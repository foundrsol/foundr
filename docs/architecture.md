# Architecture and threat model

## Trust and funds

The Next.js app exports static assets. All key generation, encryption, WOTS
signing, recovery-package handling and coordination-key signing run in the
browser. The server receives no recovery package, password, vault scalar or
private key. Public addresses, instructions and signatures reach the explicitly selected, genesis-verified RPC
and the user's wallet provider. No analytics, telemetry or error-tracking code
is included. Set `NEXT_TELEMETRY_DISABLED=1` during development/build.

The adapted Rust program owns a canonical PDA with seeds `shell`, the 32-byte
WOTS Merkle root and the 32-byte coordination public key. **The PDA is a storage
address; authorization comes from the WOTS verifier.** Runtime account ownership,
canonical seeds, version, bump, status and exact account lengths are checked.
An ordinary transaction signature or the coordination key alone cannot withdraw.

Every vault contains 172 bytes: version (1), state (1), bump (1), original WOTS
root (32), coordination key (32), immutable operation (105). Operations contain
version (1), amount in little-endian u64 (8), recipient (32), next PDA (32) and
next WOTS root (32). The next vault retains the same coordination identity.

## Authorization path

1. **Create:** payer and locally generated coordination key sign account
   creation. No WOTS signature is exposed. The PDA binds both identities, so an
   arbitrary initializer cannot replace the coordination identity at that PDA.
2. **Deposit:** a conventional payer signature funds an available vault through
   the program. Committed and consumed vaults reject this instruction.
3. **Commit:** only the recorded coordination key can store the intended
   operation. First write wins permanently. Identical retries are idempotent.
   Different operations and consumed vaults reject commitment.
4. **Withdraw/rotate:** the program verifies a 768-byte signature against the
   stored root and the complete preimage below. It transfers the exact amount
   to the bound recipient, creates the bound new vault, transfers **all remaining
   spendable lamports** there, and marks the old vault consumed atomically. Only
   the known System Program is invoked, for creating the next account.

```
SHA256(
  "SHELL_DEVNET_V1" || "EtWTRABZaYq6iMfeYKouRu166VU2xqa1" ||
  program_id[32] || old_vault[32] || old_root[32] || coordination_key[32] ||
  operation[105]
)
```

The upstream WOTS scheme uses the first 22 bytes of this message digest, exactly
its existing N=22 parameter. The 32-character marker above is an immutable v1
authorization domain, not the full RPC genesis hash. RPC validation uses the
full `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` value separately. Existing
one-time messages and schema-1 encrypted recovery packages are unchanged.

SHA-256 chain values, Merkle leaves/nodes and roots
retain all 32 bytes. The port preserves 255-step chains, a two-byte checksum,
leaf tag `00`, node tag `01` and rightmost-node duplication. No additional hash
truncation or invented cryptographic construction is introduced.

The full digest commits operation type/version, original vault, deployment,
fixed network authorization context, amount, recipient and every change destination/root. Fees
and new-account rent come from the transaction payer, not an unsigned vault
refund. Recipients, old vault and next vault must differ. The change root must
be different from the old root. Checked arithmetic rejects insufficiency and
overflow. Partial and full withdrawals both create a fresh account; full
withdrawal leaves its spendable balance zero.

There is no ordinary-signature withdrawal, arbitrary CPI, emergency sweep,
administrator spending, key reset, or rent-refund instruction. Old vault records
are never closed or reinitialized. Each permanently reserves its rent; initially
the standard legacy rent for 172 bytes is 2,088,000 lamports, but the client
always quotes the actual devnet value. Deposits/rotation are shown as protected
only after finalized state is read.

## Durable one-time state

`Engine` is the only application caller of the low-level signer. It holds a Web
Lock across read, reconciliation, state updates, signing, transaction building
and submission. IndexedDB encrypted writes request strict durability, check that
the transaction reports `strict`, and await `oncomplete` before progressing.
Browsers lacking these features fail closed. React also guards duplicate clicks
synchronously. Each save bounds completed history while retaining current/next
keys, pending commitments, bound digests, signatures and every unresolved signed
transaction. Oversized encrypted state is rejected before replacing stored data.

