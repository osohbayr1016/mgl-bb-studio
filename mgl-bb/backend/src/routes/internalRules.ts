/**
 * Дотоод журам — ажилтан уншиж, танилцсанаа ГАРЫН ҮСГЭЭР баталгаажуулна.
 * Миграц 0330, цэвэр туслахууд `lib/internalRules.ts`.
 *
 *   Ажилтан (admin | senior | engineer | architect — `canReadRules`):
 *   GET    /api/internal-rules                     — нийтлэгдсэн журмууд + миний төлөв
 *   GET    /api/internal-rules/:id                 — одоогийн ХУВИЛБАРЫН бичвэр + миний гарын үсэг
 *   POST   /api/internal-rules/:id/sign            — {version_id, content_hash, confirmed:true}
 *   GET    /api/internal-rules/signatures/:sigId/image — зурсан гарын үсгийн зураг (өөрийнх | admin)
 *
 *   Админ (`requireAdmin`):
 *   GET    /api/internal-rules/admin               — БҮХ журам (draft/archived орно) + тоолуур
 *   POST   /api/internal-rules                     — шинэ (draft)
 *   PUT    /api/internal-rules/:id                 — ажлын хувийг засах (нийтлэгдсэнийг ХӨНДӨХГҮЙ)
 *   POST   /api/internal-rules/:id/publish         — ажлын хувийг ШИНЭ ХУВИЛБАР болгон нийтлэх
 *   POST   /api/internal-rules/:id/archive         — ажилтнаас нуух (гарын үсэг хэвээр)
 *   POST   /api/internal-rules/:id/unarchive
 *   DELETE /api/internal-rules/:id                 — зөвхөн гарын үсэггүй журам
 *   GET    /api/internal-rules/:id/signatures      — хэн зурсан / зураагүй (одоогийн хувилбар)
 *   POST   /api/internal-rules/files               — хавсралт байршуулах (multipart `file`)
 *
 *   Хавсралт татах (миграц 0347):
 *   GET    /api/internal-rules/:id/files/:fileId   — ажилтан: ОДООГИЙН хувилбарын файл;
 *                                                    admin: ажлын хувь + бүх хувилбарынх
 *
 * Бие нь 0347-оос `body_format = 'html'` (мэдээ, зарлалын засварлагч, сервер
 * `sanitizeHtml`-ээр цэвэрлэнэ); 0330-ийн мөрүүд `markdown` хэвээр уншигдана.
 * Хавсралт нь ХУВИЙН `MEETING_BUCKET`-ийн `rule-files/`-д — нийтлэхэд
 * хувилбарын мөрөнд хуулагдаж, content_hash-д sha256-аараа орно: ажилтан
 * ЯГ тэр файлд гарын үсэг зурсан гэдгийг нотолно.
 *
 * Гарын үсгийн эх нь ПРОФАЙЛЫН `users.signature_url` (эзний шийдвэр
 * 2026-09-21: тусдаа зурах алхамгүй).  Гэхдээ мөр нь тэр URL руу ЗААДАГГҮЙ —
 * гарын үсэг зурах мөчид байтыг хувийн bucket руу хуулж, sha256-г хадгална
 * (`lib/mediaReplace.ts` профайлын хуучин объектыг устгадаг тул).
 *
 * `client` нь `lib/clientScope.ts`-ийн цагаан жагсаалтад ЭНЭ угтвар байхгүй тул
 * 403; `worker` мөн `lib/workerScope.ts`-ээр 403.  Доорх `canReadRules`
 * шалгалт нь тэр хоёр хаалтын ХОЁРДУГААР давхарга.
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { streamPrivateObject } from '../lib/privateFileStream';
import { mediaKeyOfUrl } from '../lib/mediaReplace';
import { createNotification } from '../lib/notify';
import {
  RULE_FILE_MAX_BYTES,
  RULE_FILE_TYPES,
  RULE_ROSTER_ROLES_SQL,
  canReadRules,
  cleanRuleFileName,
  contentHashOf,
  hasUnpublishedChanges,
  isRuleBodyEmpty,
  isRuleFileId,
  orphanedKeys,
  parseAttachmentRefs,
  parseAttachmentsJson,
  parseSignBody,
  publicAttachment,
  ruleFileExtOf,
  ruleFileIdOf,
  ruleFileObjectKey,
  sanitizeRuleInput,
  serializeAttachments,
  sha256HexOf,
  signatureContentTypeOf,
  signatureObjectKey,
  sniffImageExt,
} from '../lib/internalRules';
import type { AttachmentRef, RuleAttachment, RuleBodyFormat, RuleStatus } from '../lib/internalRules';

const rules = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Энэ router-ийн алдаа JSON хэлбэртэй — index.ts-д `app.onError` байхгүй тул
// үндсэн апп текст «Internal Server Error» өгдөг; frontend `apiFetch` JSON хүлээнэ.
rules.onError((err, c) => {
  console.error('[internal-rules]', err);
  return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
});

/* ------------------------------------------------------------------ */
/*  Мөрийн хэлбэрүүд                                                   */
/* ------------------------------------------------------------------ */

