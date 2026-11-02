import { runtime } from "@/server/runtime";
import { SESSION_ID, sessionId, sessionsEnabled } from "@/server/session";
import { handleMcp } from "@/server/mcp";

// Kinwarden's MCP endpoint (Streamable HTTP, stateless, JSON responses). An AI assistant connects to
//   https://<host>/api/mcp?world=<id>
// where <id> is the visitor's private sandbox (shown on /attack); without it, the request's own world.
// Only sandbox data, no AI cost on our side; a per-world cap keeps one client from flooding the log.
const PER_HOUR = Number(process.env.KINWARDEN_MCP_CALLS_PER_HOUR ?? 600);
const g = globalThis as unknown as { __kinwardenMcp?: Map<string, { hour: number; calls: number }> };
const usage = (g.__kinwardenMcp ??= new Map());

function worldOf(request: Request) {
  const asked = new URL(request.url).searchParams.get("world") ?? "";
  return sessionsEnabled() && SESSION_ID.test(asked) ? asked : sessionId(request);
}

function overLimit(sid: string, n: number) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const u = usage.get(sid);
  if (!u || u.hour !== hour) usage.set(sid, { hour, calls: n });
  else u.calls += n;
  return (usage.get(sid)?.calls ?? 0) > PER_HOUR;
}

const rpcError = (code: number, message: string, status: number) => Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });

export async function POST(request: Request) {
  // browsers send an Origin: only our own pages may call from a browser (MCP clients send none)
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin && origin !== "null" && new URL(origin).host !== host) return rpcError(-32600, "Cross-origin requests are not allowed", 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(-32700, "Parse error", 400);
  }
  const messages = Array.isArray(body) ? body : [body];
  const sid = worldOf(request);
  if (overLimit(sid, messages.length)) return rpcError(-32000, "Too many calls to this sandbox for now; try again in an hour.", 429);
  const store = runtime(sid).store;
  const replies = messages.map((m) => handleMcp(store, (m ?? {}) as Parameters<typeof handleMcp>[1])).filter((r) => r !== null);
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}

// no server-initiated stream: this server only answers requests
export async function GET() {
  return new Response("Kinwarden MCP endpoint: POST JSON-RPC here (MCP Streamable HTTP).", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
