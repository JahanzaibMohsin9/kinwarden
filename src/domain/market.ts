import type { CorridorId, Currency, Route } from "./types";
import { corridorOf } from "./corridors";

/**
 * Sandbox market data. These are illustrative numbers for the demo, not live
 * quotes; the UI labels them as "sandbox rates".
 */
export const USD_RATES: Record<Currency, number> = {
  USD: 1,
  PKR: 281.2,
  THB: 32.8,
  GBP: 0.742,
  CNY: 7.11,
  EUR: 0.861,
  SGD: 1.292,
  MYR: 4.21,
  AED: 3.6725,
  SAR: 3.75,
  TRY: 41.9,
  HKD: 7.79,
  AUD: 1.52,
  CAD: 1.385,
};

/** Small deterministic daily drift so rates move a little across simulated days. */
export function ratePerUSD(cur: Currency, simDate: string): number {
  if (cur === "USD") return 1;
  const day = Math.floor(new Date(simDate).getTime() / 86_400_000);
  const seed = (day * 9301 + cur.charCodeAt(0) * 49297) % 233280;
  const drift = (seed / 233280 - 0.5) * 0.006; // ±0.3%
  return USD_RATES[cur] * (1 + drift);
}

/** source units per 1 unit of destination currency */
export function midRate(source: Currency, dest: Currency, simDate: string): number {
  return ratePerUSD(source, simDate) / ratePerUSD(dest, simDate);
}

export function toUSD(amount: number, cur: Currency, simDate: string): number {
  return amount / ratePerUSD(cur, simDate);
}

export interface FeeRule {
  label: string;
  kind: "flat_source" | "flat_usd" | "pct_source" | "per_withdrawal_dest" | "per_withdrawal_source" | "institution_surcharge";
  value: number;
  min?: number;
  max?: number;
}

export interface RoutePricing {
  fxMarkupPct: number;
  fees: FeeRule[];
  arrivesInHours: number;
  /** max per single cash withdrawal, destination currency */
  withdrawalMax?: number;
  note: string;
}

export const PRICING: Record<CorridorId, Partial<Record<Route, RoutePricing>>> = {
  "PK-TH": {
    bank_transfer: {
      fxMarkupPct: 0.009,
      fees: [
        { label: "Bank remittance charge", kind: "flat_source", value: 5000 },
        { label: "Correspondent bank charge (sender pays all)", kind: "flat_usd", value: 25 },
      ],
      arrivesInHours: 48,
      note: "SWIFT transfer straight to the hospital's account",
    },
    card_payment: {
      fxMarkupPct: 0.03,
      fees: [],
      arrivesInHours: 0,
      note: "Paid at the hospital cashier or through its payment link",
    },
    atm_cash: {
      fxMarkupPct: 0.03,
      fees: [
        { label: "Thai ATM operator fee", kind: "per_withdrawal_dest", value: 220 },
        { label: "Your bank's overseas withdrawal fee", kind: "per_withdrawal_source", value: 1200 },
      ],
      withdrawalMax: 30000,
      arrivesInHours: 0,
      note: "Several withdrawals, then pay the hospital in cash",
    },
    carried_cash: {
      fxMarkupPct: 0.015,
      fees: [],
      arrivesInHours: 0,
      note: "Only possible before you leave Pakistan",
    },
  },
  "PK-GB": {
    bank_transfer: {
      fxMarkupPct: 0.009,
      fees: [
        { label: "Bank remittance charge", kind: "flat_source", value: 5000 },
        { label: "Correspondent bank charge (sender pays all)", kind: "flat_usd", value: 25 },
      ],
      arrivesInHours: 48,
      note: "SWIFT transfer straight to the university's account",
    },
    card_payment: {
      fxMarkupPct: 0.03,
      fees: [{ label: "University card surcharge", kind: "institution_surcharge", value: 0 }],
      arrivesInHours: 0,
      note: "University online payment portal",
    },
  },
  "CN-GB": {
    bank_transfer: {
      fxMarkupPct: 0.006,
      fees: [
        { label: "电汇手续费 Telegraphic transfer fee", kind: "pct_source", value: 0.001, min: 50, max: 260 },
        { label: "电报费 Cable fee", kind: "flat_source", value: 80 },
      ],
      arrivesInHours: 48,
      note: "SWIFT transfer straight to the university's account",
    },
    card_payment: {
      fxMarkupPct: 0.015,
      fees: [{ label: "University card surcharge", kind: "institution_surcharge", value: 0 }],
      arrivesInHours: 0,
      note: "University online payment portal",
    },
  },
};

/**
 * Pricing for a corridor. A derived corridor (an uploaded bill) uses its home country's scenario
 * pricing as a template; fees fixed in the destination currency are converted at the base rate.
 */
export function pricingOf(id: CorridorId): Partial<Record<Route, RoutePricing>> {
  if (PRICING[id]) return PRICING[id];
  const c = corridorOf(id);
  const template = c.fromCode === "CN" ? PRICING["CN-GB"] : PRICING["PK-TH"];
  const fromTHB = (n: number) => Math.round((n / USD_RATES.THB) * USD_RATES[c.destCurrency]);
  const out: Partial<Record<Route, RoutePricing>> = {};
  for (const route of c.routes) {
    const t = template[route];
    if (!t) continue;
    out[route] = {
      ...t,
      fees: t.fees.map((f) => (f.kind === "per_withdrawal_dest" ? { ...f, label: "ATM operator fee abroad", value: fromTHB(f.value) } : f)),
      withdrawalMax: t.withdrawalMax !== undefined ? fromTHB(t.withdrawalMax) : undefined,
      note: t.note.replace(/hospital|university/, "institution"),
    };
  }
  return out;
}
