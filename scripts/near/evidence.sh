#!/usr/bin/env bash
# Regenerates the NEAR red-team evidence: builds both contracts, runs the app's NEAR sandbox tests and
# the vault mutation checks with their evidence written to docs/redteam/near/, then writes
# docs/redteam/ONCHAIN.md. Linux x86_64 (glibc >= 2.39) or macOS ARM64, toolchain from
# contracts/near/README.md, after `npm ci`.
#
#   bash scripts/near/evidence.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export KINWARDEN_EVIDENCE_DIR="$PWD/docs/redteam/near"
export KINWARDEN_COMMIT="${KINWARDEN_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)$(git diff --quiet HEAD -- 2>/dev/null || echo +changes)}"
(cd contracts/near/vault && cargo near build non-reproducible-wasm)
(cd contracts/near/tusdc && cargo near build non-reproducible-wasm)
npm run test:near
node scripts/near/mutants.mjs
node scripts/near/onchain-report.mjs
