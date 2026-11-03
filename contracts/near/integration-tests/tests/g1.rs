//! G1 sandbox tests: deployed vault + test token, real accounts and keys.
//! Each test asserts state or balances, not only an error label.

mod common;

use common::*;
use near_workspaces::types::{AccessKey, KeyType, NearToken, SecretKey};
use serde_json::json;

#[tokio::test]
async fn deposit_credits_case_and_unknown_case_is_refunded() -> anyhow::Result<()> {
    let env = setup().await?;
    create_case(&env).await?;

    deposit(&env, &env.family, &env.token, 250_000_000, CASE)
        .await?
        .into_result()?;
    let case = view(&env.vault, "get_case", json!({ "case_id": CASE })).await?;
    assert_eq!(u128_field(&case, "balance"), 250_000_000);
    assert_eq!(ft_balance(&env.token, env.vault.id()).await?, 250_000_000);
    assert_eq!(
        ft_balance(&env.token, env.family.id()).await?,
        FAMILY_FUNDS - 250_000_000
    );

    // Unknown case: the vault returns everything and nothing is credited.
    deposit(&env, &env.family, &env.token, 5_000_000, "case-unknown")
        .await?
        .into_result()?;
    assert_eq!(ft_balance(&env.token, env.vault.id()).await?, 250_000_000);
    assert_eq!(
        ft_balance(&env.token, env.family.id()).await?,
        FAMILY_FUNDS - 250_000_000
    );
    Ok(())
}

#[tokio::test]
async fn relative_can_fund_a_case() -> anyhow::Result<()> {
    let env = setup().await?;
    create_case(&env).await?;
    let uncle = account(&env.worker, "uncle").await?;
    register(&env.token, uncle.id()).await?;
    mint(&env.token, uncle.id(), 40_000_000).await?;
    deposit(&env, &uncle, &env.token, 40_000_000, CASE)
        .await?
        .into_result()?;
    let case = view(&env.vault, "get_case", json!({ "case_id": CASE })).await?;
    assert_eq!(u128_field(&case, "balance"), 40_000_000);
    assert_eq!(case["owner"], json!(env.family.id()));
    Ok(())
}

