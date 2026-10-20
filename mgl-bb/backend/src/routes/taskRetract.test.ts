// «ТАСКИЙГ БУЦААХ» (эзэн 2026-10-05, migration 0386) — бодит SQLite, D1 shim, Hono `app.request()`.
// Хамрах хүрээ: миний хувь + оноо устна (бусдынх хэвээр), би таскийн нэр/«Миний ажлууд»/хувь нэмэрчээс алга болно,
// албан таймерын сэшн УСТАХГҮЙ (админы тайлан тоолсоор) ба таск дээр харагдахгүй, дахин авбал зөвхөн ШИНЭ цаг харагдана;
// хуваарилагдсан / цагаар бодогддог / идэвхгүй төсөл татгалзана.
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

const tasksRoute = (await import('./tasks.ts')).default;
const taskTimerRoute = (await import('./taskTimer.ts')).default;
const allocRoute = (await import('./taskAllocations.ts')).default;
const progressRoute = (await import('./progress.ts')).default;
const { todayInUB } = await import('../lib/time.ts');

/** Бодит D1 шиг: `bind` шинэ statement, batch = НЭГ транзакц, RETURNING мөр `results`-д. */
function d1Shim(db: DatabaseSync) {
  const exec = (sql: string, params: unknown[]) => {
    if (/\bRETURNING\b/i.test(sql)) {
      const rows = db.prepare(sql).all(...(params as never[]));
      return { results: rows, meta: { last_row_id: 0, changes: rows.length } };
    }
    const r = db.prepare(sql).run(...(params as never[]));
    return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  };
  const prepare = (sql: string, params: unknown[] = []) => {
    const stmt = {
      bind(...args: unknown[]) {
        return prepare(sql, args);
      },
      async all() {
        return { results: db.prepare(sql).all(...(params as never[])) };
      },
      async first() {
        return db.prepare(sql).get(...(params as never[])) ?? null;
      },
      async run() {
        return exec(sql, params);
      },
      runSync: () => exec(sql, params),
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

const CEO = { sub: 2, role: 'admin' };
const BAT = { sub: 3, role: 'engineer' };
const DORJ = { sub: 4, role: 'engineer' };
const SARAA = { sub: 5, role: 'architect' };
const NOMIN = { sub: 6, role: 'engineer' }; // ирцгүй
const ADMIN = { sub: 9, role: 'admin' };
type U = { sub: number; role: string };

function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT,
      status TEXT DEFAULT 'active', is_support INTEGER DEFAULT 0, profile_image TEXT,
      employee_id TEXT, attendance_unrestricted INTEGER DEFAULT 0);
    CREATE TABLE attendance_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT,
      clock_in TEXT, clock_out TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      category TEXT, progress_mode TEXT DEFAULT 'tasks', completion_questions TEXT,
      complexity TEXT, complexity_pct REAL, updated_at TEXT);
    CREATE TABLE project_team_shares (project_id INTEGER, team_id INTEGER, share_percent REAL);
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER, team_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER, name TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, component_id INTEGER, name TEXT NOT NULL,
      weight_percent REAL NOT NULL DEFAULT 10, assigned_to INTEGER, due_date TEXT, start_date TEXT,
      sort_order INTEGER DEFAULT 0, ai_completion_summary TEXT, ai_completion_summary_at TEXT);
    CREATE TABLE task_assignees (task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), self_joined INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (task_id, user_id));
    CREATE TABLE task_self_done (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, note TEXT,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE task_shares (task_id INTEGER, user_id INTEGER, share_percent REAL, is_owner INTEGER DEFAULT 0);
    CREATE TABLE task_checklist_items (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, is_done INTEGER);
    CREATE TABLE task_deadlines (id INTEGER PRIMARY KEY, task_id INTEGER);
    CREATE TABLE task_hold_periods (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER);
    CREATE TABLE project_milestones (id INTEGER PRIMARY KEY, task_id INTEGER);
    CREATE TABLE repair_entries (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, hours REAL);
    CREATE TABLE repair_marks (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, date TEXT,
      award_points INTEGER DEFAULT 1);
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER,
      percentage REAL CHECK (percentage >= 0 AND percentage <= 100), date TEXT, notes TEXT, status TEXT,
      reviewed_by INTEGER, reviewed_at TEXT, image_url TEXT, is_rest_day INTEGER DEFAULT 0,
      defer_next_day INTEGER DEFAULT 0, completion_qa TEXT, attachments TEXT, source TEXT DEFAULT 'web',
      is_baseline INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE user_points (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, project_id INTEGER,
      repair_project_id INTEGER, task_id INTEGER, progress_entry_id INTEGER, amount REAL, delta_pct REAL,
      assignee_count INTEGER, awarded_by INTEGER, source TEXT NOT NULL DEFAULT 'progress',
      awarded_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, title TEXT, body TEXT,
      link TEXT, created_at TEXT DEFAULT (datetime('now')));
    -- Ирцийн цайны цонх (албан таймер ч хэрэглэнэ) — тест өдрийн аль ч цагт ижил байхын тулд унтраасан.
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by INTEGER);
    INSERT INTO app_settings (key, value) VALUES ('lunch_enabled', '0');
  `);
  for (const f of ['0361_task_timer.sql', '0368_task_live_take.sql', '0370_task_personal_list.sql', '0376_task_allocations.sql', '0377_task_contributions.sql', '0378_allocation_ledger_links.sql', '0379_task_timer_voids.sql', '0385_task_conversions.sql', '0386_task_retractions.sql']) {
    db.exec(readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO users (id, username, full_name, role) VALUES
      (2, 'ceo', 'Захирал', 'admin'), (3, 'bat', 'Бат', 'engineer'), (4, 'dorj', 'Дорж', 'engineer'),
      (5, 'saraa', 'Сараа', 'architect'), (6, 'nomin', 'Номин', 'engineer'), (9, 'admin', 'Админ', 'admin');
    INSERT INTO projects (id, name, status, category, progress_mode, complexity_pct) VALUES
      (10, 'ABC Tower', 'active', 'AZ', 'tasks', 100), (20, 'Засвар', 'active', 'ZA', 'hours', 100),
      (30, 'Архив', 'archived', 'AZ', 'tasks', 100);
    INSERT INTO project_team_shares VALUES (10, 1, 100), (20, 1, 100), (30, 1, 100);
    INSERT INTO blocks (id, project_id, team_id, name) VALUES
      (100, 10, 1, 'Блок'), (200, 20, 1, 'Блок'), (300, 30, 1, 'Блок');
    INSERT INTO drawings (id, block_id, name) VALUES (1000, 100, 'BA-01'), (2000, 200, 'ZA-01'), (3000, 300, 'BA-01');
    INSERT INTO components (id, drawing_id, name) VALUES (1, 1000, 'К'), (2, 2000, 'К'), (3, 3000, 'К');
    INSERT INTO tasks (id, component_id, name, weight_percent, sort_order) VALUES
      (501, 1, 'Фасад', 10, 10), (502, 1, 'План', 20, 20), (504, 1, 'Огтлол', 10, 40),
      (505, 1, 'Дууссан', 10, 50), (601, 2, 'Засвар', 10, 10), (701, 3, 'Архивын таск', 10, 10);
    INSERT INTO progress_entries (task_id, user_id, percentage, date, status, created_at)
      VALUES (505, 4, 100, '2026-09-01', 'approved', '2026-09-01 10:00:00');
  `);
  db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out) VALUES
       (3, ?1, '08:55', NULL), (4, ?1, '09:00', NULL), (5, ?1, '09:01', NULL)`,
  ).run(todayInUB());

  const d1 = d1Shim(db);
  const env = { DB: d1 } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/tasks', allocRoute as never);
  app.route('/api/tasks', tasksRoute as never);
  app.route('/api/task-timer', taskTimerRoute as never);
  app.route('/api/progress', progressRoute as never);
  const req = (user: U, method: string, path: string, body?: unknown) =>
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
  const add = (taskId: number, user: U = BAT) => req(user, 'POST', `/api/progress/my-tasks/${taskId}/list`);
  const remove = (taskId: number, user: U = BAT) => req(user, 'DELETE', `/api/progress/my-tasks/${taskId}/list`);
  const start = (taskId: number, user: U = BAT) => req(user, 'POST', '/api/task-timer/start', { task_id: taskId });
  const pause = (user: U = BAT) => req(user, 'POST', '/api/task-timer/pause', {});
  const myTasks = async (user: U = BAT) =>
    (await json<{ items: Array<{ id: number; can_report: boolean; working: Array<{ user_id: number }> }> }>(
      await req(user, 'GET', '/api/progress/my-tasks'),
    )).items;
  const myIds = async (user: U = BAT) => (await myTasks(user)).map((i) => i.id).sort((a, b) => a - b);
  return { db, req, add, remove, start, pause, myTasks, myIds };
}

const json = async <T>(r: Response) => (await r.json()) as T;

function seed(h: ReturnType<typeof harness>) {
  const e = h.db.prepare(
    `INSERT INTO progress_entries (task_id, user_id, percentage, date, status, created_at) VALUES (?, ?, ?, '2026-10-04', 'approved', ?)`,
  );
  const dorjEntry = Number(e.run(501, 4, 30, '2026-10-04 10:00:00').lastInsertRowid);
  const batEntry = Number(e.run(501, 3, 60, '2026-10-04 11:00:00').lastInsertRowid);
  const p = h.db.prepare(
    `INSERT INTO user_points (user_id, project_id, task_id, progress_entry_id, amount, delta_pct, assignee_count, awarded_by)
     VALUES (?, 10, 501, ?, ?, ?, 1, ?)`,
  );
  p.run(4, dorjEntry, 3, 3, 4);
  p.run(3, batEntry, 3, 3, 3);
  h.db.exec(`INSERT INTO task_assignees (task_id, user_id) VALUES (501, 4), (501, 3);
             INSERT INTO task_checklist_items (task_id, user_id, is_done) VALUES (501, 3, 1);`);
  return { dorjEntry, batEntry };
}

/** Албан таймерын хаагдсан сэшн (цайны цонх унтраалттай тул `duration_ms` яг тоологдоно). */
function session(h: ReturnType<typeof harness>, userId: number, taskId: number, startedAt: string, endedAt: string, ms: number) {
  h.db
    .prepare(
      `INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms, start_reason, end_reason,
         started_by, ended_by, start_request_id, end_request_id, created_at, updated_at)
       VALUES (?, ?, 10, ?, ?, ?, 'start', 'pause', ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, taskId, startedAt, endedAt, ms, userId, userId, 'r-' + userId + startedAt, 'e-' + userId + startedAt, startedAt, endedAt);
}

