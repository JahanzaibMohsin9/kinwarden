import pkPack from "./packs/pk-sbp.json";
import cnPack from "./packs/cn-safe.json";
import { corridorOf } from "../corridors";
import { pricingOf, midRate, ratePerUSD } from "../market";
import type {
  CaseFile,
  CorridorId,
  CostBreakdown,
  Currency,
  DocumentKind,
  Institution,
  Person,
  Route,
  World,
} from "../types";

export type RuleStatus = "official" | "reported" | "assumed" | "policy";

export interface Rule {
  id: string;
  title: string;
  kind: "limit" | "tax" | "documents" | "requirement" | "forbidden";
  appliesTo: string[];
  purposes?: string[];
  values?: Record<string, number>;
  scope?: string;
  requirement?: string;
  documents?: string[];
  documentLabels?: Record<string, string>;
  history?: { effectiveFrom: string; rate: number; note: string }[];
  consequence?: string;
  status: string;
  effectiveFrom?: string;
  source: { title: string; url: string };
}

export interface RulePack {
  id: string;
  jurisdiction: string;
  name: string;
  homeCurrency: string;
  version: string;
  notes: string;
  rules: Rule[];
}

export const PACKS: Record<string, RulePack> = {
  "pk-sbp": pkPack as RulePack,
  "cn-safe": cnPack as RulePack,
};

export function packFor(corridor: CorridorId): RulePack {
  return PACKS[corridorOf(corridor).packId];
}

export function findRule(corridor: CorridorId, id: string): Rule | undefined {
  return packFor(corridor).rules.find((r) => r.id === id);
}

export function allRules(): (Rule & { packId: string })[] {
  return Object.values(PACKS).flatMap((p) => p.rules.map((r) => ({ ...r, packId: p.id })));
}

