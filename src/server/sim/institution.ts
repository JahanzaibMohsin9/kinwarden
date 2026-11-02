import type { Institution, Invoice } from "@/domain/types";
import { INSTITUTIONS } from "@/domain/institutions";
import type { Store } from "../store";
import { addDoc, hoursFrom, issueInvoice, sendMail } from "./factory";
import { schedule } from "./engine";

// ---------------------------------------------------------------------------
// Sandbox institutions answer email like a competent back office: one reply
// per email, answering every question asked in it, and saying when something
// that doesn't exist yet (such as the final bill) will come.

export type Intent = "estimate" | "bank_details" | "fraud_alert" | "payment_status" | "cash" | "dispute" | "refund" | "statement" | "admission";

/** Order in which answers appear in the reply (a dispute is settled before a refund is worked out). */
const PATTERNS: [Intent, RegExp][] = [
  ["estimate", /estimate|pro-?forma|quotation|fee statement|fee schedule|deposit (is )?(required|needed|amount)|how much|cost of (the )?(treatment|procedure|programme)/],
  ["bank_details", /bank (details|account|letter|confirmation)|account (details|name|number)|letterhead|beneficiary|swift|iban/],
  ["fraud_alert", /fraud|scam|phishing|suspicious|look-?alike|impersonat|did not come from|not (been )?(sent|come) from (you|your|the hospital|the university)/],
  ["payment_status", /receipt|received|arriv|credited|(transfer|payment|deposit) (has been |was |is )?(sent|initiated|made|submitted|on its way|in progress)|we (have )?(sent|paid|transferred|initiated)/],
  ["cash", /\bcash\b|cashier/],
  ["dispute", /duplicate|twice|double[- ]?charg|charged two|same (test|scan)|dispute|corrected (bill|invoice)|billing error/],
  ["refund", /refund|excess deposit|money back|return the (balance|difference)|overpa/],
  ["statement", /statement|final (bill|invoice)|itemi[sz]ed|outstanding|balance|account summary/],
  ["admission", /(confirm|verify) (the |her |his |this |that )?(admission|offer|enrol|applicant|student)|genuine offer/],
];

export function detectIntents(text: string): Intent[] {
  const t = text.toLowerCase();
  return PATTERNS.filter(([, re]) => re.test(t)).map(([k]) => k);
}

interface Profile {
  desk: string;
  billing: string;
  tz: string;
  subjectName: string;
  subjectRef: string;
  refLabel: string;
}

const PROFILES: Record<string, Profile> = {
  srh: { desk: "SRH International Patient Services", billing: "Patient Billing", tz: "Asia/Bangkok", subjectName: "Mr. Tariq Mahmood", subjectRef: "HN 66-014382", refLabel: "HN" },
  kgu: { desk: "Kingsgate Student Finance", billing: "Student Finance Office", tz: "Europe/London", subjectName: "Lin Yuxuan", subjectRef: "KG2601847", refLabel: "Student ID" },
};

