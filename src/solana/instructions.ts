import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { concat, u64, unhex } from '../core/bytes.ts';
import { encodeOperation, type AuthorizationProfile } from '../core/protocol.ts';
import { activationPlatformFee, PLATFORM_FEE_RECIPIENT } from '../core/platform-fee.ts';
import type { Request } from '../core/engine.ts';
export function buildInstruction(programId: PublicKey, request: Request, payer: PublicKey): TransactionInstruction {
  const vault = new PublicKey(request.vault.address), coordinator = new PublicKey(request.coordinator);
  const writable = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
  const sys = { pubkey: SystemProgram.programId, isSigner: false, isWritable: false };
  switch (request.kind) {
    case 'authorization': throw Error('Public authorization staging requires the verified protocol client');
    case 'create': return new TransactionInstruction({ programId, keys: [writable(payer, true), { pubkey: coordinator, isSigner: true, isWritable: false }, writable(vault), sys], data: Buffer.from(concat(new Uint8Array([0]), unhex(request.vault.root, 32))) });
    case 'deposit': return new TransactionInstruction({ programId, keys: [writable(payer, true), writable(vault), sys], data: Buffer.from(concat(new Uint8Array([1]), u64(request.amount!))) });
    case 'commit': return new TransactionInstruction({ programId, keys: [{ pubkey: coordinator, isSigner: true, isWritable: false }, writable(vault)], data: Buffer.from(concat(new Uint8Array([2]), encodeOperation(request.operation!))) });
    case 'withdraw': return new TransactionInstruction({ programId, keys: [writable(payer, true), writable(vault), writable(new PublicKey(request.operation!.destination)), writable(new PublicKey(request.operation!.nextAddress)), sys], data: Buffer.from(concat(new Uint8Array([3]), encodeOperation(request.operation!), unhex(request.wotsSignature!, 768))) });
  }
}

export function activationFeeInstruction(payer: PublicKey, profile: AuthorizationProfile): TransactionInstruction | null {
  const amount = activationPlatformFee(profile);
  return amount === 0n ? null : SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(PLATFORM_FEE_RECIPIENT), lamports: amount });
}

// Initial activation and its payment are one atomic transaction. The existing
// immutable vault program remains unchanged; direct program calls are free.
export function buildTransactionInstructions(programId: PublicKey, request: Request, payer: PublicKey, profile: AuthorizationProfile): TransactionInstruction[] {
  const instructions = [buildInstruction(programId, request, payer)];
  if (request.kind === 'create') {
    const payment = activationFeeInstruction(payer, profile);
    if (payment) instructions.push(payment);
  }
  return instructions;
}
