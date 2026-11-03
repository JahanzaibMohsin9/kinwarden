# Kinwarden NEAR: claim → enforcement → test map

Every security or behavior claim about the NEAR integration appears here with
where it is enforced and the test that checks it. A claim without a passing test
is not made in the README. Unit tests: `contracts/near/vault/src/`. Sandbox
tests (real NEAR node, deployed contracts, real keys):
`contracts/near/integration-tests/tests/`.

Status: **G1 (C1–C14) and G2 (C15–C30).** The app, wallet integration,
testnet deployment and log anchoring (G3–G4) are not implemented and have no
rows. Unit tests: `vault/src/tests.rs`, `tests_payments.rs`, `types.rs`,
`ids.rs`, `commitment.rs`. Sandbox tests: `integration-tests/tests/g1.rs`,
`g2.rs`.

| # | Claim | Enforced by | Tests |
|---|---|---|---|
| C1 | A function-call access key cannot call any family or verifier method, even if the key lists those methods | NEAR protocol (`DepositWithFunctionCall`) + every such method requires a deposit | sandbox `g1::function_call_key_cannot_call_any_deposit_method`; unit `owner_actions_require_one_yocto`, `verifier_actions_require_one_yocto` |
| C2 | Only the case owner can pause, unpause, change limits or switch the agent off | Vault: `owned_case_mut` (`E_NOT_OWNER`) | sandbox `g1::only_the_owner_controls_a_case`; unit `stranger_cannot_pause`, `agent_cannot_pause_or_change_policy` |
| C3 | Limits can only be lowered, and lowering bumps the policy version | Vault: `Limits::not_higher_than`, `lower_limits` | sandbox `g1::only_the_owner_controls_a_case`; unit `limits_cannot_be_raised`, `lowering_limits_bumps_policy_version`, `types::lowering_compares_effective_group_caps` |
| C4 | Only the verifier can enroll payees or authorize invoices; the agent and family cannot | Vault: `assert_verifier` (`E_NOT_VERIFIER`) | sandbox `g1::only_the_verifier_enrolls_and_authorizes`; unit `agent_cannot_enroll_payee`, `family_cannot_enroll_payee`, `agent_cannot_authorize_invoice` |
| C5 | A payee becomes active only after the token confirms it can receive | Vault: `enroll_payee` → token `storage_balance_of` → private callback | sandbox `g1::payee_becomes_active_only_when_registered_on_the_token`; unit `enrollment_waits_for_token_registration`, `unregistered_account_is_rejected_and_released`, `failed_registration_lookup_rejects` |
| C6 | The registration answer cannot be forged, and a stale answer cannot change a newer enrollment | Vault: `#[private]` callback + version check | sandbox `g1::registration_callback_cannot_be_forged`; unit `stale_registration_callback_is_ignored` |
| C7 | The vault, token, agent and verifier can never be payees; one account is one payee | Vault: `enroll_payee` | unit `agent_account_cannot_be_payee`, `one_account_one_payee` |
| C8 | Invoices are canonical: an id is never reused, and an invoice needs an existing case and an active payee | Vault: `authorize_invoice` | sandbox `g1::invoices_are_canonical_and_bound_to_active_payees`; unit `invoice_ids_are_never_reused`, `invoice_needs_active_payee`, `invoice_needs_existing_case` |
| C9 | Only the configured token can credit a case; a lookalike token is refunded and calling the hook directly fails | Vault: `ft_on_transfer` (`E_WRONG_TOKEN`) | sandbox `g1::vault_only_accepts_its_configured_token`; unit `other_tokens_cannot_deposit` |
| C10 | Deposits credit exactly the named case; tokens for an unknown case are returned | Vault: `ft_on_transfer` | sandbox `g1::deposit_credits_case_and_unknown_case_is_refunded`, `g1::relative_can_fund_a_case`; unit `token_deposit_credits_case`, `deposit_for_unknown_case_is_returned` |
| C11 | Identifiers on chain cannot carry names or free text; provenance is a digest | Vault: `ids::assert_opaque_id`, `assert_provenance` | sandbox `g1::invoices_are_canonical_and_bound_to_active_payees`; unit `ids::*`, `case_id_cannot_carry_personal_text`, `provenance_must_be_a_digest` |
| C12 | Case creators pay their own storage; the vault keeps only the cost | Vault: `create_case` | sandbox `g1::create_case_charges_storage_and_refunds_the_rest`; unit `create_case_requires_deposit`, `create_case_requires_enough_for_storage` |
| C13 | The approval commitment encoding matches an independent implementation, and any single field change alters the hash | `commitment::ApprovalCommitmentV1` | unit `commitment::matches_independent_vectors`, `commitment::every_single_field_change_changes_the_hash` |
| C14 | The agent and verifier cannot own cases; all role accounts are distinct | Vault: `new`, `create_case` | unit `init_rejects_shared_roles`, `init_rejects_vault_as_role`, `agent_cannot_own_a_case` |
| C15 | An honest proposal, approved by the family, pays the enrolled hospital the exact amount and settles the case's accounting | Vault: `propose_payment`, `approve_payment`, `on_transfer_complete` | sandbox `g2::honest_payment_settles_to_the_enrolled_hospital`; unit `approval_moves_reservation_to_in_flight`, `successful_transfer_settles_once` |
| C16 | The agent cannot choose who is paid: the recipient and token come from the verifier's records | Vault: `propose_payment` takes no recipient | sandbox `g2::honest_payment_settles_to_the_enrolled_hospital`; unit `proposal_reserves_and_takes_recipient_from_the_verifier` |
| C17 | Only the case owner approves; the agent's limited key, the agent account, the verifier and strangers cannot | Vault: `owned_case_mut` + 1 yoctoNEAR (protocol) | sandbox `g2::agent_can_propose_but_never_approve`; unit `agent_cannot_approve`, `approval_needs_one_yocto` |
| C18 | Changing the approved recipient, token, amount, policy version or hash refuses the approval and moves nothing | Vault: `approve_payment` field and commitment checks | sandbox `g2::every_altered_approval_field_is_refused_and_nothing_moves`; unit `approval_with_other_*_is_refused` (5 tests) |
| C19 | A proposal is paid at most once; repeating a request returns the same proposal | Vault: status set to Submitted before dispatch; request index | sandbox `g2::a_proposal_is_paid_at_most_once`; unit `approval_happens_once`, `repeated_request_returns_the_same_proposal_and_reserves_once`, `reused_request_id_with_new_content_is_refused` |
| C20 | A failed transfer restores the case's funds exactly once, and an explicit new request can retry it | Vault: `on_transfer_complete` (`Failed` only on a failed promise) | sandbox `g2::failed_transfer_restores_funds_once_and_a_retry_settles`; unit `failed_transfer_restores_funds_once_and_allows_a_retry`, `finishing_a_pending_proposal_does_nothing` |
| C21 | A duplicate, late or forged settlement callback changes nothing | Vault: `#[private]` callback, acts only on Submitted | sandbox `g2::failed_transfer_restores_funds_once_and_a_retry_settles` (forged call); unit `successful_transfer_settles_once` |
| C22 | Pending proposals reserve funds, so concurrent requests cannot overspend the case, an invoice or a cap | Vault: reservations counted in every cap | sandbox `g2::reservations_stop_overspending_at_the_cap`; unit `liquidity_counts_reservations`, `invoice_ceiling_counts_reservations`, `rolling_cap_counts_pending_reservations`, `group_cap_counts_pending_reservations` |
| C23 | Per-payment, invoice, rolling 24-hour, purpose-group and lifetime caps are enforced at proposal and rechecked at approval | Vault: `propose_payment`, `blockers` | unit `per_payment_cap`, `lifetime_cap_counts_paid_amounts`, `group_cap_counts_pending_reservations`, `rolling_cap_counts_pending_reservations` |
| C24 | The rolling window is a true 24-hour window by block time, and a late failure never frees current-window budget | Vault: window entries charged at creation, pruned after 24 h | unit `rolling_window_counts_a_charge_for_exactly_24_hours`, `rolling_window_still_counts_one_nanosecond_before_24_hours`, `late_failure_never_releases_current_window_budget` |
| C25 | Lowering limits, pausing, switching the agent off or revoking the invoice invalidates pending proposals and releases their reservations | Vault: `sweep_case` from owner/verifier actions | sandbox `g2::changes_after_a_proposal_make_it_unapprovable_and_release_funds`; unit `policy_change_pause_and_agent_revocation_invalidate_pending`, `invoice_revocation_invalidates_pending_immediately` |
| C26 | A proposal for a revoked or changed payee cannot be approved, and anyone can release its reservation | Vault: `blockers` (`E_PAYEE_CHANGED`), public `sweep` | sandbox `g2::changes_after_a_proposal_make_it_unapprovable_and_release_funds`; unit `revoked_payee_blocks_approval`, `sweep_releases_expired_and_payee_changed_proposals` |
| C27 | Expired proposals cannot be approved and their reservation is released | Vault: `blockers` (`E_EXPIRED`), `sweep` | sandbox `g2::expired_proposal_cannot_be_approved_and_is_released`; unit `expired_proposal_cannot_be_approved`, `proposal_is_approvable_until_just_before_expiry` |
| C28 | The agent cannot grow storage or lock the budget without bound: at most 8 pending and 32 proposals per case per 24 h, lifetime at most 24 h | Vault: `propose_payment` bounds | unit `pending_proposals_are_bounded`, `proposal_rate_is_bounded_even_when_rejected`, `ttl_is_bounded` |
| C29 | The approval preview runs the same checks as the approval and shows the remaining budgets | Vault: `approval_preview` uses `blockers` | unit `preview_matches_what_approval_checks`; sandbox `g2::*` approve with preview values |
| C30 | Only the owner can withdraw, and only unreserved funds | Vault: `withdraw` | sandbox `g2::owner_withdraws_unreserved_funds_only`; unit `owner_withdraws_only_unreserved_funds`, `reserved_funds_cannot_be_withdrawn`, `only_the_owner_withdraws` |

What these tests do **not** show:

- That an enrolled account really belongs to a hospital. That is the
  verifier's off-chain decision, simulated in the demo.
- Recovery when a settlement callback never runs. The proposal stays
  `Submitted` with its funds held; no recovery path exists, and this case is
  not tested.
- Anything about the app, the family's wallet or testnet. Those are G3 work.
