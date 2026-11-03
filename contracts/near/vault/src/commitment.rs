//! Approval commitment, version 1 (docs/near/STATE_AND_ENCODING.md §6).
//! SHA-256 over the Borsh encoding of the fields below, in this order. The
//! vault builds it from stored state; G2's `approve_payment` compares it with
//! the hash the family's wallet signed.

use near_sdk::borsh::{self, BorshSerialize};
use near_sdk::{env, AccountId};

pub const DOMAIN_V1: &str = "kinwarden.approval.v1";

#[derive(BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct ApprovalCommitmentV1 {
    pub domain: String,
    pub network: String,
    pub vault: AccountId,
    pub case_id: String,
    pub invoice_id: String,
    pub proposal_id: u64,
    pub attempt: u32,
    pub token: AccountId,
    pub recipient: AccountId,
    pub amount: u128,
    pub expires_at: u64,
    pub policy_version: u64,
    pub payee_version: u64,
}

impl ApprovalCommitmentV1 {
    pub fn encode(&self) -> Vec<u8> {
        borsh::to_vec(self).expect("borsh encoding of the commitment cannot fail")
    }

    pub fn hash_hex(&self) -> String {
        to_hex(&env::sha256(self.encode()))
    }
}

pub fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// Vectors produced by an independent Python encoder
    /// (test-vectors/approval_commitment_v1.py), not by this code.
    const VECTORS: &str = include_str!("../test-vectors/approval_commitment_v1.json");

    fn commitment(v: &Value) -> ApprovalCommitmentV1 {
        let s = |k: &str| v[k].as_str().unwrap().to_string();
        ApprovalCommitmentV1 {
            domain: s("domain"),
            network: s("network"),
            vault: s("vault").parse().unwrap(),
            case_id: s("case_id"),
            invoice_id: s("invoice_id"),
            proposal_id: s("proposal_id").parse().unwrap(),
            attempt: s("attempt").parse().unwrap(),
            token: s("token").parse().unwrap(),
            recipient: s("recipient").parse().unwrap(),
            amount: s("amount").parse().unwrap(),
            expires_at: s("expires_at").parse().unwrap(),
            policy_version: s("policy_version").parse().unwrap(),
            payee_version: s("payee_version").parse().unwrap(),
        }
    }

    #[test]
    fn matches_independent_vectors() {
        let doc: Value = serde_json::from_str(VECTORS).unwrap();
        let vectors = doc["vectors"].as_array().unwrap();
        assert!(vectors.len() >= 14, "base vector plus one per field");
        for v in vectors {
            let c = commitment(&v["input"]);
            assert_eq!(
                to_hex(&c.encode()),
                v["borsh_hex"].as_str().unwrap(),
                "{}",
                v["name"]
            );
            assert_eq!(
                c.hash_hex(),
                v["sha256_hex"].as_str().unwrap(),
                "{}",
                v["name"]
            );
        }
    }

    #[test]
    fn every_single_field_change_changes_the_hash() {
        let doc: Value = serde_json::from_str(VECTORS).unwrap();
        let hashes: Vec<String> = doc["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| commitment(&v["input"]).hash_hex())
            .collect();
        let mut unique = hashes.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), hashes.len());
    }
}
