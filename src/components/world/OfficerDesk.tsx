"use client";

import { CircleAlert, CircleCheck, FileText, Fingerprint, Hand, Landmark, Link2, ScrollText } from "lucide-react";
import { useCarry } from "@/lib/client";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dateTime, money, shortHash } from "@/lib/format";
import { corridorOf } from "@/domain/corridors";
import { evaluateRoute, findRule } from "@/domain/rules/engine";
import type { LedgerEntry, Payment, World } from "@/domain/types";
import { RuleChip } from "../RuleChip";

// The bank's side of a Kinwarden payment: the remittance package an FX officer
// would review before releasing a transfer. Built from the same world state,
// rules engine and activity log the family sees; nothing here is typed by hand.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** SWIFT MT103 amounts use a decimal comma. */
const swiftAmount = (n: number) => n.toFixed(2).replace(".", ",");
const swiftDate = (iso: string) => iso.slice(2, 10).replace(/-/g, "");

function mt103(w: World, p: Payment, payerName: string, city: string) {
  const inst = w.institutions[p.institutionId];
  const c = w.cases[p.caseId];
  const purpose = c.type === "medical" ? "MEDICAL TREATMENT ABROAD" : "TUITION AND ACCOMMODATION FEES";
  return [
    `:20:${p.id.toUpperCase().replace(/_/g, "")}`,
    ":23B:CRED",
    `:32A:${swiftDate(p.createdAt)}${p.currency}${swiftAmount(p.amount)}`,
    `:50K:${payerName.replace(/[^\x20-\x7E]/g, "").trim()}`,
    `${city.toUpperCase()}`,
    `:57A:${p.beneficiary.swift}`,
    `:59:/${p.beneficiary.accountNumber.replace(/\s+/g, "")}`,
    `${inst.legalName}`,
    `:70:${p.reference.slice(0, 35)}`,
    `${purpose}`,
    ":71A:OUR",
  ].join("\n");
}

export function OfficerDesk() {
  const { state } = useCarry();
  if (!state) return null;
  const w = state.world;
  const c = activeCase(state)!;
  const tz = caseTz(c);
  const corridor = corridorOf(c.corridor);
  const transfers = Object.values(w.payments)
    .filter((p) => p.caseId === c.id && p.route === "bank_transfer" && p.status !== "cancelled")
    .reverse();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#2a3441] bg-[#111820] text-[#d7e0ea] shadow-pop">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#2a3441] px-4 py-2.5">
        <Landmark size={15} className="text-[#7fb3ff]" />
        <p className="flex-1 text-[13px] font-semibold">Remittance desk · {corridor.fromCity.name} (FX officer view)</p>
        <span className="font-mono text-[10px] text-[#8193a8]">sandbox bank</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
        <p className="text-[12px] leading-relaxed text-[#8193a8]">
          Every transfer Kinwarden sends arrives as a complete package: applicant, verified beneficiary, the regulations checked with their sources, the signed forms, the family&apos;s approval and a draft SWIFT message. The officer reviews instead of re-collecting paperwork.
        </p>
        {transfers.length === 0 && <p className="px-1 py-3 text-[12px] text-[#8193a8]">No bank transfers on this case yet.</p>}
        {transfers.map((p) => (
          <Package key={p.id} w={w} p={p} ledger={state.ledger} tz={tz} city={corridor.fromCity.name} />
        ))}
      </div>
    </div>
  );
}

