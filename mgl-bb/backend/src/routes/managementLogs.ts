/**
 * «Тайлан → Менежментийн багийн тайлан» — `/api/reports/management-logs`.
 *
 * Өдрийн ажлын тайлангийн (0345, `routes/dailyWorkLogs.ts`) БАГИЙН нэгтгэл.
 * Эзний шийдвэр (2026-10-07): зөвхөн CEO болон admin харна — `reports.ts`-ийн
 * `requireAdmin()` + энд дахин (хоёр дахь давхарга; CEO нь admin).  Бичих зам
 * БАЙХГҮЙ — тайланг зөвхөн зохиогч өөрөө `/api/daily-work-logs`-оор бичнэ/засна.
 *
 *   GET /           ?window=&anchor=  — багийн гишүүд, өдөр бүрийн тоо (матриц)
 *   GET /:userId    ?window=&anchor=  — нэг гишүүний бүх ажил (нэгтгэл + heatmap)
 *
 * Цонх нь хуудасны бусад табтай ИЖИЛ (`lib/reportWindows.ts resolveWindow`);
 * ирээдүй өнөөдрөөр таслагдана, `all` цонх анхны тайлангаас эхэлнэ.
 * Дүрэм (гишүүн, хүлээгдэх өдөр, хамрах хувь) — `lib/managementLogs.ts`.
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { todayInUB } from '../lib/time';
import { getHolidaySet } from '../lib/holidays';
import { isCeo } from '../lib/ceo';
import { daysBetween, isIsoDate, isReportWindow, resolveWindow, type ReportWindow } from '../lib/reportWindows';
import { addDays, isLate, parseStoredItems } from '../lib/dailyWorkLog';
import {
  DAILY_LOG_SINCE,
  MATRIX_ITEMS_MAX_DAYS,
  MEMBER_LOGS_LIMIT,
  expectedFrom,
  summarizeMember,
  workdaysIn,
} from '../lib/managementLogs';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();
router.use('*', requireAdmin());

interface UserRow {
  id: number;
  username: string;
  full_name: string | null;
  position: string | null;
  status: string | null;
  role: string;
  created_date: string | null;
}

const USER_COLS = `u.id, u.username, u.full_name, u.position, u.status, u.role,
       substr(u.created_at, 1, 10) AS created_date`;

/** D1-ийн `datetime('now')` нь UTC «YYYY-MM-DD HH:MM:SS» — ISO болгоно. */
const utcIso = (s: string) => (s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);

const ITEM_COUNT_SQL = `CASE WHEN json_valid(items_json) THEN json_array_length(items_json) ELSE 0 END`;

function shapeUser(u: UserRow) {
  return {
    user_id: u.id,
    name: (u.full_name ?? '').trim() || u.username,
    username: u.username,
    position: u.position,
    active: u.status !== 'inactive',
    is_admin: u.role === 'admin',
    is_ceo: isCeo(u.id),
  };
}

type Win = { window: ReportWindow; anchor: string; from: string; to: string; today: string };

/**
 * `?window=&anchor=` → муж.  `firstLog` = `all` цонхны эхлэл (анхны тайлан).
 * Буруу утга null (дуудагч 400).
 */
function readWindow(
  query: (k: string) => string | undefined,
  firstLog: string | null,
): Win | null {
  const w = query('window') ?? '7d';
  if (!isReportWindow(w)) return null;
  const today = todayInUB();
  const a = query('anchor') ?? today;
  if (!isIsoDate(a)) return null;
  const anchor = a > today ? today : a;
  const r = resolveWindow(w, anchor).current;
  const to = r.to > today ? today : r.to;
  let from = w === 'all' ? (firstLog ?? DAILY_LOG_SINCE) : r.from;
  if (from > to) from = to;
  return { window: w, anchor, from, to, today };
}

async function firstLogDate(db: D1Database, userId?: number): Promise<string | null> {
  const r = userId
    ? await db.prepare('SELECT MIN(log_date) AS d FROM daily_work_logs WHERE user_id = ?').bind(userId).first<{ d: string | null }>()
    : await db.prepare('SELECT MIN(log_date) AS d FROM daily_work_logs').first<{ d: string | null }>();
  return r?.d ?? null;
}

