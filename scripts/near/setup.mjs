// Deploys the Kinwarden test token and vault, with the verifier, agent and a fictional hospital, under
// an account you control. Testnet only: it refuses mainnet.
//
//   NEAR_ROOT_KEY=ed25519:... node scripts/near/setup.mjs --root kinwarden-demo.testnet --family you.testnet
//
// Writes .near/deployment.json (public description), .near/keys.json (setup keys, Git-ignored) and
// NEAR_AGENT_KEY into .env.local. Secrets are never printed. Build the contracts first
// (contracts/near/README.md). The family then opens and funds its case in the app with its own wallet.
import crypto from "node:crypto";
import path from "node:path";
import { deploy, writeAgentKeyToEnv, writeJson } from "./lib.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const network = arg("network", "testnet");
if (network !== "testnet") throw new Error("setup.mjs deploys to testnet only. Use scripts/near/sandbox.mjs for a local sandbox.");
const rpc = arg("rpc", "https://rpc.testnet.near.org");
const rootId = arg("root");
const familyId = arg("family");
const rootKey = process.env.NEAR_ROOT_KEY;
if (!rootId || !familyId || !rootKey) {
  throw new Error("Usage: NEAR_ROOT_KEY=ed25519:... node scripts/near/setup.mjs --root <account>.testnet --family <family>.testnet");
}
if (!rootId.endsWith(".testnet") || !familyId.endsWith(".testnet")) throw new Error("Both accounts must be .testnet accounts.");

const caseId = arg("case-id", `case-th-${crypto.randomBytes(2).toString("hex")}`);
const { deployment, keys, agentKey } = await deploy({ rpc, network, rootId, rootKey, familyId });
deployment.cases = { case_th: { vaultCaseId: caseId, owner: familyId } };

writeJson(path.join(process.cwd(), ".near", "deployment.json"), deployment);
writeJson(path.join(process.cwd(), ".near", "keys.json"), keys);
writeAgentKeyToEnv(agentKey);

console.log(`
Deployed on ${network}:
  vault     ${deployment.vault}
  token     ${deployment.token}
  verifier  ${deployment.verifier}
  agent     ${deployment.agent}
  hospital  ${deployment.payees.srh.account}
Family ${familyId} holds 40,000 tUSDC (test token, no value) and will own case "${caseId}".

Next:
  1. npm run dev, open the app's NEAR panel and open and fund the case with your wallet.
  2. node scripts/near/verifier.mjs   (the simulated verifier operator, in another terminal)
`);
