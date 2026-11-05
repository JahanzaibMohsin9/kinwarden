import { commitmentForProposal, commitmentHash, type VaultProposal } from "./commitment";

/** What the vault's `approval_preview` view returns, as read by the family's browser. */
export interface ApprovalPreview {
  proposal: VaultProposal;
  commitment_hash: string;
  blockers: string[];
  case_available: string;
  invoice_remaining: string;
  rolling_24h_remaining: string;
  lifetime_remaining: string;
}

/**
 * Whether the family may approve, decided in the browser from what the RPC returned. The commitment
 * hash is recomputed here from the proposal's fields; if the RPC (or anything in between) changed a
 * field but kept the vault's hash, the two differ and Approve stays off. A forgery that changes the
 * fields and the hash together passes this check; the vault then refuses the approval, because it
 * compares the approved fields and hash with the proposal it stored (tested in forged.sandbox.ts).
 */
export function approvalCheck(input: { preview: ApprovalPreview | null; network: string; vault: string; account: string | null; owner: string | undefined; walletAvailable: boolean }) {
  const { preview, network, vault, account, owner, walletAvailable } = input;
  const proposal = preview?.proposal;
  const localHash = proposal ? commitmentHash(commitmentForProposal(proposal, network, vault)) : null;
  const hashOk = Boolean(preview && localHash === preview.commitment_hash);
  const pending = proposal?.status === "PendingApproval";
  const rightAccount = account !== null && account === owner;
  const canDecide = Boolean(pending && hashOk && preview && !preview.blockers.length && walletAvailable && rightAccount);
  const problem = !preview
    ? "reading"
    : !hashOk
      ? "hash_mismatch"
      : !pending
        ? "not_pending"
        : preview.blockers.length
          ? "blocked"
          : !walletAvailable
            ? "no_wallet"
            : !rightAccount
              ? "wrong_account"
              : null;
  return { localHash, hashOk, pending, rightAccount, canDecide, problem };
}
