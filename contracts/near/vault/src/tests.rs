//! Unit tests run in near-sdk's mocked environment. Cross-contract behavior
//! (token registration, real deposits, access keys) is covered by the sandbox
//! tests in contracts/near/integration-tests.

use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

pub(crate) const VAULT: &str = "vault.test.near";
pub(crate) const TOKEN: &str = "tusdc.test.near";
pub(crate) const VERIFIER: &str = "verifier.test.near";
pub(crate) const AGENT: &str = "agent.test.near";
pub(crate) const FAMILY: &str = "family.test.near";
pub(crate) const HOSPITAL: &str = "hospital.test.near";
pub(crate) const STRANGER: &str = "stranger.test.near";
pub(crate) const CASE: &str = "case-th-hosp-001";
pub(crate) const PROVENANCE: &str =
    "4f6c1a0e2b9d8c7f6e5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e";

pub(crate) fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// Block time used by tests unless they move the clock.
pub(crate) const T0: u64 = 1_800_000_000_000_000_000;

pub(crate) fn as_caller(caller: &str, deposit: NearToken) {
    as_caller_at(caller, deposit, T0);
}

pub(crate) fn as_caller_at(caller: &str, deposit: NearToken, block_timestamp: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct(VAULT))
        .predecessor_account_id(acct(caller))
        .attached_deposit(deposit)
        .block_timestamp(block_timestamp)
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}

pub(crate) fn limits() -> Limits {
    Limits {
        per_payment_max: U128(300_000_000),
        rolling_24h_cap: U128(500_000_000),
        lifetime_cap: U128(2_000_000_000),
        group_caps: vec![GroupCap {
            group: PurposeGroup::Hospital,
            rolling_24h_cap: U128(400_000_000),
        }],
    }
}

pub(crate) fn vault() -> Vault {
    as_caller(VAULT, NearToken::from_yoctonear(0));
    Vault::new(acct(TOKEN), acct(VERIFIER), acct(AGENT), "sandbox".into())
}

pub(crate) fn vault_with_case() -> Vault {
    let mut v = vault();
    as_caller(FAMILY, NearToken::from_millinear(100));
    v.create_case(CASE.into(), limits());
    v
}

pub(crate) fn vault_with_active_payee() -> Vault {
    let mut v = vault_with_case();
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
    as_caller(VAULT, NearToken::from_yoctonear(0));
    let status = v.on_payee_registration_checked(
        "bih".into(),
        1,
        Ok(Some(StorageBalance {
            total: NearToken::from_millinear(1),
            available: NearToken::from_yoctonear(0),
        })),
    );
    assert_eq!(status, PayeeStatus::Active);
    v
}

// ----- init -----------------------------------------------------------------

#[test]
#[should_panic(expected = "E_ROLE_CONFLICT")]
fn init_rejects_shared_roles() {
    as_caller(VAULT, NearToken::from_yoctonear(0));
    Vault::new(acct(TOKEN), acct(AGENT), acct(AGENT), "sandbox".into());
}

#[test]
#[should_panic(expected = "E_ROLE_CONFLICT")]
fn init_rejects_vault_as_role() {
    as_caller(VAULT, NearToken::from_yoctonear(0));
    Vault::new(acct(TOKEN), acct(VAULT), acct(AGENT), "sandbox".into());
}

#[test]
#[should_panic(expected = "E_BAD_NETWORK")]
fn init_rejects_unknown_network() {
    as_caller(VAULT, NearToken::from_yoctonear(0));
    Vault::new(acct(TOKEN), acct(VERIFIER), acct(AGENT), "devnet".into());
}

// ----- cases --------------------------------------------------------------------

#[test]
fn create_case_sets_owner_and_initial_state() {
    let v = vault_with_case();
    let c = v.get_case(CASE.into()).unwrap();
    assert_eq!(c.owner, acct(FAMILY));
    assert_eq!(c.status, CaseStatus::Active);
    assert_eq!(c.policy_version, 1);
    assert!(c.agent_enabled);
    assert_eq!(
        (c.balance.0, c.reserved.0, c.in_flight.0, c.paid.0),
        (0, 0, 0, 0)
    );
}

#[test]
#[should_panic(expected = "E_STORAGE_DEPOSIT")]
fn create_case_requires_deposit() {
    let mut v = vault();
    as_caller(FAMILY, NearToken::from_yoctonear(0));
    v.create_case(CASE.into(), limits());
}

#[test]
#[should_panic(expected = "E_STORAGE_DEPOSIT")]
fn create_case_requires_enough_for_storage() {
    let mut v = vault();
    as_caller(FAMILY, ONE_YOCTO);
    v.create_case(CASE.into(), limits());
}

#[test]
#[should_panic(expected = "E_CASE_EXISTS")]
fn case_ids_are_unique() {
    let mut v = vault_with_case();
    as_caller(STRANGER, NearToken::from_millinear(100));
    v.create_case(CASE.into(), limits());
}

