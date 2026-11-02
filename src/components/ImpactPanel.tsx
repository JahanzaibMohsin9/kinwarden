import fs from "node:fs";
import path from "node:path";
import { BadgeCheck, Bot, ShieldAlert, Wallet } from "lucide-react";
import redteamResults from "../../docs/redteam/results.json";

// Impact numbers for the landing page, read when the page is built from the execution evidence
// (docs/evidence, scripts/evidence.mjs) and the live evaluation (docs/eval/runs.jsonl). Every figure
// comes from the rules engine or the evaluator; nothing here is typed in by hand.

interface Evidence {
  evaluation: {
    success: boolean;
    metrics: { toolCalls: number; wakeups: number; emailsToInstitution: number; simDays: number };
    money: { sourceCurrency: string; destCurrency: string; savedVsCardSource: number; duplicateChargeCaught: number; refundedSource: number };
  };
  anchors: { chain?: { status: string } }[];
}

interface Run {
  scenarioId: string;
  mode: string;
  config?: string;
  excluded?: string;
  success: boolean;
  checks: { id: string; pass: boolean }[];
}

function readEvidence(name: "th-medical" | "uk-tuition"): Evidence | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "evidence", `${name}.json`), "utf8")) as Evidence;
  } catch {
    return null;
  }
}

function liveRuns(): Run[] {
  try {
    return fs
      .readFileSync(path.join(process.cwd(), "docs", "eval", "runs.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Run)
      .filter((r) => r.mode === "live" && !r.excluded);
  } catch {
    return [];
  }
}

const n = (x: number) => Math.round(x).toLocaleString("en-US");

interface RedteamRow {
  attempted: string | null;
  executed: string | null;
}

/** The measured numbers the landing page shows (hero counters and impact tiles). */
export function impactNumbers() {
  const th = readEvidence("th-medical");
  const uk = readEvidence("uk-tuition");
  const redteam: RedteamRow[] = redteamResults;
  const runs = liveRuns();
  // the latest agent configuration, as in docs/EVAL.md
  const current = runs.at(-1)?.config;
  const latest = runs.filter((r) => r.config === current);
  const fraud = latest.filter((r) => r.scenarioId === "pk-admission" || r.scenarioId === "cn-admission");
  const fraudSafe = fraud.filter((r) => r.checks.find((c) => c.id === "nothing_paid")?.pass).length;
  const anchored = [th, uk].reduce((s, e) => s + (e?.anchors.filter((a) => a.chain?.status === "confirmed").length ?? 0), 0);
  return {
    th,
    uk,
    latest,
    fraud,
    fraudSafe,
    anchored,
    liveRuns: { passed: latest.filter((r) => r.success).length, total: latest.length },
    attacks: { total: redteam.length, executed: redteam.filter((r) => r.executed).length, attempted: redteam.filter((r) => r.attempted).length },
    savedOneCase: th ? `${th.evaluation.money.sourceCurrency} ${n(th.evaluation.money.savedVsCardSource)}` : null,
  };
}

export function ImpactPanel() {
  const { th, uk, latest, fraud, fraudSafe, anchored } = impactNumbers();
  if (!th || !latest.length) return null;

  const tiles = [
    {
      icon: Wallet,
      big: `${th.evaluation.money.sourceCurrency} ${n(th.evaluation.money.savedVsCardSource)}`,
      label: "saved on one hospital case",
      detail: `against paying the same bills by card, plus a ${th.evaluation.money.destCurrency} ${n(th.evaluation.money.duplicateChargeCaught)} duplicate charge caught and the excess deposit refunded${uk ? `. London tuition: ${uk.evaluation.money.sourceCurrency} ${n(uk.evaluation.money.savedVsCardSource)} saved` : ""}.`,
    },
    {
      icon: Bot,
      big: `${th.evaluation.metrics.toolCalls} actions`,
      label: "handled for the family",
      detail: `over ${Math.round(th.evaluation.metrics.simDays)} days: ${th.evaluation.metrics.emailsToInstitution} emails to the hospital, ${th.evaluation.metrics.wakeups} times the agent picked the case up again. The family's part: approve with a fingerprint.`,
    },
    {
      icon: ShieldAlert,
      big: `${fraudSafe} of ${fraud.length}`,
      label: "fake-agent cases stopped",
      detail: "live AI runs of the two fake-admission scenarios (Pakistan and China): nothing paid to the agent, the university checked first, the family told it isn't their fault.",
    },
    {
      icon: BadgeCheck,
      big: `${latest.filter((r) => r.success).length} of ${latest.length}`,
      label: "live AI runs passed every check",
      detail: `on the current agent, across all scenarios (details in docs/EVAL.md)${anchored ? `; ${anchored} milestones of the evidence runs anchored on a public blockchain` : ""}.`,
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <h2 className="text-[28px] font-bold tracking-tight">What it does for a family</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-ink-2">Measured on the sandbox scenarios, not estimated. Sandbox rates; no real money moved.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-[var(--radius)] border border-line bg-surface p-5 shadow-card">
            <t.icon size={20} className="text-brand" />
            <p className="num mt-3 text-[26px] font-bold leading-tight tracking-tight">{t.big}</p>
            <p className="text-[14px] font-semibold">{t.label}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
