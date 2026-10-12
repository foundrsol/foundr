import { BN, Program, type Idl } from '@anchor-lang/core';
import { Connection, PublicKey, SystemProgram, type AccountMeta, type TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, unpackMint, unpackAccount } from '@solana/spl-token';
import { Buffer } from 'buffer';
import idl from './idl.json' with { type: 'json' };
import { SolanaChain, type Deployment } from '../solana/chain.ts';
import { DEVNET_RPC } from '../solana/network.ts';
import { encodeOperation, type Operation } from '../core/protocol.ts';
import { unhex, u64, hex, sha256, utf8 } from '../core/bytes.ts';
import { validateRules, type FeeRules, type Service } from './fees.ts';

export const PROTOCOL_ID = new PublicKey(idl.address);
export const VAULT_ID = new PublicKey('H5dQjE5MxyTCcwVuDcrVH3yUTeP51t6CvBvg9T4FzPds');
export type ProtocolDeployment = Deployment & { idlSha256: string | null; shellMint: string | null; quoteMint: string | null; admins: string[]; treasuryRecipient: string | null; testPoolOnly: true };
export type PaidChoice = { service: Exclude<Service, 0>; maxFee: string; revision: string; program: string };
type AmountFields = 'nativeVolume' | 'nativeFees' | 'splFees' | 'nativeSpent' | 'splSpent' | 'nativeBought' | 'splBought' | 'burned' | 'nativeAllocated' | 'splAllocated' | 'nativeTreasuryAllocated' | 'splTreasuryAllocated' | 'settlementNonce' | 'treasuryNonce' | 'treasuryReleased' | 'splTreasuryNonce' | 'splTreasuryReleased';
type AddressFields = 'treasuryRecipient' | 'vaultProgram' | 'shellMint' | 'quoteMint' | 'nativeBuyback' | 'nativeTreasury' | 'splBuyback' | 'splTreasury' | 'burnAccount';
export type ProtocolConfig = Record<AmountFields, bigint> & Record<AddressFields, PublicKey> & {
  admins: PublicKey[]; fees: FeeRules; pendingFees: FeeRules; pendingAt: bigint; pendingApprovals: number; revision: bigint; bump: number; testPoolOnly: boolean;
};
export type ProtocolReceipt = { address: string; kind: number; payer: PublicKey; operation: PublicKey; asset: PublicKey; amount: bigint; fee: bigint; buyback: bigint; treasury: bigint; revision: bigint; service: number; timestamp: bigint; expiresAt: bigint; bought: bigint; burned: bigint; signature?: string };
export type ProtocolOperator = { address: string; owner: PublicKey; staked: bigint; unlockAt: bigint; actionNonce: bigint; eligible: boolean };
export type ProtocolSnapshot = { config: ProtocolConfig; slot: number; timestamp: bigint; shellDecimals: number; quoteDecimals: number; supply: bigint;
  nativeBuybackBalance: bigint; nativeTreasuryBalance: bigint; splBuybackBalance: bigint; splTreasuryBalance: bigint;
  native24h: bigint; spl24h: bigint; circulatingUpperBound: bigint; poolShellBalance: bigint; receipts: ProtocolReceipt[]; operators: ProtocolOperator[] };
const n = (value: unknown): bigint => { if (!(value instanceof BN)) throw Error('Unexpected protocol amount encoding'); return BigInt((value as BN).toString()); };
export const toAnchor = (rules: FeeRules) => Object.fromEntries(Object.entries(rules).map(([key, value]) => [key, typeof value === 'bigint' ? new BN(value.toString()) : value]));
const fromAnchor = (rules: Record<string, unknown>): FeeRules => Object.fromEntries(Object.entries(rules).map(([key, value]) => [key, value instanceof BN ? n(value) : value])) as FeeRules;
export function pda(seed: string, ...parts: Uint8Array[]): PublicKey { return PublicKey.findProgramAddressSync([Buffer.from(seed), ...parts.map(p => Buffer.from(p))], PROTOCOL_ID)[0]; }
export const configAddress = () => pda('config');
export const bankAddress = (name: string) => pda(name, configAddress().toBytes());
export const receiptAddress = (vault: PublicKey) => pda('receipt', vault.toBytes());
export const authorizationAddress = (vault: PublicKey) => pda('authorization', vault.toBytes());
export const subscriptionAddress = (payer: PublicKey, nonce: Uint8Array) => pda('subscription-receipt', payer.toBytes(), nonce);
export const settlementAddress = (nonce: bigint) => pda('settlement', configAddress().toBytes(), u64(nonce));
export const poolAddress = (mint: PublicKey) => pda('pool', configAddress().toBytes(), mint.toBytes());
export const operatorAddress = (owner: PublicKey) => pda('operator', configAddress().toBytes(), owner.toBytes());
export const solscan = (sig: string) => `https://solscan.io/tx/${encodeURIComponent(sig)}?cluster=devnet`;
export const solscanAddress = (key: string) => `https://solscan.io/account/${encodeURIComponent(key)}?cluster=devnet`;

