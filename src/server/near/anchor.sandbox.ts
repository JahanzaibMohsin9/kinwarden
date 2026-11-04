// G4 on a local NEAR node: the app anchors its activity log on the vault with the agent's restricted
// key, the anchor reads back from the chain, and editing an anchored log entry is detected.
// Run: npm run test:near.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sandbox } from "near-sandbox";
import type { NearDeployment } from "./config";
import { VaultClient } from "./vault";
import { nearPublisher } from "./anchors";
import { AnchorService } from "../anchor/service";
import { Store } from "../store";
import { seedScenario } from "../scenarios";
import { startSandboxDeployment, writeEvidence } from "./sandbox-kit";

const CASE = "case-th-anchor";
let sandbox: Sandbox;
let deployment: NearDeployment;
let client: VaultClient;

beforeAll(async () => {
  let agentKey: string;
  ({ sandbox, deployment, agentKey } = await startSandboxDeployment(CASE));
  client = new VaultClient({ deployment, agentKey });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

async function settled(store: Store, id: string) {
  for (let i = 0; i < 200; i++) {
    const a = store.anchors.find((x) => x.id === id);
    if (a?.chain?.status === "confirmed" || a?.chain?.status === "failed") return a;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("anchor did not settle");
}

describe("activity log anchored on the NEAR vault", () => {
  it("anchors the log head, reads it back, and detects a later edit", async () => {
    const store = new Store();
    store.reset(seedScenario("th-medical"));
    store.log({ actor: "family", type: "case.opened", caseId: "case_th", narration: "Case opened", data: {} });
    store.log({ actor: "family", type: "approval.approved", caseId: "case_th", narration: "Deposit approved in the wallet", data: {} });

    const service = new AnchorService(store, nearPublisher(client, CASE, () => "run001"), { retryMs: 200 });
    const anchor = service.flush("payment approved")!;
    const done = await settled(store, anchor.id);
    expect(done.chain).toMatchObject({ chainId: "near:sandbox", contract: deployment.vault, status: "confirmed" });

    // The vault holds the same head and sequence number, under the run tag.
    expect(await client.view("get_anchor", { case_id: CASE, index: "0" })).toMatchObject({ seq: String(anchor.seq), head: anchor.hash, label: "run001:th-medical:payment approved" });
    const clean = await service.check(anchor.id);
    expect(clean).toMatchObject({ ok: true, onChain: { head: anchor.hash, seq: anchor.seq } });

    // Someone edits an anchored entry afterwards: the check fails and says where.
    store.tamper(anchor.seq, "Deposit approved by the agent");
    const tampered = await service.check(anchor.id);
    expect(tampered.ok).toBe(false);
    expect(tampered.reason).toMatch(/changed after it was anchored/);
    writeEvidence("anchor-sandbox.json", { anchor: done, clean, tampered });
    service.dispose();
  });
});