#[tokio::test]
async fn vault_only_accepts_its_configured_token() -> anyhow::Result<()> {
    let env = setup().await?;
    create_case(&env).await?;

    // A lookalike token deployed by the attacker.
    let fake = deploy_token(&env.worker, "fake-usdc").await?;
    register(&fake, env.vault.id()).await?;
    register(&fake, env.attacker.id()).await?;
    mint(&fake, env.attacker.id(), 999_000_000).await?;
    deposit(&env, &env.attacker, &fake, 999_000_000, CASE)
        .await?
        .into_result()?;

    let case = view(&env.vault, "get_case", json!({ "case_id": CASE })).await?;
    assert_eq!(
        u128_field(&case, "balance"),
        0,
        "fake token must not credit the case"
    );
    assert_eq!(
        ft_balance(&fake, env.attacker.id()).await?,
        999_000_000,
        "refunded by the fake token"
    );
    assert_eq!(ft_balance(&fake, env.vault.id()).await?, 0);

    // Calling the receiver hook directly is refused too.
    let direct = call(
        &env.attacker,
        env.vault.id(),
        "ft_on_transfer",
        json!({ "sender_id": env.attacker.id(), "amount": "999000000", "msg": CASE }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert!(failure(direct).contains("E_WRONG_TOKEN"));
    let case = view(&env.vault, "get_case", json!({ "case_id": CASE })).await?;
    assert_eq!(u128_field(&case, "balance"), 0);
    Ok(())
}

#[tokio::test]
async fn payee_becomes_active_only_when_registered_on_the_token() -> anyhow::Result<()> {
    let env = setup().await?;
    let payee = enroll_hospital(&env, "bih", env.hospital.id()).await?;
    assert_eq!(payee["status"], json!("Active"));
    assert_eq!(payee["payee_version"], json!(2));

    let clinic = account(&env.worker, "unregistered-clinic").await?;
    let payee = enroll_hospital(&env, "clinic", clinic.id()).await?;
    assert_eq!(payee["status"], json!("Rejected"));
    let owner = view(
        &env.vault,
        "get_payee_id_by_account",
        json!({ "account": clinic.id() }),
    )
    .await?;
    assert!(owner.is_null(), "rejected account is released");
    Ok(())
}

/// `#[private]` is enforced in the deployed contract's entry point, so this is
/// tested against the sandbox rather than in unit tests.
#[tokio::test]
async fn registration_callback_cannot_be_forged() -> anyhow::Result<()> {
    let env = setup().await?;
    let clinic = account(&env.worker, "unregistered-clinic").await?;
    let payee = enroll_hospital(&env, "clinic", clinic.id()).await?;
    assert_eq!(payee["status"], json!("Rejected"));

    // The attacker tries to deliver a "registered" answer in place of the token.
    let r = call(
        &env.attacker,
        env.vault.id(),
        "on_payee_registration_checked",
        json!({ "payee_id": "clinic", "payee_version": 2 }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert!(failure(r).contains("is private"));
    let payee = view(&env.vault, "get_payee", json!({ "payee_id": "clinic" })).await?;
    assert_eq!(payee["status"], json!("Rejected"));
    Ok(())
}

#[tokio::test]
async fn only_the_verifier_enrolls_and_authorizes() -> anyhow::Result<()> {
    let env = setup().await?;
    create_case(&env).await?;
    enroll_hospital(&env, "bih", env.hospital.id()).await?;

    for who in [&env.agent, &env.family, &env.attacker] {
        let r = call(
            who,
            env.vault.id(),
            "enroll_payee",
            json!({
                "payee_id": "evil",
                "account": env.attacker.id(),
                "purpose_group": "Hospital",
                "provenance": PROVENANCE,
            }),
            ONE_YOCTO,
        )
        .await?;
        assert!(failure(r).contains("E_NOT_VERIFIER"));

        let r = call(
            who,
            env.vault.id(),
            "authorize_invoice",
            json!({ "invoice_id": "inv-evil", "case_id": CASE, "payee_id": "bih", "ceiling": "1" }),
            ONE_YOCTO,
        )
        .await?;
        assert!(failure(r).contains("E_NOT_VERIFIER"));
    }
    assert!(view(&env.vault, "get_payee", json!({ "payee_id": "evil" }))
        .await?
        .is_null());
    assert!(view(
        &env.vault,
        "get_invoice",
        json!({ "invoice_id": "inv-evil" })
    )
    .await?
    .is_null());
    Ok(())
}

/// Even a function-call key that lists the privileged methods cannot use them,
/// because each requires a deposit and the protocol forbids deposits from
/// function-call keys. The agent's real key is narrower still (G2).
#[tokio::test]
async fn function_call_key_cannot_call_any_deposit_method() -> anyhow::Result<()> {
    let env = setup().await?;
    create_case(&env).await?;

    let methods = [
        "pause",
        "lower_limits",
        "enroll_payee",
        "authorize_invoice",
        "create_case",
    ];
    for holder in [&env.family, &env.verifier] {
        let sk = SecretKey::from_random(KeyType::ED25519);
        holder
            .batch(holder.id())
            .add_key(
                sk.public_key(),
                AccessKey::function_call_access(env.vault.id(), &methods, None),
            )
            .transact()
            .await?
            .into_result()?;
        let limited =
            near_workspaces::Account::from_secret_key(holder.id().clone(), sk, &env.worker);
        let r = limited
            .call(env.vault.id(), "pause")
            .args_json(json!({ "case_id": CASE }))
            .deposit(ONE_YOCTO)
            .transact()
            .await;
        let text = match r {
            Err(e) => format!("{e:?}"),
            Ok(o) => failure(o),
        };
        assert!(text.contains("DepositWithFunctionCall"), "{text}");
    }
    let case = view(&env.vault, "get_case", json!({ "case_id": CASE })).await?;
    assert_eq!(case["status"], json!("Active"));
    Ok(())
}

#[tokio::test]
async fn only_the_owner_controls_a_case() -> anyhow::Result<()> {
    let env = setup().await?;
    create_case(&env).await?;

    for (who, method) in [
        (&env.attacker, "pause"),
        (&env.agent, "pause"),
        (&env.agent, "revoke_agent"),
    ] {
        let r = call(
            who,
            env.vault.id(),
            method,
            json!({ "case_id": CASE }),
            ONE_YOCTO,
        )
        .await?;
        assert!(failure(r).contains("E_NOT_OWNER"));
    }
    let r = call(
        &env.family,
        env.vault.id(),
        "pause",
        json!({ "case_id": CASE }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert!(failure(r).contains("E_ONE_YOCTO"));
    assert_eq!(
        view(&env.vault, "get_case", json!({ "case_id": CASE })).await?["status"],
        json!("Active")
    );

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
        view(&env.vault, "get_case", json!({ "case_id": CASE })).await?["status"],
        json!("Paused")
    );

    let mut higher = limits();
    higher["lifetime_cap"] = json!("3000000000");
    let r = call(
        &env.family,
        env.vault.id(),
        "lower_limits",
        json!({ "case_id": CASE, "limits": higher }),
        ONE_YOCTO,
    )
    .await?;
    assert!(failure(r).contains("E_LIMITS_NOT_LOWER"));

    let mut lower = limits();
    lower["per_payment_max"] = json!("100000000");
    call(
        &env.family,
        env.vault.id(),
        "lower_limits",
        json!({ "case_id": CASE, "limits": lower }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;
    let case = view(&env.vault, "get_case", json!({ "case_id": CASE })).await?;
    assert_eq!(case["policy_version"], json!(2));
    assert_eq!(case["limits"]["per_payment_max"], json!("100000000"));
    Ok(())
}

#[tokio::test]
async fn invoices_are_canonical_and_bound_to_active_payees() -> anyhow::Result<()> {
    let env = setup().await?;
    create_case(&env).await?;
    enroll_hospital(&env, "bih", env.hospital.id()).await?;
    let authorize = |invoice: &'static str, case: &'static str, ceiling: &'static str| {
        let env = &env;
        async move {
            call(
                &env.verifier,
                env.vault.id(),
                "authorize_invoice",
                json!({ "invoice_id": invoice, "case_id": case, "payee_id": "bih", "ceiling": ceiling }),
                ONE_YOCTO,
            )
            .await
        }
    };

    authorize("inv-bih-0042", CASE, "250000000")
        .await?
        .into_result()?;
    let inv = view(
        &env.vault,
        "get_invoice",
        json!({ "invoice_id": "inv-bih-0042" }),
    )
    .await?;
    assert_eq!(inv["status"], json!("Authorized"));
    assert_eq!(u128_field(&inv, "ceiling"), 250_000_000);

    assert!(failure(authorize("inv-bih-0042", CASE, "1").await?).contains("E_INVOICE_EXISTS"));
    assert!(failure(authorize("inv-x", "case-unknown", "1").await?).contains("E_CASE_NOT_FOUND"));
    assert!(failure(authorize("Ayesha Khan bill", CASE, "1").await?).contains("E_ID_FORMAT"));

    call(
        &env.verifier,
        env.vault.id(),
        "revoke_payee",
        json!({ "payee_id": "bih" }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;
    assert!(failure(authorize("inv-bih-0043", CASE, "1").await?).contains("E_PAYEE_NOT_ACTIVE"));
    Ok(())
}

#[tokio::test]
async fn create_case_charges_storage_and_refunds_the_rest() -> anyhow::Result<()> {
    let env = setup().await?;
    let r = call(
        &env.family,
        env.vault.id(),
        "create_case",
        json!({ "case_id": CASE, "limits": limits() }),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert!(failure(r).contains("E_STORAGE_DEPOSIT"));

    let vault_before = env.vault.view_account().await?.balance;
    call(
        &env.family,
        env.vault.id(),
        "create_case",
        json!({ "case_id": CASE, "limits": limits() }),
        NearToken::from_near(1),
    )
    .await?
    .into_result()?;
    let vault_after = env.vault.view_account().await?.balance;
    let kept = vault_after
        .as_yoctonear()
        .saturating_sub(vault_before.as_yoctonear());
    assert!(
        kept < NearToken::from_millinear(50).as_yoctonear(),
        "vault kept {kept} yocto of 1 NEAR"
    );
    Ok(())
}
