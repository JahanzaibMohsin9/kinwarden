"use client";

import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Link2, Loader2 } from "lucide-react";
import type { PublicState } from "@/server/runtime";
import { shortHash } from "@/lib/format";

/** The demo stage's view of the on-chain anchors: each milestone's head hash landing on a public chain. */
export function StageAnchors({ state }: { state: PublicState }) {
  if (!state.anchoring) return null;
  const recent = [...state.anchors].reverse().slice(0, 3);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d918c]">
        <Link2 size={12} /> Anchored on a public blockchain · {state.anchoring.chain}
      </p>
      {recent.length === 0 ? (
        <p className="mt-2 text-[12px] text-[#7d918c]">The log&apos;s head hash goes on-chain at each milestone.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          <AnimatePresence initial={false}>
            {recent.map((a) => (
              <motion.li key={a.id ?? a.at} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-[12px]">
                <span className="num font-mono text-[#5ccdb4]">#{a.seq}</span>
                <span className="num font-mono text-[#9fb2ad]">{shortHash(a.hash)}</span>
                <span className="min-w-0 flex-1 truncate text-[#c9d6d2]">{a.note}</span>
                {a.chain?.status === "confirmed" && a.chain.explorerUrl ? (
                  <a href={a.chain.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#5ccdb4] hover:underline">
                    block {a.chain.blockNumber} <ExternalLink size={11} />
                  </a>
                ) : a.chain?.status === "pending" ? (
                  <span className="inline-flex items-center gap-1 text-[#9fb2ad]">
                    <Loader2 size={11} className="animate-spin" /> sending
                  </span>
                ) : (
                  <span className="text-[#f0b44c]">{a.chain?.status === "failed" ? "not sent" : "local"}</span>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
