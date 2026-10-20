/**
 * Нийтийн мэдээлэл — системийн шинэчлэлт, компанийн мэдээлэл, чухал дотоод
 * зарлал.  Миграц 0338, цэвэр туслахууд `lib/announcements.ts`.
 *
 *   Ажилтан (admin | senior | engineer | architect — `canReadAnnouncements`):
 *   GET    /api/announcements                  — нийтлэгдсэн, надад хамаарах мэдээлэл + миний төлөв
 *   GET    /api/announcements/:id              — бүтэн агуулга + миний баталгаа
 *   POST   /api/announcements/:id/ack          — {confirmed:true, ack_version, content_hash}
 *                                                 confirm → чагт; signature → профайлын гарын үсэг
 *   GET    /api/announcements/acks/:ackId/image — зурсан гарын үсгийн зураг (өөрийнх | admin)
 *
 *   Админ (`requireAdmin` — эзний шийдвэр 2026-09-21: зөвхөн admin):
 *   GET    /api/announcements/admin            — БҮГД (draft/archived орно) + тоолуур
 *   POST   /api/announcements                  — шинэ (draft)
 *   PUT    /api/announcements/:id              — засах; `reack:true` → ack_version +1 (бүгд дахин)
 *   POST   /api/announcements/:id/publish      — нийтлэх + хүрээний ажилтанд мэдэгдэл
 *   POST   /api/announcements/:id/unpublish    — буцааж draft (баталгаа хэвээр)
 *   POST   /api/announcements/:id/archive | unarchive
 *   POST   /api/announcements/:id/remind       — баталгаажуулаагүй хүмүүст дахин мэдэгдэл
 *   DELETE /api/announcements/:id              — бүрмөсөн (баталгаа + гарын үсэг + мэдэгдэл хамт)
 *   GET    /api/announcements/:id/acks         — хэн баталгаажуулсан / хэзээ / хэн ҮГҮЙ
 *
 * Гарын үсгийн эх нь ПРОФАЙЛЫН `users.signature_url` (Дотоод журамтай ижил
 * зарчим): баталгаажуулах мөчид байтыг хувийн bucket руу хуулж, sha256-г
 * мөрөнд хадгална — профайлын объект дараа солигдсон ч баталгаа үлдэнэ.
 *
 * `client` нь `lib/clientScope.ts`-ийн цагаан жагсаалтад ЭНЭ угтвар байхгүй
 * тул 403; `worker` мөн `lib/workerScope.ts`-ээр 403.  Доорх
 * `canReadAnnouncements` шалгалт нь тэр хоёр хаалтын ХОЁРДУГААР давхарга.
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { streamPrivateObject } from '../lib/privateFileStream';
import { mediaKeyOfUrl } from '../lib/mediaReplace';
import { createNotification } from '../lib/notify';
import {
  audienceMatches,
  audienceWhereSql,
  canReadAnnouncements,
  contentHashOf,
  excerptOf,
  parseAckBody,
  parseAudience,
  sanitizeAnnouncementInput,
  serializeAudience,
  sha256HexOf,
  signatureContentTypeOf,
  signatureObjectKey,
  sniffImageExt,
} from '../lib/announcements';
import type { AckMode, AnnouncementKind, AnnouncementStatus, Audience } from '../lib/announcements';

const announcements = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Энэ router-ийн алдаа JSON хэлбэртэй — index.ts-д `app.onError` байхгүй тул
// үндсэн апп текст «Internal Server Error» өгдөг; frontend `apiFetch` JSON хүлээнэ.
announcements.onError((err, c) => {
  console.error('[announcements]', err);
  return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
});

/* ------------------------------------------------------------------ */
/*  Мөрийн хэлбэрүүд                                                   */
/* ------------------------------------------------------------------ */

