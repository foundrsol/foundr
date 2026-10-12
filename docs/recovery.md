Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

# Recovery instructions

Your existing wallet seed phrase is never requested. SHELL uses an independent
identity and **an encrypted package plus its SHELL recovery password**. A basic
seed phrase alone does not recover this design.

The package contains the deployment/network context, local identity ID, private
coordination seed/public key, independent WOTS scalars and roots for current and
prepared next shells, addresses, the immutable intended operation, bound signing
digest/phase, any stored signature, transaction bytes/signatures, validity heights
and known outcomes. Historical consumed keys are erased from the latest local
state; older encrypted packages may still contain them.

Its envelope uses a random 32-byte PBKDF2 salt, random 12-byte AES-GCM nonce,
PBKDF2-SHA256 with 600,000 iterations, AES-256-GCM and authenticated format/KDF
metadata. It is not a Phantom/Solflare backup and is not mnemonic-compatible.

For optional paid operations, the package also retains the selected service,
protocol program, maximum approved fee and configuration revision. A fee change
may require explicit renewed wallet approval and backup verification; it never
permits changing the already bound withdrawal amount or destinations.

1. Choose a strong, unique recovery password (at least 12 characters; length
   alone is not an entropy guarantee). Keep it separately from the package.
2. Export the package immediately after creation. Save it outside browser
   storage, privately and redundantly. Reopen the actual saved file and decrypt
   it in the verification dialog. Funding is gated on this verification.
3. **For every withdrawal, export and verify the refreshed package after
   preparing the next shell and before committing/signing.** This package
   contains the operation and next shell's independent private scalars.
4. Retain that revision until the rotation is confirmed and a later revision is
   safely verified. Exporting again after confirmation is recommended; it removes
   obsolete keys and updates history, but the pre-commit refreshed package can
   follow the permanent receipt to the already backed-up child.
5. In a clean browser profile, open the same trusted deployment, choose **Restore vault**,
   select the package and enter its password. All decryption happens locally.
   Roots, coordination key, addresses and signing-state consistency are checked.
   The app reconciles finalized chain records before enabling money operations.
6. Connect a conventional wallet to pay fees on the same explicitly selected network. It need not be the
   original funding wallet. Verify the public address and balance independently.

If RPC/deployment verification is unavailable, recovered keys stay encrypted
locally in a **signing-blocked** identity. They are not discarded and no new
identity is silently substituted. Once the expected deployment and network can
be verified, reconciliation can unlock only a consistent state.

A stale initial package can restore an untouched available vault, because every
signature requires a prior immutable on-chain commitment. If the chain shows a
committed operation absent from the package, stop and find its refreshed
package. If a consumed receipt points to missing next keys, stop and recover the
correct revision. Possession of an old secret does not permit a different
operation. There is no fallback withdrawal through your ordinary wallet.

A previously signed but unsubmitted operation still has its permanent chain
commitment. Use its refreshed package. The client can reproduce the **identical**
deterministic authorization, or reuse a stored signature, and reconcile the
ordinary transaction before resubmission. Never alter the amount or destinations
because a wallet prompt was cancelled, a transaction expired, or RPC timed out.

Do not delete local browser data while relying on it as your only backup. Do not
restore over a currently unlocked local identity; use a clean profile. Local
creation/recovery never overwrites an existing identity. Hardware-isolated
signing and independently reviewed cross-device recovery are still required
before any real-money use.

Browser storage is scoped to the website origin. Moving between Sites, Vercel
at https://sonic-perseus-9a1cxls.vercel.app, or a custom domain requires exporting and
verifying the latest package at the old origin and recovering it at the new
trusted origin. A missing local identity after a hostname change is not a reason
to replace a funded identity. Keep your verified package and password available.

## Network selection and schema compatibility

The Mainnet page `/` creates schema-2 packages bound to `mainnet-beta`,
`mainnet-v2`, the full Mainnet genesis and the reserved/deployed program ID.
Its database is `shell-encrypted-mainnet-v2`, and its lock is
`SHELL:identity:mainnet:v2`. The `/devnet` page retains schema 1, the legacy
Devnet signing marker, `shell-encrypted-v1` and `SHELL:identity:v1` unchanged.
The encrypted envelope format remains `SHELL-RECOVERY-1`; the encrypted identity
schema specifies the actual authorization profile. Download names include the
network. The same strong password may decrypt a file but cannot make it valid
on another network or deployment.

Changing pages does not migrate keys, sign a new message or replace an identity.
Recovery on the wrong page stops before saving anything. After a successful
local restore, missing/unverified deployment or RPC state blocks signing while
retaining the encrypted identity. Current local Mainnet and Devnet browser tests
cover reload, separate storage, rejection on the wrong network and recovery in
a clean browser profile. The public navigation offers Wallet and How it Works, with no Devnet selector.
The direct `/devnet` route is retained only for developer verification. The actual
Mainnet program is deployed and immutable; public funding is still blocked pending
independent exact-build security review. The Devnet program is not deployed.

## Retention and storage limits

Every durable save and backup export retains the current and prepared next
shells, their secrets, intended operation, bound digest and signature. It also
retains eight recent consumed shell receipts and up to 100 transaction attempts.
All unresolved signed transactions take priority over completed history. Older
completed transactions remain available in Solana Explorer; their retirement
does not change keys, commitments, backup revisions or authorization messages.

A valid legacy package containing up to 100 shells is checked and compacted
on recovery without discarding active keys or unresolved transactions. If 100
attempts remain unresolved, new wallet transaction requests stop until outcomes
are reconciled. No unknown transaction is silently dropped to make room.

The encrypted package limit remains 2 MB. Encryption rejects oversized state
before replacing the existing local record. Already oversized packages from an
older version remain unsupported; do not delete their source data or invent a
replacement identity. Current clean-profile tests cover large legacy packages,
signed but unsubmitted operations, stale backups and completed-history trimming.

Browser signing also requires IndexedDB to report `strict` durability for each
write. Browsers that ignore that option stop before saving or exposing a
signature. This does not protect against storage deletion, a compromised device,
or hardware failure; keep the verified external package and its password.
