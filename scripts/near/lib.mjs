// Shared NEAR setup steps for scripts/near/*.mjs and the sandbox end-to-end test. Setup tooling only:
// it holds deployer, verifier and test keys, and must never be imported by the app.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Account, JsonRpcProvider, KeyPair, nearToYocto } from "near-api-js";

export const ONE_YOCTO = "1";
export const TGAS = BigInt(10) ** BigInt(12);
export const TUSDC = BigInt(1_000_000); // 6 decimals
export const AGENT_METHODS = ["propose_payment", "sweep"];

export const WASM = {
  vault: "contracts/near/target/near/kinwarden_vault/kinwarden_vault.wasm",
  token: "contracts/near/target/near/kinwarden_tusdc/kinwarden_tusdc.wasm",
};

/** Limits for the demo hospital case, in tUSDC. Lowering them later is allowed; raising is not. */
export const DEMO_LIMITS = {
  per_payment_max: (BigInt(15_000) * TUSDC).toString(),
  rolling_24h_cap: (BigInt(20_000) * TUSDC).toString(),
  lifetime_cap: (BigInt(60_000) * TUSDC).toString(),
  group_caps: [{ group: "Hospital", rolling_24h_cap: (BigInt(18_000) * TUSDC).toString() }],
};

export const EXPLORER_TX = { testnet: "https://testnet.nearblocks.io/txns/" };

export function provider(rpcUrl) {
  return new JsonRpcProvider({ url: rpcUrl });
}

export function account(rpc, accountId, secretKey) {
  return new Account(accountId, provider(rpc), secretKey);
}

export function newKey() {
  const kp = KeyPair.fromRandom("ed25519");
  return { secretKey: kp.toString(), publicKey: kp.getPublicKey().toString() };
}

export async function call(acct, contractId, methodName, args, { deposit = "0", tgas = 100 } = {}) {
  return acct.callFunction({ contractId, methodName, args, deposit: BigInt(deposit), gas: BigInt(tgas) * TGAS });
}

export async function view(rpc, contractId, method, args = {}) {
  return provider(rpc).callFunction({ contractId, method, args });
}

/** SHA-256 of the off-chain verification record: only the digest goes on chain. */
export function provenance(record) {
  return crypto.createHash("sha256").update(record).digest("hex");
}

async function subAccount(root, rpc, prefix, near) {
  const key = newKey();
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: key.publicKey, nearToTransfer: nearToYocto(near) });
  const id = `${prefix}.${root.accountId}`;
  return { id, key, account: account(rpc, id, key.secretKey) };
}

/**
 * Deploys tUSDC and the vault under `root`, creates the verifier, agent and a fictional hospital,
 * enrolls the hospital, installs the agent's function-call key, and registers and funds the family.
 * Returns the deployment description and every generated secret (for .near/keys.json).
 */
