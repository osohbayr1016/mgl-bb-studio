/**
 * Төслийн Drive хавтсанд ERP-ээс файл БАЙРШУУЛАХ — цэвэр (сүлжээгүй, D1-гүй)
 * хэсэг (2026-09-17).  Drive рүү дуудлага нь `google/driveBrowse.ts`
 * (`driveResumable*`), route нь `routes/projectDrive.ts`.
 *
 * Урсгал:
 *   1. хөтөч `POST …/folders/:folderId/uploads {name, mime, size, on_conflict}`
 *      → сервер ancestry шалгаад Google resumable session нээж, session URI-г
 *      ГАРЫН ҮСЭГТЭЙ ТОКЕНД нууж буцаана (`upload_token`);
 *   2. хөтөч файлыг `UPLOAD_CHUNK_BYTES`-ээр хувааж `PUT …/uploads?offset=N`
 *      (толгой `X-Upload-Token`) — сервер chunk-ийг санах ойд цуглуулалгүй
 *      Drive session руу УРСГАЛААР дамжуулна;
 *   3. сүүлийн chunk-д Drive файлын метаг буцаана → ledger-т `uploaded_by`.
 *
 * ЯАГААД session URI-г хөтөч рүү ил өгдөггүй вэ: Google-ийн resumable URI нь
 * ӨӨРӨӨ эрх — Authorization-гүйгээр тэр файлыг бичнэ.  Ил өгвөл хөтөч
 * Worker-ийг тойрч Google руу шууд бичиж болно (CORS ажиллах эсэх нь
 * баталгаагүй) ба ямар ч URI-г Worker-ээр дамжуулах «нээлттэй прокси» болно.
 * Токен нь HMAC-SHA256 (JWT_SECRET) гарын үсэгтэй, ХОЁР хэсэгтэй
 * (`payload.sig`) — ГУРВАН хэсэгтэй JWT биш тул `lib/jwt.ts verifyToken`
 * түүнийг session токен гэж ХЭЗЭЭ Ч хүлээж авахгүй (`sub`/`role` ч байхгүй).
 *
 * ЯАГААД D1-д session хадгалдаггүй вэ: chunk бүрд мөр унших/бичих нь
 * rows_read/write зардал; токен нь өөрөө бүх контекст (root, эцэг, нэр,
 * хэмжээ, солих файл, хэн) тээж, 24 цагт хүчингүй болно.
 */
import { GOOGLE_APPS_PREFIX } from './google/driveBrowseCore';
import { mimeFromFileName } from './projectDrive';

/* ------------------------------------------------------------------ */
/*  Хэмжээ                                                             */
/* ------------------------------------------------------------------ */

/**
 * Нэг chunk = 32 MiB.  Google resumable нь сүүлийнхээс бусад chunk-ийг
 * 256 KiB-ийн үржвэр байхыг шаарддаг (32 MiB = 128 × 256 KiB ✓); Worker-ийн
 * хүсэлтийн биетийн хязгаар (100 MB) дор.  Хөтөч ч ижил тоог сервер
 * хариунаас (`chunk_bytes`) авдаг — хатуу бичихгүй.
 */
export const UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;

/** Нэг файлын тааз — 2 GiB.  Drive-ын өөрийн тааз 5 TB; сонсогчийн хуулбар
 *  (`SNAPSHOT_MAX_BYTES`) 1 GiB тул үүнээс том файл Drive-д орно, гэхдээ
 *  ledger-т r2_key-гүй (буцаах боломжгүй) бүртгэгдэнэ. */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** Токены амьдрал — Google session 7 хоног амьд ч 24 цаг хангалттай. */
export const UPLOAD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Файлын нэрийн дээд урт (Drive өөрөө хязгаарладаггүй ч UI/ledger-т ухаалаг тааз). */
export const MAX_NAME_LENGTH = 255;

/* ------------------------------------------------------------------ */
/*  Нэр                                                                */
/* ------------------------------------------------------------------ */

/**
 * Хөтчөөс ирсэн нэрийг ариутгана: замын тэмдэг (`/`, `\`) — хавтасны нэр
 * үүсгэх/солих оролдлого — доогуур зураас болно, удирдлагын тэмдэгт хасагдана,
 * захын зай/цэг тайрагдана.  Хоосон, `.`/`..` → null (400).
 * Кирилл, зай, хаалт г.м. бүгд ЗӨВШӨӨРӨГДӨНӨ — Drive нэр нь чөлөөт текст.
 */
