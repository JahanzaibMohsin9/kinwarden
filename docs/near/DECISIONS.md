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
The sandbox node downloaded by `near-sandbox` (neard 2.14.0) needs glibc ≥ 2.39:
Debian 13 / Ubuntu 24.04 or newer, or the dev image (Debian trixie). It fails to
start on Debian 12 (glibc 2.36). The README states this requirement.
On a supported Linux host, [`contracts/near/setup-ubuntu.sh`](../../contracts/near/setup-ubuntu.sh)
installs the same toolchain without Docker.

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
  call them. **Confirmed on 2–3 Nov 2026** with a throwaway probe contract on a local
  NEAR sandbox (near-workspaces 0.24.0, neard sandbox 2.14.0, Ubuntu 24.04): the
  account's full-access key called a 1-yoctoNEAR method successfully; a
  function-call key on the same account, limited to that method, was rejected by
  the protocol before execution with
  `InvalidTransaction(InvalidAccessKeyError(DepositWithFunctionCall))`, and the
  contract state was unchanged. G1 turns this into a permanent sandbox test against
  the real vault methods.
- **Testnet-capable wallets in the connector manifest** (2 Nov): Meteor, Intear,
  Ledger, Nightly, NEAR CLI, WalletConnect and others. We filter the connector to
  `features: { testnet: true, signAndSendTransaction: true }`.
- **Primary demo wallet:** Meteor Wallet. **Deterministic fallback:** NEAR CLI
  (`near-cli-rs`), which prints the full transaction before signing.
- **Readable authorization.** Wallets show the method name and JSON arguments.
  The approval arguments therefore include the readable recipient, token and
  amount next to the commitment hash (D-04), so the wallet itself shows who is
  being paid what.

**Meteor display check, 2 November 2026** (testnet, `@hot-labs/near-connect`
0.12.0, sample `approve_payment` request with fictional values, rejected in the
wallet; screenshots in [wallet-check/](wallet-check/)):

| Observed | Result |
|---|---|
| Connect screen | States the app may know the address and balance, and that it does **not** allow calling methods or signing on the user's behalf. A read-only RPC query afterwards showed no key added to the account. |
| Approval summary screen | Shows From, To (the receiver contract), deposit and fee. It does **not** show the method or arguments. |
| "View Transaction Details" | Shows the method `approve_payment`, the contract, gas and **all arguments as readable JSON**, including `expected_recipient` and `expected_amount`. |
| Deposit display | Both screens display the 1-yoctoNEAR deposit as **0** (`0.000000000000000 NEAR`, `0 Ⓝ`), which is rounding. |

Consequences:

- **Readable authorization is available, one tap deep.** Before opening the
  wallet, the Kinwarden approval screen tells the family to open "View
  Transaction Details" and check that the recipient and amount there match the
  bill. The demo video shows that step.
- **The summary "To" is the vault, not the hospital.** The family-facing
  explanation says so, so nobody reads "To: vault" as the payee.
