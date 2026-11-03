import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Kinwarden approval commitment v1 (docs/near/STATE_AND_ENCODING.md §6): SHA-256 over the Borsh
 * encoding of these fields, in this order. Written from the Borsh rules (strings: u32 little-endian
 * length + UTF-8; integers: little-endian), independently of the Rust contract, and checked against
 * the shared vectors in contracts/near/vault/test-vectors. Used by the browser and the server.
 */
export const COMMITMENT_DOMAIN_V1 = "kinwarden.approval.v1";

export interface ApprovalCommitmentV1 {
  domain: string;
  network: string;
  vault: string;
  case_id: string;
  invoice_id: string;
  proposal_id: bigint;
  attempt: number;
  token: string;
  recipient: string;
  amount: bigint;
  expires_at: bigint;
  policy_version: bigint;
  payee_version: bigint;
}

type Kind = "string" | "u32" | "u64" | "u128";
const FIELDS: [keyof ApprovalCommitmentV1, Kind][] = [
  ["domain", "string"],
  ["network", "string"],
  ["vault", "string"],
  ["case_id", "string"],
  ["invoice_id", "string"],
  ["proposal_id", "u64"],
  ["attempt", "u32"],
  ["token", "string"],
  ["recipient", "string"],
  ["amount", "u128"],
  ["expires_at", "u64"],
  ["policy_version", "u64"],
  ["payee_version", "u64"],
];
const WIDTH = { u32: 4, u64: 8, u128: 16 } as const;

function littleEndian(value: bigint, bytes: number): Uint8Array {
  if (value < BigInt(0) || value >= BigInt(1) << BigInt(bytes * 8)) throw new RangeError(`value out of range for ${bytes * 8} bits`);
  const out = new Uint8Array(bytes);
  let v = value;
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

export function encodeCommitment(c: ApprovalCommitmentV1): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, kind] of FIELDS) {
    const value = c[name];
    if (kind === "string") {
      const data = new TextEncoder().encode(value as string);
      parts.push(littleEndian(BigInt(data.length), 4), data);
    } else {
      parts.push(littleEndian(BigInt(value as bigint | number), WIDTH[kind]));
    }
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function commitmentHash(c: ApprovalCommitmentV1): string {
  return bytesToHex(sha256(encodeCommitment(c)));
}

/** Vault proposal as returned by the contract's JSON views (u64/u128 as strings). */
export interface VaultProposal {
  proposal_id: string;
  case_id: string;
  invoice_id: string;
  request_id: string;
  attempt: number;
  payee_id: string;
  recipient: string;
  token: string;
  amount: string;
  purpose_group: "Hospital" | "Tuition";
  ttl_seconds: number;
  created_at: string;
  expires_at: string;
  policy_version: number;
  payee_version: number;
  status: "PendingApproval" | "Submitted" | "Settled" | "Failed" | "Rejected" | "Expired" | "Invalidated";
  status_reason: string | null;
  updated_at: string;
}

/** The commitment for a stored proposal, as the contract builds it. */
export function commitmentForProposal(p: VaultProposal, network: string, vault: string): ApprovalCommitmentV1 {
  return {
    domain: COMMITMENT_DOMAIN_V1,
    network,
    vault,
    case_id: p.case_id,
    invoice_id: p.invoice_id,
    proposal_id: BigInt(p.proposal_id),
    attempt: p.attempt,
    token: p.token,
    recipient: p.recipient,
    amount: BigInt(p.amount),
    expires_at: BigInt(p.expires_at),
    policy_version: BigInt(p.policy_version),
    payee_version: BigInt(p.payee_version),
  };
}
