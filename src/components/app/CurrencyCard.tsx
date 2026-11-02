"use client";

import { ArrowRight, Coins } from "lucide-react";
import { ROUTE_KEY, useT } from "@/lib/i18n";
import { cn, money } from "@/lib/format";
import { midRate } from "@/domain/market";
import type { CaseFile, Currency, Payment, World } from "@/domain/types";
import { Card } from "../ui";

const MOVED = new Set(["approved", "submitted", "processing", "completed"]);

/** What left the family's home currency, what arrived abroad, what it cost, and what came back: all from engine-priced payments. */
export function CurrencyCard({ w, c, payments }: { w: World; c: CaseFile; payments: Payment[] }) {
  const { t, lang } = useT();
  const urdu = lang === "ur";
  const moved = payments.filter((p) => MOVED.has(p.status));
  if (moved.length === 0) return null;
  const src = moved[0].cost.sourceCurrency as Currency;
  const dest = moved[0].currency as Currency;
  const arrived = moved.filter((p) => p.status === "completed");
  const onTheWay = moved.filter((p) => p.status !== "completed");
  const paidSource = moved.reduce((s, p) => s + p.cost.totalSource, 0);
  const extraSource = moved.reduce((s, p) => s + (p.cost.totalSource - p.cost.deliverAmount * p.cost.midRate), 0);
  const delivered = moved.reduce((s, p) => s + p.amount, 0);
  const refund = c.expectedRefund;
  const refundSource = refund ? refund.amount * midRate(src, dest, refund.receivedAt ?? w.now) : 0;
  const net = paidSource - (refund?.receivedAt ? refundSource : 0);
  const netDelivered = delivered - (refund?.receivedAt ? refund.amount : 0);
  const allIn = netDelivered > 0 ? net / netDelivered : 0;
  const mid = midRate(src, dest, w.now);
  const byRoute = Object.entries(
    moved.reduce<Record<string, { dest: number; src: number }>>((acc, p) => {
      const r = (acc[p.route] ??= { dest: 0, src: 0 });
      r.dest += p.amount;
      r.src += p.cost.totalSource;
      return acc;
    }, {}),
  );

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Coins size={16} className="text-brand" />
        <p className={cn("text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3", urdu && "urdu normal-case tracking-normal")}>{t("acrossCurrencies")}</p>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3" dir="ltr">
        <div>
          <p className={cn("text-[11.5px] text-ink-3", urdu && "urdu")}>{t("leftHome")}</p>
          <p className="num text-[18px] font-bold">{money(paidSource, src)}</p>
        </div>
        <ArrowRight size={16} className="text-ink-3" />
        <div className="text-right">
          <p className={cn("text-[11.5px] text-ink-3", urdu && "urdu")}>{t("arrivedAbroad")}</p>
          <p className="num text-[18px] font-bold">{money(arrived.reduce((s, p) => s + p.amount, 0), dest)}</p>
          {onTheWay.length > 0 && <p className="num text-[11.5px] text-ink-3">+{money(onTheWay.reduce((s, p) => s + p.amount, 0), dest)} {t("onTheWay")}</p>}
        </div>
      </div>
      <dl className="num space-y-1.5 border-t border-line px-4 py-3 text-[13px]" dir="ltr">
        {byRoute.map(([route, v]) => (
          <div key={route} className="flex justify-between gap-3">
            <dt className={cn("text-ink-2", urdu && "urdu")}>{t(ROUTE_KEY[route as keyof typeof ROUTE_KEY])}</dt>
            <dd>
              {money(v.dest, dest)} <span className="text-ink-3">· {money(v.src, src)}</span>
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-3">
          <dt className={cn("text-ink-2", urdu && "urdu")}>{t("fxFeesTax")}</dt>
          <dd>{money(extraSource, src)}</dd>
        </div>
        {refund && (
          <div className="flex justify-between gap-3">
            <dt className={cn("text-ink-2", urdu && "urdu")}>{refund.receivedAt ? t("refundBack") : t("refundComing")}</dt>
            <dd className="text-success">
              {money(refund.amount, refund.currency)} <span className="text-ink-3">≈ {money(refundSource, src)}</span>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold">
          <dt className={cn(urdu && "urdu")}>{t("netCost")}</dt>
          <dd>{money(net, src)}</dd>
        </div>
      </dl>
      {allIn > 0 && (
        <p className={cn("bg-surface-2 px-4 py-2.5 text-[12px] text-ink-2", urdu && "urdu")} dir={urdu ? "rtl" : "ltr"}>
          {t("allInRate")}: <span className="num font-semibold" dir="ltr">1 {dest} = {allIn.toFixed(src === "CNY" ? 3 : 2)} {src}</span> · {t("midRate")} <span className="num" dir="ltr">{mid.toFixed(src === "CNY" ? 3 : 2)}</span>
        </p>
      )}
    </Card>
  );
}
