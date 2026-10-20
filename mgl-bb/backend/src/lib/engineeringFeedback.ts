/**
 * ПРОГРАМЫН ХҮСЭЛТ (engineering feedback) — ЦЭВЭР дүрэм (2026-10-16).
 *
 * Revit-ийн хэрэгслээс (add-in «Санал хүсэлт») эсвэл ERP-ээс ирэх алдаа / сайжруулалт / асуулт.  Энэ файл
 * D1, R2, Hono-оос ХАМААРАХГҮЙ — хязгаар, файлын нэр/төрөл, төлөвийн шилжилт, idempotency хэш, оношилгооны
 * цэвэрлэгээ.  Замууд: routes/engineeringFeedback.ts.  Эрх: lib/engineeringFeedbackAccess.ts.
 *
 * ⚠️ add-in-ий ихэр: revit-mcp/addin/Feedback/Core/FeedbackLimits.cs (хязгаар, өргөтгөл) — хамт өөрчил.
 *    Сервер нь ЭЦСИЙН шийдвэр гаргагч: клиентийн шалгалт зөвхөн UX.
 */

/** Хүсэлт тутмын хязгаар (эзний өгөгдмөл; тохируулах бол ENV биш энд + add-in ихэр). */
export const EF_LIMITS = {
  /** Нэг хүсэлтэд ил сонгосон хавсралтын тоо. */
  maxAttachments: 5,
  /** Нэг хүсэлтийн бүх хавсралтын нийт байт. */
  maxTotalBytes: 100 * 1024 * 1024,
  /** Энгийн файл (зураг, PDF, лог …) — нэг удаагийн stream PUT. */
  maxOrdinaryBytes: 25 * 1024 * 1024,
  /**
   * Том файлын (RVT/RFA/ZIP) multipart хэсгийн хэмжээ.  R2: сүүлийнхээс бусад хэсэг ИЖИЛ хэмжээтэй, ≥ 5 MiB.
   * 8 MiB = Worker-ийн 100 MB request body хязгаараас хол, 100 MiB файлд ≤ 13 хэсэг.
   */
  partBytes: 8 * 1024 * 1024,
  /** Нөөцөлсөн (reserved/uploading) хавсралт хэдэн минутын дараа хүчингүй болж цэвэрлэгдэх вэ. */
  uploadTtlMinutes: 180,
  /** Илгээгээгүй ноорог хэдэн өдрийн дараа хавсралтаа алдана (мөр нь үлдэнэ, status = draft). */
  draftTtlDays: 30,
  titleMax: 200,
  textMax: 20000,
  shortMax: 4000,
  diagnosticsMaxBytes: 64 * 1024,
  fileNameMax: 180,
} as const;

/** Хүлээн авах өргөтгөл → media type.  Идэвхтэй/гүйцэтгэгдэх төрөл (html, svg, js, exe …) ЗОРИУД байхгүй. */
export const EF_EXTENSIONS: Readonly<Record<string, { mediaType: string; large: boolean; preview: 'image' | 'pdf' | 'text' | null }>> = {
  png: { mediaType: 'image/png', large: false, preview: 'image' },
  jpg: { mediaType: 'image/jpeg', large: false, preview: 'image' },
  jpeg: { mediaType: 'image/jpeg', large: false, preview: 'image' },
  webp: { mediaType: 'image/webp', large: false, preview: 'image' },
  pdf: { mediaType: 'application/pdf', large: false, preview: 'pdf' },
  txt: { mediaType: 'text/plain; charset=utf-8', large: false, preview: 'text' },
  log: { mediaType: 'text/plain; charset=utf-8', large: false, preview: 'text' },
  json: { mediaType: 'application/json', large: false, preview: 'text' },
  zip: { mediaType: 'application/zip', large: true, preview: null },
  rvt: { mediaType: 'application/octet-stream', large: true, preview: null },
  rfa: { mediaType: 'application/octet-stream', large: true, preview: null },
};

