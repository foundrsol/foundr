import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { SolanaChain, type Deployment } from '../src/solana/chain.ts';
import type { Request } from '../src/core/engine.ts';
import { hex } from '../src/core/bytes.ts';
import { PLATFORM_FEE_LAMPORTS } from '../src/core/platform-fee.ts';
const deployment = JSON.parse(await readFile('public/mainnet-deployment.json', 'utf8')) as Deployment;
const rent = 2_088_000n;
test('incoming System SOL stays uninitialized; activation quotes only the exact missing rent and rejects unsafe amounts', async () => {
  const chain = new SolanaChain(deployment), address = Keypair.generate().publicKey;
  let value: { owner: PublicKey; data: Buffer; lamports: number; executable: boolean; rentEpoch: number } | null = null;
  chain.connection.getAccountInfo = async () => value;
  chain.connection.getMinimumBalanceForRentExemption = async () => Number(rent);
  assert.equal(await chain.uninitializedBalance(address.toBase58()), 0n);
  assert.equal(await chain.initializationRent(address.toBase58()), rent);
  for (const balance of [1n, rent - 1n, rent, 90_998_331n]) {
    value = { owner: SystemProgram.programId, data: Buffer.alloc(0), lamports: Number(balance), executable: false, rentEpoch: 0 };
    assert.equal(await chain.vault(address.toBase58()), null);
    assert.equal(await chain.uninitializedBalance(address.toBase58()), balance);
    assert.equal(await chain.initializationRent(address.toBase58()), balance >= rent ? 0n : rent - balance);
  }
  value!.lamports = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(chain.uninitializedBalance(address.toBase58()), /safe integer/);
  value!.lamports = 90_998_331;
  for (const change of [{ owner: new PublicKey(chain.program) }, { executable: true }, { data: Buffer.from([1]) }]) {
    const original = value; value = { ...original!, ...change };
    assert.equal(await chain.uninitializedBalance(address.toBase58()), null);
    await assert.rejects(chain.initializationRent(address.toBase58()), /already initialized or has an unexpected owner/);
    value = original;
  }
});
test('a prefunded activation needs the platform fee and exact network fee, not a second rent payment; insufficient fees never request a signature', async () => {
  const payer = Keypair.generate(), coordinator = Keypair.generate(); let balance = 0n, received = 90_998_331n, signatures = 0;
  const chain = new SolanaChain(deployment, undefined, { publicKey: payer.publicKey, connect: async () => ({ publicKey: payer.publicKey }), disconnect: async () => {}, signTransaction: async tx => { signatures++; tx.partialSign(payer); return tx; } });
  // Isolate fee preflight here. Compiled SBF + browser tests enforce actual
  // deployment validation, creation and subsequent one-time withdrawals.
  chain.validate = async () => {};
  chain.walletBalance = async () => balance;
  chain.connection.getAccountInfo = async () => ({ owner: SystemProgram.programId, data: Buffer.alloc(0), lamports: Number(received), executable: false, rentEpoch: 0 });
  chain.connection.getMinimumBalanceForRentExemption = async () => Number(rent);
  chain.connection.getLatestBlockhash = async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 200 });
  chain.connection.getFeeForMessage = async () => ({ context: { slot: 1 }, value: 10_000 });
  const root = 'ab'.repeat(32), coordinatorAddress = coordinator.publicKey.toBase58();
  const request: Request = { kind: 'create', vault: { root, address: chain.address(root, coordinatorAddress), secret: null, consumed: false }, coordinator: coordinatorAddress, coordinatorSeed: hex(coordinator.secretKey.subarray(0, 32)) };
  for (const amount of [0n, 10_000n, PLATFORM_FEE_LAMPORTS + 9_999n]) { balance = amount; await assert.rejects(chain.transaction(request), /cannot cover/); }
  assert.equal(signatures, 0);
  balance = PLATFORM_FEE_LAMPORTS + 10_000n; await chain.transaction(request); assert.equal(signatures, 1);
  received = rent - 3n;
  await assert.rejects(chain.transaction(request), /cannot cover/); assert.equal(signatures, 1);
  balance = PLATFORM_FEE_LAMPORTS + 10_003n; await chain.transaction(request); assert.equal(signatures, 2);
});
