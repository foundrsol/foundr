#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_HOME="$PWD/.toolchains/cargo"
export RUSTUP_HOME="$PWD/.toolchains/rustup"
export XDG_CACHE_HOME="$PWD/.toolchains/cache"
export PATH="$CARGO_HOME/bin:$PWD/.toolchains/solana-release/bin:$PATH"
if ! command -v cargo-build-sbf >/dev/null; then
  echo 'Install the pinned Rust 1.90.0 / Agave 4.3.0 toolchain documented in docs/deployment.md first.' >&2
  exit 1
fi
npm run verify:upstream
cargo build-sbf --manifest-path program/Cargo.toml --tools-version v1.57 -- --locked
cargo build-sbf --manifest-path program/Cargo.toml --tools-version v1.57 --sbf-out-dir program/target/deploy/mainnet -- --locked --features mainnet-v2
cargo build-sbf --manifest-path protocol/Cargo.toml --tools-version v1.57 --sbf-out-dir protocol/target/deploy -- --locked
