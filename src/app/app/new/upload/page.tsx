"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Camera, FileText, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { DESTINATIONS } from "@/domain/corridors";
import type { CaseType, UploadedBill } from "@/domain/types";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/format";

type Draft = Omit<UploadedBill, "note" | "priorFxYearUSD"> & { redFlags: string[]; extractedBy: string; warnings: string[] };

const input = "h-11 w-full rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30";

/** Photos are shrunk in the browser before upload: smaller and faster to read, and enough for the text. */
async function shrinkPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="block text-[12.5px] font-semibold text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: { value: V; label: React.ReactNode }[]; onChange: (v: V) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-flow-col gap-1 rounded-full bg-surface-3 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-full text-[13.5px] font-semibold focus-visible:outline-2 focus-visible:outline-brand", value === o.value ? "bg-surface text-ink shadow-card" : "text-ink-2")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function UploadBill() {
  const router = useRouter();
  const { t, lang } = useT();
  const [home, setHome] = useState<"PK" | "CN">(lang === "zh" ? "CN" : "PK");
  const [type, setType] = useState<CaseType>("medical");
  const [payerName, setPayer] = useState("");
  const [subjectName, setSubject] = useState("");
  const [abroad, setAbroad] = useState(true);
  const [fxUsed, setFxUsed] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [busy, setBusy] = useState<"read" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState("");

  const namesOk = payerName.trim().length >= 2 && subjectName.trim().length >= 2;

  const read = async (sample = false) => {
    setBusy("read");
    setError(null);
    try {
      const fd = new FormData();
      fd.set("home", home);
      fd.set("type", type);
      fd.set("payerName", payerName);
      fd.set("subjectName", subjectName);
      fd.set("alreadyAbroad", String(type === "medical" && abroad));
      if (sample) fd.set("sample", "true");
      else if (paste !== null) fd.set("text", paste);
      else if (file) fd.set("file", await shrinkPhoto(file), file.type.startsWith("image/") && file.size >= 1_500_000 ? "photo.jpg" : file.name);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = (await r.json()) as { draft?: Draft; error?: string };
      if (!r.ok || !j.draft) throw new Error(j.error ?? "Could not read the bill.");
      setDraft(j.draft);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (!draft) return;
    setBusy("start");
    setError(null);
    try {
      // the draft's review-only fields (warnings, red flags) are dropped by the server's schema
      const body: UploadedBill = { ...draft, note: note.trim() || undefined, priorFxYearUSD: home === "CN" && fxUsed ? Number(fxUsed) : undefined };
      const r = await fetch("/api/upload/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Could not start the case.");
      router.push("/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setInst = (k: keyof Draft["institution"], v: string) => setDraft((d) => (d ? { ...d, institution: { ...d.institution, [k]: v } } : d));
  const total = draft ? draft.lineItems.reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0) : 0;

  const errorBox = error && (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      {error}
    </p>
  );

  return (
    <div className="space-y-5 px-4 pb-10 pt-5">
      <div>
        <button type="button" onClick={() => (draft ? setDraft(null) : router.push("/app/new"))} className="mb-2 inline-flex items-center gap-1 rounded-full text-[13px] font-semibold text-ink-2 focus-visible:outline-2 focus-visible:outline-brand">
          <ArrowLeft size={15} /> {t("uploadBack")}
        </button>
        <h1 className="text-[22px] font-bold tracking-tight">{draft ? t("uploadCheck") : t("uploadTitle")}</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">{draft ? t("uploadCheckHint") : t("uploadIntro")}</p>
      </div>

      {!draft ? (
        <>
          <Card className="space-y-4 p-4">
            <h2 className="text-[15px] font-semibold">{t("uploadWho")}</h2>
            <Field label={t("uploadHome")}>
              <Segmented
                label={t("uploadHome")}
                value={home}
                onChange={setHome}
                options={[
                  { value: "PK", label: <><Flag code="PK" /> Pakistan</> },
                  { value: "CN", label: <><Flag code="CN" /> 中国 China</> },
                ]}
              />
            </Field>
            <Field label={t("uploadKind")}>
              <Segmented label={t("uploadKind")} value={type} onChange={setType} options={[{ value: "medical", label: t("uploadHospital") }, { value: "tuition", label: t("uploadUniversity") }]} />
            </Field>
            <Field label={t("uploadPayer")}>
              <input className={input} value={payerName} onChange={(e) => setPayer(e.target.value)} autoComplete="name" maxLength={80} />
            </Field>
            <Field label={type === "medical" ? t("uploadPatient") : t("uploadStudent")}>
              <input className={input} value={subjectName} onChange={(e) => setSubject(e.target.value)} maxLength={80} />
            </Field>
            {type === "medical" && (
              <label className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" checked={abroad} onChange={(e) => setAbroad(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
                {t("uploadAbroad")}
              </label>
            )}
            {home === "CN" && (
              <Field label={t("uploadFxUsed")}>
                <input className={input} inputMode="numeric" value={fxUsed} onChange={(e) => setFxUsed(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" />
              </Field>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-[15px] font-semibold">{t("uploadTheBill")}</h2>
            {paste === null ? (
              <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-strong p-4 focus-within:border-brand", file && "border-brand bg-brand-softer")}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">{file?.type === "application/pdf" ? <FileText size={20} /> : <Camera size={20} />}</span>
                <span className="min-w-0 flex-1 text-[14px]">
                  <span className="block truncate font-semibold">{file ? file.name : t("uploadChoose")}</span>
                  <span className="block text-[12px] text-ink-3">PDF · JPEG · PNG · WebP · 8 MB</span>
                </span>
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            ) : (
              <div className="relative">
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={8} maxLength={20000} aria-label={t("uploadPaste")} className={cn(input, "h-auto py-2 font-mono text-[12.5px]")} />
                <button type="button" onClick={() => setPaste(null)} aria-label={t("uploadBack")} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-surface-3 text-ink-2">
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {paste === null && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPaste("")}>
                  {t("uploadPaste")}
                </Button>
              )}
              <Button type="button" variant="soft" size="sm" disabled={!namesOk || busy !== null} onClick={() => read(true)}>
                <Sparkles size={14} /> {t("uploadSample")}
              </Button>
            </div>
            <p className="text-[12px] leading-relaxed text-ink-3">{t("uploadPrivacy")}</p>
          </Card>

          {errorBox}
          <Button size="lg" className="w-full" disabled={!namesOk || busy !== null || (paste === null ? !file : paste.trim().length < 20)} onClick={() => read(false)}>
            {busy === "read" ? t("uploadReading") : t("uploadRead")}
          </Button>
        </>
      ) : (
        <>
          {(draft.warnings.length > 0 || draft.redFlags.length > 0) && (
            <Card className="space-y-1.5 border-amber/40 bg-amber-soft p-4 text-[13.5px] text-amber-strong">
              {draft.redFlags.length > 0 && <p className="font-semibold">{t("uploadRedFlags")}</p>}
              {[...draft.redFlags, ...draft.warnings].map((w) => (
                <p key={w} className="flex items-start gap-1.5">
                  <AlertTriangle size={14} className="mt-[3px] shrink-0" /> {w}
                </p>
              ))}
            </Card>
          )}

          <Card className="space-y-3 p-4">
            <Field label={t("uploadInstitution")}>
              <input className={input} value={draft.institution.name} onChange={(e) => setInst("name", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("uploadCountry")}>
                <select className={input} value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value, currency: DESTINATIONS[e.target.value].currency })}>
                  <option value="" disabled>
                    —
                  </option>
                  {Object.entries(DESTINATIONS)
                    .filter(([code]) => code !== draft.home)
                    .map(([code, d]) => (
                      <option key={code} value={code}>
                        {d.country} ({d.currency})
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={t("uploadCity")}>
                <input className={input} value={draft.institution.city} onChange={(e) => setInst("city", e.target.value)} />
              </Field>
            </div>
            <Field label={t("uploadEmail")}>
              <input className={input} type="email" value={draft.institution.email ?? ""} onChange={(e) => setInst("email", e.target.value)} />
            </Field>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-[15px] font-semibold">{t("uploadLines")}</h2>
            <ul className="space-y-2">
              {draft.lineItems.map((l, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input aria-label={`${t("uploadLines")} ${i + 1}`} className={cn(input, "h-10 min-w-0 flex-1 text-[13px]")} value={l.description} onChange={(e) => set("lineItems", draft.lineItems.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <input
                    aria-label={`${draft.currency} ${i + 1}`}
                    className={cn(input, "num h-10 w-28 text-right text-[13px]")}
                    inputMode="decimal"
                    value={String(l.amount)}
                    onChange={(e) => set("lineItems", draft.lineItems.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/[^\d.]/g, "")) } : x)))}
                  />
                </li>
              ))}
            </ul>
            <p className="num flex justify-between border-t border-line pt-2 text-[14px] font-semibold">
              <span>Total</span>
              <span>
                {draft.currency} {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${t("uploadDueNow")} (${draft.currency})`}>
                <input className={cn(input, "num")} inputMode="decimal" value={String(draft.amountDue)} onChange={(e) => set("amountDue", Number(e.target.value.replace(/[^\d.]/g, "")))} />
              </Field>
              <Field label={t("uploadDueDate")}>
                <input className={input} type="date" value={draft.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || undefined)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("uploadBillNo")}>
                <input className={input} value={draft.billNumber ?? ""} onChange={(e) => set("billNumber", e.target.value)} />
              </Field>
              <Field label={t("uploadReference")}>
                <input className={input} value={draft.reference ?? ""} onChange={(e) => set("reference", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-[15px] font-semibold">{t("uploadBank")}</h2>
            {(
              [
                ["bankName", "uploadBankName"],
                ["accountName", "uploadAccountName"],
                ["accountNumber", "uploadAccountNumber"],
                ["swift", "uploadSwift"],
              ] as [keyof Draft["institution"], TKey][]
            ).map(([k, label]) => (
              <Field key={k} label={t(label)}>
                <input className={cn(input, (k === "accountNumber" || k === "swift") && "num")} value={draft.institution[k] ?? ""} onChange={(e) => setInst(k, e.target.value)} />
              </Field>
            ))}
            <p className="text-[12px] text-ink-3">{t("onHoldUnverified")}</p>
          </Card>

          <Card className="space-y-2 p-4">
            <Field label={t("uploadNote")}>
              <textarea className={cn(input, "h-auto py-2")} rows={3} maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <p className="text-[12px] text-ink-3">
              {t("uploadReadBy")}: {draft.readBy} · {draft.extractedBy}
            </p>
          </Card>

          {errorBox}
          <Button size="lg" className="w-full" disabled={busy !== null || !draft.country} onClick={start}>
            {busy === "start" ? t("uploadStarting") : t("uploadStart")}
          </Button>
        </>
      )}
    </div>
  );
}
