# New-vault activation fee

The owner configured a **0.01 SOL (10,000,000 lamports)** application platform fee for each separate new Mainnet vault activated through SHELL. The recipient is `45Vxy36SWNd1DrMZWqn1QkVhRgCqfhHPB9uLnw4xqqgy`. This is the owner-selected deployment wallet. No key or hosting credential is included in the source repository. The recipient is pinned in the application source; changing it requires a new tested application release.

Creating an encrypted local identity, connecting a wallet and verifying a recovery file remain free. The fee is paid by the connected conventional wallet when the user approves **Activate vault**. The approval screen separately quotes platform fee, current Solana transaction fee, actual missing vault rent and total wallet cost, and exposes the complete fee-recipient address. Incoming SOL at an uninitialized vault address is never used to pay the platform fee.

The activation instruction and exact System Program fee transfer are in the same signed transaction. Solana commits both or rolls both back. Failed activation or failed fee payment collects no platform fee; the network can still charge its transaction fee. The client checks the complete cost before requesting a signature and rejects a wallet-returned transaction with a reduced fee, substituted recipient or omitted payment.

One initialized vault cannot be initialized again. Existing initialized vaults are detected before constructing a payment, so reloads and repeated activation attempts do not charge again. Pending signed transactions are durably saved before broadcast; ambiguous outcomes block fresh submission until reconciled, and retries preserve identical signed bytes. Previously signed activation transactions from the earlier free release retain their existing authorization. There is no retroactive charge.

Deposits, withdrawals, recovery and automatic shell rotations do not include this platform payment. A new local identity activated as a separate vault pays a new 0.01 SOL fee. Permanent record rent and Solana transaction fees still apply independently. The fee uses integer lamports throughout; no percentage, token transaction, buyback or additional spending authorization was added.

## Enforcement boundary

This is an **application fee**, not a new rule enforced by the existing immutable vault program. Someone using the public program directly can create a vault without paying the SHELL application fee. The old program cannot be upgraded to enforce a mandatory platform fee. Such enforcement would require a separately reviewed new deployment and an explicit migration design. This update does not redeploy the program, alter Winternitz verification, add an administrator spending route, change recovery keys or collect fees from protected vault funds.

## Verification

Unit coverage checks exact amount/recipient, supported network, total-cost preflight, fee-message substitution, separate new vaults, concurrent clicks, reloads, crash-before-broadcast and ambiguous submission. The compiled Mainnet SBF matrix checks exact recipient credit, no second activation charge, failed-payment rollback preserving prefunded SOL, a second new vault's fee and fee-free partial/full withdrawal and rotation. Browser flows check approval-screen prices, total and recipient before executing disposable VM transactions. Public-site acceptance opens the same approval screen read-only and never signs or submits an actual Mainnet transaction.

[Current published verification](platform-fee-verification.json) records the actual deployment, source digest, passed tests and mobile checks.