export function sanitizeUploadName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  let name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\]/g, '_').trim();
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!name || name === '.' || name === '..') return null;
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trimEnd();
  return name || null;
}

/** Хөтчийн `file.type` хоосон/буруу байвал файлын НЭРЭЭР нь таньж
 *  (`lib/projectDrive.ts mimeFromFileName` — урьдчилан харах төлөвлөгөөтэй ижил
 *  хүснэгт), танигдахгүй бол энгийн байт.  Өмнө нь хоосон `File.type`
 *  (Windows дээр чирж тавих / хавтас байршуулахад элбэг) Drive-д
 *  `application/octet-stream` .docx үүсгэж, тэр файл хэзээ ч урьдчилан
 *  харагдахгүй байв.  Google-ийн өөрийн форматыг (`application/vnd.google-apps.*`)
 *  байршуулалтаар ЗОХИОЖ болохгүй. */
export function normalizeUploadMime(raw: unknown, name?: string | null): string {
  const fallback = mimeFromFileName(name) ?? 'application/octet-stream';
  if (typeof raw !== 'string') return fallback;
  const m = raw.trim().toLowerCase();
  if (!m || m.length > 200 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(m)) return fallback;
  if (m.startsWith(GOOGLE_APPS_PREFIX)) return fallback;
  if (m === 'application/octet-stream') return fallback;
  return m;
}

export type UploadConflict = 'replace' | 'keep';

export function parseConflict(raw: unknown): UploadConflict | null {
  if (raw === undefined || raw === null || raw === '') return 'replace';
  return raw === 'replace' || raw === 'keep' ? raw : null;
}

/* ------------------------------------------------------------------ */
/*  «Эх файлыг нээх» — ИЖИЛ .docx-ийн шинэ хувилбар (2026-09-30)       */
/* ------------------------------------------------------------------ */
/*
 * «Google Docs болгох» (хөрвүүлсэн ХУУЛБАР) хасагдсан: товч дарах бүрт хавтсанд ижил нэртэй
 * Google Doc нэмэгдэж давхардлаар дүүрдэг байв (эзний гомдол; прод дээр RFI-017 ×3, RFI-020 ×2).
 * Оронд нь «Эх файлыг нээх» дээр хөтөч .docx-ийг Google-д Word-той ижил харагдахаар засаад
 * (`frontend/.../drive/docxGoogleReady.ts` — navy бичвэр цагаан, нуусан navy хэлбэр, фонт)
 * ИЖИЛ файлын ШИНЭ ХУВИЛБАР болгон байршуулна (`files.update`) — шинэ файл хэзээ ч үүсэхгүй.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Энэ замаар засах .docx-ийн дээд хэмжээ.  RFI ~0.4–1.5 MB; зурагтай тайланг (50–110 MB)
 *  хөтөч дахин татаж ZIP-лэхгүй — тэдгээрийг засваргүй нээнэ (`openInGoogle.ts`-ийн ижил тааз). */
export const REVISION_MAX_BYTES = 40 * 1024 * 1024;

export type RevisionRequest =
  | { ok: true; size: number; base: string }
  | { ok: false; code: 'EMPTY_FILE' | 'REVISION_TOO_LARGE' | 'BASE_REQUIRED' };

/**
 * `{ size, base_modified_time }`.  `base_modified_time` — хөтөч засвар хийхээр татсан үеийн
 * Drive-ын `modifiedTime`; одоогийнхоос өөр бол (хэн нэгэн хооронд нь засварласан) сервер
 * 409-өөр татгалзана — бусдын засварыг хуучин байтаар ХЭЗЭЭ Ч дарахгүй.
 */
export function parseRevisionRequest(body: unknown): RevisionRequest {
  const b = (body ?? {}) as { size?: unknown; base_modified_time?: unknown };
  const size = typeof b.size === 'number' ? b.size : Number.NaN;
  if (!Number.isInteger(size) || size <= 0) return { ok: false, code: 'EMPTY_FILE' };
  if (size > REVISION_MAX_BYTES) return { ok: false, code: 'REVISION_TOO_LARGE' };
  const base = typeof b.base_modified_time === 'string' ? b.base_modified_time.trim() : '';
  if (!base) return { ok: false, code: 'BASE_REQUIRED' };
  return { ok: true, size, base };
}

