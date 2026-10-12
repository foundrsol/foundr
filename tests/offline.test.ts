import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.ts';
import { setup, MemoryStore, PASSWORD } from './support.ts';
test('offline recovery retains the original encrypted identity and blocks signing until reconciliation', async () => {
  const { engine, chain } = await setup(); const original = await engine.read(), backup = await engine.exportBackup();
  const validate = chain.validate.bind(chain); chain.validate = async () => { throw Error('Deployment verification unavailable'); };
  const recovered = new Engine(new MemoryStore(), chain, PASSWORD); const offline = await recovered.recover(backup);
  assert.equal(offline.id, original.id); assert.equal(offline.current, original.current); assert.match(offline.blocked!, /unavailable/);
  await assert.rejects(recovered.deposit(1n), /unavailable/);
  chain.validate = validate; const online = await recovered.reconcile(); assert.equal(online.blocked, undefined); assert.equal(online.current, original.current);
});
