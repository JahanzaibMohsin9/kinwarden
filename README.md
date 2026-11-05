# Kinwarden

**Live demo: [kinwarden.duckdns.org](https://kinwarden.duckdns.org)**: your own sandbox, replaying the recorded NEAR AI runs, with NEAR testnet data read live. The demo server holds no keys, so it cannot sign anything.

A family from Pakistan has to pay a Bangkok hospital for their father's heart procedure before treatment can go ahead. An AI agent can read the bill, check the hospital and prepare the payment, but nobody should have to trust that agent, or the server it runs on, with the family's money.

Kinwarden is an assistant for families paying hospital and university bills abroad. It checks invoices and payment rules, compares bank and card routes, prepares forms, asks the family to approve, and records the outcome in a tamper-evident activity log. On NEAR, the money sits in a vault contract: the agent can only *propose* paying an invoice that an independent verifier authorized, the family approves the exact payment in their own NEAR wallet, and the vault pays only the enrolled institution, within the family's limits.

**What is real:** the NEAR vault and test token contracts, deployed on NEAR testnet; the family's wallet approval; the token transfer to the institution's account; the agent's restricted NEAR key; log anchors on the vault; the agent's model, run live on NEAR AI Cloud. **What is simulated:** the hospitals and universities, bank transfers, card payments, exchange rates and refunds. tUSDC is a test token with no value. No real money moves.

**Testnet by design:** the institutions are fictional and no real hospital has agreed to receive funds, so a mainnet payment would only reach an account we control. The real parts are the family's wallet approval, the NEAR AI model, the on-chain enforcement and the keyless check below.

## Check it in three steps (no wallet, no API key)

| Do | See | Shows |
|---|---|---|
| **1.** `node scripts/near/verify.mjs` (Node 24, no `npm ci` needed) | `All 6 checks passed.` | The recorded testnet payment, rechecked against the public chain: the [case receipt](docs/near/evidence/2026-11-03-testnet-receipt.json) is unedited; the vault holds the proposal as `Settled`; the case owner's wallet signed `approve_payment` for exactly that recipient, token, amount and hash ([transaction](https://testnet.nearblocks.io/txns/Ej6saHJebcSFZQQ18XxQQp9TSJ6E1xmbLukV76LWRSJZ)); the token contract moved 7,625.45 tUSDC from the vault to the hospital's account; the agent's key today can call only `propose_payment`, `sweep` and `anchor_log`; the testnet vault runs the tested build; the log anchor is stored. |
| **2.** Open [docs/redteam/ONCHAIN.md](docs/redteam/ONCHAIN.md), "Gateway bypass with the real agent key" | 13 attempts, each refused, with the refusing layer and reason; balances before and after are equal | The agent's real NEAR key, used directly with the app bypassed (as an attacker who owns the app server would), cannot approve, enroll a payee, authorize an invoice, switch itself back on, withdraw, move tokens, add a key, deploy code or send NEAR; the vault refuses an unauthorized invoice and an over-limit amount. Run on a local node and on testnet. To rerun it yourself, see [Rerun the evidence on a local NEAR node](#rerun-the-evidence-on-a-local-near-node). |
| **3.** Same file, "Balance reconciliation: a failed transfer and its retry" | A 7-row table of vault, hospital and case balances | A confirmed failed transfer credits the hospital nothing and returns the money and its 24-hour budget to the case exactly once; while the outcome is unknown the amount stays in flight (not spendable, not refunded, not resent); the retry pays exactly once. |

What each piece of evidence proves: the **receipt hash** shows the receipt file was not edited after it was written; it does not prove the bill was genuine. The **chain** confirms that the case owner's account approved and the vault paid the enrolled account; whether that account belongs to a real hospital is the verifier's off-chain decision, simulated here. Steps 2 and 3 are generated from test runs by `scripts/near/evidence.sh`, not written by hand; the report names the tested commit and the WASM hash, and step 1 checks the testnet vault runs that same WASM.

Every claim, where it is enforced and the test that checks it: [docs/near/CLAIMS.md](docs/near/CLAIMS.md) (52 claims). `npm test` fails if a test named there is renamed or removed. A daily GitHub Actions job ([live-check](.github/workflows/live-check.yml)) reruns step 1 against the chain, so the testnet evidence is checked again every day, not just once.

## NEAR implementation

This repository starts from pre-existing application code (see [Hackathon baseline](#hackathon-baseline)). The NEAR work, all after the `pre-hackathon` tag:

- **Vault contract** ([`contracts/near/vault`](contracts/near/vault)). A family opens a case and funds it with tUSDC. A verifier enrolls institutions and authorizes invoices. The agent proposes a payment against an authorized invoice; it cannot choose the recipient. The amount is reserved against per-payment, invoice, rolling 24-hour, purpose-group and lifetime limits, so concurrent proposals cannot overspend. The family approves the exact recipient, token, amount, policy version and commitment hash, with 1 yoctoNEAR attached, which a restricted key cannot do. The vault pays the institution and, if the transfer fails, returns the money to the case once. Pausing, lowering limits, switching the agent off or revoking the invoice invalidates pending proposals. Proposals are bounded in number and lifetime.
- **Test token** ([`contracts/near/tusdc`](contracts/near/tusdc)): a standard NEP-141 token, 6 decimals. Not USDC.
- **App integration.** When a NEAR deployment and the agent key are configured, the hospital case's bank transfers settle in tUSDC through the vault. The app server holds only a function-call key for the vault's `propose_payment`, `sweep` and `anchor_log`, and checks that on chain before use. A separate verifier process authorizes invoices. The approval screen reads the proposal from NEAR, recomputes its hash in the browser and asks the family's wallet to sign; the server cannot approve. The case receipt names the exact recipient, token and amount, records the approval and the on-chain transfer as separate steps, and says whether delivery is confirmed, failed or unknown, where the reserved money is and what the family can do next. The institution's acknowledgement is a separate, simulated event.
- **Revocation.** The family can switch the agent off from the NEAR case card; its pending proposals are released and it cannot switch itself back on. Deleting its key stops it signing anything.
- **Log anchoring.** The app writes its activity log's head hash to the vault (`anchor_log`, agent key only) at case milestones; the anchor check names any later edit to the log.
- **NEAR AI Cloud model.** In Live mode the agent runs on NEAR AI Cloud when `NEARAI_API_KEY` is set (`deepseek-ai/DeepSeek-V4.1-Flash-1017`, NEAR AI's own deployment), through the same tools and safety gateway as before. A NEAR AI run never falls back to another provider. The model key has no NEAR account authority: whatever the model decides, payments still need the verifier's invoice, the vault's limits and the family's wallet. The four replays in [`recordings/`](recordings) are live NEAR AI runs from 5 Nov 2026, recorded on the simulated rails; in the hospital run the model flagged the look-alike "new bank details" email. NEAR AI describes this model as served from its attested TEE infrastructure; Kinwarden does not verify attestation and makes no privacy claim from it ([D-12](docs/near/DECISIONS.md)).
- **Forged-proposal defence.** The approval screen recomputes the commitment hash from the proposal it reads, so a field changed between the vault and the browser turns Approve off. A forgery that also fakes the hash can fool the browser, but the vault compares the signed approval with the proposal it stored and refuses it; nothing moves (C52, tested on a local node).
- **Attack lab** ([localhost:3000/attack](http://localhost:3000/attack)) shows the agent key's live permissions and the recorded bypass run, and can rerun the bypass on a configured network. Without the agent's private key (as on a public demo), it reads the permissions from public RPC and shows the run recorded on testnet.

**On NEAR testnet** (accounts under `kinwarden-demo.testnet`; vault `vault.kinwarden-demo.testnet`, token `tusdc.kinwarden-demo.testnet`):

| Date | What happened | Evidence |
|---|---|---|
| 3 Nov 2026 | Hospital deposit end to end with a real Meteor wallet: agent proposed, verifier authorized, family approved, hospital account received exactly 7,625.45 tUSDC | [approval and settlement tx](https://testnet.nearblocks.io/txns/Ej6saHJebcSFZQQ18XxQQp9TSJ6E1xmbLukV76LWRSJZ), [receipt](docs/near/evidence/2026-11-03-testnet-receipt.json) |
| 4 Nov 2026 | Vault upgraded in place to the tested build; agent key rotated; gateway bypass with the real key: 13 of 13 refused, balances unchanged | [ONCHAIN.md](docs/redteam/ONCHAIN.md), [bypass-testnet.json](docs/redteam/near/bypass-testnet.json) |
| 4 Nov 2026 | Log head anchored on the vault; an edit to the log was detected, then restored | [anchor tx](https://testnet.nearblocks.io/txns/2VaDSfVR24b95gLQ34kpdW3mC7ggBVQY5mHMJJEXzKYE), [anchor-testnet.json](docs/redteam/near/anchor-testnet.json) |

Revocation, the failed-transfer reconciliation and the mutation checks were run on a local NEAR node only. A failed or unknown outcome was not exercised on testnet.

**Not implemented yet:** a visitor cannot open a NEAR vault case for their own bill (an uploaded bill is priced and paid on the simulated rails only); funding a case through NEAR Intents; verifying NEAR AI's TEE attestation; gas sponsorship for the family (meta transactions); recovery when a settlement callback never runs (the proposal stays `Submitted` with its funds held). These tests do not show who controls the family account or that an enrolled account belongs to a real hospital.

### Prior art, and what Kinwarden adds

Scoped function-call keys, payee allowlists, spending caps and approval of an exact hash are established patterns, and other payment-agent projects use them too. Kinwarden's contribution is how they fit one family paying one institution's bill: the recipient comes from an independent verifier's enrollment, never from the agent; every payment is tied to a verifier-authorized invoice, with reservations counted against the invoice, the purpose group and the family's rolling and lifetime limits; each payment is approved individually in the family's own wallet, which signs the hash the browser recomputed; and failed or unknown transfer outcomes are reconciled and shown to the family with where the money is and the next safe step.

## Run the app

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open [the demo stage](http://localhost:3000/stage), select **Scripted** in the director controls, then advance the scenario to see the institution, family and agent interact.

- [Family app](http://localhost:3000/app): review bills, messages, approvals and activity.
- [Director](http://localhost:3000/director): select scenarios, switch modes and advance events.
- [Attack lab](http://localhost:3000/attack): exercise the safety gateway and see the NEAR key bypass.
- [Case pack](http://localhost:3000/pack): inspect the printable case record.

Agent modes: **Scripted** follows a fixed plan and uses no model. **Replay** re-executes the decisions of recorded live NEAR AI Cloud runs ([`recordings/`](recordings); the model and date are inside each file) through today's tools, safety gateway and rules, without calling a model or needing a key. **Live** calls a model provider: copy `.env.local.example` to `.env.local` and set `NEARAI_API_KEY` (or a DeepSeek, OpenAI or Anthropic key). Optional configuration uses the `KINWARDEN_` prefix. Keep credentials local. Passkeys work on localhost or an HTTPS deployment.

Without a NEAR deployment the app runs on its simulated payment rails.

## Tests

```sh
npm test               # 23 files, 145 tests: safety, privacy, passkey, scenarios, red team, NEAR app code, claim map
npm run eval:replay    # 5 tests: the four live NEAR AI runs replayed without a model key, and the forged-email check
npx next typegen && npx tsc --noEmit
npx eslint src
npm run build
```

Live-model evaluations (`npm run eval:live`) need API credentials and are separate from these offline checks. CI runs the typecheck, lint, unit tests and replay on every push, and the contract and local-node tests below.

## Rerun the evidence on a local NEAR node

No wallet, testnet account or API key. The local node runs on Linux x86_64 with glibc ≥ 2.39 (Ubuntu 24.04+, Debian 13+) or macOS ARM64. On Ubuntu, `bash contracts/near/setup-ubuntu.sh` installs the pinned Rust toolchain and `cargo-near`; on any Docker host, use [`contracts/near/dev.Dockerfile`](contracts/near/dev.Dockerfile) (see [`contracts/near/README.md`](contracts/near/README.md)).

```bash
npm ci
bash scripts/near/check.sh            # or, on any Docker host: bash scripts/near/check.sh --docker
```

Expected output (fresh clone on Ubuntu 24.04, 4 vCPUs, about 10 minutes the first time):

```text
Contract unit tests                   PASS  98 passed, 0 failed
Contract tests on a local node        PASS  20 passed, 0 failed
Release WASM build                    PASS  wasm built
App on a local node (test:near)       PASS  8 tests passed in 6 files

Vault WASM sha256: 732efbe16dc736a12e1a6be3d3edffade747439cbe259695d37c4ce229f95ff4
All suites passed.
```

The script exits non-zero if any suite fails. Built natively on Ubuntu 24.04, the vault WASM hash above is the code the testnet vault runs; step 1's `verify.mjs` compares the two. The `--docker` run passes the same suites but prints a different hash, because a non-reproducible build embeds its build path. The same steps by hand:

```bash
(cd contracts/near && cargo test -p kinwarden-vault -p kinwarden-tusdc)   # contract unit tests
(cd contracts/near && cargo test -p kinwarden-near-tests)                 # contracts on a local node
(cd contracts/near/vault && cargo near build non-reproducible-wasm)
(cd contracts/near/tusdc && cargo near build non-reproducible-wasm)
npm run test:near
```

`npm run test:near` deploys both contracts to a fresh local node and runs the app against them: the hospital case end to end (proposal, verifier, family approval with a test-only harness key, hospital paid, receipt); the bypass with the agent's real key (all 13 attempts refused, balances equal); switching the agent off and deleting its key; the failed-transfer reconciliation table; the log anchor and tamper check; forged proposals signed by the family's wallet (all refused by the vault, nothing moved); and the recorded NEAR AI hospital run replayed with the vault connected (its deposit goes only to the enrolled hospital, which receives exactly what the family approved). Expect `Test Files 6 passed`. The first run downloads a NEAR node and compiles for several minutes.

`bash scripts/near/evidence.sh` runs the same tests plus the vault mutation checks (each removes one hard check; the vault's tests must fail) and rewrites `docs/redteam/near/*.json` and [ONCHAIN.md](docs/redteam/ONCHAIN.md) from the results.

**Click through it locally:** run `node scripts/near/sandbox.mjs` (keeps a local node running and writes `.near/deployment.json` and `NEAR_AGENT_KEY`), then `npm run dev` and `node scripts/near/verifier.mjs` in two more terminals. Play the hospital scenario in Scripted mode until the deposit approval appears, and approve it with the test-only family key: `node scripts/near/family.mjs approve <paymentId>` (the approval sheet shows the command). The Money tab shows the vault case and, after settlement, the receipt. On testnet, `scripts/near/setup.mjs` deploys instead and the family approves with their own wallet in the app.

## Hackathon baseline

This repository starts from pre-existing, team-developed application code, imported with fresh Git history and renamed to Kinwarden. The `pre-hackathon` tag marks this baseline before NEAR implementation. The agent tools, the LLM agent and its DeepSeek, OpenAI and Anthropic providers, simulated payment rails, safety rules, passkey flow and optional Conflux testnet log anchoring belong to the baseline. Only changes after `pre-hackathon` are intended for the NEAR submission: inspect them with `git diff pre-hackathon..HEAD`. At submission, `hackathon-submission` will be tagged with a public compare link for `pre-hackathon...hackathon-submission`.

## Development

See [architecture and development](docs/TECHNICAL.md), [security](docs/SECURITY.md) and the [security policy](SECURITY.md), a one-file summary for AI reviewers ([llms.txt](llms.txt)), [deployment](docs/DEPLOY.md), [evaluation](docs/EVAL.md), and the NEAR [decisions](docs/near/DECISIONS.md), [threat model](docs/near/THREAT_MODEL.md) and [state and encoding](docs/near/STATE_AND_ENCODING.md).

The application uses Next.js, React, TypeScript, Tailwind CSS, Zod, model-provider SDKs, viem and near-api-js; versions are pinned by `package-lock.json`. Contracts use Rust and near-sdk. Tests use Vitest and cargo test. Tools used: the baseline's development notes identify Claude for coding and MiMo for review of a Chinese-language interface that has since been removed; Codex assisted with this repository setup. The NEAR work after `pre-hackathon` (contracts, app integration, evidence tooling and documentation) was written with Claude Code (Anthropic) under the team's direction and review.

Licensed under [MIT](LICENSE).
