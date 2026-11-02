// Agent evaluation: run a scenario end to end N times against a running Kinwarden server
// and record whether each run completed the task safely, plus steps, tokens and money.
//   node scripts/eval.mjs run th-medical 10 [live|replay|scripted]   # appends to docs/eval/runs.jsonl
//   node scripts/eval.mjs report                                      # writes docs/EVAL.md and docs/eval/chart.svg
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.KINWARDEN_URL || "http://localhost:3000";
const OUT_DIR = path.join(process.cwd(), "docs", "eval");
const RUNS_FILE = path.join(OUT_DIR, "runs.jsonl");

// What changed inside a configuration while its runs were being collected, so the report says so.
const CONFIG_NOTES = {
  "v3.1 (China fake-agent scenario, explicit no-blame wording)":
    "Within this configuration, the make-up runs after the DeepSeek outage of 15 Oct also had the uploaded-bill prompt section and gateway checks (they only act on uploaded bills), and the last two Bangkok runs also retried connections that DeepSeek dropped mid-response. Two earlier Bangkok runs that failed only because of such a dropped connection (all task checks passed) count as failures.",
};
const MAX_STEPS = 45;

// USD per million tokens, DeepSeek peak-hour list prices (api-docs.deepseek.com/quick_start/pricing, read 14 Oct 2026).
// Off-peak is half. Peak is the conservative figure to quote; re-check before the deadline.
const PRICES = {
  "deepseek-v4-pro": { input: 1.32, cachedInput: 0.044, output: 3.96 },
  "deepseek-flash": { input: 0.3, cachedInput: 0.006, output: 1.2 },
};

const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (p) => fetch(BASE + p).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIdle(maxSec = 400) {
  await sleep(800);
  for (let i = 0; i < maxSec; i++) {
    const s = await get("/api/state");
    if (!s.agentBusy) return s;
    await sleep(1000);
  }
  throw new Error("agent still busy after " + maxSec + "s");
}

async function runOnce(scenarioId, mode) {
  await post("/api/director", { action: "reset", scenarioId, mode });
  const t0 = Date.now();
  let failure = null;
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const s = await get("/api/state");
      const pending = Object.values(s.world.approvals).filter((a) => !a.decision);
      if (pending.length) {
        for (const a of pending) await post(`/api/approvals/${a.id}`, { decision: "approved", method: "hold" });
      } else if (s.nextEvent) {
        await post("/api/director", { action: "next" });
      } else break;
      await waitIdle();
    }
  } catch (err) {
    failure = String(err?.message ?? err);
  }
  const ev = await get("/api/eval");
  return { at: new Date().toISOString(), config: process.env.EVAL_CONFIG ?? "v3 (privacy firewall, case closing)", wallSeconds: Math.round((Date.now() - t0) / 1000), failure, ...ev };
}

function costUSD(m) {
  const p = PRICES[m.models?.[0]?.split(" · ").at(-1) ?? "deepseek-v4-pro"] ?? PRICES["deepseek-v4-pro"];
  if (!p || !m.inputTokens) return null;
  const uncached = m.inputTokens - m.cachedInputTokens;
  return (uncached * p.input + m.cachedInputTokens * p.cachedInput + m.outputTokens * p.output) / 1e6;
}

const [cmd, scenario, nArg, modeArg] = process.argv.slice(2);
if (cmd === "run") {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const n = Number(nArg ?? 1);
  for (let i = 0; i < n; i++) {
    const r = await runOnce(scenario ?? "th-medical", modeArg ?? "live");
    fs.appendFileSync(RUNS_FILE, JSON.stringify(r) + "\n");
    const failed = r.checks.filter((c) => !c.pass).map((c) => c.id);
    const cost = costUSD(r.metrics);
    console.log(
      `${r.scenarioId} #${i + 1}: ${r.success ? "SUCCESS" : "FAIL " + failed.join(",")} · ${r.metrics.wakeups} wake-ups · ${r.metrics.toolCalls} tools · ${r.metrics.emailsToInstitution} emails · ${r.metrics.llmCalls} LLM calls${r.metrics.toolErrors ? ` · ${r.metrics.toolErrors} tool calls rejected or failed` : ""}${cost != null ? ` · $${cost.toFixed(3)}` : ""} · ${r.wallSeconds}s${r.failure ? " · " + r.failure : ""}`,
    );
  }
} else if (cmd === "report") {
  report();
} else {
  console.log("commands: run <scenario> <n> [mode] | report");
}

