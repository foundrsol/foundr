# Deployment status and remaining Devnet commands

The public website is live at https://sonic-perseus-9a1cxls.vercel.app. The website's publication does not deploy a Solana program. [Vercel evidence](vercel-evidence.json) records the ready production deployment and public route/manifest verification.

**Neither reserved Solana program exists on Devnet.** The compiled source was tested locally, but no Devnet deployment, mint creation, paid transaction or vault lifecycle succeeded. All public money-operation gates remain disabled.

| Field | Actual value/status |
| --- | --- |
| RPC | `https://api.devnet.solana.com` |
| Full verified genesis | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Reserved vault identity | `H5dQjE5MxyTCcwVuDcrVH3yUTeP51t6CvBvg9T4FzPds` |
| Reserved protocol identity | `CBZ5KvpvwfKphy1Mrrgsocey5KDimz47ajYmjNWVGWd6` |
| Dedicated development deployer/upgrade authority | `DEQAd3kXd8rbcJQc3bETCM5nvpvEcPWtEfrVTUvzc7dL` |
| Deployer balance | 0 lamports |
| ProgramData and deployment slots | Not established |
| Deployment/lifecycle transaction signatures | None |
| Real $SHELL CA and production treasury/multisig | Not supplied |
| Mainnet programs and production DEX | Not deployed or enabled |

Address lookups: [vault](https://explorer.solana.com/address/H5dQjE5MxyTCcwVuDcrVH3yUTeP51t6CvBvg9T4FzPds?cluster=devnet), [protocol](https://explorer.solana.com/address/CBZ5KvpvwfKphy1Mrrgsocey5KDimz47ajYmjNWVGWd6?cluster=devnet), [development deployer](https://explorer.solana.com/address/DEQAd3kXd8rbcJQc3bETCM5nvpvEcPWtEfrVTUvzc7dL?cluster=devnet). These links are not evidence of deployment.

## Exact blocker

Official RPC works. On 2026-10-10, a 2-SOL faucet retry returned RPC `-32603: Internal error`; a smaller 1-SOL request returned HTTP **429**: “You've either reached your airdrop limit today or the airdrop faucet has run dry. Please visit https://faucet.solana.com for alternate sources of test SOL”. The finalized deployer balance remains zero. [Latest attempt](deployment-attempt-2026-10-10.json) and [faucet evidence](faucet-evidence.json) record the actual responses. [RPC evidence](devnet-rpc-evidence.json) records both absent program accounts and the zero deployer balance. No program deployment transaction was submitted.

Rust/Agave/Anchor are now installed and both exact SBF builds pass execution tests. Compiler availability is no longer the blocker. No real funds should be requested to address this; the remaining requirement is Devnet test SOL sufficient for program rent, temporary deployment buffers, test account rent and controlled liquidity.

## Continue in this workspace

Private development keys live only in ignored `.dev/`, with mode 0600, and are excluded from every publication/source archive. Obtain **Devnet test SOL only** for the disposable deployer at https://faucet.solana.com, then:

    export CARGO_HOME="$PWD/.toolchains/cargo"
    export RUSTUP_HOME="$PWD/.toolchains/rustup"
    export XDG_CACHE_HOME="$PWD/.toolchains/cache"
    export PATH="$CARGO_HOME/bin:$PWD/.toolchains/solana-release/bin:$PATH"
    export NODE_USE_ENV_PROXY=1
    npm run diagnose:devnet
    npm run test:programs
    solana balance --url https://api.devnet.solana.com --keypair .dev/deployer.json
    solana program deploy program/target/deploy/shell_vault.so --use-rpc --url https://api.devnet.solana.com --keypair .dev/deployer.json --program-id .dev/program.json --upgrade-authority .dev/deployer.json --output json > .dev/deployment-result.json
    node scripts/verify-deployment.ts
    node scripts/devnet-flow.ts
    solana program deploy protocol/target/deploy/shell_protocol.so --use-rpc --url https://api.devnet.solana.com --keypair .dev/deployer.json --program-id .dev/protocol.json --upgrade-authority .dev/deployer.json --output json > .dev/protocol-deployment-result.json
    node scripts/verify-protocol-deployment.ts
    node scripts/initialize-protocol.ts
    npm run build -- --webpack

The lifecycle script also requires a separate disposable faucet-funded payer. Faucets can independently block that step; its encrypted test state is retained if the outcome is unknown.

`verify-protocol-deployment.ts` pins actual binary/IDL hashes, loader ownership, ProgramData, slot and authority. Initialization creates **disposable Devnet test mints** and controlled test liquidity, then pins the actual mint/admin/treasury addresses only after validation. Three development admin keys are in one environment; this is not independent production governance.

Do not manually set either manifest's `verified` flag. The verifiers require passing exact-binary SVM evidence and compare live bytecode, including padding. The browser repeats those checks before signing and submission. The vault uses a real manual Pinocchio ABI; the fee program has a generated Anchor IDL. Upstream Winterwallet ID/IDL cannot replace either one.

## From a clean source archive

The original private program keys are intentionally absent. Create a new **unfunded** Devnet fork with `SHELL_NEW_DEVELOPMENT_DEPLOYMENT=1 npm run keys:devnet`, rebuild both binaries and regenerate the IDL, then run `bash scripts/verify-runtime.sh`. Never use that fork command to replace an existing funded vault's deployment.

The runtime script stops on errors, never changes cluster, and writes successful public transaction evidence only after actual execution. Mainnet requires a separately reviewed domain/deployment migration and all release requirements in the README.

An upgrade authority can change spending rules. The planned disposable authority above is disclosed; the prototype is not trustless. Frontend checks cannot eliminate an upgrade between validation and transaction execution.

## Mainnet release preparation

The root website now selects the separate Mainnet-v2 profile; Devnet remains at `/devnet`. See [mainnet.md](mainnet.md) and [mainnet-preflight.json](mainnet-preflight.json) for the distinct reserved identity, immutable deployment procedure and actual launch blockers. Publishing the site does not deploy either program or enable funding.
