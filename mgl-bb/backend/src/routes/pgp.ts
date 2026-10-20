import { Hono } from 'hono';
import { requireManager } from '../middleware/auth';
import { isAdminRole } from '../types';
import type { Env, AppVariables, PgpPlanRow, PgpCommentRow } from '../types';
import { createNotification } from '../lib/notify';

/* ============================================================
 * /api/pgp — Хувь хүний хөгжлийн төлөвлөгөө (Personal Growth Plan).
 *
 *  Ажилтан өөрийн хөгжлийн төлөвлөгөөг жил бүр (period) бөглөнө.
 *  Урсгал ЭНГИЙН: submit/түгжээ байхгүй — эзэн хүссэн үедээ засаж autosave
 *  хийнэ (PUT), статус байхгүй. Жил бүр шинэ бичлэг (POST) үүсгэх ба өмнөх
 *  нь түүхээр үлдэнэ (UNIQUE(user_id, period)).
 *
 *  Маягтын бүх талбар `answers_json`-д хадгалагдана (frontend schema —
 *  quotes.data_json хэв маяг). Route хариунд `answers` object болж парслагдана.
 *
 *  Харах эрх: эзэн өөрөө + admin + senior. Admin/senior нь POST /:id/comments-
 *  оор санал (feedback) үлдээж, эзэнд мэдэгдэл очно.
 * ============================================================ */

const pgp = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Хэн бусдын PGP-г харах эрхтэй вэ — admin эсвэл senior (багийн ахлагч). */
function isPrivileged(role: string): boolean {
  return isAdminRole(role) || role === 'senior';
}

/** answers_json (string) → answers (object) болгож, comments-ийг хавсаргаж
 *  frontend-д ээлтэй хэлбэрээр буцаана. */
function serializePlan(row: PgpPlanRow, comments: PgpCommentRow[] = []) {
  let answers: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.answers_json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      answers = parsed as Record<string, unknown>;
    }
  } catch {
    answers = {};
  }
  return {
    id: row.id,
    user_id: row.user_id,
    period: row.period,
    answers,
    created_at: row.created_at,
    updated_at: row.updated_at,
    comments: comments.map((cm) => ({
      id: cm.id,
      author_id: cm.author_id,
      author_name: cm.author_name ?? null,
      note: cm.note,
      created_at: cm.created_at,
    })),
  };
}

/** Өгсөн PGP id-уудын бүх comment-ийг нэг query-ээр татаж, pgp_id-аар бүлэглэнэ. */
async function fetchCommentsByPlan(
  db: D1Database,
  planIds: number[],
): Promise<Map<number, PgpCommentRow[]>> {
  const map = new Map<number, PgpCommentRow[]>();
  if (!planIds.length) return map;
  const placeholders = planIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT pc.*, u.full_name AS author_name
       FROM pgp_comments pc
       JOIN users u ON u.id = pc.author_id
       WHERE pc.pgp_id IN (${placeholders})
       ORDER BY pc.created_at ASC, pc.id ASC`,
    )
    .bind(...planIds)
    .all<PgpCommentRow>();
  for (const r of results ?? []) {
    const arr = map.get(r.pgp_id) ?? [];
    arr.push(r);
    map.set(r.pgp_id, arr);
  }
  return map;
}

/** Нэг ажилтны бүх PGP-г (шинэ он эхэнд) comment-тэй нь буцаах туслах. */
async function listPlansForUser(db: D1Database, userId: number) {
  const { results } = await db
    .prepare(`SELECT * FROM pgp_plans WHERE user_id = ? ORDER BY period DESC, id DESC`)
    .bind(userId)
    .all<PgpPlanRow>();
  const plans = results ?? [];
  const commentMap = await fetchCommentsByPlan(
    db,
    plans.map((p) => p.id),
  );
  return plans.map((p) => serializePlan(p, commentMap.get(p.id) ?? []));
}

// ---------------------------------------------------------------------------
// Эзэн (ажилтан) — өөрийн PGP
// ---------------------------------------------------------------------------

// GET /api/pgp/my — эзний бүх period-ийн PGP (comment-той).
pgp.get('/my', async (c) => {
  const user = c.get('user');
  if (user.role === 'client') return c.json({ error: 'Forbidden' }, 403);
  const plans = await listPlansForUser(c.env.DB, user.sub);
  return c.json({ plans });
});

// GET /api/pgp/authors — PGP бөглөсөн ажилтнуудын жагсаалт (admin/senior).
//   UsersPage-ийн «Хөгжлийн төлөвлөгөө» табд харагдана. Нэг ажилтны хэдэн
//   period, хамгийн сүүлийн он/шинэчилсэн огноог нэгтгэж буцаана.
pgp.get('/authors', async (c) => {
  const viewer = c.get('user');
  if (!isPrivileged(viewer.role)) return c.json({ error: 'Forbidden' }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT u.id AS user_id, u.full_name, u.profile_image, u.employee_id, u.role,
            pt.code AS team_code, pt.name_mn AS team_name_mn,
            COUNT(p.id) AS plan_count,
            MAX(p.period) AS latest_period,
            MAX(p.updated_at) AS latest_updated_at,
            GROUP_CONCAT(p.period) AS periods
     FROM pgp_plans p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
     LEFT JOIN teams pt ON pt.id = ut_p.team_id
     GROUP BY u.id
     ORDER BY latest_updated_at DESC, u.full_name ASC`,
  ).all();
  return c.json({ authors: results ?? [] });
});

