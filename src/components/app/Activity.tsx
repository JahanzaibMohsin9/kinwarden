"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Banknote,
  BrainCircuit,
  ChevronDown,
  CreditCard,
  Eye,
  Fingerprint,
  HeartPulse,
  Landmark,
  Link2,
  Mail,
  PenLine,
  SendHorizontal,
  ShieldAlert,
  ShieldX,
  TriangleAlert,
  User,
  Mic,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { post, useCarry } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { activeCase, caseTz, feed, type FeedItem } from "@/lib/selectors";
import { cn, dayKey, dayLabel, dayNumber, shortHash, timeOf } from "@/lib/format";
import { Logo } from "../ui";
import { RuleChip } from "../RuleChip";
import { ListenButton, VoiceButton } from "./Voice";

export function ActivityFeed() {
  const { state } = useCarry();
  const { t, lang } = useT();
  const bottom = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  const items = state ? feed(state, activeCase(state)!.id) : [];

  useEffect(() => {
    if (items.length !== count.current) {
      bottom.current?.scrollIntoView({ behavior: count.current === 0 ? "auto" : "smooth", block: "end" });
      count.current = items.length;
    }
  }, [items.length]);

  if (!state) return null;
  const c = activeCase(state)!;
  const tz = caseTz(c);
  const groups: { key: string; label: string; items: FeedItem[] }[] = [];
  for (const it of items) {
    const k = dayKey(it.entry.simAt, tz);
    if (groups.at(-1)?.key !== k) groups.push({ key: k, label: `${t("day")} ${dayNumber(it.entry.simAt, c.openedAt, tz)} · ${dayLabel(it.entry.simAt, tz, lang)}`, items: [] });
    groups.at(-1)!.items.push(it);
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-5 px-4 pb-4 pt-4">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="sticky top-0 z-10 -mx-4 mb-2 bg-bg/90 px-4 py-1.5 backdrop-blur">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{g.label}</span>
            </div>
            <ul className="space-y-2.5">
              <AnimatePresence initial={false}>
                {g.items.map((it) => (
                  <motion.li key={it.entry.seq} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                    <FeedLine item={it} tz={tz} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))}
        <div ref={bottom} className="scroll-mb-24" />
      </div>
      <Composer caseId={c.id} />
    </div>
  );
}

function Composer({ caseId }: { caseId: string }) {
  const { t, lang } = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await post("/api/family", { caseId, text });
      setText("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="sticky bottom-0 border-t border-line/70 bg-bg/95 px-3 py-2.5 backdrop-blur">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("messagePlaceholder")}
          className={cn("h-11 flex-1 rounded-full border border-line bg-surface px-4 text-[14px] outline-none placeholder:text-ink-3 focus:border-brand", lang === "ur" && "urdu")}
        />
        {text.trim() ? (
          <button disabled={sending} className="grid h-11 w-11 place-items-center rounded-full bg-brand text-brand-ink disabled:opacity-40" aria-label={t("send")}>
            <SendHorizontal size={18} className={cn(lang === "ur" && "rotate-180")} />
          </button>
        ) : (
          <VoiceButton
            lang={lang}
            onText={(spoken) => post("/api/family", { caseId, text: spoken, voice: true })}
            labels={{ record: t("voiceRecord"), stop: t("voiceStop"), working: t("voiceWorking"), note: t("voiceNote") }}
          />
        )}
      </form>
    </div>
  );
}

const TIER_ICON = { read: Eye, communicate: PenLine, money: Banknote } as const;
const TIER_LABEL = { read: "Read", communicate: "Write", money: "Money" } as const;

