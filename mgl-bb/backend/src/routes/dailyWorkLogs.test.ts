// Өдрийн ажлын тайлангийн route-ууд — БОДИТ SQLite (миграц 0345 файлаас), D1
// shim, Hono `app.request()`.  Эрхийн хаалт, «зөвхөн өөрийнх», засварын түүх,
// «хожим нөхсөн», огнооны хил.
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

const dailyWorkLogs = (await import('./dailyWorkLogs.ts')).default;
const { todayInUB } = await import('../lib/time.ts');

function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
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
        const r = db.prepare(sql).run(...(params as never[]));
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
}

function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
  db.exec('INSERT INTO users (id) VALUES (1), (2), (3)');
  db.exec(readFileSync(new URL('../../migrations/0345_daily_work_logs.sql', import.meta.url), 'utf8'));
  const env = { DB: d1Shim(db) } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/daily-work-logs', dailyWorkLogs as never);
  const req = (user: { sub: number; role: string } | null, method: string, path: string, body?: unknown) =>
    app.request(
      `http://x${path}`,
      {
        method,
        headers: {
          ...(user ? { 'x-test-user': JSON.stringify(user) } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
    );
  return { db, req };
}

const A1 = { sub: 1, role: 'admin' };
const A2 = { sub: 2, role: 'admin' };
const SENIOR = { sub: 3, role: 'senior' };

type Log = { log_date: string; items: string[]; late: boolean; edit_count: number; first_written_on: string };
const json = async <T>(r: Response) => (await r.json()) as T;

const TODAY = todayInUB();
const shift = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const YESTERDAY = shift(TODAY, -1);

test('админ биш бол бүх зам 403', async () => {
  const h = harness();
  for (const [m, p, b] of [
    ['GET', '/api/daily-work-logs', undefined],
    ['GET', `/api/daily-work-logs/${TODAY}`, undefined],
    ['PUT', `/api/daily-work-logs/${TODAY}`, { items: ['x'] }],
  ] as const) {
    const r = await h.req(SENIOR, m, p, b);
    assert.equal(r.status, 403, `${m} ${p}`);
  }
});

test('бичих → дугаар хасагдана, давтан ижил хадгалалт түүх үүсгэхгүй', async () => {
  const h = harness();
  const r = await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { text: '1. Хурал\n2) Гэрээ\n\n' });
  assert.equal(r.status, 201);
  const body = await json<{ log: Log }>(r);
  assert.deepEqual(body.log.items, ['Хурал', 'Гэрээ']);
  assert.equal(body.log.late, false);

  const same = await json<{ changed: boolean }>(
    await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['Хурал', 'Гэрээ'] }),
  );
  assert.equal(same.changed, false);
  const n = h.db.prepare('SELECT COUNT(*) AS n FROM daily_work_log_revisions').get() as { n: number };
  assert.equal(n.n, 0);
});

test('засвар бүр өмнөх хувилбарыг түүхэнд үлдээнэ', async () => {
  const h = harness();
  await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['v1'] });
  await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['v2'] });
  await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['v3', 'нэмэлт'] });
  const day = await json<{ log: Log; revisions: { items: string[] }[] }>(
    await h.req(A1, 'GET', `/api/daily-work-logs/${TODAY}`),
  );
  assert.deepEqual(day.log.items, ['v3', 'нэмэлт']);
  assert.equal(day.log.edit_count, 2);
  assert.deepEqual(
    day.revisions.map((r) => r.items),
    [['v2'], ['v1']],
  );
});

test('зөвхөн өөрийнх: өөр админ харахгүй, дарахгүй', async () => {
  const h = harness();
  await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['нууц'] });
  const other = await json<{ log: Log | null }>(await h.req(A2, 'GET', `/api/daily-work-logs/${TODAY}`));
  assert.equal(other.log, null);
  const month = await json<{ logs: Log[] }>(await h.req(A2, 'GET', '/api/daily-work-logs'));
  assert.equal(month.logs.length, 0);
  // A2 ижил өдөрт өөрийнхөө мөрийг бичнэ — A1-ийнх хөдлөхгүй.
  assert.equal((await h.req(A2, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['минийх'] })).status, 201);
  const mine = await json<{ log: Log }>(await h.req(A1, 'GET', `/api/daily-work-logs/${TODAY}`));
  assert.deepEqual(mine.log.items, ['нууц']);
});

