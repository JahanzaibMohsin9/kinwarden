//! Payments (G2): proposals, reservations, approval, settlement and owner
//! withdrawal. Spec: docs/near/STATE_AND_ENCODING.md §2–§5.
//!
//! One function, `blockers`, decides whether a proposal can be approved. The
//! approval refuses on its first blocker, `sweep` releases proposals whose
//! blockers make them permanently stale, and `approval_preview` shows all of
//! them, so the preview cannot disagree with execution.

use near_sdk::json_types::{U128, U64};
use near_sdk::{env, ext_contract, log, near, require, AccountId, Gas, Promise, PromiseError};

use crate::commitment::{ApprovalCommitmentV1, DOMAIN_V1};
use crate::types::*;
use crate::{assert_one_yocto, errors, ids, now, request_key, Vault, VaultExt, ONE_YOCTO};

pub const DAY_NS: u64 = 86_400 * 1_000_000_000;
pub const MAX_PENDING_PER_CASE: usize = 8;
pub const MAX_PROPOSALS_PER_24H: usize = 32;
pub const MAX_TTL_SECONDS: u32 = 86_400;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_TRANSFER_CALLBACK: Gas = Gas::from_tgas(20);
const GAS_APPROVE_MIN: Gas = Gas::from_tgas(100);

#[ext_contract(ext_ft_core)]
#[allow(dead_code)]
trait FtCore {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// Blockers that can never clear for this proposal, so `sweep` releases it.
/// Cap blockers are excluded: a pending proposal holds its reservation, so
/// they can only appear through a policy change, which is itself stale.
fn is_stale(code: &str) -> bool {
    [
        errors::EXPIRED,
        errors::PAUSED,
        errors::AGENT_DISABLED,
        errors::STALE_POLICY,
        errors::PAYEE_CHANGED,
        errors::INVOICE_NOT_AUTHORIZED,
    ]
    .contains(&code)
}

fn code_of(message: &str) -> String {
    message.split(':').next().unwrap_or(message).to_string()
}

fn in_window(entry: &WindowEntry, now: u64) -> bool {
    entry.at.0.saturating_add(DAY_NS) > now
}

/// Amount charged to the rolling 24-hour window, optionally for one group.
fn window_used(case: &Case, group: Option<PurposeGroup>, now: u64) -> u128 {
    case.window
        .iter()
        .filter(|e| e.counted && in_window(e, now) && group.is_none_or(|g| e.group == g))
        .map(|e| e.amount.0)
        .sum()
}

fn committed(paid: U128, reserved: U128, in_flight: U128) -> u128 {
    paid.0
        .saturating_add(reserved.0)
        .saturating_add(in_flight.0)
}

fn sub(a: U128, b: u128) -> U128 {
    U128(
        a.0.checked_sub(b)
            .unwrap_or_else(|| env::panic_str(errors::AMOUNT_OVERFLOW)),
    )
}

fn add(a: U128, b: u128) -> U128 {
    U128(
        a.0.checked_add(b)
            .unwrap_or_else(|| env::panic_str(errors::AMOUNT_OVERFLOW)),
    )
}

#[near]
impl Vault {
    // ----- Agent -------------------------------------------------------------

