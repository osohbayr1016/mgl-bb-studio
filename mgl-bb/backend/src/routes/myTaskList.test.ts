// «Миний ажлууд»-ын хувийн жагсаалт (эзэн 2026-10-01, migration 0370).
// БОДИТ SQLite (0361 + 0368 + 0370 миграц файлаас), D1 shim, Hono `app.request()`.
//
// Хамрах хүрээ: «Миний ажилд нэмэх» нь ЗӨВХӨН тухайн хүнд харагдана (таск дээрх нэр,
// бүртгэл, бусдын жагсаалт хөндөгдөхгүй); «Миний ажлууд»-аас шууд цаг эхлүүлэх; зогсоосон ч
// жагсаалтад үлдэх; өөр хүн ажиллаж байвал «Миний ажлууд»-ын шууд мэдээлэл (`?mine=1`);
// хасах (ажилласан таскийг ч), дахин авахад буцах; нэмэх эрх; хуваалтад жагсаалт дагах;
// таск устгахад цэвэрлэгдэх.  Цэвэр SQL: `lib/myTaskList.ts`.
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
  for (const f of ['0361_task_timer.sql', '0368_task_live_take.sql', '0370_task_personal_list.sql', '0376_task_allocations.sql', '0377_task_contributions.sql', '0378_allocation_ledger_links.sql', '0379_task_timer_voids.sql', '0385_task_conversions.sql']) {
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

test('«Миний ажилд нэмэх» — ЗӨВХӨН надад: «Миний ажлууд»-д гарна, таск дээр нэр/бүртгэл үүсэхгүй, бусдад харагдахгүй', async () => {
  const h = harness();
  const r = await h.add(501);
  assert.equal(r.status, 200);
  assert.deepEqual(await json(r), { ok: true, task_id: 501, in_list: true });
  const mine = await h.myTasks();
  assert.deepEqual(mine.map((i) => i.id), [501]);
  assert.equal(mine[0]!.can_report, false, 'цаг эхлүүлээгүй — хувь оруулах эрхгүй (эхлүүлэх товч гарна)');
  assert.deepEqual(await h.myIds(DORJ), [], 'Доржийн жагсаалтад орохгүй');
  // Таск дээрх нэр = одоо цаг нь явж буй хүн — нэмэх нь цаг эхлүүлэхгүй.
  const w = await json<{ workers: unknown[] }>(await h.req(DORJ, 'GET', '/api/task-timer/working?project_id=10'));
  assert.deepEqual(w.workers, []);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM task_assignees').get()!.n, 0, 'бүртгэлд орохгүй');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM task_timer_sessions').get()!.n, 0);
  // Төслийн хуудасны товчны төлөв.
  const ids = await json<{ task_ids: number[] }>(await h.req(BAT, 'GET', '/api/progress/my-tasks/ids?project_id=10'));
  assert.deepEqual(ids.task_ids, [501]);
  const none = await json<{ task_ids: number[] }>(await h.req(DORJ, 'GET', '/api/progress/my-tasks/ids?project_id=10'));
  assert.deepEqual(none.task_ids, []);
  assert.equal((await h.req(BAT, 'GET', '/api/progress/my-tasks/ids')).status, 400);
  // Давхар дарах — идемпотент.
  assert.equal((await h.add(501)).status, 200);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM task_personal_list').get()!.n, 1);
});

test('«Миний ажлууд»-аас шууд цаг эхлүүлнэ → таск дээр нэр гарна; зогсоосон ч жагсаалтад үлдэнэ', async () => {
  const h = harness();
  await h.add(501);
  const s = await h.start(501);
  assert.equal(s.status, 200);
  assert.equal((await json<{ outcome: string }>(s)).outcome, 'started');
  const w = await json<{ workers: Array<{ task_id: number; user_id: number }> }>(
    await h.req(DORJ, 'GET', '/api/task-timer/working?project_id=10'),
  );
  assert.deepEqual(w.workers.map((x) => [x.task_id, x.user_id]), [[501, 3]], 'бусдад «Бат одоо хийж байна»');
  assert.equal((await h.myTasks())[0]!.can_report, true, 'цаг эхэлсэн — хувь оруулна');
  await h.pause();
  assert.deepEqual(await h.myIds(), [501], 'зогсоосон ч «Миний ажлууд»-д үлдэнэ');
  const w2 = await json<{ workers: unknown[] }>(await h.req(DORJ, 'GET', '/api/task-timer/working?project_id=10'));
  assert.deepEqual(w2.workers, [], 'зогссон бол нэр арилна');
});

