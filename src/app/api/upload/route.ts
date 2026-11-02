import { draftFromBill, MAX_UPLOAD_BYTES, readBillText, sampleDraft } from "@/server/upload";
import type { CaseType } from "@/domain/types";

// Reads an uploaded bill into a draft the family checks. Nothing is created or paid here.
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const home = form.get("home") === "CN" ? "CN" : "PK";
    const type: CaseType = form.get("type") === "tuition" ? "tuition" : "medical";
    const family = {
      home: home as "PK" | "CN",
      type,
      payerName: String(form.get("payerName") ?? "").trim().slice(0, 80),
      subjectName: String(form.get("subjectName") ?? "").trim().slice(0, 80),
      alreadyAbroad: form.get("alreadyAbroad") === "true",
    };
    if (family.payerName.length < 2 || family.subjectName.length < 2) return Response.json({ error: "Enter both names first." }, { status: 400 });
    if (form.get("sample") === "true") return Response.json({ draft: sampleDraft(family) });

    const file = form.get("file");
    const upload =
      file instanceof File && file.size > 0
        ? file.size > MAX_UPLOAD_BYTES
          ? null
          : { type: file.type, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
        : undefined;
    if (upload === null) return Response.json({ error: "The file is larger than 8 MB." }, { status: 400 });
    const read = await readBillText({ file: upload, text: String(form.get("text") ?? "") });
    return Response.json({ draft: await draftFromBill(read, family) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
