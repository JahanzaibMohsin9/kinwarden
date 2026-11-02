"use client";

import Link from "next/link";
import { useState } from "react";
import { HeartPulse, Smartphone, Terminal } from "lucide-react";
import { useCarry } from "@/lib/client";
import { activeCase } from "@/lib/selectors";
import { cn } from "@/lib/format";
import { Logo } from "../ui";
import { AgentConsole } from "./AgentConsole";
import { BankConsole } from "./BankConsole";
import { DirectorPanel } from "./DirectorPanel";
import { HospitalDesk } from "./HospitalDesk";
import { StageAnchors } from "./StageAnchors";
import { PhoneFrame } from "./PhoneFrame";

/** One screen for the demo video: the outside world, the family's phone, and the machine's view. */
export function Stage() {
  const { state } = useCarry();
  const [showDirector, setShowDirector] = useState(true);
  const c = state ? activeCase(state) : undefined;
  const inst = state && c ? state.world.institutions[c.institutionId] : undefined;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[#08100f] text-[#e9f1ee]">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(#5ccdb4 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0e6b5c] opacity-20 blur-[140px]" />

      <header className="relative z-10 flex items-center gap-3 px-5 pt-4">
        <Link href="/" aria-label="Kinwarden home" className="rounded-xl bg-white/95 px-2.5 py-1.5">
          <Logo className="text-[15px]" />
        </Link>
        <p className="text-[13px] text-[#9fb2ad]">Never carry cash across borders again.</p>
        <button onClick={() => setShowDirector((v) => !v)} className="ml-auto rounded-lg border border-white/15 px-2.5 py-1 text-[11.5px] font-semibold text-[#9fb2ad] hover:text-white">
          {showDirector ? "Hide controls" : "Show controls"}
        </button>
      </header>
      {showDirector && (
        <div className="relative z-10 mx-5 mt-3 rounded-2xl bg-white/95 px-3 py-2 text-[#12201e]" data-theme="light">
          <DirectorPanel dense />
        </div>
      )}

      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(300px,1fr)_auto_minmax(300px,1fr)]">
        <section className="hidden min-h-0 flex-col gap-3 lg:flex">
          <Label icon={<HeartPulse size={13} />}>{inst?.kind === "university" ? "The university" : "The hospital"} · outside world</Label>
          <div className="min-h-0 flex-[3]">
            <HospitalDesk compact />
          </div>
          <div className="min-h-0 flex-[2]">
            <BankConsole />
          </div>
        </section>

        <section className="flex min-h-0 flex-col items-center gap-3">
          <Label icon={<Smartphone size={13} />}>The family&apos;s phone</Label>
          <PhoneFrame />
        </section>

        <section className="hidden min-h-0 flex-col gap-3 lg:flex">
          <Label icon={<Terminal size={13} />}>What the agent did · machine view</Label>
          <div className="min-h-0 flex-1">
            <AgentConsole />
          </div>
          {state && <StageAnchors state={state} />}
        </section>
      </div>
    </div>
  );
}

function Label({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return <p className={cn("inline-flex items-center gap-1.5 self-start text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7d918c]")}>{icon}{children}</p>;
}
