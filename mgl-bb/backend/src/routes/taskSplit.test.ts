// `POST /api/tasks/:id/split` — ХАСАГДСАН (2026-10-02).  Хуучин урсгал таскийн дотоод жинг хуваагаад шинэ таск
// (хуулбар «(i/N)») үүсгэдэг байв; эзний шийдвэр: нэг таск = НЭГ үндсэн ажил, дотоод жин өөрчлөгдөхгүй, шинэ таск
// үүсэхгүй — хуваарилалт (`POST /api/tasks/:id/allocation/split`, `routes/taskAllocations.test.ts`).
// Энэ тест нь хуучин замын ЮУ Ч бичихгүй, ойлгомжтой 410 өгдөгийг батална (кэштэй хуучин клиентээс).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const tasks = (await import('./tasks.ts')).default;

function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string, params: unknown[] = []) => ({
    bind: (...args: unknown[]) => prepare(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...(params as never[])) }),
    first: async () => db.prepare(sql).get(...(params as never[])) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(params as never[]));
      return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
    },
  });
  return { prepare, batch: async () => [] } as unknown as D1Database;
}

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, component_id INTEGER, name TEXT NOT NULL,
      weight_percent REAL NOT NULL, assigned_to INTEGER, due_date TEXT, start_date TEXT, sort_order INTEGER);
    INSERT INTO tasks (id, component_id, name, weight_percent, sort_order) VALUES (10, 1, 'Эхний', 8, 10);
  `);
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/tasks', tasks as never);
  const post = (role: string, body: unknown) =>
    app.request(
      '/api/tasks/10/split',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify({ sub: 3, role }) },
        body: JSON.stringify(body),
      },
      { DB: d1Shim(db) },
    );
  return { db, post };
}

test('хуучин «таск хуваах» 410 SPLIT_RETIRED — шинэ таск үүсэхгүй, жин өөрчлөгдөхгүй', async () => {
  for (const role of ['engineer', 'architect', 'senior', 'admin']) {
    const { db, post } = setup();
    const res = await post(role, { weights: [4, 4] });
    assert.equal(res.status, 410, role);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'SPLIT_RETIRED');
    assert.match(body.message, /allocation\/split/);
    const rows = db.prepare('SELECT id, name, weight_percent FROM tasks').all().map((r) => ({ ...r }));
    assert.deepEqual(rows, [{ id: 10, name: 'Эхний', weight_percent: 8 }]);
  }
});

test('хуучин «таск хуваах» — take:true ч мөн 410 (ирц, таймерт хүрэхгүй)', async () => {
  const { db, post } = setup();
  const res = await post('engineer', { weights: [4, 4], take: true });
  assert.equal(res.status, 410);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 1);
});

test('ажилтны бус роль (client) хуучин замд мөн хаалттай', async () => {
  const { post } = setup();
  const res = await post('client', { weights: [4, 4] });
  assert.ok(res.status === 403 || res.status === 401, `status ${res.status}`);
});
