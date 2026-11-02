import { describe, expect, it } from "vitest";
import { seedScenario } from "../scenarios";
import { caseSnapshot } from "./snapshot";
import { buildVault } from "./privacy";
import { Store } from "../store";
import { issueInvoice } from "../sim/factory";

function bangkok() {
  const store = new Store();
  store.reset(seedScenario("th-medical"));
  store.world.cases.case_th.people[0].passport = "AB1234567";
  issueInvoice(store, { caseId: "case_th", institutionId: "srh", kind: "deposit_request", title: "Deposit", patientName: "Mr. Tariq Mahmood", patientRef: "HN 66-014382", lineItems: [{ description: "CT coronary angiography", amount: 14000 }], dueInHours: 20 });
  return store;
}

describe("privacy firewall", () => {
  it("hides names, hospital number, cards, passport and medical details from the model", () => {
    const store = bangkok();
    const v = buildVault(store.world, "case_th");
    const masked = v.mask(JSON.stringify(caseSnapshot(store.world, "case_th")) + " Dear Ms. Sana, Mr. Tariq needs a stent. Passport AB1234567, card Visa debit •• 4821.");
    for (const secret of ["Tariq", "tariq", "Mahmood", "Sana", "sana", "66-014382", "4821", "1937", "AB1234567", "stent", "angiography", "chest pain"]) expect(masked).not.toContain(secret);
    expect(masked).toContain("[PERSON_1]");
    expect(masked).toContain("HN [PATIENT_REF_1]");
    // internal IDs carry names, so they are tokens too
    expect(masked).toContain('"id":"[PERSON_ID_1]"');
    expect(masked).not.toContain("p_tariq");
    expect(masked).toContain("Siam Riverside International Hospital");
    expect(v.mask("Account number: 101-3-58821-7  SWIFT: BKCBTHBK")).toContain("101-3-58821-7");
    expect(v.withheld()).toMatchObject({ PERSON: 2, PATIENT_REF: 1, CARD: 2, PASSPORT: 1 });
  });

  it("puts the real values back in tool inputs, inside our code", () => {
    const store = bangkok();
    const v = buildVault(store.world, "case_th");
    const input = v.unmaskDeep({
      reference: "HN [PATIENT_REF_1] deposit",
      body: "The CT [MEDICAL_3] [MEDICAL_5] for [PERSON_1] was charged twice.",
      beneficiary: { account_number: "101-3-58821-7" },
      payer_id: "[PERSON_ID_1]",
    });
    expect(input.reference).toBe("HN 66-014382 deposit");
    expect(input.body).toBe("The CT coronary angiography for Tariq Mahmood was charged twice.");
    expect(input.payer_id).toBe("p_tariq");
  });

  it("round-trips: unmask(mask(x)) keeps the meaning for the family", () => {
    const store = bangkok();
    const v = buildVault(store.world, "case_th");
    const text = "Tariq Mahmood's angiogram is tomorrow; Sana Tariq approved the card Visa debit •• 4821.";
    expect(v.unmask(v.mask(text))).toBe(text);
  });

  it("handles Chinese names, given names and the student ID", () => {
    const store = new Store();
    store.reset(seedScenario("uk-tuition"));
    const v = buildVault(store.world, "case_uk");
    const masked = v.mask(store.world.cases.case_uk.brief + " 雨萱的硕士学费 Lin Yuxuan 林伟 Lin Wei");
    for (const secret of ["林雨萱", "雨萱", "KG2601847", "Yuxuan", "林伟", "Lin Wei"]) expect(masked).not.toContain(secret);
    expect(masked).toContain("Kingsgate University");
  });

  it("restores a bilingual name in the reader's script", () => {
    const store = new Store();
    store.reset(seedScenario("uk-tuition"));
    const v = buildVault(store.world, "case_uk");
    const out = v.unmaskDeep({ text: "这笔学费由 [PERSON_2] 本人支付", body: "Payment for [PERSON_2], student ID [STUDENT_ID_1]", narration: "为 [PERSON_2] 付款" });
    expect(out.text).toBe("这笔学费由 林雨萱 本人支付");
    expect(out.narration).toBe("为 林雨萱 付款");
    expect(out.body).toBe("Payment for Lin Yuxuan, student ID KG2601847");
  });
});
