// Bridge between the sandbox world and the NEAR vault. For a linked case, a bank-transfer payment the
// safety gateway accepted is also proposed to the vault, as test stablecoin, with the agent's
// function-call key. From then on the server only observes: the family approves or rejects in their
// own wallet, and the vault's proposal status drives the payment here. Nothing in this file can
// approve a payment or move tokens.
import crypto from "node:crypto";
import type { LedgerEntry, NearPaymentLink, Payment } from "@/domain/types";
import { toUSD } from "@/domain/market";
import { stableStringify } from "@/lib/canonical";
import { commitmentForProposal, commitmentHash, type VaultProposal } from "@/near/commitment";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import type { Store } from "../store";
import { setPaymentStatus, settlePayment } from "../sim/engine";
import { explorerTx, type NearConfig } from "./config";
import { refusalCode, VaultClient, type KeyCheck } from "./vault";

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
      settlePayment(this.store, paymentId);
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
   * calling approve_payment on the vault for this proposal, successfully.
   */
  async recordApprovalTx(paymentId: string, txHash: string): Promise<{ ok: boolean; reason?: string }> {
    const link = this.store.world.payments[paymentId]?.near;
    if (!link?.proposalId) return { ok: false, reason: "No NEAR proposal for this payment." };
    const owner = Object.values(this.deployment.cases).find((c) => c.vaultCaseId === link.vaultCaseId)?.owner;
    if (!owner) return { ok: false, reason: "Unknown case owner." };
    const tx = (await this.client.provider.viewTransactionStatus({ txHash, accountId: owner, waitUntil: "FINAL" })) as unknown as {
      status: Record<string, unknown>;
      transaction: { signer_id: string; receiver_id: string; actions: { FunctionCall?: { method_name: string; args: string } }[] };
    };
    const call = tx.transaction.actions.find((x) => x.FunctionCall)?.FunctionCall;
    const args = call ? (JSON.parse(Buffer.from(call.args, "base64").toString("utf8")) as { proposal_id?: string }) : {};
    const ok =
      tx.transaction.signer_id === owner &&
      tx.transaction.receiver_id === this.deployment.vault &&
      call?.method_name === "approve_payment" &&
      args.proposal_id === link.proposalId &&
      "SuccessValue" in tx.status;
    if (!ok) return { ok: false, reason: "That transaction is not a successful approval of this payment by the case owner." };
    this.update(paymentId, { approvalTx: txHash });
    await this.sync();
    return { ok: true };
  }

  /**
   * A receipt binding the invoice, the stored proposal, its commitment hash, the family's approval
   * transaction and the settled status. `receipt_hash` covers everything else in the receipt; it shows
   * the receipt was not edited, not that the bill itself was genuine.
   */
  async receipt(paymentId: string) {
    const p = this.store.world.payments[paymentId];
    const link = p?.near;
    if (!link?.proposalId) return null;
    const proposal = await this.client.getProposal(link.proposalId);
    if (!proposal) return null;
    const inv = this.store.world.invoices[p.invoiceId];
    const body = {
      kind: "kinwarden.near.receipt.v1",
      network: this.deployment.network,
      vault: this.deployment.vault,
      token: this.deployment.token,
      invoice: { number: inv.number, vault_invoice_id: link.vaultInvoiceId, institution: this.store.world.institutions[p.institutionId].name },
      proposal,
      commitment_hash: commitmentHash(commitmentForProposal(proposal, this.deployment.network, this.deployment.vault)),
      approval_tx: link.approvalTx ?? null,
      approval_tx_url: link.approvalTx ? explorerTx(this.deployment, link.approvalTx) ?? null : null,
      settled: proposal.status === "Settled",
      amount: formatTusdc(proposal.amount),
      note: "Test stablecoin on a test network. The hash shows this receipt was not edited; it does not prove the bill itself was genuine.",
    };
    return { ...body, receipt_hash: bytesToHex(sha256(new TextEncoder().encode(stableStringify(body)))) };
  }
}