/** The tax rate in force on a given date, from a rule with a dated history. */
export function rateInForce(rule: Rule | undefined, onDate: string): { rate: number; note: string } | undefined {
  if (!rule?.history) return undefined;
  const sorted = [...rule.history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let current: { rate: number; note: string } | undefined;
  for (const h of sorted) if (h.effectiveFrom <= onDate.slice(0, 10)) current = { rate: h.rate, note: h.note };
  return current;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What a route costs the family to deliver `deliverAmount` (destination currency) to the institution. */
export function priceRoute(opts: {
  corridor: CorridorId;
  route: Route;
  deliverAmount: number;
  institution: Institution;
  simDate: string;
}): CostBreakdown | undefined {
  const { corridor, route, deliverAmount, institution, simDate } = opts;
  const c = corridorOf(corridor);
  const pricing = pricingOf(corridor)[route];
  if (!pricing) return undefined;
  const src = c.sourceCurrency;
  const dest = institution.bank.currency;
  const mid = midRate(src, dest, simDate);
  const base = deliverAmount * mid;
  const fxMarkupCost = base * pricing.fxMarkupPct;
  const fees: { label: string; amount: number }[] = [];
  const withdrawals = pricing.withdrawalMax ? Math.ceil(deliverAmount / pricing.withdrawalMax) : 1;
  for (const f of pricing.fees) {
    let amount = 0;
    switch (f.kind) {
      case "flat_source":
        amount = f.value;
        break;
      case "flat_usd":
        amount = f.value * ratePerUSD(src, simDate);
        break;
      case "pct_source":
        amount = Math.min(f.max ?? Infinity, Math.max(f.min ?? 0, base * f.value));
        break;
      case "per_withdrawal_dest":
        amount = f.value * withdrawals * mid;
        break;
      case "per_withdrawal_source":
        amount = f.value * withdrawals;
        break;
      case "institution_surcharge":
        amount = (institution.cardSurchargePct ?? 0) * base;
        break;
    }
    if (amount > 0) {
      fees.push({
        label: pricing.withdrawalMax && f.kind.startsWith("per_withdrawal") ? `${f.label} ×${withdrawals}` : f.label,
        amount: round2(amount),
      });
    }
  }
  const taxes: { label: string; amount: number; ruleId?: string }[] = [];
  if (c.packId === "pk-sbp" && (route === "card_payment" || route === "atm_cash")) {
    const rule = findRule(corridor, "PK.CARD.ADVANCE_TAX");
    const r = rateInForce(rule, simDate);
    if (r) {
      taxes.push({
        label: `Advance tax on card use abroad (${(r.rate * 100).toFixed(1)}%)`,
        amount: round2((base + fxMarkupCost) * r.rate),
        ruleId: "PK.CARD.ADVANCE_TAX",
      });
    }
  }
  const totalSource = round2(base + fxMarkupCost + fees.reduce((s, f) => s + f.amount, 0) + taxes.reduce((s, t) => s + t.amount, 0));
  return {
    route,
    deliverAmount: round2(deliverAmount),
    deliverCurrency: dest,
    sourceCurrency: src,
    midRate: mid,
    fxMarkupPct: pricing.fxMarkupPct,
    fxMarkupCost: round2(fxMarkupCost),
    fees,
    taxes,
    totalSource,
    totalUSD: round2(totalSource / ratePerUSD(src, simDate)),
    arrivesInHours: pricing.arrivesInHours,
  };
}

// ---------------------------------------------------------------------------
// Usage of limits, derived from the world

const COUNTED = new Set(["approved", "submitted", "processing", "completed", "awaiting_approval"]);

export interface Usage {
  /** USD value of FX delivered for this case by bank transfer */
  caseBankTransferUSD: number;
  /** per person: card + ATM spending this calendar year (USD) */
  cardYearUSD: Record<string, number>;
  /** per person: FX bought by bank transfer this calendar year (USD) */
  fxYearUSD: Record<string, number>;
}

export function computeUsage(world: World, caseId: string, excludePaymentId?: string): Usage {
  const usage: Usage = { caseBankTransferUSD: 0, cardYearUSD: {}, fxYearUSD: {} };
  for (const card of world.cards) {
    usage.cardYearUSD[card.personId] = (usage.cardYearUSD[card.personId] ?? 0) + card.annualUsedUSD;
  }
  for (const c of Object.values(world.cases)) {
    for (const p of c.people) {
      if (p.priorFxYearUSD) usage.fxYearUSD[p.id] = p.priorFxYearUSD;
    }
  }
  const year = world.now.slice(0, 4);
  for (const p of Object.values(world.payments)) {
    if (p.id === excludePaymentId || !COUNTED.has(p.status)) continue;
    if (p.createdAt.slice(0, 4) !== year) continue;
    const usd = p.amount / ratePerUSD(p.currency, p.createdAt);
    if (p.route === "bank_transfer") {
      if (p.caseId === caseId) usage.caseBankTransferUSD += usd;
      usage.fxYearUSD[p.payerId] = (usage.fxYearUSD[p.payerId] ?? 0) + usd;
    } else if (p.route === "card_payment" || p.route === "atm_cash") {
      usage.cardYearUSD[p.payerId] = (usage.cardYearUSD[p.payerId] ?? 0) + usd;
    }
  }
  return usage;
}

export interface LimitLine {
  ruleId: string;
  label: string;
  usedUSD: number;
  afterUSD: number;
  capUSD: number;
  scope: string;
}

export interface Finding {
  ruleId: string;
  message: string;
}

export interface RouteEvaluation {
  route: Route;
  allowed: boolean;
  blockers: Finding[];
  warnings: Finding[];
  requiredDocs: { kind: DocumentKind; label: string; ruleId: string; present: boolean }[];
  limits: LimitLine[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateRoute(opts: {
  world: World;
  caseFile: CaseFile;
  payer: Person | undefined;
  route: Route;
  amount: number;
  currency: Currency;
  purpose?: string;
  excludePaymentId?: string;
  invoiceId?: string;
}): RouteEvaluation {
  const { world, caseFile, payer, route, amount, currency } = opts;
  const purpose = opts.purpose ?? caseFile.type;
  const corridor = caseFile.corridor;
  const pack = packFor(corridor);
  const usd = amount / ratePerUSD(currency, world.now);
  const usage = computeUsage(world, caseFile.id, opts.excludePaymentId);
  const ev: RouteEvaluation = { route, allowed: true, blockers: [], warnings: [], requiredDocs: [], limits: [] };
  const block = (ruleId: string, message: string) => ev.blockers.push({ ruleId, message });
  const warn = (ruleId: string, message: string) => ev.warnings.push({ ruleId, message });

  if (!corridorOf(corridor).routes.includes(route)) {
    block("CORRIDOR.ROUTE", `${route} is not available on the ${corridorOf(corridor).label} corridor.`);
  }

  // Who pays must be someone named on the case.
  if (!payer) {
    block(pack.id === "cn-safe" ? "CN.FX.NO_SPLITTING" : "KINWARDEN.NO_SPLITTING",
      "The payer is not a person on this case. Payments cannot be routed through relatives or other people to use their allowances.");
  }

  // a bill the family uploaded: nothing is paid until the bank has verified the institution
  const inst = world.institutions[caseFile.institutionId];
  if (inst?.origin === "uploaded_bill" && !inst.verifiedAt) {
    block("KINWARDEN.VERIFIED_INSTITUTION", `${inst.name} is not a verified institution yet. Kinwarden pays nothing until the bank has verified it and its account.`);
  }

  // an admission letter only counts if it came from the university itself (a forwarded or uploaded "offer" doesn't)
  const docsPresent = new Set(
    Object.values(world.docs)
      .filter((d) => d.caseId === caseFile.id && (d.kind !== "admission_letter" || d.origin === "institution"))
      .map((d) => d.kind),
  );
  const addDocs = (rule: Rule) => {
    for (const kind of rule.documents ?? []) {
      if (ev.requiredDocs.some((d) => d.kind === kind)) continue;
      ev.requiredDocs.push({
        kind: kind as DocumentKind,
        label: rule.documentLabels?.[kind] ?? kind,
        ruleId: rule.id,
        present: docsPresent.has(kind as DocumentKind),
      });
    }
  };

  // fake-admission fraud: no tuition on any route until the university has confirmed the admission
  if (purpose === "tuition") {
    const admission = pack.rules.find((r) => r.id === "KINWARDEN.ADMISSION_VERIFIED_BEFORE_FEES");
    if (admission) addDocs(admission);
  }

  if (pack.id === "pk-sbp") {
    if (route === "bank_transfer" && purpose === "medical") {
      const cap = findRule(corridor, "PK.MED.REMIT.CAP")!;
      const capUSD = cap.values!.perCaseUSD;
      ev.limits.push({ ruleId: cap.id, label: "Medical remittance allowance (this case)", usedUSD: r2(usage.caseBankTransferUSD), afterUSD: r2(usage.caseBankTransferUSD + usd), capUSD, scope: "case" });
      if (usage.caseBankTransferUSD + usd > capUSD) {
        block(cap.id, `This would bring medical remittances for the case to $${Math.round(usage.caseBankTransferUSD + usd).toLocaleString()}, above the $${capUSD.toLocaleString()} a bank can approve on its own. The bank must refer it to SBP.`);
      }
      addDocs(findRule(corridor, "PK.MED.REMIT.DOCS")!);
    }
    if (route === "bank_transfer" && purpose === "tuition") {
      const edu = findRule(corridor, "PK.EDU.REMIT")!;
      addDocs(edu);
      warn(edu.id, "Education remittance rules are marked 'assumed' in the sandbox. Confirm with the bank.");
    }
    if (route === "card_payment" || route === "atm_cash") {
      const card = findRule(corridor, "PK.CARD.ANNUAL")!;
      const used = payer ? usage.cardYearUSD[payer.id] ?? 0 : 0;
      const capUSD = card.values!.adultUSD;
      ev.limits.push({ ruleId: card.id, label: `Card spending abroad this year (${payer?.name ?? "unknown"})`, usedUSD: r2(used), afterUSD: r2(used + usd), capUSD, scope: "person_year" });
      if (used + usd > capUSD) block(card.id, `Card limit: ${payer?.name} would reach $${Math.round(used + usd).toLocaleString()} of the $${capUSD.toLocaleString()} yearly allowance.`);
    }
    if (route === "carried_cash") {
      const visit = findRule(corridor, "PK.CASH.PER_VISIT")!;
      const capUSD = payer?.adult ? visit.values!.adultUSD : visit.values!.minorUSD;
      ev.limits.push({ ruleId: visit.id, label: `Cash carried this visit (${payer?.name ?? "unknown"})`, usedUSD: 0, afterUSD: r2(usd), capUSD, scope: "person_visit" });
      if (payer?.abroad) block(visit.id, `${payer.name} has already left Pakistan, so carrying cash is no longer an option.`);
      if (usd > capUSD) block(visit.id, `Cash above $${capUSD.toLocaleString()} per person per visit is not allowed.`);
    }
  }

  if (pack.id === "cn-safe" && route === "bank_transfer") {
    const quota = findRule(corridor, "CN.FX.ANNUAL_QUOTA")!;
    const used = payer ? usage.fxYearUSD[payer.id] ?? 0 : 0;
    const capUSD = quota.values!.adultUSD;
    ev.limits.push({ ruleId: quota.id, label: `FX quota this year (${payer?.name ?? "unknown"})`, usedUSD: r2(used), afterUSD: r2(used + usd), capUSD, scope: "person_year" });
    addDocs(findRule(corridor, "CN.FX.PURPOSE_DECLARATION")!);
    if (used + usd > capUSD) {
      const above = findRule(corridor, "CN.FX.ABOVE_QUOTA_CURRENT")!;
      if (above.purposes?.includes(purpose)) {
        warn(above.id, `Above the $${capUSD.toLocaleString()} quota. Allowed for ${purpose} with proof of the real expense.`);
        addDocs(above);
      } else {
        block(quota.id, `Above the $${capUSD.toLocaleString()} yearly quota and the purpose is not one that can exceed it.`);
      }
    }
    const prohibited = findRule(corridor, "CN.FX.PROHIBITED_PURPOSES")!;
    if (prohibited.purposes?.includes(purpose)) block(prohibited.id, prohibited.title);
  }

  // Anti-splitting: one invoice paid by several people where one alone would breach their limit.
  if (opts.invoiceId && payer) {
    const otherPayers = new Set(
      Object.values(world.payments)
        .filter((p) => p.invoiceId === opts.invoiceId && p.id !== opts.excludePaymentId && COUNTED.has(p.status) && p.route === route)
        .map((p) => p.payerId),
    );
    otherPayers.delete(payer.id);
    if (otherPayers.size > 0 && ev.limits.some((l) => l.scope === "person_year" || l.scope === "person_visit")) {
      const splitRule = pack.id === "cn-safe" ? "CN.FX.NO_SPLITTING" : "KINWARDEN.NO_SPLITTING";
      block(splitRule, "This bill is already being paid on this route by another family member. Splitting one bill across people's personal limits is not allowed.");
    }
  }

  ev.allowed = ev.blockers.length === 0;
  return ev;
}

export interface RouteOption {
  route: Route;
  cost?: CostBreakdown;
  evaluation: RouteEvaluation;
  arrivesAt?: string;
  meetsDeadline?: boolean;
}

export function compareRoutes(opts: {
  world: World;
  caseFile: CaseFile;
  payer: Person | undefined;
  institution: Institution;
  amount: number;
  deadline?: string;
  invoiceId?: string;
}): RouteOption[] {
  const { world, caseFile, institution, amount, deadline } = opts;
  const corridor = corridorOf(caseFile.corridor);
  return corridor.routes
    .filter((route) => route !== "card_payment" || institution.acceptsCards)
    .map((route) => {
      const cost = priceRoute({ corridor: caseFile.corridor, route, deliverAmount: amount, institution, simDate: world.now });
      const evaluation = evaluateRoute({ world, caseFile, payer: opts.payer, route, amount, currency: institution.bank.currency, invoiceId: opts.invoiceId });
      const arrivesAt = cost ? new Date(new Date(world.now).getTime() + cost.arrivesInHours * 3_600_000).toISOString() : undefined;
      return {
        route,
        cost,
        evaluation,
        arrivesAt,
        meetsDeadline: deadline && arrivesAt ? arrivesAt <= deadline : undefined,
      };
    })
    .sort((a, b) => (a.cost?.totalSource ?? Infinity) - (b.cost?.totalSource ?? Infinity));
}
