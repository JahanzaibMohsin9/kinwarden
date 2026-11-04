import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";

/** The agent key's permissions, read from the chain now, and the last bypass run. Changes nothing. */
export async function GET(request: Request) {
  const { near } = runtime(sessionId(request));
  if (!near) return Response.json({ configured: false });
  try {
    return Response.json({ configured: true, network: near.deployment.network, vault: near.deployment.vault, explorerTx: near.deployment.explorerTx ?? null, permissions: await near.permissions(), lastRun: near.lastBypass ?? null });
  } catch (err) {
    return Response.json({ configured: true, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

/** Run every gateway-bypass attempt with the app's real agent key against the configured network. */
export async function POST(request: Request) {
  const { near } = runtime(sessionId(request));
  if (!near) return Response.json({ error: "NEAR is not configured." }, { status: 404 });
  try {
    return Response.json(await near.bypass());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
