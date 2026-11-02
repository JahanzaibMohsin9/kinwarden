import { publicState } from "@/server/runtime";
import { sessionId } from "@/server/session";

export async function GET(request: Request) {
  return Response.json(publicState(sessionId(request)));
}
