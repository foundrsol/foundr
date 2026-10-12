// Executes the actual compiled on-chain program. No model substitutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { address, getTransactionDecoder, signature, lamports } from '@solana/kit';
import { Connection, PublicKey, Keypair, Transaction, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { SolanaChain } from '../src/solana/chain.ts';
import { buildTransactionInstructions } from '../src/solana/instructions.ts';
import { activationPlatformFee, PLATFORM_FEE_RECIPIENT } from '../src/core/platform-fee.ts';
import { Engine, RECENT_CONSUMED_SHELLS, type Attempt, type Kind, type Request } from '../src/core/engine.ts';
import { b64, base58, from64, hex, unhex } from '../src/core/bytes.ts';
import { authorizationContext, operationDigest, type AuthorizationProfile } from '../src/core/protocol.ts';
import { generateKey, signDigest } from '../src/core/winternitz.ts';
import { MemoryStore, PASSWORD, RECIPIENT, prepared } from './support.ts';

class SvmChain extends SolanaChain {
  svm: LiteSVM; payerKey: Keypair; rejectWallet = false; lastFailure: string | null = null;
  constructor(svm: LiteSVM, program: PublicKey, payer: Keypair, profile: AuthorizationProfile = 'devnet-v1') {
    const context = authorizationContext(profile);
    super({ programId: program.toBase58(), genesis: context.genesis, cluster: context.cluster, authorizationProfile: profile, verified: false, binarySha256: null, binarySize: null, programData: null, upgradeAuthority: null, deploymentSlot: null, deploymentSignature: null, upstreamCommit: '672fc6789b1532ee680f24842d235e0be8737b61' });
    this.svm = svm; this.payerKey = payer;
    this.connection = { getAccountInfo: async (key: PublicKey) => {
      const value = svm.getAccount(address(key.toBase58()));
      return value.exists ? { owner: new PublicKey(value.programAddress), data: Buffer.from(value.data), lamports: Number(value.lamports), executable: value.executable } : null;
    }, getMinimumBalanceForRentExemption: async (n: number) => Number(svm.minimumBalanceForRentExemption(BigInt(n))) } as unknown as Connection;
  }
  override async validate() {}
  override async walletBalance() { return this.svm.getBalance(address(this.payerKey.publicKey.toBase58())) ?? 0n; }
  override async fee(k: Kind) { return k === 'create' || k === 'commit' ? 10000n : 5000n; }
  makeTransaction(r: Request): Transaction {
    this.svm.expireBlockhash();
    const tx = new Transaction({ feePayer: this.payerKey.publicKey, recentBlockhash: this.svm.latestBlockhash() });
    if (r.kind === 'withdraw') tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }));
    tx.add(...buildTransactionInstructions(new PublicKey(this.program), r, this.payerKey.publicKey, this.profile));
    if (r.kind === 'create' || r.kind === 'commit') tx.partialSign(Keypair.fromSeed(unhex(r.coordinatorSeed)));
    tx.partialSign(this.payerKey); assert.ok(tx.serialize().length <= 1232, 'real signed packet fits Solana'); return tx;
  }
  override async transaction(r: Request) {
    if (this.rejectWallet) throw Error('Simulated fee wallet rejection after durable WOTS signature');
    const tx = this.makeTransaction(r); return { signature: base58(tx.signature!), raw: b64(tx.serialize()), lastValidBlockHeight: 1000000 };
  }
  override async broadcast(a: Attempt) {
    const result = this.svm.sendTransaction(getTransactionDecoder().decode(from64(a.raw)));
    if (result instanceof FailedTransactionMetadata) {
      this.lastFailure = `SVM rejected transaction: ${result.err()}\n${result.meta().logs().join('\n')}`;
      throw Error(this.lastFailure);
    }
    return a.signature;
  }
  override async outcome(a: Attempt) {
    const r = this.svm.getTransaction(signature(a.signature));
    return { state: r instanceof FailedTransactionMetadata ? 'failed' as const : r ? 'confirmed' as const : 'outcome unknown' as const };
  }
}
for (const profile of ['devnet-v1', 'mainnet-v2'] as const) test(`SBF ${profile}: lifecycle, adversarial authorization, cross-network rejection, replay and clean-store recovery`, async () => {
  const svm = new LiteSVM(), payer = Keypair.generate(), program = Keypair.generate().publicKey;
  const path = profile === 'mainnet-v2' ? 'program/target/deploy/mainnet/shell_vault.so' : 'program/target/deploy/shell_vault.so';
  svm.addProgram(address(program.toBase58()), new Uint8Array(await readFile(path))); svm.airdrop(address(payer.publicKey.toBase58()), lamports(10_000_000_000n));
  const chain = new SvmChain(svm, program, payer, profile), store = new MemoryStore(), e = new Engine(store, chain, PASSWORD);
  await e.create(); let backup = await e.exportBackup(); await e.verifyBackup(backup, PASSWORD);
  async function prefund(vault: string, amount = Number(svm.minimumBalanceForRentExemption(0n))) {
    svm.expireBlockhash();
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() }).add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(vault), lamports: amount }));
    tx.sign(payer);
    const result = svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
    assert.ok(!(result instanceof FailedTransactionMetadata), 'A public PDA can be prefunded through System Program');
  }
  const local = (await e.read()).shells[0]; await prefund(local.address);
  assert.equal(await chain.vault(local.address), null, 'An empty prefunded System account is not protected or initialized');
  const initialization = await e.createOnChain(); assert.equal(initialization?.state, 'confirmed', chain.lastFailure ?? 'SVM initialization must confirm before funding');
  const collectedFee = svm.getBalance(address(PLATFORM_FEE_RECIPIENT)) ?? 0n;
  assert.equal(collectedFee, activationPlatformFee(profile), 'Initial activation pays the exact platform fee only on Mainnet');
  assert.equal(await e.createOnChain(), null, 'Already activated vaults do not create another fee transaction');
  await e.deposit(1_000_000_000n);
  const first = (await e.read()).shells[0]; assert.equal((await chain.vault(first.address))!.balance - await chain.rent(), 1_000_000_000n);
  backup = await prepared(e); await e.commitWithdrawal(); chain.rejectWallet = true; await assert.rejects(e.executeWithdrawal(), /wallet rejection/); chain.rejectWallet = false;
  const i = await e.read(), p = i.shells[0].pending!;
  const request: Request = { kind: 'withdraw', vault: i.shells[0], coordinator: i.coordinator, coordinatorSeed: i.coordinatorSeed, operation: p.operation, wotsSignature: p.signature };
  async function reject(r: Request) { const tx = await chain.transaction(r); await assert.rejects(chain.broadcast({ ...tx, kind: r.kind, address: r.vault.address, state: 'submitting' }), /SVM rejected/); assert.equal((await chain.vault(first.address))!.status, 'committed'); }
  await reject({ ...request, wotsSignature: '00'.repeat(768) }); // ordinary wallet only
  const wrong = await generateKey(); const digest = await operationDigest(chain.program, first.address, first.root, i.coordinator, p.operation, profile);
  await reject({ ...request, wotsSignature: hex(await signDigest(wrong.secret, digest)) }); wrong.secret.fill(0);
  await reject({ ...request, operation: { ...p.operation, amount: '250000001' } });
  await reject({ ...request, operation: { ...p.operation, destination: payer.publicKey.toBase58() } });
  await reject({ ...request, operation: { ...p.operation, nextAddress: RECIPIENT } });
  await reject({ ...request, kind: 'commit', operation: { ...p.operation, amount: '1' } });
  await prefund(p.operation.nextAddress); // Must not let a public donation freeze rotation.
  // Reuse only the already exposed signature in another compiled network
  // profile. No one-time key is asked to sign a second digest.
  const otherProfile = profile === 'mainnet-v2' ? 'devnet-v1' : 'mainnet-v2';
  const otherSvm = new LiteSVM();
  otherSvm.addProgram(address(program.toBase58()), new Uint8Array(await readFile(otherProfile === 'mainnet-v2' ? 'program/target/deploy/mainnet/shell_vault.so' : 'program/target/deploy/shell_vault.so')));
  otherSvm.airdrop(address(payer.publicKey.toBase58()), lamports(10_000_000_000n));
  const other = new SvmChain(otherSvm, program, payer, otherProfile);
  for (const kind of ['create', 'deposit', 'commit'] as const) {
    const r = { ...request, kind, amount: 1_000_000_000n }, tx = await other.transaction(r);
    await other.broadcast({ ...tx, kind, address: first.address, state: 'submitting' });
  }
  const cross = await other.transaction(request);
  await assert.rejects(other.broadcast({ ...cross, kind: 'withdraw', address: first.address, state: 'submitting' }), /SVM rejected/);
  assert.equal((await other.vault(first.address))!.status, 'committed');
  await e.executeWithdrawal(); assert.equal((await chain.vault(first.address))!.status, 'consumed');
  assert.equal(svm.getBalance(address(RECIPIENT)), 250_000_000n);
  const replay = await chain.transaction(request); await assert.rejects(chain.broadcast({ ...replay, kind: 'withdraw', address: first.address, state: 'submitting' }), /SVM rejected/);
  const recreate = await chain.transaction({ ...request, kind: 'create' }); await assert.rejects(chain.broadcast({ ...recreate, kind: 'create', address: first.address, state: 'submitting' }), /SVM rejected/);
  const recovered = new Engine(new MemoryStore(), chain, PASSWORD); await recovered.recover(backup);
  // The recipient commonly is the same wallet that pays the new shell's rent.
  await recovered.prepareWithdrawal(750_000_000n, payer.publicKey.toBase58());
  const refreshed = await recovered.exportBackup(); await recovered.verifyBackup(refreshed, PASSWORD);
  await recovered.commitWithdrawal(); const payerBefore = await chain.walletBalance();
  await recovered.executeWithdrawal();
  assert.equal(await chain.walletBalance(), payerBefore + 750_000_000n - await chain.rent() - await chain.fee('withdraw'));
  assert.equal(svm.getBalance(address(RECIPIENT)), 250_000_000n); const final = await recovered.read();
  assert.equal((await chain.vault(final.shells.at(-1)!.address))!.balance, await chain.rent());
  assert.equal(svm.getBalance(address(PLATFORM_FEE_RECIPIENT)) ?? 0n, collectedFee, 'Partial/full withdrawals, rotations and failed recreation never collect another platform fee');
  if (profile === 'mainnet-v2') {
    // Exercise retirement with actual new keys and compiled-program rotations,
    // then restore the last pre-confirmation package in a clean store.
    const seen = new Set(final.shells.map(s => s.root));
    await recovered.deposit(BigInt(RECENT_CONSUMED_SHELLS + 3));
    let lastPackage = refreshed;
    for (let n = 0; n < RECENT_CONSUMED_SHELLS + 3; n++) {
      const state = await recovered.prepareWithdrawal(1n, payer.publicKey.toBase58());
      const next = state.shells.at(-1)!;
      assert.equal(seen.has(next.root), false, 'Every rotation uses a fresh one-time key');
      seen.add(next.root);
      lastPackage = await recovered.exportBackup(); await recovered.verifyBackup(lastPackage, PASSWORD);
      await recovered.commitWithdrawal(); assert.equal((await recovered.executeWithdrawal()).state, 'confirmed');
      const saved = await recovered.read();
      assert.ok(saved.shells.length <= RECENT_CONSUMED_SHELLS + 1);
      assert.equal(saved.shells.filter(s => !s.consumed).length, 1);
      assert.ok(saved.shells.filter(s => s.consumed).every(s => s.secret === null));
    }
    const compacted = new Engine(new MemoryStore(), chain, PASSWORD);
    const clean = await compacted.recover(lastPackage);
    assert.equal(clean.current, (await recovered.read()).current);
    assert.equal((await chain.vault(clean.shells.find(s => s.root === clean.current)!.address))!.balance, await chain.rent());
    assert.ok(!clean.shells.some(s => s.root === first.root), 'The original receipt is retired locally');
    const retiredReplay = await chain.transaction(request);
    await assert.rejects(chain.broadcast({ ...retiredReplay, kind: 'withdraw', address: first.address, state: 'submitting' }), /SVM rejected/);
    assert.equal((await chain.vault(first.address))!.status, 'consumed', 'Permanent on-chain receipt still rejects replay');
  }
  // A direct transfer before activation must survive initialization. A wallet
  // with only the platform + actual two-signature fee must not fund rent twice.
  const feePayer = Keypair.generate(), directChain = new SvmChain(svm, program, feePayer, profile);
  const direct = new Engine(new MemoryStore(), directChain, PASSWORD);
  await direct.create(); const directBackup = await direct.exportBackup(); await direct.verifyBackup(directBackup, PASSWORD);
  const directAddress = (await direct.read()).shells[0].address;
  await prefund(directAddress, 90_998_331);
  assert.equal(await directChain.vault(directAddress), null);
  assert.equal(await directChain.uninitializedBalance(directAddress), 90_998_331n);
  assert.equal(await directChain.initializationRent(directAddress), 0n);
  await assert.rejects(direct.createOnChain(), /Insufficient/);
  if (profile === 'mainnet-v2') {
    svm.setAccount({ address: address(feePayer.publicKey.toBase58()), lamports: lamports(10_000n), programAddress: address(SystemProgram.programId.toBase58()), executable: false, data: new Uint8Array(0), space: 0n });
    const identity = await direct.read();
    const failedRequest: Request = { kind: 'create', vault: identity.shells[0], coordinator: identity.coordinator, coordinatorSeed: identity.coordinatorSeed };
    const failed = await directChain.transaction(failedRequest);
    await assert.rejects(directChain.broadcast({ ...failed, kind: 'create', address: directAddress, state: 'submitting' }), /SVM rejected/);
    assert.equal(await directChain.vault(directAddress), null, 'A failing payment rolls back vault initialization');
    assert.equal(await directChain.uninitializedBalance(directAddress), 90_998_331n, 'Existing incoming SOL is untouched by a failing payment');
    assert.equal(svm.getBalance(address(PLATFORM_FEE_RECIPIENT)), collectedFee, 'Failed activation collects no platform fee');
  }
  svm.setAccount({ address: address(feePayer.publicKey.toBase58()), lamports: lamports(10_000n + activationPlatformFee(profile)), programAddress: address(SystemProgram.programId.toBase58()), executable: false, data: new Uint8Array(0), space: 0n });
  assert.equal((await direct.createOnChain())!.state, 'confirmed', directChain.lastFailure ?? 'Prefunded activation must execute');
  assert.equal(await directChain.walletBalance(), 0n);
  assert.equal(svm.getBalance(address(PLATFORM_FEE_RECIPIENT)) ?? 0n, collectedFee + activationPlatformFee(profile), 'A separate new vault pays exactly one additional fee');
  const activated = (await directChain.vault(directAddress))!;
  assert.equal(activated.balance, 90_998_331n);
  const directSpendable = 90_998_331n - activated.rent;
  assert.equal(activated.balance - activated.rent, directSpendable);
  const directRecipient = Keypair.generate().publicKey;
  svm.airdrop(address(feePayer.publicKey.toBase58()), lamports(10_000_000n));
  await direct.prepareWithdrawal(directSpendable, directRecipient.toBase58());
  const spendBackup = await direct.exportBackup(); await direct.verifyBackup(spendBackup, PASSWORD);
  await direct.commitWithdrawal(); assert.equal((await direct.executeWithdrawal()).state, 'confirmed');
  assert.equal(svm.getBalance(address(directRecipient.toBase58())), directSpendable);
  assert.equal((await directChain.vault(directAddress))!.status, 'consumed');
});
