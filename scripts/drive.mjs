// Drive a running Kinwarden server from the command line (handy for live-agent checks).
//   node scripts/drive.mjs reset th-medical live
//   node scripts/drive.mjs next            # advance to the next event, wait for the agent
//   node scripts/drive.mjs approve         # approve every pending payment, wait for the agent
//   node scripts/drive.mjs run 12          # loop: approve pending, else advance (12 times)
//   node scripts/drive.mjs log 30          # print the last 30 ledger entries
const BASE = process.env.KINWARDEN_URL || "http://localhost:3000";

const post = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const state = () => fetch(BASE + "/api/state").then((r) => r.json());

async function waitIdle(maxSec = 300) {
  await new Promise((r) => setTimeout(r, 800));
  for (let i = 0; i < maxSec; i++) {
    const s = await state();
    if (!s.agentBusy) return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("agent still busy");
}

function printNew(s, fromSeq) {
  for (const e of s.ledger.filter((x) => x.seq > fromSeq)) {
    const d = e.data ?? {};
    const tag = d.decision ? ` [${d.decision}]` : "";
    let line = `${String(e.seq).padStart(3)} ${e.actor.padEnd(8)} ${e.type}${tag}`;
    if (e.narration) line += `  · ${e.narration}`;
    if (e.type === "agent.error") line += `  !! ${d.error}`;
    if (e.type === "agent.fallback") line += `  ${d.from} -> ${d.to}: ${d.error}`;
    if (e.type === "agent.summary") line += `  » ${String(d.text).slice(0, 200)}`;
    if (d.decision === "error" || d.decision === "blocked") line += `  » ${JSON.stringify(d.result).slice(0, 220)}`;
    console.log(line);
  }
}

async function step(kind) {
  const before = await state();
  const from = before.ledger.at(-1)?.seq ?? 0;
  if (kind === "approve") {
    const pend = Object.values(before.world.approvals).filter((a) => !a.decision);
    for (const a of pend) await post(`/api/approvals/${a.id}`, { decision: "approved", method: "hold" });
    if (!pend.length) return false;
  } else {
    if (!before.nextEvent) return false;
    console.log(`\n=== ${before.nextEvent.label}`);
    await post("/api/director", { action: "next" });
  }
  const t0 = Date.now();
  const s = await waitIdle();
  printNew(s, from);
  console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return true;
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === "reset") {
  await post("/api/director", { action: "reset", scenarioId: a1 ?? "th-medical", mode: a2 ?? "live" });
  console.log("reset", a1, a2);
} else if (cmd === "next") await step("next");
else if (cmd === "approve") await step("approve");
else if (cmd === "run") {
  for (let i = 0; i < Number(a1 ?? 10); i++) {
    const s = await state();
    const pending = Object.values(s.world.approvals).some((a) => !a.decision);
    const did = await step(pending ? "approve" : "next");
    if (!did) break;
  }
  const s = await state();
  console.log(`\nerror: ${s.world.agent.lastError ?? "none"} · chain ok: ${s.chain.ok} · payments: ${Object.values(s.world.payments).map((p) => `${p.route} ${p.amount} ${p.status}`).join(", ")}`);
} else if (cmd === "log") {
  const s = await state();
  printNew(s, (s.ledger.at(-1)?.seq ?? 0) - Number(a1 ?? 30));
} else {
  console.log("commands: reset <scenario> <mode> | next | approve | run <n> | log <n>");
}
