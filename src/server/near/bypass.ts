// Gateway bypass with the agent's real key. A compromised app server holds exactly this key, so every
// attempt here skips Kinwarden's safety gateway and talks to NEAR directly. Each attempt records who
// stopped it (the NEAR protocol, because of the key's permissions, or the vault contract) and the
// reason, and the run checks that no balance an attacker could gain from changed.
import { Account, actions, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import type { NearDeployment } from "./config";
import { refusalCode } from "./vault";

const TGAS = BigInt(10) ** BigInt(12);
const YOCTO_PER_NEAR = BigInt(10) ** BigInt(24);

/** Protocol-level refusals of a function-call access key, as nearcore names them. */
const PROTOCOL_REFUSALS = ["DepositWithFunctionCall", "MethodNameMismatch", "ReceiverMismatch", "RequiresFullAccess", "NotEnoughAllowance"];

export interface KeyReport {
  publicKey: string;
  kind: "FullAccess" | "FunctionCall" | "Other";
  receiver?: string;
  methods?: string[];
  /** gas allowance in NEAR, for transaction fees only; null means unlimited */
  allowanceNear?: string | null;
  note: string;
}

/** Read-only snapshot of what the agent account's keys can do, at one block. */
export interface PermissionsReport {
  account: string;
  observedAt: { blockHeight: number; blockHash: string };
  appKey: KeyReport | null;
  otherKeys: KeyReport[];
  /** the vault's payment limits are separate from the key's gas allowance */
  paymentLimitsNote: string;
}

export async function permissionsReport(provider: JsonRpcProvider, d: NearDeployment, appPublicKey: string): Promise<PermissionsReport> {
  const list = await provider.viewAccessKeyList({ accountId: d.agent, finalityQuery: { finality: "final" } });
  const keys: KeyReport[] = list.keys.map((k) => {
    const p = k.access_key.permission;
    if (p === "FullAccess") {
      return {
        publicKey: k.public_key,
        kind: "FullAccess",
        note: "Setup key held by the deployment tooling (.near/keys.json), never by the app server. It can do anything this account can, including deleting the app's key.",
      };
    }
    if (!("FunctionCall" in p)) {
      return { publicKey: k.public_key, kind: "Other", note: `Key of another kind (${Object.keys(p)[0]}); reported, not used by Kinwarden.` };
    }
    const fc = p.FunctionCall;
    return {
      publicKey: k.public_key,
      kind: "FunctionCall",
      receiver: fc.receiver_id,
      methods: fc.method_names,
      allowanceNear: fc.allowance == null ? null : formatNear(BigInt(fc.allowance)),
      note: k.public_key === appPublicKey ? "The app server's key." : "Another limited key on this account.",
    };
  });
  return {
    account: d.agent,
    observedAt: { blockHeight: list.block_height, blockHash: list.block_hash },
    appKey: keys.find((k) => k.publicKey === appPublicKey) ?? null,
    otherKeys: keys.filter((k) => k.publicKey !== appPublicKey),
    paymentLimitsNote: "The allowance only pays transaction fees. What the agent can spend is set by the family's case limits in the vault, and nothing moves without the family's wallet approval.",
  };
}

function formatNear(yocto: bigint): string {
  const milli = (yocto * BigInt(1000)) / YOCTO_PER_NEAR;
  return (Number(milli) / 1000).toFixed(3);
}

export interface BypassContext {
  agent: Account;
  deployment: NearDeployment;
  /** the family's vault case the agent works on */
  caseId: string;
  /** a proposal awaiting approval, to try approving it */
  pendingProposalId?: string;
  /** an invoice the verifier authorized, to try paying more than the limits allow */
  authorizedInvoiceId?: string;
}

export interface BypassAttempt {
  id: string;
  title: string;
  /** what was sent: receiver, action and arguments in short */
  sent: string;
  run: (c: BypassContext) => Promise<unknown>;
}

const call = (c: BypassContext, receiverId: string, method: string, args: Record<string, unknown>, deposit = BigInt(0), tgas = 50) =>
  c.agent.signAndSendTransaction({ receiverId, actions: [actions.functionCall(method, args, BigInt(tgas) * TGAS, deposit)] });

export const BYPASS_ATTEMPTS: BypassAttempt[] = [
  {
    id: "approve-with-deposit",
    title: "Approve its own payment proposal, attaching the 1 yoctoNEAR an approval needs",
    sent: "vault.approve_payment, deposit 1 yoctoNEAR",
    run: (c) => call(c, c.deployment.vault, "approve_payment", { case_id: c.caseId, proposal_id: c.pendingProposalId ?? "0" }, BigInt(1), 150),
  },
  {
    id: "approve-without-deposit",
    title: "Approve its own payment proposal without a deposit",
    sent: "vault.approve_payment, no deposit",
    run: (c) => call(c, c.deployment.vault, "approve_payment", { case_id: c.caseId, proposal_id: c.pendingProposalId ?? "0" }, BigInt(0), 150),
  },
  {
    id: "enroll-own-account",
    title: "Enroll its own account as a hospital so it can be paid",
    sent: "vault.enroll_payee(agent account)",
    run: (c) =>
      call(c, c.deployment.vault, "enroll_payee", { payee_id: "attacker", account: c.deployment.agent, purpose_group: "Hospital", provenance: "0".repeat(64) }),
  },
  {
    id: "authorize-invoice",
    title: "Authorize a fake invoice for itself",
    sent: "vault.authorize_invoice",
    run: (c) => call(c, c.deployment.vault, "authorize_invoice", { invoice_id: "attacker-inv", case_id: c.caseId, payee_id: "srh", ceiling: "1000000000000" }),
  },
  {
    id: "switch-agent-on",
    title: "Switch itself back on after the family switched it off",
    sent: "vault.enable_agent",
    run: (c) => call(c, c.deployment.vault, "enable_agent", { case_id: c.caseId }),
  },
  {
    id: "withdraw",
    title: "Withdraw the case's money",
    sent: "vault.withdraw",
    run: (c) => call(c, c.deployment.vault, "withdraw", { case_id: c.caseId, amount: "1000000" }),
  },
  {
    id: "token-transfer",
    title: "Move tokens with the token contract directly, skipping the vault",
    sent: "tusdc.ft_transfer(to agent), deposit 1 yoctoNEAR",
    run: (c) => call(c, c.deployment.token, "ft_transfer", { receiver_id: c.deployment.agent, amount: "1000000" }, BigInt(1)),
  },
  {
    id: "token-transfer-no-deposit",
    title: "Call the token contract without a deposit",
    sent: "tusdc.ft_transfer(to agent), no deposit",
    run: (c) => call(c, c.deployment.token, "ft_transfer", { receiver_id: c.deployment.agent, amount: "1000000" }),
  },
  {
    id: "add-full-key",
    title: "Give itself a full-access key",
    sent: "AddKey(full access) on the agent account",
    run: (c) => c.agent.addFullAccessKey(KeyPair.fromRandom("ed25519").getPublicKey()),
  },
  {
    id: "deploy-code",
    title: "Deploy its own code on the agent account",
    sent: "DeployContract on the agent account",
    run: (c) => c.agent.deployContract(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])),
  },
  {
    id: "send-near",
    title: "Send NEAR out of the agent account",
    sent: "Transfer 0.01 NEAR to the vault",
    run: (c) => c.agent.signAndSendTransaction({ receiverId: c.deployment.vault, actions: [actions.transfer(YOCTO_PER_NEAR / BigInt(100))] }),
  },
  {
    id: "propose-unauthorized-invoice",
    title: "Propose paying an invoice the verifier never authorized (for a look-alike recipient)",
    sent: "vault.propose_payment(unknown invoice)",
    run: (c) =>
      call(c, c.deployment.vault, "propose_payment", { case_id: c.caseId, invoice_id: "lookalike-srh-dep", request_id: `bypass-${Date.now()}`, amount: "1000000", ttl_seconds: 3600 }),
  },
  {
    id: "propose-over-limit",
    title: "Propose a payment above the family's limits on a real invoice",
    sent: "vault.propose_payment(authorized invoice, 1,000,000 tUSDC)",
    run: (c) =>
      call(c, c.deployment.vault, "propose_payment", {
        case_id: c.caseId,
        invoice_id: c.authorizedInvoiceId ?? "none",
        request_id: `bypass-${Date.now()}`,
        amount: (BigInt(1_000_000) * BigInt(1_000_000)).toString(),
        ttl_seconds: 3600,
      }),
  },
];

