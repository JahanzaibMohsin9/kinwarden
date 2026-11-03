// G3 end to end on a local NEAR node: the scripted agent asks to pay the hospital deposit, the safety
// gateway accepts it, the bridge proposes it to the vault with the agent's function-call key, the
// verifier operator authorizes the invoice, the family approves in its "wallet" (a TEST-ONLY harness
// key here, standing in for Meteor), and the hospital's token balance, the app's payment and the case
// receipt all agree. Run: npm run test:near (Linux x86_64 or macOS ARM64, contracts built).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actions, Account } from "near-api-js";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { stableStringify } from "@/lib/canonical";
import { commitmentForProposal, commitmentHash } from "@/near/commitment";
import { Store } from "../store";
import { AgentRunner } from "../agent/runner";
import { seedScenario } from "../scenarios";
import { advanceToNext } from "../sim/engine";
import type { NearDeployment } from "./config";
import { NearBridge, tusdcUnits } from "./bridge";
import * as setup from "../../../scripts/near/lib.mjs";

const CASE = "case-th-e2e";
let sandbox: Sandbox;
let deployment: NearDeployment;
let keys: Record<string, string>;
let agentKey: string;
let family: Account;

beforeAll(async () => {
  sandbox = await Sandbox.start({ version: "2.14.0" });
  const rpc = sandbox.rpcUrl;
  const root = setup.account(rpc, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY);
  const familyKey = setup.newKey();
  await root.createSubAccount({ accountOrPrefix: "family", publicKey: familyKey.publicKey, nearToTransfer: BigInt(10) * BigInt(10) ** BigInt(24) });
  const familyId = `family.${DEFAULT_ACCOUNT_ID}`;
  const out = await setup.deploy({ rpc, network: "sandbox", rootId: DEFAULT_ACCOUNT_ID, rootKey: DEFAULT_PRIVATE_KEY, familyId, log: () => {} });
  deployment = { ...out.deployment, cases: { case_th: { vaultCaseId: CASE, owner: familyId } } };
  keys = out.keys;
  agentKey = out.agentKey;
  family = setup.account(rpc, familyId, familyKey.secretKey);
  await setup.openAndFundCase({ rpc, deployment, family, caseId: CASE, fundUnits: (BigInt(30_000) * setup.TUSDC).toString() });
});

afterAll(async () => {
  await sandbox?.tearDown();
});

async function boot() {
  const store = new Store();
  store.load(() => seedScenario("th-medical"));
  store.reset(seedScenario("th-medical"));
  store.world.agent.mode = "scripted";
  const runner = new AgentRunner(store);
  runner.resetSession();
  (globalThis as Record<string, unknown>).__kinwarden = { store, runner, autoplayTimer: setInterval(() => {}, 1 << 30), runnerClass: AgentRunner };
  const settle = async () => {
    for (let i = 0; i < 400 && (runner.isBusy || store.world.agent.status === "working"); i++) await new Promise((r) => setTimeout(r, 5));
  };
  const bridge = new NearBridge(store, { deployment, agentKey });
  store.on("logged", (e) => bridge.onLogged(e));
  return { store, bridge, settle };
}

