import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { World } from "@/domain/types";

// Passkey (WebAuthn) approvals without a third-party library: the browser's
// authenticator signs a challenge that is derived from the exact payment being
// approved, so a signature can't be replayed for a different amount or account.
// Attestation is "none" (normal for passkeys); we check origin, RP ID, user
// presence + verification, the challenge, and the signature.

const DATA_DIR = process.env.KINWARDEN_DATA_DIR || path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "passkeys.json");
const CHALLENGE_TTL_MS = 5 * 60_000;

export interface StoredPasskey {
  id: string; // credential id, base64url
  publicKey: string; // SPKI DER, base64url
  alg: number; // COSE: -7 ES256, -257 RS256, -8 EdDSA
  label: string;
  createdAt: string;
  lastUsedAt?: string;
}

const g = globalThis as unknown as { __kinwardenChallenges?: Map<string, { value: string; nonce?: string; expires: number }> };
const challenges = (g.__kinwardenChallenges ??= new Map());

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest();

export function listPasskeys(): StoredPasskey[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as StoredPasskey[];
  } catch {
    return [];
  }
}

function savePasskeys(keys: StoredPasskey[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(keys, null, 2));
}

export function removePasskeys() {
  savePasskeys([]);
}

/** The RP ID is the page's host name (passkeys are bound to it). */
export function rpIdFrom(origin: string) {
  return new URL(origin).hostname;
}

// ---------------------------------------------------------------------------
// Registration

export function registrationOptions(origin: string, scope = "default") {
  const challenge = b64u(crypto.randomBytes(32));
  challenges.set(`${scope}:register`, { value: challenge, expires: Date.now() + CHALLENGE_TTL_MS });
  return {
    challenge,
    rp: { name: "Kinwarden", id: rpIdFrom(origin) },
    user: { id: b64u(sha256("kinwarden-family").subarray(0, 16)), name: "family", displayName: "Kinwarden family approver" },
    excludeCredentials: listPasskeys().map((k) => k.id),
  };
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

function readClientData(b64: string): ClientData {
  return JSON.parse(unb64u(b64).toString("utf8")) as ClientData;
}

export function register(body: { credentialId: string; publicKey: string; alg: number; clientDataJSON: string; label?: string }, origin: string, scope = "default"): StoredPasskey {
  const issued = challenges.get(`${scope}:register`);
  challenges.delete(`${scope}:register`);
  const cd = readClientData(body.clientDataJSON);
  if (!issued || issued.expires < Date.now()) throw new Error("The registration request expired. Try again.");
  if (cd.type !== "webauthn.create" || cd.challenge !== issued.value) throw new Error("Registration challenge mismatch.");
  if (cd.origin !== origin) throw new Error(`Passkey was created for ${cd.origin}, not ${origin}.`);
  if (![-7, -257, -8].includes(body.alg)) throw new Error(`Unsupported key algorithm ${body.alg}.`);
  crypto.createPublicKey({ key: unb64u(body.publicKey), format: "der", type: "spki" }); // throws if malformed
  const key: StoredPasskey = { id: body.credentialId, publicKey: body.publicKey, alg: body.alg, label: (body.label ?? "This device").slice(0, 60), createdAt: new Date().toISOString() };
  savePasskeys([...listPasskeys().filter((k) => k.id !== key.id), key]);
  return key;
}

// ---------------------------------------------------------------------------
// Approval: the challenge commits to the payment

function paymentDigest(w: World, approvalId: string, nonce: string) {
  const a = w.approvals[approvalId];
  if (!a) throw new Error("No such approval.");
  const p = w.payments[a.paymentId];
  const canonical = JSON.stringify({
    approvalId,
    paymentId: p.id,
    amount: p.amount,
    currency: p.currency,
    route: p.route,
    payer: p.payerId,
    beneficiary: [p.beneficiary.accountName, p.beneficiary.accountNumber, p.beneficiary.swift],
    reference: p.reference,
    nonce,
  });
  return b64u(sha256(canonical));
}

export function approvalChallenge(w: World, approvalId: string, scope = "default") {
  const nonce = b64u(crypto.randomBytes(16));
  const value = paymentDigest(w, approvalId, nonce);
  challenges.set(`${scope}:approval:${approvalId}`, { value, nonce, expires: Date.now() + CHALLENGE_TTL_MS });
  return { challenge: value, allowCredentials: listPasskeys().map((k) => k.id) };
}

export interface Assertion {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/** Verifies the assertion for this approval; returns evidence for the activity log. */
export function verifyApproval(w: World, approvalId: string, as: Assertion, origin: string, scope = "default") {
  const issued = challenges.get(`${scope}:approval:${approvalId}`);
  challenges.delete(`${scope}:approval:${approvalId}`);
  if (!issued || issued.expires < Date.now()) throw new Error("The approval request expired. Try again.");
  // recomputed from the payment as it is now: if anything changed since the challenge, this fails
  const expected = paymentDigest(w, approvalId, issued.nonce!);
  const cd = readClientData(as.clientDataJSON);
  if (cd.type !== "webauthn.get") throw new Error("Not a passkey assertion.");
  if (cd.challenge !== issued.value || cd.challenge !== expected) throw new Error("The signed approval doesn't match this payment.");
  if (cd.origin !== origin) throw new Error("Passkey used from a different site.");
  const key = listPasskeys().find((k) => k.id === as.credentialId);
  if (!key) throw new Error("Unknown passkey.");
  const auth = unb64u(as.authenticatorData);
  if (!auth.subarray(0, 32).equals(sha256(rpIdFrom(origin)))) throw new Error("Passkey belongs to a different site.");
  const flags = auth[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw new Error("The passkey needs your fingerprint, face or PIN.");
  const signed = Buffer.concat([auth, sha256(unb64u(as.clientDataJSON))]);
  const pub = crypto.createPublicKey({ key: unb64u(key.publicKey), format: "der", type: "spki" });
  const sig = unb64u(as.signature);
  const ok = key.alg === -8 ? crypto.verify(null, signed, pub, sig) : crypto.verify("sha256", signed, key.alg === -7 ? { key: pub, dsaEncoding: "der" } : pub, sig);
  if (!ok) throw new Error("Passkey signature is invalid.");
  savePasskeys(listPasskeys().map((k) => (k.id === key.id ? { ...k, lastUsedAt: new Date().toISOString() } : k)));
  return { credentialId: key.id.slice(0, 12) + "…", device: key.label, challenge: issued.value, userVerified: true };
}
