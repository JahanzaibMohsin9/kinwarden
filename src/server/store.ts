import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { Actor, LedgerEntry, World } from "@/domain/types";
import { GENESIS_HASH, hashEntry } from "./hash";

export const DATA_DIR = process.env.KINWARDEN_DATA_DIR || path.join(process.cwd(), ".data");

export interface CommitInput {
  actor: Actor;
  type: string;
  caseId?: string;
  narration?: string;
  data?: Record<string, unknown>;
}

export interface Anchor {
  id: string;
  seq: number;
  hash: string;
  at: string;
  simAt: string;
  note: string;
  /** the copy on a public chain, when anchoring is configured (see src/server/anchor) */
  chain?: OnChainAnchor;
}

export interface OnChainAnchor {
  chainId: number;
  contract: string;
  status: "pending" | "confirmed" | "failed";
  txHash?: string;
  blockNumber?: number;
  explorerUrl?: string;
  error?: string;
}

export interface Trigger {
  caseId: string;
  reason: string;
  detail?: string;
}

export class Store extends EventEmitter {
  world!: World;
  ledger: LedgerEntry[] = [];
  anchors: Anchor[] = [];
  private saveTimer: NodeJS.Timeout | null = null;
  private changeTimer: NodeJS.Timeout | null = null;
  private readonly WORLD_FILE: string;
  private readonly LEDGER_FILE: string;
  private readonly ANCHOR_FILE: string;

  /** Each visitor's sandbox keeps its world, log and anchors in its own folder. */
  constructor(readonly dataDir: string = DATA_DIR) {
    super();
    this.WORLD_FILE = path.join(dataDir, "world.json");
    this.LEDGER_FILE = path.join(dataDir, "ledger.jsonl");
    this.ANCHOR_FILE = path.join(dataDir, "anchors.json");
  }

  load(seed: () => World) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.WORLD_FILE)) {
      this.world = JSON.parse(fs.readFileSync(this.WORLD_FILE, "utf8"));
      this.ledger = fs.existsSync(this.LEDGER_FILE)
        ? fs.readFileSync(this.LEDGER_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
      this.anchors = fs.existsSync(this.ANCHOR_FILE) ? JSON.parse(fs.readFileSync(this.ANCHOR_FILE, "utf8")) : [];
      // never resume mid-run after a restart
      this.world.agent.status = this.world.agent.killSwitch ? "stopped" : "idle";
      this.world.agent.currentCaseId = undefined;
    } else {
      this.reset(seed());
    }
  }

  reset(world: World) {
    this.world = world;
    this.ledger = [];
    this.anchors = [];
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.LEDGER_FILE, "");
    fs.writeFileSync(this.ANCHOR_FILE, "[]");
    this.saveNow();
    this.changed();
  }

  nextId(prefix: string): string {
    const n = (this.world.counters[prefix] ?? 0) + 1;
    this.world.counters[prefix] = n;
    return `${prefix}_${n}`;
  }

  /** Append a hash-chained entry to the activity log. */
  log(input: CommitInput): LedgerEntry {
    const prev = this.ledger.at(-1);
    const base: Omit<LedgerEntry, "hash"> = {
      seq: (prev?.seq ?? 0) + 1,
      at: new Date().toISOString(),
      simAt: this.world.now,
      actor: input.actor,
      type: input.type,
      caseId: input.caseId,
      narration: input.narration,
      data: input.data ?? {},
      prevHash: prev?.hash ?? GENESIS_HASH,
    };
    const entry: LedgerEntry = { ...base, hash: hashEntry(base) };
    this.ledger.push(entry);
    fs.appendFileSync(this.LEDGER_FILE, JSON.stringify(entry) + "\n");
    this.scheduleSave();
    this.changed();
    this.emit("logged", entry);
    return entry;
  }

  mutate(fn: (w: World) => void) {
    fn(this.world);
    this.scheduleSave();
    this.changed();
  }

  trigger(t: Trigger) {
    this.emit("trigger", t);
  }

  addAnchor(note: string): Anchor {
    const head = this.ledger.at(-1);
    const anchor: Anchor = {
      id: `anc_${Date.now().toString(36)}_${this.anchors.length + 1}`,
      seq: head?.seq ?? 0,
      hash: head?.hash ?? GENESIS_HASH,
      at: new Date().toISOString(),
      simAt: this.world.now,
      note,
    };
    this.anchors.push(anchor);
    fs.writeFileSync(this.ANCHOR_FILE, JSON.stringify(this.anchors, null, 2));
    this.changed();
    return anchor;
  }

  /** Record what happened to an anchor's on-chain copy. An anchor from before a reset is gone: ignore it. */
  updateAnchor(id: string, chain: OnChainAnchor) {
    const a = this.anchors.find((x) => x.id === id);
    if (!a) return;
    a.chain = chain;
    fs.writeFileSync(this.ANCHOR_FILE, JSON.stringify(this.anchors, null, 2));
    this.changed();
  }

  /** Test hook for the "tamper" demo: edit a stored entry without re-hashing. */
  tamper(seq: number, narration: string): boolean {
    const e = this.ledger.find((x) => x.seq === seq);
    if (!e) return false;
    e.narration = narration;
    fs.writeFileSync(this.LEDGER_FILE, this.ledger.map((x) => JSON.stringify(x)).join("\n") + "\n");
    this.changed();
    return true;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 150);
  }

  private saveNow() {
    fs.writeFileSync(this.WORLD_FILE, JSON.stringify(this.world));
  }

  private changed() {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.emit("change", this.ledger.at(-1)?.seq ?? 0);
    }, 60);
  }
}
