/**
 * Санал хүсэлт (employee suggestions / requests) — илгээх, жагсаах, явц ахиулах.
 *
 * Урсгал:
 *   - Ажилтан POST-оор санал илгээнэ (гарчиг + тайлбар + заавал бус зураг,
 *     заавал бус нэрээ нууцлах).  Шинэ бичлэг `received` (Хүлээж авсан)
 *     төлөвтэй эхэлнэ.
 *   - Зөвхөн admin бүх саналыг GET /api/suggestions-ээр хараад PATCH-аар явцыг
 *     ахиулна: received → discussing (Хэлэлцэж байна) → resolved (Шийдвэрлэгдсэн,
 *     resolution = approved/тийм | rejected/үгүй).
 *   - Ажилтан өөрийн `received` төлөвтэй саналыг буцааж татаж болно (DELETE).
 *
 * Нэр нууцлал: `is_anonymous=1` бичлэгийн илгээгчийн нэр/зураг/id-г admin тал руу
 * буцаахдаа NULL болгож далдална (өөрийн /my хариунд бол харагдана).
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { isSingleSegmentMediaUrl } from '../lib/mediaUrl';
import { createNotification, createNotificationForReviewers } from '../lib/notify';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type SuggestionStatus = 'received' | 'discussing' | 'resolved';
type SuggestionResolution = 'approved' | 'rejected';

/** Хавсаргасан зураг (migration 0179).  `project_progress_notes.attachments_json`
 *  ба ASR-ийн `photos_json`-той ижил `[{url,name}]` хэлбэр. */
interface SuggestionImage {
  url: string;
  name: string;
}

interface SuggestionRow {
  id: number;
  user_id: number | null;
  is_anonymous: number;
  title: string;
  description: string;
  status: SuggestionStatus;
  resolution: SuggestionResolution | null;
  reviewer_id: number | null;
  reviewer_note: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  images_json: string | null;
  // Joined
  full_name?: string | null;
  profile_image?: string | null;
  team_code?: string | null;
  reviewer_name?: string | null;
}

/** Клиент рүү гарах хэлбэр — `images_json` задарч `images` болно. */
type SuggestionApi = Omit<SuggestionRow, 'images_json'> & { images: SuggestionImage[] };

const LIST_SQL = `
  SELECT s.*,
         u.full_name, u.profile_image,
         pt.code AS team_code,
         rv.full_name AS reviewer_name
  FROM suggestions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
  LEFT JOIN teams pt ON pt.id = ut_p.team_id
  LEFT JOIN users rv ON rv.id = s.reviewer_id
`;

// ---------------------------------------------------------------------------
// Хавсаргасан зураг (migration 0179)
// ---------------------------------------------------------------------------

const MAX_IMAGES = 10;
const MAX_IMAGE_URL = 512;
const MAX_IMAGE_NAME = 200;

/**
 * `/media/<НЭГ СЕГМЕНТ>` хэлбэрийг ЗААВАЛ шаардана — `authorSupervision.ts`-ийн
 * `isMediaUrl`-тэй ижил үндэслэл: (1) хавтастай түлхүүр (`email/…`,
 * `revit-addin/…`) нь `/media`-аар баталгаажуулалтгүй уншигдахаас
 * сэргийлнэ; (2) гаднын URL-ыг санал руу шургуулж, admin-ий дэлгэц дээр
 * ачаалуулахаас сэргийлнэ.
 *
 * ⚠️ УРЬД ЭНД `/^\/media\/[^/]+$/` regex байсан бөгөөд «`routes/media.ts`
 * бол `GET /:key`, ЯГ нэг сегмент тул хавтастай түлхүүр хэзээ ч
 * уншигдахгүй» гэсэн ХУДАЛ үндэслэлээр зөвтгөгдсөн байв.  Hono нь
 * `%2F`-ыг ЗАДАЛДАГ; regex өөрөө `/media/a%2Fb.png`-ыг НЭВТРҮҮЛДЭГ байв.
 * Шалгалт нь одоо `lib/mediaUrl.ts`-д, ЗАДАЛСАН утган дээр хийгддэг.
 *
 * Уртын хязгаар нь ТУСДАА шалгалт — `isSingleSegmentMediaUrl` уртыг
 * хардаггүй тул энд хэвээр үлдэнэ.
 */
function isMediaUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_IMAGE_URL && isSingleSegmentMediaUrl(v);
}

/** Хадгалагдсан JSON-ыг массив болгож унших.  Гэмтсэн/хоосон бол `[]` —
 *  унших тал хэзээ ч шидэхгүй. */
function parseImages(json: string | null | undefined): SuggestionImage[] {
  if (!json) return [];
  try {
    const arr: unknown = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .filter((a) => typeof a.url === 'string')
      .map((a) => ({ url: String(a.url), name: typeof a.name === 'string' ? a.name : '' }));
  } catch {
    return [];
  }
}

/**
 * Клиентээс ирсэн массивыг цэвэрлэнэ.  Буруу бол алдааны мессеж буцаана.
 *
 * ⚠️ Түлхүүр нь ЗААВАЛ дуудагчийнх байх ёстой (`upload.ts`-ийн `ownsKey`-тэй
 *    ижил `<userSub>-` угтвар).  Хоёр шалтгаан: (1) нууц санал дээр
 *    `anonymizeImages` объектыг ХУУЛЖ АВААД эхийг нь УСТГАДАГ тул энэ
 *    шалгалтгүй бол дурын ажилтан хүссэн `/media/<key>`-ээ (өөр хүний
 *    profile зураг, төслийн баримт) саналдаа бичээд R2-оос УСТГАЖ чадна;
 *    (2) өөр хүний файлыг өөрийн санал мэт харуулах гарцыг хаана.
 */
function normalizeImagesInput(
  raw: unknown,
  userSub: number,
): { ok: true; images: SuggestionImage[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'images нь массив байх ёстой' };
  if (raw.length > MAX_IMAGES) {
    return { ok: false, error: `Хамгийн ихдээ ${MAX_IMAGES} зураг хавсаргана` };
  }

  const cleaned: SuggestionImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Зургийн хэлбэр буруу' };
    const a = item as Record<string, unknown>;
    if (!isMediaUrl(a.url)) {
      return { ok: false, error: 'Зургийн url нь /media/<key> байх ёстой' };
    }
    const key = a.url.slice('/media/'.length);
    if (!key.startsWith(`${userSub}-`)) {
      return { ok: false, error: 'Зөвхөн өөрийн байршуулсан зургийг хавсаргана' };
    }
    const rawName = typeof a.name === 'string' ? a.name.trim() : '';
    cleaned.push({ url: a.url, name: (rawName || key).slice(0, MAX_IMAGE_NAME) });
  }
  return { ok: true, images: cleaned };
}

/**
 * ⚠️ Нэр нууцлалыг хамгаалах ЧУХАЛ алхам.
 *
 * `POST /api/upload` R2 түлхүүрийг `<userSub>-<timestamp>-<filename>` болгож
 * үүсгэдэг.  Тэр түлхүүрийг нууц саналд шууд хадгалбал admin зөвхөн URL-ыг
 * харснаараа илгээгчийн `users.id`-г уншиж чадна — өөрөөр хэлбэл `maskAnonymous`
 * хийсэн бүх ажил дэмий болно.  Тиймээс `is_anonymous=1` үед объектыг
 * `anon-<uuid>` санамсаргүй түлхүүр рүү ХУУЛЖ, эх түлхүүрийг УСТГАНА.
 * `customMetadata.uploadedBy` мөн зориудаар хуулагдахгүй бөгөөд файлын
 * анхны нэрийг ч `зураг-N` болгож сольдог (файлын нэр өөрөө нэр агуулж болно).
 *
 * Хуулж чадаагүй зургийг ОРХИНО — нэр задрахаас зураг дутсан нь дээр.
 */
async function anonymizeImages(
  bucket: R2Bucket,
  images: SuggestionImage[],
): Promise<SuggestionImage[]> {
  const out: SuggestionImage[] = [];
  for (const [i, img] of images.entries()) {
    const key = img.url.slice('/media/'.length);
    try {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const ext = (/\.[a-zA-Z0-9]{1,5}$/.exec(key)?.[0] ?? '').toLowerCase();
      const anonKey = `anon-${crypto.randomUUID()}${ext}`;
      await bucket.put(anonKey, obj.body, { httpMetadata: obj.httpMetadata });
      await bucket.delete(key);
      out.push({ url: `/media/${anonKey}`, name: `зураг-${i + 1}${ext}` });
    } catch {
      /* хуулж чадсангүй — зургийг орхино */
    }
  }
  return out;
}

