/**
 * Public document signing — token/audit helpers.
 *
 * Raw share tokens are bearer credentials.  They exist only in the URL returned
 * to the staff member; D1 stores SHA-256(token), so a DB leak does not turn into
 * usable signing links.
 */
export type PublicSigningKind = 'correspondence' | 'asr';
export type PublicSigningSlot = 'client' | 'arch' | 'site';
export type PublicSigningStatus = 'pending' | 'signed' | 'revoked' | 'expired';

export const PUBLIC_SIGNING_DEFAULT_DAYS = 7;
export const PUBLIC_SIGNING_MAX_DAYS = 30;

function base64Url(bytes: Uint8Array): string {
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function newPublicSigningToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeExpiryDays(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return PUBLIC_SIGNING_DEFAULT_DAYS;
  return Math.max(1, Math.min(PUBLIC_SIGNING_MAX_DAYS, Math.trunc(n)));
}

export function expiresAtIso(days: number, nowMs = Date.now()): string {
  return new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
}

export function cleanSigningText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
}

export function isPublicSigningKind(v: unknown): v is PublicSigningKind {
  return v === 'correspondence' || v === 'asr';
}

export function isPublicSigningSlot(v: unknown): v is PublicSigningSlot {
  return v === 'client' || v === 'arch' || v === 'site';
}

export function isExpired(expiresAt: string, nowMs = Date.now()): boolean {
  const ms = Date.parse(expiresAt);
  return !Number.isFinite(ms) || ms <= nowMs;
}
