"use client";

import { motion } from "motion/react";
import { Ban, Banknote, Download, ExternalLink, Eye, EyeOff, Fingerprint, Link2, Loader2, OctagonX, PenLine, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { post, useCarry } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { passkeysSupported, registerPasskey } from "@/lib/passkey";
import { stableStringify } from "@/lib/canonical";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dateTime, shortHash } from "@/lib/format";
import { corridorOf } from "@/domain/corridors";
import { PACKS } from "@/domain/rules/engine";
import type { LedgerEntry } from "@/domain/types";
import { Badge, Card, SectionTitle } from "../ui";
import { RuleChip } from "../RuleChip";
import { AnchorList } from "./AnchorList";

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyInBrowser(entries: LedgerEntry[], onProgress: (n: number) => void) {
  let prev = "0".repeat(64);
  for (let i = 0; i < entries.length; i++) {
    const { hash, ...rest } = entries[i];
    if (rest.prevHash !== prev) return { ok: false, brokenAt: rest.seq, reason: "link to previous entry is broken" };
    const h = await sha256Hex(stableStringify(rest));
    if (h !== hash) return { ok: false, brokenAt: rest.seq, reason: "entry was edited after it was written" };
    prev = hash;
    if (i % 8 === 0) onProgress(i + 1);
  }
  onProgress(entries.length);
  return { ok: true, head: prev };
}

