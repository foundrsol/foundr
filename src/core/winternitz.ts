/* Adapted from Winterwallet core/{lib,privkey,signature,pubkey}.rs at
 * 672fc6789b1532ee680f24842d235e0be8737b61, MIT, Dean Little.
 * Identical N=22, w=8, 32-byte SHA-256 chains, 2-byte checksum and Merkle
 * domain tags. The 22-byte MESSAGE digest is upstream's parameter; chain
 * hashes and Merkle roots are never truncated. No security-bit claim.
 * Independent CSPRNG scalars replace upstream's mnemonic derivation.
 * This low-level module is internal. All application signing uses engine.ts.
 */
import { concat, equal, random, sha256 } from './bytes.ts';
export const N = 22;
export const KEY_BYTES = (N + 2) * 32;
async function chain(seed: Uint8Array, count: number): Promise<Uint8Array> {
  let value = seed.slice(); for (let i = 0; i < count; i++) value = await sha256(value); return value;
}
async function merkle(scalars: Uint8Array[]): Promise<Uint8Array> {
  let nodes = await Promise.all(scalars.map(s => sha256(concat(new Uint8Array([0]), s))));
  while (nodes.length > 1) {
    const next = []; for (let i = 0; i < nodes.length; i += 2) next.push(sha256(concat(new Uint8Array([1]), nodes[i], nodes[i + 1] ?? nodes[i])));
    nodes = await Promise.all(next);
  } return nodes[0];
}
function scalars(key: Uint8Array): Uint8Array[] {
  if (key.length !== KEY_BYTES) throw Error('Invalid Winternitz key size');
  return Array.from({ length: N + 2 }, (_, i) => key.slice(i * 32, (i + 1) * 32));
}
function digits(digest: Uint8Array): number[] {
  if (digest.length !== 32) throw Error('SHA-256 digest required');
  const d = Array.from(digest.slice(0, N)); const sum = d.reduce((s, b) => s + 255 - b, 0);
  return [...d, sum >> 8, sum & 255];
}
export async function rootOf(secret: Uint8Array): Promise<Uint8Array> {
  return merkle(await Promise.all(scalars(secret).map(s => chain(s, 255))));
}
export async function generateKey(): Promise<{ secret: Uint8Array; root: Uint8Array }> {
  const secret = random(KEY_BYTES); return { secret, root: await rootOf(secret) };
}
export async function signDigest(secret: Uint8Array, digest: Uint8Array): Promise<Uint8Array> {
  const d = digits(digest); return concat(...await Promise.all(scalars(secret).map((s, i) => chain(s, d[i]))));
}
export async function verifyDigest(signature: Uint8Array, digest: Uint8Array, root: Uint8Array): Promise<boolean> {
  const d = digits(digest); const recovered = await merkle(await Promise.all(scalars(signature).map((s, i) => chain(s, 255 - d[i]))));
  return equal(recovered, root);
}