interface AnnouncementRow {
  id: number;
  title: string;
  body_html: string;
  kind: AnnouncementKind;
  ack_mode: AckMode;
  status: AnnouncementStatus;
  audience_json: string | null;
  pinned: number;
  ack_version: number;
  content_hash: string | null;
  published_at: string | null;
  published_by_id: number | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

interface AckRow {
  id: number;
  announcement_id: number;
  ack_version: number;
  user_id: number;
  content_hash: string;
  ack_kind: 'confirm' | 'signature';
  signature_key: string | null;
  signature_sha256: string | null;
  acked_at: string;
}

const A_COLS =
  'id, title, body_html, kind, ack_mode, status, audience_json, pinned, ack_version, content_hash, published_at, published_by_id, created_by_id, created_at, updated_at';
const ACK_COLS = 'id, announcement_id, ack_version, user_id, content_hash, ack_kind, signature_key, signature_sha256, acked_at';

function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function loadAnnouncement(db: D1Database, id: number): Promise<AnnouncementRow | null> {
  return db.prepare(`SELECT ${A_COLS} FROM announcements WHERE id = ?`).bind(id).first<AnnouncementRow>();
}

/** Баталгааны мөрийг клиент рүү — R2 түлхүүр ХЭЗЭЭ Ч гарахгүй (зураг нь authed route-оор). */
function shapeAck(a: AckRow) {
  return {
    id: a.id,
    announcement_id: a.announcement_id,
    ack_version: a.ack_version,
    user_id: a.user_id,
    content_hash: a.content_hash,
    ack_kind: a.ack_kind,
    acked_at: a.acked_at,
    image_url: a.ack_kind === 'signature' ? `/announcements/acks/${a.id}/image` : null,
  };
}

/** Ажилтны жагсаалт/дэлгэрэнгүйд харагдах толгой (бие ОРОХГҮЙ). */
function shapeHead(r: AnnouncementRow, publishedByName: string | null) {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    ack_mode: r.ack_mode,
    pinned: r.pinned === 1,
    ack_version: r.ack_version,
    content_hash: r.content_hash,
    published_at: r.published_at,
    published_by_name: publishedByName,
    excerpt: excerptOf(r.body_html),
  };
}

