"use client";

import { Download, FileCheck2, FileSignature, FileText, FileWarning, GraduationCap, Landmark, ReceiptText } from "lucide-react";
import { useState } from "react";
import { useCarry } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dateTime } from "@/lib/format";
import type { Doc } from "@/domain/types";
import { Badge, Card, Empty, Sheet } from "../ui";

const ICONS: Record<Doc["kind"], React.ComponentType<{ size?: number }>> = {
  invoice: ReceiptText,
  bank_letter: Landmark,
  remittance_application: FileSignature,
  self_declaration: FileSignature,
  fx_purchase_application: FileSignature,
  admission_letter: GraduationCap,
  receipt: FileCheck2,
  other: FileText,
};

export function DocsTab() {
  const { state } = useCarry();
  const { t } = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  if (!state) return null;
  const c = activeCase(state)!;
  const tz = caseTz(c);
  const docs = Object.values(state.world.docs).filter((d) => d.caseId === c.id).reverse();
  const open = openId ? state.world.docs[openId] : undefined;

  return (
    <div className="px-4 pb-10 pt-4">
      <a href="/pack" target="_blank" rel="noreferrer" className="mb-3 flex items-center justify-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[13px] font-semibold text-ink hover:bg-surface-3">
        <Download size={15} /> {t("casePack")}
      </a>
      {docs.length === 0 ? (
        <Card>
          <Empty icon={<FileText size={20} />} title="No documents yet" hint="Invoices, receipts and the forms Kinwarden prepares will appear here." />
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {docs.map((d) => {
            const Icon = d.origin === "unknown" ? FileWarning : ICONS[d.kind];
            return (
              <li key={d.id}>
                <button onClick={() => setOpenId(d.id)} className="h-full w-full text-left">
                  <Card className={cn("flex h-full flex-col gap-2 p-3 transition-shadow hover:shadow-pop", d.origin === "unknown" && "border-danger/40 bg-danger-soft")}>
                    <span className={cn("grid h-9 w-9 place-items-center rounded-xl", d.origin === "unknown" ? "bg-danger text-white" : d.origin === "agent" ? "bg-amber-soft text-amber-strong" : "bg-brand-soft text-brand")}>
                      <Icon size={17} />
                    </span>
                    <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{d.title}</p>
                    <div className="mt-auto">
                      <OriginBadge origin={d.origin} />
                      <p className="mt-1 text-[10.5px] text-ink-3">{dateTime(d.createdAt, tz)}</p>
                    </div>
                  </Card>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={Boolean(open)} onClose={() => setOpenId(null)} title={open?.title}>
        {open && (
          <div className="space-y-3 pb-3">
            <OriginBadge origin={open.origin} />
            {open.origin === "unknown" && (
              <p className="rounded-xl bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                This came from an address that is not the institution&apos;s verified contact. Kinwarden treated it as untrusted and did not act on it.
              </p>
            )}
            <pre className="scroll-thin overflow-x-auto whitespace-pre-wrap rounded-2xl border border-line bg-[color-mix(in_oklab,var(--surface)_70%,var(--amber-soft))] p-4 font-mono text-[11.5px] leading-relaxed text-ink shadow-inner">
              {open.text}
            </pre>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function OriginBadge({ origin }: { origin: Doc["origin"] }) {
  if (origin === "agent") return <Badge tone="amber">Prepared by Kinwarden</Badge>;
  if (origin === "unknown") return <Badge tone="danger">Unverified sender</Badge>;
  if (origin === "bank") return <Badge tone="info">From the bank</Badge>;
  if (origin === "family") return <Badge>From you</Badge>;
  return <Badge tone="brand">From the institution</Badge>;
}
