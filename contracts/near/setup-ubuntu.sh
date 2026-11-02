#!/usr/bin/env bash
# Installs the Kinwarden NEAR contract toolchain on Ubuntu 24.04+ / Debian 13+.
# Same versions as contracts/near/dev.Dockerfile. The NEAR sandbox node needs
# glibc >= 2.39, so older distributions should use the dev image instead.
set -euo pipefail

RUST_VERSION=1.95.0
CARGO_NEAR_VERSION=0.22.0
NEAR_CLI_VERSION=0.30.1

glibc=$(ldd --version | head -1 | grep -oE '[0-9]+\.[0-9]+$')
if [ "$(printf '%s\n2.39\n' "$glibc" | sort -V | head -1)" != "2.39" ]; then
  echo "glibc $glibc found; the NEAR sandbox needs >= 2.39. Use contracts/near/dev.Dockerfile." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential pkg-config libssl-dev libudev-dev clang curl ca-certificates git

if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain "$RUST_VERSION"
fi
# shellcheck disable=SC1091
. "$HOME/.cargo/env"
rustup toolchain install "$RUST_VERSION" --profile minimal
rustup default "$RUST_VERSION"
rustup target add wasm32-unknown-unknown

cargo install --locked "cargo-near@$CARGO_NEAR_VERSION"
cargo install --locked "near-cli-rs@$NEAR_CLI_VERSION"

rustc --version
cargo near --version
near --version
