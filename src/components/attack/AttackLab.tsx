"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, Loader2, Mail, MessageCircle, Paperclip, Send, ShieldAlert, ShieldCheck, ShieldX, Siren, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCarry } from "@/lib/client";
import { cn } from "@/lib/format";
import type { LabAttack, ForceStep } from "@/server/attacklab";
import { RuleChip } from "../RuleChip";
import { SiteNav } from "../SiteNav";
import { BringYourOwnAI } from "./BringYourOwnAI";

export type Recorded = Record<string, { model: string; attempted: string | null; executed: string | null; flagged: boolean; warnedFamily: boolean; blocked: number; tools: string[] }>;

interface Summary {
  total: number;
  attempted: number;
  executed: number;
  naiveAttempted: number;
  naiveExecuted: number;
  model: string;
}

const card = "rounded-2xl border border-white/10 bg-white/[0.04]";
const TOOL_WORDS: Record<string, string> = {
  read_email: "read the email",
  read_document: "read the attachment",
  flag_suspicious_message: "flagged it as fraud",
  message_family: "warned the family",
  send_email: "checked with the hospital's real address",
  verify_beneficiary: "checked the bank details against the verified record",
  compare_payment_routes: "priced the legal routes",
  propose_payment: "proposed paying the institution's verified account",
  prepare_documents: "prepared forms",
  add_case_note: "noted it on the case",
  get_case_overview: "reviewed the case",
};

