/**
 * Дотоод журам (`internal_rules`) — цэвэр туслахууд.
 *
 * `routes/internalRules.ts` энэ файлын функцуудыг л хэрэглэнэ; энд D1, R2,
 * Hono огт байхгүй тул `node --test` дээр шууд шалгагдана.
 *
 * ЗАГВАР (миграц 0330):
 *   internal_rules            — админы АЖЛЫН ХУВЬ (title/body чөлөөтэй засагдана)
 *   internal_rule_versions    — НИЙТЛЭГДСЭН АГШИН (append-only; ажилтан ҮҮНИЙГ л уншина)
 *   internal_rule_signatures  — (version_id × user_id) НЭГ гарын үсэг
 *
 * Гарын үсэг нь ХУВИЛБАРТ холбогдоно: журмын бичвэр өөрчлөгдөж дахин
 * нийтлэгдвэл шинэ хувилбар үүсэж, ажилтан бүр ДАХИН гарын үсэг зурна.
 * Хуучин хувилбарын гарын үсэг устахгүй — «тэр өдөр тэр бичвэрт» гэсэн
 * түүх хэвээр.
 */
import type { UserRole } from '../types';
import { htmlToText, sanitizeHtml } from './announcements';

/** Гарчгийн дээд урт. */
export const RULE_TITLE_MAX = 200;
/** Бүтэн дотоод журам урт баримт (бүлэг · заалт) тул гарын авлагын 20k хангалтгүй. */
export const RULE_BODY_MAX = 200_000;
/**
 * HTML биеийн дээд урт (ЦЭВЭРЛЭСНИЙ ДАРАА).  Word-оос оруулсан 30-40 хуудас
 * журам таг, inline style-тайгаа 200k-г амархан давдаг — «Мэдээ, зарлал»-ын
 * `ANNOUNCEMENT_BODY_MAX`-тай ижил.  Түүхий оролтыг 2 дахин өгөөмөр хүлээж
 * авна: засварлагчийн `innerHTML` цэвэрлэгдэхдээ багасдаг.
 */
export const RULE_HTML_BODY_MAX = 500_000;
const RULE_HTML_RAW_MAX = RULE_HTML_BODY_MAX * 2;

/**
 * Биеийн формат (миграц 0347).  `markdown` = 0330-ийн хуучин textarea-ийн
 * мөр (handbook-ийн жижиг рендерлэгчээр харагдана); `html` = «Мэдээ, зарлал»-тай
 * ижил rich-text засварлагч, СЕРВЕР цэвэрлэнэ (`announcements.ts sanitizeHtml`).
 * Засварлагч хуучин markdown журмыг нээхэд HTML болгож хөрвүүлдэг тул
 * хадгалмагц `html` болно.
 */
export const RULE_BODY_FORMATS = ['markdown', 'html'] as const;
export type RuleBodyFormat = (typeof RULE_BODY_FORMATS)[number];

