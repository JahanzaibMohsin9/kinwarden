"use client";

import { ExternalLink, Scale } from "lucide-react";
import { useState } from "react";
import { explainRule } from "@/domain/rules/explain";
import { useCarry } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/format";
import { Badge, Sheet } from "./ui";

const STATUS_TONE = { official: "success", reported: "info", assumed: "amber", policy: "brand" } as const;
const STATUS_LABEL = { official: "Official", reported: "Reported", assumed: "Verify", policy: "Kinwarden policy" } as const;

/** A rule ID the family can tap to see, in their language, what the rule says and where it comes from. */
export function RuleChip({ id, className }: { id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { state } = useCarry();
  const { lang } = useT();
  const ex = explainRule(id, lang, state?.world.now ?? new Date().toISOString());
  if (!ex) return <span className={cn("rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-2", className)}>{id}</span>;
  const urdu = lang === "ur";
  const status = ex.rule.status as keyof typeof STATUS_TONE;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Why? Tap to see the rule"
        className={cn("rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-2 underline decoration-dotted underline-offset-2 hover:bg-brand-softer hover:text-brand", className)}
      >
        {id}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={<span className="flex items-center gap-2"><Scale size={18} className="text-brand" /> {ex.rule.title}</span>}>
        <div className="space-y-3 pb-3" lang={lang} dir={urdu ? "rtl" : "ltr"}>
          <p className={cn("text-[15px] leading-relaxed text-ink", urdu && "urdu")}>{ex.text}</p>
          <div className="flex flex-wrap items-center gap-2" dir="ltr">
            <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>
            <span className="font-mono text-[11px] text-ink-3">{ex.rule.id}</span>
            {ex.rule.effectiveFrom && <span className="text-[11.5px] text-ink-3">in force since {ex.rule.effectiveFrom}</span>}
          </div>
          <p className={cn("text-[12.5px] text-ink-2", urdu && "urdu")}>{ex.status}</p>
          {ex.rule.source.url ? (
            <a href={ex.rule.source.url} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2 hover:text-brand" dir="ltr">
              <ExternalLink size={14} className="mt-[2px] shrink-0" />
              <span>Source: {ex.rule.source.title}</span>
            </a>
          ) : (
            <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2" dir="ltr">
              Source: {ex.rule.source.title}
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}
