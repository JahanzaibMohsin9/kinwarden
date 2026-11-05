#!/usr/bin/env bash
# One command for the NEAR evidence on a local node: contract unit tests, contract sandbox tests, the
# release WASM build, and the app on a local node (npm run test:near). Prints each suite with its
# count, then exits non-zero if any failed. No wallet, testnet account or API key.
#
#   bash scripts/near/check.sh                 # Linux x86_64 (glibc >= 2.39) or macOS ARM64,
#                                              # toolchain from contracts/near/README.md
#   bash scripts/near/check.sh --docker        # any Docker host: runs the same inside contracts/near/dev.Dockerfile
set -uo pipefail
cd "$(dirname "$0")/../.."

if [ "${1:-}" = "--docker" ]; then
  docker build -q -f contracts/near/dev.Dockerfile -t kinwarden-near-dev contracts/near >/dev/null || exit 1
  # node_modules and target stay inside the container's volumes so the host's (Windows/macOS) builds are untouched;
  # TMPDIR is on the node_modules volume because near-sandbox moves its downloaded node binary from TMPDIR into it
  exec docker run --rm -v "$PWD":/work -v kinwarden-near-target:/work/contracts/near/target -v kinwarden-node-modules:/work/node_modules \
    -w /work kinwarden-near-dev \
    bash -c 'npm ci --no-audit --no-fund >/dev/null && mkdir -p node_modules/.tmp && TMPDIR=/work/node_modules/.tmp bash scripts/near/check.sh'
fi

LOG=$(mktemp -d)
summary=()
failed=0

run() {
  local name=$1 dir=$2 cmd=$3 count=$4
  local log="$LOG/$(echo "$name" | tr ' ' '-').log" start=$SECONDS
  printf '%-38s' "$name"
  if (cd "$dir" && eval "$cmd") >"$log" 2>&1; then status=PASS; else status=FAIL; failed=1; fi
  local n
  n=$(eval "$count" <"$log")
  printf '%s  %-34s %4ss\n' "$status" "$n" "$((SECONDS - start))"
  summary+=("$status  $name  $n")
  [ "$status" = FAIL ] && tail -n 30 "$log" | sed 's/^/    /'
}

# "test result: ok. 98 passed; 0 failed" lines from cargo, summed
cargo_count='awk "/^test result:/ {p+=\$4; f+=\$6} END {printf \"%d passed, %d failed\", p, f}"'
# "Tests  5 passed (5)" from vitest, colour codes removed
vitest_count='sed "s/\x1b\[[0-9;]*m//g" | awk "/^ *Test Files/ {f=\$0} /^ *Tests  / {t=\$0} END {gsub(/^ +| +\$/, \"\", f); gsub(/^ +| +\$/, \"\", t); gsub(/ +/, \" \", f); gsub(/ +/, \" \", t); if (f) print f\" · \"t; else print \"no summary\"}"'
build_count='echo "wasm built"'

echo "Kinwarden NEAR check · $(git rev-parse --short HEAD 2>/dev/null || echo unknown) · logs in $LOG"
run "Contract unit tests" contracts/near "cargo test -p kinwarden-vault -p kinwarden-tusdc" "$cargo_count"
run "Contract tests on a local node" contracts/near "cargo test -p kinwarden-near-tests" "$cargo_count"
run "Release WASM build" . "(cd contracts/near/vault && cargo near build non-reproducible-wasm) && (cd contracts/near/tusdc && cargo near build non-reproducible-wasm)" "$build_count"
run "App on a local node (test:near)" . "npm run test:near" "$vitest_count"

echo
if [ -f contracts/near/target/near/kinwarden_vault/kinwarden_vault.wasm ]; then
  echo "Vault WASM sha256: $( (sha256sum 2>/dev/null || shasum -a 256) <contracts/near/target/near/kinwarden_vault/kinwarden_vault.wasm | cut -c1-64)"
fi
if [ "$failed" = 0 ]; then echo "All suites passed."; else echo "Some suites FAILED (see above)."; fi
exit "$failed"
