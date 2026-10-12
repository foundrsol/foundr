#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_USE_ENV_PROXY=1
export PATH="$PWD/.toolchains/solana-release/bin:$PATH"
umask 077
# Exact-build tests, genesis, account absence and real fee-payer balance must
# pass. An unaudited owner deployment does not authorize public funding.
# --final is irreversible; Mainnet uses the user's chosen immutable policy.
node scripts/mainnet.ts preflight --deployment
test -f .mainnet/buffer.json
SHELL_BINARY_SIZE=$(wc -c < program/target/deploy/mainnet/shell_vault.so)
solana program deploy program/target/deploy/mainnet/shell_vault.so --use-rpc --url https://api.mainnet-beta.solana.com --commitment finalized --program-id .mainnet/program.json --keypair .mainnet/deployer.json --buffer .mainnet/buffer.json --max-len "$SHELL_BINARY_SIZE" --final --output json > .mainnet/deployment-result.json
node scripts/mainnet.ts verify
# Public funding remains gated by a genuine review and finalized lifecycle proof.