test('өнгөрсөн өдрийг нөхөж бичвэл «хожим нөхсөн», сарын жагсаалт + нийт', async () => {
  const h = harness();
  await h.req(A1, 'PUT', `/api/daily-work-logs/${YESTERDAY}`, { items: ['өчигдөр'] });
  await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['өнөөдөр'] });
  const m = await json<{ logs: Log[]; lifetime: { days: number; first_date: string } }>(
    await h.req(A1, 'GET', `/api/daily-work-logs?month=${YESTERDAY.slice(0, 7)}`),
  );
  const y = m.logs.find((l) => l.log_date === YESTERDAY)!;
  assert.equal(y.late, true);
  assert.equal(y.first_written_on, TODAY);
  assert.equal(m.lifetime.days, 2);
  assert.equal(m.lifetime.first_date, YESTERDAY);
});

test('огноо ба оролтын хил', async () => {
  const h = harness();
  const tomorrow = shift(TODAY, 1);
  assert.equal((await h.req(A1, 'PUT', `/api/daily-work-logs/${tomorrow}`, { items: ['x'] })).status, 400);
  assert.equal((await h.req(A1, 'PUT', '/api/daily-work-logs/2026-02-30', { items: ['x'] })).status, 400);
  assert.equal((await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: [' ', ''] })).status, 400);
  assert.equal((await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, {})).status, 400);
  assert.equal((await h.req(A1, 'GET', '/api/daily-work-logs?month=2026-13')).status, 400);
});

test('календарийн муж (from/to) сарын хилийг давна, зөвхөн өөрийнх', async () => {
  const h = harness();
  const twoAgo = shift(TODAY, -2);
  await h.req(A1, 'PUT', `/api/daily-work-logs/${twoAgo}`, { items: ['a'] });
  await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['b', 'c'] });
  await h.req(A2, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['бусдынх'] });
  const r = await json<{ from: string; to: string; month: string | null; logs: Log[] }>(
    await h.req(A1, 'GET', `/api/daily-work-logs?from=${shift(TODAY, -6)}&to=${TODAY}`),
  );
  assert.equal(r.month, null);
  assert.equal(r.from, shift(TODAY, -6));
  assert.deepEqual(
    r.logs.map((l) => l.log_date),
    [TODAY, twoAgo],
  );
  assert.deepEqual(r.logs[0]!.items, ['b', 'c']);
  // Хуучин `?month=` хэлбэр хэвээр.
  const m = await json<{ month: string; from: string }>(
    await h.req(A1, 'GET', `/api/daily-work-logs?month=${TODAY.slice(0, 7)}`),
  );
  assert.equal(m.month, TODAY.slice(0, 7));
  assert.equal(m.from, `${TODAY.slice(0, 7)}-01`);
  // Хэт урт / урвуу / дутуу муж.
  for (const q of [
    `from=${shift(TODAY, -400)}&to=${TODAY}`,
    `from=${TODAY}&to=${shift(TODAY, -1)}`,
    `from=${TODAY}`,
  ]) {
    assert.equal((await h.req(A1, 'GET', `/api/daily-work-logs?${q}`)).status, 400, q);
  }
});

test('activity: өдөр бүрийн ажлын тоо, бичвэргүй, эвдэрсэн JSON 0, /:date-д баригдахгүй', async () => {
  const h = harness();
  await h.req(A1, 'PUT', `/api/daily-work-logs/${YESTERDAY}`, { text: '1. a\n2. b\n3. c' });
  await h.req(A1, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['x'] });
  await h.req(A2, 'PUT', `/api/daily-work-logs/${TODAY}`, { items: ['1', '2', '3', '4'] });
  const old = shift(TODAY, -10);
  h.db
    .prepare('INSERT INTO daily_work_logs (user_id, log_date, items_json, first_written_on) VALUES (1, ?, ?, ?)')
    .run(old, '{эвдэрсэн', old);

  const r = await h.req(A1, 'GET', '/api/daily-work-logs/activity');
  assert.equal(r.status, 200);
  const body = await json<{
    from: string;
    to: string;
    days: { date: string; count: number }[];
    lifetime: { days: number };
  }>(r);
  assert.equal(body.to, TODAY);
  assert.equal(body.from, shift(TODAY, -364));
  assert.deepEqual(body.days, [
    { date: old, count: 0 },
    { date: YESTERDAY, count: 3 },
    { date: TODAY, count: 1 },
  ]);
  assert.equal(body.lifetime.days, 3);
  assert.ok(!JSON.stringify(body).includes('"a"'), 'бичвэр буцаахгүй');

  // `items=1` — hover-т өдрийн ажил (зөвхөн өөрийнх).
  const withItems = await json<{ days: { date: string; count: number; items: string[] }[] }>(
    await h.req(A1, 'GET', '/api/daily-work-logs/activity?items=1'),
  );
  assert.deepEqual(withItems.days.find((d) => d.date === YESTERDAY)?.items, ['a', 'b', 'c']);
  assert.deepEqual(withItems.days.find((d) => d.date === old)?.items, []);
  assert.ok(!JSON.stringify(withItems).includes('"4"'), 'өөр хүний бичвэр орохгүй');

  assert.equal((await h.req(A1, 'GET', `/api/daily-work-logs/activity?from=${shift(TODAY, -400)}`)).status, 400);
  assert.equal((await h.req(SENIOR, 'GET', '/api/daily-work-logs/activity')).status, 403);
});

