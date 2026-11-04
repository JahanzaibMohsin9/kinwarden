// G4 on a local NEAR node: the agent's real key, used directly against the chain with Kinwarden's
// gateway bypassed, cannot approve, enroll, authorize, withdraw, move tokens, change its own key or
// code, or propose outside the verifier's invoices and the family's limits. Then the family switches
// the agent off, and finally the agent's key is deleted. Run: npm run test:near.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Account, KeyPair, type KeyPairString } from "near-api-js";
import type { Sandbox } from "near-sandbox";
import type { NearDeployment } from "./config";
import { VaultClient } from "./vault";
import { BYPASS_ATTEMPTS, readBalances, runBypass } from "./bypass";
import { startSandboxDeployment, writeEvidence } from "./sandbox-kit";
import * as setup from "../../../scripts/near/lib.mjs";

const CASE = "case-th-bypass";
const INVOICE = "bypass-srh-dep-0001";
let sandbox: Sandbox;
let deployment: NearDeployment;
let keys: Record<string, string>;
let agentKey: string;
let family: Account;
let client: VaultClient;
let proposalId: string;

/** What each attempt must be refused with. */
const EXPECTED: Record<string, { by: "protocol" | "contract"; reason: string | RegExp }> = {
  "approve-with-deposit": { by: "protocol", reason: "DepositWithFunctionCall" },
  "approve-without-deposit": { by: "protocol", reason: "MethodNameMismatch" },
  "enroll-own-account": { by: "protocol", reason: "MethodNameMismatch" },
  "authorize-invoice": { by: "protocol", reason: "MethodNameMismatch" },
  "switch-agent-on": { by: "protocol", reason: "MethodNameMismatch" },
  withdraw: { by: "protocol", reason: "MethodNameMismatch" },
  "token-transfer": { by: "protocol", reason: "DepositWithFunctionCall" },
  "token-transfer-no-deposit": { by: "protocol", reason: "ReceiverMismatch" },
  "add-full-key": { by: "protocol", reason: "RequiresFullAccess" },
  "deploy-code": { by: "protocol", reason: "RequiresFullAccess" },
  "send-near": { by: "protocol", reason: "RequiresFullAccess" },
  "propose-unauthorized-invoice": { by: "contract", reason: "E_INVOICE_NOT_FOUND" },
  "propose-over-limit": { by: "contract", reason: /^E_(CAP_PAYMENT|INVOICE_CEILING)$/ },
};

beforeAll(async () => {
  ({ sandbox, deployment, keys, agentKey, family } = await startSandboxDeployment(CASE));
  const rpc = deployment.rpcUrl;
  const verifier = setup.account(rpc, deployment.verifier, keys[deployment.verifier]);
  await setup.authorizeInvoices({
    verifier,
    rpc,
    deployment,
    log: () => {},
    invoices: [{ vaultInvoiceId: INVOICE, vaultCaseId: CASE, payeeId: "srh", ceilingUnits: (BigInt(9_000) * setup.TUSDC).toString(), number: "SRH-DEP-0001" }],
  });
  client = new VaultClient({ deployment, agentKey });
  const p = await client.propose({ caseId: CASE, invoiceId: INVOICE, requestId: "bypass-req-1", amountUnits: (BigInt(7_000) * setup.TUSDC).toString(), ttlSeconds: 3600 });
  proposalId = p.proposal_id;
});

afterAll(async () => {
  await sandbox?.tearDown();
});

describe("the agent's real key, with the gateway bypassed", () => {
  it("reports exactly what the key may do, apart from the payment limits", async () => {
    const run = await runBypass({ provider: client.provider, deployment, agentKey, caseId: CASE, pendingProposalId: proposalId, authorizedInvoiceId: INVOICE });
    writeEvidence("bypass-sandbox.json", run);

    expect(run.permissions.appKey).toMatchObject({ kind: "FunctionCall", receiver: deployment.vault, methods: ["propose_payment", "sweep", "anchor_log"], allowanceNear: "0.250" });
    expect(run.permissions.otherKeys).toEqual([expect.objectContaining({ kind: "FullAccess" })]);
    expect(run.permissions.observedAt.blockHeight).toBeGreaterThan(0);

    expect(run.results.map((r) => r.id)).toEqual(BYPASS_ATTEMPTS.map((a) => a.id));
    for (const r of run.results) {
      const want = EXPECTED[r.id];
      expect(r.refusedBy, `${r.id}: ${r.reason}`).toBe(want.by);
      if (typeof want.reason === "string") expect(r.reason, r.id).toBe(want.reason);
      else expect(r.reason, r.id).toMatch(want.reason);
    }

    // Nothing an attacker could gain moved, and the family's pending proposal is untouched.
    expect(run.after).toEqual(run.before);
    expect(BigInt(run.after.caseReserved)).toBe(BigInt(7_000) * setup.TUSDC);
    expect(run.held).toBe(true);
    expect((await client.getProposal(proposalId))?.status).toBe("PendingApproval");
  });

  it("stops when the family switches the agent off, and its pending proposal is released", async () => {
    await setup.call(family, deployment.vault, "revoke_agent", { case_id: CASE }, { deposit: setup.ONE_YOCTO });
    expect((await client.getProposal(proposalId))?.status).toBe("Invalidated");
    const c = await client.getCase(CASE);
    expect(c).toMatchObject({ agent_enabled: false, reserved: "0" });

    await expect(
      client.propose({ caseId: CASE, invoiceId: INVOICE, requestId: "bypass-req-2", amountUnits: (BigInt(100) * setup.TUSDC).toString(), ttlSeconds: 3600 }),
    ).rejects.toThrow(/E_AGENT_DISABLED/);
    // The agent cannot switch itself back on. near-api-js words the node's
    // InvalidAccessKeyError.MethodNameMismatch as "Access key does not allow method …".
    const agent = new Account(deployment.agent, client.provider, agentKey as KeyPairString);
    await expect(setup.call(agent, deployment.vault, "enable_agent", { case_id: CASE })).rejects.toThrow(/MethodNameMismatch|does not allow method enable_agent/);
    writeEvidence("revocation-sandbox.json", { case: c, proposal: await client.getProposal(proposalId) });
  });

  it("can no longer sign anything once its key is deleted", async () => {
    const before = await readBalances(client.provider, deployment, CASE);
    const owner = setup.account(deployment.rpcUrl, deployment.agent, keys[deployment.agent]);
    await owner.deleteKey(KeyPair.fromString(agentKey as KeyPairString).getPublicKey());
    const check = await client.checkAgentKey();
    expect(check.ok).toBe(false);
    await expect(client.sweep(CASE)).rejects.toThrow(/AccessKeyDoesNotExist|access key|does not exist/i);
    expect(await readBalances(client.provider, deployment, CASE)).toEqual(before);
  });
});
