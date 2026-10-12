import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { address, getTransactionDecoder, getBase58Encoder, lamports, signature } from '@solana/kit';
import { Connection, PublicKey, Keypair, Transaction, type TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, MINT_SIZE, ACCOUNT_SIZE as TOKEN_SIZE, createInitializeMint2Instruction, createInitializeAccount3Instruction, createMintToInstruction, createSyncNativeInstruction, NATIVE_MINT } from '@solana/spl-token';
import { DEVNET_GENESIS } from '../src/core/protocol.ts';
import { base58, b64, from64 } from '../src/core/bytes.ts';
import { ProtocolClient, PROTOCOL_ID, VAULT_ID, type ProtocolDeployment } from '../src/protocol/client.ts';
export const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const txSignature = (tx: Transaction) => base58(tx.signature!);
export function info(svm: LiteSVM, key: PublicKey) {
  const value = svm.getAccount(address(key.toBase58()));
  return value.exists ? { owner: new PublicKey(value.programAddress), data: Buffer.from(value.data), lamports: Number(value.lamports), executable: value.executable } : null;
}
export function runtimeConnection(svm: LiteSVM): Connection {
  const signatures: { signature: string; addresses: string[] }[] = [];
  const transactions = new Map<string, { tx: Transaction; preBalances: number[]; postBalances: number[] }>();
  return {
    getAccountInfo: async (key: PublicKey) => info(svm, key),
    getMinimumBalanceForRentExemption: async (n: number) => Number(svm.minimumBalanceForRentExemption(BigInt(n))),
    getGenesisHash: async () => DEVNET_GENESIS,
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(k => info(svm, k)),
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: { slot: Number(svm.getClock().slot) }, value: keys.map(k => info(svm, k)) }),
    getSlot: async () => Number(svm.getClock().slot),
    getBlockTime: async () => Number(svm.getClock().unixTimestamp),
    getProgramAccounts: async (program: PublicKey, config?: { filters?: { memcmp?: { offset: number; bytes: string } }[] }) => {
      // Anchor discriminators are eight bytes, not 32-byte Solana addresses.
      const base58Codec = getBase58Encoder();
      return svm.getProgramAccounts(address(program.toBase58())).filter(a => (config?.filters ?? []).every(f => !f.memcmp || Buffer.from(a.data).subarray(f.memcmp.offset, f.memcmp.offset + base58Codec.encode(f.memcmp.bytes).length).equals(Buffer.from(base58Codec.encode(f.memcmp.bytes))))).map(a => ({ pubkey: new PublicKey(a.address), account: info(svm, new PublicKey(a.address))! }));
    },
    getSignaturesForAddress: async (key: PublicKey) => signatures.filter(r => r.addresses.includes(key.toBase58())).map(r => ({ signature: r.signature, slot: Number(svm.getClock().slot), err: null, memo: null, blockTime: Number(svm.getClock().unixTimestamp), confirmationStatus: 'finalized' })),
    getBalance: async (key: PublicKey) => Number(svm.getBalance(address(key.toBase58())) ?? 0n),
    getLatestBlockhash: async () => { svm.expireBlockhash(); return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000 }; },
    getFeeForMessage: async (msg: { header: { numRequiredSignatures: number } }) => ({ context: { slot: 1 }, value: msg.header.numRequiredSignatures * 5000 }),
    sendRawTransaction: async (bytes: Uint8Array) => {
      const tx = Transaction.from(bytes), keys = tx.compileMessage().accountKeys;
      const preBalances = keys.map(k => Number(svm.getBalance(address(k.toBase58())) ?? 0n));
      const result = svm.sendTransaction(getTransactionDecoder().decode(bytes));
      if (result instanceof FailedTransactionMetadata) throw Error(`SBF rejected: ${result.err()}\n${result.meta().logs().join('\n')}`);
      signatures.push({ signature: txSignature(tx), addresses: tx.compileMessage().accountKeys.map(k => k.toBase58()) });
      transactions.set(txSignature(tx), { tx, preBalances, postBalances: keys.map(k => Number(svm.getBalance(address(k.toBase58())) ?? 0n)) });
      return txSignature(tx);
    },
    getTransaction: async (sig: string) => {
      const value = transactions.get(sig); if (!value) return null;
      return { slot: 1, blockTime: Number(svm.getClock().unixTimestamp), version: 'legacy', transaction: { message: value.tx.compileMessage(), signatures: value.tx.signatures.map(s => base58(s.signature!)) }, meta: { err: null, fee: value.tx.compileMessage().header.numRequiredSignatures * 5000, preBalances: value.preBalances, postBalances: value.postBalances, innerInstructions: [], logMessages: [], preTokenBalances: [], postTokenBalances: [], rewards: [] } };
    },
    simulateTransaction: async (tx: Transaction) => {
      const decoded = getTransactionDecoder().decode(tx.serialize()), result = svm.simulateTransaction(decoded);
      return { context: { slot: Number(svm.getClock().slot) }, value: { err: result instanceof FailedTransactionMetadata ? 'program rejected simulation' : null, logs: result instanceof FailedTransactionMetadata ? result.meta().logs() : result.meta().logs() } };
    },
    getSignatureStatuses: async (sigs: string[]) => ({ value: sigs.map(s => {
      const tx = svm.getTransaction(signature(s)); return tx ? { confirmationStatus: 'finalized', err: tx instanceof FailedTransactionMetadata ? 'program failed' : null } : null;
    }) }),
    getBlockHeight: async () => 1,
  } as unknown as Connection;
}
export function manifest(programId: PublicKey): ProtocolDeployment {
  return { cluster: 'devnet', genesis: DEVNET_GENESIS, programId: programId.toBase58(), verified: false, binarySha256: null, binarySize: null, programData: null, upgradeAuthority: null, deploymentSlot: null, deploymentSignature: null, upstreamCommit: '672fc6789b1532ee680f24842d235e0be8737b61', idlSha256: null, shellMint: null, quoteMint: null, admins: [], treasuryRecipient: null, testPoolOnly: true };
}
export async function runtime() {
  const svm = new LiteSVM().withNativeMints(), admins = [Keypair.generate(), Keypair.generate(), Keypair.generate()], stranger = Keypair.generate(), treasury = Keypair.generate();
  for (const key of [...admins, stranger, treasury]) svm.airdrop(address(key.publicKey.toBase58()), lamports(100_000_000_000n));
  svm.addProgram(address(VAULT_ID.toBase58()), new Uint8Array(await readFile('program/target/deploy/shell_vault.so')));
  svm.addProgram(address(PROTOCOL_ID.toBase58()), new Uint8Array(await readFile('protocol/target/deploy/shell_protocol.so')));
  // Explicit local loader fixture ONLY. Supply an upgrade authority to exercise
  // the initializer's actual checks. No fabricated user/token/vault balances.
  const programData = PublicKey.findProgramAddressSync([PROTOCOL_ID.toBuffer()], LOADER)[0];
  const bytes = await readFile('protocol/target/deploy/shell_protocol.so'), data = Buffer.alloc(45 + bytes.length);
  data.writeUInt32LE(3); data.writeBigUInt64LE(1n, 4); data[12] = 1; admins[0].publicKey.toBuffer().copy(data, 13); bytes.copy(data, 45);
  const program = Buffer.alloc(36); program.writeUInt32LE(2); programData.toBuffer().copy(program, 4);
  svm.setAccount({ address: address(programData.toBase58()), executable: false, lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))), programAddress: address(LOADER.toBase58()), data, space: BigInt(data.length) });
  svm.setAccount({ address: address(PROTOCOL_ID.toBase58()), executable: true, lamports: lamports(svm.minimumBalanceForRentExemption(36n)), programAddress: address(LOADER.toBase58()), data: program, space: BigInt(program.length) });
  const connection = runtimeConnection(svm), client = new ProtocolClient(manifest(PROTOCOL_ID)); client.connection = connection;
  // Local program execution is explicit; never confuse it with network attestation.
  client.validate = async () => client.config();
  async function send(ixs: TransactionInstruction[], signers = [admins[0]], expectFailure?: RegExp) {
    svm.expireBlockhash();
    const tx = new Transaction({ feePayer: signers[0].publicKey, recentBlockhash: svm.latestBlockhash() }).add(...ixs); tx.sign(...signers);
    const raw = tx.serialize(); assert.ok(raw.length <= 1232, `Actual signed packet is ${raw.length} bytes`);
    const result = svm.sendTransaction(getTransactionDecoder().decode(raw));
    if (expectFailure) { assert.ok(result instanceof FailedTransactionMetadata, 'The actual program must reject this transaction'); assert.match(`${result.err()} ${result.meta().logs().join('\n')}`, expectFailure); }
    else if (result instanceof FailedTransactionMetadata) assert.fail(`Real SBF failed: ${result.err()}\n${result.meta().logs().join('\n')}`);
    return { tx, result, raw: b64(raw), signature: txSignature(tx) };
  }
  async function mint(decimals = 6) {
    const key = Keypair.generate();
    await send([SystemProgram.createAccount({ fromPubkey: admins[0].publicKey, newAccountPubkey: key.publicKey, lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }), createInitializeMint2Instruction(key.publicKey, decimals, admins[0].publicKey, null)], [admins[0], key]);
    return key.publicKey;
  }
  async function tokenAccount(mint: PublicKey, owner = admins[0].publicKey, amount = 0n) {
    const key = Keypair.generate();
    await send([SystemProgram.createAccount({ fromPubkey: admins[0].publicKey, newAccountPubkey: key.publicKey, lamports: Number(svm.minimumBalanceForRentExemption(BigInt(TOKEN_SIZE))), space: TOKEN_SIZE, programId: TOKEN_PROGRAM_ID }), createInitializeAccount3Instruction(key.publicKey, mint, owner)], [admins[0], key]);
    if (amount > 0n) await send(mint.equals(NATIVE_MINT) ? [SystemProgram.transfer({ fromPubkey: admins[0].publicKey, toPubkey: key.publicKey, lamports: amount }), createSyncNativeInstruction(key.publicKey)] : [createMintToInstruction(mint, key.publicKey, admins[0].publicKey, amount)]);
    return key.publicKey;
  }
  return { svm, connection, client, admins, stranger, treasury, programData, send, mint, tokenAccount };
}
