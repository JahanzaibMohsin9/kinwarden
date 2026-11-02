// The recording server: the production build on port 3300 with a fresh data folder, Replay pacing for
// the camera and on-chain anchoring on (keys come from .env.local and are never printed).
//   npm run build && node scripts/video/serve.mjs
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "video", "out", "data");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
const child = spawn(process.execPath, ["server.js"], {
  cwd: path.join(ROOT, ".next", "standalone"),
  env: { ...process.env, ...env, PORT: "3300", HOSTNAME: "127.0.0.1", KINWARDEN_DATA_DIR: DATA, KINWARDEN_STEP_DELAY_MS: "600", KINWARDEN_DEFAULT_MODE: "replay", NODE_ENV: "production" },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
