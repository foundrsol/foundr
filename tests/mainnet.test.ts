import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Keypair, PublicKey } from '@solana/web3.js';
import { Engine, type Identity } from '../src/core/engine.ts';
import { BrowserStore } from '../src/core/store.ts';
import { encrypt, decrypt } from '../src/core/recovery.ts';
import { operationDigest, assertNetwork, MAINNET_GENESIS, DEVNET_GENESIS, authorizationContext } from '../src/core/protocol.ts';
import { hex, sha256, unhex } from '../src/core/bytes.ts';
import { verifyDigest } from '../src/core/winternitz.ts';
import { SolanaChain, type Deployment } from '../src/solana/chain.ts';
import { MAINNET_RPC, DEVNET_RPC, fundingDeploymentVerified } from '../src/solana/network.ts';
import { EXPERIMENTAL_DISCLOSURE } from '../src/solana/release.ts';
import { ModelChain, MemoryStore, PASSWORD, RECIPIENT, prepared } from './support.ts';
const reservation = JSON.parse(await readFile('public/mainnet-deployment.json', 'utf8')) as Deployment;
async function setup() {
  const store = new MemoryStore(), chain = new ModelChain('mainnet-v2'), engine = new Engine(store, chain, PASSWORD);
  await engine.create(); const initial = await engine.exportBackup(); await engine.verifyBackup(initial, PASSWORD);
  await engine.createOnChain(); await engine.deposit(1_000_000_000n); return { engine, chain, store, initial };
}
test('Mainnet explicitly fixes its endpoint/full genesis; missing deployment does not misidentify Phantom', async () => {
  const c = new SolanaChain({ ...reservation });
  assert.equal(c.connection.rpcEndpoint, MAINNET_RPC);
  for (const url of [DEVNET_RPC, 'https://api.testnet.solana.com', MAINNET_RPC + '/']) assert.throws(() => new SolanaChain(reservation, url), /Endpoint overrides/);
  assert.doesNotThrow(() => assertNetwork(MAINNET_GENESIS, 'mainnet-v2'));
  assert.throws(() => assertNetwork(DEVNET_GENESIS, 'mainnet-v2'), /RPC network mismatch/);
  c.connection.getGenesisHash = async () => MAINNET_GENESIS; c.connection.getAccountInfo = async () => null;
  c.reportWallet(RECIPIENT, 'Phantom'); await assert.rejects(c.validate(), /No SHELL program/);
  assert.equal(c.diagnostics.rpcStatus, 'verified'); assert.equal(c.diagnostics.walletPublicKey, RECIPIENT);
  assert.equal(c.diagnostics.walletNetwork, 'not exposed; not verified'); assert.equal(c.diagnostics.rpcCause, null);
  assert.equal(c.diagnostics.deploymentStatus, 'missing'); assert.equal(fundingDeploymentVerified(c.diagnostics), false);
});
test('Mainnet encrypted identities have explicit schema 2; network recovery and storage cannot mix', async () => {
  const { engine, initial } = await setup(); const identity = await engine.read();
  assert.equal(identity.schema, 2); assert.equal(identity.genesis, MAINNET_GENESIS); assert.equal(identity.cluster, 'mainnet-beta');
  const main = new BrowserStore('mainnet-v2'), dev = new BrowserStore();
  assert.notEqual(main.databaseName, dev.databaseName); assert.notEqual(main.lockName, dev.lockName);
  const target = new MemoryStore(); await assert.rejects(new Engine(target, new ModelChain(), PASSWORD).recover(initial), /network mismatch/); assert.equal(target.envelope, null);
  const tampered = await decrypt<Identity>(initial, PASSWORD); tampered.genesis = DEVNET_GENESIS as Identity['genesis'];
  await assert.rejects(new Engine(new MemoryStore(), new ModelChain('mainnet-v2'), PASSWORD).recover(await encrypt(tampered, PASSWORD)), /network mismatch/);
  assert.throws(() => authorizationContext('unknown' as 'mainnet-v2'), /Unsupported/);
});
test('Mainnet signatures bind their own domain and all outputs; fee/test-pool adaptation stays blocked', async () => {
  const { engine, chain } = await setup();
  await assert.rejects(engine.prepareWithdrawal(1n, RECIPIENT, { program: RECIPIENT, service: 1, maxFee: '1', revision: '1' }), /not enabled on Mainnet/);
  await prepared(engine); await engine.commitWithdrawal(); await engine.executeWithdrawal();
  const i = await engine.read(), s = i.shells[0], p = s.pending!;
  const digest = await operationDigest(i.program, s.address, s.root, i.coordinator, p.operation, 'mainnet-v2');
  assert.equal(await verifyDigest(unhex(p.signature!), digest, unhex(s.root)), true);
  assert.equal(await verifyDigest(unhex(p.signature!), await operationDigest(i.program, s.address, s.root, i.coordinator, p.operation, 'devnet-v1'), unhex(s.root)), false);
  for (const op of [{ ...p.operation, amount: '250000001' }, { ...p.operation, destination: chain.program }, { ...p.operation, nextAddress: chain.program }]) assert.equal(await verifyDigest(unhex(p.signature!), await operationDigest(i.program, s.address, s.root, i.coordinator, op, 'mainnet-v2'), unhex(s.root)), false);
});
test('Mainnet duplicate clicks/concurrent signing and fresh-browser recovery preserve a single operation', async () => {
  const { engine, chain, store } = await setup(), second = new Engine(store, chain, PASSWORD);
  const results = await Promise.allSettled([engine.prepareWithdrawal(20n, RECIPIENT), second.prepareWithdrawal(21n, RECIPIENT)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const backup = await engine.exportBackup(); await engine.verifyBackup(backup, PASSWORD); await engine.commitWithdrawal();
  const signatures = await Promise.allSettled([engine.executeWithdrawal(), second.executeWithdrawal()]);
  assert.equal(signatures.filter(r => r.status === 'fulfilled').length, 1);
  const recovered = new Engine(new MemoryStore(), chain, PASSWORD), restored = await recovered.recover(backup);
  assert.equal(restored.shells[0].secret, null); assert.equal(restored.current, restored.shells[1].root);
  await prepared(recovered, 1_000_000_000n - 20n); await recovered.commitWithdrawal(); await recovered.executeWithdrawal();
  assert.equal(chain.recipients.get(RECIPIENT), 1_000_000_000n); assert.equal((await recovered.read()).shells.length, 3);
});
test('Mainnet crash after binding/signing or before submission never frees a one-time key', async () => {
  for (const phase of ['signing', 'signed']) {
    const { engine, chain, store } = await setup(); await prepared(engine); await engine.commitWithdrawal();
    store.crashWhen = i => i.shells[0].pending?.phase === phase;
    await assert.rejects(engine.executeWithdrawal(), /Simulated crash/);
    const bound = (await engine.read()).shells[0].pending!.boundDigest;
    const restart = new Engine(store, chain, PASSWORD); await assert.rejects(restart.prepareWithdrawal(1n, RECIPIENT), /intended operation/);
    await restart.executeWithdrawal(); assert.equal((await restart.read()).shells[0].pending!.boundDigest, bound);
    assert.equal(chain.recipients.get(RECIPIENT), 250_000_000n);
  }
});
test('Mainnet RPC ambiguity and stale restoration stop alternate signing; identical retries reconcile', async () => {
  const { engine, chain, initial } = await setup(); await prepared(engine); await engine.commitWithdrawal();
  const stale = new Engine(new MemoryStore(), chain, PASSWORD); assert.match((await stale.recover(initial)).blocked!, /Stale package/);
  chain.timeoutBeforeSubmit = true; chain.ambiguous = true; const attempt = await engine.executeWithdrawal(); assert.equal(attempt.state, 'outcome unknown');
  await assert.rejects(engine.prepareWithdrawal(1n, RECIPIENT), /intended operation/); await assert.rejects(engine.executeWithdrawal(), /unknown/);
  chain.timeoutBeforeSubmit = false; chain.ambiguous = false; chain.timeoutAfterSubmit = true;
  await engine.retryIdentical(); chain.timeoutAfterSubmit = false; const state = await engine.reconcile();
  assert.equal(state.shells[0].consumed, true); assert.equal(state.attempts.at(-1)!.raw, attempt.raw); assert.equal(chain.recipients.get(RECIPIENT), 250_000_000n);
  assert.match((await new Engine(new MemoryStore(), chain, PASSWORD).recover(initial)).blocked!, /consumed/);
});
test('Mainnet funding rejects mutable programs, legacy binaries, missing review and arbitrary smoke evidence', async () => {
  async function fixture(authority: string | null = null, bytes = Buffer.from('SHELL_MAINNET_V2' + MAINNET_GENESIS)) {
    const pd = Keypair.generate().publicKey, loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
    const program = Buffer.alloc(36); program.writeUInt32LE(2); pd.toBuffer().copy(program, 4);
    const data = Buffer.alloc(45 + bytes.length); data.writeUInt32LE(3); data.writeBigUInt64LE(42n, 4); data[12] = authority ? 1 : 0;
    if (authority) new PublicKey(authority).toBuffer().copy(data, 13); bytes.copy(data, 45);
    const d: Deployment = { ...reservation, verified: true, programData: pd.toBase58(), binarySize: bytes.length, binarySha256: hex(await sha256(bytes)), deploymentSlot: 42, upgradeAuthority: authority };
    const updates: string[] = []; const c = new SolanaChain(d, undefined, undefined, v => updates.push(v.deploymentStatus));
    c.connection.getGenesisHash = async () => MAINNET_GENESIS;
    c.connection.getAccountInfo = async k => k.toBase58() === c.program ? { owner: loader, executable: true, data: program, lamports: 1, rentEpoch: 0 } : k.equals(pd) ? { owner: loader, executable: false, data, lamports: 1, rentEpoch: 0 } : null;
    return { c, updates };
  }
  await assert.rejects((await fixture(RECIPIENT)).c.validate(), /immutable/);
  await assert.rejects((await fixture(null, Buffer.from('SHELL_DEVNET_V1'))).c.validate(), /mainnet-v2 binary/);
  const { c, updates } = await fixture(); await assert.rejects(c.validate(), /launch checks are incomplete/);
  assert.equal(fundingDeploymentVerified(c.diagnostics), false); assert.ok(!updates.includes('verified'), 'bytecode-only validation must not briefly enable funding');
  c.deployment.mainnetRelease = { status: 'ready', sourceSha256: 'ab'.repeat(32), compiledTestsPassed: true, securityReview: { status: 'verified', reportUrl: 'https://review.example/report', reportSha256: 'cd'.repeat(32), reviewedSourceSha256: 'ab'.repeat(32), reviewedBinarySha256: c.deployment.binarySha256 }, smoke: { payer: RECIPIENT, recipient: c.program, vaults: [RECIPIENT, c.program, Keypair.generate().publicKey.toBase58()], depositLamports: '1000', partialLamports: '100', signatures: ['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate'] } };
  await assert.rejects(c.validate(), /six distinct/); assert.equal(fundingDeploymentVerified(c.diagnostics), false);
  c.deployment.mainnetRelease.status = 'experimental-ready';
  c.deployment.mainnetRelease.securityReview = { status: 'pending', reportUrl: null, reportSha256: null, reviewedSourceSha256: null, reviewedBinarySha256: null };
  c.deployment.mainnetRelease.experimentalLaunch = { mode: 'owner-authorized-experimental', authorizationProfile: 'mainnet-v2', programId: c.program, sourceSha256: c.deployment.mainnetRelease.sourceSha256!, binarySha256: c.deployment.binarySha256!, authorizedAt: '2026-10-11T00:00:00.000Z', disclosure: EXPERIMENTAL_DISCLOSURE };
  await assert.rejects(c.validate(), /six distinct/); assert.equal(fundingDeploymentVerified(c.diagnostics), false);
  c.deployment.mainnetRelease.experimentalLaunch.binarySha256 = 'ef'.repeat(32);
  await assert.rejects(c.validate(), /launch checks are incomplete/);
});
