// Checks Kinwarden's recorded NEAR testnet evidence against the public chain. No wallet, NEAR key,
// model key or `npm ci` is needed: Node 24 and network access only. Every request is a read.
//
//   node scripts/near/verify.mjs
//   node scripts/near/verify.mjs --receipt docs/near/evidence/2026-11-03-testnet-receipt.json
//   node scripts/near/verify.mjs --rpc <url> --archival-rpc <url>
//
// It checks, and says what each check does not show:
//   1. the case receipt was not edited (its hash recomputes) and its commitment hash recomputes
//      from the proposal it names;
//   2. the vault on chain holds that proposal, Settled, with the same recipient, token and amount;
//   3. the approval transaction was signed by the case owner, called approve_payment with exactly
//      those fields and that hash, and the token contract logged the transfer to the hospital;
//   4. the agent account's keys today: the app's key can call only the vault's agent methods;
//   5. the testnet vault runs the build the tests and mutation checks ran against;
//   6. the activity-log anchor recorded in the evidence is stored on the vault.
// Exit code 0 when every check passes, 1 otherwise.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
// rpc.testnet.near.org is deprecated and rate-limited; dRPC serves current state. Old transactions
// leave regular nodes after a few days, so they are read from FastNEAR's archival node.
const RPC = arg("rpc", "https://near-testnet.drpc.org");
const ARCHIVAL = arg("archival-rpc", "https://archival-rpc.testnet.fastnear.com");
const RECEIPT = path.resolve(ROOT, arg("receipt", "docs/near/evidence/2026-11-03-testnet-receipt.json"));
const EVIDENCE = path.join(ROOT, "docs/redteam/near");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// ---- encodings (independent of the app's code, which imports npm packages) ----

/** JSON with sorted keys, as the app hashes receipts (src/lib/canonical.ts). */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest();

/** Approval commitment v1 (docs/near/STATE_AND_ENCODING.md §6): SHA-256 over Borsh fields. */
function commitmentHash(p, network, vault) {
  const le = (value, bytes) => {
    const out = Buffer.alloc(bytes);
    let v = BigInt(value);
    for (let i = 0; i < bytes; i++, v >>= 8n) out[i] = Number(v & 0xffn);
    return out;
  };
  const str = (s) => {
    const b = Buffer.from(s, "utf8");
    return Buffer.concat([le(b.length, 4), b]);
  };
  const parts = [
    str("kinwarden.approval.v1"), str(network), str(vault), str(p.case_id), str(p.invoice_id),
    le(p.proposal_id, 8), le(p.attempt, 4), str(p.token), str(p.recipient), le(p.amount, 16),
    le(p.expires_at, 8), le(p.policy_version, 8), le(p.payee_version, 8),
  ];
  return sha256(Buffer.concat(parts)).toString("hex");
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}

// ---- JSON-RPC ----

