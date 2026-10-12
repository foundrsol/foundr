import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Keypair, PublicKey, SystemInstruction, SystemProgram } from '@solana/web3.js';
import { activationPlatformFee, PLATFORM_FEE_LAMPORTS, PLATFORM_FEE_RECIPIENT } from '../src/core/platform-fee.ts';
import { parseSol } from '../src/core/amount.ts';
import { hex } from '../src/core/bytes.ts';
import { Engine, type Request } from '../src/core/engine.ts';
import { buildTransactionInstructions } from '../src/solana/instructions.ts';
import { SolanaChain, type Deployment } from '../src/solana/chain.ts';
import { MemoryStore, ModelChain, PASSWORD, prepared } from './support.ts';

const deployment = JSON.parse(await readFile('public/mainnet-deployment.json', 'utf8')) as Deployment;
async function localIdentity(chain = new ModelChain('mainnet-v2')) {
  const store = new MemoryStore(), engine = new Engine(store, chain, PASSWORD);
  await engine.create(); const backup = await engine.exportBackup(); await engine.verifyBackup(backup, PASSWORD);
  return { chain, store, engine };
}

test('the activation fee is exactly 0.01 SOL in integer lamports and only applies to Mainnet', () => {
  assert.equal(PLATFORM_FEE_LAMPORTS, parseSol('0.01'));
  assert.equal(activationPlatformFee('mainnet-v2'), 10_000_000n);
  assert.equal(activationPlatformFee('devnet-v1'), 0n);
  assert.throws(() => activationPlatformFee('testnet' as 'mainnet-v2'), /Unsupported/);
  assert.equal(new PublicKey(PLATFORM_FEE_RECIPIENT).toBase58(), '45Vxy36SWNd1DrMZWqn1QkVhRgCqfhHPB9uLnw4xqqgy');
});

test('only a new Mainnet vault activation includes one exact transfer from the wallet to the selected recipient', () => {
  const payer = Keypair.generate().publicKey, coordinator = Keypair.generate().publicKey;
  const vault = { root: 'ab'.repeat(32), address: Keypair.generate().publicKey.toBase58(), secret: null, consumed: false };
  const request: Request = { kind: 'create', vault, coordinator: coordinator.toBase58(), coordinatorSeed: '01'.repeat(32) };
  const instructions = buildTransactionInstructions(new PublicKey(deployment.programId), request, payer, 'mainnet-v2');
  assert.equal(instructions.length, 2);
  const payment = SystemInstruction.decodeTransfer(instructions[1]);
  assert.equal(payment.fromPubkey.toBase58(), payer.toBase58());
  assert.equal(payment.toPubkey.toBase58(), PLATFORM_FEE_RECIPIENT);
  assert.equal(payment.lamports, PLATFORM_FEE_LAMPORTS);
  assert.equal(buildTransactionInstructions(new PublicKey(deployment.programId), request, payer, 'devnet-v1').length, 1);
  const operation = { version: 1 as const, amount: '1', destination: Keypair.generate().publicKey.toBase58(), nextAddress: Keypair.generate().publicKey.toBase58(), nextRoot: 'cd'.repeat(32) };
  for (const kind of ['deposit', 'commit', 'withdraw'] as const) {
    const calls = buildTransactionInstructions(new PublicKey(deployment.programId), { ...request, kind, amount: 1n, operation, wotsSignature: '00'.repeat(768) }, payer, 'mainnet-v2');
    assert.equal(calls.length, 1, `${kind} must not charge an activation fee`);
  }
});

