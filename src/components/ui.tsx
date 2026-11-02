"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/format";

export function Logo({ className, mark = false }: { className?: string; mark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-ink", className)}>
      <svg viewBox="0 0 32 32" className="h-[1.6em] w-[1.6em] shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" fill="var(--brand)" />
        <path d="M8.5 21.5c2.2-7.6 12.8-7.6 15 0" fill="none" stroke="var(--brand-ink)" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="8.5" cy="21.5" r="2.6" fill="var(--brand-ink)" />
        <circle cx="23.5" cy="21.5" r="2.6" fill="var(--amber-soft)" stroke="var(--brand-ink)" strokeWidth="1.6" />
        <circle cx="16" cy="13.3" r="1.7" fill="var(--brand-ink)" />
      </svg>
      {!mark && (
        <span>
          Kin<span className="text-brand">warden</span>
        </span>
      )}
    </span>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-[var(--radius)] border border-line bg-surface shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

type Tone = "neutral" | "brand" | "amber" | "danger" | "success" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  brand: "bg-brand-soft text-brand-strong",
  amber: "bg-amber-soft text-amber-strong",
  danger: "bg-danger-soft text-danger",
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", className, children, icon }: { tone?: Tone; className?: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4", TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between px-1", className)}>
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">{children}</h3>
      {action}
    </div>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "soft" | "danger" | "outline"; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,background,opacity] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-brand text-brand-ink hover:bg-brand-strong",
        variant === "soft" && "bg-brand-soft text-brand-strong hover:bg-brand-track",
        variant === "ghost" && "text-ink-2 hover:bg-surface-3",
        variant === "outline" && "border border-line-strong bg-surface text-ink hover:bg-surface-2",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        className,
      )}
      {...rest}
    />
  );
}

/** Single-value meter: track and fill from the same ramp; status color + icon + label only near the cap. */
export function Meter({ value, max, label, sub, className }: { value: number; max: number; label: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const state = pct >= 100 ? "danger" : pct >= 80 ? "amber" : "brand";
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="truncate text-ink-2">{label}</span>
        <span className="num shrink-0 font-semibold text-ink">{sub}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-brand-track" role="meter" aria-valuenow={Math.round(value)} aria-valuemax={max} aria-valuemin={0}>
        <motion.div
          className={cn("h-full rounded-full", state === "brand" && "bg-brand", state === "amber" && "bg-amber", state === "danger" && "bg-danger")}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        />
      </div>
    </div>
  );
}

export function Sheet({ open, onClose, children, title, className }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: React.ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.button aria-label="Close" className="absolute inset-0 bg-[rgb(8_16_15/0.45)] backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            className={cn("relative z-10 flex max-h-[92dvh] w-full max-w-[480px] flex-col rounded-t-[28px] bg-surface shadow-float", className)}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <div className="flex items-center justify-between px-5 pb-1 pt-3">
              <div className="mx-auto h-1.5 w-10 rounded-full bg-line-strong" />
            </div>
            {title && (
              <div className="flex items-center justify-between px-5 pb-2">
                <h2 className="text-lg font-semibold">{title}</h2>
                <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-surface-3 text-ink-2" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            )}
            <div className="scroll-thin overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))]">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Dots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="h-1 w-1 rounded-full bg-current" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }} />
      ))}
    </span>
  );
}

export function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-3 text-ink-3">{icon}</div>
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="text-sm text-ink-3">{hint}</p>}
    </div>
  );
}
