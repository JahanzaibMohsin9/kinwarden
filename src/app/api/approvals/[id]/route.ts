import { checkApprover, decideApproval, runtime } from "@/server/runtime";
import { verifyApproval, type Assertion } from "@/server/passkey";
import { sessionId } from "@/server/session";

export async function POST(request: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  // `as`: the family member acting in the app (family roles: only the payer approves)
  const body = (await request.json()) as { decision?: string; method?: string; assertion?: Assertion; as?: string };
  if (body.decision !== "approved" && body.decision !== "declined") {
    return Response.json({ error: "decision must be approved or declined" }, { status: 400 });
  }
  const sid = sessionId(request);
  const { store } = runtime(sid);
  try {
    if (body.method === "passkey") {
      // the signature must cover this payment exactly; checked before anything moves
      if (!body.assertion) throw new Error("A passkey approval needs a signed assertion.");
      const origin = request.headers.get("origin") ?? new URL(request.url).origin;
      checkApprover(store, id, body.decision, body.as);
      const evidence = verifyApproval(store.world, id, body.assertion, origin, sid);
      decideApproval(id, body.decision, "passkey", evidence, body.as, sid);
    } else {
      decideApproval(id, body.decision, "hold", undefined, body.as, sid);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
