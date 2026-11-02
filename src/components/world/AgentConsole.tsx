"use client";

import { AnimatePresence, motion } from "motion/react";
import { Terminal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCarry } from "@/lib/client";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, shortHash, timeOf } from "@/lib/format";

const DECISION_STYLE: Record<string, string> = {
  allowed: "text-[#6ee7a8]",
  needs_approval: "text-[#fbbf6b]",
  blocked: "text-[#ff8a80]",
  error: "text-[#fbbf6b]",
};

/** The machine's view: every tool call, policy decision and hash as it happens. */
export function AgentConsole() {
  const { state } = useCarry();
  const end = useRef<HTMLDivElement>(null);
  const n = state?.ledger.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [n]);
  if (!state) return null;
  const c = activeCase(state)!;
  const tz = caseTz(c);
  const rows = state.ledger.slice(-160);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#1f2a29] bg-[#0a1110] font-mono text-[11px] text-[#b9c8c4] shadow-pop">
      <div className="flex items-center gap-2 border-b border-[#1f2a29] px-3 py-2.5 font-sans">
        <Terminal size={14} className="text-[#39b198]" />
        <p className="flex-1 text-[13px] font-semibold text-[#e9f1ee]">Agent & safety layer</p>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", state.chain.ok ? "bg-[#12312b] text-[#5ccdb4]" : "bg-[#361816] text-[#f2827a]")}>
          {state.chain.ok ? "hash chain ✓" : "chain broken ✗"}
        </span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <AnimatePresence initial={false}>
          {rows.map((e) => {
            const decision = typeof e.data.decision === "string" ? e.data.decision : undefined;
            const isTool = e.type.startsWith("tool.");
            return (
              <motion.div key={e.seq} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="border-b border-[#141d1c] py-1.5 leading-relaxed">
                <div className="flex gap-2">
                  <span className="shrink-0 text-[#4d5f5b]">{String(e.seq).padStart(3, "0")}</span>
                  <span className="shrink-0 text-[#4d5f5b]">{timeOf(e.simAt, tz)}</span>
                  <span className={cn("shrink-0", e.actor === "agent" ? "text-[#5ccdb4]" : e.actor === "gateway" ? "text-[#ff8a80]" : e.actor === "family" ? "text-[#c4b5fd]" : "text-[#7fb3ff]")}>{e.actor}</span>
                  <span className="min-w-0 flex-1 truncate text-[#e9f1ee]">
                    {isTool ? String(e.data.tool) : e.type}
                    {decision && <span className={cn("ml-1.5", DECISION_STYLE[decision])}>[{decision}]</span>}
                  </span>
                </div>
                {e.type === "agent.thinking" && <p className="ml-9 line-clamp-3 text-[10.5px] italic text-[#7d918c]">{String(e.data.summary ?? "")}</p>}
                {e.narration && e.type !== "agent.thinking" && <p className="ml-9 truncate font-sans text-[11px] text-[#9fb2ad]">{e.narration}</p>}
                <p className="ml-9 text-[9.5px] text-[#3f504c]">{shortHash(e.hash)}</p>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={end} />
      </div>
    </div>
  );
}
