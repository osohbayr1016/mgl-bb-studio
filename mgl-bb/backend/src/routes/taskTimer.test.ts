// Албан ёсны таскийн цаг хэмжигч (0361, 0368) — БОДИТ SQLite (0360 + 0361 + 0368 миграц файлаас),
// D1 shim, Hono `app.request()`.  Захирлын 17 шаардлагын тест: эхлүүлэх/зогсоох/
// үргэлжлүүлэх, атом сэлгэлт, давхар даралт, зэрэг хүсэлт, хоёр таб/төхөөрөмж,
// сэргээх/хаах нь зогсоохгүй, 100% хаахад автоматаар зогсох, эрх, нийт/өнөөдөр,
// Revit-ийн автомат цаг албан цагт огт нөлөөлөхгүй.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const taskTimer = (await import('./taskTimer.ts')).default;
const revitTracking = (await import('./revitTracking.ts')).default;
const { submitProgressEntry } = await import('./progress.ts');
const { todayInUB } = await import('../lib/time.ts');
const { ubDayWindow } = await import('../lib/taskTimer.ts');

/**
 * D1 shim.  `batch` нь D1-ийн адил НЭГ транзакц бөгөөд ДУНДАА await-гүй —
 * зэрэг ирсэн хүсэлтүүд batch-ийн гадна (уншилтын await дээр) л солигдоно,
 * batch өөрөө бусдын дунд тасрахгүй (D1 нь бичилтийг дараалуулдаг).
 */
function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const runSync = () => {
      const r = db.prepare(sql).run(...(params as never[]));
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
    };
    const stmt = {
      bind(...args: unknown[]) {
        params = args;
        return stmt;
      },
      async all() {
        return { results: db.prepare(sql).all(...(params as never[])) };
      },
      async first() {
        return db.prepare(sql).get(...(params as never[])) ?? null;
      },
      async run() {
        return runSync();
      },
      runSync,
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT,
      status TEXT DEFAULT 'active', is_support INTEGER DEFAULT 0, profile_image TEXT,
      employee_id TEXT, attendance_unrestricted INTEGER DEFAULT 0);
    CREATE TABLE attendance_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT,
      clock_in TEXT, clock_out TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      progress_mode TEXT DEFAULT 'tasks', completion_questions TEXT, complexity_pct REAL);
    CREATE TABLE project_members (project_id INTEGER, user_id INTEGER);
    CREATE TABLE project_team_shares (project_id INTEGER, team_id INTEGER, share_percent REAL);
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER, team_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, component_id INTEGER, name TEXT NOT NULL,
      weight_percent REAL DEFAULT 10, assigned_to INTEGER, sort_order INTEGER DEFAULT 0,
      ai_completion_summary TEXT, ai_completion_summary_at TEXT);
    CREATE TABLE task_assignees (task_id INTEGER, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')),
      self_joined INTEGER DEFAULT 0, PRIMARY KEY (task_id, user_id));
    CREATE TABLE task_self_done (task_id INTEGER, user_id INTEGER, note TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER,
      percentage REAL CHECK (percentage >= 0 AND percentage <= 100), date TEXT, notes TEXT, status TEXT,
      reviewed_by INTEGER, reviewed_at TEXT, image_url TEXT, is_rest_day INTEGER DEFAULT 0,
      defer_next_day INTEGER DEFAULT 0, completion_qa TEXT, attachments TEXT, source TEXT DEFAULT 'web',
      is_baseline INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE user_points (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, project_id INTEGER,
      repair_project_id INTEGER, task_id INTEGER, progress_entry_id INTEGER, amount REAL, delta_pct REAL,
      assignee_count INTEGER, awarded_by INTEGER, source TEXT NOT NULL DEFAULT 'progress',
      awarded_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE revit_submissions (id INTEGER PRIMARY KEY, draft_uid TEXT);
    -- Ирцийн цайны цонх (албан таймер ч хэрэглэнэ).  Тест өдрийн аль ч цагт ижил
    -- байхын тулд УНТРААСАН; цайны тест өөрөө асаана.
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by INTEGER);
    INSERT INTO app_settings (key, value) VALUES ('lunch_enabled', '0');
  `);
  for (const f of ['0360_revit_work_tracking.sql', '0361_task_timer.sql', '0368_task_live_take.sql', '0370_task_personal_list.sql', '0376_task_allocations.sql', '0377_task_contributions.sql', '0378_allocation_ledger_links.sql', '0379_task_timer_voids.sql', '0385_task_conversions.sql']) {
    db.exec(readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO users (id, username, full_name, role, status, is_support) VALUES
      (1, 'ceo', 'Захирал', 'admin', 'active', 0),
      (2, 'bat', 'Бат', 'engineer', 'active', 0),
      (3, 'saraa', 'Сараа', 'architect', 'active', 0),
      (4, 'tv', 'TV', 'engineer', 'active', 1),
      (5, 'old', 'Хуучин', 'engineer', 'inactive', 0),
      (9, 'cleaner', 'Цэвэрлэгч', 'worker', 'active', 0);
    INSERT INTO projects (id, name, status) VALUES (10, 'ABC Tower', 'active'), (20, 'Архив', 'archived');
    INSERT INTO project_team_shares VALUES (10, 1, 100), (20, 1, 100);
    INSERT INTO blocks (id, project_id, team_id, name) VALUES (100, 10, 1, 'Блок'), (200, 20, 1, 'Блок');
    INSERT INTO drawings (id, block_id, name) VALUES (1000, 100, 'BA-01'), (2000, 200, 'BA-02');
    INSERT INTO components (id, drawing_id) VALUES (1, 1000), (2, 2000);
    INSERT INTO tasks (id, component_id, name, assigned_to) VALUES
      (501, 1, 'Task A', 2), (502, 1, 'Task B', 2), (503, 1, 'Task C', NULL),
      (504, 1, 'Сараагийн таск', 3), (505, 1, 'Дууссан', 2), (601, 2, 'Архивын таск', 2),
      (506, 1, 'ЗА өөрөө дууссан', 2);
    INSERT INTO task_assignees (task_id, user_id) VALUES (503, 2);
    INSERT INTO task_self_done (task_id, user_id) VALUES (506, 2);
    INSERT INTO progress_entries (task_id, user_id, percentage, date, status, created_at) VALUES
      (501, 2, 60, '2026-09-01', 'approved', '2026-09-01 10:00:00'),
      (505, 2, 100, '2026-09-02', 'approved', '2026-09-02 10:00:00');
  `);
  // 2026-10-01: таск авч цаг эхлүүлэх нь ирц нээлттэй (эсвэл чөлөөлөгдсөн) үед л.
  // Бат, Сараа өнөөдөр «Ирэх» бүртгэсэн; бусад нь бүртгээгүй.
  db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out) VALUES
       (2, ?1, '08:55', NULL), (3, ?1, '09:01', NULL)`,
  ).run(todayInUB());
  const d1 = d1Shim(db);
  const env = { DB: d1 } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/task-timer', taskTimer as never);
  app.route('/api/revit', revitTracking as never);
  const req = (user: { sub: number; role: string }, method: string, path: string, body?: unknown) =>
    app.request(
      `http://x${path}`,
      {
        method,
        headers: {
          'x-test-user': JSON.stringify(user),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
    );
  return { db, d1, req };
}

