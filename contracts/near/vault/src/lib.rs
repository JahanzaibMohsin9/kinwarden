//! Kinwarden vault: holds a family's test-token funds per case and will pay
//! only verifier-enrolled institutions against verifier-authorized invoices,
//! after the family approves the exact payment in their own wallet.
//!
//! This file: configuration, cases, payee and invoice enrollment, deposits and
//! views. `payments.rs`: proposals, approval, settlement and withdrawal.
//! Design: docs/near/DECISIONS.md, STATE_AND_ENCODING.md, THREAT_MODEL.md.

pub mod commitment;
pub mod errors;
pub mod ids;
mod payments;
pub mod types;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::StorageBalance;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, log, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub use types::*;

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_STORAGE_VIEW: Gas = Gas::from_tgas(5);
const GAS_REGISTRATION_CALLBACK: Gas = Gas::from_tgas(10);
const NETWORKS: [&str; 3] = ["sandbox", "testnet", "mainnet"];

#[ext_contract(ext_ft_storage)]
#[allow(dead_code)]
trait FtStorage {
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance>;
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Cases,
    Payees,
    PayeeByAccount,
    Invoices,
    Proposals,
    Requests,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    config: Config,
    cases: LookupMap<String, Case>,
    payees: LookupMap<String, Payee>,
    /// Account -> payee id, for pending and active payees only.
    payee_by_account: LookupMap<AccountId, String>,
    invoices: LookupMap<String, Invoice>,
    proposals: LookupMap<u64, Proposal>,
    /// "case_id/request_id" -> proposal id, for idempotent requests.
    requests: LookupMap<String, u64>,
    next_proposal_id: u64,
}

fn assert_one_yocto() {
    require!(env::attached_deposit() == ONE_YOCTO, errors::ONE_YOCTO);
}

fn now() -> U64 {
    U64(env::block_timestamp())
}

fn request_key(case_id: &str, request_id: &str) -> String {
    format!("{case_id}/{request_id}")
}

#[near]
impl Vault {
    #[init]
    pub fn new(token: AccountId, verifier: AccountId, agent: AccountId, network: String) -> Self {
        let vault = env::current_account_id();
        let roles = [&vault, &token, &verifier, &agent];
        for (i, a) in roles.iter().enumerate() {
            require!(!roles[..i].contains(a), errors::ROLE_CONFLICT);
        }
        require!(NETWORKS.contains(&network.as_str()), errors::BAD_NETWORK);
        Self {
            config: Config {
                token,
                verifier,
                agent,
                network,
            },
            cases: LookupMap::new(StorageKey::Cases),
            payees: LookupMap::new(StorageKey::Payees),
            payee_by_account: LookupMap::new(StorageKey::PayeeByAccount),
            invoices: LookupMap::new(StorageKey::Invoices),
            proposals: LookupMap::new(StorageKey::Proposals),
            requests: LookupMap::new(StorageKey::Requests),
            next_proposal_id: 1,
        }
    }

    // ----- Family (case owner) -------------------------------------------

