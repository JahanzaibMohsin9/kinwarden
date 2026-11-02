import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { World } from "@/domain/types";
import type { Store, Trigger } from "../store";
import { SYSTEM_PROMPT, wakeMessage } from "./prompt";
import { caseSnapshot } from "./snapshot";
import { anthropicToolDefs, executeTool } from "./tools";
import { SCRIPTS } from "./scripted";
import { fallbackConfig, hasProviderKey, providerConfig, type ProviderConfig } from "./llm";
import { buildVault, type Vault } from "./privacy";

/** Label of the model that Live mode will use, e.g. "DeepSeek · deepseek-v4-pro". */
export const MODEL = providerConfig().label;
const MAX_STEPS = 24;
const STEP_DELAY_SCRIPTED = Number(process.env.KINWARDEN_STEP_DELAY_MS ?? 700);
const STEP_DELAY_REPLAY = Number(process.env.KINWARDEN_STEP_DELAY_MS ?? 850);
const REC_DIR = path.join(process.env.KINWARDEN_DATA_DIR || path.join(process.cwd(), ".data"), "recordings");
/** Curated live runs checked into the repo; Replay prefers these (set KINWARDEN_REPLAY_SOURCE=latest to replay the newest local run). */
const CURATED_DIR = path.join(process.cwd(), "recordings");

export interface RecordedStep {
  tool: string;
  input: Record<string, unknown>;
  thinking?: string;
}
export interface RecordedRun {
  triggers: { reason: string; detail?: string }[];
  steps: RecordedStep[];
  finalText?: string;
}
export interface Recording {
  scenarioId: string;
  model: string;
  createdAt: string;
  note?: string;
  runs: RecordedRun[];
}

export function hasApiCredentials(): boolean {
  return hasProviderKey();
}

export class AgentRunner {
  private pending = new Map<string, Trigger[]>();
  private busy = false;
  private recording: Recording | null = null;
  private replayCursor = new Set<number>();
  private replaySource: Recording | null = null;
  private scriptedCursor = new Set<number>();

  private onTrigger = (t: Trigger) => this.enqueue(t);

  /** systemPrompt is only overridden by the red-team ablation (a naive agent without Kinwarden's safety rules) */
  constructor(
    private store: Store,
    private systemPrompt: string = SYSTEM_PROMPT,
  ) {
    store.on("trigger", this.onTrigger);
  }

  /** Detach from the store (used when dev hot-reload swaps in new code). */
  dispose() {
    this.store.off("trigger", this.onTrigger);
  }

  get isBusy() {
    return this.busy || this.pending.size > 0;
  }

  /** Take over the session of the runner this one replaces (dev hot reload), so a recording isn't split in two. */
  adoptSession(prev: AgentRunner) {
    this.recording = prev.recording;
    this.replayCursor = prev.replayCursor;
    this.replaySource = prev.replaySource;
    this.scriptedCursor = prev.scriptedCursor;
  }

  /** Called on scenario reset. */
  resetSession() {
    this.pending.clear();
    this.replayCursor.clear();
    this.scriptedCursor.clear();
    const w = this.store.world;
    this.recording = { scenarioId: w.scenarioId, model: providerConfig().label, createdAt: new Date().toISOString(), runs: [] };
    this.replaySource = loadLatestRecording(w.scenarioId);
  }

  enqueue(t: Trigger) {
    const list = this.pending.get(t.caseId) ?? [];
    list.push(t);
    this.pending.set(t.caseId, list);
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    // let events raised in the same moment (e.g. an approval and the card payment it settles) arrive, so they share one wake-up
    await new Promise((r) => setImmediate(r));
    try {
      while (this.pending.size > 0) {
        const [caseId, triggers] = this.pending.entries().next().value as [string, Trigger[]];
        this.pending.delete(caseId);
        if (this.store.world.agent.killSwitch) continue;
        await this.runCase(caseId, triggers);
      }
    } finally {
      this.busy = false;
      this.store.mutate((w) => {
        if (w.agent.status === "working") w.agent.status = "idle";
        w.agent.currentCaseId = undefined;
      });
    }
  }