const CEO = { sub: 1, role: 'admin' };
const BAT = { sub: 2, role: 'engineer' };
const SARAA = { sub: 3, role: 'architect' };
const WORKER = { sub: 9, role: 'worker' };

interface State {
  outcome?: string;
  server_now: string;
  date: string;
  day_start: string;
  running: { session_id: number; task_id: number; task_name: string; project_name: string; started_at: string } | null;
  tasks: Array<{ task_id: number; official_closed_ms: number; sessions: number }>;
  official_today_closed_ms: number;
}
const json = async <T>(r: Response) => (await r.json()) as T;
type H = ReturnType<typeof harness>;
const start = (h: H, taskId: number, user = BAT) => h.req(user, 'POST', '/api/task-timer/start', { task_id: taskId });
const pause = (h: H, taskId?: number, user = BAT) =>
  h.req(user, 'POST', '/api/task-timer/pause', taskId === undefined ? {} : { task_id: taskId });
const state = async (h: H, user = BAT) => json<State>(await h.req(user, 'GET', '/api/task-timer/state'));

const sessions = (h: H, userId = 2) =>
  h.db
    .prepare('SELECT * FROM task_timer_sessions WHERE user_id = ? ORDER BY id')
    .all(userId) as Array<{
    id: number;
    task_id: number;
    project_id: number;
    started_at: string;
    ended_at: string | null;
    duration_ms: number | null;
    start_reason: string;
    end_reason: string | null;
  }>;
const events = (h: H) =>
  h.db.prepare('SELECT * FROM task_timer_events ORDER BY id').all() as Array<{
    action: string;
    user_id: number;
    actor_id: number;
    session_id: number;
    task_id: number;
    from_session_id: number | null;
    from_task_id: number | null;
    at: string;
  }>;
const runningCount = (h: H, userId = 2) =>
  (h.db.prepare('SELECT COUNT(*) AS n FROM task_timer_sessions WHERE user_id = ? AND ended_at IS NULL').get(userId) as {
    n: number;
  }).n;

test('1. ▶ Task A — сервер цагтай шинэ сэшн, төлөвт явж буй', async () => {
  const h = harness();
  const r = await start(h, 501);
  assert.equal(r.status, 200);
  const s = await json<State>(r);
  assert.equal(s.outcome, 'started');
  assert.equal(s.running?.task_id, 501);
  assert.equal(s.running?.task_name, 'Task A');
  assert.equal(s.running?.project_name, 'ABC Tower');
  assert.match(s.running!.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const rows = sessions(h);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ended_at, null);
  assert.equal(rows[0]!.project_id, 10, 'төсөл серверээс');
  assert.deepEqual(events(h).map((e) => e.action), ['start']);
});

