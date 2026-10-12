import { base58, concat, from58, from64url, hex, random, unhex } from './bytes.ts';
import { decrypt, encrypt, fingerprint, type Envelope } from './recovery.ts';
import { DEVNET_AUTHORIZATION_DOMAIN, MAINNET_GENESIS, authorizationContext, operationDigest, sameOperation, type AuthorizationProfile, type Operation, type VaultState } from './protocol.ts';
import { checkFunds } from './amount.ts';
import { activationPlatformFee } from './platform-fee.ts';
import { generateKey, rootOf, signDigest } from './winternitz.ts';
import type { PaidChoice } from '../protocol/client.ts';
import type { Session, Store } from './store.ts';

export type Stage = 'awaiting signature' | 'submitting' | 'confirming' | 'confirmed' | 'failed' | 'outcome unknown' | 'expired';
export type Kind = 'create' | 'deposit' | 'commit' | 'authorization' | 'withdraw';
export type Attempt = { kind: Kind; address: string; amount?: string; signature: string; raw: string; lastValidBlockHeight: number; state: Stage; error?: string };
export type Pending = { operation: Operation; digest: string; boundDigest?: string; phase: 'prepared' | 'committed' | 'signing' | 'signed' | 'confirmed'; signature?: string; paid?: PaidChoice };
export type Shell = { root: string; address: string; secret: string | null; consumed: boolean; pending?: Pending };
// Schema 1's legacy field name "genesis" stores the authorization domain marker,
// not the full RPC genesis hash. Existing encrypted packages remain compatible.
type IdentityState = { id: string; program: string; coordinator: string; coordinatorSeed: string; securityRevision: number; verifiedRevision: number; current: string; shells: Shell[]; attempts: Attempt[]; blocked?: string };
export type Identity = IdentityState & ({ schema: 1; genesis: typeof DEVNET_AUTHORIZATION_DOMAIN; cluster?: never; authorizationProfile?: never } | { schema: 2; genesis: typeof MAINNET_GENESIS; cluster: 'mainnet-beta'; authorizationProfile: 'mainnet-v2' });
export const RECENT_CONSUMED_SHELLS = 8;
export const LOCAL_TRANSACTION_LIMIT = 100;
const settled = (a: Attempt): boolean => ['confirmed', 'failed', 'expired'].includes(a.state);
// Only public, terminal history may be retired. Current/next keys, commitments,
// bound digests, signatures and unresolved signed transactions always survive.
function retainRecoveryState(i: Identity): void {
  const live = i.shells.filter(s => !s.consumed);
  if (live.length === 0 || live.length > 2 || !live.some(s => s.root === i.current)) throw Error('Invalid active recovery state. No keys were replaced.');
  if (i.shells.some(s => s.consumed && s.secret !== null)) throw Error('Consumed signing secrets must be erased. Signing stopped.');
  const retired = new Set(i.shells.filter(s => s.consumed).slice(-RECENT_CONSUMED_SHELLS));
  i.shells = i.shells.filter(s => !s.consumed || retired.has(s));
  const unfinished = i.attempts.filter(a => !settled(a));
  if (unfinished.length > LOCAL_TRANSACTION_LIMIT) throw Error('Too many unresolved transactions. Recovery state was preserved; reconcile their outcomes before signing.');
  const room = LOCAL_TRANSACTION_LIMIT - unfinished.length;
  const recent = room > 0 ? i.attempts.filter(settled).slice(-room) : [];
  const retained = new Set([...unfinished, ...recent]);
  i.attempts = i.attempts.filter(a => retained.has(a));
}
export type Request = { kind: Kind; vault: Shell; coordinator: string; coordinatorSeed: string; amount?: bigint; operation?: Operation; wotsSignature?: string; paid?: PaidChoice };
export interface Chain {
  program: string;
  readonly profile?: AuthorizationProfile;
  validate(): Promise<void>;
  address(root: string, coordinator: string): string;
  validateCoordinator(seed: string, coordinator: string): void;
  vault(address: string): Promise<VaultState | null>;
  rent(): Promise<bigint>;
  initializationRent(address: string): Promise<bigint>;
  fee(kind: Kind): Promise<bigint>;
  walletBalance(): Promise<bigint>;
  transaction(request: Request): Promise<Omit<Attempt, 'state' | 'kind' | 'address'>>;
  broadcast(attempt: Attempt): Promise<string>;
  outcome(attempt: Attempt): Promise<{ state: Stage; error?: string }>;
  authorizationReady?(request: Request): Promise<boolean>;
}
const active = (i: Identity): Shell => { const s = i.shells.find(s => s.root === i.current); if (!s || s.consumed) throw Error('No usable current shell'); return s; };
function backupReady(i: Identity): void { if (i.verifiedRevision !== i.securityRevision) throw Error('Export and verify the current encrypted recovery package first.'); }
function assertState(s: Shell, i: Identity, state: VaultState): void {
  if (state.root !== s.root || state.coordinator !== i.coordinator) throw Error('Unexpected on-chain vault identity. Signing stopped.');
}
// Phases, confirmations, and transaction blockhashes can change without adding
// secret material. The chain commitment guarantees deterministic same-op recovery.
const recoveryMaterial = (i: Identity) => ({ id: i.id, program: i.program, genesis: i.genesis, coordinator: i.coordinator, coordinatorSeed: i.coordinatorSeed, revision: i.securityRevision,
  ...(i.schema === 2 ? { schema: i.schema, cluster: i.cluster, authorizationProfile: i.authorizationProfile } : {}),
  shells: i.shells.filter(s => !s.consumed).map(s => ({ root: s.root, secret: s.secret, address: s.address, operation: s.pending?.operation, paid: s.pending?.paid })) });

