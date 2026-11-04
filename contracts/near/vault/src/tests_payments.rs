//! Unit tests for proposals, reservations, approval checks, settlement
//! accounting and the rolling window (STATE_AND_ENCODING §2–§5). The real
//! token transfer and callback are covered by the sandbox tests.

use super::*;
use crate::payments::{DAY_NS, MAX_PENDING_PER_CASE, MAX_PROPOSALS_PER_24H};
use crate::tests::*;

const INVOICE: &str = "inv-0042";
const SEC: u64 = 1_000_000_000;

/// Case funded with 1,000 tUSDC, active hospital payee, invoice ceiling 1,000.
fn ready() -> Vault {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    v.authorize_invoice(
        INVOICE.into(),
        CASE.into(),
        "bih".into(),
        U128(1_000_000_000),
    );
    as_caller(TOKEN, NearToken::from_yoctonear(0));
    let _ = v.ft_on_transfer(acct(FAMILY), U128(1_000_000_000), CASE.into());
    v
}

fn propose_at(v: &mut Vault, request: &str, amount: u128, ttl: u32, at: u64) -> Proposal {
    as_caller_at(AGENT, NearToken::from_yoctonear(0), at);
    v.propose_payment(
        CASE.into(),
        INVOICE.into(),
        request.into(),
        U128(amount),
        ttl,
    )
}

fn propose(v: &mut Vault, request: &str, amount: u128) -> Proposal {
    propose_at(v, request, amount, 3600, T0)
}

fn case(v: &Vault) -> Case {
    v.get_case(CASE.into()).unwrap()
}

/// Approves with the values a correct wallet request would carry.
fn approve_at(v: &mut Vault, p: &Proposal, at: u64) {
    let hash = v.commitment_for(p).hash_hex();
    as_caller_at(FAMILY, ONE_YOCTO, at);
    let _ = v.approve_payment(
        CASE.into(),
        p.proposal_id,
        p.recipient.clone(),
        p.token.clone(),
        p.amount,
        p.policy_version,
        hash,
    );
}

fn approve(v: &mut Vault, p: &Proposal) {
    approve_at(v, p, T0);
}

// ----- proposals and reservations ---------------------------------------------

#[test]
fn proposal_reserves_and_takes_recipient_from_the_verifier() {
    let mut v = ready();
    let p = propose(&mut v, "req-1", 250_000_000);
    assert_eq!(p.status, ProposalStatus::PendingApproval);
    assert_eq!(p.recipient, acct(HOSPITAL));
    assert_eq!(p.token, acct(TOKEN));
    assert_eq!((p.attempt, p.policy_version, p.payee_version), (1, 1, 2));
    assert_eq!(p.expires_at.0, T0 + 3600 * SEC);
    let c = case(&v);
    assert_eq!(c.reserved.0, 250_000_000);
    assert_eq!(c.available(), 750_000_000);
    assert_eq!(c.pending, vec![p.proposal_id.0]);
    assert_eq!(
        v.get_invoice(INVOICE.into()).unwrap().reserved.0,
        250_000_000
    );
}

#[test]
#[should_panic(expected = "E_NOT_AGENT")]
fn only_the_agent_proposes() {
    let mut v = ready();
    as_caller(FAMILY, NearToken::from_yoctonear(0));
    v.propose_payment(CASE.into(), INVOICE.into(), "r".into(), U128(1), 60);
}

#[test]
fn repeated_request_returns_the_same_proposal_and_reserves_once() {
    let mut v = ready();
    let a = propose(&mut v, "req-1", 100_000_000);
    let b = propose(&mut v, "req-1", 100_000_000);
    assert_eq!(a, b);
    assert_eq!(case(&v).reserved.0, 100_000_000);
}

#[test]
#[should_panic(expected = "E_REQUEST_ID_CONFLICT")]
fn reused_request_id_with_new_content_is_refused() {
    let mut v = ready();
    propose(&mut v, "req-1", 100_000_000);
    propose(&mut v, "req-1", 100_000_001);
}

#[test]
#[should_panic(expected = "E_CAP_PAYMENT")]
fn per_payment_cap() {
    let mut v = ready();
    propose(&mut v, "r", 300_000_001);
}

