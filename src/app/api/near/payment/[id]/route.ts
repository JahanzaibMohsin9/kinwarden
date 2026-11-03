import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";

/** Which vault proposal a payment is. The approval screen reads the proposal itself from NEAR. */
export async function GET(request: Request, ctx: RouteContext<"/api/near/payment/[id]">) {
  const { id } = await ctx.params;
  const { store, near } = runtime(sessionId(request));
  const p = store.world.payments[id];
  if (!near || !p?.near) return Response.json({ error: "Not a NEAR payment." }, { status: 404 });
  return Response.json({ link: p.near, owner: near.deployment.cases[p.caseId]?.owner ?? null });
}

/** The wallet reported the family's approval transaction; it is kept only if the chain confirms it. */
export async function POST(request: Request, ctx: RouteContext<"/api/near/payment/[id]">) {
  const { id } = await ctx.params;
  const { near } = runtime(sessionId(request));
  if (!near) return Response.json({ error: "NEAR is not configured." }, { status: 404 });
  const body = (await request.json()) as { approvalTx?: string };
  if (!body.approvalTx || !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(body.approvalTx)) {
    return Response.json({ error: "approvalTx must be a NEAR transaction hash." }, { status: 400 });
  }
  try {
    const r = await near.recordApprovalTx(id, body.approvalTx);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  } catch (err) {
    return Response.json({ ok: false, reason: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
