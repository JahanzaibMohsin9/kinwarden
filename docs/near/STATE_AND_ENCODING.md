# Kinwarden NEAR: payment state, reservations and approval encoding

> **Status:** §1 records, §6 encoding (with test vectors) and the G1 parts of
> §3 (per-case deposits) and §7 are **implemented** in
> [`contracts/near/vault`](../../contracts/near/vault). Proposals, approval,
> reservations, caps enforcement and settlement (§2–§5) are **G2, not yet
> implemented**. Tests must cite the section they cover.
> See [DECISIONS.md](DECISIONS.md).

All amounts are integer token units (`u128`, JSON string). tUSDC has 6
decimals, so `"250000000"` is 250 tUSDC. All times are contract block time in
nanoseconds (`env::block_timestamp()`, JSON string); browser or simulator time
is never used.

A vault is configured once at initialization with **one** token, one verifier
account, one agent account and a network label (`sandbox` | `testnet` |
`mainnet`). The four role accounts and the vault must all differ.

**Identifiers** (`case_id`, `payee_id`, `invoice_id`) are opaque: 1–64
characters of `a-z`, `0-9` and `-`, starting with a letter or digit. Free text,
names and record numbers with spaces or capitals are rejected (`E_ID_FORMAT`).

## 1. Stored records

**Case** — `case_id`, `owner` (the family account that created it),
`status` (`Active` | `Paused`), `agent_enabled`, `policy_version: u64` (starts
at 1), `limits` (§4), and accounting `balance`, `reserved`, `in_flight`,
`paid` (§3). The creator attaches NEAR for the case's storage; the excess is
refunded (`E_STORAGE_DEPOSIT` if too little).

**Payee** (verifier-enrolled) — `payee_id`, `account` (token receiver),
`payee_version: u64`, `status`, `purpose_group` (`Hospital` | `Tuition`),
`provenance` (SHA-256 hex of the off-chain verification record, never the
record). Status starts `PendingRegistration`; the vault asks the token contract
for the account's storage registration and the callback sets `Active` or
`Rejected`. The verifier can set `Revoked`. Every status change increments
`payee_version`. One account maps to at most one pending or active payee; the
vault, token, agent and verifier accounts cannot be payees.

**Invoice** (verifier-authorized) — `invoice_id` (canonical, unique per vault,
never reused even after revocation), `case_id`, `payee_id`, `ceiling`, `paid`,
`reserved`, `in_flight`, `status` (`Authorized` | `Revoked`). Authorization
requires an existing case and an `Active` payee. Recognizing that two
different scans describe the same bill is the verifier's job; hashing does not
do it.

**Proposal** — `proposal_id: u64` (vault-wide counter), `case_id`,
`invoice_id`, `attempt: u32`, `request_id` (agent-supplied, case-scoped),
`recipient`, `token`, `amount`, `created_at`, `expires_at`,
`policy_version`, `payee_version`, `status` (§2).

## 2. Proposal states

```text
                 ┌─> REJECTED     (owner)
                 ├─> EXPIRED      (block time >= expires_at; settled lazily)
PENDING_APPROVAL ┼─> INVALIDATED  (policy/payee/invoice change, pause*, cancel)
                 └─> SUBMITTED ──┬─> SETTLED
                                 └─> FAILED
```

\* Pause blocks approval and execution. Whether pause also invalidates pending
proposals or only blocks them is decided in G2 and tested; it must never let a
paused case settle.

| Transition | Caller | Accounting effect (§3) |
|---|---|---|
| create → `PENDING_APPROVAL` | agent | reserve `amount` once |
| → `REJECTED` / `EXPIRED` / `INVALIDATED` | owner / anyone after expiry / contract | release reservation once |
| `PENDING_APPROVAL` → `SUBMITTED` | owner via `approve_payment` | move reserved → in-flight; status changes **before** `ft_transfer` is dispatched |
| `SUBMITTED` → `SETTLED` | private callback, transfer succeeded | in-flight → paid |
| `SUBMITTED` → `FAILED` | private callback, transfer failed | in-flight released; liquidity restored once |

**Request idempotency.** `(case_id, request_id)` maps to one proposal. Repeating
the same request with identical content returns the existing proposal. Reusing
the `request_id` with different content is refused (`REQUEST_ID_CONFLICT`).

**Retry.** Only a new explicit agent request may retry a `FAILED` payment. It
creates a new proposal with `attempt + 1` for the same canonical invoice, and it
needs a new family approval.

**Unknown outcome.** If the callback has not run, the proposal stays
`SUBMITTED` with its in-flight amount held. Nothing is refunded, resent or
treated as failed because of a timeout. A recovery path must be specified and
tested in G2 before it is exposed. An owner's assertion is not proof of failure.

**Callback.** `on_transfer_complete(proposal_id, attempt)` is `#[private]`.
It acts only on a `SUBMITTED` proposal whose ID and attempt match. A repeated
call, or a call for a proposal in any other state, changes no accounting.

## 3. Reservations and liquidity

Funds are held **per case**, so one family's balance can never pay another
family's bill. Each case tracks `balance`, `reserved` and `in_flight`.

