import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicKey, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { AccountingDatabase, type Job } from '../keeper/database.ts';
import { PROTOCOL_ID, settlementAddress, type ProtocolReceipt } from '../src/protocol/client.ts';
import type { ProtocolClient } from '../src/protocol/client.ts';
import { SettlementKeeper } from '../keeper/settlement.ts';
import { base58 } from '../src/core/bytes.ts';
const key = new PublicKey(new Uint8Array(32).fill(12));
function job(nonce = '0'): Job { return { id: crypto.randomUUID(), cluster: 'devnet', program: PROTOCOL_ID.toBase58(), nonce, input_mint: key.toBase58(), amount: '8000000', minimum_out: '100', deadline: '60', receipt: settlementAddress(BigInt(nonce)).toBase58(), state: 'planned', updated_at: new Date().toISOString() }; }
test('keeper SQL prevents duplicate nonce claims across processes and preserves ambiguous signed bytes across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shell-ledger-')), path = join(dir, 'ledger.sqlite');
  try {
    let first = new AccountingDatabase(path), second = new AccountingDatabase(path); const j = job();
    assert.equal(first.plan(j).created, true); assert.equal(second.plan({ ...j, id: crypto.randomUUID() }).created, false);
    first.signed(j, { signature: 'local-test-signature', job_id: j.id, raw: 'identical-public-signed-bytes', last_valid_height: 100, state: 'submitting', error: null, created_at: j.updated_at });
    first.state(j, 'outcome unknown'); first.close(); second.close();
    first = new AccountingDatabase(path); assert.equal(first.pending().length, 1); assert.equal(first.submission(j.id)!.raw, 'identical-public-signed-bytes');
    assert.throws(() => first.signed(j, { signature: 'different-signature', job_id: j.id, raw: 'replacement-bytes', last_valid_height: 200, state: 'submitting', error: null, created_at: j.updated_at }), /unresolved/);
    assert.equal(first.plan({ ...j, deadline: '120' }).created, false, 'Unknown outcomes never permit a new quote/signature');
    first.state(j, 'expired'); const renewed = first.plan({ ...j, id: crypto.randomUUID(), deadline: '120' }); assert.equal(renewed.created, true); assert.equal(renewed.job.id, j.id);
    first.signed(j, { signature: 'retry-after-finalized-expiry', job_id: j.id, raw: 'new-blockhash-same-operation', last_valid_height: 200, state: 'submitting', error: null, created_at: j.updated_at }); first.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('public accounting deduplicates finalized receipts, detects altered records and rejects bogus burns', () => {
  const db = new AccountingDatabase(':memory:');
  const receipt: ProtocolReceipt = { address: settlementAddress(0n).toBase58(), kind: 3, payer: key, operation: key, asset: key, amount: 8_000_000n, fee: 0n, buyback: 0n, treasury: 0n, revision: 1n, service: 0, timestamp: 100n, expiresAt: 0n, bought: 100n, burned: 100n };
  db.finalized(receipt, 200); db.finalized(receipt, 201); assert.equal(db.publicRecords().length, 1); assert.equal(db.publicRecords()[0].amount, '8000000');
  assert.throws(() => db.finalized({ ...receipt, amount: 9n }, 200), /changed/);
  assert.throws(() => db.finalized({ ...receipt, address: key.toBase58(), bought: 0n, burned: 100n }, 200), /Invalid/);
  assert.throws(() => db.finalized(receipt, NaN), /Invalid/); db.close();
});
test('keeper renews an expired quote under its durable job ID before signing or broadcasting', async () => {
  const db = new AccountingDatabase(':memory:'), original = job(), payer = Keypair.generate();
  db.plan(original); db.state(original, 'expired'); let broadcasts = 0;
  const client = {
    validate: async () => ({ settlementNonce: 0n }),
    settleInstruction: async () => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: key, lamports: 0 }),
    connection: {
      getLatestBlockhash: async () => ({ blockhash: key.toBase58(), lastValidBlockHeight: 100 }),
      simulateTransaction: async () => ({ value: { err: null } }),
      getAccountInfo: async () => null,
      getSignatureStatuses: async () => ({ value: [null] }),
      getBlockHeight: async () => 1,
      sendRawTransaction: async (raw: Uint8Array) => { broadcasts++; return base58(Transaction.from(raw).signature!); },
    },
  } as unknown as ProtocolClient;
  try {
    const state = await new SettlementKeeper(client, db).submit({ ...original, id: crypto.randomUUID(), deadline: '120' }, payer);
    assert.equal(state, 'outcome unknown'); assert.equal(broadcasts, 1);
    assert.equal(db.submission(original.id)!.job_id, original.id);
    assert.equal(db.pending()[0].deadline, '120');
  } finally { db.close(); }
});
