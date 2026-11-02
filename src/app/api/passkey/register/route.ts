import { register, registrationOptions } from "@/server/passkey";
import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";

const originOf = (req: Request) => req.headers.get("origin") ?? new URL(req.url).origin;

export async function GET(request: Request) {
  return Response.json(registrationOptions(originOf(request), sessionId(request)));
}

export async function POST(request: Request) {
  try {
    const sid = sessionId(request);
    const key = register(await request.json(), originOf(request), sid);
    // push fresh state to open apps so the approval screen switches to the passkey
    runtime(sid).store.mutate(() => {});
    return Response.json({ ok: true, id: key.id, label: key.label });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