**Deposits (implemented in G1).** Anyone, for example a relative, funds a case
with `ft_transfer_call` on the configured token, `msg` = `case_id`. The vault's
`ft_on_transfer` accepts calls only from that token (`E_WRONG_TOKEN`); a
lookalike token is refunded by its own contract. Tokens sent for an unknown
case are returned in full.

```text
available = balance - reserved - in_flight
```

A proposal is accepted only if `amount <= available` and every cap in §4 holds
with pending reservations counted. Settlement reduces `balance` and `in_flight`
together. Failure reduces only `in_flight`, because tokens never left the vault.

Every proposal records the accounting window it was charged to. A late failure
or expiry releases exactly that proposal's charge and never touches unrelated
current-window capacity.

## 4. Policy caps (enforced at proposal **and** execution)

| Cap | Scope | Counted |
|---|---|---|
| per-payment max | proposal | `amount` |
| invoice ceiling | invoice | `paid + reserved + in_flight` |
| rolling 24 h case cap | case | reserved + in-flight + settled with `charged_at > now - 24h` |
| lifetime case cap | case | reserved + in-flight + settled |
| rolling 24 h purpose-group cap | case × payee `purpose_group` | as rolling case cap |

The rolling window is a true sliding 24-hour window from block time, not a reset
at UTC midnight. Boundary: a charge at time `t` counts while `now < t + 24h`.

Caps are fixed at case creation. The owner can lower them (`policy_version += 1`,
which invalidates pending proposals) but cannot raise them in the MVP.

## 5. Bounds (K07)

These numbers are placeholders until G2 measures storage cost.

| Bound | Initial value |
|---|---|
| active proposals per case | 8 |
| proposal lifetime | ≤ 24 h, chosen by the agent within the bound |
| anchors per case per rolling 24 h | 48 |
| rolling-window entries per case | pruned on write; bounded by active + 24 h charges |

The agent pays its own transaction gas through its key allowance. Contract
storage for proposals and anchors is bounded by the limits above.

## 6. Approval commitment, version 1

The contract builds this struct from **stored** state, encodes it with Borsh,
and hashes it with SHA-256 (`env::sha256`). The hash is passed as lowercase hex.

```rust
struct ApprovalCommitmentV1 {
    domain: String,          // "kinwarden.approval.v1"
    network: String,         // "testnet" | "sandbox" | "mainnet"
    vault: AccountId,
    case_id: String,
    invoice_id: String,
    proposal_id: u64,
    attempt: u32,
    token: AccountId,
    recipient: AccountId,
    amount: u128,
    expires_at: u64,
    policy_version: u64,
    payee_version: u64,
}
```

Field order is part of the format. Any change creates a new `domain` version.
Test vectors are in
[`contracts/near/vault/test-vectors/approval_commitment_v1.json`](../../contracts/near/vault/test-vectors/approval_commitment_v1.json):
a base vector, one vector per field with only that field changed, maximum
integer values and a sandbox-network case, each with its Borsh bytes and
SHA-256. They are generated by an independent Python encoder
(`approval_commitment_v1.py`, no NEAR or Borsh library) and checked by the
vault's Rust unit tests; the TypeScript client (G3) checks the same file. Every
field changed on its own produces a different hash; G2 adds the refused
approval for each (K01).

The hash binds the approval to exact stored state. It does not prove that an
invoice is genuine; that is the verifier's enrollment decision.

## 7. Reason codes

Refusals panic with a stable code prefix that tests assert, e.g.
`E_NOT_OWNER`, `E_NOT_AGENT`, `E_PAUSED`, `E_PAYEE_REVOKED`,
`E_INVOICE_UNAUTHORIZED`, `E_INVOICE_CEILING`, `E_CAP_PAYMENT`,
`E_CAP_ROLLING`, `E_CAP_LIFETIME`, `E_CAP_GROUP`, `E_LIQUIDITY`, `E_EXPIRED`,
`E_STALE_POLICY`, `E_COMMITMENT_MISMATCH`, `E_FIELD_MISMATCH`, `E_BAD_STATE`,
`E_REQUEST_ID_CONFLICT`, `E_BOUND_ACTIVE`, `E_ONE_YOCTO`.

Implemented in G1 ([`vault/src/errors.rs`](../../contracts/near/vault/src/errors.rs)):
`E_ONE_YOCTO`, `E_STORAGE_DEPOSIT`, `E_NOT_OWNER`, `E_NOT_VERIFIER`,
`E_ROLE_CONFLICT`, `E_BAD_NETWORK`, `E_ID_FORMAT`, `E_PROVENANCE_FORMAT`,
`E_CASE_EXISTS`, `E_CASE_NOT_FOUND`, `E_LIMITS_INVALID`, `E_LIMITS_NOT_LOWER`,
`E_PAYEE_EXISTS`, `E_PAYEE_NOT_FOUND`, `E_PAYEE_ACCOUNT_IN_USE`,
`E_PAYEE_FORBIDDEN_ACCOUNT`, `E_PAYEE_NOT_ACTIVE`, `E_INVOICE_EXISTS`,
`E_INVOICE_NOT_FOUND`, `E_INVOICE_UNAUTHORIZED`, `E_AMOUNT`,
`E_AMOUNT_OVERFLOW`, `E_WRONG_TOKEN`. G2 adds the proposal and settlement codes.
