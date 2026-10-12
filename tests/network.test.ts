import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { AccountInfo } from '@solana/web3.js';
import { SolanaChain, type Deployment, type WalletProvider } from '../src/solana/chain.ts';
import { DEVNET_RPC, fundingDeploymentVerified, publicDiagnostics } from '../src/solana/network.ts';
import { assertNetwork, DEVNET_GENESIS, DEVNET_AUTHORIZATION_DOMAIN, operationDigest, encodeOperation } from '../src/core/protocol.ts';
import { base58, concat, from58, hex, sha256, unhex, utf8 } from '../src/core/bytes.ts';
import type { Request, Attempt } from '../src/core/engine.ts';

const reserved = JSON.parse(await readFile('public/deployment.json', 'utf8')) as Deployment;
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const info = (data: Buffer, executable = false, owner = loader): AccountInfo<Buffer> => ({ data, executable, owner, lamports: 5_000_000, rentEpoch: 0 });
function connected() {
  const payer = Keypair.generate(); let signatures = 0;
  const wallet: WalletProvider = { publicKey: payer.publicKey, connect: async () => ({ publicKey: payer.publicKey }), disconnect: async () => {}, signTransaction: async tx => { signatures++; tx.partialSign(payer); return tx; } };
  const chain = new SolanaChain({ ...reserved }, DEVNET_RPC, wallet);
  chain.reportWallet(payer.publicKey.toBase58(), 'Phantom');
  chain.connection.getGenesisHash = async () => DEVNET_GENESIS;
  chain.connection.getAccountInfo = async () => null;
  return { chain, wallet, payer, signatures: () => signatures };
}
async function verifiedFixture() {
  const fixture = connected(), chain = fixture.chain;
  const programData = Keypair.generate().publicKey, binary = Buffer.from('source-matched SBF fixture, NOT an actual deployment');
  const program = Buffer.alloc(36); program.writeUInt32LE(2); programData.toBuffer().copy(program, 4);
  const data = Buffer.alloc(45 + binary.length + 16); data.writeUInt32LE(3); data.writeBigUInt64LE(42n, 4); data[12] = 1;
  new PublicKey(reserved.upgradeAuthority!).toBuffer().copy(data, 13); binary.copy(data, 45);
  chain.deployment = { ...reserved, verified: true, programData: programData.toBase58(), deploymentSlot: 42, binarySize: binary.length, binarySha256: hex(await sha256(binary)) };
  chain.diagnostics.manifestVerified = true;
  chain.connection.getAccountInfo = async address => address.toBase58() === chain.program ? info(program, true) : address.equals(programData) ? info(data) : null;
  chain.connection.getLatestBlockhash = async () => ({ blockhash: base58(new Uint8Array(32).fill(4)), lastValidBlockHeight: 100 });
  chain.connection.getFeeForMessage = async () => ({ context: { slot: 42 }, value: 5000 });
  chain.connection.getMinimumBalanceForRentExemption = async () => 2_088_000;
  chain.connection.getBalance = async () => 1_000_000_000;
  return { ...fixture, data, program, programData };
}
function deposit(chain: SolanaChain): Request {
  const coordinator = Keypair.generate(), root = 'ab'.repeat(32);
  return { kind: 'deposit', amount: 10n, coordinator: coordinator.publicKey.toBase58(), coordinatorSeed: hex(coordinator.secretKey.subarray(0, 32)), vault: { root, address: chain.address(root, coordinator.publicKey.toBase58()), consumed: false, secret: null } };
}

