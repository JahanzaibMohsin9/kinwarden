import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionId, SHARED_SESSION, DEFAULT_SESSION } from "./session";

const req = (cookie?: string) => new Request("http://localhost/api/state", cookie ? { headers: { cookie } } : undefined);

describe("private sandboxes", () => {
  beforeAll(() => {
    process.env.KINWARDEN_SESSIONS = "per-visitor";
    process.env.KINWARDEN_DEFAULT_MODE = "replay";
  });
  afterAll(() => {
    delete process.env.KINWARDEN_SESSIONS;
    delete process.env.KINWARDEN_DEFAULT_MODE;
  });

  it("reads the visitor's cookie; no cookie or a malformed one means the shared world", () => {
    const id = "a".repeat(32);
    expect(sessionId(req(`theme=dark; cp_sid=${id}`))).toBe(id);
    expect(sessionId(req())).toBe(SHARED_SESSION);
    expect(sessionId(req("cp_sid=../../etc"))).toBe(SHARED_SESSION);
    delete process.env.KINWARDEN_SESSIONS;
    expect(sessionId(req(`cp_sid=${id}`))).toBe(DEFAULT_SESSION);
    process.env.KINWARDEN_SESSIONS = "per-visitor";
  });

  it("gives each visitor their own world, in their own folder, starting in Replay", async () => {
    const { directorAction, publicState, runtime } = await import("./runtime");
    const a = "a1".repeat(16);
    const b = "b2".repeat(16);
    directorAction({ action: "reset", scenarioId: "uk-tuition" }, a);
    directorAction({ action: "reset", scenarioId: "cn-admission" }, b);
    directorAction({ action: "next" }, b);
    expect(publicState(a).world.scenarioId).toBe("uk-tuition");
    expect(publicState(b).world.scenarioId).toBe("cn-admission");
    expect(publicState(a).ledger.some((e) => e.type === "case.opened")).toBe(false);
    expect(publicState(b).ledger.some((e) => e.type === "case.opened")).toBe(true);
    expect(runtime(a).store.dataDir).not.toBe(runtime(b).store.dataDir);
    expect(runtime(a).store.dataDir).toMatch(/sessions[\\/]a1a1/);
    expect(publicState("c3".repeat(16)).world.agent.mode).toBe("replay");
    for (const sid of [a, b, "c3".repeat(16)]) {
      const rt = runtime(sid);
      clearInterval(rt.autoplayTimer);
      rt.runner.dispose();
    }
  });
});
