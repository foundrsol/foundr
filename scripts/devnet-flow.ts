import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Keypair, PublicKey } from '@solana/web3.js';
import { SolanaChain, explorer, type Deployment, type WalletProvider } from '../src/solana/chain.ts';
import { Engine, type Stage } from '../src/core/engine.ts';
import { hex, random } from '../src/core/bytes.ts';
import { assertNetwork } from '../src/core/protocol.ts';
import { FileStore } from './file-store.ts';
await mkdir('.dev', { recursive: true, mode: 0o700 }); await mkdir('docs', { recursive: true });
const manifest = JSON.parse(await readFile('public/deployment.json', 'utf8')) as Deployment;
const payer = Keypair.generate(), recipient = Keypair.generate().publicKey;
const wallet: WalletProvider = { publicKey: payer.publicKey, connect: async () => ({ publicKey: payer.publicKey }), disconnect: async () => {}, signTransaction: async tx => { tx.partialSign(payer); return tx; } };
const chain = new SolanaChain(manifest, 'https://api.devnet.solana.com', wallet);
await chain.validate(); assertNetwork(await chain.connection.getGenesisHash());
// Disposable test identity, devnet faucet only. Never read a user's wallet key.
const faucet = await chain.connection.requestAirdrop(payer.publicKey, 200_000_000);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
for (let n = 0; n < 60 && await chain.walletBalance() < 200_000_000n; n++) await sleep(2000);
assert.ok(await chain.walletBalance() >= 200_000_000n, 'Devnet faucet did not finalize');
const password = hex(random(24)); // disposable test password; never logged
const runId = crypto.randomUUID(), store = new FileStore(`.dev/flow-${runId}.json`);
const engine = new Engine(store, chain, password, (state: Stage) => console.log(`Devnet verification: ${state}`));
await engine.create();
async function backup() { const e = await engine.exportBackup(); await writeFile(`.dev/flow-${runId}-backup.json`, JSON.stringify(e), { mode: 0o600 }); await engine.verifyBackup(JSON.parse(await readFile(`.dev/flow-${runId}-backup.json`, 'utf8')), password); return e; }
async function finalized() {
  for (let n = 0; n < 90; n++) {
    const i = await engine.reconcile(); if (i.blocked) throw Error(i.blocked);
    if (i.attempts.every(a => a.state === 'confirmed')) return;
    const bad = i.attempts.find(a => a.state === 'failed' || a.state === 'expired'); if (bad) throw Error(`${bad.kind}: ${bad.state}`);
    await sleep(2000);
  } throw Error('RPC confirmation remains unknown; test identity kept encrypted. No alternative one-time operation was signed.');
}
await backup(); await engine.createOnChain(); await finalized(); await engine.deposit(50_000_000n); await finalized();
let i = await engine.read(); const initial = i.shells[0].address;
assert.equal((await chain.vault(initial))!.balance - await chain.rent(), 50_000_000n);
await engine.prepareWithdrawal(20_000_000n, recipient.toBase58()); const refreshed = await backup();
await engine.commitWithdrawal(); await finalized(); await engine.executeWithdrawal(); await finalized();
i = await engine.read(); assert.equal((await chain.vault(initial))!.status, 'consumed'); assert.equal((await chain.vault(i.shells[1].address))!.balance - await chain.rent(), 30_000_000n);
// Restore the pre-confirmation package into fresh encrypted storage. The chain
// receipt, not a basic seed or a local counter, identifies the replacement.
const clean = new Engine(new FileStore(`.dev/flow-${runId}-clean.json`), chain, password); const recovered = await clean.recover(refreshed); assert.equal(recovered.current, i.current);
await engine.prepareWithdrawal(30_000_000n, recipient.toBase58()); await backup(); await engine.commitWithdrawal(); await finalized(); await engine.executeWithdrawal(); await finalized();
i = await engine.read(); assert.equal((await chain.vault(i.shells.at(-1)!.address))!.balance, await chain.rent());
assert.equal(await chain.connection.getBalance(recipient, 'finalized'), 50_000_000);
const result = { network: 'devnet', programId: chain.program, payer: payer.publicKey.toBase58(), recipient: recipient.toBase58(), faucet: { signature: faucet, explorer: explorer(faucet) }, vaults: i.shells.map(s => ({ address: s.address, consumed: s.consumed })), transactions: i.attempts.map(a => ({ kind: a.kind, signature: a.signature, state: a.state, explorer: explorer(a.signature) })), cleanStoreRecovery: 'passed', completedAt: new Date().toISOString() };
await writeFile('docs/devnet-evidence.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
