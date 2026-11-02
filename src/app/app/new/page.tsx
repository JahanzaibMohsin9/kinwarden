"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, GraduationCap, HeartPulse, Landmark, LifeBuoy, Plane, ShieldAlert, Siren, Upload } from "lucide-react";
import { useState } from "react";
import { director } from "@/lib/client";
import { Card } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { cn } from "@/lib/format";

const LIVE = [
  { id: "th-medical", icon: HeartPulse, title: "Hospital treatment abroad", corridor: ["PK", "Pakistan", "TH", "Thailand"], rules: "State Bank of Pakistan rules" },
  { id: "pk-admission", icon: ShieldAlert, title: "University offer through an agent", corridor: ["PK", "Pakistan", "GB", "United Kingdom"], rules: "State Bank of Pakistan rules · admission check first" },
  { id: "uk-tuition", icon: GraduationCap, title: "University fees abroad", corridor: ["CN", "China", "GB", "United Kingdom"], rules: "SAFE (国家外汇管理局) rules" },
  { id: "cn-admission", icon: ShieldAlert, title: "Study agent promises a place", corridor: ["CN", "China", "GB", "United Kingdom"], rules: "SAFE rules · admission check first · no 蚂蚁搬家" },
];

const SOON = [
  { icon: Plane, title: "Stranded abroad, card blocked" },
  { icon: Siren, title: "Family emergency abroad" },
  { icon: Landmark, title: "Visa & embassy fees" },
  { icon: LifeBuoy, title: "Insurance claim abroad" },
];

export default function NewCase() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const start = async (id: string) => {
    setBusy(id);
    await director("reset", { scenarioId: id });
    router.push("/app");
  };
  return (
    <div className="space-y-5 px-4 pb-10 pt-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">What do you need to pay?</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">Kinwarden handles it end to end under your home country&apos;s rules.</p>
      </div>
      <div className="space-y-3">
        {LIVE.map((s) => (
          <button key={s.id} onClick={() => start(s.id)} disabled={busy !== null} className="w-full text-left">
            <Card className={cn("flex items-center gap-3 p-4 transition-shadow hover:shadow-pop", busy === s.id && "border-brand")}>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand">
                <s.icon size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{s.title}</span>
                <span className="block text-[12.5px] text-ink-2">
                  <Flag code={s.corridor[0]} /> {s.corridor[1]} → <Flag code={s.corridor[2]} /> {s.corridor[3]}
                </span>
                <span className="block text-[11.5px] text-ink-3">{s.rules}</span>
              </span>
              <ArrowRight size={18} className="text-ink-3" />
            </Card>
          </button>
        ))}
      </div>
      <Link href="/app/new/upload" className="block rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-brand">
        <Card className="flex items-center gap-3 border-dashed border-brand/50 bg-brand-softer p-4 transition-shadow hover:shadow-pop">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-brand-ink">
            <Upload size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Upload your own bill</span>
            <span className="block text-[12.5px] text-ink-2">Any hospital or university bill: PDF, photo or text</span>
            <span className="block text-[11.5px] text-ink-3">Read and priced now · paid only after the bank verifies the institution</span>
          </span>
          <ArrowRight size={18} className="text-ink-3" />
        </Card>
      </Link>
      <div>
        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Coming next · same agent, new rules file</p>
        <div className="grid grid-cols-2 gap-3">
          {SOON.map((s) => (
            <Card key={s.title} className="flex flex-col gap-2 border-dashed bg-surface-2 p-3 opacity-80">
              <s.icon size={18} className="text-ink-3" />
              <span className="text-[13px] font-semibold text-ink-2">{s.title}</span>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
