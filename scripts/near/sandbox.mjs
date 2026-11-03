// A complete local NEAR setup with no wallet, testnet account or API key: starts a NEAR sandbox node,
// deploys everything, and opens and funds the family case with a TEST-ONLY family key that this
// harness holds (on testnet the family uses its own wallet instead). Linux x86_64 with glibc >= 2.39,
// or macOS ARM64. Keeps the node running until Ctrl+C.
//
//   node scripts/near/sandbox.mjs
//   npm run dev                        # in a second terminal (reads NEAR_AGENT_KEY from .env.local)
//   node scripts/near/verifier.mjs     # in a third terminal
//   node scripts/near/family.mjs approve   # approve as the test family (sandbox only)
import path from "node:path";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import { account, deploy, newKey, openAndFundCase, TUSDC, writeAgentKeyToEnv, writeJson } from "./lib.mjs";

const sandbox = await Sandbox.start({ version: "2.14.0" });
const rpc = sandbox.rpcUrl;
console.log(`NEAR sandbox running at ${rpc}`);

const root = account(rpc, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY);
const familyKey = newKey();
await root.createSubAccount({ accountOrPrefix: "family", publicKey: familyKey.publicKey, nearToTransfer: BigInt(10) * BigInt(10) ** BigInt(24) });
const familyId = `family.${DEFAULT_ACCOUNT_ID}`;

const { deployment, keys, agentKey } = await deploy({ rpc, network: "sandbox", rootId: DEFAULT_ACCOUNT_ID, rootKey: DEFAULT_PRIVATE_KEY, familyId });
const caseId = "case-th-sandbox";
deployment.cases = { case_th: { vaultCaseId: caseId, owner: familyId } };
const family = account(rpc, familyId, familyKey.secretKey);
const c = await openAndFundCase({ rpc, deployment, family, caseId, fundUnits: (BigInt(30_000) * TUSDC).toString() });
console.log(`Family case ${caseId} funded: balance ${BigInt(c.balance) / TUSDC} tUSDC`);

writeJson(path.join(process.cwd(), ".near", "deployment.json"), deployment);
writeJson(path.join(process.cwd(), ".near", "keys.json"), { ...keys, [familyId]: familyKey.secretKey, sandboxNote: "family key is a TEST-ONLY harness key" });
writeAgentKeyToEnv(agentKey);
console.log("Wrote .near/deployment.json, .near/keys.json and NEAR_AGENT_KEY in .env.local. Ctrl+C stops the node.");

const stop = async () => {
  await sandbox.tearDown();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
