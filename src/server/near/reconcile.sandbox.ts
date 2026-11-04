// G4 balance reconciliation on a local NEAR node, one build for both outcomes: a confirmed transfer
// failure credits the hospital nothing and returns the money to the case exactly once; then a retry
// settles. The state between the approval and the transfer's result (what an unknown outcome holds)
// is read at the approval's own block. Run: npm run test:near.
import crypto from "node:crypto";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actions, type Account } from "near-api-js";
import type { Sandbox } from "near-sandbox";
import type { NearDeployment } from "./config";
import { VaultClient } from "./vault";
import type { FinalTx } from "./bridge";
import { startSandboxDeployment, writeEvidence } from "./sandbox-kit";
import * as setup from "../../../scripts/near/lib.mjs";

const CASE = "case-th-reconcile";
const INVOICE = "reconcile-srh-dep-0001";
const AMOUNT = BigInt(7_000) * setup.TUSDC;
let sandbox: Sandbox;
let deployment: NearDeployment;
let keys: Record<string, string>;
let agentKey: string;
let family: Account;
let client: VaultClient;

beforeAll(async () => {
  ({ sandbox, deployment, keys, agentKey, family } = await startSandboxDeployment(CASE));
  const verifier = setup.account(deployment.rpcUrl, deployment.verifier, keys[deployment.verifier]);
  await setup.authorizeInvoices({
    verifier,
    rpc: deployment.rpcUrl,
    deployment,
    log: () => {},
    invoices: [{ vaultInvoiceId: INVOICE, vaultCaseId: CASE, payeeId: "srh", ceilingUnits: (BigInt(9_000) * setup.TUSDC).toString(), number: "SRH-DEP-0001" }],
  });
  client = new VaultClient({ deployment, agentKey });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

interface Row {
  step: string;
  vaultTokens: string;
  hospitalTokens: string;
  caseBalance: string;
  caseAvailable: string;
  caseReserved: string;
  caseInFlight: string;
  casePaid: string;
  rolling24hCharged: string;
}

async function snapshot(step: string, blockId?: string): Promise<Row> {
  const blockQuery = blockId ? { blockQuery: { blockId } } : {};
  const view = <T>(contractId: string, method: string, args: Record<string, unknown>) =>
    client.provider.callFunction({ contractId, method, args, ...blockQuery }) as Promise<T>;
  const hospital = deployment.payees.srh.account;
  const [vaultTokens, hospitalTokens, c] = await Promise.all([
    view<string>(deployment.token, "ft_balance_of", { account_id: deployment.vault }),
    view<string>(deployment.token, "ft_balance_of", { account_id: hospital }),
    view<{ balance: string; reserved: string; in_flight: string; paid: string; window: { amount: string; counted: boolean }[] }>(deployment.vault, "get_case", { case_id: CASE }),
  ]);
  const charged = c.window.filter((w) => w.counted).reduce((s, w) => s + BigInt(w.amount), BigInt(0));
  return {
    step,
    vaultTokens,
    hospitalTokens,
    caseBalance: c.balance,
    caseAvailable: (BigInt(c.balance) - BigInt(c.reserved) - BigInt(c.in_flight)).toString(),
    caseReserved: c.reserved,
    caseInFlight: c.in_flight,
    casePaid: c.paid,
    rolling24hCharged: charged.toString(),
  };
}

/** The family approves in its (TEST-ONLY harness) wallet; returns the approval receipt's block. */
async function approve(proposalId: string): Promise<{ tx: string; approvalBlock: string }> {
  const preview = (await client.preview(proposalId))!;
  const p = preview.proposal;
  const args = {
    case_id: p.case_id,
    proposal_id: p.proposal_id,
    expected_recipient: p.recipient,
    expected_token: p.token,
    expected_amount: p.amount,
    expected_policy_version: p.policy_version,
    expected_proposal_hash: preview.commitment_hash,
  };
  const sent = (await family.signAndSendTransaction({ receiverId: deployment.vault, actions: [actions.functionCall("approve_payment", args, BigInt(150) * setup.TGAS, BigInt(1))] })) as unknown as FinalTx & {
    transaction: { hash: string };
  };
  return { tx: sent.transaction.hash, approvalBlock: sent.receipts_outcome.find((r) => r.outcome.executor_id === deployment.vault)!.block_hash };
}

const sha = (file: string) => (fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null);

describe("balance reconciliation for a failed transfer and its retry", () => {
  it("a confirmed failure credits nothing and frees the money once; the retry pays exactly once", async () => {
    const rows: Row[] = [await snapshot("1. Case funded")];

    const first = await client.propose({ caseId: CASE, invoiceId: INVOICE, requestId: "reconcile-1", amountUnits: AMOUNT.toString(), ttlSeconds: 3600 });
    rows.push(await snapshot("2. Agent proposed; amount reserved"));

    // The hospital's token account disappears, so the vault's transfer to it will fail.
    const hospital = setup.account(deployment.rpcUrl, deployment.payees.srh.account, keys[deployment.payees.srh.account]);
    await setup.call(hospital, deployment.token, "storage_unregister", {}, { deposit: setup.ONE_YOCTO });

    const failed = await approve(first.proposal_id);
    rows.push(await snapshot("3. Family approved; transfer sent, outcome not yet known", failed.approvalBlock));
    rows.push(await snapshot("4. Transfer failed (confirmed by the vault's callback)"));
    expect((await client.getProposal(first.proposal_id))?.status).toBe("Failed");

    // Nothing else can release or credit it again.
    await client.sweep(CASE);
    rows.push(await snapshot("5. Later sweep: nothing changes"));

    // The hospital registers again; the agent proposes a second attempt and the family approves it.
    await setup.call(family, deployment.token, "storage_deposit", { account_id: deployment.payees.srh.account }, { deposit: (BigInt(10) ** BigInt(22)).toString() });
    const retry = await client.propose({ caseId: CASE, invoiceId: INVOICE, requestId: "reconcile-2", amountUnits: AMOUNT.toString(), ttlSeconds: 3600 });
    expect(retry.attempt).toBe(2);
    rows.push(await snapshot("6. Agent proposed attempt 2; amount reserved"));
    const settled = await approve(retry.proposal_id);
    rows.push(await snapshot("7. Family approved attempt 2; transfer settled"));
    expect((await client.getProposal(retry.proposal_id))?.status).toBe("Settled");

    const [funded, reserved, inFlight, failedRow, swept, , paid] = rows;
    const amt = AMOUNT.toString();
    // Reservation, then in flight while the outcome is unknown.
    expect(reserved).toMatchObject({ caseReserved: amt, caseAvailable: (BigInt(funded.caseBalance) - AMOUNT).toString(), rolling24hCharged: amt });
    expect(inFlight).toMatchObject({ caseReserved: "0", caseInFlight: amt, hospitalTokens: "0", vaultTokens: funded.vaultTokens });
    // Confirmed failure: no credit, money and 24-hour budget back once.
    expect(failedRow).toMatchObject({ hospitalTokens: "0", vaultTokens: funded.vaultTokens, caseBalance: funded.caseBalance, caseAvailable: funded.caseAvailable, caseReserved: "0", caseInFlight: "0", casePaid: "0", rolling24hCharged: "0" });
    expect({ ...swept, step: "" }).toEqual({ ...failedRow, step: "" });
    // The retry pays exactly the amount, once.
    expect(paid).toMatchObject({ hospitalTokens: amt, vaultTokens: (BigInt(funded.vaultTokens) - AMOUNT).toString(), caseBalance: (BigInt(funded.caseBalance) - AMOUNT).toString(), casePaid: amt, caseReserved: "0", caseInFlight: "0" });

    writeEvidence("reconcile-sandbox.json", {
      network: "sandbox",
      commit: process.env.KINWARDEN_COMMIT ?? "unknown",
      wasmSha256: { vault: sha(setup.WASM.vault), token: sha(setup.WASM.token) },
      amountUnits: amt,
      failedApprovalTx: failed.tx,
      settledApprovalTx: settled.tx,
      rows,
    });
  });
});
