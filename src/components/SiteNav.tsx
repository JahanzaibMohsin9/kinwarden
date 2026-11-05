"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";
import { Logo } from "./ui";
import { InstallApp } from "./InstallApp";

// One navigation for every page, so nobody gets lost: the three things a visitor can do, and the
// sandbox's inner workings under "Behind the scenes", each with what it is.
export const MAIN = [
  { href: "/demo", label: "Watch the demo" },
  { href: "/app", label: "Family app" },
  { href: "/attack", label: "Try to fool it" },
  { href: "/#near", label: "On NEAR" },
  { href: "/#how", label: "How it works" },
];

export const BEHIND = [
  { href: "/director", label: "Director", hint: "Drive the sandbox: next event, agent mode, chaos, tamper demo" },
  { href: "/stage", label: "Demo stage", hint: "Hospital, phone and agent side by side, with controls: the screen for recording the video" },
  { href: "/hospital", label: "Hospital & university desk", hint: "The institution's inbox: what the agent emails and what it gets back" },
  { href: "/bank", label: "Payment rails", hint: "The sandbox bank and card network moving the money" },
  { href: "/bank/officer", label: "Bank officer", hint: "The bank's view: a remittance package ready to approve" },
  { href: "/pack", label: "Case pack", hint: "Every bill, receipt and form, printable" },
  { href: "https://github.com/JahanzaibMohsin9/kinwarden/blob/main/docs/redteam/ONCHAIN.md", label: "On-chain evidence & source", hint: "NEAR testnet transactions, the red-team report and the source code", external: true },
];

export function SiteNav({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const dark = tone === "dark";
  const link = (active: boolean) =>
    cn("rounded-full px-3 py-2 text-[13.5px] font-semibold transition-colors", dark ? (active ? "bg-white/10 text-white" : "text-[#9fb2ad] hover:text-white") : active ? "bg-brand-soft text-brand-strong" : "text-ink-2 hover:bg-surface-3 hover:text-ink");

  const behind = (
    <ul className="space-y-0.5">
      {BEHIND.map((b) => (
        <li key={b.href}>
          <Link href={b.href} target={b.external ? "_blank" : undefined} rel={b.external ? "noreferrer" : undefined} className="block rounded-xl px-3 py-2 hover:bg-surface-3" onClick={() => setMenu(false)}>
            <span className="block text-[13.5px] font-semibold text-ink">{b.label}</span>
            <span className="block text-[12px] leading-snug text-ink-3">{b.hint}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <header className={cn("relative z-30", className)}>
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-5 py-4">
        <Link href="/" aria-label="Kinwarden home" className={cn("rounded-xl", dark && "bg-white/95 px-2.5 py-1.5")}>
          <Logo className="text-[18px]" />
        </Link>
        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
          {MAIN.map((m) => (
            <Link key={m.href} href={m.href} className={link(path === m.href)}>
              {m.href === "/demo" && <Play size={13} className="mr-1 inline" />}
              {m.label}
            </Link>
          ))}
          <div ref={ref} className="relative">
            <button type="button" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu((v) => !v)} className={cn(link(BEHIND.some((b) => b.href === path)), "inline-flex items-center gap-1")}>
              Behind the scenes <ChevronDown size={14} className={cn("transition-transform", menu && "rotate-180")} />
            </button>
            {menu && <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-line bg-surface p-2 shadow-float">{behind}</div>}
          </div>
          <InstallApp className={cn("ml-1 h-9 px-3.5 text-[13px]", dark ? "bg-white text-[#08100f]" : "bg-ink text-bg")} />
        </nav>
        <button type="button" onClick={() => setMobile(true)} aria-label="Menu" className={cn("ml-auto grid h-10 w-10 place-items-center rounded-full md:hidden", dark ? "text-white" : "text-ink")}>
          <Menu size={20} />
        </button>
      </div>
      {mobile && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-bg p-5 text-ink md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex items-center">
            <Logo className="text-[18px]" />
            <button type="button" onClick={() => setMobile(false)} aria-label="Close menu" className="ml-auto grid h-10 w-10 place-items-center rounded-full hover:bg-surface-3">
              <X size={20} />
            </button>
          </div>
          <ul className="mt-6 space-y-1">
            {MAIN.map((m) => (
              <li key={m.href}>
                <Link href={m.href} onClick={() => setMobile(false)} className="block rounded-2xl px-3 py-3 text-[18px] font-semibold hover:bg-surface-3">
                  {m.label}
                </Link>
              </li>
            ))}
          </ul>
          <InstallApp className="mt-3 h-11 bg-brand px-5 text-[15px] text-brand-ink" label="Install on this phone" />
          <p className="mb-1 mt-8 px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Behind the scenes</p>
          {behind}
        </div>
      )}
    </header>
  );
}

/** One line at the top of an inner page: what you are looking at, and the way back. */
export function PageIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5">
      <div className="rounded-2xl border border-line bg-surface px-4 py-3">
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        <p className="text-[13px] text-ink-2">{children}</p>
      </div>
    </div>
  );
}
