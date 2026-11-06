# Evaluation

Run `npm test` for the unit and safety suites, and `npm run eval:replay` for the
four curated scenario replays. These checks use no API keys and move no real money.

The replay fixtures in `recordings/` are live NEAR AI Cloud runs of the four
scenarios, recorded on 5 Nov 2026 (`deepseek-ai/DeepSeek-V4.1-Flash-1017`); each
passed every evaluation check when it was recorded. Each replay executes the
recorded decisions through the current gateway and generates a new activity log;
it does not call a model. Every recorded answer carries NEAR AI's signature:
`node scripts/near/verify-model.mjs` checks that each replayed decision is in a
signed answer from the attested model ([D-13](near/DECISIONS.md)).

On 6 Nov 2026 the hospital case also ran live on NEAR AI through the NEAR vault
on testnet, with a wallet approval (README, "On NEAR testnet"). Its signed answers
are in `docs/near/evidence/2026-11-06-live/` and pass `verify-model.mjs`. One
observed model error: in its warning to the family about the forged email, the
model converted THB 138,000 to "≈ PKR 38,850" (about PKR 1.18 million is right).
Nothing was paid; the gateway checks payments and their amounts, not the figures in
messages to the family.

Historical live evaluation exports from the baseline (DeepSeek) are not published
as Kinwarden results. Collect fresh evidence before making numerical claims.

With an API key and a running development server:

```sh
node scripts/eval.mjs run th-medical 10
node scripts/eval.mjs report
npm run redteam:llm
```

Live evaluations can incur provider costs. Review generated reports and logs
before including any in a public submission.
