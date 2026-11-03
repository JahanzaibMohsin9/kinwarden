"use client";

import { motion } from "motion/react";
import { BadgeCheck, Check, ChevronDown, Clock, FileSignature, Fingerprint, Info, KeyRound, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { useRef, useState } from "react";
import { useCarry, post } from "@/lib/client";
import { approveWithPasskey, passkeysSupported, registerPasskey } from "@/lib/passkey";
import { setViewer, useViewer } from "@/lib/viewer";
import { ROUTE_KEY, useT } from "@/lib/i18n";
import { caseTz } from "@/lib/selectors";
import { cn, dateTime, money } from "@/lib/format";
import { ROUTE_SHORT } from "@/domain/corridors";
import { compareRoutes, evaluateRoute, findRule } from "@/domain/rules/engine";
import { Badge, Sheet } from "../ui";
import { RuleChip } from "../RuleChip";
import { NearApproval } from "./NearApproval";

export function ApprovalSheet({ approvalId, onClose }: { approvalId: string | null; onClose: () => void }) {
  const { state } = useCarry();
  const { t, lang } = useT();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [useHold, setUseHold] = useState(false);
  const [busy, setBusy] = useState(false);

  const a = state && approvalId ? state.world.approvals[approvalId] : undefined;
  const viewer = useViewer(a && state ? state.world.cases[a.caseId] : undefined);
  const open = Boolean(a && (!a.decision || done));
  if (!state || !a) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  const w = state.world;
  const p = w.payments[a.paymentId];
  const c = w.cases[a.caseId];
  const inv = w.invoices[p.invoiceId];
  const inst = w.institutions[p.institutionId];
  const payer = c.people.find((x) => x.id === p.payerId);
  const tz = caseTz(c);
  const urdu = lang === "ur";

  // world as it was before this payment was proposed, so the comparison is like-for-like
  const before = { ...w, payments: Object.fromEntries(Object.entries(w.payments).filter(([id]) => id !== p.id)) };
  const options = compareRoutes({ world: before, caseFile: c, payer, institution: inst, amount: p.amount, deadline: inv.dueAt, invoiceId: inv.id });
  // chart the cost on top of the money itself (markup + fees + tax): that's where routes differ
  const extra = (o: (typeof options)[number]) => (o.cost ? o.cost.totalSource - o.cost.deliverAmount * o.cost.midRate : 0);
  const maxExtra = Math.max(...options.map(extra), 1);
  const chosen = options.find((o) => o.route === p.route);
  const cheapestAllowed = options.find((o) => o.evaluation.allowed && o.meetsDeadline !== false);
  const ev = evaluateRoute({ world: before, caseFile: c, payer, route: p.route, amount: p.amount, currency: p.currency, invoiceId: inv.id });
  const forms = Object.values(w.docs).filter((d) => d.caseId === c.id && d.origin === "agent" && d.fields.invoice === inv.number);
  const arrivesAt = new Date(new Date(p.createdAt).getTime() + p.cost.arrivesInHours * 3_600_000).toISOString();

  // family roles: only the person whose money pays can approve; anyone can decline
  const notPayer = Boolean(viewer && payer && viewer !== payer.id);
  const canPasskey = passkeysSupported();
  const hasPasskey = canPasskey && state.passkeys.length > 0;
  const passkeyMode = hasPasskey && !useHold;

  const decide = async (decision: "approved" | "declined", method: "hold" | "passkey" = "hold") => {
    setError(null);
    setBusy(true);
    try {
      if (decision === "approved" && method === "passkey") await approveWithPasskey(a.id, viewer);
      else await post(`/api/approvals/${a.id}`, { decision, method: "hold", as: viewer });
      if (decision === "approved") {
        setDone(true);
        setTimeout(onClose, 1100);
      } else onClose();
    } catch (e) {
      setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Approval was cancelled. Try again, or hold to approve instead.");
    } finally {
      setBusy(false);
    }
  };

  const setUp = async () => {
    setError(null);
    try {
      await registerPasskey();
    } catch (e) {
      setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Passkey setup was cancelled.");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={<span className={cn(urdu && "urdu")}>{t("approvePayment")}</span>}>
      <div lang={lang} dir={urdu ? "rtl" : "ltr"} className="space-y-4 pb-2">
        {/* Amount */}
        <div className="rounded-3xl bg-brand-softer p-4 text-center">
          <p className="num text-[34px] font-bold leading-tight tracking-tight" dir="ltr">
            {money(p.amount, p.currency)}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-2" dir="ltr">
            ≈ {money(p.cost.totalSource, p.cost.sourceCurrency)} {t("totalCost").toLowerCase()} · {t(ROUTE_KEY[p.route])}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px]">
            <span className="font-semibold">{inst.name}</span>
            <Badge tone="success" icon={<BadgeCheck size={12} />}>
              {t("verifiedAccount")}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] text-ink-3" dir="ltr">
            {p.route === "bank_transfer" ? `${p.beneficiary.bankName} · ${p.beneficiary.accountNumber}` : `Card ${w.cards.find((k) => k.personId === p.payerId)?.label ?? ""}`} · Ref “{p.reference}”
          </p>
          <div className="mt-2.5 inline-flex items-center gap-2 rounded-2xl bg-surface px-3 py-1.5 text-left text-[12px]">
            <Clock size={14} className="shrink-0 text-ink-3" />
            <span>
              <span className="block font-semibold text-ink-2">
                {t("arrives")}: {p.cost.arrivesInHours === 0 ? t("instant") : dateTime(arrivesAt, tz, lang)}
              </span>
              {inv.dueAt && <span className="block text-ink-3">Due {dateTime(inv.dueAt, tz, lang)}</span>}
            </span>
          </div>
        </div>

        {/* Why */}
        <div>
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{t("why")}</p>
          <p className={cn("text-[14.5px] leading-relaxed text-ink", urdu && "urdu")}>{p.rationale}</p>
        </div>

        {/* Route comparison: one series (total cost), chosen route highlighted, blocked routes hatched */}
        <div className="rounded-2xl border border-line p-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{t("compare")}</p>
          <p className="mb-2.5 text-[11.5px] text-ink-3" dir="ltr">
            Extra you pay on top of the money itself: exchange markup, fees and tax
          </p>
          <ul className="space-y-2.5" dir="ltr">
            {options.map((o) => {
              const isChosen = o.route === p.route;
              const blocked = !o.evaluation.allowed;
              const late = o.meetsDeadline === false;
              const pct = o.cost ? Math.max(3, (extra(o) / maxExtra) * 100) : 0;
              const reason = blocked ? o.evaluation.blockers[0]?.message : late ? "Arrives after the deadline" : undefined;
              return (
                <li key={o.route} tabIndex={0} title={`${ROUTE_SHORT[o.route]}: ${o.cost ? money(o.cost.totalSource, o.cost.sourceCurrency) : "n/a"}${reason ? ` · ${reason}` : ""}`} className="group rounded-md">
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                    <span className={cn("font-semibold", isChosen ? "text-ink" : "text-ink-2")}>
                      {t(ROUTE_KEY[o.route])}
                      {isChosen && <span className="ml-1.5 text-brand">●</span>}
                    </span>
                    <span className={cn("num", isChosen ? "font-semibold text-ink" : "text-ink-2")}>{o.cost ? `+${money(extra(o), o.cost.sourceCurrency)}` : "n/a"}</span>
                  </div>
                  <div className="h-2.5 w-full rounded-[4px] bg-surface-3">
                    <div
                      className={cn("h-full rounded-[4px]", isChosen ? "bg-brand" : blocked || late ? "hatch text-line-strong" : "bg-ink-3/45 group-hover:bg-ink-3/70")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {reason && (
                    <p className="mt-1 flex items-start gap-1 text-[11.5px] text-ink-3">
                      <TriangleAlert size={12} className="mt-[1px] shrink-0" /> {reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {chosen && cheapestAllowed && chosen.route !== cheapestAllowed.route && (
            <p className="mt-2 text-[12px] text-ink-3" dir="ltr">
              Not the cheapest overall: cheaper routes are blocked or arrive too late.
            </p>
          )}
        </div>

        {/* Cost breakdown */}
        <div className="rounded-2xl border border-line">
          <button onClick={() => setShowBreakdown((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-left">
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{t("costBreakdown")}</span>
            <ChevronDown size={16} className={cn("text-ink-3 transition-transform", showBreakdown && "rotate-180")} />
          </button>
          {showBreakdown && (
            <dl className="num space-y-1.5 border-t border-line px-3 py-2.5 text-[13px]" dir="ltr">
              <Row k={`${money(p.amount, p.currency)} at ${p.cost.midRate.toFixed(3)} ${p.cost.sourceCurrency}/${p.currency} (sandbox mid-rate)`} v={money(p.amount * p.cost.midRate, p.cost.sourceCurrency)} />
              <Row k={`Exchange-rate markup (${(p.cost.fxMarkupPct * 100).toFixed(1)}%)`} v={money(p.cost.fxMarkupCost, p.cost.sourceCurrency)} />
              {p.cost.fees.map((f) => (
                <Row key={f.label} k={f.label} v={money(f.amount, p.cost.sourceCurrency)} />
              ))}
              {p.cost.taxes.map((x) => (
                <Row key={x.label} k={x.label} v={money(x.amount, p.cost.sourceCurrency)} />
              ))}
              <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                <dt>{t("totalCost")}</dt>
                <dd>{money(p.cost.totalSource, p.cost.sourceCurrency)}</dd>
              </div>
            </dl>
          )}
        </div>

        {/* Checks */}
        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{t("checks")}</p>
          <ul className="space-y-1.5 text-[13px]" dir="ltr">
            <CheckLine ok text={`Bank account matches ${inst.name}'s verified record`} />
            {ev.limits.map((l) => (
              <CheckLine key={l.ruleId + l.label} ok={l.afterUSD <= l.capUSD} text={`${l.label}: $${Math.round(l.afterUSD).toLocaleString()} of $${l.capUSD.toLocaleString()}`} rule={l.ruleId} />
            ))}
            {ev.warnings.map((x) => (
              <CheckLine key={x.ruleId} ok text={x.message} rule={x.ruleId} />
            ))}
            {p.route === "bank_transfer" && c.type === "medical" && findRule(c.corridor, "PK.MED.DIRECT_TO_HOSPITAL") && <CheckLine ok text="Paid directly to the hospital's own account" rule="PK.MED.DIRECT_TO_HOSPITAL" />}
            <CheckLine ok text="One payer, no splitting across relatives" rule={c.corridor === "CN-GB" ? "CN.FX.NO_SPLITTING" : "KINWARDEN.NO_SPLITTING"} />
          </ul>
        </div>

        {forms.length > 0 && (
          <div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{t("docsToSign")}</p>
            <ul className="space-y-1.5">
              {forms.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px]" dir="ltr">
                  <FileSignature size={15} className="text-brand" />
                  <span className="flex-1 truncate">{d.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

        {p.near ? (
          // Settles through the NEAR vault: only the family's wallet can approve or reject it.
          <NearApproval paymentId={p.id} onDone={onClose} />
        ) : (
        <div className="sticky bottom-0 -mx-5 space-y-1.5 border-t border-line/60 bg-surface px-5 pb-1 pt-3">
          {notPayer && payer ? (
            <div className="space-y-2 rounded-2xl bg-info-soft p-3 text-[13px] text-info">
              <p className="flex items-start gap-1.5 font-semibold">
                <Users size={15} className="mt-px shrink-0" />
                {t("onlyPayerApproves").replaceAll("{name}", payer.name)}
              </p>
              <button onClick={() => setViewer(c, payer.id)} className="rounded-full bg-info px-3 py-1.5 text-[12.5px] font-semibold text-white">
                {t("switchToPayer").replaceAll("{name}", payer.name)}
              </button>
            </div>
          ) : passkeyMode ? (
            <PasskeyButton done={done} busy={busy} label={done ? t("approved") : t("approveWithPasskey")} onClick={() => decide("approved", "passkey")} />
          ) : (
            <HoldToApprove done={done} label={done ? t("approved") : t("holdToApprove")} onComplete={() => decide("approved")} />
          )}
          {!done && !notPayer && hasPasskey && (
            <button onClick={() => setUseHold((v) => !v)} className={cn("mx-auto block rounded-full px-3 py-1 text-[12px] font-semibold text-ink-3 hover:bg-surface-3 hover:text-ink", urdu && "urdu")}>
              {useHold ? t("approveWithPasskey") : t("holdInstead")}
            </button>
          )}
          {!done && !notPayer && canPasskey && !hasPasskey && (
            <button onClick={setUp} className={cn("mx-auto flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold text-brand hover:bg-brand-softer", urdu && "urdu")}>
              <KeyRound size={13} /> {t("setUpPasskey")}
            </button>
          )}
          <div className="flex items-center justify-between gap-3 pb-1">
            <p className={cn("flex items-center gap-1 text-[11px] leading-tight text-ink-3", passkeyMode && urdu && "urdu")}>
              <ShieldCheck size={12} className="shrink-0" /> {passkeyMode ? t("passkeySigns") : "Nothing moves without this. The safety layer re-checks it."}
            </p>
            {!done && (
              <button onClick={() => decide("declined")} className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold text-ink-3 hover:bg-surface-3 hover:text-ink">
                {t("decline")}
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{k}</dt>
      <dd className="shrink-0 text-ink">{v}</dd>
    </div>
  );
}

function CheckLine({ ok, text, rule }: { ok: boolean; text: string; rule?: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cn("mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
        {ok ? <Check size={12} strokeWidth={3} /> : <Info size={12} />}
      </span>
      <span className="flex-1 text-ink-2">
        {text}
        {rule && <RuleChip id={rule} className="ml-1.5" />}
      </span>
    </li>
  );
}

function PasskeyButton({ onClick, label, done, busy }: { onClick: () => void; label: string; done: boolean; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={done || busy}
      className={cn("relative h-14 w-full select-none overflow-hidden rounded-full text-[15px] font-semibold transition-colors", done ? "bg-success text-white" : "bg-ink text-bg hover:bg-brand", busy && "opacity-80")}
    >
      <span className="relative flex items-center justify-center gap-2">
        {done ? (
          <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} className="grid h-6 w-6 place-items-center rounded-full bg-white/25">
            <Check size={16} strokeWidth={3} />
          </motion.span>
        ) : (
          <Fingerprint size={20} className={cn(busy && "animate-pulse")} />
        )}
        {label}
      </span>
    </button>
  );
}

function HoldToApprove({ onComplete, label, done }: { onComplete: () => void; label: string; done: boolean }) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const fired = useRef(false);
  const DURATION = 1100;

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (!fired.current) setProgress(0);
  };
  const tick = (ts: number) => {
    if (!start.current) start.current = ts;
    const pr = Math.min(1, (ts - start.current) / DURATION);
    setProgress(pr);
    if (pr >= 1) {
      fired.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(30);
      onComplete();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (done || fired.current) return;
    start.current = 0;
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <button
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && begin()}
      onKeyUp={stop}
      className={cn("relative h-14 w-full select-none overflow-hidden rounded-full text-[15px] font-semibold", done ? "bg-success text-white" : "bg-ink text-bg")}
      style={{ touchAction: "none" }}
    >
      {!done && <motion.span className="absolute inset-y-0 left-0 bg-brand" style={{ width: `${progress * 100}%` }} />}
      <span className="relative flex items-center justify-center gap-2">
        {done ? (
          <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} className="grid h-6 w-6 place-items-center rounded-full bg-white/25">
            <Check size={16} strokeWidth={3} />
          </motion.span>
        ) : (
          <Fingerprint size={20} />
        )}
        {label}
      </span>
    </button>
  );
}
