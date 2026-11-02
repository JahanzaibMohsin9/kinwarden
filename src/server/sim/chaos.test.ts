import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { seedScenario } from "../scenarios";
import { executeTool } from "../agent/tools";
import { INSTITUTIONS } from "@/domain/institutions";
import { advanceTo, injectChaos, submitPayment } from "./engine";
import { hoursFrom, issueInvoice } from "./factory";

function setup() {
  const store = new Store();
  store.reset(seedScenario("th-medical"));
  const triggers: { reason: string; detail?: string }[] = [];
  store.on("trigger", (t) => triggers.push(t));
  const inv = issueInvoice(store, { caseId: "case_th", institutionId: "srh", kind: "deposit_request", title: "Deposit", patientName: "Mr. Tariq Mahmood", patientRef: "HN 66-014382", lineItems: [{ description: "Deposit", amount: 160000 }], dueInHours: 40 });
  const b = INSTITUTIONS.srh.bank;
  const tool = (name: string, input: Record<string, unknown>) => JSON.parse(executeTool(name, { narration: "test", ...input }, { store, caseId: "case_th" }));
  const propose = (route: string) =>
    tool("propose_payment", { invoice_id: inv.id, route, amount: 160000, payer_id: "p_tariq", reference: "HN 66-014382", beneficiary: { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName }, rationale: "test rationale" });
  const approve = (paymentId: string) => {
    store.mutate((w) => (w.payments[paymentId].status = "approved"));
    submitPayment(store, store.world.payments[paymentId]);
  };
  return { store, triggers, inv, tool, propose, approve };
}

describe("chaos mode", () => {
  it("a bank outage bounces the next transfer once, and it can be resent unchanged", () => {
    const { store, tool, propose, approve, inv, triggers } = setup();
    tool("prepare_documents", { kinds: ["remittance_application", "self_declaration"], invoice_id: inv.id, payer_id: "p_tariq", amount: 160000 });
    injectChaos(store, "bank_outage");
    const p = propose("bank_transfer");
    approve(p.payment_id);
    advanceTo(store, hoursFrom(store.world.now, 7));
    expect(store.world.payments[p.payment_id].status).toBe("returned");
    expect(triggers.some((t) => t.reason === "payment_returned")).toBe(true);
    expect(tool("resubmit_payment", { payment_id: p.payment_id, corrected_reference: "HN 66-014382" }).resubmitted).toBe(true);
    advanceTo(store, hoursFrom(store.world.now, 60));
    expect(store.world.payments[p.payment_id].status).toBe("completed");
  });

  it("a declined card charges nothing and wakes the agent; another payment can be proposed", () => {
    const { store, propose, approve, triggers } = setup();
    injectChaos(store, "card_decline");
    const p = propose("card_payment");
    approve(p.payment_id);
    expect(store.world.payments[p.payment_id].status).toBe("rejected");
    expect(triggers.at(-1)?.reason).toBe("payment_declined");
    expect(propose("card_payment").status).toBe("awaiting_family_approval");
  });

  it("a silent institution answers only after the silence", () => {
    const { store, tool } = setup();
    injectChaos(store, "silent");
    const until = store.world.chaos!.silentUntil!;
    tool("send_email", { to: INSTITUTIONS.srh.email, subject: "Estimate", body: "Please send the estimate." });
    advanceTo(store, hoursFrom(store.world.now, 24));
    expect(Object.values(store.world.mail).filter((m) => m.direction === "inbound")).toHaveLength(0);
    advanceTo(store, hoursFrom(until, 2));
    expect(Object.values(store.world.mail).filter((m) => m.direction === "inbound")).toHaveLength(1);
  });
});
