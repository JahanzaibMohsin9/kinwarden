import { describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { VaultClient } from "./vault";
import type { NearDeployment } from "./config";

const deployment = { network: "sandbox", rpcUrl: "http://127.0.0.1:1", vault: "vault.test.near", agent: "agent.test.near" } as NearDeployment;

/** A client whose RPC answers view_access_key with the given permission. */
function clientWith(permission: unknown) {
  const c = new VaultClient({ deployment, agentKey: KeyPair.fromRandom("ed25519").toString() });
  (c.provider as unknown as { viewAccessKey: () => Promise<unknown> }).viewAccessKey = async () => ({ nonce: BigInt(0), permission });
  return c;
}

const fc = (receiver_id: string, method_names: string[], allowance: string | null = "250000000000000000000000") => ({ FunctionCall: { receiver_id, method_names, allowance } });

describe("agent key check", () => {
  it("accepts a function-call key for the vault limited to propose_payment and sweep, with an allowance", async () => {
    expect(await clientWith(fc("vault.test.near", ["propose_payment", "sweep"])).checkAgentKey()).toMatchObject({ ok: true, methods: ["propose_payment", "sweep"] });
    expect((await clientWith(fc("vault.test.near", ["propose_payment"])).checkAgentKey()).ok).toBe(true);
  });

  it.each([
    ["full access", "FullAccess", /full access/],
    ["another receiver", fc("tusdc.test.near", ["propose_payment"]), /not the vault/],
    ["an approval method", fc("vault.test.near", ["propose_payment", "approve_payment"]), /only propose_payment, sweep/],
    ["any method", fc("vault.test.near", []), /any method/],
    ["no allowance", fc("vault.test.near", ["propose_payment"], null), /no gas allowance/],
  ])("refuses a key with %s", async (_label, permission, reason) => {
    const r = await clientWith(permission).checkAgentKey();
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toMatch(reason);
  });

  it("refuses a key that is not on the agent account", async () => {
    const c = new VaultClient({ deployment, agentKey: KeyPair.fromRandom("ed25519").toString() });
    (c.provider as unknown as { viewAccessKey: () => Promise<unknown> }).viewAccessKey = async () => {
      throw new Error("access key does not exist");
    };
    expect(await c.checkAgentKey()).toMatchObject({ ok: false, reason: expect.stringMatching(/not on agent.test.near/) });
  });
});
