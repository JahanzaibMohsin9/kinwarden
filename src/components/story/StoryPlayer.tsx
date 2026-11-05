"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Fingerprint, Link2, Loader2, Pause, Play, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { director, post, useCarry } from "@/lib/client";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dateTime, dayNumber, money } from "@/lib/format";
import type { PublicState } from "@/server/runtime";
import { SiteNav } from "../SiteNav";
import { AgentConsole } from "../world/AgentConsole";
import { PhoneFrame } from "../world/PhoneFrame";
import { StageAnchors } from "../world/StageAnchors";
import { CHAPTER_IDS, CHAPTER_TITLES, STORY_SCENARIO, chapterOf } from "./chapters";

/** how long each chapter stays on screen before the world moves on (reading time); ?dwell=ms changes it, e.g. for recording the video */
const DEFAULT_DWELL_MS = 7000;
const dwellMs = () => {
  const v = Number(new URLSearchParams(window.location.search).get("dwell"));
  return Number.isFinite(v) && v >= 500 && v <= 60_000 ? v : DEFAULT_DWELL_MS;
};

type Phase = "ready" | "playing" | "paused" | "done";

interface Evaluation {
  metrics: { toolCalls: number; emailsToInstitution: number; wakeups: number; simDays: number };
  money: { sourceCurrency: string; destCurrency: string; savedVsCardSource: number; duplicateChargeCaught: number };
  checks: { pass: boolean }[];
}

