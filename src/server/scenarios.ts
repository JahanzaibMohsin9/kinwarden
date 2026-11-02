import type { CorridorId, Invoice, UploadedBill, World } from "@/domain/types";
import { INSTITUTIONS } from "@/domain/institutions";
import { DESTINATIONS } from "@/domain/corridors";

export interface ScenarioInfo {
  id: string;
  title: string;
  subtitle: string;
  corridor: string;
  caseId: string;
}

export const SCENARIOS: ScenarioInfo[] = [
  {
    id: "th-medical",
    title: "Medical treatment in Bangkok",
    subtitle: "Pakistan → Thailand · father's heart procedure",
    corridor: "PK-TH",
    caseId: "case_th",
  },
  {
    id: "pk-admission",
    title: "University offer through an agent",
    subtitle: "Pakistan → United Kingdom · offer letter from a consultant",
    corridor: "PK-GB",
    caseId: "case_pk",
  },
  {
    id: "uk-tuition",
    title: "University fees in London",
    subtitle: "China → United Kingdom · daughter's MSc",
    corridor: "CN-GB",
    caseId: "case_uk",
  },
  {
    id: "cn-admission",
    title: "Study agent promises a place",
    subtitle: "China → United Kingdom · 留学中介 asks for fees and a quota split",
    corridor: "CN-GB",
    caseId: "case_cn",
  },
];

function emptyWorld(scenarioId: string, start: string): World {
  return {
    scenarioId,
    now: start,
    startedAt: start,
    cases: {},
    institutions: structuredClone(INSTITUTIONS),
    invoices: {},
    payments: {},
    approvals: {},
    mail: {},
    docs: {},
    messages: [],
    security: [],
    cards: [],
    schedule: [],
    agent: { status: "idle", mode: "live", killSwitch: false, runs: 0 },
    autoReply: true,
    autoplay: false,
    counters: {},
  };
}

const at = (start: string, days: number, hh: number, mm = 0) => {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hh, mm, 0, 0);
  return d.toISOString();
};

export function seedScenario(id: string): World {
  if (id === "uk-tuition") return seedUkTuition();
  if (id === "pk-admission") return seedPkAdmission();
  if (id === "cn-admission") return seedCnAdmission();
  return seedThMedical();
}

function seedThMedical(): World {
  // 09:30 in Bangkok (UTC+7)
  const start = "2026-11-02T02:30:00.000Z";
  const w = emptyWorld("th-medical", start);
  w.cases.case_th = {
    id: "case_th",
    type: "medical",
    corridor: "PK-TH",
    title: "Abbu's heart treatment",
    lang: "en",
    institutionId: "srh",
    openedAt: start,
    status: "active",
    brief:
      "My father Tariq Mahmood (62) was admitted to Siam Riverside International Hospital in Bangkok this morning with chest pain. The cardiologist says he needs an angiogram and maybe a stent. I'm with him as his attendant. We brought USD 10,000 cash between us and most of it is already gone on the first tests. We have his Visa debit card and his bank account in Lahore. Please handle the hospital payments.",
    people: [
      // sandbox passport numbers (fictional): they go on the SBP forms and are never shown to the LLM
      { id: "p_tariq", name: "Tariq Mahmood", role: "patient", adult: true, abroad: true, passport: "AK4419027" },
      { id: "p_sana", name: "Sana Tariq", role: "attendant", adult: true, abroad: true, passport: "BM8813564" },
    ],
    notes: [],
  };
  w.cards = [
    { personId: "p_tariq", label: "Visa debit •• 4821", annualUsedUSD: 4200, currency: "PKR" },
    { personId: "p_sana", label: "Mastercard •• 1937", annualUsedUSD: 1100, currency: "PKR" },
  ];
  w.schedule = [
    { id: "s_open", at: at(start, 0, 2, 31), kind: "beat", payload: { beat: "th.open" }, label: "Family opens the case" },
    { id: "s_comp", at: at(start, 3, 7, 30), kind: "beat", payload: { beat: "th.complication" }, label: "Doctor recommends a stent; extra deposit needed by morning" },
    { id: "s_attack", at: at(start, 4, 13, 10), kind: "beat", payload: { beat: "th.attack" }, label: "Look-alike 'billing' email asks to change bank details" },
    { id: "s_final", at: at(start, 6, 3, 0), kind: "beat", payload: { beat: "th.discharge" }, label: "Discharge: final itemised bill" },
  ];
  w.counters = { mail: 0, doc: 0, inv: 0, pay: 0, apr: 0, msg: 0, sec: 0, sch: 0 };
  return w;
}

