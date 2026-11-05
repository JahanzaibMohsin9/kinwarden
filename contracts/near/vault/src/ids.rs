//! On-chain identifiers are opaque. Names, medical details, student numbers
//! and invoice text stay off chain (docs/near/DECISIONS.md D-06), so free text
//! is rejected at the interface rather than trusted to callers.

use near_sdk::require;

use crate::errors;

pub fn is_opaque_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    (1..=64).contains(&bytes.len())
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

pub fn assert_opaque_id(id: &str) {
    require!(is_opaque_id(id), errors::ID_FORMAT);
}

/// A provenance reference is a SHA-256 digest of the off-chain verification
/// record, so the record itself never reaches the chain.
pub fn assert_provenance(digest: &str) {
    require!(
        digest.len() == 64
            && digest
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        errors::PROVENANCE_FORMAT
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_opaque_ids() {
        for id in [
            "case-th-hosp-001",
            "a",
            "0",
            "inv-2026-11-0042",
            &"x".repeat(64),
        ] {
            assert!(is_opaque_id(id), "{id}");
        }
    }

    #[test]
    fn rejects_free_text_and_bad_shapes() {
        let too_long = "x".repeat(65);
        for id in [
            "",
            "Anna Brooks",
            "MRN 12345",
            "-leading-dash",
            "UPPER",
            "student_id",
            "a.b",
            "emoji-🙂",
            too_long.as_str(),
        ] {
            assert!(!is_opaque_id(id), "{id}");
        }
    }
}
