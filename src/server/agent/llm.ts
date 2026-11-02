// Which LLM provider runs the agent in Live mode.
// DeepSeek and OpenAI share one OpenAI-compatible code path; Anthropic keeps its own.

export type Provider = "deepseek" | "openai" | "anthropic";

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
  deepseek: "deepseek-v4-pro",
  openai: "gpt-5.4-mini",
  anthropic: "claude-opus-5-5",
};

function keyFor(p: Provider) {
  if (p === "deepseek") return process.env.DEEPSEEK_API_KEY;
  if (p === "openai") return process.env.OPENAI_API_KEY;
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
}

/** Explicit KINWARDEN_PROVIDER wins; otherwise the first provider with a key: DeepSeek, OpenAI, Anthropic. */
export function providerConfig(override?: Provider): ProviderConfig {
  const explicit = (override ?? process.env.KINWARDEN_PROVIDER) as Provider | undefined;
  const provider: Provider =
    explicit && ["deepseek", "openai", "anthropic"].includes(explicit)
      ? explicit
      : keyFor("deepseek")
        ? "deepseek"
        : keyFor("openai")
          ? "openai"
          : "anthropic";
  const model = (!override && process.env.KINWARDEN_MODEL) || DEFAULT_MODEL[provider];
  const effortEnv = process.env.KINWARDEN_EFFORT;
  // DeepSeek understands low/high/max; OpenAI low/medium/high; Anthropic low..max
  const effort =
    provider === "deepseek" ? (effortEnv === "low" || effortEnv === "max" ? effortEnv : "high") : provider === "openai" ? (effortEnv === "low" || effortEnv === "high" ? effortEnv : "medium") : effortEnv || "medium";
  return {
    provider,
    model,
    baseURL: provider === "deepseek" ? "https://api.deepseek.com" : undefined,
    apiKey: keyFor(provider),
    effort,
    label: `${provider === "deepseek" ? "DeepSeek" : provider === "openai" ? "OpenAI" : "Claude"} · ${model}`,
  };
}

export function hasProviderKey(): boolean {
  return Boolean(providerConfig().apiKey);
}

/** The fallback provider to try when the primary one fails (DeepSeek ↔ OpenAI). */
export function fallbackConfig(primary: Provider): ProviderConfig | undefined {
  // KINWARDEN_FALLBACK=none: fail instead of switching provider (e.g. to keep OpenAI credits untouched)
  if (process.env.KINWARDEN_FALLBACK === "none") return undefined;
  const order: Provider[] = primary === "deepseek" ? ["openai"] : primary === "openai" ? ["deepseek"] : [];
  for (const p of order) if (keyFor(p)) return providerConfig(p);
  return undefined;
}
