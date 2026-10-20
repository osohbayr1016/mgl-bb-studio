// Хасагдсан (410) замын хэрэглээний тоолуур — бодит SQLite + Hono.  Тоо атомаар өсөх, хэрэглэгч тус бүр бүртгэгдэх,
// бичилт унасан ч 410 хэвээр буцахыг батална.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import { retiredHandler, RETIRED_HITS_PREFIX } from './retiredHits.ts';

function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string, params: unknown[] = []) => ({
    bind: (...args: unknown[]) => prepare(sql, args),
    run: async () => {
      db.prepare(sql).run(...(params as never[]));
      return { results: [], meta: {} };
    },
  });
  return { prepare } as unknown as D1Database;
}

const BODY = { error: 'X_RETIRED', message: 'хасагдсан' };

function setup(withTable = true) {
  const db = new DatabaseSync(':memory:');
  if (withTable) {
    db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER)`);
  }
  const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.post('/x/:id', retiredHandler('test.route', BODY) as never);
  const call = async (userId: number | null, ua: string) => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
    const headers: Record<string, string> = { 'user-agent': ua };
    if (userId !== null) headers['x-test-user'] = JSON.stringify({ sub: userId, role: 'engineer' });
    const res = await app.request('/x/5', { method: 'POST', headers }, { DB: d1Shim(db) }, ctx as never);
    await Promise.all(pending);
    return res;
  };
  const read = () => {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`${RETIRED_HITS_PREFIX}test.route`) as
      | { value: string }
      | undefined;
    return row ? JSON.parse(row.value) : null;
  };
  return { call, read };
}

test('анхны дуудлага мөр үүсгэнэ, дараагийнх нь тоог нэмж хэрэглэгчийг бүртгэнэ', async () => {
  const { call, read } = setup();
  const r1 = await call(7, 'Mozilla/5.0 old-pwa');
  assert.equal(r1.status, 410);
  assert.deepEqual(await r1.json(), BODY);
  let v = read();
  assert.equal(v.count, 1);
  assert.equal(v.last_user, 7);
  assert.equal(v.last_ua, 'Mozilla/5.0 old-pwa');
  assert.equal(v.first_at, v.last_at);

  await call(7, 'Mozilla/5.0 old-pwa');
  await call(12, 'curl/8.0');
  v = read();
  assert.equal(v.count, 3);
  assert.equal(v.last_user, 12);
  assert.equal(v.last_ua, 'curl/8.0');
  assert.deepEqual(Object.keys(v.users).sort(), ['u12', 'u7']);
  assert.ok(v.last_at >= v.first_at);
});

test('хэрэглэгчгүй дуудлага «anon» гэж бүртгэгдэнэ, UA 160 тэмдэгтээр тасарна', async () => {
  const { call, read } = setup();
  await call(null, 'a'.repeat(500));
  const v = read();
  assert.equal(v.count, 1);
  assert.equal(v.last_user, null);
  assert.ok('uanon' in v.users);
  assert.equal(v.last_ua.length, 160);
});

test('тоолуур бичигдэж чадахгүй ч (хүснэгт алга) 410 хэвээр буцна', async () => {
  const { call } = setup(false);
  const res = await call(3, 'x');
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), BODY);
});
