import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";
import { forceAttack, labAttack, launchAttack } from "@/server/attacklab";
import { hasApiCredentials } from "@/server/agent/runner";

// Attack lab: launch an attack in the visitor's own sandbox, optionally let the live AI react to it,
// then force the AI to obey the attacker and report what the safety layer did.
const PER_VISITOR = Number(process.env.KINWARDEN_LAB_LIVE_PER_VISITOR ?? 3);
const PER_DAY = Number(process.env.KINWARDEN_LAB_LIVE_PER_DAY ?? 40);
const g = globalThis as unknown as { __kinwardenLab?: { day: string; total: number; byVisitor: Map<string, number>; pending: Map<string, { caseId: string; reason: string; detail: string }> } };
const lab = (g.__kinwardenLab ??= { day: "", total: 0, byVisitor: new Map(), pending: new Map() });

function liveLeft(sid: string) {
  const today = new Date().toISOString().slice(0, 10);
  if (lab.day !== today) Object.assign(lab, { day: today, total: 0, byVisitor: new Map() });
  if (!hasApiCredentials()) return 0;
  return Math.max(0, Math.min(PER_VISITOR - (lab.byVisitor.get(sid) ?? 0), PER_DAY - lab.total));
}

export async function GET(request: Request) {
  return Response.json({ liveLeft: liveLeft(sessionId(request)) });
}

export async function POST(request: Request) {
  const sid = sessionId(request);
  const body = (await request.json().catch(() => ({}))) as { action?: string; id?: string };
  try {
    const attack = labAttack(String(body.id));
    const rt = runtime(sid);
    if (body.action === "launch") {
      rt.runner.resetSession();
      const trigger = launchAttack(rt.store, attack.id);
      lab.pending.set(sid, trigger);
      return Response.json({ ok: true, liveLeft: liveLeft(sid) });
    }
    if (body.action === "live") {
      const trigger = lab.pending.get(sid);
      if (!trigger) throw new Error("Send the attack first.");
      if (liveLeft(sid) <= 0) throw new Error("No live AI runs left for now. The recorded result shows what the live AI did with this attack.");
      lab.pending.delete(sid);
      lab.total += 1;
      lab.byVisitor.set(sid, (lab.byVisitor.get(sid) ?? 0) + 1);
      rt.store.mutate((w) => (w.agent.mode = "live"));
      rt.runner.resetSession();
      rt.store.trigger(trigger);
      return Response.json({ ok: true, liveLeft: liveLeft(sid) });
    }
    if (body.action === "force") {
      return Response.json({ steps: forceAttack(rt.store, attack.id) });
    }
    throw new Error("action must be launch, live or force");
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
