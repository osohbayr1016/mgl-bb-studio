/**
 * Гарын авлага (Handbook) — албан тушаал × түвшин тус бүрийн заавар.
 *
 * HR/админ ажилтан бүрд «энэ албан тушаалд, энэ түвшинд юу шаардагдах
 * вэ» гэдгийг бичнэ.  Ажилтан профайл дээрээ ЗӨВХӨН өөрийн role-д
 * хамаарах нийтлэгдсэн бичлэгүүдийг харах бөгөөд үнэлгээгээр гарсан
 * одоогийн түвшинтэй нь тохирох мөр онцлон харагдана (frontend тал).
 *
 *   GET    /api/handbook        — staff: зөвхөн published + (role = өөрийн
 *                                 role ЭСВЭЛ '*').  Draft хэзээ ч харагдахгүй.
 *   GET    /api/handbook/admin  — admin: БҮХ бичлэг (draft орно).
 *   POST   /api/handbook        — admin
 *   PUT    /api/handbook/:id    — admin
 *   DELETE /api/handbook/:id    — admin
 *
 * `role` / `level_code` нь хүснэгтгүй чөлөөт үгсийн сан (migration 0148-ын
 * тайлбарыг үз) — тиймээс шалгалт нь энд, кодод хийгдэнэ.
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import { ALL_ROLES } from '../types';
import type { Env, AppVariables } from '../types';

const handbook = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Markdown биеийн дээд хэмжээ — DB-г хамгаалсан зөөлөн таг. */
const BODY_MD_MAX_LENGTH = 20000;
const TITLE_MAX_LENGTH = 200;

/** «Бүгд» гэсэн орлуулагч — role болон level_code хоёуланд нь. */
const ANY = '*';

/** Үнэлгээний band кодууд (JSON схемийн `levels`-тэй ижил үгсийн сан). */
const LEVEL_CODES = ['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'EXPERT'] as const;

const VALID_STATUSES = ['draft', 'published'] as const;
type HandbookStatus = (typeof VALID_STATUSES)[number];

interface HandbookRow {
  id: number;
  role: string;
  level_code: string;
  title_mn: string;
  title_en: string | null;
  body_md: string;
  sort_order: number;
  status: string;
  updated_at: string;
}

const SELECT_COLS =
  'id, role, level_code, title_mn, title_en, body_md, sort_order, status, updated_at';

/** Хүчинтэй role мөр эсэх — users.role эсвэл '*'. */
function isValidRole(value: string): boolean {
  return value === ANY || (ALL_ROLES as string[]).includes(value);
}

/** Хүчинтэй band код эсэх — LEVEL_CODES эсвэл '*'. */
function isValidLevelCode(value: string): boolean {
  return value === ANY || (LEVEL_CODES as readonly string[]).includes(value);
}

interface HandbookBody {
  role?: unknown;
  level_code?: unknown;
  title_mn?: unknown;
  title_en?: unknown;
  body_md?: unknown;
  sort_order?: unknown;
  status?: unknown;
}

interface CleanEntry {
  role: string;
  level_code: string;
  title_mn: string;
  title_en: string | null;
  body_md: string;
  sort_order: number;
  status: HandbookStatus;
}

/**
 * Биеийг цэвэрлэж, шалгана.  `partial=true` (PUT) үед байхгүй талбарууд
 * нь `existing`-ээс өвлөгдөнө — ингэснээр frontend хэсэгчилсэн PUT
 * илгээж чадна.
 */
function sanitizeBody(
  body: HandbookBody,
  existing: CleanEntry | null,
): { entry: CleanEntry } | { error: string } {
  const base: CleanEntry = existing ?? {
    role: ANY,
    level_code: ANY,
    title_mn: '',
    title_en: null,
    body_md: '',
    sort_order: 0,
    status: 'published',
  };

  // role
  let role = base.role;
  if (body.role !== undefined) {
    if (typeof body.role !== 'string') return { error: 'role нь тэмдэгт мөр байх ёстой' };
    role = body.role.trim();
    if (!isValidRole(role)) return { error: `Тодорхойгүй role: ${role}` };
  }

  // level_code
  let levelCode = base.level_code;
  if (body.level_code !== undefined) {
    if (typeof body.level_code !== 'string') {
      return { error: 'level_code нь тэмдэгт мөр байх ёстой' };
    }
    levelCode = body.level_code.trim().toUpperCase();
    if (!isValidLevelCode(levelCode)) return { error: `Тодорхойгүй level_code: ${levelCode}` };
  }

  // title_mn — хоосон байж болохгүй.
  let titleMn = base.title_mn;
  if (body.title_mn !== undefined) {
    if (typeof body.title_mn !== 'string') {
      return { error: 'title_mn нь тэмдэгт мөр байх ёстой' };
    }
    titleMn = body.title_mn.trim().slice(0, TITLE_MAX_LENGTH);
  }
  if (!titleMn) return { error: 'Гарчиг (title_mn) шаардлагатай' };

  // title_en — заавал биш; хоосон мөр = NULL.
  let titleEn = base.title_en;
  if (body.title_en !== undefined) {
    if (body.title_en === null) {
      titleEn = null;
    } else if (typeof body.title_en === 'string') {
      const trimmed = body.title_en.trim().slice(0, TITLE_MAX_LENGTH);
      titleEn = trimmed.length > 0 ? trimmed : null;
    } else {
      return { error: 'title_en нь тэмдэгт мөр эсвэл null байх ёстой' };
    }
  }

  // body_md — 20000 тэмдэгтийн таг.
  let bodyMd = base.body_md;
  if (body.body_md !== undefined) {
    if (typeof body.body_md !== 'string') {
      return { error: 'body_md нь тэмдэгт мөр байх ёстой' };
    }
    if (body.body_md.length > BODY_MD_MAX_LENGTH) {
      return { error: `Агуулга хэт урт байна (дээд тал нь ${BODY_MD_MAX_LENGTH} тэмдэгт)` };
    }
    bodyMd = body.body_md;
  }

  // sort_order — бүхэл тоо.
  let sortOrder = base.sort_order;
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order)) {
      return { error: 'sort_order нь бүхэл тоо байх ёстой' };
    }
    sortOrder = body.sort_order;
  }

  // status
  let status = base.status;
  if (body.status !== undefined) {
    if (
      typeof body.status !== 'string' ||
      !(VALID_STATUSES as readonly string[]).includes(body.status)
    ) {
      return { error: "status нь 'draft' эсвэл 'published' байх ёстой" };
    }
    status = body.status as HandbookStatus;
  }

  return {
    entry: {
      role,
      level_code: levelCode,
      title_mn: titleMn,
      title_en: titleEn,
      body_md: bodyMd,
      sort_order: sortOrder,
      status,
    },
  };
}

