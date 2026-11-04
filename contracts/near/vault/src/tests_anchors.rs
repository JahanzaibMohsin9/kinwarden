//! Unit tests for activity-log anchors.

use super::anchors::MAX_ANCHORS_PER_CASE;
use super::tests::*;
use super::*;

const HEAD: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

fn anchor(v: &mut Vault, seq: u64) -> anchors::LogAnchor {
    as_caller(AGENT, NearToken::from_yoctonear(0));
    v.anchor_log(
        CASE.into(),
        U64(seq),
        HEAD.into(),
        "th-medical:payment approved".into(),
    )
}

#[test]
fn agent_anchors_in_order_and_anchors_are_readable() {
    let mut v = vault_with_case();
    let a = anchor(&mut v, 5);
    assert_eq!((a.index, a.seq), (U64(0), U64(5)));
    let b = anchor(&mut v, 9);
    assert_eq!(b.index, U64(1));
    assert_eq!(v.get_anchor_count(CASE.into()), U64(2));
    assert_eq!(v.get_anchor(CASE.into(), U64(1)), Some(b));
    assert_eq!(v.get_anchor(CASE.into(), U64(2)), None);
}

#[test]
#[should_panic(expected = "E_NOT_AGENT")]
fn only_the_agent_anchors() {
    let mut v = vault_with_case();
    as_caller(FAMILY, NearToken::from_yoctonear(0));
    v.anchor_log(CASE.into(), U64(1), HEAD.into(), "x".into());
}

#[test]
#[should_panic(expected = "E_CASE_NOT_FOUND")]
fn anchors_need_an_existing_case() {
    let mut v = vault();
    as_caller(AGENT, NearToken::from_yoctonear(0));
    v.anchor_log("case-none".into(), U64(1), HEAD.into(), "x".into());
}

#[test]
fn anchors_are_append_only() {
    let mut v = vault_with_case();
    let first = anchor(&mut v, 9);
    // A reset world anchors from seq 1 again: a new entry, the old one unchanged.
    let again = anchor(&mut v, 1);
    assert_eq!(again.index, U64(1));
    assert_eq!(v.get_anchor(CASE.into(), U64(0)), Some(first));
}

#[test]
#[should_panic(expected = "E_ANCHOR_HEAD")]
fn head_must_be_a_sha256_hex_digest() {
    let mut v = vault_with_case();
    as_caller(AGENT, NearToken::from_yoctonear(0));
    v.anchor_log(CASE.into(), U64(1), HEAD.to_uppercase(), "x".into());
}

#[test]
#[should_panic(expected = "E_ANCHOR_LABEL")]
fn label_is_short_printable_text() {
    let mut v = vault_with_case();
    as_caller(AGENT, NearToken::from_yoctonear(0));
    v.anchor_log(CASE.into(), U64(1), HEAD.into(), "a".repeat(97));
}

#[test]
#[should_panic(expected = "E_BOUND_ANCHORS")]
fn anchors_per_case_are_bounded() {
    let mut v = vault_with_case();
    for seq in 1..=MAX_ANCHORS_PER_CASE + 1 {
        anchor(&mut v, seq);
    }
}