#[test]
#[should_panic(expected = "E_INVOICE_CEILING")]
fn invoice_ceiling_counts_reservations() {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    v.authorize_invoice(INVOICE.into(), CASE.into(), "bih".into(), U128(250_000_000));
    as_caller(TOKEN, NearToken::from_yoctonear(0));
    let _ = v.ft_on_transfer(acct(FAMILY), U128(1_000_000_000), CASE.into());
    propose(&mut v, "r1", 200_000_000);
    propose(&mut v, "r2", 50_000_001);
}

#[test]
#[should_panic(expected = "E_LIQUIDITY")]
fn liquidity_counts_reservations() {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    v.authorize_invoice(
        INVOICE.into(),
        CASE.into(),
        "bih".into(),
        U128(1_000_000_000),
    );
    as_caller(TOKEN, NearToken::from_yoctonear(0));
    let _ = v.ft_on_transfer(acct(FAMILY), U128(300_000_000), CASE.into());
    propose(&mut v, "r1", 200_000_000);
    propose(&mut v, "r2", 100_000_001);
}

#[test]
#[should_panic(expected = "E_CAP_GROUP")]
fn group_cap_counts_pending_reservations() {
    let mut v = ready();
    propose(&mut v, "r1", 300_000_000);
    propose(&mut v, "r2", 100_000_001); // Hospital group cap is 400
}

#[test]
#[should_panic(expected = "E_CAP_ROLLING")]
fn rolling_cap_counts_pending_reservations() {
    let mut v = vault();
    let mut l = limits();
    l.group_caps.clear(); // rolling 500 is then the only 24h bound
    as_caller(FAMILY, NearToken::from_millinear(100));
    v.create_case(CASE.into(), l);
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
    as_caller(VAULT, NearToken::from_yoctonear(0));
    v.on_payee_registration_checked(
        "bih".into(),
        1,
        Ok(Some(StorageBalance {
            total: NearToken::from_millinear(1),
            available: NearToken::from_yoctonear(0),
        })),
    );
    as_caller(VERIFIER, ONE_YOCTO);
    v.authorize_invoice(
        INVOICE.into(),
        CASE.into(),
        "bih".into(),
        U128(1_000_000_000),
    );
    as_caller(TOKEN, NearToken::from_yoctonear(0));
    let _ = v.ft_on_transfer(acct(FAMILY), U128(1_000_000_000), CASE.into());
    propose(&mut v, "r1", 300_000_000);
    propose(&mut v, "r2", 200_000_001);
}

#[test]
#[should_panic(expected = "E_CAP_LIFETIME")]
fn lifetime_cap_counts_paid_amounts() {
    let mut v = ready();
    let mut lower = limits();
    lower.lifetime_cap = U128(500_000_000);
    lower.rolling_24h_cap = U128(500_000_000);
    as_caller(FAMILY, ONE_YOCTO);
    v.lower_limits(CASE.into(), lower);
    let p = propose(&mut v, "r1", 300_000_000);
    approve(&mut v, &p);
    v.finish_transfer(p.proposal_id.0, true);
    // 24 hours later the rolling window is clear, but the lifetime cap is not.
    propose_at(&mut v, "r2", 200_000_001, 3600, T0 + DAY_NS);
}

#[test]
#[should_panic(expected = "E_INVOICE_CASE_MISMATCH")]
fn invoice_must_belong_to_the_case() {
    let mut v = ready();
    as_caller(STRANGER, NearToken::from_millinear(100));
    v.create_case("case-other".into(), limits());
    as_caller(VERIFIER, ONE_YOCTO);
    v.authorize_invoice(
        "inv-other".into(),
        "case-other".into(),
        "bih".into(),
        U128(1),
    );
    as_caller(AGENT, NearToken::from_yoctonear(0));
    v.propose_payment(CASE.into(), "inv-other".into(), "r".into(), U128(1), 60);
}

#[test]
#[should_panic(expected = "E_PAUSED")]
fn paused_case_takes_no_proposals() {
    let mut v = ready();
    as_caller(FAMILY, ONE_YOCTO);
    v.pause(CASE.into());
    propose(&mut v, "r", 1);
}