    /// Asks to pay `amount` of an authorized invoice. The recipient, token and
    /// purpose come from the verifier's records. The amount is reserved; no
    /// tokens move until the case owner approves. Repeating a request with
    /// the same content returns the existing proposal.
    pub fn propose_payment(
        &mut self,
        case_id: String,
        invoice_id: String,
        request_id: String,
        amount: U128,
        ttl_seconds: u32,
    ) -> Proposal {
        require!(
            env::predecessor_account_id() == self.config.agent,
            errors::NOT_AGENT
        );
        ids::assert_opaque_id(&request_id);
        require!(self.cases.contains_key(&case_id), errors::CASE_NOT_FOUND);

        let key = request_key(&case_id, &request_id);
        if let Some(id) = self.requests.get(&key) {
            let existing = self.proposals.get(id).expect("indexed proposal");
            require!(
                existing.invoice_id == invoice_id
                    && existing.amount == amount
                    && existing.ttl_seconds == ttl_seconds,
                errors::REQUEST_ID_CONFLICT
            );
            return existing.clone();
        }

        self.sweep_case(&case_id);
        let now = env::block_timestamp();
        let case = self.cases.get(&case_id).expect("checked above").clone();
        require!(case.status == CaseStatus::Active, errors::PAUSED);
        require!(case.agent_enabled, errors::AGENT_DISABLED);
        require!((1..=MAX_TTL_SECONDS).contains(&ttl_seconds), errors::TTL);
        let invoice = self
            .invoices
            .get(&invoice_id)
            .unwrap_or_else(|| env::panic_str(errors::INVOICE_NOT_FOUND))
            .clone();
        require!(
            invoice.status == InvoiceStatus::Authorized,
            errors::INVOICE_NOT_AUTHORIZED
        );
        require!(invoice.case_id == case_id, errors::INVOICE_CASE_MISMATCH);
        let payee = self
            .payees
            .get(&invoice.payee_id)
            .unwrap_or_else(|| env::panic_str(errors::PAYEE_NOT_FOUND))
            .clone();
        require!(
            payee.status == PayeeStatus::Active,
            errors::PAYEE_NOT_ACTIVE
        );

        let amt = amount.0;
        require!(amt > 0, errors::AMOUNT);
        let limits = &case.limits;
        require!(amt <= limits.per_payment_max.0, errors::CAP_PAYMENT);
        require!(
            committed(invoice.paid, invoice.reserved, invoice.in_flight).saturating_add(amt)
                <= invoice.ceiling.0,
            errors::INVOICE_CEILING
        );
        require!(amt <= case.available(), errors::LIQUIDITY);
        require!(
            committed(case.paid, case.reserved, case.in_flight).saturating_add(amt)
                <= limits.lifetime_cap.0,
            errors::CAP_LIFETIME
        );
        require!(
            window_used(&case, None, now).saturating_add(amt) <= limits.rolling_24h_cap.0,
            errors::CAP_ROLLING
        );
        require!(
            window_used(&case, Some(payee.purpose_group), now).saturating_add(amt)
                <= limits.group_cap(payee.purpose_group),
            errors::CAP_GROUP
        );
        require!(
            case.pending.len() < MAX_PENDING_PER_CASE,
            errors::BOUND_ACTIVE
        );
        require!(
            case.window.iter().filter(|e| in_window(e, now)).count() < MAX_PROPOSALS_PER_24H,
            errors::BOUND_RATE
        );

        let id = self.next_proposal_id;
        self.next_proposal_id += 1;
        let attempt = invoice.attempts + 1;
        let proposal = Proposal {
            proposal_id: U64(id),
            case_id: case_id.clone(),
            invoice_id: invoice_id.clone(),
            request_id,
            attempt,
            payee_id: invoice.payee_id.clone(),
            recipient: payee.account.clone(),
            token: self.config.token.clone(),
            amount,
            purpose_group: payee.purpose_group,
            ttl_seconds,
            created_at: U64(now),
            expires_at: U64(now + u64::from(ttl_seconds) * 1_000_000_000),
            policy_version: case.policy_version,
            payee_version: payee.payee_version,
            status: ProposalStatus::PendingApproval,
            status_reason: None,
            updated_at: U64(now),
        };

        let case_m = self.cases.get_mut(&case_id).expect("checked above");
        case_m.reserved = add(case_m.reserved, amt);
        case_m.pending.push(id);
        case_m.window.push(WindowEntry {
            proposal_id: id,
            at: U64(now),
            amount,
            group: payee.purpose_group,
            counted: true,
        });
        let invoice_m = self.invoices.get_mut(&invoice_id).expect("checked above");
        invoice_m.reserved = add(invoice_m.reserved, amt);
        invoice_m.attempts = attempt;
        self.proposals.insert(id, proposal.clone());
        self.requests.insert(key, id);
        log!("proposal_created {id} case={case_id} invoice={invoice_id} attempt={attempt} amount={amt}");
        proposal
    }

    // ----- Anyone ------------------------------------------------------------

    /// Releases proposals that can no longer be approved: expired, or stale
    /// after a pause, policy, agent, payee or invoice change. Only ever
    /// releases reservations, so anyone may call it. Returns how many.
    pub fn sweep(&mut self, case_id: String) -> u32 {
        require!(self.cases.contains_key(&case_id), errors::CASE_NOT_FOUND);
        self.sweep_case(&case_id)
    }

    // ----- Family (case owner) ----------------------------------------------

