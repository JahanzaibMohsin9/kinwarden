# Execution evidence

No new signed execution evidence has been collected for this repository yet.
Historical source logs were not renamed and republished: changing log text would
invalidate its hashes and any existing on-chain anchors.

Use `node scripts/evidence.mjs` against a configured local instance to collect
fresh evidence. Review its generated JSON files before publishing; these files
are ignored by default. Optional chain anchoring needs a separately configured
testnet wallet and contract. NEAR evidence will be added after implementation.
