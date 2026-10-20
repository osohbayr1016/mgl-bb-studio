import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { isAdminRole } from '../types';
import { d1StatsOf } from '../lib/d1Telemetry';

/**
 * ЗӨВХӨН ЛОКАЛ — D1 query-ийн `rows_read` хэмжигч (`scripts/audit-d1.mjs`-ийн
 * арын хаалга).
 *
 * `wrangler d1 execute --local --json` нь `meta.rows_read`-ыг буцаадаггүй, харин
 * Worker доторх D1 binding буцаадаг тул EXPLAIN-ээс гадна БОДИТ уншсан мөрийн
 * тоог авах цорын ганц зам энэ.  Гурван давхар хаалт:
 *
 *   1. `D1_TELEMETRY_VERBOSE=1` (prod `[vars]`-д ХЭЗЭЭ Ч тавихгүй),
 *   2. хүсэлтийн host нь loopback (`lib/devAuth.ts`-тэй ижил дүрэм),
 *   3. admin role.
 *
 * Аль нэг нь хангагдахгүй бол 404 — маршрут «байхгүй» мэт.  Зөвхөн SELECT /
 * EXPLAIN / WITH-ээр эхэлсэн текст зөвшөөрнө; бичих statement 400.
 */
const probe = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
}

probe.post('/', async (c) => {
  if (c.env.D1_TELEMETRY_VERBOSE !== '1' || !isLoopback(c.req.url)) return c.notFound();
  const user = c.get('user');
  if (!user || !isAdminRole(user.role)) return c.notFound();

  let body: { sql?: unknown; binds?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  const sql = typeof body.sql === 'string' ? body.sql.trim() : '';
  if (!/^(select|with|explain)\b/i.test(sql)) {
    return c.json({ error: 'Зөвхөн SELECT / WITH / EXPLAIN' }, 400);
  }
  const binds = Array.isArray(body.binds) ? (body.binds as unknown[]) : [];

  const stats = d1StatsOf(c.env.DB);
  const before = stats ? { r: stats.rowsRead, q: stats.queries } : null;
  const t0 = Date.now();
  const res = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();
  const ms = Date.now() - t0;
  const meta = res.meta as { rows_read?: number; rows_written?: number; duration?: number };
  return c.json({
    rows: res.results.length,
    rows_read: meta.rows_read ?? (stats && before ? stats.rowsRead - before.r : null),
    rows_written: meta.rows_written ?? null,
    duration_ms: meta.duration ?? null,
    wall_ms: ms,
    sample: res.results.slice(0, 3),
  });
});

export default probe;
