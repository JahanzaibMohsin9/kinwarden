//! Stored records. Amounts are integer token units; times are block time in
//! nanoseconds. See docs/near/STATE_AND_ENCODING.md §1 and §4.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, require, AccountId};

use crate::errors;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub token: AccountId,
    pub verifier: AccountId,
    pub agent: AccountId,
    /// Commitment domain: "sandbox", "testnet" or "mainnet".
    pub network: String,
}

/// Verifier-assigned category used for the purpose-group cap. The agent never
/// writes a purpose; it comes from the payee's enrollment.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PurposeGroup {
    Hospital,
    Tuition,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupCap {
    pub group: PurposeGroup,
    pub rolling_24h_cap: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Limits {
    pub per_payment_max: U128,
    pub rolling_24h_cap: U128,
    pub lifetime_cap: U128,
    /// Optional tighter rolling caps per purpose group. A group without an
    /// entry is bounded by `rolling_24h_cap`.
    pub group_caps: Vec<GroupCap>,
}

impl Limits {
    pub fn validate(&self) {
        let (p, r, l) = (
            self.per_payment_max.0,
            self.rolling_24h_cap.0,
            self.lifetime_cap.0,
        );
        require!(p > 0 && p <= r && r <= l, errors::LIMITS_INVALID);
        for (i, cap) in self.group_caps.iter().enumerate() {
            require!(
                cap.rolling_24h_cap.0 > 0 && cap.rolling_24h_cap.0 <= r,
                errors::LIMITS_INVALID
            );
            require!(
                !self.group_caps[..i].iter().any(|c| c.group == cap.group),
                errors::LIMITS_INVALID
            );
        }
    }

    pub fn group_cap(&self, group: PurposeGroup) -> u128 {
        self.group_caps
            .iter()
            .find(|c| c.group == group)
            .map_or(self.rolling_24h_cap.0, |c| c.rolling_24h_cap.0)
    }

    /// True when no limit, including the effective cap of any group, is higher
    /// than in `current`.
    pub fn not_higher_than(&self, current: &Limits) -> bool {
        self.per_payment_max.0 <= current.per_payment_max.0
            && self.rolling_24h_cap.0 <= current.rolling_24h_cap.0
            && self.lifetime_cap.0 <= current.lifetime_cap.0
            && [PurposeGroup::Hospital, PurposeGroup::Tuition]
                .into_iter()
                .all(|g| self.group_cap(g) <= current.group_cap(g))
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaseStatus {
    Active,
    Paused,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Case {
    pub owner: AccountId,
    pub status: CaseStatus,
    /// The owner can switch the configured agent off for this case.
    pub agent_enabled: bool,
    /// Incremented on every policy change; old approvals then fail.
    pub policy_version: u64,
    pub limits: Limits,
    /// Tokens held for this case, including reserved and in-flight amounts.
    pub balance: U128,
    /// Reserved by pending proposals.
    pub reserved: U128,
    /// Dispatched, awaiting the transfer outcome.
    pub in_flight: U128,
    /// Settled to payees.
    pub paid: U128,
    pub created_at: U64,
    /// Proposal ids awaiting approval (bounded, STATE_AND_ENCODING §5).
    pub pending: Vec<u64>,
    /// Proposals created in the last 24 hours, for the rolling caps and the
    /// proposal rate bound. Pruned on write.
    pub window: Vec<WindowEntry>,
}

impl Case {
    /// Tokens not reserved, in flight or otherwise committed.
    pub fn available(&self) -> u128 {
        self.balance
            .0
            .saturating_sub(self.reserved.0)
            .saturating_sub(self.in_flight.0)
    }
}

/// One proposal's charge against the rolling windows. `counted` is cleared
/// when the proposal is released or its transfer fails; the entry still
/// counts toward the proposal rate bound until it ages out.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowEntry {
    pub proposal_id: u64,
    pub at: U64,
    pub amount: U128,
    pub group: PurposeGroup,
    pub counted: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    PendingApproval,
    Submitted,
    Settled,
    Failed,
    Rejected,
    Expired,
    Invalidated,
}

/// A payment the agent asked for. The recipient, token and purpose come from
/// the verifier's records, never from the agent.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposal {
    pub proposal_id: U64,
    pub case_id: String,
    pub invoice_id: String,
    pub request_id: String,
    /// 1 for the invoice's first proposal, then 2, 3, … for retries.
    pub attempt: u32,
    pub payee_id: String,
    pub recipient: AccountId,
    pub token: AccountId,
    pub amount: U128,
    pub purpose_group: PurposeGroup,
    pub ttl_seconds: u32,
    pub created_at: U64,
    pub expires_at: U64,
    pub policy_version: u64,
    pub payee_version: u64,
    pub status: ProposalStatus,
    /// Refusal or invalidation code for terminal states other than Settled.
    pub status_reason: Option<String>,
    pub updated_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayeeStatus {
    /// Enrolled; waiting for the token contract to confirm storage registration.
    PendingRegistration,
    Active,
    /// The account was not registered on the token, so it could not receive.
    Rejected,
    Revoked,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payee {
    pub account: AccountId,
    pub purpose_group: PurposeGroup,
    /// SHA-256 of the off-chain verification record.
    pub provenance: String,
    /// Incremented on every status change; bound into approvals.
    pub payee_version: u64,
    pub status: PayeeStatus,
    pub updated_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InvoiceStatus {
    Authorized,
    Revoked,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invoice {
    pub case_id: String,
    pub payee_id: String,
    pub ceiling: U128,
    pub paid: U128,
    pub reserved: U128,
    pub in_flight: U128,
    pub status: InvoiceStatus,
    pub authorized_at: U64,
    /// Proposals created for this invoice so far.
    pub attempts: u32,
}

/// Read-only preview of an approval, computed by the same checks
/// `approve_payment` runs. Advisory: approval rechecks everything.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovalPreview {
    pub proposal: Proposal,
    pub commitment_hash: String,
    /// Empty when the proposal can be approved right now.
    pub blockers: Vec<String>,
    pub case_available: U128,
    pub invoice_remaining: U128,
    pub rolling_24h_remaining: U128,
    pub group_24h_remaining: U128,
    pub lifetime_remaining: U128,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits(p: u128, r: u128, l: u128, groups: &[(PurposeGroup, u128)]) -> Limits {
        Limits {
            per_payment_max: U128(p),
            rolling_24h_cap: U128(r),
            lifetime_cap: U128(l),
            group_caps: groups
                .iter()
                .map(|(g, c)| GroupCap {
                    group: *g,
                    rolling_24h_cap: U128(*c),
                })
                .collect(),
        }
    }

    #[test]
    fn valid_limits_pass() {
        limits(100, 200, 1000, &[(PurposeGroup::Hospital, 150)]).validate();
        limits(1, 1, 1, &[]).validate();
    }

    #[test]
    #[should_panic(expected = "E_LIMITS_INVALID")]
    fn zero_per_payment_rejected() {
        limits(0, 200, 1000, &[]).validate();
    }

    #[test]
    #[should_panic(expected = "E_LIMITS_INVALID")]
    fn per_payment_above_rolling_rejected() {
        limits(300, 200, 1000, &[]).validate();
    }

    #[test]
    #[should_panic(expected = "E_LIMITS_INVALID")]
    fn rolling_above_lifetime_rejected() {
        limits(100, 2000, 1000, &[]).validate();
    }

    #[test]
    #[should_panic(expected = "E_LIMITS_INVALID")]
    fn group_cap_above_rolling_rejected() {
        limits(100, 200, 1000, &[(PurposeGroup::Tuition, 201)]).validate();
    }

    #[test]
    #[should_panic(expected = "E_LIMITS_INVALID")]
    fn duplicate_group_rejected() {
        limits(
            100,
            200,
            1000,
            &[(PurposeGroup::Hospital, 50), (PurposeGroup::Hospital, 60)],
        )
        .validate();
    }

    #[test]
    fn lowering_compares_effective_group_caps() {
        let current = limits(100, 200, 1000, &[(PurposeGroup::Hospital, 150)]);
        assert!(limits(100, 200, 1000, &[(PurposeGroup::Hospital, 150)]).not_higher_than(&current));
        assert!(limits(50, 150, 900, &[(PurposeGroup::Tuition, 100)]).not_higher_than(&current));
        // Removing the Hospital cap would raise its effective cap from 150 to 200.
        assert!(!limits(100, 200, 1000, &[]).not_higher_than(&current));
        assert!(!limits(101, 200, 1000, &[(PurposeGroup::Hospital, 150)]).not_higher_than(&current));
        assert!(!limits(100, 200, 1001, &[(PurposeGroup::Hospital, 150)]).not_higher_than(&current));
    }
}
