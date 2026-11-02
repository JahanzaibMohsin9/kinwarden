"use client";

import { post } from "./client";

// Browser side of passkey approvals (WebAuthn). The server builds every challenge;
// for approvals it commits to the payment, so the signature covers that payment only.

const toB64u = (buf: ArrayBuffer) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64u = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export function passkeysSupported() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;
}

export async function registerPasskey() {
  const opts = (await fetch("/api/passkey/register").then((r) => r.json())) as {
    challenge: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    excludeCredentials: string[];
  };
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: fromB64u(opts.challenge),
      rp: opts.rp,
      user: { ...opts.user, id: fromB64u(opts.user.id) },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -8 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      excludeCredentials: opts.excludeCredentials.map((id) => ({ type: "public-key", id: fromB64u(id) })),
      attestation: "none",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was created.");
  const res = cred.response as AuthenticatorAttestationResponse;
  const publicKey = res.getPublicKey?.();
  if (!publicKey) throw new Error("This browser can't share the passkey's public key.");
  const ua = navigator.userAgent;
  const label = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android phone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows device" : "This device";
  return post("/api/passkey/register", { credentialId: cred.id, publicKey: toB64u(publicKey), alg: res.getPublicKeyAlgorithm(), clientDataJSON: toB64u(res.clientDataJSON), label });
}

export async function approveWithPasskey(approvalId: string, as?: string) {
  const { challenge, allowCredentials } = (await post(`/api/approvals/${approvalId}/challenge`, {})) as { challenge: string; allowCredentials: string[] };
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge),
      allowCredentials: allowCredentials.map((id) => ({ type: "public-key", id: fromB64u(id) })),
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Approval was cancelled.");
  const res = cred.response as AuthenticatorAssertionResponse;
  return post(`/api/approvals/${approvalId}`, {
    decision: "approved",
    method: "passkey",
    as,
    assertion: { credentialId: cred.id, clientDataJSON: toB64u(res.clientDataJSON), authenticatorData: toB64u(res.authenticatorData), signature: toB64u(res.signature) },
  });
}
