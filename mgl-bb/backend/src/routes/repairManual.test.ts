// POST /api/repair — хоёр горим: `hours`+`description` = ГАРААР бүртгэх (2026-10-08 сэргээсэн),
// `hours`-гүй = 0348-ын «Ажилласан» тэмдэглэгээ.  Бодит SQLite + 0348/0349, Hono `app.request()`.
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

const repair = (await import('./repair.ts')).default;
const { todayInUB } = await import('../lib/time.ts');

/** node:sqlite дээрх D1 shim — `batch` нь дарааллаар, нэг transaction-д. */
function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    __sql: sql,
    __args: args,
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } } as never;
    },
    raw: async () => [] as never,
  });
  return {
    prepare: (sql: string) => mk(sql),
    batch: async (stmts: Array<{ __sql: string; __args: unknown[] }>) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => {
          const r = db.prepare(s.__sql).run(...(s.__args as never[]));
          return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

const DAY = '2026-09-22'; // Мягмар, зуны албадлагаас гадуур

function freshDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      is_support INTEGER NOT NULL DEFAULT 0, team_id INTEGER, work_schedule TEXT,
      created_at TEXT DEFAULT '2025-01-06 01:00:00'
    );
    CREATE TABLE user_work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, schedule TEXT NOT NULL,
      effective_from TEXT NOT NULL, created_by INTEGER
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT, updated_by INTEGER);
    INSERT INTO app_settings (key, value) VALUES ('lunch_enabled','1'),('lunch_start','13:00'),('lunch_end','14:00');
    CREATE TABLE holidays (date TEXT PRIMARY KEY);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
      status TEXT NOT NULL DEFAULT 'active', progress_mode TEXT NOT NULL DEFAULT 'tasks'
    );
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, team_id INTEGER, weight_percent REAL NOT NULL DEFAULT 0);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER NOT NULL, weight_percent REAL NOT NULL DEFAULT 0);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER NOT NULL);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, component_id INTEGER NOT NULL, name TEXT, weight_percent REAL NOT NULL DEFAULT 0);
    CREATE TABLE project_team_shares (project_id INTEGER NOT NULL, team_id INTEGER NOT NULL, share_percent REAL NOT NULL);
    CREATE TABLE progress_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      percentage REAL NOT NULL DEFAULT 0, date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved',
      is_rest_day INTEGER DEFAULT 0, defer_next_day INTEGER DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'web',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE repair_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE user_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      project_id INTEGER, repair_project_id INTEGER, task_id INTEGER, progress_entry_id INTEGER,
      amount REAL NOT NULL, delta_pct REAL NOT NULL, assignee_count INTEGER NOT NULL DEFAULT 1,
      awarded_at TEXT NOT NULL DEFAULT (datetime('now')), awarded_by INTEGER,
      source TEXT NOT NULL DEFAULT 'progress', repair_entry_id INTEGER
    );
    CREATE TABLE repair_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      project_id INTEGER, repair_project_id INTEGER, task_id INTEGER,
      description TEXT NOT NULL DEFAULT '', hours REAL NOT NULL CHECK (hours > 0),
      day_hours REAL NOT NULL DEFAULT 8, weekly_avg_pct REAL NOT NULL DEFAULT 0,
      rate_source TEXT, computed_pct REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
      progress_rate REAL NOT NULL DEFAULT 0, progress_rate_source TEXT, progress_pct REAL NOT NULL DEFAULT 0,
      CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))
    );
    CREATE TABLE non_project_work_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type TEXT NOT NULL DEFAULT 'annual',
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, days REAL NOT NULL DEFAULT 1, hours REAL,
      start_time TEXT, end_time TEXT, status TEXT NOT NULL DEFAULT 'pending'
    );
    -- хэрэглэгч 1: 08:00–17:00 ээлж (early); ZA төсөл 1 (таск 11, 12), AZ төсөл 2 (таск 21, 22)
    INSERT INTO users (id, role, team_id, work_schedule) VALUES (1,'engineer',10,'early'),(2,'engineer',10,'early');
    INSERT INTO projects (id, name, category, progress_mode) VALUES (1,'ZA','ZA','tasks'),(2,'AZ','AZ','tasks');
    INSERT INTO blocks (id, project_id) VALUES (1,1),(2,2);
    INSERT INTO drawings (id, block_id) VALUES (1,1),(2,2);
    INSERT INTO components (id, drawing_id) VALUES (1,1),(2,2);
    INSERT INTO tasks (id, component_id, name) VALUES (11,1,'za-a'),(12,1,'za-b'),(21,2,'az-a'),(22,2,'az-b');
    INSERT INTO repair_projects (id, name) VALUES (5,'Оффисын засвар');
  `);
  db.exec(readFileSync(new URL('../../migrations/0348_repair_auto_hours.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0349_repair_progress_carryover.sql', import.meta.url), 'utf8'));
  return { db, d1: fakeD1(db) };
}


function setup() {
  const { db, d1 } = freshDb();
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    c.set('user', { sub: 1, role: 'engineer' });
    await next();
  });
  app.route('/api/repair', repair as never);
  const post = (body: unknown) =>
    app.request(
      '/api/repair',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      { DB: d1 },
    );
  return { db, post };
}

test('гар бүртгэл: тайлбар + цаг → manual мөр + repair оноо', async () => {
  const { db, post } = setup();
  const res = await post({ repair_project_id: 5, description: 'Оффисын зураг засав', hours: 4 });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { hours: number; created: boolean };
  assert.equal(body.hours, 4);
  const row = db
    .prepare(`SELECT hours, hours_source, description, date, mark_id, repair_project_id FROM repair_entries`)
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...row },
    { hours: 4, hours_source: 'manual', description: 'Оффисын зураг засав', date: todayInUB(), mark_id: null, repair_project_id: 5 },
  );
  const pts = db.prepare(`SELECT source, repair_entry_id FROM user_points`).all() as Record<string, unknown>[];
  assert.equal(pts.length, 1);
  assert.equal(pts[0]!.source, 'repair');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM repair_marks`).get()!.n, 0);
});

test('гар бүртгэл: тайлбаргүй / цаг буруу / ирээдүй / өдөрт 12-оос их → 400', async () => {
  const { post } = setup();
  assert.equal((await post({ repair_project_id: 5, description: '', hours: 4 })).status, 400);
  assert.equal((await post({ repair_project_id: 5, description: 'x', hours: 0 })).status, 400);
  assert.equal((await post({ repair_project_id: 5, description: 'x', hours: 25 })).status, 400);
  assert.equal((await post({ repair_project_id: 5, description: 'x', hours: 2, date: '2099-01-01' })).status, 400);
  assert.equal((await post({ repair_project_id: 5, description: 'x', hours: 8 })).status, 201);
  assert.equal((await post({ repair_project_id: 5, description: 'x', hours: 5 })).status, 400);
  assert.equal((await post({ repair_project_id: 5, description: 'x', hours: 4 })).status, 201);
});

test('hours-гүй хүсэлт хуучин ёсоор тэмдэглэгээ үүсгэнэ (My Tasks «Ажилласан»)', async () => {
  const { db, post } = setup();
  const res = await post({ repair_project_id: 5 });
  assert.equal(res.status, 201);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM repair_marks`).get()!.n, 1);
});
