"use client";

import { Inbox, Mail, Paperclip, Reply, Send } from "lucide-react";
import { useState } from "react";
import { useCarry } from "@/lib/client";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dateTime, money } from "@/lib/format";

/** The institution's side: what the hospital / university billing desk sees. Deliberately styled as a different product. */
export function HospitalDesk({ compact = false }: { compact?: boolean }) {
  const { state } = useCarry();
  const [pick, setPick] = useState<{ id: string; latest?: string } | null>(null);
  const c = state ? activeCase(state) : undefined;
  const mails = state && c ? Object.values(state.world.mail).filter((m) => m.caseId === c.id && (m.to === state.world.institutions[c.institutionId].email || m.from === state.world.institutions[c.institutionId].email)) : [];
  const latestId = mails.at(-1)?.id;
  // follow new mail automatically unless the user picked one since it arrived
  const selected = pick && pick.latest === latestId ? pick.id : latestId;
  const setSelected = (id: string) => setPick({ id, latest: latestId });
  if (!state || !c) return null;
  const inst = state.world.institutions[c.institutionId];
  const tz = caseTz(c);
  const open = selected ? state.world.mail[selected] : undefined;
  const received = Object.values(state.world.payments).filter((p) => p.caseId === c.id && p.status === "completed");
  const isHospital = inst.kind === "hospital";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#d5dbe3] bg-[#f6f8fb] font-sans text-[#1d2939] shadow-pop" data-theme="light">
      <div className="flex items-center gap-2 bg-[#1f3a5f] px-4 py-2.5 text-white">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-white/15 text-[11px] font-bold">{isHospital ? "SRH" : "KGU"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{isHospital ? "Siam Riverside · Patient Billing" : "Kingsgate · Student Finance"}</p>
          <p className="truncate text-[10.5px] text-white/70">{inst.email}</p>
        </div>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", state.world.autoReply ? "bg-emerald-400/25 text-emerald-100" : "bg-white/15")}>{state.world.autoReply ? "Auto-reply on" : "Manual"}</span>
      </div>
      <div className={cn("grid min-h-0 flex-1", compact ? "grid-rows-[minmax(0,40%)_minmax(0,60%)]" : "grid-cols-[230px_1fr]")}>
        <ul className={cn("scroll-thin min-h-0 overflow-y-auto bg-white", compact ? "border-b border-[#e3e8ef]" : "border-r border-[#e3e8ef]")}>
          {mails.length === 0 && (
            <li className="flex items-center gap-2 px-3 py-4 text-[12px] text-[#667085]">
              <Inbox size={14} /> No messages yet
            </li>
          )}
          {[...mails].reverse().map((m) => {
            const incoming = m.direction === "outbound"; // from Kinwarden = incoming for the institution
            return (
              <li key={m.id}>
                <button onClick={() => setSelected(m.id)} className={cn("w-full border-l-2 px-3 py-2 text-left", selected === m.id ? "border-[#1f3a5f] bg-[#eef3fa]" : "border-transparent hover:bg-[#f6f8fb]")}>
                  <p className="flex items-center gap-1 text-[11px] text-[#667085]">
                    {incoming ? <Mail size={11} /> : <Reply size={11} />}
                    {incoming ? "Kinwarden (for family)" : "You replied"}
                    <span className="ml-auto">{dateTime(m.at, tz).split(", ").pop()}</span>
                  </p>
                  <p className={cn("truncate text-[12px]", incoming && !m.read ? "font-bold" : "font-medium")}>{m.subject}</p>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="scroll-thin min-h-0 overflow-y-auto p-4">
          {open ? (
            <article>
              <h3 className="text-[14px] font-semibold leading-snug">{open.subject}</h3>
              <p className="mt-1 text-[11px] text-[#667085]">
                {open.direction === "outbound" ? `From cases@kinwarden.app` : `From ${inst.email}`} · {dateTime(open.at, tz)}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#344054]">{open.body}</p>
              {open.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {open.attachments.map((d) => (
                    <span key={d} className="inline-flex items-center gap-1 rounded border border-[#d5dbe3] bg-white px-2 py-1 text-[11px]">
                      <Paperclip size={11} /> {state.world.docs[d]?.title ?? d}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ) : (
            <p className="text-[12px] text-[#667085]">Select a message</p>
          )}
        </div>
      </div>
      {received.length > 0 && (
        <div className="border-t border-[#e3e8ef] bg-white px-4 py-2 text-[11.5px]">
          <span className="font-semibold text-[#027a48]">Received: </span>
          {received.map((p) => money(p.amount, p.currency)).join(" · ")}
        </div>
      )}
      {!compact && (
        <div className="flex items-center gap-2 border-t border-[#e3e8ef] bg-white px-4 py-2 text-[11px] text-[#667085]">
          <Send size={12} /> Replies are sent by the sandbox auto-responder about 90 simulated minutes after each email.
        </div>
      )}
    </div>
  );
}
