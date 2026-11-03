# Kinwarden NEAR: payment state, reservations and approval encoding

> **Status:** §1–§7 are **implemented** in
> [`contracts/near/vault`](../../contracts/near/vault) (G1 and G2) and covered
> by unit and sandbox tests listed in [CLAIMS.md](CLAIMS.md). Not implemented:
> a recovery path for a transfer whose callback never runs (§2, "Unknown
> outcome") and NEAR log anchoring (G4). See [DECISIONS.md](DECISIONS.md).

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
`invoice_id`, `attempt: u32` (the invoice's proposal count), `request_id`
(agent-supplied, case-scoped), `payee_id`, `recipient`, `token`, `amount`,
`purpose_group`, `ttl_seconds`, `created_at`, `expires_at`, `policy_version`,
`payee_version`, `status` (§2), `status_reason` (the code that ended it). The
agent supplies only the case, invoice, request id, amount and lifetime: the
recipient, token and purpose come from the verifier's records, so the agent
cannot choose who is paid.

## 2. Proposal states

```text
                 ┌─> REJECTED     (owner)
                 ├─> EXPIRED      (block time >= expires_at; settled lazily)
PENDING_APPROVAL ┼─> INVALIDATED  (policy/payee/invoice change, pause*, cancel)
                 └─> SUBMITTED ──┬─> SETTLED
                                 └─> FAILED
```

\* **Decided in G2:** pausing *invalidates* every pending proposal of the case
and releases its reservation. After unpausing, the agent must propose again
and the family must approve again.

**What invalidates a pending proposal.** One function, `blockers`, lists every
reason a proposal cannot be approved; approval refuses on the first, the
`approval_preview` view shows them all, and `sweep` releases a proposal whose
blockers include one that can never clear: expired (`EXPIRED`), case paused,
agent switched off, policy version changed (lowered limits), payee revoked,
re-enrolled or moved (`PAYEE_CHANGED`), or invoice revoked. `pause`,
`revoke_agent`, `lower_limits` and `revoke_invoice` sweep their case
immediately. A payee revocation can affect many cases, so it does not; the next
proposal, approval attempt or an explicit `sweep(case_id)` by anyone releases
those proposals. `sweep` only ever releases reservations.

| Transition | Caller | Accounting effect (§3) |
|---|---|---|
| create → `PENDING_APPROVAL` | agent | reserve `amount` once |
| → `REJECTED` | owner via `reject_payment` | release reservation once |
| → `EXPIRED` / `INVALIDATED` | `sweep` (anyone), or owner and verifier actions above | release reservation once |
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
treated as failed because of a timeout. **No recovery path is exposed**; an
owner's assertion is not proof of failure. The callback receives 20 TGas of
static gas and the approval requires at least 100 TGas prepaid (`E_GAS`), which
makes an unexecuted callback unlikely, but this case is not tested.

**Callback.** `on_transfer_complete(proposal_id)` is `#[private]`. It acts only
on a `SUBMITTED` proposal (proposal ids are unique per attempt). A repeated
call, or a call for a proposal in any other state, changes no accounting. The
transfer counts as failed only when the promise result is `Failed`; a
successful result is never read, so it can never be mistaken for a failure.
Anything other than exactly one promise result panics, leaving the proposal
`SUBMITTED` (unknown outcome, never guessed).

**Withdrawal.** The owner can `withdraw(case_id, amount)` up to the case's
available funds; the balance is debited before the transfer and restored by a
private callback if the transfer fails.

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

Every proposal adds one entry to its case's window, charged at the proposal's
creation time. Release or a failed transfer clears only that proposal's entry.
Entries older than 24 hours are pruned, so a late failure of an old transfer
never releases current-window capacity (tested).

## 4. Policy caps (enforced at proposal **and** execution)

| Cap | Scope | Counted |
|---|---|---|
| per-payment max | proposal | `amount` |
| invoice ceiling | invoice | `paid + reserved + in_flight` |
| rolling 24 h case cap | case | reserved + in-flight + settled proposals created within the last 24 h |
| lifetime case cap | case | reserved + in-flight + settled |
| rolling 24 h purpose-group cap | case × payee `purpose_group` | as rolling case cap |

The rolling window is a true sliding 24-hour window from block time, not a reset
at UTC midnight. Boundary: a charge at time `t` counts while `now < t + 24h`.

Caps are fixed at case creation. The owner can lower them (`policy_version += 1`,
which invalidates pending proposals) but cannot raise them in the MVP.

## 5. Bounds (K07)

| Bound | Value (implemented) | Refusal |
|---|---|---|
| proposals awaiting approval per case | 8 | `E_BOUND_ACTIVE` |
| proposals created per case per rolling 24 h, including rejected or expired ones | 32 | `E_BOUND_RATE` |
| proposal lifetime | 1 s – 24 h, chosen by the agent | `E_TTL` |
| rolling-window entries per case | ≤ 32, pruned on write | — |
| anchors per case per rolling 24 h | 48 (G4, not implemented) | — |

The agent pays its own transaction gas through its key allowance. The vault
pays storage for proposal records from its own NEAR balance; the rate bound
caps that growth at 32 records per case per day. Proposal records are kept as
history and are not deleted.

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
field changed on its own produces a different hash. A wrong hash, or a wrong
readable recipient, token, amount or policy version, refuses the approval
(K01; unit and sandbox tests).

The hash binds the approval to exact stored state. It does not prove that an
invoice is genuine; that is the verifier's enrollment decision.

## 7. Reason codes

Refusals panic with a stable code prefix that tests assert. The full list is in
[`vault/src/errors.rs`](../../contracts/near/vault/src/errors.rs):

- Setup and roles: `E_ONE_YOCTO`, `E_STORAGE_DEPOSIT`, `E_GAS`, `E_NOT_OWNER`,
  `E_NOT_VERIFIER`, `E_NOT_AGENT`, `E_ROLE_CONFLICT`, `E_BAD_NETWORK`,
  `E_ID_FORMAT`, `E_PROVENANCE_FORMAT`.
- Cases, payees and invoices: `E_CASE_EXISTS`, `E_CASE_NOT_FOUND`,
  `E_LIMITS_INVALID`, `E_LIMITS_NOT_LOWER`, `E_PAYEE_EXISTS`,
  `E_PAYEE_NOT_FOUND`, `E_PAYEE_ACCOUNT_IN_USE`, `E_PAYEE_FORBIDDEN_ACCOUNT`,
  `E_PAYEE_NOT_ACTIVE`, `E_INVOICE_EXISTS`, `E_INVOICE_NOT_FOUND`,
  `E_INVOICE_UNAUTHORIZED`, `E_INVOICE_CASE_MISMATCH`, `E_WRONG_TOKEN`,
  `E_AMOUNT`, `E_AMOUNT_OVERFLOW`.
- Proposals and caps: `E_PAUSED`, `E_AGENT_DISABLED`, `E_TTL`,
  `E_CAP_PAYMENT`, `E_INVOICE_CEILING`, `E_LIQUIDITY`, `E_CAP_LIFETIME`,
  `E_CAP_ROLLING`, `E_CAP_GROUP`, `E_BOUND_ACTIVE`, `E_BOUND_RATE`,
  `E_REQUEST_ID_CONFLICT`.
- Approval: `E_PROPOSAL_NOT_FOUND`, `E_BAD_STATE`, `E_EXPIRED`,
  `E_STALE_POLICY`, `E_PAYEE_CHANGED`, `E_FIELD_MISMATCH`,
  `E_COMMITMENT_MISMATCH`.
- Status reasons recorded without a panic: `E_TRANSFER_FAILED`,
  `E_REJECTED_BY_OWNER`, and the blocker code that invalidated or expired a
  proposal.
