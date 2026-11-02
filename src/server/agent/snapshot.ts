import type { World } from "@/domain/types";
import { corridorOf } from "@/domain/corridors";
import { computeUsage, findRule } from "@/domain/rules/engine";
import { ratePerUSD } from "@/domain/market";

const r0 = (n: number) => Math.round(n);

/** Compact, model-facing view of one case. Everything the agent needs to decide its next step. */
export function caseSnapshot(w: World, caseId: string) {
  const c = w.cases[caseId];
  const inst = w.institutions[c.institutionId];
  const corridor = corridorOf(c.corridor);
  const usage = computeUsage(w, caseId);
  const paymentsFor = Object.values(w.payments).filter((p) => p.caseId === caseId);
  const invoices = Object.values(w.invoices)
    .filter((i) => i.caseId === caseId)
    .map((i) => {
      const paid = paymentsFor.filter((p) => p.invoiceId === i.id && p.status === "completed").reduce((s, p) => s + p.amount, 0);
      const inFlight = paymentsFor
        .filter((p) => p.invoiceId === i.id && ["awaiting_approval", "approved", "submitted", "processing"].includes(p.status))
        .reduce((s, p) => s + p.amount, 0);
      return {
        id: i.id,
        kind: i.kind,
        number: i.number,
        currency: i.currency,
        total: i.total,
        amount_requested_now: i.amountDue,
        due_at: i.dueAt,
        status: i.status,
        paid,
        in_flight: inFlight,
        document_id: i.documentId,
        reference_on_document: i.patientRef,
      };
    });
  const caseMail = Object.values(w.mail).filter((m) => m.caseId === caseId);
  const cards = w.cards.filter((k) => c.people.some((p) => p.id === k.personId));
  return {
    now: w.now,
    case: {
      id: c.id,
      type: c.type,
      title: c.title,
      family_language: c.lang,
      status: c.status,
      corridor: `${corridor.label} (${corridor.sourceCurrency} → ${inst.bank.currency})`,
      rules_pack: corridor.packId,
      opened_at: c.openedAt,
      family_brief: c.brief,
      notes: c.notes.slice(-12),
      expected_refund: c.expectedRefund,
    },
    people: c.people.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      already_abroad: p.abroad,
      card: cards.find((k) => k.personId === p.id)?.label,
      card_spend_this_year_usd: r0(usage.cardYearUSD[p.id] ?? 0),
      fx_bought_this_year_usd: r0(usage.fxYearUSD[p.id] ?? 0),
    })),
    institution: {
      id: inst.id,
      name: inst.name,
      verified_email: inst.origin === "uploaded_bill" && !inst.verifiedAt ? undefined : inst.email || undefined,
      ...(inst.origin === "uploaded_bill"
        ? {
            source: "a bill the family uploaded",
            verified_by_bank: !!inst.verifiedAt,
            verification_note: inst.verifiedAt
              ? "The bank has verified this institution and the account on the uploaded bill. It is outside the sandbox: it does not answer Kinwarden's email automatically."
              : "Not verified yet. Read and price the bill and explain it to the family, but nothing can be paid and no email can be sent until the bank has verified it. You will be woken when that happens.",
          }
        : {}),
      accepts_cards: inst.acceptsCards,
      card_surcharge_pct: inst.cardSurchargePct ?? 0,
      payment_reference_required: inst.referenceRule?.label,
      note: "Bank details are NOT listed here on purpose: read them from the institution's documents and check them with verify_beneficiary.",
    },
    invoices,
    payments: paymentsFor.map((p) => ({
      id: p.id,
      invoice_id: p.invoiceId,
      route: p.route,
      amount: p.amount,
      currency: p.currency,
      payer_id: p.payerId,
      reference: p.reference,
      status: p.status,
      attempts: p.attempts,
      return_reason: p.returnReason,
      cost_to_family: `${p.cost.sourceCurrency} ${r0(p.cost.totalSource).toLocaleString()}`,
    })),
    pending_approvals: Object.values(w.approvals).filter((a) => a.caseId === caseId && !a.decision).map((a) => ({ id: a.id, payment_id: a.paymentId, summary: a.summary })),
    limits_used: {
      medical_bank_remittance_this_case_usd:
        c.type === "medical" && corridor.packId === "pk-sbp"
          ? { used: r0(usage.caseBankTransferUSD), cap: findRule(c.corridor, "PK.MED.REMIT.CAP")?.values?.perCaseUSD }
          : undefined,
    },
    mailbox: caseMail.slice(-14).map((m) => {
      const reply = m.direction === "outbound" ? caseMail.find((r) => r.inReplyTo === m.id) : undefined;
      return {
        id: m.id,
        direction: m.direction,
        from: m.from,
        to: m.to,
        subject: m.subject,
        at: m.at,
        unread: m.direction === "inbound" && !m.read,
        sender_verified: m.direction === "inbound" ? !m.unverifiedSender && m.from === inst.email : undefined,
        attachments: m.attachments,
        // institutions answer every question in one reply: these show what was asked and answered
        ...(m.direction === "outbound" ? { answered_by: reply?.id ?? (m.to === inst.email ? "awaiting reply" : undefined) } : {}),
        ...(m.inReplyTo ? { in_reply_to: m.inReplyTo, topics_answered: m.topics } : {}),
      };
    }),
    scheduled_followups: w.schedule
      .filter((s) => s.kind === "agent.followup" && (s.payload as { caseId?: string }).caseId === caseId)
      .map((s) => ({ id: s.id, due_at: s.at, reason: (s.payload as { reason?: string }).reason, skip_if: (s.payload as { skipIf?: string }).skipIf })),
    documents: Object.values(w.docs)
      .filter((d) => d.caseId === caseId)
      .map((d) => ({ id: d.id, kind: d.kind, title: d.title, origin: d.origin })),
    recent_family_messages: w.messages.filter((m) => m.caseId === caseId).slice(-6).map((m) => ({ from: m.from, text: m.text, at: m.at })),
    fx_sandbox_rates_per_usd: Object.fromEntries([...new Set(["PKR", "THB", "GBP", "CNY", inst.bank.currency] as const)].map((k) => [k, Math.round(ratePerUSD(k, w.now) * 1000) / 1000])),
  };
}