    /// Approves one exact payment. The readable fields and the commitment
    /// hash must match the stored proposal and current policy, and every
    /// hard rule is rechecked. Then the reservation moves to in-flight and
    /// the vault sends the tokens; `on_transfer_complete` settles it.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn approve_payment(
        &mut self,
        case_id: String,
        proposal_id: U64,
        expected_recipient: AccountId,
        expected_token: AccountId,
        expected_amount: U128,
        expected_policy_version: u64,
        expected_proposal_hash: String,
    ) -> Promise {
        assert_one_yocto();
        require!(env::prepaid_gas() >= GAS_APPROVE_MIN, errors::GAS);
        let case = self.owned_case_mut(&case_id).clone();
        let proposal = self.case_proposal(&case_id, proposal_id.0);
        if let Some(code) = self
            .blockers(&case, &proposal, env::block_timestamp())
            .first()
        {
            env::panic_str(code);
        }
        require!(
            expected_policy_version == case.policy_version,
            errors::STALE_POLICY
        );
        require!(
            expected_recipient == proposal.recipient
                && expected_token == proposal.token
                && expected_amount == proposal.amount,
            errors::FIELD_MISMATCH
        );
        require!(
            expected_proposal_hash == self.commitment_for(&proposal).hash_hex(),
            errors::COMMITMENT_MISMATCH
        );

        // Mark it submitted before the transfer is dispatched, so it can
        // never be approved twice.
        let id = proposal_id.0;
        let amt = proposal.amount.0;
        let case_m = self.cases.get_mut(&case_id).expect("owned above");
        case_m.reserved = sub(case_m.reserved, amt);
        case_m.in_flight = add(case_m.in_flight, amt);
        case_m.pending.retain(|p| *p != id);
        let invoice_m = self
            .invoices
            .get_mut(&proposal.invoice_id)
            .expect("blockers checked the invoice");
        invoice_m.reserved = sub(invoice_m.reserved, amt);
        invoice_m.in_flight = add(invoice_m.in_flight, amt);
        let proposal_m = self.proposals.get_mut(&id).expect("loaded above");
        proposal_m.status = ProposalStatus::Submitted;
        proposal_m.updated_at = now();
        log!("proposal_submitted {id} amount={amt}");

        ext_ft_core::ext(proposal.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                proposal.recipient.clone(),
                proposal.amount,
                Some(format!("kinwarden proposal {id}")),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_TRANSFER_CALLBACK)
                    .on_transfer_complete(proposal_id),
            )
    }

    #[payable]
    pub fn reject_payment(&mut self, case_id: String, proposal_id: U64) -> Proposal {
        assert_one_yocto();
        self.owned_case_mut(&case_id);
        let proposal = self.case_proposal(&case_id, proposal_id.0);
        require!(
            proposal.status == ProposalStatus::PendingApproval,
            errors::BAD_STATE
        );
        self.release(
            proposal_id.0,
            ProposalStatus::Rejected,
            "E_REJECTED_BY_OWNER",
        );
        self.proposals.get(&proposal_id.0).expect("exists").clone()
    }

    /// Sends unreserved funds back to the case owner.
    #[payable]
    pub fn withdraw(&mut self, case_id: String, amount: U128) -> Promise {
        assert_one_yocto();
        require!(env::prepaid_gas() >= GAS_APPROVE_MIN, errors::GAS);
        require!(amount.0 > 0, errors::AMOUNT);
        let owner = {
            let case = self.owned_case_mut(&case_id);
            require!(amount.0 <= case.available(), errors::LIQUIDITY);
            case.balance = sub(case.balance, amount.0);
            case.owner.clone()
        };
        log!("withdrawal {case_id} amount={}", amount.0);
        ext_ft_core::ext(self.config.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(owner, amount, Some("kinwarden withdrawal".to_string()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_TRANSFER_CALLBACK)
                    .on_withdraw_complete(case_id, amount),
            )
    }

    // ----- Callbacks -----------------------------------------------------------

    #[private]
    pub fn on_transfer_complete(&mut self, proposal_id: U64) -> ProposalStatus {
        self.finish_transfer(proposal_id.0, Self::single_promise_succeeded())
    }

    #[private]
    pub fn on_withdraw_complete(&mut self, case_id: String, amount: U128) -> bool {
        let ok = Self::single_promise_succeeded();
        if !ok {
            let case = self.cases.get_mut(&case_id).expect("withdrawn from");
            case.balance = add(case.balance, amount.0);
            log!("withdrawal_failed {case_id} amount={} restored", amount.0);
        }
        ok
    }

    // ----- Views -----------------------------------------------------------------

    /// What `approve_payment` would check right now, with the hash the family's
    /// wallet must sign and the budgets that would remain. Advisory only.
    pub fn approval_preview(&self, proposal_id: U64) -> Option<ApprovalPreview> {
        let proposal = self.proposals.get(&proposal_id.0)?.clone();
        let case = self.cases.get(&proposal.case_id)?;
        let invoice = self.invoices.get(&proposal.invoice_id)?;
        let now = env::block_timestamp();
        let limits = &case.limits;
        Some(ApprovalPreview {
            commitment_hash: self.commitment_for(&proposal).hash_hex(),
            blockers: self
                .blockers(case, &proposal, now)
                .into_iter()
                .map(code_of)
                .collect(),
            case_available: U128(case.available()),
            invoice_remaining: U128(invoice.ceiling.0.saturating_sub(committed(
                invoice.paid,
                invoice.reserved,
                invoice.in_flight,
            ))),
            rolling_24h_remaining: U128(
                limits
                    .rolling_24h_cap
                    .0
                    .saturating_sub(window_used(case, None, now)),
            ),
            group_24h_remaining: U128(
                limits
                    .group_cap(proposal.purpose_group)
                    .saturating_sub(window_used(case, Some(proposal.purpose_group), now)),
            ),
            lifetime_remaining: U128(limits.lifetime_cap.0.saturating_sub(committed(
                case.paid,
                case.reserved,
                case.in_flight,
            ))),
            proposal,
        })
    }
}