const retract = (h: ReturnType<typeof harness>, taskId: number, user: U = BAT) =>
  h.req(user, 'POST', `/api/progress/my-tasks/${taskId}/retract`);
const contributors = async (h: ReturnType<typeof harness>) =>
  (
    await json<{ tasks: Record<string, Array<{ user_id: number; official_closed_ms: number }>> }>(
      await h.req(DORJ, 'GET', '/api/tasks/contributors?project_id=10'),
    )
  ).tasks;

test('буцаах — миний хувь + оноо устна, бусдынх хэвээр; таск «би юу ч хийгээгүй» болно', async () => {
  const h = harness();
  const { dorjEntry, batEntry } = seed(h);
  session(h, 3, 501, '2026-10-04T08:00:00.000Z', '2026-10-04T09:00:00.000Z', 3_600_000);
  assert.deepEqual(await h.myIds(BAT), [501], 'эхлээд миний жагсаалтад');

  const r = await retract(h, 501);
  assert.equal(r.status, 200);
  const body = await json<{ removed_entries: number; removed_points: number; progress_before: number; progress_after: number }>(r);
  assert.equal(body.removed_entries, 1);
  assert.equal(body.removed_points, 1);
  assert.equal(body.progress_before, 60);
  assert.equal(body.progress_after, 30, 'таскийн явц миний өмнөх бичлэг рүү буцна');

  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE id = ?').get(batEntry)!.n, 0);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE id = ?').get(dorjEntry)!.n, 1, 'Доржийнх хэвээр');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM user_points WHERE user_id = 3').get()!.n, 0);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM user_points WHERE user_id = 4').get()!.n, 1, 'Доржийн оноо хэвээр');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM task_assignees WHERE user_id = 3').get()!.n, 0);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM task_assignees WHERE user_id = 4').get()!.n, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM task_checklist_items WHERE user_id = 3').get()!.n, 0);
  assert.deepEqual(await h.myIds(BAT), [], '«Миний ажлууд»-аас алга');

  // Аудит: архив хадгалагдсан.
  const arch = h.db.prepare('SELECT entries_json, points_json FROM task_retractions').get() as { entries_json: string; points_json: string };
  assert.equal(JSON.parse(arch.entries_json).length, 1);
  assert.equal(JSON.parse(arch.points_json).length, 1);
});

