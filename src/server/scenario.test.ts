import { describe, expect, it } from "vitest";
import { Store } from "./store";
import { AgentRunner } from "./agent/runner";
import { seedScenario } from "./scenarios";
import { advanceToNext } from "./sim/engine";
import { verifyChain } from "./hash";
import { executeTool } from "./agent/tools";
import { evaluateRun } from "./evaluate";

async function boot(scenarioId: string) {
  const store = new Store();
  store.load(() => seedScenario(scenarioId));
  store.reset(seedScenario(scenarioId));
  store.world.agent.mode = "scripted";
  const runner = new AgentRunner(store);
  runner.resetSession();
  // make runtime() (used by decideApproval) return this store
  (globalThis as Record<string, unknown>).__kinwarden = { store, runner, autoplayTimer: setInterval(() => {}, 1 << 30), runnerClass: AgentRunner };
  const { decideApproval } = await import("./runtime");
  const settle = async () => {
    for (let i = 0; i < 200 && (runner.isBusy || store.world.agent.status === "working"); i++) await new Promise((r) => setTimeout(r, 5));
  };
  const next = async () => {
    advanceToNext(store);
    await new Promise((r) => setTimeout(r, 1));
    await settle();
  };
  const approveAll = async () => {
    for (const a of Object.values(store.world.approvals).filter((x) => !x.decision)) decideApproval(a.id, "approved", "hold");
    await new Promise((r) => setTimeout(r, 1));
    await settle();
  };
  return { store, runner, next, approveAll, settle };
}

describe("Bangkok medical scenario (scripted agent)", () => {
  it("runs from admission to refund with every safety check holding", async () => {
    const { store, next, approveAll } = await boot("th-medical");
    const w = () => store.world;
    const pays = () => Object.values(w().payments);

    await next(); // family opens the case
    expect(Object.values(w().mail).filter((m) => m.direction === "outbound")).toHaveLength(1);

    await next(); // hospital replies with estimate + deposit request
    expect(pays()).toHaveLength(1);
    expect(pays()[0]).toMatchObject({ route: "bank_transfer", amount: 250000, status: "awaiting_approval" });
    expect(Object.values(w().docs).map((d) => d.kind)).toEqual(expect.arrayContaining(["remittance_application", "self_declaration"]));

    await approveAll();
    expect(pays()[0].status).toBe("processing");

    await next(); // receiving bank returns it: reference lacks the HN
    expect(pays()[0].status).toBe("processing"); // agent resubmitted with the HN
    expect(pays()[0].attempts).toBe(2);
    expect(pays()[0].reference).toMatch(/HN 66-014382/);

    await next(); // settles
    expect(pays()[0].status).toBe("completed");

    await next(); // complication: THB 160,000 by tomorrow morning
    const card = pays().find((p) => p.amount === 160000)!;
    expect(card.route).toBe("card_payment");
    await approveAll();
    expect(w().payments[card.id].status).toBe("completed");

    await next(); // look-alike scam email
    expect(w().security.some((s) => s.kind === "suspicious_message")).toBe(true);
    expect(pays()).toHaveLength(2); // nothing paid to the fraudster

    // even if the agent were fooled, the gateway refuses the fraudster's account
    const inv = Object.values(w().invoices).find((i) => i.amountDue === 160000)!;
    const res = JSON.parse(
      executeTool(
        "propose_payment",
        {
          invoice_id: inv.id,
          route: "bank_transfer",
          amount: 1000,
          payer_id: "p_tariq",
          reference: "HN 66-014382",
          beneficiary: { account_name: "SR Medical Services Co.", account_number: "774-2-90311-5", swift: "KPTBTHB1", bank_name: "Krungsri Pattana Bank" },
          rationale: "attack simulation",
          narration: "attack simulation",
        },
        { store, caseId: "case_th" },
      ),
    );
    expect(res.error).toMatch(/BLOCKED/);

    // run the remaining timeline: hospital confirms account, discharge, dispute, correction, refund
    for (let i = 0; i < 12 && w().schedule.length; i++) await next();

    const corrected = Object.values(w().invoices).find((i) => i.kind === "corrected_final")!;
    expect(corrected.total).toBe(368000);
    expect(w().cases.case_th.expectedRefund?.amount).toBe(42000);
    expect(w().cases.case_th.expectedRefund?.receivedAt).toBeDefined();
    expect(w().messages.at(-1)?.importance).toBe("good_news");

    const ev = evaluateRun(w(), store.ledger);
    expect(ev.checks.filter((c) => !c.pass)).toEqual([]);
    expect(ev.money.duplicateChargeCaught).toBe(14000);
    expect(ev.money.savedVsCardSource).toBeGreaterThan(0);

    const chain = verifyChain(store.ledger);
    expect(chain.ok).toBe(true);
    store.tamper(5, "edited");
    expect(verifyChain(store.ledger).ok).toBe(false);
  });
});

