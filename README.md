# Kinwarden

Kinwarden is a sandbox assistant for families paying hospital and university bills abroad. It checks invoices and payment rules, compares bank and card routes, prepares forms, requests family approval, and records the outcome in a tamper-evident activity log.

Institutions, bank transfers, card payments, exchange rates and refunds are simulated. No real money moves in the demo.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open [the demo stage](http://localhost:3000/stage), select **Scripted** in the director controls, then advance the scenario to see the institution, family and agent interact. Scripted mode uses no model or API key. **Replay** executes recorded decisions through the current tools and safety checks without an API key.

- [Family app](http://localhost:3000/app): review bills, messages, approvals and activity.
- [Director](http://localhost:3000/director): select scenarios, switch modes and advance events.
- [Attack lab](http://localhost:3000/attack): exercise the sandbox safety gateway.
- [Case pack](http://localhost:3000/pack): inspect the printable case record.

For **Live** mode, copy `.env.local.example` to `.env.local` and set a model provider key. Optional configuration uses the `KINWARDEN_` prefix. Keep credentials local. Passkeys work on localhost or an HTTPS deployment.

## Verify

```sh
npm test
npm run eval:replay
npx next typegen
npx tsc --noEmit
npx eslint src
npm run build
```

The unit suite includes safety, privacy, passkey, scenario and red-team checks. Replay evaluation covers the four recorded scenarios. Live-model evaluations require API credentials and are separate from these offline checks.

## NEAR HACKATHON

This repository starts from pre-existing, team-developed application code, imported with fresh Git history and renamed to Kinwarden. The `pre-hackathon` tag marks this application baseline before NEAR implementation. Existing agent tools, simulated payment rails, safety rules, passkey flow and optional Conflux testnet log anchoring belong to the baseline.

The NEAR work is a spending-policy vault, a test stablecoin, restricted agent keys, payment approval signed by the family through an independently controlled NEAR wallet, and on-chain log anchoring.

**Implemented in the contracts** ([`contracts/near`](contracts/near)): the tUSDC test token and the vault. In the vault, a family opens a case and funds it; a verifier enrolls institutions and authorizes invoices; the agent proposes a payment against an authorized invoice (it cannot choose the recipient); the amount is reserved against per-payment, invoice, rolling 24-hour, purpose-group and lifetime limits; the family approves the exact recipient, token, amount and commitment hash; and the vault pays the institution, recovering the funds if the transfer fails.

**Implemented in the app:** when a NEAR deployment and the agent key are configured, the hospital case's bank transfers settle in tUSDC through the vault. The app server holds only a function-call key for `propose_payment` and `sweep`, and checks that on chain before use. A separate verifier process authorizes invoices. The approval screen reads the proposal from NEAR, recomputes its hash in the browser and asks the family's wallet to sign. Settlement and failure follow from the vault's state. The case receipt names the exact recipient, token and amount, records the family's approval and the on-chain transfer as separate steps, and says whether delivery is confirmed, failed or still unknown, where the reserved money is and what the family can do next. Without a deployment the app runs on its simulated rails as before.

Each claim and its tests are in [docs/near/CLAIMS.md](docs/near/CLAIMS.md); design in [docs/near](docs/near).

**On NEAR testnet (3 Nov 2026):** the contracts are deployed under `kinwarden-demo.testnet` (vault `vault.kinwarden-demo.testnet`, token `tusdc.kinwarden-demo.testnet`). The hospital deposit ran end to end with a real Meteor wallet: the agent proposed it, the verifier authorized the invoice, the family approved in Meteor ([approval and settlement transaction](https://testnet.nearblocks.io/txns/Ej6saHJebcSFZQQ18XxQQp9TSJ6E1xmbLukV76LWRSJZ)), and the fictional hospital account received exactly 7,625.45 tUSDC. The case receipt from that run is in [docs/near/evidence](docs/near/evidence/2026-11-03-testnet-receipt.json). Testnet tokens have no value.

**Adversarial evidence (local NEAR node):** with the app's gateway bypassed, the agent's real NEAR key is refused for every action outside proposing, and nothing moves; switching the agent off and deleting its key stop it; a failed transfer returns the money to the case exactly once; and removing selected vault checks makes the tests fail. The results, generated from the test runs, are in [docs/redteam/ONCHAIN.md](docs/redteam/ONCHAIN.md), and the [attack lab](http://localhost:3000/attack) shows them and can rerun the bypass on a configured network.

**Log anchoring on NEAR:** the vault's `anchor_log` and the app's NEAR anchoring are implemented and tested on a local NEAR node. The testnet vault has not been upgraded to this code yet, so testnet anchors are not available.

**Not implemented yet:** the NEAR AI model provider.

### Try the NEAR flow on a local node (no wallet, no API key)

Linux x86_64 with glibc ≥ 2.39 (Ubuntu 24.04+) or macOS ARM64, with Node 24 and the Rust toolchain from [`contracts/near/README.md`](contracts/near/README.md):

```bash
(cd contracts/near/vault && cargo near build non-reproducible-wasm)
(cd contracts/near/tusdc && cargo near build non-reproducible-wasm)
npm ci
npm run test:near          # the whole flow as one end-to-end test
```

To click through it: run `node scripts/near/sandbox.mjs` (keeps a local node running and writes `.near/deployment.json` and `NEAR_AGENT_KEY`), then `npm run dev` and `node scripts/near/verifier.mjs` in two more terminals. Open the app, play the hospital scenario in Scripted mode until the deposit approval appears, and approve it with the test-only family key: `node scripts/near/family.mjs approve <paymentId>` (the approval sheet shows the command). The Money tab shows the vault case and, after settlement, the receipt. On testnet, `scripts/near/setup.mjs` deploys instead and the family uses its own wallet in the app.

Only changes after `pre-hackathon` are intended for the NEAR submission. Inspect work in progress with `git diff pre-hackathon..HEAD`. At submission, create `hackathon-submission` and add a public compare link for `pre-hackathon...hackathon-submission`.

## Development

See [architecture and development](docs/TECHNICAL.md), [security](docs/SECURITY.md), [deployment](docs/DEPLOY.md), and [evaluation](docs/EVAL.md).

The application uses Next.js, React, TypeScript, Tailwind CSS, Zod, model-provider SDKs and viem; versions are pinned by `package-lock.json`. Tests use Vitest. The inherited development notes identify Claude for coding and MiMo for Chinese-language review; Codex assisted with this repository setup.

Licensed under [MIT](LICENSE).
