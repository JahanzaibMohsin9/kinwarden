"use client";

import { BadgeCheck, Anchor, Bot, FastForward, Flame, Pause, Play, RotateCcw, SkipForward, Skull, Zap } from "lucide-react";
import { useState } from "react";
import { director, useCarry } from "@/lib/client";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dateTime, dayNumber } from "@/lib/format";
import type { AgentMode } from "@/domain/types";

export function DirectorPanel({ dense = false }: { dense?: boolean }) {
  const { state, connected } = useCarry();
  const [err, setErr] = useState<string | null>(null);
  if (!state) return null;
  const c = activeCase(state)!;
  const tz = caseTz(c);
  const w = state.world;
  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setErr(null);
    try {
      await director(action, extra);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const lastSeq = state.ledger.at(-1)?.seq ?? 1;

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-[12px]", dense ? "" : "rounded-2xl border border-line bg-surface p-3 shadow-card")}>
      <select
        value={w.scenarioId}
        onChange={(e) => run("reset", { scenarioId: e.target.value })}
        className="h-8 rounded-lg border border-line bg-surface px-2 font-semibold"
        aria-label="Scenario"
      >
        {state.scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title} ({s.corridor})
          </option>
        ))}
        {w.scenarioId === "upload" && <option value="upload">Your uploaded bill ({c.corridor})</option>}
      </select>
      <div className="flex h-8 items-center rounded-lg border border-line bg-surface p-0.5" role="radiogroup" aria-label="Agent mode">
        {(["live", "replay", "scripted"] as AgentMode[]).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={w.agent.mode === m}
            onClick={() => run("mode", { mode: m })}
            className={cn("h-full rounded-md px-2 font-semibold capitalize", w.agent.mode === m ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}
            title={m === "live" ? "The AI model makes every decision" : m === "replay" ? "Replays the decisions of a recorded live run" : "Hand-written plan, no AI (development)"}
          >
            {m === "live" && <Bot size={12} className="mr-1 inline" />}
            {m}
          </button>
        ))}
      </div>
      {w.agent.mode === "live" &&
        (state.hasKey ? (
          <span className="rounded-md bg-brand-soft px-2 py-1 font-semibold text-brand-strong">{state.model}</span>
        ) : (
          <span className="rounded-md bg-amber-soft px-2 py-1 font-semibold text-amber-strong">No API key on server</span>
        ))}

      <span className="mx-1 h-5 w-px bg-line" />
      <span className="num font-semibold text-ink-2">
        Day {dayNumber(w.now, c.openedAt, tz)} · {dateTime(w.now, tz)}
      </span>
      <button onClick={() => run("next")} disabled={!state.nextEvent || state.agentBusy} className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-2.5 font-semibold text-brand-ink disabled:opacity-40" title={state.nextEvent?.label}>
        <SkipForward size={13} /> Next{!dense && state.nextEvent ? `: ${state.nextEvent.label}` : ""}
      </button>
      <button onClick={() => run("advance", { hours: 6 })} disabled={state.agentBusy} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 font-semibold disabled:opacity-40">
        <FastForward size={13} /> +6h
      </button>
      <button onClick={() => run("autoplay", { on: !w.autoplay })} className={cn("inline-flex h-8 items-center gap-1 rounded-lg border px-2 font-semibold", w.autoplay ? "border-brand bg-brand-soft text-brand-strong" : "border-line")}>
        {w.autoplay ? <Pause size={13} /> : <Play size={13} />} Autoplay
      </button>
      <button onClick={() => run("nudge", { caseId: c.id })} disabled={state.agentBusy} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 font-semibold disabled:opacity-40" title="Wake the agent to review the case">
        <Zap size={13} /> Wake agent
      </button>

      <span className="mx-1 h-5 w-px bg-line" />
      <span className="inline-flex items-center gap-1 font-semibold text-ink-2" title="Break the outside world and watch the agent recover">
        <Flame size={13} className="text-amber" /> Chaos
      </span>
      {(
        [
          ["bank_outage", "Bank outage", Boolean(w.chaos?.bankOutage)],
          ["card_decline", "Card declined", Boolean(w.chaos?.cardDecline)],
          ["silent", "Institution silent", Boolean(w.chaos?.silentUntil && w.chaos.silentUntil > w.now)],
        ] as const
      ).map(([kind, label, armed]) => (
        <button
          key={kind}
          onClick={() => run("chaos", { kind })}
          disabled={armed}
          className={cn("inline-flex h-8 items-center rounded-lg border px-2 font-semibold", armed ? "border-amber bg-amber-soft text-amber-strong" : "border-line hover:border-amber")}
        >
          {label}
          {armed ? " ✓" : ""}
        </button>
      ))}
      {w.institutions[c.institutionId]?.origin === "uploaded_bill" && (
        <>
          <span className="mx-1 h-5 w-px bg-line" />
          <button
            onClick={() => run("verify_institution")}
            disabled={Boolean(w.institutions[c.institutionId].verifiedAt) || state.agentBusy}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-brand/50 px-2 font-semibold text-brand-strong disabled:opacity-50"
            title="Stands in for the bank's own check of the institution and its account (sandbox)"
          >
            <BadgeCheck size={13} /> {w.institutions[c.institutionId].verifiedAt ? "Institution verified" : "Verify institution (sandbox)"}
          </button>
        </>
      )}
      <span className="mx-1 h-5 w-px bg-line" />
      <label className="inline-flex items-center gap-1 font-semibold text-ink-2">
        <input type="checkbox" checked={w.autoReply} onChange={(e) => run("autoReply", { on: e.target.checked })} /> Auto-reply
      </label>
      <button onClick={() => run("anchor", { note: `Anchor at ${dateTime(w.now, tz)}` })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 font-semibold" title="Publish the current head hash">
        <Anchor size={13} /> Anchor
      </button>
      <button onClick={() => run("tamper", { seq: Math.max(1, Math.floor(lastSeq / 3)) })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-danger/40 px-2 font-semibold text-danger" title="Edit a past log entry without re-hashing, to show tamper detection">
        <Skull size={13} /> Tamper demo
      </button>
      <button onClick={() => run("reset", { scenarioId: w.scenarioId })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 font-semibold">
        <RotateCcw size={13} /> Reset
      </button>
      <span className={cn("ml-auto inline-flex items-center gap-1.5 font-medium", connected ? "text-success" : "text-amber")}>
        <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-success" : "bg-amber")} />
        {connected ? "Live" : "Reconnecting"}
      </span>
      {err && <span className="w-full rounded-md bg-danger-soft px-2 py-1 text-danger">{err}</span>}
    </div>
  );
}