function seedUkTuition(): World {
  // 09:00 in Shenzhen (UTC+8)
  const start = "2026-11-02T01:00:00.000Z";
  const w = emptyWorld("uk-tuition", start);
  w.cases.case_uk = {
    id: "case_uk",
    type: "tuition",
    corridor: "CN-GB",
    title: "雨萱的硕士学费",
    lang: "zh",
    institutionId: "kgu",
    openedAt: start,
    status: "active",
    brief:
      "我女儿林雨萱被伦敦 Kingsgate University 录取了（理学硕士，2027年1月入学，学号 KG2601847）。学校要求开学前付第一期学费和住宿费。今年的购汇额度我已经用了大概 3.1 万美元（之前给她交了语言班和押金）。麻烦帮我们把学费付给学校。",
    people: [
      { id: "p_linwei", name: "林伟 Lin Wei", role: "parent", adult: true, abroad: false, priorFxYearUSD: 31000, passport: "E73420915" },
      { id: "p_yuxuan", name: "林雨萱 Lin Yuxuan", role: "student", adult: true, abroad: false, passport: "E81236604" },
    ],
    notes: [],
  };
  w.cards = [{ personId: "p_linwei", label: "UnionPay •• 6620", annualUsedUSD: 0, currency: "CNY" }];
  w.schedule = [
    { id: "s_open", at: at(start, 0, 1, 1), kind: "beat", payload: { beat: "uk.open" }, label: "Family opens the case" },
    { id: "s_split", at: at(start, 1, 12, 0), kind: "beat", payload: { beat: "uk.split_request" }, label: "Father asks to use his brother's FX quota" },
  ];
  w.counters = { mail: 0, doc: 0, inv: 0, pay: 0, apr: 0, msg: 0, sec: 0, sch: 0 };
  return w;
}

function seedPkAdmission(): World {
  // 10:00 in Karachi (UTC+5). Fictional family; the pattern follows fake study-abroad agents reported in Pakistan.
  const start = "2026-11-02T05:00:00.000Z";
  const w = emptyWorld("pk-admission", start);
  w.cases.case_pk = {
    id: "case_pk",
    type: "tuition",
    corridor: "PK-GB",
    title: "Mariam's MSc offer",
    lang: "en",
    institutionId: "kgu",
    openedAt: start,
    status: "active",
    brief:
      "My daughter Mariam got an offer from Kingsgate University London for an MSc starting in January, through an education consultant, Mr. Faraz Siddiqui of Global Pathways Education. He sent the offer letter (I've uploaded it) and says we must pay the first-year tuition of GBP 18,500 plus a GBP 1,200 visa guarantee fee to his company's account by Friday, or her seat goes to someone else. We already gave him PKR 350,000 in cash as a processing fee. Please pay the university fees.",
    people: [
      { id: "p_aslam", name: "Aslam Javed", role: "parent", adult: true, abroad: false, passport: "CK5530418" },
      { id: "p_mariam", name: "Mariam Aslam", role: "student", adult: true, abroad: false, passport: "DM2081736" },
    ],
    notes: [],
  };
  w.cards = [{ personId: "p_aslam", label: "Visa debit •• 7302", annualUsedUSD: 900, currency: "PKR" }];
  w.schedule = [
    { id: "s_open", at: at(start, 0, 5, 1), kind: "beat", payload: { beat: "pk.open" }, label: "Family opens the case with the consultant's offer letter" },
    { id: "s_pressure", at: at(start, 1, 13, 0), kind: "beat", payload: { beat: "pk.pressure" }, label: "The consultant pressures the family to pay his personal account" },
  ];
  w.counters = { mail: 0, doc: 0, inv: 0, pay: 0, apr: 0, msg: 0, sec: 0, sch: 0 };
  return w;
}

function seedCnAdmission(): World {
  // 20:00 in Shenzhen (UTC+8). Fictional family; the pattern (保录取, fees to the agency, 蚂蚁搬家) follows
  // fake study-agency cases reported in China.
  const start = "2026-11-02T12:00:00.000Z";
  const w = emptyWorld("cn-admission", start);
  w.cases.case_cn = {
    id: "case_cn",
    type: "tuition",
    corridor: "CN-GB",
    title: "思雨的留学录取",
    lang: "zh",
    institutionId: "kgu",
    openedAt: start,
    status: "active",
    brief:
      "我女儿陈思雨通过深圳的「英途留学」中介申请了伦敦 Kingsgate University 的金融硕士，明年1月入学。中介的王老师说他们是学校的合作机构，能“保录取”，还帮她拿到了40%的奖学金。录取通知书我已经上传了。他说周五之前要交 3.8 万元保录取服务费，第一年学费 18,500 英镑也得先打到他们公司账户，说是他们会统一转给学校，不然名额就给别人了。之前还交了 2 万元定金。我今年的购汇额度已经用了大概 2.9 万美元。麻烦帮我们把学费付了。",
    people: [
      { id: "p_chenjg", name: "陈建国 Chen Jianguo", role: "parent", adult: true, abroad: false, priorFxYearUSD: 29000, passport: "E52817330" },
      { id: "p_siyu", name: "陈思雨 Chen Siyu", role: "student", adult: true, abroad: false, passport: "E90364127" },
    ],
    notes: [],
  };
  w.cards = [{ personId: "p_chenjg", label: "UnionPay •• 3058", annualUsedUSD: 0, currency: "CNY" }];
  w.schedule = [
    { id: "s_open", at: at(start, 0, 12, 1), kind: "beat", payload: { beat: "cn.open" }, label: "Family opens the case with the agency's offer letter" },
    { id: "s_pressure", at: at(start, 1, 11, 30), kind: "beat", payload: { beat: "cn.pressure" }, label: "The agency pushes for payment to a personal account and FX bought in relatives' names" },
  ];
  w.counters = { mail: 0, doc: 0, inv: 0, pay: 0, apr: 0, msg: 0, sec: 0, sch: 0 };
  return w;
}

