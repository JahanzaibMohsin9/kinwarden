import { defineConfig } from "vitest/config";
import path from "node:path";

// NEAR end-to-end tests against a local sandbox node (Linux x86_64 with glibc >= 2.39, or macOS ARM64).
// Needs the contracts built first (contracts/near/README.md). No wallet, testnet account or API key.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.sandbox.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
    env: { KINWARDEN_STEP_DELAY_MS: "0" },
  },
});