test('цаг УСТАХГҮЙ: сэшн хэвээр, таск дээр харагдахгүй; дахин авбал зөвхөн ШИНЭ цаг харагдана, бусдын цаг хэвээр', async () => {
  const h = harness();
  seed(h);
  session(h, 3, 501, '2026-10-04T08:00:00.000Z', '2026-10-04T09:00:00.000Z', 3_600_000); // миний хуучин 1 цаг
  session(h, 4, 501, '2026-10-04T08:00:00.000Z', '2026-10-04T08:30:00.000Z', 1_800_000); // Доржийн 30 мин
  let list = await contributors(h);
  assert.deepEqual(
    list['501']!.map((x) => [x.user_id, x.official_closed_ms]).sort(),
    [[3, 3_600_000], [4, 1_800_000]],
  );

  assert.equal((await retract(h, 501)).status, 200);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM task_timer_sessions WHERE user_id = 3').get()!.n, 1, 'сэшн УСТААГҮЙ');
  list = await contributors(h);
  assert.deepEqual(list['501']!.map((x) => x.user_id), [4], 'Бат хувь нэмэрчийн жагсаалтаас алга; Доржийнх хэвээр');
  assert.equal(list['501']![0]!.official_closed_ms, 1_800_000);

  const state = await json<{ tasks: Array<{ task_id: number }> }>(await h.req(BAT, 'GET', '/api/task-timer/state'));
  assert.equal(state.tasks.some((t) => t.task_id === 501), false, 'таскийн нийт цаг хүнд харагдахгүй');
  const left = h.db.prepare('SELECT SUM(duration_ms) AS ms FROM task_timer_sessions WHERE user_id = 3').get()!.ms;
  assert.equal(left, 3_600_000, 'системд цаг хэвээр (админы албан таймерын тайлан тоолно)');

  // Дахин авах: буцаасан агшнаас хойших сэшн л харагдана — хуучин 1 цаг ХЭЗЭЭ Ч нэмэгдэхгүй.
  const future = new Date(Date.now() + 60_000).toISOString();
  const futureEnd = new Date(Date.now() + 120_000).toISOString();
  session(h, 3, 501, future, futureEnd, 60_000);
  list = await contributors(h);
  const bat = list['501']!.find((x) => x.user_id === 3)!;
  assert.equal(bat.official_closed_ms, 60_000, 'зөвхөн шинэ цаг; хуучин 1 цаг frontend-д харагдахгүй');
});

