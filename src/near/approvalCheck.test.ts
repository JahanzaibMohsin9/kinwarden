import { describe, expect, it } from "vitest";
import receipt from "../../docs/near/evidence/2026-11-03-testnet-receipt.json";
import { approvalCheck, type ApprovalPreview } from "./approvalCheck";
import { commitmentForProposal, commitmentHash, type VaultProposal } from "./commitment";

// The real testnet proposal the family approved on 3 Nov, as the vault's approval_preview returned it
// before approval, and the hash the vault stored for it.
const proposal = { ...receipt.proposal, status: "PendingApproval" } as VaultProposal;
const honest: ApprovalPreview = {
  proposal,
  commitment_hash: receipt.commitment_hash,
  blockers: [],
  case_available: "30000000000",
  invoice_remaining: proposal.amount,
  rolling_24h_remaining: "20000000000",
  lifetime_remaining: "60000000000",
};
const base = { network: receipt.network, vault: receipt.vault, account: receipt.approval.by, owner: receipt.approval.by, walletAvailable: true };
const ATTACKER = "attacker.testnet";

describe("approval screen check against a lying RPC (K16, C52)", () => {
  it("the honest proposal's hash recomputes in the browser and Approve is on", () => {
    const r = approvalCheck({ ...base, preview: honest });
    expect(r.localHash).toBe(receipt.commitment_hash);
    expect(r).toMatchObject({ hashOk: true, canDecide: true, problem: null });
  });

  it("a recipient changed in transit with the vault's hash kept turns Approve off", () => {
    const forged = { ...honest, proposal: { ...proposal, recipient: ATTACKER } };
    const r = approvalCheck({ ...base, preview: forged });
    expect(r).toMatchObject({ hashOk: false, canDecide: false, problem: "hash_mismatch" });
  });

  it("any other single field changed in transit also turns Approve off", () => {
    for (const change of [{ amount: "9625450000" }, { token: "fake-usdc.testnet" }, { policy_version: 2 }, { payee_version: 9 }, { invoice_id: "other-invoice" }, { expires_at: "1893456000000000000" }]) {
      const r = approvalCheck({ ...base, preview: { ...honest, proposal: { ...proposal, ...change } as VaultProposal } });
      expect(r.canDecide, JSON.stringify(change)).toBe(false);
    }
  });

  it("a forgery that also recomputes the hash passes the browser check: the vault is what refuses it", () => {
    const fields = { ...proposal, recipient: ATTACKER };
    const forged = { ...honest, proposal: fields, commitment_hash: commitmentHash(commitmentForProposal(fields, base.network, base.vault)) };
    expect(approvalCheck({ ...base, preview: forged }).hashOk).toBe(true);
    // the vault side of this case: src/server/near/forged.sandbox.ts
  });

  it("only the case owner's connected wallet can decide", () => {
    expect(approvalCheck({ ...base, preview: honest, account: "someone.testnet" })).toMatchObject({ canDecide: false, problem: "wrong_account" });
    expect(approvalCheck({ ...base, preview: honest, account: null })).toMatchObject({ canDecide: false });
    expect(approvalCheck({ ...base, preview: { ...honest, blockers: ["E_PAUSED"] } })).toMatchObject({ canDecide: false, problem: "blocked" });
  });
});