interface RuleRow {
  id: number;
  title_mn: string;
  title_en: string | null;
  body_md: string;
  body_format: RuleBodyFormat;
  attachments_json: string | null;
  status: RuleStatus;
  current_version_id: number | null;
  sort_order: number;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: number;
  rule_id: number;
  version: number;
  title_mn: string;
  title_en: string | null;
  body_md: string;
  body_format: RuleBodyFormat;
  attachments_json: string | null;
  content_hash: string;
  published_by_id: number | null;
  published_at: string;
}

interface SignatureRow {
  id: number;
  rule_id: number;
  version_id: number;
  user_id: number;
  content_hash: string;
  signature_key: string;
  signature_sha256: string;
  signature_source: string;
  signed_at: string;
}

const RULE_COLS =
  'id, title_mn, title_en, body_md, body_format, attachments_json, status, current_version_id, sort_order, created_by_id, created_at, updated_at';
const VERSION_COLS =
  'id, rule_id, version, title_mn, title_en, body_md, body_format, attachments_json, content_hash, published_by_id, published_at';
const SIG_COLS =
  'id, rule_id, version_id, user_id, content_hash, signature_key, signature_sha256, signature_source, signed_at';

/** Гарын үсгийн мөрийг клиент рүү — R2 түлхүүр ХЭЗЭЭ Ч гарахгүй (зураг нь authed route-оор). */
function shapeSignature(s: SignatureRow) {
  return {
    id: s.id,
    rule_id: s.rule_id,
    version_id: s.version_id,
    user_id: s.user_id,
    content_hash: s.content_hash,
    signature_sha256: s.signature_sha256,
    signature_source: s.signature_source,
    signed_at: s.signed_at,
    image_url: `/internal-rules/signatures/${s.id}/image`,
  };
}

function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function loadRule(db: D1Database, id: number): Promise<RuleRow | null> {
  return db.prepare(`SELECT ${RULE_COLS} FROM internal_rules WHERE id = ?`).bind(id).first<RuleRow>();
}

/**
 * Админд явах журмын мөр — `attachments_json` задлагдаж `attachments` болно
 * (R2 түлхүүртэй: засварлагч хадгалахдаа түлхүүрээр нь буцааж илгээдэг).
 */
function shapeRule<T extends RuleRow>(rule: T) {
  const { attachments_json, ...rest } = rule;
  return { ...rest, attachments: parseAttachmentsJson(attachments_json) };
}

/** Ажлын хувийн хэш — нийтлэгдсэн хувилбарын `content_hash`-тай ижил томьёо. */
function workingHashOf(rule: Pick<RuleRow, 'title_mn' | 'body_md' | 'body_format' | 'attachments_json'>) {
  return contentHashOf(rule.title_mn, rule.body_md, {
    format: rule.body_format,
    attachments: parseAttachmentsJson(rule.attachments_json),
  });
}

/** Журмын БҮХ хувилбарт ишлэгдсэн хавсралтын түлхүүрүүд (нотолгоо — устгахгүй). */
async function versionFileKeys(db: D1Database, ruleId: number): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT attachments_json FROM internal_rule_versions WHERE rule_id = ? AND attachments_json IS NOT NULL')
    .bind(ruleId)
    .all<{ attachments_json: string | null }>();
  const keys = new Set<string>();
  for (const r of results ?? []) for (const a of parseAttachmentsJson(r.attachments_json)) keys.add(a.key);
  return keys;
}

/**
 * `[{key, name?}]` → бүрэн хавсралтын мөр.  Хэмжээ, sha256, MIME-ийг R2-ийн
 * мета (upload үед СЕРВЕР бичсэн) -ээс авна — клиентийн утгад итгэхгүй.
 * Аль хэдийн ажлын хувьд байгаа түлхүүрийг дахин `head` хийхгүй.
 */
async function resolveAttachments(
  bucket: R2Bucket,
  refs: readonly AttachmentRef[],
  existing: readonly RuleAttachment[],
): Promise<{ list: RuleAttachment[] } | { error: string }> {
  const known = new Map(existing.map((a) => [a.key, a]));
  const list: RuleAttachment[] = [];
  for (const ref of refs) {
    const prev = known.get(ref.key);
    if (prev) {
      list.push(ref.name ? { ...prev, name: ref.name } : prev);
      continue;
    }
    const id = ruleFileIdOf(ref.key);
    const obj = id ? await bucket.head(ref.key) : null;
    const sha = obj?.customMetadata?.sha256;
    if (!id || !obj || !sha) return { error: 'Хавсралтын файл олдсонгүй — дахин байршуулна уу' };
    let storedName = '';
    try {
      storedName = decodeURIComponent(obj.customMetadata?.name ?? '');
    } catch {
      storedName = '';
    }
    const ext = ref.key.split('.').pop() ?? '';
    list.push({
      id,
      key: ref.key,
      name: ref.name ?? (cleanRuleFileName(storedName) || `file.${ext}`),
      size: obj.size,
      content_type: RULE_FILE_TYPES[ext] ?? 'application/octet-stream',
      sha256: sha,
    });
  }
  return { list };
}