/** Хэрэглэгчийн баг — хүрээний шүүлтэд.  Токенд team_id байхгүй тул DB-ээс. */
async function loadViewer(db: D1Database, userId: number) {
  return db
    .prepare('SELECT id, role, team_id, signature_url FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: number; role: string; team_id: number | null; signature_url: string | null }>();
}

/**
 * Хүрээнд багтах идэвхтэй ажилтны id-ууд (мэдэгдэл, сануулга).  Roster-той
 * ЯГ ижил предикат (`audienceWhereSql`) — статистикийн «total» ба мэдэгдэл
 * авсан хүмүүс зөрөхгүй.
 */
async function audienceUserIds(db: D1Database, audience: Audience, exclude: number): Promise<number[]> {
  const w = audienceWhereSql(audience);
  const { results } = await db
    .prepare(`SELECT u.id FROM users u WHERE ${w.sql} AND u.id <> ?`)
    .bind(...w.binds, exclude)
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

const KIND_LABEL_MN: Record<AnnouncementKind, string> = {
  system_update: 'Системийн шинэчлэлт',
  company_info: 'Компанийн мэдээлэл',
  announcement: 'Зарлал',
};

function notificationTitle(r: AnnouncementRow, reack: boolean): string {
  const base = KIND_LABEL_MN[r.kind] ?? 'Нийтийн мэдээлэл';
  if (r.ack_mode === 'signature') return reack ? `${base} шинэчлэгдлээ — дахин гарын үсэг зурна уу` : `${base} — уншиж, гарын үсэг зурна уу`;
  if (r.ack_mode === 'confirm') return reack ? `${base} шинэчлэгдлээ — дахин баталгаажуулна уу` : `${base} — уншиж баталгаажуулна уу`;
  return `${base}`;
}

/* ------------------------------------------------------------------ */
/*  Админ — жагсаалт (`/admin` нь `/:id`-ээс ӨМНӨ бүртгэгдэнэ)          */
/* ------------------------------------------------------------------ */

// GET /api/announcements/admin — бүх мэдээлэл + одоогийн хувилбарын тоолуур.
announcements.get('/admin', requireAdmin(), async (c) => {
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      `SELECT ${A_COLS.split(', ').map((col) => `a.${col}`).join(', ')},
              pu.full_name AS published_by_name,
              cu.full_name AS created_by_name,
              (SELECT COUNT(*) FROM announcement_acks k WHERE k.announcement_id = a.id AND k.ack_version = a.ack_version) AS acked_count,
              (SELECT COUNT(*) FROM announcement_acks k WHERE k.announcement_id = a.id) AS total_acks
         FROM announcements a
         LEFT JOIN users pu ON pu.id = a.published_by_id
         LEFT JOIN users cu ON cu.id = a.created_by_id
        ORDER BY CASE a.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                 a.pinned DESC, COALESCE(a.published_at, a.updated_at) DESC, a.id DESC`,
    )
    .all<AnnouncementRow & { published_by_name: string | null; created_by_name: string | null; acked_count: number; total_acks: number }>();

  // Roster-ийн хэмжээг мэдээлэл бүрд тус тусад нь — хүрээ өөр өөр.
  const out = [];
  for (const r of results ?? []) {
    const audience = parseAudience(r.audience_json);
    let rosterCount = 0;
    if (r.ack_mode !== 'none') {
      const w = audienceWhereSql(audience);
      const cnt = await db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${w.sql}`).bind(...w.binds).first<{ n: number }>();
      rosterCount = cnt?.n ?? 0;
    }
    out.push({
      ...shapeHead(r, r.published_by_name),
      body_html: r.body_html,
      status: r.status,
      audience,
      created_by_name: r.created_by_name,
      created_at: r.created_at,
      updated_at: r.updated_at,
      acked_count: r.acked_count,
      total_acks: r.total_acks,
      roster_count: rosterCount,
    });
  }
  return c.json({ announcements: out });
});

/* ------------------------------------------------------------------ */
/*  Гарын үсгийн зураг (`/acks/...` нь `/:id`-ээс ӨМНӨ)                */
/* ------------------------------------------------------------------ */

// GET /api/announcements/acks/:ackId/image — өөрийн гарын үсэг эсвэл admin.
announcements.get('/acks/:ackId/image', async (c) => {
  const user = c.get('user');
  if (!canReadAnnouncements(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const ackId = parseId(c.req.param('ackId'));
  if (ackId === null) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(`SELECT ${ACK_COLS} FROM announcement_acks WHERE id = ?`).bind(ackId).first<AckRow>();
  if (!row || !row.signature_key) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== user.sub && user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  const ext = row.signature_key.split('.').pop() ?? 'png';
  return streamPrivateObject(c.env, row.signature_key, `signature-${row.id}.${ext}`, null, { inline: true });
});

/* ------------------------------------------------------------------ */
/*  Ажилтан                                                            */
/* ------------------------------------------------------------------ */

// GET /api/announcements — нийтлэгдсэн, надад хамаарах мэдээлэл + миний баталгаа.
announcements.get('/', async (c) => {
  const user = c.get('user');
  if (!canReadAnnouncements(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const db = c.env.DB;
  const viewer = await loadViewer(db, user.sub);
  const { results } = await db
    .prepare(
      `SELECT ${A_COLS.split(', ').map((col) => `a.${col}`).join(', ')},
              pu.full_name AS published_by_name,
              k.id AS ack_id, k.acked_at AS ack_acked_at, k.ack_kind AS ack_ack_kind
         FROM announcements a
         LEFT JOIN users pu ON pu.id = a.published_by_id
         LEFT JOIN announcement_acks k
                ON k.announcement_id = a.id AND k.ack_version = a.ack_version AND k.user_id = ?
        WHERE a.status = 'published'
        ORDER BY a.pinned DESC, a.published_at DESC, a.id DESC`,
    )
    .bind(user.sub)
    .all<AnnouncementRow & { published_by_name: string | null; ack_id: number | null; ack_acked_at: string | null; ack_ack_kind: 'confirm' | 'signature' | null }>();

  // Хүрээний шүүлт: admin бүгдийг харна (удирдах эрхтэй хүн), бусад нь
  // зөвхөн өөрт хамаарахыг.  `audienceMatches` нь roster SQL-тэй ижил дүрэм.
  const me = { role: viewer?.role ?? user.role, team_id: viewer?.team_id ?? null };
  const list = (results ?? [])
    .filter((r) => user.role === 'admin' || audienceMatches(parseAudience(r.audience_json), me))
    .map((r) => ({
      ...shapeHead(r, r.published_by_name),
      my_ack: r.ack_id !== null ? { id: r.ack_id, acked_at: r.ack_acked_at, ack_kind: r.ack_ack_kind } : null,
      /** Admin хүрээнээс гадуур мэдээллийг харж болох ч баталгаажуулах шаардлагагүй. */
      in_audience: audienceMatches(parseAudience(r.audience_json), me),
    }));
  const pending = list.filter((r) => r.ack_mode !== 'none' && r.my_ack === null && r.in_audience).length;
  return c.json({ announcements: list, pending_count: pending });
});

// GET /api/announcements/:id — бүтэн агуулга.
announcements.get('/:id', async (c) => {
  const user = c.get('user');
  if (!canReadAnnouncements(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const row = await loadAnnouncement(db, id);
  if (!row || row.status !== 'published') return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  const viewer = await loadViewer(db, user.sub);
  const me = { role: viewer?.role ?? user.role, team_id: viewer?.team_id ?? null };
  const inAudience = audienceMatches(parseAudience(row.audience_json), me);
  if (!inAudience && user.role !== 'admin') return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);

  const publisher = row.published_by_id
    ? await db.prepare('SELECT full_name FROM users WHERE id = ?').bind(row.published_by_id).first<{ full_name: string }>()
    : null;
  const mine = await db
    .prepare(`SELECT ${ACK_COLS} FROM announcement_acks WHERE announcement_id = ? AND ack_version = ? AND user_id = ?`)
    .bind(id, row.ack_version, user.sub)
    .first<AckRow>();
  // Өмнөх хувилбарт баталгаажуулсан байсан бол — «шинэчлэгдсэн, дахин».
  const previous = mine
    ? null
    : await db
        .prepare(
          `SELECT ack_version, acked_at FROM announcement_acks
            WHERE announcement_id = ? AND user_id = ? AND ack_version <> ?
            ORDER BY ack_version DESC LIMIT 1`,
        )
        .bind(id, user.sub, row.ack_version)
        .first<{ ack_version: number; acked_at: string }>();

  return c.json({
    announcement: { ...shapeHead(row, publisher?.full_name ?? null), body_html: row.body_html, audience: parseAudience(row.audience_json) },
    my_ack: mine ? shapeAck(mine) : null,
    previous: previous ?? null,
    in_audience: inAudience,
    profile_signature_url: viewer?.signature_url ?? null,
  });
});

// POST /api/announcements/:id/ack — уншиж танилцсанаа баталгаажуулах.
announcements.post('/:id/ack', async (c) => {
  const user = c.get('user');
  if (!canReadAnnouncements(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const parsed = parseAckBody(await c.req.json().catch(() => null));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const db = c.env.DB;
  const row = await loadAnnouncement(db, id);
  if (!row || row.status !== 'published') return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  if (row.ack_mode === 'none') return c.json({ error: 'Энэ мэдээлэл баталгаа шаарддаггүй', code: 'NO_ACK_REQUIRED' }, 400);
  const viewer = await loadViewer(db, user.sub);
  const me = { role: viewer?.role ?? user.role, team_id: viewer?.team_id ?? null };
  if (!audienceMatches(parseAudience(row.audience_json), me)) {
    // Admin хүрээнээс гадуур мэдээллийг харж болно, гэхдээ баталгаа нь roster-т
    // тоологдохгүй тул бичихгүй — статистик «зурсан N / total M» зөрөхгүй.
    return c.json({ error: 'Та энэ мэдээллийн хүрээнд ороогүй байна', code: 'NOT_IN_AUDIENCE' }, 403);
  }
  // Ажилтан ХУУЧИН агуулгыг харж байгаад «баталгаажуулах» дарсан бол — энэ
  // хооронд админ шинэчилсэн — 409: хуудсаа дахин ачаалж ШИНЭ агуулгыг уншина.
  if (parsed.ackVersion !== row.ack_version) {
    return c.json({ error: 'Мэдээлэл шинэчлэгдсэн байна — дахин уншина уу', code: 'VERSION_CHANGED' }, 409);
  }
  if (!row.content_hash || row.content_hash !== parsed.contentHash) {
    return c.json({ error: 'Агуулга өөрчлөгдсөн байна — хуудсаа дахин ачаална уу', code: 'HASH_MISMATCH' }, 409);
  }
  const existing = await db
    .prepare('SELECT id FROM announcement_acks WHERE announcement_id = ? AND ack_version = ? AND user_id = ?')
    .bind(id, row.ack_version, user.sub)
    .first<{ id: number }>();
  if (existing) return c.json({ error: 'Та аль хэдийн баталгаажуулсан байна', code: 'ALREADY_ACKED' }, 409);

  let signatureKey: string | null = null;
  let signatureSha: string | null = null;
  if (row.ack_mode === 'signature') {
    // Профайлын гарын үсэг — эх сурвалж (Дотоод журамтай ижил зарчим).
    const mediaKey = viewer?.signature_url ? mediaKeyOfUrl(viewer.signature_url) : null;
    if (!mediaKey) return c.json({ error: 'Профайлдаа гарын үсгээ хадгална уу', code: 'NO_SIGNATURE' }, 409);
    const source = await c.env.MEDIA_BUCKET.get(mediaKey);
    if (!source) return c.json({ error: 'Профайлын гарын үсгийн зураг олдсонгүй — дахин хадгална уу', code: 'NO_SIGNATURE' }, 409);
    const bytes = await source.arrayBuffer();
    const ext = sniffImageExt(bytes);
    if (!ext) return c.json({ error: 'Гарын үсгийн файл зураг биш байна', code: 'NO_SIGNATURE' }, 409);
    signatureKey = signatureObjectKey(row.id, row.ack_version, user.sub, ext);
    signatureSha = await sha256HexOf(bytes);
    await c.env.MEETING_BUCKET.put(signatureKey, bytes, {
      httpMetadata: { contentType: signatureContentTypeOf(ext) },
      customMetadata: {
        announcement_id: String(row.id),
        ack_version: String(row.ack_version),
        user_id: String(user.sub),
        source_key: mediaKey,
      },
    });
  }

  const ackedAt = new Date().toISOString();
  const userAgent = (c.req.header('user-agent') ?? '').slice(0, 300) || null;
  let ackId: number;
  try {
    const res = await db
      .prepare(
        `INSERT INTO announcement_acks
           (announcement_id, ack_version, user_id, content_hash, ack_kind, signature_key, signature_sha256, acked_at, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, row.ack_version, user.sub, row.content_hash, row.ack_mode, signatureKey, signatureSha, ackedAt, userAgent)
      .run();
    ackId = Number(res.meta.last_row_id);
  } catch (err) {
    // UNIQUE — хоёр таб зэрэг дарсан: хуулбарыг цэвэрлээд 409.
    if (signatureKey) c.executionCtx.waitUntil(c.env.MEETING_BUCKET.delete(signatureKey).catch(() => {}));
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg)) return c.json({ error: 'Та аль хэдийн баталгаажуулсан байна', code: 'ALREADY_ACKED' }, 409);
    throw err;
  }
  const saved = await db.prepare(`SELECT ${ACK_COLS} FROM announcement_acks WHERE id = ?`).bind(ackId).first<AckRow>();
  if (!saved) return c.json({ error: 'Хадгалсан баталгаа олдсонгүй' }, 500);
  return c.json({ ack: shapeAck(saved) }, 201);
});