#[test]
#[should_panic(expected = "E_PAYEE_NOT_ACTIVE")]
fn invoice_of_a_revoked_payee_cannot_be_proposed() {
    let mut v = ready();
    as_caller(VERIFIER, ONE_YOCTO);
    v.revoke_payee("bih".into());
    propose(&mut v, "r", 1);
}

#[test]
#[should_panic(expected = "E_AGENT_DISABLED")]
fn revoked_agent_cannot_propose() {
    let mut v = ready();
    as_caller(FAMILY, ONE_YOCTO);
    v.revoke_agent(CASE.into());
    propose(&mut v, "r", 1);
}

#[test]
#[should_panic(expected = "E_TTL")]
fn ttl_is_bounded() {
    let mut v = ready();
    propose_at(&mut v, "r", 1, 86_401, T0);
}

#[test]
#[should_panic(expected = "E_BOUND_ACTIVE")]
fn pending_proposals_are_bounded() {
    let mut v = ready();
    for i in 0..=MAX_PENDING_PER_CASE {
        propose(&mut v, &format!("r{i}"), 1);
    }
}

#[test]
#[should_panic(expected = "E_BOUND_RATE")]
fn proposal_rate_is_bounded_even_when_rejected() {
    let mut v = ready();
    for i in 0..=MAX_PROPOSALS_PER_24H {
        let p = propose(&mut v, &format!("r{i}"), 1);
        as_caller(FAMILY, ONE_YOCTO);
        v.reject_payment(CASE.into(), p.proposal_id);
    }
}

// ----- approval checks ------------------------------------------------------------

#[test]
fn approval_moves_reservation_to_in_flight() {
    let mut v = ready();
    let p = propose(&mut v, "r", 250_000_000);
    approve(&mut v, &p);
    let c = case(&v);
    assert_eq!(
        (c.reserved.0, c.in_flight.0, c.balance.0),
        (0, 250_000_000, 1_000_000_000)
    );
    assert!(c.pending.is_empty());
    let stored = v.get_proposal(p.proposal_id).unwrap();
    assert_eq!(stored.status, ProposalStatus::Submitted);
    let inv = v.get_invoice(INVOICE.into()).unwrap();
    assert_eq!((inv.reserved.0, inv.in_flight.0), (0, 250_000_000));
}

#[allow(clippy::too_many_arguments)]
fn approve_with(
    v: &mut Vault,
    p: &Proposal,
    caller: &str,
    recipient: &str,
    token: &str,
    amount: u128,
    policy: u64,
    hash: Option<&str>,
) {
    let hash = hash.map_or_else(|| v.commitment_for(p).hash_hex(), str::to_string);
    as_caller(caller, ONE_YOCTO);
    let _ = v.approve_payment(
        CASE.into(),
        p.proposal_id,
        acct(recipient),
        acct(token),
        U128(amount),
        policy,
        hash,
    );
}

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn agent_cannot_approve() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    approve_with(&mut v, &p, AGENT, HOSPITAL, TOKEN, 1, 1, None);
}

#[test]
#[should_panic(expected = "E_FIELD_MISMATCH")]
fn approval_with_other_recipient_is_refused() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    approve_with(&mut v, &p, FAMILY, STRANGER, TOKEN, 1, 1, None);
}

#[test]
#[should_panic(expected = "E_FIELD_MISMATCH")]
fn approval_with_other_token_is_refused() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    approve_with(
        &mut v,
        &p,
        FAMILY,
        HOSPITAL,
        "fake-usdc.test.near",
        1,
        1,
        None,
    );
}

#[test]
#[should_panic(expected = "E_FIELD_MISMATCH")]
fn approval_with_other_amount_is_refused() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    approve_with(&mut v, &p, FAMILY, HOSPITAL, TOKEN, 2, 1, None);
}

#[test]
#[should_panic(expected = "E_STALE_POLICY")]
fn approval_with_other_policy_version_is_refused() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    approve_with(&mut v, &p, FAMILY, HOSPITAL, TOKEN, 1, 2, None);
}

#[test]
#[should_panic(expected = "E_COMMITMENT_MISMATCH")]
fn approval_with_other_hash_is_refused() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    let mut other = p.clone();
    other.expires_at = U64(p.expires_at.0 + 1); // a field the wallet would not show
    let wrong = v.commitment_for(&other).hash_hex();
    approve_with(&mut v, &p, FAMILY, HOSPITAL, TOKEN, 1, 1, Some(&wrong));
}

