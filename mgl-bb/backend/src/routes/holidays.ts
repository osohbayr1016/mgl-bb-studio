/**
 * Holidays (баярын / ажлын бус өдрүүд) — компанийн хэмжээнд нэг календарь.
 *
 * Read нь бүх authed staff-д нээлттэй (Settings-ийн read-only preview +
 * төслийн графикийн өнгө тооцоход хэрэгтэй).  Нэмэх/устгах нь зөвхөн
 * admin.  Засвар байхгүй — устгаад дахин нэмнэ (migration 0103-ын тайлбар).
 */
import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

const holidays = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface HolidayRow {
  id: number;
  date: string;
  name: string;
  created_by: number | null;
  created_at: string;
}

// GET /api/holidays?from=yyyy-mm-dd&to=yyyy-mm-dd
// Огнооны хүрээ заавал биш — заавал бол хязгаарлана, эс бол бүгдийг.
holidays.get('/', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  const conditions: string[] = [];
  const binds: string[] = [];
  if (from) {
    conditions.push('date >= ?');
    binds.push(from);
  }
  if (to) {
    conditions.push('date <= ?');
    binds.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `SELECT id, date, name, created_by, created_at FROM holidays ${where} ORDER BY date`,
  )
    .bind(...binds)
    .all<HolidayRow>();

  return c.json({ holidays: results ?? [] });
});

// POST /api/holidays  { date: 'yyyy-mm-dd', name }  (admin)
holidays.post('/', requireRole('admin'), async (c) => {
  const body = await c.req
    .json<{ date?: string; name?: string }>()
    .catch(() => ({}) as { date?: string; name?: string });

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date (yyyy-mm-dd) шаардлагатай' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  if (!name) {
    return c.json({ error: 'Баярын нэр шаардлагатай' }, 400);
  }

  // date нь UNIQUE — давхар бол найрсаг 409.
  const existing = await c.env.DB.prepare(`SELECT id FROM holidays WHERE date = ?`)
    .bind(date)
    .first<{ id: number }>();
  if (existing) {
    return c.json({ error: 'Тухайн өдөр аль хэдийн бүртгэгдсэн байна' }, 409);
  }

  const user = c.get('user');
  let lastRowId: number | string;
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO holidays (date, name, created_by) VALUES (?, ?, ?)`,
    )
      .bind(date, name, user.sub)
      .run();
    lastRowId = result.meta.last_row_id;
  } catch (err) {
    // Дээрх pre-check болон INSERT хоёрын хооронд өөр хүсэлт ижил огноо
    // оруулсан бол UNIQUE(date) зөрчигдөнө — найрсаг 409-аар орчуулна
    // (DB constraint нь өгөгдлийн бүрэн бүтэн байдлыг хамгаалсан хэвээр).
    if (String(err).includes('UNIQUE')) {
      return c.json({ error: 'Тухайн өдөр аль хэдийн бүртгэгдсэн байна' }, 409);
    }
    throw err;
  }

  const row = await c.env.DB.prepare(
    `SELECT id, date, name, created_by, created_at FROM holidays WHERE id = ?`,
  )
    .bind(lastRowId)
    .first<HolidayRow>();

  return c.json({ holiday: row }, 201);
});

// DELETE /api/holidays/:id  (admin)
holidays.delete('/:id', requireRole('admin'), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  await c.env.DB.prepare(`DELETE FROM holidays WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

export default holidays;
