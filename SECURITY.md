# Security policy

Kinwarden runs on **NEAR testnet only**. tUSDC is a test token with no value, and the hospitals,
universities and banks are simulated. A testnet exploit costs nothing, but it is still worth
reporting: the point of the project is that the money rules hold even when the AI agent or the app
server is compromised.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then
**Report a vulnerability**. The report stays private until it is fixed. Please do not open a public
issue for something exploitable. Include the steps to reproduce, the component and the impact.

## In scope

| Component | What matters most |
|---|---|
| [`contracts/near/vault`](contracts/near/vault) | Who may approve, enroll, authorize, withdraw or pause; reservations and limits; the approval commitment; settlement and failure callbacks; log anchors |
| [`contracts/near/tusdc`](contracts/near/tusdc) | Minting and transfers of the test token |
| `src/near/`, `src/server/near/`, `src/components/app/NearApproval.tsx` | The agent key check, what the approval screen shows and recomputes, how the app records approvals and outcomes |
| `src/server/agent/`, `src/domain/rules/` | The safety gateway between the model and the tools, the privacy masking, the payment rules |
| `scripts/near/` | The verifier, setup and evidence scripts |

The most useful findings break a claim in [docs/near/CLAIMS.md](docs/near/CLAIMS.md): a payment
that reaches an account the verifier did not enroll, an approval accepted for fields the family did
not sign, a limit that can be crossed, funds released or counted twice, or an action the agent's key
can take outside `propose_payment`, `sweep` and `anchor_log`.

## Out of scope

- Testnet funds, and the per-visitor sandboxes of the public demo (each visitor's world is their own).
- Published test material: the local NEAR node's default key and the test-only family key used by
  the end-to-end tests.
- Third-party services: NEAR RPC providers, NEAR AI Cloud, the wallet, GitHub.
- The simulated institutions and payment rails themselves.

## Known limits

They are stated rather than hidden: see "Not implemented yet" in the [README](README.md) and "What
these tests do not show" in [docs/near/CLAIMS.md](docs/near/CLAIMS.md). In short: no recovery path
if a settlement callback never runs; who controls the family account and whether an enrolled account
really belongs to a hospital are off-chain questions; NEAR AI's TEE attestation is not verified.

## What is tested

Each claim in [docs/near/CLAIMS.md](docs/near/CLAIMS.md) names the test that checks it, and
`npm test` fails if a named test disappears. Contract unit tests and contract tests on a local NEAR
node, the app against a local node (`bash scripts/near/check.sh`), targeted mutation checks, and the
attacks in [docs/redteam/ONCHAIN.md](docs/redteam/ONCHAIN.md) run from the repository. A daily
read-only job rechecks the testnet evidence against the chain (`node scripts/near/verify.mjs`).
The application's own safety design is described in [docs/SECURITY.md](docs/SECURITY.md).

## Safe harbour

Good-faith research on testnet, without attacking third-party infrastructure, taking data or
degrading the public demo for others, will not be met with legal action. Tell us before you publish
and we will credit you if you want.