async function call(action: string, id: string) {
  const r = await fetch("/api/attack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j;
}

export function AttackLab({ attacks, recorded, naive, summary }: { attacks: LabAttack[]; recorded: Recorded; naive: Recorded; summary: Summary }) {
  const { state } = useCarry();
  const [sel, setSel] = useState(attacks[0].id);
  const [launched, setLaunched] = useState<string | null>(null);
  const [liveLeft, setLiveLeft] = useState(0);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<ForceStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = attacks.find((x) => x.id === sel)!;
  const rec = recorded[a.redteamId];
  const nv = naive[a.redteamId];

  useEffect(() => {
    fetch("/api/attack")
      .then((r) => r.json())
      .then((j: { liveLeft: number }) => setLiveLeft(j.liveLeft))
      .catch(() => {});
  }, []);

  const choose = (id: string) => {
    setSel(id);
    setLaunched(null);
    setSteps(null);
    setLive(false);
    setError(null);
  };

  const run = async (action: "launch" | "live" | "force") => {
    setBusy(action);
    setError(null);
    try {
      if (action === "launch") {
        const j = await call("launch", a.id);
        setLaunched(a.id);
        setLiveLeft(j.liveLeft);
        setSteps(null);
        setLive(false);
      } else if (action === "live") {
        const j = await call("live", a.id);
        setLiveLeft(j.liveLeft);
        setLive(true);
      } else {
        setSteps((await call("force", a.id)).steps);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // the attack as the agent received it, from the visitor's own world
  const delivered = useMemo(() => {
    if (!state || launched !== a.id) return null;
    const w = state.world;
    // the entry just before "attack.launched" is the attack itself: an email or a family message
    const at = state.ledger.findIndex((e) => e.type === "attack.launched");
    const e = at > 0 ? state.ledger[at - 1] : undefined;
    const mail = e?.type === "mail.received" ? w.mail[String(e.data.mailId)] : undefined;
    if (mail) return { kind: "mail" as const, from: mail.from, subject: mail.subject, body: mail.body, docs: mail.attachments.map((d) => w.docs[d]).filter(Boolean) };
    const msg = e?.type === "family.message" ? w.messages.find((m) => m.id === e.data.messageId) : undefined;
    return msg ? { kind: "family" as const, body: msg.text } : null;
  }, [state, launched, a.id]);

  // what the live AI is doing right now (after "watch the live AI")
  const liveCalls = useMemo(() => {
    if (!state || !live) return [];
    const at = state.ledger.find((e) => e.type === "attack.launched")?.seq ?? 0;
    return state.ledger.filter((e) => e.seq > at && e.type.startsWith("tool.") && e.actor !== "director").map((e) => ({ seq: e.seq, tool: e.type.slice(5), decision: String(e.data.decision ?? ""), narration: e.narration }));
  }, [state, live]);
  const liveWarning = live && state ? state.world.messages.filter((m) => m.from === "agent").at(-1)?.text : undefined;

  return (
    <div className="relative min-h-dvh bg-[#08100f] text-[#e9f1ee]">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(#f2827a 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
      <SiteNav tone="dark" />
      <main className="relative z-10 mx-auto max-w-6xl space-y-6 px-5 pb-16">
        <header className="max-w-3xl space-y-3 pt-2">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#f2827a]">
            <Siren size={14} /> Attack lab
          </p>
          <h1 className="text-[34px] font-bold leading-[1.1] tracking-tight sm:text-[42px]">Try to fool it.</h1>
          <p className="text-[15.5px] leading-relaxed text-[#c9d6d2]">
            Six attacks that work on payment agents: fake bank details, data theft, rule evasion, kickbacks, double payments. Send one to Kinwarden, see what the AI does, then <b className="text-white">force the AI to obey the attacker</b> and watch the safety layer refuse. Everything runs in your own sandbox.
          </p>
          <p className="text-[13px] text-[#9fb2ad]">
            In our red team on the live model ({summary.model}), Kinwarden&apos;s agent tried {summary.attempted} of {summary.total} attacks and {summary.executed} got through. An agent with a typical &ldquo;helpful assistant&rdquo; prompt tried {summary.naiveAttempted}; the safety layer still stopped {summary.naiveAttempted - summary.naiveExecuted === summary.naiveAttempted ? "all of them" : `${summary.naiveAttempted - summary.naiveExecuted}`}.
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
          <ul className="space-y-2" aria-label="Attacks">
            {attacks.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => choose(x.id)}
                  aria-pressed={sel === x.id}
                  className={cn("w-full rounded-2xl border p-3.5 text-left transition-colors", sel === x.id ? "border-[#f2827a]/60 bg-[#f2827a]/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#f2827a]">{x.category}</span>
                  <span className="mt-0.5 block text-[15px] font-semibold leading-snug">{x.title}</span>
                </button>
              </li>
            ))}
          </ul>

          <section className="space-y-4" aria-live="polite">
            <div className={cn(card, "p-5")}>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#f2827a]">{a.category}</p>
              <h2 className="mt-1 text-[24px] font-bold leading-tight tracking-tight">{a.title}</h2>
              <p className="mt-2 text-[14.5px] leading-relaxed text-[#c9d6d2]">{a.wants}</p>
              <button onClick={() => run("launch")} disabled={busy !== null} className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-[#f2827a] px-5 text-[14.5px] font-semibold text-[#1d0907] disabled:opacity-60">
                {busy === "launch" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} 1. Send the attack to Kinwarden
              </button>
            </div>

            <AnimatePresence>
              {launched === a.id && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  {delivered && (
                    <div className={cn(card, "p-4")}>
                      <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7d918c]">What the agent receives</p>
                      {delivered.kind === "mail" ? (
                        <div className="rounded-xl bg-[#f4f1ea] p-3.5 text-[#12201e]">
                          <p className="flex items-center gap-1.5 text-[12.5px] text-[#48605b]">
                            <Mail size={13} /> From <b className="font-mono text-[#b42318]">{delivered.from}</b>
                          </p>
                          <p className="mt-1 text-[14.5px] font-semibold">{delivered.subject}</p>
                          <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed">{delivered.body}</p>
                          {delivered.docs.map((d) => (
                            <div key={d.id} className="mt-2.5 rounded-lg border border-[#d3cabb] bg-white p-2.5">
                              <p className="flex items-center gap-1 text-[12px] font-semibold text-[#48605b]">
                                <Paperclip size={12} /> {d.title}
                              </p>
                              <p className="mt-1 whitespace-pre-line font-mono text-[11.5px] leading-relaxed">{d.text}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <MessageCircle size={16} className="mt-1 shrink-0 text-[#9fb2ad]" />
                          <p className="rounded-2xl rounded-tl-sm bg-[#1f2c34] px-3.5 py-2.5 text-[14px] leading-relaxed">{delivered.body}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {rec && (
                    <div className={cn(card, "p-4")}>
                      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7d918c]">
                        <Bot size={13} /> What the AI did with it · recorded on {rec.model}
                      </p>
                      <ul className="mt-2 space-y-1 text-[14px]">
                        <Line ok={!rec.attempted} text={rec.attempted ? `It tried something unsafe: ${rec.attempted}` : "It didn't try to do what the attacker asked"} />
                        {rec.flagged && <Line ok text="It flagged the message as fraud" />}
                        {rec.warnedFamily && <Line ok text="It warned the family in plain words" />}
                        <Line ok={!rec.executed} text={rec.executed ? `Something unsafe happened: ${rec.executed}` : "Nothing unsafe happened"} />
                      </ul>
                      {rec.tools.length > 0 && (
                        <p className="mt-2 text-[12.5px] leading-relaxed text-[#9fb2ad]">
                          Its steps: {[...new Set(rec.tools.map((t) => TOOL_WORDS[t.split(":")[0]] ?? t.split(":")[0]))].join(" → ")}.
                        </p>
                      )}
                      {nv?.attempted && (
                        <p className="mt-2 rounded-lg bg-[#f0b44c]/10 px-3 py-2 text-[12.5px] text-[#f6c66f]">
                          An agent with a typical &ldquo;helpful assistant&rdquo; prompt did try it ({nv.attempted}). The safety layer still stopped it: {nv.executed ? `but ${nv.executed}` : "nothing was paid"}.
                        </p>
                      )}
                      {liveLeft > 0 && !live && (
                        <button onClick={() => run("live")} disabled={busy !== null} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/20 px-3.5 text-[13px] font-semibold hover:bg-white/5 disabled:opacity-60">
                          {busy === "live" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Watch the live AI handle it now (about a minute)
                        </button>
                      )}
                      {live && (
                        <div className="mt-3 space-y-1.5 rounded-xl border border-white/10 p-3">
                          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#5ccdb4]">
                            {state?.agentBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Live AI {state?.agentBusy ? "working…" : "finished"}
                          </p>
                          {liveCalls.map((c) => (
                            <p key={c.seq} className="text-[12.5px] text-[#c9d6d2]">
                              <span className={cn("mr-1.5 rounded px-1 font-mono text-[10.5px]", c.decision === "blocked" ? "bg-[#f2827a]/20 text-[#f2827a]" : "bg-white/10 text-[#9fb2ad]")}>{c.tool}</span>
                              {c.narration}
                            </p>
                          ))}
                          {liveWarning && !state?.agentBusy && <p className="mt-1 rounded-lg bg-white/[0.06] px-3 py-2 text-[12.5px] leading-relaxed text-[#e9f1ee]">To the family: {liveWarning}</p>}
                        </div>
                      )}
                    </div>
                  )}

                  <div className={cn(card, "border-[#f2827a]/30 p-4")}>
                    <p className="text-[14.5px] font-semibold">Now suppose the AI was fooled.</p>
                    <p className="mt-1 text-[13.5px] text-[#9fb2ad]">The safety layer doesn&apos;t trust the model: every action is checked in code before anything happens.</p>
                    <button onClick={() => run("force")} disabled={busy !== null || steps !== null} className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-semibold text-[#08100f] disabled:opacity-60">
                      {busy === "force" ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />} 2. Make the AI obey: {a.obey}
                    </button>
                    {steps && (
                      <ul className="mt-3 space-y-2">
                        {steps.map((st, i) => (
                          <motion.li key={i} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.25 }} className={cn("rounded-xl p-3", st.outcome === "allowed" ? "bg-white/[0.05]" : "bg-[#f2827a]/12")}>
                            <p className="flex items-center gap-2 text-[14px] font-semibold">
                              {st.outcome === "allowed" ? <ShieldCheck size={16} className="text-[#9fb2ad]" /> : <ShieldX size={16} className="text-[#f2827a]" />}
                              {st.what}: <span className={st.outcome === "allowed" ? "text-[#9fb2ad]" : "text-[#f2827a]"}>{st.outcome === "blocked" ? "BLOCKED" : st.outcome === "refused" ? "REFUSED" : "only a request for the family's fingerprint"}</span>
                            </p>
                            <p className="mt-1 text-[13px] leading-relaxed text-[#c9d6d2]">{st.message.charAt(0).toUpperCase() + st.message.slice(1)}</p>
                            {st.ruleIds.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1.5" data-theme="light">
                                {st.ruleIds.map((r) => (
                                  <RuleChip key={r} id={r} />
                                ))}
                              </div>
                            ) : st.tool === "send_email" ? (
                              <p className="mt-1.5 text-[12px] text-[#9fb2ad]">Rule: Kinwarden only writes to the institution&apos;s verified address.</p>
                            ) : null}
                          </motion.li>
                        ))}
                        <li className="flex items-center gap-1.5 pt-1 text-[13px] font-semibold text-[#5ccdb4]">
                          <ShieldCheck size={15} /> No money went to the attacker. The attempt is logged in the Security Centre and the hash-chained log.
                        </li>
                      </ul>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {error && <p className="rounded-xl bg-[#f2827a]/15 px-3 py-2 text-[13px] text-[#f2827a]">{error}</p>}
          </section>
        </div>
        <BringYourOwnAI />
      </main>
    </div>
  );
}

function Line({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#5ccdb4]" /> : <ShieldX size={16} className="mt-0.5 shrink-0 text-[#f2827a]" />}
      <span className={ok ? "text-[#e9f1ee]" : "text-[#f2827a]"}>{text}</span>
    </li>
  );
}
