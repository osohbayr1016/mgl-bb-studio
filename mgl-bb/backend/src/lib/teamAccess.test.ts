// Багууд хуудасны харагдацын эрх — БОДИТ SQLite (`user_teams`), Hono `app.request()`.
// admin/senior бүх баг; бусад зөвхөн өөрийн баг (үндсэн + нэмэлт).
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

const { seesAllTeams, isTeamMember, listOwnTeams, requireOwnTeamOrManager } = await import(
  './teamAccess.ts'
);
const teamsRouter = (await import('../routes/teams.ts')).default;

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
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT, name_mn TEXT, name_en TEXT, sort_order INTEGER);
    CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER, is_primary INTEGER);
    INSERT INTO teams VALUES (1, 'BA', 'Архитектур', 'Architecture', 1), (2, 'AU', 'Автомат', NULL, 2),
                             (3, 'BB', 'Барилга', NULL, 3);
    -- 3 = BA-ийн үндсэн гишүүн, 4 = AU үндсэн + BA нэмэлт (нэмэлт нь өмнө бичигдсэн),
    -- 5 = багт хамаарахгүй
    INSERT INTO user_teams VALUES (3, 1, 1), (4, 1, 0), (4, 2, 1);
  `);
  return db;
}

/** Тухайн хэрэглэгчээр нэвтэрсэн мэт `middleware`-ийг ганцаараа туршина. */
function guardApp(db: DatabaseSync, user: { sub: number; role: string }) {
  const app = new Hono<{ Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.get('/teams/:id', requireOwnTeamOrManager() as never, (c) => c.json({ ok: true }));
  return (path: string) => app.request(path, {}, { DB: d1Shim(db) });
}

/** Бодит `routes/teams.ts`-ийг хэрэглэгчээр нь угсарна. */
function routerApp(db: DatabaseSync, user: { sub: number; role: string }) {
  const app = new Hono<{ Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/teams', teamsRouter as never);
  return (path: string) => app.request(path, {}, { DB: d1Shim(db) });
}

test('seesAllTeams: зөвхөн admin, senior', () => {
  assert.equal(seesAllTeams('admin'), true);
  assert.equal(seesAllTeams('senior'), true);
  for (const r of ['engineer', 'architect', 'client', 'worker', '']) {
    assert.equal(seesAllTeams(r), false, r);
  }
});

test('isTeamMember: үндсэн ба нэмэлт баг хоёулаа гишүүнчлэл', async () => {
  const db = setup();
  const d1 = d1Shim(db);
  assert.equal(await isTeamMember(d1, 3, 1), true);
  assert.equal(await isTeamMember(d1, 3, 2), false);
  assert.equal(await isTeamMember(d1, 4, 1), true); // нэмэлт баг
  assert.equal(await isTeamMember(d1, 4, 2), true); // үндсэн баг
  assert.equal(await isTeamMember(d1, 5, 1), false);
});

test('listOwnTeams: үндсэн баг эхэнд, нэмэлт нь араас; баггүй хүнд хоосон', async () => {
  const db = setup();
  const d1 = d1Shim(db);
  assert.deepEqual(
    (await listOwnTeams(d1, 4)).map((t) => [t.code, t.is_primary]),
    [
      ['AU', 1],
      ['BA', 0],
    ],
  );
  assert.deepEqual((await listOwnTeams(d1, 3)).map((t) => t.code), ['BA']);
  assert.deepEqual(await listOwnTeams(d1, 5), []);
});

test('admin, senior — ямар ч баг руу орно', async () => {
  const db = setup();
  for (const role of ['admin', 'senior']) {
    const get = guardApp(db, { sub: 99, role }); // 99 нь user_teams-д ОГТ байхгүй
    assert.equal((await get('/teams/1')).status, 200, role);
    assert.equal((await get('/teams/2')).status, 200, role);
    assert.equal((await get('/teams/777')).status, 200, role);
  }
});

test('engineer — зөвхөн өөрийн баг, бусад нь 403', async () => {
  const db = setup();
  const get = guardApp(db, { sub: 3, role: 'engineer' });
  assert.equal((await get('/teams/1')).status, 200);
  const other = await get('/teams/2');
  assert.equal(other.status, 403);
  assert.equal(((await other.json()) as { code: string }).code, 'TEAM_FORBIDDEN');
});

test('нэмэлт багийн гишүүн хоёр багаа хоёуланг нь харна', async () => {
  const db = setup();
  const get = guardApp(db, { sub: 4, role: 'architect' });
  assert.equal((await get('/teams/1')).status, 200);
  assert.equal((await get('/teams/2')).status, 200);
  assert.equal((await get('/teams/3')).status, 403);
});

test('багт хамаарахгүй хэрэглэгч, байхгүй/буруу id — 403 (баг байгаа эсэхийг задруулахгүй)', async () => {
  const db = setup();
  const get = guardApp(db, { sub: 5, role: 'engineer' });
  assert.equal((await get('/teams/1')).status, 403);
  assert.equal((await get('/teams/777')).status, 403);
  assert.equal((await get('/teams/abc')).status, 403);
});

test('routes/teams.ts: engineer бүх багийн хуваарилалтын самбарыг авч чадахгүй', async () => {
  const db = setup();
  const get = routerApp(db, { sub: 3, role: 'engineer' });
  assert.equal((await get('/api/teams/allocation')).status, 403);
});

test('routes/teams.ts: /mine нь /:id-д баригдахгүй, зөвхөн дуудагчийн багуудыг буцаана', async () => {
  const db = setup();
  const res = await routerApp(db, { sub: 3, role: 'engineer' })('/api/teams/mine');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { teams: Array<{ id: number; code: string }> };
  assert.deepEqual(body.teams.map((t) => t.code), ['BA']);
  // admin ч /mine-д өөрийн гишүүнчлэлээ л авна (бүх баг биш).
  const admin = await routerApp(db, { sub: 99, role: 'admin' })('/api/teams/mine');
  assert.deepEqual(((await admin.json()) as { teams: unknown[] }).teams, []);
});

test('routes/teams.ts: engineer бусад багийн дэлгэрэнгүйг авч чадахгүй', async () => {
  const db = setup();
  const get = routerApp(db, { sub: 3, role: 'engineer' });
  for (const suffix of ['', '/overview', '/member-tasks']) {
    const res = await get(`/api/teams/2${suffix}`);
    assert.equal(res.status, 403, `/api/teams/2${suffix}`);
    assert.equal(((await res.json()) as { code: string }).code, 'TEAM_FORBIDDEN');
  }
});
