import type { World } from "@/domain/types";

// Privacy firewall: personal data is replaced with tokens before anything is
// sent to the LLM, and put back only inside our own code (tool inputs, emails,
// family messages, payment references). The model works with "[PERSON_1]" and
// "[PATIENT_REF_1]"; the hospital still receives the real name and HN.
// Institution data (names, verified bank accounts, amounts, dates) is business
// information the agent needs and stays visible.

export type PiiKind = "PERSON" | "PERSON_ID" | "PATIENT_REF" | "STUDENT_ID" | "CARD" | "PASSPORT" | "MEDICAL";

/** Medical details the agent doesn't need to see to pay a bill (amounts, dates and urgency stay visible). */
const MEDICAL_TERMS = [
  "chest pain",
  "heart attack",
  "coronary",
  "angiogram",
  "angiography",
  "angioplasty",
  "stent",
  "PCI",
  "cardiologist",
  "cardiology",
  "cath lab",
  "troponin",
  "ECG",
  "CCU",
  "heart",
  "cardiac",
  "drug-eluting",
  "catheterisation",
  "catheterization",
  "myocardial",
  "infarction",
];

interface Entry {
  token: string;
  kind: PiiKind;
  real: string;
  /** every spelling that maps to this token, longest first */
  patterns: string[];
}