test('миний жагсаалтын таск дээр ӨӨР хүн ажиллавал «Миний ажлууд» (`?mine=1`) шууд харуулна', async () => {
  const h = harness();
  await h.add(501);
  await h.add(601);
  await h.start(501, DORJ); // Дорж 501 дээр
  await h.start(504, SARAA); // Сараа миний жагсаалтад БАЙХГҮЙ таск дээр
  await h.start(601, BAT); // би 601 дээр (цагаар бодогддог — хуваагдахгүй)
  const r = await json<{ workers: Array<{ task_id: number; user_id: number; full_name: string }> }>(
    await h.req(BAT, 'GET', '/api/task-timer/working?mine=1'),
  );
  assert.deepEqual(
    r.workers.map((w) => [w.task_id, w.user_id, w.full_name]).sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [501, 4, 'Дорж'],
      [601, 3, 'Бат'],
    ],
    'зөвхөн миний жагсаалтын таскууд — нэр л',
  );
  for (const w of r.workers) assert.ok(!('started_at' in w), 'цаг харагдахгүй');
  // Дорж зогсоовол дараагийн шинэчлэлд алга.
  await h.pause(DORJ);
  const r2 = await json<{ workers: Array<{ task_id: number }> }>(await h.req(BAT, 'GET', '/api/task-timer/working?mine=1'));
  assert.deepEqual(r2.workers.map((w) => w.task_id), [601]);
});

test('хасах — ажилласан таскийг ч нууна; дахин нэмэх эсвэл цаг эхлүүлэхэд буцна; явж буйг хасахгүй', async () => {
  const h = harness();
  await h.start(504); // ажилласан (бүртгэлтэй)
  const running = await h.remove(504);
  assert.equal(running.status, 409);
  assert.equal((await json<{ error: string }>(running)).error, 'TASK_RUNNING');
  await h.pause();
  await h.add(501);
  assert.deepEqual(await h.myIds(), [501, 504]);
  assert.equal((await h.remove(504)).status, 200);
  assert.equal((await h.remove(501)).status, 200);
  assert.deepEqual(await h.myIds(), [], 'ажилласан таск ч, нэмсэн таск ч алга');
  const ids = await json<{ task_ids: number[] }>(await h.req(BAT, 'GET', '/api/progress/my-tasks/ids?project_id=10'));
  assert.deepEqual(ids.task_ids, []);
  assert.ok(h.db.prepare('SELECT 1 FROM task_assignees WHERE task_id = 504 AND user_id = 3').get(), 'бүртгэл (түүх) хөндөгдөхгүй');
  // Цаг эхлүүлэх = миний ажил → буцаж гарна.
  await h.start(504);
  assert.deepEqual(await h.myIds(), [504]);
  // Дахин нэмэх → буцаж гарна.
  await h.add(501);
  assert.deepEqual(await h.myIds(), [501, 504]);
});

test('нэмэх эрх — «авах» дүрэм (эрх → таск → төсөл → дууссан), ИРЦ шаардахгүй', async () => {
  const h = harness();
  const code = async (r: Response) => [r.status, (await json<{ error?: string }>(r)).error ?? null];
  assert.deepEqual(await code(await h.add(505)), [409, 'TASK_COMPLETED']);
  assert.deepEqual(await code(await h.add(701)), [409, 'PROJECT_INACTIVE']);
  assert.deepEqual(await code(await h.add(9999)), [404, 'TASK_NOT_FOUND']);
  assert.deepEqual(await code(await h.add(501, ADMIN)), [403, 'ROLE_NOT_ALLOWED']);
  assert.deepEqual(await code(await h.add(501, CEO)), [200, null]);
  assert.deepEqual(await code(await h.add(501, NOMIN)), [200, null], 'ирцгүй ч нэмнэ');
  // Ирцгүй хүн «Миний ажлууд»-аас эхлүүлэх гэвэл ердийн «авах» дүрэм.
  assert.deepEqual(await code(await h.start(501, NOMIN)), [409, 'NOT_CLOCKED_IN']);
  assert.equal((await h.add(0)).status, 400);
});

test('таск устгахад хувийн жагсаалтын мөр цэвэрлэгдэнэ', async () => {
  const h = harness();
  await h.add(504);
  await h.remove(501);
  const del = await h.req({ sub: 8, role: 'senior' }, 'DELETE', '/api/tasks/504');
  assert.equal(del.status, 200);
  assert.deepEqual(
    h.db.prepare('SELECT task_id FROM task_personal_list ORDER BY task_id').all().map((r) => (r as { task_id: number }).task_id),
    [501],
  );
});

// D1 нэг compound SELECT-д ≤5 нэр томьёо зөвшөөрнө (SQLITE_ERROR 7500).  Локал node:sqlite хязгааргүй тул
// тест ногоон байхад прод «Миний ажлууд» 500 өгч байв (2026-10-05) — энэ хамгаалалт тэр ангийг барина.
test('myTaskIdsSql — нэг compound SELECT-д 5-аас олон нэр томьёо ХЭЗЭЭ Ч байхгүй (D1 хязгаар)', async () => {
  const { myTaskIdsSql } = await import('../lib/myTaskList.ts');
  const sql = myTaskIdsSql(7);
  // Хаалтын гүнээр бүлэглэж, түвшин тус бүрийн UNION/EXCEPT/INTERSECT-ийг тоолно.
  const perDepth = new Map<number, number>();
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (/^(UNION|EXCEPT|INTERSECT)\b/.test(sql.slice(i, i + 10)) && (i === 0 || /\s/.test(sql[i - 1]!))) {
      perDepth.set(depth, (perDepth.get(depth) ?? 0) + 1);
    }
  }
  for (const [d, n] of perDepth) assert.ok(n + 1 <= 5, `depth ${d}: ${n + 1} terms > 5`);
});
