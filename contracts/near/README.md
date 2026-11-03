# Kinwarden NEAR contracts

| Crate | What it is |
|---|---|
| [`vault`](vault) | Family payment vault: cases, verifier-enrolled payees and invoices, per-case deposits, agent proposals with reservations and caps, exact family approval bound to a commitment hash, settlement with failure recovery, owner withdrawal. **Not yet:** NEAR log anchoring (G4). |
| [`tusdc`](tusdc) | Kinwarden Test USD (tUSDC): a standard NEP-141 test token with 6 decimals and owner-only minting. It has no value and is not USDC. |
| [`integration-tests`](integration-tests) | Sandbox tests against a local NEAR node with both contracts deployed. |

Design and claims: [`docs/near/`](../../docs/near) — decisions, threat model,
state and encoding spec, and the [claim → test map](../../docs/near/CLAIMS.md).

## Requirements

Linux x86_64 with glibc ≥ 2.39 (Ubuntu 24.04+, Debian 13+) or macOS ARM64 for
the sandbox. The toolchain is pinned in `rust-toolchain.toml` (Rust 1.95.0,
`wasm32-unknown-unknown`).

- Ubuntu 24.04+: `bash setup-ubuntu.sh` installs Rust, cargo-near and near-cli-rs.
- Any Docker host: `docker build -f dev.Dockerfile -t kinwarden-near-dev .` then
  run commands inside `kinwarden-near-dev` with this directory mounted at `/work`.

## Commands

Run from this directory:

```bash
cargo test -p kinwarden-vault -p kinwarden-tusdc     # unit tests, seconds
cargo test -p kinwarden-near-tests                   # sandbox tests; first run downloads a NEAR node
(cd vault && cargo near build non-reproducible-wasm) # target/near/kinwarden_vault/kinwarden_vault.wasm
(cd tusdc && cargo near build non-reproducible-wasm) # target/near/kinwarden_tusdc/kinwarden_tusdc.wasm
```

The sandbox tests need no wallet, testnet account or API key, but they do need
the `cargo-near` CLI on `PATH`: they build both contracts with it before
deploying them. The first run compiles the NEAR test harness, which takes
several minutes.

Approval-commitment test vectors are regenerated with
`python vault/test-vectors/approval_commitment_v1.py`.
