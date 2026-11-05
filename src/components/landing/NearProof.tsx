import { ArrowUpRight, BadgeCheck, Bot, KeyRound, Landmark, Terminal, Wallet } from "lucide-react";
import { CLAIMS_MAP, nearEvidence, ONCHAIN_REPORT } from "@/lib/nearEvidence";

const FLOW = [
  {
    icon: BadgeCheck,
    who: "Verifier",
    call: "enroll_payee · authorize_invoice",
    title: "The hospital is verified",
    text: "Only the verifier can enroll an institution's account or authorize an invoice. Neither the agent nor the family can add a payee.",
  },
  {
    icon: Bot,
    who: "Agent on NEAR AI",
    call: "propose_payment",
    title: "The agent proposes",
    text: "It names an authorized invoice and an amount. The recipient comes from the verifier's record, and the vault reserves the amount against the family's limits.",
  },
  {
    icon: Wallet,
    who: "Family wallet",
    call: "approve_payment · 1 yoctoNEAR",
    title: "The family approves",
    text: "Their own NEAR wallet signs the exact recipient, token, amount and hash. The agent's key cannot attach the deposit an approval needs.",
  },
  {
    icon: Landmark,
    who: "Vault",
    call: "ft_transfer",
    title: "The vault pays, or gives it back",
    text: "The enrolled account receives exactly the approved amount. If the transfer fails, the money returns to the family's case once.",
  },
];

/** How a payment is enforced on NEAR, with the testnet evidence for each claim. */
export function NearProof() {
  const e = nearEvidence();
  const stats = [
    { big: e.payment.amount, label: `paid to the hospital after the family approved it in their own wallet`, link: { href: e.payment.txUrl, text: "View the transaction" } },
    { big: `${e.bypass.refused}/${e.bypass.total}`, label: "attacks with the agent's real NEAR key refused, balances unchanged", link: { href: ONCHAIN_REPORT, text: "Read the red-team report" } },
    { big: "Same build", label: "the testnet vault runs the exact code the tests and mutation checks ran against", link: { href: e.vault.url, text: "Open the vault" } },
  ];
  return (
    <section id="near" className="scroll-mt-4 border-y border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <p className="inline-flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-brand">
          <KeyRound size={14} /> On NEAR {e.network}
        </p>
        <h2 className="mt-2 text-[28px] font-bold tracking-tight">Enforced on chain, not just promised</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2">
          The agent runs on NEAR AI Cloud. The family&apos;s money sits in a NEAR vault that pays only a verified institution, and only after the family approves the exact payment. Even someone who takes over Kinwarden&apos;s server holds a key that can only propose.
        </p>

        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((s, i) => (
            <li key={s.title} className="relative rounded-[var(--radius)] border border-line bg-surface-2 p-5">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
                  <s.icon size={18} />
                </span>
                <span className="num text-[12px] font-bold text-ink-3">0{i + 1}</span>
                <span className="ml-auto rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2">{s.who}</span>
              </div>
              <p className="mt-3 text-[15px] font-semibold">{s.title}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
              <p className="mt-3 font-mono text-[11.5px] text-ink-3">{s.call}</p>
            </li>
          ))}
        </ol>

        <dl className="mt-8 grid gap-4 md:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col rounded-[var(--radius)] border border-line bg-surface p-5 shadow-card">
              <dt className="sr-only">{s.label}</dt>
              <dd className="num text-[28px] font-bold leading-none tracking-tight text-brand-strong">{s.big}</dd>
              <dd className="mt-2 flex-1 text-[13.5px] leading-snug text-ink-2">{s.label}</dd>
              <dd className="mt-3">
                <a href={s.link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline">
                  {s.link.text} <ArrowUpRight size={14} />
                </a>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius)] bg-[#0b1312] p-5 text-[#e9f1ee] md:flex-row md:items-center">
          <Terminal size={18} className="shrink-0 text-[#5ccdb4]" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">Check it yourself, without a wallet or a key</p>
            <p className="mt-0.5 text-[12.5px] text-[#a6b8b3]">Reads the public testnet: the receipt, the vault&apos;s record, the family&apos;s approval, the agent key&apos;s permissions, the deployed code and the log anchor.</p>
          </div>
          <code className="overflow-x-auto whitespace-nowrap rounded-lg bg-white/5 px-3 py-2 font-mono text-[13px] text-[#9fd9cb]">node scripts/near/verify.mjs</code>
        </div>
        <p className="mt-4 text-[12.5px] text-ink-3">
          NEAR testnet by design: tUSDC is a test token with no value, and the hospitals are fictional, so no real institution receives funds. Every claim and the test that checks it:{" "}
          <a href={CLAIMS_MAP} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
            claim → test map
          </a>
          .
        </p>
      </div>
    </section>
  );
}