export function SecurityCenter() {
  const { state } = useCarry();
  const { t, lang } = useT();
  const [verifying, setVerifying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; brokenAt?: number; reason?: string; head?: string; at: number } | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  if (!state) return null;
  const c = activeCase(state)!;
  const w = state.world;
  const tz = caseTz(c);
  const urdu = lang === "ur";
  const events = [...w.security].reverse();
  const blocked = events.filter((e) => e.severity !== "info").length;
  const pack = PACKS[corridorOf(c.corridor).packId];
  const kill = w.agent.killSwitch;

  const toolCounts = { read: 0, communicate: 0, money: 0 } as Record<string, number>;
  for (const e of state.ledger) if (e.type.startsWith("tool.") && typeof e.data.tier === "string") toolCounts[e.data.tier] = (toolCounts[e.data.tier] ?? 0) + 1;

  const verify = async () => {
    setVerifying(true);
    setResult(null);
    setProgress(0);
    const r = await verifyInBrowser(state.ledger, setProgress);
    await new Promise((res) => setTimeout(res, 350));
    setResult({ ...r, at: state.ledger.length });
    setVerifying(false);
  };

  return (
    <div className="space-y-5 px-4 pb-10 pt-4">
      {/* Status hero */}
      <Card className={cn("overflow-hidden p-0", kill && "border-danger/40")}>
        <div className={cn("flex items-center gap-3 px-4 py-4", kill ? "bg-danger-soft" : "bg-brand-softer")}>
          <span className={cn("grid h-12 w-12 place-items-center rounded-2xl", kill ? "bg-danger text-white" : "bg-brand text-brand-ink")}>
            {kill ? <OctagonX size={24} /> : <ShieldCheck size={24} />}
          </span>
          <div className="flex-1">
            <p className={cn("text-[17px] font-bold", urdu && "urdu")}>{kill ? t("agentStopped") : t("protectedBy")}</p>
            <p className="text-[12.5px] text-ink-2">
              {blocked > 0 ? `${blocked} attempt${blocked > 1 ? "s" : ""} blocked or flagged` : t("noThreats")} · {toolCounts.money ?? 0} money actions, each covered by your approval
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1">
            <p className={cn("text-[14px] font-semibold", urdu && "urdu")}>{t("emergencyStop")}</p>
            <p className={cn("text-[12px] text-ink-3", urdu && "urdu")}>{t("emergencyStopHint")}</p>
          </div>
          <button
            role="switch"
            aria-checked={kill}
            onClick={() => post("/api/family", { action: "kill", on: !kill })}
            className={cn("relative h-8 w-14 shrink-0 rounded-full transition-colors", kill ? "bg-danger" : "bg-line-strong")}
          >
            <motion.span layout className="absolute top-1 h-6 w-6 rounded-full bg-white shadow" style={{ left: kill ? 28 : 4 }} />
          </button>
        </div>
        <PasskeyRow passkeys={state.passkeys} error={passkeyError} setError={setPasskeyError} />
      </Card>

      {/* Threats */}
      <section>
        <SectionTitle>
          <span className={cn(urdu && "urdu normal-case tracking-normal")}>{t("threats")}</span>
        </SectionTitle>
        <Card className="divide-y divide-line">
          {events.length === 0 && <p className="px-4 py-4 text-[13.5px] text-ink-3">{t("noThreats")}</p>}
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-4 py-3">
              <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", e.severity === "critical" ? "bg-danger text-white" : "bg-amber-soft text-amber-strong")}>
                {e.kind === "suspicious_message" ? <ShieldAlert size={15} /> : <ShieldX size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold leading-snug">{e.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{e.detail}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={e.severity === "critical" ? "danger" : "amber"}>{e.severity === "critical" ? "Critical" : "Warning"}</Badge>
                  {e.ruleIds?.map((r) => <RuleChip key={r} id={r} />)}
                  <span className="text-[11px] text-ink-3">{dateTime(e.at, tz, lang)}</span>
                </div>
              </div>
            </div>
          ))}
        </Card>
      </section>

      <PrivacyCard lastPrompt={w.agent.lastPrompt} />

      {/* Log integrity */}
      <section>
        <SectionTitle>
          <span className={cn(urdu && "urdu normal-case tracking-normal")}>{t("logIntegrity")}</span>
        </SectionTitle>
        <Card className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-2xl", state.chain.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              <Link2 size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">
                {state.ledger.length} entries · {state.chain.ok ? "chain intact" : `broken at #${state.chain.brokenAt}`}
              </p>
              <p className="text-[12px] leading-relaxed text-ink-3">
                Every action is hashed with SHA-256 together with the hash of the action before it, so changing any past entry breaks every link after it.
              </p>
              <p className="mt-1 truncate font-mono text-[11px] text-ink-2">head {shortHash(state.chain.headHash)}</p>
            </div>
          </div>
          {verifying && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-brand-track">
                <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(progress / Math.max(1, state.ledger.length)) * 100}%` }} />
              </div>
              <p className="num text-[11.5px] text-ink-3">
                Recomputing hash {progress} of {state.ledger.length}…
              </p>
            </div>
          )}
          {result && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("rounded-xl px-3 py-2 text-[12.5px] font-semibold", result.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}
            >
              {result.ok ? `✓ Verified ${result.at} entries in this browser. Nothing was changed.` : `✗ Entry #${result.brokenAt}: ${result.reason}.`}
            </motion.p>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={verify} disabled={verifying} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12.5px] font-semibold text-bg disabled:opacity-60">
              {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              {t("verifyNow")}
            </button>
            <a href="/api/ledger" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[12.5px] font-semibold">
              <Download size={14} />
              {t("download")}
            </a>
          </div>
          <AnchorList state={state} />
        </Card>
      </section>

      {/* Permissions */}
      <section>
        <SectionTitle>
          <span className={cn(urdu && "urdu normal-case tracking-normal")}>{t("permissions")}</span>
        </SectionTitle>
        <Card className="divide-y divide-line">
          <Tier icon={<Eye size={15} />} tone="brand" title={t("tierRead")} hint={t("tierReadHint")} count={toolCounts.read} urdu={urdu} />
          <Tier icon={<PenLine size={15} />} tone="brand" title={t("tierCommunicate")} hint={t("tierCommunicateHint")} count={toolCounts.communicate} urdu={urdu} />
          <Tier icon={<Banknote size={15} />} tone="amber" title={t("tierMoney")} hint={t("tierMoneyHint")} count={toolCounts.money} urdu={urdu} />
          <Tier icon={<Ban size={15} />} tone="danger" title={t("tierForbidden")} hint={t("tierForbiddenHint")} urdu={urdu} />
        </Card>
      </section>

      {/* Rules */}
      <section>
        <SectionTitle>
          <span className={cn(urdu && "urdu normal-case tracking-normal")}>{t("rules")}</span>
        </SectionTitle>
        <Card className="p-0">
          <div className="border-b border-line px-4 py-3">
            <p className="text-[14px] font-semibold">{pack.name}</p>
            <p className="font-mono text-[11px] text-ink-3">
              {pack.id} · version {pack.version}
            </p>
          </div>
          <ul className="divide-y divide-line">
            {pack.rules.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold leading-snug">{r.title}</p>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-0.5 font-mono text-[10.5px] text-ink-3">{r.id}</p>
                {r.history && (
                  <p className="mt-1 text-[12px] text-ink-2">
                    {r.history.map((h) => `${(h.rate * 100).toFixed(1)}% from ${h.effectiveFrom}`).join(" → ")}
                  </p>
                )}
                {r.source.url ? (
                  <a href={r.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand">
                    {r.source.title} <ExternalLink size={11} />
                  </a>
                ) : (
                  <p className="mt-1 text-[11.5px] text-ink-3">{r.source.title}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}

function Tier({ icon, tone, title, hint, count, urdu }: { icon: React.ReactNode; tone: "brand" | "amber" | "danger"; title: string; hint: string; count?: number; urdu: boolean }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", tone === "brand" && "bg-brand-soft text-brand", tone === "amber" && "bg-amber-soft text-amber-strong", tone === "danger" && "bg-danger-soft text-danger")}>
        {icon}
      </span>
      <div className="flex-1">
        <p className={cn("text-[13.5px] font-semibold", urdu && "urdu")}>{title}</p>
        <p className={cn("text-[12px] text-ink-3", urdu && "urdu")}>{hint}</p>
      </div>
      {count !== undefined && <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2">{count}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "official") return <Badge tone="success">Official</Badge>;
  if (status === "reported") return <Badge tone="info">Reported</Badge>;
  if (status === "assumed") return <Badge tone="amber">Verify</Badge>;
  return <Badge tone="brand">Policy</Badge>;
}

function PasskeyRow({ passkeys, error, setError }: { passkeys: { id: string; label: string; createdAt: string; lastUsedAt?: string }[]; error: string | null; setError: (e: string | null) => void }) {
  const { t, lang } = useT();
  const urdu = lang === "ur";
  const on = passkeys.length > 0;
  const setUp = async () => {
    setError(null);
    try {
      await registerPasskey();
    } catch (e) {
      setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Passkey setup was cancelled.");
    }
  };
  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", on ? "bg-success-soft text-success" : "bg-surface-3 text-ink-3")}>
          <Fingerprint size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-[14px] font-semibold", urdu && "urdu")}>{on ? t("passkeyReady") : t("setUpPasskey")}</p>
          <p className={cn("text-[12px] text-ink-3", urdu && "urdu")}>{on ? `${passkeys.map((k) => k.label).join(", ")} · ${t("passkeySigns")}` : t("passkeySigns")}</p>
        </div>
        {!on && passkeysSupported() && (
          <button onClick={setUp} className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-bg hover:bg-brand">
            Set up
          </button>
        )}
      </div>
      {error && <p className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

const WITHHELD_LABEL: Record<string, string> = {
  PERSON: "names",
  PERSON_ID: "internal IDs",
  PATIENT_REF: "hospital number",
  STUDENT_ID: "student ID",
  CARD: "card numbers",
  PASSPORT: "passport numbers",
  MEDICAL: "medical details",
};

/** Privacy firewall: what was withheld from the AI, and the exact text it was sent last time. */
function PrivacyCard({ lastPrompt }: { lastPrompt?: { at: string; caseId: string; text: string; withheld: Record<string, number> } }) {
  const { t, lang } = useT();
  const urdu = lang === "ur";
  const [open, setOpen] = useState(false);
  const kinds = Object.entries(lastPrompt?.withheld ?? {});
  return (
    <section>
      <SectionTitle>
        <span className={cn(urdu && "urdu normal-case tracking-normal")}>{t("privacyTitle")}</span>
      </SectionTitle>
      <Card className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-softer text-brand">
            <EyeOff size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("text-[14px] font-semibold", urdu && "urdu")}>{t("privacyHeadline")}</p>
            <p className={cn("text-[12px] leading-relaxed text-ink-3", urdu && "urdu")}>{t("privacyHint")}</p>
          </div>
        </div>
        {kinds.length > 0 && (
          <div className="flex flex-wrap gap-1.5" dir="ltr">
            {kinds.map(([k, n]) => (
              <Badge key={k} tone="success">
                {n} {WITHHELD_LABEL[k] ?? k} withheld
              </Badge>
            ))}
          </div>
        )}
        {lastPrompt ? (
          <div>
            <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-semibold text-brand">
              <Eye size={14} /> {open ? "Hide" : "Show"} exactly what the AI was sent
            </button>
            {open && (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3 font-mono text-[10.5px] leading-relaxed text-ink-2" dir="ltr">
                {lastPrompt.text}
              </pre>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-3">The AI hasn&apos;t been sent anything for this case yet.</p>
        )}
      </Card>
    </section>
  );
}
