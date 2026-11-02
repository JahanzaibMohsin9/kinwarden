"use client";

import { useSyncExternalStore } from "react";
import type { CaseFile } from "@/domain/types";

// Which family member is using this phone. Everyone on the case can follow it; only the person who pays
// can approve (the server checks it too). Remembered per device and case, like the language.
const key = (c: CaseFile) => `kinwarden.viewer.${c.id}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(c: CaseFile): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(key(c));
  } catch {}
  const id = saved ?? memory.get(key(c));
  return id && c.people.some((p) => p.id === id) ? id : c.people[0].id;
}

export function setViewer(c: CaseFile, personId: string) {
  memory.set(key(c), personId);
  try {
    localStorage.setItem(key(c), personId);
  } catch {}
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useViewer(c: CaseFile | undefined): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (c ? read(c) : undefined),
    () => c?.people[0].id,
  );
}
