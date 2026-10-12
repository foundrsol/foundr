import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { allowedHistoryRequest } from '../scripts/mainnet-history-relay.mjs';
const request = (method: string, params: unknown[] = []) => ({ jsonrpc: '2.0', id: 'public-request', method, params });
const signatures = ['known-owner-receipt'];
test('history relay accepts only finalized public owner receipts and rejects transactions or substituted destinations', () => {
  assert.equal(allowedHistoryRequest(request('getGenesisHash'), signatures), true);
  assert.equal(allowedHistoryRequest(request('getSignatureStatuses', [signatures, { searchTransactionHistory: true }]), signatures), true);
  assert.equal(allowedHistoryRequest(request('getTransaction', [signatures[0], { commitment: 'finalized', maxSupportedTransactionVersion: 0 }]), signatures), true);
  for (const body of [request('sendTransaction', ['raw']), request('getBalance', ['address']), request('getTransaction', ['other', { commitment: 'finalized', maxSupportedTransactionVersion: 0 }]), request('getTransaction', [signatures[0], { commitment: 'processed', maxSupportedTransactionVersion: 0 }]), { ...request('getGenesisHash'), destination: 'https://other.invalid' }, [request('getGenesisHash')]]) assert.equal(allowedHistoryRequest(body, signatures), false);
});
test('history server strips browser/credential headers, pins the upstream and fails closed without logging inputs', async () => {
  const dir = new URL('../.dev/history-relay-test/', import.meta.url); await mkdir(dir, { recursive: true });
  await writeFile(new URL('index.mjs', dir), await readFile('scripts/mainnet-history-relay.mjs'));
  await writeFile(new URL('owner-lifecycle.json', dir), JSON.stringify(signatures));
  const original = globalThis.fetch; let forwarded = 0;
  globalThis.fetch = async (url, init) => {
    forwarded++; assert.equal(String(url), 'https://api.mainnet-beta.solana.com'); assert.deepEqual(init!.headers, { 'Content-Type': 'application/json' }); assert.equal(init!.redirect, 'error'); assert.equal(init!.credentials, 'omit');
    return new Response(JSON.stringify({ result: 'public-genesis' }), { status: 200 });
  };
  try {
    const { default: handler } = await import(new URL('index.mjs', dir).href);
    async function call(method: string, body: unknown) {
      const req = Object.assign((async function* () { yield Buffer.from(JSON.stringify(body)); })(), { method, headers: { origin: 'https://browser.invalid', cookie: 'private', authorization: 'private' } });
      const res = { statusCode: 200, headers: {} as Record<string, string>, text: '', setHeader(k: string, v: string) { this.headers[k] = v; }, end(t: string) { this.text = t; } };
      await handler(req, res); return res;
    }
    const ok = await call('POST', request('getGenesisHash')); assert.equal(ok.statusCode, 200); assert.equal(ok.headers['Cache-Control'], 'no-store');
    assert.equal((await call('GET', {})).statusCode, 405);
    assert.equal((await call('POST', request('sendTransaction', ['raw']))).statusCode, 400);
    assert.equal((await call('POST', { ...request('getGenesisHash'), secret: 'x'.repeat(5000) })).statusCode, 502);
    assert.equal(forwarded, 1);
  } finally { globalThis.fetch = original; await rm(dir, { recursive: true, force: true }); }
});