/** The family's own bill: an institution Kinwarden doesn't know, priced under the home country's rules, paid only once the bank has verified it. */
export function seedUpload(bill: UploadedBill, startAt = new Date().toISOString()): World {
  const start = new Date(Math.floor(Date.parse(startAt) / 60_000) * 60_000).toISOString();
  const w = emptyWorld("upload", start);
  const dest = DESTINATIONS[bill.country];
  const medical = bill.type === "medical";
  const email = bill.institution.email?.trim().toLowerCase() ?? "";
  w.institutions.upl = {
    id: "upl",
    kind: medical ? "hospital" : "university",
    name: bill.institution.name,
    legalName: bill.institution.accountName,
    country: dest.country,
    city: bill.institution.city || dest.city,
    email,
    emailDomain: email.split("@")[1] ?? "",
    bank: { bankName: bill.institution.bankName, accountName: bill.institution.accountName, accountNumber: bill.institution.accountNumber, swift: bill.institution.swift, currency: bill.currency },
    acceptsCards: true,
    origin: "uploaded_bill",
  };
  const samePerson = bill.payerName.trim().toLowerCase() === bill.subjectName.trim().toLowerCase();
  const people: World["cases"][string]["people"] = [
    { id: "p_subject", name: bill.subjectName.trim(), role: medical ? "patient" : "student", adult: true, abroad: medical && bill.alreadyAbroad, priorFxYearUSD: samePerson ? bill.priorFxYearUSD : undefined },
  ];
  if (!samePerson) {
    // the payer is the one holding the phone: first in the list, so the app opens as them
    people.unshift({ id: "p_payer", name: bill.payerName.trim(), role: medical ? "attendant" : "parent", adult: true, abroad: medical && bill.alreadyAbroad, priorFxYearUSD: bill.priorFxYearUSD });
  }
  const zh = bill.lang === "zh";
  w.cases.case_up = {
    id: "case_up",
    type: bill.type,
    corridor: `${bill.home}-${bill.country}` as CorridorId,
    title: zh ? `${bill.institution.name} 的账单` : `Bill from ${bill.institution.name}`,
    lang: bill.lang,
    institutionId: "upl",
    openedAt: start,
    status: "active",
    brief:
      bill.note?.trim() ||
      (zh ? "我上传了一张账单，麻烦按我们国家的规定帮我们付款。" : "I've uploaded a bill. Please pay it for us under our country's rules."),
    people,
    notes: [],
  };
  // the bill becomes a document and an invoice, both marked as coming from the family, not the institution
  const docId = "doc_1";
  const number = bill.billNumber?.trim() || "UPLOADED-1";
  w.docs[docId] = {
    id: docId,
    caseId: "case_up",
    kind: "invoice",
    title: `Uploaded bill ${number}`,
    text: bill.text,
    fields: { number, total: bill.lineItems.reduce((s, l) => s + l.amount, 0), amountDue: bill.amountDue, currency: bill.currency, readBy: bill.readBy },
    origin: "family",
    createdAt: start,
  };
  const total = Math.round(bill.lineItems.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const inv: Invoice = {
    id: "inv_1",
    caseId: "case_up",
    institutionId: "upl",
    kind: medical ? "estimate" : "fee_statement",
    number,
    currency: bill.currency,
    lineItems: bill.lineItems.map((l, i) => ({ ...l, id: `inv_1_li${i + 1}` })),
    total,
    amountDue: bill.amountDue,
    // noon UTC falls on the same calendar day from New York to Sydney
    dueAt: bill.dueDate ? `${bill.dueDate.slice(0, 10)}T12:00:00.000Z` : undefined,
    issuedAt: start,
    documentId: docId,
    patientRef: bill.reference?.trim() || undefined,
    status: "open",
  };
  w.invoices[inv.id] = inv;
  w.upload = bill;
  w.schedule = [{ id: "s_open", at: start, kind: "beat", payload: { beat: "upload.open" }, label: "You send Kinwarden the bill" }];
  w.counters = { mail: 0, doc: 1, inv: 1, pay: 0, apr: 0, msg: 0, sec: 0, sch: 0 };
  return w;
}
