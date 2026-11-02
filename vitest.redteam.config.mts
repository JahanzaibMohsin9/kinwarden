import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

// API keys from .env.local (Next's own loader skips that file under NODE_ENV=test); used only by `npm run redteam:llm`.
const envFile = path.resolve(import.meta.dirname, ".env.local");
const keys: Record<string, string> = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) keys[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.redteam.ts"],
    testTimeout: 60 * 60 * 1000,
    env: { ...keys, KINWARDEN_STEP_DELAY_MS: "0", KINWARDEN_DATA_DIR: path.resolve(import.meta.dirname, ".data-redteam") },
  },
});
