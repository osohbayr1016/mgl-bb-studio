// `GET /api/profiles/:id/hours-log` — засвар + төслийн бус ажлын цаг, сонголттой
// `?from=&to=` цонх («Тайлан → Ажилтан»-ы «Явцын бичлэгүүд»).  БОДИТ SQLite, D1 shim,
// Hono `app.request()` — bind-ийн дараалал (UNION-ы хоёр хэсэг + LIMIT) зөрвөл унана.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

const profiles = (await import('./profiles.ts')).default;

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
  });
  return { prepare } as unknown as D1Database;
}

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE repair_projects (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE repair_entries (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT, created_at TEXT,
      hours REAL, hours_source TEXT, weekly_avg_pct REAL, rate_source TEXT, computed_pct REAL, description TEXT,
      project_id INTEGER, repair_project_id INTEGER, task_id INTEGER, mark_id INTEGER);
    CREATE TABLE repair_marks (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT, marked_at TEXT,
      daily_rate REAL, rate_source TEXT, project_id INTEGER, repair_project_id INTEGER, task_id INTEGER,
      award_points INTEGER);
    CREATE TABLE non_project_work_entries (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT, category TEXT,
      note TEXT, start_time TEXT, end_time TEXT, minutes INTEGER, report TEXT, status TEXT, review_note TEXT,
      daily_rate REAL, rate_source TEXT, computed_pct REAL, created_at TEXT);
    INSERT INTO projects VALUES (55, 'MGL-231019 Хуванцар_ZA');
    INSERT INTO repair_projects VALUES (1, 'Luxwood засвар');
    INSERT INTO tasks VALUES (18408, 'Хэсэгчилсэн байгуулалт');
    INSERT INTO repair_entries VALUES
      (1, 12, '2026-08-29', '2026-08-29 09:00:00', 8, 'manual', 0.01, 'self30', 0.01, '', NULL, 1, NULL, NULL),
      (2, 12, '2026-09-03', '2026-09-03 09:00:00', 8, 'manual', 0.02, 'self30', 0.02, '', NULL, 1, NULL, NULL),
      (3, 12, '2026-09-18', '2026-09-18 09:00:00', 4, 'auto', 0.03, 'self30', 0.015, '', 55, NULL, 18408, 10),
      (4, 12, '2026-10-01', '2026-10-01 09:00:00', 8, 'manual', 0.01, 'self30', 0.01, '', 55, NULL, NULL, NULL),
      (5, 13, '2026-09-10', '2026-09-10 09:00:00', 8, 'manual', 0.01, 'self30', 0.01, '', 55, NULL, NULL, NULL);
    INSERT INTO repair_marks VALUES
      (10, 12, '2026-09-18', '2026-09-18 10:00:00', 0.03, 'self30', 55, NULL, 18408, 1),
      (11, 12, '2026-09-20', '2026-09-20 10:00:00', 0.03, 'self30', 55, NULL, 18408, 1),
      (12, 12, '2026-08-20', '2026-08-20 10:00:00', 0.03, 'self30', 55, NULL, 18408, 1);
    INSERT INTO non_project_work_entries VALUES
      (1, 12, '2026-08-30', 'meeting', NULL, '09:00', '10:00', 60, 'x', 'approved', NULL, 0.01, 'self30', 0.001, '2026-08-30'),
      (2, 12, '2026-09-05', 'meeting', NULL, '09:00', '10:00', 60, 'x', 'pending', NULL, NULL, NULL, NULL, '2026-09-05');
  `);
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/profiles', profiles as never);
  const get = (path: string, user: { sub: number; role: string }) =>
    app.request(`/api/profiles${path}`, { headers: { 'x-test-user': JSON.stringify(user) } }, { DB: d1Shim(db) });
  return { get };
}

type Body = {
  repairs: Array<{ kind: string; id: number; date: string; is_repair_project: boolean }>;
  non_project: Array<{ id: number; date: string }>;
};
const ADMIN = { sub: 9, role: 'admin' };

test('цонхгүй — бүх засвар (тэмдэглэгээтэй мөр давхардахгүй) + төслийн бус ажил', async () => {
  const { get } = setup();
  const res = await get('/12/hours-log', ADMIN);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Body;
  assert.deepEqual(
    body.repairs.map((r) => `${r.kind}:${r.id}`),
    ['entry:4', 'mark:11', 'entry:3', 'entry:2', 'entry:1', 'mark:12'],
  );
  assert.deepEqual(body.non_project.map((n) => n.id), [2, 1]);
});

test('from/to — засвар, тэмдэглэгээ, төслийн бус ажил гурвуулаа цонхоор (хоёр тал орно)', async () => {
  const { get } = setup();
  const body = (await (await get('/12/hours-log?from=2026-09-01&to=2026-09-30&limit=1000', ADMIN)).json()) as Body;
  assert.deepEqual(
    body.repairs.map((r) => `${r.kind}:${r.id}`),
    ['mark:11', 'entry:3', 'entry:2'],
  );
  assert.equal(body.repairs.find((r) => r.id === 2)?.is_repair_project, true);
  assert.deepEqual(body.non_project.map((n) => n.id), [2]);

  const edge = (await (await get('/12/hours-log?from=2026-09-18&to=2026-09-18', ADMIN)).json()) as Body;
  assert.deepEqual(edge.repairs.map((r) => `${r.kind}:${r.id}`), ['entry:3']);
});

test('буруу хэлбэрийн огноо үл тоогдоно (SQL-д орохгүй)', async () => {
  const { get } = setup();
  const body = (await (await get("/12/hours-log?from=x'&to=2026-09-30", ADMIN)).json()) as Body;
  assert.deepEqual(
    body.repairs.map((r) => `${r.kind}:${r.id}`),
    ['mark:11', 'entry:3', 'entry:2', 'entry:1', 'mark:12'],
  );
});

test('эрх — өөр ажилтан 403, өөрөө 200', async () => {
  const { get } = setup();
  assert.equal((await get('/12/hours-log', { sub: 13, role: 'engineer' })).status, 403);
  assert.equal((await get('/12/hours-log', { sub: 12, role: 'engineer' })).status, 200);
});
