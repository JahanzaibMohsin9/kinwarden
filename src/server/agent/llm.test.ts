import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackConfig, maxTokens, NEARAI_BASE_URL, providerConfig } from "./llm";

const KEYS = ["NEARAI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "KINWARDEN_PROVIDER", "KINWARDEN_MODEL", "KINWARDEN_FALLBACK", "KINWARDEN_NEARAI_BASE_URL"];
function env(values: Record<string, string>) {
  for (const k of KEYS) vi.stubEnv(k, values[k] ?? "");
}
afterEach(() => vi.unstubAllEnvs());

describe("Live-mode model provider", () => {
  it("uses NEAR AI Cloud first when its key is set", () => {
    env({ NEARAI_API_KEY: "near-key", DEEPSEEK_API_KEY: "ds-key", OPENAI_API_KEY: "oa-key" });
    const cfg = providerConfig();
    expect(cfg).toMatchObject({ provider: "nearai", baseURL: NEARAI_BASE_URL, apiKey: "near-key", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017" });
    expect(cfg.label).toBe("NEAR AI · deepseek-ai/DeepSeek-V4.1-Flash-1017");
  });

  it("keeps the earlier order without a NEAR AI key", () => {
    env({ DEEPSEEK_API_KEY: "ds-key", OPENAI_API_KEY: "oa-key" });
    expect(providerConfig().provider).toBe("deepseek");
    env({ OPENAI_API_KEY: "oa-key" });
    expect(providerConfig().provider).toBe("openai");
  });

  it("an explicit provider and model win", () => {
    env({ NEARAI_API_KEY: "near-key", DEEPSEEK_API_KEY: "ds-key", KINWARDEN_PROVIDER: "deepseek" });
    expect(providerConfig().provider).toBe("deepseek");
    env({ NEARAI_API_KEY: "near-key", KINWARDEN_MODEL: "z-ai/glm-5.3-flash", KINWARDEN_NEARAI_BASE_URL: "https://example.test/v1" });
    expect(providerConfig()).toMatchObject({ provider: "nearai", model: "z-ai/glm-5.3-flash", baseURL: "https://example.test/v1" });
  });

  it("never falls back from NEAR AI, so a NEAR AI run is not finished by another provider", () => {
    env({ NEARAI_API_KEY: "near-key", DEEPSEEK_API_KEY: "ds-key", OPENAI_API_KEY: "oa-key" });
    expect(fallbackConfig("nearai")).toBeUndefined();
    expect(fallbackConfig("deepseek")?.provider).toBe("openai");
  });

  it("sends the token limit each API accepts", () => {
    env({ NEARAI_API_KEY: "near-key", OPENAI_API_KEY: "oa-key" });
    expect(maxTokens(providerConfig(), 800)).toEqual({ max_tokens: 800 });
    expect(maxTokens(providerConfig("openai"), 800)).toEqual({ max_completion_tokens: 800 });
  });
});
