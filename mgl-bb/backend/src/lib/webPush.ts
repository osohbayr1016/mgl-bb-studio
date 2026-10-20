/**
 * Web Push илгээгч — RFC 8030 (protocol) + RFC 8291 (aes128gcm шифрлэлт)
 * + RFC 8292 (VAPID).  Гуравдагч талын сан ашиглахгүй: бүгд WebCrypto дээр
 * бичигдсэн тул Worker дээр шууд ажиллана.
 *
 * ТҮЛХҮҮРИЙН ФОРМАТ (энэ файлын бүх орох утга):
 *   VAPID_PUBLIC_KEY  — 65 байтын шахагдаагүй P-256 цэг (0x04-ээр эхэлнэ),
 *                       base64url.  Браузерын `applicationServerKey`-тэй
 *                       ЯГ ижил утга; нууц биш.
 *   VAPID_PRIVATE_KEY — 32 байтын түүхий `d` скаляр, base64url (ASN.1/PEM БИШ).
 *   Хоёуланг нь `npx web-push generate-vapid-keys` яг энэ хэлбэрээр өгдөг.
 *
 * Түлхүүрийг ASN.1 задлахгүйгээр x/y/d-ээс JWK угсарч import хийнэ.
 */
import type { Env } from '../types';

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ */
/*  base64url                                                          */
/* ------------------------------------------------------------------ */

export function bytesToB64url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Буруу тэмдэгттэй / гажсан оролт дээр шидэлгүй хоосон массив буцаана —
 *  дуудагч тал нь урт шалгаж алдаа мэдээлнэ (routes/push.ts). */
export function b64urlToBytes(str: string): Uint8Array {
  try {
    const binary = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/* ------------------------------------------------------------------ */
/*  Нийтийн төрлүүд                                                    */
/* ------------------------------------------------------------------ */

export interface PushSubscriptionRecord {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body?: string | null;
  link?: string | null;
  /** Service worker-ийн `tag` — ижил tag-тай мэдэгдэл бие биенээ дарна. */
  tag?: string;
  type?: string;
  id?: number;
  unread?: number;
}

/**
 * Илгээлтийн үр дүн.  `action` нь дуудагч талд ЮУ ХИЙХИЙГ хэлнэ:
 *   drop   — subscription үхсэн (404/410/403) → мөрийг устга.
 *   retry  — түр зуурын алдаа (429/5xx/сүлжээ) → failure_count += 1.
 *   ignore — бидний талын засах юмгүй (413 хэт том) → тоолуур хөдөлгөхгүй.
 *   config — VAPID тохиргооны алдаа (400/401) → DB-д огт хүрэхгүй, зөвхөн лог.
 */
export type PushOutcome =
  | { ok: true; status: number }
  | {
      ok: false;
      status: number;
      action: 'drop' | 'retry' | 'ignore' | 'config';
      retryAfterSec?: number;
      detail?: string;
    };

/** Шифрлэхээс ӨМНӨ хаягдсан хэт том payload. */
export class PushPayloadTooLargeError extends Error {
  bytes: number;
  constructor(bytes: number) {
    super(`push payload ${bytes}B > ${MAX_PLAINTEXT_BYTES}B`);
    this.name = 'PushPayloadTooLargeError';
    this.bytes = bytes;
  }
}

/** Гажсан p256dh / auth түлхүүр — уг subscription дахин хэзээ ч ажиллахгүй
 *  тул `drop` (мөрийг устгах) болгон тайлагдана. */
export class PushSubscriptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushSubscriptionKeyError';
  }
}

/* ------------------------------------------------------------------ */
/*  Тогтмолууд                                                         */
/* ------------------------------------------------------------------ */

