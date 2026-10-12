# Security engineering verification

This is an engineering review and regression-test report by the implementation
agent. It is **not an independent audit or external security approval**, and it
does not satisfy the existing Mainnet independent-review release gate. No
independent report or approval descriptor was invented. Exact source, binary,
test results and network observations are recorded in
[security-verification.json](security-verification.json).

## Authorization inspected

The SOL program has four instructions: create, deposit, commit and
withdraw/rotate. Only withdraw/rotate debits protected lamports. It requires the
unchanged upstream Winternitz verifier, a matching immutable committed operation,
the recorded root and canonical vault PDA. Its message includes the operation
version, network profile, executing program, old vault, old root, coordinator,
amount, recipient, next vault and next root. There is no closure, rent refund,
administrator sweep, recovery bypass or arbitrary CPI. The ordinary wallet pays
fees and next-account rent; its signature cannot authorize vault spending.

All signing, recovery and encryption remain local. The static website has no
secret-receiving API, analytics or error tracker. Diagnostic output is limited
to public RPC, wallet, deployment and error fields. The client obtains full
genesis hashes separately from wallet connection, requires finalized
commitments before WOTS computation, rejects substituted wallet transactions,
saves signed bytes before broadcast and treats RPC ambiguity as unknown.

The actual Mainnet deployment is immutable (`--final`).
[mainnet-program-verification.json](mainnet-program-verification.json) records
the exact bytecode, loader ownership, finalized deployment transaction/slot and
absent upgrade authority, independently read back from the official RPC. An immutable defect
cannot be repaired by upgrading or an administrator rescue.

## Findings fixed

| Finding | Impact and mitigation |
| --- | --- |
| Unbounded encrypted history | Repeated rotations/deposits could eventually prevent recovery or local decryption. Every save/export now retains current/next keys, all pending signing state, eight consumed receipts and up to 100 attempts, prioritizing all unresolved signed transactions. A full unresolved journal stops new transaction requests. |
| Oversized write accepted | Encryption could save a package larger than decryption/import accepts. The size check now runs before encryption/storage replacement. Existing readable state survives rejection. Already oversized legacy packages remain unsupported. |
| Ignored durability option | Requesting strict IndexedDB durability did not prove the browser honored it. Each write now checks `transaction.durability === 'strict'` and aborts otherwise, before signing/exposure. |
| Native bigint buffer overflow | The pinned Exodus fork ships only pure JavaScript conversion, no native binding or install hook. Longer-than-32-byte inputs and endian round trips are tested through the actual Solana dependency resolution. Cryptography is unchanged. |
| TOML/UUID advisories | Exact compatible patched versions are pinned in npm overrides and the lockfile. Versions, registry source commits, integrity and licenses are recorded in [upstream-review.md](upstream-review.md). |

Recovery tests use 100-shell legacy fixtures in both profiles, large completed
transaction histories, an unresolved full journal and signed but unsubmitted
operations. The compiled Mainnet matrix also performs eleven further rotations
with actual fresh keys past the receipt-retirement boundary, restores the final
pre-confirmation package into clean storage and confirms replay still fails at
the original on-chain consumed record even after local retirement.

## Remaining dependency advisories

The actual npm scan after patching reports **two moderate package entries,
zero high and zero critical** in both runtime-only and full dependency scans.
It still exits 1; it is not a clean audit. `jayson` 4.3.0 retains `stream-json`
1.9.1, covering:

* [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x): deep filtering can block the event loop.
* [GHSA-hqr4-qq8f-hg3x](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x): JSONC comment rescanning can block the event loop.
* [GHSA-mjw6-4jj6-33hc](https://github.com/advisories/GHSA-mjw6-4jj6-33hc): unsafe streaming assembler property assignment.

SHELL uses the SDK's browser JSON-RPC client. Its fixed Vercel Mainnet rewrite
forwards public JSON-RPC POST bodies to PublicNode; it does not run Jayson's
JSON-RPC server or a streaming JSON parser. A fresh-process regression test confirms the actual
Web3, Anchor and SPL entrypoints do not load `stream-json`. The patched 3.x
parser changes module format and import paths used by Jayson's streaming server;
blindly overriding it would break that library API. This is a bounded
reachability observation, not a claim the dependency is safe for other uses.
Resolve it with a compatible upstream release or reviewed backport before
production review or introducing any streaming/server path. Raw scans are in
[dependency-audit.json](dependency-audit.json).

## Deployment outcome and limits

The actual guarded deployment command and read-only official Mainnet RPC
preflight are recorded in
[funded-mainnet-deployment.txt](test-results/funded-mainnet-deployment.txt)
and [mainnet-preflight.json](mainnet-preflight.json). The exact tested program
was deployed immutably. The owner-funded lifecycle and its six finalized
transactions passed, including clean-store recovery; actual public signatures
are in [mainnet-smoke-evidence.json](mainnet-smoke-evidence.json). The initial
zero-funded/review-gated attempt is preserved as historical evidence in
[security-deployment-blocked.txt](test-results/security-deployment-blocked.txt).
Local SBF signatures are in-memory test evidence, not Solana Explorer evidence.

The dedicated development fee payer received a finalized 0.3 SOL transfer.
[mainnet-funding-observation.json](mainnet-funding-observation.json) records it.
Owner-authorized immutable deployment and the fixed 0.002 SOL lifecycle check
require exact-build tests, full genesis and on-chain validation. Public funding
remains separately blocked on an independently supplied exact-build review and
finalized deployment/lifecycle verification. A deployment does not imply approval.
The local engineering report cannot certify its own independence.
The report URL/hash gate proves descriptor/artifact consistency; human review
must establish the reviewer's independence, scope and actual approval.

Browser/device compromise, offline guessing of stolen backups, coordination-key
denial of service, trusted RPC responses, permanent account rent, loss of current
operation/child secrets and unchanged upstream parameter assumptions remain
documented in [architecture.md](architecture.md) and [recovery.md](recovery.md).
Hardware-isolated signing and stronger RPC proofs are not implemented. These
checks do not establish complete blockchain-wide quantum protection or real-money
readiness. Deployment and remaining commands are in [mainnet.md](mainnet.md).
