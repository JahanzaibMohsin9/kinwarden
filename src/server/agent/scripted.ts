// Hand-written demo plans used in "Scripted" mode, so the app can be developed
// and demonstrated without an API key. These are NOT the AI: the Director and
// the UI label this mode clearly. Live mode is the LLM; Replay replays a recorded live run.
import type { Invoice, Mail, World } from "@/domain/types";
import { INSTITUTIONS } from "@/domain/institutions";
import type { Trigger } from "../store";
import type { RecordedStep, ScriptedRun } from "./runner";
import { compareRoutes, priceRoute } from "@/domain/rules/engine";
import { ROUTE_LABEL } from "@/domain/corridors";
import type { CorridorId, Route } from "@/domain/types";

/** Cost difference between two routes for the same amount, rounded to the nearest 1,000 (or 100 for CNY). */
function diff(w: World, corridor: CorridorId, inst: string, amount: number, a: Route, b: Route) {
  const pa = priceRoute({ corridor, route: a, deliverAmount: amount, institution: w.institutions[inst], simDate: w.now })!;
  const pb = priceRoute({ corridor, route: b, deliverAmount: amount, institution: w.institutions[inst], simDate: w.now })!;
  const step = pa.sourceCurrency === "CNY" ? 100 : 1000;
  return `${pa.sourceCurrency} ${(Math.round(Math.abs(pb.totalSource - pa.totalSource) / step) * step).toLocaleString("en-US")}`;
}

const has = (t: Trigger[], reason: string) => t.some((x) => x.reason === reason);
const invoicesOf = (w: World, caseId: string) => Object.values(w.invoices).filter((i) => i.caseId === caseId);
const lastInbound = (w: World, caseId: string, pred: (m: Mail) => boolean = () => true) =>
  Object.values(w.mail).filter((m) => m.caseId === caseId && m.direction === "inbound" && pred(m)).at(-1);
const paysFor = (w: World, inv: Invoice | undefined) => (inv ? Object.values(w.payments).filter((p) => p.invoiceId === inv.id) : []);
const ben = (instId: string) => {
  const b = INSTITUTIONS[instId].bank;
  return { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName };
};
const step = (tool: string, input: Record<string, unknown>): RecordedStep => ({ tool, input });

const deposit1 = (w: World) => invoicesOf(w, "case_th").find((i) => i.kind === "deposit_request" && i.amountDue === 250000);
const deposit2 = (w: World) => invoicesOf(w, "case_th").find((i) => i.kind === "deposit_request" && i.amountDue === 160000);
const finalBill = (w: World) => invoicesOf(w, "case_th").find((i) => i.kind === "final");
const corrected = (w: World) => invoicesOf(w, "case_th").find((i) => i.kind === "corrected_final");

