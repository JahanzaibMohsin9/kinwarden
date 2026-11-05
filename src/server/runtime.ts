import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, Store } from "./store";
import { AgentRunner, hasApiCredentials, MODEL } from "./agent/runner";
import { SCENARIOS, seedScenario, seedUpload } from "./scenarios";
import { advanceTo, advanceToNext, injectChaos, nextScheduled, runBeat, setPaymentStatus, submitPayment, verifyInstitution, type ChaosKind } from "./sim/engine";
import { hoursFrom } from "./sim/factory";
import { verifyChain } from "./hash";
import { listPasskeys } from "./passkey";
import type { AgentMode, UploadedBill } from "@/domain/types";
import { AnchorService, milestoneOf } from "./anchor/service";
import { ANCHOR_CHAIN, anchorConfig, explorerAddress, viemPublisher, type ChainPublisher } from "./anchor/chain";
import { DEFAULT_SESSION } from "./session";
import { answerFamily } from "./agent/answer";
import { nearConfig } from "./near/config";
import { NearBridge } from "./near/bridge";
import { nearPublisher } from "./near/anchors";

interface Runtime {
  id: string;
  store: Store;
  runner: AgentRunner;
  autoplayTimer: NodeJS.Timeout;
  runnerClass: typeof AgentRunner;
  /** on-chain anchoring, when the testnet key and contract are configured */
  anchors?: AnchorService;
  /** NEAR vault settlement for the main world, when a deployment and the agent key are configured */
  near?: NearBridge;
  nearTimer?: NodeJS.Timeout;
  lastSeen?: number;
}

// One sandbox world per visitor (see ./session). The default world keeps its old slot and folder, so
// local development, the scripts and the tests see no difference.
const g = globalThis as unknown as {
  __kinwarden?: Runtime;
  __kinwardenSessions?: Map<string, Runtime>;
  __kinwardenPublisher?: ChainPublisher | null;
  __kinwardenSweep?: NodeJS.Timeout;
};
const sessions = (g.__kinwardenSessions ??= new Map());
const MAX_SESSIONS = Number(process.env.KINWARDEN_MAX_SESSIONS ?? 80);
const IDLE_MS = Number(process.env.KINWARDEN_SESSION_IDLE_HOURS ?? 6) * 3_600_000;

/** One wallet signs every anchor, from every world. */
function publisher(): ChainPublisher | null {
  if (g.__kinwardenPublisher === undefined) {
    const cfg = anchorConfig();
    g.__kinwardenPublisher = cfg ? viemPublisher(cfg) : null;
  }
  return g.__kinwardenPublisher;
}

function create(id: string): Runtime {
  const dir = id === DEFAULT_SESSION ? DATA_DIR : path.join(DATA_DIR, "sessions", id);
  const store = new Store(dir);
  store.setMaxListeners(200);
  store.load(() => seedScenario("th-medical"));
  if (store.ledger.length === 0) {
    const preferred = process.env.KINWARDEN_DEFAULT_MODE as AgentMode | undefined;
    if (preferred && ["live", "replay", "scripted"].includes(preferred)) store.world.agent.mode = preferred;
    else if (!hasApiCredentials()) store.world.agent.mode = "scripted";
  }
  const runner = new AgentRunner(store);
  runner.resetSession();
  const rt: Runtime = { id, store, runner, runnerClass: AgentRunner, autoplayTimer: setInterval(() => autoplayTick(rt.store, rt.runner), 1500) };
  const attachAnchors = (pub: ChainPublisher) => {
    const anchors = new AnchorService(store, pub);
    store.on("logged", (e) => {
      const m = milestoneOf(e);
      if (m) anchors.milestone(m);
    });
    rt.anchors = anchors;
  };
  // One family case on chain belongs to one world: per-visitor sandbox copies stay on simulated rails.
  const near = id === DEFAULT_SESSION ? nearConfig() : null;
  if (!near) {
    const pub = publisher();
    if (pub) attachAnchors(pub);
  }
  if (near) {
    const bridge = new NearBridge(store, near);
    store.on("logged", (e) => bridge.onLogged(e));
    rt.near = bridge;
    rt.nearTimer = setInterval(() => {
      if (bridge.hasOpenLinks()) void bridge.sync();
    }, 4000);
    // The linked world anchors its log on the vault when the agent key may call anchor_log;
    // otherwise it falls back to the Conflux publisher, if that is configured.
    void bridge.ready().then((k) => {
      const caseId = Object.values(near.deployment.cases)[0]?.vaultCaseId;
      if (k.ok && k.methods.includes("anchor_log") && caseId) attachAnchors(nearPublisher(bridge.client, caseId, () => bridge.runId()));
      else {
        const pub = publisher();
        if (pub) attachAnchors(pub);
      }
    });
  }
  return rt;
}

