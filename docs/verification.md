# Verification evidence

Checks use actual client cryptography, AES-GCM/PBKDF2 envelopes, durable signing state, upstream Rust fixtures, real Chromium and the exact compiled SBF programs. Local execution and real Mainnet/Devnet read-only observations are reported separately.

## Executed checks

| Check | Actual result |
| --- | --- |
| Upstream verification | 87 vendored source files match pinned Git blob hashes |
| Frontend TypeScript | Passed; Next.js production build also checks types |
| Tools, keeper and runtime-test TypeScript | Separate strict check in `tsconfig.tools.json` |
| Client/network/fees/keeper tests | 54 passed, 0 failed |
| Compiled-program tests | Three passing matrices: Devnet vault, Mainnet vault, Devnet fee protocol |
| Local real Chromium | 16 passed, 0 failed; one production-only HTTPS relay check skipped locally |
| Public HTTPS website in Chromium | Vercel production: 17 passed, 0 failed; earlier Sites version 3 also passed 15 |
| Next.js 16.4.0 production webpack build | Passed; static Wallet, How it Works and developer routes generated |
| Actual Mainnet RPC | PublicNode through the same-origin relay and official CLI verify the full Mainnet genesis; immutable program bytecode and six finalized lifecycle transactions verified |
| Actual official Devnet RPC | Full genesis verified; both reserved program accounts absent |
| Actual Devnet deployer | Zero lamports |
| Actual Devnet faucet | HTTP 429; no airdrop signature |
| Actual Devnet program deployment/lifecycle | Blocked; no success or transaction signatures claimed |
| Real Phantom browser extension | Not automated; provider-interface fixtures used |

Raw output: [core](test-results/core.txt), [programs](test-results/programs.txt), [local browser](test-results/browser.txt), [public browser](test-results/browser-public.txt), [production build](test-results/build.txt), and [tools typecheck](test-results/tools-typecheck.txt).

## What the checks establish

* Create, backup verification, guarded deposit, partial/full withdrawal and fresh-key rotation execute in the actual compiled vault program.
* Ordinary-wallet-only spending, wrong WOTS roots, altered amounts/recipient/change, replay, different second commitments and consumed-account reinitialization are rejected.
* Duplicate operations, concurrent locks, reloads, crashes after key binding/signature persistence, lost RPC replies, identical retransmission, finalized expiry and stale backups are covered by durable-state tests.
* Real browser Web Crypto and IndexedDB perform encrypted export, password verification, reload/unlock and recovery into a clean profile.
* The public website test performs the full browser-to-local-SBF lifecycle: initialize, deposit 0.1 test SOL, withdraw 0.04, recover the pre-confirmation package in another browser profile, and withdraw the remaining 0.06. Its transaction signatures belong to an in-memory VM, not Devnet.
* Phantom-interface tests connect without cluster metadata, track account changes/disconnect, preserve connection during RPC timeout/mismatch, and block funding when deployment is absent. The actual Devnet RPC browser test sends no Solana transaction.
* Both paid-withdrawal packets fit 1,232 bytes. Public signature staging, core CPI, fee and split receipts are exercised; insufficient fee-payer funds roll back the vault operation itself.
* Protocol execution covers actual native/SPL collection, 80/20 accounting, donation-spend rejection, swaps against real disposable SPL pool accounts, real token burns, settlement replay/limits, treasury authorization, multisig/timelock, mint checks, optional stake/lock/nonce and owner-only unstake.
* A keeper timeout after an executed real VM burn reconciles its on-chain receipt without repeating the burn. SQLite rejects duplicate nonce claims and retains signed bytes across restart. An expired-quote renewal test preserves the original durable job ID.
* The public CA is visibly pending; a verified-address fixture shows the entire string and copies it exactly. Mobile wallet/protocol layouts do not overflow. Missing protocol deployments produce dashes, not financial claims.
* Integer lamports, rent, transaction fees, insufficient funds, exact decimals, rejected rounding and network/deployment mismatches have dedicated coverage.

The tests are engineering evidence, not an independent audit or a proof of complete quantum security.

## Exact compiled builds

Linux toolchain: Rust 1.90.0, Agave 4.3.0, SBF platform-tools v1.57, Anchor CLI/Rust crates 1.2.1, LiteSVM Node 1.6.0. Both Cargo lockfiles are included.

| Build | Bytes | SHA-256 |
| --- | --- | --- |
| Devnet vault SBF | 24,536 | `6e0854817445e11d87917ada41d90e1fd9a03c8407e6b33670120a85861c2506` |
| Mainnet vault SBF | 24,544 | `9cbc6ed720288666c45693350405a35022c0f20bf80723b143628a47f13bc62f` |
| Protocol SBF | 614,152 | `06ed329d771e21260f76fbee12299be66171c23732058e378679ff02fddf7010` |
| Generated Anchor IDL, canonical JSON | — | `f0506493f91edbc55afebe7619af4d8c3ea3da491d9633433b31a865a0c1226d` |

[runtime-evidence.json](runtime-evidence.json) records the successful exact-binary checks. These hashes do not assert either network deployment.