test('the wallet cannot substitute, reduce or omit the approved fee; the exact fee is included in the signed message and balance check', async () => {
  const payer = Keypair.generate(), coordinator = Keypair.generate();
  let mutation: 'recipient' | 'amount' | 'remove' | null = null, signatures = 0;
  const chain = new SolanaChain(deployment, undefined, {
    publicKey: payer.publicKey, connect: async () => ({ publicKey: payer.publicKey }), disconnect: async () => {},
    signTransaction: async tx => {
      signatures++;
      if (mutation === 'remove') tx.instructions.pop();
      else if (mutation) tx.instructions[1] = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: mutation === 'recipient' ? Keypair.generate().publicKey : new PublicKey(PLATFORM_FEE_RECIPIENT), lamports: mutation === 'amount' ? 1n : PLATFORM_FEE_LAMPORTS });
      tx.partialSign(payer); return tx;
    },
  });
  chain.validate = async () => {};
  let balance = 20_000_000n;
  chain.walletBalance = async () => balance;
  chain.connection.getAccountInfo = async () => null;
  chain.connection.getMinimumBalanceForRentExemption = async () => 1_524_000;
  chain.connection.getLatestBlockhash = async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 200 });
  chain.connection.getFeeForMessage = async () => ({ context: { slot: 1 }, value: 10_000 });
  const root = 'ab'.repeat(32);
  const request: Request = { kind: 'create', vault: { root, address: chain.address(root, coordinator.publicKey.toBase58()), secret: null, consumed: false }, coordinator: coordinator.publicKey.toBase58(), coordinatorSeed: hex(coordinator.secretKey.subarray(0, 32)) };
  balance = 11_533_999n; await assert.rejects(chain.transaction(request), /cannot cover/); assert.equal(signatures, 0);
  balance = 11_534_000n;
  for (const change of ['recipient', 'amount', 'remove'] as const) { mutation = change; await assert.rejects(chain.transaction(request), /substituted/); }
  mutation = null; const signed = await chain.transaction(request);
  assert.ok(signed.raw); assert.equal(signatures, 4);
  chain.connection.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: null, confirmationStatus: 'finalized', err: { InstructionError: [1, 'InsufficientFunds'] } }] });
  const failure = await chain.outcome({ ...signed, kind: 'create', address: request.vault.address, state: 'confirming' });
  assert.equal(failure.state, 'failed'); assert.match(failure.error!, /No platform fee was collected/);
});

test('every separate new vault pays once; duplicate calls, reloads, withdrawals and automatic rotations do not pay again', async () => {
  const { chain, store, engine } = await localIdentity();
  const results = await Promise.allSettled([engine.createOnChain(), new Engine(store, chain, PASSWORD).createOnChain()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(chain.platformFeesCollected, PLATFORM_FEE_LAMPORTS);
  assert.equal(await new Engine(store, chain, PASSWORD).createOnChain(), null);
  const second = await localIdentity(chain); await second.engine.createOnChain();
  assert.equal(chain.platformFeesCollected, 2n * PLATFORM_FEE_LAMPORTS);
  await engine.deposit(1_000_000n); await prepared(engine, 500_000n); await engine.commitWithdrawal(); await engine.executeWithdrawal();
  await prepared(engine, 500_000n); await engine.commitWithdrawal(); await engine.executeWithdrawal();
  assert.equal(chain.platformFeesCollected, 2n * PLATFORM_FEE_LAMPORTS);
});

test('ambiguous submission and a crash before broadcast retry the identical activation without collecting twice', async () => {
  for (const scenario of ['before-submit', 'after-submit', 'crash'] as const) {
    const { chain, store, engine } = await localIdentity();
    if (scenario === 'before-submit') chain.timeoutBeforeSubmit = true;
    if (scenario === 'after-submit') chain.timeoutAfterSubmit = true;
    if (scenario === 'crash') {
      store.crashWhen = identity => identity.attempts.some(attempt => attempt.kind === 'create' && attempt.state === 'submitting');
      await assert.rejects(engine.createOnChain(), /Simulated crash/);
    } else assert.equal((await engine.createOnChain())?.state, 'outcome unknown');
    const raw = (await engine.read()).attempts.at(-1)!.raw;
    const restarted = new Engine(store, chain, PASSWORD);
    if (scenario !== 'after-submit') await assert.rejects(restarted.createOnChain(), /outcome is unknown/);
    chain.timeoutBeforeSubmit = false; chain.timeoutAfterSubmit = false;
    await restarted.retryIdentical();
    assert.equal((await restarted.read()).attempts.at(-1)!.raw, raw);
    assert.equal(chain.platformFeesCollected, PLATFORM_FEE_LAMPORTS);
    assert.equal(await restarted.createOnChain(), null);
  }
});
