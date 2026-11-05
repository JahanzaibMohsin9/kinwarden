// K16 on a local NEAR node: a lying RPC (or anything between the vault and the family's browser) shows
// the family a forged proposal, and the family's real wallet signs an approval for it. Whatever was
// forged, the vault compares the approved fields and hash with the proposal it stored and refuses;
// nothing moves and the proposal stays pending. The honest approval afterwards still pays exactly.
// The browser half (a changed field with the vault's hash kept turns Approve off) is
// src/near/approvalCheck.test.ts. Run: npm run test:near.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actions, type Account } from "near-api-js";
import type { Sandbox } from "near-sandbox";
import { commitmentForProposal, commitmentHash, type VaultProposal } from "@/near/commitment";
import type { NearDeployment } from "./config";
import { VaultClient } from "./vault";
import { readBalances } from "./bypass";
import { startSandboxDeployment, writeEvidence } from "./sandbox-kit";
import * as setup from "../../../scripts/near/lib.mjs";

const CASE = "case-th-forged";
const INVOICE = "forged-srh-dep-0001";
let sandbox: Sandbox;
let deployment: NearDeployment;
let keys: Record<string, string>;
let agentKey: string;
let family: Account;
let client: VaultClient;
let proposal: VaultProposal;

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
  const p = await client.propose({ caseId: CASE, invoiceId: INVOICE, requestId: "forged-req-1", amountUnits: (BigInt(7_000) * setup.TUSDC).toString(), ttlSeconds: 3600 });
  proposal = (await client.getProposal(p.proposal_id))!;
});

afterAll(async () => {
  await sandbox?.tearDown();
});

const hashOf = (p: VaultProposal) => commitmentHash(commitmentForProposal(p, "sandbox", deployment.vault));
const tokens = async (account: string) => BigInt((await setup.view(deployment.rpcUrl, deployment.token, "ft_balance_of", { account_id: account })) as string);

/** The family's wallet signs approve_payment for what it was shown; returns the vault's error code, if any. */
async function familyApproves(shown: VaultProposal, hash: string): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await family.signAndSendTransaction({
      receiverId: deployment.vault,
      actions: [
        actions.functionCall(
          "approve_payment",
          {
            case_id: CASE,
            proposal_id: shown.proposal_id,
            expected_recipient: shown.recipient,
            expected_token: shown.token,
            expected_amount: shown.amount,
            expected_policy_version: shown.policy_version,
            expected_proposal_hash: hash,
          },
          BigInt(150) * setup.TGAS,
          BigInt(1),
        ),
      ],
    });
    return { ok: true };
  } catch (e) {
    const text = e instanceof Error ? `${e.message} ${JSON.stringify(e)}` : String(e);
    return { ok: false, code: text.match(/E_[A-Z_]+/)?.[0] ?? `UNCLASSIFIED: ${text.slice(0, 160)}` };
  }
}

describe("a forged proposal shown to the family's wallet (K16)", () => {
  it("is refused by the vault whatever was forged, and nothing moves", async () => {
    const attacker = deployment.agent; // whoever controls the app server would want to be paid
    const hospital = deployment.payees.srh.account;
    const before = { ...(await readBalances(client.provider, deployment, CASE)), attacker: await tokens(attacker), hospital: await tokens(hospital) };

    const forgedRecipient = { ...proposal, recipient: attacker };
    const attempts = [
      { id: "recipient-changed-hash-kept", title: "Recipient changed, the vault's hash kept", shown: forgedRecipient, hash: hashOf(proposal) },
      { id: "recipient-and-hash-forged", title: "Recipient changed and the hash recomputed to match", shown: forgedRecipient, hash: hashOf(forgedRecipient) },
      { id: "amount-and-hash-forged", title: "Amount changed and the hash recomputed to match", shown: { ...proposal, amount: (BigInt(proposal.amount) * BigInt(2)).toString() }, hash: hashOf({ ...proposal, amount: (BigInt(proposal.amount) * BigInt(2)).toString() }) },
      { id: "hash-only-forged", title: "Fields honest, the hash of a forged recipient", shown: proposal, hash: hashOf(forgedRecipient) },
    ];
    const results = [];
    for (const a of attempts) {
      const r = await familyApproves(a.shown, a.hash);
      expect(r, a.id).toMatchObject({ ok: false });
      const code = (r as { code: string }).code;
      expect(code, a.id).toMatch(/^E_(FIELD_MISMATCH|COMMITMENT_MISMATCH)$/);
      expect((await client.getProposal(proposal.proposal_id))?.status, a.id).toBe("PendingApproval");
      results.push({ id: a.id, title: a.title, refusedWith: code });
    }

    const after = { ...(await readBalances(client.provider, deployment, CASE)), attacker: await tokens(attacker), hospital: await tokens(hospital) };
    expect(after).toEqual(before);

    // The same wallet approving what the vault really stored still works, and pays exactly.
    expect(await familyApproves(proposal, hashOf(proposal))).toEqual({ ok: true });
    expect(await tokens(hospital)).toBe(before.hospital + BigInt(proposal.amount));
    expect(await tokens(attacker)).toBe(before.attacker);

    writeEvidence("forged-sandbox.json", {
      network: "sandbox",
      proposal: { proposalId: proposal.proposal_id, recipient: proposal.recipient, amount: proposal.amount },
      forgedRecipient: attacker,
      results,
      before: { attacker: before.attacker.toString(), hospital: before.hospital.toString(), caseReserved: before.caseReserved, caseBalance: before.caseBalance },
      afterForgeries: { attacker: after.attacker.toString(), hospital: after.hospital.toString(), caseReserved: after.caseReserved, caseBalance: after.caseBalance },
      honestApprovalPaid: proposal.amount,
    });
  });
});