/** aes128gcm биеийн толгой: salt(16) + rs(4) + idlen(1) + as_public(65). */
const HEADER_BYTES = 86;
/** Нэг бичлэгийн (record) хэмжээ — RFC 8188 `rs`. */
const RECORD_SIZE = 4096;
/** GCM tag(16) + record delimiter(1) → цэвэр текстэд үлдэх дээд хэмжээ. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_BYTES - 16 - 1; // 3993

const TITLE_MAX_BYTES = 100;
const BODY_MAX_BYTES = 300;

/* ------------------------------------------------------------------ */
/*  Тохиргооны хаалга                                                  */
/* ------------------------------------------------------------------ */

/**
 * Push бүрэн тохируулагдсан эсэх.  Env дэх гурван талбар бүгд optional
 * (тохируулаагүй орчин ч type-check дамжина) тул ГАНЦ RUNTIME ХААЛГА нь энэ.
 */
export function vapidConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/* ------------------------------------------------------------------ */
/*  VAPID түлхүүр + JWT                                                */
/* ------------------------------------------------------------------ */

let signingKeyCache: { id: string; key: Promise<CryptoKey> } | null = null;

/** x/y/d-ээс JWK угсарч ECDSA P-256 гарын үсгийн түлхүүр import хийнэ.
 *  `ext` / `key_ops`-ыг ЗОРИУДААР оруулахгүй — зарим runtime тэдгээрийг
 *  дамжуулсан usages-тай зөрчилдвөл import-ыг унагадаг. */
function importVapidKey(publicKeyB64: string, privateKeyB64: string): Promise<CryptoKey> {
  const pub = b64urlToBytes(publicKeyB64);
  const d = b64urlToBytes(privateKeyB64);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    return Promise.reject(
      new Error('VAPID_PUBLIC_KEY нь 65 байтын шахагдаагүй P-256 цэг (0x04...) байх ёстой'),
    );
  }
  if (d.length !== 32) {
    return Promise.reject(new Error('VAPID_PRIVATE_KEY нь 32 байтын түүхий скаляр байх ёстой'));
  }
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(pub.subarray(1, 33)),
    y: bytesToB64url(pub.subarray(33, 65)),
    d: bytesToB64url(d),
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
}

function getVapidSigningKey(env: Env): Promise<CryptoKey> {
  const id = `${env.VAPID_PUBLIC_KEY ?? ''}.${env.VAPID_PRIVATE_KEY ?? ''}`;
  if (!signingKeyCache || signingKeyCache.id !== id) {
    signingKeyCache = { id, key: importVapidKey(env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!) };
  }
  return signingKeyCache.key;
}

/** aud (+ түлхүүр) тус бүрийн JWT кэш.  Isolate-ийн амьдралын хугацаанд
 *  дахин ашиглана — 12 цагийн exp-ээс 1 цагаас бага үлдвэл шинэчилнэ. */
const jwtCache = new Map<string, { jwt: string; exp: number }>();

const VAPID_JWT_TTL_SEC = 12 * 3600;
const VAPID_JWT_MIN_REMAINING_SEC = 3600;

/**
 * RFC 8292 VAPID `Authorization` толгой.
 *
 * ⚠️ `aud` нь endpoint-ийн ORIGIN (protocol + host) — ЗАМГҮЙ.  Бүтэн
 *    endpoint URL-ыг `aud`-д тавих нь FCM 401 өгөх №1 шалтгаан.
 */
