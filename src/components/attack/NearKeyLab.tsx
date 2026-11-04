"use client";

import { ExternalLink, KeyRound, Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import type { BypassRun, PermissionsReport } from "@/server/near/bypass";

const card = "rounded-2xl border border-white/10 bg-white/[0.04]";

interface Live {
  configured: boolean;
  network?: string;
  vault?: string;
  explorerTx?: string | null;
  permissions?: PermissionsReport;
  lastRun?: BypassRun | null;
  error?: string;
}

const tusdc = (units: string) => (Number(BigInt(units) / BigInt(10_000)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

/**
 * The agent's real NEAR key with Kinwarden's gateway out of the way: what the key may do (read from
 * the chain) and what happened when it tried to do more. Shows the recorded local-node run, and runs
 * it live when a deployment is configured.
 */
export function NearKeyLab({ recorded }: { recorded: (BypassRun & { commit?: string }) | null }) {
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/near/bypass")
      .then((r) => r.json() as Promise<Live>)
      .then((j) => alive && setLive(j))
      .catch(() => alive && setLive({ configured: false }));
    return () => {
      alive = false;
    };
  }, []);

  const runLive = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/near/bypass", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Request failed");
      setLive((l) => ({ ...(l ?? { configured: true }), lastRun: j as BypassRun }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const run = live?.lastRun ?? recorded;
  const permissions = live?.permissions ?? run?.permissions;
  const isLive = Boolean(live?.lastRun);
  if (!run && !permissions) return null;
  const txUrl = (hash?: string) => (hash && live?.explorerTx ? `${live.explorerTx}${hash}` : undefined);

  return (
    <section className={cn(card, "space-y-4 p-5")} aria-labelledby="near-key-lab">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#5ccdb4]">
          <KeyRound size={14} /> Skip the AI and the safety layer
        </p>
        <h2 id="near-key-lab" className="text-[22px] font-bold tracking-tight">
          Steal the app&apos;s NEAR key and try to take the money.
        </h2>
        <p className="max-w-3xl text-[14px] leading-relaxed text-[#c9d6d2]">
          Suppose an attacker owns Kinwarden&apos;s server. They hold the same key the app uses on NEAR, and they send transactions straight to the chain, with no AI and no safety
          layer in the way. NEAR itself checks what that key is allowed to do, and the family&apos;s vault checks everything else.
        </p>
      </header>

      {permissions && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#9fb2ad]">
            What the key may do {live?.permissions ? `on NEAR ${live.network}, read now` : "on the local NEAR node, recorded"} at block {permissions.observedAt.blockHeight}
          </h3>
          <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[160px_1fr]">
            <dt className="text-[#9fb2ad]">Account</dt>
            <dd className="font-mono">{permissions.account}</dd>
            <dt className="text-[#9fb2ad]">App key</dt>
            <dd className="break-all font-mono">{permissions.appKey?.publicKey ?? "not on the account"}</dd>
            <dt className="text-[#9fb2ad]">May call</dt>
            <dd>
              {permissions.appKey?.kind === "FunctionCall" ? (
                <>
                  only <span className="font-mono">{permissions.appKey.methods?.join(", ")}</span> on <span className="font-mono">{permissions.appKey.receiver}</span>, with no deposit
                </>
              ) : (
                (permissions.appKey?.kind ?? "—")
              )}
            </dd>
            <dt className="text-[#9fb2ad]">Gas allowance</dt>
            <dd>{permissions.appKey?.allowanceNear ? `${permissions.appKey.allowanceNear} NEAR for fees. ${permissions.paymentLimitsNote}` : "—"}</dd>
            {permissions.otherKeys.map((k) => (
              <div key={k.publicKey} className="contents">
                <dt className="text-[#9fb2ad]">Other key ({k.kind})</dt>
                <dd>
                  <span className="break-all font-mono">{k.publicKey}</span>. {k.note}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {run && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#9fb2ad]">
            {isLive ? `Run just now on NEAR ${run.network}` : `Recorded on a local NEAR node${recorded?.commit ? ` (commit ${recorded.commit})` : ""}`}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="text-[#9fb2ad]">
                <tr>
                  <th className="py-1 pr-3 font-medium">The attacker tries to…</th>
                  <th className="py-1 pr-3 font-medium">Stopped by</th>
                  <th className="py-1 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {run.results.map((r) => (
                  <tr key={r.id} className="border-t border-white/10 align-top">
                    <td className="py-1.5 pr-3">
                      {r.title}
                      <span className="block font-mono text-[11.5px] text-[#9fb2ad]">{r.sent}</span>
                    </td>
                    <td className={cn("py-1.5 pr-3 font-semibold", r.refusedBy === "not refused" ? "text-[#f2827a]" : "text-[#5ccdb4]")}>
                      {r.refusedBy === "protocol" ? "NEAR (key permissions)" : r.refusedBy === "contract" ? "Family's vault" : "NOT STOPPED"}
                    </td>
                    <td className="py-1.5 font-mono text-[12px]">
                      {r.reason}
                      {txUrl(r.tx) && (
                        <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 font-sans text-[#5ccdb4]">
                          <ExternalLink size={11} /> tx
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cn("flex items-start gap-1.5 rounded-xl px-3 py-2 text-[13px]", run.held ? "bg-[#5ccdb4]/10 text-[#5ccdb4]" : "bg-[#f2827a]/10 text-[#f2827a]")}>
            {run.held ? <ShieldCheck size={15} className="mt-px shrink-0" /> : <ShieldX size={15} className="mt-px shrink-0" />}
            {run.held
              ? `Every attempt was refused. Before and after: the attacker's account held ${tusdc(run.before.agentTokens)} → ${tusdc(run.after.agentTokens)} tUSDC, the vault ${tusdc(run.before.vaultTokens)} → ${tusdc(run.after.vaultTokens)}, the family's case ${tusdc(run.before.caseBalance)} → ${tusdc(run.after.caseBalance)} (reserved ${tusdc(run.before.caseReserved)} → ${tusdc(run.after.caseReserved)}).`
              : "At least one attempt was not refused or a balance changed. This is a failure; see the table."}
          </p>
        </div>
      )}

      {live?.configured && (
        <div className="space-y-1">
          <button
            onClick={runLive}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[#5ccdb4] px-4 text-[13px] font-semibold text-[#08100f] hover:bg-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
            Try it now on NEAR {live.network} with the app&apos;s real key
          </button>
          <p className="text-[12px] text-[#9fb2ad]">
            Sends real transactions to {live.vault}. Refused ones move nothing; the vault&apos;s refusals cost the key a fraction of a milliNEAR in fees.
          </p>
        </div>
      )}
      {(error || live?.error) && <p className="rounded-xl bg-[#f2827a]/10 px-3 py-2 text-[13px] text-[#f2827a]">{error ?? live?.error}</p>}
    </section>
  );
}
