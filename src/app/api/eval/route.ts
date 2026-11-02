import { runtime } from "@/server/runtime";
import { evaluateRun } from "@/server/evaluate";
import { sessionId } from "@/server/session";

export async function GET(request: Request) {
  const { store } = runtime(sessionId(request));
  return Response.json(evaluateRun(store.world, store.ledger));
}
