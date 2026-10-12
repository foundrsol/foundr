// Public conventional-wallet approvals only. Vault keys stay exclusively in
// the encrypted identity store. Every payment/staking operation has an on-chain
// nonce/receipt, and its signed bytes are durable before broadcast.
import { Transaction, VersionedTransaction, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { base58, b64, equal, from64 } from '../core/bytes.ts';
import type { Stage, Attempt } from '../core/engine.ts';
import type { WalletProvider } from '../solana/chain.ts';
import { BN } from '@anchor-lang/core';
import { ProtocolClient, PROTOCOL_ID } from './client.ts';
export type PublicAction = { id: string; kind: string; receipt: string; nonce: string; amount: string; revision: string; state: Stage; signature?: string; raw?: string; lastValidBlockHeight?: number; error?: string };
const terminal = (state: Stage) => ['confirmed', 'failed', 'expired'].includes(state);
export class PublicWalletJournal {
  client: ProtocolClient; wallet: WalletProvider;
  constructor(client: ProtocolClient, wallet: WalletProvider) { this.client = client; this.wallet = wallet; }
  private key() { if (!this.wallet.publicKey) throw Error('Connect a fee wallet'); return `${PROTOCOL_ID}:${this.wallet.publicKey.toBase58()}`; }
  private async db() {
    return new Promise<IDBDatabase>((resolve, reject) => { const q = indexedDB.open('shell-public-actions-v1', 1); q.onupgradeneeded = () => q.result.createObjectStore('actions'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(Error('Durable action storage unavailable')); });
  }
  private async exclusive<T>(fn: (load: () => Promise<PublicAction | null>, save: (value: PublicAction) => Promise<void>) => Promise<T>): Promise<T> {
    if (!globalThis.isSecureContext || !navigator.locks) throw Error('Wallet actions require secure browser storage and Web Locks');
    return navigator.locks.request(`SHELL:public:${this.key()}`, { ifAvailable: true, mode: 'exclusive' }, async lock => {
      if (!lock) throw Error('Another tab is approving or reconciling this wallet operation');
      const db = await this.db(); try {
        const key = this.key();
        return await fn(() => new Promise((resolve, reject) => { const q = db.transaction('actions').objectStore('actions').get(key); q.onsuccess = () => resolve(q.result ?? null); q.onerror = () => reject(Error('Action storage read failed')); }), value => new Promise((resolve, reject) => { const tx = db.transaction('actions', 'readwrite', { durability: 'strict' }); tx.objectStore('actions').put(value, key); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(Error('Action state could not be persisted. Nothing submitted.')); }));
      } finally { db.close(); }
    });
  }
  read() { return this.exclusive(load => load()); }
  private async status(action: PublicAction): Promise<Stage> {
    const receipt = await this.client.connection.getAccountInfo(new PublicKey(action.receipt), 'finalized');
    if (receipt?.owner.equals(PROTOCOL_ID)) {
      if (action.kind === 'subscription') {
        const r = this.client.program.coder.accounts.decode<{ payer: PublicKey; fee: BN }>('receipt', receipt.data);
        if (!r.payer.equals(this.wallet.publicKey!) || r.fee.toString() !== action.amount) throw Error('Subscription receipt differs from approved payment');
        return 'confirmed';
      }
      const operator = this.client.program.coder.accounts.decode<{ owner: PublicKey; actionNonce: BN }>('operator', receipt.data);
      if (!operator.owner.equals(this.wallet.publicKey!)) throw Error('Operator record belongs to another wallet');
      if (action.kind === 'register' || BigInt(operator.actionNonce.toString()) > BigInt(action.nonce)) return 'confirmed';
    }
    if (!action.signature || !action.lastValidBlockHeight) return 'failed'; // Never submitted; no private one-time keys involved.
    const result = (await this.client.connection.getSignatureStatuses([action.signature], { searchTransactionHistory: true })).value[0];
    if (result?.confirmationStatus === 'finalized') return result.err ? 'failed' : 'confirmed';
    if (result) return 'confirming';
    if (await this.client.connection.getBlockHeight('finalized') > action.lastValidBlockHeight) return 'expired';
    return 'outcome unknown';
  }
  async reconcile(retryIdentical = false): Promise<PublicAction | null> {
    return this.exclusive(async (load, save) => {
      const action = await load(); if (!action || terminal(action.state)) return action;
      await this.client.validate();
      try {
        action.state = await this.status(action);
        if (!terminal(action.state) && retryIdentical && action.raw) {
          const sig = await this.client.connection.sendRawTransaction(from64(action.raw), { skipPreflight: false, maxRetries: 0, preflightCommitment: 'finalized' });
          if (sig !== action.signature) throw Error('Unexpected RPC signature'); action.state = await this.status(action);
        }
      } catch { action.state = 'outcome unknown'; }
      await save(action); return action;
    });
  }
  async approve(intent: Omit<PublicAction, 'id' | 'state'>, instructions: TransactionInstruction[], rent: bigint, notify: (state: Stage) => void): Promise<PublicAction> {
    return this.exclusive(async (load, save) => {
      const previous = await load();
      if (previous && !terminal(previous.state)) throw Error('A previous wallet action has an unresolved outcome. Reconcile or retry its identical transaction first.');
      await this.client.validate();
      const payer = this.wallet.publicKey!;
      if (typeof this.wallet.signTransaction !== 'function') throw Error('Wallet must support signing without submission');
      const block = await this.client.connection.getLatestBlockhash('finalized'), tx = new Transaction({ feePayer: payer, ...block }).add(...instructions);
      if (instructions.some(i => !i.programId.equals(PROTOCOL_ID))) throw Error('Unexpected program in protocol action');
      const fee = (await this.client.connection.getFeeForMessage(tx.compileMessage(), 'finalized')).value;
      if (fee === null || !Number.isSafeInteger(fee)) throw Error('Network fee quote unavailable');
      if (BigInt(await this.client.connection.getBalance(payer, 'finalized')) < BigInt(fee) + rent) throw Error('Insufficient connected-wallet SOL for fees and account rent');
      const simulated = await this.client.connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, replaceRecentBlockhash: false, commitment: 'finalized' });
      if (simulated.value.err) throw Error('Simulation rejected this action. Check token balance, mint, lock period and configuration. No approval requested.');
      const action: PublicAction = { ...intent, id: crypto.randomUUID(), state: 'awaiting signature' };
      await save(action); notify(action.state);
      let signed: Transaction;
      try {
        const expected = tx.serializeMessage(); signed = await this.wallet.signTransaction(tx);
        if (!equal(expected, signed.serializeMessage()) || !signed.verifySignatures()) throw Error('Wallet substituted the approved message');
      } catch (error) { action.state = 'failed'; await save(action); throw error; }
      const raw = signed.serialize(); if (raw.length > 1232) { action.state = 'failed'; await save(action); throw Error('Wallet action exceeds packet limit'); }
      action.raw = b64(raw); action.signature = base58(signed.signature!); action.lastValidBlockHeight = block.lastValidBlockHeight; action.state = 'submitting';
      await save(action); notify(action.state);
      try {
        await this.client.validate();
        const result = await this.client.connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0, preflightCommitment: 'finalized' });
        if (result !== action.signature) throw Error('Unexpected RPC signature'); action.state = 'confirming'; await save(action); notify(action.state); action.state = await this.status(action);
      } catch { action.state = 'outcome unknown'; }
      await save(action); notify(action.state); return action;
    });
  }
}
