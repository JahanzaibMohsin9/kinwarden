"use client";

import { useEffect, useRef, useState } from "react";

/** The family app in a phone frame, as large as the space allows (stage, story mode). */
export function PhoneFrame({ src = "/app", title = "Kinwarden family app", maxHeight = 880 }: { src?: string; title?: string; maxHeight?: number }) {
  const slot = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setH(Math.min(e.contentRect.height, maxHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight]);
  return (
    <div ref={slot} className="flex min-h-0 w-full flex-1 justify-center">
      <div className="relative" style={{ height: h, width: Math.round((h * 390) / 844) }}>
        <div className="absolute inset-0 rounded-[52px] bg-[#1b1f1e] p-[10px] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="relative h-full w-full overflow-hidden rounded-[42px] bg-bg">
            <iframe src={src} title={title} className="h-full w-full border-0" />
            <div className="pointer-events-none absolute left-1/2 top-2 h-[26px] w-[96px] -translate-x-1/2 rounded-full bg-black" />
          </div>
        </div>
      </div>
    </div>
  );
}
