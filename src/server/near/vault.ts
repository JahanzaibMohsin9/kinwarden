// Thin client for the Kinwarden vault. It holds only the agent's function-call key, and checks that
// key's real permissions on chain before using it: a secret key string does not reveal its authority.
import { Account, actions, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import type { VaultProposal } from "@/near/commitment";
import { AGENT_METHODS, type NearConfig, type NearDeployment } from "./config";

export interface VaultPreview {
  proposal: VaultProposal;
  commitment_hash: string;
  blockers: string[];
  case_available: string;
  invoice_remaining: string;
  rolling_24h_remaining: string;
  group_24h_remaining: string;
  lifetime_remaining: string;
}

export interface VaultCase {
  owner: string;
  status: "Active" | "Paused";
  agent_enabled: boolean;
  policy_version: number;
  balance: string;
  reserved: string;
  in_flight: string;
  paid: string;
  pending: number[];
  limits: { per_payment_max: string; rolling_24h_cap: string; lifetime_cap: string; group_caps: { group: string; rolling_24h_cap: string }[] };
}

export type KeyCheck =
  | { ok: true; publicKey: string; methods: string[]; allowance: string }
  | { ok: false; publicKey?: string; reason: string };

const TGAS = BigInt(10) ** BigInt(12);

export class VaultClient {
  readonly provider: JsonRpcProvider;
  readonly deployment: NearDeployment;
  private readonly agent: Account;
  readonly publicKey: string;

  constructor(cfg: NearConfig) {
    this.deployment = cfg.deployment;
    this.provider = new JsonRpcProvider({ url: cfg.deployment.rpcUrl });
    const key = cfg.agentKey as KeyPairString;
    this.publicKey = KeyPair.fromString(key).getPublicKey().toString();
    this.agent = new Account(cfg.deployment.agent, this.provider, key);
  }

  async view<T>(method: string, args: Record<string, unknown> = {}, contractId = this.deployment.vault): Promise<T> {
    return (await this.provider.callFunction({ contractId, method, args })) as T;
  }

  getCase(caseId: string) {
    return this.view<VaultCase | null>("get_case", { case_id: caseId });
  }

  getProposal(proposalId: string) {
    return this.view<VaultProposal | null>("get_proposal", { proposal_id: proposalId });
  }

  getProposalByRequest(caseId: string, requestId: string) {
    return this.view<VaultProposal | null>("get_proposal_by_request", { case_id: caseId, request_id: requestId });
  }

  preview(proposalId: string) {
    return this.view<VaultPreview | null>("approval_preview", { proposal_id: proposalId });
  }

  getInvoice(invoiceId: string) {
    return this.view<{ status: string; ceiling: string; paid: string } | null>("get_invoice", { invoice_id: invoiceId });
  }

  async tokenBalance(accountId: string): Promise<bigint> {
    const v = await this.view<string>("ft_balance_of", { account_id: accountId }, this.deployment.token);
    return BigInt(v);
  }

  /**
   * The agent key must be a function-call key for the vault, limited to the agent's methods, with a
   * gas allowance. A full-access key, another receiver, extra methods or an unlimited allowance fail.
   */
  async checkAgentKey(): Promise<KeyCheck> {
    let view: { permission: unknown };
    try {
      view = (await this.provider.viewAccessKey({ accountId: this.deployment.agent, publicKey: this.publicKey })) as { permission: unknown };
    } catch (err) {
      return { ok: false, publicKey: this.publicKey, reason: `The agent key is not on ${this.deployment.agent}: ${err instanceof Error ? err.message : String(err)}` };
    }
    const p = view.permission as "FullAccess" | { FunctionCall: { allowance?: string | null; receiver_id: string; method_names: string[] } };
    if (p === "FullAccess") return { ok: false, publicKey: this.publicKey, reason: "The agent key has full access. Give the app a function-call key only." };
    const fc = p.FunctionCall;
    if (fc.receiver_id !== this.deployment.vault) return { ok: false, publicKey: this.publicKey, reason: `The agent key may call ${fc.receiver_id}, not the vault.` };
    const allowed = new Set<string>(AGENT_METHODS);
    if (!fc.method_names.length || fc.method_names.some((m) => !allowed.has(m))) {
      return { ok: false, publicKey: this.publicKey, reason: `The agent key may call [${fc.method_names.join(", ") || "any method"}]; only ${AGENT_METHODS.join(", ")} are allowed.` };
    }
    if (fc.allowance === null || fc.allowance === undefined) return { ok: false, publicKey: this.publicKey, reason: "The agent key has no gas allowance limit." };
    return { ok: true, publicKey: this.publicKey, methods: fc.method_names, allowance: fc.allowance };
  }

  /** Agent: ask the vault for a payment. Attaches no deposit; the key could not attach one anyway. */
  async propose(args: { caseId: string; invoiceId: string; requestId: string; amountUnits: string; ttlSeconds: number }): Promise<VaultProposal> {
    return (await this.agent.callFunction({
      contractId: this.deployment.vault,
      methodName: "propose_payment",
      args: { case_id: args.caseId, invoice_id: args.invoiceId, request_id: args.requestId, amount: args.amountUnits, ttl_seconds: args.ttlSeconds },
      gas: BigInt(50) * TGAS,
    })) as VaultProposal;
  }

  /** Anyone: release proposals that can no longer be approved. */
  async sweep(caseId: string): Promise<number> {
    return (await this.agent.callFunction({ contractId: this.deployment.vault, methodName: "sweep", args: { case_id: caseId }, gas: BigInt(50) * TGAS })) as number;
  }

  /** Agent: anchor the activity log's head hash on the vault. Returns the transaction hash. */
  async anchor(caseId: string, seq: number, head: string, label: string): Promise<string> {
    const out = (await this.agent.signAndSendTransaction({
      receiverId: this.deployment.vault,
      actions: [actions.functionCall("anchor_log", { case_id: caseId, seq: String(seq), head, label }, BigInt(30) * TGAS, BigInt(0))],
    })) as unknown as { transaction: { hash: string } };
    return out.transaction.hash;
  }
}

/** The contract's refusal code (E_…) inside a failed call's error, if any. */
export function refusalCode(err: unknown): string | undefined {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { cause?: unknown }).cause ?? "")}` : String(err);
  return text.match(/\bE_[A-Z_]+\b/)?.[0];
}