describe("London tuition scenario (scripted agent)", () => {
  it("pays above the SAFE quota with documents and refuses quota splitting", async () => {
    const { store, next, approveAll } = await boot("uk-tuition");
    await next(); // open
    await next(); // fee statement arrives
    const p = Object.values(store.world.payments)[0];
    expect(p).toMatchObject({ route: "bank_transfer", amount: 24675, reference: "KG2601847 Lin Yuxuan" });
    await approveAll();
    await next(); // father asks to use his brother's quota
    expect(store.world.messages.at(-1)?.text).toMatch(/蚂蚁搬家/);
    for (let i = 0; i < 5 && store.world.schedule.length; i++) await next();
    expect(store.world.payments[p.id].status).toBe("completed");
    expect(verifyChain(store.ledger).ok).toBe(true);
    expect(evaluateRun(store.world, store.ledger).checks.filter((c) => !c.pass)).toEqual([]);
  });
});

describe("Family roles", () => {
  it("only the payer can approve; anyone on the case can decline", async () => {
    const { store, next } = await boot("uk-tuition");
    await next(); // open
    await next(); // fee statement: the agent proposes the transfer from the father's quota
    const { decideApprovalIn } = await import("./runtime");
    const a = Object.values(store.world.approvals)[0];
    expect(store.world.payments[a.paymentId].payerId).toBe("p_linwei");

    expect(() => decideApprovalIn(store, a.id, "approved", "hold", undefined, "p_yuxuan")).toThrow(/Only 林伟 Lin Wei can approve/);
    expect(store.world.approvals[a.id].decision).toBeUndefined();
    expect(store.world.security.at(-1)?.kind).toBe("blocked_wrong_approver");
    expect(store.ledger.at(-1)?.type).toBe("approval.refused");

    decideApprovalIn(store, a.id, "approved", "hold", undefined, "p_linwei");
    expect(store.world.approvals[a.id].decision).toBe("approved");
    expect(store.ledger.find((e) => e.type === "approval.approved")?.data.by).toBe("p_linwei");
  });

  it("a family member who doesn't pay can still decline", async () => {
    const { store, next } = await boot("uk-tuition");
    await next();
    await next();
    const { decideApprovalIn } = await import("./runtime");
    const a = Object.values(store.world.approvals)[0];
    decideApprovalIn(store, a.id, "declined", "hold", undefined, "p_yuxuan");
    expect(store.world.payments[a.paymentId].status).toBe("cancelled");
  });
});

describe("Fake admission scenario (scripted agent)", () => {
  it("checks the offer with the university, pays nothing and tells the family gently", async () => {
    const { store, next } = await boot("pk-admission");
    for (let i = 0; i < 6 && store.world.schedule.length; i++) await next();
    const w = store.world;
    expect(Object.values(w.payments)).toHaveLength(0);
    const reply = Object.values(w.mail).find((m) => m.direction === "inbound")!;
    expect(reply.topics).toContain("admission");
    expect(reply.body).toMatch(/no applicant or student named Mariam Aslam/);
    expect(Object.values(w.invoices)).toHaveLength(0); // no fee statement for someone who never applied
    expect(evaluateRun(w, store.ledger).checks.filter((c) => !c.pass)).toEqual([]);
  });
});

describe("Fake study agent in China (scripted agent)", () => {
  it("checks with the university, pays nothing, refuses the quota split and tells the family gently", async () => {
    const { store, next } = await boot("cn-admission");
    for (let i = 0; i < 6 && store.world.schedule.length; i++) await next();
    const w = store.world;
    expect(Object.values(w.payments)).toHaveLength(0);
    expect(Object.values(w.approvals)).toHaveLength(0);
    const reply = Object.values(w.mail).find((m) => m.direction === "inbound")!;
    expect(reply.topics).toContain("admission");
    expect(reply.body).toMatch(/no applicant or student named Chen Siyu/);
    expect(reply.body).toMatch(/guaranteed admission/);
    expect(Object.values(w.invoices)).toHaveLength(0);
    expect(w.messages.at(-1)?.text).toMatch(/蚂蚁搬家/);
    const ev = evaluateRun(w, store.ledger);
    expect(ev.checks.filter((c) => !c.pass)).toEqual([]);
    expect(ev.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["police_advised", "split_refused_kindly"]));
  });

});
