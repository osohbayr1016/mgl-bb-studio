/**
 * ЭЭЛЖ БҮРД ЯГ НЭГ TrustedNormResult (Amendment B) — серверийн HMAC гарын үсэг.
 *
 *   /context → үр дүн + гарын үсэг (conv_uid, seq, асуултын хэш ХАМТ)
 *   хөтөч   → харуулна, тулгана, ХӨНДӨЛГҮЙ буцаана
 *   /messages → гарын үсэг ТААРВАЛ ТЭР объектоос итгэл, эшлэл, оношилгоо
 *
 * ⚠️ /messages хэзээ ч хөдөлгүүрийг ДАХИН ажиллуулахгүй — follow-up-ын нэгдсэн
 *    оролт, ярианы төлөв, кодын хувилбар зөрөөд A ≠ B үр дүн гарч болно.
 * ⚠️ Хөтчийн өөрчилсөн объектод ИТГЭХГҮЙ: гарын үсэг таарахгүй бол `null`.
 *    Түлхүүр нь `JWT_SECRET` (Worker-ийн цорын ганц нууц); зорилгын угтвар
 *    тусдаа тул JWT-тэй ХЭЗЭЭ Ч андуурагдахгүй.
 */
import type { TrustedNormResult } from './types';

const PURPOSE = 'mglai-trusted-norm-result-v1';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(`${PURPOSE}:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SignedScope {
  convUid: string | null;
  seq: number;
  question: string;
}

export function signingInput(result: TrustedNormResult, scope: SignedScope): string {
  return `${PURPOSE}\n${scope.convUid ?? ''}\n${scope.seq}\n${canonical(scope.question)}\n${canonical(result)}`;
}

export async function signTrustedResult(result: TrustedNormResult, scope: SignedScope, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput(result, scope)));
  return hex(sig);
}

/** Гарын үсэг таарвал `result`, таарахгүй/эвдэрсэн бол `null`. */
export async function verifyTrustedResult(raw: unknown, sig: unknown, scope: SignedScope, secret: string): Promise<TrustedNormResult | null> {
  if (!raw || typeof raw !== 'object' || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const result = raw as TrustedNormResult;
  if (result.version !== 'tnr-1') return null;
  const expected = await signTrustedResult(result, scope, secret);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? result : null;
}
