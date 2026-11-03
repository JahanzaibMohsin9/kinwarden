// TEST-ONLY family harness for the local sandbox: approves or rejects a payment with the family key
// that scripts/near/sandbox.mjs created. It stands in for the family's wallet so the flow can be
// reproduced without one. It refuses any network but the sandbox; on testnet the family uses its own
// wallet in the app.
//
//   node scripts/near/family.mjs approve <paymentId> [--app http://localhost:3000]
//   node scripts/near/family.mjs reject  <paymentId>
import fs from "node:fs";
import path from "node:path";
import { account, call, ONE_YOCTO, view } from "./lib.mjs";

const [action, paymentId] = process.argv.slice(2);
const i = process.argv.indexOf("--app");
const app = i > 0 ? process.argv[i + 1] : "http://localhost:3000";
if (!["approve", "reject"].includes(action) || !paymentId) throw new Error("Usage: node scripts/near/family.mjs approve|reject <paymentId>");

const deployment = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".near", "deployment.json"), "utf8"));
if (deployment.network !== "sandbox") throw new Error("family.mjs acts only on the local sandbox. On testnet, approve in your own wallet.");
const keys = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".near", "keys.json"), "utf8"));
const { link, owner } = await (await fetch(`${app}/api/near/payment/${paymentId}`)).json();
if (!link?.proposalId) throw new Error(`Payment ${paymentId} has no NEAR proposal yet.`);
const family = account(deployment.rpcUrl, owner, keys[owner]);

if (action === "reject") {
  await call(family, deployment.vault, "reject_payment", { case_id: link.vaultCaseId, proposal_id: link.proposalId }, { deposit: ONE_YOCTO });
  console.log(`Rejected proposal ${link.proposalId}`);
} else {
  // The approval carries what the family read on screen plus the commitment hash, as a wallet would.
  const preview = await view(deployment.rpcUrl, deployment.vault, "approval_preview", { proposal_id: link.proposalId });
  if (preview.blockers.length) throw new Error(`Not approvable: ${preview.blockers.join(", ")}`);
  const p = preview.proposal;
  await call(
    family,
    deployment.vault,
    "approve_payment",
    {
      case_id: p.case_id,
      proposal_id: p.proposal_id,
      expected_recipient: p.recipient,
      expected_token: p.token,
      expected_amount: p.amount,
      expected_policy_version: p.policy_version,
      expected_proposal_hash: preview.commitment_hash,
    },
    { deposit: ONE_YOCTO, tgas: 150 },
  );
  console.log(`Approved proposal ${p.proposal_id}: ${BigInt(p.amount) / BigInt(1_000_000)} tUSDC to ${p.recipient}`);
}
