# Linux build and sandbox-test environment for the Kinwarden NEAR contracts.
# The NEAR sandbox runs on Linux x86_64 and macOS ARM64 only, so Windows hosts
# use this image. Build: docker build -f contracts/near/dev.Dockerfile -t kinwarden-near-dev contracts/near
FROM rust:1.95-bookworm

RUN rustup target add wasm32-unknown-unknown \
 && apt-get update \
 && apt-get install -y --no-install-recommends clang libudev-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

RUN cargo install --locked cargo-near@0.22.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends libssl-dev \
 && rm -rf /var/lib/apt/lists/* \
 && cargo install --locked near-cli-rs@0.30.1

WORKDIR /work
