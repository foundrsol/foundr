import { PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { NATIVE_MINT, unpackAccount } from '@solana/spl-token';
import { BN } from '@anchor-lang/core';
import { ProtocolClient, PROTOCOL_ID, poolAddress, pda, settlementAddress, type ProtocolConfig } from '../src/protocol/client.ts';
import { swapQuote } from '../src/protocol/fees.ts';
import { base58, b64, from64 } from '../src/core/bytes.ts';
import { AccountingDatabase, type Job } from './database.ts';
export class SettlementKeeper {
  client: ProtocolClient; database: AccountingDatabase;
  constructor(client: ProtocolClient, database: AccountingDatabase) { this.client = client; this.database = database; }
  async reconcile(job: Job, retryIdentical = false): Promise<string> {
    await this.client.validate();
    const info = await this.client.connection.getAccountInfo(new PublicKey(job.receipt), 'finalized');
    if (info?.owner.equals(PROTOCOL_ID)) {
      const receipt = this.client.program.coder.accounts.decode<{ kind: number; asset: PublicKey; amount: BN; bought: BN; burned: BN }>('receipt', info.data);
      if (receipt.kind !== 3 || receipt.asset.toBase58() !== job.input_mint || receipt.amount.toString() !== job.amount || receipt.bought.toString() !== receipt.burned.toString() || BigInt(receipt.bought.toString()) < BigInt(job.minimum_out)) throw Error('Settlement nonce was consumed by a different operation. Stop and inspect its public receipt.');
      this.database.state(job, 'confirmed'); return 'confirmed';
    }
    const a = this.database.submission(job.id);
    if (!a) { this.database.state(job, 'failed', 'Planning finished without a signed submission; no funds were sent'); return 'failed'; }
    try {
      const status = (await this.client.connection.getSignatureStatuses([a.signature], { searchTransactionHistory: true })).value[0];
      if (status?.confirmationStatus === 'finalized') { const state = status.err ? 'failed' : 'outcome unknown'; this.database.state(job, state, status.err ? 'Finalized transaction failed; no protocol settlement completed' : 'Finalized transaction exists, but its required receipt is missing'); return state; }
      if (!status && await this.client.connection.getBlockHeight('finalized') > a.last_valid_height) { this.database.state(job, 'expired'); return 'expired'; }
      if (retryIdentical) {
        const sent = await this.client.connection.sendRawTransaction(from64(a.raw), { skipPreflight: false, maxRetries: 0, preflightCommitment: 'finalized' });
        if (sent !== a.signature) throw Error('Unexpected RPC signature');
      }
      this.database.state(job, status ? 'confirming' : 'outcome unknown'); return status ? 'confirming' : 'outcome unknown';
    } catch { this.database.state(job, 'outcome unknown', 'RPC delivery or confirmation remains ambiguous. Preserve identical signed bytes.'); return 'outcome unknown'; }
  }
  async quote(config: ProtocolConfig, mint: PublicKey): Promise<Job | null> {
    const native = mint.equals(NATIVE_MINT);
    if (!native && !mint.equals(config.quoteMint)) throw Error('Unexpected settlement input mint');
    if (!config.testPoolOnly) throw Error('This keeper is limited to explicitly controlled Devnet test pools. No production DEX adapter is enabled.');
    const remaining = native ? config.nativeAllocated - config.nativeSpent : config.splAllocated - config.splSpent;
    const amount = remaining < (native ? config.fees.maxSettleNative : config.fees.maxSettleSpl) ? remaining : (native ? config.fees.maxSettleNative : config.fees.maxSettleSpl);
    if (amount <= 0n) return null;
    const pool = poolAddress(mint), keys = [pda('pool-quote', pool.toBytes()), pda('pool-shell', pool.toBytes())];
    const accounts = await this.client.connection.getMultipleAccountsInfo(keys, 'finalized');
    if (accounts.some(i => !i)) throw Error('No initialized, real controlled test pool exists. Settlement skipped.');
    const x = unpackAccount(keys[0], accounts[0]!), y = unpackAccount(keys[1], accounts[1]!);
    if (!x.owner.equals(pool) || !y.owner.equals(pool) || !x.mint.equals(mint) || !y.mint.equals(config.shellMint)) throw Error('Pool token mint or authority mismatch');
    const quoted = swapQuote(amount, x.amount, y.amount, config.fees, native);
    const slot = await this.client.connection.getSlot('finalized'), time = await this.client.connection.getBlockTime(slot);
    if (time === null) throw Error('Finalized chain time unavailable');
    return { id: crypto.randomUUID(), cluster: 'devnet', program: PROTOCOL_ID.toBase58(), nonce: config.settlementNonce.toString(), input_mint: mint.toBase58(), amount: amount.toString(), minimum_out: quoted.minimumOut.toString(), deadline: (BigInt(time) + 60n).toString(), receipt: settlementAddress(config.settlementNonce).toBase58(), state: 'planned', updated_at: new Date().toISOString() };
  }
  async submit(job: Job, payer: Keypair): Promise<string> {
    const reserved = this.database.plan(job); if (!reserved.created) return this.reconcile(reserved.job, true);
    // A renewed quote keeps the durable job's original ID. Use that record for
    // every submission and state transition, including after process restart.
    job = reserved.job;
    try {
      const config = await this.client.validate();
      if (config.settlementNonce.toString() !== job.nonce) throw Error('On-chain nonce changed before signing');
      const ix = await this.client.settleInstruction(config, new PublicKey(job.input_mint), BigInt(job.nonce), BigInt(job.amount), BigInt(job.minimum_out), BigInt(job.deadline), payer.publicKey);
      const block = await this.client.connection.getLatestBlockhash('finalized'), tx = new Transaction({ feePayer: payer.publicKey, ...block }).add(ix); tx.sign(payer);
      const simulated = await this.client.connection.simulateTransaction(tx);
      if (simulated.value.err) throw Error('Simulation rejected the buyback; nothing submitted');
      const raw = tx.serialize(); if (raw.length > 1232) throw Error('Settlement packet exceeds Solana limit');
      const signature = base58(tx.signature!);
      this.database.signed(job, { signature, job_id: job.id, raw: b64(raw), last_valid_height: block.lastValidBlockHeight, state: 'submitting', error: null, created_at: new Date().toISOString() });
      // Durable raw bytes + unique nonce exist before the first broadcast.
      return await this.reconcile(job, true);
    } catch (error) {
      if (this.database.submission(job.id)) this.database.state(job, 'outcome unknown', 'Signed operation retained; reconcile before retrying');
      else this.database.state(job, 'failed', (error as Error).message);
      throw error;
    }
  }
  async syncAccounting(): Promise<void> {
    const snapshot = await this.client.snapshot();
    for (const receipt of snapshot.receipts) { receipt.signature = await this.client.receiptSignature(receipt.address); this.database.finalized(receipt, snapshot.slot); }
  }
}
