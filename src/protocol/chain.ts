import { PublicKey, Transaction, Keypair, ComputeBudgetProgram } from '@solana/web3.js';
import { base58, b64, equal, hex, unhex, from64 } from '../core/bytes.ts';
import { encodeOperation } from '../core/protocol.ts';
import type { Attempt, Request, Kind } from '../core/engine.ts';
import { SolanaChain, type Deployment, type WalletProvider } from '../solana/chain.ts';
import { DEVNET_RPC, type DevnetDiagnostics } from '../solana/network.ts';
import { ProtocolClient, PROTOCOL_ID, authorizationAddress, type ProtocolDeployment } from './client.ts';
import { protocolFee } from './fees.ts';
export class ProtocolChain extends SolanaChain {
  protocol?: ProtocolClient;
  constructor(deployment: Deployment, protocolDeployment: ProtocolDeployment | null, wallet?: WalletProvider, sink?: (value: DevnetDiagnostics) => void) {
    super(deployment, DEVNET_RPC, wallet, sink);
    if (protocolDeployment) this.protocol = new ProtocolClient(protocolDeployment);
  }
  async authorizationRent(): Promise<bigint> {
    if (!this.protocol) throw Error('Protocol configuration is unavailable');
    return BigInt(await this.connection.getMinimumBalanceForRentExemption(this.protocol.program.coder.accounts.size('authorization'), 'finalized'));
  }
  async receiptRent(): Promise<bigint> {
    if (!this.protocol) throw Error('Protocol configuration is unavailable');
    return BigInt(await this.connection.getMinimumBalanceForRentExemption(this.protocol.program.coder.accounts.size('receipt'), 'finalized'));
  }
  async authorizationReady(request: Request): Promise<boolean> {
    if (!request.paid || !request.operation || !request.wotsSignature || !this.protocol) throw Error('Paid operation state is incomplete');
    await this.protocol.validate();
    const vault = new PublicKey(request.vault.address), key = authorizationAddress(vault);
    const account = await this.connection.getAccountInfo(key, 'finalized'); if (!account) return false;
    if (!account.owner.equals(PROTOCOL_ID)) throw Error('Authorization account has an unexpected owner');
    const r = this.protocol.program.coder.accounts.decode<{ vault: PublicKey; operation: number[]; signature: number[] }>('authorization', account.data);
    if (!r.vault.equals(vault) || !equal(new Uint8Array(r.operation), encodeOperation(request.operation)) || hex(new Uint8Array(r.signature)) !== request.wotsSignature) throw Error('The permanent public signature record differs from this backed-up operation. Signing stopped.');
    return true;
  }
  override async transaction(request: Request) {
    if (!request.paid && request.kind !== 'authorization') return super.transaction(request);
    await this.validate();
    const client = this.protocol, payer = this.wallet?.publicKey ? new PublicKey(this.wallet.publicKey.toBase58()) : null;
    if (!client || !request.paid || !payer || typeof this.wallet?.signTransaction !== 'function' || !request.operation || !request.wotsSignature) throw Error('Verified protocol, wallet and durable one-time authorization are required');
    const config = await client.validate();
    const isStage = request.kind === 'authorization';
    if (!isStage && request.kind !== 'withdraw') throw Error('Unsupported paid operation');
    const fee = protocolFee(BigInt(request.operation.amount), request.paid.service, config.fees);
    if (request.paid.program !== PROTOCOL_ID.toBase58() || request.paid.revision !== config.revision.toString() || fee > BigInt(request.paid.maxFee)) throw Error('The fee configuration changed or exceeds the backed-up approval. Resume only after explicitly reviewing the same operation.');
    const vault = new PublicKey(request.vault.address), block = await this.connection.getLatestBlockhash('finalized');
    const tx = new Transaction({ feePayer: payer, ...block });
    if (!isStage) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }));
    tx.add(isStage ? await client.stageInstruction(vault, new PublicKey(request.coordinator), request.wotsSignature, payer) : await client.paidInstruction(vault, request.operation, request.wotsSignature, request.paid, payer));
    const quoted = await this.connection.getFeeForMessage(tx.compileMessage(), 'finalized');
    if (quoted.value === null || !Number.isSafeInteger(quoted.value) || quoted.value < 0) throw Error('Exact network fee is unavailable');
    const costs = BigInt(quoted.value) + (isStage ? await this.authorizationRent() : await this.rent() + await this.receiptRent() + fee);
    if (await this.walletBalance() < costs) throw Error('Connected wallet cannot cover the protocol fee, network fee and permanent account rent');
    if (isStage) tx.partialSign(Keypair.fromSeed(unhex(request.coordinatorSeed, 32)));
    const intended = tx.serializeMessage(), signed = await this.wallet.signTransaction(tx);
    if (!equal(intended, signed.serializeMessage()) || !signed.verifySignatures()) throw Error('Wallet substituted the approved transaction. Nothing was submitted.');
    const raw = signed.serialize(); if (raw.length > 1232) throw Error('Protocol transaction exceeds the Solana packet limit');
    return { signature: base58(signed.signature!), raw: b64(raw), lastValidBlockHeight: block.lastValidBlockHeight };
  }
  override async broadcast(attempt: Attempt): Promise<string> {
    const tx = Transaction.from(from64(attempt.raw));
    if (tx.instructions.some(i => i.programId.equals(PROTOCOL_ID))) {
      if (!this.protocol) throw Error('Protocol deployment unavailable');
      await this.protocol.validate();
    }
    return super.broadcast(attempt);
  }
}
