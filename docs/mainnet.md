Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

# Mainnet release preparation

The website has a separate Mainnet SOL-vault implementation at `/`, and keeps
the existing Devnet implementation at `/devnet`. **Implementation preparation
does not mean a live, reviewed Mainnet deployment.** Funding stays disabled until
the complete public release gate passes. Owner-funded deployment and bounded
lifecycle verification are separate from approval to accept public deposits.

## Actual addresses and current blockers

The dedicated keys were generated locally with a CSPRNG and are ignored, private
files under `.mainnet/`. They are deployment/test keys, not a user's wallet seed.

| Item | Actual state |
| --- | --- |
| Reserved Mainnet program | `DC4PEctnFZH4qcGAJzbGWi47AUrac7QuBRtD8DtLqdk4`; deployed, executable, exact bytecode verified |
| Dedicated development fee payer | `45Vxy36SWNd1DrMZWqn1QkVhRgCqfhHPB9uLnw4xqqgy`; received 300,000,000 lamports (0.3 SOL), finalized |
| Required upgrade policy | Immutable; `solana program deploy --final` |
| Live ProgramData | `GgNpv2WTgVm4gzxMb4UZ9rEZNyGQCoC78nFLBLSgxc9A` |
| Deployment slot | `455239788` |
| Deployment transaction | `3dxWFSwSgF7kbXAV8jZrqq6mjf4cuUB2qwhkGK6JG4QtaSUHPwUb7JGq3dmKFnjXHYd7mL7taUTPT3JiWceKtaq5` |
| Finalization transaction | `2YaPs7pUj9r8oqPovUwSxYwM1ZAtQCFdvJ8j9atBkuukyXgDoRcAroHXomuYsFYsNjVcX81KguqpMf8T3YGoPA6m`; upgrade authority absent |
| Independent exact-build security review | Not supplied or verified |
| Finalized Mainnet lifecycle evidence | Passed: create, deposit, partial/full withdrawal, rotation, clean-store recovery; six real transactions |
| $SHELL CA and production treasury | Not supplied; no token is invented |

