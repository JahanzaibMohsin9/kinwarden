// Test harness for *.sandbox.ts: a local NEAR node with Kinwarden deployed, a TEST-ONLY family account
// and its case opened and funded. Never imported by the app.
import fs from "node:fs";
import path from "node:path";
import type { Account } from "near-api-js";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import type { NearDeployment } from "./config";
import * as setup from "../../../scripts/near/lib.mjs";

export interface SandboxDeployment {
  sandbox: Sandbox;
  deployment: NearDeployment;
  keys: Record<string, string>;
  agentKey: string;
  family: Account;
  caseId: string;
}

export async function startSandboxDeployment(caseId: string, fundTusdc = 30_000): Promise<SandboxDeployment> {
  const sandbox = await Sandbox.start({ version: "2.14.0" });
  const rpc = sandbox.rpcUrl;
  const root = setup.account(rpc, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY);
  const familyKey = setup.newKey();
  await root.createSubAccount({ accountOrPrefix: "family", publicKey: familyKey.publicKey, nearToTransfer: BigInt(10) * BigInt(10) ** BigInt(24) });
  const familyId = `family.${DEFAULT_ACCOUNT_ID}`;
  const out = await setup.deploy({ rpc, network: "sandbox", rootId: DEFAULT_ACCOUNT_ID, rootKey: DEFAULT_PRIVATE_KEY, familyId, log: () => {} });
  const deployment: NearDeployment = { ...out.deployment, cases: { case_th: { vaultCaseId: caseId, owner: familyId } } };
  const family = setup.account(rpc, familyId, familyKey.secretKey);
  await setup.openAndFundCase({ rpc, deployment, family, caseId, fundUnits: (BigInt(fundTusdc) * setup.TUSDC).toString() });
  return { sandbox, deployment, keys: out.keys, agentKey: out.agentKey, family, caseId };
}

/** Writes a JSON evidence file when KINWARDEN_EVIDENCE_DIR is set (scripts/near/evidence.sh sets it). */
export function writeEvidence(name: string, value: unknown) {
  const dir = process.env.KINWARDEN_EVIDENCE_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + "\n");
}
