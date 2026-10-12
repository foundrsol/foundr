# Direct SOL transfers before activation

A user can send SOL directly to the address of a locally created identity before activating it. Solana then holds that balance in an empty System-owned account. It is not yet an initialized SHELL vault. The deployed immutable program already supports allocating and assigning this prefunded PDA after the correct local coordinator authorizes creation.

The previous frontend treated this account as an absent vault and displayed zero. Its activation preflight also required the connected wallet to cover the entire rent again. The updated UI shows the finalized amount as **SOL awaiting activation** and marks it protected only after initialization is finalized. The client computes the wallet rent top-up as `max(0, current minimum rent - incoming balance)` and separately quotes the transaction fee. It does not pay network fees from an uninitialized vault address.

Incoming balance state is bound to the current address. A failed fee quote or Explorer-history lookup cannot replace an already confirmed incoming balance with zero. RPC/network failures show an unknown value or diagnostic; deployment checks still gate activation and deposits. Initialized account owner, version, layout, root and coordinator validation are unchanged.

## Using a directly funded address

Reload the site in the same browser and choose **Unlock saved vault**. Keep the existing identity and its verified recovery file. Connect a wallet with enough SOL for the activation fee and any quoted rent top-up, then choose **Activate vault**. SOL already at the address covers the applicable rent, and the remainder becomes the protected balance after confirmation. An updated backup is still required before each withdrawal. Do not replace the identity or delete browser storage to refresh a balance.

The fee payer can differ from the wallet that sent the direct transfer. A conventional wallet signature still cannot withdraw vault funds. Withdrawals require the existing hash-based one-time authorization and automatic key rotation.

## Verification

The current release evidence is in [experimental-launch.json](experimental-launch.json). All 61 unit tests, three compiled SBF matrices, and 18 public browser tests passed. New cases cover absent, partially prefunded and fully prefunded addresses; incorrect owners and unsafe RPC amounts; insufficient fees; activation with only a fee balance; exact preservation of an incoming 90,998,331 lamports; reload of the same encrypted identity; and withdrawal/rotation of those funds using the compiled program. Rent expectations use the runtime/RPC quote, not a hardcoded network price.

The Mainnet program binary and recovery schema were unchanged. Production verification used read-only RPC requests. Browser funding/withdrawal tests used disposable local VM accounts; this update did not sign or spend a user's Mainnet funds.

## Interface update

“How it Works” now explains the on-chain vault, one-time Winternitz signatures and fresh-shell rotation in three short sections. Setup instructions are expandable. The Mainnet top banner was removed from the wallet and guide; the internal Devnet test banner remains.
