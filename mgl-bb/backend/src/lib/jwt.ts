import type { JWTPayload } from '../types';
import { currentTenantId, hasTenantContext } from './requestContext';

const encoder = new TextEncoder();

async function createKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function signToken(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInHours = 24,
): Promise<string> {
  const key = await createKey(secret);
  const now = Math.floor(Date.now() / 1000);

  // Олон-tenant контекстэд байвал `tid` claim-ийг АВТОМАТААР шигтгэнэ.
  //
  // ⚠️ ЗОРИУДААР ЭНД, дуудагч бүр дээр биш.  `signToken` нь 11 газраас
  //    дуудагддаг (нэвтрэлт, mcp-token, 6 төрлийн print token, stt-audio,
  //    email OAuth state).  Нэгийг нь мартвал тэр токен tenant-гүй гарч,
  //    `middleware/auth.ts` 401 өгнө — эсвэл бүр муу нь, шалгалт сул байсан
  //    бол компани хооронд гарах цоорхой болно.  Нэг газарт хийснээр ийм
  //    алдаа боломжгүй болно.
  //
  // Нэг-tenant суулгацад `hasTenantContext()` худал тул `tid` ОГТ нэмэгдэхгүй
  // — токены хэлбэр өнөөдрийнхтэй байт байтаараа ижил үлдэнэ.
  const fullPayload: JWTPayload = {
    ...payload,
    ...(hasTenantContext() && payload.tid === undefined ? { tid: currentTenantId() } : {}),
    iat: now,
    exp: now + expiresInHours * 3600,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));

  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
    const key = await createKey(secret);

    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(signingInput));
    if (!valid) return null;

    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadStr) as JWTPayload;

    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
