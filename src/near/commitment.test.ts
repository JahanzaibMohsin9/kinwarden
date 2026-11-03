import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitmentHash, encodeCommitment, type ApprovalCommitmentV1 } from "./commitment";

// The same vectors the Rust contract is tested against, produced by an independent Python encoder.
const doc = JSON.parse(readFileSync(join(process.cwd(), "contracts/near/vault/test-vectors/approval_commitment_v1.json"), "utf8")) as {
  vectors: { name: string; input: Record<string, string>; borsh_hex: string; sha256_hex: string }[];
};

function commitment(input: Record<string, string>): ApprovalCommitmentV1 {
  return {
    domain: input.domain,
    network: input.network,
    vault: input.vault,
    case_id: input.case_id,
    invoice_id: input.invoice_id,
    proposal_id: BigInt(input.proposal_id),
    attempt: Number(input.attempt),
    token: input.token,
    recipient: input.recipient,
    amount: BigInt(input.amount),
    expires_at: BigInt(input.expires_at),
    policy_version: BigInt(input.policy_version),
    payee_version: BigInt(input.payee_version),
  };
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("approval commitment v1", () => {
  it("has a base vector plus one per field", () => {
    expect(doc.vectors.length).toBeGreaterThanOrEqual(14);
  });

  it.each(doc.vectors.map((v) => [v.name, v] as const))("matches the shared vector %s", (_name, v) => {
    const c = commitment(v.input);
    expect(hex(encodeCommitment(c))).toBe(v.borsh_hex);
    expect(commitmentHash(c)).toBe(v.sha256_hex);
  });

  it("refuses integers outside their width", () => {
    const c = commitment(doc.vectors[0].input);
    expect(() => encodeCommitment({ ...c, attempt: 2 ** 32 })).toThrow(RangeError);
    expect(() => encodeCommitment({ ...c, amount: BigInt(-1) })).toThrow(RangeError);
  });
});
