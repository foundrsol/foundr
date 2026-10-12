import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine, type Identity } from '../src/core/engine.ts';
import { base58, hex, unhex, utf8, sha256 } from '../src/core/bytes.ts';
import { encrypt, decrypt } from '../src/core/recovery.ts';
import { parseSol, formatSol, checkFunds } from '../src/core/amount.ts';
import { generateKey, signDigest, verifyDigest } from '../src/core/winternitz.ts';
import { operationDigest, DEVNET_GENESIS } from '../src/core/protocol.ts';
import { setup, prepared, MemoryStore, ModelChain, PASSWORD, RECIPIENT } from './support.ts';

test('upstream Rust golden signatures reconstruct all N=22 Merkle roots', async () => {
  const fixture = JSON.parse(await readFile('vendor/winterwallet/fixtures/signing-session.json', 'utf8'));
  for (const entry of fixture.sessions) {
    assert.equal(await verifyDigest(unhex(entry.signature), unhex(entry.digest), unhex(entry.current_root)), true);
    const altered = unhex(entry.digest); altered[0] ^= 1;
    assert.equal(await verifyDigest(unhex(entry.signature), altered, unhex(entry.current_root)), false);
  }
});
test('create, verified backup, deposit, partial withdrawal, full withdrawal, and two rotations', async () => {
  const { engine, chain } = await setup(); const before = await engine.read(); const old = before.shells[0].address;
  assert.equal((await chain.vault(old))!.balance - await chain.rent(), 1_000_000_000n);
  await prepared(engine); await engine.commitWithdrawal(); await engine.executeWithdrawal();
  let i = await engine.read(); assert.notEqual(i.current, before.current); assert.equal((await chain.vault(old))!.status, 'consumed');
  assert.equal(i.shells[0].secret, null); assert.equal(chain.recipients.get(RECIPIENT), 250_000_000n);
  assert.equal((await chain.vault(i.shells[1].address))!.balance - await chain.rent(), 750_000_000n);
  await prepared(engine, 750_000_000n); await engine.commitWithdrawal(); await engine.executeWithdrawal(); i = await engine.read();
  assert.equal(chain.recipients.get(RECIPIENT), 1_000_000_000n); assert.equal(i.shells.length, 3);
  assert.equal((await chain.vault(i.shells[2].address))!.balance, await chain.rent());
});
test('recovery package is mandatory before funding and again after preparing new keys', async () => {
  const store = new MemoryStore(), chain = new ModelChain(), e = new Engine(store, chain, PASSWORD);
  await e.create(); await assert.rejects(e.createOnChain(), /verify/);
  const package1 = await e.exportBackup(); await e.verifyBackup(package1, PASSWORD); await e.createOnChain(); await e.deposit(100_000_000n);
  await e.prepareWithdrawal(10n, RECIPIENT); await assert.rejects(e.commitWithdrawal(), /verify/); await assert.rejects(e.verifyBackup(package1, PASSWORD), /current keys/);
});
test('ordinary wallet only, wrong keys, modified amount/recipient/change vault, and replay are rejected', async () => {
  const { engine, chain } = await setup(); await prepared(engine); await engine.commitWithdrawal(); await engine.executeWithdrawal();
  const good = [...chain.requests.values()].find(r => r.kind === 'withdraw')!;
  // Restore model before consumption for each adversarial authorization check.
  const old = chain.vaults.get(good.vault.address)!; old.status = 'committed'; old.balance += 1_000_000_000n;
  await assert.rejects(chain.apply({ ...good, wotsSignature: undefined }), /Winternitz/);
  await assert.rejects(chain.apply({ ...good, wotsSignature: hex(new Uint8Array(768)) }), /Winternitz/);
  for (const operation of [ { ...good.operation!, amount: '250000001' }, { ...good.operation!, destination: base58(new Uint8Array(32).fill(42)) }, { ...good.operation!, nextAddress: RECIPIENT }, { ...good.operation!, nextRoot: '11'.repeat(32) } ]) await assert.rejects(chain.apply({ ...good, operation }));
  old.status = 'consumed'; await assert.rejects(chain.apply(good), /Replay/);
  await engine.prepareWithdrawal(10n, RECIPIENT); const updated = await engine.exportBackup(); await engine.verifyBackup(updated, PASSWORD);
  await assert.rejects(engine.prepareWithdrawal(11n, RECIPIENT), /intended operation/);
});
test('duplicate clicks and concurrent tabs have only one intended operation', async () => {
  const { engine, store, chain } = await setup(); const other = new Engine(store, chain, PASSWORD);
  const result = await Promise.allSettled([engine.prepareWithdrawal(10n, RECIPIENT), other.prepareWithdrawal(11n, RECIPIENT)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  const i = await engine.read(); assert.equal(i.shells.length, 2); assert.ok(i.shells[0].pending);
  const backup = await engine.exportBackup(); await engine.verifyBackup(backup, PASSWORD); await engine.commitWithdrawal();
  const signed = await Promise.allSettled([engine.executeWithdrawal(), other.executeWithdrawal()]); assert.equal(signed.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(chain.recipients.get(RECIPIENT), BigInt(i.shells[0].pending!.operation.amount));
});
test('separate restored browsers race the same key: chain first-writer commitment blocks the loser', async () => {
  const { engine, chain, initialBackup } = await setup();
  const clone = new Engine(new MemoryStore(), chain, PASSWORD); await clone.recover(initialBackup);
  await prepared(engine, 10n); await prepared(clone, 11n);
  await engine.commitWithdrawal(); await assert.rejects(clone.commitWithdrawal(), /Another operation/);
  await assert.rejects(clone.executeWithdrawal(), /identical operation/);
  await engine.executeWithdrawal(); assert.equal(chain.recipients.get(RECIPIENT), 10n);
});
test('reload/crash after durable signing intent or signature preserves identical authorization', async () => {
  for (const phase of ['signing', 'signed']) {
    const { engine, chain, store } = await setup(); await prepared(engine); await engine.commitWithdrawal();
    store.crashWhen = i => i.shells.find(s => s.root === i.current)?.pending?.phase === phase;
    await assert.rejects(engine.executeWithdrawal(), /Simulated crash/);
    const persisted = await engine.read(); const binding = persisted.shells[0].pending!.boundDigest;
    const restarted = new Engine(store, chain, PASSWORD); await assert.rejects(restarted.prepareWithdrawal(123n, RECIPIENT), /intended operation/);
    await restarted.executeWithdrawal(); assert.equal((await restarted.read()).shells[0].pending!.boundDigest, binding); assert.equal(chain.recipients.get(RECIPIENT), 250_000_000n);
  }
});
test('timeout after actual execution reconciles to consumed without spending twice', async () => {
  const { engine, chain } = await setup(); await prepared(engine); await engine.commitWithdrawal(); chain.timeoutAfterSubmit = true;
  await engine.executeWithdrawal(); chain.timeoutAfterSubmit = false;
  const i = await engine.reconcile(); assert.equal(i.shells[0].consumed, true); assert.equal(i.attempts.at(-1)!.state, 'confirmed');
  assert.equal(chain.recipients.get(RECIPIENT), 250_000_000n); await assert.rejects(engine.executeWithdrawal(), /No prepared/);
});
test('unsubmitted ambiguous transaction blocks new messages and permits identical raw retransmission', async () => {
  const { engine, chain } = await setup(); await prepared(engine); await engine.commitWithdrawal(); chain.timeoutBeforeSubmit = true; chain.ambiguous = true;
  const result = await engine.executeWithdrawal(); assert.equal(result.state, 'outcome unknown');
  await assert.rejects(engine.executeWithdrawal(), /unknown/); await assert.rejects(engine.prepareWithdrawal(1n, RECIPIENT), /intended operation/);
  const raw = (await engine.read()).attempts.at(-1)!.raw; chain.timeoutBeforeSubmit = false; chain.ambiguous = false;
  await engine.retryIdentical(); assert.equal((await engine.read()).attempts.at(-1)!.raw, raw); assert.equal(chain.recipients.get(RECIPIENT), 250_000_000n);
});
test('failed and expired transactions permit a new blockhash only for the identical WOTS operation', async () => {
  for (const mode of ['failed', 'expired']) {
    const { engine, chain } = await setup(); await prepared(engine); await engine.commitWithdrawal();
    if (mode === 'failed') chain.forceFailure = true; else chain.timeoutBeforeSubmit = true;
    await engine.executeWithdrawal(); const sig = (await engine.read()).shells[0].pending!.signature;
    chain.forceFailure = false; chain.timeoutBeforeSubmit = false; chain.expired = mode === 'expired';
    await engine.executeWithdrawal(); assert.equal((await engine.read()).shells[0].pending!.signature, sig); assert.equal(chain.recipients.get(RECIPIENT), 250_000_000n);
  }
});
test('clean browser recovery follows confirmed rotation; stale packages block committed and consumed keys', async () => {
  const { engine, chain, initialBackup } = await setup(); const currentBackup = await prepared(engine); await engine.commitWithdrawal();
  const stale = new Engine(new MemoryStore(), chain, PASSWORD); const locked = await stale.recover(initialBackup); assert.match(locked.blocked!, /Stale package/);
  await assert.rejects(stale.prepareWithdrawal(100n, RECIPIENT), /Stale package/);
  const clean = new Engine(new MemoryStore(), chain, PASSWORD); const recovered = await clean.recover(currentBackup); assert.equal(recovered.shells[0].pending!.phase, 'committed');
  await clean.executeWithdrawal();
  const later = new Engine(new MemoryStore(), chain, PASSWORD); const rotated = await later.recover(currentBackup); assert.equal(rotated.current, rotated.shells[1].root); assert.equal(rotated.shells[0].secret, null);
  const consumedStale = new Engine(new MemoryStore(), chain, PASSWORD); assert.match((await consumedStale.recover(initialBackup)).blocked!, /consumed/);
});
test('signing before finalized commit and stale unsigned-package operation substitution are blocked', async () => {
  const { engine, chain } = await setup(); await prepared(engine); await assert.rejects(engine.executeWithdrawal(), /finalized/);
  chain.timeoutBeforeSubmit = true; await engine.commitWithdrawal(); await assert.rejects(engine.executeWithdrawal(), /finalized/);
  chain.timeoutBeforeSubmit = false; await engine.retryIdentical(); await engine.executeWithdrawal();
});
test('authenticated encryption rejects wrong password, tampering, and never replaces identities', async () => {
  const { engine, chain, store } = await setup(); const envelope = await engine.exportBackup();
  assert.ok(!JSON.stringify(store.envelope).includes((await engine.read()).coordinatorSeed));
  await assert.rejects(decrypt(envelope, 'incorrect-password123'), /incorrect/);
  const altered = { ...envelope, ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1) }; await assert.rejects(decrypt(altered, PASSWORD), /modified/);
  await assert.rejects(engine.recover(envelope), /overwrite/); assert.equal((await engine.read()).shells.length, 1);
  const identity = await decrypt<Identity>(envelope, PASSWORD); identity.shells[0].secret = '00'.repeat(768);
  const broken = await encrypt(identity, PASSWORD); await assert.rejects(new Engine(new MemoryStore(), chain, PASSWORD).recover(broken), /missing usable/);
});
test('fees, rent, insufficient balance, exact lamports and forbidden rounding', async () => {
  assert.equal(parseSol('0.000000001'), 1n); assert.equal(formatSol(parseSol('1.234567891')), '1.234567891');
  for (const input of ['0.0000000001', '1e-9', '-1', ' 1', 'NaN', '01', '1.']) assert.throws(() => parseSol(input));
  assert.throws(() => checkFunds(100n, 90n, 5n, 6n), /Insufficient/);
  const { engine, chain } = await setup(); await assert.rejects(engine.prepareWithdrawal(1_000_000_001n, RECIPIENT), /rent/);
  chain.wallet = 5_000n; await assert.rejects(engine.deposit(1n), /fees/);
  chain.wallet = 10_000_000n; await prepared(engine); await engine.commitWithdrawal(); chain.wallet = 5_000n;
  await assert.rejects(engine.executeWithdrawal(), /rent/); const i = await engine.read(); assert.equal(i.shells[0].pending!.phase, 'signed');
  chain.wallet = 10_000_000n; await engine.executeWithdrawal(); assert.equal((await engine.read()).shells[0].consumed, true);
});
test('network and deployment mismatches reject operations and recovery', async () => {
  const { engine, chain } = await setup(); chain.genesis = 'mainnet'; await assert.rejects(engine.deposit(10n), /RPC network mismatch/); await assert.rejects(engine.prepareWithdrawal(1n, RECIPIENT), /RPC network mismatch/);
  chain.genesis = DEVNET_GENESIS; const backup = await engine.exportBackup(); const different = new ModelChain(); different.program = base58(new Uint8Array(32).fill(15));
  await assert.rejects(new Engine(new MemoryStore(), different, PASSWORD).recover(backup), /deployment mismatch/);
});
test('authorization binds the program, old vault, coordinator and all operation outputs', async () => {
  const { engine, chain } = await setup(); await prepared(engine); const i = await engine.read(), s = i.shells[0];
  const digest = await operationDigest(i.program, s.address, s.root, i.coordinator, s.pending!.operation);
  const key = unhex(s.secret!), signature = await signDigest(key, digest); key.fill(0);
  assert.equal(await verifyDigest(signature, digest, unhex(s.root)), true);
  for (const [program, vault, coordinator] of [[RECIPIENT, s.address, i.coordinator], [i.program, RECIPIENT, i.coordinator], [i.program, s.address, RECIPIENT]]) assert.equal(await verifyDigest(signature, await operationDigest(program, vault, s.root, coordinator, s.pending!.operation), unhex(s.root)), false);
});
