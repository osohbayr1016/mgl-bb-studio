/**
 * Өдрийн ажлын тайлан (миграц 0345) — `/api/daily-work-logs`.
 *
 * Админ (= «Менежмент» баг) өдөрт хийсэн ажлаа 1. 2. 3. гэж бичнэ; насан
 * туршид хадгалагдаж нотолгоо болно.  Эзний шийдвэр (2026-09-24):
 *   * ЭНЭ router ЗӨВХӨН өөрийнхөө — бүх зам `user.sub`-аар шүүнэ, өөр хүний id
 *     авах параметр ЗОРИУД байхгүй.  ⚠️ 2026-10-07-нд эзэн өөрчилсөн: CEO болон
 *     admin «Тайлан → Менежментийн багийн тайлан»-аас багийн БҮХ гишүүний
 *     тайланг уншина — тэр нь ТУСДАА `routes/managementLogs.ts`
 *     (`/api/reports/management-logs`, `requireAdmin`), энд биш.
 *   * Өнгөрсөн өдрийг засаж / нөхөж болно, өмнөх хувилбар
 *     `daily_work_log_revisions`-д үлдэнэ.  Устгах зам байхгүй.
 *
 * ⚠️ Угтвар нь ШИНЭ тул `lib/workerScope.ts` ба `lib/clientScope.ts`-ийн
 *    цагаан жагсаалтаар worker/client-д аль хэдийн хаалттай; доорх role
 *    хаалт нь хоёр дахь давхарга.  MCP-д хэрэгсэл БАЙХГҮЙ.
 */
import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { todayInUB } from '../lib/time';
import {
  DAILY_LOG_ROLES,
  MAX_ACTIVITY_DAYS,
  MAX_RANGE_DAYS,
  addDays,
  checkLogDate,
  isLate,
  itemsEqual,
  monthBounds,
  normalizeItems,
  parseStoredItems,
  rangeBounds,
} from '../lib/dailyWorkLog';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

router.use('*', requireRole(...DAILY_LOG_ROLES));

interface LogRow {
  id: number;
  log_date: string;
  items_json: string;
  first_written_on: string;
  edit_count: number;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  items_json: string;
  valid_from: string;
  replaced_at: string;
}

/** D1-ийн `datetime('now')` нь UTC «YYYY-MM-DD HH:MM:SS» — ISO болгоно. */
const utcIso = (s: string) => (s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);

function shapeLog(r: LogRow) {
  return {
    log_date: r.log_date,
    items: parseStoredItems(r.items_json),
    first_written_on: r.first_written_on,
    late: isLate(r.first_written_on, r.log_date),
    edit_count: r.edit_count,
    created_at: utcIso(r.created_at),
    updated_at: utcIso(r.updated_at),
  };
}

const LOG_COLS = 'id, log_date, items_json, first_written_on, edit_count, created_at, updated_at';

async function loadLog(db: D1Database, userId: number, date: string) {
  return db
    .prepare(`SELECT ${LOG_COLS} FROM daily_work_logs WHERE user_id = ? AND log_date = ?`)
    .bind(userId, date)
    .first<LogRow>();
}

async function loadLifetime(db: D1Database, userId: number) {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS days, MIN(log_date) AS first_date
         FROM daily_work_logs WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ days: number; first_date: string | null }>();
  return { days: r?.days ?? 0, first_date: r?.first_date ?? null };
}