test('2. ⏸ Task A — сэшн хаагдаж duration бичигдэнэ, аудит pause', async () => {
  const h = harness();
  await start(h, 501);
  const r = await pause(h, 501);
  const s = await json<State>(r);
  assert.equal(s.outcome, 'paused');
  assert.equal(s.running, null);
  const [row] = sessions(h);
  assert.ok(row!.ended_at);
  assert.equal(row!.end_reason, 'pause');
  assert.ok((row!.duration_ms ?? -1) >= 0);
  assert.deepEqual(events(h).map((e) => e.action), ['start', 'pause']);
  // Явж буй таймергүй үед дахин ⏸ — хор хөнөөлгүй.
  assert.equal((await json<State>(await pause(h, 501))).outcome, 'not_running');
});

test('3. үргэлжлүүлэх = ШИНЭ сэшн, өмнөх дууссан сэшн хөндөгдөхгүй', async () => {
  const h = harness();
  await start(h, 501);
  await pause(h, 501);
  const before = sessions(h)[0]!;
  await start(h, 501);
  const rows = sessions(h);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], before, 'дууссан сэшн өөрчлөгдөөгүй');
  assert.equal(rows[1]!.ended_at, null);
  assert.equal(rows[1]!.start_reason, 'start');
  assert.ok(rows[1]!.started_at >= before.ended_at!, 'давхцахгүй');
});

test('4. A явж байхад ▶ B — A ЯГ нэг удаа зогсож, B ЯГ нэг удаа эхэлнэ, завсаргүй', async () => {
  const h = harness();
  await start(h, 501);
  const s = await json<State>(await start(h, 502));
  assert.equal(s.outcome, 'switched');
  assert.equal(s.running?.task_id, 502);
  const rows = sessions(h);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.task_id, 501);
  assert.equal(rows[0]!.end_reason, 'switch');
  assert.equal(rows[1]!.task_id, 502);
  assert.equal(rows[1]!.start_reason, 'switch');
  assert.equal(rows[1]!.started_at, rows[0]!.ended_at, 'A-ийн төгсгөл = B-ийн эхлэл');
  const ev = events(h);
  assert.deepEqual(ev.map((e) => e.action), ['start', 'switch']);
  assert.equal(ev[1]!.from_task_id, 501, '«A нь B эхэлсэн тул зогссон» сэргээгдэнэ');
  assert.equal(ev[1]!.from_session_id, rows[0]!.id);
  assert.equal(ev[1]!.session_id, rows[1]!.id);
  assert.equal(runningCount(h), 1);
});

test('5. давхар даралт (ижил таск дахин ▶) — давхар сэшн үүсэхгүй', async () => {
  const h = harness();
  await start(h, 501);
  const again = await json<State>(await start(h, 501));
  assert.equal(again.outcome, 'already_running');
  // Сүлжээний давхар хүргэлт — зэрэг.
  await Promise.all([start(h, 501), start(h, 501), start(h, 501)]);
  assert.equal(sessions(h).length, 1);
  assert.equal(events(h).length, 1);
  assert.equal(runningCount(h), 1);
});

test('6. зэрэг ▶ A ба ▶ B — үлдэх нь ЯГ нэг явж буй сэшн; DB өөрөө хоёр дахийг хориглоно', async () => {
  const h = harness();
  const rs = await Promise.all([start(h, 501), start(h, 502), start(h, 503), start(h, 502)]);
  for (const r of rs) assert.equal(r.status, 200);
  assert.equal(runningCount(h), 1);
  const rows = sessions(h);
  // Хаагдсан бүх сэшн 'switch'-ээр, явж буй нь сүүлд ялсан таск.
  assert.ok(rows.slice(0, -1).every((r) => r.end_reason === 'switch'));
  // DB-ийн инвариант — кодыг тойрсон шууд INSERT ч хоёр дахь явж буй мөр үүсгэж чадахгүй.
  assert.throws(
    () =>
      h.db
        .prepare(
          `INSERT INTO task_timer_sessions (user_id, task_id, started_at, started_by, start_request_id, created_at, updated_at)
           VALUES (2, 501, '2026-09-29T00:00:00.000Z', 2, 'x', 'x', 'x')`,
        )
        .run(),
    /UNIQUE/,
  );
});

test('7. хоёр таб нэг canonical төлөвтэй; таб 2-оос B эхлүүлэхэд таб 1-ийн дараагийн уншилтад B', async () => {
  const h = harness();
  await start(h, 501); // таб 1
  const tab2 = await state(h);
  assert.equal(tab2.running?.task_id, 501, 'таб 2 ижил явж буй таск');
  await start(h, 502); // таб 2
  const tab1 = await state(h);
  assert.equal(tab1.running?.task_id, 502);
  // Хуучирсан таб 1 «A-г зогсоох» гэж дарав — B-г САНАМСАРГҮЙ зогсоохгүй.
  const stale = await json<State>(await pause(h, 501));
  assert.equal(stale.outcome, 'not_running');
  assert.equal(stale.running?.task_id, 502);
});

