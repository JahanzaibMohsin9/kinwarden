"use client";

import { ArrowRight, CircleCheck, CornerUpLeft, CreditCard, Landmark, Timer } from "lucide-react";
import { useCarry } from "@/lib/client";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dateTime, money } from "@/lib/format";
import { corridorOf } from "@/domain/corridors";

/** The payment rails: SWIFT tracker for transfers and the card network for card payments. */
export function BankConsole() {
  const { state } = useCarry();
  if (!state) return null;
  const c = activeCase(state)!;
  const tz = caseTz(c);
  const corridor = corridorOf(c.corridor);
  const pays = Object.values(state.world.payments)
    .filter((p) => p.caseId === c.id && p.status !== "awaiting_approval" && p.status !== "cancelled")
    .reverse();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#2a3441] bg-[#111820] text-[#d7e0ea] shadow-pop">
      <div className="flex items-center gap-2 border-b border-[#2a3441] px-4 py-2.5">
        <Landmark size={15} className="text-[#7fb3ff]" />
        <p className="flex-1 text-[13px] font-semibold">Payment rails · SWIFT gpi & card network</p>
        <a href="/bank/officer" className="text-[11px] font-semibold text-[#7fb3ff] hover:underline">Officer view</a>
        <span className="font-mono text-[10px] text-[#8193a8]">sandbox</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {pays.length === 0 && <p className="px-1 py-3 text-[12px] text-[#8193a8]">No payments on the rails yet.</p>}
        {pays.map((p) => {
          const returned = p.statusHistory.some((h) => h.status === "returned");
          const stages =
            p.route === "bank_transfer"
              ? [
                  { label: `${corridor.fromCity.name} bank`, done: true },
                  { label: "Correspondent", done: ["processing", "completed", "returned"].includes(p.status) },
                  { label: p.beneficiary.bankName, done: p.status === "completed" },
                ]
              : [
                  { label: "Card issuer", done: true },
                  { label: "Card network", done: true },
                  { label: "Hospital cashier", done: p.status === "completed" },
                ];
          return (
            <div key={p.id} className="rounded-xl border border-[#2a3441] bg-[#16202b] p-3">
              <div className="flex items-center gap-2">
                {p.route === "bank_transfer" ? <Landmark size={14} className="text-[#7fb3ff]" /> : <CreditCard size={14} className="text-[#7fb3ff]" />}
                <span className="num text-[14px] font-semibold text-white">{money(p.amount, p.currency)}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold">
                  {p.status === "completed" ? (
                    <span className="inline-flex items-center gap-1 text-[#6ee7a8]">
                      <CircleCheck size={12} /> Credited
                    </span>
                  ) : p.status === "returned" ? (
                    <span className="inline-flex items-center gap-1 text-[#fbbf6b]">
                      <CornerUpLeft size={12} /> Returned
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#7fb3ff]">
                      <Timer size={12} /> In transit
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                {stages.map((s, i) => (
                  <div key={s.label} className="flex min-w-0 flex-1 items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <div className={cn("h-1 rounded-full", s.done ? "bg-[#7fb3ff]" : "bg-[#2a3441]")} />
                      <p className="mt-1 truncate text-[10px] text-[#8193a8]">{s.label}</p>
                    </div>
                    {i < stages.length - 1 && <ArrowRight size={10} className="mb-3 shrink-0 text-[#4b5b6e]" />}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 truncate font-mono text-[10px] text-[#8193a8]">
                :70: {p.reference} · :59: {p.beneficiary.accountName}
              </p>
              {returned && (
                <p className="mt-1 text-[10.5px] text-[#fbbf6b]">
                  {p.statusHistory.find((h) => h.status === "returned")?.note}
                  {p.status !== "returned" && ` → resent (attempt ${p.attempts})`}
                </p>
              )}
              <p className="mt-1 text-[10px] text-[#64748b]">{dateTime(p.statusHistory.at(-1)!.at, tz)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
