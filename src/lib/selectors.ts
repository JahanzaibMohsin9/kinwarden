import type { CaseFile, FamilyMessage, Invoice, LedgerEntry, Payment, World } from "@/domain/types";
import type { PublicState } from "@/server/runtime";
import { corridorOf, DESTINATIONS } from "@/domain/corridors";
import { computeUsage, findRule, priceRoute } from "@/domain/rules/engine";
import { ratePerUSD } from "@/domain/market";
import { CASE_TZ } from "./format";

export function activeCase(s: PublicState): CaseFile | undefined {
  return Object.values(s.world.cases)[0];
}

export function caseTz(c: CaseFile) {
  const fixed = CASE_TZ[c.corridor];
  if (fixed) return fixed;
  // an uploaded bill: a patient's family is with them abroad, a student's family is at home
  const [from, to] = c.corridor.split("-");
  return c.type === "medical" ? DESTINATIONS[to]?.tz ?? "UTC" : from === "CN" ? "Asia/Shanghai" : "Asia/Karachi";
}

export function caseInvoices(w: World, caseId: string) {
  return Object.values(w.invoices).filter((i) => i.caseId === caseId);
}

export function casePayments(w: World, caseId: string) {
  return Object.values(w.payments).filter((p) => p.caseId === caseId);
}

/** The bill that currently defines what the family owes. */
export function currentBill(w: World, caseId: string): Invoice | undefined {
  const inv = caseInvoices(w, caseId);
  return (
    inv.find((i) => i.kind === "corrected_final") ??
    inv.find((i) => i.kind === "final" && i.status !== "superseded") ??
    inv.find((i) => i.kind === "fee_statement") ??
    inv.find((i) => i.kind === "deposit_request" && i.total !== i.amountDue) ??
    inv[0]
  );
}

export function moneySummary(w: World, caseId: string) {
  const bill = currentBill(w, caseId);
  const pays = casePayments(w, caseId);
  const currency = bill?.currency ?? pays[0]?.currency ?? "THB";
  const grossPaid = pays.filter((p) => p.status === "completed").reduce((s, p) => s + p.amount, 0);
  const refund = w.cases[caseId].expectedRefund;
  const refunded = refund?.receivedAt ? refund.amount : 0;
  const paid = grossPaid - refunded;
  const inFlight = pays.filter((p) => ["approved", "submitted", "processing"].includes(p.status)).reduce((s, p) => s + p.amount, 0);
  const awaiting = pays.filter((p) => p.status === "awaiting_approval").reduce((s, p) => s + p.amount, 0);
  const total = bill?.total ?? 0;
  const isFinal = bill?.kind === "final" || bill?.kind === "corrected_final" || bill?.kind === "fee_statement";
  const sourceSpent = pays.filter((p) => p.status === "completed").reduce((s, p) => s + p.cost.totalSource, 0);
  const settled = isFinal && Math.abs(paid - total) < 0.5 && inFlight === 0;
  return { bill, currency, paid, grossPaid, refunded, inFlight, awaiting, total, isFinal, settled, sourceSpent, overpaid: Math.max(0, paid - total) };
}

/** How much more the family would have paid withdrawing cash from ATMs abroad for the same payments. */
export function savingsVsCash(w: World, caseId: string) {
  const c = w.cases[caseId];
  if (!corridorOf(c.corridor).routes.includes("atm_cash")) {
    // compare against card instead where ATM cash isn't an option
    return savingsVs(w, caseId, "card_payment");
  }
  return savingsVs(w, caseId, "atm_cash");
}

function savingsVs(w: World, caseId: string, against: "atm_cash" | "card_payment") {
  const c = w.cases[caseId];
  let saved = 0;
  for (const p of casePayments(w, caseId).filter((x) => x.status === "completed")) {
    const alt = priceRoute({ corridor: c.corridor, route: against, deliverAmount: p.amount, institution: w.institutions[p.institutionId], simDate: p.createdAt });
    if (alt) saved += alt.totalSource - p.cost.totalSource;
  }
  return { saved: Math.max(0, saved), against, currency: corridorOf(c.corridor).sourceCurrency };
}

export interface AllowanceLine {
  ruleId: string;
  label: string;
  used: number;
  cap: number;
  scope: string;
}