#[test]
#[should_panic(expected = "E_ID_FORMAT")]
fn case_id_cannot_carry_personal_text() {
    let mut v = vault();
    as_caller(FAMILY, NearToken::from_millinear(100));
    v.create_case("Ayesha Khan MRN 12345".into(), limits());
}

#[test]
#[should_panic(expected = "E_ROLE_CONFLICT")]
fn agent_cannot_own_a_case() {
    let mut v = vault();
    as_caller(AGENT, NearToken::from_millinear(100));
    v.create_case(CASE.into(), limits());
}

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn stranger_cannot_pause() {
    let mut v = vault_with_case();
    as_caller(STRANGER, ONE_YOCTO);
    v.pause(CASE.into());
}

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn agent_cannot_pause_or_change_policy() {
    let mut v = vault_with_case();
    as_caller(AGENT, ONE_YOCTO);
    v.lower_limits(CASE.into(), limits());
}

#[test]
#[should_panic(expected = "E_ONE_YOCTO")]
fn owner_actions_require_one_yocto() {
    let mut v = vault_with_case();
    as_caller(FAMILY, NearToken::from_yoctonear(0));
    v.pause(CASE.into());
}

#[test]
#[should_panic(expected = "E_ONE_YOCTO")]
fn owner_actions_reject_larger_deposits() {
    let mut v = vault_with_case();
    as_caller(FAMILY, NearToken::from_yoctonear(2));
    v.pause(CASE.into());
}

#[test]
fn owner_can_pause_unpause_and_toggle_agent() {
    let mut v = vault_with_case();
    as_caller(FAMILY, ONE_YOCTO);
    assert_eq!(v.pause(CASE.into()).status, CaseStatus::Paused);
    assert_eq!(v.unpause(CASE.into()).status, CaseStatus::Active);
    assert!(!v.revoke_agent(CASE.into()).agent_enabled);
    assert!(v.enable_agent(CASE.into()).agent_enabled);
}

#[test]
fn lowering_limits_bumps_policy_version() {
    let mut v = vault_with_case();
    let mut lower = limits();
    lower.per_payment_max = U128(100_000_000);
    as_caller(FAMILY, ONE_YOCTO);
    let c = v.lower_limits(CASE.into(), lower.clone());
    assert_eq!(c.policy_version, 2);
    assert_eq!(c.limits, lower);
}

#[test]
#[should_panic(expected = "E_LIMITS_NOT_LOWER")]
fn limits_cannot_be_raised() {
    let mut v = vault_with_case();
    let mut higher = limits();
    higher.lifetime_cap = U128(3_000_000_000);
    as_caller(FAMILY, ONE_YOCTO);
    v.lower_limits(CASE.into(), higher);
}

// ----- payees -------------------------------------------------------------------