export function StoryPlayer() {
  const { state } = useCarry();
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<Evaluation | null>(null);
  const stateRef = useRef<PublicState | null>(null);
  const since = useRef({ chapter: "", at: 0 });
  const lock = useRef(0);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const chapter = state ? chapterOf(state) : null;

  // the visitor's own world drives forward on its own; it waits for the agent, for reading time, and for the family's approval
  useEffect(() => {
    if (phase !== "playing") return;
    const t = setInterval(async () => {
      const s = stateRef.current;
      // the story waits while the visitor looks at another tab, so they don't come back to skipped chapters
      if (document.hidden || !s || Date.now() < lock.current || s.agentBusy) return;
      const ch = chapterOf(s);
      // a new chapter starts its reading time
      if (since.current.chapter !== ch.id) {
        since.current = { chapter: ch.id, at: Date.now() };
        return;
      }
      if (ch.yourTurn) return;
      if (Date.now() - since.current.at < dwellMs()) return;
      if (s.nextEvent) {
        lock.current = Date.now() + 2500;
        await director("next");
        return;
      }
      setPhase("done");
      try {
        setResult((await fetch("/api/eval").then((r) => r.json())) as Evaluation);
      } catch {}
    }, 600);
    return () => clearInterval(t);
  }, [phase]);

  const start = async () => {
    setResult(null);
    lock.current = Date.now() + 3000;
    await director("reset", { scenarioId: STORY_SCENARIO, mode: "replay" });
    since.current = { chapter: "", at: Date.now() };
    setPhase("playing");
  };

  const approveForMe = async () => {
    const s = stateRef.current;
    const a = s && Object.values(s.world.approvals).find((x) => !x.decision);
    if (!s || !a) return;
    await post(`/api/approvals/${a.id}`, { decision: "approved", method: "hold", as: s.world.payments[a.paymentId].payerId });
  };

  const c = state ? activeCase(state) : undefined;
  const inStory = state?.world.scenarioId === STORY_SCENARIO && phase !== "ready";
  const tz = c ? caseTz(c) : "UTC";

  return (
    <div className="relative flex min-h-dvh flex-col bg-[#08100f] text-[#e9f1ee] lg:h-dvh">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(#5ccdb4 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
      <SiteNav tone="dark" />

      <div className="relative z-10 mx-auto grid w-full max-w-[1500px] min-h-0 flex-1 grid-cols-1 gap-5 px-4 pb-5 lg:grid-cols-[minmax(320px,400px)_auto_minmax(300px,1fr)] lg:px-6">
        {/* the story */}
        <section aria-label="Story" className="flex min-h-0 flex-col gap-4">
          <ol className="flex gap-1" aria-label="Chapters">
            {CHAPTER_IDS.slice(1).map((id, i) => (
              <li key={id} title={CHAPTER_TITLES[id]} className={cn("h-1.5 flex-1 rounded-full transition-colors", inStory && chapter && chapter.index > i ? "bg-[#5ccdb4]" : "bg-white/12")} />
            ))}
          </ol>

          <AnimatePresence mode="wait">
            {!inStory || !chapter ? (
              <motion.div key="intro" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#5ccdb4]">A real case · about 4 minutes</p>
                <h1 className="text-[32px] font-bold leading-[1.1] tracking-tight">{CHAPTER_TITLES.intro}</h1>
                <p className="text-[15px] leading-relaxed text-[#c9d6d2]">
                  Daniel, 62, is in a Bangkok hospital with chest pain. His daughter Sara is with him. They brought USD 10,000 in cash and it is almost gone. Pakistan&apos;s rules allow up to USD 50,000 to be sent straight to the hospital, but nobody told them.
                </p>
                <p className="text-[13.5px] leading-relaxed text-[#9fb2ad]">
                  Watch Kinwarden&apos;s AI agent handle the whole case. This replays a recorded run of the real agent: every email, check and payment happens for real in your own private sandbox. No real money moves.
                </p>
                <button onClick={start} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#5ccdb4] px-6 text-[15px] font-semibold text-[#04211b] hover:bg-[#7ad9c4]">
                  <Play size={18} /> Play the story
                </button>
              </motion.div>
            ) : (
              <motion.div key={chapter.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-3" aria-live="polite">
                <p className="num text-[12px] font-semibold uppercase tracking-[0.1em] text-[#5ccdb4]">
                  {chapter.index} of {CHAPTER_IDS.length - 1}
                  {c && ` · Day ${dayNumber(state!.world.now, c.openedAt, tz)}, ${dateTime(state!.world.now, tz)} in Bangkok`}
                </p>
                <h2 className="text-[28px] font-bold leading-[1.15] tracking-tight">{chapter.title}</h2>
                <p className="text-[15px] leading-relaxed text-[#c9d6d2]">{chapter.body}</p>
                {chapter.yourTurn && (
                  <div className="space-y-2 rounded-2xl border border-[#f0b44c]/40 bg-[#f0b44c]/10 p-3.5">
                    <p className="flex items-start gap-2 text-[14px] font-semibold text-[#f6c66f]">
                      <Fingerprint size={18} className="mt-px shrink-0" /> {chapter.yourTurn}
                    </p>
                    <button onClick={approveForMe} className="text-[12.5px] font-semibold text-[#9fb2ad] underline-offset-2 hover:text-white hover:underline">
                      Approve it for me instead
                    </button>
                  </div>
                )}
                {state?.agentBusy && !chapter.yourTurn && (
                  <p className="flex items-center gap-2 text-[13px] text-[#9fb2ad]">
                    <Loader2 size={14} className="animate-spin" /> The agent is working…
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {phase === "done" && result && <Results result={result} state={state!} />}

          {inStory && (
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
              {phase === "playing" && (
                <button onClick={() => setPhase("paused")} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-[13px] font-semibold hover:bg-white/5">
                  <Pause size={14} /> Pause
                </button>
              )}
              {phase === "paused" && (
                <button onClick={() => setPhase("playing")} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#5ccdb4] px-3.5 text-[13px] font-semibold text-[#04211b]">
                  <Play size={14} /> Continue
                </button>
              )}
              <button onClick={start} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-[13px] font-semibold hover:bg-white/5">
                <RotateCcw size={14} /> Start over
              </button>
            </div>
          )}
        </section>

        {/* the family's phone */}
        <section aria-label="The family's phone" className="relative flex h-[78dvh] min-h-[560px] flex-col items-center gap-2 lg:h-auto lg:min-h-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7d918c]">The family&apos;s phone · tap it</p>
          <PhoneFrame />
          {!inStory && (
            // before Play the phone may still show another case: cover it until the story starts
            <button onClick={start} className="absolute inset-x-0 bottom-0 top-7 grid place-items-center rounded-[52px] bg-[#08100f]/75 backdrop-blur-sm" aria-label="Play the story">
              <span className="grid h-20 w-20 place-items-center rounded-full bg-[#5ccdb4] text-[#04211b] shadow-[0_0_0_12px_rgba(92,205,180,0.15)]">
                <Play size={34} className="ml-1" />
              </span>
            </button>
          )}
        </section>

        {/* the machine's view */}
        <section aria-label="What the agent did" className="hidden min-h-0 flex-col gap-3 lg:flex">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7d918c]">What the agent did · and the safety layer&apos;s decisions</p>
          <div className="min-h-0 flex-1">
            <AgentConsole />
          </div>
          {state && <StageAnchors state={state} />}
        </section>
      </div>
    </div>
  );
}

function Results({ result, state }: { result: Evaluation; state: PublicState }) {
  const m = result.money;
  const c = activeCase(state);
  const refund = c?.expectedRefund;
  const anchored = state.anchors.filter((a) => a.chain?.status === "confirmed");
  const rows = [
    { big: money(m.savedVsCardSource, m.sourceCurrency), label: "saved against paying everything by card" },
    { big: money(m.duplicateChargeCaught, m.destCurrency), label: `duplicate charge caught${refund ? `, ${money(refund.amount, refund.currency)} refunded` : ""}` },
    { big: `${result.metrics.toolCalls}`, label: `actions by the agent over ${Math.round(result.metrics.simDays)} days, ${result.metrics.emailsToInstitution} emails to the hospital` },
    { big: `${result.checks.filter((x) => x.pass).length}/${result.checks.length}`, label: "safety and task checks passed" },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="grid grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.label}>
            <p className="num text-[20px] font-bold leading-tight text-white">{r.big}</p>
            <p className="text-[12px] leading-snug text-[#9fb2ad]">{r.label}</p>
          </div>
        ))}
      </div>
      <p className="flex items-start gap-1.5 text-[12.5px] text-[#9fb2ad]">
        <ShieldCheck size={14} className="mt-px shrink-0 text-[#5ccdb4]" />
        Every step is on a hash-chained log{anchored.length ? `, and ${anchored.length} milestones were anchored on a public blockchain just now` : ""}.
        {state.anchoring && (
          <a href={state.anchoring.contractUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-[#5ccdb4] hover:underline">
            <Link2 size={12} /> contract
          </a>
        )}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/app/new/upload" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#5ccdb4] px-4 text-[13.5px] font-semibold text-[#04211b]">
          <Upload size={15} /> Try it with any bill
        </Link>
        <Link href="/app/new" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/20 px-4 text-[13.5px] font-semibold hover:bg-white/5">
          More cases <ArrowRight size={15} />
        </Link>
      </div>
    </motion.div>
  );
}
