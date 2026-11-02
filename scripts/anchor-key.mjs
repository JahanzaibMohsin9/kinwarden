// Creates the testnet-only wallet that signs on-chain anchors, straight into .env.local.
// The private key is never printed; only the address is shown, for funding from the faucet.
//   node scripts/anchor-key.mjs           # create (refuses if one already exists)
//   node scripts/anchor-key.mjs address   # show the address of the existing key
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV = path.join(process.cwd(), ".env.local");
const text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
const existing = text.match(/^ANCHOR_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1];

if (process.argv[2] === "address") {
  if (!existing) throw new Error("No ANCHOR_PRIVATE_KEY in .env.local yet.");
  console.log(privateKeyToAccount(existing).address);
  process.exit(0);
}
if (existing) {
  console.log(`An anchor key already exists (address ${privateKeyToAccount(existing).address}); not replacing it.`);
  process.exit(0);
}

const key = generatePrivateKey();
const block = [
  "",
  "# On-chain anchoring: a testnet-only wallet created by scripts/anchor-key.mjs. Never put real funds on it.",
  "ANCHOR_CHAIN=conflux-espace-testnet",
  `ANCHOR_PRIVATE_KEY=${key}`,
  "",
].join("\n");
fs.writeFileSync(ENV, text.replace(/\n*$/, "\n") + block, { mode: 0o600 });
console.log(`Created. Fund this address with testnet CFX: ${privateKeyToAccount(key).address}`);
