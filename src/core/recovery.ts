import { b64, from64, hex, random, sha256, utf8 } from './bytes.ts';
export type Envelope = { format: 'SHELL-RECOVERY-1'; kdf: 'PBKDF2-SHA256'; iterations: 600000; salt: string; iv: string; ciphertext: string };
export const MAX_RECOVERY_PACKAGE_BYTES = 2_000_000;
async function key(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password.length < 12) throw Error('Use a recovery password of at least 12 characters');
  const material = await crypto.subtle.importKey('raw', utf8(password) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 600000 }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const AAD = utf8('SHELL-RECOVERY-1|PBKDF2-SHA256|600000');
export async function encrypt(value: unknown, password: string): Promise<Envelope> {
  const salt = random(32), iv = random(12); const encoded = utf8(JSON.stringify(value));
  try {
    // AES-GCM adds a 16-byte tag. Refuse oversized state before writing a blob
    // that this same implementation would be unable to decrypt later.
    if (4 * Math.ceil((encoded.length + 16) / 3) > MAX_RECOVERY_PACKAGE_BYTES - 512) throw Error('Recovery state exceeds the supported encrypted package size. Existing stored state was preserved.');
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: AAD as BufferSource }, await key(password, salt), encoded as BufferSource);
    return { format: 'SHELL-RECOVERY-1', kdf: 'PBKDF2-SHA256', iterations: 600000, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
  } finally { encoded.fill(0); }
}
export async function decrypt<T>(e: Envelope, password: string): Promise<T> {
  if (!e || e.format !== 'SHELL-RECOVERY-1' || e.kdf !== 'PBKDF2-SHA256' || e.iterations !== 600000 || typeof e.ciphertext !== 'string' || e.ciphertext.length > MAX_RECOVERY_PACKAGE_BYTES || typeof e.salt !== 'string' || e.salt.length > 44 || typeof e.iv !== 'string' || e.iv.length > 16) throw Error('Unsupported recovery package');
  const salt = from64(e.salt), iv = from64(e.iv);
  if (salt.length !== 32 || iv.length !== 12) throw Error('Invalid recovery package');
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: AAD as BufferSource }, await key(password, salt), from64(e.ciphertext) as BufferSource)); }
  catch { throw Error('Recovery password is incorrect, or the encrypted package was modified. No replacement identity was created.'); }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } finally { bytes.fill(0); }
}
export const fingerprint = async (value: unknown) => hex(await sha256(utf8(JSON.stringify(value))));
