import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SolanaChain, type Deployment } from '../src/solana/chain.ts';
import { DEVNET_GENESIS, MAINNET_GENESIS } from '../src/core/protocol.ts';
import { MAINNET_RPC, DEVNET_RPC, rpcTransportForProfile, initialDiagnostics, fundingDeploymentVerified } from '../src/solana/network.ts';

test('HTTPS Mainnet requests use the same-origin relay with no cookies, redirect or cache; Devnet stays official', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { protocol: 'https:', origin: 'https://shell.example' } } });
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init: init! });
      const request = JSON.parse(String(init!.body));
      assert.equal(request.method, 'getGenesisHash');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: String(input) === DEVNET_RPC ? DEVNET_GENESIS : MAINNET_GENESIS }), { headers: { 'content-type': 'application/json' } });
    };
    const main = new SolanaChain(JSON.parse(await readFile('public/mainnet-deployment.json', 'utf8')) as Deployment);
    await main.verifyRpc();
    assert.equal(main.connection.rpcEndpoint, MAINNET_RPC);
    assert.equal(main.diagnostics.rpcTransportEndpoint, 'https://shell.example/api/mainnet-rpc');
    assert.equal(main.diagnostics.rpcStatus, 'verified');
    const dev = new SolanaChain(JSON.parse(await readFile('public/deployment.json', 'utf8')) as Deployment);
    await dev.verifyRpc();
    assert.deepEqual(calls.map(c => c.url), ['https://shell.example/api/mainnet-rpc', DEVNET_RPC]);
    for (const { init } of calls) {
      assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
      assert.ok(!String(init.body).includes('secret')); assert.ok(init.signal);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('RPC transport cannot substitute another destination or alter network-specific funding checks', async () => {
  assert.equal(rpcTransportForProfile('mainnet-v2'), MAINNET_RPC);
  const configuration = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.deepEqual(configuration.rewrites, [{ source: '/api/mainnet-rpc', destination: `${MAINNET_RPC}/` }]);
  const d = { ...initialDiagnostics('public-test-program', true, 'mainnet-v2'), rpcGenesis: MAINNET_GENESIS, rpcStatus: 'verified' as const, deploymentStatus: 'verified' as const };
  assert.equal(fundingDeploymentVerified(d), true);
  assert.equal(fundingDeploymentVerified({ ...d, rpcTransportEndpoint: 'https://attacker.example/api/mainnet-rpc' }), false);
  assert.equal(fundingDeploymentVerified({ ...d, rpcEndpoint: DEVNET_RPC }), false);
  assert.equal(fundingDeploymentVerified({ ...d, rpcGenesis: DEVNET_GENESIS }), false);
  assert.equal(fundingDeploymentVerified({ ...d, rpcStatus: 'unavailable' }), false);
});
