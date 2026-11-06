// Checks that the recorded NEAR AI runs in recordings/ were produced by NEAR AI's attested model and
// replay exactly what it answered. No model key, wallet or NEAR key; needs `npm ci` and network access
// (Intel's quote collateral). With --offline the quote's signature chain is not checked.
//
//   node scripts/near/verify-model.mjs
//   node scripts/near/verify-model.mjs --offline
//   node scripts/near/verify-model.mjs docs/near/evidence/2026-11-06-live   (other recordings: files or folders)
//
// See scripts/near/model-provenance.mjs for exactly what is checked and what is not.
import fs from "node:fs";
import path from "node:path";
import { checkRecording, dcapVerifier } from "./model-provenance.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const offline = process.argv.includes("--offline");
const verifyQuote = offline ? undefined : await dcapVerifier();
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = (targets.length ? targets.map((t) => path.resolve(t)) : [path.join(ROOT, "recordings")])
  .flatMap((t) => (fs.statSync(t).isDirectory() ? fs.readdirSync(t).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(t, f)) : [t]));

let failed = 0;
for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(f, "utf8"));
  const r = await checkRecording(rec, { verifyQuote });
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${path.relative(ROOT, f).replaceAll("\\", "/")}  (${r.model}, recorded ${r.createdAt.slice(0, 10)})`);
  console.log(`      TDX quote: ${r.quote ?? (offline ? "contents read, chain not checked (--offline)" : "not verified")}; ${r.signed} of ${r.answers} answers signed by the attested key${r.unsigned ? ` (${r.unsigned} without a signature)` : ""}; ${r.boundSteps} of ${r.steps} replayed tool calls are in a signed answer`);
  for (const p of r.problems.slice(0, 8)) console.log(`      - ${p}`);
}
console.log();
console.log(failed ? `${failed} of ${files.length} recordings failed.` : `All ${files.length} recordings check out.`);
console.log("Not checked: NVIDIA's GPU evidence, and the request bytes (only their hash is recorded).");
process.exit(failed ? 1 : 0);
