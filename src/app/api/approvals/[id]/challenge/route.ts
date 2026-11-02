import { runtime } from "@/server/runtime";
import { approvalChallenge } from "@/server/passkey";
import { sessionId } from "@/server/session";

/** A WebAuthn challenge that commits to this exact payment (amount, account, reference). */
export async function POST(request: Request, ctx: RouteContext<"/api/approvals/[id]/challenge">) {
  const { id } = await ctx.params;
  try {
    const sid = sessionId(request);
    return Response.json(approvalChallenge(runtime(sid).store.world, id, sid));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