test('8. хоёр төхөөрөмж зэрэг — нэг ажилтанд хоёр албан таймер хэзээ ч үгүй', async () => {
  const h = harness();
  // Нэг токен (нэг хүн) хоёр компьютерээс зэрэг өөр таск эхлүүлэв.
  await Promise.all([start(h, 501), start(h, 503)]);
  assert.equal(runningCount(h), 1);
  // Өөр хүний таймер тусдаа — Сараа эхлүүлэхэд Батынх хөндөгдөхгүй.
  await start(h, 504, SARAA);
  assert.equal(runningCount(h, 2), 1);
  assert.equal(runningCount(h, 3), 1);
});

test('9–10. хуудас сэргээх (олон GET) ба хөтөч хаах (хүсэлтгүй) таймерыг зогсоохгүй', async () => {
  const h = harness();
  await start(h, 501);
  for (let i = 0; i < 5; i++) {
    const s = await state(h);
    assert.equal(s.running?.task_id, 501);
  }
  // «Хөтөч хаагдсан» = ямар ч хүсэлт ирэхгүй.  Хэсэг хугацааны дараа ч явсаар.
  await new Promise((r) => setTimeout(r, 25));
  const later = await state(h);
  assert.equal(later.running?.task_id, 501);
  assert.ok(Date.parse(later.server_now) - Date.parse(later.running!.started_at) >= 20);
  assert.equal(runningCount(h), 1);
  assert.equal(sessions(h)[0]!.ended_at, null);
});

test('11. хүчинтэй 100% хаалт (submitProgressEntry, асуултууд бүрэн) → таймер автоматаар зогсоно', async () => {
  const h = harness();
  await start(h, 501);
  const ctx = { db: h.d1, ai: undefined as never, waitUntil: () => {}, user: BAT };
  // Асуултгүй 100% — хаах дүрэм хэвээр 400, таймер ҮРГЭЛЖИЛНЭ.
  const bad = await submitProgressEntry(ctx, { task_id: 501, percentage: 100 } as never);
  assert.equal(bad.status, 400);
  assert.equal(runningCount(h), 1);
  // 99% — хаалт биш, таймер хэвээр.
  const mid = await submitProgressEntry(ctx, { task_id: 501, percentage: 99 } as never);
  assert.equal(mid.status, 201);
  assert.equal(runningCount(h), 1);
  // created_at нь секундын нарийвчлалтай — 99% ба 100% ижил секундэд ирвэл
  // «сүүлийн» мөр тодорхойгүй (production-ийн мэдэгдэж буй tiebreak), тестэд салгана.
  h.db.prepare(`UPDATE progress_entries SET created_at = '2026-09-03 10:00:00' WHERE percentage = 99`).run();
  const ok = await submitProgressEntry(ctx, {
    task_id: 501,
    percentage: 100,
    completion_qa: { done: 'Бүрэн', issues: 'Байхгүй', next: 'Хяналт' },
  } as never);
  assert.equal(ok.status, 201);
  assert.equal(runningCount(h), 0);
  const [row] = sessions(h);
  assert.equal(row!.end_reason, 'auto_stop_completed');
  assert.deepEqual(events(h).map((e) => e.action), ['start', 'auto_stop_completed']);
  // Дууссан таск дээр дахин ▶ — 409.
  const again = await start(h, 501);
  assert.equal(again.status, 409);
  assert.equal((await json<{ error: string }>(again)).error, 'TASK_COMPLETED');
});

test('12. өөр ажилтны таймерыг эхлүүлэх зам байхгүй — биеийн user_id үл тоогдоно', async () => {
  const h = harness();
  const r = await h.req(BAT, 'POST', '/api/task-timer/start', { task_id: 501, user_id: 3 });
  assert.equal(r.status, 200);
  assert.equal(runningCount(h, 3), 0);
  assert.equal(runningCount(h, 2), 1);
  // 2026-10-01: «хариуцагч» гэж байхгүй — Сараа 504 дээр ажиллаж байхад (хуваагдах
  // таск) Бат авах гэвэл 409 TASK_OCCUPIED + 50/50 хуваах өгөгдмөл; Батын 501 зогсохгүй.
  assert.equal((await start(h, 504, SARAA)).status, 200);
  const other = await start(h, 504);
  assert.equal(other.status, 409);
  const occ = await json<{
    error: string;
    occupied: { workers: Array<{ user_id: number }>; split: { default_weights: number[]; split_total: number } };
  }>(other);
  assert.equal(occ.error, 'TASK_OCCUPIED');
  assert.deepEqual(occ.occupied.workers.map((w) => w.user_id), [3]);
  assert.deepEqual(occ.occupied.split.default_weights, [5, 5], 'явцгүй 10% таск — 50/50');
  assert.equal(runningCount(h, 2), 1, 'Батын өмнөх таймер хөндөгдөөгүй');
  assert.equal(sessions(h).find((x) => x.ended_at === null)?.task_id, 501);
  // Бусдын өдрийн тайлан — зөвхөн admin.
  assert.equal((await h.req(SARAA, 'GET', '/api/task-timer/users/2/days')).status, 403);
  assert.equal((await h.req(CEO, 'GET', '/api/task-timer/users/2/days')).status, 200);
  assert.equal((await h.req(BAT, 'GET', '/api/task-timer/users/2/days')).status, 200);
  // Шууд харагдац — зөвхөн admin.
  assert.equal((await h.req(BAT, 'GET', '/api/task-timer/live')).status, 403);
});

