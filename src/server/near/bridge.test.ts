import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { seedScenario } from "../scenarios";
import { executeTool } from "../agent/tools";
import { decideApprovalIn } from "../runtime";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { stableStringify } from "@/lib/canonical";
import type { VaultProposal } from "@/near/commitment";
import { buildReceipt, evidenceFromTx, formatTusdc, opaqueId, tusdcUnits, type FinalTx } from "./bridge";
import type { NearPaymentLink, Payment } from "@/domain/types";

describe("on-chain identifiers and amounts", () => {
  it("makes opaque vault ids from app ids", () => {
    expect(opaqueId("a1b2c3-SRH-DEP-0001")).toBe("a1b2c3-srh-dep-0001");
    expect(opaqueId("a1b2c3-pay_12")).toBe("a1b2c3-pay-12");
    expect(opaqueId("x".repeat(80))).toHaveLength(64);
  });

  it("converts at the invoice date's rate, to the cent, in 6-decimal units", () => {
    const units = tusdcUnits(250000, "THB", "2026-03-02T09:00:00.000Z");
    expect(BigInt(units) % BigInt(10_000)).toBe(BigInt(0));
    expect(units).toBe(tusdcUnits(250000, "THB", "2026-03-02T09:00:00.000Z"));
    expect(formatTusdc("7142860000")).toBe("7,142.86 tUSDC");
  });
});

/** A world with one deposit payment marked as settling through NEAR. */
function worldWithNearPayment(status: Payment["status"]) {
  const store = new Store();
  store.reset(seedScenario("th-medical"));
  const invoiceId = Object.keys(store.world.invoices)[0] ?? "inv_x";
  const payment = {
    id: "pay_1",
    caseId: "case_th",
    invoiceId,
    institutionId: "srh",
    route: "bank_transfer",
    amount: 1,
    currency: "THB",
    payerId: "p_tariq",
    reference: "Deposit",
    beneficiary: { accountName: "", accountNumber: "", swift: "", bankName: "" },
    rationale: "",
    status,
    statusHistory: [],
    approvalId: "apr_1",
    createdAt: store.world.now,
    attempts: 1,
    near: { network: "sandbox", vault: "vault", vaultCaseId: "case", vaultInvoiceId: "inv", requestId: "req", amountUnits: "1", state: "Failed", updatedAt: "" },
  } as unknown as Payment;
  store.mutate((w) => {
    w.payments.pay_1 = payment;
    w.approvals.apr_1 = { id: "apr_1", caseId: "case_th", paymentId: "pay_1", requestedAt: w.now, summary: "deposit" };
  });
  return store;
}

describe("NEAR payments stay under the family's wallet", () => {
  it("cannot be approved or declined over HTTP", () => {
    const store = worldWithNearPayment("awaiting_approval");
    expect(() => decideApprovalIn(store, "apr_1", "approved", "hold")).toThrow(/NEAR wallet/);
    expect(() => decideApprovalIn(store, "apr_1", "declined", "hold")).toThrow(/NEAR wallet/);
    expect(store.world.approvals.apr_1.decision).toBeUndefined();
  });

  it("a failed NEAR transfer cannot be resent without a new approval", () => {
    const store = worldWithNearPayment("returned");
    const out = JSON.parse(executeTool("resubmit_payment", { payment_id: "pay_1", corrected_reference: "Deposit again", narration: "Resending the deposit" }, { store, caseId: "case_th" }));
    expect(out.error).toMatch(/new propose_payment and a new approval/);
    expect(store.world.payments.pay_1.status).toBe("returned");
  });
});

