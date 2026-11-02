# Kinwarden NEAR: architecture decisions

> **Status: design (G0), not implemented.** These decisions govern the NEAR work
> after the `pre-hackathon` tag. Nothing here settles payments yet. Companion
> documents: [THREAT_MODEL.md](THREAT_MODEL.md) and
> [STATE_AND_ENCODING.md](STATE_AND_ENCODING.md).

Recorded 2 November 2026. Versions were checked against crates.io and npm on that
date. Each decision lists what would make us revisit it.

## D-01 Toolchain and versions

| Component | Version | Notes |
|---|---|---|
| `near-sdk` / `near-contract-standards` | 5.30.0 | MSRV is Rust 1.95 |
| Rust for contracts | 1.95 (pinned) | `rust-toolchain.toml` in the contract workspace |
| `cargo-near` | 0.22.0 | `cargo near build non-reproducible-wasm` for development |
| `near-workspaces` | 0.24.0 | Sandbox integration tests |
| `near-cli-rs` | 0.30.1 | Setup and deployment scripts |
| `near-api-js` | 7.4.0 | Server-side agent client and setup checks |
| `@hot-labs/near-connect` | 0.12.0 | Family wallet connection (D-03) |

The NEAR sandbox runs only on Linux x86_64 and macOS ARM64, and building
`cargo-near`/`near-cli-rs` natively on Windows failed on 2 Nov (vendored OpenSSL
needs a Windows Perl). All NEAR tooling — builds, sandbox tests, CLI setup and
deployment — therefore runs in [`contracts/near/dev.Dockerfile`](../../contracts/near/dev.Dockerfile)
on Windows hosts, and directly on Linux/CI. The documented judge path is Linux.

*Revisit if:* the pinned compiler is rejected by `cargo-near`'s protocol check or
a dependency raises its MSRV.

## D-02 Accounts and roles

Each role is a separate NEAR account. The contract checks the caller's role on
every method; key permissions are a second, independent layer.

| Role | Account | Key held where | May call |
|---|---|---|---|
| Family owner | The family's own account | The family's wallet only | `approve_payment`, `reject_payment`, `cancel_proposal`, `pause`, `unpause`, `lower_limits`, `revoke_agent` |
| Agent | `agent.<vault>` | App server: **function-call key only** | `propose_payment`, `anchor_log` |
| Verifier | `verifier.<vault>` | CLI setup tooling only | `enroll_payee`, `revoke_payee`, `authorize_invoice`, `revoke_invoice` |
| Vault | `<vault>` | Deployer tooling | Contract code; no app-held key |
| Test token | `tusdc.<vault>` | Deployer tooling | Standard NEP-141 plus test minting |

The agent key is a function-call access key with receiver = vault, methods =
`propose_payment` and `anchor_log`, and a bounded gas allowance. The server
queries its own key with `view_access_key` at startup and refuses to start if
the key is full-access, has another receiver or extra methods, or cannot be
verified. A secret key string does not reveal its own permissions.

The agent account's full-access key stays with setup tooling. The demo
documents whether it is retained or deleted after setup.

*Revisit if:* a single-account layout is needed for meta transactions (D-07).

## D-03 Family signer: an independent wallet via NEAR Connect

The family approves with their own NEAR wallet through `@hot-labs/near-connect`
on testnet. The app never generates, imports or stores a family private key.

- **Connect without adding an app key.** We do not use the `signIn: { contractId }`
  option, which installs a limited function-call key on the family account. Every
  family action is signed in the wallet.
- **Family methods require exactly 1 yoctoNEAR.** NEAR function-call access keys
  cannot attach a deposit, so a limited key held anywhere can never approve, pause
  or change policy. Only a full-access key, which means a wallet confirmation, can
  call them. A toolchain probe in a sandbox has to confirm this protocol behavior
  before G1 relies on it.
- **Testnet-capable wallets in the connector manifest** (2 Nov): Meteor, Intear,
  Ledger, Nightly, NEAR CLI, WalletConnect and others. We filter the connector to
  `features: { testnet: true, signAndSendTransaction: true }`.
- **Primary demo wallet:** Meteor Wallet. **Deterministic fallback:** NEAR CLI
  (`near-cli-rs`), which prints the full transaction before signing.
- **Readable authorization.** Wallets show the method name and JSON arguments.
  The approval arguments therefore include the readable recipient, token and
  amount next to the commitment hash (D-04), so the wallet itself shows who is
  being paid what.

**Open G0 check, needs a person:** confirm on testnet what Meteor actually shows
for `approve_payment` (method, arguments, deposit) and capture a screenshot for
`docs/near/`. That requires the user's own testnet wallet and signature; the
agent cannot do it. If Meteor hides the arguments, use another listed wallet or
NEAR CLI for the demo, never a browser-held key.

The existing passkey flow remains a UX confirmation before the wallet opens. It
is not payment authority.

*Revisit if:* no testnet wallet shows the arguments readably.

## D-04 Approval interface

This supersedes the four-argument interface in the plan, which identified the
proposal only by a hash:

```text
approve_payment(
  case_id, proposal_id,
  expected_recipient, expected_token, expected_amount,
  expected_policy_version, expected_proposal_hash
)  // #[payable], exactly 1 yoctoNEAR, caller = case owner
```

The contract recomputes the commitment from its **stored** proposal and current
policy, then requires every `expected_*` field and the hash to match. Then it
rechecks every hard rule at execution: pause, agent and payee status, invoice
authorization and ceiling, caps, expiry and liquidity. The readable fields serve
the person reading the wallet. The hash covers the fields a wallet would not
display usefully, such as network, vault, invoice ID, expiry and payee version.
See [STATE_AND_ENCODING.md](STATE_AND_ENCODING.md) for the encoding.

Family approval cannot waive a hard rule.

## D-05 Test token

A standard NEP-141 token built with `near-contract-standards`, named
"Kinwarden Test USD (tUSDC)", with 6 decimals and minting restricted to the
deployer. It is never described as USDC. Payees must be storage-registered on the
token before verification; setup scripts register the fictional demo payees.

## D-06 Privacy boundary on chain

On chain: opaque case, invoice and proposal identifiers, account IDs, token,
integer amounts, timestamps, status, policy and payee versions, commitments and
anchor hashes. Off chain only: names, medical details, student numbers, invoice
bodies, institution correspondence and free-text memos. NEAR account IDs,
amounts and timing are public, and the README says so.

## D-07 Deferred: gas sponsorship (P2 after G3)

NEP-366 delegate actions let a relayer pay gas for a family-signed approval. The
1-yoctoNEAR rule still applies to the inner action. The relayer gains no
authority. This is not designed further until G3 passes.

## D-08 Upgrade authority

During development the vault account keeps a deployer full-access key, so the
contract **is upgradeable** and is never described as immutable. Before the
final testnet demo, we either remove that key and document the lock, or keep it
and say who holds it.
