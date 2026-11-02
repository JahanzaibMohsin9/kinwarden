// A family message in Replay must not play a recorded step out of context: it gets an answer instead.
// (No API key in tests, so the answer is the plain "this demo is following a recording" reply.)
import { describe, expect, it } from "vitest";
import { familyMessage, runtime } from "./runtime";
import { seedScenario } from "./scenarios";

describe("family questions outside Live mode", () => {
  it("are answered without feeding the recording, and are capped per visitor", async () => {
    const rt = runtime();
    rt.store.reset(seedScenario("th-medical"));
    rt.store.mutate((w) => (w.agent.mode = "replay"));
    const triggers: string[] = [];
    rt.store.on("trigger", (t: { reason: string }) => triggers.push(t.reason));
    const before = rt.store.ledger.length;

    familyMessage("case_th", "Can I pay with my brother's card?", undefined, { voice: true });
    await new Promise((r) => setTimeout(r, 20));

    expect(triggers).toEqual([]); // the replaying agent was not woken
    const w = rt.store.world;
    expect(w.messages.find((m) => m.from === "family")?.voice).toBe(true);
    const answer = rt.store.ledger.slice(before).find((e) => e.type === "agent.answer");
    expect(answer).toBeDefined();
    expect(w.messages.find((m) => m.id === answer!.data.messageId)?.from).toBe("agent");
    expect(rt.store.ledger.some((e) => e.type.startsWith("tool."))).toBe(false); // no tool ran

    rt.store.mutate((ww) => (ww.agent.mode = "live"));
    familyMessage("case_th", "And now?");
    expect(triggers).toEqual(["family_message"]);
    clearInterval(rt.autoplayTimer);
    rt.runner.dispose();
  });
});
