"use client";

import { ArrowUpRight, Bot, BotOff, FileText, Link2, Loader2, PauseCircle, PlayCircle, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useCarry } from "@/lib/client";
import { cn } from "@/lib/format";
import { nearAmount, nearBalance, nearView, tusdc } from "@/near/rpc";
import { callWithWallet, connectWallet, connectedAccount } from "@/near/wallet";
import { Card, SectionTitle } from "../ui";
import { NearOutcomeNote, NearReceiptView } from "./NearReceipt";

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

const STORAGE_DEPOSIT = BigInt(10) ** BigInt(23); // 0.1 NEAR; the vault refunds what storage does not use
const STORAGE_DEPOSIT_YOCTO = STORAGE_DEPOSIT.toString();
const FEES_HEADROOM = BigInt(10) ** BigInt(22); // 0.01 NEAR for transaction fees
const explorerAccount = (network: string, account: string) => (network === "testnet" ? `https://testnet.nearblocks.io/address/${account}` : null);

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
  const [ownerNear, setOwnerNear] = useState<bigint | null | undefined>(undefined);
  const [account, setAccount] = useState<string | null>(null);
  const [amount, setAmount] = useState("30000");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

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
      void nearBalance(rpcUrl, owner).then((b) => alive && setOwnerNear(b)).catch(() => {});
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
  const vaultPayments = Object.values(state.world.payments).filter((p) => p.caseId === caseId && p.near?.proposalId);

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
      <Card className="space-y-3 p-4 text-[13px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-ink-3">Vault case</dt>
          <dd className="truncate font-mono text-ink">{link.vaultCaseId}</dd>
          <dt className="text-ink-3">Owner</dt>
          <dd className="flex min-w-0 items-center gap-1 font-mono text-ink">
            <span className="truncate">{link.owner}</span>
            {explorerAccount(near.network, link.owner) && (
              <a href={explorerAccount(near.network, link.owner)!} target="_blank" rel="noreferrer" aria-label={`${link.owner} on the explorer`} className="shrink-0 text-brand">
                <ArrowUpRight size={13} />
              </a>
            )}
          </dd>
        </dl>
        {vcase === undefined ? (
          <p className="flex items-center gap-2 text-ink-3">
            <Loader2 size={14} className="animate-spin" /> Reading the vault…
          </p>
        ) : vcase === null ? (
          <p className="text-ink-2">
            This case is not open on the vault yet. {walletNet ? `${link.owner} opens it from their own wallet, with the limits below.` : "Run scripts/near/sandbox.mjs to open it."}
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
              <span className={cn("font-semibold", vcase.status === "Paused" ? "text-danger" : "text-success")}>{vcase.status}</span> · agent{" "}
              <span className={cn("font-semibold", vcase.agent_enabled ? "text-success" : "text-danger")}>{vcase.agent_enabled ? "on" : "switched off"}</span>
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
                {account ? "Connect the case owner's wallet" : "Connect your NEAR wallet"}
              </button>
            ) : (
              <>
                <p className="text-[12px] text-ink-3">
                  Wallet {account} holds {ownerTokens ? tusdc(ownerTokens) : "…"} {near.tokenSymbol}. Each action opens your wallet to confirm.
                </p>
                {vcase === null && ownerNear !== undefined && (ownerNear ?? BigInt(0)) < STORAGE_DEPOSIT + FEES_HEADROOM && (
                  <p className="rounded-xl bg-amber-soft px-2.5 py-2 text-[12px] text-amber-strong">
                    Opening the case stores it on the vault: your wallet needs about 0.11 testnet NEAR (a 0.1 NEAR storage deposit, partly refunded, plus fees). It holds {nearAmount(ownerNear ?? BigInt(0))} NEAR. Get testnet NEAR from a faucet first.
                  </p>
                )}
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
                    secondary
                    busy={busy === "pause"}
                    disabled={busy !== null}
                    icon={vcase.status === "Paused" ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
                    onClick={() => act("pause", { receiverId: near.vault, methodName: vcase.status === "Paused" ? "unpause" : "pause", args: { case_id: link.vaultCaseId }, gasTgas: 50, depositYocto: "1" })}
                  >
                    {vcase.status === "Paused" ? "Resume payments" : "Pause all payments (cancels pending approvals)"}
                  </Action>
                )}
                {vcase && (
                  <Action
                    secondary
                    busy={busy === "agent"}
                    disabled={busy !== null}
                    icon={vcase.agent_enabled ? <BotOff size={15} /> : <Bot size={15} />}
                    onClick={() => act("agent", { receiverId: near.vault, methodName: vcase.agent_enabled ? "revoke_agent" : "enable_agent", args: { case_id: link.vaultCaseId }, gasTgas: 50, depositYocto: "1" })}
                  >
                    {vcase.agent_enabled ? "Switch the agent off (cancels its pending proposals)" : "Switch the agent back on"}
                  </Action>
                )}
              </>
            )}
          </div>
        )}

        {error && <p className="rounded-xl bg-danger-soft px-2.5 py-2 text-[12px] text-danger">{error}</p>}

        {vaultPayments.length > 0 && (
          <div className="space-y-3 border-t border-line pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Payments through the vault</p>
            {vaultPayments.map((p) => (
              <div key={p.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">
                    {state.world.invoices[p.invoiceId]?.number} · {tusdc(p.near!.amountUnits)} {near.tokenSymbol}
                  </p>
                  <button
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-brand"
                  >
                    <FileText size={13} /> {open === p.id ? "Hide receipt" : "Receipt"}
                  </button>
                </div>
                <NearOutcomeNote state={p.near!.state} reason={p.near!.reason} />
                {open === p.id && <NearReceiptView paymentId={p.id} version={`${p.near!.state}:${p.near!.approvalTx ?? ""}`} />}
              </div>
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

/** A wallet action. Rare, disruptive ones (pause, switch the agent off) are `secondary`: outlined, not filled. */
function Action({ children, onClick, busy, disabled, icon, secondary }: { children: React.ReactNode; onClick: () => void; busy: boolean; disabled: boolean; icon: React.ReactNode; secondary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-10 w-full flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold disabled:opacity-60",
        secondary ? "border border-line-strong bg-surface text-ink-2 hover:border-danger hover:text-danger" : "bg-ink text-bg hover:bg-brand",
      )}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