test('13. авч болохгүй таск: дууссан / өөрөө дууссан / архив / олдохгүй / ирцгүй / worker / энгийн admin', async () => {
  const h = harness();
  const cases: Array<[number, number, string]> = [
    [505, 409, 'TASK_COMPLETED'],
    [506, 409, 'TASK_COMPLETED'],
    [601, 409, 'PROJECT_INACTIVE'],
    [99999, 404, 'TASK_NOT_FOUND'],
  ];
  for (const [taskId, status, code] of cases) {
    const r = await start(h, taskId);
    assert.equal(r.status, status, `task ${taskId}`);
    assert.equal((await json<{ error: string }>(r)).error, code);
  }
  // Хэн ч ажиллаагүй таск — хэн ч авна (байнгын хариуцагч байхгүй).
  assert.equal((await start(h, 503)).status, 200);
  assert.equal((await start(h, 501, WORKER)).status, 403);
  // Ирцээ «Ирэх» бүртгээгүй инженер — NOT_CLOCKED_IN; бүртгэсний дараа болно.
  h.db.exec(`INSERT INTO users (id, username, full_name, role) VALUES (7, 'dorj', 'Дорж', 'engineer')`);
  const DORJ = { sub: 7, role: 'engineer' };
  const noAtt = await start(h, 504, DORJ);
  assert.equal(noAtt.status, 409);
  assert.equal((await json<{ error: string }>(noAtt)).error, 'NOT_CLOCKED_IN');
  h.db.prepare(`INSERT INTO attendance_sessions (user_id, date, clock_in) VALUES (7, ?, '09:00')`).run(todayInUB());
  assert.equal((await start(h, 504, DORJ)).status, 200);
  // «Гарах» бүртгэсэн бол дахин ирцгүй.
  h.db.prepare(`UPDATE attendance_sessions SET clock_out = '18:00' WHERE user_id = 7`).run();
  assert.equal((await start(h, 502, DORJ)).status, 409);
  // Энгийн admin (CEO биш) таск авч ажилладаггүй — ирцээс чөлөөтэй ч ROLE_NOT_ALLOWED.
  const admin = await start(h, 502, CEO);
  assert.equal(admin.status, 403);
  assert.equal((await json<{ error: string }>(admin)).error, 'ROLE_NOT_ALLOWED');
  assert.equal((await h.req(BAT, 'POST', '/api/task-timer/start', {})).status, 400);
  assert.equal(runningCount(h, 9), 0);
});

test('14–15. таскийн нийт = бүх сэшний нийлбэр; «өнөөдөр» зөвхөн УБ-ын өнөөдрийн хэсэг', async () => {
  const h = harness();
  const today = todayInUB();
  const w = ubDayWindow(today, 480);
  const iso = (ms: number) => new Date(ms).toISOString();
  const H1 = 3_600_000;
  const ins = h.db.prepare(
    `INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms,
       start_reason, end_reason, started_by, start_request_id, created_at, updated_at)
     VALUES (2, ?, 10, ?, ?, ?, 'start', 'pause', 2, ?, ?, ?)`,
  );
  const add = (taskId: number, a: number, b: number, id: string) =>
    ins.run(taskId, iso(a), iso(b), b - a, id, iso(a), iso(b));
  add(501, w.startMs - 10 * H1, w.startMs - 8 * H1, 'y1'); // өчигдөр 2 цаг
  add(501, w.startMs - H1, w.startMs + H1, 'x1'); // шөнө дундыг давсан: өнөөдөрт 1 цаг
  add(502, w.startMs + 2 * H1, w.startMs + 3.5 * H1, 't1'); // өнөөдөр 1.5 цаг
  add(503, w.endMs + H1, w.endMs + 2 * H1, 'n1'); // маргааш (өнөөдөрт ОРОХГҮЙ)
  const s = await state(h);
  const total = new Map(s.tasks.map((t) => [t.task_id, t.official_closed_ms]));
  assert.equal(total.get(501), 4 * H1, 'бүх түүх: 2 + 2');
  assert.equal(total.get(502), 1.5 * H1);
  assert.equal(s.official_today_closed_ms, 2.5 * H1, 'өнөөдөр: 1 + 1.5');
  assert.equal(s.date, today);

  // Өдрийн тайлан: өдрөөр хуваагдсан.
  const yesterday = new Date(w.startMs - 1 + 480 * 60_000).toISOString().slice(0, 10);
  const r = await json<{ days: Array<{ date: string; official_ms: number; tasks: Array<{ task_id: number; official_ms: number }> }> }>(
    await h.req(BAT, 'GET', `/api/task-timer/users/2/days?from=${yesterday}&to=${today}`),
  );
  const byDate = new Map(r.days.map((d) => [d.date, d.official_ms]));
  assert.equal(byDate.get(yesterday), 3 * H1);
  assert.equal(byDate.get(today), 2.5 * H1);
});

