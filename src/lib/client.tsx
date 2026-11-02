"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { PublicState } from "@/server/runtime";

interface Ctx {
  state: PublicState | null;
  refresh: () => void;
  connected: boolean;
}

const CarryCtx = createContext<Ctx>({ state: null, refresh: () => {}, connected: false });

/** Fetches /api/state, coalescing bursts of change events into at most one follow-up fetch. */
function createRefresher(setState: (s: PublicState) => void) {
  let inflight = false;
  let again = false;
  const refresh = async (): Promise<void> => {
    if (inflight) {
      again = true;
      return;
    }
    inflight = true;
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) setState(await res.json());
    } catch {
      // network blip: the stream reconnect will trigger another refresh
    } finally {
      inflight = false;
      if (again) {
        again = false;
        void refresh();
      }
    }
  };
  return refresh;
}

export function CarryProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PublicState | null>(null);
  const [connected, setConnected] = useState(false);
  const [refresh] = useState(() => createRefresher(setState));

  useEffect(() => {
    void refresh();
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource("/api/stream");
      es.addEventListener("change", () => void refresh());
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
    };
  }, [refresh]);

  return <CarryCtx.Provider value={{ state, refresh, connected }}>{children}</CarryCtx.Provider>;
}

export function useCarry() {
  return useContext(CarryCtx);
}

export async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const director = (action: string, extra: Record<string, unknown> = {}) => post("/api/director", { action, ...extra });
