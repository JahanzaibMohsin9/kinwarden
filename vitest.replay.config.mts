import { defineConfig } from "vitest/config";
import path from "node:path";

// Offline evaluation: replays the curated live runs in recordings/. No API keys are loaded; used by `npm run eval:replay` and CI.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.replay.ts"],
    testTimeout: 120000,
    setupFiles: ["./vitest.setup.ts"],
    env: { KINWARDEN_STEP_DELAY_MS: "0" },
  },
});
