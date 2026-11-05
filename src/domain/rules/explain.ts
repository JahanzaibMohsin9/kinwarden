import type { Lang } from "../types";
import { allRules, rateInForce, type Rule } from "./engine";

// Plain-language "why" for each rule. Every number is
// read from the rule pack, so the explanation can't drift from what the engine enforces.

const usd = (n?: number) => (n === undefined ? "?" : `USD ${n.toLocaleString("en-US")}`);
const pct = (r?: number) => (r === undefined ? "?" : `${+(r * 100).toFixed(2)}%`);

type Explainer = (r: Rule, onDate: string) => Partial<Record<Lang, string>> & { en: string };

const EXPLAIN: Record<string, Explainer> = {
  "PK.CASH.PER_VISIT": (r) => ({
    en: `An adult leaving Pakistan may carry up to ${usd(r.values?.adultUSD)} in foreign cash per trip (${usd(r.values?.minorUSD)} for a child). Once you are abroad, carrying more cash from home is no longer an option.`,
  }),
  "PK.CASH.ANNUAL": (r) => ({
    en: `Across all trips in a year, an adult may carry out up to ${usd(r.values?.adultUSD)} in foreign cash (${usd(r.values?.minorUSD)} for a child).`,
  }),
  "PK.CARD.ANNUAL": (r) => ({
    en: `Each person can spend up to ${usd(r.values?.adultUSD)} a year abroad on Pakistani cards, card payments and ATM withdrawals together. Kinwarden counts what you have already used this year.`,
  }),
  "PK.CARD.ADVANCE_TAX": (r, on) => {
    const now = rateInForce(r, on);
    return {
      en: `Paying or withdrawing abroad with a Pakistani card adds an advance tax of ${pct(now?.rate)} on the amount (${now?.note ?? "rate history in the rule pack"}). Bank transfers for treatment don't carry this tax, which is one reason they cost less.`,
    };
  },
  "PK.MED.REMIT.CAP": (r) => ({
    en: `For treatment abroad, your bank can send up to ${usd(r.values?.perCaseUSD)} per case straight to the hospital on its own authority. Above that, the bank must refer the case to the State Bank.`,
  }),
  "PK.MED.REMIT.DOCS": () => ({
    en: "For a medical remittance the bank needs the application form, the hospital's invoice or estimate, and a signed self-declaration. Kinwarden fills in the forms; you sign them when you approve.",
  }),
  "PK.MED.DIRECT_TO_HOSPITAL": () => ({
    en: "Money for treatment must go straight to the hospital's own bank account, never to a person, an agent or the family's account abroad.",
  }),
  "PK.EDU.REMIT": () => ({
    en: "Education fees are paid directly to the university against the admission letter and fee voucher. This rule is a sandbox assumption still to be confirmed with a bank.",
  }),
  "KINWARDEN.NO_SPLITTING": () => ({
    en: "Kinwarden never splits one bill across family members to get around a per-person limit. Banks treat that as structuring; it can get accounts frozen.",
  }),
  "KINWARDEN.VERIFIED_BENEFICIARY": () => ({
    en: "Money only goes to an institution's bank account that Kinwarden has verified independently, never to details from an email or a document alone. This stops 'our bank details have changed' scams.",
  }),
  "KINWARDEN.VERIFIED_INSTITUTION": () => ({
    en: "A bill you upload yourself comes from an institution Kinwarden doesn't know yet. It can read the bill, price it and explain the rules, but it pays nothing until the bank has verified the hospital or university and its account.",
  }),
  "KINWARDEN.ADMISSION_VERIFIED_BEFORE_FEES": () => ({
    en: "Kinwarden pays no tuition until the university itself confirms the admission through its verified address. An offer letter from an agent or consultant is never enough: fake admissions are a common scam.",
  }),
  "CN.FX.ANNUAL_QUOTA": (r) => ({
    en: `Each person in China can buy up to ${usd(r.values?.adultUSD)} of foreign currency a year with just their ID. The quota resets on 1 January and does not carry over.`,
  }),
  "CN.FX.ABOVE_QUOTA_CURRENT": () => ({
    en: "Above the yearly quota, tuition and medical bills can still be paid in full with proof of the real expense: the admission letter and the fee statement (or the hospital bill).",
  }),
  "CN.FX.PURPOSE_DECLARATION": () => ({
    en: "Every foreign-currency purchase needs a signed purpose declaration. Kinwarden prepares it; you sign when you approve.",
  }),
  "CN.FX.PROHIBITED_PURPOSES": () => ({
    en: "Personal foreign currency may not be used for property, securities, life insurance or investment-linked insurance abroad.",
  }),
  "CN.FX.NO_SPLITTING": (r) => ({
    en: `Using relatives' quotas to buy currency for one person's expense (known as "ant moving") is a violation. Consequences: ${r.consequence ?? "penalties"}.`,
  }),
};

const STATUS: Record<string, Partial<Record<Lang, string>> & { en: string }> = {
  official: { en: "From the regulator's own publication." },
  reported: { en: "From reputable press coverage of the regulation; to be confirmed with a bank." },
  assumed: { en: "A sandbox assumption: confirm with a bank before real use." },
  policy: { en: "Kinwarden's own safety rule, stricter than the law." },
};

export function ruleById(id: string): (Rule & { packId: string }) | undefined {
  return allRules().find((r) => r.id === id);
}

export function explainRule(id: string, lang: Lang, onDate: string): { rule: Rule & { packId: string }; text: string; status: string } | undefined {
  const rule = ruleById(id);
  if (!rule) return undefined;
  const ex = EXPLAIN[id]?.(rule, onDate);
  const st = STATUS[rule.status];
  return { rule, text: ex?.[lang] ?? ex?.en ?? rule.title, status: st?.[lang] ?? st?.en ?? rule.status };
}

/** Every rule must have an explanation (checked by a test). */
export function rulesWithoutExplanation(): string[] {
  return allRules()
    .map((r) => r.id)
    .filter((id) => !EXPLAIN[id]);
}
