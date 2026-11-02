// Anchoring: at each case milestone the activity log's head hash is copied to a public chain, so
// anyone can later prove the log wasn't edited after that point. Runs beside the agent and never
// blocks it; the agent has no tool for it and never sees the key.
import type { LedgerEntry } from "@/domain/types";
import { verifyChain } from "../hash";
import type { Anchor, Store } from "../store";
import { explorerTx, type ChainPublisher } from "./chain";

/** Log entries worth an anchor: what a family, a bank or an auditor would ask about later. */
export const MILESTONES: Record<string, string> = {
  "case.opened": "case opened",
  "approval.approved": "payment approved",
  "payment.completed": "payment received",
  "payment.returned": "payment returned",
  "refund.received": "refund received",
  "institution.verified": "institution verified",
  "tool.flag_suspicious_message": "fraud flagged",
  "tool.close_case": "case closed",
};

export function milestoneOf(e: LedgerEntry): string | undefined {
  const label = MILESTONES[e.type];
  if (!label) return undefined;
  if (e.type.startsWith("tool.") && e.data.decision !== "allowed") return undefined;
  return label;
}

export interface AnchorCheck {
  ok: boolean;
  /** what was found on the chain for this anchor's transaction */
  onChain?: { head: string; seq: number; label: string; blockNumber: number };
  explorerUrl?: string;
  /** the log up to the anchored entry, recomputed now */
  log: { ok: boolean; brokenAt?: number; reason?: string };
  reason?: string;
}

/** One wallet signs for every visitor's world, so its transactions go out one at a time (one nonce sequence). */
const queues = new WeakMap<ChainPublisher, Promise<void>>();

export class AnchorService {
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private store: Store,
    private publisher: ChainPublisher,
    private opts: { debounceMs?: number; retries?: number; retryMs?: number } = {},
  ) {}

  /** Several milestones in quick succession (approve → submitted → …) share one anchor. */
  milestone(label: string) {
    this.pending.add(label);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.opts.debounceMs ?? 2500);
  }

  /** Anchor the current head now (also used by the Director's Anchor button). */
  flush(note?: string): Anchor | undefined {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const labels = [...this.pending, ...(note ? [note] : [])];
    this.pending.clear();
    if (!labels.length || !this.store.ledger.length) return undefined;
    const anchor = this.store.addAnchor(labels.join(", "));
    this.publish(anchor);
    return anchor;
  }

  /** Queue this anchor behind every other world's, retrying network errors. */
  publish(anchor: Anchor) {
    const base = { chainId: this.publisher.chainId, contract: this.publisher.contract };
    this.store.updateAnchor(anchor.id, { ...base, status: "pending" });
    // the on-chain label says what kind of moment it was, never who or how much
    const label = `${this.store.world.scenarioId}:${anchor.note}`.slice(0, 96);
    const queue = (queues.get(this.publisher) ?? Promise.resolve()).then(async () => {
      let lastError = "";
      for (let attempt = 1; attempt <= (this.opts.retries ?? 3); attempt++) {
        try {
          const txHash = await this.publisher.publish({ head: anchor.hash, seq: anchor.seq, label });
          this.store.updateAnchor(anchor.id, { ...base, status: "pending", txHash, explorerUrl: explorerTx(txHash) });
          const r = await this.publisher.confirm(txHash);
          this.store.updateAnchor(anchor.id, { ...base, status: r.ok ? "confirmed" : "failed", txHash, blockNumber: r.blockNumber, explorerUrl: explorerTx(txHash), ...(r.ok ? {} : { error: "Transaction reverted" }) });
          return;
        } catch (err) {
          lastError = err instanceof Error ? (err as { shortMessage?: string }).shortMessage ?? err.message : String(err);
          await new Promise((r) => setTimeout(r, (this.opts.retryMs ?? 3000) * attempt));
        }
      }
      this.store.updateAnchor(anchor.id, { ...base, status: "failed", error: lastError.slice(0, 200) });
    });
    queues.set(this.publisher, queue);
  }

  /** Re-check an anchor against the chain and against the log as it is now. */
  async check(anchorId: string): Promise<AnchorCheck> {
    const a = this.store.anchors.find((x) => x.id === anchorId);
    if (!a) return { ok: false, log: { ok: false }, reason: "No such anchor." };
    const upTo = this.store.ledger.filter((e) => e.seq <= a.seq);
    const chain = verifyChain(upTo);
    const log = { ok: chain.ok && chain.headHash === a.hash, brokenAt: chain.brokenAt, reason: chain.reason ?? (chain.headHash !== a.hash ? "The log's head no longer matches the anchored hash" : undefined) };
    if (!a.chain?.txHash) return { ok: false, log, reason: "This anchor is not on the chain yet." };
    const onChain = await this.publisher.read(a.chain.txHash);
    if (!onChain) return { ok: false, log, explorerUrl: a.chain.explorerUrl, reason: "No Kinwarden anchor found in that transaction." };
    const matches = onChain.head === a.hash && onChain.seq === a.seq;
    return {
      ok: matches && log.ok,
      onChain,
      explorerUrl: a.chain.explorerUrl,
      log,
      reason: !matches ? "The chain holds a different hash for this anchor." : !log.ok ? `The log was changed after it was anchored (entry #${log.brokenAt ?? "?"}).` : undefined,
    };
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
