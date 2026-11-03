// NEAR vault configuration. `.near/deployment.json` (written by scripts/near/setup.mjs, Git-ignored)
// says where the contracts and role accounts are; the agent's function-call key comes only from the
// environment. Without both, the app runs exactly as before with simulated rails.
import fs from "node:fs";
import path from "node:path";

export interface NearDeployment {
  network: "sandbox" | "testnet";
  rpcUrl: string;
  /** transaction explorer prefix, e.g. https://testnet.nearblocks.io/txns/ (none for sandbox) */
  explorerTx?: string;
  vault: string;
  token: string;
  tokenSymbol: string;
  tokenDecimals: number;
  verifier: string;
  agent: string;
  /** world case id → the family's vault case */
  cases: Record<string, { vaultCaseId: string; owner: string }>;
  /** world institution id → its verifier-enrolled payee */
  payees: Record<string, { payeeId: string; account: string }>;
}

export interface NearConfig {
  deployment: NearDeployment;
  agentKey: string;
}

/** Methods the app's agent key may call. Anything broader disables NEAR. */
export const AGENT_METHODS = ["propose_payment", "sweep"] as const;

export function deploymentFile(): string {
  return process.env.NEAR_DEPLOYMENT_FILE || path.join(process.cwd(), ".near", "deployment.json");
}

export function nearConfig(): NearConfig | null {
  const file = deploymentFile();
  const agentKey = process.env.NEAR_AGENT_KEY;
  if (!agentKey || !fs.existsSync(file)) return null;
  const deployment = JSON.parse(fs.readFileSync(file, "utf8")) as NearDeployment;
  return { deployment, agentKey };
}

export function explorerTx(d: NearDeployment, hash: string): string | undefined {
  return d.explorerTx ? `${d.explorerTx}${hash}` : undefined;
}
