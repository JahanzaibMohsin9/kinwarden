// The on-chain anchor contract: compile it, deploy it, and check the deployment.
//   node scripts/anchor-contract.mjs compile   # contracts/KinwardenAnchor.sol -> src/server/anchor/artifact.json
//   node scripts/anchor-contract.mjs deploy    # deploys with ANCHOR_PRIVATE_KEY, writes ANCHOR_CONTRACT to .env.local
//   node scripts/anchor-contract.mjs verify    # publishes the source on ConfluxScan
//   node scripts/anchor-contract.mjs status    # wallet balance, contract, anchors so far
import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "contracts", "KinwardenAnchor.sol");
const ARTIFACT = path.join(ROOT, "src", "server", "anchor", "artifact.json");
const ENV = path.join(ROOT, ".env.local");

const CHAIN = {
  id: 71,
  name: "Conflux eSpace Testnet",
  nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmtestnet.confluxrpc.com"] } },
};

function env() {
  const text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  return Object.fromEntries([...text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
}

function compile() {
  const input = {
    language: "Solidity",
    sources: { "KinwardenAnchor.sol": { content: fs.readFileSync(SOURCE, "utf8") } },
    // "paris": no PUSH0, so the bytecode runs on any EVM chain, including older ones
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts["KinwardenAnchor.sol"].KinwardenAnchor;
  const artifact = { contractName: "KinwardenAnchor", compiler: `solc ${solc.version()}`, settings: input.settings, abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`Compiled with ${artifact.compiler}: ${(artifact.bytecode.length - 2) / 2} bytes -> ${path.relative(ROOT, ARTIFACT)}`);
}

async function deploy() {
  const e = env();
  if (!e.ANCHOR_PRIVATE_KEY) throw new Error("No ANCHOR_PRIVATE_KEY in .env.local: run node scripts/anchor-key.mjs first.");
  if (e.ANCHOR_CONTRACT) throw new Error(`ANCHOR_CONTRACT is already set (${e.ANCHOR_CONTRACT}). Remove it from .env.local to deploy a new one.`);
  const { abi, bytecode } = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  const account = privateKeyToAccount(e.ANCHOR_PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http() });
  const reader = createPublicClient({ chain: CHAIN, transport: http() });
  const hash = await wallet.deployContract({ abi, bytecode });
  console.log(`Deploy transaction: ${hash}`);
  const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed (${receipt.status}).`);
  fs.appendFileSync(ENV, `ANCHOR_CONTRACT=${receipt.contractAddress}\n`);
  console.log(`Deployed at ${receipt.contractAddress} (block ${receipt.blockNumber}); ANCHOR_CONTRACT written to .env.local.`);
}

async function status() {
  const e = env();
  const reader = createPublicClient({ chain: CHAIN, transport: http() });
  const address = e.ANCHOR_PRIVATE_KEY ? privateKeyToAccount(e.ANCHOR_PRIVATE_KEY).address : undefined;
  if (address) console.log(`Wallet ${address}: ${formatEther(await reader.getBalance({ address }))} CFX`);
  if (e.ANCHOR_CONTRACT) {
    const { abi } = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
    const count = await reader.readContract({ address: e.ANCHOR_CONTRACT, abi, functionName: "count" });
    const owner = await reader.readContract({ address: e.ANCHOR_CONTRACT, abi, functionName: "owner" });
    console.log(`Contract ${e.ANCHOR_CONTRACT}: ${count} anchors, owner ${owner}`);
  }
}

/** Publish the source on ConfluxScan (Etherscan-compatible API), so anyone can read what the contract does. */
async function verify() {
  const e = env();
  if (!e.ANCHOR_CONTRACT) throw new Error("No ANCHOR_CONTRACT in .env.local.");
  const { compiler, settings } = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  const standardJson = { language: "Solidity", sources: { "KinwardenAnchor.sol": { content: fs.readFileSync(SOURCE, "utf8") } }, settings: { ...settings, outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } } } };
  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    contractaddress: e.ANCHOR_CONTRACT,
    sourceCode: JSON.stringify(standardJson),
    codeformat: "solidity-standard-json-input",
    contractname: "KinwardenAnchor.sol:KinwardenAnchor",
    compilerversion: `v${compiler.replace(/^solc /, "").replace(/\.Emscripten.*$/, "")}`,
    constructorArguements: "",
  });
  const api = "https://evmapi-testnet.confluxscan.org/api";
  const sent = await fetch(api, { method: "POST", body }).then((r) => r.json());
  console.log("submitted:", sent.message, sent.result);
  if (sent.status !== "1") return;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const check = await fetch(`${api}?module=contract&action=checkverifystatus&guid=${sent.result}`).then((r) => r.json());
    console.log("status:", check.result);
    if (!/pending|queue/i.test(String(check.result))) return;
  }
}

const cmd = process.argv[2];
if (cmd === "compile") compile();
else if (cmd === "deploy") await deploy();
else if (cmd === "verify") await verify();
else if (cmd === "status") await status();
else console.log("commands: compile | deploy | verify | status");
