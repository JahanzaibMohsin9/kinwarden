"use client";

import { CircleCheck, CircleHelp, CircleX, Clock, ExternalLink, FileDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { NearPaymentLink } from "@/domain/types";
import { cn } from "@/lib/format";
import { nearOutcome, type Delivery } from "@/near/outcome";
import type { NearReceipt } from "@/server/near/bridge";

const TONE: Record<Delivery, string> = {
  delivered: "bg-success-soft text-success",
  failed: "bg-danger-soft text-danger",
  unknown: "bg-amber-soft text-amber-strong",
  awaiting_approval: "bg-info-soft text-info",
  not_sent: "bg-surface-2 text-ink-2",
};

const ICON: Record<Delivery, React.ReactNode> = {
  delivered: <CircleCheck size={14} className="mt-px shrink-0" />,
  failed: <CircleX size={14} className="mt-px shrink-0" />,
  unknown: <CircleHelp size={14} className="mt-px shrink-0" />,
  awaiting_approval: <Clock size={14} className="mt-px shrink-0" />,
  not_sent: <CircleX size={14} className="mt-px shrink-0" />,
};

/** Whether delivery is confirmed, failed or unknown, where the reserved money is, and what to do next. */
export function NearOutcomeNote({ state, reason }: { state: NearPaymentLink["state"]; reason?: string | null }) {
  const o = nearOutcome(state);
  return (
    <div className={cn("flex items-start gap-1.5 rounded-xl px-2.5 py-2 text-[12px] leading-relaxed", TONE[o.delivery])}>
      {ICON[o.delivery]}
      <div>
        <p className="font-semibold">
          {o.label}
          {reason ? ` (${reason})` : ""}
        </p>
        <p>
          <span className="font-semibold">Money:</span> {o.funds}
        </p>
        <p>
          <span className="font-semibold">Next:</span> {o.next}
        </p>
      </div>
    </div>
  );
}

/**
 * The case receipt in readable form: who was paid, in which token and how much, with the family's
 * approval and the on-chain settlement shown as separate observations. The JSON download is the same
 * receipt with its tamper-evident hash.
 */
export function NearReceiptView({ paymentId, version }: { paymentId: string; version: string }) {
  const [r, setR] = useState<NearReceipt | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch(`/api/near/receipt/${paymentId}?view=1`)
      .then((res) => (res.ok ? (res.json() as Promise<NearReceipt>) : null))
      .then((v) => alive && setR(v))
      .catch(() => alive && setR(null));
    return () => {
      alive = false;
    };
  }, [paymentId, version]);

  if (r === undefined)
    return (
      <p className="flex items-center gap-2 text-[12px] text-ink-3">
        <Loader2 size={13} className="animate-spin" /> Reading the receipt from NEAR…
      </p>
    );
  if (r === null) return <p className="text-[12px] text-ink-3">The receipt could not be read from NEAR right now.</p>;

  const t = r.settlement?.token_transfer;
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "not observed");
  return (
    <div className="space-y-2 rounded-xl bg-surface px-2.5 py-2 text-[12px]">
      <p className="font-semibold text-ink">Case receipt · invoice {r.invoice.number}</p>
      <dl className="space-y-1">
        <Row k="Paid to" v={`${r.paid_to.institution} · ${r.paid_to.account}`} />
        <Row k="Token" v={`${r.token.symbol} · ${r.token.contract}`} />
        <Row k="Amount" v={`${r.amount.display} (${r.amount.units} base units)`} />
        <Row
          k="Approved"
          v={r.approval ? `${when(r.approval.approved_at)} by ${r.approval.by ?? "the case owner"}` : "no approval transaction reported"}
          href={r.approval?.tx_url ?? undefined}
        />
        <Row
          k="Transfer"
          v={
            t
              ? t.succeeded
                ? `${when(t.observed_at)}: ${t.from} → ${t.to}${t.matches_proposal ? ", matches the approved payment" : ", DOES NOT match the approved payment"}`
                : `${when(t.observed_at)}: the token contract refused the transfer`
              : "not observed yet"
          }
          href={r.settlement?.tx_url ?? undefined}
        />
        <Row k="Vault record" v={r.outcome.recorded_by_vault_at ? `${r.outcome.vault_status} at ${when(r.outcome.recorded_by_vault_at)}` : r.outcome.vault_status} />
        <Row
          k="Hospital"
          v={r.institution_acknowledgement ? `acknowledged (simulated hospital, separate from the transfer)` : "no acknowledgement from the institution yet"}
        />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/api/near/receipt/${paymentId}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 font-semibold text-brand">
          <FileDown size={13} /> Download receipt
        </a>
        <span className="num text-[11px] text-ink-3">
          hash {r.receipt_hash.slice(0, 10)}…{r.receipt_hash.slice(-6)}
        </span>
      </div>
    </div>
  );
}

function Row({ k, v, href }: { k: string; v: string; href?: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-ink-3">{k}</dt>
      <dd className="min-w-0 break-words text-ink">
        {v}
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 font-semibold text-brand">
            <ExternalLink size={11} /> explorer
          </a>
        )}
      </dd>
    </div>
  );
}
