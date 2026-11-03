//! Shared sandbox setup: test token, vault, and one account per role.

#![allow(dead_code)]

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};
use tokio::sync::OnceCell;

pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const CASE: &str = "case-th-hosp-001";
pub const PROVENANCE: &str = "4f6c1a0e2b9d8c7f6e5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e";
/// 1,000 tUSDC (6 decimals).
pub const FAMILY_FUNDS: u128 = 1_000_000_000;

static WASM: OnceCell<(Vec<u8>, Vec<u8>)> = OnceCell::const_new();

/// Builds both contracts once per test binary.
pub async fn wasm() -> anyhow::Result<&'static (Vec<u8>, Vec<u8>)> {
    WASM.get_or_try_init(|| async {
        let vault = near_workspaces::compile_project("../vault").await?;
        let token = near_workspaces::compile_project("../tusdc").await?;
        anyhow::Ok((vault, token))
    })
    .await
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub vault: Contract,
    pub token: Contract,
    pub family: Account,
    pub verifier: Account,
    pub agent: Account,
    pub hospital: Account,
    pub attacker: Account,
}

pub async fn account(worker: &Worker<Sandbox>, name: &str) -> anyhow::Result<Account> {
    Ok(worker
        .root_account()?
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?)
}

pub async fn deploy_token(worker: &Worker<Sandbox>, name: &str) -> anyhow::Result<Contract> {
    let (_, token_wasm) = wasm().await?;
    let token = account(worker, name)
        .await?
        .deploy(token_wasm)
        .await?
        .into_result()?;
    token
        .call("new")
        .args_json(json!({ "owner_id": token.id() }))
        .transact()
        .await?
        .into_result()?;
    Ok(token)
}

pub async fn register(token: &Contract, who: &AccountId) -> anyhow::Result<()> {
    token
        .as_account()
        .call(token.id(), "storage_deposit")
        .args_json(json!({ "account_id": who }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

pub async fn mint(token: &Contract, to: &AccountId, amount: u128) -> anyhow::Result<()> {
    token
        .as_account()
        .call(token.id(), "mint")
        .args_json(json!({ "account_id": to, "amount": amount.to_string() }))
        .deposit(ONE_YOCTO)
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

pub async fn setup() -> anyhow::Result<Env> {
    let (vault_wasm, _) = wasm().await?;
    let worker = near_workspaces::sandbox().await?;
    let token = deploy_token(&worker, "tusdc").await?;
    let family = account(&worker, "family").await?;
    let verifier = account(&worker, "verifier").await?;
    let agent = account(&worker, "agent").await?;
    let hospital = account(&worker, "hospital").await?;
    let attacker = account(&worker, "attacker").await?;
    let vault = account(&worker, "vault")
        .await?
        .deploy(vault_wasm)
        .await?
        .into_result()?;
    vault
        .call("new")
        .args_json(json!({
            "token": token.id(),
            "verifier": verifier.id(),
            "agent": agent.id(),
            "network": "sandbox",
        }))
        .transact()
        .await?
        .into_result()?;
    for who in [vault.id(), family.id(), hospital.id(), attacker.id()] {
        register(&token, who).await?;
    }
    mint(&token, family.id(), FAMILY_FUNDS).await?;
    Ok(Env {
        worker,
        vault,
        token,
        family,
        verifier,
        agent,
        hospital,
        attacker,
    })
}

pub fn limits() -> Value {
    json!({
        "per_payment_max": "300000000",
        "rolling_24h_cap": "500000000",
        "lifetime_cap": "2000000000",
        "group_caps": [{ "group": "Hospital", "rolling_24h_cap": "400000000" }],
    })
}

pub async fn call(
    who: &Account,
    contract: &AccountId,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(who
        .call(contract, method)
        .args_json(args)
        .deposit(deposit)
        .max_gas()
        .transact()
        .await?)
}

/// Panics unless the transaction failed; returns the failure text.
pub fn failure(result: ExecutionFinalResult) -> String {
    match result.into_result() {
        Ok(ok) => panic!("expected failure, got success: {ok:?}"),
        Err(e) => format!("{e:?}"),
    }
}

pub async fn create_case(env: &Env) -> anyhow::Result<()> {
    call(
        &env.family,
        env.vault.id(),
        "create_case",
        json!({ "case_id": CASE, "limits": limits() }),
        NearToken::from_millinear(100),
    )
    .await?
    .into_result()?;
    Ok(())
}

pub async fn enroll_hospital(
    env: &Env,
    payee_id: &str,
    account: &AccountId,
) -> anyhow::Result<Value> {
    call(
        &env.verifier,
        env.vault.id(),
        "enroll_payee",
        json!({
            "payee_id": payee_id,
            "account": account,
            "purpose_group": "Hospital",
            "provenance": PROVENANCE,
        }),
        ONE_YOCTO,
    )
    .await?
    .into_result()?;
    view(&env.vault, "get_payee", json!({ "payee_id": payee_id })).await
}

pub async fn deposit(
    env: &Env,
    from: &Account,
    token: &Contract,
    amount: u128,
    msg: &str,
) -> anyhow::Result<ExecutionFinalResult> {
    call(
        from,
        token.id(),
        "ft_transfer_call",
        json!({ "receiver_id": env.vault.id(), "amount": amount.to_string(), "msg": msg }),
        ONE_YOCTO,
    )
    .await
}

pub async fn view(contract: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(contract.view(method).args_json(args).await?.json()?)
}

pub async fn ft_balance(token: &Contract, who: &AccountId) -> anyhow::Result<u128> {
    let v = view(token, "ft_balance_of", json!({ "account_id": who })).await?;
    Ok(v.as_str().unwrap().parse()?)
}

pub fn u128_field(v: &Value, key: &str) -> u128 {
    v[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key} missing in {v}"))
        .parse()
        .unwrap()
}
