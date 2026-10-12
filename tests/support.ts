// Deterministic authorization MODEL, not the Solana VM. No production code
// imports this file. Runtime tests live in tests/svm.integration.ts.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { Engine, type Identity, type Chain, type Request, type Attempt, type Kind } from '../src/core/engine.ts';
import type { Store, Session } from '../src/core/store.ts';
import { encrypt, decrypt, type Envelope } from '../src/core/recovery.ts';
import { base58, hex, unhex } from '../src/core/bytes.ts';
import { assertNetwork, authorizationContext, operationDigest, sameOperation, type AuthorizationProfile, type VaultState } from '../src/core/protocol.ts';
import { verifyDigest } from '../src/core/winternitz.ts';
import { activationPlatformFee } from '../src/core/platform-fee.ts';
export const PASSWORD = 'test-recovery-password-123';
export const RECIPIENT = base58(new Uint8Array(32).fill(8));
export class MemoryStore implements Store {
  envelope: Envelope | null = null; locked = false;
  crashWhen?: (identity: Identity) => boolean;
  async exclusive<T>(password: string, task: (s: Session) => Promise<T>): Promise<T> {
    if (this.locked) throw Error('Concurrent identity operation blocked'); this.locked = true;
    try {
      return await task({ load: async <U>() => this.envelope ? decrypt<U>(this.envelope, password) : null,
        save: async value => { this.envelope = await encrypt(value, password); if (this.crashWhen?.(value as Identity)) { this.crashWhen = undefined; throw Error('Simulated crash after durable write'); } } });
    } finally { this.locked = false; }
  }
}
export class ModelChain implements Chain {
  program = base58(new Uint8Array(32).fill(9)); genesis: string;
  readonly profile: AuthorizationProfile;
  constructor(profile: AuthorizationProfile = 'devnet-v1') { this.profile = profile; this.genesis = authorizationContext(profile).genesis; }
  vaults = new Map<string, VaultState>(); requests = new Map<string, Request>(); processed = new Set<string>();
  wallet = 10_000_000_000n; recipients = new Map<string, bigint>(); counter = 0; platformFeesCollected = 0n;
  timeoutAfterSubmit = false; timeoutBeforeSubmit = false; ambiguous = false; expired = false; forceFailure = false;
  async validate(): Promise<void> { assertNetwork(this.genesis, this.profile); }
  address(root: string, coordinator: string): string { return base58(createHash('sha256').update(this.program + root + coordinator).digest()); }
  validateCoordinator(seed: string, coordinator: string): void {
    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(unhex(seed, 32))]), type: 'pkcs8', format: 'der' });
    const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
    if (base58(publicKey.subarray(-32)) !== coordinator) throw Error('Coordinator mismatch');
  }
  async rent(): Promise<bigint> { return 2_088_000n; }
  async initializationRent(_address: string): Promise<bigint> { return this.rent(); }
  async fee(kind: Kind): Promise<bigint> { return kind === 'create' || kind === 'commit' ? 10000n : 5000n; }
  async walletBalance(): Promise<bigint> { return this.wallet; }
  async vault(address: string): Promise<VaultState | null> { return structuredClone(this.vaults.get(address) ?? null); }
  async transaction(req: Request): Promise<Omit<Attempt, 'state' | 'kind' | 'address'>> {
    const signature = `model-${++this.counter}`; this.requests.set(signature, structuredClone(req));
    return { signature, raw: signature, lastValidBlockHeight: 200 };
  }
  async broadcast(a: Attempt): Promise<string> {
    if (this.timeoutBeforeSubmit) throw Error('RPC delivery unknown');
    if (!this.processed.has(a.signature) && !this.forceFailure) { await this.apply(this.requests.get(a.signature)!); this.processed.add(a.signature); }
    if (this.timeoutAfterSubmit) throw Error('RPC timed out AFTER chain execution'); return a.signature;
  }
  async outcome(a: Attempt) {
    if (this.forceFailure) return { state: 'failed' as const };
    if (this.ambiguous) return { state: 'outcome unknown' as const };
    if (this.processed.has(a.signature)) return { state: 'confirmed' as const };
    if (this.expired) return { state: 'expired' as const };
    return { state: 'outcome unknown' as const };
  }
  async apply(r: Request): Promise<void> {
    await this.validate(); const rent = await this.rent(); const v = this.vaults.get(r.vault.address);
    if (r.kind === 'create') {
      this.validateCoordinator(r.coordinatorSeed, r.coordinator);
      if (v) throw Error('Cannot recreate a consumed or existing vault');
      const platformFee = activationPlatformFee(this.profile);
      this.vaults.set(r.vault.address, { status: 'available', root: r.vault.root, coordinator: r.coordinator, balance: rent, rent }); this.wallet -= rent + await this.fee('create') + platformFee; this.platformFeesCollected += platformFee; return;
    }
    if (!v) throw Error('Vault missing');
    if (r.kind === 'deposit') { if (v.status !== 'available') throw Error('Vault not available'); v.balance += r.amount!; this.wallet -= r.amount! + await this.fee('deposit'); return; }
    const op = r.operation!;
    if (BigInt(op.amount) <= 0n || op.destination === r.vault.address || op.nextAddress === r.vault.address || op.destination === op.nextAddress || this.address(op.nextRoot, r.coordinator) !== op.nextAddress || op.nextRoot === v.root) throw Error('Invalid operation destinations');
    if (r.kind === 'commit') {
      this.validateCoordinator(r.coordinatorSeed, v.coordinator);
      if (v.status !== 'available' && !(v.status === 'committed' && sameOperation(v.operation, op))) throw Error('Different or consumed intent');
      v.operation = structuredClone(op); v.status = 'committed'; this.wallet -= await this.fee('commit'); return;
    }
    if (v.status !== 'committed' || !sameOperation(v.operation, op)) throw Error('Replay, substitution or consumed key');
    if (!r.wotsSignature || !await verifyDigest(unhex(r.wotsSignature), await operationDigest(this.program, r.vault.address, v.root, v.coordinator, op, this.profile), unhex(v.root))) throw Error('Required Winternitz signature missing or invalid');
    const remainder = v.balance - rent - BigInt(op.amount);
    if (remainder < 0n || this.wallet < rent + await this.fee('withdraw')) throw Error('Insufficient balance / rent');
    if (this.vaults.has(op.nextAddress)) throw Error('Replacement already initialized');
    this.vaults.set(op.nextAddress, { status: 'available', root: op.nextRoot, coordinator: v.coordinator, balance: rent + remainder, rent });
    this.recipients.set(op.destination, (this.recipients.get(op.destination) ?? 0n) + BigInt(op.amount));
    v.status = 'consumed'; v.balance = rent; this.wallet -= rent + await this.fee('withdraw');
  }
}
export async function setup() {
  const store = new MemoryStore(), chain = new ModelChain(), engine = new Engine(store, chain, PASSWORD);
  await engine.create(); const initialBackup = await engine.exportBackup(); await engine.verifyBackup(initialBackup, PASSWORD);
  await engine.createOnChain(); await engine.deposit(1_000_000_000n);
  return { store, chain, engine, initialBackup };
}
export async function prepared(engine: Engine, amount = 250_000_000n) {
  await engine.prepareWithdrawal(amount, RECIPIENT); const backup = await engine.exportBackup(); await engine.verifyBackup(backup, PASSWORD); return backup;
}
