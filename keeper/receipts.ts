// Integrations must verify a paid receipt, rather than trust a frontend label.
// Ordinary direct vault use stays free. A paid service cannot claim entitlement
// merely because the underlying free vault operation happened.
import { PublicKey } from '@solana/web3.js';
import { BN } from '@anchor-lang/core';
import { ProtocolClient, PROTOCOL_ID, receiptAddress } from '../src/protocol/client.ts';
export async function verifyPremiumReceipt(client: ProtocolClient, receipt: PublicKey, payer: PublicKey, expected: { kind: 'subscription' } | { kind: 'vault'; vault: PublicKey; service: number; amount: bigint }): Promise<{ validUntil: bigint | null; paid: bigint }> {
  await client.validate();
  const info = await client.connection.getAccountInfo(receipt, 'finalized');
  if (!info || !info.owner.equals(PROTOCOL_ID)) throw Error('A finalized payment receipt is required');
  const r = client.program.coder.accounts.decode<{ kind: number; payer: PublicKey; operation: PublicKey; fee: BN; amount: BN; service: number; expiresAt: BN }>('receipt', info.data);
  if (!r.payer.equals(payer)) throw Error('Receipt belongs to another payer');
  if (expected.kind === 'subscription') {
    if (r.kind !== 2) throw Error('Enterprise access requires a subscription receipt');
    const slot = await client.connection.getSlot('finalized'), timestamp = await client.connection.getBlockTime(slot);
    if (timestamp === null || BigInt(r.expiresAt.toString()) <= BigInt(timestamp)) throw Error('Subscription expired or finalized time unavailable');
    return { validUntil: BigInt(r.expiresAt.toString()), paid: BigInt(r.fee.toString()) };
  }
  if (r.kind !== 1 || !receipt.equals(receiptAddress(expected.vault)) || !r.operation.equals(expected.vault) || r.service !== expected.service || BigInt(r.amount.toString()) !== expected.amount) throw Error('Paid receipt does not authorize the requested premium service');
  return { validUntil: null, paid: BigInt(r.fee.toString()) };
}
