// Checks that the recorded NEAR AI runs in recordings/ were produced by NEAR AI's attested model and
// replay exactly what it answered. No model key, wallet or NEAR key; needs `npm ci` and network access
// (Intel's quote collateral). With --offline the quote's signature chain is not checked.
//
//   node scripts/near/verify-model.mjs
//   node scripts/near/verify-model.mjs --offline
//
// See scripts/near/model-provenance.mjs for exactly what is checked and what is not.
import fs from "node:fs";
import path from "node:path";
import { checkRecording, dcapVerifier } from "./model-provenance.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const offline = process.argv.includes("--offline");
const verifyQuote = offline ? undefined : await dcapVerifier();
const files = fs.readdirSync(path.join(ROOT, "recordings")).filter((f) => f.endsWith(".json")).sort();

let failed = 0;
for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, "recordings", f), "utf8"));
  const r = await checkRecording(rec, { verifyQuote });
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${f}  (${r.model}, recorded ${r.createdAt.slice(0, 10)})`);
  console.log(`      TDX quote: ${r.quote ?? (offline ? "contents read, chain not checked (--offline)" : "not verified")}; ${r.signed} of ${r.answers} answers signed by the attested key${r.unsigned ? ` (${r.unsigned} without a signature)` : ""}; ${r.boundSteps} of ${r.steps} replayed tool calls are in a signed answer`);
  for (const p of r.problems.slice(0, 8)) console.log(`      - ${p}`);
}
console.log();
console.log(failed ? `${failed} of ${files.length} recordings failed.` : `All ${files.length} recordings check out.`);
console.log("Not checked: NVIDIA's GPU evidence, and the request bytes (only their hash is recorded).");
process.exit(failed ? 1 : 0);