function dispose(rt: Runtime) {
  clearInterval(rt.autoplayTimer);
  if (rt.nearTimer) clearInterval(rt.nearTimer);
  rt.runner.dispose();
  rt.anchors?.dispose();
  rt.store.removeAllListeners();
  if (rt.id !== DEFAULT_SESSION) fs.rmSync(rt.store.dataDir, { recursive: true, force: true });
}

/** Drop worlds nobody has looked at for a while, and the oldest ones beyond the limit. */
function sweep() {
  const now = Date.now();
  const byAge = [...sessions.values()].sort((a, b) => (a.lastSeen ?? 0) - (b.lastSeen ?? 0));
  for (const rt of byAge) {
    const tooMany = sessions.size > MAX_SESSIONS;
    if (!tooMany && now - (rt.lastSeen ?? 0) < IDLE_MS) break;
    if (rt.runner.isBusy) continue;
    sessions.delete(rt.id);
    dispose(rt);
  }
}
g.__kinwardenSweep ??= setInterval(sweep, 10 * 60_000);

function hotSwap(rt: Runtime) {
  // dev hot reload: keep the world, swap in the new agent code
  // (in dev, API routes can also load separate copies of this module: keep the recording going either way)
  if (rt.runnerClass === AgentRunner || rt.runner.isBusy) return;
  const prev = rt.runner;
  prev.dispose();
  rt.store.removeAllListeners("trigger");
  rt.runner = new AgentRunner(rt.store);
  rt.runner.adoptSession(prev);
  rt.runnerClass = AgentRunner;
}

export function runtime(sid: string = DEFAULT_SESSION): Runtime {
  if (sid === DEFAULT_SESSION) {
    g.__kinwarden ??= create(DEFAULT_SESSION);
    hotSwap(g.__kinwarden);
    return g.__kinwarden;
  }
  let rt = sessions.get(sid);
  if (!rt) {
    rt = create(sid);
    sessions.set(sid, rt);
    if (sessions.size > MAX_SESSIONS) sweep();
  }
  rt.lastSeen = Date.now();
  hotSwap(rt);
  return rt;
}

function pendingApprovals(store: Store) {
  return Object.values(store.world.approvals).filter((a) => !a.decision).length;
}

function autoplayTick(store: Store, runner: AgentRunner) {
  const w = store.world;
  if (!w.autoplay || runner.isBusy || w.agent.status === "working" || pendingApprovals(store) > 0) return;
  if (!nextScheduled(store)) {
    store.mutate((ww) => (ww.autoplay = false));
    return;
  }
  advanceToNext(store);
}

/** Where this world's log is anchored, for the UI. */
function anchoringInfo(rt: Runtime) {
  const pub = rt.anchors?.chain;
  if (pub && typeof pub.chainId === "string" && rt.near) {
    const d = rt.near.deployment;
    return { chain: `NEAR ${d.network}`, chainId: pub.chainId, contract: d.vault, contractUrl: d.explorerTx ? d.explorerTx.replace(/\/txns\/$/, "/address/") + d.vault : undefined };
  }
  const cfg = anchorConfig();
  return cfg ? { chain: ANCHOR_CHAIN.name, chainId: ANCHOR_CHAIN.id, contract: cfg.contract, contractUrl: explorerAddress(cfg.contract) } : null;
}

