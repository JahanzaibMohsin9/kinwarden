// Bridge between the sandbox world and the NEAR vault. For a linked case, a bank-transfer payment the
// safety gateway accepted is also proposed to the vault, as test stablecoin, with the agent's
// function-call key. From then on the server only observes: the family approves or rejects in their
// own wallet, and the vault's proposal status drives the payment here. Nothing in this file can
// approve a payment or move tokens.
import crypto from "node:crypto";
import type { LedgerEntry, NearEvidence, NearPaymentLink, Payment } from "@/domain/types";
import { toUSD } from "@/domain/market";
import { stableStringify } from "@/lib/canonical";
import { commitmentForProposal, commitmentHash, type VaultProposal } from "@/near/commitment";
import { nearOutcome } from "@/near/outcome";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import type { Store } from "../store";
import { setPaymentStatus, settlePayment } from "../sim/engine";
import { explorerTx, type NearConfig } from "./config";
import { refusalCode, VaultClient, type KeyCheck } from "./vault";
import { permissionsReport, runBypass, type BypassRun } from "./bypass";

/** How long the family has to approve a proposal in their wallet. */
const TTL_SECONDS = 12 * 3600;
const TERMINAL = new Set<NearPaymentLink["state"]>(["Settled", "Failed", "Rejected", "Expired", "Invalidated", "error"]);

/** On-chain identifiers: lowercase letters, digits and dashes, at most 64 characters. */
export function opaqueId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "").slice(0, 64);
}

/** tUSDC base units (6 decimals) for an amount, at the sandbox rate on the invoice's issue date. */
export function tusdcUnits(amount: number, currency: Payment["currency"], rateDate: string): string {
  const cents = Math.round(toUSD(amount, currency, rateDate) * 100);
  return (BigInt(cents) * BigInt(10_000)).toString();
}

