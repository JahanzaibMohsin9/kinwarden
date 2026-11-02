import type { CorridorId, Currency, Route } from "./types";

export interface Corridor {
  id: CorridorId;
  label: string;
  fromCountry: string;
  toCountry: string;
  fromCode: string;
  toCode: string;
  sourceCurrency: Currency;
  destCurrency: Currency;
  packId: "pk-sbp" | "cn-safe";
  /** map arc endpoints for the money-flow animation (lon, lat) */
  fromCity: { name: string; lon: number; lat: number };
  toCity: { name: string; lon: number; lat: number };
  routes: Route[];
}

export const CORRIDORS: Record<CorridorId, Corridor> = {
  "PK-TH": {
    id: "PK-TH",
    label: "Pakistan → Thailand",
    fromCountry: "Pakistan",
    toCountry: "Thailand",
    fromCode: "PK",
    toCode: "TH",
    sourceCurrency: "PKR",
    destCurrency: "THB",
    packId: "pk-sbp",
    fromCity: { name: "Lahore", lon: 74.35, lat: 31.55 },
    toCity: { name: "Bangkok", lon: 100.5, lat: 13.75 },
    routes: ["bank_transfer", "card_payment", "atm_cash", "carried_cash"],
  },
  "CN-GB": {
    id: "CN-GB",
    label: "China → United Kingdom",
    fromCountry: "China",
    toCountry: "United Kingdom",
    fromCode: "CN",
    toCode: "GB",
    sourceCurrency: "CNY",
    destCurrency: "GBP",
    packId: "cn-safe",
    fromCity: { name: "Shenzhen", lon: 114.06, lat: 22.54 },
    toCity: { name: "London", lon: -0.13, lat: 51.5 },
    routes: ["bank_transfer", "card_payment"],
  },
  "PK-GB": {
    id: "PK-GB",
    label: "Pakistan → United Kingdom",
    fromCountry: "Pakistan",
    toCountry: "United Kingdom",
    fromCode: "PK",
    toCode: "GB",
    sourceCurrency: "PKR",
    destCurrency: "GBP",
    packId: "pk-sbp",
    fromCity: { name: "Karachi", lon: 67.0, lat: 24.86 },
    toCity: { name: "London", lon: -0.13, lat: 51.5 },
    routes: ["bank_transfer", "card_payment"],
  },
};

export const ROUTE_LABEL: Record<Route, string> = {
  bank_transfer: "Bank transfer to the institution",
  card_payment: "Card payment at the institution",
  atm_cash: "Cash from an ATM abroad",
  carried_cash: "Foreign cash carried from home",
};

export const ROUTE_SHORT: Record<Route, string> = {
  bank_transfer: "Bank transfer",
  card_payment: "Card",
  atm_cash: "ATM cash",
  carried_cash: "Carried cash",
};

/** Countries an uploaded bill can come from (sandbox rates exist for their currencies). */
export const DESTINATIONS: Record<string, { country: string; currency: Currency; city: string; lon: number; lat: number; tz: string }> = {
  TH: { country: "Thailand", currency: "THB", city: "Bangkok", lon: 100.5, lat: 13.75, tz: "Asia/Bangkok" },
  GB: { country: "United Kingdom", currency: "GBP", city: "London", lon: -0.13, lat: 51.5, tz: "Europe/London" },
  CN: { country: "China", currency: "CNY", city: "Shenzhen", lon: 114.06, lat: 22.54, tz: "Asia/Shanghai" },
  SG: { country: "Singapore", currency: "SGD", city: "Singapore", lon: 103.82, lat: 1.35, tz: "Asia/Singapore" },
  MY: { country: "Malaysia", currency: "MYR", city: "Kuala Lumpur", lon: 101.69, lat: 3.14, tz: "Asia/Kuala_Lumpur" },
  AE: { country: "United Arab Emirates", currency: "AED", city: "Dubai", lon: 55.27, lat: 25.2, tz: "Asia/Dubai" },
  SA: { country: "Saudi Arabia", currency: "SAR", city: "Riyadh", lon: 46.68, lat: 24.71, tz: "Asia/Riyadh" },
  TR: { country: "Türkiye", currency: "TRY", city: "Istanbul", lon: 28.98, lat: 41.01, tz: "Europe/Istanbul" },
  HK: { country: "Hong Kong SAR", currency: "HKD", city: "Hong Kong", lon: 114.17, lat: 22.32, tz: "Asia/Hong_Kong" },
  DE: { country: "Germany", currency: "EUR", city: "Berlin", lon: 13.4, lat: 52.52, tz: "Europe/Berlin" },
  US: { country: "United States", currency: "USD", city: "New York", lon: -74.0, lat: 40.71, tz: "America/New_York" },
  AU: { country: "Australia", currency: "AUD", city: "Sydney", lon: 151.21, lat: -33.87, tz: "Australia/Sydney" },
  CA: { country: "Canada", currency: "CAD", city: "Toronto", lon: -79.38, lat: 43.65, tz: "America/Toronto" },
};

const HOME = {
  PK: { country: "Pakistan", currency: "PKR" as Currency, packId: "pk-sbp" as const, city: { name: "Lahore", lon: 74.35, lat: 31.55 }, routes: ["bank_transfer", "card_payment", "atm_cash", "carried_cash"] as Route[] },
  CN: { country: "China", currency: "CNY" as Currency, packId: "cn-safe" as const, city: { name: "Shenzhen", lon: 114.06, lat: 22.54 }, routes: ["bank_transfer", "card_payment"] as Route[] },
};

const derived = new Map<string, Corridor>();

/** A corridor by id: one of the scenario corridors, or one derived for an uploaded bill ("PK-SG", "CN-HK"). */
export function corridorOf(id: CorridorId): Corridor {
  const fixed = (CORRIDORS as Record<string, Corridor>)[id];
  if (fixed) return fixed;
  const hit = derived.get(id);
  if (hit) return hit;
  const [from, to] = id.split("-");
  const home = HOME[from as keyof typeof HOME];
  const dest = DESTINATIONS[to];
  if (!home || !dest || from === to) throw new Error(`Unsupported corridor ${id}`);
  const c: Corridor = {
    id,
    label: `${home.country} → ${dest.country}`,
    fromCountry: home.country,
    toCountry: dest.country,
    fromCode: from,
    toCode: to,
    sourceCurrency: home.currency,
    destCurrency: dest.currency,
    packId: home.packId,
    fromCity: home.city,
    toCity: { name: dest.city, lon: dest.lon, lat: dest.lat },
    routes: home.routes,
  };
  derived.set(id, c);
  return c;
}
