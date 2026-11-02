import type { Lang } from "../types";
import { allRules, rateInForce, type Rule } from "./engine";

// Plain-language "why" for each rule, in the family's language. Every number is
// read from the rule pack, so the explanation can't drift from what the engine enforces.

const usd = (n?: number) => (n === undefined ? "?" : `USD ${n.toLocaleString("en-US")}`);
const pct = (r?: number) => (r === undefined ? "?" : `${+(r * 100).toFixed(2)}%`);

// Urdu isn't written for these: the app falls back to English.
type Explainer = (r: Rule, onDate: string) => Partial<Record<Lang, string>> & { en: string };

const EXPLAIN: Record<string, Explainer> = {
  "PK.CASH.PER_VISIT": (r) => ({
    en: `An adult leaving Pakistan may carry up to ${usd(r.values?.adultUSD)} in foreign cash per trip (${usd(r.values?.minorUSD)} for a child). Once you are abroad, carrying more cash from home is no longer an option.`,
    zh: `成年人每次离开巴基斯坦最多可携带 ${usd(r.values?.adultUSD)} 外币现钞（未成年人为 ${usd(r.values?.minorUSD)}）。出境后就无法再从国内携带更多现金。`,
  }),
  "PK.CASH.ANNUAL": (r) => ({
    en: `Across all trips in a year, an adult may carry out up to ${usd(r.values?.adultUSD)} in foreign cash (${usd(r.values?.minorUSD)} for a child).`,
    zh: `一年内所有出行合计，成年人最多可携带 ${usd(r.values?.adultUSD)} 外币现钞出境（未成年人为 ${usd(r.values?.minorUSD)}）。`,
  }),
  "PK.CARD.ANNUAL": (r) => ({
    en: `Each person can spend up to ${usd(r.values?.adultUSD)} a year abroad on Pakistani cards, card payments and ATM withdrawals together. Kinwarden counts what you have already used this year.`,
    zh: `每人每年在境外使用巴基斯坦银行卡（含刷卡和 ATM 取现）最多可支出 ${usd(r.values?.adultUSD)}。Kinwarden 会算上您今年已使用的额度。`,
  }),
  "PK.CARD.ADVANCE_TAX": (r, on) => {
    const now = rateInForce(r, on);
    return {
      en: `Paying or withdrawing abroad with a Pakistani card adds an advance tax of ${pct(now?.rate)} on the amount (${now?.note ?? "rate history in the rule pack"}). Bank transfers for treatment don't carry this tax, which is one reason they cost less.`,
      zh: `在境外用巴基斯坦银行卡付款或取现，需按金额缴纳 ${pct(now?.rate)} 的预缴税。治疗费用走银行汇款不收这项税，这也是汇款更便宜的原因之一。`,
    };
  },
  "PK.MED.REMIT.CAP": (r) => ({
    en: `For treatment abroad, your bank can send up to ${usd(r.values?.perCaseUSD)} per case straight to the hospital on its own authority. Above that, the bank must refer the case to the State Bank.`,
    zh: `出国治疗时，银行可自行批准每个病例最多 ${usd(r.values?.perCaseUSD)} 直接汇给医院；超过该金额的病例，须由银行报巴基斯坦国家银行审批。`,
  }),
  "PK.MED.REMIT.DOCS": () => ({
    en: "For a medical remittance the bank needs the application form, the hospital's invoice or estimate, and a signed self-declaration. Kinwarden fills in the forms; you sign them when you approve.",
    zh: "医疗汇款需要申请表、医院账单或费用预估，以及签字的自我声明。表格由 Kinwarden 填写，您批准付款时签字即可。",
  }),
  "PK.MED.DIRECT_TO_HOSPITAL": () => ({
    en: "Money for treatment must go straight to the hospital's own bank account, never to a person, an agent or the family's account abroad.",
    zh: "治疗费用必须直接汇入医院自己的银行账户，不能汇给个人、中介或家属在国外的账户。",
  }),
  "PK.EDU.REMIT": () => ({
    en: "Education fees are paid directly to the university against the admission letter and fee voucher. This rule is a sandbox assumption still to be confirmed with a bank.",
    zh: "学费须凭录取通知书和缴费单直接付给学校。这条规则目前是沙盒假设，仍需向银行确认。",
  }),
  "KINWARDEN.NO_SPLITTING": () => ({
    en: "Kinwarden never splits one bill across family members to get around a per-person limit. Banks treat that as structuring; it can get accounts frozen.",
    zh: "Kinwarden 绝不会把一张账单拆到多位家人名下来规避个人额度。银行会把这视为分拆交易，可能导致账户被冻结。",
  }),
  "KINWARDEN.VERIFIED_BENEFICIARY": () => ({
    en: "Money only goes to an institution's bank account that Kinwarden has verified independently, never to details from an email or a document alone. This stops 'our bank details have changed' scams.",
    zh: "资金只会汇入经 Kinwarden 独立核实的机构账户，绝不凭邮件或文件中的账户信息付款。这能防范“银行账户已变更”这类诈骗。",
  }),
  "KINWARDEN.VERIFIED_INSTITUTION": () => ({
    en: "A bill you upload yourself comes from an institution Kinwarden doesn't know yet. It can read the bill, price it and explain the rules, but it pays nothing until the bank has verified the hospital or university and its account.",
    zh: "您自己上传的账单，来自 Kinwarden 还不认识的机构。Kinwarden 可以读取账单、核算费用并解释规定，但在银行核实这家医院或学校及其账户之前，不会支付任何款项。",
  }),
  "KINWARDEN.ADMISSION_VERIFIED_BEFORE_FEES": () => ({
    en: "Kinwarden pays no tuition until the university itself confirms the admission through its verified address. An offer letter from an agent or consultant is never enough: fake admissions are a common scam.",
    zh: "在校方通过已核实的地址确认录取之前，Kinwarden 不支付任何学费。仅凭中介或顾问提供的录取信远远不够：伪造录取是常见骗局。",
  }),
  "CN.FX.ANNUAL_QUOTA": (r) => ({
    en: `Each person in China can buy up to ${usd(r.values?.adultUSD)} of foreign currency a year with just their ID. The quota resets on 1 January and does not carry over.`,
    zh: `每人每年凭身份证即可购汇不超过 ${usd(r.values?.adultUSD)}（便利化额度），每年 1 月 1 日重置，不能结转。`,
  }),
  "CN.FX.ABOVE_QUOTA_CURRENT": () => ({
    en: "Above the yearly quota, tuition and medical bills can still be paid in full with proof of the real expense: the admission letter and the fee statement (or the hospital bill).",
    zh: "超过便利化额度后，属于经常项目的学费和医疗费仍可凭真实用途证明全额购汇，如录取通知书和学费单（或医院账单）。",
  }),
  "CN.FX.PURPOSE_DECLARATION": () => ({
    en: "Every foreign-currency purchase needs a signed purpose declaration (个人购汇申请书). Kinwarden prepares it; you sign when you approve.",
    zh: "每次购汇都需签署《个人购汇申请书》并说明用途。表格由 Kinwarden 填写，您批准时签字即可。",
  }),
  "CN.FX.PROHIBITED_PURPOSES": () => ({
    en: "Personal foreign currency may not be used for property, securities, life insurance or investment-linked insurance abroad.",
    zh: "个人购汇不得用于境外买房、证券投资、购买人寿保险和投资性返还分红类保险。",
  }),
  "CN.FX.NO_SPLITTING": (r) => ({
    en: `Using relatives' quotas to buy currency for one person's expense (蚂蚁搬家) is a violation. Consequences: ${r.consequence ?? "penalties"}.`,
    // Chinese restates the pack's consequence (an English field) in SAFE's own terms; keep the two in step
    zh: "借用亲属额度为同一人的开支分拆购汇（“蚂蚁搬家”）属于违规。后果包括列入“关注名单”、当年及之后两年不再享有便利化额度、行政处罚，并计入个人征信记录。",
  }),
};

const STATUS: Record<string, Partial<Record<Lang, string>> & { en: string }> = {
  official: { en: "From the regulator's own publication.", zh: "来自监管机构的正式发布。" },
  reported: { en: "From reputable press coverage of the regulation; to be confirmed with a bank.", zh: "来自权威媒体对该规定的报道，仍需向银行确认。" },
  assumed: { en: "A sandbox assumption: confirm with a bank before real use.", zh: "沙盒假设：实际使用前须向银行确认。" },
  policy: { en: "Kinwarden's own safety rule, stricter than the law.", zh: "Kinwarden 自设的安全规则，比法规更严格。" },
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
