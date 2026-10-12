export const utf8 = (s: string) => new TextEncoder().encode(s);
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out;
}
export const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export function unhex(s: string, size?: number): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(s) || (size !== undefined && s.length !== size * 2)) throw Error('Invalid byte encoding');
  return Uint8Array.from(s.match(/../g)!, x => parseInt(x, 16));
}
export const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
export const random = (size: number) => crypto.getRandomValues(new Uint8Array(size));
export const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
export const b64 = (b: Uint8Array) => btoa(Array.from(b, v => String.fromCharCode(v)).join(''));
export function from64(s: string): Uint8Array { return Uint8Array.from(atob(s), x => x.charCodeAt(0)); }
export const from64url = (s: string) => from64(s.replace(/-/g, '+').replace(/_/g, '/'));
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(b: Uint8Array): string {
  let n = BigInt('0x' + (hex(b) || '0')); let s = '';
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const v of b) { if (v !== 0) break; s = '1' + s; } return s;
}
export function from58(s: string): Uint8Array {
  if (!s || s.length > 44) throw Error('Invalid Solana address');
  let n = 0n; for (const ch of s) { const digit = ALPHABET.indexOf(ch); if (digit < 0) throw Error('Invalid Solana address'); n = n * 58n + BigInt(digit); }
  const bytes: number[] = []; while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of s) { if (ch !== '1') break; bytes.unshift(0); }
  const b = Uint8Array.from(bytes); if (b.length !== 32) throw Error('Address must contain 32 bytes'); return b;
}
export function u64(n: bigint): Uint8Array {
  if (n < 0n || n > 0xffffffffffffffffn) throw Error('Amount outside u64');
  const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b;
}