const money = (cur: string, n: number) => `${cur} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: tz });

interface Answer {
  text: string;
  attachments?: string[];
}

export function institutionReply(store: Store, mailId: string) {
  const w = store.world;
  const original = w.mail[mailId];
  if (!original) return;
  const inst = Object.values(INSTITUTIONS).find((i) => i.email === original.to);
  if (!inst) return;
  const caseId = original.caseId;
  const student = w.cases[caseId].people.find((p) => p.role === "student");
  const enrolled = inst.kind === "university" ? inst.students?.find((s) => student && student.name.includes(s.name)) : undefined;
  const latinName = (n: string) => n.split(/\s+/).filter((x) => !/\p{Script=Han}/u.test(x)).join(" ") || n;
  const prof = inst.kind === "university" ? { ...PROFILES[inst.id], subjectName: latinName(student?.name ?? ""), subjectRef: enrolled?.id ?? "" } : PROFILES[inst.id];
  const invoices = () => Object.values(store.world.invoices).filter((i) => i.caseId === caseId);

  const intents = new Set(detectIntents(`${original.subject}\n${original.body}`));
  if (inst.kind === "university" && !enrolled) {
    // the admissions office looks the student up first: no applicant means no fees, whatever was asked
    intents.add("admission");
    for (const other of ["estimate", "statement", "bank_details", "payment_status", "refund", "dispute"] as const) intents.delete(other);
  }
  // a first contact always gets the estimate / fee statement: that's what any back office sends a new case
  else if (!invoices().length) intents.add("estimate");
  // a fraud alert is answered with the real bank details
  if (intents.has("fraud_alert")) intents.add("bank_details");
  const current = currentBill(invoices());
  if ((intents.has("dispute") || intents.has("refund")) && current) {
    intents.delete("statement");
    intents.delete("payment_status");
  }

  const ctx: ReplyCtx = { store, inst, prof, caseId, invoices, enrolled };
  const answers: Answer[] = [];
  for (const [intent] of PATTERNS) {
    if (!intents.has(intent)) continue;
    const a = HANDLERS[intent](ctx);
    if (a) answers.push(a);
  }

  const body =
    answers.length === 0
      ? "Thank you for your message, which we have noted. Nothing further is needed from you at the moment."
      : answers.length === 1
        ? `Thank you for your email.\n\n${answers[0].text}`
        : `Thank you for your email. Answering each of your points:\n\n${answers.map((a, i) => `${i + 1}. ${a.text}`).join("\n\n")}`;
  const signature = inst.kind === "hospital" ? "International Patient Services\nSiam Riverside International Hospital" : "Student Finance Office\nKingsgate University";
  const subject = "Re: " + original.subject.replace(/^(re:\s*)+/i, "");
  const topics = [...intents].filter((i) => PATTERNS.some(([k]) => k === i));
  const m = sendMail(store, {
    caseId,
    direction: "inbound",
    from: inst.email,
    fromName: prof.desk,
    to: original.from,
    subject,
    body: `Dear Kinwarden team,\n\n${body}\n\nKind regards,\n${signature}`,
    attachments: answers.flatMap((a) => a.attachments ?? []),
    inReplyTo: original.id,
    topics,
  });
  store.log({
    actor: inst.kind === "hospital" ? "hospital" : "university",
    type: "mail.received",
    caseId,
    narration: `${inst.name} replied${topics.length ? ` (${topics.map((t) => TOPIC_LABEL[t]).join(", ")})` : ""}`,
    data: { mailId: m.id, inReplyTo: original.id, topics },
  });
  store.trigger({ caseId, reason: "mail_received", detail: subject });
}

const TOPIC_LABEL: Record<Intent, string> = {
  estimate: "estimate",
  bank_details: "bank details",
  fraud_alert: "fraud alert",
  payment_status: "payment status",
  cash: "cash paid at the cashier",
  dispute: "bill query",
  refund: "refund",
  statement: "statement",
  admission: "admission",
};

interface ReplyCtx {
  store: Store;
  inst: Institution;
  prof: Profile;
  caseId: string;
  invoices: () => Invoice[];
  enrolled?: { id: string; name: string; programme: string; start: string };
}

function currentBill(invs: Invoice[]) {
  return invs.find((i) => (i.kind === "corrected_final" || i.kind === "final") && i.status !== "superseded");
}

function received(ctx: ReplyCtx) {
  return Object.values(ctx.store.world.payments).filter((p) => p.caseId === ctx.caseId && p.institutionId === ctx.inst.id && p.status === "completed");
}

function inFlight(ctx: ReplyCtx) {
  return Object.values(ctx.store.world.payments).filter((p) => p.caseId === ctx.caseId && p.institutionId === ctx.inst.id && (p.status === "submitted" || p.status === "processing"));
}

function bankLetterSent(ctx: ReplyCtx) {
  return Object.values(ctx.store.world.docs).find((d) => d.caseId === ctx.caseId && d.kind === "bank_letter" && d.origin === "institution");
}

/** When the hospital expects to discharge the patient: the scenario's discharge beat, if any. */
function expectedDischarge(ctx: ReplyCtx) {
  return ctx.store.world.schedule.find((s) => s.kind === "beat" && String((s.payload as { beat?: string }).beat).endsWith(".discharge"))?.at;
}

const HANDLERS: Record<Intent, (c: ReplyCtx) => Answer | null> = {
  estimate: (c) => {
    const cur = c.inst.bank.currency;
    const existing = c.invoices().find((i) => i.kind === "deposit_request" || i.kind === "estimate" || i.kind === "fee_statement");
    if (existing) {
      const paid = received(c).filter((p) => p.invoiceId === existing.id).reduce((s, p) => s + p.amount, 0);
      return {
        text: `Our ${existing.kind === "fee_statement" ? "fee statement" : "estimate"} ${existing.number} of ${day(existing.issuedAt, c.prof.tz)} is still current (${money(cur, existing.total)}${existing.amountDue !== existing.total ? `, of which ${money(cur, existing.amountDue)} was requested in advance` : ""}). ${paid >= existing.amountDue - 0.01 ? "That amount has been received in full." : existing.dueAt ? `It is due by ${day(existing.dueAt, c.prof.tz)}.` : ""}`.trim(),
      };
    }
    if (c.inst.id === "srh") {
      const inv = issueInvoice(c.store, {
        caseId: c.caseId,
        institutionId: "srh",
        kind: "deposit_request",
        title: "Treatment estimate and deposit request",
        patientName: c.prof.subjectName,
        patientRef: "HN 66-014382",
        lineItems: [
          { description: "Diagnostic coronary angiogram", amount: 68000 },
          { description: "Possible PCI with stent (if required)", amount: 230000 },
          { description: "Room and nursing, est. 5 nights", amount: 72000 },
          { description: "Medication, labs and physician fees (est.)", amount: 50000 },
        ],
        amountDue: 250000,
        dueInHours: 70,
        extraText:
          "This is an estimate. A deposit of THB 250,000.00 is required before the angiogram and possible intervention, at the latest by the morning of 5 November. Final charges may differ.",
      });
      return {
        text: `Please find attached the treatment estimate of ${money("THB", inv.total)} and our deposit request of ${money("THB", inv.amountDue)}, due by ${day(inv.dueAt!, c.prof.tz)}. Our bank details are on the document. For international transfers please allow 2 working days.`,
        attachments: [inv.documentId],
      };
    }
    const admission = addDoc(c.store, {
      caseId: c.caseId,
      kind: "admission_letter",
      title: "Offer of admission: MSc Data Science",
      text: "KINGSGATE UNIVERSITY: UNCONDITIONAL OFFER OF ADMISSION\nStudent: Lin Yuxuan   Student ID: KG2601847\nProgramme: MSc Data Science (full-time, 12 months)\nStart date: 18 January 2027\nThis letter confirms your place on the programme.",
      fields: { studentId: "KG2601847", programme: "MSc Data Science" },
      origin: "institution",
    });
    const inv = issueInvoice(c.store, {
      caseId: c.caseId,
      institutionId: "kgu",
      kind: "fee_statement",
      title: "Fee statement",
      patientName: "Lin Yuxuan",
      patientRef: "KG2601847",
      lineItems: [
        { description: "Tuition fee 2026/27, instalment 1 of 2", amount: 14875 },
        { description: "University accommodation, Jan-Jun 2027", amount: 9800 },
      ],
      dueInHours: 18 * 24,
      extraText: "Please quote your Student ID as the payment reference.",
    });
    return {
      text: `Please find attached the fee statement (${money("GBP", inv.total)}) and a copy of the offer letter. Payment is due by ${day(inv.dueAt!, c.prof.tz)}. Please quote the Student ID KG2601847 as the payment reference. Card payments via our portal carry a 2.5% surcharge.`,
      attachments: [admission.id, inv.documentId],
    };
  },

  bank_details: (c) => {
    const b = c.inst.bank;
    const sent = bankLetterSent(c);
    if (sent) {
      return {
        text: `Our bank details have not changed. The only account for ${c.inst.kind === "hospital" ? "patient" : "fee"} payments is the one in our confirmation letter of ${day(sent.createdAt, c.prof.tz)}: ${b.bankName}, account name ${b.accountName}, account ${b.accountNumber}, SWIFT ${b.swift}.`,
      };
    }
    const doc = addDoc(c.store, {
      caseId: c.caseId,
      kind: "bank_letter",
      title: c.inst.kind === "hospital" ? "Bank account confirmation letter" : "University bank details confirmation",
      text: `To whom it may concern,\n\nWe confirm that ${c.inst.legalName} (trading as ${c.inst.name}) holds the following account for receiving ${c.inst.kind === "hospital" ? "international patient payments" : "student fees"}:\n  Bank: ${b.bankName}\n  Account name: ${b.accountName}\n  ${c.inst.kind === "hospital" ? "Account number" : "IBAN"}: ${b.accountNumber}\n  SWIFT: ${b.swift}\nPayments must quote the ${c.inst.referenceRule?.label ?? "reference"} in the payment reference. We never change our bank details by email.\n\nFinance Department`,
      fields: { accountName: b.accountName, accountNumber: b.accountNumber, swift: b.swift },
      origin: "institution",
    });
    return {
      text: `Our signed bank confirmation letter is attached. Please always quote the ${c.inst.referenceRule?.label ?? "reference"} in the payment reference.`,
      attachments: [doc.id],
    };
  },

  fraud_alert: (c) => ({
    text: `Thank you for alerting us. That message did not come from us: our only address for ${c.inst.kind === "hospital" ? "patient" : "student"} payment matters is ${c.inst.email}, and we never change bank details by email. Please do not pay any other account. We have reported the message to our IT security team.`,
  }),

  payment_status: (c) => {
    const cur = c.inst.bank.currency;
    const got = received(c);
    const coming = inFlight(c);
    const parts: string[] = [];
    if (got.length) parts.push(`We confirm receipt of ${got.map((p) => money(cur, p.amount)).join(" and ")} (total ${money(cur, got.reduce((s, p) => s + p.amount, 0))}).`);
    if (coming.length)
      parts.push(
        `${coming.length > 1 ? "The transfers" : `The transfer of ${money(cur, coming[0].amount)}`} you mentioned ${coming.length > 1 ? "have" : "has"} not reached our account yet. International transfers usually take about 2 working days; we will email the official receipt as soon as ${coming.length > 1 ? "they arrive" : "it arrives"}, so there is no need to check with us again.`,
      );
    if (!parts.length) parts.push("We have not received any payment for this case yet.");
    return { text: parts.join(" ") };
  },

  cash: (c) =>
    c.inst.kind === "hospital"
      ? {
          text: "Cash paid at our cashier on admission (the emergency assessment and first tests) was settled at the time and is separate from the deposits and from this bill; nothing from it is owed or refundable. Receipts were issued at the cashier, and copies can be collected from the cashier desk on the ground floor at any time. There is no need to reconcile it with us by email.",
        }
      : null,

  dispute: (c) => {
    const final = currentBill(c.invoices());
    if (!final) return { text: "The final bill has not been issued yet. If anything on it looks wrong once you receive it, please let us know and we will check it." };
    const seen = new Set<string>();
    const dupes = new Set<string>();
    const kept = final.lineItems.filter((li) => {
      if (seen.has(li.description)) {
        dupes.add(li.description);
        return false;
      }
      seen.add(li.description);
      return true;
    });
    if (dupes.size === 0) return { text: `We have reviewed bill ${final.number} line by line and found no duplicate charges.` };
    const corrected = issueInvoice(c.store, {
      caseId: c.caseId,
      institutionId: c.inst.id,
      kind: "corrected_final",
      title: "Corrected final bill",
      patientName: c.prof.subjectName,
      patientRef: final.patientRef,
      lineItems: kept.map(({ description, date, amount }) => ({ description, date, amount })),
      extraText: `Correction: duplicate line removed (${[...dupes].join(", ")}). We apologise for the error.`,
    });
    c.store.mutate((w) => {
      w.invoices[final.id].status = "superseded";
      w.invoices[final.id].supersededBy = corrected.id;
    });
    return {
      text: `You are right: ${[...dupes].join(", ")} was entered twice. The corrected final bill ${corrected.number} is attached (${money(c.inst.bank.currency, corrected.total)}).`,
      attachments: [corrected.documentId],
    };
  },

  refund: (c) => {
    const cur = c.inst.bank.currency;
    const w = c.store.world;
    const exp = w.cases[c.caseId].expectedRefund;
    if (exp) {
      return {
        text: exp.receivedAt
          ? `The refund of ${money(exp.currency, exp.amount)} was completed on ${day(exp.receivedAt, c.prof.tz)}.`
          : `The refund of ${money(exp.currency, exp.amount)} was initiated on ${day(exp.requestedAt, c.prof.tz)} to the account the deposit came from. International refunds take about 3 working days, so there is no need to request it again.`,
      };
    }
    const bill = currentBill(c.invoices());
    const paid = received(c).reduce((s, p) => s + p.amount, 0);
    if (!bill) {
      const dis = expectedDischarge(c);
      return {
        text: `Any excess deposit is refunded after the final bill is settled${dis ? `, which we expect on discharge around ${day(dis, c.prof.tz)}` : ""}. It will be returned to the account it came from; there is nothing to request before then.`,
      };
    }
    const due = Math.round((paid - bill.total) * 100) / 100;
    if (due <= 0) return { text: `Our records show no refund is due: bill ${bill.number} is ${money(cur, bill.total)} and we have received ${money(cur, paid)}.` };
    c.store.mutate((w2) => {
      w2.cases[c.caseId].expectedRefund = { amount: due, currency: cur, requestedAt: w2.now };
      // deposits already cover the bill: it is settled
      w2.invoices[bill.id].status = "paid";
    });
    schedule(c.store, { at: hoursFrom(w.now, 72), kind: "refund.credit", payload: { caseId: c.caseId }, label: `${c.inst.kind === "hospital" ? "Hospital" : "University"} refund reaches the family's account` });
    return {
      text: `Bill ${bill.number} is ${money(cur, bill.total)} and we have received ${money(cur, paid)}, so we have initiated a refund of ${money(cur, due)} to the account the deposits were sent from. International refunds take about 3 working days. Bill ${bill.number} is now settled.`,
    };
  },

  statement: (c) => {
    const cur = c.inst.bank.currency;
    const paid = received(c).reduce((s, p) => s + p.amount, 0);
    const bill = currentBill(c.invoices());
    if (bill) {
      const bal = Math.round((bill.total - paid) * 100) / 100;
      return {
        text: `The ${bill.kind === "corrected_final" ? "corrected " : ""}final bill ${bill.number} of ${day(bill.issuedAt, c.prof.tz)} is ${money(cur, bill.total)}. We have received ${money(cur, paid)}, so ${bal > 0 ? `${money(cur, bal)} remains due` : bal < 0 ? `${money(cur, -bal)} is in excess of the bill` : "the account is fully settled"}.`,
      };
    }
    if (c.inst.kind === "hospital") {
      const dis = expectedDischarge(c);
      return {
        text: `${c.prof.subjectName} is still under our care, so the final itemised bill is not ready yet. We will email it on the day of discharge${dis ? `, currently expected around ${day(dis, c.prof.tz)}` : ""}. So far we have received deposits totalling ${money(cur, paid)}. Nothing further is due before discharge unless the treatment plan changes, in which case we will write to you.`,
      };
    }
    const fs = c.invoices().find((i) => i.kind === "fee_statement");
    return { text: fs ? `Fee statement ${fs.number} (${money(cur, fs.total)}) is the current statement; we have received ${money(cur, paid)} against it.` : "No fees have been invoiced yet." };
  },

  admission: (c) => {
    if (c.inst.kind !== "university") return null;
    if (c.enrolled) return { text: `We confirm that ${c.enrolled.name} (Student ID ${c.enrolled.id}) holds an unconditional offer for ${c.enrolled.programme} starting ${c.enrolled.start}.` };
    return {
      text: `We have no applicant or student named ${c.prof.subjectName || "in your message"} in our admissions records, and no offer has been issued in that name. Our offers are only sent from @kingsgate.ac.uk addresses, we never charge "guaranteed admission", "visa guarantee", scholarship processing or other such fees, and no agent, consultant or agency collects tuition on our behalf: fees are paid only to the university's own account, quoting a Kingsgate Student ID, after a genuine offer has been accepted. The letter you describe is not from us. We recommend reporting it to the police, and we have alerted our fraud team.`,
    };
  },
};