export const RULE_STATUSES = ['draft', 'published', 'archived'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/**
 * Гарын үсэг ЗУРАХ ЁСТОЙ ажилтны role-ууд (админы «хэн зурсан/зураагүй»
 * жагсаалтын популяци).
 *
 * `worker` ОРООГҮЙ: `lib/workerScope.ts` энэ route-ыг түүнд нээдэггүй,
 * профайлын гарын үсэг зурах UI ч байхгүй.  `client` — гадны хүн.
 * Уншигчийн хаалт (`canReadRules`) мөн ижил жагсаалт.
 */
export const RULE_ROSTER_ROLES: readonly UserRole[] = ['admin', 'senior', 'engineer', 'architect'];

export function canReadRules(role: string | null | undefined): boolean {
  return (RULE_ROSTER_ROLES as readonly string[]).includes(role ?? '');
}

/** SQL `IN (...)` хэлбэрийн литерал — role-ууд тогтмол жагсаалтаас тул bind шаардлагагүй. */
export const RULE_ROSTER_ROLES_SQL = RULE_ROSTER_ROLES.map((r) => `'${r}'`).join(',');

/* ------------------------------------------------------------------ */
/*  Агуулгын хэш                                                       */
/* ------------------------------------------------------------------ */

async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Дурын байтын SHA-256 (гарын үсгийн PNG-д). */
export const sha256HexOf = sha256Hex;

/**
 * Нийтлэгдсэн бичвэрийн хэш — гарчиг + бие (+ формат + хавсралт).  Гарын
 * үсгийн мөр энэ хэшийг хуулж авдаг тул хувилбарын дугаарыг мартсан ч ЯГ ямар
 * бичвэр, ЯМАР ФАЙЛД гарын үсэг зурсныг нотолно.  `\r\n` → `\n` — Windows
 * textarea-аас ирсэн мөр төгсгөл хэшийг өөрчлөх ёсгүй.
 *
 * ⚠️ Нэмэлт хэсгүүд нь ЗӨВХӨН байгаа үед л залгагдана: 0330-ийн markdown +
 * хавсралтгүй мөрийн хэш миграц 0347-ын дараа ч байт-ижил хэвээр (эс бөгөөс
 * тэдний гарын үсэг «нийтлээгүй өөрчлөлттэй» мэт харагдана).  Хавсралтыг
 * sha256-аар нь тоолно — файлын нэр ч орно (ажилтанд харагдах мэдээлэл).
 */
export async function contentHashOf(
  titleMn: string,
  bodyMd: string,
  opts: {
    format?: RuleBodyFormat;
    attachments?: readonly Pick<RuleAttachment, 'sha256' | 'size' | 'name'>[];
  } = {},
): Promise<string> {
  let text = `${titleMn.trim()}\n\n${normalizeNewlines(bodyMd)}`;
  if (opts.format === 'html') text += '\n\n[format:html]';
  if (opts.attachments && opts.attachments.length > 0) {
    text += `\n\n[files]\n${opts.attachments.map((a) => `${a.sha256} ${a.size} ${a.name}`).join('\n')}`;
  }
  return sha256Hex(new TextEncoder().encode(text));
}

export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

/* ------------------------------------------------------------------ */
/*  Оролт цэвэрлэх                                                     */
/* ------------------------------------------------------------------ */

export interface RuleInput {
  title_mn: string;
  title_en: string | null;
  body_md: string;
  body_format: RuleBodyFormat;
  sort_order: number;
}

export interface RuleInputBody {
  title_mn?: unknown;
  title_en?: unknown;
  body_md?: unknown;
  body_format?: unknown;
  sort_order?: unknown;
}

/**
 * Админы create/update биеийг шалгана.  `partial` (PUT) үед байхгүй талбар
 * `existing`-ээс өвлөгдөнө — гарын авлагын `sanitizeBody`-той ижил хэлбэр.
 */
export function sanitizeRuleInput(
  body: RuleInputBody,
  existing: RuleInput | null,
): { input: RuleInput } | { error: string } {
  const base: RuleInput = existing ?? {
    title_mn: '',
    title_en: null,
    body_md: '',
    body_format: 'markdown',
    sort_order: 0,
  };

  let titleMn = base.title_mn;
  if (body.title_mn !== undefined) {
    if (typeof body.title_mn !== 'string') return { error: 'title_mn нь тэмдэгт мөр байх ёстой' };
    titleMn = body.title_mn.trim().slice(0, RULE_TITLE_MAX);
  }
  if (!titleMn) return { error: 'Гарчиг (title_mn) шаардлагатай' };

  let titleEn = base.title_en;
  if (body.title_en !== undefined) {
    if (body.title_en === null) titleEn = null;
    else if (typeof body.title_en === 'string') {
      const trimmed = body.title_en.trim().slice(0, RULE_TITLE_MAX);
      titleEn = trimmed.length > 0 ? trimmed : null;
    } else return { error: 'title_en нь тэмдэгт мөр эсвэл null байх ёстой' };
  }

  let format = base.body_format;
  if (body.body_format !== undefined) {
    if (typeof body.body_format !== 'string' || !(RULE_BODY_FORMATS as readonly string[]).includes(body.body_format)) {
      return { error: 'body_format нь markdown | html байх ёстой' };
    }
    format = body.body_format as RuleBodyFormat;
  }

  let bodyMd = base.body_md;
  if (body.body_md !== undefined) {
    if (typeof body.body_md !== 'string') return { error: 'body_md нь тэмдэгт мөр байх ёстой' };
    if (format === 'html') {
      if (body.body_md.length > RULE_HTML_RAW_MAX) {
        return { error: `Агуулга хэт урт байна (дээд тал нь ${RULE_HTML_BODY_MAX} тэмдэгт)` };
      }
      bodyMd = sanitizeHtml(normalizeNewlines(body.body_md));
      if (bodyMd.length > RULE_HTML_BODY_MAX) {
        return { error: `Агуулга хэт урт байна (дээд тал нь ${RULE_HTML_BODY_MAX} тэмдэгт)` };
      }
    } else {
      if (body.body_md.length > RULE_BODY_MAX) {
        return { error: `Агуулга хэт урт байна (дээд тал нь ${RULE_BODY_MAX} тэмдэгт)` };
      }
      bodyMd = normalizeNewlines(body.body_md);
    }
  } else if (format !== base.body_format) {
    // Формат л солигдож, бие ирээгүй — markdown бичвэрийг HTML гэж (эсвэл
    // эсрэгээр) уншвал `<`/`&` агуулсан мөр эвдэрнэ.  Засварлагч хоёуланг
    // ҮРГЭЛЖ хамт илгээдэг.
    return { error: 'body_format-ыг солихдоо body_md-г хамт илгээнэ үү' };
  }

  let sortOrder = base.sort_order;
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order)) {
      return { error: 'sort_order нь бүхэл тоо байх ёстой' };
    }
    sortOrder = body.sort_order;
  }

  return {
    input: { title_mn: titleMn, title_en: titleEn, body_md: bodyMd, body_format: format, sort_order: sortOrder },
  };
}