#[test]
#[should_panic(expected = "E_ONE_YOCTO")]
fn approval_needs_one_yocto() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    let hash = v.commitment_for(&p).hash_hex();
    as_caller(FAMILY, NearToken::from_yoctonear(0));
    let _ = v.approve_payment(
        CASE.into(),
        p.proposal_id,
        acct(HOSPITAL),
        acct(TOKEN),
        U128(1),
        1,
        hash,
    );
}

#[test]
#[should_panic(expected = "E_BAD_STATE")]
fn approval_happens_once() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    approve(&mut v, &p);
    approve(&mut v, &p);
}

#[test]
#[should_panic(expected = "E_EXPIRED")]
fn expired_proposal_cannot_be_approved() {
    let mut v = ready();
    let p = propose_at(&mut v, "r", 1, 60, T0);
    approve_at(&mut v, &p, T0 + 60 * SEC);
}

#[test]
fn proposal_is_approvable_until_just_before_expiry() {
    let mut v = ready();
    let p = propose_at(&mut v, "r", 1, 60, T0);
    approve_at(&mut v, &p, T0 + 60 * SEC - 1);
    assert_eq!(
        v.get_proposal(p.proposal_id).unwrap().status,
        ProposalStatus::Submitted
    );
}

#[test]
#[should_panic(expected = "E_PAYEE_CHANGED")]
fn revoked_payee_blocks_approval() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    as_caller(VERIFIER, ONE_YOCTO);
    v.revoke_payee("bih".into());
    approve(&mut v, &p);
}

#[test]
#[should_panic(expected = "E_PROPOSAL_NOT_FOUND")]
fn proposal_must_belong_to_the_approved_case() {
    let mut v = ready();
    let p = propose(&mut v, "r", 1);
    as_caller(STRANGER, NearToken::from_millinear(100));
    v.create_case("case-other".into(), limits());
    as_caller(STRANGER, ONE_YOCTO);
    let _ = v.approve_payment(
        "case-other".into(),
        p.proposal_id,
        acct(HOSPITAL),
        acct(TOKEN),
        U128(1),
        1,
        v.commitment_for(&p).hash_hex(),
    );
}

// ----- invalidation and release ---------------------------------------------------

#[test]
fn rejection_releases_reservation_once() {
    let mut v = ready();
    let p = propose(&mut v, "r", 200_000_000);
    as_caller(FAMILY, ONE_YOCTO);
    let r = v.reject_payment(CASE.into(), p.proposal_id);
    assert_eq!(r.status, ProposalStatus::Rejected);
    assert_eq!(case(&v).reserved.0, 0);
    // Releasing again is a no-op.
    v.release(p.proposal_id.0, ProposalStatus::Rejected, "again");
    assert_eq!(case(&v).reserved.0, 0);
    assert_eq!(v.get_invoice(INVOICE.into()).unwrap().reserved.0, 0);
}

#[test]
fn policy_change_pause_and_agent_revocation_invalidate_pending() {
    let mut v = ready();
    let a = propose(&mut v, "a", 10);
    let mut lower = limits();
    lower.per_payment_max = U128(200_000_000);
    as_caller(FAMILY, ONE_YOCTO);
    v.lower_limits(CASE.into(), lower);
    let a = v.get_proposal(a.proposal_id).unwrap();
    assert_eq!(a.status, ProposalStatus::Invalidated);
    assert_eq!(a.status_reason.as_deref(), Some("E_STALE_POLICY"));

    let b = propose(&mut v, "b", 10);
    as_caller(FAMILY, ONE_YOCTO);
    v.pause(CASE.into());
    assert_eq!(
        v.get_proposal(b.proposal_id)
            .unwrap()
            .status_reason
            .as_deref(),
        Some("E_PAUSED")
    );
    as_caller(FAMILY, ONE_YOCTO);
    v.unpause(CASE.into());

    let c = propose(&mut v, "c", 10);
    as_caller(FAMILY, ONE_YOCTO);
    v.revoke_agent(CASE.into());
    assert_eq!(
        v.get_proposal(c.proposal_id)
            .unwrap()
            .status_reason
            .as_deref(),
        Some("E_AGENT_DISABLED")
    );
    let state = case(&v);
    assert_eq!((state.reserved.0, state.pending.len()), (0, 0));
}