test('16–17. Revit-ийн автомат цаг албан цагт огт нөлөөлөхгүй; Revit өөрийн өгөгдлөө тусад нь хадгалсаар', async () => {
  const h = harness();
  await start(h, 501);
  await pause(h, 501);
  const before = await state(h);
  const officialA = before.tasks.find((t) => t.task_id === 501)?.official_closed_ms;

  // Revit add-in нь таск A дээр 3 цагийн идэвхтэй хугацаа илгээв (0360-ийн бодит зам).
  const now = new Date().toISOString();
  const sessionId = 'cccccccccccccccccccccccccccccccc';
  const r = await h.req(BAT, 'POST', '/api/revit/tracking/sync', {
    session_id: sessionId,
    work_date: todayInUB(),
    state: 'active',
    task_id: 501,
    segments: [
      {
        segment_id: `${sessionId}-1`,
        session_id: sessionId,
        task_id: 501,
        work_date: todayInUB(),
        doc_key: 'docA',
        active_ms: 3 * 3_600_000,
        idle_ms: 0,
        rev: 1,
        first_at: now,
        last_at: now,
      },
    ],
  });
  assert.equal(r.status, 200);
  const seg = h.db.prepare('SELECT SUM(active_ms) AS ms FROM revit_work_segments WHERE user_id = 2').get() as {
    ms: number;
  };
  assert.equal(seg.ms, 3 * 3_600_000, 'Revit өөрийн хүснэгтэд хадгалсаар');

  const after = await state(h);
  assert.equal(after.tasks.find((t) => t.task_id === 501)?.official_closed_ms, officialA, 'албан нийт хөдлөөгүй');
  assert.equal(after.official_today_closed_ms, before.official_today_closed_ms);
  assert.equal(after.running, null, 'Revit таймер эхлүүлэхгүй');
  assert.ok(!JSON.stringify(after).includes('revit'), 'албан хариунд Revit-ийн талбар алга');

  const live = await json<{ rows: Array<Record<string, unknown>> }>(await h.req(CEO, 'GET', '/api/task-timer/live'));
  assert.ok(!JSON.stringify(live).includes('revit'), 'захирлын харагдацад Revit-ийн цаг алга');
});

test('захирлын харагдац: идэвхтэй ажилтнууд, явж буй таск, таскийн хуримтлал, өнөөдөр', async () => {
  const h = harness();
  await start(h, 501);
  await pause(h, 501);
  await start(h, 501);
  await start(h, 504, SARAA);
  const live = await json<{
    rows: Array<{
      user_id: number;
      running: { task_id: number; project_name: string; official_task_closed_ms: number } | null;
      official_today_closed_ms: number;
      last_stop: { reason: string } | null;
    }>;
  }>(await h.req(CEO, 'GET', '/api/task-timer/live'));
  const by = new Map(live.rows.map((r) => [r.user_id, r]));
  assert.deepEqual([...by.keys()].sort(), [1, 2, 3], 'support/inactive/worker орохгүй');
  assert.equal(by.get(2)?.running?.task_id, 501);
  assert.equal(by.get(2)?.running?.project_name, 'ABC Tower');
  assert.equal(by.get(2)?.last_stop?.reason, 'pause');
  assert.equal(by.get(3)?.running?.task_id, 504);
  assert.equal(by.get(1)?.running, null);
});

test('«миний хэсэг дууссан» (onlyUserId) — зөвхөн тэр хүний таймер; таск устгахад бүгд, сэшн үлдэнэ', async () => {
  const h = harness();
  const { stopOfficialTimersForTask } = await import('../lib/taskTimerStore.ts');
  // Хуваагдахгүй таск (жин 0) дээр хоёр хүн ЗЭРЭГ ажиллаж болно (эзэн 2026-10-01).
  h.db.exec(`UPDATE tasks SET weight_percent = 0 WHERE id = 501`);
  assert.equal((await start(h, 501)).status, 200);
  assert.equal((await start(h, 501, SARAA)).status, 200);
  const now = () => new Date().toISOString();
  const mine = await stopOfficialTimersForTask(h.d1, {
    taskId: 501,
    actorId: 2,
    nowIso: now(),
    requestId: 'self-done-req',
    reason: 'auto_stop_completed',
    onlyUserId: 2,
  });
  assert.equal(mine, 1);
  assert.equal(runningCount(h, 2), 0);
  assert.equal(runningCount(h, 3), 1, 'Сараагийнх үргэлжилсээр');
  const all = await stopOfficialTimersForTask(h.d1, {
    taskId: 501,
    actorId: 1,
    nowIso: now(),
    requestId: 'delete-req',
    reason: 'auto_stop_deleted',
  });
  assert.equal(all, 1);
  assert.equal(runningCount(h, 3), 0);
  const kinds = (h.db.prepare(`SELECT action FROM task_timer_events ORDER BY id`).all() as Array<{ action: string }>).map(
    (e) => e.action,
  );
  assert.deepEqual(kinds, ['start', 'start', 'auto_stop_completed', 'auto_stop_deleted']);
  assert.equal(
    (h.db.prepare(`SELECT COUNT(*) AS n FROM task_timer_sessions WHERE task_id = 501`).get() as { n: number }).n,
    2,
    'сэшнүүд (аудит) устахгүй',
  );
});