/**
 * Бие хоосон уу — нийтлэх хаалт.  HTML-д зөвхөн таг (`<p><br></p>`) үлдсэн бол
 * хоосон; зураг, хүснэгт байвал агуулгатай.  Route нь хавсралттай бол хоосон
 * биеийг ч нийтлүүлнэ: журам нь ганц PDF/Word файл байх нь ердийн.
 */
export function isRuleBodyEmpty(body: string, format: RuleBodyFormat): boolean {
  if (format === 'html') return htmlToText(body).length === 0 && !/<(img|table)\b/i.test(body);
  return body.trim().length === 0;
}

/* ------------------------------------------------------------------ */
/*  Файл хавсралт (миграц 0347)                                        */
/* ------------------------------------------------------------------ */

/**
 * Хавсралтын R2 угтвар — ХУВИЙН `MEETING_BUCKET`.  `/media/` нь нэвтрэлтгүй
 * тул компанийн дотоод журам тэнд байж БОЛОХГҮЙ (CLAUDE.md аюулгүй байдал #2).
 */
export const RULE_FILE_PREFIX = 'rule-files/';
/**
 * Нэг файлын дээд хэмжээ.  Upload нь `formData()`-аар бүтнээрээ Worker-ийн
 * санах ойд орж (128 MB), дээр нь sha256 тооцоолдог тул ~30 MB аюулгүй хязгаар;
 * сканердсан журмын PDF ихэвчлэн 5-20 MB.
 */
export const RULE_FILE_MAX_BYTES = 30 * 1024 * 1024;
/** Нэг журмын хавсралтын тоо. */
export const RULE_FILE_MAX_COUNT = 20;
/** Хавсралтын нэрийн дээд урт. */
export const RULE_FILE_NAME_MAX = 200;

export interface RuleAttachment {
  /** Тогтвортой id — R2 түлхүүрийн сүүлийн хэсэг (`<ms>-<rand>`); татах замд. */
  id: string;
  key: string;
  name: string;
  size: number;
  content_type: string;
  sha256: string;
}

/**
 * Зөвшөөрөгдсөн өргөтгөл → MIME.  Цагаан жагсаалт: HTML/SVG/JS зэрэг нь API-ийн
 * origin-оос татагдахдаа скрипт ажиллуулах эрсдэлтэй, exe/bat нь журамд утгагүй.
 * MIME-ийг клиентээс БИШ өргөтгөлөөс тогтооно.
 */
export const RULE_FILE_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  rtf: 'application/rtf',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  zip: 'application/zip',
};