export type EfChannel = 'revit' | 'erp';
export type EfSource = 'wall_elevation' | 'revit_tool' | 'erp' | 'other';
export type EfType = 'bug' | 'improvement' | 'question';
export type EfPriority = 'low' | 'normal' | 'high' | 'critical';
export type EfStatus =
  | 'draft'
  | 'received'
  | 'triaged'
  | 'in_progress'
  | 'awaiting_info'
  | 'ready_for_retest'
  | 'resolved'
  | 'duplicate'
  | 'rejected'
  | 'reopened';

export const EF_SOURCES: readonly EfSource[] = ['wall_elevation', 'revit_tool', 'erp', 'other'];
export const EF_TYPES: readonly EfType[] = ['bug', 'improvement', 'question'];
export const EF_PRIORITIES: readonly EfPriority[] = ['low', 'normal', 'high', 'critical'];
export const EF_STATUSES: readonly EfStatus[] = [
  'draft',
  'received',
  'triaged',
  'in_progress',
  'awaiting_info',
  'ready_for_retest',
  'resolved',
  'duplicate',
  'rejected',
  'reopened',
];

/**
 * Reviewer-ийн гараар хийх төлөвийн шилжилт (хязгаарлагдмал автомат).  `draft` ба `received` руу гараар
 * ХЭЗЭЭ Ч буцахгүй (draft = илгээгчийнх, received = submit-ийн үр дүн).  `duplicate` нь заавал `duplicate_of`-той
 * (routes шалгана).  Илгээгчийн зам (retest, info reply) нь өөрийн функцээр — {@link senderTransition}.
 */
const REVIEWER_NEXT: Readonly<Record<EfStatus, readonly EfStatus[]>> = {
  draft: [],
  received: ['triaged', 'in_progress', 'awaiting_info', 'duplicate', 'rejected'],
  triaged: ['in_progress', 'awaiting_info', 'ready_for_retest', 'resolved', 'duplicate', 'rejected'],
  in_progress: ['triaged', 'awaiting_info', 'ready_for_retest', 'resolved', 'duplicate', 'rejected'],
  awaiting_info: ['triaged', 'in_progress', 'resolved', 'duplicate', 'rejected'],
  ready_for_retest: ['in_progress', 'resolved', 'reopened'],
  resolved: ['reopened'],
  duplicate: ['reopened'],
  rejected: ['reopened'],
  reopened: ['triaged', 'in_progress', 'awaiting_info', 'ready_for_retest', 'resolved', 'duplicate', 'rejected'],
};

export function isStatus(v: unknown): v is EfStatus {
  return typeof v === 'string' && (EF_STATUSES as readonly string[]).includes(v);
}

export function reviewerCanMove(from: EfStatus, to: EfStatus): boolean {
  return from !== to && REVIEWER_NEXT[from].includes(to);
}

export function reviewerNextStatuses(from: EfStatus): readonly EfStatus[] {
  return REVIEWER_NEXT[from];
}

/** Илгээгчийн үйлдэл → шинэ төлөв (null = энэ төлөвт хориотой). */
export function senderTransition(
  from: EfStatus,
  action: 'still_broken' | 'works' | 'info',
): EfStatus | null {
  switch (action) {
    case 'still_broken':
      // Засвар бэлэн гэсэн ч засагдаагүй → дахин нээнэ (анхны тайлан, түүх хэвээр).
      return from === 'ready_for_retest' || from === 'resolved' ? 'reopened' : null;
    case 'works':
      return from === 'ready_for_retest' ? 'resolved' : null;
    case 'info':
      // Нэмэлт мэдээлэл хүлээж буй үед хариулсан → reviewer-ийн дараалал руу.
      return from === 'awaiting_info' ? 'triaged' : null;
  }
}