[Program address lookup](https://explorer.solana.com/address/DC4PEctnFZH4qcGAJzbGWi47AUrac7QuBRtD8DtLqdk4)
and [fee-payer address lookup](https://explorer.solana.com/address/45Vxy36SWNd1DrMZWqn1QkVhRgCqfhHPB9uLnw4xqqgy)
identify the real program and dedicated fee payer.
[mainnet-program-verification.json](mainnet-program-verification.json) records
actual finalized bytecode, loader and authority checks. The
[deployment transaction](https://explorer.solana.com/tx/3dxWFSwSgF7kbXAV8jZrqq6mjf4cuUB2qwhkGK6JG4QtaSUHPwUb7JGq3dmKFnjXHYd7mL7taUTPT3JiWceKtaq5)
and [immutability transaction](https://explorer.solana.com/tx/2YaPs7pUj9r8oqPovUwSxYwM1ZAtQCFdvJ8j9atBkuukyXgDoRcAroHXomuYsFYsNjVcX81KguqpMf8T3YGoPA6m)
are real finalized Mainnet receipts; they do not imply independent review.
[mainnet-preflight.json](mainnet-preflight.json) records actual finalized
official-RPC observations, build/source hashes, exact blockers and rent quotes.
Its timestamps are UTC machine evidence; user-facing dates use Asia/Shanghai.

The observed preparation budget is **252,917,200 lamports (0.252917200 SOL)**:
833,120 for the executable account, 125,562,360 for exact-length ProgramData,
125,521,720 for the temporary upload buffer, plus a 1,000,000-lamport fee
allowance. The buffer is temporary; this is a conservative peak funding quote,
not a promised final cost. Preflight recalculates it from the actual cluster.
The user funded the dedicated development fee payer with 0.3 SOL.
[mainnet-funding-observation.json](mainnet-funding-observation.json) records the
finalized incoming transfer. It is funding evidence, not a deployment transaction.
The release preflight reports the current balance after any deployment or checks.

## Actual completed owner lifecycle

The bounded owner check completed on Mainnet; the full independent RPC receipt
recheck passed. [mainnet-smoke-evidence.json](mainnet-smoke-evidence.json) records
all signatures, amounts, addresses and clean-store recovery.

| Operation | Actual finalized transaction |
| --- | --- |
| Initialize vault | [Explorer](https://explorer.solana.com/tx/4vwBQyrnE4Jm1oaNvH3hjbQrbjE4GqSHePYuRNsedg2NSDK6jVbNfuo2sYF8Y2eKxvb2z5WcxdVqe4miNm93dJnn) |
| Deposit 0.002 SOL | [Explorer](https://explorer.solana.com/tx/2XsHhkwt9eLE8aN18niwtpmafp6dS1ZUufqczY8Pbj9gVNskY7mDW7B6w8CBY3xWpvksVvM8gjCFCsWtF1m34d9D) |
| Commit partial withdrawal | [Explorer](https://explorer.solana.com/tx/2oFteoP6c1Tb9CNyaSAdU4EMcocpCszAyfkJbZhourK8rpi9W87DxufbUbWsdRHyaJygneszf9fjkhq9WfyAM2R) |
| Withdraw 0.001 SOL and rotate | [Explorer](https://explorer.solana.com/tx/2JdgXHvk72d8Szn5MaGt5vuEqdvmAqK9k7hrJzqhtMzbzZT2LoLc9VrXw7rEypRujeaaz1hB58cp399BpX4CxVko) |
| Commit full withdrawal after clean-store recovery | [Explorer](https://explorer.solana.com/tx/2ykp1ofq3gw3jEzsmUTUbUHRxLfzcg7v6V3xDwDxTxy4EzCJNcvgDZKYuX4Jp2qit7DcVWj181SRuB8iyLTa2CZ7) |
| Withdraw remaining 0.001 SOL and rotate | [Explorer](https://explorer.solana.com/tx/2cYPoM4oiVi1845QCEjBfSEoJiReEbPsa7ZcJnm6ke1CxjwTsLGPpGyso24gx3DLxBexmvoxXx5peQQgPEaZJvh4) |

The first two vault records are consumed; the third is available with zero
spendable SOL. Each retains **1,524,000 lamports** of actual Mainnet rent, as
queried from the cluster. The app uses live rent quotes rather than assuming
Devnet and Mainnet costs match.

The disposable recipient's 0.002 SOL was returned to the deployment wallet,
less the 5,000-lamport transfer fee. [Refund receipt](https://explorer.solana.com/tx/24oyFtsMCyPNg8YNNG8L54murpKvM58tGmLExC3ZjMQ4jVPfwjHFFnjXtTm7bMLVhkJ72LbBuspGnxPxG51PXdVN) and
[funds accounting](mainnet-funds-accounting.json) record **168,832,520 lamports
(0.168832520 SOL)** remaining, **131,167,480 lamports** used in program rent,
three permanent vault records and network fees, and 35 observed finalized
transactions since funding (including upload transactions). The rejected first
refund preflight had an invalid conventional-wallet blockhash; it spent nothing
and involved no Winternitz key. A reconciled ordinary-wallet retry finalized.

Public funding is still disabled. The remaining release blocker is independent
review of the exact source and binary; deployment and tests are not an audit.

## Network and authorization

Mainnet RPC genesis must equal the full
`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` hash.
The official `https://api.mainnet-beta.solana.com` endpoint works for the CLI,
but returned HTTP 403 `Access forbidden` with both localhost and published-site
Origin headers. The frontend therefore pins `https://solana-rpc.publicnode.com`,
which returned HTTP 200, CORS support and the same complete genesis. Devnet
continues to use `https://api.devnet.solana.com`. HTTPS production browsers post
to `/api/mainnet-rpc` on the website's own origin. A fixed Vercel rewrite forwards
JSON-RPC POST requests to that same PublicNode provider; other methods receive
HTTP 405. This removes the browser's direct cross-origin RPC request after a
reported `Failed to fetch` that was not reproducible in the test browser.
Local HTTP development and CLI checks contact PublicNode directly. Endpoint
overrides are rejected; diagnostics show the selected provider, actual browser
request URL and expected/received genesis. Responses are not cached; redirects,
cookies and unexpected request destinations are rejected. There is no secret
RPC credential. Only public RPC data and signed transactions enter the relay;
recovery packages, passwords and private signing keys stay in the browser.
Vercel and PublicNode remain trusted transport/data dependencies; verifying
genesis does not establish a light-client proof.

Phantom's injected Solana provider has no documented reliable active-cluster
indicator. Connection is displayed independently, with wallet network
**not exposed; not verified**. SHELL builds transactions with the selected
profile's verified blockhash, requires `signTransaction`, rejects message
substitution and sends the exact signed bytes only through that pinned RPC.
The wallet may reject a request; the app never bypasses its consent.

The Mainnet Cargo feature `mainnet-v2` uses account version 2 and this preimage:

```
SHA256("SHELL_MAINNET_V2" || full_Mainnet_genesis ||
       program_id[32] || old_vault[32] || old_root[32] || coordinator[32] ||
       operation[105])
```

The amount, recipient, next PDA and next root are all committed. The pinned
Winterwallet N=22 verifier and its cryptographic parameters are unchanged.
Legacy Devnet tags, preimages, account version and schema-1 backup fingerprints
remain unchanged. Neither profile can use the other's keys or recovery package.
Both actual compiled binaries reject cross-profile signature replay.

Mainnet uses schema-2 recovery and separate IndexedDB/Web Locks. Before signing,
the exact operation and key state are persisted, an updated encrypted package
is verified, and the matching immutable commitment is read at finality. Failed,
expired, cancelled and unknown transactions never release a key for another
message. Clean-browser recovery follows permanent receipts or blocks a stale
package; it never creates a replacement identity. See [recovery.md](recovery.md).

Empty System-owned pre-funded PDAs are treated as uninitialized, not protected.
The existing program safely allocates/assigns them and tops up rent. A public
transfer to a next-shell address cannot by itself freeze rotation. Permanent
program-owned consumed records still reject reinitialization. External transfers
to consumed records can strand funds; use the guarded Deposit action.

## Reproducible release and deployment

Use Node 24+, pinned npm/Cargo lockfiles and the pinned Linux toolchain described
in [deployment.md](deployment.md). Run locally:

```sh
npm ci
npm run prepare:mainnet
npm run build:programs
SHELL_LIVE_RPC=1 npm run verify:release
NODE_USE_ENV_PROXY=1 npm run preflight:mainnet
```

`verify:release` runs upstream verification, both TypeScript checks, crypto and
durability tests, all actual SBF matrices, real Chromium and production export.
It writes `.mainnet/release-checks.json` only on success, matched to the exact
source digest and Mainnet binary. A source change invalidates that record.

The archive intentionally excludes private deployment keys. On a fresh checkout,
the public reservation cannot be adopted without its owner key. Preparation
refuses to replace it. An explicitly new **unfunded fork** is possible with:

```sh
SHELL_NEW_MAINNET_RESERVATION=1 NODE_USE_ENV_PROXY=1 npm run prepare:mainnet
```

That command first verifies the old program is absent, and refuses a verified
or existing program. It creates a new program ID/fee payer. Update the public
site only intentionally. Existing recovery packages cannot migrate to this fork.
Never place a user's Phantom/Solflare seed in any deployment key file.

Public funding requires an independent reviewer to supply a real published report
and a local public
descriptor `.mainnet/security-review.json` with:

```
reviewer, reportUrl (HTTPS), reportSha256, sourceSha256, binarySha256,
authorizationProfile: "mainnet-v2", programId, conclusion: "approved"
```

Hashes must match the exact current artifacts and the downloaded report bytes.
This descriptor is a review attestation, not an automatic claim of a formal audit.
No descriptor/report has been created or fabricated for this release.

After the exact-source release checks pass and the dedicated fee payer is funded,
the user-authorized prototype deployment and owner-only checks can run while
independent review is pending:

```sh
npm run deploy:mainnet
npm run verify:mainnet
npm run test:mainnet
npm run release:mainnet
npm run build -- --webpack
```

Deployment rechecks source/binary evidence, the full official genesis, confirmed
account absence and actual fee-payer balance before invoking the CLI. It uses
the dedicated private payer, program and resumable buffer keys, exact maximum
binary length, official Mainnet RPC, finalized commitment, `--use-rpc` and `--final`.
Independent review remains mandatory for public funding, and a pending review
is disclosed rather than represented as approval.
No frontend environment variable can bypass the release gate. The verifier
matches loader ownership, finalized deployment transaction/slot, full bytecode,
zero padding and **no upgrade authority**. Initialization is per user, through
the verified app's Create-vault instruction; there is no global admin initializer.

The bounded CLI smoke flow uses the dedicated development fee payer, a disposable
recipient and locally encrypted test identity; it deposits 0.002 SOL, partially
withdraws 0.001, restores the refreshed package into clean storage and fully
withdraws the remaining 0.001. It requests no airdrop and checks fees and three
permanent rent reserves before submission. Its fixed 0.002 SOL deposit uses
real owner-controlled Mainnet funds. The recipient key is retained privately,
so this check does not deliberately discard those funds. A verified immutable
deployment and matching release checks are required; independent approval is
still required before public funding. An incomplete run retains its encrypted journals/packages
and stops; it never silently generates replacement keys. Operator reconciliation
is required before another run. This CLI's disposable password file must never
be used for a user's funded browser vault or included in an archive.

Only an actually completed flow writes public evidence. `release:mainnet` then
independently checks all six finalized transactions, exact instructions/amounts/
addresses, the two permanent consumed commitments and the empty fresh vault.
The browser performs the same checks, in addition to live immutable bytecode,
before enabling funding. Local SVM signatures are never Mainnet Explorer proof.

## Requirements before real-money use

1. Independently review the exact vault binary, browser signing/recovery code,
   upstream parameter choices, immutable commitments and RPC trust assumptions;
   resolve findings before accepting public funds. Review the implemented active-state retention, strict-storage checks, encrypted package limits and remaining dependency advisories before real-money use. No verified audit exists.
2. Establish owner-controlled deployment credentials, adequate fee/rent budget,
   immutable deployed bytecode and actual finalized lifecycle evidence. Obtain
   reproducible build/release attestations and operate trusted distribution.
3. Review production RPC reliability, monitoring, browser/extension threats and
   disaster recovery. Hardware-isolated signing remains future work; browser
   secrets can be stolen by an infected device or changed application origin.
4. Rehearse recovery and stale-backup handling across devices/origins. Keep the
   verified current operation package and password; a basic seed is insufficient.
5. Treat $SHELL tokenomics as a separate release. Supply the actual CA, treasury,
   production liquidity/DEX adapter and independent review. Devnet test pools,
   disposable mints, three admins in one environment and keeper configuration
   must not be represented as production financial operations. Mainnet SOL vault
   authorization has no token dependency or protocol fee in this release.

Immutability removes an upgrade administrator's ability to change spending rules.
It does not make device security, code correctness, recovery or Solana independent
of trust. A deployed immutable defect cannot be upgraded away. No claim of being
unhackable or of complete blockchain-wide quantum protection is made.