/** Файлын нэрээс зөвшөөрөгдсөн өргөтгөл (жижиг үсгээр), эс бөгөөс null. */
export function ruleFileExtOf(name: string): string | null {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  const ext = m?.[1]?.toLowerCase();
  return ext && Object.hasOwn(RULE_FILE_TYPES, ext) ? ext : null;
}

/**
 * Харуулах нэр — зам, хяналтын тэмдэгт хасаж, урт хязгаарлана.  Өргөтгөл
 * ҮЛДЭНЭ (таслахдаа нэрийн голоос).  Кирилл нэр хэвээр.
 */
export function cleanRuleFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= RULE_FILE_NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 6 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, RULE_FILE_NAME_MAX - ext.length) + ext;
}

export function ruleFileObjectKey(
  ext: string,
  now = Date.now(),
  rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8),
): string {
  return `${RULE_FILE_PREFIX}${now}-${rand}.${ext}`;
}

/** `rule-files/<ms>-<rand>.<ext>` → `<ms>-<rand>`; хэлбэр таарахгүй бол null. */
export function ruleFileIdOf(key: string): string | null {
  const m = /^rule-files\/(\d{10,15}-[0-9a-f]{8})\.[a-z0-9]{1,5}$/.exec(key);
  return m?.[1] ?? null;
}

/** Татах замын `:fileId` — `ruleFileIdOf`-ийн гаралттай ижил хэлбэр. */
export function isRuleFileId(raw: string | undefined): raw is string {
  return typeof raw === 'string' && /^\d{10,15}-[0-9a-f]{8}$/.test(raw);
}

function isAttachment(a: unknown): a is RuleAttachment {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.key === 'string' &&
    typeof o.name === 'string' &&
    typeof o.size === 'number' &&
    typeof o.content_type === 'string' &&
    typeof o.sha256 === 'string'
  );
}

/** DB-ийн `attachments_json` → массив.  Эвдэрсэн/хоосон мөр → []. */
export function parseAttachmentsJson(raw: string | null | undefined): RuleAttachment[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter(isAttachment) : [];
  } catch {
    return [];
  }
}

export function serializeAttachments(list: readonly RuleAttachment[]): string | null {
  return list.length > 0 ? JSON.stringify(list) : null;
}

/** Ажилтанд явах хэлбэр — R2 түлхүүр ГАРАХГҮЙ. */
export function publicAttachment(a: RuleAttachment) {
  return { id: a.id, name: a.name, size: a.size, content_type: a.content_type, sha256: a.sha256 };
}

export interface AttachmentRef {
  key: string;
  name: string | null;
}

/**
 * PUT/POST-ийн `attachments` талбарыг шалгана — `[{key, name?}]`.  Хэмжээ,
 * sha256, MIME-ийг клиентээс ХҮЛЭЭЖ АВАХГҮЙ: route нь R2 `head`-ээс (upload
 * үед сервер өөрөө бичсэн мета) дүүргэнэ.  Энд зөвхөн хэлбэр, угтвар,
 * давхардал, тоо.
 */
export function parseAttachmentRefs(raw: unknown): { refs: AttachmentRef[] } | { error: string } {
  if (raw === null) return { refs: [] };
  if (!Array.isArray(raw)) return { error: 'attachments нь массив байх ёстой' };
  if (raw.length > RULE_FILE_MAX_COUNT) return { error: `Хавсралт дээд тал нь ${RULE_FILE_MAX_COUNT} файл` };
  const refs: AttachmentRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const obj: unknown = typeof item === 'string' ? { key: item } : item;
    if (!obj || typeof obj !== 'object') return { error: 'attachments-ийн мөр буруу' };
    const key = (obj as { key?: unknown }).key;
    if (typeof key !== 'string' || ruleFileIdOf(key) === null) return { error: 'Хавсралтын түлхүүр буруу' };
    if (seen.has(key)) continue;
    seen.add(key);
    const rawName = (obj as { name?: unknown }).name;
    const name = typeof rawName === 'string' ? cleanRuleFileName(rawName) : '';
    refs.push({ key, name: name || null });
  }
  return { refs };
}

/**
 * Ажлын хувиас хасагдсан файлуудын дундаас АЛЬ Ч хувилбарт (нийтлэгдсэн
 * агшинд) ишлэгдээгүйг л устгана — нийтлэгдсэн хувилбарын файл нь гарын
 * үсгийн нотолгоо тул хэзээ ч устахгүй.
 */
