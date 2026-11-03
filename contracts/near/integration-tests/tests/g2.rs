//! G2 sandbox tests: proposals, family approval, real token settlement,
//! failed transfers, stale approvals and bounds, against a local NEAR node.
//! Assertions check token balances and stored state, not only error labels.

mod common;

use common::*;
use near_workspaces::types::{AccessKey, KeyType, NearToken, SecretKey};
use near_workspaces::Account;
use serde_json::{json, Value};

const INVOICE: &str = "inv-bih-0042";

/// Case funded with 1,000 tUSDC, active hospital payee, invoice ceiling 1,000.
async fn ready() -> anyhow::Result<Env> {
    let env = setup().await?;
    create_case(&env).await?;
    enroll_hospital(&env, "bih", env.hospital.id()).await?;
    call(
        &env.verifier,
        env.vault.id(),
        "authorize_invoice",
        json!({ "invoice_id": INVOICE, "case_id": CASE, "payee_id": "bih", "ceiling": "1000000000" }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;
    deposit(&env, &env.family, &env.token, FAMILY_FUNDS, CASE)
        .await?
        .into_result()?;
    Ok(env)
}

async fn propose(
    env: &Env,
    as_who: &Account,
    request: &str,
    amount: u128,
    ttl: u32,
) -> anyhow::Result<Value> {
    Ok(call(
        as_who,
        env.vault.id(),
        "propose_payment",
        json!({
            "case_id": CASE,
            "invoice_id": INVOICE,
            "request_id": request,
            "amount": amount.to_string(),
            "ttl_seconds": ttl,
        }),
        NearToken::from_yoctonear(0),
    )
    .await?
    .into_result()?
    .json()?)
}

async fn preview(env: &Env, id: &Value) -> anyhow::Result<Value> {
    view(&env.vault, "approval_preview", json!({ "proposal_id": id })).await
}

/// The arguments a correct wallet request carries, taken from the preview.
fn approval_args(preview: &Value) -> Value {
    let p = &preview["proposal"];
    json!({
        "case_id": CASE,
        "proposal_id": p["proposal_id"],
        "expected_recipient": p["recipient"],
        "expected_token": p["token"],
        "expected_amount": p["amount"],
        "expected_policy_version": p["policy_version"],
        "expected_proposal_hash": preview["commitment_hash"],
    })
}

async fn approve(
    env: &Env,
    who: &Account,
    args: Value,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    call(who, env.vault.id(), "approve_payment", args, ONE_YOCTO).await
}

async fn proposal(env: &Env, id: &Value) -> anyhow::Result<Value> {
    view(&env.vault, "get_proposal", json!({ "proposal_id": id })).await
}

async fn the_case(env: &Env) -> anyhow::Result<Value> {
    view(&env.vault, "get_case", json!({ "case_id": CASE })).await
}

#[tokio::test]
async fn honest_payment_settles_to_the_enrolled_hospital() -> anyhow::Result<()> {
    let env = ready().await?;
    let p = propose(&env, &env.agent, "req-1", 250_000_000, 3600).await?;
    assert_eq!(
        p["recipient"],
        json!(env.hospital.id()),
        "recipient comes from enrollment"
    );

    let pv = preview(&env, &p["proposal_id"]).await?;
    assert_eq!(pv["blockers"], json!([]));
    approve(&env, &env.family, approval_args(&pv))
        .await?
        .into_result()?;

    assert_eq!(
        ft_balance(&env.token, env.hospital.id()).await?,
        250_000_000
    );
    assert_eq!(ft_balance(&env.token, env.vault.id()).await?, 750_000_000);
    let c = the_case(&env).await?;
    assert_eq!(u128_field(&c, "balance"), 750_000_000);
    assert_eq!(u128_field(&c, "paid"), 250_000_000);
    assert_eq!(
        (u128_field(&c, "reserved"), u128_field(&c, "in_flight")),
        (0, 0)
    );
    assert_eq!(
        proposal(&env, &p["proposal_id"]).await?["status"],
        json!("Settled")
    );
    let inv = view(&env.vault, "get_invoice", json!({ "invoice_id": INVOICE })).await?;
    assert_eq!(u128_field(&inv, "paid"), 250_000_000);
    Ok(())
}

#[tokio::test]
async fn every_altered_approval_field_is_refused_and_nothing_moves() -> anyhow::Result<()> {
    let env = ready().await?;
    let p = propose(&env, &env.agent, "req-1", 250_000_000, 3600).await?;
    let good = approval_args(&preview(&env, &p["proposal_id"]).await?);

    let cases: [(&str, Value, &str); 5] = [
        (
            "expected_recipient",
            json!(env.attacker.id()),
            "E_FIELD_MISMATCH",
        ),
        (
            "expected_token",
            json!("fake-usdc.test.near"),
            "E_FIELD_MISMATCH",
        ),
        ("expected_amount", json!("250000001"), "E_FIELD_MISMATCH"),
        ("expected_policy_version", json!(2), "E_STALE_POLICY"),
        (
            "expected_proposal_hash",
            json!("0000000000000000000000000000000000000000000000000000000000000000"),
            "E_COMMITMENT_MISMATCH",
        ),
    ];
    for (field, value, code) in cases {
        let mut args = good.clone();
        args[field] = value;
        let text = failure(approve(&env, &env.family, args).await?);
        assert!(text.contains(code), "{field}: {text}");
    }
    assert_eq!(ft_balance(&env.token, env.hospital.id()).await?, 0);
    assert_eq!(ft_balance(&env.token, env.attacker.id()).await?, 0);
    assert_eq!(
        proposal(&env, &p["proposal_id"]).await?["status"],
        json!("PendingApproval")
    );

    // The untouched request still works afterwards.
    approve(&env, &env.family, good).await?.into_result()?;
    assert_eq!(
        ft_balance(&env.token, env.hospital.id()).await?,
        250_000_000
    );
    Ok(())
}

/// The agent's real key is a function-call key limited to proposing. It can
/// propose, but neither it nor the agent's full account can approve, and a
/// limited key listing `approve_payment` is stopped by the protocol.
#[tokio::test]
async fn agent_can_propose_but_never_approve() -> anyhow::Result<()> {
    let env = ready().await?;
    let sk = SecretKey::from_random(KeyType::ED25519);
    env.agent
        .batch(env.agent.id())
        .add_key(
            sk.public_key(),
            AccessKey::function_call_access(
                env.vault.id(),
                &["propose_payment", "approve_payment"],
                None,
            ),
        )
        .transact()
        .await?
        .into_result()?;
    let agent_key = Account::from_secret_key(env.agent.id().clone(), sk, &env.worker);

    let p = propose(&env, &agent_key, "req-1", 250_000_000, 3600).await?;
    let args = approval_args(&preview(&env, &p["proposal_id"]).await?);

    let limited = agent_key
        .call(env.vault.id(), "approve_payment")
        .args_json(args.clone())
        .deposit(ONE_YOCTO)
        .max_gas()
        .transact()
        .await;
    let text = match limited {
        Err(e) => format!("{e:?}"),
        Ok(o) => failure(o),
    };
    assert!(text.contains("DepositWithFunctionCall"), "{text}");

    for who in [&env.agent, &env.attacker, &env.verifier] {
        assert!(failure(approve(&env, who, args.clone()).await?).contains("E_NOT_OWNER"));
    }
    let r = propose(&env, &env.family, "req-2", 1, 60).await;
    assert!(format!("{:?}", r.unwrap_err()).contains("E_NOT_AGENT"));

    assert_eq!(ft_balance(&env.token, env.hospital.id()).await?, 0);
    assert_eq!(ft_balance(&env.token, env.vault.id()).await?, FAMILY_FUNDS);
    Ok(())
}

/// The hospital closes its token account after the proposal. The transfer
/// fails, the callback restores the case once, and a fresh request retries.
#[tokio::test]
async fn failed_transfer_restores_funds_once_and_a_retry_settles() -> anyhow::Result<()> {
    let env = ready().await?;
    let p = propose(&env, &env.agent, "req-1", 300_000_000, 3600).await?;
    call(
        &env.hospital,
        env.token.id(),
        "storage_unregister",
        json!({}),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;

    approve(
        &env,
        &env.family,
        approval_args(&preview(&env, &p["proposal_id"]).await?),
    )
    .await?
    .into_result()?;
    let failed = proposal(&env, &p["proposal_id"]).await?;
    assert_eq!(failed["status"], json!("Failed"));
    assert_eq!(failed["status_reason"], json!("E_TRANSFER_FAILED"));
    let c = the_case(&env).await?;
    assert_eq!(u128_field(&c, "balance"), FAMILY_FUNDS);
    assert_eq!(
        (u128_field(&c, "in_flight"), u128_field(&c, "paid")),
        (0, 0)
    );
    assert_eq!(ft_balance(&env.token, env.vault.id()).await?, FAMILY_FUNDS);

    // A forged callback cannot settle or fail anything.
    let r = call(
        &env.attacker,
        env.vault.id(),
        "on_transfer_complete",
        json!({ "proposal_id": p["proposal_id"] }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert!(failure(r).contains("is private"));

    register(&env.token, env.hospital.id()).await?;
    let retry = propose(&env, &env.agent, "req-2", 300_000_000, 3600).await?;
    assert_eq!(retry["attempt"], json!(2));
    approve(
        &env,
        &env.family,
        approval_args(&preview(&env, &retry["proposal_id"]).await?),
    )
    .await?
    .into_result()?;
    assert_eq!(
        ft_balance(&env.token, env.hospital.id()).await?,
        300_000_000
    );
    assert_eq!(u128_field(&the_case(&env).await?, "paid"), 300_000_000);
    Ok(())
}

#[tokio::test]
async fn a_proposal_is_paid_at_most_once() -> anyhow::Result<()> {
    let env = ready().await?;
    let p = propose(&env, &env.agent, "req-1", 200_000_000, 3600).await?;
    let args = approval_args(&preview(&env, &p["proposal_id"]).await?);
    approve(&env, &env.family, args.clone())
        .await?
        .into_result()?;
    assert!(failure(approve(&env, &env.family, args).await?).contains("E_BAD_STATE"));

    // The same request id returns the settled proposal instead of a new one.
    let again = propose(&env, &env.agent, "req-1", 200_000_000, 3600).await?;
    assert_eq!(again["proposal_id"], p["proposal_id"]);
    assert_eq!(again["status"], json!("Settled"));
    assert_eq!(
        ft_balance(&env.token, env.hospital.id()).await?,
        200_000_000
    );
    Ok(())
}

#[tokio::test]
async fn changes_after_a_proposal_make_it_unapprovable_and_release_funds() -> anyhow::Result<()> {
    let env = ready().await?;

    // Policy lowered: the proposal is invalidated at once, so the old
    // approval request finds nothing awaiting approval.
    let a = propose(&env, &env.agent, "a", 100_000_000, 3600).await?;
    let a_args = approval_args(&preview(&env, &a["proposal_id"]).await?);
    let mut lower = limits();
    lower["per_payment_max"] = json!("200000000");
    call(
        &env.family,
        env.vault.id(),
        "lower_limits",
        json!({ "case_id": CASE, "limits": lower }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;
    let invalidated = proposal(&env, &a["proposal_id"]).await?;
    assert_eq!(invalidated["status"], json!("Invalidated"));
    assert_eq!(invalidated["status_reason"], json!("E_STALE_POLICY"));
    assert!(failure(approve(&env, &env.family, a_args).await?).contains("E_BAD_STATE"));

    // Pause.
    let b = propose(&env, &env.agent, "b", 100_000_000, 3600).await?;
    call(
        &env.family,
        env.vault.id(),
        "pause",
        json!({ "case_id": CASE }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;
    assert_eq!(
        proposal(&env, &b["proposal_id"]).await?["status"],
        json!("Invalidated")
    );
    call(
        &env.family,
        env.vault.id(),
        "unpause",
        json!({ "case_id": CASE }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;

    // Payee revoked by the verifier: approval refused, anyone can release it.
    let c = propose(&env, &env.agent, "c", 100_000_000, 3600).await?;
    let c_args = approval_args(&preview(&env, &c["proposal_id"]).await?);
    call(
        &env.verifier,
        env.vault.id(),
        "revoke_payee",
        json!({ "payee_id": "bih" }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;
    assert!(failure(approve(&env, &env.family, c_args).await?).contains("E_PAYEE_CHANGED"));
    assert_eq!(u128_field(&the_case(&env).await?, "reserved"), 100_000_000);
    let released: u32 = call(
        &env.attacker,
        env.vault.id(),
        "sweep",
        json!({ "case_id": CASE }),
        NearToken::from_yoctonear(0),
    )
    .await?
    .into_result()?
    .json()?;
    assert_eq!(released, 1);

    let state = the_case(&env).await?;
    assert_eq!(u128_field(&state, "reserved"), 0);
    assert_eq!(state["pending"], json!([]));
    assert_eq!(ft_balance(&env.token, env.hospital.id()).await?, 0);
    Ok(())
}

#[tokio::test]
async fn reservations_stop_overspending_at_the_cap() -> anyhow::Result<()> {
    let env = ready().await?;
    // Hospital group cap is 400 per 24h.
    let a = propose(&env, &env.agent, "a", 300_000_000, 3600).await?;
    let r = propose(&env, &env.agent, "b", 100_000_001, 3600).await;
    assert!(format!("{:?}", r.unwrap_err()).contains("E_CAP_GROUP"));
    let b = propose(&env, &env.agent, "b2", 100_000_000, 3600).await?;

    approve(
        &env,
        &env.family,
        approval_args(&preview(&env, &a["proposal_id"]).await?),
    )
    .await?
    .into_result()?;
    approve(
        &env,
        &env.family,
        approval_args(&preview(&env, &b["proposal_id"]).await?),
    )
    .await?
    .into_result()?;
    let r = propose(&env, &env.agent, "c", 1, 3600).await;
    assert!(format!("{:?}", r.unwrap_err()).contains("E_CAP_GROUP"));
    assert_eq!(
        ft_balance(&env.token, env.hospital.id()).await?,
        400_000_000
    );
    Ok(())
}

#[tokio::test]
async fn expired_proposal_cannot_be_approved_and_is_released() -> anyhow::Result<()> {
    let env = ready().await?;
    let p = propose(&env, &env.agent, "req-1", 100_000_000, 1).await?;
    let args = approval_args(&preview(&env, &p["proposal_id"]).await?);
    env.worker.fast_forward(20).await?;
    assert!(failure(approve(&env, &env.family, args).await?).contains("E_EXPIRED"));
    call(
        &env.attacker,
        env.vault.id(),
        "sweep",
        json!({ "case_id": CASE }),
        NearToken::from_yoctonear(0),
    )
    .await?
    .into_result()?;
    assert_eq!(
        proposal(&env, &p["proposal_id"]).await?["status"],
        json!("Expired")
    );
    assert_eq!(u128_field(&the_case(&env).await?, "reserved"), 0);
    Ok(())
}

#[tokio::test]
async fn owner_withdraws_unreserved_funds_only() -> anyhow::Result<()> {
    let env = ready().await?;
    propose(&env, &env.agent, "req-1", 300_000_000, 3600).await?;
    let r = call(
        &env.family,
        env.vault.id(),
        "withdraw",
        json!({ "case_id": CASE, "amount": "700000001" }),
        ONE_YOCTO,
    )
    .await?;
    assert!(failure(r).contains("E_LIQUIDITY"));
    let r = call(
        &env.attacker,
        env.vault.id(),
        "withdraw",
        json!({ "case_id": CASE, "amount": "1" }),
        ONE_YOCTO,
    )
    .await?;
    assert!(failure(r).contains("E_NOT_OWNER"));

    call(
        &env.family,
        env.vault.id(),
        "withdraw",
        json!({ "case_id": CASE, "amount": "700000000" }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;
    assert_eq!(ft_balance(&env.token, env.family.id()).await?, 700_000_000);
    assert_eq!(ft_balance(&env.token, env.vault.id()).await?, 300_000_000);
    assert_eq!(u128_field(&the_case(&env).await?, "balance"), 300_000_000);
    Ok(())
}

#[tokio::test]
async fn proposals_for_another_cases_invoice_are_refused() -> anyhow::Result<()> {
    let env = ready().await?;
    call(
        &env.attacker,
        env.vault.id(),
        "create_case",
        json!({ "case_id": "case-attacker", "limits": limits() }),
        NearToken::from_millinear(100),
    )
    .await?
    .into_result()?;
    let r = call(
        &env.agent,
        env.vault.id(),
        "propose_payment",
        json!({
            "case_id": "case-attacker",
            "invoice_id": INVOICE,
            "request_id": "x",
            "amount": "1",
            "ttl_seconds": 60,
        }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert!(failure(r).contains("E_INVOICE_CASE_MISMATCH"));
    Ok(())
}