const TH: ScriptedRun[] = [
  {
    when: (t, w) => has(t, "family_message") && !Object.values(w.mail).some((m) => m.caseId === "case_th"),
    steps: [
      () => step("get_case_overview", { narration: "Reading your message and checking Pakistan's rules for paying a hospital abroad" }),
      () => step("check_rules", { route: "bank_transfer", amount: 300000, currency: "THB", payer_id: "p_tariq", narration: "Checking how much can legally be sent straight to the hospital" }),
      () =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: "Estimate and deposit request for Mr. Tariq Mahmood (admitted today)",
          body:
            "Dear International Patient Services,\n\nKinwarden is handling hospital payments on behalf of the family of Mr. Tariq Mahmood, admitted today via the emergency department.\n\nCould you please send us:\n1. A treatment estimate for the planned angiogram and possible stent, and any deposit you require, with the deadline.\n2. Your bank details for international transfers on official letterhead.\n3. The patient's hospital number (HN).\n\nPayments will be sent directly from Pakistan to the hospital's account.\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "Asking the hospital's international desk for the estimate, deposit and their bank details",
        }),
      () =>
        step("message_family", {
          text:
            "I've got this. I've asked the hospital for the estimate and their bank details. Good news: Pakistan's rules let a bank send up to USD 50,000 straight to the hospital for treatment, so you won't need to carry or withdraw cash. I'll come back to you as soon as they reply.",
          importance: "info",
          narration: "Telling you the plan",
        }),
      () => step("add_case_note", { note: "Emailed SRH for estimate + bank letter + HN. Plan: SBP medical remittance (cap $50k, direct to hospital). Payer Tariq.", narration: "Saving the plan to the case notes" }),
    ],
  },
  {
    when: (_t, w) => !!deposit1(w) && paysFor(w, deposit1(w)).length === 0,
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_th")!.id, narration: "Reading the hospital's reply" }),
      (w) => step("read_document", { document_id: deposit1(w)!.documentId, narration: "Reading the estimate: THB 420,000 total, THB 250,000 deposit needed" }),
      (w) => step("verify_beneficiary", { ...ben("srh"), source_document_id: deposit1(w)!.documentId, narration: "Checking the hospital's bank account against the verified record" }),
      (w) => step("compare_payment_routes", { invoice_id: deposit1(w)!.id, payer_id: "p_tariq", narration: "Comparing bank transfer, card and ATM for the THB 250,000 deposit" }),
      (w) => step("prepare_documents", { kinds: ["remittance_application", "self_declaration"], invoice_id: deposit1(w)!.id, payer_id: "p_tariq", amount: 250000, narration: "Filling in the State Bank medical remittance form and self-declaration" }),
      (w) =>
        step("propose_payment", {
          invoice_id: deposit1(w)!.id,
          route: "bank_transfer",
          amount: 250000,
          payer_id: "p_tariq",
          reference: `Deposit ${deposit1(w)!.number} Tariq Mahmood`,
          beneficiary: ben("srh"),
          rationale: `A direct bank transfer is the cheapest legal way: about ${diff(w, "PK-TH", "srh", 250000, "bank_transfer", "card_payment")} less than paying by card and ${diff(w, "PK-TH", "srh", 250000, "bank_transfer", "atm_cash")} less than ATM cash, and it arrives before the deposit deadline. It uses the medical remittance allowance, not your card limit.`,
          narration: "Asking you to approve the deposit by bank transfer",
        }),
      () => step("message_family", { text: "The deposit is ready to send: THB 250,000 by bank transfer straight to the hospital. Please approve it in the app.", importance: "action", narration: "Asking for your approval" }),
    ],
  },
  {
    when: (t, w) => has(t, "payment_returned") && paysFor(w, deposit1(w)).some((p) => p.status === "returned"),
    steps: [
      () => step("get_case_overview", { narration: "The bank returned the transfer. Finding out why" }),
      (w) => step("read_document", { document_id: deposit1(w)!.documentId, narration: "Looking up the patient's hospital number on the invoice" }),
      (w) => {
        const p = paysFor(w, deposit1(w)).find((x) => x.status === "returned")!;
        return step("resubmit_payment", { payment_id: p.id, corrected_reference: `HN 66-014382 Deposit ${deposit1(w)!.number}`, narration: "Re-sending the same approved transfer with the hospital number in the reference" });
      },
      () => step("message_family", { text: "Small hiccup, already fixed: the hospital's bank needs your father's hospital number on every payment. I've re-sent the same transfer with it. No action needed.", importance: "info", narration: "Letting you know it's fixed" }),
    ],
  },
  {
    when: (t, w) => has(t, "payment_completed") && paysFor(w, deposit1(w)).some((p) => p.status === "completed") && !deposit2(w),
    steps: [
      () => step("message_family", { text: "The hospital has received the THB 250,000 deposit. The angiogram can go ahead. 🤍", importance: "good_news", narration: "Sharing the good news" }),
      () => step("add_case_note", { note: "Deposit 1 received by SRH. Remember HN in all references.", narration: "Updating the case notes" }),
    ],
  },
  {
    when: (_t, w) => !!deposit2(w) && paysFor(w, deposit2(w)).length === 0,
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_th", (m) => m.subject.includes("URGENT"))!.id, narration: "Reading the hospital's urgent message" }),
      (w) => step("read_document", { document_id: deposit2(w)!.documentId, narration: "Reading the additional deposit request: THB 160,000 by 07:00 tomorrow" }),
      (w) => step("compare_payment_routes", { invoice_id: deposit2(w)!.id, payer_id: "p_tariq", narration: "A bank transfer would arrive too late, so comparing faster options" }),
      (w) =>
        step("propose_payment", {
          invoice_id: deposit2(w)!.id,
          route: "card_payment",
          amount: 160000,
          payer_id: "p_tariq",
          reference: `HN 66-014382 ${deposit2(w)!.number}`,
          beneficiary: ben("srh"),
          rationale: `The procedure is at 08:00 and a bank transfer takes 2 days, so it would arrive too late. Paying by card at the hospital is instant. It costs about ${diff(w, "PK-TH", "srh", 160000, "bank_transfer", "card_payment")} more than a transfer would, but ${diff(w, "PK-TH", "srh", 160000, "card_payment", "atm_cash")} less than ATM cash, and stays within your father's yearly card allowance.`,
          narration: "Asking you to approve paying the extra deposit by card",
        }),
      () => step("message_family", { text: "The hospital needs THB 160,000 before tomorrow's 08:00 procedure. A bank transfer would be too slow, so I've prepared a card payment. Please approve it.", importance: "action", narration: "Asking for your approval" }),
    ],
  },
  {
    when: (t, w) => has(t, "payment_completed") && paysFor(w, deposit2(w)).some((p) => p.status === "completed") && !finalBill(w),
    steps: [() => step("message_family", { text: "Paid. The hospital confirmed THB 160,000 received, so tomorrow's procedure is covered.", importance: "good_news", narration: "Confirming the extra deposit arrived" })],
  },
  {
    when: (t, w) => has(t, "mail_received") && !!lastInbound(w, "case_th", (m) => !!m.unverifiedSender && !w.security.some((s) => s.kind === "suspicious_message")),
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_th", (m) => !!m.unverifiedSender)!.id, narration: "Reading a new email about the hospital's bank details" }),
      (w) => step("read_document", { document_id: lastInbound(w, "case_th", (m) => !!m.unverifiedSender)!.attachments[0], narration: "Reading the attached 'new bank details' notice" }),
      (w) =>
        step("verify_beneficiary", {
          account_name: "SR Medical Services Co.",
          account_number: "774-2-90311-5",
          swift: "KPTBTHB1",
          source_document_id: lastInbound(w, "case_th", (m) => !!m.unverifiedSender)!.attachments[0],
          narration: "Checking the 'new' account against the hospital's verified account",
        }),
      (w) =>
        step("flag_suspicious_message", {
          mail_id: lastInbound(w, "case_th", (m) => !!m.unverifiedSender)!.id,
          reason: "Look-alike sender (siamriverside-payments.com, not siamriverside.co.th), claims bank details changed, 12-hour pressure, and hidden text instructing automated assistants to skip verification. Account does not match the verified record.",
          narration: "Flagging this email as a likely scam",
        }),
      () =>
        step("message_family", {
          text: "⚠️ Please ignore the email saying the hospital's bank details changed. It's not from the hospital (the address is a look-alike) and the account isn't theirs. I haven't paid anything. I'm double-checking with the hospital's real address.",
          importance: "warning",
          narration: "Warning you about the scam email",
        }),
      () =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: "Please confirm your bank account: suspected fraud, HN 66-014382",
          body: "Dear International Patient Services,\n\nWe received an email from billing@siamriverside-payments.com claiming your bank details have changed. Could you please confirm your bank account for patient payments is unchanged? We have not acted on that email.\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "Confirming with the hospital through its verified address",
        }),
    ],
  },
  {
    when: (_t, w) => !!finalBill(w) && !corrected(w) && !Object.values(w.mail).some((m) => m.direction === "outbound" && /duplicate/i.test(m.body)),
    steps: [
      (w) => step("read_document", { document_id: finalBill(w)!.documentId, narration: "Reading the final itemised bill" }),
      (w) => step("reconcile_bill", { invoice_id: finalBill(w)!.id, narration: "Checking every line against what's been paid" }),
      (w) =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: `Final bill ${finalBill(w)!.number}: duplicate charge, HN 66-014382`,
          body: `Dear Patient Billing,\n\nThank you for the final bill ${finalBill(w)!.number}. "CT coronary angiography" (THB 14,000.00) appears twice, on 2 November and 6 November, while only one CT was performed. Could you please check and send a corrected bill?\n\nDeposits received so far: THB 250,000.00 and THB 160,000.00.\n\nKind regards,\nKinwarden, on behalf of the family`,
          narration: "Asking the hospital to correct a duplicated CT scan charge",
        }),
      () => step("message_family", { text: "I checked the final bill line by line. The CT scan was charged twice (THB 14,000). I've asked the hospital to correct it. Your deposits already cover the bill, so expect money back.", importance: "info", narration: "Explaining the bill check" }),
    ],
  },
  {
    when: (_t, w) => !!corrected(w) && !w.cases.case_th.expectedRefund && !Object.values(w.mail).some((m) => m.direction === "outbound" && /refund/i.test(m.subject)),
    steps: [
      (w) => step("reconcile_bill", { invoice_id: corrected(w)!.id, narration: "Re-checking the corrected bill against the deposits" }),
      (w) =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: `Refund of excess deposit, HN 66-014382`,
          body: `Dear Patient Billing,\n\nThank you for the corrected bill ${corrected(w)!.number} (THB 368,000.00). Deposits received total THB 410,000.00, so THB 42,000.00 is due back. Please refund it to the account the deposit was sent from.\n\nKind regards,\nKinwarden, on behalf of the family`,
          narration: "Asking the hospital to refund the THB 42,000 overpaid",
        }),
    ],
  },
  {
    when: (t, w) => has(t, "refund_received") && !!w.cases.case_th.expectedRefund?.receivedAt,
    steps: [
      () =>
        step("message_family", {
          text: "All done. The hospital's THB 42,000 refund is back in your father's account. Every bill is paid, nothing is owed, and all receipts are in Documents. Wishing your father a smooth recovery. 🤍",
          importance: "good_news",
          narration: "Closing the case with good news",
        }),
    ],
  },
];