export function orphanedKeys(
  before: readonly RuleAttachment[],
  after: readonly RuleAttachment[],
  inVersions: ReadonlySet<string>,
): string[] {
  const keep = new Set(after.map((a) => a.key));
  return before.map((a) => a.key).filter((k) => !keep.has(k) && !inVersions.has(k));
}

/* ------------------------------------------------------------------ */
/*  Гарын үсгийн R2 түлхүүр                                            */
/* ------------------------------------------------------------------ */

/**
 * Хувийн bucket (`MEETING_BUCKET`) дахь гарын үсгийн хуулбарын түлхүүр.
 *
 * ЯАГААД ХУУЛБАР: профайлын `users.signature_url` нь нийтийн `/media/`
 * объект бөгөөд ажилтан гарын үсгээ СОЛИХОД `lib/mediaReplace.ts` хуучин
 * объектыг устгадаг (ишлэлийн тоо `users`/`projects`/… л шалгадаг).
 * Баталгааны мөр тэр объект руу заавал үлдэх ёсгүй — тиймээс гарын үсэг
 * зурах МӨЧИД байтыг өөрийн угтвар руу хуулж, sha256-г мөрөнд хадгална.
 */
export function signatureObjectKey(
  ruleId: number,
  versionId: number,
  userId: number,
  ext: 'png' | 'jpg' | 'webp',
  now = Date.now(),
  rand = crypto.randomUUID().slice(0, 8),
): string {
  return `rule-signatures/${ruleId}/${versionId}-${userId}-${now}-${rand}.${ext}`;
}

/** R2 объектын contentType → файлын өргөтгөл (зөвхөн зургийн 3 төрөл). */
export function signatureExtOf(contentType: string | null | undefined): 'png' | 'jpg' | 'webp' | null {
  const ct = (contentType ?? '').toLowerCase().split(';')[0]?.trim();
  if (ct === 'image/png') return 'png';
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg';
  if (ct === 'image/webp') return 'webp';
  return null;
}

/** Өргөтгөл → contentType (хувийн bucket-д хадгалах, дамжуулахад). */
export function signatureContentTypeOf(ext: 'png' | 'jpg' | 'webp'): string {
  return ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
}

/**
 * Байтын толгойгоор зураг мөн эсэхийг батална — R2-ийн contentType нь
 * upload үеийн клиентийн мэдэгдэл тул дангаараа итгэх ёсгүй.
 */
export function sniffImageExt(bytes: ArrayBuffer): 'png' | 'jpg' | 'webp' | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'webp';
  return null;
}

/* ------------------------------------------------------------------ */
/*  Хувилбар / төлөв                                                   */
/* ------------------------------------------------------------------ */

/**
 * Ажлын хувь нь нийтлэгдсэн хувилбараас ялгаатай юу — админы жагсаалтад
 * «нийтлээгүй өөрчлөлттэй» шошго, `publish`-ийн UNCHANGED хаалт хоёулаа
 * энэ нэг харьцуулалт.
 */
export function hasUnpublishedChanges(
  workingHash: string,
  currentVersionHash: string | null | undefined,
): boolean {
  return currentVersionHash == null || workingHash !== currentVersionHash;
}

/**
 * Ажилтны гарын үсгийн хүсэлтийн биеийг шалгана.  `confirmed === true` нь UI-н
 * «уншиж танилцсан» нүд; `version_id` + `content_hash` нь «ЯГ энэ бичвэрийг
 * харсан» гэсэн нотолгоо — сервер одоогийн хувилбартай тулгана.
 */
export function parseSignBody(body: unknown):
  | { versionId: number; contentHash: string }
  | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Хүсэлтийн бие буруу' };
  const b = body as Record<string, unknown>;
  if (b.confirmed !== true) return { error: 'Уншиж танилцсанаа баталгаажуулна уу (confirmed)' };
  const versionId = typeof b.version_id === 'number' ? b.version_id : Number(b.version_id);
  if (!Number.isInteger(versionId) || versionId <= 0) return { error: 'version_id буруу' };
  const contentHash = typeof b.content_hash === 'string' ? b.content_hash.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(contentHash)) return { error: 'content_hash буруу' };
  return { versionId, contentHash };
}