// GET /api/pgp/export — бүх ажилтны бүх period-ийн PGP-г Excel export-д
//   зориулж flat мөрөөр буцаана (admin/senior). Нэг мөр = ажилтан × period;
//   хэрэглэгчийн нэр/багийг /authors-тай ижил primary-team join-оор хавсаргана.
pgp.get('/export', async (c) => {
  const viewer = c.get('user');
  if (!isPrivileged(viewer.role)) return c.json({ error: 'Forbidden' }, 403);

  type ExportRow = PgpPlanRow & {
    full_name: string;
    employee_id: string | null;
    team_code: string | null;
    team_name_mn: string | null;
  };
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.full_name, u.employee_id,
            pt.code AS team_code, pt.name_mn AS team_name_mn
     FROM pgp_plans p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN user_teams ut_p ON ut_p.user_id = p.user_id AND ut_p.is_primary = 1
     LEFT JOIN teams pt ON pt.id = ut_p.team_id
     ORDER BY u.full_name ASC, p.period DESC`,
  ).all<ExportRow>();
  const rows = results ?? [];
  const commentMap = await fetchCommentsByPlan(
    c.env.DB,
    rows.map((r) => r.id),
  );
  return c.json({
    rows: rows.map((r) => ({
      ...serializePlan(r, commentMap.get(r.id) ?? []),
      full_name: r.full_name,
      employee_id: r.employee_id,
      team_code: r.team_code,
      team_name_mn: r.team_name_mn,
    })),
  });
});

// POST /api/pgp — тухайн жилийн (period) PGP үүсгэх. Давхардвал 409.
pgp.post('/', async (c) => {
  const user = c.get('user');
  if (user.role === 'client') return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const period = typeof body.period === 'string' ? body.period.trim() : '';
  if (!/^\d{4}$/.test(period)) {
    return c.json({ error: 'period нь 4 оронтой он байх ёстой' }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM pgp_plans WHERE user_id = ? AND period = ?`,
  )
    .bind(user.sub, period)
    .first<{ id: number }>();
  if (existing) {
    return c.json({ error: 'Тухайн жилийн төлөвлөгөө аль хэдийн байна', plan_id: existing.id }, 409);
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO pgp_plans (user_id, period, answers_json) VALUES (?, ?, '{}') RETURNING *`,
  )
    .bind(user.sub, period)
    .first<PgpPlanRow>();
  if (!row) return c.json({ error: 'Failed to create' }, 500);

  return c.json({ plan: serializePlan(row) }, 201);
});

// PUT /api/pgp/:id — маягтын агуулгыг хадгалах (autosave). Зөвхөн эзэн; түгжээгүй.
pgp.put('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(`SELECT user_id FROM pgp_plans WHERE id = ?`)
    .bind(id)
    .first<{ user_id: number }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== user.sub) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const answers =
    body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
      ? (body.answers as Record<string, unknown>)
      : {};
  const answersJson = JSON.stringify(answers);
  if (answersJson.length > 100_000) {
    return c.json({ error: 'Агуулга хэт урт байна' }, 413);
  }

  await c.env.DB.prepare(
    `UPDATE pgp_plans SET answers_json = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(answersJson, id)
    .run();

  const updated = await c.env.DB.prepare(`SELECT updated_at FROM pgp_plans WHERE id = ?`)
    .bind(id)
    .first<{ updated_at: string }>();
  return c.json({ ok: true, updated_at: updated?.updated_at ?? null });
});