| Phase | Required durable evidence | Allowed next action |
| --- | --- | --- |
| Fresh | Current keys exported and verified | Prepare one operation |
| Prepared | Exact operation plus independent next keys saved; new backup verified | Commit that operation |
| Committed | Matching operation read from finalized on-chain state | Bind key to that digest |
| Signing | Bound digest persisted before WOTS computation | Produce/reproduce only the identical deterministic signature |
| Signed | Signature saved before wallet transaction/submission | Submit identical operation |
| Unknown/confirming | Signed transaction bytes, ID and validity height saved | Reconcile or retransmit identical bytes |
| Failed/expired | Finalized failure/expiry and matching chain commitment | New outer blockhash; identical WOTS authorization |
| Consumed | Permanent on-chain receipt and matching recovered child | Adopt child; erase old secret in current storage |

The operation is persisted before any signature is exposed. Before submission,
the fully signed outer transaction, signature and last-valid height are also
persisted. A timeout is unknown, not failed. New transactions are blocked until
the prior result is reconciled. Failure does not unbind the key. A new blockhash
changes only the ordinary outer transaction, not the WOTS operation. Confirmation
uses finalized signature status; absence is insufficient to infer failure.
Expiry requires finalized block height beyond the transaction's validity window.

Recovery from a package made before signing is safe only for the exact on-chain
commitment. Reproducing its deterministic WOTS signature reveals no additional
chain material. Stale packages lacking that operation/next keys are blocked.
Concurrent restored browsers can prepare different operations, but only one
can commit; both must inspect that finalized commitment before signing.

## Threats and limitations

* Wrong keys, modified amounts/destinations, replay and consumed-account reuse
  fail the commitment, WOTS, status or PDA checks.
* A stolen coordination key can freeze an unwanted operation, causing denial of
  service. It cannot spend without WOTS. No insecure cancellation escape exists.
* A stolen encrypted package enables offline password guessing. PBKDF2-SHA256
  (600,000 iterations) and AES-256-GCM reduce risk; use a strong unique password.
* A compromised device, extension, wallet, application origin or unlocked memory
  can expose secrets or mislead users. JavaScript string copies cannot be
  reliably zeroized. Web Crypto does not make browser signing hardware-secure.
* This assumes accurate finalized RPC responses. A malicious RPC can falsify
  commitment state across stale restores. This is not a light client or a
  proof-verifying RPC system. Device and network integrity remain dependencies.
* Solana provides no genesis-hash sysvar. Devnet-v1 uses its original legacy authorization marker; Mainnet-v2 uses a separate domain tag, full Mainnet genesis and account version 2. The client and deployment scripts enforce actual full genesis hashes and pinned program/binary/authority. There is no on-chain claim of runtime cluster detection. Different domains prevent a signature crossing profiles. Never migrate Devnet keys or previously bound operations into Mainnet.
* The development upgrade authority can replace spending rules and steal funds.
  Binary, ProgramData, slot and authority checks detect known changes, but cannot
  eliminate an administrator's ability to upgrade between check and execution.
  **The upgradeable prototype is not trustless.**
* External raw System transfers to consumed accounts cannot be prevented.
  Those lamports are stranded; the app uses a guarded Deposit instruction.
* Loss of the latest operation package/next keys can strand funds. Missing keys
  never trigger an invented replacement identity. Unknown outcomes stop signing.
* SOL only, legacy packets at most 1,232 bytes, zero priority-fee configuration,
  and safe-integer RPC balance checks limit this first version.

The test report distinguishes model, browser, SBF and devnet results. These are
engineering checks, not independent audits or proof of complete quantum security.

## Optional protocol extension