/** Шинэ хувилбараар солих боломжтой: жинхэнэ .docx (Google-ийн формат, товчлол, хавтас биш).
 *  Хөтөч MIME өгөөгүй байршуулсан .docx Drive дээр octet-stream байж болно — өргөтгөлөөр. */
export function isRevisableDocx(entry: { name: string; mimeType: string }): boolean {
  if (entry.mimeType === DOCX_MIME) return true;
  return entry.mimeType === 'application/octet-stream' && /\.docx$/i.test(entry.name);
}

/* ------------------------------------------------------------------ */
/*  Chunk-ийн тооцоо                                                   */
/* ------------------------------------------------------------------ */

export type ChunkCheck =
  | { ok: true; length: number; last: boolean }
  | { ok: false; reason: 'BAD_OFFSET' | 'BAD_LENGTH' };

/**
 * `offset` chunk-ийн хилээс эхэлж, урт нь яг `min(chunk, size − offset)`
 * байх ёстой — хөтөч ямар ч урттай биет илгээж Google-ийн «256 KiB-ийн
 * үржвэр» дүрмийг зөрчихгүй, мөн Content-Length-ээ тайрч/сунгаж чадахгүй.
 */
export function checkChunk(offset: number, contentLength: number, size: number, chunk = UPLOAD_CHUNK_BYTES): ChunkCheck {
  if (!Number.isInteger(offset) || offset < 0 || offset >= size || offset % chunk !== 0) {
    return { ok: false, reason: 'BAD_OFFSET' };
  }
  const expected = Math.min(chunk, size - offset);
  if (!Number.isInteger(contentLength) || contentLength !== expected) return { ok: false, reason: 'BAD_LENGTH' };
  return { ok: true, length: expected, last: offset + expected === size };
}

/* ------------------------------------------------------------------ */
/*  Гарын үсэгтэй upload токен                                         */
/* ------------------------------------------------------------------ */

export interface UploadTicket {
  /** Google resumable session URI — ХӨТӨЧ рүү ил ХЭЗЭЭ Ч явахгүй. */
  session: string;
  /** Төслийн үндэс хавтас — route нь хандах эрхийг ЭНЭ id-гаар дахин тулгана. */
  root: string;
  /** Файл очих хавтас (`created` мөрийн parent_id). */
  parent: string;
  name: string;
  mime: string;
  size: number;
  /** Солигдож буй файл (`on_conflict=replace` + ижил нэр байсан) — ledger `modified`. */
  existing: string | null;
  /** Байршуулагч (ERP хэрэглэгч) — ledger `uploaded_by_user_id`. */
  user: number;
  /** Хүчинтэй хугацаа, ms epoch. */
  exp: number;
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array | null {
  try {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(`drive-upload:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signUploadTicket(secret: string, ticket: UploadTicket): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(ticket)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

/** Гарын үсэг, хугацаа, хэлбэр — гурвуулаа таарвал л буцаана; бусад null. */
export async function verifyUploadTicket(secret: string, token: string, nowMs = Date.now()): Promise<UploadTicket | null> {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sigB64] = parts as [string, string];
  const sig = b64urlDecode(sigB64);
  if (!sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, encoder.encode(payload));
  if (!ok) return null;
  const raw = b64urlDecode(payload);
  if (!raw) return null;
  let t: unknown;
  try {
    t = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!isTicket(t) || t.exp <= nowMs) return null;
  return t;
}

function isTicket(v: unknown): v is UploadTicket {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.session === 'string' &&
    o.session.startsWith('https://www.googleapis.com/upload/drive/v3/') &&
    typeof o.root === 'string' &&
    typeof o.parent === 'string' &&
    typeof o.name === 'string' &&
    typeof o.mime === 'string' &&
    typeof o.size === 'number' &&
    Number.isInteger(o.size) &&
    o.size > 0 &&
    (o.existing === null || typeof o.existing === 'string') &&
    typeof o.user === 'number' &&
    typeof o.exp === 'number'
  );
}
