import { sessionId, sessionsEnabled } from "@/server/session";

// The visitor's own MCP address: /api/mcp?world=<their sandbox> (or plain /api/mcp locally).
export async function GET(request: Request) {
  const sid = sessionId(request);
  return Response.json({ path: sessionsEnabled() ? `/api/mcp?world=${sid}` : "/api/mcp" });
}
