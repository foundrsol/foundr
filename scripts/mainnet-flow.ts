// Owner-operated, bounded Mainnet smoke test. No faucet, user seed or token.
// This bootstrap verifier is CLI-only: the browser always requires completed
// lifecycle evidence and independent review. This owner-funded test requires
// the exact tested, immutable deployment and never enables public funding.
import assert from 'node:assert/strict';
import { readFile, writeFile, access, open } from 'node:fs/promises';
import { Keypair } from '@solana/web3.js';
import { SolanaChain, explorer, type Deployment, type MainnetSmoke, type WalletProvider } from '../src/solana/chain.ts';
import { Engine } from '../src/core/engine.ts';
import { hex, random } from '../src/core/bytes.ts';
import { FileStore } from './file-store.ts';
import { releaseSourceSha256 } from './release-source.ts';
import { assertOwnerSmokeBuild, type BuildCheck } from './mainnet-deployment.ts';
const manifest = JSON.parse(await readFile('public/mainnet-deployment.json', 'utf8')) as Deployment;
const source = await releaseSourceSha256(), runtime = JSON.parse(await readFile('.mainnet/svm-result.json', 'utf8')) as BuildCheck, checks = JSON.parse(await readFile('.mainnet/release-checks.json', 'utf8')) as BuildCheck;
assertOwnerSmokeBuild(manifest, source, runtime, checks);
try { await access('.mainnet/smoke-session.json'); throw Error('A prior Mainnet smoke session exists. Reconcile its encrypted signing journal before any new run; automatic replacement is blocked.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile('.mainnet/deployer.json', 'utf8'))));
const wallet: WalletProvider = { publicKey: payer.publicKey, connect: async () => ({ publicKey: payer.publicKey }), disconnect: async () => {}, signTransaction: async tx => { tx.partialSign(payer); return tx; } };
class SmokeChain extends SolanaChain { override async validate() { await this.validateDeployment(); } }
const chain = new SmokeChain(manifest, undefined, wallet); await chain.validate();
const deposit = 2_000_000n, partial = 1_000_000n;
const rent = await chain.rent(), fees = await chain.fee('create') + await chain.fee('deposit') + 2n * (await chain.fee('commit') + await chain.fee('withdraw'));
const required = deposit + 3n * rent + fees;
assert.ok(await chain.walletBalance() >= required, `Dedicated fee payer cannot cover the bounded smoke test: ${required} lamports including fees and permanent rent. No funds moved.`);
assert.ok(BigInt(await chain.connection.getMinimumBalanceForRentExemption(0, 'finalized')) <= partial, 'Recipient rent exceeds the fixed smoke budget; stop rather than increase real-fund amounts automatically.');
const runId = crypto.randomUUID(), password = hex(random(24)), recipientKey = Keypair.generate(), recipient = recipientKey.publicKey;
await writeFile('.mainnet/smoke-recipient.json', JSON.stringify(Array.from(recipientKey.secretKey)), { mode: 0o600, flag: 'wx' });
await writeFile('.mainnet/smoke-password.txt', password, { mode: 0o600, flag: 'wx' });
await writeFile('.mainnet/smoke-session.json', JSON.stringify({ runId, payer: payer.publicKey.toBase58(), recipient: recipient.toBase58(), encryptedJournal: '.mainnet/smoke-identity.json', passwordFile: '.mainnet/smoke-password.txt', status: 'started' }), { mode: 0o600, flag: 'wx' });
const engine = new Engine(new FileStore('.mainnet/smoke-identity.json'), chain, password, stage => console.log(`Mainnet smoke: ${stage}`));
await engine.create();
async function backup() {
  const value = await engine.exportBackup(); await writeFile('.mainnet/smoke-backup.json', JSON.stringify(value), { mode: 0o600 }); const file = await open('.mainnet/smoke-backup.json', 'r+'); try { await file.sync(); } finally { await file.close(); } const saved = JSON.parse(await readFile('.mainnet/smoke-backup.json', 'utf8')); await engine.verifyBackup(saved, password); return saved;
}
async function finalized() {
  for (let n = 0; n < 90; n++) {
    const i = await engine.reconcile(); if (i.blocked) throw Error(i.blocked);
    if (i.attempts.every(a => a.state === 'confirmed')) return;
    if (i.attempts.some(a => a.state === 'failed' || a.state === 'expired')) throw Error('Smoke transaction failed/expired. Preserve the journal and reconcile the identical operation; no new messages were signed.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error('Mainnet outcome remains unknown. Preserve the encrypted journal and current package. No key was reused for another operation.');
}
await backup(); await engine.createOnChain(); await finalized(); await engine.deposit(deposit); await finalized();
await engine.prepareWithdrawal(partial, recipient.toBase58()); const refreshed = await backup(); await engine.commitWithdrawal(); await finalized(); await engine.executeWithdrawal(); await finalized();
let i = await engine.read();
assert.equal((await chain.vault(i.shells[1].address))!.balance - rent, deposit - partial);
const clean = new Engine(new FileStore('.mainnet/smoke-clean.json'), chain, password); const recovered = await clean.recover(refreshed); assert.equal(recovered.current, i.current);
await clean.prepareWithdrawal(deposit - partial, recipient.toBase58()); const lastBackup = await clean.exportBackup(); await writeFile('.mainnet/smoke-final-backup.json', JSON.stringify(lastBackup), { mode: 0o600 }); const backupFile = await open('.mainnet/smoke-final-backup.json', 'r+'); try { await backupFile.sync(); } finally { await backupFile.close(); } await clean.verifyBackup(JSON.parse(await readFile('.mainnet/smoke-final-backup.json', 'utf8')), password);
await clean.commitWithdrawal();
async function cleanFinalized() {
  for (let n = 0; n < 90; n++) { const state = await clean.reconcile(); if (state.blocked) throw Error(state.blocked); if (state.attempts.every(a => a.state === 'confirmed')) return; if (state.attempts.some(a => ['failed', 'expired'].includes(a.state))) throw Error('Restored smoke operation requires reconciliation; journal retained.'); await new Promise(resolve => setTimeout(resolve, 2000)); }
  throw Error('Restored operation outcome is unknown; no replacement operation is permitted.');
}
await cleanFinalized(); await clean.executeWithdrawal(); await cleanFinalized(); i = await clean.read();
const firstAttempts = (await engine.read()).attempts, lastAttempts = i.attempts.filter(a => a.address === i.shells[1].address);
const signatures = [...firstAttempts, ...lastAttempts].map(a => a.signature);
assert.equal(signatures.length, 6); assert.equal(await chain.connection.getBalance(recipient, 'finalized'), Number(deposit));
assert.equal((await chain.vault(i.shells[2].address))!.balance, rent);
const proof: MainnetSmoke = { payer: payer.publicKey.toBase58(), recipient: recipient.toBase58(), vaults: i.shells.map(s => s.address) as MainnetSmoke['vaults'], depositLamports: deposit.toString(), partialLamports: partial.toString(), signatures: signatures as MainnetSmoke['signatures'] };
manifest.mainnetRelease!.smoke = proof;
await writeFile('public/mainnet-deployment.json', JSON.stringify(manifest, null, 2) + '\n');
await writeFile('docs/mainnet-smoke-evidence.json', JSON.stringify({ network: 'mainnet-beta', authorizationProfile: 'mainnet-v2', programId: manifest.programId, sourceSha256: source, binarySha256: manifest.binarySha256, cleanStoreRecovery: 'passed', proof, transactions: signatures.map(signature => ({ signature, explorer: explorer(signature, 'mainnet-beta') })), completedAt: new Date().toISOString() }, null, 2) + '\n');
await writeFile('.mainnet/smoke-session.json', JSON.stringify({ runId, status: 'completed', proof }), { mode: 0o600 });
console.log('Bounded Mainnet lifecycle finalized. Run npm run release:mainnet to independently recheck all six transactions before enabling public funding.');