describe("hospital deposit through the NEAR vault", () => {
  it("proposal → verifier → family wallet approval → hospital paid → receipt", async () => {
    const { store, bridge, settle } = await boot();
    const w = () => store.world;

    expect(await bridge.ready()).toMatchObject({ ok: true, methods: ["propose_payment", "sweep"] });

    // Run the scenario until the agent asks to pay the deposit by bank transfer.
    for (let i = 0; i < 20 && !Object.values(w().payments).some((p) => p.status === "awaiting_approval"); i++) {
      advanceToNext(store);
      await new Promise((r) => setTimeout(r, 1));
      await settle();
    }
    const payment = Object.values(w().payments).find((p) => p.status === "awaiting_approval")!;
    expect(payment).toMatchObject({ route: "bank_transfer", institutionId: "srh", currency: "THB", amount: 250000 });

    // Linked; the invoice is not authorized on chain yet, so the vault refuses and the bridge waits.
    await bridge.sync();
    expect(w().payments[payment.id].near, JSON.stringify(w().payments[payment.id].near)).toMatchObject({ state: "waiting_for_verifier" });

    // The verifier operator authorizes the hospital's invoice (separate key; the app never has it).
    const inv = w().invoices[payment.invoiceId];
    const verifier = setup.account(deployment.rpcUrl, deployment.verifier, keys[deployment.verifier]);
    await setup.authorizeInvoices({
      verifier,
      rpc: deployment.rpcUrl,
      deployment,
      log: () => {},
      invoices: [{ vaultInvoiceId: bridge.vaultInvoiceId(inv.number), vaultCaseId: CASE, payeeId: "srh", ceilingUnits: tusdcUnits(inv.amountDue, inv.currency, inv.issuedAt), number: inv.number }],
    });
    await bridge.sync();
    const link = w().payments[payment.id].near!;
    expect(link.state).toBe("PendingApproval");
    expect(link.proposalId).toBeTruthy();

    // The app cannot approve it: not over HTTP, and not with the key it holds.
    const { decideApprovalIn } = await import("../runtime");
    expect(() => decideApprovalIn(store, payment.approvalId!, "approved", "hold")).toThrow(/NEAR wallet/);
    const appKey = new Account(deployment.agent, bridge.client.provider, agentKey as `ed25519:${string}`);
    const preview = (await bridge.client.preview(link.proposalId!))!;
    expect(preview.blockers).toEqual([]);
    expect(preview.proposal.recipient).toBe(deployment.payees.srh.account);
    const approveArgs = {
      case_id: CASE,
      proposal_id: link.proposalId,
      expected_recipient: preview.proposal.recipient,
      expected_token: preview.proposal.token,
      expected_amount: preview.proposal.amount,
      expected_policy_version: preview.proposal.policy_version,
      expected_proposal_hash: preview.commitment_hash,
    };
    await expect(
      appKey.callFunction({ contractId: deployment.vault, methodName: "approve_payment", args: approveArgs, deposit: BigInt(1), gas: BigInt(150) * setup.TGAS }),
    ).rejects.toThrow(/DepositWithFunctionCall|deposit/i);

    // The browser recomputes the hash itself and gets what the contract stored.
    expect(commitmentHash(commitmentForProposal(preview.proposal, "sandbox", deployment.vault))).toBe(preview.commitment_hash);

    // The family approves in its wallet.
    const before = BigInt((await setup.view(deployment.rpcUrl, deployment.token, "ft_balance_of", { account_id: deployment.payees.srh.account })) as string);
    const tx = await family.signAndSendTransaction({
      receiverId: deployment.vault,
      actions: [actions.functionCall("approve_payment", approveArgs, BigInt(150) * setup.TGAS, BigInt(1))],
    });
    const txHash = (tx as unknown as { transaction: { hash: string } }).transaction.hash;

    // A transaction that is not this approval is not accepted as one.
    const fake = await family.signAndSendTransaction({ receiverId: deployment.vault, actions: [actions.functionCall("sweep", { case_id: CASE }, BigInt(30) * setup.TGAS, BigInt(0))] });
    expect(await bridge.recordApprovalTx(payment.id, (fake as unknown as { transaction: { hash: string } }).transaction.hash)).toMatchObject({ ok: false });
    expect(await bridge.recordApprovalTx(payment.id, txHash)).toEqual({ ok: true });
    await settle();

    // Chain and app agree.
    const after = BigInt((await setup.view(deployment.rpcUrl, deployment.token, "ft_balance_of", { account_id: deployment.payees.srh.account })) as string);
    expect(after - before).toBe(BigInt(link.amountUnits));
    const p = w().payments[payment.id];
    expect(p.status).toBe("completed");
    expect(p.near).toMatchObject({ state: "Settled", approvalTx: txHash });
    expect(w().approvals[payment.approvalId!]).toMatchObject({ decision: "approved", method: "near_wallet" });
    expect(w().invoices[payment.invoiceId].status).toBe("paid");
    expect(store.ledger.some((e) => e.type === "payment.completed" && e.actor === "near")).toBe(true);

    // The receipt binds the proposal, its hash, the approval and the settlement, observed separately.
    const receipt = (await bridge.receipt(payment.id))!;
    const { receipt_hash, ...body } = receipt;
    expect(receipt_hash).toBe(bytesToHex(sha256(new TextEncoder().encode(stableStringify(body)))));
    expect(receipt).toMatchObject({
      paid_to: { account: deployment.payees.srh.account },
      token: { contract: deployment.token },
      amount: { units: link.amountUnits },
      commitment_hash: preview.commitment_hash,
      outcome: { delivery: "delivered", vault_status: "Settled" },
      approval: { tx: txHash, by: family.accountId },
      settlement: { token_transfer: { succeeded: true, from: deployment.vault, to: deployment.payees.srh.account, matches_proposal: true }, vault_callback: { result: "Settled" } },
      institution_acknowledgement: { simulated: true },
    });
    // The transfer the receipt reports is the balance change the hospital actually got.
    expect(BigInt(receipt.settlement!.token_transfer.amount_units!)).toBe(after - before);
    expect(Date.parse(receipt.settlement!.token_transfer.observed_at)).toBeGreaterThanOrEqual(Date.parse(receipt.approval!.approved_at!));
    const edited = { ...body, amount: { ...body.amount, display: "1.00 tUSDC" } };
    expect(bytesToHex(sha256(new TextEncoder().encode(stableStringify(edited))))).not.toBe(receipt_hash);
  });
});
