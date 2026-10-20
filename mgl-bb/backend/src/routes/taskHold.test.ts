// Таск дээр зарцуулсан өдөр (0350) ба 2026-10-01-ний оноох замын хаалт — БОДИТ SQLite,
// D1 shim, Hono `app.request()`.  Тоолох дүрэм өөрөө `lib/taskHold.test.ts`-д.
// «Өөртөө авах» (таймер эхлэх = таск дээрх нэр) — `routes/taskTake.test.ts`.
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

const tasks = (await import('./tasks.ts')).default;
const { countHoldDays, doneSpans, holdSpan } = await import('../lib/taskHold.ts');
const { todayInUB } = await import('../lib/time.ts');

function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string, params: unknown[] = []) => ({
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
      const r = db.prepare(sql).run(...(params as never[]));
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  return {
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, progress_mode TEXT);
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER, name TEXT);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, component_id INTEGER, name TEXT NOT NULL,
      weight_percent REAL NOT NULL, assigned_to INTEGER, due_date TEXT, start_date TEXT, sort_order INTEGER);
    CREATE TABLE task_assignees (task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), self_joined INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (task_id, user_id));
    CREATE TABLE task_self_done (task_id INTEGER, user_id INTEGER);
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER,
      percentage REAL, date TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE task_shares (task_id INTEGER, user_id INTEGER, share_percent REAL);
    CREATE TABLE holidays (id INTEGER PRIMARY KEY, date TEXT NOT NULL UNIQUE, name TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, title TEXT, body TEXT,
      link TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE users (id INTEGER PRIMARY KEY, status TEXT, role TEXT);
    CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER, is_primary INTEGER);
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT, lead_user_id INTEGER);
    INSERT INTO projects VALUES (1, 'tasks');
    INSERT INTO blocks VALUES (1, 1);
    INSERT INTO drawings VALUES (1, 1, 'BA архитектур');
    INSERT INTO components VALUES (1, 1);
    INSERT INTO users VALUES (3, 'active', 'engineer'), (4, 'active', 'engineer'), (5, 'active', 'engineer'), (9, 'active', 'admin');
    INSERT INTO tasks (id, component_id, name, weight_percent, assigned_to, sort_order) VALUES
      (10, 1, 'Фасад', 4, NULL, 10),
      (11, 1, 'Хуучин хамтарсан', 4, 3, 20);
    INSERT INTO task_assignees (task_id, user_id) VALUES (11, 3), (11, 4);
  `);
  // Бодит миграц — хүснэгтийн хэлбэр зөрөхгүйн тулд.
  db.exec(readFileSync(new URL('../../migrations/0350_task_hold_periods.sql', import.meta.url), 'utf8'));

  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/tasks', tasks as never);
  const call = (path: string, method: string, body: unknown, user: { sub: number; role: string }) =>
    app.request(
      `/api/tasks${path}`,
      {
        method,
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      },
      { DB: d1Shim(db) },
    );
  return { db, call };
}

const A = { sub: 3, role: 'engineer' };
const ADMIN = { sub: 9, role: 'admin' };

/** Хүлээгдэж буй өдөр — ижил цэвэр дүрмээр, D1-ийн мөрүүдээс. */
function expectedDays(db: DatabaseSync, taskId: number, userId: number): number {
  const today = todayInUB();
  const spans = [
    ...(db
      .prepare('SELECT created_at FROM task_assignees WHERE task_id = ? AND user_id = ?')
      .all(taskId, userId) as Array<{ created_at: string }>).map((r) => holdSpan(r.created_at, null, today, 480)),
    ...(db
      .prepare('SELECT started_at, ended_at FROM task_hold_periods WHERE task_id = ? AND user_id = ?')
      .all(taskId, userId) as Array<{ started_at: string; ended_at: string }>).map((r) =>
      holdSpan(r.started_at, r.ended_at, today, 480),
    ),
  ].filter((s) => s !== null);
  return countHoldDays(spans, new Set());
}

test('2026-10-01: ахлах/админ оноох зам хаагдсан — /share, /unassign → 410', async () => {
  const { db, call } = setup();
  for (const [path, body] of [
    ['/10/share', { user_ids: [5] }],
    ['/11/unassign', { user_id: 3 }],
  ] as const) {
    const res = await call(path, 'POST', body, ADMIN);
    assert.equal(res.status, 410, path);
    assert.equal(((await res.json()) as { error: string }).error, 'ASSIGNMENT_REMOVED');
  }
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM task_assignees WHERE task_id = 10').get() as { n: number }).n,
    0,
  );
});

test('2026-10-01: PUT нь assignees/assigned_to-г ҮЛ ТООНО (setup хуудасны хуучин клиент 400 авахгүй)', async () => {
  const { db, call } = setup();
  const before = db.prepare('SELECT task_id, user_id FROM task_assignees ORDER BY task_id, user_id').all();
  const res = await call('/10', 'PUT', { name: 'Шинэ нэр', assignees: [3, 4], assigned_to: 3 }, ADMIN);
  assert.equal(res.status, 200);
  const row = db.prepare('SELECT name, assigned_to FROM tasks WHERE id = 10').get() as {
    name: string;
    assigned_to: number | null;
  };
  assert.deepEqual([row.name, row.assigned_to], ['Шинэ нэр', null]);
  assert.deepEqual(db.prepare('SELECT task_id, user_id FROM task_assignees ORDER BY task_id, user_id').all(), before);
  // Зөвхөн оноолт ирвэл засах талбар алга → 400 (өмнөхтэй ижил).
  assert.equal((await call('/10', 'PUT', { assignees: [3] }, ADMIN)).status, 400);
});

test('2026-10-01: POST нь хариуцагч оноохгүй, мэдэгдэл явуулахгүй', async () => {
  const { db, call } = setup();
  const res = await call('', 'POST', { name: 'Шинэ', component_id: 1, weight_percent: 2, assignees: [3] }, ADMIN);
  assert.equal(res.status, 201);
  const id = ((await res.json()) as { id: number }).id;
  const row = db.prepare('SELECT assigned_to FROM tasks WHERE id = ?').get(id) as { assigned_to: number | null };
  assert.equal(row.assigned_to, null);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM task_assignees WHERE task_id = ?').get(id) as { n: number }).n,
    0,
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n, 0);
});

test('хасагдсан замууд: /join, /shares → 404', async () => {
  const { call } = setup();
  assert.equal((await call('/10/join', 'POST', {}, A)).status, 404);
  assert.equal((await call('/10/shares', 'GET', null, A)).status, 404);
  assert.equal((await call('/10/shares', 'PUT', { shares: [] }, A)).status, 404);
});

test('100% болсон таскийн өдөр тэр өдрөөр зогсоно, done_on буцаана', async () => {
  const { db, call } = setup();
  db.prepare("INSERT INTO task_assignees (task_id, user_id, created_at) VALUES (10, 3, datetime('now', '-30 days'))").run();
  const doneDate = db.prepare("SELECT date(datetime('now', '+8 hours'), '-10 days') AS d").get() as { d: string };
  const halfDate = db.prepare("SELECT date(datetime('now', '+8 hours'), '-20 days') AS d").get() as { d: string };
  db.prepare(
    `INSERT INTO progress_entries (task_id, user_id, percentage, date, status, created_at) VALUES
       (10, 3, 50, ?, 'approved', datetime('now', '-20 days')),
       (10, 3, 100, ?, 'approved', datetime('now', '-10 days')),
       (10, 3, 30, date('now'), 'rejected', datetime('now'))`,
  ).run(halfDate.d, doneDate.d);

  // Хүлээгдэж буй = ижил цэвэр дүрмээр (татгалзсан бичлэг таскийг дахин нээхгүй).
  const started = db.prepare('SELECT created_at FROM task_assignees WHERE task_id = 10').get() as { created_at: string };
  const expected = countHoldDays(
    [holdSpan(started.created_at, null, todayInUB(), 480)!],
    new Set(),
    doneSpans([
      { date: halfDate.d, percentage: 50 },
      { date: doneDate.d, percentage: 100 },
    ]).spans,
  );

  for (const path of ['/hold-days?mine=1', '/hold-days?project_id=1']) {
    const rows = ((await (await call(path, 'GET', null, A)).json()) as {
      rows: Array<{ task_id: number; user_id: number; days: number; done_on: string | null }>;
    }).rows;
    const row = rows.find((r) => r.task_id === 10 && r.user_id === 3)!;
    assert.equal(row.done_on, doneDate.d, path);
    assert.equal(row.days, expected, path);
    assert.ok(row.days < expectedDays(db, 10, 3), `${path}: frozen count must be below the open count`);
  }

  // Дуусаагүй таск (11) хэвээр.
  const proj = ((await (await call('/hold-days?project_id=1', 'GET', null, A)).json()) as {
    rows: Array<{ task_id: number; user_id: number; done_on: string | null }>;
  }).rows;
  assert.equal(proj.find((r) => r.task_id === 11 && r.user_id === 3)!.done_on, null);
});
