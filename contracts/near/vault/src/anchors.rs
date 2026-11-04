//! Activity-log anchors: the app copies its tamper-evident log's head hash
//! here at case milestones, so anyone can later check the log was not edited.
//! Only the agent's restricted key may anchor; only a hash, its sequence
//! number and a short label go on chain.
//!
//! Anchors live under their own raw storage prefix rather than in the
//! contract struct, so adding them did not change the vault's state layout.

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U64;
use near_sdk::{env, log, near, require};

use crate::{errors, now, Vault, VaultExt};

/// Anchors kept per case. Each costs the vault about 0.002 NEAR of storage.
pub const MAX_ANCHORS_PER_CASE: u64 = 200;
const LABEL_MAX: usize = 96;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct LogAnchor {
    pub index: U64,
    /// The log entry the head hash covers, up to and including it.
    pub seq: U64,
    /// SHA-256 head of the activity log's hash chain, lowercase hex.
    pub head: String,
    pub label: String,
    pub at: U64,
}

fn count_key(case_id: &str) -> Vec<u8> {
    [b"anc#".as_slice(), case_id.as_bytes()].concat()
}

fn anchor_key(case_id: &str, index: u64) -> Vec<u8> {
    [
        b"anc/".as_slice(),
        case_id.as_bytes(),
        b"/",
        &index.to_be_bytes(),
    ]
    .concat()
}

fn read<T: BorshDeserialize>(key: &[u8]) -> Option<T> {
    env::storage_read(key).map(|b| T::try_from_slice(&b).expect("anchor storage"))
}

fn write<T: BorshSerialize>(key: &[u8], value: &T) {
    env::storage_write(key, &borsh::to_vec(value).expect("anchor storage"));
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[near]
impl Vault {
    /// Agent: anchor the activity log's head for a case. Anchors are
    /// append-only: each gets the next index and the block time, and none is
    /// ever replaced. A reset demo world starts its log again at 1, so the
    /// label carries the world's run tag rather than the vault ordering seq.
    pub fn anchor_log(
        &mut self,
        case_id: String,
        seq: U64,
        head: String,
        label: String,
    ) -> LogAnchor {
        require!(
            env::predecessor_account_id() == self.config.agent,
            errors::NOT_AGENT
        );
        require!(self.cases.contains_key(&case_id), errors::CASE_NOT_FOUND);
        require!(is_hex64(&head), errors::ANCHOR_HEAD);
        require!(
            !label.is_empty()
                && label.len() <= LABEL_MAX
                && label.bytes().all(|b| (0x20..0x7f).contains(&b)),
            errors::ANCHOR_LABEL
        );
        let count: u64 = read(&count_key(&case_id)).unwrap_or(0);
        require!(count < MAX_ANCHORS_PER_CASE, errors::BOUND_ANCHORS);
        let anchor = LogAnchor {
            index: U64(count),
            seq,
            head,
            label,
            at: now(),
        };
        write(&anchor_key(&case_id, count), &anchor);
        write(&count_key(&case_id), &(count + 1));
        log!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "kinwarden",
                "version": "1.0.0",
                "event": "log_anchored",
                "data": [{
                    "case_id": case_id,
                    "index": anchor.index,
                    "seq": anchor.seq,
                    "head": anchor.head,
                    "label": anchor.label,
                }],
            })
        );
        anchor
    }

    pub fn get_anchor_count(&self, case_id: String) -> U64 {
        U64(read(&count_key(&case_id)).unwrap_or(0))
    }

    pub fn get_anchor(&self, case_id: String, index: U64) -> Option<LogAnchor> {
        read(&anchor_key(&case_id, index.0))
    }
}