test('/report — мужийн нийлбэр ажилтан/төслөөр; зөвхөн admin; буруу параметр 400', async () => {
  const h = harness();
  const { date: today } = { date: todayInUB() };
  // Бат: өнөөдөр 2 цаг (Task A, ABC Tower), өчигдөр 1 цаг (Task B); Сараа: өнөөдөр явж буй.
  const day = ubDayWindow(today, 480);
  const iso = (ms: number) => new Date(ms).toISOString();
  const ins = h.db.prepare(
    `INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms,
       start_reason, end_reason, started_by, ended_by, start_request_id, end_request_id, created_at, updated_at)
     VALUES (?, ?, 10, ?, ?, ?, 'start', 'pause', ?, ?, ?, ?, ?, ?)`,
  );
  const put = (uid: number, task: number, a: number, b: number, tag: string) =>
    ins.run(uid, task, iso(a), iso(b), b - a, uid, uid, `s-${tag}`, `e-${tag}`, iso(a), iso(b));
  put(2, 501, day.startMs + 3_600_000, day.startMs + 3 * 3_600_000, 'a');
  put(2, 502, day.startMs - 86_400_000 + 3_600_000, day.startMs - 86_400_000 + 2 * 3_600_000, 'b');

  type Report = {
    from: string;
    to: string;
    window: string;
    rows: Array<{
      user_id: number;
      official_ms: number;
      active_days: number;
      sessions: number;
      tasks: number;
      running: boolean;
    }>;
    projects: Array<{ project_id: number; project_name: string; official_ms: number; people: number; tasks: number }>;
    totals: { official_ms: number; sessions: number; active_people: number; people: number };
  };
  const get = async (q: string, user = CEO) => h.req(user, 'GET', `/api/task-timer/report${q}`);

  const week = await json<Report>(await get('?window=7d'));
  const by = new Map(week.rows.map((r) => [r.user_id, r]));
  assert.deepEqual([...by.keys()].sort(), [1, 2, 3], 'support/inactive/worker орохгүй');
  assert.equal(by.get(2)!.official_ms, 3 * 3_600_000);
  assert.equal(by.get(2)!.active_days, 2);
  assert.equal(by.get(2)!.sessions, 2);
  assert.equal(by.get(2)!.tasks, 2);
  assert.equal(by.get(3)!.official_ms, 0);
  assert.equal(week.totals.official_ms, 3 * 3_600_000);
  assert.equal(week.totals.active_people, 1);
  assert.equal(week.totals.people, 3);
  assert.equal(week.projects.length, 1);
  assert.equal(week.projects[0]!.project_name, 'ABC Tower');
  assert.equal(week.projects[0]!.official_ms, 3 * 3_600_000);
  assert.equal(week.projects[0]!.people, 1);

  // Өнөөдрийн цонх: зөвхөн өнөөдрийн 2 цаг.
  const dayRep = await json<Report>(await get(`?window=day&anchor=${today}`));
  assert.equal(dayRep.rows.find((r) => r.user_id === 2)!.official_ms, 2 * 3_600_000);
  assert.equal(dayRep.rows.find((r) => r.user_id === 2)!.active_days, 1);

  // Явж буй сэшн: өнөөдрийн мужид running=true, өнгөрсөн мужид false.
  await start(h, 504, SARAA);
  const live = await json<Report>(await get('?window=day'));
  assert.equal(live.rows.find((r) => r.user_id === 3)!.running, true);
  const yesterday = new Date(day.startMs - 86_400_000 + 12 * 3_600_000).toISOString().slice(0, 10);
  const past = await json<Report>(await get(`?window=day&anchor=${yesterday}`));
  assert.equal(past.rows.find((r) => r.user_id === 3)!.running, false, 'өнгөрсөн муж «одоо» биш');
  assert.equal(past.rows.find((r) => r.user_id === 2)!.official_ms, 3_600_000);

  // all: from = анхны сэшний өдөр.
  const all = await json<Report>(await get('?window=all'));
  assert.equal(all.from, yesterday);
  assert.equal(all.rows.find((r) => r.user_id === 2)!.official_ms, 3 * 3_600_000);

  // Эрх ба параметр.
  assert.equal((await get('?window=7d', BAT)).status, 403);
  assert.equal((await get('?window=nope')).status, 400);
  assert.equal((await get('?window=7d&anchor=2999-01-01')).status, 400);
  assert.equal((await get('?window=7d&anchor=abc')).status, 400);
});