/** DB мөрийг клиентийн хэлбэр рүү (images_json → images). */
function toApi(row: SuggestionRow): SuggestionApi {
  const { images_json: _omit, ...rest } = row;
  return { ...rest, images: parseImages(row.images_json) };
}

/**
 * Нэрээ нууцалсан (is_anonymous=1) бичлэгийн илгээгчийг таниулах бүх талбарыг
 * admin тал руу буцаахаас өмнө арилгана.  `is_anonymous` flag хэвээр үлдэх тул
 * UI «Нэр нууц» гэж харуулна.  Зургийн түлхүүрийг илгээх үед нь аль хэдийн
 * `anonymizeImages` цэвэрлэсэн байдаг (энд хийх зүйл үлдэхгүй).
 */
function maskAnonymous(row: SuggestionApi): SuggestionApi {
  if (row.is_anonymous !== 1) return row;
  return {
    ...row,
    user_id: null,
    full_name: null,
    profile_image: null,
    team_code: null,
  };
}

// ---------------------------------------------------------------------------
// Employee endpoints
// ---------------------------------------------------------------------------

// POST /api/suggestions — submit a new suggestion
router.post('/', async (c) => {
  const user = c.get('user');
  // Захиалагч (client) дотоод санал хүсэлт гаргахгүй — зөвхөн staff.
  if (user.role === 'client') return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : '';
  const isAnonymous = body.is_anonymous === true || body.is_anonymous === 1 ? 1 : 0;

  if (!title) return c.json({ error: 'Гарчиг шаардлагатай' }, 400);
  if (!description) return c.json({ error: 'Тайлбар шаардлагатай' }, 400);

  const imagesInput = normalizeImagesInput(body.images, user.sub);
  if (!imagesInput.ok) return c.json({ error: imagesInput.error }, 400);
  // Нууц санал → R2 түлхүүрээс илгээгчийн id-г арилгана (дээрх тайлбарыг үз).
  const images = isAnonymous
    ? await anonymizeImages(c.env.MEDIA_BUCKET, imagesInput.images)
    : imagesInput.images;

  const result = await c.env.DB.prepare(
    `INSERT INTO suggestions (user_id, is_anonymous, title, description, images_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(user.sub, isAnonymous, title, description, images.length ? JSON.stringify(images) : null)
    .run();

  const row = await c.env.DB.prepare(`${LIST_SQL} WHERE s.id = ?`)
    .bind(result.meta.last_row_id)
    .first<SuggestionRow>();

  // Бүх active admin руу мэдэгдэнэ (teamId=null → notify.ts-ийн admin fallback),
  // илгээгчийг хасна.  Нууц бол body-д нэр оруулахгүй.
  const notifyBody = isAnonymous ? title : `${row?.full_name ?? ''}: ${title}`;
  await createNotificationForReviewers(
    c.env.DB,
    null,
    'suggestion_submitted',
    'Шинэ санал хүсэлт ирлээ',
    notifyBody,
    '/app/suggestions',
    user.sub,
  );

  // POST хариу нь илгээгчийн өөрийнх тул далдлахгүй (өөрийн бичлэгээ хардаг).
  return c.json({ suggestion: row ? toApi(row) : null }, 201);
});

// GET /api/suggestions/my — caller's own suggestions
router.get('/my', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `${LIST_SQL} WHERE s.user_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 100`,
  )
    .bind(user.sub)
    .all<SuggestionRow>();
  return c.json({ suggestions: (results ?? []).map(toApi) });
});

// DELETE /api/suggestions/:id — employee withdraws their own still-"received" item
router.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(`SELECT user_id, status FROM suggestions WHERE id = ?`)
    .bind(id)
    .first<{ user_id: number; status: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  const isOwner = row.user_id === user.sub;
  const isAdmin = user.role === 'admin';
  // Ажилтан зөвхөн хэлэлцэж эхлээгүй (received) бичлэгээ татна; admin аль ч төлөвт устгана.
  if (!isAdmin && !(isOwner && row.status === 'received')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare(`DELETE FROM suggestions WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

// GET /api/suggestions — all suggestions with optional status filter (admin only)
router.get('/', requireAdmin(), async (c) => {
  const status = c.req.query('status'); // received | discussing | resolved

  const conditions: string[] = [];
  const binds: (string | number)[] = [];
  if (status) {
    conditions.push('s.status = ?');
    binds.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `${LIST_SQL}
     ${where}
     ORDER BY
       CASE s.status WHEN 'received' THEN 0 WHEN 'discussing' THEN 1 ELSE 2 END,
       s.created_at DESC, s.id DESC
     LIMIT 500`,
  )
    .bind(...binds)
    .all<SuggestionRow>();

  const counts = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'received'   THEN 1 ELSE 0 END) AS received,
       SUM(CASE WHEN status = 'discussing' THEN 1 ELSE 0 END) AS discussing,
       SUM(CASE WHEN status = 'resolved'   THEN 1 ELSE 0 END) AS resolved
     FROM suggestions`,
  ).first<{ received: number; discussing: number; resolved: number }>();

  return c.json({
    suggestions: (results ?? []).map((r) => maskAnonymous(toApi(r))),
    counts: {
      received: counts?.received ?? 0,
      discussing: counts?.discussing ?? 0,
      resolved: counts?.resolved ?? 0,
    },
  });
});

// PATCH /api/suggestions/:id — advance the workflow (admin only)
//   { status: 'discussing' }                              → received → discussing
//   { status: 'resolved', resolution: 'approved'|'rejected', note? } → resolve
router.patch('/:id', requireAdmin(), async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const nextStatus = body.status as SuggestionStatus | undefined;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null;

  if (nextStatus !== 'discussing' && nextStatus !== 'resolved') {
    return c.json({ error: 'status нь discussing эсвэл resolved байх ёстой' }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT status, user_id, title FROM suggestions WHERE id = ?`,
  )
    .bind(id)
    .first<{ status: SuggestionStatus; user_id: number; title: string }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.status === 'resolved') {
    return c.json({ error: 'Аль хэдийн шийдвэрлэгдсэн' }, 409);
  }

  let resolution: SuggestionResolution | null = null;
  if (nextStatus === 'discussing') {
    if (existing.status !== 'received') {
      return c.json({ error: 'Зөвхөн "Хүлээж авсан" саналыг хэлэлцэж эхэлнэ' }, 409);
    }
  } else {
    // resolved — resolution заавал
    if (body.resolution !== 'approved' && body.resolution !== 'rejected') {
      return c.json({ error: 'resolution нь approved эсвэл rejected байх ёстой' }, 400);
    }
    resolution = body.resolution;
  }

  await c.env.DB.prepare(
    `UPDATE suggestions
     SET status = ?, resolution = ?, reviewer_id = ?, reviewer_note = ?,
         decided_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE decided_at END,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(nextStatus, resolution, user.sub, note, nextStatus, id)
    .run();

  // Илгээгчид нь явцыг мэдэгдэнэ (өөрөө ахиулсан бол алгасна).
  if (existing.user_id !== user.sub) {
    if (nextStatus === 'discussing') {
      await createNotification(
        c.env.DB,
        existing.user_id,
        'suggestion_updated',
        'Таны санал хэлэлцэгдэж эхэллээ',
        `${existing.title}${note ? ` — ${note}` : ''}`,
        '/app/suggestions',
      );
    } else {
      await createNotification(
        c.env.DB,
        existing.user_id,
        'suggestion_resolved',
        resolution === 'approved' ? 'Таны санал зөвшөөрөгдлөө' : 'Таны санал татгалзагдлаа',
        `${existing.title}${note ? ` — ${note}` : ''}`,
        '/app/suggestions',
      );
    }
  }

  const row = await c.env.DB.prepare(`${LIST_SQL} WHERE s.id = ?`).bind(id).first<SuggestionRow>();
  return c.json({ suggestion: row ? maskAnonymous(toApi(row)) : null });
});

export default router;
