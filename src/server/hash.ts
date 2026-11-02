import { createHash } from "node:crypto";
import type { LedgerEntry } from "@/domain/types";
import { stableStringify } from "@/lib/canonical";

export { stableStringify };

export const GENESIS_HASH = "0".repeat(64);

export function hashEntry(entry: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256").update(stableStringify(entry)).digest("hex");
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  headHash: string;
  brokenAt?: number;
  reason?: string;
}

/** Recompute every hash and check each entry points at the one before it. */
export function verifyChain(entries: LedgerEntry[]): ChainCheck {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prevHash !== prev) {
      return { ok: false, checked: i, headHash: prev, brokenAt: e.seq, reason: "Entry does not point at the previous entry's hash" };
    }
    const { hash, ...rest } = e;
    const expected = hashEntry(rest);
    if (expected !== hash) {
      return { ok: false, checked: i, headHash: prev, brokenAt: e.seq, reason: "Entry contents were changed after it was written" };
    }
    prev = hash;
  }
  return { ok: true, checked: entries.length, headHash: prev };
}