/** Илгээгчид харагдах (дотоод тэмдэглэлгүй) төлөвийн нэр. */
export function publicStatusLabel(s: EfStatus): string {
  switch (s) {
    case 'draft':
      return 'Ноорог';
    case 'received':
      return 'Хүлээн авсан';
    case 'triaged':
    case 'in_progress':
    case 'reopened':
      return 'Шийдвэрлэж байна';
    case 'awaiting_info':
      return 'Нэмэлт мэдээлэл хүлээж байна';
    case 'ready_for_retest':
      return 'Засвар бэлэн — шалгана уу';
    case 'resolved':
      return 'Шийдэгдсэн';
    case 'duplicate':
      return 'Өөр хүсэлттэй нэгтгэсэн';
    case 'rejected':
      return 'Хүлээн аваагүй';
  }
}

export function displayNumber(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) return null;
  return `ПХ-${String(n).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Файлын нэр, төрөл                                                  */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const FORBIDDEN_NAME_CHARS_RE = /[\\/:*?"<>|]/g;

export interface NameCheck {
  ok: boolean;
  name?: string;
  extension?: string;
  error?: string;
}

/**
 * Хэрэглэгчийн файлын нэрийг ЦЭВЭРЛЭНЭ: замын хэсэг, control/bidi тэмдэгт, Windows-д хориотой тэмдэгт хасна,
 * урт хязгаарлана (кирилл нэр хадгалагдана).  Өргөтгөл нь {@link EF_EXTENSIONS}-д байх ёстой.  Цэвэрлэсэн нэр
 * зөвхөн харуулах/татах нэр — объектын түлхүүрт ХЭЗЭЭ Ч орохгүй.
 */
export function sanitizeFileName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Файлын нэр алга' };
  let s = raw.normalize('NFC');
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(CONTROL_RE, '').replace(FORBIDDEN_NAME_CHARS_RE, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!s) return { ok: false, error: 'Файлын нэр хоосон' };
  const dot = s.lastIndexOf('.');
  if (dot <= 0 || dot === s.length - 1) return { ok: false, error: 'Файлын өргөтгөл алга' };
  const ext = s.slice(dot + 1).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(EF_EXTENSIONS, ext)) {
    return { ok: false, error: `«.${ext}» төрлийн файл хүлээн авахгүй` };
  }
  if (s.length > EF_LIMITS.fileNameMax) {
    const keep = EF_LIMITS.fileNameMax - ext.length - 1;
    s = `${s.slice(0, dot).slice(0, Math.max(1, keep)).trim()}.${ext}`;
  }
  return { ok: true, name: s, extension: ext };
}

export interface SizeCheck {
  ok: boolean;
  mode?: 'single' | 'multipart';
  error?: string;
}

/**
 * Нэг хавсралтын хэмжээ + горим.  `existingBytes` = энэ хүсэлтийн бусад (ready/нөөцөлсөн) хавсралтын нийлбэр.
 * Энгийн файл ≤ 25 MiB (single); RVT/RFA/ZIP нь хүсэлтийн үлдсэн нийт (≤ 100 MiB) хүртэл multipart.
 */
export function checkAttachmentSize(ext: string, size: unknown, existingBytes: number, existingCount: number): SizeCheck {
  const spec = EF_EXTENSIONS[ext];
  if (!spec) return { ok: false, error: 'Файлын төрөл хүлээн авахгүй' };
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return { ok: false, error: 'Файлын хэмжээ буруу' };
  if (existingCount >= EF_LIMITS.maxAttachments) return { ok: false, error: `Нэг хүсэлтэд ${EF_LIMITS.maxAttachments}-аас олон файл хавсаргахгүй` };
  const remaining = EF_LIMITS.maxTotalBytes - existingBytes;
  if (size > remaining) return { ok: false, error: 'Хүсэлтийн нийт хавсралт 100 MiB-аас хэтэрнэ' };
  if (!spec.large) {
    if (size > EF_LIMITS.maxOrdinaryBytes) return { ok: false, error: 'Энэ төрлийн файл 25 MiB-аас том байж болохгүй' };
    return { ok: true, mode: 'single' };
  }
  return { ok: true, mode: size > EF_LIMITS.maxOrdinaryBytes ? 'multipart' : 'single' };
}

/** Multipart-ийн хэсгийн тоо ба тухайн хэсгийн ЗААВАЛ хэмжээ (сүүлийнхээс бусад нь ижил). */
export function partCount(size: number, partBytes: number = EF_LIMITS.partBytes): number {
  return Math.max(1, Math.ceil(size / partBytes));
}

export function expectedPartSize(size: number, partNumber: number, partBytes: number = EF_LIMITS.partBytes): number | null {
  const n = partCount(size, partBytes);
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > n) return null;
  return partNumber < n ? partBytes : size - partBytes * (n - 1);
}

const HEX64_RE = /^[0-9a-f]{64}$/;

export function normalizeSha256(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return HEX64_RE.test(s) ? s : null;
}

/* ------------------------------------------------------------------ */
/*  Id, idempotency                                                    */
/* ------------------------------------------------------------------ */

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** Клиентийн idempotency түлхүүр (UUID, ULID …) — 8–80 тэмдэгт, URL-д аюулгүй. */
export function isClientId(v: unknown): v is string {
  return typeof v === 'string' && CLIENT_ID_RE.test(v);
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Тааварлах боломжгүй opaque id: `efr_` / `efa_` + 26 тэмдэгт (≈ 130 бит). */
export function opaqueId(prefix: 'efr' | 'efa'): string {
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  let s = `${prefix}_`;
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

const OPAQUE_RE = /^ef[ra]_[a-z2-9]{26}$/;

export function isOpaqueId(v: unknown, prefix: 'efr' | 'efa'): v is string {
  return typeof v === 'string' && OPAQUE_RE.test(v) && v.startsWith(`${prefix}_`);
}

/** R2 объектын түлхүүр — СЕРВЕР үүсгэнэ, клиентээс ирсэн мөр ХЭЗЭЭ Ч орохгүй. */
export function objectKeyFor(tenant: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const t = (tenant || 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'default';
  return `ef/${t}/${y}/${m}/${opaqueId('efa').slice(4)}`;
}

/** Канон JSON (түлхүүрийг эрэмбэлсэн) — payload hash-д. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/*  Агуулгын цэвэрлэгээ                                                */
/* ------------------------------------------------------------------ */

export interface DraftFields {
  channel: EfChannel;
  source: EfSource;
  tool_id: string | null;
  source_context: string | null;
  type: EfType;
  title: string;
  description: string;
  expected: string | null;
  actual: string | null;
  steps: string | null;
  suggestion: string | null;
  impact: string | null;
  diagnostics_schema: string | null;
  diagnostics_json: string | null;
  revit_year: number | null;
  revit_build: string | null;
  addin_version: string | null;
  addin_sha256: string | null;
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL_RE, (ch) => (ch === '\n' || ch === '\r' || ch === '\t' ? ch : '')).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function token(v: unknown, max: number, re: RegExp): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max && re.test(s) ? s : null;
}

/**
 * Оношилгооны JSON-оос нууц байж болох түлхүүрийг ХАСНА (add-in аль хэдийн цэвэрлэсэн байх ёстой — энэ нь
 * хоёр дахь давхарга).  Түлхүүрийн нэрээр: token, cookie, password, secret, authorization, signature, credential,
 * session, license, key (api_key, private_key …), signed URL-ийн `X-Amz-*`/`sig=` параметр.
 */
const SECRET_KEY_RE = /(token|cookie|passw|secret|authori[sz]ation|signature|credential|session|licen[cs]e|private|api[_-]?key|bearer)/i;
const SIGNED_URL_RE = /([?&](x-amz-[a-z-]+|sig|signature|token|t)=)[^&\s"]+/gi;

export function scrubDiagnostics(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 8) return '[…]';
    if (typeof v === 'string') return v.replace(SIGNED_URL_RE, '$1[хассан]').slice(0, 8000);
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (SECRET_KEY_RE.test(k)) {
          out[k] = '[хассан]';
          continue;
        }
        out[k] = walk(x, depth + 1);
      }
      return out;
    }
    return v;
  };
  const json = JSON.stringify(walk(value, 0));
  if (new TextEncoder().encode(json).length > EF_LIMITS.diagnosticsMaxBytes) return null;
  return json;
}

/** Клиентийн биеэс ноорогийн талбарууд (дутуу/буруу утга → null; заавал талбарын алдааг буцаана). */
export function parseDraftFields(body: Record<string, unknown>, channel: EfChannel): { fields?: DraftFields; error?: string } {
  const source = typeof body.source === 'string' && (EF_SOURCES as readonly string[]).includes(body.source) ? (body.source as EfSource) : null;
  const type = typeof body.type === 'string' && (EF_TYPES as readonly string[]).includes(body.type) ? (body.type as EfType) : null;
  if (!source) return { error: 'Эх сурвалж (source) буруу' };
  if (!type) return { error: 'Төрөл (Алдаа / Сайжруулалт / Асуулт) буруу' };
  const year = typeof body.revit_year === 'number' && Number.isSafeInteger(body.revit_year) && body.revit_year >= 2020 && body.revit_year <= 2040 ? body.revit_year : null;
  const diagnostics = scrubDiagnostics(body.diagnostics ?? body.diagnostics_json ?? null);
  return {
    fields: {
      channel,
      source,
      tool_id: token(body.tool_id, 80, /^[A-Za-z0-9_.:@-]+$/),
      source_context: text(body.source_context, EF_LIMITS.shortMax),
      type,
      title: text(body.title, EF_LIMITS.titleMax) ?? '',
      description: text(body.description, EF_LIMITS.textMax) ?? '',
      expected: text(body.expected, EF_LIMITS.textMax),
      actual: text(body.actual, EF_LIMITS.textMax),
      steps: text(body.steps, EF_LIMITS.textMax),
      suggestion: text(body.suggestion, EF_LIMITS.textMax),
      impact: text(body.impact, EF_LIMITS.shortMax),
      diagnostics_schema: diagnostics ? token(body.diagnostics_schema, 40, /^[a-z0-9._-]+$/i) ?? 'mgl-diag/1' : null,
      diagnostics_json: diagnostics,
      revit_year: year,
      revit_build: token(body.revit_build, 64, /^[A-Za-z0-9 ._()-]+$/),
      addin_version: token(body.addin_version, 40, /^[0-9A-Za-z.+_-]+$/),
      addin_sha256: normalizeSha256(body.addin_sha256),
    },
  };
}

/** Submit-ийн өмнөх эцсийн шалгалт (ноорог бүрэн эсэх). */
export function submitProblem(f: Pick<DraftFields, 'title' | 'description'>): string | null {
  if (!f.title || f.title.trim().length < 3) return 'Гарчиг дор хаяж 3 тэмдэгт байна';
  if (!f.description || f.description.trim().length < 3) return 'Тайлбар бичнэ үү';
  return null;
}

/** Submit-ийн idempotency хэш: агуулга + бэлэн хавсралтын id (эрэмбэлсэн). */
export async function payloadHash(f: DraftFields, attachmentIds: readonly string[]): Promise<string> {
  return sha256Hex(
    canonicalJson({
      f: {
        source: f.source,
        tool_id: f.tool_id,
        type: f.type,
        title: f.title,
        description: f.description,
        expected: f.expected,
        actual: f.actual,
        steps: f.steps,
        suggestion: f.suggestion,
        impact: f.impact,
      },
      a: [...attachmentIds].sort(),
    }),
  );
}
