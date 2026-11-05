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
      () => step("check_rules", { route: "bank_transfer", amount: 300000, currency: "THB", payer_id: "p_daniel", narration: "Checking how much can legally be sent straight to the hospital" }),
      () =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: "Estimate and deposit request for Mr. Daniel Hart (admitted today)",
          body:
            "Dear International Patient Services,\n\nKinwarden is handling hospital payments on behalf of the family of Mr. Daniel Hart, admitted today via the emergency department.\n\nCould you please send us:\n1. A treatment estimate for the planned angiogram and possible stent, and any deposit you require, with the deadline.\n2. Your bank details for international transfers on official letterhead.\n3. The patient's hospital number (HN).\n\nPayments will be sent directly from Pakistan to the hospital's account.\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "Asking the hospital's international desk for the estimate, deposit and their bank details",
        }),
      () =>
        step("message_family", {
          text:
            "I've got this. I've asked the hospital for the estimate and their bank details. Good news: Pakistan's rules let a bank send up to USD 50,000 straight to the hospital for treatment, so you won't need to carry or withdraw cash. I'll come back to you as soon as they reply.",
          importance: "info",
          narration: "Telling you the plan",
        }),
      () => step("add_case_note", { note: "Emailed SRH for estimate + bank letter + HN. Plan: SBP medical remittance (cap $50k, direct to hospital). Payer Daniel.", narration: "Saving the plan to the case notes" }),
    ],
  },
  {
    when: (_t, w) => !!deposit1(w) && paysFor(w, deposit1(w)).length === 0,
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_th")!.id, narration: "Reading the hospital's reply" }),
      (w) => step("read_document", { document_id: deposit1(w)!.documentId, narration: "Reading the estimate: THB 420,000 total, THB 250,000 deposit needed" }),
      (w) => step("verify_beneficiary", { ...ben("srh"), source_document_id: deposit1(w)!.documentId, narration: "Checking the hospital's bank account against the verified record" }),
      (w) => step("compare_payment_routes", { invoice_id: deposit1(w)!.id, payer_id: "p_daniel", narration: "Comparing bank transfer, card and ATM for the THB 250,000 deposit" }),
      (w) => step("prepare_documents", { kinds: ["remittance_application", "self_declaration"], invoice_id: deposit1(w)!.id, payer_id: "p_daniel", amount: 250000, narration: "Filling in the State Bank medical remittance form and self-declaration" }),
      (w) =>
        step("propose_payment", {
          invoice_id: deposit1(w)!.id,
          route: "bank_transfer",
          amount: 250000,
          payer_id: "p_daniel",
          reference: `Deposit ${deposit1(w)!.number} Daniel Hart`,
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
      (w) => step("compare_payment_routes", { invoice_id: deposit2(w)!.id, payer_id: "p_daniel", narration: "A bank transfer would arrive too late, so comparing faster options" }),
      (w) =>
        step("propose_payment", {
          invoice_id: deposit2(w)!.id,
          route: "card_payment",
          amount: 160000,
          payer_id: "p_daniel",
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
      () => step("get_case_overview", { narration: "Reading your note and checking the foreign-exchange rules" }),
      () =>
        step("send_email", {
          to: "student.finance@kingsgate.ac.uk",
          subject: "Fee statement request: Emily Lane (KG2601847)",
          body: "Dear Student Finance Office,\n\nKinwarden is arranging fee payment on behalf of the family of Emily Lane (Student ID KG2601847, MSc Data Science, January 2027 start). Could you please send the fee statement for the first instalment and accommodation, the due date, and your bank details for international transfers?\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "Asking the university's finance office for the fee statement and bank details",
        }),
      () => step("message_family", { text: "I've asked the university's finance office for the fee statement. When it arrives I'll compare the ways to pay and prepare the foreign-exchange paperwork.", importance: "info", narration: "Telling you what happens next" }),
    ],
  },
  {
    when: (_t, w) => invoicesOf(w, "case_uk").length > 0 && Object.values(w.payments).length === 0,
    steps: [
      (w) => step("read_document", { document_id: invoicesOf(w, "case_uk")[0].documentId, narration: "Reading the fee statement: tuition £14,875 + accommodation £9,800" }),
      (w) => step("verify_beneficiary", { ...ben("kgu"), source_document_id: invoicesOf(w, "case_uk")[0].documentId, narration: "Checking the university's bank account" }),
      (w) => step("compare_payment_routes", { invoice_id: invoicesOf(w, "case_uk")[0].id, payer_id: "p_robert", narration: "Comparing the total cost of a bank transfer and a card payment" }),
      (w) => step("prepare_documents", { kinds: ["fx_purchase_application"], invoice_id: invoicesOf(w, "case_uk")[0].id, payer_id: "p_robert", amount: 24675, narration: "Filling in the personal FX purchase application" }),
      (w) =>
        step("propose_payment", {
          invoice_id: invoicesOf(w, "case_uk")[0].id,
          route: "bank_transfer",
          amount: 24675,
          payer_id: "p_robert",
          reference: "KG2601847 Emily Lane",
          beneficiary: ben("kgu"),
          rationale: `A bank transfer straight to the university's account is the cheapest way, about ${diff(w, "CN-GB", "kgu", 24675, "bank_transfer", "card_payment")} less than paying by card (2.5% fee). With what you have already used this year, this purchase goes over the USD 50,000 yearly quota. Tuition and accommodation are current-account payments, so the bank can still process it with the admission letter and the fee statement.`,
          narration: "Asking you to approve the tuition transfer",
        }),
    ],
  },
  {
    when: (t) => has(t, "family_message"),
    steps: [
      () =>
        step("message_family", {
          text: "I understand wanting to keep it simple, but we can't use your brother's quota. Splitting one purchase across relatives' quotas (known as \"ant moving\") is explicitly prohibited by the foreign-exchange regulator: it can put you on a watch list, suspend your yearly quota and lead to a fine.\n\nThe good news is that it isn't needed: tuition and accommodation are current-account payments, so above the quota the bank processes them with the admission letter and the fee statement. I have already prepared the paperwork.",
          importance: "warning",
          narration: "Explaining why a relative's quota can't be used",
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
          subject: "Please confirm an offer of admission: Maya Grant (ref KGU/INT/2026/77812)",
          body:
            "Dear Kingsgate University,\n\nKinwarden is helping the family of Maya Grant pay university fees. They received an offer letter (ref KGU/INT/2026/77812, MSc Finance, January 2027) through an education consultant, Global Pathways Education, who asks for tuition and a visa guarantee fee to be paid to his company's account.\n\nCould you please confirm whether Maya Grant holds a genuine offer from Kingsgate, and how fees should be paid?\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "Asking the university directly, through its verified address, whether the offer is real",
        }),
      () =>
        step("message_family", {
          text: "Before anyone pays anything, I'm checking with Kingsgate University directly, using their own verified address, whether Maya's offer is genuine. Some things in this letter worry me: real universities don't ask for a 'visa guarantee fee' or for tuition to go to an agent's account. Please don't send anything to the consultant until I hear back.",
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
          text: "I'm so sorry. Kingsgate University has confirmed they have no application or offer for Maya: the letter is not from them. This is not your fault; these scams are made to look real. Nothing has been paid through Kinwarden. Please don't send anything more to the consultant. Keep the letter, his messages and the receipt for the PKR 350,000 you gave him, and report it to the police. If Maya wants to apply for real, the university's own website is the place to start, and I'll help with the fees when there's a genuine offer.",
          importance: "warning",
          narration: "Telling you what the university said and what to do next",
        }),
      () => step("add_case_note", { note: "KGU confirmed: no applicant named Maya Grant; offer is fraudulent. Nothing paid. Family told not to pay the consultant, keep evidence, report to police.", narration: "Recording the university's answer" }),
    ],
  },
  {
    when: (t) => has(t, "family_message"),
    steps: [
      () =>
        step("message_family", {
          text: "Please don't send money to Mark's personal account. The university has told us in writing that there is no offer for Maya, so there is no place to lose. A real university never asks for fees to go to a person, and never threatens to cancel a place within hours. If he keeps pressing you, stop replying and add his messages to your police report.",
          importance: "warning",
          narration: "Warning you not to pay the consultant",
        }),
    ],
  },
];

const cnOffer = (w: World) => Object.values(w.docs).find((d) => d.caseId === "case_cn" && d.title.startsWith("Offer letter"));
const cnUniSaidNo = (w: World) => !!lastInbound(w, "case_cn", (m) => /no applicant/i.test(m.body));

// Family-facing text in this plan
const CN: ScriptedRun[] = [
  {
    when: (t, w) => has(t, "family_message") && !Object.values(w.mail).some((m) => m.caseId === "case_cn"),
    steps: [
      () => step("get_case_overview", { narration: "Reading your note and the offer letter you uploaded" }),
      (w) => step("read_document", { document_id: cnOffer(w)!.id, narration: "Checking the offer letter sent by the agency" }),
      (w) =>
        step("flag_suspicious_message", {
          document_id: cnOffer(w)!.id,
          reason: "Offer letter sent by a study agency, from a 163.com address: 'guaranteed admission' service fee, scholarship processing fee, tuition payable to the agency's account or a personal WeChat/Alipay, and an offer to buy the pounds in relatives' names (quota splitting). Universities don't sell guaranteed places or collect tuition through agents.",
          narration: "Flagging what looks wrong in the offer letter",
        }),
      () =>
        step("send_email", {
          to: "student.finance@kingsgate.ac.uk",
          subject: "Please confirm an offer of admission: Sophie Cole (ref KGU/CN/2026/30519)",
          body:
            "Dear Kingsgate University,\n\nKinwarden is helping the family of Sophie Cole pay university fees. They received an offer letter (ref KGU/CN/2026/30519, MSc Finance, January 2027, with a 40% scholarship) through a study agency in Shenzhen, which asks for a 'guaranteed admission' service fee and for the tuition to be paid to the agency's own account.\n\nCould you please confirm whether Sophie Cole holds a genuine offer from Kingsgate, and how fees should be paid?\n\nKind regards,\nKinwarden, on behalf of the family",
          narration: "Asking the university directly, at its verified address, whether the offer is real",
        }),
      () =>
        step("message_family", {
          text: "Please hold on for a moment. Before anything is paid, I'm using Kingsgate University's verified address to confirm directly whether Sophie's offer is real. A few things in this letter worry me: real universities don't sell guaranteed places, and they never ask for tuition to be paid to an agency or a personal account first. Until the university replies, please don't send the agency any money.",
          importance: "warning",
          narration: "Asking you not to pay until the university replies",
        }),
      () => step("add_case_note", { note: "Offer letter via study agency (163.com, guaranteed-admission fee, pay agency or a personal mobile-payment account, offers relatives' quotas). Asked KGU to confirm. No payment until the university confirms.", narration: "Noting what is being checked" }),
    ],
  },
  {
    when: (t, w) => has(t, "mail_received") && cnUniSaidNo(w),
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_cn")!.id, narration: "Reading the university's reply" }),
      () =>
        step("message_family", {
          text: "I'm sorry: Kingsgate University has confirmed in writing that it has no application from Sophie and never sent this offer letter. The letter did not come from the university. This is not your fault; these scams are made to look exactly like the real thing. Nothing has been paid through Kinwarden. Please don't send the agency any more money. Keep the letter, the chat messages and the receipt for the CNY 20,000 deposit, and report it to the police as soon as you can. If Sophie still wants to apply, she can start on the university's own website; once she has a real offer, I'll help you pay the fees.",
          importance: "warning",
          narration: "Telling you the university's answer and what to do next",
        }),
      () => step("add_case_note", { note: "KGU confirmed: no applicant named Sophie Cole; offer is fraudulent. Nothing paid. Family told not to pay the agency, keep evidence, report to police.", narration: "Noting the university's answer" }),
    ],
  },
  {
    when: (t) => has(t, "family_message"),
    steps: [
      () =>
        step("message_family", {
          text: "Please don't send money to Mr Ellis's personal account, and don't buy pounds in your relatives' names. The university has confirmed in writing that Sophie has no offer, so there is no place to lose. Splitting a purchase across relatives' quotas (\"ant moving\") is explicitly prohibited by the foreign-exchange regulator, and every relative involved could be put on a watch list and lose their quota. Real universities never ask for tuition to go to a personal account, and they don't cancel a place within a few hours. If he keeps pushing, please stop replying and give these messages to the police as well.",
          importance: "warning",
          narration: "Reminding you not to send money or split the purchase",
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
      () => step("get_case_overview", { narration: "Reading the bill you uploaded" }),
      (w) => step("read_document", { document_id: upInvoice(w).documentId, narration: "Checking the amounts and payment details on the bill" }),
      (w) => step("compare_payment_routes", { invoice_id: upInvoice(w).id, payer_id: upPayer(w).id, narration: "Pricing every legal way to pay under your country's rules" }),
      (w) => {
        const inv = upInvoice(w);
        const inst = w.institutions[inv.institutionId];
        const best = upBest(w);
        const docs = best?.evaluation.requiredDocs.map((d) => d.label) ?? [];
        const cost = best?.cost ? upMoney(best.cost.sourceCurrency, best.cost.totalSource) : "";
        const text = !best
          ? `I've read the bill from ${inst.name} (${upMoney(inv.currency, inv.amountDue)}). Under your country's rules there is no legal way to pay this amount right now; the reasons are in the case notes. Nothing will be paid until the bank has verified this institution.`
          : `I've read the bill from ${inst.name}: ${upMoney(inv.currency, inv.amountDue)} is due now. The cheapest legal way is ${ROUTE_LABEL[best.route].toLowerCase()}, about ${cost} in total.${docs.length ? ` The bank will need: ${docs.join("; ")}.` : ""}\n\nThis institution isn't verified yet, so nothing will be paid until the bank has checked it and its account. As soon as it has, I'll ask you to approve the payment.`;
        return step("message_family", { text, importance: "info", narration: "Telling you the cost and what happens next" });
      },
      (w) => step("add_case_note", { note: `Uploaded bill ${upInvoice(w).number} priced; best route ${upBest(w)?.route ?? "none"}. Waiting for the bank to verify ${w.institutions.upl.name}. No payment before that.`, narration: "Noting that we're waiting for the bank" }),
    ],
  },
  {
    when: (t, w) => has(t, "institution_verified") && !Object.values(w.payments).length,
    steps: [
      (w) => {
        const b = w.institutions.upl.bank;
        return step("verify_beneficiary", { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, source_document_id: upInvoice(w).documentId, narration: "Checking the bill's bank details against the verified record" });
      },
      (w) => {
        const best = upBest(w)!;
        const kinds = best.evaluation.requiredDocs.filter((d) => !d.present && ["remittance_application", "self_declaration", "fx_purchase_application"].includes(d.kind)).map((d) => d.kind);
        return kinds.length
          ? step("prepare_documents", { kinds, invoice_id: upInvoice(w).id, payer_id: upPayer(w).id, amount: upInvoice(w).amountDue, narration: "Filling in the forms the bank needs" })
          : step("add_case_note", { note: "No forms needed for this route.", narration: "No extra forms needed" });
      },
      (w) => {
        const inv = upInvoice(w);
        const b = w.institutions.upl.bank;
        const best = upBest(w)!;
        return step("propose_payment", {
          invoice_id: inv.id,
          route: best.route,
          amount: inv.amountDue,
          payer_id: upPayer(w).id,
          reference: inv.patientRef ? `${inv.patientRef} ${inv.number}` : inv.number,
          beneficiary: { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName },
          rationale: `The bank has verified ${w.institutions.upl.name} and its account. This is the cheapest legal route: about ${upMoney(best.cost!.sourceCurrency, best.cost!.totalSource)} in total.`,
          narration: "Asking you to approve the payment",
        });
      },
    ],
  },
  {
    when: (t, w) => has(t, "payment_completed") && w.cases.case_up.status === "active",
    steps: [
      (w) =>
        step("message_family", {
          text: `${w.institutions.upl.name} has received the payment; the bank confirmed it arrived. Ask them for their official receipt.`,
          importance: "good_news",
          narration: "Telling you the payment arrived",
        }),
      (w) => step("close_case", { summary: `Uploaded bill ${upInvoice(w).number} paid in full to ${w.institutions.upl.name} after the bank verified it.`, narration: "Closing the case" }),
    ],
  },
];

export const SCRIPTS: Record<string, ScriptedRun[]> = { "th-medical": TH, "uk-tuition": UK, "pk-admission": PK, "cn-admission": CN, upload: UP };
