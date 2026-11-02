import { directorAction } from "@/server/runtime";
import { sessionId } from "@/server/session";

export async function POST(request: Request) {
  try {
    directorAction((await request.json()) as Record<string, unknown>, sessionId(request));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
