import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";

// Re-check one anchor against the public chain and against the log as it is now.
export async function POST(request: Request) {
  const { anchors } = runtime(sessionId(request));
  if (!anchors) return Response.json({ error: "On-chain anchoring is not configured on this server." }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    return Response.json(await anchors.check(body.id));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
