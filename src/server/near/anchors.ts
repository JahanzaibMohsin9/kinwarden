// Anchoring the activity log on NEAR: the vault's anchor_log, signed with the agent's restricted key.
// Plugs into the existing AnchorService (src/server/anchor) in place of the Conflux publisher for the
// world linked to a vault case. Only the head hash, its sequence number and a short label go on chain.
import type { ChainPublisher, OnChainRecord } from "../anchor/chain";
import type { FinalTx } from "./bridge";
import { explorerTx } from "./config";
import type { VaultClient } from "./vault";

interface AnchoredEvent {
  standard?: string;
  event?: string;
  data?: { case_id: string; index: string; seq: string; head: string; label: string }[];
}

/** The vault's log_anchored event in a final transaction, if any. */
export function anchoredEvent(tx: FinalTx, vault: string): NonNullable<AnchoredEvent["data"]>[number] | null {
  for (const r of tx.receipts_outcome) {
    if (r.outcome.executor_id !== vault) continue;
    for (const line of r.outcome.logs) {
      if (!line.startsWith("EVENT_JSON:")) continue;
      const ev = JSON.parse(line.slice("EVENT_JSON:".length)) as AnchoredEvent;
      if (ev.standard === "kinwarden" && ev.event === "log_anchored" && ev.data?.[0]) return ev.data[0];
    }
  }
  return null;
}

/** The on-chain label: the world's run tag first (a reset world starts its log again), plain ASCII, at most 96. */
export function anchorLabel(runId: string, label: string): string {
  return `${runId}:${label}`.replace(/[^ -~]/g, "?").slice(0, 96);
}

export function nearPublisher(client: VaultClient, caseId: string, runId: () => string): ChainPublisher {
  const d = client.deployment;
  const final = (txHash: string) => client.provider.viewTransactionStatus({ txHash, accountId: d.agent, waitUntil: "FINAL" }) as unknown as Promise<FinalTx>;
  const heightOf = async (tx: FinalTx) => {
    const r = tx.receipts_outcome.find((x) => x.outcome.executor_id === d.vault);
    return r ? (await client.provider.viewBlock({ blockId: r.block_hash })).header.height : 0;
  };
  return {
    chainId: `near:${d.network}`,
    contract: d.vault,
    explorerTx: (txHash) => explorerTx(d, txHash),
    publish: ({ head, seq, label }) => client.anchor(caseId, seq, head, anchorLabel(runId(), label)),
    confirm: async (txHash) => {
      const tx = await final(txHash);
      return { ok: "SuccessValue" in tx.status && anchoredEvent(tx, d.vault) !== null, blockNumber: await heightOf(tx) };
    },
    read: async (txHash): Promise<OnChainRecord | null> => {
      const tx = await final(txHash);
      const ev = anchoredEvent(tx, d.vault);
      if (!ev || ev.case_id !== caseId) return null;
      return { head: ev.head, seq: Number(ev.seq), label: ev.label, blockNumber: await heightOf(tx), contract: d.vault };
    },
  };
}