test('RPC validation accepts the full official Devnet hash and rejects the truncated CAIP identifier', () => {
  assert.doesNotThrow(() => assertNetwork('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'));
  for (const hash of [DEVNET_AUTHORIZATION_DOMAIN, 'mainnet', '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY']) assert.throws(() => assertNetwork(hash), /RPC network mismatch.*received/);
});
test('all frontend RPC endpoints are fixed to the official Devnet URL', () => {
  for (const endpoint of ['https://api.mainnet-beta.solana.com', 'https://api.testnet.solana.com', 'https://another-devnet.example', DEVNET_RPC + '/']) assert.throws(() => new SolanaChain(reserved, endpoint), /Endpoint overrides are disabled/);
  assert.equal(connected().chain.connection.rpcEndpoint, DEVNET_RPC);
});
test('Phantom connection without a network indicator is independent of verified RPC and missing program', async () => {
  const { chain, payer, signatures } = connected();
  await chain.verifyRpc(); await assert.rejects(chain.validate(), /No SHELL program account exists/);
  assert.equal(chain.diagnostics.rpcStatus, 'verified'); assert.equal(chain.diagnostics.rpcCause, null);
  assert.equal(chain.diagnostics.walletPublicKey, payer.publicKey.toBase58()); assert.equal(chain.diagnostics.walletNetwork, 'not exposed; not verified');
  assert.equal(chain.diagnostics.deploymentStatus, 'missing'); assert.equal(fundingDeploymentVerified(chain.diagnostics), false);
  await assert.rejects(chain.transaction(deposit(chain)), /No SHELL program account exists/); assert.equal(signatures(), 0);
});
test('RPC timeout is unavailable, not a network mismatch, and retains wallet connection', async () => {
  const { chain, payer } = connected(); chain.connection.getGenesisHash = async () => { throw Error('RPC timeout'); };
  await assert.rejects(chain.validate(), /could not be verified: RPC timeout/);
  assert.equal(chain.diagnostics.rpcStatus, 'unavailable'); assert.doesNotMatch(chain.diagnostics.rpcCause!, /network mismatch/);
  assert.equal(chain.diagnostics.walletPublicKey, payer.publicKey.toBase58()); assert.equal(fundingDeploymentVerified(chain.diagnostics), false);
});
test('wrong RPC genesis blocks signing with exact expected and received hashes', async () => {
  const { chain, signatures } = connected(); chain.connection.getGenesisHash = async () => 'unexpected-genesis';
  await assert.rejects(chain.transaction(deposit(chain)), /received unexpected-genesis/);
  assert.equal(chain.diagnostics.rpcStatus, 'mismatch'); assert.equal(chain.diagnostics.rpcGenesis, 'unexpected-genesis');
  assert.equal(fundingDeploymentVerified(chain.diagnostics), false); assert.equal(signatures(), 0);
});
test('a manifest mismatch is separate from RPC mismatch; ordinary accounts and unverified bytecode stay gated', async () => {
  const { chain } = connected(); chain.deployment.genesis = DEVNET_AUTHORIZATION_DOMAIN;
  await assert.rejects(chain.validate(), /Deployment manifest mismatch/); assert.equal(chain.diagnostics.rpcStatus, 'verified');
  chain.deployment.genesis = DEVNET_GENESIS; chain.deployment.verified = true;
  chain.connection.getAccountInfo = async () => info(Buffer.alloc(36), false, SystemProgram.programId);
  await assert.rejects(chain.validate(), /not the expected executable/); assert.equal(fundingDeploymentVerified(chain.diagnostics), false);
  const f = await verifiedFixture(); f.chain.deployment.verified = false; f.chain.diagnostics.manifestVerified = false;
  await assert.rejects(f.chain.validate(), /security verification are incomplete/); assert.equal(f.chain.diagnostics.deploymentStatus, 'unverified'); assert.equal(fundingDeploymentVerified(f.chain.diagnostics), false);
});
test('funding requires verified program owner, bytecode, ProgramData, deployment slot and upgrade authority', async () => {
  const f = await verifiedFixture(); await f.chain.validate(); assert.equal(fundingDeploymentVerified(f.chain.diagnostics), true);
  const mutations: ((fixture: typeof f) => void)[] = [
    v => { v.data[45] ^= 1; }, v => { v.data[v.data.length - 1] = 1; },
    v => { v.data.writeBigUInt64LE(43n, 4); }, v => { v.data[13] ^= 1; },
    v => { v.chain.deployment.programData = Keypair.generate().publicKey.toBase58(); },
    v => { v.chain.deployment.upstreamCommit = 'unreviewed'; },
    v => { v.data.writeUInt32LE(2); },
  ];
  for (const mutate of mutations) { const v = await verifiedFixture(); mutate(v); await assert.rejects(v.chain.validate()); assert.equal(fundingDeploymentVerified(v.chain.diagnostics), false); }
});
test('wallet signs a Devnet-built message, substitution is rejected, and only the verified RPC submits', async () => {
  const { chain, wallet, payer } = await verifiedFixture(); const request = deposit(chain);
  let sent = 0;
  chain.connection.sendRawTransaction = async raw => { sent++; return base58(Transaction.from(raw).signature!); };
  const signed = await chain.transaction(request);
  const transaction = Transaction.from(Buffer.from(signed.raw, 'base64'));
  assert.equal(transaction.recentBlockhash, base58(new Uint8Array(32).fill(4))); assert.equal(sent, 0);
  const attempt: Attempt = { ...signed, kind: request.kind, address: request.vault.address, state: 'submitting' };
  assert.equal(await chain.broadcast(attempt), signed.signature); assert.equal(sent, 1);
  wallet.signTransaction = async tx => { tx.instructions[0].data[1] ^= 1; tx.partialSign(payer); return tx; };
  await assert.rejects(chain.transaction(request), /substituted/); assert.equal(sent, 1);
  chain.connection.getGenesisHash = async () => 'wrong-network'; await assert.rejects(chain.broadcast(attempt), /RPC network mismatch/); assert.equal(sent, 1);
});
test('diagnostic logging whitelist excludes passwords, recovery data and signing keys', () => {
  const d = connected().chain.diagnostics;
  const publicValue = publicDiagnostics({ ...d, password: 'never log', coordinatorSeed: 'never log', secret: 'never log' } as typeof d);
  assert.doesNotMatch(JSON.stringify(publicValue), /password|coordinatorSeed|secret|never log/);
});
test('RPC correction preserves the existing v1 authorization preimage exactly', async () => {
  const key = base58(new Uint8Array(32).fill(9)), root = 'ab'.repeat(32);
  const op = { version: 1 as const, amount: '10', destination: key, nextAddress: key, nextRoot: 'cd'.repeat(32) };
  const original = await sha256(concat(utf8('SHELL_DEVNET_V1'), utf8('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'), from58(key), from58(key), unhex(root), from58(key), encodeOperation(op)));
  assert.deepEqual(await operationDigest(key, key, root, key, op), original);
});
