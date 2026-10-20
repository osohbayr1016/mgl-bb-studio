/**
 * Жижиг AES-GCM "secret box" — Gmail OAuth refresh token-ийг D1-д
 * шифрлэж хадгалахад зориулсан.  Workspace (service account) хайрцагт
 * хэрэггүй — тэнд refresh token огт хадгалдаггүй.  Зөвхөн энгийн
 * @gmail хайрцгийн OAuth урсгал л үүнийг ашиглана.
 *
 * Формат:  base64( iv(12 byte) ‖ ciphertext+tag ).  Түлхүүр нь
 * `EMAIL_ENCRYPTION_KEY` (base64 кодлогдсон 32 byte) Worker secret.
 *
 * crypto.subtle + crypto.getRandomValues нь Workers-д ажилладаг
 * (Math.random биш) тул resume-д ч асуудалгүй.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

async function importAesKey(rawKeyB64: string): Promise<CryptoKey> {
  const keyBytes = b64ToBytes(rawKeyB64);
  if (keyBytes.length !== 32) {
    throw new Error('EMAIL_ENCRYPTION_KEY must decode to 32 bytes (base64 of a 256-bit key)');
  }
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt `plaintext` (e.g. an OAuth refresh token) for at-rest storage. */
export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importAesKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );
  const ct = new Uint8Array(ctBuf);
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return bytesToB64(combined);
}

/** Reverse of {@link encryptSecret}.  Throws if the payload is tampered. */
export async function decryptSecret(payload: string, keyB64: string): Promise<string> {
  const key = await importAesKey(keyB64);
  const combined = b64ToBytes(payload);
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return decoder.decode(ptBuf);
}
