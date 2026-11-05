// Provenance of live NEAR AI decisions (docs/near/DECISIONS.md D-13). For every chat completion the
// runner keeps the exact response bytes and the SHA-256 of the exact request bytes, and asks NEAR AI
// for the response signature its model TEE made over "model:sha256(request):sha256(response)". Once per
// recording it also saves the model's attestation report (an Intel TDX quote whose report data names
// the signing key and our nonce). scripts/near/verify-model.mjs checks all of it without a model key.
import crypto from "node:crypto";

export interface ResponseSignature {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: string;
}

/** One model answer, as signed by NEAR AI. Recorded steps point at it with `call`. */
export interface SignedResponse {
  chat_id: string;
  /** SHA-256 of the exact request bytes (the request itself is large and is not kept) */
  request_sha256: string;
  /** the exact response bytes, as received */
  response_body: string;
  signature?: ResponseSignature;
  /** why no signature could be fetched; the run is kept, the answer just is not provable */
  unavailable?: string;
}

/** The model's attestation report, fetched once per recording with a nonce derived from the recording. */
export interface ModelAttestation {
  model: string;
  provider: string;
  fetched_at: string;
  nonce: string;
  signing_address: string;
  signing_algo: string;
  intel_quote: string;
  request_nonce: string;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** The nonce for a recording's attestation: anyone can recompute it from the recording itself. */
export function attestationNonce(scenarioId: string, createdAt: string): string {
  return sha256(`kinwarden:${scenarioId}:${createdAt}`);
}

/**
 * A fetch for the OpenAI client that keeps the exact bytes of each chat completion exchange, keyed by
 * the completion id, so they can be hashed exactly as NEAR AI signed them.
 */
export function capturingFetch() {
  const exchanges = new Map<string, { request: string; response: string }>();
  const wrapped: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/chat/completions") && typeof init?.body === "string" && res.ok) {
      const response = await res.clone().text();
      try {
        const id = (JSON.parse(response) as { id?: string }).id;
        if (id) exchanges.set(id, { request: init.body, response });
      } catch {
        /* not JSON: nothing to sign */
      }
    }
    return res;
  };
  return {
    fetch: wrapped,
    /** the exchange for a completion id, removed once taken */
    take(id: string) {
      const ex = exchanges.get(id) ?? null;
      exchanges.delete(id);
      return ex ? { request_sha256: sha256(ex.request), response_body: ex.response } : null;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** NEAR AI's signature for a completion. 404 is retried briefly, as the docs advise. */
export async function fetchSignature(baseURL: string, apiKey: string, model: string, chatId: string): Promise<{ signature?: ResponseSignature; unavailable?: string }> {
  let last = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const r = await fetch(`${baseURL}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`, { headers: { authorization: `Bearer ${apiKey}` } });
      const j = (await r.json().catch(() => ({}))) as Partial<ResponseSignature> & { error_code?: string; message?: string; error?: { message?: string } };
      if (r.ok && j.signature && j.text && j.signing_address) {
        return { signature: { text: j.text, signature: j.signature, signing_address: j.signing_address, signing_algo: j.signing_algo ?? "ecdsa", signature_kind: j.signature_kind } };
      }
      last = `HTTP ${r.status} ${j.error_code ?? j.error?.message ?? j.message ?? ""}`.trim();
      if (r.status !== 404 && r.ok === false) break;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await sleep(1000 * (attempt + 1));
  }
  return { unavailable: last || "no signature" };
}

/** The model's attestation report for a nonce, reduced to what verification needs. */
export async function fetchAttestation(baseURL: string, apiKey: string, model: string, nonce: string): Promise<ModelAttestation | { unavailable: string }> {
  try {
    const r = await fetch(`${baseURL}/attestation/report?model=${encodeURIComponent(model)}&provider=near&signing_algo=ecdsa&nonce=${nonce}`, {
      headers: { authorization: `Bearer ${apiKey}`, "x-no-aliasing": "true" },
    });
    const j = (await r.json()) as { model_attestations?: { signing_address: string; signing_algo: string; intel_quote: string; request_nonce: string }[] };
    const m = j.model_attestations?.[0];
    if (!r.ok || !m) return { unavailable: `HTTP ${r.status}: no model attestation` };
    return { model, provider: "near", fetched_at: new Date().toISOString(), nonce, signing_address: m.signing_address, signing_algo: m.signing_algo, intel_quote: m.intel_quote, request_nonce: m.request_nonce };
  } catch (e) {
    return { unavailable: e instanceof Error ? e.message : String(e) };
  }
}
