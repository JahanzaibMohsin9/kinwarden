"use client";

import Link from "next/link";
import { ArrowLeft, Play, Settings2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { AppQR, InstallApp } from "../InstallApp";
import { Logo } from "../ui";

/** On a laptop, beside the phone-sized app: what this is, a QR code for the real phone, and the way back. */
export function AppAside() {
  // inside the stage's or landing page's phone frame there is no room, and no need
  const embedded = useSyncExternalStore(
    () => () => {},
    () => window.self !== window.top,
    () => true,
  );
  if (embedded) return null;
  return (
    <aside className="fixed left-6 top-1/2 hidden w-[260px] -translate-y-1/2 space-y-4 xl:block 2xl:left-16" aria-label="About this page">
      <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> <Logo className="text-[15px]" />
      </Link>
      <div>
        <p className="text-[18px] font-bold leading-snug tracking-tight">This is the family&apos;s app</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
          What a family sees on their phone while Kinwarden handles a bill abroad: what&apos;s happening, what it costs, and the approvals that need their fingerprint. Everything here is a sandbox; no real money moves.
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
        <AppQR size={92} />
        <p className="text-[12.5px] leading-snug text-ink-2">Scan to open it on your phone and add it to your home screen.</p>
      </div>
      <div className="flex flex-col items-start gap-1.5 text-[13px] font-semibold">
        <InstallApp className="h-9 bg-ink px-3.5 text-[13px] text-bg" />
        <Link href="/demo" className="inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-brand hover:underline">
          <Play size={13} /> Watch a real case, step by step
        </Link>
        <Link href="/director" className="inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-ink-2 hover:text-ink">
          <Settings2 size={13} /> Drive the sandbox (Director)
        </Link>
      </div>
    </aside>
  );
}