function report() {
  const runs = fs.existsSync(RUNS_FILE) ? fs.readFileSync(RUNS_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const current = process.env.EVAL_CONFIG ?? "v3.1 (China fake-agent scenario, explicit no-blame wording)";
  const excluded = runs.filter((r) => r.excluded);
  const live = runs.filter((r) => r.mode === "live" && !r.excluded && (r.config ?? current) === current);
  const earlier = runs.filter((r) => r.mode === "live" && r.config && r.config !== current);
  const by = {};
  for (const r of live) (by[r.scenarioId] ??= []).push(r);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const rows = Object.entries(by).map(([id, rs]) => {
    const costs = rs.map((r) => costUSD(r.metrics)).filter((x) => x != null);
    const checkIds = rs[0].checks.map((c) => c.id);
    return {
      id,
      n: rs.length,
      success: rs.filter((r) => r.success).length,
      wake: avg(rs.map((r) => r.metrics.wakeups)),
      tools: avg(rs.map((r) => r.metrics.toolCalls)),
      emails: avg(rs.map((r) => r.metrics.emailsToInstitution)),
      llm: avg(rs.map((r) => r.metrics.llmCalls)),
      cost: costs.length ? avg(costs) : null,
      agentMin: avg(rs.map((r) => r.metrics.agentSeconds)) / 60,
      money: rs.find((r) => r.success)?.money ?? rs[0].money,
      checks: checkIds.map((cid) => ({ id: cid, label: rs[0].checks.find((c) => c.id === cid).label, pass: rs.filter((r) => r.checks.find((c) => c.id === cid)?.pass).length })),
      failures: rs.filter((r) => !r.success).map((r) => r.checks.filter((c) => !c.pass).map((c) => c.id).join(", ") + (r.failure ? ` (${r.failure})` : "")),
    };
  });
  const fmt = (n, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  const lines = [
    "# Agent evaluation",
    "",
    `Generated by \`node scripts/eval.mjs report\` from ${live.length} live runs in [eval/runs.jsonl](eval/runs.jsonl). Each run plays a scenario from case opening to refund on a fresh sandbox, approving every payment the agent proposes, and is then checked by [src/server/evaluate.ts](../src/server/evaluate.ts). A run counts as a success only if every check passes.`,
    "",
    "![Success rate per scenario](eval/chart.svg)",
    "",
    "| Scenario | Runs | Success | Wake-ups | Tool calls | Emails | LLM calls | AI cost / case | Agent time |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${r.n} | ${r.success}/${r.n} (${fmt((100 * r.success) / r.n)}%) | ${fmt(r.wake, 1)} | ${fmt(r.tools, 1)} | ${fmt(r.emails, 1)} | ${fmt(r.llm, 1)} | ${r.cost != null ? "$" + fmt(r.cost, 3) : "n/a"} | ${fmt(r.agentMin, 1)} min |`),
    "",
    `Agent configuration: **${current}**. AI cost uses the token counts the provider reported and DeepSeek's peak-hour list prices in \`scripts/eval.mjs\` (off-peak is half; re-check prices before quoting).`,
    "",
    ...(CONFIG_NOTES[current] ? [CONFIG_NOTES[current], ""] : []),
    ...(excluded.length ? [`Excluded: ${excluded.length} run${excluded.length > 1 ? "s" : ""} that stopped because the model provider was unavailable (${[...new Set(excluded.map((r) => r.excluded))].join("; ")}); they say nothing about the agent and are kept in runs.jsonl.`, ""] : []),
    ...(earlier.length
      ? [`Earlier configuration${new Set(earlier.map((r) => r.config)).size > 1 ? "s" : ""} (${[...new Set(earlier.map((r) => r.config))].join(", ")}): ${earlier.filter((r) => r.success).length}/${earlier.length} live runs succeeded (${[...new Set(earlier.map((r) => r.scenarioId))].join(", ")}).`, ""]
      : []),
  ];
  for (const r of rows) {
    const m = r.money;
    lines.push(
      `## ${r.id}`,
      "",
      "| Check | Passed |",
      "|---|---|",
      ...r.checks.map((c) => `| ${c.label} | ${c.pass}/${r.n} |`),
      "",
      `Money (from the rules engine, one successful run): paid ${m.sourceCurrency} ${fmt(m.paidSource)}, refunded ${m.sourceCurrency} ${fmt(m.refundedSource)}; the same payments by card would have cost ${m.sourceCurrency} ${fmt(m.baselineCardSource)}, so the routes chosen saved ${m.sourceCurrency} ${fmt(m.savedVsCardSource)}${m.duplicateChargeCaught ? `, and the duplicate charge caught was ${m.destCurrency} ${fmt(m.duplicateChargeCaught)}` : ""}.`,
      "",
      ...(r.failures.length ? ["Failed runs:", "", ...r.failures.map((f) => `- ${f}`), ""] : []),
    );
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "docs", "EVAL.md"), lines.join("\n"));
  fs.writeFileSync(path.join(OUT_DIR, "chart.svg"), chart(rows));
  console.log(lines.slice(6, 9 + rows.length).join("\n"));
}

// Horizontal bars: success rate per scenario, with the run count as a label.
function chart(rows) {
  const W = 640, rowH = 44, top = 56, left = 150, right = 70;
  const H = top + rows.length * rowH + 30;
  const barW = W - left - right;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const label = { "th-medical": "Bangkok medical", "uk-tuition": "London tuition", "pk-admission": "Fake admission (PK)", "cn-admission": "Fake study agent (CN)", upload: "Uploaded bill" };
  const bars = rows
    .map((r, i) => {
      const y = top + i * rowH;
      const pct = r.success / r.n;
      return `<text x="${left - 12}" y="${y + 19}" text-anchor="end" class="l">${esc(label[r.id] ?? r.id)}</text>
<rect x="${left}" y="${y + 4}" width="${barW}" height="22" rx="4" class="track"/>
<rect x="${left}" y="${y + 4}" width="${Math.max(2, barW * pct)}" height="22" rx="4" class="bar"/>
<text x="${left + barW + 10}" y="${y + 20}" class="v">${Math.round(pct * 100)}%</text>
<text x="${left}" y="${y + 40}" class="s">${r.success} of ${r.n} live runs completed every check</text>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, system-ui, sans-serif">
<style>.t{font-size:15px;font-weight:600;fill:#16302b}.l{font-size:13px;fill:#16302b}.v{font-size:13px;font-weight:600;fill:#16302b}.s{font-size:11px;fill:#5b6f6a}.track{fill:#e9e3d6}.bar{fill:#0b8a78}</style>
<rect width="100%" height="100%" fill="#faf7f0"/>
<text x="20" y="30" class="t">Kinwarden live agent (DeepSeek): end-to-end success rate</text>
${bars}
</svg>
`;
}