export async function deploy({ rpc, network, rootId, rootKey, familyId, wasmDir = process.cwd(), log = console.log, near = {} }) {
  const root = account(rpc, rootId, rootKey);
  const amounts = { token: "2.5", vault: "3.5", verifier: "0.3", agent: "0.3", hospital: "0.2", ...near };
  log(`Creating role accounts under ${rootId}`);
  const token = await subAccount(root, rpc, "tusdc", amounts.token);
  const vault = await subAccount(root, rpc, "vault", amounts.vault);
  const verifier = await subAccount(root, rpc, "verifier", amounts.verifier);
  const agent = await subAccount(root, rpc, "agent", amounts.agent);
  const hospital = await subAccount(root, rpc, "siam-riverside-hospital", amounts.hospital);

  log("Deploying the test token and the vault");
  await token.account.deployContract(fs.readFileSync(path.join(wasmDir, WASM.token)));
  await call(token.account, token.id, "new", { owner_id: rootId });
  await vault.account.deployContract(fs.readFileSync(path.join(wasmDir, WASM.vault)));
  await call(vault.account, vault.id, "new", { token: token.id, verifier: verifier.id, agent: agent.id, network });

  log("Registering token accounts");
  for (const who of [vault.id, hospital.id, familyId]) {
    await call(root, token.id, "storage_deposit", { account_id: who }, { deposit: nearToYocto("0.01").toString() });
  }

  log("Verifier enrolls the fictional hospital");
  const record = `Kinwarden demo verification: Siam Riverside Hospital (fictional) controls ${hospital.id}`;
  await call(verifier.account, vault.id, "enroll_payee", { payee_id: "srh", account: hospital.id, purpose_group: "Hospital", provenance: provenance(record) }, { deposit: ONE_YOCTO });
  const payee = await view(rpc, vault.id, "get_payee", { payee_id: "srh" });
  if (payee?.status !== "Active") throw new Error(`Hospital enrollment did not activate: ${JSON.stringify(payee)}`);

  log("Installing the agent's function-call key (propose_payment and sweep only)");
  const agentKey = newKey();
  await agent.account.addFunctionCallAccessKey({ publicKey: agentKey.publicKey, contractId: vault.id, methodNames: AGENT_METHODS, allowance: nearToYocto("0.25") });

  log("Minting 40,000 tUSDC to the family account");
  await call(root, token.id, "mint", { account_id: familyId, amount: (BigInt(40_000) * TUSDC).toString() }, { deposit: ONE_YOCTO });

  const deployment = {
    network,
    rpcUrl: rpc,
    ...(EXPLORER_TX[network] ? { explorerTx: EXPLORER_TX[network] } : {}),
    vault: vault.id,
    token: token.id,
    tokenSymbol: "tUSDC",
    tokenDecimals: 6,
    verifier: verifier.id,
    agent: agent.id,
    cases: {},
    payees: { srh: { payeeId: "srh", account: hospital.id } },
  };
  const keys = {
    note: "Setup tooling keys. Never import into the app; the app gets only NEAR_AGENT_KEY.",
    [token.id]: token.key.secretKey,
    [vault.id]: vault.key.secretKey,
    [verifier.id]: verifier.key.secretKey,
    [agent.id]: agent.key.secretKey,
    [hospital.id]: hospital.key.secretKey,
  };
  return { deployment, keys, agentKey: agentKey.secretKey };
}

/** The family opens its case and funds it. On testnet this happens in the family's own wallet. */
export async function openAndFundCase({ rpc, deployment, family, caseId, fundUnits }) {
  await call(family, deployment.vault, "create_case", { case_id: caseId, limits: DEMO_LIMITS }, { deposit: nearToYocto("0.1").toString() });
  await call(family, deployment.token, "ft_transfer_call", { receiver_id: deployment.vault, amount: fundUnits, msg: caseId }, { deposit: ONE_YOCTO, tgas: 150 });
  return view(rpc, deployment.vault, "get_case", { case_id: caseId });
}

/**
 * Verifier operator: authorize every listed invoice not yet on chain. In the demo the hospital and
 * its bills are simulated; a real operator would confirm each bill with the institution first.
 */
export async function authorizeInvoices({ verifier, rpc, deployment, invoices, log = console.log }) {
  const done = [];
  for (const inv of invoices) {
    const existing = await view(rpc, deployment.vault, "get_invoice", { invoice_id: inv.vaultInvoiceId });
    if (existing) continue;
    await call(verifier, deployment.vault, "authorize_invoice", { invoice_id: inv.vaultInvoiceId, case_id: inv.vaultCaseId, payee_id: inv.payeeId, ceiling: inv.ceilingUnits }, { deposit: ONE_YOCTO });
    log(`Authorized ${inv.number} as ${inv.vaultInvoiceId} (ceiling ${Number(BigInt(inv.ceilingUnits) / TUSDC).toLocaleString()} tUSDC)`);
    done.push(inv.vaultInvoiceId);
  }
  return done;
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}

/** Put NEAR_AGENT_KEY into .env.local, replacing an old value. The key is never printed. */
export function writeAgentKeyToEnv(secretKey, envFile = path.join(process.cwd(), ".env.local")) {
  const text = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const without = text.replace(/\n?# NEAR vault: the agent's function-call key[^\n]*\nNEAR_AGENT_KEY=[^\n]*\n?/m, "\n").replace(/^NEAR_AGENT_KEY=.*$/m, "");
  const block = `\n# NEAR vault: the agent's function-call key (propose_payment and sweep only), from scripts/near/setup.mjs\nNEAR_AGENT_KEY=${secretKey}\n`;
  fs.writeFileSync(envFile, without.replace(/\n*$/, "\n") + block, { mode: 0o600 });
}
