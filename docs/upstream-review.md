# Upstream review and adaptation

Inspection date: 2026-10-09. The official [Blueshift research page](https://blueshift.gg/research/quantum-proofing-solana)
links to [Winterwallet](https://github.com/blueshift-gg/winterwallet), the current
successor to the original vault demonstration. The exact current default-branch
commit inspected is **672fc6789b1532ee680f24842d235e0be8737b61** (2026-04-27,
“Cargo fixes”). The legacy source inspected is
**beb312c7a62914079d68e7eee2c1a3e44bda7a3d** (2025-01-09).

The current Rust core, Rust/TypeScript clients, program, CLI, documentation,
licenses, crypto and instruction tests, golden fixtures and gated integration
tests are vendored. 87 textual source files are pinned by their Git blob hashes
in `source-lock.json`; `npm run verify:upstream` detects any modifications. The
binary Bun lockfile was excluded. Legacy source/docs/tests are retained separately.

## Findings

* Current SDK 0.1.0 is an instruction/plan builder. It does not supply a browser
  signer, key manager or durable transaction/recovery state.
* Its on-chain Initialize recovers an identity root by signing only
  `WINTERWALLET_INITIALIZE`; its supplied next root is not in that signature.
  SHELL avoids exposing a WOTS initialization signature entirely.
* Advance verifies `tag || wallet_id || current_root || next_root || ordered
  passthrough_account_addresses || raw_CPI_payload`. Amounts and recipients are
  bound when encoded into that payload. Root advancement precedes CPI and rolls
  back on transaction failure. The current source advances a stable wallet PDA's
  root; it should not be described merely by the research page's simplified
  fresh-address narrative.
* Withdraw and Close require the wallet PDA to be a signer. Advance supplies
  that signature only after WOTS verification. Close sweeps to its bound receiver;
  it is not an ordinary payer-authorized escape. This is the full authorization
  path; the mere existence of a PDA is insufficient.
* Advance's digest does not explicitly bind a cluster genesis or executing
  program ID. The original legacy Split binds amount/split/refund addresses
  using a recovered key and PDA equality; it lacks the durable intent records
  needed by this browser/restoration scope. SHELL therefore uses the current
  core with a new bounded SOL-only deployment rather than integrating legacy
  spending instructions or blindly trusting a published program.
* Core signing consumes Rust private-key values and offers local position
  advancement. Re-derivation, old backups, lost writes, failed outer transactions
  and competing browser profiles remain client responsibilities. Local counters
  alone cannot provide SHELL's required stale-restore guarantee.
* The current README explicitly says **“Not formally audited (yet).”** No audit
  report covering the pinned version or this adaptation was established.
  The research page's numerical security claims are not repeated as guarantees.

The upstream program ID advertised in code is
`winter5vMwvf51xrSVPTxbAAD6qiSTmPeRTSizMCQCa`. Its gated SDK integration tests clone
the mainnet deployment with Surfpool; this is not evidence of a source-matched
devnet deployment. We have not established any existing devnet deployment's
relationship to that commit. SHELL consequently uses a dedicated development
program ID, only enabled after its own bytecode/deployment checks.

## Adaptation

SHELL links the unchanged vendored Rust `winterwallet-core` verifier. The browser
port preserves N=22, w=8, SHA-256 chain/checksum/Merkle logic and is checked
against upstream Rust golden signatures. Independent CSPRNG scalars replace
mnemonic derivation; this is not a new signature scheme. The current upstream
TypeScript builder is retained for provenance, but its Advance wire protocol is
not compatible with SHELL. SHELL's focused builder is in `src/solana/instructions.ts`.

The adaptation adds immutable pre-signing operation commitments; permanent
consumed records; explicit deployment/devnet domain binding; checked SOL-only
withdrawal and automatic new-PDA rotation; no arbitrary CPI; no closure/refund or
admin spending path; encrypted strict-durability browser state; verified updated
recovery packages; and exact-operation-only retries. See the threat model for
coordination-key denial of service, RPC trust, upgrade races and permanent rent.

## Versions and licenses

| Component | Pinned version/source | License |
| --- | --- | --- |
| Winterwallet core, program, SDK and fixtures | 0.1.0; commit 672fc6789b1532ee680f24842d235e0be8737b61 | MIT, Dean Little |
| Legacy Solana Winternitz Vault | commit beb312c7a62914079d68e7eee2c1a3e44bda7a3d | MIT, Dean Little |
| Next.js | 16.4.0 | MIT |
| React / React DOM | 19.2.0 | MIT |
| @solana/web3.js | 1.98.4, compatible with upstream v1 builders | MIT |
| bigint-buffer transitive override | npm:@exodus/bigint-buffer@1.1.5-exodus.1; commit e88174779e1f6e97896a77b8df71d96fd9cae9fd | Apache-2.0 |
| toml transitive override | 4.2.0; commit 6d42b7e4fa693f8e6fb025d419b10b38107e83e2 | MIT |
| uuid transitive override | 11.1.1; commit 7269a96c12a55a745bd4a7812c01cfd385ec6c46 | MIT |
| buffer | 6.0.3 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| Playwright | 1.56.1 | Apache-2.0 |
| LiteSVM Node | 1.6.0; source fab4665eccf392cd4a63fa4c79fa8717dab27698 | MIT |
| @solana/kit | 8.4.0, test runtime only | MIT |
| @solana/spl-token | 0.4.15 | Apache-2.0 |
| @anchor-lang/core / anchor-lang / anchor-spl | 1.2.1; source f1d20a94e8857d66e39810039aa5b5eee9ff733e | Apache-2.0 |
| pinocchio / pinocchio-system | 0.11.1 / 0.6.1 | Apache-2.0 |
| solana-address / solana-sha256-hasher | 2.6.0 / 3.1.0 | Apache-2.0 |
| Vercel CLI used for hosting preparation | 59.11.7 | Apache-2.0 |

The executed local toolchain uses Rust 1.90.0, rustup 1.29.1 and Agave
4.3.0, source `825efd18292aff6ffcf9daa0f7612f21b3531a72`. Its Linux archive is
checked against the official release API's SHA-256
`c97289a8abb1d0efb497d8b5cb285baabd9b7f8ea6647f5d145c5dc8ff3611e8`.
Both adapted SBF programs were actually compiled and executed with platform-tools
v1.57. The official Anchor CLI 1.2.1 Linux binary has SHA-256
`5c899379cbd9a843fa4a730a37ba7ab61357571ffc535036a9afa08e5cd0b99b`.
The fee extension is original SHELL code; its actual generated Anchor IDL is
included. License/repository provenance is verified against the release metadata,
not inferred from old Anchor package names.

All npm resolution/integrity hashes are in `package-lock.json`. The upstream
Rust dependency lock is retained byte-for-byte; both adapted programs' generated
Cargo lockfiles are included. Exact program
binary SHA-256 and CLI/toolchain versions belong in the deployment evidence,
not in an invented successful-build report. Original MIT notices are preserved
in `vendor/winterwallet/LICENSE`, `vendor/winterwallet/sdk/ts/LICENSE` and
`vendor/legacy/LICENSE`. SHELL's original code is MIT licensed.

The 2026-10-10 security pass inspected the Exodus package tarball and pinned its
published integrity. Its Node entrypoint uses the same pure JavaScript integer
conversion as its browser entrypoint; no native binary, binding dependency or
install hook is shipped. This removes the vulnerable native `bigint-buffer`
path without changing WOTS or any cryptographic parameters. The TOML and UUID
overrides retain the interfaces used by the pinned SDKs. Source commits above
are the registry's published `gitHead` values; package integrity is pinned by the
lockfile. Remaining `stream-json` advisories and reachability limits are recorded
in the security verification report; the dependency scan is not clean.

## Mainnet-v2 adaptation

The vendor snapshot and WOTS parameters remain unchanged. The separately compiled `mainnet-v2` Cargo feature changes only the network authorization tag/domain and vault account version. The TypeScript digest, recovery schema, browser storage and release gates select that exact profile. Devnet-v1 signatures, fingerprints, envelopes and accounts retain compatibility. Mainnet has a separate manual Pinocchio ABI (`program/shell-mainnet-v2.abi.json`); it must never use the upstream Winterwallet IDL or the Devnet fee program. No audit of this adaptation has been verified.