  private async runCase(caseId: string, triggers: Trigger[]) {
    const mode = this.store.world.agent.mode;
    this.store.mutate((w) => {
      w.agent.status = "working";
      w.agent.currentCaseId = caseId;
      w.agent.lastError = undefined;
      w.agent.runs += 1;
    });
    this.store.log({
      actor: "system",
      type: "agent.wake",
      caseId,
      data: { mode, triggers: triggers.map((t) => ({ reason: t.reason, detail: t.detail })) },
    });
    try {
      if (mode === "live") await this.runLive(caseId, triggers);
      else if (mode === "replay") await this.runReplay(caseId, triggers);
      else await this.runScripted(caseId, triggers);
    } catch (err) {
      const msg = describeError(err);
      this.store.mutate((w) => (w.agent.lastError = msg));
      this.store.log({ actor: "system", type: "agent.error", caseId, data: { error: msg } });
    }
    this.store.log({ actor: "system", type: "agent.sleep", caseId, data: {} });
  }

  // -------------------------------------------------------------------------
  // Live: the LLM decides

  private async runLive(caseId: string, triggers: Trigger[]) {
    const cfg = providerConfig();
    if (!cfg.apiKey) {
      throw new Error("No LLM API key set. Add DEEPSEEK_API_KEY (or OPENAI_API_KEY) to .env.local, or switch the agent to Replay or Scripted mode in the Director.");
    }
    if (cfg.provider !== "anthropic") {
      try {
        return await this.runLiveOpenAICompatible(caseId, triggers, cfg);
      } catch (err) {
        // fall back only when the provider itself failed, not when our own checks stopped the run
        const fb = fallbackConfig(cfg.provider);
        if (!fb || !(err instanceof OpenAI.APIError)) throw err;
        this.store.log({ actor: "system", type: "agent.fallback", caseId, data: { from: cfg.label, to: fb.label, error: describeError(err) } });
        return await this.runLiveOpenAICompatible(caseId, triggers, fb);
      }
    }
    await this.runLiveAnthropic(caseId, triggers, cfg);
  }