#[test]
fn invoice_revocation_invalidates_pending_immediately() {
    let mut v = ready();
    let p = propose(&mut v, "r", 10);
    as_caller(VERIFIER, ONE_YOCTO);
    v.revoke_invoice(INVOICE.into());
    let p = v.get_proposal(p.proposal_id).unwrap();
    assert_eq!(p.status_reason.as_deref(), Some("E_INVOICE_UNAUTHORIZED"));
    assert_eq!(case(&v).reserved.0, 0);
}

#[test]
fn sweep_releases_expired_and_payee_changed_proposals() {
    let mut v = ready();
    let short = propose_at(&mut v, "short", 10, 60, T0);
    let long = propose_at(&mut v, "long", 20, 3600, T0);
    as_caller_at(STRANGER, NearToken::from_yoctonear(0), T0 + 61 * SEC);
    assert_eq!(v.sweep(CASE.into()), 1);
    assert_eq!(
        v.get_proposal(short.proposal_id).unwrap().status,
        ProposalStatus::Expired
    );
    assert_eq!(case(&v).reserved.0, 20);

    as_caller(VERIFIER, ONE_YOCTO);
    v.revoke_payee("bih".into());
    as_caller_at(STRANGER, NearToken::from_yoctonear(0), T0 + 62 * SEC);
    assert_eq!(v.sweep(CASE.into()), 1);
    let long = v.get_proposal(long.proposal_id).unwrap();
    assert_eq!(long.status_reason.as_deref(), Some("E_PAYEE_CHANGED"));
    assert_eq!(case(&v).reserved.0, 0);
}

// ----- settlement -------------------------------------------------------------------

#[test]
fn successful_transfer_settles_once() {
    let mut v = ready();
    let p = propose(&mut v, "r", 250_000_000);
    approve(&mut v, &p);
    assert_eq!(
        v.finish_transfer(p.proposal_id.0, true),
        ProposalStatus::Settled
    );
    let c = case(&v);
    assert_eq!(
        (c.balance.0, c.in_flight.0, c.paid.0),
        (750_000_000, 0, 250_000_000)
    );
    // A duplicate or late callback changes nothing, even a "failure".
    assert_eq!(
        v.finish_transfer(p.proposal_id.0, false),
        ProposalStatus::Settled
    );
    assert_eq!(case(&v), c);
    let inv = v.get_invoice(INVOICE.into()).unwrap();
    assert_eq!((inv.paid.0, inv.in_flight.0), (250_000_000, 0));
}

#[test]
fn failed_transfer_restores_funds_once_and_allows_a_retry() {
    let mut v = ready();
    let p = propose(&mut v, "r1", 300_000_000);
    approve(&mut v, &p);
    assert_eq!(
        v.finish_transfer(p.proposal_id.0, false),
        ProposalStatus::Failed
    );
    let c = case(&v);
    assert_eq!(
        (c.balance.0, c.in_flight.0, c.paid.0, c.reserved.0),
        (1_000_000_000, 0, 0, 0)
    );
    assert_eq!(
        v.finish_transfer(p.proposal_id.0, true),
        ProposalStatus::Failed
    );
    assert_eq!(case(&v), c);
    // The failed amount no longer counts toward the 24h caps, so the full
    // amount can be retried as attempt 2 of the same invoice.
    let retry = propose(&mut v, "r2", 300_000_000);
    assert_eq!(retry.attempt, 2);
    assert_ne!(
        v.commitment_for(&retry).hash_hex(),
        v.commitment_for(&p).hash_hex()
    );
}

#[test]
fn finishing_a_pending_proposal_does_nothing() {
    let mut v = ready();
    let p = propose(&mut v, "r", 5);
    assert_eq!(
        v.finish_transfer(p.proposal_id.0, true),
        ProposalStatus::PendingApproval
    );
    assert_eq!(case(&v).reserved.0, 5);
}

// ----- rolling window ------------------------------------------------------------------