- **Verified on testnet, 3 Nov 2026:** Meteor attaches the 1 yoctoNEAR it
  displays as 0. The family's `approve_payment` transaction
  [Ej6saHJe…](https://testnet.nearblocks.io/txns/Ej6saHJebcSFZQQ18XxQQp9TSJ6E1xmbLukV76LWRSJZ)
  carries `deposit: 1` and settled the hospital deposit.

Meteor stays the primary demo wallet. NEAR CLI remains the fallback that prints
the full transaction, deposit included.

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

**Implemented in G2** with the arguments above (`proposal_id` is a JSON string,
as for all u64 values). The commitment hash for a proposal comes from the
`approval_preview` view, which also lists any blockers and the remaining
budgets; the wallet request is built from that view, and the contract
recomputes the hash itself rather than trusting the preview. Owner-side
companions: `reject_payment(case_id, proposal_id)` and
`withdraw(case_id, amount)`, both 1 yoctoNEAR.

## D-09 Pause invalidates, the agent cannot pick the payee

Decided in G2. Pausing a case, lowering its limits, switching its agent off or
revoking an invoice invalidates the affected pending proposals immediately and
releases their reservations; after unpausing, the agent must propose again and
the family approve again. A payee revocation can touch many cases, so the
proposals it affects are released lazily by the next action on each case or by
a public `sweep(case_id)`, which only ever releases. `propose_payment` takes an
invoice id, not a recipient: the vault reads the recipient, token and purpose
from the verifier's records.

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

## D-10 How the app uses the vault (G3)

- **Bridge, not a new rail.** The agent's `propose_payment` tool and the app's
  safety gateway are unchanged and run first. For the case linked in
  `.near/deployment.json`, a bank transfer to an enrolled institution that the
  gateway accepts is also proposed to the vault in tUSDC (the USD value at the
  invoice's issue-date sandbox rate, to the cent). From then on the server only
  observes the vault: the proposal's status drives approval, settlement,
  failure and release through the app's existing code paths.
- **Who holds which key.** The app server: only the agent's function-call key,
  checked on chain before use. The verifier: `scripts/near/verifier.mjs`, a
  separate process that authorizes each new hospital invoice. In the demo it
  trusts the app's simulated hospital; a real operator would confirm the bill
  with the institution. The family: its own wallet (testnet), or a TEST-ONLY
  harness key on the local sandbox. Setup and deployer keys: `.near/keys.json`,
  used only by the scripts and excluded from Git, Docker and Next output.
- **The browser checks the chain, not the server.** The approval screen reads
  the proposal and preview from NEAR RPC and recomputes the commitment hash
  before asking the wallet to sign.
- **Evidence of delivery.** The case receipt (JSON download, also shown readably
  in the app) names the recipient, token contract and exact amount, and keeps
  the family's approval and the settlement apart: the approval step, the token
  contract's NEP-141 transfer event and the vault's callback, each with its block
  time, read once from the final approval transaction and stored, because RPC
  nodes drop old transactions. Delivery follows the vault's record: `Settled` is
  delivered, `Failed` is a confirmed failure (the tokens never left the vault; the
  amount and its 24-hour budget return to the case), and `Submitted` is unknown
  (the amount stays in flight; nothing is refunded or resent). Every state comes
  with where the reserved money is and the family's next step. The simulated
  hospital's acknowledgement is a separate entry.
- **One world, one case.** NEAR runs for the main demo world only. Per-visitor
  sandbox copies stay on simulated rails, because each family case on chain
  belongs to one family. Each world run gets a random tag, so on-chain request
  and invoice ids are never reused after a reset.
- **Node versions.** Contracts built with near-sdk 5.30 need nearcore 2.14:
  the JS `near-sandbox` default (2.13.4) rejects them with a link error, so
  scripts and tests pin sandbox 2.14.0. Testnet ran 2.14.0-rc.5 (protocol 88)
  on 3 Nov 2026.
- **Testnet RPC.** `rpc.testnet.near.org` answered 429 "endpoint is deprecated"
  on 3 Nov 2026. The deployment and `setup.mjs` use dRPC
  (`https://near-testnet.drpc.org`, a published free-tier limit, browser CORS
  allowed). FastNEAR (`https://test.rpc.fastnear.com`) also works but
  rate-limited a short burst in our tests. The RPC is a setting in
  `.near/deployment.json`, read by the server, the verifier and the browser.

## D-11 Activity-log anchors on the vault (G4)

- **Where.** `anchor_log(case_id, seq, head, label)` on the vault, callable only
  by the agent account, so the app's existing restricted key signs it. The key's
  methods become `propose_payment`, `sweep` and `anchor_log`; a key without
  `anchor_log` still passes the app's check, and the app then anchors to Conflux
  if that is configured, or not at all.
- **What.** A SHA-256 head (64 lowercase hex), the log sequence number and a
  label of at most 96 printable ASCII characters (the world's run tag, scenario
  and milestone). No names, amounts or medical details.
- **Append-only, not ordered.** Each anchor gets the next index and the block
  time, and none is replaced. A reset demo world starts its log again at 1, so
  sequence numbers are not required to increase.
- **Bounded.** At most 200 anchors per case (`E_BOUND_ANCHORS`); each costs the
  vault about 0.002 NEAR of storage.
- **No state migration.** Anchors use their own raw storage prefix instead of a
  field in the contract struct, so the code can be redeployed onto an existing
  vault without changing its state layout.

## D-12 NEAR AI Cloud as the Live-mode model

Checked against the live API on 5 Nov 2026 with the team's key.

- **API.** NEAR AI Cloud is OpenAI-compatible at `https://cloud-api.near.ai/v1`
  (`/models`, `/chat/completions` with function tools). It joins DeepSeek and
  OpenAI on the app's existing Chat Completions path. `NEARAI_API_KEY` selects
  it first; `KINWARDEN_PROVIDER` and `KINWARDEN_MODEL` override, and
  `KINWARDEN_NEARAI_BASE_URL` changes the endpoint.
- **Model.** `deepseek-ai/DeepSeek-V4.1-Flash-1017`: NEAR AI's own deployment
  (`owned_by: nearai`), tool calling confirmed, $0.30 / $1.20 per million
  input / output tokens, and the same model family as the baseline's recorded
  DeepSeek runs. `Qwen/Qwen3.8-27B` and `z-ai/glm-5.3-flash` also called tools
  correctly in the same check. Models listed under other owners (OpenAI,
  Anthropic, Google) are routed to those companies.
- **No privacy claim from us.** NEAR AI describes this deployment as served
  from its attested TEE infrastructure. Kinwarden does not fetch or verify an
  attestation report, so it claims nothing about private or attested inference.
  What the model sees is unchanged: the app's privacy gateway masks names and
  identifiers before any provider call.
- **No fallback.** A failed NEAR AI call fails the run instead of switching to
  DeepSeek or OpenAI, so a run labelled NEAR AI was made by NEAR AI.
- **No payment authority.** The model key is not a NEAR account key. The model
  proposes through the app's tools; NEAR payments still need the verifier's
  invoice, the vault's limits and the family's wallet signature.
- **Reproduction.** Judges and CI have no model key. The live NEAR AI runs are
  saved in `recordings/` (model name and date inside) and replayed by
  `npm run eval:replay` through today's tools and safety gateway without
  calling a model.

## D-13 Provenance of the recorded NEAR AI decisions

Checked against the live API on 5 Nov 2026; the verifier is `scripts/near/verify-model.mjs`.

- **Why.** Replay re-executes decisions recorded from live runs. Without proof, a reader cannot tell
  them from decisions written by hand. NEAR AI signs each answer of its TEE-hosted models, so the
  recordings can carry that proof.
- **What is recorded.** For every chat completion of a NEAR AI run: the exact response bytes, the
  SHA-256 of the exact request bytes (requests are large and repeat the prompt), and NEAR AI's
  signature (`GET /v1/signature/{id}`, `signing_algo=ecdsa`). The client sends `x-no-aliasing: true`
  and `Accept-Encoding: identity` and keeps the bytes before parsing, as NEAR AI's docs require. Once
  per recording: the model's attestation report (`GET /v1/attestation/report`, `provider=near`) with
  nonce `sha256("kinwarden:<scenario>:<recording start>")`, so it cannot be reused for another recording.
- **What is checked.** The signed text is `model:sha256(request):sha256(answer)` for the recorded
  answer; the EIP-191 signature recovers to the signing key (viem); that key and the nonce are the
  report data of the model's Intel TDX quote; debug mode is off; the quote's signature chain and TCB
  status verify against Intel's collateral (`@phala/dcap-qvl` 0.7.0, pinned; online only); and every
  replayed tool call, with its exact arguments, is a tool call of the signed answer it points at.
  `npm test` runs the offline part on the curated recordings.
- **Limits, stated.** NVIDIA's GPU evidence is not checked. The request bytes are not kept, so the
  check proves what the model answered, not the full prompt it saw. Instances of a model share one
  signing key, so a signature does not identify the serving instance. The quote shows the key was in
  an up-to-date TDX enclave when the recording was made; it does not prove what software ran beyond
  what the quote measures.
- **Effect on D-12.** D-12 said Kinwarden does not verify attestation. For the recorded runs it now
  does, within the limits above. The privacy guarantee is unchanged: the app's gateway masks personal
  data before any provider call.
