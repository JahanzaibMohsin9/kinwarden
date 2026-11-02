import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CorridorId, Currency } from "@/domain/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYMBOL: Partial<Record<Currency, string>> = { USD: "$", GBP: "£" };

export function money(amount: number, currency: Currency | string, opts: { decimals?: number; compact?: boolean } = {}) {
  const decimals = opts.decimals ?? (Math.abs(amount) >= 1000 || Number.isInteger(amount) ? 0 : 2);
  const n = opts.compact
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(amount)
    : amount.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sym = SYMBOL[currency as Currency];
  return sym ? `${sym}${n}` : `${currency} ${n}`;
}

export const CASE_TZ: Partial<Record<CorridorId, string>> = {
  "PK-TH": "Asia/Bangkok",
  "CN-GB": "Asia/Shanghai",
  "PK-GB": "Asia/Karachi",
};

export function timeOf(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function dayLabel(iso: string, tz: string, lang = "en") {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
}

export function dateTime(iso: string, tz: string, lang = "en") {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function dayKey(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
}

/** "Day 3" counted from the day the case opened, in the case's timezone. */
export function dayNumber(iso: string, openedAt: string, tz: string) {
  const a = new Date(dayKey(openedAt, tz)).getTime();
  const b = new Date(dayKey(iso, tz)).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

export function hoursBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

export function shortHash(h: string) {
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}