test('цайны цаг (эзэн 2026-10-01): 13:00–14:00 тоологдохгүй — /state, /days, /live, /report НЭГ дүрэм; 10-01-ээс өмнө хэвээр', async () => {
  const h = harness();
  h.db.exec(`UPDATE app_settings SET value = '1' WHERE key = 'lunch_enabled';
             INSERT INTO app_settings (key, value) VALUES ('lunch_start', '13:00'), ('lunch_end', '14:00');`);
  const ub = (s: string) => new Date(`${s.replace(' ', 'T')}:00+08:00`).toISOString();
  const ins = h.db.prepare(
    `INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms,
       start_reason, end_reason, started_by, start_request_id, created_at, updated_at)
     VALUES (?, ?, 10, ?, ?, ?, 'start', 'pause', ?, ?, ?, ?)`,
  );
  const put = (uid: number, task: number, a: string, b: string, tag: string) =>
    ins.run(uid, task, ub(a), ub(b), Date.parse(ub(b)) - Date.parse(ub(a)), uid, tag, ub(a), ub(b));
  const HR = 3_600_000;
  put(2, 501, '2026-10-01 12:30', '2026-10-01 14:30', 'a'); // цай хасагдана → 1 ц
  put(2, 501, '2026-09-30 12:30', '2026-09-30 14:30', 'b'); // 10-01-ээс өмнө → 2 ц (хэвээр)
  put(2, 502, '2026-10-01 13:10', '2026-10-01 13:50', 'c'); // бүхэлдээ цайны цагт → 0
  put(3, 504, '2026-10-01 12:00', '2026-10-01 15:00', 'd'); // Сараа: 3 ц − 1 ц = 2 ц

  const s = await state(h);
  const total = new Map(s.tasks.map((t) => [t.task_id, t.official_closed_ms]));
  assert.equal(total.get(501), 3 * HR, 'SQL ихэр: 1 + 2');
  assert.equal(total.get(502), 0);
  assert.deepEqual((s as unknown as { lunch: unknown }).lunch, { start_min: 780, end_min: 840, from: '2026-10-01', offset_min: 480 });
  // duration_ms (аудит) ТҮҮХИЙ хэвээр.
  assert.equal(
    (h.db.prepare(`SELECT duration_ms FROM task_timer_sessions WHERE start_request_id = 'a'`).get() as { duration_ms: number })
      .duration_ms,
    2 * HR,
  );

  const days = await json<{ days: Array<{ date: string; official_ms: number }> }>(
    await h.req(BAT, 'GET', '/api/task-timer/users/2/days?from=2026-09-30&to=2026-10-01'),
  );
  const byDate = new Map(days.days.map((d) => [d.date, d.official_ms]));
  assert.equal(byDate.get('2026-10-01'), HR, 'JS: 10-01 = 1 ц (цайны дотор бүхэлдээ байсан сэшн 0)');
  assert.equal(byDate.get('2026-09-30'), 2 * HR);

  // /live: Сараагийн явж буй таск дээрх өмнөх сэшн (SQL ихэр) = 2 ц.
  await start(h, 504, SARAA);
  const live = await json<{ lunch: unknown; rows: Array<{ user_id: number; running: { official_task_closed_ms: number } | null }> }>(
    await h.req(CEO, 'GET', '/api/task-timer/live'),
  );
  assert.equal(live.rows.find((r) => r.user_id === 3)!.running!.official_task_closed_ms, 2 * HR);
  assert.deepEqual(live.lunch, { start_min: 780, end_min: 840, from: '2026-10-01', offset_min: 480 });

  // /report (all): Бат 3 ц / 2 өдөр / 2 сэшн (цайны дотор бүхэлдээ байсан нь тоологдохгүй).
  const rep = await json<{ rows: Array<{ user_id: number; official_ms: number; active_days: number; sessions: number }> }>(
    await h.req(CEO, 'GET', '/api/task-timer/report?window=all'),
  );
  const bat = rep.rows.find((r) => r.user_id === 2)!;
  assert.equal(bat.official_ms, 3 * HR);
  assert.equal(bat.active_days, 2);
  assert.equal(bat.sessions, 2);

  // Ирцэд цайг унтраавал таймер ч хасахгүй (нэг эх сурвалж).
  h.db.exec(`UPDATE app_settings SET value = '0' WHERE key = 'lunch_enabled'`);
  const off = await state(h);
  assert.equal(new Map(off.tasks.map((t) => [t.task_id, t.official_closed_ms])).get(501), 4 * HR);
  assert.equal((off as unknown as { lunch: unknown }).lunch, null);
});