// GET /api/reports/management-logs — багийн нэгтгэл.
router.get('/', async (c) => {
  const db = c.env.DB;
  const win = readWindow((k) => c.req.query(k), await firstLogDate(db));
  if (!win) return c.json({ error: 'window/anchor буруу' }, 400);
  const { from, to } = win;
  const withItems = daysBetween(from, to) <= MATRIX_ITEMS_MAX_DAYS;

  const [roster, logs, lifetime, holidays] = await Promise.all([
    db
      .prepare(
        `SELECT ${USER_COLS}
           FROM users u
          WHERE (u.role = 'admin' AND u.status = 'active' AND COALESCE(u.is_support, 0) = 0)
             OR u.id IN (SELECT user_id FROM daily_work_logs WHERE log_date BETWEEN ? AND ?)`,
      )
      .bind(from, to)
      .all<UserRow>(),
    db
      .prepare(
        `SELECT user_id, log_date, first_written_on, edit_count, updated_at, ${ITEM_COUNT_SQL} AS item_count
                ${withItems ? ', items_json' : ''}
           FROM daily_work_logs
          WHERE log_date BETWEEN ? AND ?
          ORDER BY log_date`,
      )
      .bind(from, to)
      .all<{
        user_id: number;
        log_date: string;
        first_written_on: string;
        edit_count: number;
        updated_at: string;
        item_count: number | null;
        items_json?: string;
      }>(),
    db
      .prepare(
        `SELECT user_id, COUNT(*) AS days, MAX(log_date) AS last_date
           FROM daily_work_logs GROUP BY user_id`,
      )
      .all<{ user_id: number; days: number; last_date: string | null }>(),
    getHolidaySet(db, from, to),
  ]);

  const rows = logs.results ?? [];
  const byUser = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  const life = new Map((lifetime.results ?? []).map((r) => [r.user_id, r]));

  const members = (roster.results ?? []).map((u) => {
    const mine = byUser.get(u.id) ?? [];
    const expected = workdaysIn(expectedFrom(from, u.created_date), to, holidays);
    const summary = summarizeMember(
      mine.map((r) => ({ log_date: r.log_date, item_count: Number(r.item_count ?? 0), first_written_on: r.first_written_on })),
      from,
      to,
      expected,
    );
    const l = life.get(u.id);
    return {
      ...shapeUser(u),
      ...summary,
      lifetime_days: l?.days ?? 0,
      lifetime_last_date: l?.last_date ?? null,
    };
  });
  // Идэвхтэй нь эхэнд, дотроо ажлын тоогоор буурах, дараа нь нэрээр.
  members.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      b.items - a.items ||
      b.days_logged - a.days_logged ||
      a.name.localeCompare(b.name, 'mn'),
  );

  const memberIds = new Set(members.map((m) => m.user_id));
  const totals = members.reduce(
    (t, m) => ({
      items: t.items + m.items,
      person_days: t.person_days + m.days_logged,
      logged_workdays: t.logged_workdays + m.logged_workdays,
      expected_workdays: t.expected_workdays + m.expected_workdays,
      writers: t.writers + (m.days_logged > 0 ? 1 : 0),
    }),
    { items: 0, person_days: 0, logged_workdays: 0, expected_workdays: 0, writers: 0 },
  );

  return c.json({
    window: win.window,
    anchor: win.anchor,
    today: win.today,
    range: { from, to },
    since: DAILY_LOG_SINCE,
    with_items: withItems,
    workdays: workdaysIn(from, to, holidays).length,
    totals: {
      ...totals,
      members: members.length,
      coverage: totals.expected_workdays > 0 ? totals.logged_workdays / totals.expected_workdays : null,
    },
    members,
    days: rows
      .filter((r) => memberIds.has(r.user_id))
      .map((r) => ({
        user_id: r.user_id,
        date: r.log_date,
        count: Number(r.item_count ?? 0),
        late: isLate(r.first_written_on, r.log_date),
        // «Сүүлийн ажлууд» урсгалын цаг (UTC ISO) — хамгийн сүүлд хадгалсан агшин.
        updated_at: utcIso(r.updated_at),
        ...(withItems ? { items: parseStoredItems(r.items_json) } : {}),
      })),
  });
});

// GET /api/reports/management-logs/:userId — нэг гишүүний нэгтгэл.
router.get('/:userId', async (c) => {
  const db = c.env.DB;
  const userId = Number.parseInt(c.req.param('userId'), 10);
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: 'userId буруу' }, 400);

  const user = await db.prepare(`SELECT ${USER_COLS} FROM users u WHERE u.id = ?`).bind(userId).first<UserRow>();
  const first = await firstLogDate(db, userId);
  // Менежментийн багийн гишүүн биш (admin биш, тайлан ч бичээгүй) хүн энд харагдахгүй.
  if (!user || (user.role !== 'admin' && first === null)) return c.json({ error: 'Олдсонгүй' }, 404);

  const win = readWindow((k) => c.req.query(k), first);
  if (!win) return c.json({ error: 'window/anchor буруу' }, 400);
  const { from, to } = win;
  // Contribution heatmap (53 долоо хоног) — мужаас урт байж болно.
  const heatFrom = addDays(to, -370);
  const loadFrom = from < heatFrom ? from : heatFrom;

  const [rows, holidays] = await Promise.all([
    db
      .prepare(
        `SELECT log_date, items_json, first_written_on, edit_count, updated_at, ${ITEM_COUNT_SQL} AS item_count
           FROM daily_work_logs
          WHERE user_id = ? AND log_date BETWEEN ? AND ?
          ORDER BY log_date DESC
          LIMIT ${MEMBER_LOGS_LIMIT}`,
      )
      .bind(userId, loadFrom, to)
      .all<{
        log_date: string;
        items_json: string;
        first_written_on: string;
        edit_count: number;
        updated_at: string;
        item_count: number | null;
      }>(),
    getHolidaySet(db, from, to),
  ]);

  const list = rows.results ?? [];
  const summary = summarizeMember(
    list.map((r) => ({ log_date: r.log_date, item_count: Number(r.item_count ?? 0), first_written_on: r.first_written_on })),
    from,
    to,
    workdaysIn(expectedFrom(from, user.created_date), to, holidays),
  );

  return c.json({
    window: win.window,
    anchor: win.anchor,
    today: win.today,
    range: { from, to },
    heat: { from: heatFrom, to },
    member: { ...shapeUser(user), first_log_date: first },
    summary,
    logs: list.map((r) => ({
      log_date: r.log_date,
      items: parseStoredItems(r.items_json),
      first_written_on: r.first_written_on,
      late: isLate(r.first_written_on, r.log_date),
      edit_count: r.edit_count,
      updated_at: utcIso(r.updated_at),
    })),
  });
});

export default router;
