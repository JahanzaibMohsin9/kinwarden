"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Activity, FileText, Fingerprint, House, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useCarry } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { activeCase, pendingApprovals, threatCount } from "@/lib/selectors";
import { cn } from "@/lib/format";
import { corridorOf } from "@/domain/corridors";
import { Dots, Logo } from "../ui";
import { Flag } from "../Flag";
import { ApprovalSheet } from "./ApprovalSheet";
import { ApprovalSummary } from "./Overview";
import { MessageBanner } from "./MessageBanner";
import { setViewer, useViewer } from "@/lib/viewer";

const TABS = [
  { href: "/app", key: "overview", icon: House },
  { href: "/app/activity", key: "activity", icon: Activity },
  { href: "/app/money", key: "money", icon: Wallet },
  { href: "/app/docs", key: "documents", icon: FileText },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state } = useCarry();
  const { t } = useT();
  const pathname = usePathname();
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const seenApprovals = useRef(new Set<string>());

  // inside the stage's phone frame: leave room for the notch
  const embedded = useSyncExternalStore(
    () => () => {},
    () => window.self !== window.top,
    () => false,
  );
  const c = state ? activeCase(state) : undefined;
  const pending = useMemo(() => (state && c ? pendingApprovals(state.world, c.id) : []), [state, c]);
  const viewer = useViewer(c);
  const threats = state ? threatCount(state.world) : 0;

  // pop the approval sheet when a new approval arrives
  useEffect(() => {
    for (const a of pending) {
      if (!seenApprovals.current.has(a.id)) {
        seenApprovals.current.add(a.id);
        setApprovalId(a.id);
        break;
      }
    }
  }, [pending]);

  if (!state || !c) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <Logo className="text-xl" />
      </div>
    );
  }

  const corridor = corridorOf(c.corridor);
  const agent = state.world.agent;
  const working = state.agentBusy;

  return (
    <div className="relative mx-auto flex h-dvh max-w-[480px] flex-col overflow-hidden bg-bg">
      {/* Top bar */}
      <header className={cn("z-20 shrink-0 border-b border-line/70 bg-bg/85 px-4 pb-2 backdrop-blur-md", embedded ? "pt-10" : "pt-[max(12px,env(safe-area-inset-top))]")}>
        <div className="flex items-center gap-2">
          <Link href="/app" aria-label="Kinwarden home">
            <Logo mark className="text-[15px]" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-[15px] font-semibold leading-tight")}>{c.title}</p>
            <p className="truncate text-[11.5px] text-ink-3" dir="ltr">
              <Flag code={corridor.fromCode} /> {corridor.fromCity.name} → <Flag code={corridor.toCode} /> {corridor.toCity.name}
            </p>
          </div>
          <Link
            href="/app/security"
            className={cn("relative grid h-9 w-9 place-items-center rounded-full border border-line bg-surface", pathname === "/app/security" && "border-brand text-brand")}
            aria-label={t("security")}
          >
            <ShieldCheck size={18} />
            {threats > 0 && (
              <span className="num absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{threats}</span>
            )}
          </Link>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
              agent.killSwitch ? "bg-danger-soft text-danger" : working ? "bg-brand-soft text-brand-strong" : "bg-surface-3 text-ink-2",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", agent.killSwitch ? "bg-danger" : working ? "bg-brand" : "bg-success")} />
            {agent.killSwitch ? t("agentStopped") : working ? t("agentWorking") : t("agentIdle")}
            {working && !agent.killSwitch && <Dots />}
          </span>
          {c.people.length > 1 && (
            <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-3" dir="ltr">
              <span className="sr-only">{t("viewingAs")}</span>
              <select
                value={viewer}
                onChange={(e) => setViewer(c, e.target.value)}
                className="h-6 max-w-[130px] truncate rounded-full border border-line bg-surface px-2 text-[11px] font-semibold text-ink-2"
                title={t("viewingAs")}
              >
                {c.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name.split(" ")[0]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {agent.mode !== "live" && (
            <span className="rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[10.5px] font-medium text-ink-3" dir="ltr">
              {agent.mode === "replay" ? "Replay of a recorded AI run" : "Scripted demo · no AI"}
            </span>
          )}
          {agent.lastError && (
            <span className="truncate rounded-full bg-amber-soft px-2 py-0.5 text-[10.5px] font-medium text-amber-strong" title={agent.lastError} dir="ltr">
              {agent.lastError}
            </span>
          )}
        </div>
      </header>

      {/* Pending approval banner */}
      <AnimatePresence>
        {pending.length > 0 && !approvalId && (
          <motion.button
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            onClick={() => setApprovalId(pending[0].id)}
            className="z-10 mx-3 mt-2 flex items-center gap-3 rounded-2xl bg-amber px-4 py-3 text-left text-white shadow-pop"
          >
            <Fingerprint size={22} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold opacity-90">{t("needsYou")}</span>
              <span className="block truncate text-[14px] font-semibold">
                <ApprovalSummary id={pending[0].id} />
              </span>
            </span>
            <span className="rounded-full bg-white/20 px-3 py-1 text-[12px] font-semibold">{t("review")}</span>
          </motion.button>
        )}
      </AnimatePresence>

      <main className="scroll-thin relative flex-1 overflow-y-auto">{children}</main>

      {/* Bottom tabs */}
      <nav className="z-20 shrink-0 border-t border-line/70 bg-bg/90 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-md">
        <ul className="grid grid-cols-4">
          {TABS.map(({ href, key, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link href={href} className={cn("flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold", active ? "text-brand" : "text-ink-3")}>
                  <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-brand-soft")}>
                    <Icon size={19} strokeWidth={active ? 2.4 : 2} />
                  </span>
                  <span>{t(key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* simulated WhatsApp notification; not on the Activity tab, where the message is already in view */}
      <MessageBanner messages={state.world.messages.filter((m) => m.caseId === c.id)} hidden={pathname === "/app/activity" || approvalId !== null} />

      <ApprovalSheet key={approvalId ?? "none"} approvalId={approvalId} onClose={() => setApprovalId(null)} />
    </div>
  );
}
