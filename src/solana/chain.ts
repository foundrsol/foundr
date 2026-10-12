import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { base58, b64, equal, from64, hex, sha256, unhex, utf8 } from '../core/bytes.ts';
import { ACCOUNT_SIZE, assertNetwork, authorizationContext, encodeOperation, type AuthorizationProfile, type Cluster, type Operation, type VaultState } from '../core/protocol.ts';
import type { Attempt, Chain, Kind, Request, Stage } from '../core/engine.ts';
import { buildTransactionInstructions, activationFeeInstruction } from './instructions.ts';
import { activationPlatformFee, PLATFORM_FEE_RECIPIENT } from '../core/platform-fee.ts';
import { initialDiagnostics, publicDiagnostics, rpcForProfile, rpcTransportForProfile, MAINNET_DEPLOY_RPC, type DevnetDiagnostics } from './network.ts';
import { mainnetReleaseAuthorized, type ExperimentalLaunch } from './release.ts';
export type MainnetSmoke = { payer: string; recipient: string; vaults: [string, string, string]; depositLamports: string; partialLamports: string; signatures: [string, string, string, string, string, string] };
export type MainnetRelease = { status: 'review-required' | 'deployment-required' | 'smoke-test-required' | 'ready' | 'experimental-ready'; securityReview: { status: 'pending' | 'verified'; reportUrl: string | null; reportSha256: string | null; reviewedBinarySha256: string | null; reviewedSourceSha256: string | null }; experimentalLaunch?: ExperimentalLaunch; compiledTestsPassed: boolean; sourceSha256: string | null; smoke: MainnetSmoke | null };
export type Deployment = { cluster: string; genesis: string; authorizationProfile?: AuthorizationProfile; programId: string; verified: boolean; binarySha256: string | null; binarySize: number | null; programData: string | null; upgradeAuthority: string | null; deploymentSlot: number | null; deploymentSignature: string | null; upstreamCommit: string; mainnetRelease?: MainnetRelease; note?: string };
export interface WalletProvider { publicKey: PublicKey | null; connect(): Promise<{ publicKey: PublicKey }>; disconnect(): Promise<void>; signTransaction(transaction: Transaction): Promise<Transaction>; on?(event: string, callback: (...args: unknown[]) => void): void; off?(event: string, callback: (...args: unknown[]) => void): void }
const safe = (n: number): bigint => { if (!Number.isSafeInteger(n) || n < 0) throw Error('RPC lamports are outside the safe integer range'); return BigInt(n); };
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export class SolanaChain implements Chain {
  public readonly profile: AuthorizationProfile;
  public program: string;
  public connection: Connection;
  public deployment: Deployment;
  public wallet?: WalletProvider;
  public diagnostics: DevnetDiagnostics;
  private diagnosticSink?: (value: DevnetDiagnostics) => void;
  private lastDiagnostic: string | undefined;
  private verifiedSmoke: string | null = null;
  historyConnection: Connection;
  constructor(deployment: Deployment, endpoint?: string, wallet?: WalletProvider, diagnosticSink?: (value: DevnetDiagnostics) => void) {
    this.deployment = deployment; this.wallet = wallet;
    this.profile = deployment.authorizationProfile ?? 'devnet-v1'; authorizationContext(this.profile);
    const expectedEndpoint = rpcForProfile(this.profile); endpoint ??= expectedEndpoint;
    if (endpoint !== expectedEndpoint) throw Error(`SHELL uses only the pinned ${expectedEndpoint} RPC for this authorization profile. Endpoint overrides are disabled.`);
    this.program = deployment.programId;
    this.diagnostics = initialDiagnostics(this.program, deployment.verified, this.profile); this.diagnosticSink = diagnosticSink;
    this.connection = new Connection(endpoint, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: (url, init) => {
      if (String(url) !== expectedEndpoint) throw Error('Unexpected RPC destination; request blocked.');
      const transport = rpcTransportForProfile(this.profile);
      if (transport !== this.diagnostics.rpcTransportEndpoint) throw Error('RPC transport changed; reload and verify before signing.');
      return fetch(transport, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    } });
    const historyTransport = typeof window !== 'undefined' ? new URL('/api/mainnet-history', window.location.origin).href : MAINNET_DEPLOY_RPC;
    this.historyConnection = this.profile === 'mainnet-v2' ? new Connection(MAINNET_DEPLOY_RPC, { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: (url, init) => {
      if (String(url) !== MAINNET_DEPLOY_RPC) throw Error('Unexpected history RPC destination');
      const body = JSON.parse(String(init?.body));
      if (!['getGenesisHash', 'getSignatureStatuses', 'getTransaction'].includes(body.method)) throw Error('History RPC is read-only');
      return fetch(historyTransport, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    } }) : this.connection;
    this.updateDiagnostics({});
  }
  private updateDiagnostics(change: Partial<DevnetDiagnostics>): void {
    Object.assign(this.diagnostics, change);
    const value = publicDiagnostics(this.diagnostics);
    const serialized = JSON.stringify(value); if (serialized === this.lastDiagnostic) return;
    this.lastDiagnostic = serialized;
    console.info(this.profile === 'devnet-v1' ? '[SHELL devnet diagnostics]' : '[SHELL mainnet diagnostics]', value);
    this.diagnosticSink?.(value);
  }
  reportWallet(publicKey: string | null, provider: string | null): void {
    this.updateDiagnostics({ walletPublicKey: publicKey, walletProvider: provider });
  }
  async verifyRpc(): Promise<void> {
    if (this.diagnostics.rpcStatus === 'unchecked') this.updateDiagnostics({ rpcStatus: 'checking' });
    let genesis: string;
    try { genesis = await this.connection.getGenesisHash(); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown RPC transport failure';
      this.updateDiagnostics({ rpcStatus: 'unavailable', rpcCause: `${this.profile === 'mainnet-v2' ? 'Mainnet' : 'Devnet'} RPC could not be verified: ${message}` });
      throw Error(this.diagnostics.rpcCause!);
    }
    this.updateDiagnostics({ rpcGenesis: genesis });
    try { assertNetwork(genesis, this.profile); }
    catch (error) { this.updateDiagnostics({ rpcStatus: 'mismatch', rpcCause: (error as Error).message }); throw error; }
    this.updateDiagnostics({ rpcStatus: 'verified', rpcCause: null });
  }
  async validateDeployment(): Promise<void> {
    const d = this.deployment;
    const context = authorizationContext(this.profile);
    await this.verifyRpc();
    if (d.cluster !== context.cluster || d.genesis !== context.genesis || d.programId !== this.program) {
      this.updateDiagnostics({ deploymentStatus: 'invalid', deploymentCause: `Deployment manifest mismatch: expected ${context.cluster} / ${context.genesis}; received ${d.cluster} / ${d.genesis}. RPC verification passed separately.` }); throw Error(this.diagnostics.deploymentCause!);
    }
    let program;
    try { program = await this.connection.getAccountInfo(new PublicKey(this.program), 'finalized'); }
    catch (error) { this.updateDiagnostics({ deploymentStatus: 'unavailable', deploymentCause: `Program-account inspection failed: ${(error as Error).message}` }); throw error; }
    if (!program) { this.updateDiagnostics({ deploymentStatus: 'missing', deploymentCause: `No SHELL program account exists at ${this.program} on verified ${context.cluster}. Funding and on-chain signing are disabled.` }); throw Error(this.diagnostics.deploymentCause!); }
    if (!program.executable || !program.owner.equals(LOADER) || program.data.length !== 36 || program.data.readUInt32LE(0) !== 2) {
      this.updateDiagnostics({ deploymentStatus: 'invalid', deploymentCause: 'The configured address is not the expected executable vault program.' }); throw Error(this.diagnostics.deploymentCause!);
    }
    if (d.verified !== true || !d.binarySha256 || !d.binarySize || !d.programData) {
      this.updateDiagnostics({ deploymentStatus: 'unverified', deploymentCause: 'A program account exists, but source-matched deployment and security verification are incomplete. Funding is disabled.' }); throw Error(this.diagnostics.deploymentCause!);
    }
    // A routine recheck must not toggle a verified UI gate and retrigger its
    // own fee-preview effect. Every signing/broadcast path still awaits the
    // complete check; any failure immediately clears the verified status.
    if (this.diagnostics.deploymentStatus !== 'verified') this.updateDiagnostics({ deploymentStatus: 'checking', deploymentCause: null });
    try {
    if (!Number.isSafeInteger(d.binarySize) || d.binarySize <= 0 || !/^[0-9a-f]{64}$/.test(d.binarySha256) || !Number.isSafeInteger(d.deploymentSlot) || d.deploymentSlot! < 0 || d.upstreamCommit !== '672fc6789b1532ee680f24842d235e0be8737b61') throw Error('Deployment attestation has invalid build provenance.');
    const address = new PublicKey(program.data.subarray(4));
    if (address.toBase58() !== d.programData) throw Error('ProgramData differs from the pinned deployment');
    const data = await this.connection.getAccountInfo(address, 'finalized');
    if (!data || !data.owner.equals(LOADER) || data.data.length < 45 + d.binarySize || data.data.readUInt32LE(0) !== 3) throw Error('Invalid deployment data');
    const option = data.data[12]; if (option !== 0 && option !== 1) throw Error('Invalid upgrade authority');
    const authority = option === 1 ? new PublicKey(data.data.subarray(13, 45)).toBase58() : null;
    if (authority !== d.upgradeAuthority || Number(data.data.readBigUInt64LE(4)) !== d.deploymentSlot) throw Error('Program authority or deployment slot changed. All signing is blocked.');
    if (hex(await sha256(data.data.subarray(45, 45 + d.binarySize))) !== d.binarySha256 || data.data.subarray(45 + d.binarySize).some(v => v !== 0)) throw Error('Deployed bytecode differs from the pinned prototype build');
    if (this.profile === 'mainnet-v2' && (authority !== null || !data.data.subarray(45, 45 + d.binarySize).includes(Buffer.from(utf8(context.tag))) || !data.data.subarray(45, 45 + d.binarySize).includes(Buffer.from(utf8(context.domain))))) throw Error('Mainnet requires the separate mainnet-v2 binary and an immutable program with no upgrade authority.');
    if (this.profile === 'devnet-v1') this.updateDiagnostics({ deploymentStatus: 'verified', deploymentCause: null });
    else if (this.diagnostics.deploymentStatus !== 'verified') this.updateDiagnostics({ deploymentStatus: 'unverified', deploymentCause: 'Immutable Mainnet bytecode verified. Release authorization and finalized lifecycle checks are still required.' });
    } catch (error) { this.updateDiagnostics({ deploymentStatus: 'invalid', deploymentCause: (error as Error).message }); throw error; }
  }
  async validate(): Promise<void> {
    await this.validateDeployment();
    if (this.profile === 'mainnet-v2') {
      const release = this.deployment.mainnetRelease;
      if (!mainnetReleaseAuthorized(this.deployment) || !release?.smoke) {
        this.updateDiagnostics({ deploymentStatus: 'unverified', deploymentCause: 'Mainnet launch checks are incomplete: an immutable verified deployment, exact-build release authorization and finalized lifecycle verification are required. Funding is disabled.' });
        throw Error(this.diagnostics.deploymentCause!);
      }
      try {
        const fingerprint = JSON.stringify([this.deployment.binarySha256, release]);
        if (this.verifiedSmoke !== fingerprint) { await this.verifyMainnetSmoke(release.smoke); this.verifiedSmoke = fingerprint; }
        this.updateDiagnostics({ deploymentStatus: 'verified', deploymentCause: null });
      } catch (error) { this.updateDiagnostics({ deploymentStatus: 'unverified', deploymentCause: `Mainnet lifecycle verification failed: ${(error as Error).message}. Funding is disabled.` }); throw Error(this.diagnostics.deploymentCause!); }
    }
  }
  // Read-only owner verification; it cannot set public funding to verified or
  // bypass validate() on any wallet transaction/signing path.
  async inspectMainnetLifecycle(proof: MainnetSmoke): Promise<void> {
    if (this.profile !== 'mainnet-v2') throw Error('Mainnet lifecycle verification requires the Mainnet-v2 profile');
    await this.validateDeployment();
    await this.verifyMainnetSmoke(proof);
  }
  private async verifyMainnetSmoke(proof: MainnetSmoke): Promise<void> {
    if (proof.vaults.length !== 3 || proof.signatures.length !== 6 || new Set(proof.signatures).size !== 6 || new Set(proof.vaults).size !== 3) throw Error('Expected six distinct lifecycle transactions and three distinct shells');
    const deposit = BigInt(proof.depositLamports), partial = BigInt(proof.partialLamports);
    if (partial <= 0n || deposit <= partial) throw Error('Invalid lifecycle amounts');
    const payer = new PublicKey(proof.payer), recipient = new PublicKey(proof.recipient);
    if (payer.equals(recipient)) throw Error('Lifecycle recipient must be a separate disposable address');
    const vaults = await Promise.all(proof.vaults.map(v => this.vault(v)));
    if (vaults.some(v => !v) || vaults[0]!.status !== 'consumed' || vaults[1]!.status !== 'consumed' || vaults[2]!.status !== 'available') throw Error('Partial/full rotation states are not finalized');
    for (let n = 0; n < 2; n++) {
      const a = vaults[n]!, b = vaults[n + 1]!;
      if (a.coordinator !== b.coordinator || a.operation?.amount !== (n === 0 ? partial : deposit - partial).toString() || a.operation.destination !== proof.recipient || a.operation.nextAddress !== proof.vaults[n + 1] || a.operation.nextRoot !== b.root) throw Error('Permanent lifecycle commitments do not match the release evidence');
    }
    assertNetwork(await this.historyConnection.getGenesisHash(), 'mainnet-v2');
    const tags = [0, 1, 2, 3, 2, 3], indices = [0, 0, 0, 0, 1, 1];
    for (let n = 0; n < 6; n++) {
      const status = (await this.historyConnection.getSignatureStatuses([proof.signatures[n]], { searchTransactionHistory: true })).value[0];
      if (!status || status.err || status.confirmationStatus !== 'finalized') throw Error(`Lifecycle transaction ${n + 1} is not finalized successfully`);
      const tx = await this.historyConnection.getTransaction(proof.signatures[n], { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
      if (!tx?.meta || tx.meta.err || tx.slot < this.deployment.deploymentSlot!) throw Error('Missing or invalid finalized lifecycle transaction');
      const message = tx.transaction.message, keys = message.getAccountKeys();
      if (!keys.get(0)?.equals(payer)) throw Error('Unexpected lifecycle fee payer');
      const instructions = message.compiledInstructions;
      const tag = tags[n];
      const calls = instructions.filter(ix => keys.get(ix.programIdIndex)?.toBase58() === this.program);
      const payments = instructions.filter(ix => keys.get(ix.programIdIndex)?.equals(SystemProgram.programId));
      if (payments.length > 1 || payments.some(ix => {
        const bytes = Buffer.from(ix.data);
        return tag !== 0 || bytes.length !== 12 || bytes.readUInt32LE(0) !== 2 || bytes.readBigUInt64LE(4) !== activationPlatformFee(this.profile) || ix.accountKeyIndexes.length !== 2 || !keys.get(ix.accountKeyIndexes[0])?.equals(payer) || keys.get(ix.accountKeyIndexes[1])?.toBase58() !== PLATFORM_FEE_RECIPIENT;
      })) throw Error('Unexpected lifecycle activation payment');
      if (calls.length !== 1 || instructions.some(ix => !keys.get(ix.programIdIndex)?.equals(new PublicKey(this.program)) && !keys.get(ix.programIdIndex)?.equals(ComputeBudgetProgram.programId) && !keys.get(ix.programIdIndex)?.equals(SystemProgram.programId))) throw Error('Unexpected lifecycle instructions');
      const ix = calls[0], bytes = Buffer.from(ix.data);
      if (bytes[0] !== tag || keys.get(ix.accountKeyIndexes[tag === 0 ? 2 : 1])?.toBase58() !== proof.vaults[indices[n]]) throw Error('Lifecycle operation or vault mismatch');
      if (tag === 1 && (bytes.length !== 9 || bytes.readBigUInt64LE(1) !== deposit)) throw Error('Lifecycle deposit mismatch');
      if (tag === 1) {
        const key = ix.accountKeyIndexes[1];
        if (safe(tx.meta.postBalances[key]) - safe(tx.meta.preBalances[key]) !== deposit) throw Error('Lifecycle deposit balance mismatch');
      }
      if ((tag === 2 || tag === 3) && hex(bytes.subarray(1, 106)) !== hex(encodeOperation(vaults[indices[n]]!.operation!))) throw Error('Lifecycle commitment/withdrawal mismatch');
      if (tag === 3 && (bytes.length !== 874 || keys.get(ix.accountKeyIndexes[2])?.toBase58() !== proof.recipient || keys.get(ix.accountKeyIndexes[3])?.toBase58() !== proof.vaults[indices[n] + 1])) throw Error('Lifecycle withdrawal destination mismatch');
      if (tag === 3) {
        const old = ix.accountKeyIndexes[1], to = ix.accountKeyIndexes[2], next = ix.accountKeyIndexes[3];
        const amount = BigInt(vaults[indices[n]]!.operation!.amount), remaining = n === 3 ? deposit - partial : 0n;
        const retainedRent = safe(tx.meta.postBalances[old]);
        if (safe(tx.meta.postBalances[to]) - safe(tx.meta.preBalances[to]) !== amount || safe(tx.meta.postBalances[next]) - retainedRent !== remaining) throw Error('Lifecycle withdrawal/rotation balances do not match');
        // Public System transfers can add SOL after this proof completed.
        // Verify the historical empty shell, not a donation-sensitive current
        // balance that anybody could change to disable a verified release.
        if (vaults[indices[n]]!.balance < retainedRent || vaults[indices[n] + 1]!.balance < retainedRent) throw Error('Permanent lifecycle rent records are inconsistent');
      }
    }
  }
  address(root: string, coordinator: string): string {
    return PublicKey.findProgramAddressSync([Buffer.from(utf8('shell')), Buffer.from(unhex(root, 32)), new PublicKey(coordinator).toBuffer()], new PublicKey(this.program))[0].toBase58();
  }
  validateCoordinator(seed: string, coordinator: string): void {
    if (Keypair.fromSeed(unhex(seed, 32)).publicKey.toBase58() !== coordinator) throw Error('Recovery coordination key is inconsistent');
  }
  async vault(address: string): Promise<VaultState | null> {
    const info = await this.connection.getAccountInfo(new PublicKey(address), 'finalized'); if (!info) return null;
    // Anyone can pre-fund a public PDA. The program safely allocates/assigns
    // an empty System account and tops up rent; it is not a protected vault
    // until that initialization is finalized. Existing program records must
    // still pass the exact owner/version/layout checks below.
    if (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0) return null;
    if (!info.owner.equals(new PublicKey(this.program)) || info.data.length !== ACCOUNT_SIZE || info.data[0] !== authorizationContext(this.profile).accountVersion || info.data[1] > 2) throw Error('Unexpected vault account owner or layout');
    const root = hex(info.data.subarray(3, 35)), coordinator = new PublicKey(info.data.subarray(35, 67)).toBase58();
    if (this.address(root, coordinator) !== address) throw Error('Vault PDA does not match its stored identity');
    const [_, bump] = PublicKey.findProgramAddressSync([Buffer.from(utf8('shell')), Buffer.from(unhex(root)), new PublicKey(coordinator).toBuffer()], new PublicKey(this.program));
    if (bump !== info.data[2]) throw Error('Invalid vault PDA bump');
    let operation: Operation | undefined;
    if (info.data[1] > 0) {
      const op = info.data.subarray(67);
      if (op[0] !== 1) throw Error('Unsupported committed operation');
      operation = { version: 1, amount: op.readBigUInt64LE(1).toString(), destination: new PublicKey(op.subarray(9, 41)).toBase58(), nextAddress: new PublicKey(op.subarray(41, 73)).toBase58(), nextRoot: hex(op.subarray(73, 105)) };
    }
    return { status: (['available', 'committed', 'consumed'] as const)[info.data[1]], root, coordinator, operation, balance: safe(info.lamports), rent: await this.rent() };
  }
  async rent(): Promise<bigint> { return safe(await this.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, 'finalized')); }
  // A direct transfer can arrive before initialization. Keep it separate from
  // protected funds; only an empty System account can be allocated by create.
  async uninitializedBalance(address: string): Promise<bigint | null> {
    const info = await this.connection.getAccountInfo(new PublicKey(address), 'finalized');
    if (!info) return 0n;
    if (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0) return safe(info.lamports);
    return null;
  }
  async initializationRent(address: string): Promise<bigint> {
    const balance = await this.uninitializedBalance(address);
    if (balance === null) throw Error('Activation address is already initialized or has an unexpected owner. Refresh before continuing.');
    const rent = await this.rent();
    return balance >= rent ? 0n : rent - balance;
  }
  private payer(): PublicKey { if (!this.wallet?.publicKey) throw Error(`Connect Phantom or Solflare to pay ${authorizationContext(this.profile).cluster} transaction fees`); return new PublicKey(this.wallet.publicKey.toBase58()); }
  async walletBalance(): Promise<bigint> { return safe(await this.connection.getBalance(this.payer(), 'finalized')); }
  async fee(kind: Kind): Promise<bigint> {
    const payer = this.payer(), block = await this.connection.getLatestBlockhash('finalized');
    const tx = new Transaction({ feePayer: payer, ...block });
    const keys = [{ pubkey: payer, isSigner: true, isWritable: true }];
    if (kind === 'create' || kind === 'commit' || kind === 'authorization') keys.push({ pubkey: new PublicKey(new Uint8Array(32).fill(7)), isSigner: true, isWritable: false });
    if (kind === 'withdraw') tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }));
    tx.add(new TransactionInstruction({ programId: new PublicKey(this.program), keys, data: Buffer.alloc(0) }));
    if (kind === 'create') { const payment = activationFeeInstruction(payer, this.profile); if (payment) tx.add(payment); }
    const quote = await this.connection.getFeeForMessage(tx.compileMessage(), 'finalized');
    if (quote.value === null) throw Error('RPC could not quote transaction fees'); return safe(quote.value);
  }
  async transaction(request: Request): Promise<Omit<Attempt, 'state' | 'kind' | 'address'>> {
    await this.validate(); const payer = this.payer(), block = await this.connection.getLatestBlockhash('finalized');
    if (typeof this.wallet?.signTransaction !== 'function') throw Error('This wallet does not support signing without submission. SHELL requires signTransaction so that only the verified RPC for this identity submits transactions.');
    const tx = new Transaction({ feePayer: payer, ...block });
    if (request.kind === 'withdraw') tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }));
    tx.add(...buildTransactionInstructions(new PublicKey(this.program), request, payer, this.profile));
    const quote = await this.connection.getFeeForMessage(tx.compileMessage(), 'finalized'); if (quote.value === null) throw Error('Fee quote unavailable');
    const costs = safe(quote.value) + (request.kind === 'create' ? await this.initializationRent(request.vault.address) + activationPlatformFee(this.profile) : request.kind === 'withdraw' ? await this.rent() : request.amount ?? 0n);
    if (await this.walletBalance() < costs) throw Error(request.kind === 'create' && activationPlatformFee(this.profile) > 0n ? 'Connected wallet cannot cover the activation platform fee, exact transaction fee and account rent' : 'Connected wallet cannot cover the exact transaction fee and account rent');
    if (request.kind === 'create' || request.kind === 'commit') tx.partialSign(Keypair.fromSeed(unhex(request.coordinatorSeed, 32)));
    const intended = tx.serializeMessage();
    const signed = await this.wallet!.signTransaction(tx);
    if (!equal(intended, signed.serializeMessage()) || !signed.verifySignatures()) throw Error('Wallet returned a substituted or incompletely signed transaction. Nothing was submitted.');
    const raw = signed.serialize(); if (raw.length > 1232) throw Error(`Transaction exceeds Solana’s packet limit (${raw.length} bytes)`);
    return { signature: base58(signed.signature!), raw: b64(raw), lastValidBlockHeight: block.lastValidBlockHeight };
  }
  async broadcast(a: Attempt): Promise<string> {
    await this.validate();
    return this.connection.sendRawTransaction(from64(a.raw), { skipPreflight: false, maxRetries: 0, preflightCommitment: 'finalized' });
  }
  async outcome(a: Attempt): Promise<{ state: Stage; error?: string }> {
    try {
      const status = (await this.connection.getSignatureStatuses([a.signature], { searchTransactionHistory: true })).value[0];
      if (status?.confirmationStatus === 'finalized') return status.err ? { state: 'failed', error: a.kind === 'create' ? 'Vault activation failed. No platform fee was collected. Solana may still charge its transaction fee.' : 'On-chain transaction failed. The one-time operation remains bound; its amount and destinations cannot change.' } : { state: 'confirmed' };
      if (status) return { state: 'confirming' };
      // Finalized height must pass the blockhash validity window before a new
      // outer transaction is allowed. The signature itself never changes.
      if (await this.connection.getBlockHeight('finalized') > a.lastValidBlockHeight) return { state: 'expired' };
      return { state: 'outcome unknown' };
    } catch { return { state: 'outcome unknown', error: 'RPC timeout. Confirmation has not been established.' }; }
  }
}
export const explorer = (signature: string, cluster: Cluster = 'devnet') => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
export const addressExplorer = (address: string, cluster: Cluster = 'devnet') => `https://explorer.solana.com/address/${encodeURIComponent(address)}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