// GET /api/daily-work-logs?month=YYYY-MM          — тухайн сар
// GET /api/daily-work-logs?from=YYYY-MM-DD&to=…   — календарийн харагдац
//     (7 хоног, сарын 6×7 тор, «Нэгтгэл» — сарын хилийг давдаг; ≤ MAX_RANGE_DAYS).
router.get('/', async (c) => {
  const user = c.get('user');
  const today = todayInUB();
  const fromQ = c.req.query('from');
  const toQ = c.req.query('to');
  let month: string | null = null;
  let bounds: { from: string; to: string } | null;
  if (fromQ !== undefined || toQ !== undefined) {
    bounds = rangeBounds(fromQ ?? '', toQ ?? '', MAX_RANGE_DAYS);
    if (!bounds) {
      return c.json({ error: `from/to нь YYYY-MM-DD, from ≤ to, ${MAX_RANGE_DAYS} өдрөөс ихгүй` }, 400);
    }
  } else {
    month = c.req.query('month') ?? today.slice(0, 7);
    bounds = monthBounds(month);
    if (!bounds) return c.json({ error: 'month нь YYYY-MM хэлбэртэй байна' }, 400);
  }

  const [rows, lifetime] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ${LOG_COLS} FROM daily_work_logs
        WHERE user_id = ? AND log_date BETWEEN ? AND ?
        ORDER BY log_date DESC`,
    )
      .bind(user.sub, bounds.from, bounds.to)
      .all<LogRow>(),
    loadLifetime(c.env.DB, user.sub),
  ]);

  return c.json({
    today,
    month,
    from: bounds.from,
    to: bounds.to,
    logs: (rows.results ?? []).map(shapeLog),
    lifetime,
  });
});

// GET /api/daily-work-logs/activity?from=&to=[&items=1] — contribution heatmap:
// өдөр бүрийн АЖЛЫН ТОО (дугаарласан мөрийн тоо).  Өгөгдмөл: өнөөдрөөс 364
// хоног өмнөөс өнөөдөр хүртэл.  `items=1` бол өдрийн ажлуудыг ч буцаана —
// нүдэн дээр hover хийхэд тэр өдрийн ажил шууд харагдана (өөрийнх л тул
// бичвэр буцаахад нууцлалын асуудалгүй).  ⚠️ `/:date`-ээс ДЭЭР байх ёстой
// (эс бөгөөс «activity» огноо гэж уншигдаж 400).
router.get('/activity', async (c) => {
  const user = c.get('user');
  const today = todayInUB();
  const withItems = c.req.query('items') === '1';
  const to = c.req.query('to') ?? today;
  const from = c.req.query('from') ?? addDays(to, -364);
  const bounds = rangeBounds(from, to, MAX_ACTIVITY_DAYS);
  if (!bounds) {
    return c.json({ error: `from/to нь YYYY-MM-DD, from ≤ to, ${MAX_ACTIVITY_DAYS} өдрөөс ихгүй` }, 400);
  }

  // `json_valid` — эвдэрсэн мөр бүх асуулгыг «malformed JSON»-оор унагахгүй.
  const [rows, lifetime] = await Promise.all([
    c.env.DB.prepare(
      `SELECT log_date,
              CASE WHEN json_valid(items_json) THEN json_array_length(items_json) ELSE 0 END AS item_count
              ${withItems ? ', items_json' : ''}
         FROM daily_work_logs
        WHERE user_id = ? AND log_date BETWEEN ? AND ?
        ORDER BY log_date`,
    )
      .bind(user.sub, bounds.from, bounds.to)
      .all<{ log_date: string; item_count: number | null; items_json?: string }>(),
    loadLifetime(c.env.DB, user.sub),
  ]);

  return c.json({
    today,
    from: bounds.from,
    to: bounds.to,
    days: (rows.results ?? []).map((r) => ({
      date: r.log_date,
      count: Number(r.item_count ?? 0),
      ...(withItems ? { items: parseStoredItems(r.items_json) } : {}),
    })),
    lifetime,
  });
});

// GET /api/daily-work-logs/:date — нэг өдөр + засварын түүх (шинээс хуучин руу).
router.get('/:date', async (c) => {
  const user = c.get('user');
  const date = c.req.param('date');
  const bad = checkLogDate(date, todayInUB());
  if (bad) return c.json({ error: bad }, 400);

  const row = await loadLog(c.env.DB, user.sub, date);
  if (!row) return c.json({ log: null, revisions: [] });
  const revs = await c.env.DB.prepare(
    `SELECT items_json, valid_from, replaced_at FROM daily_work_log_revisions
      WHERE log_id = ? ORDER BY id DESC`,
  )
    .bind(row.id)
    .all<RevisionRow>();
  return c.json({
    log: shapeLog(row),
    revisions: (revs.results ?? []).map((r) => ({
      items: parseStoredItems(r.items_json),
      valid_from: utcIso(r.valid_from),
      replaced_at: utcIso(r.replaced_at),
    })),
  });
});

// PUT /api/daily-work-logs/:date  { items: string[] } эсвэл { text } [+ base_edit_count]
//
// Зэрэг хадгалалт (2026-10-15).  Баруун доод тэмдэглэл, профайлын засварлагч, хоёр таб нэг өдрийг зэрэг бичиж болно.
// Өмнө нь «уншаад → түүхэнд хуучныг → шинэчлэх» нь CAS-гүй байсан тул хоёр хүсэлт хоёулаа ИЖИЛ хуучин хувилбарыг
// уншиж, эхнийх нь бичсэн агуулга ТҮҮХЭНД Ч ОРОЛГҮЙ алга болдог байв («насан туршийн нотолгоо» гэдгийг зөрчинө).
//   * Сервер талын CAS ҮРГЭЛЖ: түүхийн мөр нь DB-д ОДОО байгаа хувилбараас (`INSERT … SELECT … WHERE edit_count = ?`),
//     шинэчлэл ч ижил нөхцөлтэй — нэг batch (= нэг транзакц) тул хоёулаа эсвэл аль нь ч биш.  Тэр хооронд өөр хүсэлт
//     бичсэн бол дахин уншиж давтана → ямар ч хувилбар түүхээс алга болохгүй.
//   * `base_edit_count` (клиентийн засаж эхэлсэн хувилбар; `null` = «тайлан байгаагүй») ирвэл, DB өөр хувилбартай
//     байхад 409 `STALE_LOG` + одоогийн хувилбар — хэрэглэгч «дарах / сервер хувилбарыг ачаалах»-ыг сонгоно.
//     Ирээгүй бол (хуучин клиент) сүүлд бичсэн нь ялна, гэхдээ түүх бүрэн.
const MAX_CAS_RETRIES = 4;

router.put('/:date', async (c) => {
  const user = c.get('user');
  const date = c.req.param('date');
  const today = todayInUB();
  const bad = checkLogDate(date, today);
  if (bad) return c.json({ error: bad }, 400);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const v = normalizeItems(body.items ?? body.text);
  if (!v.ok) return c.json({ error: v.error, code: v.code }, 400);
  const json = JSON.stringify(v.items);

  // undefined = шалгахгүй; null = «байхгүй гэж үзсэн»; тоо = тэр хувилбар.
  const rawBase = body.base_edit_count;
  if (rawBase !== undefined && rawBase !== null && !(typeof rawBase === 'number' && Number.isSafeInteger(rawBase) && rawBase >= 0)) {
    return c.json({ error: 'base_edit_count нь сөрөг биш бүхэл тоо эсвэл null', code: 'BAD_BASE' }, 400);
  }
  const base = rawBase as number | null | undefined;
  const stale = (current: LogRow) =>
    c.json(
      {
        error: 'Энэ өдрийн тайланг өөр газраас өөрчилсөн байна',
        code: 'STALE_LOG',
        log: shapeLog(current),
      },
      409,
    );

  let row = await loadLog(c.env.DB, user.sub, date);
  if (!row) {
    // Давхар дарсан хоёр хүсэлт — UNIQUE-д унахгүйн тулд DO NOTHING, дараа
    // нь дахин уншаад засварын зам руу орно.
    const ins = await c.env.DB.prepare(
      `INSERT INTO daily_work_logs (user_id, log_date, items_json, first_written_on)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, log_date) DO NOTHING`,
    )
      .bind(user.sub, date, json, today)
      .run();
    row = await loadLog(c.env.DB, user.sub, date);
    if (!row) return c.json({ error: 'Хадгалж чадсангүй' }, 500);
    if ((ins.meta?.changes ?? 0) > 0) return c.json({ log: shapeLog(row), changed: true }, 201);
  }

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    // Хүссэн агуулга аль хэдийн DB-д байвал зөрчил биш.
    if (itemsEqual(parseStoredItems(row.items_json), v.items)) {
      return c.json({ log: shapeLog(row), changed: false });
    }
    if (base !== undefined && base !== row.edit_count) return stale(row);

    const expected = row.edit_count;
    // Өмнөх хувилбарыг (DB-д ОДОО байгаагаас) түүхэнд, дараа нь шинэчлэл — нэг транзакцид, ижил нөхцөлтэй.
    const res = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO daily_work_log_revisions (log_id, items_json, valid_from)
         SELECT id, items_json, updated_at FROM daily_work_logs WHERE id = ? AND edit_count = ?`,
      ).bind(row.id, expected),
      c.env.DB.prepare(
        `UPDATE daily_work_logs
            SET items_json = ?, edit_count = edit_count + 1, updated_at = datetime('now')
          WHERE id = ? AND edit_count = ?`,
      ).bind(json, row.id, expected),
    ]);
    const next = await loadLog(c.env.DB, user.sub, date);
    if ((res[1]?.meta?.changes ?? 0) > 0) {
      return c.json({ log: next ? shapeLog(next) : null, changed: true });
    }
    // Тэр хооронд өөр хүсэлт бичсэн — шинэ хувилбар дээр дахин.
    if (!next) return c.json({ error: 'Хадгалж чадсангүй' }, 500);
    row = next;
  }
  return stale(row);
});

export default router;
