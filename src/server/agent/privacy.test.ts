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
  issueInvoice(store, { caseId: "case_th", institutionId: "srh", kind: "deposit_request", title: "Deposit", patientName: "Mr. Daniel Hart", patientRef: "HN 66-014382", lineItems: [{ description: "CT coronary angiography", amount: 14000 }], dueInHours: 20 });
  return store;
}

describe("privacy firewall", () => {
  it("hides names, hospital number, cards, passport and medical details from the model", () => {
    const store = bangkok();
    const v = buildVault(store.world, "case_th");
    const masked = v.mask(JSON.stringify(caseSnapshot(store.world, "case_th")) + " Dear Ms. Sara, Mr. Daniel needs a stent. Passport AB1234567, card Visa debit •• 4821.");
    for (const secret of ["Daniel", "tariq", "Mahmood", "Sara", "sana", "66-014382", "4821", "1937", "AB1234567", "stent", "angiography", "chest pain"]) expect(masked).not.toContain(secret);
    expect(masked).toContain("[PERSON_1]");
    expect(masked).toContain("HN [PATIENT_REF_1]");
    // internal IDs carry names, so they are tokens too
    expect(masked).toContain('"id":"[PERSON_ID_1]"');
    expect(masked).not.toContain("p_daniel");
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
    expect(input.body).toBe("The CT coronary angiography for Daniel Hart was charged twice.");
    expect(input.payer_id).toBe("p_daniel");
  });

  it("round-trips: unmask(mask(x)) keeps the meaning for the family", () => {
    const store = bangkok();
    const v = buildVault(store.world, "case_th");
    const text = "Daniel Hart's angiogram is tomorrow; Sara Hart approved the card Visa debit •• 4821.";
    expect(v.unmask(v.mask(text))).toBe(text);
  });

  it("hides full names, first names, surnames and the student ID", () => {
    const store = new Store();
    store.reset(seedScenario("uk-tuition"));
    const v = buildVault(store.world, "case_uk");
    const masked = v.mask(store.world.cases.case_uk.brief + " Emily's MSc fees. Emily Lane, Robert Lane, Mr Lane");
    for (const secret of ["Emily", "Lane", "KG2601847", "Robert"]) expect(masked).not.toContain(secret);
    expect(masked).toContain("Kingsgate University");
  });

  it("restores the real names in every field", () => {
    const store = new Store();
    store.reset(seedScenario("uk-tuition"));
    const v = buildVault(store.world, "case_uk");
    const out = v.unmaskDeep({ text: "These fees are paid by [PERSON_2] herself", body: "Payment for [PERSON_2], student ID [STUDENT_ID_1]", narration: "Paying for [PERSON_2]" });
    expect(out.text).toBe("These fees are paid by Emily Lane herself");
    expect(out.narration).toBe("Paying for Emily Lane");
    expect(out.body).toBe("Payment for Emily Lane, student ID KG2601847");
  });
});
