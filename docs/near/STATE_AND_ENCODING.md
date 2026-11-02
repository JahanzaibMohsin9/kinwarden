# Kinwarden NEAR: payment state, reservations and approval encoding

> **Status: design (G0), not implemented.** G1-G2 implement this specification;
> tests must cite the section they cover. See [DECISIONS.md](DECISIONS.md).

All amounts are integer token units (`u128`, JSON string). tUSDC has 6
decimals, so `"250000000"` is 250 tUSDC. All times are contract block time in
nanoseconds (`env::block_timestamp()`); browser or simulator time is never used.

## 1. Stored records

**Case** — `case_id`, `owner` (family account), `status` (`Active` | `Paused`),
`policy_version: u64`, caps (§4), accounting (§3).

**Payee** (verifier-enrolled) — `payee_id`, `account` (token receiver),
`token`, `payee_version: u64`, `status` (`Active` | `Revoked`), `purpose_group`
(verifier-defined enum, e.g. `Hospital`, `Tuition`), `provenance` (opaque
verification reference).

**Invoice** (verifier-authorized) — `invoice_id` (canonical, unique per vault),
`case_id`, `payee_id`, `token`, `ceiling`, `paid`, `reserved`, `status`
(`Authorized` | `Revoked`). The verifier rejects a duplicate canonical
`invoice_id` at enrollment. Recognizing that two different scans describe the
same bill is the verifier's job; hashing does not do it.

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

Per token, the vault tracks `balance` (credited through `ft_on_transfer` from
the token contract), `reserved` and `in_flight`.

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
G1 publishes shared test vectors: a JSON file of inputs plus the expected hex
hash, checked by both the Rust unit tests and the TypeScript client tests. Every
field changed on its own must produce a different hash and a refused approval
(K01).

The hash binds the approval to exact stored state. It does not prove that an
invoice is genuine; that is the verifier's enrollment decision.

## 7. Reason codes

Refusals panic with a stable code prefix that tests assert, e.g.
`E_NOT_OWNER`, `E_NOT_AGENT`, `E_PAUSED`, `E_PAYEE_REVOKED`,
`E_INVOICE_UNAUTHORIZED`, `E_INVOICE_CEILING`, `E_CAP_PAYMENT`,
`E_CAP_ROLLING`, `E_CAP_LIFETIME`, `E_CAP_GROUP`, `E_LIQUIDITY`, `E_EXPIRED`,
`E_STALE_POLICY`, `E_COMMITMENT_MISMATCH`, `E_FIELD_MISMATCH`, `E_BAD_STATE`,
`E_REQUEST_ID_CONFLICT`, `E_BOUND_ACTIVE`, `E_ONE_YOCTO`. The final list is
fixed in G1.
