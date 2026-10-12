# SHELL

A free experimental Solana security-vault prototype. A conventional wallet funds deposits and pays fees; a separate Winternitz one-time signature authorizes each SOL withdrawal. Remaining funds rotate into a fresh vault with fresh signing keys. Basic vault software has no SHELL protocol fee; Solana network fees and permanent vault rent still apply. Recovery packages and vault keys stay encrypted in the browser. Browser signing does not provide a hardware secure element, and no superiority over Ledger hardware is claimed.

**Public website:** https://sonic-perseus-9a1cxls.vercel.app

**Immutable Mainnet program deployed; public funding enabled under an explicitly authorized experimental release. Independent security review remains pending.** `/` uses the separate `mainnet-v2` profile; `/devnet` preserves existing `devnet-v1` identities. The real Mainnet program is `DC4PEctnFZH4qcGAJzbGWi47AUrac7QuBRtD8DtLqdk4`, with no upgrade authority. The dedicated wallet received 0.3 SOL; deployment, deposit, partial/full withdrawal, rotation and clean-store recovery completed on Mainnet. [Actual deployment and lifecycle evidence](docs/mainnet.md) records all receipts and remaining funds. Independent exact-build review is still required before public deposits. Devnet programs remain undeployed because the test faucet is unavailable. Neither the pinned upstream version nor this adaptation has a verified formal audit.

The application includes wallet connection, encrypted identity creation, required export/verification, clean-browser recovery, separate balances, withdrawal/rotation, public diagnostics and Explorer links. The `/protocol` page displays only verified chain metrics. The token section displays and copies the full project-supplied CA, `66fEEkGSYVeBb2eTwsfmipZBvT3WY1ab9bRJTooSpump`. Its metadata remains `owner-provided`: both genesis-verified Mainnet RPCs returned no finalized account at verification. This does not change vault authorization.

The current [direct-transfer balance fix and simpler guide](docs/direct-transfers.md) are included.

## Local setup

Use Node **24+**, a secure modern browser with Web Crypto Ed25519, IndexedDB and Web Locks, and Phantom or Solflare. SHELL never requests an existing wallet seed phrase.

    npm ci
    cp .env.example .env.local
    npm run verify:upstream
    npm run typecheck
    npm run typecheck:tools
    npm test
    npm run dev

Open http://localhost:3000 for Mainnet release preparation, or http://localhost:3000/devnet for test funds. Devnet uses the fixed official `https://api.devnet.solana.com` endpoint. Mainnet pins `https://solana-rpc.publicnode.com`. On the HTTPS production website, the browser posts to `/api/mainnet-rpc` on the website's own origin; Vercel forwards that request to the same pinned provider. Local HTTP development and CLI checks contact the provider directly. Official Mainnet RPC is used by deployment tooling. Both profiles verify the full expected genesis hash. The official Mainnet endpoint returned HTTP 403 to browser Origin headers, so it is not used for frontend transactions. Diagnostics distinguish the provider from the browser request URL. Phantom does not expose a documented reliable active Solana network indicator; connection is displayed independently from RPC and deployment validation. No recovery file, password or signing key enters the relay.

Choose the intended network explicitly. Create an identity, export and reopen its encrypted backup with the SHELL password, connect a conventional wallet, initialize a verified vault, and deposit test SOL. Before each withdrawal, prepare the exact amount/destination and fresh shell, export and verify the new backup, commit that operation, and authorize withdrawal/rotation. A timeout retains the intended operation; it never permits a different message under the old key.

## Verification and deployment

    npm run verify:upstream
    npm run typecheck
    npm run typecheck:tools
    npm test
    npm run test:programs
    SHELL_LIVE_RPC=1 npm run test:browser
    npm run build -- --webpack

Compiled-program tests require all three SBF binaries: Devnet vault, Mainnet vault and Devnet fee protocol. `npm run build:programs` builds the locked profiles with the pinned installed toolchain; `npm run verify:release` runs all release checks and writes a source/binary-matched local record. Results and commands are in [verification](docs/verification.md). Local SVM signatures are never represented as Explorer-confirmed Devnet transactions.

`bash scripts/verify-runtime.sh` prepares pinned Linux development tools, builds both programs and the real Anchor IDL, tests exact binaries, checks Devnet, and attempts deployment with disposable keys. It stops on failure. For an archive without private deployment keys, `SHELL_NEW_DEVELOPMENT_DEPLOYMENT=1 npm run keys:devnet` explicitly creates a new **unfunded Devnet fork**; rebuild both programs and regenerate the IDL afterward. Never replace a funded deployment identity.

The Anchor protocol supplies optional premium receipts, atomic SOL/SPL fees, 80/20 accounting, controlled Devnet buyback/burn test pools, multisig treasury release, optional operator stake without slashing, and a durable SQLite keeper. The base vault is free; integrators must require verified premium receipts for paid entitlements. There is no hosted enterprise API or enabled production DEX adapter. See [protocol](docs/protocol.md).

Once the real CA exists, verify its mint account and republish:

    NODE_USE_ENV_PROXY=1 node scripts/configure-token.ts YOUR_REAL_SHELL_MINT
    npm run build -- --webpack

That command reads Mainnet mint metadata and configures the public badge only. It changes public token metadata only; it does not change either vault profile, create tokens, trade or enable Mainnet spending. The Mainnet SOL vault works independently of a token mint; the Devnet fee/test-pool extension is not enabled on Mainnet.

## Mainnet preparation

    npm run prepare:mainnet
    npm run build:programs
    SHELL_LIVE_RPC=1 npm run verify:release
    NODE_USE_ENV_PROXY=1 npm run preflight:mainnet

Deployment uses `--final` for the immutable policy you selected. Mainnet funding requires live source-matched immutable bytecode, exact-build release authorization and six independently rechecked finalized lifecycle transactions. The owner authorized a separate experimental policy; independent review is still pending. See [the current experimental release](docs/experimental-launch.md). See [Mainnet deployment and launch requirements](docs/mainnet.md) for actual addresses, costs, review format, commands and current blockers.

The source archive excludes private deployment keys. On a new checkout, preparation refuses to replace the included reservation. `SHELL_NEW_MAINNET_RESERVATION=1 npm run prepare:mainnet` explicitly creates a new unfunded fork only after verifying the prior program is absent. Its program ID and recovery context differ. Existing keys/backups must never be migrated or silently replaced.

## Documentation and release requirements

* [Mainnet profile, immutable deployment and remaining requirements](docs/mainnet.md)
* [Architecture and threat model](docs/architecture.md)
* [Recovery and stale backups](docs/recovery.md)
* [Upstream, dependency pins and licenses](docs/upstream-review.md)
* [Test results and binary evidence](docs/verification.md)
* [Security engineering findings, fixes and remaining advisories](docs/security-verification.md)
* [Devnet deployment status and remaining commands](docs/deployment.md)
* [RPC/Phantom diagnosis](docs/devnet-integration.md)
* [Public hosting and verified Vercel deployment](docs/vercel.md)
* [Minimalist interface and layout verification](docs/minimal-ui.md)
* [Light/dark appearance and verification](docs/appearance.md)

Before real-money use: independent audits of exact builds and recovery; production upgrade governance or immutability; reviewed mainnet domain/deployment migration; isolated signing; stronger RPC trust; reproducible builds, fuzzing and supply-chain controls; a reviewed production DEX and price/MEV controls; real token/liquidity configuration; independently controlled multisig keys; monitoring and recovery usability review. The upgradeable prototype is **not trustless** and does not protect the entire underlying network.