test('явж буй таймер зогсоно; дахин авах (цаг эхлүүлэх) → «Миний ажлууд»-д буцаж гарна', async () => {
  const h = harness();
  seed(h);
  assert.equal((await h.start(501)).status, 200);
  const r = await retract(h, 501);
  assert.equal((await json<{ timer_stopped: boolean }>(r)).timer_stopped, true);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM task_timer_sessions WHERE ended_at IS NULL').get()!.n, 0);
  assert.deepEqual(await h.myIds(BAT), []);
  assert.equal((await h.start(501)).status, 200, 'дахин авч болно');
  assert.deepEqual(await h.myIds(BAT), [501]);
});

test('татгалзах: цагаар бодогддог / идэвхгүй төсөл / олдохгүй таск / хуваарилагдсан; эрхгүй', async () => {
  const h = harness();
  const hours = await retract(h, 601);
  assert.equal(hours.status, 409);
  assert.equal((await json<{ error: string }>(hours)).error, 'HOURS_PROGRESS');
  assert.equal((await retract(h, 701)).status, 409, 'архивын төсөл');
  assert.equal((await retract(h, 99999)).status, 404);
  h.db.exec(`INSERT INTO task_roots (task_id) VALUES (502)`);
  const m = await retract(h, 502);
  assert.equal(m.status, 409);
  assert.equal((await json<{ error: string }>(m)).error, 'MANAGED_ROOT');
  assert.equal((await retract(h, 501, { sub: 7, role: 'client' })).status, 403);
});

test('бусдын бичлэг, baseline, системийн (split) бичлэг хөндөгдөхгүй', async () => {
  const h = harness();
  seed(h);
  h.db.exec(`INSERT INTO progress_entries (task_id, user_id, percentage, date, status, source, is_baseline, created_at)
             VALUES (501, 3, 10, '2026-10-01', 'approved', 'split', 0, '2026-10-01 10:00:00'),
                    (501, 3, 5, '2026-10-01', 'approved', 'web', 1, '2026-10-01 09:00:00')`);
  await retract(h, 501);
  const left = h.db.prepare(`SELECT source, is_baseline FROM progress_entries WHERE user_id = 3`).all();
  assert.equal(left.length, 2, 'split + baseline үлдэнэ');
});