async function vapidAuthHeader(env: Env, endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cacheKey = `${aud}|${env.VAPID_PUBLIC_KEY}`;
  const now = Math.floor(Date.now() / 1000);

  const hit = jwtCache.get(cacheKey);
  if (hit && hit.exp - now > VAPID_JWT_MIN_REMAINING_SEC) {
    return `vapid t=${hit.jwt}, k=${env.VAPID_PUBLIC_KEY}`;
  }

  const exp = now + VAPID_JWT_TTL_SEC;
  const header = bytesToB64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(
    encoder.encode(JSON.stringify({ aud, exp, sub: env.VAPID_SUBJECT })),
  );
  const signingInput = `${header}.${claims}`;

  const key = await getVapidSigningKey(env);
  // WebCrypto-гийн ECDSA гарын үсэг нь түүхий r‖s (64 байт) — энэ нь ЯГ
  // JOSE ES256 формат.  DER (ASN.1) хөрвүүлэлт ХЭРЭГГҮЙ.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  );
  const jwt = `${signingInput}.${bytesToB64url(sig)}`;
  jwtCache.set(cacheKey, { jwt, exp });

  // Толгойн утга дахь таслал + ЗАЙ хоёул шаардлагатай.
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

/* ------------------------------------------------------------------ */
/*  RFC 8291 aes128gcm шифрлэлт                                        */
/* ------------------------------------------------------------------ */

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

const KEY_INFO_PREFIX = encoder.encode('WebPush: info');
const CEK_INFO = encoder.encode('Content-Encoding: aes128gcm\0');
const NONCE_INFO = encoder.encode('Content-Encoding: nonce\0');

/**
 * Нэг бичлэгтэй (single record) aes128gcm бие угсарна.
 *
 * Бие = salt(16) ‖ rs(4, BIG-ENDIAN uint32) ‖ idlen(1)=65 ‖ as_public(65) ‖ ct
 *
 * `opts` нь ЗӨВХӨН тестэд зориулагдсан (тогтмол salt + тогтмол түр зуурын
 * түлхүүр оруулж RFC 8291 §5-ийн вектор давтахад).  Продакшнд хэзээ ч
 * дамжуулахгүй.
 */
async function encryptAes128gcm(
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  plaintext: Uint8Array,
  opts?: { salt?: Uint8Array; ephemeral?: CryptoKeyPair },
): Promise<Uint8Array> {
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new PushSubscriptionKeyError('p256dh нь 65 байтын шахагдаагүй цэг (0x04...) байх ёстой');
  }
  if (authSecret.length !== 16) {
    throw new PushSubscriptionKeyError('auth нь яг 16 байт байх ёстой');
  }
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new PushPayloadTooLargeError(plaintext.length);
  }

  // Хэрэглэгчийн агентын нийтийн түлхүүр.  ECDH НИЙТИЙН түлхүүрийн usages
  // массив ЗААВАЛ хоосон байх ёстой (deriveBits нь хувийн түлхүүр дээр байдаг).
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // Мессеж × subscription бүрт ШИНЭ түр зуурын хос.  publicKey-г raw-аар
  // экспортлох шаардлагатай тул extractable = true.
  const kp =
    opts?.ephemeral ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);
  // workers-types-ийн `exportKey` нь `ArrayBuffer | JsonWebKey` буцаадаг;
  // 'raw' форматад үргэлж ArrayBuffer тул нарийсгана.
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer,
  );
  if (asPublic.length !== 65) throw new Error('түр зуурын нийтийн түлхүүр 65 байт биш байна');

  // ⚠️ workers-types нь workerd-ийн C++ талбарын нэрийг (`$public`) шууд
  //    гаргачихсан байдаг ч JS-д харагдах жинхэнэ нэр нь `public` (WebCrypto
  //    стандартын дагуу).  Тиймээс runtime-д `public` бичиж, төрлийг cast-аар
  //    дүрсэлнэ — `$public` бичвэл ECDH түлхүүр олдохгүй унана.
  const ecdhParams = {
    name: 'ECDH',
    public: uaKey,
  } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, kp.privateKey, 256));

  // ⚠️ ДАРААЛАЛ: "WebPush: info" ‖ 0x00 ‖ ua_public ‖ as_public  = 144 байт.
  //    ua_public ЭХЛЭЭД, as_public ХОЁРДУГААРТ.  Сольвол push service
  //    201 буцаасан хэвээр байх ба браузер мессежийг ЧИМЭЭГҮЙ хаяна —
  //    энэ файл дахь хамгийн оношлоход хэцүү алдаа.
  const keyInfo = concatBytes(KEY_INFO_PREFIX, new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = opts?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error('salt 16 байт байх ёстой');

  const cek = await hkdf(salt, ikm, CEK_INFO, 16);
  // Ганц бичлэг → SEQ = 0 → nonce-ыг дарааллын дугаартай XOR хийх шаардлагагүй.
  const nonce = await hkdf(salt, ikm, NONCE_INFO, 12);

  // Сүүлийн бичлэгийн тусгаарлагч нь 0x02.  0x01 бол Firefox татгалзана.
  const record = concatBytes(plaintext, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record),
  );

  const body = new Uint8Array(HEADER_BYTES + ct.length);
  body.set(salt, 0);
  // rs — BIG-endian uint32 (сүүлийн аргумент `false`).
  new DataView(body.buffer).setUint32(16, RECORD_SIZE, false);
  body[20] = 65; // idlen
  body.set(asPublic, 21);
  body.set(ct, HEADER_BYTES);
  return body;
}