## Reproduce

    npm ci
    npm run verify:upstream
    npm run typecheck
    npm run typecheck:tools
    npm test
    npm run build:programs
    cargo build-sbf --manifest-path protocol/programs/shell-protocol/Cargo.toml --tools-version v1.57 --sbf-out-dir protocol/target/deploy -- --locked
    cd protocol
    ../.toolchains/anchor idl build -p shell_protocol -o ../src/protocol/idl.json -- --locked
    cd ..
    npm run test:programs
    SHELL_LIVE_RPC=1 npm run test:browser
    npm run build -- --webpack

For the public export, set `SHELL_BROWSER_URL=https://sonic-perseus-9a1cxls.vercel.app`. In this managed environment Chromium required the environment proxy CA in its trust store and a proxy bypass for localhost. Default sandbox subprocess restrictions required scoped runtime permissions; these transport constraints are not application security results.

The security hardening publication passed all 17 public Vercel checks, including actual read-only Mainnet and Devnet genesis verification. [Vercel browser output](test-results/vercel-public-browser.txt) and [production deployment evidence](vercel-evidence.json) record the current release. The earlier Sites version-3 suite also passed all 15 checks.

## Mainnet release verification

[mainnet-release-checks.json](mainnet-release-checks.json) and
[test-results/security-release.txt](test-results/security-release.txt) record the
latest frozen-source workflow: 54 unit tests, three actual SBF matrices, all 16
local Chromium checks including both real read-only RPC checks, one production-only relay test skipped locally, both typechecks,
upstream verification and production export. The record is generated only after
successful stages and matched to the source and binary. These are engineering
checks, not an independent review. The earlier complete workflow remains in
[test-results/vercel-release.txt](test-results/vercel-release.txt).

[security-verification.md](security-verification.md) documents the reviewed
spending path, history-retention and durability fixes, tested dependency patches
and two remaining moderate package advisories. Current/next keys and every
unresolved signed transaction survive history retirement. The Mainnet compiled
matrix tests eleven additional fresh-key rotations, clean-store recovery and
replay against a locally retired but permanently consumed vault receipt.

Mainnet coverage includes schema/storage isolation, rejecting Devnet packages
and signatures, full/partial rotation, wallet-only/wrong-key/substitution/replay
rejection, concurrent locks, crash after binding/signature persistence, ambiguous
RPC delivery, identical retransmission and clean-browser recovery. Both compiled
profiles test pre-funded initial and next PDAs. Mainnet release proof validation
checks historical transaction balances; later public donations cannot disable it.
Browser Mainnet fixtures contain only explicit local test attestations and actual
LiteSVM transactions, never a fabricated public deployment or review report.

The actual browser RPC check verifies PublicNode's full Mainnet genesis and
the deployed immutable program separately from pending public-launch approval. The official Mainnet endpoint's observed Origin
HTTP 403 led to the explicit pinned provider selection. HTTPS production uses a fixed same-origin POST-only rewrite to that provider's explicit root. The relay carries public RPC data; it never receives passwords, keys or recovery packages. The public browser suite verifies Mainnet while direct provider access is blocked. Phantom tests use its documented interface, not an installed live extension.

[mainnet-program-verification.json](mainnet-program-verification.json),
[mainnet-smoke-evidence.json](mainnet-smoke-evidence.json) and
[test-results/funded-mainnet-flow.txt](test-results/funded-mainnet-flow.txt)
record the real immutable Mainnet deployment and completed owner lifecycle.
All six finalized operations were independently rechecked through RPC, including
partial/full withdrawal, rotation and clean-store recovery. The remaining public
funding blocker is independent exact-build review, recorded in
[mainnet-preflight.json](mainnet-preflight.json). The earlier blocked command
logs are historical attempts, not the current deployment state.

[Public version-3 Chromium results](test-results/browser-public-mainnet.txt) and [actual Mainnet RPC browser evidence](mainnet-public-browser-rpc.json) record the deployed HTTPS verification. [Website publication evidence](mainnet-website.json) identifies saved version 3 and its exact pushed Git commit. That earlier Sites publication submitted no Mainnet transaction.

## Current minimalist interface

[Appearance verification](appearance.json) records the current production deployment, exact-source release and desktop/390px/320px layout checks. All 17 browser checks passed on the public HTTPS origin, with no horizontal overflow or page exceptions in the inspected layouts. [Desktop](ui-preview/desktop.png), [phone](ui-preview/phone.png) and [identity form](ui-preview/create-phone.png) screenshots show the actual deployed interface. The immutable Solana binary is unchanged; this publication submitted zero Solana transactions.

## Appearance checks

The latest local suite used light appearance; all 17 public browser checks passed with a saved dark preference, including encrypted identity creation, backup/recovery and compiled-SBF withdrawal/rotation. Clean browser contexts also cover default light. Dedicated UI checks passed mouse/keyboard toggling, reload and route persistence, pre-hydration palette application, synchronization between tabs and blocked-storage fallback. Desktop, 390px and 320px layouts had no horizontal overflow or uncaught page errors. [Dark desktop](appearance-preview/dark-desktop.png), [dark phone](appearance-preview/dark-phone.png) and [dark recovery](appearance-preview/dark-recover-phone.png) show the actual public interface. No new Solana transaction was submitted.
