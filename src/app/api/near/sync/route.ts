import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";

/** Read the vault now instead of waiting for the next background check. Changes nothing on chain. */
export async function POST(request: Request) {
  const { near } = runtime(sessionId(request));
  if (!near) return Response.json({ error: "NEAR is not configured." }, { status: 404 });
  await near.sync();
  return Response.json({ ok: true, agentKey: near.keyCheck ?? null });
}
