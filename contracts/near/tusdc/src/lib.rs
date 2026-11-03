//! Kinwarden Test USD (tUSDC): a standard NEP-141 token for sandbox and testnet
//! demos. It is a test token with no value and is never described as USDC.
//! Only the owner set at initialization can mint.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    assert_one_yocto, env, log, near, require, AccountId, BorshStorageKey, NearToken,
    PanicOnDefault, PromiseOrValue,
};

pub const DECIMALS: u8 = 6;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    FungibleToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestToken {
    owner_id: AccountId,
    token: FungibleToken,
}

#[near]
impl TestToken {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        let mut this = Self {
            owner_id: owner_id.clone(),
            token: FungibleToken::new(StorageKey::FungibleToken),
        };
        this.token.internal_register_account(&owner_id);
        this
    }

    /// Mints test tokens to a storage-registered account. Owner only.
    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.owner_id,
            "E_NOT_MINTER: only the token owner can mint"
        );
        require!(amount.0 > 0, "E_AMOUNT: amount must be positive");
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("Kinwarden test mint"),
        }
        .emit();
    }

    pub fn owner(&self) -> AccountId {
        self.owner_id.clone()
    }
}

#[near]
impl FungibleTokenCore for TestToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for TestToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Kinwarden Test USD (test token, no value)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}