export class ProtocolClient {
  connection: Connection; program: Program; verifier: SolanaChain; deployment: ProtocolDeployment;
  constructor(deployment: ProtocolDeployment) {
    if (deployment.programId !== PROTOCOL_ID.toBase58()) throw Error('Protocol deployment differs from the compiled Anchor IDL.');
    this.deployment = deployment; this.verifier = new SolanaChain(deployment, DEVNET_RPC); this.connection = this.verifier.connection;
    this.program = new Program(idl as Idl, { connection: this.connection });
  }
  // Public instruction builder; signing and submission are always explicit.
  async instruction(name: string, args: unknown[], accounts: Record<string, PublicKey>, remaining: AccountMeta[] = []): Promise<TransactionInstruction> {
    if (!this.program.idl.instructions.some(i => i.name === name)) throw Error('Unknown protocol instruction');
    return this.program.methods[name](...args).accountsStrict(accounts).remainingAccounts(remaining).instruction();
  }
  decodeConfig(data: Buffer): ProtocolConfig {
    const raw = this.program.coder.accounts.decode<Record<string, unknown>>('config', data);
    const result = { ...raw };
    for (const [key, value] of Object.entries(raw)) if (value instanceof BN) result[key] = n(value);
    result.fees = fromAnchor(raw.fees as Record<string, unknown>); result.pendingFees = fromAnchor(raw.pendingFees as Record<string, unknown>);
    const c = result as ProtocolConfig; validateRules(c.fees);
    if (!c.vaultProgram.equals(VAULT_ID) || c.admins.length !== 3 || new Set(c.admins.map(k => k.toBase58())).size !== 3 || !c.testPoolOnly) throw Error('Unexpected protocol configuration or settlement adapter');
    for (const key of ['nativeBuyback', 'nativeTreasury', 'splBuyback', 'splTreasury', 'burnAccount'] as const) {
      const seed = { nativeBuyback: 'native-buyback', nativeTreasury: 'native-treasury', splBuyback: 'spl-buyback', splTreasury: 'spl-treasury', burnAccount: 'burn' }[key];
      if (!c[key].equals(bankAddress(seed))) throw Error(`Incorrect protocol ${key} PDA`);
    }
    return c;
  }
  async config(): Promise<ProtocolConfig> {
    const info = await this.connection.getAccountInfo(configAddress(), 'finalized');
    if (!info || !info.owner.equals(PROTOCOL_ID)) throw Error('Protocol configuration has not been initialized on devnet');
    return this.decodeConfig(info.data);
  }
  async validate(): Promise<ProtocolConfig> {
    if (this.deployment.verified && this.deployment.idlSha256 !== hex(await sha256(utf8(JSON.stringify(idl))))) throw Error('The protocol deployment is not matched to this generated Anchor IDL');
    await this.verifier.validate();
    const c = await this.config(), d = this.deployment;
    if (!d.shellMint || !d.quoteMint || c.shellMint.toBase58() !== d.shellMint || c.quoteMint.toBase58() !== d.quoteMint || c.treasuryRecipient.toBase58() !== d.treasuryRecipient || c.admins.map(k => k.toBase58()).join(',') !== d.admins.join(',')) throw Error('Protocol mint, treasury or administrator configuration differs from the pinned deployment');
    return c;
  }
  paidInstruction(vault: PublicKey, op: Operation, signature: string, choice: PaidChoice, payer: PublicKey) {
    if (choice.program !== PROTOCOL_ID.toBase58()) throw Error('Paid operation targets an unexpected program');
    return this.instruction('paidVault', [choice.service, new BN(choice.maxFee), new BN(choice.revision)], {
      payer, config: configAddress(), nativeBuyback: bankAddress('native-buyback'), nativeTreasury: bankAddress('native-treasury'), receipt: receiptAddress(vault),
      authorization: authorizationAddress(vault),
      vault, recipient: new PublicKey(op.destination), nextVault: new PublicKey(op.nextAddress), vaultProgram: VAULT_ID, systemProgram: SystemProgram.programId,
    });
  }
  stageInstruction(vault: PublicKey, coordinator: PublicKey, signature: string, payer: PublicKey) {
    return this.instruction('stageAuthorization', [Array.from(unhex(signature, 768))], { payer, coordinator, vault, authorization: authorizationAddress(vault), systemProgram: SystemProgram.programId });
  }
  async settleInstruction(config: ProtocolConfig, quote: PublicKey, nonce: bigint, input: bigint, minimumOut: bigint, deadline: bigint, keeper: PublicKey) {
    const pool = poolAddress(quote);
    return this.instruction('settle', [new BN(nonce.toString()), new BN(input.toString()), new BN(minimumOut.toString()), new BN(deadline.toString())], {
      keeper, config: configAddress(), nativeBuyback: config.nativeBuyback, splBuyback: config.splBuyback,
      quoteMint: quote, shellMint: config.shellMint, pool, poolQuote: pda('pool-quote', pool.toBytes()), poolShell: pda('pool-shell', pool.toBytes()), burnAccount: config.burnAccount,
      receipt: settlementAddress(nonce), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    });
  }
  async snapshot(): Promise<ProtocolSnapshot> {
    const c = await this.validate();
    const keys = [c.shellMint, c.quoteMint, c.nativeBuyback, c.nativeTreasury, c.splBuyback, c.splTreasury];
    const batch = await this.connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'finalized' });
    if (batch.value.some(v => !v)) throw Error('Protocol accounting accounts are missing');
    const [sm, qm, nb, nt, sb, st] = batch.value;
    const shell = unpackMint(c.shellMint, sm!), quote = unpackMint(c.quoteMint, qm!);
    if (shell.decimals > 9 || quote.decimals > 9 || shell.freezeAuthority || quote.freezeAuthority) throw Error('Unsupported configured token mint');
    const sbToken = unpackAccount(c.splBuyback, sb!), stToken = unpackAccount(c.splTreasury, st!);
    if (!sbToken.mint.equals(c.quoteMint) || !stToken.mint.equals(c.quoteMint) || !sbToken.owner.equals(configAddress()) || !stToken.owner.equals(configAddress()) || !nb!.owner.equals(SystemProgram.programId) || nb!.data.length !== 0 || !nt!.owner.equals(PROTOCOL_ID)) throw Error('Incorrect accounting account owner or token mint');
    const [records, operatorAccounts, timestamp, bankRent, treasuryRent] = await Promise.all([
      this.connection.getProgramAccounts(PROTOCOL_ID, { commitment: 'finalized', filters: [{ memcmp: this.program.coder.accounts.memcmp('receipt') }] }),
      this.connection.getProgramAccounts(PROTOCOL_ID, { commitment: 'finalized', filters: [{ memcmp: this.program.coder.accounts.memcmp('operator') }] }),
      this.connection.getBlockTime(batch.context.slot), this.connection.getMinimumBalanceForRentExemption(nb!.data.length, 'finalized'), this.connection.getMinimumBalanceForRentExemption(nt!.data.length, 'finalized'),
    ]);
    if (timestamp === null) throw Error('Finalized snapshot time is unavailable');
    const now = BigInt(timestamp), receipts: ProtocolReceipt[] = records.map(row => {
      const raw = this.program.coder.accounts.decode<Record<string, unknown>>('receipt', row.account.data), r: Record<string, unknown> = { ...raw, address: row.pubkey.toBase58() };
      for (const [k, v] of Object.entries(raw)) if (v instanceof BN) r[k] = n(v);
      return r as ProtocolReceipt;
    }).sort((a, b) => a.timestamp > b.timestamp ? -1 : a.timestamp < b.timestamp ? 1 : a.address.localeCompare(b.address));
    const operators = operatorAccounts.map(row => {
      const r = this.program.coder.accounts.decode<{ config: PublicKey; owner: PublicKey; staked: BN; unlockAt: BN; actionNonce: BN }>('operator', row.account.data);
      if (!r.config.equals(configAddress())) throw Error('Unrelated operator record');
      return { address: row.pubkey.toBase58(), owner: r.owner, staked: n(r.staked), unlockAt: n(r.unlockAt), actionNonce: n(r.actionNonce), eligible: n(r.staked) >= c.fees.minimumStake };
    });
    let poolShellBalance = 0n;
    for (const mint of [NATIVE_MINT, c.quoteMint]) {
      const pool = poolAddress(mint), key = pda('pool-shell', pool.toBytes()), account = await this.connection.getAccountInfo(key, 'finalized');
      if (account) { const t = unpackAccount(key, account); if (!t.mint.equals(c.shellMint) || !t.owner.equals(pool)) throw Error('Invalid controlled pool token account'); poolShellBalance += t.amount; }
    }
    const locked = operators.reduce((s, o) => s + o.staked, 0n) + poolShellBalance;
    return { config: c, slot: batch.context.slot, timestamp: now, shellDecimals: shell.decimals, quoteDecimals: quote.decimals, supply: shell.supply,
      nativeBuybackBalance: BigInt(nb!.lamports) - BigInt(bankRent), nativeTreasuryBalance: BigInt(nt!.lamports) - BigInt(treasuryRent), splBuybackBalance: sbToken.amount, splTreasuryBalance: stToken.amount,
      native24h: receipts.filter(r => r.kind === 1 && r.timestamp > now - 86400n && r.timestamp <= now).reduce((s, r) => s + r.fee, 0n),
      spl24h: receipts.filter(r => r.kind === 2 && r.timestamp > now - 86400n && r.timestamp <= now).reduce((s, r) => s + r.fee, 0n),
      circulatingUpperBound: shell.supply > locked ? shell.supply - locked : 0n, poolShellBalance, receipts, operators };
  }
  async receiptSignature(key: string): Promise<string | undefined> {
    const rows = await this.connection.getSignaturesForAddress(new PublicKey(key), { limit: 20 }, 'finalized');
    return rows.find(row => row.err === null && row.confirmationStatus === 'finalized')?.signature;
  }
}
