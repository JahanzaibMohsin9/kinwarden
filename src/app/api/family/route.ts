import { familyMessage, runtime, setKillSwitch } from "@/server/runtime";
import { sessionId } from "@/server/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { action?: string; caseId?: string; text?: string; on?: boolean; voice?: boolean };
  const sid = sessionId(request);
  if (body.action === "kill") {
    setKillSwitch(Boolean(body.on), sid);
    return Response.json({ ok: true });
  }
  const { store } = runtime(sid);
  if (!body.caseId || !store.world.cases[body.caseId] || !body.text?.trim()) {
    return Response.json({ error: "caseId and text are required" }, { status: 400 });
  }
  familyMessage(body.caseId, body.text.trim().slice(0, 1000), sid, { voice: body.voice === true });
  return Response.json({ ok: true });
}
