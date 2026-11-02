"use client";

import { CircleCheck, ExternalLink, Link2, Loader2, ShieldX } from "lucide-react";
import { useState } from "react";
import type { PublicState } from "@/server/runtime";
import type { AnchorCheck } from "@/server/anchor/service";
import { useT } from "@/lib/i18n";
import { cn, shortHash } from "@/lib/format";
import { Badge } from "../ui";

/** The log's head hash at each milestone, with its copy on a public chain and a check against it. */
export function AnchorList({ state }: { state: PublicState }) {
  const { t } = useT();
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AnchorCheck | { error: string }>>({});
  const chain = state.anchoring;
  if (!state.anchors.length && !chain) return null;

  const check = async (id: string) => {
    setChecking(id);
    try {
      const r = await fetch("/api/anchors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const body = (await r.json()) as AnchorCheck & { error?: string };
      setResults((x) => ({ ...x, [id]: r.ok ? body : { error: body.error ?? "Check failed" } }));
    } catch (e) {
      setResults((x) => ({ ...x, [id]: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setChecking(null);
    }
  };

  return (
    <div className="space-y-2 rounded-xl bg-surface-2 p-3">
      <div>
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Link2 size={14} className="text-brand" />
          {chain ? t("anchorsTitle") : t("anchorsLocal")}
        </p>
        {chain && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">
            {t("anchorsHint")}{" "}
            <a href={chain.contractUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand underline-offset-2 hover:underline">
              {t("anchorContract")} {shortHash(chain.contract)}
            </a>
          </p>
        )}
      </div>
      <ul className="space-y-1.5">
        {[...state.anchors].reverse().map((a) => {
          const r = results[a.id];
          const status = a.chain?.status;
          return (
            <li key={a.id ?? a.at} className="rounded-lg border border-line bg-surface px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="num font-mono text-[11px] text-ink-2">
                  #{a.seq} {shortHash(a.hash)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">{a.note}</span>
                {status === "confirmed" && <Badge tone="success" icon={<CircleCheck size={11} />}>{t("anchorConfirmed")}</Badge>}
                {status === "pending" && <Badge tone="info" icon={<Loader2 size={11} className="animate-spin" />}>{t("anchorPending")}</Badge>}
                {status === "failed" && <Badge tone="amber">{t("anchorFailed")}</Badge>}
              </div>
              {a.chain?.txHash && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {a.chain.explorerUrl && (
                    <a href={a.chain.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand underline-offset-2 hover:underline">
                      {t("anchorView")} <ExternalLink size={11} />
                    </a>
                  )}
                  {status === "confirmed" && (
                    <button type="button" onClick={() => check(a.id)} disabled={checking !== null} className="inline-flex h-7 items-center gap-1 rounded-full border border-line-strong px-2.5 text-[11.5px] font-semibold disabled:opacity-50">
                      {checking === a.id && <Loader2 size={11} className="animate-spin" />}
                      {t("anchorCheck")}
                    </button>
                  )}
                </div>
              )}
              {r && (
                <p role="status" className={cn("mt-1.5 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-semibold", "error" in r || !r.ok ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>
                  {"error" in r ? (
                    r.error
                  ) : r.ok ? (
                    <>
                      <CircleCheck size={13} className="mt-px shrink-0" /> {t("anchorCheckOk")} {r.onChain ? `(block ${r.onChain.blockNumber})` : ""}
                    </>
                  ) : (
                    <>
                      <ShieldX size={13} className="mt-px shrink-0" /> {t("anchorCheckBad")}{" "}
                      {!r.onChain ? r.reason : r.onChain.head !== a.hash ? t("anchorHashDiffers") : `${t("anchorLogChanged")} #${r.log.brokenAt ?? "?"}`}
                    </>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