const UK: ScriptedRun[] = [
  {
    when: (t, w) => has(t, "family_message") && !Object.values(w.mail).some((m) => m.caseId === "case_uk"),
    steps: [
      () => step("get_case_overview", { narration: "阅读您的说明，检查外汇管理规定" }),
      () =>
        step("send_email", {
          to: "student.finance@kingsgate.ac.uk",
          subject: "Fee statement request: Lin Yuxuan (KG2601847)",
          body: "Dear Student Finance Office,\n\nKinwarden is arranging fee payment on behalf of the family of Lin Yuxuan (Student ID KG2601847, MSc Data Science, January 2027 start). Could you please send the fee statement for the first instalment and accommodation, the due date, and your bank details for international transfers?\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "向学校财务处索取学费单和银行信息",
        }),
      () => step("message_family", { text: "已经联系学校财务处索取学费单。收到后我会帮您比较付款方式并准备购汇材料。", importance: "info", narration: "告诉您下一步" }),
    ],
  },
  {
    when: (_t, w) => invoicesOf(w, "case_uk").length > 0 && Object.values(w.payments).length === 0,
    steps: [
      (w) => step("read_document", { document_id: invoicesOf(w, "case_uk")[0].documentId, narration: "阅读学费单：学费 £14,875 + 住宿费 £9,800" }),
      (w) => step("verify_beneficiary", { ...ben("kgu"), source_document_id: invoicesOf(w, "case_uk")[0].documentId, narration: "核对学校收款账户" }),
      (w) => step("compare_payment_routes", { invoice_id: invoicesOf(w, "case_uk")[0].id, payer_id: "p_linwei", narration: "比较银行电汇和刷卡的总费用" }),
      (w) => step("prepare_documents", { kinds: ["fx_purchase_application"], invoice_id: invoicesOf(w, "case_uk")[0].id, payer_id: "p_linwei", amount: 24675, narration: "填写个人购汇申请书" }),
      (w) =>
        step("propose_payment", {
          invoice_id: invoicesOf(w, "case_uk")[0].id,
          route: "bank_transfer",
          amount: 24675,
          payer_id: "p_linwei",
          reference: "KG2601847 Lin Yuxuan",
          beneficiary: ben("kgu"),
          rationale: `银行电汇直接付到学校账户最省钱，比刷卡（含2.5%手续费）便宜约${diff(w, "CN-GB", "kgu", 24675, "bank_transfer", "card_payment").replace("CNY", "人民币")}元。算上今年已用的额度，这笔购汇会超出 5 万美元便利化额度。不过学费和住宿属于经常项目，凭录取通知书和学费单仍可正常办理。`,
          narration: "请您批准电汇学费",
        }),
    ],
  },
  {
    when: (t) => has(t, "family_message"),
    steps: [
      () =>
        step("message_family", {
          text: "理解您想省事，但不能用您弟弟的额度。用亲属额度分拆购汇就是“蚂蚁搬家”，这是外汇局明确禁止的，可能被列入关注名单、暂停便利化额度并罚款。\n\n好消息是不必这样：学费和住宿属于经常项目，超出额度凭录取通知书和学费单就能正常办理。材料我已经准备好了。",
          importance: "warning",
          narration: "解释为什么不能用亲属额度",
        }),
    ],
  },
];