async function rpc(url, method, params) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "kinwarden-verify", method, params }) });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const body = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    if (body.error) throw new Error(`${method}: ${body.error.data ?? body.error.message ?? JSON.stringify(body.error)}`);
    return body.result;
  }
}
const query = (params) => rpc(RPC, "query", { finality: "final", ...params });
async function view(account, method, args = {}) {
  const r = await query({ request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  if (r.error || !r.result) throw new Error(`${account}.${method}: ${r.error ?? "no result"}`);
  return JSON.parse(Buffer.from(r.result).toString("utf8"));
}
const tx = (hash, sender) => rpc(ARCHIVAL, "EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" });

// ---- checks ----

const results = [];
async function check(title, fn, limit) {
  try {
    const detail = await fn();
    results.push({ title, ok: true, detail, limit });
  } catch (e) {
    results.push({ title, ok: false, detail: e.message, limit });
  }
}
function expect(cond, message) {
  if (!cond) throw new Error(message);
}
const tusdc = (units) => `${(Number(BigInt(units) / 10_000n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} tUSDC`;

const receipt = readJson(RECEIPT);
const { network, vault } = receipt;
const proposal = receipt.proposal;
let config;
let caseInfo;

console.log(`Kinwarden NEAR evidence check — ${network}, vault ${vault}`);
console.log(`Receipt: ${path.relative(ROOT, RECEIPT)}`);
console.log(`RPC: ${RPC} (state), ${ARCHIVAL} (archived transactions)\n`);

await check(
  "Receipt is unedited and its commitment hash recomputes",
  async () => {
    const { receipt_hash, ...body } = receipt;
    const recomputed = sha256(Buffer.from(stableStringify(body), "utf8")).toString("hex");
    expect(recomputed === receipt_hash, `receipt_hash ${receipt_hash} but the content hashes to ${recomputed}`);
    const commitment = commitmentHash(proposal, network, vault);
    expect(commitment === receipt.commitment_hash, `commitment_hash ${receipt.commitment_hash} but the proposal hashes to ${commitment}`);
    expect(receipt.paid_to.account === proposal.recipient, `paid_to ${receipt.paid_to.account} is not the proposal's recipient ${proposal.recipient}`);
    expect(receipt.token.contract === proposal.token, `token ${receipt.token.contract} is not the proposal's token ${proposal.token}`);
    expect(receipt.amount.units === proposal.amount, `amount ${receipt.amount.units} is not the proposal's amount ${proposal.amount}`);
    return `receipt ${receipt_hash.slice(0, 16)}…, commitment ${commitment.slice(0, 16)}…`;
  },
  "The hash shows the file was not changed after it was written; it does not prove the bill was genuine.",
);

await check("Vault holds the proposal, settled, with the receipt's recipient, token and amount", async () => {
  config ??= await view(vault, "get_config");
  expect(config.network === network, `vault is configured for ${config.network}`);
  const onChain = await view(vault, "get_proposal", { proposal_id: proposal.proposal_id });
  expect(onChain, `vault has no proposal ${proposal.proposal_id}`);
  for (const k of ["case_id", "invoice_id", "recipient", "token", "amount", "attempt", "expires_at", "policy_version", "payee_version"]) {
    expect(String(onChain[k]) === String(proposal[k]), `${k}: vault has ${onChain[k]}, receipt has ${proposal[k]}`);
  }
  expect(onChain.status === "Settled", `status is ${onChain.status}`);
  expect(onChain.token === config.token, `proposal token ${onChain.token} is not the vault's token ${config.token}`);
  expect(commitmentHash(onChain, network, vault) === receipt.commitment_hash, "the vault's proposal does not hash to the receipt's commitment");
  caseInfo = await view(vault, "get_case", { case_id: onChain.case_id });
  const payeeId = await view(vault, "get_payee_id_by_account", { account: onChain.recipient });
  const payee = payeeId ? await view(vault, "get_payee", { payee_id: payeeId }) : null;
  expect(payee, `recipient ${onChain.recipient} is not an enrolled payee`);
  return `proposal ${onChain.proposal_id}: ${tusdc(onChain.amount)} to ${onChain.recipient} (payee "${payeeId}", enrolled by ${config.verifier}), status Settled; case owner ${caseInfo.owner}`;
});

await check(
  "Approval transaction: case owner signed approve_payment for exactly these fields; the token logged the transfer",
  async () => {
    config ??= await view(vault, "get_config");
    caseInfo ??= await view(vault, "get_case", { case_id: proposal.case_id });
    const t = await tx(receipt.approval.tx, receipt.approval.by);
    const { signer_id, receiver_id, actions } = t.transaction;
    expect(signer_id === caseInfo?.owner, `signed by ${signer_id}, case owner is ${caseInfo?.owner}`);
    expect(receiver_id === vault, `sent to ${receiver_id}`);
    expect(actions.length === 1 && actions[0].FunctionCall, "expected one function call");
    const call = actions[0].FunctionCall;
    expect(call.method_name === "approve_payment", `called ${call.method_name}`);
    expect(call.deposit === "1", `attached ${call.deposit} yoctoNEAR (an approval needs exactly 1, which no limited key can attach)`);
    const a = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
    expect(a.case_id === proposal.case_id && String(a.proposal_id) === String(proposal.proposal_id), "approves another proposal");
    expect(a.expected_recipient === proposal.recipient, `approved recipient ${a.expected_recipient}`);
    expect(a.expected_token === proposal.token, `approved token ${a.expected_token}`);
    expect(String(a.expected_amount) === String(proposal.amount), `approved amount ${a.expected_amount}`);
    expect(String(a.expected_policy_version) === String(proposal.policy_version), `approved policy version ${a.expected_policy_version}`);
    expect(a.expected_proposal_hash === receipt.commitment_hash, `approved hash ${a.expected_proposal_hash}`);
    expect("SuccessValue" in t.status, `transaction failed: ${JSON.stringify(t.status)}`);
    const events = t.receipts_outcome
      .filter((r) => r.outcome.executor_id === proposal.token && "SuccessValue" in r.outcome.status)
      .flatMap((r) => r.outcome.logs)
      .filter((l) => l.startsWith("EVENT_JSON:"))
      .map((l) => JSON.parse(l.slice("EVENT_JSON:".length)))
      .filter((e) => e.standard === "nep141" && e.event === "ft_transfer")
      .flatMap((e) => e.data);
    expect(events.length === 1, `expected one token transfer, found ${events.length}`);
    const [ev] = events;
    expect(ev.old_owner_id === vault && ev.new_owner_id === proposal.recipient && ev.amount === proposal.amount, `transfer was ${JSON.stringify(ev)}`);
    const finished = t.receipts_outcome.some((r) => r.outcome.executor_id === vault && r.outcome.logs.includes(`proposal_finished ${proposal.proposal_id} status=Settled`));
    expect(finished, "no vault callback recording the settlement");
    const balance = await view(proposal.token, "ft_balance_of", { account_id: proposal.recipient });
    return `tx ${receipt.approval.tx.slice(0, 10)}… by ${signer_id}, 1 yoctoNEAR; ${tusdc(ev.amount)} from the vault to ${ev.new_owner_id}; hospital balance today ${tusdc(balance)}`;
  },
  "Shows the family's account approved and the vault paid. It does not show who controls that account or that the hospital is real (the verifier's off-chain decision, simulated here).",
);

await check(
  "Agent keys today: the app's key can call only the vault's agent methods",
  async () => {
    config ??= await view(vault, "get_config");
    const recorded = readJson(path.join(EVIDENCE, "bypass-testnet.json"));
    const AGENT_METHODS = new Set(["propose_payment", "sweep", "anchor_log"]);
    const list = await query({ request_type: "view_access_key_list", account_id: config.agent });
    const limited = list.keys.filter((k) => k.access_key.permission !== "FullAccess");
    const full = list.keys.filter((k) => k.access_key.permission === "FullAccess");
    for (const k of limited) {
      const fc = k.access_key.permission.FunctionCall;
      expect(fc.receiver_id === vault, `${k.public_key} may call ${fc.receiver_id}`);
      expect(fc.method_names.length > 0 && fc.method_names.every((m) => AGENT_METHODS.has(m)), `${k.public_key} may call ${fc.method_names.join(", ") || "any method"}`);
    }
    const refused = recorded.results.filter((r) => r.refusedBy === "protocol" || r.refusedBy === "contract").length;
    const byProtocol = recorded.results.filter((r) => r.refusedBy === "protocol").length;
    const app = limited.find((k) => k.public_key === recorded.permissions.appKey.publicKey);
    expect(app, `the app key from the recorded bypass run (${recorded.permissions.appKey.publicKey}) is no longer on ${config.agent}`);
    const fc = app.access_key.permission.FunctionCall;
    const allowance = (Number(BigInt(fc.allowance ?? 0) / 10n ** 21n) / 1000).toFixed(3);
    const fullNote = full.length ? `; ${full.length} full-access setup key(s), held by the deployment tooling, not the app server: ${full.map((k) => k.public_key).join(", ")}` : "";
    return `block ${list.block_height}: app key ${app.public_key.slice(0, 16)}… may call ${fc.method_names.join(", ")} on ${fc.receiver_id}, gas allowance ${allowance} NEAR${fullNote}. The recorded bypass run (${recorded.ranAt}) sent ${recorded.results.length} attacks with this key: ${refused} refused (${byProtocol} by NEAR key permissions, ${refused - byProtocol} by the vault), balances unchanged: ${recorded.held ? "yes" : "NO"}`;
  },
  "A function-call key cannot attach the 1 yoctoNEAR deposit that approval, enrollment, withdrawal and token transfers require (NEAR protocol). Replaying the attacks themselves needs the key: run them on a local node with `npm run test:near` (see README).",
);

await check("Testnet vault runs the build the tests and mutation checks ran against", async () => {
  const recorded = readJson(path.join(EVIDENCE, "testnet-vault.json"));
  const account = await query({ request_type: "view_account", account_id: vault });
  const tested = base58(Buffer.from(recorded.testedWasmSha256, "hex"));
  expect(account.code_hash === tested, `vault code hash ${account.code_hash}, tested build ${tested} (sha256 ${recorded.testedWasmSha256})`);
  let local = "";
  const wasm = path.join(ROOT, "contracts/near/target/near/kinwarden_vault/kinwarden_vault.wasm");
  if (fs.existsSync(wasm)) {
    const mine = sha256(fs.readFileSync(wasm)).toString("hex");
    local = mine === recorded.testedWasmSha256 ? "; your local build is byte-identical" : `; your local build differs (sha256 ${mine.slice(0, 16)}…): non-reproducible builds vary with the toolchain and path`;
  }
  return `code hash ${account.code_hash} = sha256 ${recorded.testedWasmSha256.slice(0, 16)}… (tested build)${local}`;
});

await check(
  "Activity-log anchor from the evidence is stored on the vault",
  async () => {
    config ??= await view(vault, "get_config");
    const recorded = readJson(path.join(EVIDENCE, "anchor-testnet.json"));
    const head = recorded.anchor.hash;
    const count = Number(await view(vault, "get_anchor_count", { case_id: proposal.case_id }));
    const anchors = [];
    for (let i = 0; i < count; i++) anchors.push(await view(vault, "get_anchor", { case_id: proposal.case_id, index: String(i) }));
    const found = anchors.find((a) => a.head === head && String(a.seq) === String(recorded.anchor.seq));
    expect(found, `no anchor with head ${head} among ${count}`);
    const t = await tx(recorded.anchor.chain.txHash, config.agent);
    const call = t.transaction.actions[0]?.FunctionCall;
    expect(t.transaction.signer_id === config.agent && call?.method_name === "anchor_log", "anchor transaction was not the agent's anchor_log");
    return `entry #${found.seq}, head ${head.slice(0, 16)}…, label "${found.label}", tx ${recorded.anchor.chain.txHash.slice(0, 10)}…`;
  },
  "Shows the log head existed when anchored. Recompute the head from the log with the app's anchor check (attack lab) to detect an edit.",
);

// ---- report ----

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.title}`);
  console.log(`      ${r.detail}`);
  if (r.limit) console.log(`      Limit: ${r.limit}`);
  console.log();
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
