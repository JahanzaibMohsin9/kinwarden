# Kinwarden NEAR: claim → enforcement → test map

Every security or behavior claim about the NEAR integration appears here with
where it is enforced and the test that checks it. A claim without a passing test
is not made in the README. Unit tests: `contracts/near/vault/src/`. Sandbox
tests (real NEAR node, deployed contracts, real keys):
`contracts/near/integration-tests/tests/`.

Status: **G1 (C1–C14), G2 (C15–C30) and G3 app integration (C31–C38).**
Testnet deployment and log anchoring (G4) have no rows yet. Contract unit tests:
`vault/src/tests.rs`, `tests_payments.rs`, `types.rs`, `ids.rs`,
`commitment.rs`. Contract sandbox tests: `integration-tests/tests/g1.rs`,
`g2.rs`. App tests: `src/near/*.test.ts`, `src/server/near/*.test.ts`; app
end to end on a local NEAR node: `src/server/near/e2e.sandbox.ts`
(`npm run test:near`).

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

| C31 | The app server holds only a function-call key limited to `propose_payment` and `sweep`, checked on chain before use; a full-access key, another receiver, extra methods or no allowance disables NEAR | App: `VaultClient.checkAgentKey` | app unit `vault.test.ts` (7 cases); e2e `ready()` |
| C32 | The app cannot approve or reject a NEAR payment: HTTP decisions are refused and its own key is blocked by the protocol | App: `decideApprovalIn`; NEAR protocol | app unit `bridge.test.ts`; e2e (HTTP refusal and `DepositWithFunctionCall` with the app's key) |
| C33 | A payment is proposed only after the separate verifier authorizes its invoice on chain; until then the vault refuses | Vault + `scripts/near/verifier.mjs` (own key) | e2e (`waiting_for_verifier`, then proposed) |
| C34 | The approval screen reads the proposal from NEAR and recomputes the commitment hash in the browser; it must match the vault's | Browser: `NearApproval`, `src/near/commitment.ts` | app unit `commitment.test.ts` (16 shared vectors); e2e (browser-side hash equals the vault's) |
| C35 | A wallet-reported approval is recorded only if the chain shows the case owner's successful `approve_payment` for that proposal | App: `NearBridge.recordApprovalTx` | e2e (an unrelated transaction is refused, the real one accepted) |
| C36 | When the vault settles, the hospital's token balance rises by exactly the proposed amount and the app marks the payment completed, the approval as made in the wallet, and the invoice paid | Vault + `NearBridge.apply` | e2e |
| C37 | The case receipt binds invoice, proposal, commitment hash, approval transaction and settlement; any edit changes its hash | App: `NearBridge.receipt` | e2e (hash recomputed; an edited copy differs) |
| C39 | The receipt names the exact recipient, token contract and amount, and records the family's approval and the settlement as separate on-chain steps with their own block times: the approval, the token contract's NEP-141 transfer event (from the vault, to the recipient, amount) and the vault's callback. A transfer that differs from the approved payment is flagged | App: `evidenceFromTx`, `buildReceipt` | app unit `bridge.test.ts`; e2e (the reported transfer equals the hospital's balance change) |
| C40 | Delivery is stated as delivered, failed or unknown from the vault's record; an approval or a submitted transaction alone is never shown as delivered, and an unknown outcome is never shown as failed or refunded. For each state the receipt and the app say where the reserved money is and what the family can do next | `src/near/outcome.ts`; `NearOutcomeNote`, `NearReceiptView` | app unit `outcome.test.ts`, `bridge.test.ts` (delivered, failed, unknown) |
| C41 | The institution's acknowledgement is a separate event in the receipt, marked as coming from the simulated hospital | `NearBridge.apply`, `buildReceipt` | app unit `bridge.test.ts`; e2e |
| C38 | A failed NEAR transfer cannot be resent without a new proposal and a new wallet approval | App: `resubmit_payment` guard; vault attempts | app unit `bridge.test.ts`; contract `failed_transfer_restores_funds_once_and_allows_a_retry` |

**Testnet run, 3 Nov 2026.** C31–C37 and C39–C41 were also observed on NEAR
testnet with the family's own Meteor wallet: the agent key check, the
verifier's authorization, the browser-side hash, the wallet approval
([transaction](https://testnet.nearblocks.io/txns/Ej6saHJebcSFZQQ18XxQQp9TSJ6E1xmbLukV76LWRSJZ),
1 yoctoNEAR attached), the hospital's balance rising by exactly 7,625.45 tUSDC,
and the receipt ([evidence/2026-11-03-testnet-receipt.json](evidence/2026-11-03-testnet-receipt.json),
its hash recomputes). A failed or unknown outcome was not exercised on testnet.

What these tests do **not** show:

- That an enrolled account really belongs to a hospital. That is the
  verifier's off-chain decision, simulated in the demo.
- Recovery when a settlement callback never runs. The proposal stays
  `Submitted` with its funds held; no recovery path exists, and this case is
  not tested.
- That a real wallet shows the approval readably. That was checked by hand
  with Meteor on testnet (DECISIONS.md D-03); the end-to-end test signs with a
  test-only harness key instead of a wallet.
- Anything on testnet. The end-to-end test runs on a local NEAR node.