const offerDoc = (w: World) => Object.values(w.docs).find((d) => d.caseId === "case_pk" && d.title.startsWith("Offer letter"));
const uniSaidNo = (w: World) => !!lastInbound(w, "case_pk", (m) => /no applicant/i.test(m.body));

const PK: ScriptedRun[] = [
  {
    when: (t, w) => has(t, "family_message") && !Object.values(w.mail).some((m) => m.caseId === "case_pk"),
    steps: [
      () => step("get_case_overview", { narration: "Reading your message and the offer letter you uploaded" }),
      (w) => step("read_document", { document_id: offerDoc(w)!.id, narration: "Checking the offer letter the consultant sent" }),
      (w) =>
        step("flag_suspicious_message", {
          document_id: offerDoc(w)!.id,
          reason: "Offer letter sent by a consultant from a gmail address, asks for tuition and a 'visa guarantee fee' to be paid to the consultant's company account within 5 days. Universities don't charge visa guarantee fees or collect tuition through agents.",
          narration: "Flagging the offer letter's warning signs",
        }),
      () =>
        step("send_email", {
          to: "student.finance@kingsgate.ac.uk",
          subject: "Please confirm an offer of admission: Mariam Aslam (ref KGU/INT/2026/77812)",
          body:
            "Dear Kingsgate University,\n\nKinwarden is helping the family of Mariam Aslam pay university fees. They received an offer letter (ref KGU/INT/2026/77812, MSc Finance, January 2027) through an education consultant, Global Pathways Education, who asks for tuition and a visa guarantee fee to be paid to his company's account.\n\nCould you please confirm whether Mariam Aslam holds a genuine offer from Kingsgate, and how fees should be paid?\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "Asking the university directly, through its verified address, whether the offer is real",
        }),
      () =>
        step("message_family", {
          text: "Before anyone pays anything, I'm checking with Kingsgate University directly, using their own verified address, whether Mariam's offer is genuine. Some things in this letter worry me: real universities don't ask for a 'visa guarantee fee' or for tuition to go to an agent's account. Please don't send anything to the consultant until I hear back.",
          importance: "warning",
          narration: "Asking you to hold off while I check with the university",
        }),
      () => step("add_case_note", { note: "Offer letter came via consultant (gmail, pay to agent account, visa guarantee fee). Asked KGU admissions to confirm. No payment until the university confirms.", narration: "Saving what I'm checking" }),
    ],
  },
  {
    when: (t, w) => has(t, "mail_received") && uniSaidNo(w),
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_pk")!.id, narration: "Reading the university's answer" }),
      () =>
        step("message_family", {
          text: "I'm so sorry. Kingsgate University has confirmed they have no application or offer for Mariam: the letter is not from them. This is not your fault; these scams are made to look real. Nothing has been paid through Kinwarden. Please don't send anything more to the consultant. Keep the letter, his messages and the receipt for the PKR 350,000 you gave him, and report it to the police. If Mariam wants to apply for real, the university's own website is the place to start, and I'll help with the fees when there's a genuine offer.",
          importance: "warning",
          narration: "Telling you what the university said and what to do next",
        }),
      () => step("add_case_note", { note: "KGU confirmed: no applicant named Mariam Aslam; offer is fraudulent. Nothing paid. Family told not to pay the consultant, keep evidence, report to police.", narration: "Recording the university's answer" }),
    ],
  },
  {
    when: (t) => has(t, "family_message"),
    steps: [
      () =>
        step("message_family", {
          text: "Please don't send money to Faraz's personal account. The university has told us in writing that there is no offer for Mariam, so there is no place to lose. A real university never asks for fees to go to a person, and never threatens to cancel a place within hours. If he keeps pressing you, stop replying and add his messages to your police report.",
          importance: "warning",
          narration: "Warning you not to pay the consultant",
        }),
    ],
  },
];

