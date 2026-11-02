// Execution evidence for the submission: plays every scenario on a running Kinwarden server, with
// on-chain anchoring on, and saves each hash-chained log (with its anchors and checks) to docs/evidence/.
//   npm run dev        (with ANCHOR_* in .env.local for on-chain anchors)
//   node scripts/evidence.mjs                   # all scenarios
//   node scripts/evidence.mjs th-medical        # one
// Scenarios 1-4 run in Replay mode: the decisions of a recorded live DeepSeek run, re-executed for real
// against the sandbox (no AI cost, same result every time). The uploaded bill runs the scripted plan.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.KINWARDEN_URL || "http://localhost:3000";
const OUT = path.join(process.cwd(), "docs", "evidence");
const ALL = ["th-medical", "uk-tuition", "pk-admission", "cn-admission", "upload"];

const json = (p, init) => fetch(BASE + p, init).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(`${p}: ${r.status} ${await r.text()}`))));
const post = (p, b) => json(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const state = () => json("/api/state");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function idle() {
  await sleep(600);
  for (let i = 0; i < 600; i++) {
    const s = await state();
    if (!s.agentBusy) return s;
    await sleep(1000);
  }
  throw new Error("agent still busy after 10 minutes");
}

async function play(id) {
  if (id === "upload") {
    await post("/api/director", { action: "mode", mode: "scripted" });
    const fd = new FormData();
    for (const [k, v] of Object.entries({ home: "PK", type: "medical", payerName: "Ayesha Khan", subjectName: "Imran Khan", alreadyAbroad: "true", sample: "true" })) fd.set(k, v);
    const { draft } = await json("/api/upload", { method: "POST", body: fd });
    await post("/api/upload/start", draft);
  } else {
    await post("/api/director", { action: "reset", scenarioId: id, mode: "replay" });
  }
  for (let step = 0; step < 60; step++) {
    let s = await idle();
    const pending = Object.values(s.world.approvals).filter((a) => !a.decision);
    if (pending.length) {
      for (const a of pending) await post(`/api/approvals/${a.id}`, { decision: "approved", method: "hold" });
      continue;
    }
    if (s.nextEvent) {
      await post("/api/director", { action: "next" });
      continue;
    }
    const inst = s.world.institutions.upl;
    if (inst && !inst.verifiedAt) {
      await post("/api/director", { action: "verify_institution" });
      continue;
    }
    break;
  }
  // let the last milestones become an anchor and confirm on-chain
  await sleep(4000);
  let s = await state();
  for (let i = 0; i < 60 && s.anchors.some((a) => a.chain?.status === "pending"); i++) {
    await sleep(2000);
    s = await state();
  }
  const checks = [];
  for (const a of s.anchors.filter((x) => x.chain?.status === "confirmed")) checks.push({ anchor: a.id, ...(await post("/api/anchors", { id: a.id })) });
  const evaluation = await json("/api/eval");
  const ledger = await json("/api/ledger");
  const evidence = { ...ledger, mode: s.world.agent.mode, recordedModel: s.model, evaluation, anchorChecks: checks, anchoring: s.anchoring };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(evidence, null, 2));
  return { id, mode: s.world.agent.mode, entries: ledger.entries.length, chainOk: ledger.verification.ok, success: evaluation.success, failed: evaluation.checks.filter((c) => !c.pass).map((c) => c.id), anchors: s.anchors, checks };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const results = [];
for (const id of ids) {
  process.stdout.write(`${id}… `);
  const r = await play(id);
  results.push(r);
  console.log(`${r.entries} entries · chain ${r.chainOk ? "ok" : "BROKEN"} · checks ${r.success ? "all pass" : "FAILED " + r.failed.join(",")} · ${r.anchors.length} anchors (${r.checks.filter((c) => c.ok).length} match the chain)`);
}

// README for the folder: one row per scenario, every anchor with its explorer link
const prev = fs.existsSync(path.join(OUT, "summary.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "summary.json"), "utf8")) : {};
for (const r of results) prev[r.id] = { at: new Date().toISOString(), mode: r.mode, entries: r.entries, chainOk: r.chainOk, success: r.success, failed: r.failed, anchors: r.anchors.map((a) => ({ seq: a.seq, note: a.note, hash: a.hash, tx: a.chain?.txHash, block: a.chain?.blockNumber, url: a.chain?.explorerUrl, matchesChain: r.checks.find((c) => c.anchor === a.id)?.ok ?? false })) };
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(prev, null, 2));
const label = { "th-medical": "1. Bangkok medical (PK→TH)", "uk-tuition": "2. London tuition (CN→GB)", "pk-admission": "3. Fake admission (PK→GB)", "cn-admission": "4. Fake study agent (CN→GB)", upload: "Uploaded bill (PK→SG)" };
const lines = [
  "# Execution evidence",
  "",
  "Generated by `node scripts/evidence.mjs` on a running Kinwarden server. Each file is the full sandbox log of one scenario: every action of the agent, the family, the institutions and the bank, SHA-256 hash-chained, with the chain's verification, the evaluator's checks, and the anchors written to the **Conflux eSpace testnet** with a re-check of each against the chain.",
  "",
  "Scenarios 1-4 run in **Replay** mode: the decisions of a recorded live DeepSeek run, re-executed for real against the sandbox. The uploaded bill runs the **scripted** plan (no AI). Live-run statistics are in [../EVAL.md](../EVAL.md).",
  "",
  "| Scenario | Mode | Log entries | Hash chain | Task checks | Anchors on-chain (match the chain) |",
  "|---|---|---|---|---|---|",
  ...ALL.filter((id) => prev[id]).map((id) => {
    const r = prev[id];
    return `| [${label[id]}](${id}.json) | ${r.mode} | ${r.entries} | ${r.chainOk ? "verified" : "broken"} | ${r.success ? "all pass" : "failed: " + r.failed.join(", ")} | ${r.anchors.filter((a) => a.tx).length} (${r.anchors.filter((a) => a.matchesChain).length}) |`;
  }),
  "",
  "## Anchors",
  "",
  ...ALL.filter((id) => prev[id]).flatMap((id) => [`**${label[id]}**`, "", ...prev[id].anchors.map((a) => `- #${a.seq} ${a.note}: \`${a.hash.slice(0, 16)}…\`${a.url ? ` → [block ${a.block}](${a.url})` : " (local only)"}`), ""]),
];
fs.writeFileSync(path.join(OUT, "README.md"), lines.join("\n"));
console.log(`Wrote ${path.relative(process.cwd(), OUT)}/README.md`);