async function loadVersion(db: D1Database, id: number): Promise<VersionRow | null> {
  return db
    .prepare(`SELECT ${VERSION_COLS} FROM internal_rule_versions WHERE id = ?`)
    .bind(id)
    .first<VersionRow>();
}

/* ------------------------------------------------------------------ */
/*  Ажилтан                                                            */
/* ------------------------------------------------------------------ */

// GET /api/internal-rules — нийтлэгдсэн журмууд + миний гарын үсгийн төлөв.
rules.get('/', async (c) => {
  const user = c.get('user');
  if (!canReadRules(user.role)) return c.json({ error: 'Forbidden' }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.sort_order,
            v.id AS version_id, v.version, v.title_mn, v.title_en, v.published_at, v.content_hash,
            length(v.body_md) AS body_length, v.body_format,
            COALESCE(json_array_length(v.attachments_json), 0) AS attachment_count,
            s.id AS signature_id, s.signed_at
       FROM internal_rules r
       JOIN internal_rule_versions v ON v.id = r.current_version_id
       LEFT JOIN internal_rule_signatures s
              ON s.version_id = v.id AND s.user_id = ?
      WHERE r.status = 'published'
      ORDER BY r.sort_order, r.id`,
  )
    .bind(user.sub)
    .all<{
      id: number;
      sort_order: number;
      version_id: number;
      version: number;
      title_mn: string;
      title_en: string | null;
      published_at: string;
      content_hash: string;
      body_length: number;
      body_format: RuleBodyFormat;
      attachment_count: number;
      signature_id: number | null;
      signed_at: string | null;
    }>();

  const list = results ?? [];
  return c.json({
    rules: list,
    pending_count: list.filter((r) => r.signature_id === null).length,
  });
});

// GET /api/internal-rules/admin — БҮХ журам + тоолуур (admin).
// ⚠️ `/:id`-ээс ДЭЭР — эс тэгвэл «admin» нь id гэж уншигдана.
rules.get('/admin', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.title_mn, r.title_en, r.body_md, r.body_format, r.attachments_json, r.status,
            r.current_version_id, r.sort_order, r.created_by_id, r.created_at, r.updated_at,
            v.version AS current_version, v.content_hash AS current_hash, v.published_at,
            (SELECT COUNT(*) FROM internal_rule_signatures s WHERE s.version_id = r.current_version_id) AS signed_count,
            (SELECT COUNT(*) FROM users u
              WHERE u.status = 'active' AND u.is_support = 0
                AND u.role IN (${RULE_ROSTER_ROLES_SQL})) AS roster_count,
            (SELECT COUNT(*) FROM internal_rule_signatures s WHERE s.rule_id = r.id) AS total_signatures
       FROM internal_rules r
       LEFT JOIN internal_rule_versions v ON v.id = r.current_version_id
      ORDER BY r.sort_order, r.id`,
  ).all<
    RuleRow & {
      current_version: number | null;
      current_hash: string | null;
      published_at: string | null;
      signed_count: number;
      roster_count: number;
      total_signatures: number;
    }
  >();

  const list = await Promise.all(
    (results ?? []).map(async (r) => {
      const workingHash = await workingHashOf(r);
      return {
        ...shapeRule(r),
        working_hash: workingHash,
        has_unpublished_changes: hasUnpublishedChanges(workingHash, r.current_hash),
      };
    }),
  );
  return c.json({ rules: list });
});

// GET /api/internal-rules/signatures/:sigId/image — зурсан гарын үсгийн зураг.
// Өөрийн гарын үсэг эсвэл admin.  Хувийн bucket тул `/media/` биш.
rules.get('/signatures/:sigId/image', async (c) => {
  const user = c.get('user');
  const sigId = parseId(c.req.param('sigId'));
  if (sigId === null) return c.json({ error: 'Invalid id' }, 400);
  const sig = await c.env.DB.prepare(`SELECT ${SIG_COLS} FROM internal_rule_signatures WHERE id = ?`)
    .bind(sigId)
    .first<SignatureRow>();
  if (!sig) return c.json({ error: 'Not found' }, 404);
  if (sig.user_id !== user.sub && user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  const ext = sig.signature_key.split('.').pop() ?? 'png';
  const ct = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return streamPrivateObject(c.env, sig.signature_key, `signature-${sig.id}.${ext}`, ct, { inline: true });
});

// POST /api/internal-rules/files — хавсралт байршуулах (admin, multipart `file`).
// Хувийн bucket руу; sha256-г СЕРВЕР тооцоолж R2 мета-д бичнэ — дараа нь
// PUT/POST нь зөвхөн түлхүүрийг илгээж, хэмжээ/хэшийг эндээс уншина.
// Журамд холбогдоогүй (ажлын хувьд хадгалагдаагүй) файл өнчин үлдэж болно —
// хэмжээ нь жижиг тул цэвэрлэгч cron нэмээгүй.
rules.post('/files', requireAdmin(), async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return c.json({ error: 'file талбар байхгүй' }, 400);
  const name = cleanRuleFileName(file.name || '');
  const ext = ruleFileExtOf(name);
  if (!name || !ext) {
    return c.json(
      {
        error: 'Энэ төрлийн файл хавсаргах боломжгүй (PDF, Word, Excel, PowerPoint, зураг, txt/csv, zip)',
        code: 'FILE_TYPE',
      },
      400,
    );
  }
  if (file.size === 0) return c.json({ error: 'Файл хоосон байна' }, 400);
  if (file.size > RULE_FILE_MAX_BYTES) {
    return c.json(
      { error: `Файл ${Math.round(RULE_FILE_MAX_BYTES / (1024 * 1024))} MB-аас том байна`, code: 'FILE_TOO_LARGE' },
      413,
    );
  }
  const bytes = await file.arrayBuffer();
  const sha = await sha256HexOf(bytes);
  const key = ruleFileObjectKey(ext);
  const contentType = RULE_FILE_TYPES[ext] ?? 'application/octet-stream';
  await c.env.MEETING_BUCKET.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      sha256: sha,
      // R2 мета нь HTTP толгойн утга — кирилл нэрийг кодлож хадгална.
      name: encodeURIComponent(name),
      uploaded_by: String(c.get('user').sub),
    },
  });
  const attachment: RuleAttachment = {
    id: ruleFileIdOf(key) ?? '',
    key,
    name,
    size: bytes.byteLength,
    content_type: contentType,
    sha256: sha,
  };
  return c.json({ attachment }, 201);
});