  /** DeepSeek and OpenAI via the Chat Completions API with function calling. */
  private async runLiveOpenAICompatible(caseId: string, triggers: Trigger[], cfg: ProviderConfig) {
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: 180_000, maxRetries: 2 });
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = anthropicToolDefs().map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema as Record<string, unknown> },
    }));
    const vault = this.openVault(caseId, triggers);
    const run: RecordedRun = { triggers: triggers.map((t) => ({ reason: t.reason, detail: t.detail })), steps: [] };
    // DeepSeek needs reasoning_content sent back on every request when tools are used,
    // so assistant messages keep it as an extra field.
    const messages: (OpenAI.Chat.Completions.ChatCompletionMessageParam & { reasoning_content?: string })[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: vault.prompt },
    ];

    const usage = { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    try {
      await this.loopOpenAICompatible(caseId, client, cfg, tools, messages, run, usage, vault);
    } finally {
      if (usage.calls) this.store.log({ actor: "system", type: "agent.usage", caseId, data: { model: cfg.label, ...usage } });
      this.logWithheld(caseId, vault);
    }
    this.saveRun(run, cfg.label);
  }

  private async loopOpenAICompatible(
    caseId: string,
    client: OpenAI,
    cfg: ProviderConfig,
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
    messages: (OpenAI.Chat.Completions.ChatCompletionMessageParam & { reasoning_content?: string })[],
    run: RecordedRun,
    usage: { calls: number; inputTokens: number; cachedInputTokens: number; outputTokens: number },
    vault: Vault,
  ) {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (this.store.world.agent.killSwitch) break;
      const body: Record<string, unknown> = { model: cfg.model, messages, tools };
      if (cfg.provider === "deepseek") {
        body.thinking = { type: "enabled" };
        body.reasoning_effort = cfg.effort;
        body.max_tokens = 16000;
      } else {
        // OpenAI's Chat Completions rejects reasoning_effort together with function tools on gpt-5.4-mini
        // (it wants the Responses API for that), so the model's default reasoning is used here.
        body.max_completion_tokens = 16000;
      }
      const response = (await withNetworkRetry(() =>
        client.chat.completions.create(body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming),
      )) as OpenAI.Chat.Completions.ChatCompletion;
      const u = response.usage as (OpenAI.CompletionUsage & { prompt_cache_hit_tokens?: number }) | undefined;
      usage.calls += 1;
      usage.inputTokens += u?.prompt_tokens ?? 0;
      usage.cachedInputTokens += u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0;
      usage.outputTokens += u?.completion_tokens ?? 0;
      const choice = response.choices[0];
      const msg = choice.message as OpenAI.Chat.Completions.ChatCompletionMessage & { reasoning_content?: string };
      const thinking = msg.reasoning_content?.trim() ?? "";
      // the log is ours and the family reads it: real names go back in for display
      if (thinking) this.store.log({ actor: "agent", type: "agent.thinking", caseId, data: { summary: vault.unmask(thinking.slice(0, 1500)), model: cfg.label } });

      if (choice.finish_reason === "length") throw new Error("Model output was cut off (max tokens).");

      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
        ...(cfg.provider === "deepseek" && msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
      });

      const calls = (msg.tool_calls ?? []).filter(
        (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === "function",
      );
      if (calls.length === 0) {
        run.finalText = msg.content ?? "";
        if (run.finalText.trim()) this.store.log({ actor: "agent", type: "agent.summary", caseId, data: { text: vault.unmask(run.finalText.slice(0, 1500)) } });
        break;
      }
      for (const call of calls) {
        let output: string;
        try {
          // recorded as the model wrote it (tokens, no personal data); real values only for execution
          const input = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          run.steps.push({ tool: call.function.name, input, thinking: thinking || undefined });
          output = vault.mask(executeTool(call.function.name, vault.unmaskDeep(input), { store: this.store, caseId }));
        } catch {
          output = JSON.stringify({ error: "INVALID_JSON: the tool arguments were not valid JSON. Call the tool again with valid JSON." });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    }
  }

  private async runLiveAnthropic(caseId: string, triggers: Trigger[], cfg: ProviderConfig) {
    const client = new Anthropic({ apiKey: cfg.apiKey });
    const tools = anthropicToolDefs();
    const vault = this.openVault(caseId, triggers);
    const run: RecordedRun = { triggers: triggers.map((t) => ({ reason: t.reason, detail: t.detail })), steps: [] };
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: vault.prompt }];

    const usage = { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    for (let step = 0; step < MAX_STEPS; step++) {
      if (this.store.world.agent.killSwitch) break;
      const response = await client.beta.messages.create({
        model: cfg.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: cfg.effort as "low" | "medium" | "high" | "xhigh" | "max" },
        system: [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });

      usage.calls += 1;
      usage.inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
      usage.cachedInputTokens += response.usage.cache_read_input_tokens ?? 0;
      usage.outputTokens += response.usage.output_tokens;
      if (response.stop_reason === "refusal") {
        throw new Error(`Model declined (${response.stop_details?.category ?? "unknown"}).`);
      }

      const thinking = response.content
        .filter((b): b is Anthropic.Beta.BetaThinkingBlock => b.type === "thinking")
        .map((b) => b.thinking)
        .filter(Boolean)
        .join("\n");
      if (thinking) this.store.log({ actor: "agent", type: "agent.thinking", caseId, data: { summary: vault.unmask(thinking.slice(0, 1500)) } });

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason === "max_tokens") throw new Error("Model output was cut off (max_tokens).");
      if (toolUses.length === 0) {
        const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
        run.finalText = text;
        if (text.trim()) this.store.log({ actor: "agent", type: "agent.summary", caseId, data: { text: vault.unmask(text.slice(0, 1500)) } });
        break;
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        run.steps.push({ tool: tu.name, input, thinking: thinking || undefined });
        const output = vault.mask(executeTool(tu.name, vault.unmaskDeep(input), { store: this.store, caseId }));
        results.push({ type: "tool_result", tool_use_id: tu.id, content: output });
      }
      messages.push({ role: "user", content: results });
    }

    this.store.log({ actor: "system", type: "agent.usage", caseId, data: { model: cfg.label, ...usage } });
    this.logWithheld(caseId, vault);
    this.saveRun(run, cfg.label);
  }

  /** Privacy firewall for one wake-up; the masked prompt is kept for the Security Centre's "what the AI saw". */
  private openVault(caseId: string, triggers: Trigger[]): Vault & { prompt: string } {
    const vault = buildVault(this.store.world, caseId);
    const prompt = vault.mask(wakeMessage(triggers, caseSnapshot(this.store.world, caseId)));
    this.store.mutate((w) => (w.agent.lastPrompt = { at: w.now, caseId, text: prompt, withheld: vault.withheld() }));
    // recordings keep what the model saw: trigger details (e.g. the family's message) masked too
    for (const t of triggers) if (t.detail) t.detail = vault.mask(t.detail);
    return { ...vault, prompt };
  }

  private logWithheld(caseId: string, vault: Vault) {
    const withheld = vault.withheld();
    if (Object.keys(withheld).length) this.store.log({ actor: "gateway", type: "privacy.masked", caseId, data: { withheld, tokens: vault.entries.length } });
  }

  /** Where this session's recording is saved (set once a live run has been recorded). */
  recordingFile?: string;

  private saveRun(run: RecordedRun, model: string) {
    if (!this.recording) this.resetSession();
    this.recording!.model = model;
    this.recording!.runs.push(run);
    fs.mkdirSync(REC_DIR, { recursive: true });
    const file = path.join(REC_DIR, `${this.recording!.scenarioId}-${this.recording!.createdAt.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(this.recording, null, 2));
    this.recordingFile = file;
  }

  // -------------------------------------------------------------------------
  // Replay: decisions from a recorded live run, executed for real in the sandbox

  private async runReplay(caseId: string, triggers: Trigger[]) {
    const rec = this.replaySource ?? loadLatestRecording(this.store.world.scenarioId);
    this.replaySource = rec;
    if (!rec) throw new Error("No recorded live run for this scenario yet. Run it once in Live mode to record one.");
    const reasons = triggers.map((t) => t.reason).sort().join(",");
    let idx = rec.runs.findIndex((r, i) => !this.replayCursor.has(i) && r.triggers.map((t) => t.reason).sort().join(",") === reasons);
    if (idx < 0) idx = rec.runs.findIndex((_r, i) => !this.replayCursor.has(i));
    if (idx < 0) throw new Error("The recording has no more steps for this point in the scenario.");
    this.replayCursor.add(idx);
    let lastThinking = "";
    for (const step of rec.runs[idx].steps) {
      if (this.store.world.agent.killSwitch) break;
      if (step.thinking && step.thinking !== lastThinking) {
        this.store.log({ actor: "agent", type: "agent.thinking", caseId, data: { summary: buildVault(this.store.world, caseId).unmask(step.thinking.slice(0, 1500)), replayed: true } });
        lastThinking = step.thinking;
      }
      await sleep(STEP_DELAY_REPLAY);
      executeTool(step.tool, buildVault(this.store.world, caseId).unmaskDeep(step.input), { store: this.store, caseId });
    }
  }

  // -------------------------------------------------------------------------
  // Scripted: hand-written plan for development without an API key (no AI)

  private async runScripted(caseId: string, triggers: Trigger[]) {
    const script = SCRIPTS[this.store.world.scenarioId];
    if (!script) throw new Error("No scripted plan for this scenario.");
    const idx = script.findIndex((s, i) => !this.scriptedCursor.has(i) && s.when(triggers, this.store.world));
    if (idx < 0) return;
    this.scriptedCursor.add(idx);
    for (const make of script[idx].steps) {
      if (this.store.world.agent.killSwitch) break;
      const step = make(this.store.world, caseId);
      if (!step) continue;
      await sleep(STEP_DELAY_SCRIPTED);
      executeTool(step.tool, step.input, { store: this.store, caseId });
    }
  }
}

export interface ScriptedRun {
  when: (triggers: Trigger[], w: World) => boolean;
  steps: ((w: World, caseId: string) => RecordedStep | null)[];
}

function loadLatestRecording(scenarioId: string): Recording | null {
  const curated = path.join(CURATED_DIR, `${scenarioId}.json`);
  if (process.env.KINWARDEN_REPLAY_SOURCE !== "latest" && fs.existsSync(curated)) return JSON.parse(fs.readFileSync(curated, "utf8")) as Recording;
  if (!fs.existsSync(REC_DIR)) return null;
  const files = fs.readdirSync(REC_DIR).filter((f) => f.startsWith(scenarioId + "-") && f.endsWith(".json")).sort();
  for (const f of files.reverse()) {
    const rec = JSON.parse(fs.readFileSync(path.join(REC_DIR, f), "utf8")) as Recording;
    if (rec.runs.length > 0) return rec;
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A connection that drops while the response is being read ("terminated", "fetch failed", a reset socket)
 * escapes the SDK's own retries. Asking again is safe: no tool runs until a complete response has arrived.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true;
  const e = err as { message?: string; code?: string; cause?: { code?: string } } | undefined;
  return /^(terminated|fetch failed|other side closed)$/i.test(e?.message ?? "") || ["ECONNRESET", "UND_ERR_SOCKET", "ETIMEDOUT"].includes(e?.code ?? e?.cause?.code ?? "");
}

export async function withNetworkRetry<T>(call: () => Promise<T>, attempts = 3, waitMs = 2000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (err) {
      if (i >= attempts || !isTransientNetworkError(err)) throw err;
      await new Promise((r) => setTimeout(r, waitMs * i));
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API (network).";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  if (err instanceof OpenAI.AuthenticationError) return "The LLM API key was rejected.";
  if (err instanceof OpenAI.RateLimitError) return "Rate limited or out of credit at the LLM provider. Try again shortly.";
  if (err instanceof OpenAI.APIConnectionError) return "Could not reach the LLM provider (network).";
  if (err instanceof OpenAI.APIError) return `LLM API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
