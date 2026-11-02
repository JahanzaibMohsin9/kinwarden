import { startUploadedCase } from "@/server/runtime";
import { UploadedBillSchema } from "@/server/upload";
import type { UploadedBill } from "@/domain/types";
import { sessionId } from "@/server/session";

// The family confirmed the draft: start a case from their bill. The institution stays unverified.
export async function POST(request: Request) {
  const parsed = UploadedBillSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join(" ") }, { status: 400 });
  }
  startUploadedCase(parsed.data as UploadedBill, sessionId(request));
  return Response.json({ ok: true });
}
