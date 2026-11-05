// The NEAR evidence the public pages quote, read from the committed evidence files when the page is built.
// Nothing here is typed by hand: scripts/near/evidence.sh and the testnet runs write these files, and
// `node scripts/near/verify.mjs` rechecks the testnet ones against the public chain.
import receipt from "../../docs/near/evidence/2026-11-03-testnet-receipt.json";
import bypassTestnet from "../../docs/redteam/near/bypass-testnet.json";
import reconcile from "../../docs/redteam/near/reconcile-sandbox.json";
import testnetVault from "../../docs/redteam/near/testnet-vault.json";
import anchorTestnet from "../../docs/redteam/near/anchor-testnet.json";

export const REPO = "https://github.com/JahanzaibMohsin9/kinwarden";
export const ONCHAIN_REPORT = `${REPO}/blob/main/docs/redteam/ONCHAIN.md`;
export const CLAIMS_MAP = `${REPO}/blob/main/docs/near/CLAIMS.md`;

const explorerAccount = (account: string) => `https://testnet.nearblocks.io/address/${account}`;

export function nearEvidence() {
  const refused = bypassTestnet.results.filter((r) => r.refusedBy === "protocol" || r.refusedBy === "contract").length;
  return {
    network: receipt.network,
    vault: { account: receipt.vault, url: explorerAccount(receipt.vault), sameBuildAsTests: testnetVault.matches, codeSha256: testnetVault.codeSha256 },
    payment: {
      amount: receipt.amount.display,
      institution: receipt.paid_to.institution,
      recipient: receipt.paid_to.account,
      approvedBy: receipt.approval.by,
      txUrl: receipt.approval.tx_url,
      delivered: receipt.outcome.delivery === "delivered",
    },
    bypass: { refused, total: bypassTestnet.results.length, balancesUnchanged: bypassTestnet.held, ranAt: bypassTestnet.ranAt },
    reconcile: { commit: reconcile.commit },
    anchor: { txUrl: anchorTestnet.anchor.chain.explorerUrl, tamperDetected: anchorTestnet.tampered.ok === false },
  };
}
