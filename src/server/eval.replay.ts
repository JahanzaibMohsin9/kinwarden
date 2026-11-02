import { describe, expect, it } from "vitest";
import { Store } from "./store";
import { AgentRunner } from "./agent/runner";
import { seedScenario } from "./scenarios";
import { advanceToNext } from "./sim/engine";
import { verifyChain } from "./hash";
import { evaluateRun } from "./evaluate";

// Offline evaluation for CI: replays the curated live runs in recordings/ (the model's recorded decisions,
// executed for real against today's tools, safety gateway and rules engine) and scores each with evaluateRun,
// the same checks scripts/eval.mjs applies to live runs. No API key and no model call needed.
//   npm run eval:replay

const MAX_STEPS = 45;

async function replay(scenarioId: string) {
  const store = new Store();
  store.load(() => seedScenario(scenarioId));
  store.reset(seedScenario(scenarioId));
  store.world.agent.mode = "replay";
  const runner = new AgentRunner(store);
  runner.resetSession();
  (globalThis as Record<string, unknown>).__kinwarden = { store, runner, autoplayTimer: setInterval(() => {}, 1 << 30), runnerClass: AgentRunner };
  const { decideApproval } = await import("./runtime");
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 1));
    for (let i = 0; i < 2000 && (runner.isBusy || store.world.agent.status === "working"); i++) await new Promise((r) => setTimeout(r, 5));
  };

  // Same loop as scripts/eval.mjs: approve whatever the agent proposes, otherwise advance the world.
  for (let i = 0; i < MAX_STEPS; i++) {
    const pending = Object.values(store.world.approvals).filter((a) => !a.decision);
    if (pending.length) for (const a of pending) decideApproval(a.id, "approved", "hold");
    else if (store.world.schedule.length) advanceToNext(store);
    else break;
    await settle();
  }
  return store;
}

describe("Replay evaluation (curated live runs)", () => {
  it.each(["th-medical", "uk-tuition", "pk-admission", "cn-admission"])("%s passes every evaluation check", async (scenarioId) => {
    const store = await replay(scenarioId);
    const ev = evaluateRun(store.world, store.ledger);
    expect(ev.mode).toBe("replay");
    expect(ev.checks.filter((c) => !c.pass)).toEqual([]);
    expect(ev.metrics.toolCalls).toBeGreaterThan(0);
    expect(ev.metrics.llmCalls).toBe(0);
    expect(verifyChain(store.ledger).ok).toBe(true);
  });
});