/* ------------------------------------------------------------------ */
/*  Админ — CRUD                                                       */
/* ------------------------------------------------------------------ */

async function loadAdminOne(db: D1Database, id: number) {
  const r = await loadAnnouncement(db, id);
  if (!r) return null;
  const audience = parseAudience(r.audience_json);
  const w = audienceWhereSql(audience);
  const [pub, acked, total, roster] = await Promise.all([
    r.published_by_id ? db.prepare('SELECT full_name FROM users WHERE id = ?').bind(r.published_by_id).first<{ full_name: string }>() : Promise.resolve(null),
    db.prepare('SELECT COUNT(*) AS n FROM announcement_acks WHERE announcement_id = ? AND ack_version = ?').bind(id, r.ack_version).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM announcement_acks WHERE announcement_id = ?').bind(id).first<{ n: number }>(),
    r.ack_mode === 'none'
      ? Promise.resolve({ n: 0 })
      : db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${w.sql}`).bind(...w.binds).first<{ n: number }>(),
  ]);
  return {
    ...shapeHead(r, pub?.full_name ?? null),
    body_html: r.body_html,
    status: r.status,
    audience,
    created_at: r.created_at,
    updated_at: r.updated_at,
    acked_count: acked?.n ?? 0,
    total_acks: total?.n ?? 0,
    roster_count: roster?.n ?? 0,
  };
}

// POST /api/announcements — шинэ мэдээлэл (draft).  Нийтлэх нь тусдаа алхам.
announcements.post('/', requireAdmin(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = sanitizeAnnouncementInput(body, null);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const { input } = parsed;
  const user = c.get('user');
  const hash = await contentHashOf(input.title, input.body_html);
  const res = await c.env.DB.prepare(
    `INSERT INTO announcements (title, body_html, kind, ack_mode, audience_json, pinned, content_hash, created_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(input.title, input.body_html, input.kind, input.ack_mode, serializeAudience(input.audience), input.pinned ? 1 : 0, hash, user.sub)
    .run();
  const saved = await loadAdminOne(c.env.DB, Number(res.meta.last_row_id));
  if (!saved) return c.json({ error: 'Хадгалсан мэдээлэл олдсонгүй' }, 500);
  return c.json({ announcement: saved }, 201);
});

// PUT /api/announcements/:id — засах.  `reack: true` (нийтлэгдсэн, баталгаатай)
// → ack_version +1: бүх ажилтан ДАХИН баталгаажуулна, хуучин мөр түүх болно.
announcements.put('/:id', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const row = await loadAnnouncement(db, id);
  if (!row) return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = sanitizeAnnouncementInput(body, {
    title: row.title,
    body_html: row.body_html,
    kind: row.kind,
    ack_mode: row.ack_mode,
    audience: parseAudience(row.audience_json),
    pinned: row.pinned === 1,
  });
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const { input } = parsed;
  const hash = await contentHashOf(input.title, input.body_html);
  const reack = body.reack === true && input.ack_mode !== 'none';
  await db
    .prepare(
      `UPDATE announcements
          SET title = ?, body_html = ?, kind = ?, ack_mode = ?, audience_json = ?, pinned = ?, content_hash = ?,
              ack_version = ack_version + ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(input.title, input.body_html, input.kind, input.ack_mode, serializeAudience(input.audience), input.pinned ? 1 : 0, hash, reack ? 1 : 0, id)
    .run();

  // Дахин баталгаажуулалт + нийтлэгдсэн → хүрээний ажилтанд мэдэгдэл.
  if (reack && row.status === 'published') {
    const updated = await loadAnnouncement(db, id);
    if (updated) {
      const ids = await audienceUserIds(db, input.audience, c.get('user').sub);
      const title = notificationTitle(updated, true);
      c.executionCtx.waitUntil(
        (async () => {
          for (const uid of ids) await createNotification(db, uid, 'announcement_published', title, updated.title, `/app/announcements/${id}`);
        })(),
      );
    }
  }
  return c.json({ announcement: await loadAdminOne(db, id), reacked: reack });
});

// POST /api/announcements/:id/publish — нийтлэх + хүрээний ажилтанд мэдэгдэл.
// `notify: false` бол мэдэгдэлгүй (жижиг засварыг дахин нийтлэхэд).
announcements.post('/:id/publish', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const row = await loadAnnouncement(db, id);
  if (!row) return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  if (row.status === 'published') return c.json({ error: 'Аль хэдийн нийтлэгдсэн', code: 'ALREADY_PUBLISHED' }, 409);
  if (!row.body_html.trim()) return c.json({ error: 'Хоосон мэдээлэл нийтлэх боломжгүй' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { notify?: unknown };
  const user = c.get('user');
  const hash = await contentHashOf(row.title, row.body_html);
  const publishedAt = new Date().toISOString();
  // Архиваас буцаахад анхны published_at хэвээр (жагсаалтын дараалал), draft-аас бол одоо.
  const firstPublish = row.published_at === null || row.status === 'draft';
  await db
    .prepare(
      `UPDATE announcements
          SET status = 'published', content_hash = ?, published_at = ?, published_by_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(hash, firstPublish ? publishedAt : row.published_at, user.sub, id)
    .run();

  let notified = 0;
  if (body.notify !== false) {
    const audience = parseAudience(row.audience_json);
    const ids = await audienceUserIds(db, audience, user.sub);
    notified = ids.length;
    const title = notificationTitle({ ...row, content_hash: hash }, false);
    c.executionCtx.waitUntil(
      (async () => {
        for (const uid of ids) await createNotification(db, uid, 'announcement_published', title, row.title, `/app/announcements/${id}`);
      })(),
    );
  }
  return c.json({ announcement: await loadAdminOne(db, id), notified });
});

// POST /api/announcements/:id/unpublish — буцааж draft; баталгаа хэвээр.
announcements.post('/:id/unpublish', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const row = await loadAnnouncement(c.env.DB, id);
  if (!row) return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  if (row.status !== 'published') return c.json({ error: 'Нийтлэгдээгүй мэдээлэл' }, 409);
  await c.env.DB.prepare("UPDATE announcements SET status = 'draft', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  return c.json({ announcement: await loadAdminOne(c.env.DB, id) });
});

// POST /api/announcements/:id/archive — ажилтнаас нуух; баталгаа хэвээр.
announcements.post('/:id/archive', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const row = await loadAnnouncement(c.env.DB, id);
  if (!row) return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  if (row.status === 'archived') return c.json({ error: 'Аль хэдийн архивлагдсан' }, 409);
  await c.env.DB.prepare("UPDATE announcements SET status = 'archived', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  return c.json({ announcement: await loadAdminOne(c.env.DB, id) });
});

// POST /api/announcements/:id/unarchive — өмнө нийтлэгдсэн бол published, үгүй бол draft.
announcements.post('/:id/unarchive', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const row = await loadAnnouncement(c.env.DB, id);
  if (!row) return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  if (row.status !== 'archived') return c.json({ error: 'Архивлагдаагүй мэдээлэл' }, 409);
  const next: AnnouncementStatus = row.published_at ? 'published' : 'draft';
  await c.env.DB.prepare("UPDATE announcements SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(next, id).run();
  return c.json({ announcement: await loadAdminOne(c.env.DB, id) });
});

// POST /api/announcements/:id/remind — одоогийн хувилбарыг баталгаажуулаагүй хүмүүст дахин мэдэгдэл.
announcements.post('/:id/remind', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const row = await loadAnnouncement(db, id);
  if (!row) return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  if (row.status !== 'published' || row.ack_mode === 'none') {
    return c.json({ error: 'Зөвхөн нийтлэгдсэн, баталгаа шаардсан мэдээлэлд сануулна', code: 'NOT_APPLICABLE' }, 409);
  }
  const w = audienceWhereSql(parseAudience(row.audience_json));
  const { results } = await db
    .prepare(
      `SELECT u.id FROM users u
        WHERE ${w.sql} AND u.id <> ?
          AND NOT EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id = ? AND k.ack_version = ? AND k.user_id = u.id)`,
    )
    .bind(...w.binds, c.get('user').sub, id, row.ack_version)
    .all<{ id: number }>();
  const ids = (results ?? []).map((r) => r.id);
  const title = `Сануулга: ${notificationTitle(row, false)}`;
  c.executionCtx.waitUntil(
    (async () => {
      for (const uid of ids) await createNotification(db, uid, 'announcement_published', title, row.title, `/app/announcements/${id}`);
    })(),
  );
  return c.json({ reminded: ids.length });
});

// DELETE /api/announcements/:id — баталгаатай ч устгана (эзний шийдвэр 2026-09-25;
// өмнө нь 409 `HAS_ACKS` буцааж архивлахыг шаарддаг байв).  Баталгаа, түүний
// гарын үсгийн хуулбар (хувийн bucket), мэдээлэл рүү заасан мэдэгдэл — бүгд хамт
// арилна.  UI нь баталгааны тоог дурдсан баталгаажуулах цонхоор хамгаална.
announcements.delete('/:id', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const row = await loadAnnouncement(db, id);
  if (!row) return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  const { results: signed } = await db
    .prepare('SELECT signature_key FROM announcement_acks WHERE announcement_id = ? AND signature_key IS NOT NULL')
    .bind(id)
    .all<{ signature_key: string }>();
  // D1 нь FK-г runtime дээр мөрдөхгүй тул хүүхэд мөрийг гараар (repo-гийн конвенц).
  const [acksRes] = await db.batch([
    db.prepare('DELETE FROM announcement_acks WHERE announcement_id = ?').bind(id),
    db.prepare('DELETE FROM notifications WHERE type = ? AND link = ?').bind('announcement_published', `/app/announcements/${id}`),
    db.prepare('DELETE FROM announcements WHERE id = ?').bind(id),
  ]);
  // R2-ийг мөр бүрийн түлхүүрээр (угтвараар БИШ) — DB амжилттай болсны ДАРАА.
  const keys = (signed ?? []).map((r) => r.signature_key);
  if (keys.length) {
    c.executionCtx.waitUntil(Promise.all(keys.map((k) => c.env.MEETING_BUCKET.delete(k).catch(() => {}))).then(() => {}));
  }
  return c.json({ ok: true, deleted_acks: acksRes?.meta.changes ?? 0 });
});

