import test from 'node:test';
import assert from 'node:assert/strict';
import { BN } from '@anchor-lang/core';
import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, unpackMint, unpackAccount } from '@solana/spl-token';
import { address, lamports } from '@solana/kit';
import { Engine } from '../src/core/engine.ts';
import { ProtocolChain } from '../src/protocol/chain.ts';
import { PROTOCOL_ID, VAULT_ID, configAddress, bankAddress, pda, poolAddress, authorizationAddress, receiptAddress, subscriptionAddress, operatorAddress, toAnchor, type PaidChoice } from '../src/protocol/client.ts';
import { testRules, protocolFee, swapQuote } from '../src/protocol/fees.ts';
import { runtime, info, manifest } from './runtime.ts';
import { MemoryStore, PASSWORD, RECIPIENT } from './support.ts';
import { AccountingDatabase } from '../keeper/database.ts';
import { SettlementKeeper } from '../keeper/settlement.ts';
import { verifyPremiumReceipt } from '../keeper/receipts.ts';

test('real SBF protocol: atomic paid vault, SOL/SPL revenue, actual swaps/burns, governance and operator escrow', async () => {
  const r = await runtime(), { client, svm, admins, stranger, treasury, send } = r;
  const shellMint = await r.mint(), quoteMint = await r.mint(), wrongMint = await r.mint();
  const shellSource = await r.tokenAccount(shellMint, admins[0].publicKey, 4_000_000_000_000n);
  const quoteSource = await r.tokenAccount(quoteMint, admins[0].publicKey, 10_000_000_000n);
  const wrongSource = await r.tokenAccount(wrongMint, admins[0].publicKey, 10_000_000_000n);
  const nativeSource = await r.tokenAccount(NATIVE_MINT, admins[0].publicKey, 10_000_000_000n);
  const rules = testRules();
  const initAccounts = { authority: admins[0].publicKey, protocol: PROTOCOL_ID, programData: r.programData, config: configAddress(), nativeBuyback: bankAddress('native-buyback'), nativeTreasury: bankAddress('native-treasury'), shellMint, quoteMint, splBuyback: bankAddress('spl-buyback'), splTreasury: bankAddress('spl-treasury'), burnAccount: bankAddress('burn'), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
  await send([await client.instruction('initialize', [admins.map(a => a.publicKey), treasury.publicKey, toAnchor(rules)], { ...initAccounts, authority: stranger.publicKey })], [stranger], /Unauthorized/);
  await send([await client.instruction('initialize', [[admins[0].publicKey, admins[0].publicKey, admins[2].publicKey], treasury.publicKey, toAnchor(rules)], initAccounts)], [admins[0]], /InvalidAdmins/);
  await send([await client.instruction('initialize', [admins.map(a => a.publicKey), treasury.publicKey, toAnchor(rules)], initAccounts)]);
  let config = await client.config(); assert.equal(config.revision, 1n); assert.equal(config.nativeFees, 0n);
  function tokens(key: PublicKey) { return unpackAccount(key, info(svm, key)!).amount; }
  function balance(key: PublicKey) { return svm.getBalance(address(key.toBase58())) ?? 0n; }
  const bankStart = balance(config.nativeBuyback), treasuryStart = balance(config.nativeTreasury);
  const payer = admins[0], wallet = { publicKey: payer.publicKey, connect: async () => ({ publicKey: payer.publicKey }), disconnect: async () => {}, signTransaction: async (tx: import('@solana/web3.js').Transaction) => { tx.partialSign(payer); return tx; } };
  const chain = new ProtocolChain(manifest(VAULT_ID), manifest(PROTOCOL_ID), wallet); chain.connection = r.connection; chain.protocol = client; chain.validate = async () => {};
  const store = new MemoryStore(), engine = new Engine(store, chain, PASSWORD);
  await engine.create(); let backup = await engine.exportBackup(); await engine.verifyBackup(backup, PASSWORD);
  assert.equal((await engine.createOnChain())!.state, 'confirmed'); assert.equal((await engine.deposit(1_000_000_000n)).state, 'confirmed');
  assert.equal((await client.config()).nativeFees, 0n, 'Basic security and deposits are free');
  const choice: PaidChoice = { program: PROTOCOL_ID.toBase58(), service: 4, maxFee: protocolFee(250_000_000n, 4, rules).toString(), revision: '1' };
  await engine.prepareWithdrawal(250_000_000n, RECIPIENT, choice);
  backup = await engine.exportBackup(); await engine.verifyBackup(backup, PASSWORD); assert.equal((await engine.commitWithdrawal())!.state, 'confirmed');
  // A wallet rejection occurs after durable one-time signing, before submission.
  wallet.signTransaction = async () => { throw Error('wallet declined public signature staging'); };
  await assert.rejects(engine.executeWithdrawal(), /wallet declined/);
  let identity = await engine.read(), vault = identity.shells[0], pending = vault.pending!;
  const committedSignature = pending.signature!; assert.equal(committedSignature.length, 1536);
  assert.equal((await client.config()).nativeFees, 0n);
  const stage = await client.stageInstruction(new PublicKey(vault.address), new PublicKey(identity.coordinator), committedSignature, payer.publicKey);
  await send([{ ...stage, keys: stage.keys.map(k => k.pubkey.equals(new PublicKey(identity.coordinator)) ? { ...k, pubkey: stranger.publicKey } : k) }], [payer, stranger], /Unauthorized/);
  assert.equal(info(svm, authorizationAddress(new PublicKey(vault.address))), null);
  const coordinator = Keypair.fromSeed(Buffer.from(identity.coordinatorSeed, 'hex'));
  await send([stage], [payer, coordinator]);
  assert.equal((await chain.vault(vault.address))!.status, 'committed');
  const paid = await client.paidInstruction(new PublicKey(vault.address), pending.operation, committedSignature, choice, payer.publicKey);
  const compute = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 });
  await send([compute, { ...paid, keys: paid.keys.map(k => k.pubkey.equals(new PublicKey(RECIPIENT)) ? { ...k, pubkey: stranger.publicKey } : k) }], [payer], /InvalidArgument|invalid program argument/i);
  await send([compute, await client.paidInstruction(new PublicKey(vault.address), pending.operation, committedSignature, { ...choice, maxFee: '1' }, payer.publicKey)], [payer], /FeeCap/);
  await send([compute, await client.paidInstruction(new PublicKey(vault.address), pending.operation, committedSignature, { ...choice, revision: '2' }, payer.publicKey)], [payer], /ConfigChanged/);
  assert.equal(balance(config.nativeBuyback), bankStart); assert.equal(balance(config.nativeTreasury), treasuryStart);
  assert.equal(info(svm, receiptAddress(new PublicKey(vault.address))), null, 'Failed protected operations have no receipt or protocol debit');
  const cost = svm.minimumBalanceForRentExemption(BigInt(client.program.coder.accounts.size('receipt'))) + await chain.rent() + BigInt(choice.maxFee);
  await send([SystemProgram.transfer({ fromPubkey: stranger.publicKey, toPubkey: payer.publicKey, lamports: balance(stranger.publicKey) - cost })], [stranger]);
  await send([compute, await client.paidInstruction(new PublicKey(vault.address), pending.operation, committedSignature, choice, stranger.publicKey)], [stranger], /insufficient|Insufficient/i);
  assert.equal((await chain.vault(vault.address))!.status, 'committed'); assert.equal(balance(new PublicKey(RECIPIENT)), 0n); assert.equal((await client.config()).nativeFees, 0n, 'Failed fee payment rolls back the protected operation itself');
  svm.airdrop(address(stranger.publicKey.toBase58()), lamports(1_000_000_000n));
  // Clean encrypted store restores the previously signed, unsubmitted operation.
  const signedBackup = await engine.exportBackup(), clean = new Engine(new MemoryStore(), chain, PASSWORD); await clean.recover(signedBackup);
  wallet.signTransaction = async tx => { tx.partialSign(payer); return tx; };
  const concurrent = await Promise.allSettled([clean.executeWithdrawal(), clean.executeWithdrawal()]);
  assert.equal(concurrent.filter(x => x.status === 'fulfilled').length, 1); assert.equal(concurrent.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await chain.vault(vault.address))!.status, 'consumed'); assert.equal(balance(new PublicKey(RECIPIENT)), 250_000_000n);
  config = await client.config(); assert.equal(config.nativeFees, 1_000_000n); assert.equal(config.nativeAllocated, 800_000n); assert.equal(balance(config.nativeBuyback) - bankStart, 800_000n); assert.equal(balance(config.nativeTreasury) - treasuryStart, 200_000n);
  const receipt = client.program.coder.accounts.decode('receipt', info(svm, receiptAddress(new PublicKey(vault.address)))!.data); assert.equal(receipt.fee.toString(), '1000000'); assert.equal(receipt.buyback.toString(), '800000');
  await send([compute, paid], [payer], /already in use|already initialized|custom program error/i);
  assert.equal((await client.config()).nativeFees, 1_000_000n, 'Consumed vault cannot collect another fee');
  assert.equal((await verifyPremiumReceipt(client, receiptAddress(new PublicKey(vault.address)), payer.publicKey, { kind:'vault', vault:new PublicKey(vault.address), service:4, amount:250_000_000n })).paid, 1_000_000n);
  await assert.rejects(verifyPremiumReceipt(client, receiptAddress(new PublicKey(vault.address)), stranger.publicKey, { kind:'vault', vault:new PublicKey(vault.address), service:4, amount:250_000_000n }), /another payer/);

  const nonce = crypto.getRandomValues(new Uint8Array(32)), subscription = subscriptionAddress(payer.publicKey, nonce);
  const subAccounts = { payer: payer.publicKey, config: configAddress(), quoteMint, payerQuote: quoteSource, splBuyback: config.splBuyback, splTreasury: config.splTreasury, receipt: subscription, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
  const subArgs = [Array.from(nonce), new BN(rules.subscriptionPrice.toString()), new BN(1)];
  await send([await client.instruction('paySubscription', subArgs, { ...subAccounts, payerQuote: wrongSource })], [payer], /ConstraintTokenMint/);
  await send([await client.instruction('paySubscription', [Array.from(nonce), new BN(1), new BN(1)], subAccounts)], [payer], /FeeCap/);
  assert.equal(tokens(config.splBuyback), 0n);
  await send([await client.instruction('paySubscription', subArgs, subAccounts)]);
  assert.equal(tokens(config.splBuyback), 8_000_000n); assert.equal(tokens(config.splTreasury), 2_000_000n);
  await send([await client.instruction('paySubscription', subArgs, subAccounts)], [payer], /already in use|already initialized|custom program error/i);
  assert.equal(tokens(config.splBuyback), 8_000_000n);
  assert.equal((await verifyPremiumReceipt(client, subscription, payer.publicKey, {kind:'subscription'})).paid, 10_000_000n);
  async function createPool(quote: PublicKey, source: PublicKey, amount: bigint, failure = false) {
    const pool = poolAddress(quote), ix = await client.instruction('createTestPool', [new BN(amount.toString()), new BN('1000000000000')], { admin: payer.publicKey, config: configAddress(), quoteMint: quote, shellMint, pool, poolQuote: pda('pool-quote', pool.toBytes()), poolShell: pda('pool-shell', pool.toBytes()), adminQuote: source, adminShell: shellSource, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }, [{ pubkey: admins[1].publicKey, isSigner: true, isWritable: false }]);
    await send([ix], [payer, admins[1]], failure ? /WrongMint/ : undefined);
  }
  await createPool(wrongMint, wrongSource, 1_000_000_000n, true);
  await createPool(NATIVE_MINT, nativeSource, 10_000_000_000n); await createPool(quoteMint, quoteSource, 1_000_000_000n);
  async function settle(quote: PublicKey, amount: bigint, changes: { minimum?: bigint; deadline?: bigint; nonce?: bigint; failure?: RegExp } = {}) {
    config = await client.config(); const pool = poolAddress(quote), x = tokens(pda('pool-quote', pool.toBytes())), y = tokens(pda('pool-shell', pool.toBytes())), output = swapQuote(amount, x, y, config.fees, quote.equals(NATIVE_MINT));
    const ix = await client.settleInstruction(config, quote, changes.nonce ?? config.settlementNonce, amount, changes.minimum ?? output.minimumOut, changes.deadline ?? svm.getClock().unixTimestamp + 60n, stranger.publicKey);
    await send([ix], [stranger], changes.failure); return output;
  }
  const supplyBefore = unpackMint(shellMint, info(svm, shellMint)!).supply;
  await settle(NATIVE_MINT, 800_000n, { minimum: 1n, failure: /InvalidQuote/ });
  await settle(NATIVE_MINT, 800_000n, { deadline: svm.getClock().unixTimestamp - 1n, failure: /ExpiredQuote/ });
  await settle(NATIVE_MINT, 800_000n, { nonce: 99n, failure: /Replay/ });
  assert.equal((await client.config()).burned, 0n); assert.equal(unpackMint(shellMint, info(svm, shellMint)!).supply, supplyBefore);
  const solSwap = await settle(NATIVE_MINT, 800_000n), splSwap = await settle(quoteMint, 8_000_000n);
  config = await client.config(); assert.equal(config.nativeSpent, 800_000n); assert.equal(config.splSpent, 8_000_000n);
  assert.equal(config.burned, solSwap.output + splSwap.output); assert.equal(unpackMint(shellMint, info(svm, shellMint)!).supply, supplyBefore - config.burned); assert.equal(tokens(config.burnAccount), 0n);
  // The actual backend keeper executes against this same compiled program.
  // Lose the RPC response AFTER a real swap/burn, then recover its receipt.
  const nonce2 = crypto.getRandomValues(new Uint8Array(32));
  await send([await client.instruction('paySubscription', [Array.from(nonce2),new BN('10000000'),new BN(1)], {...subAccounts,receipt:subscriptionAddress(payer.publicKey,nonce2)})]);
  const db = new AccountingDatabase(':memory:'), keeper = new SettlementKeeper(client,db), job = await keeper.quote(await client.config(),quoteMint); assert.ok(job);
  const sendOriginal = r.connection.sendRawTransaction.bind(r.connection), burnedBefore = (await client.config()).burned;
  r.connection.sendRawTransaction = async (...args) => { await sendOriginal(...args); throw Error('RPC timeout after real execution'); };
  assert.equal(await keeper.submit(job,payer), 'outcome unknown'); assert.ok((await client.config()).burned > burnedBefore);
  r.connection.sendRawTransaction = sendOriginal;
  assert.equal(await keeper.reconcile(job,true), 'confirmed'); const burnedAfter = (await client.config()).burned;
  assert.equal(await keeper.reconcile(job,true), 'confirmed'); assert.equal((await client.config()).burned,burnedAfter,'Unknown response never causes duplicate burn');
  await keeper.syncAccounting(); assert.ok(db.publicRecords().length >= 6); db.close();
  // Donating SOL does not count as collected revenue and cannot be settled.
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: config.nativeBuyback, lamports: 100_000n })]);
  await settle(NATIVE_MINT, 100_000n, { failure: /InsufficientFunds/ });
  const releaseAccounts = { payer: payer.publicKey, config: configAddress(), nativeTreasury: config.nativeTreasury, recipient: treasury.publicKey, receipt: pda('treasury-receipt', configAddress().toBytes(), new Uint8Array(8)), systemProgram: SystemProgram.programId };
  const release = await client.instruction('releaseTreasury', [new BN(0), new BN('200000')], releaseAccounts, [{ pubkey: admins[0].publicKey, isSigner: true, isWritable: false }]);
  await send([release], [payer], /Unauthorized/);
  const releaseGood = await client.instruction('releaseTreasury', [new BN(0), new BN('200000')], releaseAccounts, [{ pubkey: admins[1].publicKey, isSigner: true, isWritable: false }]);
  const treasuryBefore = balance(treasury.publicKey); await send([releaseGood], [payer, admins[1]]); assert.equal(balance(treasury.publicKey) - treasuryBefore, 200_000n);
  const quoteTreasury = await r.tokenAccount(quoteMint, treasury.publicKey);
  await send([await client.instruction('releaseSplTreasury', [new BN(0), new BN('2000000')], { payer: payer.publicKey, config: configAddress(), quoteMint, splTreasury: config.splTreasury, recipientQuote: quoteTreasury, receipt: pda('spl-treasury-receipt', configAddress().toBytes(), new Uint8Array(8)), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }, [{ pubkey: admins[1].publicKey, isSigner: true, isWritable: false }])], [payer, admins[1]]);
  assert.equal(tokens(quoteTreasury), 2_000_000n);

  const operator = operatorAddress(payer.publicKey), stakeVault = pda('stake-vault', operator.toBytes());
  const registerAccounts = { owner: payer.publicKey, config: configAddress(), shellMint, operator, stakeVault, ownerShell: shellSource, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
  await send([await client.instruction('registerOperator', [new BN(1)], registerAccounts)], [payer], /Ineligible/);
  await send([await client.instruction('registerOperator', [new BN(rules.minimumStake.toString())], registerAccounts)]);
  assert.equal(tokens(stakeVault), rules.minimumStake);
  const { systemProgram: _, ...stakeAccounts } = registerAccounts;
  await send([await client.instruction('unstake', [new BN(1), new BN(0)], stakeAccounts)], [payer], /Timelock/);
  await send([await client.instruction('stake', [new BN(1), new BN(0)], { ...stakeAccounts, ownerShell: wrongSource })], [payer], /ConstraintTokenMint/);
  await send([await client.instruction('unstake', [new BN(1), new BN(0)], { ...stakeAccounts, owner: stranger.publicKey })], [stranger], /ConstraintSeeds|ConstraintHasOne/);
  await send([await client.instruction('stake', [new BN('1000000'), new BN(0)], stakeAccounts)]); assert.equal(tokens(stakeVault), rules.minimumStake + 1_000_000n);
  const clock = svm.getClock(); clock.unixTimestamp += BigInt(rules.operatorLockSeconds) + 1n; svm.setClock(clock);
  await send([await client.instruction('unstake', [new BN((rules.minimumStake + 1_000_000n).toString()), new BN(1)], stakeAccounts)]); assert.equal(tokens(stakeVault), 0n);

  const adminAccounts = { admin: payer.publicKey, config: configAddress() }, newRules = { ...rules, ratesBps: [26, 10, 30] as [number, number, number] };
  await send([await client.instruction('proposeFees', [toAnchor(newRules)], { ...adminAccounts, admin: stranger.publicKey })], [stranger], /Unauthorized/);
  await send([await client.instruction('proposeFees', [toAnchor(newRules)], adminAccounts)]);
  await send([await client.instruction('activateFees', [], { config: configAddress() })], [stranger], /Timelock/);
  await send([await client.instruction('approveFees', [], adminAccounts)]); assert.equal((await client.config()).pendingApprovals, 1, 'The same signer never counts twice');
  clock.unixTimestamp += 3601n; svm.setClock(clock);
  await send([await client.instruction('activateFees', [], { config: configAddress() })], [stranger], /Unauthorized/);
  await send([await client.instruction('approveFees', [], { ...adminAccounts, admin: admins[1].publicKey })], [admins[1]]);
  await send([await client.instruction('activateFees', [], { config: configAddress() })], [stranger]); assert.equal((await client.config()).revision, 2n);
  // All economic records above were actual local SBF instructions and real
  // SPL transfer/burn calls. They are NEVER uploaded as Devnet/mainnet records.
});