function Package({ w, p, ledger, tz, city }: { w: World; p: Payment; ledger: LedgerEntry[]; tz: string; city: string }) {
  const c = w.cases[p.caseId];
  const inst = w.institutions[p.institutionId];
  const inv = w.invoices[p.invoiceId];
  const payer = c.people.find((x) => x.id === p.payerId);
  // like-for-like: the rules as they stood before this payment counted against the limits
  const before = { ...w, payments: Object.fromEntries(Object.entries(w.payments).filter(([id]) => id !== p.id)) };
  const ev = evaluateRoute({ world: before, caseFile: c, payer, route: p.route, amount: p.amount, currency: p.currency, invoiceId: inv.id });
  const benOk = norm(p.beneficiary.accountNumber) === norm(inst.bank.accountNumber) && norm(p.beneficiary.swift) === norm(inst.bank.swift);
  const docs = Object.values(w.docs).filter((d) => d.caseId === c.id);
  const bankLetter = docs.find((d) => d.kind === "bank_letter" && d.origin === "institution");
  const approval = ledger.find((e) => e.type === "approval.approved" && e.data.paymentId === p.id);
  const passkey = approval?.data.passkey as { device?: string; challenge?: string } | undefined;
  const entries = ledger.filter((e) => JSON.stringify(e.data).includes(p.id));
  const ready = benOk && ev.allowed && ev.requiredDocs.every((d) => d.present) && !!approval;
  const directRule = c.type === "medical" ? findRule(c.corridor, "PK.MED.DIRECT_TO_HOSPITAL") : undefined;

  return (
    <div className="rounded-xl border border-[#2a3441] bg-[#16202b]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#2a3441] px-3 py-2.5">
        <span className="num text-[16px] font-semibold text-white">{money(p.amount, p.currency)}</span>
        <span className="text-[12px] text-[#8193a8]">≈ {money(p.cost.totalSource, p.cost.sourceCurrency)} debited</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold", ready ? "bg-[#163626] text-[#6ee7a8]" : "bg-[#3a2c14] text-[#fbbf6b]")}>
          {ready ? "Package complete" : p.status === "awaiting_approval" ? "Waiting for the family's approval" : "Needs review"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
        <Block title="Applicant">
          <Row k="Name" v={payer?.name ?? p.payerId} />
          <Row k="Passport" v={payer?.passport ?? "on file"} mono />
          <Row k="Relationship" v={payer?.role ?? ""} />
          <Row k="Purpose" v={c.type === "medical" ? "Medical treatment abroad" : "Tuition and accommodation abroad"} />
        </Block>
        <Block title="Beneficiary">
          <Row k="Name" v={inst.legalName} />
          <Row k="Bank" v={`${p.beneficiary.bankName} · ${p.beneficiary.swift}`} />
          <Row k="Account" v={p.beneficiary.accountNumber} mono />
          <Check ok={benOk} text={benOk ? "Matches the verified registry" : "Does not match the verified registry"} rule="KINWARDEN.VERIFIED_BENEFICIARY" />
          {bankLetter && <Check ok text={`Institution's bank letter on file (${dateTime(bankLetter.createdAt, tz)})`} />}
        </Block>

        <Block title="Regulations checked">
          {ev.limits.map((l) => (
            <Check key={l.ruleId + l.label} ok={l.afterUSD <= l.capUSD} text={`${l.label}: USD ${Math.round(l.afterUSD).toLocaleString()} of ${l.capUSD.toLocaleString()}`} rule={l.ruleId} />
          ))}
          {directRule && <Check ok={benOk} text="Paid directly to the hospital's own account" rule={directRule.id} />}
          {ev.warnings.map((x) => (
            <Check key={x.ruleId} ok text={x.message} rule={x.ruleId} />
          ))}
          {ev.blockers.map((x) => (
            <Check key={x.ruleId} ok={false} text={x.message} rule={x.ruleId} />
          ))}
          <Check ok text="One payer for this bill, no splitting across relatives" rule={c.corridor === "CN-GB" ? "CN.FX.NO_SPLITTING" : "KINWARDEN.NO_SPLITTING"} />
        </Block>

        <Block title="Documents">
          {ev.requiredDocs.map((d) => {
            const doc = d.kind === "invoice" ? docs.find((x) => x.id === inv.documentId) : docs.find((x) => x.kind === d.kind);
            return (
              <div key={d.kind} className="flex items-start gap-2 text-[12px]">
                <FileText size={13} className={cn("mt-[2px] shrink-0", d.present ? "text-[#6ee7a8]" : "text-[#fbbf6b]")} />
                <span className="min-w-0 flex-1">
                  {d.label}
                  <span className="block truncate text-[11px] text-[#8193a8]">
                    {doc ? `${doc.title} · ${doc.origin === "agent" ? (approval ? "signed by the applicant on approval" : "prepared, awaiting signature") : `from ${inst.name}`}` : "missing"}
                  </span>
                </span>
                <RuleChip id={d.ruleId} className="bg-[#22303e] text-[#b9c6d4]" />
              </div>
            );
          })}
        </Block>

        <Block title="Customer authorisation">
          {approval ? (
            <>
              <div className="flex items-center gap-2 text-[12px]">
                {passkey ? <Fingerprint size={14} className="text-[#6ee7a8]" /> : <Hand size={14} className="text-[#fbbf6b]" />}
                <span>
                  {passkey ? `Passkey (${passkey.device ?? "device"}), user verified` : "Hold-to-approve (no passkey on this device)"} · {dateTime(approval.simAt, tz)}
                </span>
              </div>
              {passkey?.challenge && <Row k="Signed payment digest" v={`${passkey.challenge.slice(0, 16)}…`} mono />}
            </>
          ) : (
            <p className="text-[12px] text-[#fbbf6b]">Not yet approved by the family.</p>
          )}
        </Block>

        <Block title="Audit trail">
          <div className="flex items-center gap-2 text-[12px]">
            <Link2 size={13} className="text-[#7fb3ff]" />
            <span>
              {entries.length} hash-chained log entries for this payment · head {shortHash(ledger.at(-1)?.hash ?? "")}
            </span>
          </div>
          <a href="/api/ledger" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7fb3ff] hover:underline">
            <ScrollText size={13} /> Export the verified log
          </a>
        </Block>
      </div>

      <div className="border-t border-[#2a3441] p-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8193a8]">Draft SWIFT MT103 (for the officer to check; not sent from here)</p>
        <pre className="scroll-thin overflow-x-auto rounded-lg bg-[#0b1016] p-3 font-mono text-[11.5px] leading-relaxed text-[#b9c6d4]">{mt103(w, p, payer?.name ?? "", city)}</pre>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5 rounded-lg border border-[#2a3441] p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8193a8]">{title}</p>
      {children}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-[#8193a8]">{k}</span>
      <span className={cn("min-w-0 truncate text-right", mono && "font-mono")}>{v}</span>
    </div>
  );
}

function Check({ ok, text, rule }: { ok: boolean; text: string; rule?: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      {ok ? <CircleCheck size={13} className="mt-[2px] shrink-0 text-[#6ee7a8]" /> : <CircleAlert size={13} className="mt-[2px] shrink-0 text-[#fbbf6b]" />}
      <span className="min-w-0 flex-1">{text}</span>
      {rule && <RuleChip id={rule} className="bg-[#22303e] text-[#b9c6d4]" />}
    </div>
  );
}