// GET /api/announcements/:id/acks — хэн баталгаажуулсан / хэзээ / хэн ҮГҮЙ.
// `?ack_version=` өгвөл тэр хувилбар, үгүй бол одоогийнх.  ЗӨВХӨН admin.
announcements.get('/:id/acks', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const row = await loadAnnouncement(db, id);
  if (!row) return c.json({ error: 'Мэдээлэл олдсонгүй' }, 404);
  const wanted = parseId(c.req.query('ack_version')) ?? row.ack_version;
  if (wanted > row.ack_version) return c.json({ error: 'Хувилбар буруу' }, 400);

  const { results: versions } = await db
    .prepare(
      `SELECT ack_version, COUNT(*) AS acked_count, MIN(acked_at) AS first_at, MAX(acked_at) AS last_at
         FROM announcement_acks WHERE announcement_id = ? GROUP BY ack_version ORDER BY ack_version DESC`,
    )
    .bind(id)
    .all<{ ack_version: number; acked_count: number; first_at: string; last_at: string }>();

  if (row.ack_mode === 'none') {
    return c.json({ ack_mode: row.ack_mode, ack_version: row.ack_version, viewing_version: wanted, versions: versions ?? [], summary: { acked: 0, pending: 0, total: 0 }, rows: [], extra: [] });
  }

  const audience = parseAudience(row.audience_json);
  const w = audienceWhereSql(audience);
  // Хүрээний идэвхтэй ажилтан бүр × энэ хувилбарын баталгаа.  `previous_*` —
  // энэ хувилбарт биш ч өмнөх хувилбарт баталгаажуулсан бол хамгийн сүүлийнх.
  const { results: rawRows } = await db
    .prepare(
      `SELECT u.id AS user_id, u.full_name, u.username, u.role, tm.code AS team_code,
              k.id AS ack_id, k.acked_at, k.ack_kind,
              (SELECT k2.ack_version FROM announcement_acks k2
                WHERE k2.announcement_id = ? AND k2.user_id = u.id AND k2.ack_version <> ?
                ORDER BY k2.ack_version DESC LIMIT 1) AS previous_version,
              (SELECT k2.acked_at FROM announcement_acks k2
                WHERE k2.announcement_id = ? AND k2.user_id = u.id AND k2.ack_version <> ?
                ORDER BY k2.ack_version DESC LIMIT 1) AS previous_acked_at
         FROM users u
         LEFT JOIN teams tm ON tm.id = u.team_id
         LEFT JOIN announcement_acks k ON k.announcement_id = ? AND k.ack_version = ? AND k.user_id = u.id
        WHERE ${w.sql}
        ORDER BY (k.id IS NULL) DESC, u.full_name`,
    )
    .bind(id, wanted, id, wanted, id, wanted, ...w.binds)
    .all<{
      user_id: number;
      full_name: string;
      username: string;
      role: string;
      team_code: string | null;
      ack_id: number | null;
      acked_at: string | null;
      ack_kind: 'confirm' | 'signature' | null;
      previous_version: number | null;
      previous_acked_at: string | null;
    }>();
  const rows = (rawRows ?? []).map(({ previous_version, previous_acked_at, ...r }) => ({
    ...r,
    image_url: r.ack_id !== null && r.ack_kind === 'signature' ? `/announcements/acks/${r.ack_id}/image` : null,
    previous: r.ack_id === null && previous_version !== null && previous_acked_at !== null ? { ack_version: previous_version, acked_at: previous_acked_at } : null,
  }));
  const acked = rows.filter((r) => r.ack_id !== null).length;

  // Идэвхгүй болсон / хүрээнээс гарсан ч баталгаажуулсан хүмүүс — түүх алдагдахгүй.
  const { results: extra } = await db
    .prepare(
      `SELECT k.user_id, u.full_name, u.username, u.role, tm.code AS team_code, k.id AS ack_id, k.acked_at, k.ack_kind
         FROM announcement_acks k
         LEFT JOIN users u ON u.id = k.user_id
         LEFT JOIN teams tm ON tm.id = u.team_id
        WHERE k.announcement_id = ? AND k.ack_version = ?
          AND NOT (u.id IS NOT NULL AND ${w.sql})
        ORDER BY k.acked_at DESC`,
    )
    .bind(id, wanted, ...w.binds)
    .all<{ user_id: number; full_name: string | null; username: string | null; role: string | null; team_code: string | null; ack_id: number; acked_at: string; ack_kind: 'confirm' | 'signature' }>();

  return c.json({
    ack_mode: row.ack_mode,
    ack_version: row.ack_version,
    viewing_version: wanted,
    versions: versions ?? [],
    summary: { acked, pending: rows.length - acked, total: rows.length },
    rows,
    extra: (extra ?? []).map((e) => ({ ...e, image_url: e.ack_kind === 'signature' ? `/announcements/acks/${e.ack_id}/image` : null, previous: null })),
  });
});

export default announcements;
