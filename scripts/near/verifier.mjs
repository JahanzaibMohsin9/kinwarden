// The verifier operator, simulated: authorizes hospital invoices of the linked case on the vault.
// Runs as its own process with the verifier key, so the app never holds it. It trusts the app's
// sandbox hospital for the bill itself; a real operator would confirm each bill with the institution.
//
//   node scripts/near/verifier.mjs [--app http://localhost:3000] [--once]
import fs from "node:fs";
import path from "node:path";
import { account, authorizeInvoices } from "./lib.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const app = arg("app", "http://localhost:3000");
const once = process.argv.includes("--once");

const deployment = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".near", "deployment.json"), "utf8"));
const keys = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".near", "keys.json"), "utf8"));
const verifierKey = process.env.NEAR_VERIFIER_KEY ?? keys[deployment.verifier];
if (!verifierKey) throw new Error(`No key for ${deployment.verifier} in .near/keys.json or NEAR_VERIFIER_KEY.`);
const verifier = account(deployment.rpcUrl, deployment.verifier, verifierKey);

async function tick() {
  const res = await fetch(`${app}/api/near/invoices`);
  if (!res.ok) throw new Error(`${app}/api/near/invoices: ${res.status} ${await res.text()}`);
  const { invoices } = await res.json();
  await authorizeInvoices({ verifier, rpc: deployment.rpcUrl, deployment, invoices });
}

console.log(`Verifier ${deployment.verifier} watching ${app} for invoices to authorize on ${deployment.vault}`);
for (;;) {
  try {
    await tick();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, 5000));
}
