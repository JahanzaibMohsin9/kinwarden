import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "./store";
import { seedScenario } from "./scenarios";
import { issueInvoice } from "./sim/factory";
import { executeTool } from "./agent/tools";
import { INSTITUTIONS } from "@/domain/institutions";
import { approvalChallenge, register, registrationOptions, removePasskeys, verifyApproval } from "./passkey";

// A software authenticator: what a phone's secure enclave does, with a P-256 key in memory.
const ORIGIN = "https://kinwarden.test";
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest();

function authenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const id = b64u(crypto.randomBytes(16));
  const authData = (flags: number, rpId = "kinwarden.test") => Buffer.concat([sha(rpId), Buffer.from([flags]), Buffer.from([0, 0, 0, 1])]);
  return {
    register() {
      const { challenge } = registrationOptions(ORIGIN);
      const clientDataJSON = b64u(JSON.stringify({ type: "webauthn.create", challenge, origin: ORIGIN }));
      return register({ credentialId: id, publicKey: b64u(publicKey.export({ format: "der", type: "spki" })), alg: -7, clientDataJSON }, ORIGIN);
    },
    sign(challenge: string, opts: { flags?: number; origin?: string; rpId?: string } = {}) {
      const cd = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: opts.origin ?? ORIGIN }));
      const ad = authData(opts.flags ?? 0x05, opts.rpId);
      const signature = crypto.sign("sha256", Buffer.concat([ad, sha(cd)]), privateKey);
      return { credentialId: id, clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(signature) };
    },
  };
}

let store: Store;
let approvalId: string;

beforeEach(() => {
  removePasskeys();
  store = new Store();
  store.reset(seedScenario("th-medical"));
  const inv = issueInvoice(store, { caseId: "case_th", institutionId: "srh", kind: "deposit_request", title: "Deposit", patientName: "Mr. Tariq Mahmood", patientRef: "HN 66-014382", lineItems: [{ description: "Deposit", amount: 160000 }], dueInHours: 20 });
  const b = INSTITUTIONS.srh.bank;
  const r = JSON.parse(
    executeTool(
      "propose_payment",
      { invoice_id: inv.id, route: "card_payment", amount: 160000, payer_id: "p_tariq", reference: "HN 66-014382", beneficiary: { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName }, rationale: "card is instant", narration: "test" },
      { store, caseId: "case_th" },
    ),
  );
  approvalId = r.approval_id;
});

describe("passkey approvals", () => {
  it("accepts a fingerprint-verified signature over this exact payment", () => {
    const dev = authenticator();
    dev.register();
    const { challenge } = approvalChallenge(store.world, approvalId);
    const ev = verifyApproval(store.world, approvalId, dev.sign(challenge), ORIGIN);
    expect(ev.userVerified).toBe(true);
  });

  it("rejects the signature if the payment changed after the challenge (amount swap)", () => {
    const dev = authenticator();
    dev.register();
    const { challenge } = approvalChallenge(store.world, approvalId);
    const pid = store.world.approvals[approvalId].paymentId;
    store.world.payments[pid].amount = 1600000;
    expect(() => verifyApproval(store.world, approvalId, dev.sign(challenge), ORIGIN)).toThrow(/doesn't match this payment/);
  });

  it("rejects a replayed signature (challenges are single use)", () => {
    const dev = authenticator();
    dev.register();
    const { challenge } = approvalChallenge(store.world, approvalId);
    const signed = dev.sign(challenge);
    verifyApproval(store.world, approvalId, signed, ORIGIN);
    expect(() => verifyApproval(store.world, approvalId, signed, ORIGIN)).toThrow(/expired/);
  });

  it("rejects a passkey without user verification, from another site, or with a forged signature", () => {
    const dev = authenticator();
    dev.register();
    let c = approvalChallenge(store.world, approvalId).challenge;
    expect(() => verifyApproval(store.world, approvalId, dev.sign(c, { flags: 0x01 }), ORIGIN)).toThrow(/fingerprint/);
    c = approvalChallenge(store.world, approvalId).challenge;
    expect(() => verifyApproval(store.world, approvalId, dev.sign(c, { origin: "https://kinwarden-login.com" }), ORIGIN)).toThrow(/different site/);
    c = approvalChallenge(store.world, approvalId).challenge;
    const other = authenticator();
    expect(() => verifyApproval(store.world, approvalId, { ...other.sign(c), credentialId: dev.sign(c).credentialId }, ORIGIN)).toThrow(/invalid/);
  });

  it("rejects an unknown passkey", () => {
    const { challenge } = approvalChallenge(store.world, approvalId);
    expect(() => verifyApproval(store.world, approvalId, authenticator().sign(challenge), ORIGIN)).toThrow(/Unknown passkey/);
  });
});
