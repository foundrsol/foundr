# Protocol fees, accounting and token integration

The fee extension is a separate Anchor 1.2.1 program with a generated IDL at `src/protocol/idl.json`. Its reserved Devnet identity is `CBZ5KvpvwfKphy1Mrrgsocey5KDimz47ajYmjNWVGWd6`. It is compiled/tested locally, not deployed. The vault program retains unchanged WOTS spending authorization and no administrator spending route.

## Services and fee authorization

Basic vault creation, deposits and ordinary secure withdrawals/rotation are free of protocol fees. Proposed Devnet receipt defaults are advanced operation 25 bps, protected transaction 10 bps, automatic rotation 30 bps, and protected+rotation 40 bps, subject to the 0.01 SOL cap. The actual verified on-chain configuration, not these defaults, determines a paid quote. The conventional wallet additionally pays network fees and all account rent. Local recovery itself remains free; an advanced receipt does not imply a hosted recovery service.

A paid withdrawal stages only its already durably bound **public** WOTS signature in a permanent authorization PDA. Staging requires the vault's recorded coordinator; it cannot replace the committed operation or sign a new message. A second packet invokes the vault's original verifier and collects fees atomically after successful spending. A failure rolls back the vault CPI, fee and receipt together. Both real packets are checked against Solana's 1,232-byte limit. Authorization and receipt accounts permanently retain rent.

The payer reviews service, amount, recipient, fee cap/configuration revision, network fee, account rent and total wallet cost. Signed ordinary transaction bytes and pending outcomes are journaled before broadcast. Configuration changes require fresh wallet approval and updated backup verification while preserving the exact prior WOTS operation.

**Premium receipts are entitlement proofs for integrations.** The base program intentionally remains free and public; a direct base transaction can execute the same WOTS-authorized operation without buying a premium entitlement. Integrators must use `keeper/receipts.ts` to verify finalized payer/service/vault/amount receipts and separately authenticate the payer. No hosted enterprise API, customer authentication service or mandatory vault tax is claimed. A public WOTS authorization can be relayed through the free path; that neither changes its authorized recipient nor creates a paid receipt.

Enterprise test subscriptions use the configured SPL quote mint, a durable unique nonce, maximum fee, configuration revision, and a 30-day receipt. Default price is 10 quote units with six-decimal disposable test assets. The prototype supports legacy SPL Token accounts; Token-2022 fee/mint features are not enabled in the fee program.

## Allocation, settlement and governance

Fee collection records 80% for buyback and 20% for treasury on chain, with carry accounting for integer dust. SOL and SPL metrics stay separate. Public receipts record actual fee/split/payer/service/operation/timestamp. Undeployed dashboards show dashes.

Permissionless settlement is restricted to registered, controlled **Devnet test pools**, configured mints, recorded collected allocations, liquidity/impact/slippage limits, caps, a deadline and a unique nonce. Donated balances do not increase spendable collected revenue. Native input is wrapped using System/Token instructions; SPL input uses transfer-checked. Bought SHELL tokens are actually burned in the same atomic transaction. Unsuccessful settlement does not record a burn.

The test AMM charges 30 bps and enforces reserve-relative impact; it is not an external price oracle. This adapter is not suitable for a production launch: reserve manipulation, MEV, oracle design and a reviewed real DEX integration remain requirements. There is no fallback sending arbitrary assets to an unverified router.

Configuration initialization requires the actual loader upgrade authority and three distinct admin public keys. Fee changes need two of three administrators and a one-hour timelock. Treasury release requires two administrators, an exact immutable recipient, recorded allocation and a unique nonce. These routes do not access vault funds. All development admin keys are held in the same local environment; they are test keys, not a production multisig.

Operators can optionally register, stake real configured SHELL tokens in a PDA-controlled escrow, and withdraw only their own stake after the lock. Action nonces reject duplicate top-ups/unstakes. Proposed default is 100 test SHELL locked seven days. No slashing, promised yield or rewards are implemented.

## Durable keeper and public accounting

Node 24's SQLite database uses WAL, full synchronization, immediate transactions and unique settlement nonce/receipt constraints. It stores public accounting and ordinary keeper signed transactions, **never vault keys, encrypted recovery packages or user passwords**.

The keeper validates the exact Devnet deployment and configuration, quotes only recorded revenue, simulates, persists signed bytes before submission, and reconciles a finalized receipt before retrying. Unknown outcomes retain the identical signed transaction. Finalized failure/expiry may refresh a quote only for the same recorded asset, amount and receipt. Restart and multi-process duplicate-claim behavior are tested.

    cp .env.keeper.example .env.keeper
    NODE_USE_ENV_PROXY=1 node --env-file=.env.keeper keeper/run.ts --once

Default `SHELL_KEEPER_EXECUTE=0` previews only. Explicit execution requires `SHELL_KEEPER_EXECUTE=1` and a disposable Devnet fee-payer file, never a user vault key. The keeper refuses to execute until program and configuration validation passes. It runs every 60 seconds when `--once` is omitted; no external scheduled service was provisioned.

## Dashboard and CA

`/protocol` reads actual validated configuration, finalized receipt accounts, bank balances and mint supply. SOL and SPL units are never added together. Buyback/burn receipt links use Devnet Solscan; the displayed circulation is explicitly an upper bound excluding known pool/operator custody, not a claim to know all holders. Reads are separate finalized RPC calls, not an atomic indexed snapshot.

`public/token.json` contains the owner-supplied Mainnet CA `66fEEkGSYVeBb2eTwsfmipZBvT3WY1ab9bRJTooSpump`. The badge displays the complete address and enables exact clipboard copying, labeled as project-supplied. Both genesis-verified Mainnet RPCs returned no finalized account, so `mintVerification` is `not-found` and no initialized mint is claimed. An initialized mint can subsequently be checked with the read-only `node scripts/configure-token.ts CA` tool. Token metadata is separate from the immutable Mainnet SOL vault and does not enable token funding, trades, staking or fee-protocol operations.
