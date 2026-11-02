import { listPasskeys, removePasskeys } from "@/server/passkey";
import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";

export async function GET() {
  return Response.json(listPasskeys().map((k) => ({ id: k.id, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })));
}

export async function DELETE(request: Request) {
  removePasskeys();
  runtime(sessionId(request)).store.mutate(() => {});
  return Response.json({ ok: true });
}
