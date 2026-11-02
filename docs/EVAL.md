# Evaluation

Run `npm test` for the unit and safety suites, and `npm run eval:replay` for the
four curated scenario replays. These checks use no API keys and move no real money.

The replay fixtures contain pre-existing recorded model decisions, with project
names updated. Each replay executes those decisions through the current gateway
and generates a new activity log. They are not new live-model results.

Historical live evaluation exports and signed evidence are not published as
Kinwarden results. Collect fresh evidence before making numerical claims.

With an API key and a running development server:

```sh
node scripts/eval.mjs run th-medical 10
node scripts/eval.mjs report
npm run redteam:llm
```

Live evaluations can incur provider costs. Review generated reports and logs
before including any in a public submission.