export function publicState(sid?: string) {
  const rt = runtime(sid);
  const { store, runner, near } = rt;
  const next = nextScheduled(store);
  return {
    world: store.world,
    ledger: store.ledger,
    anchors: store.anchors,
    near: near
      ? {
          network: near.deployment.network,
          rpcUrl: near.deployment.rpcUrl,
          vault: near.deployment.vault,
          token: near.deployment.token,
          tokenSymbol: near.deployment.tokenSymbol,
          tokenDecimals: near.deployment.tokenDecimals,
          explorerTx: near.deployment.explorerTx ?? null,
          cases: near.deployment.cases,
          // institutions whose bank transfers settle through the vault (the rest stay on the simulated rails)
          payeeInstitutions: Object.keys(near.deployment.payees),
          caseLimits: near.deployment.caseLimits,
          agentKey: near.keyCheck ? (near.keyCheck.ok ? { ok: true as const } : { ok: false as const, reason: near.keyCheck.reason }) : null,
        }
      : null,
    anchoring: anchoringInfo(rt),
    chain: verifyChain(store.ledger),
    agentBusy: runner.isBusy || store.world.agent.status === "working",
    nextEvent: next ? { at: next.at, label: next.label } : null,
    hasKey: hasApiCredentials(),
    passkeys: listPasskeys().map((k) => ({ id: k.id.slice(0, 12), label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
    model: MODEL,
    scenarios: SCENARIOS,
  };
}
export type PublicState = ReturnType<typeof publicState>;

// ---------------------------------------------------------------------------
// Family actions

export function decideApproval(approvalId: string, decision: "approved" | "declined", method: "passkey" | "hold", evidence?: Record<string, unknown>, actingPersonId?: string, sid?: string) {
  decideApprovalIn(runtime(sid).store, approvalId, decision, method, evidence, actingPersonId);
}

/**
 * Family roles: anyone on the case can follow it and decline a payment (a brake), but only the person
 * whose account or card pays can approve it. The family app always says who is acting; sandbox automation
 * (Director, scripts, tests) doesn't, and is treated as the payer.
 */
export function checkApprover(store: Store, approvalId: string, decision: "approved" | "declined", actingPersonId?: string) {
  const a = store.world.approvals[approvalId];
  if (!a || decision !== "approved" || !actingPersonId) return;
  const p = store.world.payments[a.paymentId];
  if (actingPersonId === p.payerId) return;
  const people = store.world.cases[a.caseId].people;
  const payer = people.find((x) => x.id === p.payerId)?.name ?? "the payer";
  const actor = people.find((x) => x.id === actingPersonId)?.name ?? "someone not on the case";
  const id = store.nextId("sec");
  store.mutate((w) =>
    w.security.push({
      id,
      at: w.now,
      caseId: a.caseId,
      severity: "warning",
      kind: "blocked_wrong_approver",
      title: "Approval by someone other than the payer was refused",
      detail: `${actor} tried to approve "${a.summary}". Only ${payer}, whose money pays it, can approve.`,
    }),
  );
  store.log({ actor: "gateway", type: "approval.refused", caseId: a.caseId, narration: `Only ${payer} can approve this payment`, data: { approvalId, paymentId: p.id, actingPersonId, payerId: p.payerId } });
  throw new Error(`Only ${payer} can approve this payment: it is paid from their account or card. You can still decline it.`);
}

/** The family's decision on a payment, applied to a given world (the app's, or a test's). */
export function decideApprovalIn(store: Store, approvalId: string, decision: "approved" | "declined", method: "passkey" | "hold", evidence?: Record<string, unknown>, actingPersonId?: string) {
  const a = store.world.approvals[approvalId];
  if (!a || a.decision) throw new Error("This approval is no longer pending.");
  if (store.world.payments[a.paymentId]?.near) {
    // Only the family's own wallet can approve or reject a NEAR payment; the server only observes it.
    throw new Error("This payment settles through the NEAR vault: approve or reject it in your NEAR wallet.");
  }
  checkApprover(store, approvalId, decision, actingPersonId);
  const p = store.world.payments[a.paymentId];
  store.mutate((w) => {
    w.approvals[approvalId].decision = decision;
    w.approvals[approvalId].decidedAt = w.now;
    w.approvals[approvalId].method = method;
  });
  store.log({
    actor: "family",
    type: decision === "approved" ? "approval.approved" : "approval.declined",
    caseId: a.caseId,
    narration: decision === "approved" ? `You approved: ${a.summary}` : `You declined: ${a.summary}`,
    data: { approvalId, paymentId: a.paymentId, method, ...(actingPersonId ? { by: actingPersonId } : {}), ...(evidence ? { passkey: evidence } : {}) },
  });
  if (decision === "approved") {
    setPaymentStatus(store, p.id, "approved", `Approved by family (${method})`);
    submitPayment(store, store.world.payments[p.id]);
  } else {
    setPaymentStatus(store, p.id, "cancelled", "Declined by family");
  }
  store.trigger({ caseId: a.caseId, reason: "approval_decided", detail: `${decision}: ${a.summary}` });
}

const ANSWERS_PER_VISITOR = Number(process.env.KINWARDEN_ANSWERS_PER_VISITOR ?? 12);
const ANSWERS_PER_DAY = Number(process.env.KINWARDEN_ANSWERS_PER_DAY ?? 300);
const answers = ((globalThis as unknown as { __kinwardenAnswers?: { day: string; total: number; by: Map<string, number> } }).__kinwardenAnswers ??= { day: "", total: 0, by: new Map() });

/** Questions left for this visitor today when the agent isn't live (each one is a call to the model). */
function takeAnswer(sid: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (answers.day !== today) Object.assign(answers, { day: today, total: 0, by: new Map() });
  if ((answers.by.get(sid) ?? 0) >= ANSWERS_PER_VISITOR || answers.total >= ANSWERS_PER_DAY) return false;
  answers.by.set(sid, (answers.by.get(sid) ?? 0) + 1);
  answers.total += 1;
  return true;
}

/**
 * The family wrote (or spoke) to Kinwarden. A live agent handles it like any event. In Replay or Scripted
 * mode the agent follows a recording or a plan, so the message must not be fed to it (it would play a
 * step out of context): the model answers the question instead, without tools (./agent/answer).
 */
export function familyMessage(caseId: string, text: string, sid?: string, opts: { voice?: boolean } = {}) {
  const { store } = runtime(sid);
  const id = store.nextId("msg");
  store.mutate((w) => w.messages.push({ id, caseId, from: "family", text, at: w.now, ...(opts.voice ? { voice: true } : {}) }));
  store.log({ actor: "family", type: "family.message", caseId, narration: text, data: { messageId: id, ...(opts.voice ? { voice: true } : {}) } });
  const w = store.world;
  if (w.agent.killSwitch) return;
  if (w.agent.mode === "live") {
    store.trigger({ caseId, reason: "family_message", detail: text });
    return;
  }
  if (!takeAnswer(sid ?? DEFAULT_SESSION)) {
    const reply = store.nextId("msg");
    const text2 = "That's all the questions for today in this demo. Switch the Director to Live mode to have the AI handle the whole case.";
    store.mutate((ww) => ww.messages.push({ id: reply, caseId, from: "agent", text: text2, at: ww.now, importance: "info" }));
    store.log({ actor: "agent", type: "agent.answer", caseId, narration: "Question limit reached", data: { messageId: reply, model: null, limit: true } });
    return;
  }
  void answerFamily(store, caseId, text);
}

export function setKillSwitch(on: boolean, sid?: string) {
  const { store } = runtime(sid);
  store.mutate((w) => {
    w.agent.killSwitch = on;
    w.agent.status = on ? "stopped" : "idle";
  });
  store.log({ actor: "family", type: on ? "agent.stopped" : "agent.resumed", narration: on ? "Emergency stop: the agent is paused" : "Agent resumed", data: {} });
}

/** The family sent their own bill: start a new case from it straight away (the agent mode stays as it was). */
export function startUploadedCase(bill: UploadedBill, sid?: string) {
  const { store, runner } = runtime(sid);
  const mode = store.world.agent.mode;
  store.reset(seedUpload(bill));
  store.mutate((w) => (w.agent.mode = mode));
  store.log({ actor: "family", type: "scenario.loaded", data: { scenarioId: "upload", mode, source: bill.source, readBy: bill.readBy } });
  runner.resetSession();
  advanceToNext(store);
}

// ---------------------------------------------------------------------------
// Director (demo controls)

export function directorAction(body: Record<string, unknown>, sid?: string) {
  const { store, runner, anchors } = runtime(sid);
  switch (body.action) {
    case "reset": {
      const id = String(body.scenarioId ?? store.world.scenarioId);
      const mode = (body.mode as AgentMode) ?? store.world.agent.mode;
      // the family's own bill can be replayed from the start; there is no seed for it without one
      const upload = id === "upload" ? store.world.upload : undefined;
      if (id === "upload" && !upload) throw new Error("No uploaded bill to restart from. Upload one in the app.");
      store.reset(upload ? seedUpload(upload) : seedScenario(id));
      store.mutate((w) => (w.agent.mode = mode));
      store.log({ actor: "director", type: "scenario.loaded", data: { scenarioId: id, mode } });
      runner.resetSession();
      return;
    }
    case "next":
      advanceToNext(store);
      return;
    case "advance":
      advanceTo(store, hoursFrom(store.world.now, Number(body.hours ?? 1)));
      return;
    case "mode":
      store.mutate((w) => (w.agent.mode = body.mode as AgentMode));
      runner.resetSession();
      return;
    case "autoplay":
      store.mutate((w) => (w.autoplay = Boolean(body.on)));
      return;
    case "autoReply":
      store.mutate((w) => (w.autoReply = Boolean(body.on)));
      return;
    case "kill":
      setKillSwitch(Boolean(body.on), sid);
      return;
    case "beat":
      runBeat(store, String(body.beat));
      store.mutate((w) => (w.schedule = w.schedule.filter((s) => (s.payload as { beat?: string }).beat !== body.beat)));
      return;
    case "nudge":
      store.trigger({ caseId: String(body.caseId), reason: "nudge" });
      return;
    case "chaos":
      if (!["bank_outage", "card_decline", "silent"].includes(String(body.kind))) throw new Error("chaos kind must be bank_outage, card_decline or silent");
      injectChaos(store, body.kind as ChaosKind);
      return;
    case "verify_institution":
      verifyInstitution(store);
      return;
    case "anchor": {
      const note = String(body.note ?? "Manual anchor").slice(0, 60);
      if (anchors) anchors.flush(note);
      else store.addAnchor(note);
      return;
    }
    case "tamper":
      store.tamper(Number(body.seq), String(body.narration ?? "Paid THB 250,000 to SR Medical Services Co."));
      return;
    default:
      throw new Error(`Unknown director action ${String(body.action)}`);
  }
}
