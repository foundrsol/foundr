#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export NEXT_TELEMETRY_DISABLED=1
export NODE_USE_ENV_PROXY=1
export CARGO_HOME="$PWD/.toolchains/cargo"
export RUSTUP_HOME="$PWD/.toolchains/rustup"
export PATH="$CARGO_HOME/bin:$PWD/.toolchains/solana-release/bin:$PATH"
export XDG_CACHE_HOME="$PWD/.toolchains/cache"
mkdir -p .toolchains .dev docs
npm run verify:upstream
npm run typecheck
npm run typecheck:tools
npm test
npm run build -- --webpack
if ! command -v cargo >/dev/null; then
  curl -fsSL --max-time 60 https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init -o .toolchains/rustup-init
  chmod 700 .toolchains/rustup-init
  .toolchains/rustup-init -y --no-modify-path --profile minimal --default-toolchain 1.90.0
fi
if [ ! -x .toolchains/anchor ]; then
  curl -fSL --max-time 300 https://github.com/otter-sec/anchor/releases/download/v1.2.1/anchor-1.2.1-x86_64-unknown-linux-gnu -o .toolchains/anchor
  echo '5c899379cbd9a843fa4a730a37ba7ab61357571ffc535036a9afa08e5cd0b99b  .toolchains/anchor' | sha256sum -c -
  chmod 700 .toolchains/anchor
fi
if ! command -v cargo-build-sbf >/dev/null; then
  # Official v4.3.0, source 825efd18292aff6ffcf9daa0f7612f21b3531a72.
  # Release asset digest inspected through the official GitHub release API.
  curl -fSL --max-time 300 https://github.com/anza-xyz/agave/releases/download/v4.3.0/solana-release-x86_64-unknown-linux-gnu.tar.bz2 -o .toolchains/agave.tar.bz2
  echo 'c97289a8abb1d0efb497d8b5cb285baabd9b7f8ea6647f5d145c5dc8ff3611e8  .toolchains/agave.tar.bz2' | sha256sum -c -
  tar -xjf .toolchains/agave.tar.bz2 -C .toolchains
fi
rustc --version
solana --version
.toolchains/anchor --version
npm run keys:devnet
cargo build-sbf --manifest-path program/Cargo.toml --tools-version v1.57 -- --locked
cargo build-sbf --manifest-path program/Cargo.toml --tools-version v1.57 --sbf-out-dir program/target/deploy/mainnet -- --locked --features mainnet-v2
cargo build-sbf --manifest-path protocol/programs/shell-protocol/Cargo.toml --tools-version v1.57 --sbf-out-dir protocol/target/deploy -- --locked
cd protocol
../.toolchains/anchor idl build -p shell_protocol -o ../src/protocol/idl.json -- --locked
cd ..
npm run test:programs
curl -fsS --max-time 30 https://api.devnet.solana.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' > .dev/devnet-genesis.json
python -c 'import json; assert json.load(open(".dev/devnet-genesis.json"))["result"] == "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "Unexpected Solana network"'
solana airdrop 2 --url https://api.devnet.solana.com --keypair .dev/deployer.json
solana program deploy program/target/deploy/shell_vault.so --use-rpc --url https://api.devnet.solana.com --keypair .dev/deployer.json --program-id .dev/program.json --upgrade-authority .dev/deployer.json --output json > .dev/deployment-result.json
node scripts/verify-deployment.ts
node scripts/devnet-flow.ts
solana program deploy protocol/target/deploy/shell_protocol.so --use-rpc --url https://api.devnet.solana.com --keypair .dev/deployer.json --program-id .dev/protocol.json --upgrade-authority .dev/deployer.json --output json > .dev/protocol-deployment-result.json
node scripts/verify-protocol-deployment.ts
node scripts/initialize-protocol.ts
npm run build -- --webpack
