"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, BadgeCheck, Building2, CircleCheck, GraduationCap, HeartPulse, PiggyBank, Plus, ShieldAlert, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import { useCarry } from "@/lib/client";
import { ROUTE_KEY, useT } from "@/lib/i18n";
import { activeCase, allowances, caseTz, feed, moneySummary, pendingApprovals, savingsVsCash } from "@/lib/selectors";
import { cn, money, timeOf } from "@/lib/format";
import { corridorOf } from "@/domain/corridors";
import { ratePerUSD } from "@/domain/market";
import { Badge, Card, Meter, SectionTitle } from "../ui";
import { FeedLine } from "./Activity";
import { Flag } from "../Flag";

export function Overview() {
  const { state } = useCarry();
  const { t, lang } = useT();
  if (!state) return null;
  const c = activeCase(state)!;
  const w = state.world;
  const inst = w.institutions[c.institutionId];
  const m = moneySummary(w, c.id);
  const tz = caseTz(c);
  const urdu = lang === "ur";
  const items = feed(state, c.id).filter((i) => i.kind !== "message" || i.message.from === "agent").slice(-3).reverse();
  const allow = allowances(w, c.id);
  const savings = savingsVsCash(w, c.id);
  const pending = pendingApprovals(w, c.id);
  const remaining = Math.max(0, m.total - m.paid - m.inFlight);
  const refund = c.expectedRefund;

  return (
    <div className="space-y-5 px-4 pb-8 pt-4">
      {/* Bill hero */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-soft text-brand">{inst.kind === "hospital" ? <HeartPulse size={20} /> : <GraduationCap size={20} />}</div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[14px] font-semibold leading-snug">{inst.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
              {inst.city === inst.country ? inst.city : `${inst.city}, ${inst.country}`}
              {inst.origin === "uploaded_bill" && !inst.verifiedAt ? (
                <Badge tone="info" icon={<ShieldCheck size={12} />}>
                  {t("notVerified")}
                </Badge>
              ) : (
                <Badge tone="success" icon={<BadgeCheck size={12} />}>
                  {inst.origin === "uploaded_bill" ? t("verifiedByBank") : t("verifiedAccount")}
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="px-4 pb-4 pt-3">
          {m.bill ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className={cn("text-[12.5px] font-medium text-ink-3", urdu && "urdu")}>
                  {m.isFinal ? t("billTotal") : t("estimate")} · {m.bill.number}
                </p>
                {m.settled && (
                  <Badge tone="success" icon={<CircleCheck size={12} />}>
                    {t("allPaid")}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex items-baseline gap-2" dir="ltr">
                <span className="num text-[30px] font-bold tracking-tight">{money(m.paid, m.currency)}</span>
                <span className="num text-[14px] text-ink-3">/ {money(m.total, m.currency)}</span>
              </div>
              {/* paid / on the way / remaining, one bar with 2px gaps; in-flight is hatched */}
              <div className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]" dir="ltr" role="img" aria-label={`${t("paid")} ${money(m.paid, m.currency)}, ${t("inFlight")} ${money(m.inFlight, m.currency)}, ${t("toPay")} ${money(remaining, m.currency)}`}>
                {m.paid > 0 && <motion.div layout className="h-full rounded-[4px] bg-brand" style={{ flexGrow: Math.min(m.paid, m.total || m.paid) }} />}
                {m.inFlight > 0 && <motion.div layout className="hatch h-full rounded-[4px] bg-brand-soft text-brand" style={{ flexGrow: m.inFlight }} />}
                {remaining > 0 && <motion.div layout className="h-full rounded-[4px] bg-brand-track" style={{ flexGrow: remaining }} />}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2" dir="ltr">
                <Legend swatch="bg-brand" label={t("paid")} value={money(m.paid, m.currency)} />
                {m.inFlight > 0 && <Legend swatch="hatch bg-brand-soft text-brand" label={t("inFlight")} value={money(m.inFlight, m.currency)} />}
                {remaining > 0 && <Legend swatch="bg-brand-track" label={t("toPay")} value={money(remaining, m.currency)} />}
              </div>
              {(m.overpaid > 0 || refund) && (
                <div className={cn("mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold", refund?.receivedAt ? "bg-success-soft text-success" : "bg-info-soft text-info")}>
                  <Undo2 size={15} />
                  {refund?.receivedAt ? t("refundReceived") : t("refundDue")}: {money(refund?.amount ?? m.overpaid, m.currency)}
                </div>
              )}
            </>
          ) : inst.origin === "uploaded_bill" && !inst.verifiedAt ? (
            <p className={cn("flex items-start gap-1.5 rounded-xl bg-info-soft px-3 py-2 text-[14px] font-semibold text-info", urdu && "urdu")}>
              <ShieldCheck size={16} className="mt-[3px] shrink-0" />
              {t("onHoldUnverified")}
            </p>
          ) : state.world.security.some((s) => s.caseId === c.id && s.kind === "suspicious_message") ? (
            // nothing to pay and a fraud warning on file: say so instead of "waiting for the bill"
            <p className={cn("flex items-start gap-1.5 rounded-xl bg-amber-soft px-3 py-2 text-[14px] font-semibold text-amber-strong", urdu && "urdu")}>
              <ShieldAlert size={16} className="mt-[3px] shrink-0" />
              {t("onHoldFraud")}
            </p>
          ) : (
            <p className="py-2 text-[14px] text-ink-2">
              <Sparkles size={14} className="mr-1 inline text-brand" />
              {c.status === "closed" ? t("caseClosed") : c.type === "medical" ? t("waitingEstimate") : t("waitingFees")}
            </p>
          )}
        </div>
      </Card>

      {pending.length > 0 && (
        <Card className="border-amber/40 bg-amber-soft p-4">
          <p className={cn("text-[13px] font-semibold text-amber-strong", urdu && "urdu")}>{t("needsYou")}</p>
          <p className="mt-0.5 text-[15px] font-semibold">
            <ApprovalSummary id={pending[0].id} />
          </p>
        </Card>
      )}

      <RouteCard />

      {/* Latest */}
      <section>
        <SectionTitle
          action={
            <Link href="/app/activity" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand">
              {t("seeAll")} <ArrowRight size={13} className={cn(urdu && "rotate-180")} />
            </Link>
          }
        >
          <span className={cn(urdu && "urdu normal-case tracking-normal")}>{t("latest")}</span>
        </SectionTitle>
        <Card className="divide-y divide-line">
          {items.length === 0 && <p className="px-4 py-4 text-[13.5px] text-ink-3">{t("nothingYet")}</p>}
          {items.map((it) => (
            <div key={it.entry.seq} className="px-3 py-2.5">
              <FeedLine item={it} tz={tz} compact />
            </div>
          ))}
        </Card>
      </section>

      {/* Savings + allowances */}
      <div className="grid grid-cols-1 gap-3">
        {savings.saved > 0 && (
          <Card className="flex items-center gap-3 p-4">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-success-soft text-success">
              <PiggyBank size={22} />
            </div>
            <div>
              <p className="num text-[22px] font-bold leading-tight">{money(savings.saved, savings.currency)}</p>
              <p className={cn("text-[12.5px] text-ink-3", urdu && "urdu")}>{savings.against === "atm_cash" ? t("savings") : t("savedVsCard")}</p>
            </div>
          </Card>
        )}
        <section>
          <SectionTitle>
            <span className={cn(urdu && "urdu normal-case tracking-normal")}>{t("allowances")}</span>
          </SectionTitle>
          <Card className="space-y-4 p-4">
            {allow.map((a) => (
              <Meter key={a.label} value={a.used} max={a.cap} label={a.label} sub={`$${Math.round(a.used).toLocaleString()} / $${a.cap.toLocaleString()}`} />
            ))}
            <p className={cn("text-[11.5px] leading-relaxed text-ink-3", urdu && "urdu")}>{corridorOf(c.corridor).packId === "pk-sbp" ? t("limitsNotePk") : t("limitsNoteCn")}</p>
          </Card>
        </section>
      </div>

      <Link href="/app/new" className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong py-3 text-[13px] font-semibold text-ink-2 hover:bg-surface">
        <Plus size={15} /> {t("newCase")}
      </Link>

      <p className="pb-2 text-center text-[11px] text-ink-3">
        Sandbox · simulated time {timeOf(w.now, tz)} {tz.split("/")[1]}
      </p>
    </div>
  );
}

export function ApprovalSummary({ id }: { id: string }) {
  const { state } = useCarry();
  const { t } = useT();
  const a = state?.world.approvals[id];
  const p = a && state ? state.world.payments[a.paymentId] : undefined;
  if (!a || !p || !state) return null;
  return (
    <>
      {t(ROUTE_KEY[p.route])} · {money(p.amount, p.currency)} → {state.world.institutions[p.institutionId].name}
    </>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-[3px]", swatch)} />
      {label} <span className="num font-semibold text-ink">{value}</span>
    </span>
  );
}

/** Lahore → Bangkok style route card with the money in motion when something is on the way. */
export function RouteCard() {
  const { state } = useCarry();
  const { t, lang } = useT();
  if (!state) return null;
  const c = activeCase(state)!;
  const w = state.world;
  const corridor = corridorOf(c.corridor);
  const inFlight = Object.values(w.payments).filter((p) => p.caseId === c.id && ["submitted", "processing"].includes(p.status));
  const dest = w.institutions[c.institutionId].bank.currency;
  const rate = ratePerUSD(corridor.sourceCurrency, w.now) / ratePerUSD(dest, w.now);
  const path = "M 28 64 C 110 -6, 250 -6, 332 64";

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3">
        <SectionTitle className="mb-0 px-0">
          <span className={cn(lang === "ur" && "urdu normal-case tracking-normal")}>{t("route")}</span>
        </SectionTitle>
        <span className="num text-[11.5px] text-ink-3" dir="ltr">
          1 {dest} = {rate.toFixed(2)} {corridor.sourceCurrency} · sandbox
        </span>
      </div>
      <div className="relative px-2" dir="ltr">
        <svg viewBox="0 0 360 92" className="h-[92px] w-full" aria-hidden>
          <path d={path} fill="none" stroke="var(--line-strong)" strokeWidth="2" strokeDasharray="4 8" strokeLinecap="round" className={cn(inFlight.length > 0 && "route-dash")} />
          {inFlight.length > 0 && (
            <>
              <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
              <circle r="7" fill="var(--brand)">
                <animateMotion dur="2.6s" repeatCount="indefinite" path={path} />
              </circle>
              <circle r="12" fill="var(--brand)" opacity="0.18">
                <animateMotion dur="2.6s" repeatCount="indefinite" path={path} />
              </circle>
            </>
          )}
          <circle cx="28" cy="64" r="6" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.5" />
          <circle cx="332" cy="64" r="6" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2.5" />
        </svg>
        <div className="-mt-3 flex justify-between px-1 pb-3 text-[12.5px]">
          <div>
            <p className="font-semibold">
              <Flag code={corridor.fromCode} /> {corridor.fromCity.name}
            </p>
            <p className="text-ink-3">{corridor.sourceCurrency}</p>
          </div>
          <div className="flex flex-col items-center justify-end text-center">
            {inFlight.length > 0 ? (
              <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[11.5px] font-semibold text-brand-strong">
                {money(inFlight.reduce((s, p) => s + p.amount, 0), dest)} {t("inFlight").toLowerCase()}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
                <Building2 size={12} /> {w.institutions[c.institutionId].kind === "hospital" ? t("directToHospital") : t("directToUniversity")}
              </span>
            )}
          </div>
          <div className="text-right">
            <p className="font-semibold">
              {corridor.toCity.name} <Flag code={corridor.toCode} />
            </p>
            <p className="text-ink-3">{dest}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
