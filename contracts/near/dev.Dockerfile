# Linux build and sandbox-test environment for the Kinwarden NEAR contracts.
# The NEAR sandbox runs on Linux x86_64 and macOS ARM64 only, so Windows hosts
# use this image. Build: docker build -f contracts/near/dev.Dockerfile -t kinwarden-near-dev contracts/near
# The near-sandbox 2.14 node binary needs glibc >= 2.39, so the base is Debian trixie.
FROM rust:1.95-trixie

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
