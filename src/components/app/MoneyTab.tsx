"use client";

import { Check, CircleDashed, CornerUpLeft, CreditCard, Landmark, Receipt, X } from "lucide-react";
import { useCarry } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { activeCase, caseInvoices, casePayments, caseTz } from "@/lib/selectors";
import { cn, dateTime, money } from "@/lib/format";
import { ROUTE_SHORT } from "@/domain/corridors";
import type { Invoice, Payment, PaymentStatus } from "@/domain/types";
import { Badge, Card, Empty, SectionTitle } from "../ui";
import { CurrencyCard } from "./CurrencyCard";
import { NearCaseCard } from "./NearCaseCard";

const INV_LABEL: Record<Invoice["kind"], string> = {
  estimate: "Estimate",
  deposit_request: "Deposit request",
  interim: "Interim bill",
  final: "Final bill",
  corrected_final: "Corrected final bill",
  fee_statement: "Fee statement",
};

export function MoneyTab() {
  const { state } = useCarry();
  const { t } = useT();
  if (!state) return null;
  const c = activeCase(state)!;
  const w = state.world;
  const tz = caseTz(c);
  const invoices = caseInvoices(w, c.id).reverse();
  const payments = casePayments(w, c.id).reverse();

  return (
    <div className="space-y-6 px-4 pb-10 pt-4">
      <CurrencyCard w={w} c={c} payments={payments} />
      {state.near?.cases[c.id] && <NearCaseCard caseId={c.id} />}
      <section>
        <SectionTitle>
          <span>{t("payments")}</span>
        </SectionTitle>
        {payments.length === 0 ? (
          <Card>
            <Empty icon={<Landmark size={20} />} title={t("noPayments")} />
          </Card>
        ) : (
          <div className="space-y-3">
            {payments.map((p) => (
              <PaymentCard key={p.id} p={p} tz={tz} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>
          <span>{t("invoices")}</span>
        </SectionTitle>
        <div className="space-y-3">
          {invoices.length === 0 && (
            <Card>
              <Empty icon={<Receipt size={20} />} title="No bills yet" hint="Kinwarden has asked the institution for them." />
            </Card>
          )}
          {invoices.map((inv) => (
            <InvoiceCard key={inv.id} inv={inv} tz={tz} />
          ))}
        </div>
      </section>
    </div>
  );
}

const STEPS: { status: PaymentStatus[]; label: string }[] = [
  { status: ["awaiting_approval"], label: "Your approval" },
  { status: ["approved", "submitted"], label: "Sent" },
  { status: ["processing"], label: "On the way" },
  { status: ["completed"], label: "Received" },
];

function PaymentCard({ p, tz }: { p: Payment; tz: string }) {
  const order = ["awaiting_approval", "approved", "submitted", "processing", "completed"];
  const idx = order.indexOf(p.status);
  const terminalBad = p.status === "cancelled" || p.status === "rejected";
  const Icon = p.route === "bank_transfer" ? Landmark : CreditCard;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="num text-[17px] font-bold">{money(p.amount, p.currency)}</p>
            <StatusBadge status={p.status} attempts={p.attempts} />
          </div>
          <p className="text-[12.5px] text-ink-3">
            {ROUTE_SHORT[p.route]} · cost to you <span className="num font-semibold text-ink-2">{money(p.cost.totalSource, p.cost.sourceCurrency)}</span>
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3">Ref {p.reference}</p>
        </div>
      </div>
      {!terminalBad && (
        <ol className="mt-3 grid grid-cols-4 gap-1" aria-label="Payment progress">
          {STEPS.map((s, i) => {
            const stepIdx = order.indexOf(s.status[s.status.length - 1]);
            const doneStep = idx >= stepIdx || p.status === "completed";
            const current = s.status.includes(p.status);
            return (
              <li key={s.label} className="flex flex-col gap-1">
                <span className={cn("h-1.5 rounded-full", doneStep ? "bg-brand" : current ? "bg-brand/50" : "bg-brand-track")} />
                <span className={cn("text-[10.5px] font-medium", doneStep || current ? "text-ink-2" : "text-ink-3")}>{s.label}</span>
                {i === 0 && null}
              </li>
            );
          })}
        </ol>
      )}
      {p.statusHistory.some((h) => h.status === "returned") && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-soft px-3 py-2 text-[12px] text-amber-strong">
          <CornerUpLeft size={14} className="mt-0.5 shrink-0" />
          <span>
            Returned once: {p.statusHistory.find((h) => h.status === "returned")?.note?.replace(/^Returned by beneficiary bank: /, "")}
            {p.status !== "returned" && " Fixed and re-sent by Kinwarden."}
          </span>
        </div>
      )}
      <details className="mt-2 text-[12px] text-ink-3">
        <summary className="cursor-pointer select-none font-semibold">Timeline</summary>
        <ul className="mt-1.5 space-y-1">
          {p.statusHistory.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="num w-28 shrink-0">{dateTime(h.at, tz)}</span>
              <span className="text-ink-2">{h.note ?? h.status}</span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function StatusBadge({ status, attempts }: { status: PaymentStatus; attempts: number }) {
  const map: Record<PaymentStatus, { tone: "brand" | "amber" | "success" | "danger" | "neutral"; label: string; icon: React.ReactNode }> = {
    awaiting_approval: { tone: "amber", label: "Needs you", icon: <CircleDashed size={11} /> },
    approved: { tone: "brand", label: "Approved", icon: <Check size={11} /> },
    submitted: { tone: "brand", label: "Sent", icon: <CircleDashed size={11} /> },
    processing: { tone: "brand", label: attempts > 1 ? "Re-sent" : "On the way", icon: <CircleDashed size={11} /> },
    completed: { tone: "success", label: "Received", icon: <Check size={11} /> },
    returned: { tone: "amber", label: "Returned", icon: <CornerUpLeft size={11} /> },
    rejected: { tone: "danger", label: "Rejected", icon: <X size={11} /> },
    cancelled: { tone: "neutral", label: "Declined", icon: <X size={11} /> },
  };
  const m = map[status];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  );
}

function InvoiceCard({ inv, tz }: { inv: Invoice; tz: string }) {
  const seen = new Set<string>();
  const dupIds = new Set<string>();
  for (const li of inv.lineItems) {
    const k = `${li.description}|${li.amount}`;
    if (seen.has(k)) dupIds.add(li.id);
    seen.add(k);
  }
  const superseded = inv.status === "superseded";
  return (
    <Card className={cn("overflow-hidden p-0", superseded && "opacity-70")}>
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div>
          <p className="text-[14px] font-semibold">{INV_LABEL[inv.kind]}</p>
          <p className="font-mono text-[11px] text-ink-3">
            {inv.number} · {dateTime(inv.issuedAt, tz)}
          </p>
        </div>
        <Badge tone={inv.status === "paid" ? "success" : superseded ? "neutral" : inv.status === "disputed" ? "amber" : "info"}>
          {inv.status === "open" ? "Open" : inv.status === "paid" ? "Paid" : superseded ? "Replaced" : "Disputed"}
        </Badge>
      </div>
      <ul className="mt-2 divide-y divide-line/70 border-t border-line text-[12.5px]">
        {inv.lineItems.map((li) => {
          const dup = dupIds.has(li.id);
          return (
            <li key={li.id} className={cn("flex items-baseline gap-2 px-4 py-1.5", dup && "bg-danger-soft")}>
              <span className={cn("flex-1 text-ink-2", dup && "text-danger line-through decoration-2")}>{li.description}</span>
              {dup && <Badge tone="danger">Duplicate</Badge>}
              <span className={cn("num shrink-0", dup ? "text-danger line-through" : "text-ink")}>{money(li.amount, inv.currency)}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between border-t border-line bg-surface-2 px-4 py-2.5 text-[13px]">
        <span className="font-semibold">{inv.amountDue !== inv.total ? "Requested now" : "Total"}</span>
        <span className="num text-[15px] font-bold">{money(inv.amountDue, inv.currency)}</span>
      </div>
      {inv.dueAt && inv.status === "open" && <p className="px-4 pb-2.5 text-[11.5px] text-ink-3">Due {dateTime(inv.dueAt, tz)}</p>}
    </Card>
  );
}