export function formatTusdc(units: string): string {
  const n = BigInt(units);
  const whole = n / BigInt(1_000_000);
  const frac = (n % BigInt(1_000_000)).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${frac} tUSDC`;
}

export class NearBridge {
  readonly client: VaultClient;
  keyCheck?: KeyCheck;
  /** the last gateway-bypass run against this deployment (see bypass.ts) */
  lastBypass?: BypassRun;
  private bypassing?: Promise<BypassRun>;
  private checking?: Promise<KeyCheck>;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly store: Store,
    readonly cfg: NearConfig,
  ) {
    this.client = new VaultClient(cfg);
  }

  get deployment() {
    return this.cfg.deployment;
  }

  /** What the app's agent key may do, read from the chain now. */
  permissions() {
    return permissionsReport(this.client.provider, this.deployment, this.client.publicKey);
  }

  /**
   * Try every gateway-bypass attempt with the app's real agent key against this deployment (one run
   * at a time). Refused attempts change nothing; the vault's refusals cost the key's gas allowance a
   * fraction of a milliNEAR each.
   */
  bypass(): Promise<BypassRun> {
    this.bypassing ??= (async () => {
      const links = Object.values(this.store.world.payments).flatMap((p) => (p.near ? [p.near] : []));
      const pending = links.find((l) => l.state === "PendingApproval" && l.proposalId);
      const authorized = links.find((l) => l.proposalId);
      const caseId = Object.values(this.deployment.cases)[0].vaultCaseId;
      const run = await runBypass({ provider: this.client.provider, deployment: this.deployment, agentKey: this.cfg.agentKey, caseId, pendingProposalId: pending?.proposalId, authorizedInvoiceId: authorized?.vaultInvoiceId });
      this.lastBypass = run;
      this.store.log({ actor: "near", type: "near.bypass", narration: run.held ? "Gateway-bypass check: the agent's real key was refused every time and nothing moved" : "Gateway-bypass check: NOT HELD, see the attack lab", data: { held: run.held, results: run.results.map((r) => `${r.id}:${r.refusedBy}:${r.reason}`) } });
      return run;
    })().finally(() => (this.bypassing = undefined));
    return this.bypassing;
  }

  /** The agent key is checked on chain once; a bad key disables NEAR with the reason. */
  ready(): Promise<KeyCheck> {
    this.checking ??= this.client.checkAgentKey().then((k) => {
      this.keyCheck = k;
      if (!k.ok) this.store.log({ actor: "near", type: "near.disabled", narration: `NEAR vault disabled: ${k.reason}`, data: { reason: k.reason } });
      return k;
    });
    return this.checking;
  }

  /** This world's run tag, so on-chain request and invoice ids are never reused after a reset. */
  runId(): string {
    if (!this.store.world.near) this.store.mutate((w) => (w.near = { runId: crypto.randomBytes(3).toString("hex") }));
    return this.store.world.near!.runId;
  }

  vaultInvoiceId(invoiceNumber: string): string {
    return opaqueId(`${this.runId()}-${invoiceNumber}`);
  }

  /** Bank transfers of a linked case to an enrolled institution settle on NEAR. */
  eligible(p: Payment): boolean {
    return p.route === "bank_transfer" && !!this.deployment.cases[p.caseId] && !!this.deployment.payees[p.institutionId];
  }

  hasOpenLinks(): boolean {
    return Object.values(this.store.world.payments).some((p) => (p.near && !TERMINAL.has(p.near.state)) || (!p.near && p.status === "awaiting_approval" && this.eligible(p)));
  }

  onLogged(e: LedgerEntry) {
    if (e.type === "tool.propose_payment" && e.data.decision === "needs_approval") void this.sync();
  }

  /**
   * Link and propose waiting payments, then apply what the vault reports. Passes run one at a time,
   * and each caller waits for a complete pass that started after its call. Safe to call often.
   */
  sync(): Promise<void> {
    const pass = this.queue.then(() => this.pass());
    this.queue = pass.catch(() => {});
    return pass;
  }

  private async pass(): Promise<void> {
    if (!(await this.ready()).ok) return;
    for (const id of Object.keys(this.store.world.payments)) {
      const p = this.store.world.payments[id];
      if (!p.near && p.status === "awaiting_approval" && this.eligible(p)) this.link(p);
      const link = this.store.world.payments[id].near;
      if (!link || TERMINAL.has(link.state)) continue;
      if (!link.proposalId) await this.propose(id);
      else await this.observe(id);
    }
  }

  private update(paymentId: string, patch: Partial<NearPaymentLink>) {
    this.store.mutate((w) => {
      const p = w.payments[paymentId];
      if (p.near) p.near = { ...p.near, ...patch, updatedAt: new Date().toISOString() };
    });
  }

  private link(p: Payment) {
    const inv = this.store.world.invoices[p.invoiceId];
    const link: NearPaymentLink = {
      network: this.deployment.network,
      vault: this.deployment.vault,
      vaultCaseId: this.deployment.cases[p.caseId].vaultCaseId,
      vaultInvoiceId: this.vaultInvoiceId(inv.number),
      requestId: opaqueId(`${this.runId()}-${p.id}`),
      amountUnits: tusdcUnits(p.amount, p.currency, inv.issuedAt),
      state: "proposing",
      updatedAt: new Date().toISOString(),
    };
    this.store.mutate((w) => (w.payments[p.id].near = link));
    this.store.log({
      actor: "near",
      type: "near.linked",
      caseId: p.caseId,
      narration: `This transfer will settle as ${formatTusdc(link.amountUnits)} through the NEAR vault`,
      data: { paymentId: p.id, vault: link.vault, vaultCaseId: link.vaultCaseId, vaultInvoiceId: link.vaultInvoiceId, amountUnits: link.amountUnits },
    });
  }

  private async propose(paymentId: string) {
    const p = this.store.world.payments[paymentId];
    const link = p.near!;
    try {
      const proposal = await this.client.propose({ caseId: link.vaultCaseId, invoiceId: link.vaultInvoiceId, requestId: link.requestId, amountUnits: link.amountUnits, ttlSeconds: TTL_SECONDS });
      this.update(paymentId, { proposalId: proposal.proposal_id, state: proposal.status, reason: undefined });
      this.store.log({
        actor: "near",
        type: "near.proposed",
        caseId: p.caseId,
        narration: `The NEAR vault reserved ${formatTusdc(link.amountUnits)} for ${this.store.world.institutions[p.institutionId].name}; nothing moves until you approve in your wallet`,
        data: { paymentId, proposalId: proposal.proposal_id, recipient: proposal.recipient, expiresAt: proposal.expires_at },
      });
    } catch (err) {
      const code = refusalCode(err);
      if (code === "E_INVOICE_NOT_FOUND" || code === "E_INVOICE_UNAUTHORIZED") {
        // The verifier has not authorized this invoice on chain yet; try again on the next sync.
        if (link.state !== "waiting_for_verifier") {
          this.update(paymentId, { state: "waiting_for_verifier", reason: code });
          this.store.log({ actor: "near", type: "near.waiting", caseId: p.caseId, narration: "Waiting for the verifier to authorize this invoice on NEAR", data: { paymentId, vaultInvoiceId: link.vaultInvoiceId } });
        }
        return;
      }
      if (!code) {
        // Not a contract refusal (network or RPC trouble): keep the message visible and retry on the next sync.
        this.update(paymentId, { reason: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
        return;
      }
      this.update(paymentId, { state: "error", reason: code });
      this.release(paymentId, `The NEAR vault refused this payment (${code})`, "near.refused");
    }
  }

  private async observe(paymentId: string) {
    const link = this.store.world.payments[paymentId].near!;
    const proposal = await this.client.getProposal(link.proposalId!).catch(() => null);
    if (!proposal || proposal.status === link.state) return;
    this.apply(paymentId, proposal);
  }

  /** Apply a proposal status read from the chain. Each transition happens once. */
  apply(paymentId: string, proposal: VaultProposal) {
    const p = this.store.world.payments[paymentId];
    const link = p.near!;
    const was = link.state;
    this.update(paymentId, { state: proposal.status, reason: proposal.status_reason ?? undefined });
    if (proposal.status === "PendingApproval") return;
    if (proposal.status === "Rejected") {
      this.decide(paymentId, "declined");
      setPaymentStatus(this.store, paymentId, "cancelled", "Rejected in the family's NEAR wallet");
      this.store.trigger({ caseId: p.caseId, reason: "approval_decided", detail: `declined in wallet: ${paymentId}` });
      return;
    }
    if (proposal.status === "Expired" || proposal.status === "Invalidated") {
      this.release(paymentId, `The NEAR vault released this payment (${proposal.status_reason ?? proposal.status})`, "near.released");
      return;
    }
    // Submitted, Settled or Failed: the family's wallet approved it.
    if (was === "PendingApproval" || was === "proposing" || was === "waiting_for_verifier") {
      this.decide(paymentId, "approved");
      setPaymentStatus(this.store, paymentId, "approved", "Approved in the family's NEAR wallet");
      setPaymentStatus(this.store, paymentId, "submitted", "Sent by the NEAR vault");
      this.store.log({ actor: "near", type: "payment.submitted", caseId: p.caseId, narration: `The NEAR vault sent ${formatTusdc(link.amountUnits)}`, data: { paymentId, proposalId: link.proposalId } });
    }
    if (proposal.status === "Settled") {
      const ack = settlePayment(this.store, paymentId);
      if (ack) this.update(paymentId, { institutionAck: { ...ack, at: this.store.world.now } });
    } else if (proposal.status === "Failed") {
      const reason = "The NEAR transfer failed; the vault kept the funds in the case. A new proposal and a new approval are needed.";
      setPaymentStatus(this.store, paymentId, "returned", reason);
      this.store.log({ actor: "near", type: "payment.returned", caseId: p.caseId, narration: reason, data: { paymentId, proposalId: link.proposalId } });
      this.store.trigger({ caseId: p.caseId, reason: "payment_returned", detail: `${paymentId}: ${reason}` });
    }
  }

  /** The family's decision, as the chain shows it. The server never makes this decision. */
  private decide(paymentId: string, decision: "approved" | "declined") {
    const p = this.store.world.payments[paymentId];
    const a = p.approvalId ? this.store.world.approvals[p.approvalId] : undefined;
    if (!a || a.decision) return;
    this.store.mutate((w) => {
      w.approvals[a.id].decision = decision;
      w.approvals[a.id].decidedAt = w.now;
      w.approvals[a.id].method = "near_wallet";
    });
    this.store.log({
      actor: "family",
      type: decision === "approved" ? "approval.approved" : "approval.declined",
      caseId: a.caseId,
      narration: decision === "approved" ? `You approved in your NEAR wallet: ${a.summary}` : `You rejected in your NEAR wallet: ${a.summary}`,
      data: { approvalId: a.id, paymentId, method: "near_wallet", proposalId: p.near?.proposalId, approvalTx: p.near?.approvalTx },
    });
  }

  /** The payment cannot go ahead on NEAR: close its approval and tell the agent. */
  private release(paymentId: string, reason: string, type: string) {
    const p = this.store.world.payments[paymentId];
    const a = p.approvalId ? this.store.world.approvals[p.approvalId] : undefined;
    if (a && !a.decision) this.store.mutate((w) => Object.assign(w.approvals[a.id], { decision: "declined", decidedAt: w.now }));
    setPaymentStatus(this.store, paymentId, "cancelled", reason);
    this.store.log({ actor: "near", type, caseId: p.caseId, narration: reason, data: { paymentId, proposalId: p.near?.proposalId, reason: p.near?.reason } });
    this.store.trigger({ caseId: p.caseId, reason: "payment_cancelled", detail: `${paymentId}: ${reason}` });
  }

  /**
   * The wallet reported an approval transaction. Keep it only if the chain shows the case owner
   * calling approve_payment on the vault for this proposal, successfully. The transaction's later
   * steps (the token transfer and the vault's callback) are kept as settlement evidence.
   */
  async recordApprovalTx(paymentId: string, txHash: string): Promise<{ ok: boolean; reason?: string }> {
    const link = this.store.world.payments[paymentId]?.near;
    if (!link?.proposalId) return { ok: false, reason: "No NEAR proposal for this payment." };
    const owner = Object.values(this.deployment.cases).find((c) => c.vaultCaseId === link.vaultCaseId)?.owner;
    if (!owner) return { ok: false, reason: "Unknown case owner." };
    const tx = (await this.client.provider.viewTransactionStatus({ txHash, accountId: owner, waitUntil: "FINAL" })) as unknown as FinalTx;
    const call = tx.transaction.actions.find((x) => x.FunctionCall)?.FunctionCall;
    const args = call ? (JSON.parse(Buffer.from(call.args, "base64").toString("utf8")) as { proposal_id?: string }) : {};
    const ok =
      tx.transaction.signer_id === owner &&
      tx.transaction.receiver_id === this.deployment.vault &&
      call?.method_name === "approve_payment" &&
      args.proposal_id === link.proposalId &&
      "SuccessValue" in tx.status;
    if (!ok) return { ok: false, reason: "That transaction is not a successful approval of this payment by the case owner." };
    const times = await this.blockTimes(tx.receipts_outcome.map((r) => r.block_hash));
    this.update(paymentId, { approvalTx: txHash, evidence: evidenceFromTx(tx, this.deployment, times) });
    await this.sync();
    return { ok: true };
  }

  private async blockTimes(hashes: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const h of new Set(hashes)) {
      const block = await this.client.provider.viewBlock({ blockId: h });
      out[h] = nsToIso(block.header.timestamp_nanosec);
    }
    return out;
  }

  /**
   * The case receipt: what was paid to whom, the family's approval and the settlement as separate
   * on-chain observations, whether delivery is confirmed, failed or unknown, where the reserved money
   * is and what to do next, and the institution's own acknowledgement as a separate event.
   * `receipt_hash` covers everything else in the receipt; it shows the receipt was not edited, not
   * that the bill itself was genuine.
   */
  async receipt(paymentId: string) {
    const p = this.store.world.payments[paymentId];
    const link = p?.near;
    if (!link?.proposalId) return null;
    const proposal = await this.client.getProposal(link.proposalId);
    if (!proposal) return null;
    return buildReceipt({
      deployment: this.deployment,
      payment: p,
      link,
      proposal,
      invoiceNumber: this.store.world.invoices[p.invoiceId].number,
      institution: this.store.world.institutions[p.institutionId].name,
    });
  }
}

/** The parts of a final transaction status the bridge reads. */
export interface FinalTx {
  status: Record<string, unknown>;
  transaction: { signer_id: string; receiver_id: string; actions: { FunctionCall?: { method_name: string; args: string } }[] };
  receipts_outcome: { id: string; block_hash: string; outcome: { executor_id: string; logs: string[]; status: Record<string, unknown> } }[];
}

function nsToIso(ns: string | number): string {
  return new Date(Number(BigInt(ns) / BigInt(1_000_000))).toISOString();
}

type Nep141Event = { standard?: string; event?: string; data?: { old_owner_id: string; new_owner_id: string; amount: string }[] };

/**
 * Settlement evidence from a final approve_payment transaction: the vault's approval step, the token
 * contract's transfer step (with its NEP-141 event, if it succeeded) and the vault's callback.
 */
export function evidenceFromTx(tx: FinalTx, d: { vault: string; token: string }, times: Record<string, string>): NearEvidence {
  const step = (r: FinalTx["receipts_outcome"][number]) => ({ receiptId: r.id, blockHash: r.block_hash, at: times[r.block_hash] ?? "", ok: !("Failure" in r.outcome.status) });
  const approval = tx.receipts_outcome.find((r) => r.outcome.executor_id === d.vault)!;
  const evidence: NearEvidence = { approval: { ...step(approval), signer: tx.transaction.signer_id } };
  const transfer = tx.receipts_outcome.find((r) => r.outcome.executor_id === d.token);
  if (transfer) {
    const event = transfer.outcome.logs
      .filter((l) => l.startsWith("EVENT_JSON:"))
      .map((l) => JSON.parse(l.slice("EVENT_JSON:".length)) as Nep141Event)
      .find((e) => e.standard === "nep141" && e.event === "ft_transfer")?.data?.[0];
    evidence.tokenTransfer = { ...step(transfer), token: d.token, ...(event ? { from: event.old_owner_id, to: event.new_owner_id, amount: event.amount } : {}) };
  }
  const callback = tx.receipts_outcome.find((r) => r.outcome.executor_id === d.vault && r.outcome.logs.some((l) => l.startsWith("proposal_finished")));
  if (callback) {
    const value = callback.outcome.status.SuccessValue;
    const result = typeof value === "string" && value ? (JSON.parse(Buffer.from(value, "base64").toString("utf8")) as string) : undefined;
    evidence.vaultCallback = { ...step(callback), ...(result ? { result } : {}) };
  }
  return evidence;
}

export function buildReceipt(input: { deployment: NearConfig["deployment"]; payment: Payment; link: NearPaymentLink; proposal: VaultProposal; invoiceNumber: string; institution: string }) {
  const { deployment: d, payment: p, link, proposal } = input;
  const ev = link.evidence;
  const outcome = nearOutcome(proposal.status);
  const txUrl = (hash?: string) => (hash ? (explorerTx(d, hash) ?? null) : null);
  const t = ev?.tokenTransfer;
  const finished = proposal.status === "Settled" || proposal.status === "Failed";
  const body = {
    kind: "kinwarden.near.receipt.v1",
    network: d.network,
    vault: d.vault,
    paid_to: { institution: input.institution, account: proposal.recipient },
    token: { contract: proposal.token, symbol: d.tokenSymbol, decimals: d.tokenDecimals },
    amount: { units: proposal.amount, display: formatTusdc(proposal.amount) },
    invoice: { number: input.invoiceNumber, vault_invoice_id: link.vaultInvoiceId },
    outcome: {
      delivery: outcome.delivery,
      vault_status: proposal.status,
      status_reason: proposal.status_reason ?? null,
      reserved_funds: outcome.funds,
      next_step: outcome.next,
      recorded_by_vault_at: finished ? nsToIso(proposal.updated_at) : null,
    },
    approval: link.approvalTx
      ? { by: ev?.approval.signer ?? null, approved_at: ev?.approval.at ?? null, tx: link.approvalTx, tx_url: txUrl(link.approvalTx), receipt_id: ev?.approval.receiptId ?? null }
      : null,
    settlement: t
      ? {
          token_transfer: {
            succeeded: t.ok,
            observed_at: t.at,
            receipt_id: t.receiptId,
            from: t.from ?? null,
            to: t.to ?? null,
            amount_units: t.amount ?? null,
            matches_proposal: t.ok && t.from === d.vault && t.to === proposal.recipient && t.amount === proposal.amount && t.token === proposal.token,
          },
          vault_callback: ev?.vaultCallback ? { result: ev.vaultCallback.result ?? null, observed_at: ev.vaultCallback.at, receipt_id: ev.vaultCallback.receiptId } : null,
          tx_url: txUrl(link.approvalTx),
        }
      : null,
    institution_acknowledgement: link.institutionAck
      ? {
          simulated: true,
          document_id: link.institutionAck.docId,
          mail_id: link.institutionAck.mailId ?? null,
          sandbox_time: link.institutionAck.at,
          note: "Sent by the simulated hospital after the vault settled: a separate event from the on-chain transfer.",
        }
      : null,
    proposal,
    commitment_hash: commitmentHash(commitmentForProposal(proposal, d.network, d.vault)),
    app_payment_status: p.status,
    note: "Test stablecoin on a test network. Delivery follows the vault's record: an approval or a submitted transaction alone does not confirm delivery. The hash shows this receipt was not edited; it does not prove the bill itself was genuine.",
  };
  return { ...body, receipt_hash: bytesToHex(sha256(new TextEncoder().encode(stableStringify(body)))) };
}

export type NearReceipt = ReturnType<typeof buildReceipt>;