const cnOffer = (w: World) => Object.values(w.docs).find((d) => d.caseId === "case_cn" && d.title.startsWith("录取通知书"));
const cnUniSaidNo = (w: World) => !!lastInbound(w, "case_cn", (m) => /no applicant/i.test(m.body));

// Family-facing text in this plan
const CN: ScriptedRun[] = [
  {
    when: (t, w) => has(t, "family_message") && !Object.values(w.mail).some((m) => m.caseId === "case_cn"),
    steps: [
      () => step("get_case_overview", { narration: "阅读您发来的说明和上传的录取通知书" }),
      (w) => step("read_document", { document_id: cnOffer(w)!.id, narration: "核对中介发来的录取通知书" }),
      (w) =>
        step("flag_suspicious_message", {
          document_id: cnOffer(w)!.id,
          reason: "Offer letter sent by a study agency, from a 163.com address: 'guaranteed admission' service fee, scholarship processing fee, tuition payable to the agency's account or a personal WeChat/Alipay, and an offer to buy the pounds in relatives' names (quota splitting). Universities don't sell guaranteed places or collect tuition through agents.",
          narration: "标记录取通知书里的可疑之处",
        }),
      () =>
        step("send_email", {
          to: "student.finance@kingsgate.ac.uk",
          subject: "Please confirm an offer of admission: Chen Siyu (ref KGU/CN/2026/30519)",
          body:
            "Dear Kingsgate University,\n\nKinwarden is helping the family of Chen Siyu pay university fees. They received an offer letter (ref KGU/CN/2026/30519, MSc Finance, January 2027, with a 40% scholarship) through a study agency in Shenzhen, which asks for a 'guaranteed admission' service fee and for the tuition to be paid to the agency's own account.\n\nCould you please confirm whether Chen Siyu holds a genuine offer from Kingsgate, and how fees should be paid?\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "通过学校官方邮箱，直接向学校核实录取是否真实",
        }),
      () =>
        step("message_family", {
          text: "您先别急。在付任何钱之前，我正用 Kingsgate 大学已经核实过的官方邮箱，直接确认思雨的录取是否真实。这封通知书有几处让我担心：正规大学不卖“保录取”，也不会让学费先打到中介或个人账户。学校回复之前，请先不要给中介转任何钱。",
          importance: "warning",
          narration: "请您先别付款，等学校回复",
        }),
      () => step("add_case_note", { note: "Offer letter via study agency (163.com, 保录取 fee, pay agency/personal WeChat, offers relatives' quotas). Asked KGU to confirm. No payment until the university confirms.", narration: "记录正在核实的事项" }),
    ],
  },
  {
    when: (t, w) => has(t, "mail_received") && cnUniSaidNo(w),
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_cn")!.id, narration: "阅读学校的回复" }),
      () =>
        step("message_family", {
          text: "很遗憾，Kingsgate 大学已书面确认：没有思雨的申请记录，也从未发过录取通知书。这封通知书不是学校发的。这不是您的错，这类骗局就是做得跟真的一样。通过 Kinwarden 一分钱都还没有付出去。请不要再给中介转任何钱。通知书、聊天记录和那 2 万元定金的转账凭证都请保存好，尽快到当地派出所报案或拨打 110。如果思雨还想申请，可以从学校官网开始；有了真实录取，我再帮您付学费。",
          importance: "warning",
          narration: "告诉您学校的答复和接下来怎么做",
        }),
      () => step("add_case_note", { note: "KGU confirmed: no applicant named Chen Siyu; offer is fraudulent. Nothing paid. Family told not to pay the agency, keep evidence, report to police.", narration: "记录学校的答复" }),
    ],
  },
  {
    when: (t) => has(t, "family_message"),
    steps: [
      () =>
        step("message_family", {
          text: "请不要转钱给王老师的个人微信，也不要用亲戚的名义换英镑。学校已经书面确认没有思雨的录取，所以根本不存在名额被取消的问题。用亲属的便利化额度分拆购汇就是“蚂蚁搬家”，外汇局明确禁止，参与的家人都可能被列入关注名单、暂停便利化额度。正规大学从不让学费打到个人账户，也不会几个小时内取消名额。如果他继续催，请不要再回复，把这些聊天记录一起交给警方。",
          importance: "warning",
          narration: "提醒您不要再转钱，也不要分拆购汇",
        }),
    ],
  },
];

