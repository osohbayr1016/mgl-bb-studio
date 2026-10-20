// Таскийн ДЭД ХУГАЦАА (`task_deadlines`, 0148) — бичих замууд ХАСАГДСАН (2026-10-02), түүх хадгалагдана.
// Эзний шийдвэр: ажилтан таскийн checkpoint үүсгэх/засах/биелүүлэх/устгах/сануулах боломжгүй; харин түүх харагдана,
// үндсэн хугацаа ба milestone (түүний дэд хугацаа) ХЭВЭЭР.  Энэ тест гурвыг батална:
//   1) дөрвөн бичих зам ойлгомжтой 410 өгч, ямар ч мөрийг хөндөхгүй (кэштэй хуучин клиентээс ч аюулгүй);
//   2) түүх унших `GET /tasks/:id` ажиллаж, `can_edit` нь үргэлж false;
//   3) `/:id` гэсэн хуучин нэг-сегменттэй замууд milestone-ийн `/milestones/:id` замуудыг ЗАВСААГҮЙ;
//   4) нээлттэй (биелээгүй) хуучин шалгах цэг «Удахгүй» / хуанли / төслийн «Хугацаа»-д хэзээ ч гарахгүй (хэзээ ч хаагдахгүй
//      «хоцорсон» дохио болох тул) — биелсэн нь л түүх болж үлдэнэ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
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

const deadlines = (await import('./deadlines.ts')).default;

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
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE task_deadlines (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, title TEXT NOT NULL,
      due_date TEXT NOT NULL, note TEXT, done_at TEXT, assignee_id INTEGER, sort_order INTEGER DEFAULT 0,
      created_by_id INTEGER, updated_at TEXT);
    CREATE TABLE project_milestones (id INTEGER PRIMARY KEY, project_id INTEGER, parent_id INTEGER, due_date TEXT,
      block_id INTEGER, task_id INTEGER);
    INSERT INTO users (id, full_name) VALUES (3, 'Бат');
    INSERT INTO task_deadlines (id, task_id, title, due_date, note, done_at, assignee_id, sort_order)
      VALUES (1, 77, 'Эхний шалгах цэг', '2026-10-20', 'тэмдэглэл', NULL, 3, 0),
             (2, 77, 'Хоёр дахь', '2026-10-25', NULL, '2026-10-21 09:00:00', NULL, 1);
  `);
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/deadlines', deadlines as never);
  const call = (role: string, method: string, path: string, body?: unknown) =>
    app.request(
      `/api/deadlines${path}`,
      {
        method,
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify({ sub: 3, role }) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      { DB: d1Shim(db) },
    );
  const snapshot = () => JSON.stringify(db.prepare('SELECT * FROM task_deadlines ORDER BY id').all());
  return { db, call, snapshot };
}

const ROLES = ['admin', 'senior', 'engineer', 'architect'] as const;

test('таскийн дэд хугацааг үүсгэх/засах/биелүүлэх/устгах → 410, мөр ХӨНДӨГДӨХГҮЙ (бүх ажилтны дүр)', async () => {
  const { call, snapshot } = setup();
  const before = snapshot();
  for (const role of ROLES) {
    const calls: [string, string, unknown?][] = [
      ['POST', '/tasks/77', { title: 'Шинэ', due_date: '2026-11-01' }],
      ['PUT', '/1', { title: 'Өөрчилсөн' }],
      ['PATCH', '/1/done', { done: true }],
      ['DELETE', '/2'],
    ];
    for (const [method, path, body] of calls) {
      const res = await call(role, method, path, body);
      const json = (await res.json()) as { error: string };
      assert.equal(res.status, 410, `${role} ${method} ${path}`);
      assert.equal(json.error, 'SUB_DEADLINE_RETIRED', `${role} ${method} ${path}`);
    }
  }
  assert.equal(snapshot(), before, 'task_deadlines мөр огт өөрчлөгдөөгүй (түүх бүрэн)');
});

test('түүх унших `GET /tasks/:id` хэвээр ажиллана, `can_edit` нь үргэлж false', async () => {
  const { call } = setup();
  for (const role of ROLES) {
    const res = await call(role, 'GET', '/tasks/77');
    assert.equal(res.status, 200, role);
    const json = (await res.json()) as { can_edit: boolean; items: { id: number; title: string; done: boolean }[] };
    assert.equal(json.can_edit, false, `${role}: бичих эрх байхгүй`);
    assert.deepEqual(
      json.items.map((i) => [i.id, i.title, i.done]),
      [
        [1, 'Эхний шалгах цэг', false],
        [2, 'Хоёр дахь', true],
      ],
      `${role}: түүх бүрэн харагдана`,
    );
  }
});

test('milestone-ийн замууд (`/milestones/:id`) нэг-сегменттэй хасагдсан замуудад ЗАВСАГДАХГҮЙ', async () => {
  const { call } = setup();
  // admin → зам жинхэнэ milestone handler-т хүрч «олдсонгүй» (404) гэнэ, 410 БИШ.
  for (const [method, path] of [
    ['PUT', '/milestones/99'],
    ['PATCH', '/milestones/99/done'],
    ['DELETE', '/milestones/99'],
  ] as const) {
    const res = await call('admin', method, path, method === 'DELETE' ? undefined : { title: 'x', done: true });
    const json = (await res.json()) as { error: string };
    assert.notEqual(res.status, 410, `${method} ${path}`);
    assert.notEqual(json.error, 'SUB_DEADLINE_RETIRED', `${method} ${path}`);
    assert.equal(res.status, 404, `${method} ${path}: milestone олдсонгүй`);
  }
  // ажилтан → milestone-ийн бичих эрх (admin/senior) байхгүй: 403, 410 БИШ.
  const denied = await call('engineer', 'PUT', '/milestones/99', { title: 'x' });
  assert.equal(denied.status, 403);
});

test('нээлттэй хуучин шалгах цэг дохио болж гарахгүй: SQL-ийн ЭХ КОДЫН хамгаалалт (handler-ийн бүтэн схем хэт том)', () => {
  // `collectRangeItems` / төслийн «Хугацаа» нь 15 хүртэл хүснэгт (passport, milestones, CTE…) шаарддаг тул handler-ийг бүтнээр нь
  // ажиллуулах тест биш — зорилго нь «нээлттэй мөрийг нэмэх» засвар чимээгүй буцахаас сэргийлэх.
  const src = readFileSync(new URL('./deadlines.ts', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('');
  assert.ok(
    src.includes('AND (? = 1 AND td.done_at IS NOT NULL)'),
    '/upcoming ба /calendar: дэд хугацааны асуулга зөвхөн БИЕЛСЭН мөрийг (include_done үед) буцаана',
  );
  assert.ok(
    src.includes('WHERE b.project_id = ? AND td.done_at IS NOT NULL'),
    'төслийн «Хугацаа»: дэд хугацаанаас зөвхөн БИЕЛСЭН (түүх) мөр',
  );
  assert.ok(!src.includes('(? = 1 OR td.done_at IS NULL)'), 'нээлттэй дэд хугацааг буцаадаг хуучин нөхцөл буцаж ирээгүй');
});
