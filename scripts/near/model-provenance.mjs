// Checks that a recorded NEAR AI run is what NEAR AI's attested model produced (docs/near/DECISIONS.md
// D-13). Used by scripts/near/verify-model.mjs and by src/server/agent/provenance.test.ts.
//
// For a recording it checks:
//   1. the attestation nonce is derived from the recording itself (scenario and start time);
//   2. the model's Intel TDX quote: its report data names the signing key and that nonce, debug mode
//      is off, and (online) the quote's signature chain verifies against Intel's collateral;
//   3. every model answer: the signed text is "model:sha256(request):sha256(answer bytes)" for the
//      recorded answer bytes, and the ECDSA signature recovers to the attested signing key;
//   4. every replayed tool call is a tool call, with the same arguments, in the signed answer it
//      points at.
// What it does not check: NVIDIA's GPU evidence, and the request bytes (only their hash is kept).
import crypto from "node:crypto";
import { recoverMessageAddress } from "viem";

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
export const attestationNonce = (scenarioId, createdAt) => sha256(`kinwarden:${scenarioId}:${createdAt}`);
/** "NEAR AI · deepseek-ai/…" → "deepseek-ai/…" */
export const modelId = (label) => label.replace(/^NEAR AI · /, "");

// TDX quote v4: a 48-byte header, then the TD report body; its report data is the body's last 64 bytes.
const TD_BODY = 48;
const quoteFields = (quoteHex) => {
  const q = Buffer.from(quoteHex, "hex");
  return { tdAttributes: q.subarray(TD_BODY + 120, TD_BODY + 128), reportData: q.subarray(TD_BODY + 520, TD_BODY + 584).toString("hex") };
};

/** Deep equality for JSON values (object key order does not matter). */
function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => sameJson(a[k], b[k]));
}

/**
 * @param {object} rec a recording (recordings/<scenario>.json)
 * @param {{ verifyQuote?: (quote: Buffer) => Promise<{ status: string, reportData: string, tdAttributes: Buffer }> }} [opts]
 *   verifyQuote checks the quote's signature chain (dcap-qvl, needs network); without it only the quote's
 *   contents are read
 */
export async function checkRecording(rec, opts = {}) {
  const problems = [];
  const model = modelId(rec.model);
  const att = rec.attestation;
  const out = { scenario: rec.scenarioId, model: rec.model, createdAt: rec.createdAt, quote: null, answers: 0, signed: 0, unsigned: 0, steps: 0, boundSteps: 0, problems };
  if (!rec.model.startsWith("NEAR AI · ")) problems.push(`not a NEAR AI recording (${rec.model})`);

  // 1-2. the attested signing key
  if (!att) problems.push("no attestation report in the recording");
  else {
    const nonce = attestationNonce(rec.scenarioId, rec.createdAt);
    if (att.nonce !== nonce || att.request_nonce !== nonce) problems.push("attestation nonce is not the one derived from this recording");
    if (att.model !== model) problems.push(`attestation is for ${att.model}, not ${model}`);
    let fields = quoteFields(att.intel_quote);
    if (opts.verifyQuote) {
      try {
        const v = await opts.verifyQuote(Buffer.from(att.intel_quote, "hex"));
        out.quote = v.status;
        fields = { reportData: v.reportData, tdAttributes: v.tdAttributes };
        if (v.status !== "UpToDate") problems.push(`TDX quote TCB status is ${v.status}`);
      } catch (e) {
        problems.push(`TDX quote did not verify: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (fields.reportData.slice(0, 40) !== att.signing_address.toLowerCase().replace(/^0x/, "")) problems.push("quote report data does not name the signing key");
    if (fields.reportData.slice(64) !== nonce) problems.push("quote report data does not carry the recording's nonce");
    if (fields.tdAttributes[0] & 1) problems.push("the TD runs in debug mode");
  }
  const signer = att?.signing_address.toLowerCase();

  // 3-4. every answer and every replayed tool call
  for (const [r, run] of rec.runs.entries()) {
    const signed = run.signed ?? [];
    for (const [i, s] of signed.entries()) {
      out.answers += 1;
      if (!s.signature) {
        out.unsigned += 1;
        continue;
      }
      const where = `run ${r} answer ${i}`;
      const expected = `${model}:${s.request_sha256}:${sha256(s.response_body)}`;
      if (s.signature.text !== expected) {
        problems.push(`${where}: the signed text does not match the recorded answer`);
        continue;
      }
      if (s.signature.signature_kind && s.signature.signature_kind !== "provider_tee") problems.push(`${where}: signed by the ${s.signature.signature_kind}, not the model TEE`);
      let recovered = "";
      try {
        recovered = (await recoverMessageAddress({ message: s.signature.text, signature: s.signature.signature })).toLowerCase();
      } catch {
        /* an unparsable signature recovers nothing */
      }
      if (!recovered || recovered !== s.signature.signing_address.toLowerCase()) problems.push(`${where}: the signature does not recover to its signing address`);
      else if (recovered !== signer) problems.push(`${where}: signed by ${recovered}, not the attested key`);
      else out.signed += 1;
    }
    for (const [k, step] of run.steps.entries()) {
      out.steps += 1;
      const s = step.call === undefined ? undefined : signed[step.call];
      if (!s?.signature) continue;
      let calls = [];
      try {
        calls = (JSON.parse(s.response_body).choices?.[0]?.message?.tool_calls ?? []).map((c) => ({ tool: c.function?.name, input: JSON.parse(c.function?.arguments || "{}") }));
      } catch {
        problems.push(`run ${r} step ${k}: its answer is not readable JSON`);
        continue;
      }
      if (calls.some((c) => c.tool === step.tool && sameJson(c.input, step.input))) out.boundSteps += 1;
      else problems.push(`run ${r} step ${k} (${step.tool}): not a tool call in the signed answer`);
    }
  }
  if (out.steps && out.boundSteps < out.steps) problems.push(`${out.steps - out.boundSteps} of ${out.steps} replayed steps are not backed by a signed answer`);
  out.ok = problems.length === 0;
  return out;
}

/** dcap-qvl verification of a TDX quote against Intel's collateral (fetched through Phala's PCCS by default). */
export async function dcapVerifier() {
  const qvl = await import("@phala/dcap-qvl");
  return async (quote) => {
    const result = await qvl.getCollateralAndVerify(quote);
    const d = result.report.data;
    return { status: result.status, reportData: Buffer.from(d.reportData).toString("hex"), tdAttributes: Buffer.from(d.tdAttributes) };
  };
}