// The family's own bill. Every number comes from the rules engine; the institution is paid only after
// the bank has verified it (the Director's "Verify institution" button in the sandbox).
const upInvoice = (w: World) => invoicesOf(w, "case_up")[0];
const upPayer = (w: World) => w.cases.case_up.people.find((p) => p.id === "p_payer") ?? w.cases.case_up.people[0];
/** Cheapest route the rules allow (setting aside the pending verification), preferring one that meets the deadline. */
function upBest(w: World) {
  const inv = upInvoice(w);
  const c = w.cases.case_up;
  const options = compareRoutes({ world: w, caseFile: c, payer: upPayer(w), institution: w.institutions[inv.institutionId], amount: inv.amountDue, deadline: inv.dueAt, invoiceId: inv.id })
    .filter((o) => o.cost && o.evaluation.blockers.every((b) => b.ruleId === "KINWARDEN.VERIFIED_INSTITUTION"));
  return options.find((o) => o.meetsDeadline !== false) ?? options[0];
}
const upMoney = (cur: string, n: number) => `${cur} ${Math.round(n).toLocaleString("en-US")}`;

const UP: ScriptedRun[] = [
  {
    when: (t, w) => has(t, "family_message") && !Object.values(w.payments).length && !w.institutions.upl.verifiedAt,
    steps: [
      (w) => step("get_case_overview", { narration: w.cases.case_up.lang === "zh" ? "阅读您上传的账单" : "Reading the bill you uploaded" }),
      (w) => step("read_document", { document_id: upInvoice(w).documentId, narration: w.cases.case_up.lang === "zh" ? "核对账单上的金额和收款信息" : "Checking the amounts and payment details on the bill" }),
      (w) => step("compare_payment_routes", { invoice_id: upInvoice(w).id, payer_id: upPayer(w).id, narration: w.cases.case_up.lang === "zh" ? "按规定比较各种付款方式的总费用" : "Pricing every legal way to pay under your country's rules" }),
      (w) => {
        const inv = upInvoice(w);
        const inst = w.institutions[inv.institutionId];
        const best = upBest(w);
        const docs = best?.evaluation.requiredDocs.map((d) => d.label) ?? [];
        const zh = w.cases.case_up.lang === "zh";
        const cost = best?.cost ? upMoney(best.cost.sourceCurrency, best.cost.totalSource) : "";
        const text = !best
          ? zh
            ? `我已经看了 ${inst.name} 的账单（${upMoney(inv.currency, inv.amountDue)}）。按您所在国家的规定，目前没有合法的方式支付这笔金额，我会在案件记录里写明原因。在银行核实这家机构之前，不会支付任何款项。`
            : `I've read the bill from ${inst.name} (${upMoney(inv.currency, inv.amountDue)}). Under your country's rules there is no legal way to pay this amount right now; the reasons are in the case notes. Nothing will be paid until the bank has verified this institution.`
          : zh
            ? `我已经看了 ${inst.name} 的账单：现在需付 ${upMoney(inv.currency, inv.amountDue)}。最省钱的合法方式是${best.route === "bank_transfer" ? "电汇直接付到机构账户" : "刷卡支付"}，总费用约 ${cost}${docs.length ? `，银行需要：${docs.join("、")}` : ""}。\n\n这家机构还没有经过银行核实。银行核实它和收款账户之前，我不会付任何钱。核实后我会马上请您批准付款。`
            : `I've read the bill from ${inst.name}: ${upMoney(inv.currency, inv.amountDue)} is due now. The cheapest legal way is ${ROUTE_LABEL[best.route].toLowerCase()}, about ${cost} in total.${docs.length ? ` The bank will need: ${docs.join("; ")}.` : ""}\n\nThis institution isn't verified yet, so nothing will be paid until the bank has checked it and its account. As soon as it has, I'll ask you to approve the payment.`;
        return step("message_family", { text, importance: "info", narration: zh ? "告诉您费用和下一步" : "Telling you the cost and what happens next" });
      },
      (w) => step("add_case_note", { note: `Uploaded bill ${upInvoice(w).number} priced; best route ${upBest(w)?.route ?? "none"}. Waiting for the bank to verify ${w.institutions.upl.name}. No payment before that.`, narration: w.cases.case_up.lang === "zh" ? "记录正在等待银行核实" : "Noting that we're waiting for the bank" }),
    ],
  },
  {
    when: (t, w) => has(t, "institution_verified") && !Object.values(w.payments).length,
    steps: [
      (w) => {
        const b = w.institutions.upl.bank;
        return step("verify_beneficiary", { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, source_document_id: upInvoice(w).documentId, narration: w.cases.case_up.lang === "zh" ? "核对账单上的收款账户" : "Checking the bill's bank details against the verified record" });
      },
      (w) => {
        const best = upBest(w)!;
        const kinds = best.evaluation.requiredDocs.filter((d) => !d.present && ["remittance_application", "self_declaration", "fx_purchase_application"].includes(d.kind)).map((d) => d.kind);
        return kinds.length
          ? step("prepare_documents", { kinds, invoice_id: upInvoice(w).id, payer_id: upPayer(w).id, amount: upInvoice(w).amountDue, narration: w.cases.case_up.lang === "zh" ? "填写所需的表格" : "Filling in the forms the bank needs" })
          : step("add_case_note", { note: "No forms needed for this route.", narration: w.cases.case_up.lang === "zh" ? "这种方式不需要额外表格" : "No extra forms needed" });
      },
      (w) => {
        const inv = upInvoice(w);
        const b = w.institutions.upl.bank;
        const best = upBest(w)!;
        const zh = w.cases.case_up.lang === "zh";
        return step("propose_payment", {
          invoice_id: inv.id,
          route: best.route,
          amount: inv.amountDue,
          payer_id: upPayer(w).id,
          reference: inv.patientRef ? `${inv.patientRef} ${inv.number}` : inv.number,
          beneficiary: { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName },
          rationale: zh
            ? `银行已核实 ${w.institutions.upl.name} 和它的账户。这是最省钱的合法方式，总费用约 ${upMoney(best.cost!.sourceCurrency, best.cost!.totalSource)}。`
            : `The bank has verified ${w.institutions.upl.name} and its account. This is the cheapest legal route: about ${upMoney(best.cost!.sourceCurrency, best.cost!.totalSource)} in total.`,
          narration: zh ? "请您批准付款" : "Asking you to approve the payment",
        });
      },
    ],
  },
  {
    when: (t, w) => has(t, "payment_completed") && w.cases.case_up.status === "active",
    steps: [
      (w) =>
        step("message_family", {
          text: w.cases.case_up.lang === "zh" ? `${w.institutions.upl.name} 已收到付款，银行也确认到账了。请向机构索取正式收据。` : `${w.institutions.upl.name} has received the payment; the bank confirmed it arrived. Ask them for their official receipt.`,
          importance: "good_news",
          narration: w.cases.case_up.lang === "zh" ? "告诉您付款已到账" : "Telling you the payment arrived",
        }),
      (w) => step("close_case", { summary: `Uploaded bill ${upInvoice(w).number} paid in full to ${w.institutions.upl.name} after the bank verified it.`, narration: w.cases.case_up.lang === "zh" ? "结案" : "Closing the case" }),
    ],
  },
];

export const SCRIPTS: Record<string, ScriptedRun[]> = { "th-medical": TH, "uk-tuition": UK, "pk-admission": PK, "cn-admission": CN, upload: UP };