export interface Vault {
  mask: (text: string) => string;
  unmask: (text: string) => string;
  /** restores tool inputs: family-facing fields (text, narration, rationale) in the family's script, the rest in Latin script */
  unmaskDeep: <T>(value: T) => T;
  /** what was withheld from the model in the text masked so far, by kind */
  withheld: () => Partial<Record<PiiKind, number>>;
  entries: { token: string; kind: PiiKind }[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLatin = (s: string) => /^[\p{Script=Latin}\d\s.'-]+$/u.test(s);
const isHan = (s: string) => /^\p{Script=Han}+$/u.test(s);

/** Name spellings that should be hidden: the full name, each part, and Chinese given names. */
export function nameForms(name: string): string[] {
  const forms = new Set<string>([name]);
  for (const part of name.split(/\s+/)) {
    if (isHan(part)) {
      forms.add(part);
      if (part.length >= 3) forms.add(part.slice(1)); // 林雨萱 → 雨萱
    } else if (part.length >= 3) forms.add(part);
  }
  // "林伟 Lin Wei": both the Chinese and the Latin spelling on their own
  const latin = name.split(/\s+/).filter((p) => isLatin(p));
  if (latin.length >= 2) forms.add(latin.join(" "));
  return [...forms];
}

export function buildVault(w: World, caseId: string): Vault {
  const c = w.cases[caseId];
  const entries: Entry[] = [];
  const counters: Record<string, number> = {};
  const add = (kind: PiiKind, real: string, patterns: string[]) => {
    if (!real || entries.some((e) => e.real === real && e.kind === kind)) return;
    counters[kind] = (counters[kind] ?? 0) + 1;
    entries.push({ token: `[${kind}_${counters[kind]}]`, kind, real, patterns });
  };

  // a name part shared by two people ("Tariq" in Tariq Mahmood and Sana Tariq) goes to the person whose
  // first name it is, as in "Mr. Tariq"; otherwise to the first person listed. Full names always win.
  const owner = new Map<string, string>();
  for (const p of c.people) if (p.name.split(/\s+/)[0]) owner.set(p.name.split(/\s+/)[0], p.id);
  for (const p of c.people) for (const f of nameForms(p.name)) if (!owner.has(f)) owner.set(f, p.id);
  for (const p of c.people) add("PERSON", p.name, nameForms(p.name).filter((f) => f === p.name || owner.get(f) === p.id));

  for (const p of c.people) if (p.passport) add("PASSPORT", p.passport, [p.passport]);
  // internal IDs can carry names ("p_tariq"): the model gets [PERSON_ID_1] and the tools get the real ID back
  for (const p of c.people) add("PERSON_ID", p.id, [p.id]);

  const refs = new Set(Object.values(w.invoices).filter((i) => i.caseId === caseId && i.patientRef).map((i) => i.patientRef!));
  for (const ref of refs) {
    const digits = ref.replace(/^(HN|ID)\s*/i, "");
    add(c.type === "tuition" ? "STUDENT_ID" : "PATIENT_REF", digits, [digits]);
  }
  // the student ID is in the family's own brief before any invoice exists
  for (const m of c.brief.matchAll(/\b[A-Z]{2}\d{7}\b/g)) add("STUDENT_ID", m[0], [m[0]]);
  for (const m of c.brief.matchAll(/\b\d{2}-\d{6}\b/g)) add("PATIENT_REF", m[0], [m[0]]);

  for (const card of w.cards.filter((k) => c.people.some((p) => p.id === k.personId))) {
    const last4 = card.label.match(/\d{4}$/)?.[0];
    add("CARD", card.label, [card.label, ...(last4 ? [`•• ${last4}`, `••${last4}`, `ending ${last4}`, `ending in ${last4}`] : [])]);
  }

  if (c.type === "medical") for (const term of MEDICAL_TERMS) add("MEDICAL", term, [term]);

  // one regex, longest spellings first, so "Tariq Mahmood" wins over "Tariq"
  const all = entries.flatMap((e) => e.patterns.map((p) => ({ p, e }))).sort((a, b) => b.p.length - a.p.length);
  const byPattern = new Map(all.map(({ p, e }) => [p.toLowerCase(), e]));
  const source = all
    .map(({ p }) =>
      isLatin(p) || /^[\w-]+$/.test(p) ? `(?<![\\p{L}\\d_])${escapeRe(p)}(?![\\p{L}\\d_])` : escapeRe(p),
    )
    .join("|");
  const re = source ? new RegExp(source, "giu") : null;
  const withheld = new Map<string, PiiKind>();

  const mask = (text: string) =>
    re
      ? text.replace(re, (m) => {
          const e = byPattern.get(m.toLowerCase())!;
          withheld.set(e.token, e.kind);
          return e.token;
        })
      : text;
  const tokenRe = /\[(PERSON_ID|PERSON|PATIENT_REF|STUDENT_ID|CARD|PASSPORT|MEDICAL)_\d+\]/g;
  // a bilingual name ("林雨萱 Lin Yuxuan") comes back in one script: the family's own in what they read,
  // the Latin spelling in emails and references for institutions abroad
  const familyScript = c.lang === "zh" ? "han" : "latin";
  const pick = (e: Entry, script?: "han" | "latin") => {
    if (e.kind !== "PERSON" || !script) return e.real;
    const parts = e.real.split(/\s+/);
    const chosen = script === "han" ? parts.filter(isHan) : parts.filter((x) => !isHan(x));
    return chosen.length ? chosen.join(" ") : e.real;
  };
  const unmaskAs = (text: string, script?: "han" | "latin") =>
    text.replace(tokenRe, (t) => {
      const e = entries.find((x) => x.token === t);
      return e ? pick(e, script) : t;
    });
  const unmask = (text: string) => unmaskAs(text);
  const FAMILY_FIELDS = new Set(["text", "narration", "rationale"]);
  const unmaskDeep = <T>(v: T, key?: string): T => {
    if (typeof v === "string") return unmaskAs(v, key && FAMILY_FIELDS.has(key) ? familyScript : "latin") as T;
    if (Array.isArray(v)) return v.map((x) => unmaskDeep(x, key)) as T;
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmaskDeep(x, k)])) as T;
    return v;
  };

  return {
    mask,
    unmask,
    unmaskDeep: (v) => unmaskDeep(v),
    withheld: () => {
      const out: Partial<Record<PiiKind, number>> = {};
      for (const kind of withheld.values()) out[kind] = (out[kind] ?? 0) + 1;
      return out;
    },
    entries: entries.map(({ token, kind }) => ({ token, kind })),
  };
}