/** Зөвхөн unit test-д (RFC 8291 §5 вектор). */
export const __encryptAes128gcmForTest = encryptAes128gcm;

/* ------------------------------------------------------------------ */
/*  Payload серилчлэл                                                  */
/* ------------------------------------------------------------------ */

/**
 * UTF-8 байтаар тайрна.  `TextEncoder.encodeInto` нь буферт багтахгүй
 * код цэгийг ХЭЗЭЭ Ч хагас бичдэггүй тул кирилл (2 байт/тэмдэгт) үсэг
 * хагасаар тасрахгүй.  Тайрсан бол '…' (3 байт) нэмнэ.
 */
export function truncateUtf8(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const probe = new Uint8Array(maxBytes);
  const first = encoder.encodeInto(s, probe);
  if (first.read >= s.length) return s; // бүтнээрээ багтсан
  const room = maxBytes - 3; // '…' = 3 байт UTF-8
  if (room <= 0) return s.slice(0, first.read);
  const buf = new Uint8Array(room);
  const { read } = encoder.encodeInto(s, buf);
  return `${s.slice(0, read)}…`;
}

function utf8Len(s: string): number {
  return encoder.encode(s).length;
}

/** Push биед орох JSON.  Гарц нь ҮРГЭЛЖ MAX_PLAINTEXT_BYTES-аас бага. */
function serializePayload(payload: PushPayload): string {
  const trimmed: PushPayload = { ...payload, title: truncateUtf8(payload.title, TITLE_MAX_BYTES) };
  if (typeof trimmed.body === 'string') trimmed.body = truncateUtf8(trimmed.body, BODY_MAX_BYTES);

  let json = JSON.stringify(trimmed);
  if (utf8Len(json) <= MAX_PLAINTEXT_BYTES) return json;

  // 1) Биеийг бүхэлд нь хаяна.
  const noBody: PushPayload = { ...trimmed };
  delete noBody.body;
  json = JSON.stringify(noBody);
  if (utf8Len(json) <= MAX_PLAINTEXT_BYTES) return json;

  // 2) Гарчгийг дахин тайрна.
  const shorter: PushPayload = { ...noBody, title: truncateUtf8(noBody.title, 200) };
  json = JSON.stringify(shorter);
  if (utf8Len(json) <= MAX_PLAINTEXT_BYTES) return json;

  // 3) Энд хүрэх цорын ганц зам бол аварга том `link` — дуудагчийн алдаа.
  throw new PushPayloadTooLargeError(utf8Len(json));
}

/* ------------------------------------------------------------------ */
/*  Хариултын тайлбар                                                  */
/* ------------------------------------------------------------------ */

/** `Retry-After` — delta-seconds эсвэл HTTP-date.  Хоногоор таглана. */
function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const asNumber = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(Math.floor(asNumber), 86400);
  }
  const at = Date.parse(trimmed);
  if (Number.isFinite(at)) {
    return Math.min(Math.max(Math.round((at - Date.now()) / 1000), 0), 86400);
  }
  return undefined;
}

