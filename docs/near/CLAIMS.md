# Kinwarden NEAR: claim → enforcement → test map

Every security or behavior claim about the NEAR integration appears here with
where it is enforced and the test that checks it. A claim without a passing test
is not made in the README. Unit tests: `contracts/near/vault/src/`. Sandbox
tests (real NEAR node, deployed contracts, real keys):
`contracts/near/integration-tests/tests/`.

Status: **G1 rows only.** Payment proposals, approval, caps, reservations and
settlement (G2) are not implemented yet and have no rows.

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

What these tests do **not** show: that an enrolled account really belongs to a
hospital (the verifier's off-chain decision, simulated in the demo), or anything
about payments, which do not exist until G2.
