"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FamilyMessage } from "@/domain/types";
import { useT } from "@/lib/i18n";

// Families in Pakistan live on WhatsApp, so Kinwarden's messages would reach them there. This shows how
// one would arrive: a phone notification at the top of the screen. Simulated; nothing is sent anywhere.
// Styled as the phone's own notification, not as the app (outside-world styling, like the other panels).
export function MessageBanner({ messages, hidden }: { messages: FamilyMessage[]; hidden: boolean }) {
  const { t } = useT();
  const [shown, setShown] = useState<FamilyMessage | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const agent = messages.filter((m) => m.from === "agent");
    // messages already there when the app opens are not news
    if (seen.current === null) {
      seen.current = new Set(agent.map((m) => m.id));
      return;
    }
    const fresh = agent.filter((m) => !seen.current!.has(m.id));
    for (const m of fresh) seen.current.add(m.id);
    if (!fresh.length || hidden) return;
    const latest = fresh.at(-1)!;
    // the state update happens after the notification "arrives", like a push
    const show = setTimeout(() => setShown(latest), 0);
    const hide = setTimeout(() => setShown((s) => (s?.id === latest.id ? null : s)), 7000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [messages, hidden]);

  return (
    <AnimatePresence>
      {shown && !hidden && (
        <motion.div
          key={shown.id}
          initial={{ y: -90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -90, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="absolute inset-x-2 top-2 z-40"
          role="status"
          aria-live="polite"
        >
          <div className="relative flex items-start gap-2.5 rounded-[20px] bg-[#1f2c34]/95 p-3 pr-9 text-[#e9edef] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#25d366] text-[#0b141a]">
              <MessageCircle size={19} />
            </span>
            <Link href="/app/activity" onClick={() => setShown(null)} className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5 text-[11.5px] text-[#8696a0]">
                <span className="font-semibold text-[#e9edef]">WhatsApp</span> · {t("waSimulated")}
              </span>
              <span className="block text-[13.5px] font-semibold">Kinwarden</span>
              <span className="line-clamp-2 text-[13px] leading-snug text-[#d1d7db]">{shown.text}</span>
            </Link>
            <button type="button" onClick={() => setShown(null)} aria-label={t("waDismiss")} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-[#8696a0] hover:bg-white/10">
              <X size={15} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