export function FeedLine({ item, tz, compact = false }: { item: FeedItem; tz: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { t, lang } = useT();
  const e = item.entry;
  const time = <span className="num shrink-0 text-[11px] text-ink-3">{timeOf(e.simAt, tz)}</span>;

  if (item.kind === "message") {
    const m = item.message;
    const mine = m.from === "family";
    if (compact) {
      return (
        <div className="flex items-start gap-2.5">
          <Logo mark className="mt-0.5 text-[13px]" />
          <p className="line-clamp-2 flex-1 text-[13.5px] leading-snug">{m.text}</p>
          {time}
        </div>
      );
    }
    return (
      <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
        {mine ? (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-bg">
            <User size={14} />
          </span>
        ) : (
          <Logo mark className="mb-0.5 text-[14px]" />
        )}
        <div
          className={cn(
            "max-w-[82%] rounded-[20px] px-3.5 py-2.5 text-[14px] leading-relaxed",
            mine ? "rounded-br-md bg-ink text-bg" : "rounded-bl-md border bg-surface shadow-card",
            !mine && m.importance === "warning" && "border-amber/50 bg-amber-soft",
            !mine && m.importance === "good_news" && "border-success/30 bg-success-soft",
            !mine && m.importance === "action" && "border-brand/30",
            !mine && (!m.importance || m.importance === "info") && "border-line",
          )}
        >
          {!mine && m.importance === "warning" && (
            <p className="mb-1 flex items-center gap-1 text-[11.5px] font-semibold text-amber-strong">
              <ShieldAlert size={13} /> Security warning
            </p>
          )}
          {mine && m.voice && (
            <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-bg/70">
              <Mic size={11} /> {t("voiceLabel")}
            </p>
          )}
          <p className="whitespace-pre-wrap">{m.text}</p>
          <div className={cn("mt-1 flex items-center justify-end gap-1.5 text-[10.5px]", mine ? "text-bg/60" : "text-ink-3")}>
            {!mine && <ListenButton text={m.text} lang={lang} labels={{ listen: t("listen"), stop: t("stopListening") }} className="-ml-1.5 mr-auto" />}
            {timeOf(m.at, tz)}
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === "approval") {
    const approved = e.type === "approval.approved";
    return (
      <div className="flex justify-center">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold", approved ? "bg-success-soft text-success" : "bg-surface-3 text-ink-2")}>
          <Fingerprint size={13} /> {e.narration}
        </span>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div className="flex items-start gap-2 rounded-2xl bg-amber-soft px-3 py-2 text-[12.5px] text-amber-strong">
        <TriangleAlert size={14} className="mt-0.5 shrink-0" />
        <span className="flex-1">Agent paused: {String(e.data.error ?? "")}</span>
      </div>
    );
  }

  const blocked = item.kind === "blocked";
  const tier = (e.data.tier as keyof typeof TIER_ICON) ?? "read";
  const TierIcon = TIER_ICON[tier] ?? Eye;
  const ruleIds = (e.data.ruleIds as string[] | undefined)?.filter(Boolean) ?? [];
  const hasDetail = !compact && (item.kind === "action" || blocked);

  return (
    <div
      className={cn(
        "rounded-2xl",
        !compact && "border px-3 py-2.5",
        !compact && (blocked ? "border-danger/30 bg-danger-soft" : item.kind === "event" ? "border-transparent bg-surface-3/60" : "border-line bg-surface"),
      )}
    >
      <button disabled={!hasDetail} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2.5 text-left">
        <span
          className={cn(
            "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full",
            blocked ? "bg-danger text-white" : item.kind === "event" ? "bg-surface text-ink-2" : tier === "money" ? "bg-amber-soft text-amber-strong" : "bg-brand-soft text-brand",
          )}
        >
          {blocked ? <ShieldX size={14} /> : item.kind === "event" ? <EventIcon actor={e.actor} type={e.type} /> : <TierIcon size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[13.5px] leading-snug", blocked && "font-semibold text-danger", compact && "line-clamp-2")}>{e.narration}</span>
          {!compact && blocked && <span className="mt-0.5 block text-[11.5px] font-semibold text-danger/80">Blocked by the safety layer, nothing was paid</span>}
          {!compact && item.kind === "action" && (
            <span className="mt-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">
              {TIER_LABEL[tier]}
              {e.data.decision === "needs_approval" && <span className="text-amber-strong">· sent to you for approval</span>}
              {e.data.decision === "error" && <span className="text-amber-strong">· retrying</span>}
            </span>
          )}
        </span>
        {time}
        {hasDetail && <ChevronDown size={14} className={cn("mt-1 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />}
      </button>
      {open && hasDetail && (
        <div className="mt-2.5 space-y-2 border-t border-line/80 pt-2.5 text-[12px]">
          {item.kind === "action" && item.thinking && (
            <div className="rounded-xl bg-surface-2 p-2.5">
              <p className="mb-1 flex items-center gap-1 font-semibold text-ink-2">
                <BrainCircuit size={13} /> How Kinwarden reasoned
              </p>
              <p className="whitespace-pre-wrap leading-relaxed text-ink-2">{item.thinking}</p>
            </div>
          )}
          <p className="font-mono text-[11px] text-ink-3">
            {String(e.data.tool)} · {String(e.data.decision)}
          </p>
          <pre className="scroll-thin max-h-48 overflow-auto rounded-xl bg-surface-2 p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-2">{JSON.stringify(e.data.input, null, 1)}</pre>
          {ruleIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {[...new Set(ruleIds)].map((r) => (
                <RuleChip key={r} id={r} />
              ))}
            </div>
          )}
          <p className="font-mono text-[10px] text-ink-3">
            #{e.seq} · {shortHash(e.hash)} ← {shortHash(e.prevHash)}
          </p>
        </div>
      )}
    </div>
  );
}

function EventIcon({ actor, type }: { actor: string; type: string }) {
  if (type === "mail.received") return actor === "system" ? <ShieldAlert size={14} /> : <Mail size={14} />;
  if (actor === "hospital") return <HeartPulse size={14} />;
  if (actor === "card") return <CreditCard size={14} />;
  if (actor === "bank") return <Landmark size={14} />;
  if (actor === "near") return <Link2 size={14} />;
  return <Mail size={14} />;
}