    /// Opens a case owned by the caller. The caller pays the case's storage;
    /// any excess deposit is refunded. Limits are fixed here and can only be
    /// lowered later.
    #[payable]
    pub fn create_case(&mut self, case_id: String, limits: Limits) -> Case {
        ids::assert_opaque_id(&case_id);
        require!(!self.cases.contains_key(&case_id), errors::CASE_EXISTS);
        limits.validate();
        let owner = env::predecessor_account_id();
        require!(!self.is_role_account(&owner), errors::ROLE_CONFLICT);

        let case = Case {
            owner: owner.clone(),
            status: CaseStatus::Active,
            agent_enabled: true,
            policy_version: 1,
            limits,
            balance: U128(0),
            reserved: U128(0),
            in_flight: U128(0),
            paid: U128(0),
            created_at: now(),
            pending: Vec::new(),
            window: Vec::new(),
        };
        let before = env::storage_usage();
        self.cases.insert(case_id.clone(), case.clone());
        self.cases.flush();
        let used = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(u128::from(used));
        let attached = env::attached_deposit();
        require!(
            !attached.is_zero() && attached >= cost,
            errors::STORAGE_DEPOSIT
        );
        let refund = attached.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(owner).transfer(refund).detach();
        }
        log!("case_created {case_id}");
        case
    }

    /// Pausing blocks new proposals and approvals, and invalidates every
    /// proposal awaiting approval, releasing its reservation.
    #[payable]
    pub fn pause(&mut self, case_id: String) -> Case {
        assert_one_yocto();
        self.owned_case_mut(&case_id).status = CaseStatus::Paused;
        log!("case_paused {case_id}");
        self.sweep_case(&case_id);
        self.case_snapshot(&case_id)
    }

    #[payable]
    pub fn unpause(&mut self, case_id: String) -> Case {
        assert_one_yocto();
        let case = self.owned_case_mut(&case_id);
        case.status = CaseStatus::Active;
        log!("case_unpaused {case_id}");
        case.clone()
    }

    /// Stops the configured agent from acting on this case and invalidates its
    /// proposals awaiting approval.
    #[payable]
    pub fn revoke_agent(&mut self, case_id: String) -> Case {
        assert_one_yocto();
        self.owned_case_mut(&case_id).agent_enabled = false;
        log!("agent_revoked {case_id}");
        self.sweep_case(&case_id);
        self.case_snapshot(&case_id)
    }

    #[payable]
    pub fn enable_agent(&mut self, case_id: String) -> Case {
        assert_one_yocto();
        let case = self.owned_case_mut(&case_id);
        case.agent_enabled = true;
        log!("agent_enabled {case_id}");
        case.clone()
    }

    /// Replaces the limits with ones that are nowhere higher, and bumps the
    /// policy version so approvals made under the old policy fail.
    #[payable]
    pub fn lower_limits(&mut self, case_id: String, limits: Limits) -> Case {
        assert_one_yocto();
        limits.validate();
        let case = self.owned_case_mut(&case_id);
        require!(
            limits.not_higher_than(&case.limits),
            errors::LIMITS_NOT_LOWER
        );
        case.limits = limits;
        case.policy_version += 1;
        log!(
            "limits_lowered {case_id} policy_version={}",
            case.policy_version
        );
        // Proposals made under the old policy can no longer be approved.
        self.sweep_case(&case_id);
        self.case_snapshot(&case_id)
    }

    // ----- Verifier --------------------------------------------------------

    /// Enrolls an institution's token account. The payee becomes Active only
    /// after the token contract confirms the account is storage-registered,
    /// so the vault never targets an account that cannot receive.
    #[payable]
    pub fn enroll_payee(
        &mut self,
        payee_id: String,
        account: AccountId,
        purpose_group: PurposeGroup,
        provenance: String,
    ) -> Promise {
        self.assert_verifier();
        assert_one_yocto();
        ids::assert_opaque_id(&payee_id);
        ids::assert_provenance(&provenance);
        require!(
            !self.is_role_account(&account),
            errors::PAYEE_FORBIDDEN_ACCOUNT
        );
        require!(
            !self.payee_by_account.contains_key(&account),
            errors::PAYEE_ACCOUNT_IN_USE
        );
        let payee_version = match self.payees.get(&payee_id) {
            None => 1,
            Some(p) => {
                require!(
                    matches!(p.status, PayeeStatus::Rejected | PayeeStatus::Revoked),
                    errors::PAYEE_EXISTS
                );
                p.payee_version + 1
            }
        };
        self.payees.insert(
            payee_id.clone(),
            Payee {
                account: account.clone(),
                purpose_group,
                provenance,
                payee_version,
                status: PayeeStatus::PendingRegistration,
                updated_at: now(),
            },
        );
        self.payee_by_account
            .insert(account.clone(), payee_id.clone());
        log!("payee_enrolled {payee_id} version={payee_version}");

        ext_ft_storage::ext(self.config.token.clone())
            .with_static_gas(GAS_STORAGE_VIEW)
            .storage_balance_of(account)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_REGISTRATION_CALLBACK)
                    .on_payee_registration_checked(payee_id, payee_version),
            )
    }

    #[private]
    pub fn on_payee_registration_checked(
        &mut self,
        payee_id: String,
        payee_version: u64,
        #[callback_result] registration: Result<Option<StorageBalance>, PromiseError>,
    ) -> PayeeStatus {
        let payee = self
            .payees
            .get_mut(&payee_id)
            .unwrap_or_else(|| env::panic_str(errors::PAYEE_NOT_FOUND));
        // A late callback for an older enrollment must not change a newer one.
        if payee.payee_version != payee_version || payee.status != PayeeStatus::PendingRegistration
        {
            return payee.status;
        }
        payee.payee_version += 1;
        payee.updated_at = now();
        if matches!(registration, Ok(Some(_))) {
            payee.status = PayeeStatus::Active;
        } else {
            payee.status = PayeeStatus::Rejected;
            let account = payee.account.clone();
            self.payee_by_account.remove(&account);
        }
        log!(
            "payee_registration_checked {payee_id} status={:?}",
            payee.status
        );
        payee.status
    }

    #[payable]
    pub fn revoke_payee(&mut self, payee_id: String) -> Payee {
        self.assert_verifier();
        assert_one_yocto();
        let payee = self
            .payees
            .get_mut(&payee_id)
            .unwrap_or_else(|| env::panic_str(errors::PAYEE_NOT_FOUND));
        require!(
            matches!(
                payee.status,
                PayeeStatus::Active | PayeeStatus::PendingRegistration
            ),
            errors::PAYEE_NOT_ACTIVE
        );
        payee.status = PayeeStatus::Revoked;
        payee.payee_version += 1;
        payee.updated_at = now();
        let snapshot = payee.clone();
        self.payee_by_account.remove(&snapshot.account);
        log!(
            "payee_revoked {payee_id} version={}",
            snapshot.payee_version
        );
        snapshot
    }

    /// Authorizes one canonical invoice for one case and payee, up to a
    /// ceiling. Invoice ids are never reused, even after revocation.
    #[payable]
    pub fn authorize_invoice(
        &mut self,
        invoice_id: String,
        case_id: String,
        payee_id: String,
        ceiling: U128,
    ) -> Invoice {
        self.assert_verifier();
        assert_one_yocto();
        ids::assert_opaque_id(&invoice_id);
        require!(
            !self.invoices.contains_key(&invoice_id),
            errors::INVOICE_EXISTS
        );
        require!(self.cases.contains_key(&case_id), errors::CASE_NOT_FOUND);
        let payee = self
            .payees
            .get(&payee_id)
            .unwrap_or_else(|| env::panic_str(errors::PAYEE_NOT_FOUND));
        require!(
            payee.status == PayeeStatus::Active,
            errors::PAYEE_NOT_ACTIVE
        );
        require!(ceiling.0 > 0, errors::AMOUNT);
        let invoice = Invoice {
            case_id,
            payee_id,
            ceiling,
            paid: U128(0),
            reserved: U128(0),
            in_flight: U128(0),
            status: InvoiceStatus::Authorized,
            authorized_at: now(),
            attempts: 0,
        };
        self.invoices.insert(invoice_id.clone(), invoice.clone());
        log!("invoice_authorized {invoice_id}");
        invoice
    }

    #[payable]
    pub fn revoke_invoice(&mut self, invoice_id: String) -> Invoice {
        self.assert_verifier();
        assert_one_yocto();
        let invoice = self
            .invoices
            .get_mut(&invoice_id)
            .unwrap_or_else(|| env::panic_str(errors::INVOICE_NOT_FOUND));
        require!(
            invoice.status == InvoiceStatus::Authorized,
            errors::INVOICE_NOT_AUTHORIZED
        );
        invoice.status = InvoiceStatus::Revoked;
        let snapshot = invoice.clone();
        log!("invoice_revoked {invoice_id}");
        // Proposals for this invoice can no longer be approved.
        self.sweep_case(&snapshot.case_id);
        snapshot
    }

    // ----- Views -----------------------------------------------------------

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_case(&self, case_id: String) -> Option<Case> {
        self.cases.get(&case_id).cloned()
    }

    pub fn get_payee(&self, payee_id: String) -> Option<Payee> {
        self.payees.get(&payee_id).cloned()
    }

    pub fn get_payee_id_by_account(&self, account: AccountId) -> Option<String> {
        self.payee_by_account.get(&account).cloned()
    }

    pub fn get_invoice(&self, invoice_id: String) -> Option<Invoice> {
        self.invoices.get(&invoice_id).cloned()
    }

    pub fn get_proposal(&self, proposal_id: U64) -> Option<Proposal> {
        self.proposals.get(&proposal_id.0).cloned()
    }

    pub fn get_proposal_by_request(&self, case_id: String, request_id: String) -> Option<Proposal> {
        let id = self.requests.get(&request_key(&case_id, &request_id))?;
        self.proposals.get(id).cloned()
    }

    /// Proposals awaiting approval. Some may already be stale; `sweep` or any
    /// state-changing call on the case releases them.
    pub fn get_pending(&self, case_id: String) -> Vec<Proposal> {
        self.cases.get(&case_id).map_or_else(Vec::new, |c| {
            c.pending
                .iter()
                .filter_map(|id| self.proposals.get(id).cloned())
                .collect()
        })
    }

    // ----- Internal ----------------------------------------------------------

    fn assert_verifier(&self) {
        require!(
            env::predecessor_account_id() == self.config.verifier,
            errors::NOT_VERIFIER
        );
    }

    fn is_role_account(&self, account: &AccountId) -> bool {
        *account == env::current_account_id()
            || *account == self.config.token
            || *account == self.config.agent
            || *account == self.config.verifier
    }

    fn owned_case_mut(&mut self, case_id: &String) -> &mut Case {
        let case = self
            .cases
            .get_mut(case_id)
            .unwrap_or_else(|| env::panic_str(errors::CASE_NOT_FOUND));
        require!(
            case.owner == env::predecessor_account_id(),
            errors::NOT_OWNER
        );
        case
    }
}

/// Deposits: `ft_transfer_call` on the configured token with `msg` set to the
/// case id. Anyone may fund a case (for example a relative). Tokens for an
/// unknown case are returned in full by the token contract.
#[near]
impl FungibleTokenReceiver for Vault {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.config.token,
            errors::WRONG_TOKEN
        );
        require!(amount.0 > 0, errors::AMOUNT);
        match self.cases.get_mut(&msg) {
            Some(case) => {
                case.balance = U128(
                    case.balance
                        .0
                        .checked_add(amount.0)
                        .unwrap_or_else(|| env::panic_str(errors::AMOUNT_OVERFLOW)),
                );
                log!("deposit {msg} from {sender_id} amount={}", amount.0);
                PromiseOrValue::Value(U128(0))
            }
            None => {
                log!("deposit_refused unknown case; returning {}", amount.0);
                PromiseOrValue::Value(amount)
            }
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_payments;
