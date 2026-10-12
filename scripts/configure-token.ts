// Read-only verification for the WEBSITE'S future mainnet token badge.
// This does not change the vault's fixed Devnet RPC, signing domain, deployment,
// fee configuration or funding gates, and never constructs a transaction.
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackMint } from '@solana/spl-token';
import { writeFile } from 'node:fs/promises';
const mint = new PublicKey(process.argv[2] ?? '');
const rpc = 'https://api.mainnet-beta.solana.com', expected = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const connection = new Connection(rpc, { commitment: 'finalized', disableRetryOnRateLimit: true });
const genesis = await connection.getGenesisHash(); if (genesis !== expected) throw Error('Token verification RPC is not official mainnet');
const info = await connection.getAccountInfo(mint, 'finalized');
if (!info || (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID))) throw Error('The supplied CA is not an on-chain SPL mint');
const value = unpackMint(mint, info, info.owner); if (!value.isInitialized) throw Error('The token mint is uninitialized');
const badge = { symbol: '$SHELL', address: mint.toBase58(), network: 'mainnet-beta', status: 'verified', tokenProgram: info.owner.toBase58(), genesis, decimals: value.decimals, mintAuthority: value.mintAuthority?.toBase58() ?? null, freezeAuthority: value.freezeAuthority?.toBase58() ?? null, checkedAt: new Date().toISOString(), note: 'Read-only token-address verification. The security vault and fee protocol remain Devnet-only. No investment return, liquidity or program compatibility claim.' };
await writeFile('public/token.json', JSON.stringify(badge, null, 2) + '\n');
console.info(JSON.stringify(badge, null, 2));