export class Engine {
  private store: Store;
  public chain: Chain;
  private password: string;
  private notify: (stage: Stage) => void;
  constructor(store: Store, chain: Chain, password: string, notify: (stage: Stage) => void = () => {}) { this.store = store; this.chain = chain; this.password = password; this.notify = notify; }
  private async persist(i: Identity, session: Session): Promise<void> { retainRecoveryState(i); await session.save(i); }
  private get profile(): AuthorizationProfile { const profile = this.chain.profile ?? 'devnet-v1'; authorizationContext(profile); return profile; }
  private sameContext(i: Identity): boolean {
    return i.program === this.chain.program && (this.profile === 'devnet-v1' ? i.schema === 1 && i.genesis === DEVNET_AUTHORIZATION_DOMAIN : i.schema === 2 && i.cluster === 'mainnet-beta' && i.genesis === MAINNET_GENESIS && i.authorizationProfile === 'mainnet-v2');
  }
  private run<T>(task: (i: Identity, session: Session) => Promise<T>): Promise<T> {
    return this.store.exclusive(this.password, async session => {
      const i = await session.load<Identity>(); if (!i) throw Error('Create or recover a SHELL identity first.');
      if (!this.sameContext(i)) throw Error('Recovery package belongs to another deployment or network. Mainnet and Devnet keys cannot be migrated or reused.');
      return task(i, session);
    });
  }
  read(): Promise<Identity> { return this.run(async i => structuredClone(i)); }
  async create(): Promise<Identity> {
    return this.store.exclusive(this.password, async session => {
      if (await session.load()) throw Error('A local identity already exists. Recover or unlock it; creation cannot replace it.');
      from58(this.chain.program);
      const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
      const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
      const key = await generateKey();
      const root = hex(key.root), coordinator = base58(from64url(jwk.x!));
      const vault: Shell = { root, secret: hex(key.secret), address: this.chain.address(root, coordinator), consumed: false };
      key.secret.fill(0);
      const context = this.profile === 'mainnet-v2' ? { schema: 2, genesis: MAINNET_GENESIS, cluster: 'mainnet-beta', authorizationProfile: 'mainnet-v2' } as const : { schema: 1, genesis: DEVNET_AUTHORIZATION_DOMAIN } as const;
      const i: Identity = { ...context, id: crypto.randomUUID(), program: this.chain.program, coordinator, coordinatorSeed: hex(from64url(jwk.d!)), securityRevision: 1, verifiedRevision: 0, current: root, shells: [vault], attempts: [] };
      await this.persist(i, session); return structuredClone(i);
    });
  }
  exportBackup(): Promise<Envelope> { return this.run(async (i, session) => { await this.persist(i, session); return encrypt(i, this.password); }); }
  async verifyBackup(envelope: Envelope, password: string): Promise<void> {
    const backup = await decrypt<Identity>(envelope, password);
    await this.run(async (i, session) => {
      if (await fingerprint(recoveryMaterial(i)) !== await fingerprint(recoveryMaterial(backup))) throw Error('This package does not contain the current keys and intended operation. Export a fresh package.');
      i.verifiedRevision = i.securityRevision; await this.persist(i, session);
    });
  }
  async recover(envelope: Envelope): Promise<Identity> {
    const i = await decrypt<Identity>(envelope, this.password);
    await this.validateRecovery(i);
    return this.store.exclusive(this.password, async session => {
      if (await session.load()) throw Error('Recovery cannot overwrite an existing local identity. Use a clean browser profile.');
      i.verifiedRevision = i.securityRevision;
      try { await this.chain.validate(); await this.reconcileIdentity(i); } catch (error) { i.blocked = (error as Error).message; }
      await this.persist(i, session); return structuredClone(i);
    });
  }
  private async validateRecovery(i: Identity): Promise<void> {
    if (!i || !this.sameContext(i) || !Array.isArray(i.shells) || i.shells.length === 0 || i.shells.length > 100 || !Array.isArray(i.attempts) || !Number.isSafeInteger(i.securityRevision)) throw Error('Invalid recovery identity or deployment mismatch / network mismatch. No replacement was created.');
    this.chain.validateCoordinator(i.coordinatorSeed, i.coordinator);
    if (new Set(i.shells.map(s => s.root)).size !== i.shells.length) throw Error('Recovery package repeats a one-time key');
    for (const s of i.shells) {
      if (s.address !== this.chain.address(s.root, i.coordinator)) throw Error('Recovery vault address is inconsistent');
      if (!s.consumed && (!s.secret || hex(await rootOf(unhex(s.secret))) !== s.root)) throw Error('Recovery package is missing usable vault keys. No replacement was created.');
      if (s.pending) {
        if (s.pending.paid) {
          const p = s.pending.paid;
          from58(p.program);
          if (![1,2,3,4].includes(p.service) || !/^\d+$/.test(p.maxFee) || !/^\d+$/.test(p.revision) || BigInt(p.maxFee) > ((1n << 64n) - 1n) || BigInt(p.revision) <= 0n) throw Error('Invalid paid-service recovery state');
        }
        if (this.profile === 'mainnet-v2' && s.pending.paid) throw Error('Devnet premium receipts cannot be restored or executed on Mainnet. No replacement was created.');
        const digest = hex(await operationDigest(i.program, s.address, s.root, i.coordinator, s.pending.operation, this.profile));
        if (s.pending.digest !== digest || (s.pending.boundDigest && s.pending.boundDigest !== digest)) throw Error('Recovery signing state is inconsistent');
        if (!i.shells.some(child => child.root === s.pending!.operation.nextRoot && child.address === s.pending!.operation.nextAddress)) throw Error('Recovery package is missing the replacement shell');
      }
    }
    if (!i.shells.some(s => s.root === i.current)) throw Error('Recovery package has no current shell');
  }
  private async reconcileIdentity(i: Identity): Promise<void> {
    // Follow permanent receipts from a pre-confirmation package. Never guess or
    // create replacement keys. A missing child secret blocks signing.
    for (let depth = 0; depth < i.shells.length; depth++) {
      const s = active(i); const state = await this.chain.vault(s.address);
      if (!state) { if (s.pending) throw Error('Vault disappeared while an operation was pending. Outcome unknown; signing stopped.'); return; }
      assertState(s, i, state);
      if (state.status === 'consumed') {
        if (!s.pending || !sameOperation(s.pending.operation, state.operation)) throw Error('Stale recovery package: this shell was consumed. Recover the refreshed package containing the next shell.');
        const child = i.shells.find(c => c.root === s.pending!.operation.nextRoot);
        if (!child?.secret) throw Error('Stale package: replacement shell keys are missing. Signing stopped.');
        const childState = await this.chain.vault(child.address);
        if (!childState) throw Error('Rotation receipt exists but the replacement vault is missing. Outcome unknown.');
        assertState(child, i, childState);
        s.consumed = true; s.secret = null; s.pending.phase = 'confirmed'; i.current = child.root;
        for (const a of i.attempts.filter(a => a.kind === 'withdraw' && a.address === s.address)) a.state = 'confirmed';
        continue;
      }
      if (state.status === 'committed') {
        if (!s.pending || !sameOperation(s.pending.operation, state.operation)) throw Error('Stale package or competing tab: a different operation is permanently committed. Do not sign. Recover its refreshed package.');
        if (s.pending.phase === 'prepared') s.pending.phase = 'committed';
      } else if (s.pending && s.pending.phase !== 'prepared') throw Error('A finalized commitment disappeared. Signing stopped.');
      return;
    }
  }
  async reconcile(): Promise<Identity> {
    return this.run(async (i, session) => {
      await this.chain.validate();
      try {
        for (const a of i.attempts) if (['submitting', 'confirming', 'outcome unknown'].includes(a.state)) Object.assign(a, await this.chain.outcome(a));
        await this.reconcileIdentity(i); delete i.blocked;
      } catch (error) { i.blocked = (error as Error).message; }
      await this.persist(i, session); return structuredClone(i);
    });
  }
  private async send(i: Identity, session: Session, request: Request): Promise<Attempt> {
    // Unknown delivery of a conventional transaction must also avoid duplicate
    // deposits. Permit a new blockhash only after reconciliation establishes
    // failure or finalized expiry. WOTS authorization bytes are unchanged.
    const previous = i.attempts.findLast(a => a.kind === request.kind && a.address === request.vault.address);
    if (previous && ['submitting', 'confirming', 'outcome unknown'].includes(previous.state)) {
      Object.assign(previous, await this.chain.outcome(previous)); await this.persist(i, session);
      if (['submitting', 'confirming', 'outcome unknown'].includes(previous.state)) throw Error('Previous transaction outcome is unknown. Reconcile or retry its identical signed transaction before submitting another.');
    }
    if (i.attempts.filter(a => !settled(a)).length >= LOCAL_TRANSACTION_LIMIT) throw Error('Unresolved transaction history is full. Reconcile before requesting another signature; no pending transaction was discarded.');
    this.notify('awaiting signature');
    let tx; try { tx = await this.chain.transaction(request); } catch (error) { this.notify('failed'); throw error; }
    const attempt: Attempt = { ...tx, kind: request.kind, address: request.vault.address, amount: request.amount?.toString() ?? request.operation?.amount, state: 'submitting' };
    i.attempts.push(attempt);
    await this.persist(i, session); // both signatures + blockhash saved BEFORE network
    this.notify('submitting');
    try {
      if (await this.chain.broadcast(attempt) !== attempt.signature) throw Error('RPC returned an unexpected transaction signature');
      attempt.state = 'confirming'; this.notify('confirming');
      Object.assign(attempt, await this.chain.outcome(attempt));
    } catch { attempt.state = 'outcome unknown'; attempt.error = 'Submission or confirmation could not be established. Reconcile before retrying.'; }
    await this.persist(i, session); this.notify(attempt.state); return structuredClone(attempt);
  }
  async createOnChain(): Promise<Attempt | null> {
    return this.run(async (i, session) => {
      backupReady(i); await this.chain.validate(); const s = active(i);
      const exists = await this.chain.vault(s.address);
      if (exists) { assertState(s, i, exists); return null; }
      const cost = await this.chain.initializationRent(s.address) + await this.chain.fee('create') + activationPlatformFee(this.profile);
      if (await this.chain.walletBalance() < cost) throw Error('Insufficient SOL for the activation platform fee, rent top-up and transaction fees');
      return this.send(i, session, { kind: 'create', vault: s, coordinator: i.coordinator, coordinatorSeed: i.coordinatorSeed });
    });
  }
  async deposit(amount: bigint): Promise<Attempt> {
    return this.run(async (i, session) => {
      backupReady(i); await this.chain.validate(); if (i.blocked) throw Error(i.blocked);
      const s = active(i), state = await this.chain.vault(s.address);
      if (!state || state.status !== 'available' || s.pending) throw Error('Initialize a fresh shell before depositing. Pending and consumed shells cannot accept deposits.');
      assertState(s, i, state); checkFunds(await this.chain.walletBalance(), amount, 0n, await this.chain.fee('deposit'));
      return this.send(i, session, { kind: 'deposit', vault: s, coordinator: i.coordinator, coordinatorSeed: i.coordinatorSeed, amount });
    });
  }
  async prepareWithdrawal(amount: bigint, destination: string, paid?: PaidChoice): Promise<Identity> {
    from58(destination);
    if (this.profile === 'mainnet-v2' && paid) throw Error('The Devnet token/fee prototype is not enabled on Mainnet. Use basic SOL vault authorization.');
    return this.run(async (i, session) => {
      backupReady(i); await this.chain.validate(); if (i.blocked) throw Error(i.blocked);
      const s = active(i); if (s.pending) throw Error('This key already has an intended operation. Resume it; its amount and destinations cannot change.');
      const state = await this.chain.vault(s.address);
      if (!state || state.status !== 'available') throw Error('Vault is absent, consumed, or already committed. Reconcile before signing.');
      assertState(s, i, state);
      if (amount <= 0n || amount > state.balance - state.rent) throw Error('Insufficient protected balance after reserved rent');
      if (destination === s.address) throw Error('Withdrawal destination cannot be the current vault');
      const key = await generateKey(); const root = hex(key.root); const nextAddress = this.chain.address(root, i.coordinator);
      if (destination === nextAddress) throw Error('Recipient must differ from the replacement vault');
      const operation: Operation = { version: 1, amount: amount.toString(), destination, nextAddress, nextRoot: root };
      s.pending = { operation, digest: hex(await operationDigest(i.program, s.address, s.root, i.coordinator, operation, this.profile)), phase: 'prepared', ...(paid ? { paid: structuredClone(paid) } : {}) };
      i.shells.push({ root, address: nextAddress, secret: hex(key.secret), consumed: false }); key.secret.fill(0);
      i.securityRevision++; await this.persist(i, session); return structuredClone(i);
    });
  }
  async commitWithdrawal(): Promise<Attempt | null> {
    return this.run(async (i, session) => {
      backupReady(i); await this.chain.validate(); const s = active(i), pending = s.pending;
      if (!pending) throw Error('Prepare and back up an operation first');
      const state = await this.chain.vault(s.address);
      if (!state) throw Error('Vault missing'); assertState(s, i, state);
      if (state.status === 'consumed') { await this.reconcileIdentity(i); await this.persist(i, session); return null; }
      if (state.status === 'committed') {
        if (!sameOperation(state.operation, pending.operation)) throw Error('Another operation is committed. Signing stopped.');
        if (pending.phase === 'prepared') pending.phase = 'committed'; await this.persist(i, session); return null;
      }
      checkFunds(await this.chain.walletBalance(), await this.chain.rent(), 0n, await this.chain.fee('commit') + await this.chain.fee('withdraw'));
      const attempt = await this.send(i, session, { kind: 'commit', vault: s, coordinator: i.coordinator, coordinatorSeed: i.coordinatorSeed, operation: pending.operation });
      await this.reconcileIdentity(i); await this.persist(i, session); return attempt;
    });
  }
  async reviewPaidOperation(paid: PaidChoice): Promise<void> {
    await this.run(async (i, session) => {
      await this.chain.validate(); await this.reconcileIdentity(i);
      const p = active(i).pending;
      if (!p?.paid || p.paid.program !== paid.program || ![1,2,3,4].includes(paid.service) || !/^\d+$/.test(paid.maxFee) || !/^\d+$/.test(paid.revision)) throw Error('Only an existing paid operation can have its fee approval reviewed');
      // Outer wallet-paid fees can be reviewed without changing a single byte
      // of the immutable WOTS operation or signing it again.
      p.paid = structuredClone(paid); i.securityRevision++; await this.persist(i, session);
    });
  }
  async executeWithdrawal(): Promise<Attempt> {
    return this.run(async (i, session) => {
      backupReady(i); await this.chain.validate(); if (i.blocked) throw Error(i.blocked);
      const s = active(i), p = s.pending;
      if (!p) throw Error('No prepared withdrawal');
      const state = await this.chain.vault(s.address);
      if (!state || state.status !== 'committed' || !sameOperation(state.operation, p.operation)) throw Error('The identical operation must be finalized on-chain before any one-time signature is produced.');
      assertState(s, i, state);
      const digest = hex(await operationDigest(i.program, s.address, s.root, i.coordinator, p.operation, this.profile));
      if (p.digest !== digest || (p.boundDigest && p.boundDigest !== digest)) throw Error('Signing key is bound to another message. Signing stopped.');
      if (!p.signature) {
        p.boundDigest = digest; p.phase = 'signing';
        await this.persist(i, session); // durable intent BEFORE exposing the WOTS signature
        const secret = unhex(s.secret!);
        try { p.signature = hex(await signDigest(secret, unhex(digest, 32))); } finally { secret.fill(0); }
        p.phase = 'signed'; await this.persist(i, session);
      }
      checkFunds(await this.chain.walletBalance(), await this.chain.rent(), 0n, await this.chain.fee('withdraw'));
      const request: Request = { kind: 'withdraw', vault: s, coordinator: i.coordinator, coordinatorSeed: i.coordinatorSeed, operation: p.operation, wotsSignature: p.signature, paid: p.paid };
      if (p.paid) {
        if (!this.chain.authorizationReady) throw Error('This client cannot safely complete the backed-up paid operation. No different one-time message will be signed.');
        if (!await this.chain.authorizationReady(request)) {
          const staged = await this.send(i, session, { ...request, kind: 'authorization' });
          if (staged.state !== 'confirmed') return staged;
          if (!await this.chain.authorizationReady(request)) throw Error('Public authorization record did not match the durable one-time operation');
        }
      }
      const attempt = await this.send(i, session, request);
      await this.reconcileIdentity(i); await this.persist(i, session); return attempt;
    });
  }
  async retryIdentical(): Promise<Attempt> {
    return this.run(async (i, session) => {
      await this.chain.validate(); const a = i.attempts.findLast(a => ['outcome unknown', 'confirming', 'submitting'].includes(a.state));
      if (!a) throw Error('No unknown transaction to retry. Reconcile the current shell.');
      const outcome = await this.chain.outcome(a); Object.assign(a, outcome); await this.persist(i, session);
      if (a.state === 'expired' || a.state === 'failed' || a.state === 'confirmed') { await this.reconcileIdentity(i); await this.persist(i, session); return structuredClone(a); }
      try { if (await this.chain.broadcast(a) !== a.signature) throw Error('Unexpected signature'); Object.assign(a, await this.chain.outcome(a)); }
      catch { a.state = 'outcome unknown'; }
      await this.reconcileIdentity(i); await this.persist(i, session); this.notify(a.state); return structuredClone(a);
    });
  }
}