#[test]
fn rolling_window_counts_a_charge_for_exactly_24_hours() {
    let mut v = ready();
    let p = propose(&mut v, "r1", 300_000_000);
    approve(&mut v, &p);
    v.finish_transfer(p.proposal_id.0, true);
    // Group cap 400: 100 more fits, 100 + 1 does not, until 24h have passed.
    let ok = propose_at(&mut v, "r2", 100_000_000, 60, T0 + DAY_NS - 1);
    as_caller_at(FAMILY, ONE_YOCTO, T0 + DAY_NS - 1);
    v.reject_payment(CASE.into(), ok.proposal_id);
    // At exactly 24h the first 300 has left the window: 300 more fits the
    // 400 group cap, which it could not while that charge counted.
    let at_boundary = propose_at(&mut v, "r3", 300_000_000, 60, T0 + DAY_NS);
    assert_eq!(at_boundary.status, ProposalStatus::PendingApproval);
}

#[test]
#[should_panic(expected = "E_CAP_GROUP")]
fn rolling_window_still_counts_one_nanosecond_before_24_hours() {
    let mut v = ready();
    let p = propose(&mut v, "r1", 300_000_000);
    approve(&mut v, &p);
    v.finish_transfer(p.proposal_id.0, true);
    propose_at(&mut v, "r2", 100_000_001, 60, T0 + DAY_NS - 1);
}

#[test]
fn late_failure_never_releases_current_window_budget() {
    let mut v = ready();
    let old = propose(&mut v, "old", 300_000_000);
    approve(&mut v, &old);
    // Outcome unknown for more than a day: still in flight, out of the window.
    let later = T0 + DAY_NS + SEC;
    let new = propose_at(&mut v, "new", 300_000_000, 60, later);
    // Liquidity: 1000 - 300 in flight - 300 reserved = 400 available.
    assert_eq!(case(&v).available(), 400_000_000);
    as_caller_at(VAULT, NearToken::from_yoctonear(0), later);
    v.finish_transfer(old.proposal_id.0, false);
    // The new proposal's 300 still counts: only 100 of the 400 group cap is left.
    let preview = v.approval_preview(new.proposal_id).unwrap();
    assert_eq!(preview.group_24h_remaining.0, 100_000_000);
    assert_eq!(case(&v).available(), 700_000_000);
}

// ----- preview and withdrawal --------------------------------------------------------------

#[test]
fn preview_matches_what_approval_checks() {
    let mut v = ready();
    let p = propose_at(&mut v, "r", 250_000_000, 60, T0);
    as_caller(STRANGER, NearToken::from_yoctonear(0));
    let preview = v.approval_preview(p.proposal_id).unwrap();
    assert!(preview.blockers.is_empty());
    assert_eq!(preview.commitment_hash, v.commitment_for(&p).hash_hex());
    assert_eq!(preview.case_available.0, 750_000_000);
    assert_eq!(preview.invoice_remaining.0, 750_000_000);
    assert_eq!(preview.group_24h_remaining.0, 150_000_000);
    assert_eq!(preview.rolling_24h_remaining.0, 250_000_000);
    assert_eq!(preview.lifetime_remaining.0, 1_750_000_000);

    as_caller_at(STRANGER, NearToken::from_yoctonear(0), T0 + 60 * SEC);
    let expired = v.approval_preview(p.proposal_id).unwrap();
    assert_eq!(expired.blockers, vec!["E_EXPIRED".to_string()]);
}

#[test]
fn owner_withdraws_only_unreserved_funds() {
    let mut v = ready();
    propose(&mut v, "r", 300_000_000);
    as_caller(FAMILY, ONE_YOCTO);
    let _ = v.withdraw(CASE.into(), U128(700_000_000));
    assert_eq!(case(&v).balance.0, 300_000_000);
    assert_eq!(case(&v).available(), 0);
}

#[test]
#[should_panic(expected = "E_LIQUIDITY")]
fn reserved_funds_cannot_be_withdrawn() {
    let mut v = ready();
    propose(&mut v, "r", 300_000_000);
    as_caller(FAMILY, ONE_YOCTO);
    let _ = v.withdraw(CASE.into(), U128(700_000_001));
}

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn only_the_owner_withdraws() {
    let mut v = ready();
    as_caller(AGENT, ONE_YOCTO);
    let _ = v.withdraw(CASE.into(), U128(1));
}
