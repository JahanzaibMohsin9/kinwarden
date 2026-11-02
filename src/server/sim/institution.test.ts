import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { seedScenario } from "../scenarios";
import { executeTool } from "../agent/tools";
import { caseSnapshot } from "../agent/snapshot";
import { advanceTo, advanceToNext, nextScheduled } from "./engine";
import { detectIntents } from "./institution";
import { hoursFrom } from "./factory";

function boot(scenarioId = "th-medical") {
  const store = new Store();
  store.load(() => seedScenario(scenarioId));
  store.reset(seedScenario(scenarioId));
  const triggers: string[] = [];
  store.on("trigger", (t) => triggers.push(t.reason));
  const caseId = scenarioId === "th-medical" ? "case_th" : "case_uk";
  const tool = (name: string, input: Record<string, unknown>) => JSON.parse(executeTool(name, { narration: "test step", ...input }, { store, caseId }));
  const email = (subject: string, body: string) =>
    tool("send_email", { to: scenarioId === "th-medical" ? "international@siamriverside.co.th" : "student.finance@kingsgate.ac.uk", subject, body });
  /** advance until the institution's reply to `mailId` has arrived, and return it */
  const replyTo = (mailId: string) => {
    for (let i = 0; i < 10; i++) {
      const r = Object.values(store.world.mail).find((m) => m.inReplyTo === mailId);
      if (r) return r;
      advanceToNext(store);
    }
    throw new Error("no reply");
  };
  return { store, triggers, tool, email, replyTo, caseId };
}

