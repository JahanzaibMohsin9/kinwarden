import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { seedScenario } from "../scenarios";
import { executeTool } from "../agent/tools";
import { decideApprovalIn } from "../runtime";
import { formatTusdc, opaqueId, tusdcUnits } from "./bridge";
import type { Payment } from "@/domain/types";

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
