"use client";

import { FileDown, Link2, Loader2, PauseCircle, PlayCircle, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useCarry } from "@/lib/client";
import { cn } from "@/lib/format";
import { nearView, tusdc } from "@/near/rpc";
import { callWithWallet, connectWallet, connectedAccount } from "@/near/wallet";
import { Card, SectionTitle } from "../ui";

interface VaultCase {
  owner: string;
  status: "Active" | "Paused";
  agent_enabled: boolean;
  policy_version: number;
  balance: string;
  reserved: string;
  in_flight: string;
  paid: string;
  limits: { per_payment_max: string; rolling_24h_cap: string; lifetime_cap: string };
}

const STORAGE_DEPOSIT_YOCTO = (BigInt(10) ** BigInt(23)).toString(); // 0.1 NEAR; the vault refunds what storage does not use

/**
 * The family's case on the NEAR vault, read from the chain. On testnet the family opens, funds and
 * pauses it from its own wallet; on the local sandbox the setup script's test family already did.
 */
export function NearCaseCard({ caseId }: { caseId: string }) {
  const { state } = useCarry();
  const near = state?.near;
  const link = near?.cases[caseId];
  const walletNet = near?.network === "testnet" ? ("testnet" as const) : null;

  const [vcase, setVcase] = useState<VaultCase | null | undefined>(undefined);
  const [ownerTokens, setOwnerTokens] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [amount, setAmount] = useState("30000");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const rpcUrl = near?.rpcUrl;
  const vault = near?.vault;
  const token = near?.token;
  const vaultCaseId = link?.vaultCaseId;
  const owner = link?.owner;
  useEffect(() => {
    if (!rpcUrl || !vault || !token || !vaultCaseId || !owner) return;
    let alive = true;
    const read = () => {
      void nearView<VaultCase | null>(rpcUrl, vault, "get_case", { case_id: vaultCaseId }).then((c) => alive && setVcase(c)).catch(() => {});
      void nearView<string>(rpcUrl, token, "ft_balance_of", { account_id: owner }).then((b) => alive && setOwnerTokens(b)).catch(() => {});
    };
    read();
    const t = setInterval(read, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [rpcUrl, vault, token, vaultCaseId, owner, reload]);

  useEffect(() => {
    if (walletNet) void connectedAccount(walletNet).then(setAccount);
  }, [walletNet]);

  if (!near || !link || !state) return null;
  const isOwner = account === link.owner;
  const receipts = Object.values(state.world.payments).filter((p) => p.caseId === caseId && p.near?.state === "Settled");

  const act = async (label: string, call: Parameters<typeof callWithWallet>[1]) => {
    if (!walletNet) return;
    setError(null);
    setBusy(label);
    try {
      await callWithWallet(walletNet, call);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const fundUnits = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? (BigInt(Math.round(n * 100)) * BigInt(10_000)).toString() : null;
  })();

  return (
    <section>
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <Link2 size={13} /> NEAR vault · {near.network}
        </span>
      </SectionTitle>
      <Card className="space-y-3 p-4 text-[13px]" dir="ltr">
        {vcase === undefined ? (
          <p className="flex items-center gap-2 text-ink-3">
            <Loader2 size={14} className="animate-spin" /> Reading the vault…
          </p>
        ) : vcase === null ? (
          <p className="text-ink-2">
            Case <code>{link.vaultCaseId}</code> is not open yet. {walletNet ? `${link.owner} opens it from their wallet with these limits.` : "Run scripts/near/sandbox.mjs to open it."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat k="Available" v={tusdc(BigInt(vcase.balance) - BigInt(vcase.reserved) - BigInt(vcase.in_flight))} />
              <Stat k="Reserved" v={tusdc(vcase.reserved)} />
              <Stat k="In flight" v={tusdc(vcase.in_flight)} />
              <Stat k="Paid" v={tusdc(vcase.paid)} />
            </div>
            <p className="text-[12px] text-ink-3">
              {near.tokenSymbol} (test token, no value) · limits: {tusdc(vcase.limits.per_payment_max)} per payment, {tusdc(vcase.limits.rolling_24h_cap)} per 24 h,{" "}
              {tusdc(vcase.limits.lifetime_cap)} in total · policy v{vcase.policy_version} ·{" "}
              <span className={cn("font-semibold", vcase.status === "Paused" ? "text-danger" : "text-success")}>{vcase.status}</span>
            </p>
          </>
        )}

        {walletNet && (
          <div className="space-y-2 border-t border-line pt-3">
            {!isOwner ? (
              <button
                onClick={async () => {
                  setError(null);
                  setBusy("connect");
                  try {
                    setAccount(await connectWallet(walletNet));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(null);
                  }
                }}
                disabled={busy !== null}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-ink text-[13px] font-semibold text-bg hover:bg-brand disabled:opacity-60"
              >
                {busy === "connect" ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
                {account ? `Connected as ${account}; connect ${link.owner}` : `Connect ${link.owner}'s wallet`}
              </button>
            ) : (
              <>
                <p className="text-[12px] text-ink-3">
                  Wallet {account} holds {ownerTokens ? tusdc(ownerTokens) : "…"} {near.tokenSymbol}. Each action opens your wallet to confirm.
                </p>
                {vcase === null && (
                  <Action busy={busy === "open"} disabled={busy !== null} icon={<Wallet size={15} />} onClick={() => act("open", { receiverId: near.vault, methodName: "create_case", args: { case_id: link.vaultCaseId, limits: near.caseLimits }, gasTgas: 50, depositYocto: STORAGE_DEPOSIT_YOCTO })}>
                    Open case {link.vaultCaseId}
                  </Action>
                )}
                {vcase && (
                  <div className="flex gap-2">
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount to add, in tUSDC" className="h-10 w-28 rounded-full border border-line bg-surface px-3 text-[13px]" />
                    <Action busy={busy === "fund"} disabled={busy !== null || !fundUnits} icon={<Wallet size={15} />} onClick={() => fundUnits && act("fund", { receiverId: near.token, methodName: "ft_transfer_call", args: { receiver_id: near.vault, amount: fundUnits, msg: link.vaultCaseId }, gasTgas: 150, depositYocto: "1" })}>
                      Add {near.tokenSymbol} to the case
                    </Action>
                  </div>
                )}
                {vcase && (
                  <Action
                    busy={busy === "pause"}
                    disabled={busy !== null}
                    icon={vcase.status === "Paused" ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
                    onClick={() => act("pause", { receiverId: near.vault, methodName: vcase.status === "Paused" ? "unpause" : "pause", args: { case_id: link.vaultCaseId }, gasTgas: 50, depositYocto: "1" })}
                  >
                    {vcase.status === "Paused" ? "Resume payments" : "Pause all payments (cancels pending approvals)"}
                  </Action>
                )}
              </>
            )}
          </div>
        )}

        {error && <p className="rounded-xl bg-danger-soft px-2.5 py-2 text-[12px] text-danger">{error}</p>}

        {receipts.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {receipts.map((p) => (
              <a key={p.id} href={`/api/near/receipt/${p.id}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-brand">
                <FileDown size={13} /> Receipt {state.world.invoices[p.invoiceId]?.number}
              </a>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2.5 py-2">
      <p className="text-[11px] text-ink-3">{k}</p>
      <p className="num text-[14px] font-semibold">{v}</p>
    </div>
  );
}

function Action({ children, onClick, busy, disabled, icon }: { children: React.ReactNode; onClick: () => void; busy: boolean; disabled: boolean; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-ink px-4 text-[13px] font-semibold text-bg hover:bg-brand disabled:opacity-60">
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