// DELETE /api/pgp/:id — зөвхөн эзэн өөрийн PGP-г устгана (comment-той нь).
pgp.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(`SELECT user_id FROM pgp_plans WHERE id = ?`)
    .bind(id)
    .first<{ user_id: number }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== user.sub) return c.json({ error: 'Forbidden' }, 403);

  // D1-д FK cascade хангалтгүй байж болзошгүй тул comment-ийг гараар устгана.
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM pgp_comments WHERE pgp_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM pgp_plans WHERE id = ?`).bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Удирдлага (admin + senior) — бусдын PGP харах + санал өгөх
// ---------------------------------------------------------------------------

// GET /api/pgp/user/:userId — тухайн ажилтны PGP-ууд (admin/senior эсвэл өөрөө).
pgp.get('/user/:userId', async (c) => {
  const viewer = c.get('user');
  const userId = parseInt(c.req.param('userId') ?? '', 10);
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid id' }, 400);

  const isSelf = viewer.sub === userId;
  if (!isPrivileged(viewer.role) && !isSelf) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const plans = await listPlansForUser(c.env.DB, userId);
  return c.json({ plans });
});

// POST /api/pgp/:id/comments — санал (feedback) нэмэх (admin + senior).
pgp.post('/:id/comments', requireManager(), async (c) => {
  const author = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';
  if (!note) return c.json({ error: 'Санал хоосон байна' }, 400);

  const plan = await c.env.DB.prepare(`SELECT id, user_id, period FROM pgp_plans WHERE id = ?`)
    .bind(id)
    .first<{ id: number; user_id: number; period: string }>();
  if (!plan) return c.json({ error: 'Not found' }, 404);

  const inserted = await c.env.DB.prepare(
    `INSERT INTO pgp_comments (pgp_id, author_id, note) VALUES (?, ?, ?) RETURNING *`,
  )
    .bind(id, author.sub, note)
    .first<PgpCommentRow>();
  if (!inserted) return c.json({ error: 'Failed to add comment' }, 500);

  const authorRow = await c.env.DB.prepare(`SELECT full_name FROM users WHERE id = ?`)
    .bind(author.sub)
    .first<{ full_name: string }>();

  // Эзэнд мэдэгдэнэ (өөрөө санал үлдээсэн бол алгасна).
  if (plan.user_id !== author.sub) {
    await createNotification(
      c.env.DB,
      plan.user_id,
      'pgp_feedback',
      'Хөгжлийн төлөвлөгөөнд санал ирлээ',
      `${plan.period} оны төлөвлөгөө — ${authorRow?.full_name ?? ''}`,
      '/app/profile',
    );
  }

  return c.json(
    {
      comment: {
        id: inserted.id,
        pgp_id: inserted.pgp_id,
        author_id: inserted.author_id,
        author_name: authorRow?.full_name ?? null,
        note: inserted.note,
        created_at: inserted.created_at,
      },
    },
    201,
  );
});

export default pgp;
