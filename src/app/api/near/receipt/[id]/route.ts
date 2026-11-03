import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";

/** Case receipt for a NEAR payment (see NearBridge.receipt): a download, or inline with ?view=1. */
export async function GET(request: Request, ctx: RouteContext<"/api/near/receipt/[id]">) {
  const { id } = await ctx.params;
  const { near } = runtime(sessionId(request));
  const receipt = near ? await near.receipt(id) : null;
  if (!receipt) return Response.json({ error: "No NEAR receipt for this payment." }, { status: 404 });
  if (new URL(request.url).searchParams.get("view") === "1") return Response.json(receipt);
  return new Response(JSON.stringify(receipt, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="kinwarden-receipt-${receipt.proposal.proposal_id}.json"`,
    },
  });
}
