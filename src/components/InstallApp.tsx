"use client";

import { Download, Share, SquarePlus, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/format";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chrome and Edge fire this once the app is installable; keep it for the button.
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    listeners.forEach((fn) => fn());
  });
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true);
const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/.test(navigator.userAgent);
const isPhone = () =>
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod/.test(navigator.userAgent);

/** A QR code that opens the family app on a phone. */
export function AppQR({
  className,
  size = 132,
}: {
  className?: string;
  size?: number;
}) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(`${window.location.origin}/app`, {
      type: "svg",
      margin: 1,
      color: { dark: "#12201e", light: "#ffffff" },
    }).then(setSvg, () => setSvg(""));
  }, []);
  return (
    <span
      role="img"
      aria-label="QR code: opens the Kinwarden family app on your phone"
      className={cn(
        "block overflow-hidden rounded-xl bg-white p-1.5",
        className,
      )}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** "Install app": the real prompt where the browser offers one, the two iPhone steps, or a QR code on a laptop. */
export function InstallApp({
  className,
  label = "Install app",
}: {
  className?: string;
  label?: string;
}) {
  const prompt = useSyncExternalStore(
    subscribe,
    () => deferred,
    () => null,
  );
  const installed = useSyncExternalStore(subscribe, isStandalone, () => false);
  const [open, setOpen] = useState(false);
  if (installed) return null;

  const click = async () => {
    if (prompt) {
      await prompt.prompt();
      deferred = null;
      listeners.forEach((fn) => fn());
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={click}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full font-semibold",
          className,
        )}
      >
        <Download size={15} /> {label}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Install Kinwarden"
            onClick={() => setOpen(false)}
          >
            <div
              className="relative w-full max-w-sm rounded-[var(--radius)] bg-surface p-5 text-ink shadow-float"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-surface-3"
              >
                <X size={16} />
              </button>
              <p className="text-[17px] font-bold">
                Put Kinwarden on your phone
              </p>
              <p className="mt-1 text-[13px] text-ink-2">
                It installs like an app: its own icon, full screen, no app
                store.
              </p>
              {!isPhone() && (
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                  <AppQR size={112} />
                  <p className="text-[13px] text-ink-2">
                    Scan with your phone&apos;s camera to open the family app,
                    then follow the steps below.
                  </p>
                </div>
              )}
              {(isIOS() || !isPhone()) && (
                <div className="mt-4">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    iPhone · Safari
                  </p>
                  <ol className="mt-1.5 space-y-1.5 text-[14px]">
                    <li className="flex items-center gap-2">
                      <Share size={16} className="text-brand" /> Tap{" "}
                      <b>Share</b> in the toolbar
                    </li>
                    <li className="flex items-center gap-2">
                      <SquarePlus size={16} className="text-brand" /> Choose{" "}
                      <b>Add to Home Screen</b>
                    </li>
                  </ol>
                </div>
              )}
              {!isIOS() && (
                <div className="mt-4">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    Android · Chrome
                  </p>
                  <ol className="mt-1.5 space-y-1.5 text-[14px]">
                    <li>
                      Tap the <b>⋮</b> menu
                    </li>
                    <li>
                      Choose <b>Install app</b> (or <b>Add to Home screen</b>)
                    </li>
                  </ol>
                </div>
              )}
            </div>
          </div>,
          // rendered on the body, so a transformed parent (the side panel) can't trap the overlay
          document.body,
        )}
    </>
  );
}
