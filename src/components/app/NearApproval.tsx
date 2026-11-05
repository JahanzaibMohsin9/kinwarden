"use client";

import { Link2, Loader2, ShieldCheck, TriangleAlert, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { post, useCarry } from "@/lib/client";
import { cn } from "@/lib/format";
import { approvalCheck, type ApprovalPreview } from "@/near/approvalCheck";
import { nearView, tusdc } from "@/near/rpc";
import { callWithWallet, connectWallet, connectedAccount } from "@/near/wallet";
import { NearOutcomeNote, NearReceiptView } from "./NearReceipt";

type Preview = ApprovalPreview;

const WAITING: Record<string, string> = {
  proposing: "Registering this payment on the NEAR vault…",
  waiting_for_verifier: "Waiting for the verifier to authorize this invoice on NEAR…",
};

/**
 * Approval of a NEAR-settled payment. Everything shown here is read from the chain by this browser,
 * the approval hash is recomputed here, and the decision is signed in the family's own wallet: the
 * app server cannot approve, and a mismatch between what the vault stored and what we show stops it.
 */
export function NearApproval({ paymentId, onDone }: { paymentId: string; onDone: () => void }) {
  const { state } = useCarry();
  const near = state?.near;
  const p = state?.world.payments[paymentId];
  const link = p?.near;
  const owner = p && near ? near.cases[p.caseId]?.owner : undefined;
  const walletNet = near?.network === "testnet" ? ("testnet" as const) : null;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | "connect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const rpcUrl = near?.rpcUrl;
  const vault = near?.vault;
  const proposalId = link?.proposalId;
  useEffect(() => {
    if (!rpcUrl || !vault || !proposalId) return;
    let alive = true;
    const read = () =>
      nearView<Preview>(rpcUrl, vault, "approval_preview", { proposal_id: proposalId })
        .then((v) => alive && setPreview(v))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void read();
    const t = setInterval(() => void read(), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [rpcUrl, vault, proposalId, link?.state, reload]);

  useEffect(() => {
    if (walletNet) void connectedAccount(walletNet).then(setAccount);
  }, [walletNet]);

  if (!near || !p || !link) return null;

  const proposal = preview?.proposal;
  const { localHash, hashOk, pending, rightAccount, canDecide } = approvalCheck({ preview, network: near.network, vault: near.vault, account, owner, walletAvailable: Boolean(walletNet) });

  const run = async (kind: "approve" | "reject") => {
    if (!proposal || !walletNet || !localHash) return;
    setError(null);
    setBusy(kind);
    try {
      if (kind === "approve") {
        const hash = await callWithWallet(walletNet, {
          receiverId: near.vault,
          methodName: "approve_payment",
          args: {
            case_id: proposal.case_id,
            proposal_id: proposal.proposal_id,
            expected_recipient: proposal.recipient,
            expected_token: proposal.token,
            expected_amount: proposal.amount,
            expected_policy_version: proposal.policy_version,
            expected_proposal_hash: localHash,
          },
          gasTgas: 150,
          depositYocto: "1",
        });
        await post(`/api/near/payment/${paymentId}`, { approvalTx: hash });
      } else {
        await callWithWallet(walletNet, { receiverId: near.vault, methodName: "reject_payment", args: { case_id: proposal.case_id, proposal_id: proposal.proposal_id }, gasTgas: 50, depositYocto: "1" });
      }
      await post("/api/near/sync", {});
      setReload((n) => n + 1);
      if (kind === "reject") onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    if (!walletNet) return;
    setError(null);
    setBusy("connect");
    try {
      setAccount(await connectWallet(walletNet));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-brand/30 bg-brand-softer/40 p-3" dir="ltr">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-brand">
        <Link2 size={13} /> Settles on NEAR {near.network} · {tusdc(link.amountUnits)} {near.tokenSymbol}
      </p>

      {!link.proposalId && (
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          {link.state === "error" ? <TriangleAlert size={14} className="text-danger" /> : <Loader2 size={14} className="animate-spin" />}
          {link.state === "error" ? `The vault refused this payment (${link.reason ?? "unknown reason"}).` : WAITING[link.state] ?? link.state}
        </p>
      )}

      {proposal && preview && (
        <>
          <dl className="space-y-1 text-[13px]">
            <Field k="Pays" v={`${tusdc(proposal.amount)} ${near.tokenSymbol} (test token, no value)`} />
            <Field k="To" v={proposal.recipient} note="the verifier enrolled this account for the hospital" />
            <Field k="Invoice" v={proposal.invoice_id} />
            <Field k="Expires" v={new Date(Number(BigInt(proposal.expires_at) / BigInt(1_000_000))).toLocaleString()} />
            <Field k="Left after this" v={`case ${tusdc(BigInt(preview.case_available))} · 24h ${tusdc(BigInt(preview.rolling_24h_remaining))} · lifetime ${tusdc(BigInt(preview.lifetime_remaining))}`} />
          </dl>

          <NearOutcomeNote state={proposal.status} reason={proposal.status_reason} />

          <p className={cn("flex items-start gap-1.5 rounded-xl px-2.5 py-2 text-[12px]", hashOk ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            <ShieldCheck size={14} className="mt-px shrink-0" />
            {hashOk
              ? `Approval fingerprint ${localHash!.slice(0, 10)}…${localHash!.slice(-6)}, computed in this browser from the vault's record, matches the vault.`
              : "The vault's approval fingerprint does not match what this browser computed. Do not approve."}
          </p>

          {preview.blockers.length > 0 && pending && (
            <p className="rounded-xl bg-danger-soft px-2.5 py-2 text-[12px] text-danger">This payment cannot be approved now: {preview.blockers.join(", ")}.</p>
          )}

          {pending && walletNet && (
            <div className="rounded-xl bg-surface px-2.5 py-2 text-[12px] leading-relaxed text-ink-2">
              <p className="font-semibold text-ink">Check it in your wallet before approving</p>
              Your wallet&apos;s first screen shows the vault ({near.vault}) as the receiver. Open <b>View Transaction Details</b> and check{" "}
              <code className="text-ink">expected_recipient</code> is <code className="text-ink">{proposal.recipient}</code> and{" "}
              <code className="text-ink">expected_amount</code> is <code className="text-ink">{proposal.amount}</code> ({tusdc(proposal.amount)} {near.tokenSymbol}). The 1 yoctoNEAR deposit may display as 0.
            </div>
          )}
        </>
      )}

      {error && <p className="rounded-xl bg-danger-soft px-2.5 py-2 text-[12px] text-danger">{error}</p>}

      {pending && !walletNet && (
        <p className="rounded-xl bg-surface px-2.5 py-2 text-[12px] text-ink-2">
          Local sandbox (no wallet): approve with the TEST-ONLY family key: <code>node scripts/near/family.mjs approve {paymentId}</code>
        </p>
      )}

      {pending && walletNet && (
        <div className="space-y-2">
          {!rightAccount ? (
            <button onClick={connect} disabled={busy !== null} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[14px] font-semibold text-bg hover:bg-brand disabled:opacity-60">
              {busy === "connect" ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
              {account ? `Connected as ${account}; connect ${owner}` : `Connect ${owner ?? "the case owner"}'s wallet`}
            </button>
          ) : (
            <button onClick={() => run("approve")} disabled={!canDecide || busy !== null} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[14px] font-semibold text-bg hover:bg-brand disabled:opacity-60">
              {busy === "approve" ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
              Approve in my NEAR wallet
            </button>
          )}
          {rightAccount && (
            <button onClick={() => run("reject")} disabled={busy !== null} className="mx-auto block rounded-full px-3 py-1 text-[12.5px] font-semibold text-ink-3 hover:bg-surface-3 hover:text-ink">
              Reject in my wallet
            </button>
          )}
        </div>
      )}

      {proposal && !pending && <NearReceiptView paymentId={paymentId} version={`${link.state}:${link.approvalTx ?? ""}`} />}
    </div>
  );
}

function Field({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[92px] shrink-0 text-ink-3">{k}</dt>
      <dd className="min-w-0 flex-1 break-all text-ink">
        {v}
        {note && <span className="block text-[11.5px] text-ink-3">{note}</span>}
      </dd>
    </div>
  );
}
