import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowRight, CirclePlay, Play, ShieldAlert, Smartphone } from "lucide-react";
import { SiteNav } from "../SiteNav";
import { impactNumbers } from "../ImpactPanel";
import { MoneyMap } from "./MoneyMap";
import { nearEvidence } from "@/lib/nearEvidence";

const CHOICES = [
  { href: "/demo", icon: Play, title: "Watch a real case", text: "A father's heart treatment in Bangkok, paid start to finish by the AI agent. 4 minutes.", primary: true },
  { href: "/app/new", icon: Smartphone, title: "Try it yourself", text: "Pick a case or upload any hospital or university bill. Your own private sandbox.", primary: false },
  { href: "/attack", icon: ShieldAlert, title: "Try to fool it", text: "Send fake bank details, hidden instructions, kickbacks. Watch them fail.", primary: false },
];

/** The demo video, served from public/video/ when the deployment has it (it is too large for Git). */
const VIDEO = "/video/kinwarden-demo.mp4";
const hasVideo = () => fs.existsSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "public", VIDEO));

/** The first screen: what Kinwarden is, where money goes, and three clear ways in. */
export function Hero() {
  const n = impactNumbers();
  const near = nearEvidence();
  const counters = [
    { big: near.payment.amount, label: "paid to a hospital on NEAR testnet after the family's wallet approval" },
    { big: `${near.bypass.refused}/${near.bypass.total}`, label: "attacks with the agent's real NEAR key refused" },
    n.attacks.total ? { big: `${n.attacks.executed}/${n.attacks.total}`, label: "prompt-injection attacks got through the agent" } : null,
    n.savedOneCase ? { big: n.savedOneCase, label: "saved on one hospital case vs paying by card" } : null,
  ].filter(Boolean) as { big: React.ReactNode; label: string }[];

  return (
    <section className="relative overflow-hidden bg-[#08100f] text-[#e9f1ee]">
      <div aria-hidden className="pointer-events-none absolute -right-40 top-10 h-[620px] w-[620px] rounded-full bg-[#0e6b5c] opacity-25 blur-[150px]" />
      <SiteNav tone="dark" />
      <div className="relative mx-auto max-w-6xl px-5 pb-10 pt-6 lg:pb-14">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 mx-auto hidden max-w-[1250px] opacity-90 md:block lg:-right-24 lg:left-auto lg:top-[-30px] lg:w-[920px]" aria-hidden={false}>
          <MoneyMap className="h-auto w-full [mask-image:linear-gradient(to_right,transparent,black_28%,black_85%,transparent)]" />
        </div>
        <div className="relative max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#5ccdb4]/30 bg-[#5ccdb4]/10 px-3 py-1 text-[12.5px] font-semibold text-[#9fd9cb]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5ccdb4]" /> AI agent on NEAR · hospital and university bills abroad
          </p>
          <h1 className="mt-5 text-[44px] font-bold leading-[1.02] tracking-tight sm:text-[64px]">
            Never carry cash
            <br />
            across borders <span className="text-[#5ccdb4]">again.</span>
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-[#c9d6d2]">
            Kinwarden pays a family&apos;s hospital and university bills abroad under their own country&apos;s rules. It deals with the institution, the bank and the forms, and catches fraud. The money waits in a NEAR vault that pays only the verified institution, and only after the family approves the exact payment in their own wallet.
          </p>
          {hasVideo() && (
            <a href={VIDEO} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-[14px] font-semibold text-white hover:bg-white/[0.1]">
              <CirclePlay size={18} className="text-[#5ccdb4]" /> Watch the 2-minute video
              <span className="font-normal text-[#9fb2ad]">· one live run on NEAR testnet</span>
            </a>
          )}
        </div>
        <div className="md:hidden">
          <MoneyMap className="mt-6 h-auto w-full" />
        </div>

        <div className="relative mt-8 grid gap-3 md:mt-28 md:grid-cols-3 lg:mt-36">
          {CHOICES.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={
                c.primary
                  ? "group rounded-2xl bg-[#5ccdb4] p-5 text-[#04211b] shadow-[0_20px_60px_-20px_rgba(92,205,180,0.6)] transition-transform hover:-translate-y-0.5"
                  : "group rounded-2xl border border-white/12 bg-white/[0.05] p-5 backdrop-blur-sm transition-[transform,background] hover:-translate-y-0.5 hover:bg-white/[0.08]"
              }
            >
              <span className="flex items-center gap-2">
                <c.icon size={20} />
                <span className="text-[17px] font-bold">{c.title}</span>
                <ArrowRight size={17} className="ml-auto transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className={c.primary ? "mt-1.5 block text-[13.5px] leading-snug text-[#04211b]/80" : "mt-1.5 block text-[13.5px] leading-snug text-[#9fb2ad]"}>{c.text}</span>
            </Link>
          ))}
        </div>

        <dl className="relative mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/10 pt-6 md:grid-cols-4">
          {counters.map((c) => (
            <div key={c.label}>
              <dt className="sr-only">{c.label}</dt>
              <dd className="num text-[26px] font-bold leading-none tracking-tight text-white">{c.big}</dd>
              <dd className="mt-1.5 text-[12.5px] leading-snug text-[#9fb2ad]">{c.label}</dd>
            </div>
          ))}
        </dl>
        <p className="relative mt-5 text-[12px] text-[#7d918c]">NEAR testnet and a sandbox of simulated hospitals, universities and banks. tUSDC is a test token; no real money moves. Figures come from the recorded test runs.</p>
      </div>
    </section>
  );
}