impl Vault {
    /// Every reason the proposal cannot be approved now, in check order.
    pub(crate) fn blockers(&self, case: &Case, p: &Proposal, now: u64) -> Vec<&'static str> {
        let mut out = Vec::new();
        if p.status != ProposalStatus::PendingApproval {
            out.push(errors::BAD_STATE);
            return out;
        }
        if now >= p.expires_at.0 {
            out.push(errors::EXPIRED);
        }
        if case.status != CaseStatus::Active {
            out.push(errors::PAUSED);
        }
        if !case.agent_enabled {
            out.push(errors::AGENT_DISABLED);
        }
        if p.policy_version != case.policy_version {
            out.push(errors::STALE_POLICY);
        }
        let payee_ok = self.payees.get(&p.payee_id).is_some_and(|payee| {
            payee.status == PayeeStatus::Active
                && payee.payee_version == p.payee_version
                && payee.account == p.recipient
        });
        if !payee_ok {
            out.push(errors::PAYEE_CHANGED);
        }
        let Some(invoice) = self.invoices.get(&p.invoice_id) else {
            out.push(errors::INVOICE_NOT_AUTHORIZED);
            return out;
        };
        if invoice.status != InvoiceStatus::Authorized {
            out.push(errors::INVOICE_NOT_AUTHORIZED);
        }
        // Hard limits, rechecked with this proposal's reservation included.
        let limits = &case.limits;
        if p.amount.0 > limits.per_payment_max.0 {
            out.push(errors::CAP_PAYMENT);
        }
        if committed(invoice.paid, invoice.reserved, invoice.in_flight) > invoice.ceiling.0 {
            out.push(errors::INVOICE_CEILING);
        }
        if case.reserved.0.saturating_add(case.in_flight.0) > case.balance.0 {
            out.push(errors::LIQUIDITY);
        }
        if committed(case.paid, case.reserved, case.in_flight) > limits.lifetime_cap.0 {
            out.push(errors::CAP_LIFETIME);
        }
        if window_used(case, None, now) > limits.rolling_24h_cap.0 {
            out.push(errors::CAP_ROLLING);
        }
        if window_used(case, Some(p.purpose_group), now) > limits.group_cap(p.purpose_group) {
            out.push(errors::CAP_GROUP);
        }
        out
    }

    pub(crate) fn commitment_for(&self, p: &Proposal) -> ApprovalCommitmentV1 {
        ApprovalCommitmentV1 {
            domain: DOMAIN_V1.to_string(),
            network: self.config.network.clone(),
            vault: env::current_account_id(),
            case_id: p.case_id.clone(),
            invoice_id: p.invoice_id.clone(),
            proposal_id: p.proposal_id.0,
            attempt: p.attempt,
            token: p.token.clone(),
            recipient: p.recipient.clone(),
            amount: p.amount.0,
            expires_at: p.expires_at.0,
            policy_version: p.policy_version,
            payee_version: p.payee_version,
        }
    }

    /// Releases every pending proposal of the case that has a stale blocker
    /// and prunes window entries older than 24 hours.
    pub(crate) fn sweep_case(&mut self, case_id: &String) -> u32 {
        let now = env::block_timestamp();
        let Some(case) = self.cases.get(case_id).cloned() else {
            return 0;
        };
        let mut released = 0;
        for id in &case.pending {
            let Some(p) = self.proposals.get(id).cloned() else {
                continue;
            };
            if let Some(code) = self
                .blockers(&case, &p, now)
                .into_iter()
                .find(|c| is_stale(c))
            {
                let status = if code == errors::EXPIRED {
                    ProposalStatus::Expired
                } else {
                    ProposalStatus::Invalidated
                };
                self.release(*id, status, &code_of(code));
                released += 1;
            }
        }
        if let Some(case_m) = self.cases.get_mut(case_id) {
            case_m.window.retain(|e| in_window(e, now));
        }
        released
    }

    /// Ends a pending proposal and releases its reservation exactly once.
    pub(crate) fn release(&mut self, id: u64, status: ProposalStatus, reason: &str) {
        let Some(p) = self.proposals.get(&id).cloned() else {
            return;
        };
        if p.status != ProposalStatus::PendingApproval {
            return;
        }
        let amt = p.amount.0;
        if let Some(case_m) = self.cases.get_mut(&p.case_id) {
            case_m.reserved = sub(case_m.reserved, amt);
            case_m.pending.retain(|x| *x != id);
            for entry in case_m.window.iter_mut().filter(|e| e.proposal_id == id) {
                entry.counted = false;
            }
        }
        if let Some(invoice_m) = self.invoices.get_mut(&p.invoice_id) {
            invoice_m.reserved = sub(invoice_m.reserved, amt);
        }
        let proposal_m = self.proposals.get_mut(&id).expect("loaded above");
        proposal_m.status = status;
        proposal_m.status_reason = Some(reason.to_string());
        proposal_m.updated_at = now();
        log!("proposal_released {id} status={status:?} reason={reason}");
    }

    /// Finishes a submitted proposal exactly once. A repeated or late call,
    /// or one for a proposal in any other state, changes nothing.
    pub(crate) fn finish_transfer(&mut self, id: u64, succeeded: bool) -> ProposalStatus {
        let Some(p) = self.proposals.get(&id).cloned() else {
            return ProposalStatus::Failed;
        };
        if p.status != ProposalStatus::Submitted {
            return p.status;
        }
        let amt = p.amount.0;
        let case_m = self.cases.get_mut(&p.case_id).expect("case of proposal");
        case_m.in_flight = sub(case_m.in_flight, amt);
        if succeeded {
            case_m.balance = sub(case_m.balance, amt);
            case_m.paid = add(case_m.paid, amt);
        } else {
            // Tokens never left the vault: release the window charge so the
            // family can retry, without touching other proposals' charges.
            for entry in case_m.window.iter_mut().filter(|e| e.proposal_id == id) {
                entry.counted = false;
            }
        }
        let invoice_m = self
            .invoices
            .get_mut(&p.invoice_id)
            .expect("invoice of proposal");
        invoice_m.in_flight = sub(invoice_m.in_flight, amt);
        if succeeded {
            invoice_m.paid = add(invoice_m.paid, amt);
        }
        let status = if succeeded {
            ProposalStatus::Settled
        } else {
            ProposalStatus::Failed
        };
        let proposal_m = self.proposals.get_mut(&id).expect("loaded above");
        proposal_m.status = status;
        proposal_m.status_reason = (!succeeded).then(|| code_of(errors::TRANSFER_FAILED));
        proposal_m.updated_at = now();
        log!("proposal_finished {id} status={status:?}");
        status
    }

    pub(crate) fn case_proposal(&self, case_id: &str, id: u64) -> Proposal {
        self.proposals
            .get(&id)
            .filter(|p| p.case_id == case_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(errors::PROPOSAL_NOT_FOUND))
    }

    pub(crate) fn case_snapshot(&self, case_id: &String) -> Case {
        self.cases.get(case_id).expect("case exists").clone()
    }

    /// True unless the single awaited promise failed. `TooLong` means the
    /// call succeeded with a result we chose not to read, so it is success:
    /// treating it as failure would restore funds that actually left.
    /// Anything other than exactly one result panics, leaving the proposal
    /// Submitted with its funds held (outcome unknown, never guessed).
    fn single_promise_succeeded() -> bool {
        require!(env::promise_results_count() == 1, "E_CALLBACK_RESULTS");
        !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed))
    }
}