export interface BypassResult {
  id: string;
  title: string;
  sent: string;
  /** who refused it; "not refused" means the attack worked and is a failure of the system */
  refusedBy: "protocol" | "contract" | "not refused";
  reason: string;
  /** a transaction hash when the attempt reached the chain (contract refusals cost gas) */
  tx?: string;
}

function classify(err: unknown): { refusedBy: BypassResult["refusedBy"]; reason: string; tx?: string } {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify(err)}` : String(err);
  const protocol = PROTOCOL_REFUSALS.find((p) => text.includes(p));
  if (protocol) return { refusedBy: "protocol", reason: protocol };
  const code = refusalCode(err);
  const tx = text.match(/"transaction_hash"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{32,64})"/)?.[1];
  if (code) return { refusedBy: "contract", reason: code, ...(tx ? { tx } : {}) };
  return { refusedBy: "contract", reason: `UNCLASSIFIED: ${text.slice(0, 160)}` };
}

export interface Balances {
  agentTokens: string;
  vaultTokens: string;
  caseBalance: string;
  caseReserved: string;
  caseInFlight: string;
  casePaid: string;
}

export async function readBalances(provider: JsonRpcProvider, d: NearDeployment, caseId: string): Promise<Balances> {
  const view = <T>(contractId: string, method: string, args: Record<string, unknown>) => provider.callFunction({ contractId, method, args }) as Promise<T>;
  const [agentTokens, vaultTokens, c] = await Promise.all([
    view<string>(d.token, "ft_balance_of", { account_id: d.agent }),
    view<string>(d.token, "ft_balance_of", { account_id: d.vault }),
    view<{ balance: string; reserved: string; in_flight: string; paid: string } | null>(d.vault, "get_case", { case_id: caseId }),
  ]);
  return {
    agentTokens,
    vaultTokens,
    caseBalance: c?.balance ?? "0",
    caseReserved: c?.reserved ?? "0",
    caseInFlight: c?.in_flight ?? "0",
    casePaid: c?.paid ?? "0",
  };
}

export interface BypassRun {
  network: string;
  vault: string;
  ranAt: string;
  permissions: PermissionsReport;
  results: BypassResult[];
  before: Balances;
  after: Balances;
  /** true when every attempt was refused and no balance changed */
  held: boolean;
}

/** Run every attempt with the agent's real key against the deployed vault, then compare balances. */
export async function runBypass(input: { provider: JsonRpcProvider; deployment: NearDeployment; agentKey: string } & Omit<BypassContext, "agent" | "deployment">): Promise<BypassRun> {
  const { provider, deployment: d } = input;
  const key = input.agentKey as KeyPairString;
  const agent = new Account(d.agent, provider, key);
  const ctx: BypassContext = { agent, deployment: d, caseId: input.caseId, pendingProposalId: input.pendingProposalId, authorizedInvoiceId: input.authorizedInvoiceId };
  const permissions = await permissionsReport(provider, d, KeyPair.fromString(key).getPublicKey().toString());
  const before = await readBalances(provider, d, input.caseId);
  const results: BypassResult[] = [];
  for (const a of BYPASS_ATTEMPTS) {
    try {
      const out = (await a.run(ctx)) as { transaction?: { hash?: string } };
      results.push({ id: a.id, title: a.title, sent: a.sent, refusedBy: "not refused", reason: "ACCEPTED", tx: out?.transaction?.hash });
    } catch (err) {
      results.push({ id: a.id, title: a.title, sent: a.sent, ...classify(err) });
    }
  }
  const after = await readBalances(provider, d, input.caseId);
  const unchanged = (Object.keys(before) as (keyof Balances)[]).every((k) => before[k] === after[k]);
  return {
    network: d.network,
    vault: d.vault,
    ranAt: new Date().toISOString(),
    permissions,
    results,
    before,
    after,
    held: unchanged && results.every((r) => r.refusedBy !== "not refused" && !r.reason.startsWith("UNCLASSIFIED")),
  };
}