describe("sandbox institution replies", () => {
  it("detects every question in one email", () => {
    expect(detectIntents("Please confirm your bank details are unchanged, that the email from siamriverside-payments.com was a scam, and send the itemised final bill.")).toEqual(
      expect.arrayContaining(["bank_details", "fraud_alert", "statement"]),
    );
  });

  it("answers a multi-question email in one reply, with the estimate and the bank letter", () => {
    const { store, email, replyTo } = boot();
    advanceToNext(store); // case opens
    const sent = email("Estimate request", "Please send the estimate and deposit, your bank details on letterhead, and the patient's HN.");
    const reply = replyTo(sent.mail_id);
    expect(reply.topics).toEqual(expect.arrayContaining(["estimate", "bank_details"]));
    const kinds = reply.attachments.map((d) => store.world.docs[d].kind);
    expect(kinds).toEqual(expect.arrayContaining(["invoice", "bank_letter"]));
    expect(Object.values(store.world.mail).filter((m) => m.inReplyTo === sent.mail_id)).toHaveLength(1);
  });

  it("says when the final bill will come instead of a generic reply, and doesn't re-issue the estimate", () => {
    const { store, email, replyTo } = boot();
    advanceToNext(store);
    replyTo(email("Estimate", "Please send the estimate.").mail_id);
    const before = Object.keys(store.world.invoices).length;
    const reply = replyTo(
      email(
        "Account confirmation",
        "1. Please confirm your bank details have not changed; we received a suspicious email from billing@siamriverside-payments.com.\n2. Please send the itemised final bill and current statement.\n3. We are not asserting a refund is owed.",
      ).mail_id,
    );
    expect(reply.topics).toEqual(expect.arrayContaining(["bank_details", "fraud_alert", "statement", "refund"]));
    expect(reply.body).toMatch(/did not come from us/);
    expect(reply.body).toMatch(/final itemised bill is not ready yet/);
    expect(reply.body).toMatch(/discharge/);
    expect(reply.body).not.toMatch(/no refund is due/i);
    expect(Object.keys(store.world.invoices)).toHaveLength(before);
  });

  it("acknowledges a transfer that is on its way without asking to be chased", () => {
    const { store, email, replyTo, tool } = boot();
    advanceToNext(store);
    replyTo(email("Estimate", "Please send the estimate.").mail_id);
    const inv = Object.values(store.world.invoices)[0];
    tool("prepare_documents", { kinds: ["remittance_application", "self_declaration"], invoice_id: inv.id, payer_id: "p_tariq", amount: 250000 });
    const p = tool("propose_payment", {
      invoice_id: inv.id,
      route: "bank_transfer",
      amount: 250000,
      payer_id: "p_tariq",
      reference: "HN 66-014382",
      beneficiary: { account_name: "Siam Riverside Hospital Co., Ltd.", account_number: "101-3-58821-7", swift: "BKCBTHBK", bank_name: "Bangkok Commercial Bank" },
      rationale: "cheapest legal route",
    });
    store.mutate((w) => (w.payments[p.payment_id].status = "processing"));
    const reply = replyTo(email("Deposit sent", "We have initiated the transfer of THB 250,000. Please confirm receipt once it arrives.").mail_id);
    expect(reply.body).toMatch(/not reached our account yet/);
    expect(reply.body).toMatch(/no need to check with us again/);
  });

  it("starts a refund once, and answers a repeat request with its status", () => {
    const { store, email, replyTo } = boot();
    advanceToNext(store);
    replyTo(email("Estimate", "Please send the estimate.").mail_id);
    // fast-forward: two deposits received, final bill issued
    store.mutate((w) => {
      for (const [id, amount] of [["pay_x1", 250000], ["pay_x2", 160000]] as const) {
        w.payments[id] = { id, caseId: "case_th", invoiceId: "inv_1", institutionId: "srh", route: "bank_transfer", amount, currency: "THB", payerId: "p_tariq", reference: "HN 66-014382", beneficiary: { accountName: "", accountNumber: "", swift: "", bankName: "" }, cost: {} as never, rationale: "", status: "completed", statusHistory: [], approvalId: "", createdAt: w.now, completedAt: w.now, attempts: 1 };
      }
    });
    while (store.world.schedule.some((s) => (s.payload as { beat?: string }).beat === "th.discharge")) advanceToNext(store);
    const r1 = replyTo(email("Duplicate and refund", "The CT coronary angiography is charged twice. Please correct it and refund the excess deposit.").mail_id);
    expect(r1.topics).toEqual(expect.arrayContaining(["dispute", "refund"]));
    expect(store.world.cases.case_th.expectedRefund?.amount).toBe(42000);
    const refunds = () => store.world.schedule.filter((s) => s.kind === "refund.credit").length;
    expect(refunds()).toBe(1);
    const r2 = replyTo(email("Refund", "Could you confirm the refund?").mail_id);
    expect(r2.body).toMatch(/no need to request it again|was completed/);
    expect(refunds()).toBeLessThanOrEqual(1);
  });

  it("skips a follow-up whose purpose was met, without waking the agent", () => {
    const { store, triggers, tool, email } = boot();
    advanceToNext(store);
    email("Estimate", "Please send the estimate.");
    const f = tool("schedule_followup", { in_hours: 24, reason: "chase the estimate", skip_if: "institution_replied" });
    expect(f.followup_id).toBeDefined();
    expect(caseSnapshot(store.world, "case_th").scheduled_followups).toHaveLength(1);
    triggers.length = 0;
    advanceTo(store, hoursFrom(store.world.now, 25));
    expect(triggers).not.toContain("followup");
    expect(store.ledger.some((e) => e.type === "followup.skipped")).toBe(true);
    // the snapshot links the email to its reply
    const out = caseSnapshot(store.world, "case_th").mailbox.find((m) => m.direction === "outbound");
    expect(out?.answered_by).toMatch(/^mail_/);
  });

  it("can cancel a follow-up", () => {
    const { store, tool } = boot();
    advanceToNext(store);
    const f = tool("schedule_followup", { in_hours: 10, reason: "check something" });
    expect(tool("cancel_followup", { followup_id: f.followup_id, why: "no longer needed" }).cancelled).toBe(f.followup_id);
    expect(nextScheduled(store)?.kind).not.toBe("agent.followup");
  });

  it("answers the university's fee questions in one reply", () => {
    const { store, email, replyTo } = boot("uk-tuition");
    advanceToNext(store);
    const reply = replyTo(email("Fees for KG2601847", "Please send the fee statement, your bank details and confirm the admission of Lin Yuxuan.").mail_id);
    expect(reply.topics).toEqual(expect.arrayContaining(["estimate", "bank_details", "admission"]));
    expect(reply.attachments.map((d) => store.world.docs[d].kind)).toEqual(expect.arrayContaining(["admission_letter", "invoice", "bank_letter"]));
  });

  it("the hospital answers a question about cash paid at its cashier, so it isn't asked again", () => {
    const { store, email, replyTo } = boot();
    advanceToNext(store);
    replyTo(email("Estimate", "Please send the estimate.").mail_id);
    const r = replyTo(email("Cash payments", "Please confirm the cash payments made at admission and send a full credit statement.").mail_id);
    expect(r.topics).toContain("cash");
    expect(r.body).toMatch(/settled at the time/);
  });

  it("close_case cancels follow-ups and refuses while money is still moving", () => {
    const { store, tool } = boot();
    advanceToNext(store);
    tool("schedule_followup", { in_hours: 24, reason: "remind the family about receipts", skip_if: "family_replied" });
    store.mutate((w) => (w.cases.case_th.expectedRefund = { amount: 100, currency: "THB", requestedAt: w.now }));
    expect(tool("close_case", { summary: "All paid and refunded." }).error).toMatch(/money is still moving/);
    store.mutate((w) => (w.cases.case_th.expectedRefund!.receivedAt = w.now));
    const r = tool("close_case", { summary: "All paid and refunded." });
    expect(r.closed).toBe(true);
    expect(r.cancelled_followups).toHaveLength(1);
    expect(store.world.cases.case_th.status).toBe("closed");
    expect(caseSnapshot(store.world, "case_th").scheduled_followups).toHaveLength(0);
  });

  it("a follow-up waiting for the family is skipped once they write back", () => {
    const { store, triggers, tool } = boot();
    advanceToNext(store);
    tool("schedule_followup", { in_hours: 24, reason: "ask the family again", skip_if: "family_replied" });
    store.mutate((w) => w.messages.push({ id: "m_x", caseId: "case_th", from: "family", text: "Here they are", at: hoursFrom(w.now, 1) }));
    triggers.length = 0;
    advanceTo(store, hoursFrom(store.world.now, 25));
    expect(triggers).not.toContain("followup");
  });
});