// GET /api/handbook  (staff)
// Зөвхөн published + дуудагчийн role (эсвэл '*').  Админ ч гэсэн энд
// draft харахгүй — draft-д зориулсан /admin төгсгөл байгаа.
//
// ⚠️ `client` (гадны захиалагч) ХААЛТТАЙ — гарын авлага нь ДОТООД ажилтны
//    зэрэг/шаардлагын заавар.  `role='*'` мөрүүд нь «бүх АЖИЛТАН» гэсэн утга
//    болохоос захиалагчийг хамруулдаггүй (pgp.ts / suggestions.ts-тэй ижил
//    хаалт).  `worker` нь `lib/workerScope.ts`-ээр аль хэдийн 403 авна.
handbook.get('/', async (c) => {
  const user = c.get('user');
  if (user.role === 'client') return c.json({ error: 'Forbidden' }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT ${SELECT_COLS}
       FROM handbook_entries
      WHERE status = 'published'
        AND (role = ? OR role = '*')
      ORDER BY sort_order, id`,
  )
    .bind(user.role)
    .all<HandbookRow>();

  return c.json({ entries: results ?? [] });
});

// GET /api/handbook/admin  (admin) — draft орсон БҮХ бичлэг.
handbook.get('/admin', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${SELECT_COLS} FROM handbook_entries ORDER BY sort_order, id`,
  ).all<HandbookRow>();

  return c.json({ entries: results ?? [] });
});

// POST /api/handbook  (admin)
handbook.post('/', requireAdmin(), async (c) => {
  const body = await c.req.json<HandbookBody>().catch(() => ({}) as HandbookBody);
  const parsed = sanitizeBody(body, null);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const entry = parsed.entry;

  const user = c.get('user');
  const result = await c.env.DB.prepare(
    `INSERT INTO handbook_entries
       (role, level_code, title_mn, title_en, body_md, sort_order, status, created_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      entry.role,
      entry.level_code,
      entry.title_mn,
      entry.title_en,
      entry.body_md,
      entry.sort_order,
      entry.status,
      user.sub,
    )
    .run();

  const row = await c.env.DB.prepare(`SELECT ${SELECT_COLS} FROM handbook_entries WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first<HandbookRow>();

  if (!row) return c.json({ error: 'Хадгалсан бичлэг олдсонгүй' }, 500);
  return c.json({ entry: row }, 201);
});

// PUT /api/handbook/:id  (admin) — хэсэгчилсэн шинэчлэлт дэмжинэ.
handbook.put('/:id', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const existingRow = await c.env.DB.prepare(
    `SELECT ${SELECT_COLS} FROM handbook_entries WHERE id = ?`,
  )
    .bind(id)
    .first<HandbookRow>();
  if (!existingRow) return c.json({ error: 'Бичлэг олдсонгүй' }, 404);

  const body = await c.req.json<HandbookBody>().catch(() => ({}) as HandbookBody);
  const parsed = sanitizeBody(body, {
    role: existingRow.role,
    level_code: existingRow.level_code,
    title_mn: existingRow.title_mn,
    title_en: existingRow.title_en,
    body_md: existingRow.body_md,
    sort_order: existingRow.sort_order,
    // DB-ийн CHECK нь зөвхөн эдгээрийг зөвшөөрдөг тул cast аюулгүй.
    status: existingRow.status as HandbookStatus,
  });
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const entry = parsed.entry;

  await c.env.DB.prepare(
    `UPDATE handbook_entries
        SET role = ?, level_code = ?, title_mn = ?, title_en = ?,
            body_md = ?, sort_order = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(
      entry.role,
      entry.level_code,
      entry.title_mn,
      entry.title_en,
      entry.body_md,
      entry.sort_order,
      entry.status,
      id,
    )
    .run();

  const row = await c.env.DB.prepare(`SELECT ${SELECT_COLS} FROM handbook_entries WHERE id = ?`)
    .bind(id)
    .first<HandbookRow>();

  if (!row) return c.json({ error: 'Шинэчилсэн бичлэг олдсонгүй' }, 500);
  return c.json({ entry: row });
});

// DELETE /api/handbook/:id  (admin)
handbook.delete('/:id', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  await c.env.DB.prepare('DELETE FROM handbook_entries WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default handbook;
