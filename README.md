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

The planned NEAR work is a spending-policy vault, a test stablecoin, restricted agent keys, browser-held family approval keys and on-chain log anchoring. **These features are not implemented yet.** Current sandbox payments do not settle on NEAR.

Only changes after `pre-hackathon` are intended for the NEAR submission. Inspect work in progress with `git diff pre-hackathon..HEAD`. At submission, create `hackathon-submission` and add a public compare link for `pre-hackathon...hackathon-submission`.

## Development

See [architecture and development](docs/TECHNICAL.md), [security](docs/SECURITY.md), [deployment](docs/DEPLOY.md), and [evaluation](docs/EVAL.md).

The application uses Next.js, React, TypeScript, Tailwind CSS, Zod, model-provider SDKs and viem; versions are pinned by `package-lock.json`. Tests use Vitest. The inherited development notes identify Claude for coding and MiMo for Chinese-language review; Codex assisted with this repository setup.

Licensed under [MIT](LICENSE).