// ── Зэрэг хадгалалт (2026-10-15) ─────────────────────────────────────────────────────────────────────

test('base_edit_count: хуучирсан бол 409 STALE_LOG + одоогийн хувилбар, таарвал хадгална', async () => {
  const h = harness();
  const url = `/api/daily-work-logs/${TODAY}`;
  await h.req(A1, 'PUT', url, { items: ['v1'] }); // edit_count 0
  await h.req(A1, 'PUT', url, { items: ['v2'] }); // edit_count 1 (өөр цонх)

  const stale = await h.req(A1, 'PUT', url, { items: ['миний'], base_edit_count: 0 });
  assert.equal(stale.status, 409);
  const sb = await json<{ code: string; log: Log }>(stale);
  assert.equal(sb.code, 'STALE_LOG');
  assert.deepEqual(sb.log.items, ['v2']);

  // Агуулга аль хэдийн ижил бол зөрчил биш.
  const same = await h.req(A1, 'PUT', url, { items: ['v2'], base_edit_count: 0 });
  assert.equal(same.status, 200);

  const ok = await h.req(A1, 'PUT', url, { items: ['миний'], base_edit_count: 1 });
  assert.equal(ok.status, 200);
  assert.equal((await json<{ log: Log }>(ok)).log.edit_count, 2);
});

test('base_edit_count: null («байгаагүй») — өөр газраас үүссэн бол 409, үгүй бол 201', async () => {
  const h = harness();
  const url = `/api/daily-work-logs/${TODAY}`;
  const first = await h.req(A1, 'PUT', url, { items: ['анх'], base_edit_count: null });
  assert.equal(first.status, 201);
  const second = await h.req(A1, 'PUT', url, { items: ['дараа'], base_edit_count: null });
  assert.equal(second.status, 409);
  const bad = await h.req(A1, 'PUT', url, { items: ['x'], base_edit_count: -1 });
  assert.equal(bad.status, 400);
});

test('уншсаны дараа өөр хүсэлт бичсэн ч (CAS) аль ч хувилбар түүхээс алга болохгүй', async () => {
  const h = harness();
  const url = `/api/daily-work-logs/${TODAY}`;
  await h.req(A1, 'PUT', url, { items: ['v1'] });

  // Энэ хүсэлт `v1`-ийг уншсаны ДАРАА, batch-аас ӨМНӨ зэрэг хүсэлт «vA» бичнэ.
  const realPrepare = h.db.prepare.bind(h.db);
  let raced = false;
  h.db.prepare = ((sql: string) => {
    if (!raced && sql.includes('INSERT INTO daily_work_log_revisions')) {
      raced = true;
      realPrepare(
        `INSERT INTO daily_work_log_revisions (log_id, items_json, valid_from)
         SELECT id, items_json, updated_at FROM daily_work_logs WHERE user_id = 1`,
      ).run();
      realPrepare(
        `UPDATE daily_work_logs SET items_json = '["vA"]', edit_count = edit_count + 1 WHERE user_id = 1`,
      ).run();
    }
    return realPrepare(sql);
  }) as typeof h.db.prepare;

  const r = await h.req(A1, 'PUT', url, { items: ['vB'] });
  assert.equal(r.status, 200);
  assert.ok(raced);
  const day = await json<{ log: Log; revisions: { items: string[] }[] }>(await h.req(A1, 'GET', url));
  assert.deepEqual(day.log.items, ['vB']);
  assert.equal(day.log.edit_count, 2);
  assert.deepEqual(
    day.revisions.map((x) => x.items),
    [['vA'], ['v1']],
  );
});
