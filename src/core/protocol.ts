import { concat, from58, hex, sha256, u64, unhex, utf8 } from './bytes.ts';
// getGenesisHash returns the entire base58 hash, not the CAIP-2 prefix.
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
// Immutable SHELL v1 signing/recovery domain. Keep the original CAIP-2 marker:
// changing RPC validation must never make an existing WOTS key sign a new
// preimage. This marker is NOT used to compare getGenesisHash responses.
export const DEVNET_AUTHORIZATION_DOMAIN = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export type AuthorizationProfile = 'devnet-v1' | 'mainnet-v2';
export type Cluster = 'devnet' | 'mainnet-beta';
export function authorizationContext(profile: AuthorizationProfile) {
  if (profile === 'devnet-v1') return { cluster: 'devnet' as const, genesis: DEVNET_GENESIS, tag: 'SHELL_DEVNET_V1', domain: DEVNET_AUTHORIZATION_DOMAIN, accountVersion: 1 };
  if (profile === 'mainnet-v2') return { cluster: 'mainnet-beta' as const, genesis: MAINNET_GENESIS, tag: 'SHELL_MAINNET_V2', domain: MAINNET_GENESIS, accountVersion: 2 };
  throw Error('Unsupported authorization profile. Signing is blocked.');
}
export const ACCOUNT_SIZE = 172;
export const OP_SIZE = 105;
export type Operation = { version: 1; amount: string; destination: string; nextAddress: string; nextRoot: string };
export type VaultState = { status: 'available' | 'committed' | 'consumed'; root: string; coordinator: string; operation?: Operation; balance: bigint; rent: bigint };
export function encodeOperation(op: Operation): Uint8Array {
  if (op.version !== 1 || BigInt(op.amount) <= 0n) throw Error('Invalid operation');
  return concat(new Uint8Array([1]), u64(BigInt(op.amount)), from58(op.destination), from58(op.nextAddress), unhex(op.nextRoot, 32));
}
export async function operationDigest(program: string, vault: string, root: string, coordinator: string, op: Operation, profile: AuthorizationProfile = 'devnet-v1'): Promise<Uint8Array> {
  const context = authorizationContext(profile);
  return sha256(concat(utf8(context.tag), utf8(context.domain), from58(program), from58(vault), unhex(root, 32), from58(coordinator), encodeOperation(op)));
}
export const sameOperation = (a: Operation | undefined, b: Operation | undefined) => !!a && !!b && hex(encodeOperation(a)) === hex(encodeOperation(b));
export function assertNetwork(genesis: string, profile: AuthorizationProfile = 'devnet-v1'): void {
  const expected = authorizationContext(profile);
  if (genesis !== expected.genesis) throw Error(`RPC network mismatch: expected ${expected.cluster} genesis ${expected.genesis}; received ${genesis}. Wallet network selection was not inspected.`);
}
