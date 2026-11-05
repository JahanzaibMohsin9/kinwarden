import Link from "next/link";
import { BadgeCheck, Ban, FileSignature, KeyRound, Link2, Mail, OctagonX, Route, Scale, Wallet } from "lucide-react";
import { Logo } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { ImpactPanel } from "@/components/ImpactPanel";
import { Hero } from "@/components/landing/Hero";
import { NearProof } from "@/components/landing/NearProof";

const STEPS = [
  { icon: Mail, title: "It talks to the institution", text: "Emails the hospital or university's verified desk, gets the estimate, the deposit deadline and the bank details." },
  { icon: Scale, title: "It knows the rules", text: "Checks your home country's regulations: limits, required forms, direct-to-institution rules. Every rule links to its source." },
  { icon: Route, title: "It picks the best route", text: "Compares bank transfer, card and cash on total cost and arrival time, and explains the trade-off in one sentence." },
  { icon: Wallet, title: "You approve, it handles the rest", text: "Nothing moves until you approve the exact payment in your own wallet. Then it tracks the money, checks the final bill and claims refunds." },
];

const SAFETY = [
  { icon: BadgeCheck, title: "Verified accounts only", text: "Bank details from any email or document are checked against a verified record before money can move." },
  { icon: Ban, title: "Untrusted content stays data", text: "Instructions hidden in invoices or look-alike emails are flagged, never followed." },
  { icon: FileSignature, title: "Rules as code", text: "Limits and forms live in versioned rule files, so a policy change is one line, not a new app." },
  { icon: Link2, title: "Tamper-evident log", text: "Every action is SHA-256 hash-chained, and the chain's head is anchored on the NEAR vault at each milestone. Any later edit is detected." },
  { icon: KeyRound, title: "A key that can only propose", text: "The agent's NEAR key may call three vault methods. It cannot approve, withdraw, move tokens, add payees or change its own permissions." },
  { icon: OctagonX, title: "Emergency stop", text: "Pause the vault or switch the agent off from your wallet. Pending proposals are released at once." },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <Hero />

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-3xl px-5 py-14">
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-brand">Why we built this</p>
          <blockquote className="mt-3 text-[22px] font-semibold leading-snug tracking-tight sm:text-[26px]">
            “When we went to Bangkok for medical treatment, we carried USD 10,000 in cash because nobody told us Pakistan&apos;s rules already allowed up to USD 50,000 to be sent straight to the hospital. When the bill passed USD 10,000, we were stuck.”
          </blockquote>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            The rules weren&apos;t the problem. Not knowing them, the paperwork, the fees and the time pressure were. Families in Pakistan, China, Egypt, Nigeria, Bangladesh and many other countries with capital controls face the same thing when they pay for care or education abroad.
          </p>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-4 px-5 py-16">
        <h2 className="text-[28px] font-bold tracking-tight">An agent, not a chatbot</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-2">It works for days, across the hospital, the bank and your family, until every bill is paid and every refund is back.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-[var(--radius)] border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
                  <s.icon size={18} />
                </span>
                <span className="num text-[12px] font-bold text-ink-3">0{i + 1}</span>
              </div>
              <p className="mt-3 text-[15px] font-semibold">{s.title}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <NearProof />

      <ImpactPanel />

      <section className="bg-[#0b1312] text-[#e9f1ee]">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-[28px] font-bold tracking-tight">Safe by construction</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-[#a6b8b3]">The AI proposes. Deterministic code, the NEAR vault and your own wallet decide.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SAFETY.map((s) => (
              <div key={s.title} className="rounded-[var(--radius)] border border-[#213230] bg-[#111b1a] p-5">
                <s.icon size={20} className="text-[#5ccdb4]" />
                <p className="mt-3 text-[15px] font-semibold">{s.title}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#a6b8b3]">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-[28px] font-bold tracking-tight">One agent, any corridor</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-ink-2">Each country&apos;s regulations are a rules file. The agent stays the same.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Corridor from="PK" to="TH" title="Pakistan → Thailand · medical treatment" rules="SBP: USD 50,000 per case direct to hospital, Appendix V-68 form, card tax 0.5% from July 2026" />
          <Corridor from="CN" to="GB" title="China → United Kingdom · university fees" rules="SAFE: USD 50,000 yearly quota, above it with proof of tuition, no splitting across relatives' quotas" />
          <Corridor from="PK" to="GB" title="Pakistan → United Kingdom · an offer through an agent" rules="No tuition until the university itself confirms the admission; fees only to its own account" />
          <Corridor from="CN" to="GB" title="China → United Kingdom · a study agent promises guaranteed admission" rules="Same check, plus no buying pounds in relatives' names to dodge the quota" />
        </div>
        <p className="mt-4 text-[13.5px] text-ink-2">
          Or upload any hospital or university bill from 13 countries: Kinwarden prices it under your home country&apos;s rules at once, and pays only after the bank has verified the institution.
        </p>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-6 text-[12.5px] text-ink-3">
          <Logo mark />
          <span>Kinwarden on NEAR testnet. Institutions are fictional, tUSDC has no value and rates are illustrative. Regulations are cited with their sources and status.</span>
          <span className="ml-auto flex gap-3">
            <Link href="/hospital" className="hover:text-ink">
              Institution desk
            </Link>
            <Link href="/bank" className="hover:text-ink">
              Payment rails
            </Link>
            <Link href="/director" className="hover:text-ink">
              Director
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Corridor({ from, to, title, rules }: { from: string; to: string; title: string; rules: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-line bg-surface p-5 shadow-card">
      <p className="text-[26px]">
        <Flag code={from} /> <span className="text-ink-3">→</span> <Flag code={to} />
      </p>
      <p className="mt-2 text-[15px] font-semibold">{title}</p>
      <p className="mt-1 text-[13.5px] text-ink-2">{rules}</p>
    </div>
  );
}
