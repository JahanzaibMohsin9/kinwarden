"use client";

import { Printer, ShieldCheck, ShieldX } from "lucide-react";
import { useCarry } from "@/lib/client";
import { activeCase, caseTz } from "@/lib/selectors";
import { dateTime, money, shortHash } from "@/lib/format";
import { corridorOf, ROUTE_SHORT } from "@/domain/corridors";
import type { Doc } from "@/domain/types";

// One printable pack per case: everything a family needs for an insurance claim,
// a tax record or a bank's questions, plus the evidence that the log is intact.
// "Save as PDF" is the browser's own print dialog.

const KIND_ORDER: Doc["kind"][] = ["invoice", "receipt", "bank_letter", "admission_letter", "remittance_application", "self_declaration", "fx_purchase_application", "other"];

export function CasePack() {
  const { state } = useCarry();
  if (!state) return <p className="p-6 text-[13px] text-ink-3">Loading…</p>;
  const w = state.world;
  const c = activeCase(state)!;
  const tz = caseTz(c);
  const inst = w.institutions[c.institutionId];
  const payments = Object.values(w.payments).filter((p) => p.caseId === c.id && p.status !== "cancelled");
  const docs = Object.values(w.docs)
    .filter((d) => d.caseId === c.id)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.createdAt.localeCompare(b.createdAt));
  const trusted = docs.filter((d) => d.origin !== "unknown");
  const flagged = docs.filter((d) => d.origin === "unknown");
  const approvals = state.ledger.filter((e) => e.type === "approval.approved");
  const src = payments[0]?.cost.sourceCurrency;
  const done = payments.filter((p) => p.status === "completed");

  return (
    <div className="mx-auto max-w-3xl space-y-6 bg-white px-5 py-6 text-[13px] text-[#16302b] print:max-w-none print:px-0 print:py-0">
      <div className="flex items-start justify-between gap-4 border-b border-[#d9d2c3] pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5b6f6a]">Kinwarden case pack · sandbox</p>
          <h1 className="text-[22px] font-bold leading-tight">{c.title}</h1>
          <p className="text-[#5b6f6a]">
            {corridorOf(c.corridor).label} · {inst.name} · opened {dateTime(c.openedAt, tz)}
          </p>
          <p className="text-[#5b6f6a]">{c.people.map((p) => `${p.name} (${p.role})`).join(" · ")}</p>
        </div>
        <button onClick={() => window.print()} className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#16302b] px-4 py-2 text-[13px] font-semibold text-white print:hidden">
          <Printer size={15} /> Save as PDF
        </button>
      </div>

      <section>
        <h2 className="mb-2 text-[15px] font-bold">Payments</h2>
        {payments.length === 0 ? (
          <p className="text-[#5b6f6a]">No payments yet.</p>
        ) : (
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#d9d2c3] text-[#5b6f6a]">
                <th className="py-1.5 pr-2 font-semibold">Date</th>
                <th className="py-1.5 pr-2 font-semibold">Route</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Delivered</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Cost to family</th>
                <th className="py-1.5 pr-2 font-semibold">Reference</th>
                <th className="py-1.5 font-semibold">Approval</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const ap = approvals.find((e) => e.data.paymentId === p.id);
                return (
                  <tr key={p.id} className="border-b border-[#eee7d8] align-top">
                    <td className="py-1.5 pr-2">{dateTime(p.completedAt ?? p.createdAt, tz)}</td>
                    <td className="py-1.5 pr-2">{ROUTE_SHORT[p.route]}</td>
                    <td className="num py-1.5 pr-2 text-right">{money(p.amount, p.currency)}</td>
                    <td className="num py-1.5 pr-2 text-right">{money(p.cost.totalSource, p.cost.sourceCurrency)}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px]">{p.reference}</td>
                    <td className="py-1.5">{ap ? `${ap.data.method === "passkey" ? "passkey" : "hold"} · log #${ap.seq}` : p.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {src && (
          <p className="mt-2 text-[12px] text-[#5b6f6a]">
            Received by {inst.name}: {money(done.reduce((s, p) => s + p.amount, 0), payments[0].currency)} · paid from home: {money(done.reduce((s, p) => s + p.cost.totalSource, 0), src)}
            {c.expectedRefund ? ` · refund ${c.expectedRefund.receivedAt ? "received" : "pending"}: ${money(c.expectedRefund.amount, c.expectedRefund.currency)}` : ""}. Costs are sandbox prices from the Kinwarden rules engine.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-bold">Evidence</h2>
        <div className="flex items-start gap-2 rounded-xl border border-[#d9d2c3] p-3">
          {state.chain.ok ? <ShieldCheck size={18} className="shrink-0 text-[#0f766e]" /> : <ShieldX size={18} className="shrink-0 text-[#b42318]" />}
          <div>
            <p className="font-semibold">
              Activity log: {state.ledger.length} entries, hash chain {state.chain.ok ? "intact" : `broken at #${state.chain.brokenAt}`}
            </p>
            <p className="font-mono text-[11px] text-[#5b6f6a]">head {state.chain.headHash}</p>
            <p className="text-[12px] text-[#5b6f6a]">
              Each entry is SHA-256 hashed together with the previous entry&apos;s hash. The full log is at /api/ledger; anchors published: {state.anchors.length}
              {state.anchors.length ? ` (latest ${shortHash(state.anchors.at(-1)!.hash)})` : ""}.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-bold">Documents ({trusted.length})</h2>
        <div className="space-y-4">
          {trusted.map((d) => (
            <article key={d.id} className="break-inside-avoid rounded-xl border border-[#d9d2c3]">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#eee7d8] px-3 py-2">
                <p className="font-semibold">{d.title}</p>
                <p className="text-[11px] text-[#5b6f6a]">
                  {d.origin === "agent" ? "prepared by Kinwarden, signed by the family on approval" : `from ${inst.name}`} · {dateTime(d.createdAt, tz)}
                </p>
              </header>
              <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[10.5px] leading-relaxed">{d.text}</pre>
            </article>
          ))}
        </div>
      </section>

      {flagged.length > 0 && (
        <section>
          <h2 className="mb-2 text-[15px] font-bold">Flagged as fraud, not paid ({flagged.length})</h2>
          <ul className="list-disc space-y-1 pl-5 text-[12px]">
            {flagged.map((d) => (
              <li key={d.id}>
                {d.title}, received {dateTime(d.createdAt, tz)} from an unverified sender. Kept as evidence; Kinwarden did not act on it.
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="border-t border-[#d9d2c3] pt-3 text-[11px] text-[#5b6f6a]">
        Generated {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from the Kinwarden sandbox. Institutions, accounts and amounts are fictional.
      </p>
    </div>
  );
}