The separate Anchor fee program can call the vault only with the same committed
operation and upstream WOTS verification. It stages a public signature after
durable binding and records an optional paid-service receipt. Configuration,
treasury and operator routes cannot sign for the vault or bypass its verifier.
Native/SPL collection, controlled test-pool buyback/burn and operator escrow are
documented in [protocol.md](protocol.md). This extension does not enable mainnet
spending and is not a substitute for a reviewed production DEX or enterprise API.

## Separate immutable Mainnet profile

Mainnet-v2 uses `SHELL_MAINNET_V2` and the full
`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` genesis in the
same complete spending preimage. WOTS parameters, chain values, Merkle roots,
operation encoding and durable first-writer commitment logic are unchanged.
The compiled account version is 2; the legacy Devnet build remains version 1.
Two actual compiled-program matrices reject cross-profile signature replay.

Mainnet recovery schema 2 authenticates the cluster and authorization profile.
Its IndexedDB database and Web Lock are separate from Devnet. Keys cannot be
migrated between them. The Mainnet deployment must have **no upgrade authority**;
`--final` is irreversible. A code defect cannot be repaired by upgrading this
program; there is no administrator rescue or rent-refund escape route.

The frontend fixes Mainnet RPC to PublicNode because the official endpoint
rejected browser Origin headers. HTTPS production browsers use the website's
own `/api/mainnet-rpc` URL, with a fixed Vercel POST-only rewrite to that same
PublicNode provider. This avoids a direct browser cross-origin request while
preserving the explicit provider and full genesis checks. Local HTTP and CLI
requests stay direct. Diagnostics report both provider and transport; redirect,
credential and cache use are disabled. Recovery material, passwords and private
signing keys are never supplied to this route. The hosting provider can see
public RPC requests and signed transaction bytes. Deployment tooling verifies
the official Mainnet genesis independently. Vercel and the RPCs remain trusted
dependencies; genesis comparison is not a light-client proof. No silent
endpoint override exists.

Live Mainnet spending additionally requires exact-source local release checks,
an independent report matching source/binary, and finalized create/deposit,
partial/full withdrawal and rotation evidence. The browser rechecks the six
transaction instructions, amounts, recipients, vaults, permanent commitments,
statuses and resulting accounts. It never briefly enables funding after
bytecode-only validation. Devnet paid services, test mints, governance, pools,
settlement and keeper are not included in the Mainnet SOL authorization profile.

The exact tested Mainnet program is deployed immutably, and the owner-funded
0.002 SOL lifecycle finalized with partial/full rotation and clean-store recovery.
This is real Mainnet evidence, separately recorded in [mainnet.md](mainnet.md).
No independent review has been supplied; public funding remains disabled.

## Current experimental release policy

The owner explicitly waived waiting for independent review. The application now accepts a distinct experimental-ready release with exact source/binary/program binding, while retaining all deployment and finalized lifecycle checks. Review status stays pending. This does not modify the immutable program, spending authorization, backup or signing-state rules. See [experimental release policy and verification](experimental-launch.md).

## Current experimental release policy

The owner explicitly waived waiting for independent review. The application now accepts a distinct experimental-ready release with exact source/binary/program binding, while retaining all deployment and finalized lifecycle checks. Review status stays pending. This does not modify the immutable program, spending authorization, backup or signing-state rules. See [experimental release policy and verification](experimental-launch.md).

## Current experimental release policy

The owner explicitly waived waiting for independent review. The application now accepts a distinct experimental-ready release with exact source/binary/program binding, while retaining all deployment and finalized lifecycle checks. Review status stays pending. This does not modify the immutable program, spending authorization, backup or signing-state rules. See [experimental release policy and verification](experimental-launch.md).

## Current experimental release policy

The owner explicitly waived waiting for independent review. The application now accepts a distinct experimental-ready release with exact source/binary/program binding, while retaining all deployment and finalized lifecycle checks. Review status stays pending. This does not modify the immutable program, spending authorization, backup or signing-state rules. See [experimental release policy and verification](experimental-launch.md).
