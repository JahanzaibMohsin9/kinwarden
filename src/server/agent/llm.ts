// Which LLM provider runs the agent in Live mode.
// NEAR AI Cloud, DeepSeek and OpenAI share one OpenAI-compatible code path; Anthropic keeps its own.

export type Provider = "nearai" | "deepseek" | "openai" | "anthropic";
const PROVIDERS: Provider[] = ["nearai", "deepseek", "openai", "anthropic"];

/** NEAR AI Cloud's OpenAI-compatible endpoint (docs/near/DECISIONS.md D-12). */
export const NEARAI_BASE_URL = "https://cloud-api.near.ai/v1";

export interface ProviderConfig {
  provider: Provider;
  model: string;
  baseURL?: string;
  apiKey?: string;
  /** effort / reasoning level in the provider's own vocabulary */
  effort: string;
  label: string;
}

const DEFAULT_MODEL: Record<Provider, string> = {
  // NEAR AI's own deployment, which NEAR AI lists as served from its TEE infrastructure (Kinwarden does not verify attestation)
  nearai: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  deepseek: "deepseek-v4-pro",
  openai: "gpt-5.4-mini",
  anthropic: "claude-opus-5-5",
};
const LABEL: Record<Provider, string> = { nearai: "NEAR AI", deepseek: "DeepSeek", openai: "OpenAI", anthropic: "Claude" };

function keyFor(p: Provider) {
  if (p === "nearai") return process.env.NEARAI_API_KEY;
  if (p === "deepseek") return process.env.DEEPSEEK_API_KEY;
  if (p === "openai") return process.env.OPENAI_API_KEY;
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
}

/** Explicit KINWARDEN_PROVIDER wins; otherwise the first provider with a key: NEAR AI, DeepSeek, OpenAI, Anthropic. */
export function providerConfig(override?: Provider): ProviderConfig {
  const explicit = (override ?? process.env.KINWARDEN_PROVIDER) as Provider | undefined;
  const provider: Provider = explicit && PROVIDERS.includes(explicit) ? explicit : (PROVIDERS.find((p) => keyFor(p)) ?? "anthropic");
  const model = (!override && process.env.KINWARDEN_MODEL) || DEFAULT_MODEL[provider];
  const effortEnv = process.env.KINWARDEN_EFFORT;
  // DeepSeek understands low/high/max; OpenAI low/medium/high; Anthropic low..max; NEAR AI uses each model's default
  const effort =
    provider === "deepseek" ? (effortEnv === "low" || effortEnv === "max" ? effortEnv : "high") : provider === "openai" ? (effortEnv === "low" || effortEnv === "high" ? effortEnv : "medium") : effortEnv || "medium";
  return {
    provider,
    model,
    baseURL: provider === "nearai" ? process.env.KINWARDEN_NEARAI_BASE_URL || NEARAI_BASE_URL : provider === "deepseek" ? "https://api.deepseek.com" : undefined,
    apiKey: keyFor(provider),
    effort,
    label: `${LABEL[provider]} · ${model}`,
  };
}

export function hasProviderKey(): boolean {
  return Boolean(providerConfig().apiKey);
}

/**
 * The fallback provider to try when the primary one fails (DeepSeek ↔ OpenAI). NEAR AI has none, so a run
 * labelled NEAR AI is never silently finished by another provider.
 */
export function fallbackConfig(primary: Provider): ProviderConfig | undefined {
  // KINWARDEN_FALLBACK=none: fail instead of switching provider (e.g. to keep OpenAI credits untouched)
  if (process.env.KINWARDEN_FALLBACK === "none") return undefined;
  const order: Provider[] = primary === "deepseek" ? ["openai"] : primary === "openai" ? ["deepseek"] : [];
  for (const p of order) if (keyFor(p)) return providerConfig(p);
  return undefined;
}

/** The output-token limit in the parameter each OpenAI-compatible provider accepts. */
export function maxTokens(cfg: ProviderConfig, n: number): { max_tokens: number } | { max_completion_tokens: number } {
  return cfg.provider === "openai" ? { max_completion_tokens: n } : { max_tokens: n };
}
