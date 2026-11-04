// Upgrades an existing testnet deployment made by setup.mjs to the current vault code and rotates the
// agent's function-call key to the current method list (AGENT_METHODS). Uses the setup keys in
// .near/keys.json; testnet only. The vault's state layout is unchanged, so no migration runs.
//
//   node scripts/near/upgrade.mjs
//
// Deploys contracts/near/target/near/kinwarden_vault/kinwarden_vault.wasm (build it first), adds a new
// agent key, deletes the old one, and writes the new NEAR_AGENT_KEY into .env.local. Secrets are never
// printed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { account, AGENT_METHODS, newKey, provider, view, WASM, writeAgentKeyToEnv } from "./lib.mjs";

const deployment = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".near", "deployment.json"), "utf8"));
if (deployment.network !== "testnet") throw new Error("upgrade.mjs acts on testnet deployments only.");
const keys = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".near", "keys.json"), "utf8"));
const rpc = deployment.rpcUrl;
const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const oldAgentKey = env.match(/^NEAR_AGENT_KEY=(.+)$/m)?.[1]?.trim();
if (!oldAgentKey) throw new Error("No NEAR_AGENT_KEY in .env.local.");

const code = fs.readFileSync(WASM.vault);
console.log(`Deploying vault code (sha256 ${crypto.createHash("sha256").update(code).digest("hex")}) to ${deployment.vault}`);
const vault = account(rpc, deployment.vault, keys[deployment.vault]);
await vault.deployContract(code);
const config = await view(rpc, deployment.vault, "get_config");
if (config.agent !== deployment.agent) throw new Error(`Vault state check failed after deploy: ${JSON.stringify(config)}`);
console.log(`Vault state intact: agent ${config.agent}, network ${config.network}`);

const agent = account(rpc, deployment.agent, keys[deployment.agent]);
const fresh = newKey();
await agent.addFunctionCallAccessKey({ publicKey: fresh.publicKey, contractId: deployment.vault, methodNames: AGENT_METHODS, allowance: BigInt(25) * BigInt(10) ** BigInt(22) });
await agent.deleteKey(KeyPair.fromString(oldAgentKey).getPublicKey());
writeAgentKeyToEnv(fresh.secretKey);

const list = await provider(rpc).viewAccessKeyList({ accountId: deployment.agent, finalityQuery: { finality: "final" } });
console.log(`Agent keys now: ${list.keys.map((k) => (k.access_key.permission === "FullAccess" ? "FullAccess (setup)" : `FunctionCall [${k.access_key.permission.FunctionCall.method_names.join(", ")}]`)).join("; ")}`);
console.log("Restart the dev server so the app picks up the new NEAR_AGENT_KEY.");
