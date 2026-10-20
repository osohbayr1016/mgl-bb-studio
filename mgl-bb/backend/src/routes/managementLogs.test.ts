// «Менежментийн багийн тайлан» — БОДИТ SQLite (миграц 0345), D1 shim, `reports`
// router-ийн бодит mount (`requireAdmin`).  Эрх, гишүүнчлэл, нэгтгэл, бичвэр.
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

const managementLogs = (await import('./managementLogs.ts')).default;
const { requireAdmin } = await import('../middleware/auth.ts');
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
  return { prepare } as unknown as D1Database;
}

const TODAY = todayInUB();
const shift = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, position TEXT,
    role TEXT, status TEXT, is_support INTEGER DEFAULT 0, created_at TEXT DEFAULT '2026-01-01 00:00:00')`);
  db.exec(`CREATE TABLE holidays (date TEXT PRIMARY KEY)`);
  const u = db.prepare('INSERT INTO users (id, username, full_name, position, role, status, is_support) VALUES (?, ?, ?, ?, ?, ?, ?)');
  u.run(2, 'ceo', 'Захирал Б', 'Захирал', 'admin', 'active', 0);
  u.run(3, 'adm', 'Админ А', 'Менежер', 'admin', 'active', 0);
  u.run(4, 'gone', 'Гарсан Г', null, 'admin', 'inactive', 0);
  u.run(5, 'tv', 'TV', null, 'admin', 'active', 1);
  u.run(6, 'eng', 'Инженер И', null, 'engineer', 'active', 0);
  db.exec(readFileSync(new URL('../../migrations/0345_daily_work_logs.sql', import.meta.url), 'utf8'));
  const ins = db.prepare(
    'INSERT INTO daily_work_logs (user_id, log_date, items_json, first_written_on) VALUES (?, ?, ?, ?)',
  );
  ins.run(2, TODAY, '["Хурал","Гэрээ"]', TODAY);
  ins.run(3, shift(TODAY, -1), '["Тайлан"]', TODAY); // нөхөж бичсэн
  ins.run(4, shift(TODAY, -2), '["Хуучин ажил"]', shift(TODAY, -2)); // идэвхгүй, мужид бичсэн
  ins.run(3, shift(TODAY, -40), '["Эрт"]', shift(TODAY, -40)); // 7 хоногийн мужаас гадуур

  const env = { DB: d1Shim(db) } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  const reports = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  reports.use('*', requireAdmin() as never);
  reports.route('/management-logs', managementLogs as never);
  app.route('/api/reports', reports);
  const req = (user: { sub: number; role: string }, path: string) =>
    app.request(`http://x${path}`, { headers: { 'x-test-user': JSON.stringify(user) } }, env);
  return { db, req };
}

const ADMIN = { sub: 3, role: 'admin' };
const SENIOR = { sub: 7, role: 'senior' };
const json = async <T>(r: Response) => (await r.json()) as T;

type Member = { user_id: number; days_logged: number; items: number; late_days: number; active: boolean; is_ceo: boolean };
type TeamBody = {
  members: Member[];
  days: { user_id: number; date: string; count: number; items?: string[]; late: boolean; updated_at: string }[];
  totals: { items: number; writers: number; members: number };
  range: { from: string; to: string };
  with_items: boolean;
};

test('зөвхөн admin (CEO орно) — senior/engineer 403', async () => {
  const h = harness();
  for (const p of ['/api/reports/management-logs', '/api/reports/management-logs/3']) {
    assert.equal((await h.req(SENIOR, p)).status, 403, p);
    assert.equal((await h.req({ sub: 6, role: 'engineer' }, p)).status, 403, p);
  }
  assert.equal((await h.req({ sub: 2, role: 'admin' }, '/api/reports/management-logs')).status, 200);
});

test('багийн нэгтгэл: идэвхтэй admin + мужид бичсэн идэвхгүй, ТВ ба инженер орохгүй', async () => {
  const h = harness();
  const b = await json<TeamBody>(await h.req(ADMIN, '/api/reports/management-logs?window=7d'));
  const ids = b.members.map((m) => m.user_id).sort();
  assert.deepEqual(ids, [2, 3, 4]);
  assert.equal(b.members.find((m) => m.user_id === 4)?.active, false);
  assert.equal(b.members.find((m) => m.user_id === 2)?.is_ceo, true);
  assert.equal(b.totals.items, 4);
  assert.equal(b.totals.writers, 3);
  assert.equal(b.with_items, true);
  const late = b.days.find((d) => d.user_id === 3);
  assert.equal(late?.late, true);
  assert.deepEqual(late?.items, ['Тайлан']);
  assert.match(late?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'updated_at UTC ISO');
  assert.ok(!b.days.some((d) => d.date === shift(TODAY, -40)), '7 хоногийн мужаас гадуурх орохгүй');
});

test('all цонх анхны тайлангаас эхэлнэ; буруу цонх 400', async () => {
  const h = harness();
  const b = await json<TeamBody>(await h.req(ADMIN, '/api/reports/management-logs?window=all'));
  assert.equal(b.range.from, shift(TODAY, -40));
  assert.equal(b.range.to, TODAY);
  assert.equal(b.with_items, true); // 41 өдөр ≤ 62
  assert.equal(b.members.find((m) => m.user_id === 3)?.days_logged, 2);
  assert.equal((await h.req(ADMIN, '/api/reports/management-logs?window=bogus')).status, 400);
});

test('гишүүний нэгтгэл: бүх ажил бичвэртэй, heatmap-д мужаас гадуурх ч ирнэ', async () => {
  const h = harness();
  const r = await h.req(ADMIN, '/api/reports/management-logs/3?window=7d');
  assert.equal(r.status, 200);
  const b = await json<{
    member: { name: string; first_log_date: string };
    summary: { days_logged: number; items: number; late_days: number };
    logs: { log_date: string; items: string[]; late: boolean }[];
  }>(r);
  assert.equal(b.member.name, 'Админ А');
  assert.equal(b.member.first_log_date, shift(TODAY, -40));
  assert.deepEqual(b.summary.days_logged, 1);
  assert.equal(b.summary.late_days, 1);
  assert.deepEqual(
    b.logs.map((l) => l.log_date),
    [shift(TODAY, -1), shift(TODAY, -40)],
  );
  assert.deepEqual(b.logs[1]!.items, ['Эрт']);
  // admin биш, тайлангүй хүн — 404; байхгүй id — 404; буруу id — 400.
  assert.equal((await h.req(ADMIN, '/api/reports/management-logs/6')).status, 404);
  assert.equal((await h.req(ADMIN, '/api/reports/management-logs/999')).status, 404);
  assert.equal((await h.req(ADMIN, '/api/reports/management-logs/abc')).status, 400);
});
