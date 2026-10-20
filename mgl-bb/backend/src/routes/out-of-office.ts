/**
 * Ажлаас гадуурх цагийн хүсэлт (out-of-office requests).
 *
 * Урсгал нь чөлөөний хүсэлттэй (leaves.ts) ижил:
 *   - ажилтан POST хийнэ (`work_date`, `category`, `hours`,
 *     optional start/end + reason)
 *   - админ/ахлах GET / approve / reject хийнэ
 *   - ажилтан зөвхөн pending байгааг өөрөө DELETE/cancel хийж болно
 *
 * Ялгаа нь `category` баганаар шалтгааныг ангилдаг (зохиогчийн
 * хяналт, хурал, бичиг баримт/зураг хүргэх, хичээл, бусад).
 * 'other' үед `reason`-д гараар бичнэ.
 */
import { Hono, type Context } from 'hono';
import { requireRole } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

type AppCtx = Context<{ Bindings: Env; Variables: AppVariables }>;
const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type OutOfOfficeCategory =
  | 'author_supervision'
  | 'meeting'
  | 'documents'
  | 'drawings'
  | 'class'
  | 'other';
const CATEGORIES: OutOfOfficeCategory[] = [
  'author_supervision',
  'meeting',
  'documents',
  'drawings',
  'class',
  'other',
];

interface OooRow {
  id: number;
  user_id: number;
  work_date: string;
  category: OutOfOfficeCategory;
  hours: number;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  attachment_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewer_id: number | null;
  reviewer_note: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  full_name?: string;
  employee_id?: string | null;
  profile_image?: string | null;
  team_code?: string | null;
  reviewer_name?: string | null;
}

const LIST_SQL = `
  SELECT oo.*,
         u.full_name, u.employee_id, u.profile_image,
         pt.code AS team_code,
         rv.full_name AS reviewer_name
  FROM out_of_office_requests oo
  JOIN users u ON u.id = oo.user_id
  LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
  LEFT JOIN teams pt ON pt.id = ut_p.team_id
  LEFT JOIN users rv ON rv.id = oo.reviewer_id
`;

function parseDate(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}
function parseTime(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  return s.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Employee endpoints
// ---------------------------------------------------------------------------

// POST /api/out-of-office — submit a new out-of-office request
router.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const workDate = parseDate(body.work_date);
  if (!workDate) {
    return c.json({ error: 'work_date шаардлагатай (yyyy-mm-dd)' }, 400);
  }

  const category = (CATEGORIES as string[]).includes(body.category)
    ? (body.category as OutOfOfficeCategory)
    : 'other';

  let hours = typeof body.hours === 'number' ? body.hours : NaN;
  if (!Number.isFinite(hours) || hours <= 0) {
    return c.json({ error: 'hours > 0 байх ёстой' }, 400);
  }
  // Нэг хүсэлтэд 16 цагаас илүү байх ёсгүй.
  if (hours > 16) hours = 16;
  hours = Math.round(hours * 100) / 100;

  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 1000)
      : null;
  // 'Бусад' ангилалд тайлбар заавал шаардана.
  if (category === 'other' && !reason) {
    return c.json({ error: '«Бусад» сонгосон бол тайлбар бичнэ үү' }, 400);
  }

  const attachment =
    typeof body.attachment_url === 'string' && body.attachment_url.trim()
      ? body.attachment_url.trim().slice(0, 500)
      : null;

  const result = await c.env.DB.prepare(
    `
    INSERT INTO out_of_office_requests
      (user_id, work_date, category, hours, start_time, end_time, reason, attachment_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      user.sub,
      workDate,
      category,
      hours,
      parseTime(body.start_time),
      parseTime(body.end_time),
      reason,
      attachment,
    )
    .run();

  const row = await c.env.DB.prepare(`${LIST_SQL} WHERE oo.id = ?`)
    .bind(result.meta.last_row_id)
    .first<OooRow>();
  return c.json({ request: row }, 201);
});

// GET /api/out-of-office/my — caller's own requests
router.get('/my', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `
    ${LIST_SQL}
    WHERE oo.user_id = ?
    ORDER BY oo.work_date DESC, oo.id DESC
    LIMIT 100
  `,
  )
    .bind(user.sub)
    .all<OooRow>();
  return c.json({ requests: results ?? [] });
});

// DELETE /api/out-of-office/:id — withdraw still-pending request
router.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT user_id, status FROM out_of_office_requests WHERE id = ?`,
  )
    .bind(id)
    .first<{ user_id: number; status: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  const isOwner = row.user_id === user.sub;
  const isManager = user.role === 'admin' || user.role === 'senior';
  if (!isManager && !(isOwner && row.status === 'pending')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare(`DELETE FROM out_of_office_requests WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Manager endpoints
// ---------------------------------------------------------------------------

router.get('/', requireRole('admin', 'senior'), async (c) => {
  const status = c.req.query('status');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const userId = c.req.query('user_id');

  const conditions: string[] = [];
  const binds: (string | number)[] = [];
  if (status) {
    conditions.push('oo.status = ?');
    binds.push(status);
  }
  if (userId) {
    conditions.push('oo.user_id = ?');
    binds.push(parseInt(userId, 10));
  }
  if (from) {
    conditions.push('oo.work_date >= ?');
    binds.push(from);
  }
  if (to) {
    conditions.push('oo.work_date <= ?');
    binds.push(to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `
    ${LIST_SQL}
    ${where}
    ORDER BY
      CASE oo.status WHEN 'pending' THEN 0 ELSE 1 END,
      oo.work_date DESC, oo.id DESC
    LIMIT 500
  `,
  )
    .bind(...binds)
    .all<OooRow>();

  const counts = await c.env.DB.prepare(
    `
    SELECT
      SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
    FROM out_of_office_requests
  `,
  ).first<{ pending: number; approved: number; rejected: number }>();

  return c.json({
    requests: results ?? [],
    counts: {
      pending: counts?.pending ?? 0,
      approved: counts?.approved ?? 0,
      rejected: counts?.rejected ?? 0,
    },
  });
});

async function decide(c: AppCtx, toStatus: 'approved' | 'rejected') {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : null;

  const existing = await c.env.DB.prepare(
    `SELECT status FROM out_of_office_requests WHERE id = ?`,
  )
    .bind(id)
    .first<{ status: string }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.status !== 'pending') {
    return c.json({ error: `Аль хэдийн "${existing.status}" төлөвт оршино` }, 409);
  }

  await c.env.DB.prepare(
    `
    UPDATE out_of_office_requests
    SET status = ?, reviewer_id = ?, reviewer_note = ?,
        decided_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `,
  )
    .bind(toStatus, user.sub, note, id)
    .run();

  const row = await c.env.DB.prepare(`${LIST_SQL} WHERE oo.id = ?`).bind(id).first<OooRow>();
  return c.json({ request: row });
}

router.post('/:id/approve', requireRole('admin', 'senior'), (c) => decide(c, 'approved'));
router.post('/:id/reject', requireRole('admin', 'senior'), (c) => decide(c, 'rejected'));

export default router;