/** Алдааны биеийг ҮРГЭЛЖ уншиж (эсвэл цуцалж) дуусгана — унших/цуцлахгүй
 *  орхивол холболт задлагдалгүй үлдэж болно. */
async function readErrorSnippet(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 512);
  } catch {
    return '';
  }
}

function discardBody(res: Response): void {
  try {
    void res.body?.cancel();
  } catch {
    /* аль хэдийн хаагдсан */
  }
}

/* ------------------------------------------------------------------ */
/*  Илгээх                                                             */
/* ------------------------------------------------------------------ */

export async function sendWebPush(
  env: Env,
  sub: PushSubscriptionRecord,
  payload: PushPayload,
  opts?: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' },
): Promise<PushOutcome> {
  if (!vapidConfigured(env)) {
    return { ok: false, status: 0, action: 'config', detail: 'VAPID тохируулаагүй' };
  }

  let body: Uint8Array;
  let authorization: string;
  try {
    const plaintext = encoder.encode(serializePayload(payload));
    body = await encryptAes128gcm(b64urlToBytes(sub.p256dh), b64urlToBytes(sub.auth), plaintext);
    authorization = await vapidAuthHeader(env, sub.endpoint);
  } catch (err) {
    if (err instanceof PushPayloadTooLargeError) {
      console.error('[web-push] payload хэт том', err.message);
      return { ok: false, status: 0, action: 'ignore', detail: err.message };
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[web-push] бэлтгэл амжилтгүй', detail);
    // Гажсан түлхүүр → энэ subscription дахин хэзээ ч ажиллахгүй тул устгана.
    // Бусад (VAPID түлхүүр импортлох) алдаа нь тохиргооных — мөр буруугүй.
    if (err instanceof PushSubscriptionKeyError) {
      return { ok: false, status: 0, action: 'drop', detail };
    }
    return { ok: false, status: 0, action: 'config', detail };
  }

  let res: Response;
  try {
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(opts?.ttl ?? 86400),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: authorization,
        Urgency: opts?.urgency ?? 'normal',
        // `Crypto-Key` / `Encryption` толгойг ЗОРИУДААР илгээхгүй — тэдгээр
        // нь хуучирсан aesgcm draft-ынх; aes128gcm-д бүх мэдээлэл бие дотор.
      },
      body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, action: 'retry', detail };
  }

  const status = res.status;
  if (status === 200 || status === 201 || status === 202) {
    discardBody(res);
    return { ok: true, status };
  }

  const detail = await readErrorSnippet(res);

  // Устсан / хүчингүй subscription — цэвэрлэ.
  if (status === 404 || status === 410 || status === 403) {
    return { ok: false, status, action: 'drop', detail };
  }
  // 413 = бие хэт том.  Дахин оролдох нь утгагүй, subscription буруугүй.
  if (status === 413) {
    console.error(`[web-push] 413 payload too large: ${detail}`);
    return { ok: false, status, action: 'ignore', detail };
  }
  if (status === 429) {
    return {
      ok: false,
      status,
      action: 'retry',
      retryAfterSec: parseRetryAfter(res.headers.get('Retry-After')),
      detail,
    };
  }
  // 400/401 нь бараг үргэлж VAPID тохиргооны алдаа (буруу aud, хугацаа
  // дууссан JWT, түлхүүр солигдсон).  failure_count-ыг ХӨДӨЛГӨХГҮЙ:
  // тохиргооны алдаанаас болж бүх төхөөрөмжийн бүртгэл устах ёсгүй.
  if (status === 400 || status === 401) {
    console.error(`[web-push] ${status} тохиргооны алдаа: ${detail}`);
    return { ok: false, status, action: 'config', detail };
  }
  return { ok: false, status, action: 'retry', detail };
}