export function allowances(w: World, caseId: string): AllowanceLine[] {
  const c = w.cases[caseId];
  const usage = computeUsage(w, caseId);
  const out: AllowanceLine[] = [];
  if (corridorOf(c.corridor).packId === "pk-sbp") {
    if (c.type === "medical") {
      out.push({ ruleId: "PK.MED.REMIT.CAP", label: "Medical remittance, this case", used: usage.caseBankTransferUSD, cap: findRule(c.corridor, "PK.MED.REMIT.CAP")!.values!.perCaseUSD, scope: "case" });
    }
    for (const p of c.people) {
      if (w.cards.some((k) => k.personId === p.id)) {
        out.push({ ruleId: "PK.CARD.ANNUAL", label: `Card abroad, ${p.name.split(" ")[0]} · this year`, used: usage.cardYearUSD[p.id] ?? 0, cap: findRule(c.corridor, "PK.CARD.ANNUAL")!.values!.adultUSD, scope: "person_year" });
      }
    }
  } else {
    for (const p of c.people.filter((x) => x.role === "parent" || x.role === "sponsor")) {
      out.push({ ruleId: "CN.FX.ANNUAL_QUOTA", label: `FX quota, ${p.name.split(" ")[0]} · 2026`, used: usage.fxYearUSD[p.id] ?? 0, cap: findRule(c.corridor, "CN.FX.ANNUAL_QUOTA")!.values!.adultUSD, scope: "person_year" });
    }
  }
  return out;
}

export function pendingApprovals(w: World, caseId?: string) {
  return Object.values(w.approvals).filter((a) => !a.decision && (!caseId || a.caseId === caseId));
}

// ---------------------------------------------------------------------------
// Activity feed

export type FeedItem =
  | { kind: "action"; entry: LedgerEntry; thinking?: string }
  | { kind: "blocked"; entry: LedgerEntry }
  | { kind: "event"; entry: LedgerEntry }
  | { kind: "message"; entry: LedgerEntry; message: FamilyMessage }
  | { kind: "approval"; entry: LedgerEntry }
  | { kind: "error"; entry: LedgerEntry }
  | { kind: "summary"; entry: LedgerEntry };

const EVENT_TYPES = new Set(["mail.received", "payment.submitted", "payment.completed", "payment.returned", "refund.received", "case.opened", "agent.stopped", "agent.resumed", "mcp.connected"]);

export function feed(s: PublicState, caseId: string): FeedItem[] {
  const msgs = new Map(s.world.messages.map((m) => [m.id, m]));
  const items: FeedItem[] = [];
  let pendingThinking: string | undefined;
  for (const e of s.ledger) {
    if (e.caseId && e.caseId !== caseId) continue;
    if (e.type === "agent.thinking") {
      pendingThinking = String((e.data as { summary?: string }).summary ?? "");
      continue;
    }
    if (e.type === "family.message" || e.type === "agent.answer") {
      const m = msgs.get(String(e.data.messageId));
      if (m) items.push({ kind: "message", entry: e, message: m });
      continue;
    }
    if (e.type === "tool.message_family") {
      const id = (e.data.result as { message_id?: string } | undefined)?.message_id;
      const m = id ? msgs.get(id) : undefined;
      if (m) items.push({ kind: "message", entry: e, message: m });
      continue;
    }
    if (e.type.startsWith("approval.")) {
      items.push({ kind: "approval", entry: e });
      continue;
    }
    if (e.type === "agent.error") {
      items.push({ kind: "error", entry: e });
      continue;
    }
    if (e.type === "agent.summary") continue;
    if (e.type.startsWith("tool.") && e.data.decision === "blocked") {
      items.push({ kind: "blocked", entry: e });
      continue;
    }
    if (e.type.startsWith("tool.") && e.narration) {
      items.push({ kind: "action", entry: e, thinking: pendingThinking });
      pendingThinking = undefined;
      continue;
    }
    if (EVENT_TYPES.has(e.type) && e.narration) {
      if (e.type === "case.opened") continue;
      items.push({ kind: "event", entry: e });
    }
  }
  return items;
}

export function threatCount(w: World) {
  return w.security.filter((x) => x.severity !== "info").length;
}

export function usd(amount: number, cur: Payment["currency"], at: string) {
  return amount / ratePerUSD(cur, at);
}
