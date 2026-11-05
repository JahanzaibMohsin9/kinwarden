# Kinwarden NEAR: threat model

> **Status:** the controls for T1–T9, T12, T13, T15 and T16 are implemented and
> tested; each is a row in [CLAIMS.md](CLAIMS.md). T10–T11 are wallet-and-person
> residuals. T14 (app restart) relies on the contract being the source of truth
> and is not covered by a dedicated test. The baseline application's own threat
> model is in [../SECURITY.md](../SECURITY.md).

## What we protect

A family's test-token balance held in the vault, and the guarantee that it is
paid only to a verifier-enrolled institution, against a verifier-authorized
invoice, within the case's limits, after the family approves that exact payment.

## Actors and trust

| Actor | Trusted for | Not trusted for |
|---|---|---|
| Family owner + wallet | Reading the wallet's display and approving what they intend | — |
| Verifier (simulated operator in the demo) | Deciding which account belongs to an institution and which invoices are real | Approving payments |
| Vault contract + NEAR protocol | Enforcing rules and access-key permissions as written | Knowing whether an invoice is genuine |
| Agent / app server | Nothing about money: it may propose and anchor logs | Approving, enrolling payees, changing policy, moving tokens |
| AI model | Nothing | Everything; its output is untrusted text |
| Wallet connector scripts (NEAR Connect manifest) | Delivering the chosen wallet's code | Same trust as that wallet; loaded at runtime from the wallet's host |
| Deployer | Building and deploying the published code | Holding app or family keys |

## Threats and planned controls

| # | Threat | Planned control | Where enforced | Covers |
|---|---|---|---|---|
| T1 | Forged "new bank details" makes the agent propose a lookalike account | Proposals only for `Active` verifier-enrolled payees on an authorized invoice for that case | Vault contract | K03, K04 |
| T2 | Stolen or compromised agent key calls the vault directly, bypassing the server | Contract role checks plus a function-call key limited to `propose_payment`, `sweep` and `anchor_log`; family methods need 1 yoctoNEAR, which function-call keys cannot attach | Contract + protocol | K03 |
| T3 | Agent tries to approve, enroll a payee, raise limits, call `ft_transfer`, deploy code or add keys | Same as T2; keys cannot target the token contract or perform account actions | Contract + protocol | K03 |
| T4 | Approval for one payment reused for another, or approval of stale state | Readable expected fields + versioned commitment hash + policy and payee versions + network/vault domain | Contract | K01 |
| T5 | Change between approval and execution (pause, payee revoked, limit lowered) | Every hard rule rechecked inside `approve_payment` before dispatch | Contract | K01, K02 |
| T6 | Concurrent proposals oversubscribe budget or liquidity | Reservation at proposal time; caps count pending + in-flight | Contract | K02 |
| T7 | Double settlement or double refund through duplicate/late callbacks | State moves to `SUBMITTED` before dispatch; callback finishes once, matched on proposal + attempt | Contract | K02 |
| T8 | Same bill paid twice or split under limits | Canonical invoice ceiling; idempotent request IDs; rolling case and purpose-group caps | Contract + verifier | K04 |
| T9 | Agent fills storage or locks the budget by spamming proposals or anchors | Bounds on active proposals, lifetime and anchors; expiry releases reservations | Contract | K07 |
| T10 | Malicious or compromised app frontend shows one payment but requests another | Wallet shows recipient, token and amount (in Meteor, under "View Transaction Details"); the family confirms there | **Wallet + person (residual)** | K05 |
| T11 | Malicious frontend asks the family to sign a different valid action | Not preventable by the contract; the wallet display is the defense | **Residual** | — |
| T12 | Sensitive data leaks on chain or into public receipts | Opaque IDs only on chain; canary tests on chain arguments and receipts | Contract interface + tests | K10 |
| T13 | Tampered activity log | Hash chain anchored on NEAR; verification fails on an edited entry | Anchor + verifier script | K08 |
| T14 | App restart loses track of a submitted payment | Contract state is the source of truth; the app rebuilds state from views | App + contract | K06 |
| T15 | A lying RPC (or anything between the vault and the browser) shows the family a forged proposal | The browser recomputes the commitment hash from what it reads, so a changed field turns Approve off; a forgery with a recomputed hash is refused by the vault, which compares the approval with the proposal it stored (C52) | Browser + contract | K01 |
| T16 | The recorded "AI decisions" the demo replays were written or edited by hand | Each recorded answer keeps NEAR AI's signature from its TEE; the signing key is attested by an Intel TDX quote bound to the recording; every replayed tool call must be in a signed answer (C53, D-13) | Verifier script + tests | — |

## Residual risks we state openly

- **The family must read the wallet.** A compromised app server cannot sign for
  the family, but it can ask the family to sign something misleading. Approving
  without reading the wallet's arguments defeats T10 and T11.
- **Verifier trust.** If the verifier enrolls an attacker's account, the vault
  will pay it. In the demo, verification is simulated with fictional
  institutions.
- **Upgrade authority.** While the deployer key exists, whoever holds it can
  change the contract (D-08). K11 deletes the vault's and token's full-access
  keys before submission; after that, no one can change their code.
- **Wallet connector supply chain.** NEAR Connect loads each wallet's script in
  a sandboxed iframe at runtime. Trust in that script equals trust in the
  wallet.
- **Unknown settlement outcome.** If a callback does not run, the payment stays
  `SUBMITTED` and its funds stay held until a specified recovery path exists.
- **Public metadata.** Account IDs, amounts and timing on NEAR are public.

## Out of scope for the hackathon build

Real institutional verification, fiat payout, mainnet funds, checking each
model answer's attestation live while the app runs (the recorded runs are
checked; D-13), NVIDIA GPU attestation, a shared reputation registry and timed
holds. Each is labeled as simulated or not built wherever it appears in the
product.