#[test]
#[should_panic(expected = "E_NOT_VERIFIER")]
fn agent_cannot_enroll_payee() {
    let mut v = vault_with_case();
    as_caller(AGENT, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
}

#[test]
#[should_panic(expected = "E_NOT_VERIFIER")]
fn family_cannot_enroll_payee() {
    let mut v = vault_with_case();
    as_caller(FAMILY, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
}

#[test]
#[should_panic(expected = "E_ONE_YOCTO")]
fn verifier_actions_require_one_yocto() {
    let mut v = vault_with_case();
    as_caller(VERIFIER, NearToken::from_yoctonear(0));
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
}

#[test]
#[should_panic(expected = "E_PAYEE_FORBIDDEN_ACCOUNT")]
fn agent_account_cannot_be_payee() {
    let mut v = vault_with_case();
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "x".into(),
        acct(AGENT),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
}

#[test]
#[should_panic(expected = "E_PROVENANCE_FORMAT")]
fn provenance_must_be_a_digest() {
    let mut v = vault_with_case();
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        "verified by phone with Dr Somchai".into(),
    );
}

#[test]
fn enrollment_waits_for_token_registration() {
    let mut v = vault_with_case();
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
    assert_eq!(
        v.get_payee("bih".into()).unwrap().status,
        PayeeStatus::PendingRegistration
    );
    assert_eq!(
        v.get_payee_id_by_account(acct(HOSPITAL)),
        Some("bih".to_string())
    );
}

#[test]
fn unregistered_account_is_rejected_and_released() {
    let mut v = vault_with_case();
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
    as_caller(VAULT, NearToken::from_yoctonear(0));
    assert_eq!(
        v.on_payee_registration_checked("bih".into(), 1, Ok(None)),
        PayeeStatus::Rejected
    );
    assert_eq!(v.get_payee_id_by_account(acct(HOSPITAL)), None);
}

#[test]
fn failed_registration_lookup_rejects() {
    let mut v = vault_with_case();
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
    as_caller(VAULT, NearToken::from_yoctonear(0));
    assert_eq!(
        v.on_payee_registration_checked("bih".into(), 1, Err(PromiseError::Failed)),
        PayeeStatus::Rejected
    );
}

#[test]
fn stale_registration_callback_is_ignored() {
    let mut v = vault_with_active_payee();
    let before = v.get_payee("bih".into()).unwrap();
    as_caller(VAULT, NearToken::from_yoctonear(0));
    // Replaying the version-1 callback after activation changes nothing.
    assert_eq!(
        v.on_payee_registration_checked("bih".into(), 1, Ok(None)),
        PayeeStatus::Active
    );
    assert_eq!(v.get_payee("bih".into()).unwrap(), before);
}

#[test]
#[should_panic(expected = "E_PAYEE_ACCOUNT_IN_USE")]
fn one_account_one_payee() {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih-2".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
}

#[test]
fn revoke_and_reenroll_bumps_version() {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    let revoked = v.revoke_payee("bih".into());
    assert_eq!(revoked.status, PayeeStatus::Revoked);
    assert_eq!(revoked.payee_version, 3);
    assert_eq!(v.get_payee_id_by_account(acct(HOSPITAL)), None);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
    assert_eq!(v.get_payee("bih".into()).unwrap().payee_version, 4);
}

// ----- invoices -------------------------------------------------------------------

#[test]
fn verifier_authorizes_invoice_for_active_payee() {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    let inv = v.authorize_invoice(
        "inv-0042".into(),
        CASE.into(),
        "bih".into(),
        U128(250_000_000),
    );
    assert_eq!(inv.status, InvoiceStatus::Authorized);
    assert_eq!((inv.paid.0, inv.reserved.0, inv.in_flight.0), (0, 0, 0));
}

#[test]
#[should_panic(expected = "E_NOT_VERIFIER")]
fn agent_cannot_authorize_invoice() {
    let mut v = vault_with_active_payee();
    as_caller(AGENT, ONE_YOCTO);
    v.authorize_invoice(
        "inv-0042".into(),
        CASE.into(),
        "bih".into(),
        U128(250_000_000),
    );
}

#[test]
#[should_panic(expected = "E_INVOICE_EXISTS")]
fn invoice_ids_are_never_reused() {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    v.authorize_invoice(
        "inv-0042".into(),
        CASE.into(),
        "bih".into(),
        U128(250_000_000),
    );
    v.revoke_invoice("inv-0042".into());
    v.authorize_invoice("inv-0042".into(), CASE.into(), "bih".into(), U128(1));
}

#[test]
#[should_panic(expected = "E_PAYEE_NOT_ACTIVE")]
fn invoice_needs_active_payee() {
    let mut v = vault_with_case();
    as_caller(VERIFIER, ONE_YOCTO);
    let _ = v.enroll_payee(
        "bih".into(),
        acct(HOSPITAL),
        PurposeGroup::Hospital,
        PROVENANCE.into(),
    );
    v.authorize_invoice(
        "inv-0042".into(),
        CASE.into(),
        "bih".into(),
        U128(250_000_000),
    );
}

#[test]
#[should_panic(expected = "E_CASE_NOT_FOUND")]
fn invoice_needs_existing_case() {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    v.authorize_invoice(
        "inv-0042".into(),
        "case-unknown".into(),
        "bih".into(),
        U128(1),
    );
}

#[test]
#[should_panic(expected = "E_AMOUNT")]
fn invoice_ceiling_must_be_positive() {
    let mut v = vault_with_active_payee();
    as_caller(VERIFIER, ONE_YOCTO);
    v.authorize_invoice("inv-0042".into(), CASE.into(), "bih".into(), U128(0));
}

// ----- deposits -------------------------------------------------------------------

#[test]
fn token_deposit_credits_case() {
    let mut v = vault_with_case();
    as_caller(TOKEN, NearToken::from_yoctonear(0));
    let left = v.ft_on_transfer(acct(FAMILY), U128(250_000_000), CASE.into());
    assert!(matches!(left, PromiseOrValue::Value(U128(0))));
    assert_eq!(v.get_case(CASE.into()).unwrap().balance.0, 250_000_000);
}

#[test]
fn deposit_for_unknown_case_is_returned() {
    let mut v = vault_with_case();
    as_caller(TOKEN, NearToken::from_yoctonear(0));
    let left = v.ft_on_transfer(acct(FAMILY), U128(5), "case-unknown".into());
    assert!(matches!(left, PromiseOrValue::Value(U128(5))));
}

#[test]
#[should_panic(expected = "E_WRONG_TOKEN")]
fn other_tokens_cannot_deposit() {
    let mut v = vault_with_case();
    as_caller("fake-usdc.test.near", NearToken::from_yoctonear(0));
    let _ = v.ft_on_transfer(acct(FAMILY), U128(5), CASE.into());
}
