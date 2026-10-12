# Project-supplied contract address

The owner supplied `66fEEkGSYVeBb2eTwsfmipZBvT3WY1ab9bRJTooSpump` for the website. It is a syntactically valid Solana public key. Both the official Mainnet RPC and the site's pinned Mainnet RPC returned the correct full genesis hash and a null finalized account at this address. The public metadata therefore uses `owner-provided` and `mintVerification: not-found`; it does not assert an initialized mint, token ownership, mint/freeze authorities, supply or liquidity.

The badge displays the entire address and supports exact clipboard copying. Pending-address behavior remains tested with an explicit fixture. Verified and owner-provided addresses both copy exactly. Actual published metadata, desktop/mobile text, clipboard contents and layout were checked; see [token-public-verification.json](token-public-verification.json).

This change made no on-chain transaction and changed no vault spending rules, program ID, recovery data, fees or keys. The finalized owner lifecycle and immutable program remain independently fetched deployment checks. Current source and deployment evidence are in [experimental-launch.json](experimental-launch.json).
