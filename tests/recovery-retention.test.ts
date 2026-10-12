import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, LOCAL_TRANSACTION_LIMIT, RECENT_CONSUMED_SHELLS, type Attempt, type Identity, type Shell } from '../src/core/engine.ts';
import { decrypt, encrypt, MAX_RECOVERY_PACKAGE_BYTES } from '../src/core/recovery.ts';
import { b64, hex, sha256, utf8 } from '../src/core/bytes.ts';
import { ModelChain, MemoryStore, PASSWORD, RECIPIENT, prepared, setup } from './support.ts';

for (const profile of ['devnet-v1', 'mainnet-v2'] as const) test(`${profile}: a legacy 100-shell signed package recovers, retains identical bytes, and completes withdrawal`, async () => {
  const store = new MemoryStore(), chain = new ModelChain(profile), engine = new Engine(store, chain, PASSWORD);
  await engine.create(); const initial = await engine.exportBackup(); await engine.verifyBackup(initial, PASSWORD);
  await engine.createOnChain(); await engine.deposit(1_000_000_000n);
  await prepared(engine, 1_000_000_000n); await engine.commitWithdrawal();
  chain.timeoutBeforeSubmit = true; chain.ambiguous = true;
  const attempt = await engine.executeWithdrawal(); assert.equal(attempt.state, 'outcome unknown');
  const legacy = await engine.read(), root = legacy.current;
  const intent = structuredClone(legacy.shells.find(s => s.root === root)!.pending);
  // Public consumed-history fixtures represent the old unbounded journal;
  // they are not network transactions or secret-bearing active shells.
  const history: Shell[] = [];
  for (let n = 0; n < 98; n++) {
    const retired = hex(await sha256(utf8(`retired-public-history-${profile}-${n}`)));
    history.push({ root: retired, address: chain.address(retired, legacy.coordinator), consumed: true, secret: null });
  }
  legacy.shells.unshift(...history); assert.equal(legacy.shells.length, 100);
  const restored = new Engine(new MemoryStore(), chain, PASSWORD);
  const recovered = await restored.recover(await encrypt(legacy, PASSWORD));
  assert.equal(recovered.shells.length, RECENT_CONSUMED_SHELLS + 2);
  assert.deepEqual(recovered.shells.find(s => s.root === root)!.pending, intent);
  assert.equal(recovered.attempts.find(a => a.signature === attempt.signature)!.raw, attempt.raw);
  await assert.rejects(restored.prepareWithdrawal(1n, RECIPIENT), /intended operation/);
  chain.timeoutBeforeSubmit = false; chain.ambiguous = false;
  const retry = await restored.retryIdentical(); assert.equal(retry.raw, attempt.raw);
  assert.equal(retry.state, 'confirmed'); assert.equal(chain.recipients.get(RECIPIENT), 1_000_000_000n);
  const freshPackage = await restored.exportBackup();
  const clean = new Engine(new MemoryStore(), chain, PASSWORD);
  const latest = await clean.recover(freshPackage);
  assert.equal(latest.current, (await restored.read()).current);
  assert.equal(chain.vaults.get(latest.shells.find(s => s.root === latest.current)!.address)!.balance, await chain.rent());
  const stale = new Engine(new MemoryStore(), chain, PASSWORD);
  assert.match((await stale.recover(initial)).blocked!, /consumed/);
});

test('completed transaction history is bounded without deleting unresolved signed bytes', async () => {
  const { engine, store } = await setup(), identity = await engine.read();
  const raw = b64(new Uint8Array(1232));
  const unresolved: Attempt = { kind: 'withdraw', address: RECIPIENT, signature: 'unresolved-public-fixture', raw, lastValidBlockHeight: 200, state: 'outcome unknown' };
  identity.attempts = [unresolved, ...Array.from({ length: 300 }, (_, n): Attempt => ({ kind: 'deposit', address: identity.shells[0].address, signature: `completed-public-fixture-${n}`, raw, lastValidBlockHeight: 200, state: 'confirmed' }))];
  await store.exclusive(PASSWORD, session => session.save(identity));
  await engine.deposit(1n);
  const current = await engine.read(); assert.equal(current.attempts.length, LOCAL_TRANSACTION_LIMIT);
  assert.deepEqual(current.attempts[0], unresolved);
  const packageFile = await engine.exportBackup(); assert.ok(JSON.stringify(packageFile, null, 2).length < MAX_RECOVERY_PACKAGE_BYTES);
  const decoded = await decrypt<Identity>(packageFile, PASSWORD);
  assert.deepEqual(decoded.attempts[0], unresolved); assert.equal(decoded.current, identity.current);
});

test('a full unresolved journal stops before requesting another wallet signature and preserves its transactions', async () => {
  const { engine, store, chain } = await setup(), identity = await engine.read();
  identity.attempts = Array.from({ length: LOCAL_TRANSACTION_LIMIT }, (_, n): Attempt => ({ kind: 'withdraw', address: RECIPIENT, signature: `unresolved-${n}`, raw: `signed-bytes-${n}`, lastValidBlockHeight: 200, state: 'outcome unknown' }));
  await store.exclusive(PASSWORD, session => session.save(identity));
  const previous = structuredClone(store.envelope), requested = chain.counter, balance = chain.wallet;
  await assert.rejects(engine.deposit(1n), /Reconcile before requesting another signature/);
  assert.equal(chain.counter, requested); assert.equal(chain.wallet, balance); assert.deepEqual(store.envelope, previous);
  assert.deepEqual((await decrypt<Identity>(await engine.exportBackup(), PASSWORD)).attempts, identity.attempts);
});

test('oversized encrypted state is rejected before replacing a recoverable local identity', async () => {
  const { engine, store } = await setup(); const original = structuredClone(store.envelope), id = (await engine.read()).id;
  await assert.rejects(store.exclusive(PASSWORD, session => session.save({ oversized: 'x'.repeat(MAX_RECOVERY_PACKAGE_BYTES) })), /supported encrypted package size/);
  assert.deepEqual(store.envelope, original); assert.equal((await engine.read()).id, id);
});