describe("case receipt evidence", () => {
  const d = {
    network: "testnet" as const,
    rpcUrl: "https://rpc.testnet.near.org",
    explorerTx: "https://testnet.nearblocks.io/txns/",
    vault: "vault.demo.testnet",
    token: "tusdc.demo.testnet",
    tokenSymbol: "tUSDC",
    tokenDecimals: 6,
    verifier: "verifier.demo.testnet",
    agent: "agent.demo.testnet",
    caseLimits: { per_payment_max: "1", rolling_24h_cap: "1", lifetime_cap: "1", group_caps: [] },
    cases: { case_th: { vaultCaseId: "case-th", owner: "family.testnet" } },
    payees: { srh: { payeeId: "srh", account: "srh.demo.testnet" } },
  };
  const proposal = (status: VaultProposal["status"]): VaultProposal => ({
    proposal_id: "3",
    case_id: "case-th",
    invoice_id: "run-srh-dep-0001",
    request_id: "run-pay-1",
    attempt: 1,
    payee_id: "srh",
    recipient: "srh.demo.testnet",
    token: "tusdc.demo.testnet",
    amount: "7142860000",
    purpose_group: "Hospital",
    ttl_seconds: 43200,
    created_at: "1793700000000000000",
    expires_at: "1793743200000000000",
    policy_version: 1,
    payee_version: 2,
    status,
    status_reason: status === "Failed" ? "E_TRANSFER_FAILED" : null,
    updated_at: "1793700060000000000",
  });
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const transferEvent = (to: string) =>
    `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer", data: [{ old_owner_id: d.vault, new_owner_id: to, amount: "7142860000" }] })}`;
  const finalTx = (transferOk: boolean, to = "srh.demo.testnet"): FinalTx => ({
    status: { SuccessValue: b64(transferOk ? '"Settled"' : '"Failed"') },
    transaction: { signer_id: "family.testnet", receiver_id: d.vault, actions: [] },
    receipts_outcome: [
      { id: "R1", block_hash: "B1", outcome: { executor_id: d.vault, logs: [], status: { SuccessReceiptId: "R3" } } },
      transferOk
        ? { id: "R2", block_hash: "B2", outcome: { executor_id: d.token, logs: [transferEvent(to)], status: { SuccessValue: "" } } }
        : { id: "R2", block_hash: "B2", outcome: { executor_id: d.token, logs: [], status: { Failure: { ActionError: {} } } } },
      { id: "R3", block_hash: "B3", outcome: { executor_id: d.vault, logs: [`proposal_finished 3 status=${transferOk ? "Settled" : "Failed"}`], status: { SuccessValue: b64(transferOk ? '"Settled"' : '"Failed"') } } },
    ],
  });
  const times = { B1: "2026-11-03T10:00:00.000Z", B2: "2026-11-03T10:00:01.000Z", B3: "2026-11-03T10:00:02.000Z" };
  const payment = { id: "pay_1", status: "completed" } as unknown as Payment;
  const link = (state: NearPaymentLink["state"], extra: Partial<NearPaymentLink> = {}): NearPaymentLink => ({
    network: "testnet",
    vault: d.vault,
    vaultCaseId: "case-th",
    vaultInvoiceId: "run-srh-dep-0001",
    requestId: "run-pay-1",
    amountUnits: "7142860000",
    proposalId: "3",
    state,
    updatedAt: "",
    ...extra,
  });
  const receipt = (status: VaultProposal["status"], l: NearPaymentLink) =>
    buildReceipt({ deployment: d, payment, link: l, proposal: proposal(status), invoiceNumber: "SRH-DEP-0001", institution: "Siam Riverside Hospital" });

  it("reads approval, token transfer and vault callback as separate steps", () => {
    const ev = evidenceFromTx(finalTx(true), d, times);
    expect(ev.approval).toEqual({ receiptId: "R1", blockHash: "B1", at: times.B1, ok: true, signer: "family.testnet" });
    expect(ev.tokenTransfer).toMatchObject({ receiptId: "R2", at: times.B2, ok: true, from: d.vault, to: "srh.demo.testnet", amount: "7142860000" });
    expect(ev.vaultCallback).toMatchObject({ receiptId: "R3", at: times.B3, result: "Settled" });
  });

  it("a delivered receipt shows the exact recipient, token and amount, with approval and settlement apart", () => {
    const r = receipt("Settled", link("Settled", { approvalTx: "TxHash1", evidence: evidenceFromTx(finalTx(true), d, times), institutionAck: { docId: "doc_9", mailId: "mail_4", at: "2026-03-02T10:00:00.000Z" } }));
    expect(r.paid_to).toEqual({ institution: "Siam Riverside Hospital", account: "srh.demo.testnet" });
    expect(r.token).toEqual({ contract: d.token, symbol: "tUSDC", decimals: 6 });
    expect(r.amount).toEqual({ units: "7142860000", display: "7,142.86 tUSDC" });
    expect(r.outcome).toMatchObject({ delivery: "delivered", vault_status: "Settled" });
    expect(r.approval).toMatchObject({ by: "family.testnet", approved_at: times.B1, tx_url: "https://testnet.nearblocks.io/txns/TxHash1" });
    expect(r.settlement?.token_transfer).toMatchObject({ succeeded: true, observed_at: times.B2, matches_proposal: true });
    expect(r.settlement?.vault_callback).toMatchObject({ result: "Settled", observed_at: times.B3 });
    expect(r.institution_acknowledgement).toMatchObject({ simulated: true, document_id: "doc_9" });
    const { receipt_hash, ...body } = r;
    expect(receipt_hash).toBe(bytesToHex(sha256(new TextEncoder().encode(stableStringify(body)))));
  });

  it("a transfer to another account is flagged, not counted as matching", () => {
    const r = receipt("Settled", link("Settled", { approvalTx: "TxHash1", evidence: evidenceFromTx(finalTx(true, "someone.testnet"), d, times) }));
    expect(r.settlement?.token_transfer.matches_proposal).toBe(false);
  });

  it("a failed transfer says the money is back in the case and what to do next", () => {
    const r = receipt("Failed", link("Failed", { approvalTx: "TxHash2", evidence: evidenceFromTx(finalTx(false), d, times) }));
    expect(r.outcome).toMatchObject({ delivery: "failed", status_reason: "E_TRANSFER_FAILED" });
    expect(r.outcome.reserved_funds).toMatch(/back in the case/);
    expect(r.outcome.next_step).toMatch(/new approval/);
    expect(r.settlement?.token_transfer).toMatchObject({ succeeded: false, from: null, matches_proposal: false });
    expect(r.settlement?.vault_callback?.result).toBe("Failed");
    expect(r.institution_acknowledgement).toBeNull();
  });

  it("an approved but unconfirmed payment is unknown, with no settlement claimed", () => {
    const r = receipt("Submitted", link("Submitted", { approvalTx: "TxHash3" }));
    expect(r.outcome).toMatchObject({ delivery: "unknown", recorded_by_vault_at: null });
    expect(r.outcome.reserved_funds).toMatch(/in flight/);
    expect(r.settlement).toBeNull();
  });
});