// GET /api/internal-rules/:id/files/:fileId — хавсралт татах.
// Ажилтан: зөвхөн ОДООГИЙН нийтлэгдсэн хувилбарын файл (draft/архив 404).
// Admin: ажлын хувь + журмын бүх хувилбар (засварлагчид урьдчилан харах).
// Үргэлж `attachment` + nosniff: хэрэглэгчийн файл API-ийн origin дээр хэзээ ч
// inline рендерлэгдэхгүй; UI нь blob болгон татаж өөрөө харуулна.
rules.get('/:id/files/:fileId', async (c) => {
  const user = c.get('user');
  if (!canReadRules(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseId(c.req.param('id'));
  const fileId = c.req.param('fileId');
  if (id === null || !isRuleFileId(fileId)) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const rule = await loadRule(db, id);
  if (!rule) return c.json({ error: 'Журам олдсонгүй' }, 404);

  let found: RuleAttachment | undefined;
  if (user.role === 'admin') {
    found = parseAttachmentsJson(rule.attachments_json).find((a) => a.id === fileId);
    if (!found) {
      const { results } = await db
        .prepare('SELECT attachments_json FROM internal_rule_versions WHERE rule_id = ? ORDER BY version DESC')
        .bind(id)
        .all<{ attachments_json: string | null }>();
      for (const r of results ?? []) {
        found = parseAttachmentsJson(r.attachments_json).find((a) => a.id === fileId);
        if (found) break;
      }
    }
  } else if (rule.status === 'published' && rule.current_version_id !== null) {
    const version = await loadVersion(db, rule.current_version_id);
    found = parseAttachmentsJson(version?.attachments_json).find((a) => a.id === fileId);
  }
  if (!found) return c.json({ error: 'Файл олдсонгүй' }, 404);

  const res = await streamPrivateObject(c.env, found.key, found.name, found.content_type, { inline: false });
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
});

// GET /api/internal-rules/:id — одоогийн хувилбарын бичвэр + миний гарын үсэг.
rules.get('/:id', async (c) => {
  const user = c.get('user');
  if (!canReadRules(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);

  const rule = await loadRule(c.env.DB, id);
  // Ажилтанд draft/archived журам «байхгүй» — админ ч энэ уншигчийн замаар
  // зөвхөн нийтлэгдсэнийг харна (draft нь /admin-д).
  if (!rule || rule.status !== 'published' || rule.current_version_id === null) {
    return c.json({ error: 'Журам олдсонгүй' }, 404);
  }
  const version = await loadVersion(c.env.DB, rule.current_version_id);
  if (!version) return c.json({ error: 'Хувилбар олдсонгүй' }, 404);

  const mine = await c.env.DB.prepare(
    `SELECT ${SIG_COLS} FROM internal_rule_signatures WHERE version_id = ? AND user_id = ?`,
  )
    .bind(version.id, user.sub)
    .first<SignatureRow>();

  // Өмнөх хувилбарт зурсан байсан уу — «шинэ хувилбар гарсан тул дахин
  // зурна» гэдгийг UI тайлбарлахад.
  const previous = mine
    ? null
    : await c.env.DB.prepare(
        `SELECT s.signed_at, v.version
           FROM internal_rule_signatures s
           JOIN internal_rule_versions v ON v.id = s.version_id
          WHERE s.rule_id = ? AND s.user_id = ?
          ORDER BY v.version DESC LIMIT 1`,
      )
        .bind(id, user.sub)
        .first<{ signed_at: string; version: number }>();

  const me = await c.env.DB.prepare('SELECT signature_url FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ signature_url: string | null }>();

  return c.json({
    rule: {
      id: rule.id,
      version_id: version.id,
      version: version.version,
      title_mn: version.title_mn,
      title_en: version.title_en,
      body_md: version.body_md,
      body_format: version.body_format,
      attachments: parseAttachmentsJson(version.attachments_json).map(publicAttachment),
      content_hash: version.content_hash,
      published_at: version.published_at,
    },
    signature: mine ? shapeSignature(mine) : null,
    previous: previous ?? null,
    profile_signature_url: me?.signature_url ?? null,
  });
});

// POST /api/internal-rules/:id/sign — уншиж танилцсанаа гарын үсгээр баталгаажуулах.
rules.post('/:id/sign', async (c) => {
  const user = c.get('user');
  if (!canReadRules(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);

  const parsed = parseSignBody(await c.req.json().catch(() => null));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const db = c.env.DB;
  const rule = await loadRule(db, id);
  if (!rule || rule.status !== 'published' || rule.current_version_id === null) {
    return c.json({ error: 'Журам олдсонгүй' }, 404);
  }
  // Ажилтан ХУУЧИН хувилбарыг харж байгаад «зурах» дарсан бол — энэ хооронд
  // админ шинээр нийтэлсэн — 409: хуудсаа дахин ачаалж ШИНЭ бичвэрийг уншина.
  if (parsed.versionId !== rule.current_version_id) {
    return c.json({ error: 'Журмын шинэ хувилбар нийтлэгдсэн байна — дахин уншина уу', code: 'VERSION_CHANGED' }, 409);
  }
  const version = await loadVersion(db, rule.current_version_id);
  if (!version) return c.json({ error: 'Хувилбар олдсонгүй' }, 404);
  if (version.content_hash !== parsed.contentHash) {
    return c.json({ error: 'Бичвэр таарахгүй байна — хуудсаа дахин ачаална уу', code: 'HASH_MISMATCH' }, 409);
  }

  const existing = await db
    .prepare('SELECT id FROM internal_rule_signatures WHERE version_id = ? AND user_id = ?')
    .bind(version.id, user.sub)
    .first<{ id: number }>();
  if (existing) return c.json({ error: 'Та энэ хувилбарт аль хэдийн гарын үсэг зурсан', code: 'ALREADY_SIGNED' }, 409);

  // Профайлын гарын үсэг — эх сурвалж.
  const me = await db.prepare('SELECT signature_url FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ signature_url: string | null }>();
  const mediaKey = me?.signature_url ? mediaKeyOfUrl(me.signature_url) : null;
  if (!mediaKey) {
    return c.json({ error: 'Профайлдаа гарын үсгээ хадгална уу', code: 'NO_SIGNATURE' }, 409);
  }
  const source = await c.env.MEDIA_BUCKET.get(mediaKey);
  if (!source) {
    return c.json({ error: 'Профайлын гарын үсгийн зураг олдсонгүй — дахин хадгална уу', code: 'NO_SIGNATURE' }, 409);
  }
  const bytes = await source.arrayBuffer();
  const ext = sniffImageExt(bytes);
  if (!ext) return c.json({ error: 'Гарын үсгийн файл зураг биш байна', code: 'NO_SIGNATURE' }, 409);

  // Хувийн bucket руу ХУУЛБАР — профайлын объект дараа устсан ч баталгаа үлдэнэ.
  const key = signatureObjectKey(rule.id, version.id, user.sub, ext);
  const sha = await sha256HexOf(bytes);
  await c.env.MEETING_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: signatureContentTypeOf(ext) },
    customMetadata: {
      rule_id: String(rule.id),
      version_id: String(version.id),
      user_id: String(user.sub),
      source_key: mediaKey,
    },
  });

  const signedAt = new Date().toISOString();
  const userAgent = (c.req.header('user-agent') ?? '').slice(0, 300) || null;
  let sigId: number;
  try {
    const res = await db
      .prepare(
        `INSERT INTO internal_rule_signatures
           (rule_id, version_id, user_id, content_hash, signature_key, signature_sha256, signature_source, signed_at, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, 'profile', ?, ?)`,
      )
      .bind(rule.id, version.id, user.sub, version.content_hash, key, sha, signedAt, userAgent)
      .run();
    sigId = Number(res.meta.last_row_id);
  } catch (err) {
    // UNIQUE(version_id, user_id) — хоёр таб зэрэг дарсан: хуулбарыг цэвэрлээд 409.
    c.executionCtx.waitUntil(c.env.MEETING_BUCKET.delete(key).catch(() => {}));
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg)) {
      return c.json({ error: 'Та энэ хувилбарт аль хэдийн гарын үсэг зурсан', code: 'ALREADY_SIGNED' }, 409);
    }
    throw err;
  }

  const row = await db
    .prepare(`SELECT ${SIG_COLS} FROM internal_rule_signatures WHERE id = ?`)
    .bind(sigId)
    .first<SignatureRow>();
  if (!row) return c.json({ error: 'Хадгалсан гарын үсэг олдсонгүй' }, 500);
  return c.json({ signature: shapeSignature(row) }, 201);
});

/* ------------------------------------------------------------------ */
/*  Админ                                                              */
/* ------------------------------------------------------------------ */

// POST /api/internal-rules — шинэ журам (draft).  Нийтлэх нь тусдаа алхам.
rules.post('/', requireAdmin(), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = sanitizeRuleInput(body, null);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const { input } = parsed;

  let attachments: RuleAttachment[] = [];
  if (body.attachments !== undefined) {
    const refs = parseAttachmentRefs(body.attachments);
    if ('error' in refs) return c.json({ error: refs.error }, 400);
    const resolved = await resolveAttachments(c.env.MEETING_BUCKET, refs.refs, []);
    if ('error' in resolved) return c.json({ error: resolved.error }, 400);
    attachments = resolved.list;
  }

  const user = c.get('user');
  const res = await c.env.DB.prepare(
    `INSERT INTO internal_rules (title_mn, title_en, body_md, body_format, attachments_json, sort_order, created_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.title_mn,
      input.title_en,
      input.body_md,
      input.body_format,
      serializeAttachments(attachments),
      input.sort_order,
      user.sub,
    )
    .run();
  const rule = await loadRule(c.env.DB, Number(res.meta.last_row_id));
  if (!rule) return c.json({ error: 'Хадгалсан журам олдсонгүй' }, 500);
  return c.json({ rule: shapeRule(rule) }, 201);
});

// PUT /api/internal-rules/:id — АЖЛЫН ХУВИЙГ засах.  Нийтлэгдсэн хувилбар
// хөндөгдөхгүй; ажилтан шинэ бичвэрийг зөвхөн /publish-ийн дараа харна.
rules.put('/:id', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const rule = await loadRule(c.env.DB, id);
  if (!rule) return c.json({ error: 'Журам олдсонгүй' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = sanitizeRuleInput(body, {
    title_mn: rule.title_mn,
    title_en: rule.title_en,
    body_md: rule.body_md,
    body_format: rule.body_format,
    sort_order: rule.sort_order,
  });
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const { input } = parsed;

  const before = parseAttachmentsJson(rule.attachments_json);
  let attachments = before;
  if (body.attachments !== undefined) {
    const refs = parseAttachmentRefs(body.attachments);
    if ('error' in refs) return c.json({ error: refs.error }, 400);
    const resolved = await resolveAttachments(c.env.MEETING_BUCKET, refs.refs, before);
    if ('error' in resolved) return c.json({ error: resolved.error }, 400);
    attachments = resolved.list;
  }

  await c.env.DB.prepare(
    `UPDATE internal_rules
        SET title_mn = ?, title_en = ?, body_md = ?, body_format = ?, attachments_json = ?, sort_order = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(
      input.title_mn,
      input.title_en,
      input.body_md,
      input.body_format,
      serializeAttachments(attachments),
      input.sort_order,
      id,
    )
    .run();

  // Ажлын хувиас хасагдсан, ямар ч нийтлэгдсэн хувилбарт ороогүй файлыг
  // устгана (DB шинэчлэгдсэний ДАРАА — амжилтгүй бол өнчин л үлдэнэ).
  if (before.length > 0) {
    const orphans = orphanedKeys(before, attachments, await versionFileKeys(c.env.DB, id));
    if (orphans.length > 0) {
      c.executionCtx.waitUntil(
        Promise.all(orphans.map((k) => c.env.MEETING_BUCKET.delete(k).catch(() => {}))),
      );
    }
  }

  const updated = await loadRule(c.env.DB, id);
  return c.json({ rule: updated ? shapeRule(updated) : null });
});

// POST /api/internal-rules/:id/publish — ажлын хувийг шинэ хувилбар болгон нийтлэх.
// Ажилтан бүрд мэдэгдэл: «шинэ журам — гарын үсэг зурна уу».
rules.post('/:id/publish', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const rule = await loadRule(db, id);
  if (!rule) return c.json({ error: 'Журам олдсонгүй' }, 404);
  const attachments = parseAttachmentsJson(rule.attachments_json);
  if (isRuleBodyEmpty(rule.body_md, rule.body_format) && attachments.length === 0) {
    return c.json({ error: 'Хоосон журам нийтлэх боломжгүй — агуулга бичих эсвэл файл хавсаргана уу' }, 400);
  }

  const hash = await workingHashOf(rule);
  const current = rule.current_version_id ? await loadVersion(db, rule.current_version_id) : null;
  if (current && !hasUnpublishedChanges(hash, current.content_hash)) {
    // Бичвэр ижил — шинэ хувилбар үүсгэвэл бүх гарын үсэг дэмий хүчингүй болно.
    if (rule.status === 'published') {
      return c.json({ error: 'Нийтлэгдсэн хувилбараас ялгаагүй байна', code: 'UNCHANGED' }, 409);
    }
    // archived → буцаан нийтлэх: хуучин хувилбар + хуучин гарын үсэг хэвээр.
    await db
      .prepare("UPDATE internal_rules SET status = 'published', updated_at = datetime('now') WHERE id = ?")
      .bind(id)
      .run();
    const reopened = await loadRule(db, id);
    return c.json({ rule: reopened ? shapeRule(reopened) : null, version: current, reused: true });
  }

  const user = c.get('user');
  const nextNo = await db
    .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS n FROM internal_rule_versions WHERE rule_id = ?')
    .bind(id)
    .first<{ n: number }>();
  const publishedAt = new Date().toISOString();
  const ins = await db
    .prepare(
      `INSERT INTO internal_rule_versions
         (rule_id, version, title_mn, title_en, body_md, body_format, attachments_json, content_hash,
          published_by_id, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      nextNo?.n ?? 1,
      rule.title_mn,
      rule.title_en,
      rule.body_md,
      rule.body_format,
      serializeAttachments(attachments),
      hash,
      user.sub,
      publishedAt,
    )
    .run();
  const versionId = Number(ins.meta.last_row_id);
  await db
    .prepare(
      "UPDATE internal_rules SET status = 'published', current_version_id = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(versionId, id)
    .run();

  // Мэдэгдэл — гарын үсэг зурах ёстой бүх идэвхтэй ажилтанд.  Төрөл нь
  // `attendance_announcement` (0198): «удирдлагаас бүх ажилтанд» гэсэн
  // компанийн хэмжээний зарлалын төрөл — шинэ NotificationType нэмэх нь
  // `CATEGORY_OF` + frontend twin-ийг хөндөнө, энд шаардлагагүй.
  const { results: staff } = await db
    .prepare(
      `SELECT id FROM users
        WHERE status = 'active' AND is_support = 0 AND role IN (${RULE_ROSTER_ROLES_SQL}) AND id <> ?`,
    )
    .bind(user.sub)
    .all<{ id: number }>();
  const title = nextNo && nextNo.n > 1 ? 'Дотоод журам шинэчлэгдлээ — дахин гарын үсэг зурна уу' : 'Дотоод журам — уншиж, гарын үсэг зурна уу';
  c.executionCtx.waitUntil(
    (async () => {
      for (const s of staff ?? []) {
        await createNotification(db, s.id, 'attendance_announcement', title, rule.title_mn, `/app/rules/${id}`);
      }
    })(),
  );

  const published = await loadRule(db, id);
  return c.json({ rule: published ? shapeRule(published) : null, version: await loadVersion(db, versionId) });
});

// POST /api/internal-rules/:id/archive — ажилтнаас нуух; гарын үсэг, хувилбар хэвээр.
rules.post('/:id/archive', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const rule = await loadRule(c.env.DB, id);
  if (!rule) return c.json({ error: 'Журам олдсонгүй' }, 404);
  if (rule.status !== 'published') return c.json({ error: 'Зөвхөн нийтлэгдсэн журмыг архивлана' }, 409);
  await c.env.DB.prepare("UPDATE internal_rules SET status = 'archived', updated_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
  const archived = await loadRule(c.env.DB, id);
  return c.json({ rule: archived ? shapeRule(archived) : null });
});

// POST /api/internal-rules/:id/unarchive — хувилбартай бол published, үгүй бол draft.
rules.post('/:id/unarchive', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const rule = await loadRule(c.env.DB, id);
  if (!rule) return c.json({ error: 'Журам олдсонгүй' }, 404);
  if (rule.status !== 'archived') return c.json({ error: 'Архивлагдаагүй журам' }, 409);
  const next: RuleStatus = rule.current_version_id ? 'published' : 'draft';
  await c.env.DB.prepare("UPDATE internal_rules SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(next, id)
    .run();
  const restored = await loadRule(c.env.DB, id);
  return c.json({ rule: restored ? shapeRule(restored) : null });
});

// DELETE /api/internal-rules/:id — ЗӨВХӨН гарын үсэггүй журам.  Гарын үсэгтэй бол
// архивла: баталгаа нь HR-ийн түүх, устгах зүйл биш.
rules.delete('/:id', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const rule = await loadRule(db, id);
  if (!rule) return c.json({ error: 'Журам олдсонгүй' }, 404);
  const sigs = await db
    .prepare('SELECT COUNT(*) AS n FROM internal_rule_signatures WHERE rule_id = ?')
    .bind(id)
    .first<{ n: number }>();
  if ((sigs?.n ?? 0) > 0) {
    return c.json({ error: 'Гарын үсэгтэй журмыг устгахгүй — архивлана уу', code: 'HAS_SIGNATURES' }, 409);
  }
  // Устгахаас ӨМНӨ хавсралтын түлхүүрүүдийг цуглуулна (ажлын хувь + бүх хувилбар).
  const fileKeys = await versionFileKeys(db, id);
  for (const a of parseAttachmentsJson(rule.attachments_json)) fileKeys.add(a.key);
  // D1 нь FK-г runtime дээр мөрдөхгүй тул хүүхэд мөрийг гараар (repo-гийн конвенц).
  await db.batch([
    db.prepare('DELETE FROM internal_rule_versions WHERE rule_id = ?').bind(id),
    db.prepare('DELETE FROM internal_rules WHERE id = ?').bind(id),
  ]);
  if (fileKeys.size > 0) {
    c.executionCtx.waitUntil(
      Promise.all([...fileKeys].map((k) => c.env.MEETING_BUCKET.delete(k).catch(() => {}))),
    );
  }
  return c.json({ ok: true });
});

// GET /api/internal-rules/:id/signatures — хэн зурсан / хэзээ / хэн зураагүй.
// `?version_id=` өгвөл тэр хувилбар, үгүй бол одоогийнх.  ЗӨВХӨН admin —
// эзний шийдвэр 2026-09-21: senior-т нээхгүй (HR-ийн өгөгдөл; Тайлан,
// Хэрэглэгчидтэй ижил `requireAdmin` конвенц).
rules.get('/:id/signatures', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const rule = await loadRule(db, id);
  if (!rule) return c.json({ error: 'Журам олдсонгүй' }, 404);
  const wanted = parseId(c.req.query('version_id')) ?? rule.current_version_id;
  const version = wanted ? await loadVersion(db, wanted) : null;
  if (version && version.rule_id !== id) return c.json({ error: 'Хувилбар энэ журмынх биш' }, 400);

  const { results: versions } = await db
    .prepare(
      `SELECT v.id, v.version, v.published_at,
              (SELECT COUNT(*) FROM internal_rule_signatures s WHERE s.version_id = v.id) AS signed_count
         FROM internal_rule_versions v WHERE v.rule_id = ? ORDER BY v.version DESC`,
    )
    .bind(id)
    .all<{ id: number; version: number; published_at: string; signed_count: number }>();

  if (!version) {
    return c.json({ version: null, versions: versions ?? [], summary: { signed: 0, pending: 0, total: 0 }, rows: [], extra: [] });
  }

  // Идэвхтэй ажилтан бүр × энэ хувилбарын гарын үсэг.  Идэвхгүй болсон ч
  // зурсан хүн (`extra`) алдагдахгүй — тайланд тусад нь.
  // `previous_*` — ЭНЭ хувилбарт зураагүй ч журмын ӨӨР хувилбарт зурсан бол
  // хамгийн сүүлийнх: админд «шинэ бичвэрийг л уншаагүй» ба «огт зураагүй»
  // хоёрыг ялгах мэдээлэл.
  const { results: rawRows } = await db
    .prepare(
      `SELECT u.id AS user_id, u.full_name, u.username, u.role, tm.code AS team_code,
              s.id AS signature_id, s.signed_at,
              (SELECT v2.version FROM internal_rule_signatures s2
                 JOIN internal_rule_versions v2 ON v2.id = s2.version_id
                WHERE s2.rule_id = ? AND s2.user_id = u.id AND s2.version_id <> ?
                ORDER BY v2.version DESC LIMIT 1) AS previous_version,
              (SELECT s2.signed_at FROM internal_rule_signatures s2
                 JOIN internal_rule_versions v2 ON v2.id = s2.version_id
                WHERE s2.rule_id = ? AND s2.user_id = u.id AND s2.version_id <> ?
                ORDER BY v2.version DESC LIMIT 1) AS previous_signed_at
         FROM users u
         LEFT JOIN teams tm ON tm.id = u.team_id
         LEFT JOIN internal_rule_signatures s ON s.version_id = ? AND s.user_id = u.id
        WHERE u.status = 'active' AND u.is_support = 0 AND u.role IN (${RULE_ROSTER_ROLES_SQL})
        ORDER BY (s.id IS NULL) DESC, u.full_name`,
    )
    .bind(id, version.id, id, version.id, version.id)
    .all<{
      user_id: number;
      full_name: string;
      username: string;
      role: string;
      team_code: string | null;
      signature_id: number | null;
      signed_at: string | null;
      previous_version: number | null;
      previous_signed_at: string | null;
    }>();

  const rows = (rawRows ?? []).map(({ previous_version, previous_signed_at, ...r }) => ({
    ...r,
    previous:
      r.signature_id === null && previous_version !== null && previous_signed_at !== null
        ? { version: previous_version, signed_at: previous_signed_at }
        : null,
  }));
  const signed = rows.filter((r) => r.signature_id !== null).length;

  const { results: extra } = await db
    .prepare(
      `SELECT s.user_id, u.full_name, u.username, u.role, tm.code AS team_code, s.id AS signature_id, s.signed_at
         FROM internal_rule_signatures s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN teams tm ON tm.id = u.team_id
        WHERE s.version_id = ?
          AND (u.id IS NULL OR u.status <> 'active' OR u.is_support <> 0 OR u.role NOT IN (${RULE_ROSTER_ROLES_SQL}))
        ORDER BY s.signed_at DESC`,
    )
    .bind(version.id)
    .all<{
      user_id: number;
      full_name: string | null;
      username: string | null;
      role: string | null;
      team_code: string | null;
      signature_id: number;
      signed_at: string;
    }>();

  return c.json({
    version: { id: version.id, version: version.version, published_at: version.published_at, content_hash: version.content_hash },
    versions: versions ?? [],
    summary: { signed, pending: rows.length - signed, total: rows.length },
    rows,
    extra: extra ?? [],
  });
});

export default rules;
