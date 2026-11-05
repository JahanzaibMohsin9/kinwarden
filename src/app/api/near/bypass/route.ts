import { JsonRpcProvider } from "near-api-js";
import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";
import { nearReadOnly } from "@/server/near/config";
import { permissionsReport, type BypassRun } from "@/server/near/bypass";
import recordedTestnet from "../../../../../docs/redteam/near/bypass-testnet.json";

/** The agent key's permissions, read from the chain now, and the last bypass run. Changes nothing. */
export async function GET(request: Request) {
  const { near } = runtime(sessionId(request));
  if (!near) {
    // public demo: no agent key on the server, so the permissions are read with the public key and the
    // run shown is the one recorded on testnet with the real key
    const ro = nearReadOnly();
    if (!ro) return Response.json({ configured: false });
    const d = ro.deployment;
    try {
      const permissions = await permissionsReport(new JsonRpcProvider({ url: d.rpcUrl }), d, ro.agentPublicKey);
      const lastRun = recordedTestnet.network === d.network && recordedTestnet.vault === d.vault ? (recordedTestnet as unknown as BypassRun) : null;
      return Response.json({ configured: true, readOnly: true, network: d.network, vault: d.vault, explorerTx: d.explorerTx ?? null, permissions, lastRun });
    } catch (err) {
      return Response.json({ configured: true, readOnly: true, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }
  try {
    return Response.json({ configured: true, network: near.deployment.network, vault: near.deployment.vault, explorerTx: near.deployment.explorerTx ?? null, permissions: await near.permissions(), lastRun: near.lastBypass ?? null });
  } catch (err) {
    return Response.json({ configured: true, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

/** Run every gateway-bypass attempt with the app's real agent key against the configured network. */
export async function POST(request: Request) {
  const { near } = runtime(sessionId(request));
  if (!near) {
    if (nearReadOnly()) return Response.json({ error: "This public demo holds no NEAR key, so it cannot rerun the attack. The run recorded on testnet with the real key is shown." }, { status: 403 });
    return Response.json({ error: "NEAR is not configured." }, { status: 404 });
  }
  try {
    return Response.json(await near.bypass());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
