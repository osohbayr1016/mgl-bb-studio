// Revit-ийн өөрчлөлтийн мэдэгдлийн route-ууд — БОДИТ SQLite (миграц 0390 файлаас),
// D1 shim, Hono `app.request()`.  Identity upsert, resolve, create (идемпотент,
// хүлээн авагч, холбогдоогүй нэр, мэдэгдэл), жагсаалтын эрх, дэлгэрэнгүйн
// харагдац, танилцсан, alias холбоход хүлээгдэж буй мэдэгдлийг хүргэх.
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

const router = (await import('./revitChangeNotices.ts')).default;

function d1Shim(db: DatabaseSync, counter: { writes: number }) {
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
        counter.writes += Number(r.changes);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return stmt;
  };
  return {
    prepare,
    // D1-ийн batch шиг: нэг транзакц, алдаа гарвал бүгд буцна.
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  } as unknown as D1Database;
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, status TEXT DEFAULT 'active', position TEXT
    );
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT, name_mn TEXT);
    CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER, is_primary INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE revit_documents (id INTEGER PRIMARY KEY, project_id INTEGER, doc_uid TEXT, last_seen_at TEXT);
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.exec(readFileSync(new URL('../../migrations/0390_revit_change_notices.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO teams (id, code, name_mn) VALUES (1, 'AR', 'Архитектур'), (2, 'BB', 'Барилга бүтээц');
    INSERT INTO users (id, username, full_name, role, position) VALUES
      (1, 'admin1', 'Админ', 'admin', 'Захирал'),
      (2, 'arch1', 'Архитектор Сараа', 'architect', 'Архитектор'),
      (3, 'eng1', 'Инженер Батаа', 'engineer', 'Бүтцийн инженер'),
      (4, 'senior1', 'Ахлах Дорж', 'senior', 'Ахлах'),
      (5, 'ZYA', 'Зая Инженер', 'engineer', NULL),
      (6, 'old', 'Гарсан ажилтан', 'engineer', NULL),
      (7, 'client1', 'Захиалагч', 'client', NULL),
      (8, 'eng2', 'Инженер Болд', 'engineer', NULL);
    UPDATE users SET status = 'inactive' WHERE id = 6;
    INSERT INTO user_teams (user_id, team_id, is_primary) VALUES (2, 1, 1), (3, 2, 1);
    INSERT INTO projects (id, name) VALUES (41, 'MGL-251006 EVERGREEN');
    INSERT INTO revit_documents (id, project_id, doc_uid, last_seen_at) VALUES
      (1, 41, 'doc-abc', '2026-10-01 00:00:00');
  `);
  return db;
}

type User = { sub: number; role: string };
const ADMIN: User = { sub: 1, role: 'admin' };
const ARCH: User = { sub: 2, role: 'architect' };
const ENG: User = { sub: 3, role: 'engineer' };
const SENIOR: User = { sub: 4, role: 'senior' };
const ZYA: User = { sub: 5, role: 'engineer' };
const ENG2: User = { sub: 8, role: 'engineer' };
const CLIENT: User = { sub: 7, role: 'client' };

function harness() {
  const db = freshDb();
  const counter = { writes: 0 };
  const env = { DB: d1Shim(db, counter) } as unknown as Record<string, unknown>;
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/revit', router as never);
  const req = async (user: User | null, method: string, path: string, body?: unknown) => {
    const res = await app.request(
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
      ctx as never,
    );
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    return { status: res.status, json: json as any };
  };
  return { db, counter, req };
}

function noticeBody(extra: Record<string, unknown> = {}) {
  return {
    client_uid: 'uid-0001',
    doc_uid: 'doc-abc',
    doc_title: 'EVERGREEN_AR.rvt',
    sender_revit_username: 'Saraa',
    moved: { label: 'Хана · 200 · #1001', category: 'Walls', ids: [1001], unique_ids: ['u-1001'] },
    offset_mm: [500, 0, 0],
    distance_mm: 500,
    verdict: 'MoveWithReview',
    headline: 'Хана 500 мм зөөгдөнө — 3 мөргөлдөөн',
    moved_at: '2026-10-06T09:15:00Z',
    conflicts: [
      { key: 'h:1', element_id: 11, label: 'Багана · #11', confirmed: true, creator: 'zya', last_changed_by: 'eng1' },
      { key: 'h:2', element_id: 12, label: 'Хана · #12', confirmed: false, creator: 'Ghost', owner: 'saraa' },
      { key: 'l:2:3', element_id: 13, label: 'Шат · #13', confirmed: true, last_changed_by: 'old' },
    ],
    issues: [{ mark: '!', text: 'Өрөө 101 хуваагдана' }],
    note: 'Цонхны байрлал өөрчлөгдсөн',
    ...extra,
  };
}

test('identity: upsert, давталтад 0 мөр бичигдэнэ, 1 өдрийн дараа шинэчилнэ', async () => {
  const h = harness();
  assert.equal((await h.req(ARCH, 'POST', '/api/revit/identity', { revit_username: ' Saraa ' })).status, 200);
  const row = h.db.prepare('SELECT * FROM revit_user_aliases').get() as Record<string, unknown>;
  assert.equal(row.revit_username_norm, 'saraa');
  assert.equal(row.revit_username, 'Saraa');
  assert.equal(row.source, 'addin');

  h.counter.writes = 0;
  await h.req(ARCH, 'POST', '/api/revit/identity', { revit_username: 'Saraa' });
  assert.equal(h.counter.writes, 0, 'ердийн давталт DB-д бичихгүй');

  await h.req(ARCH, 'POST', '/api/revit/identity', { revit_username: 'SARAA' });
  assert.equal(h.counter.writes, 1, 'бичлэг өөрчлөгдвөл шинэчилнэ');

  h.db.exec(`UPDATE revit_user_aliases SET last_seen_at = '2020-01-01 00:00:00', source = 'admin'`);
  h.counter.writes = 0;
  await h.req(ARCH, 'POST', '/api/revit/identity', { revit_username: 'SARAA' });
  assert.equal(h.counter.writes, 1, 'хуучирсан last_seen_at шинэчлэгдэнэ');
  const after = h.db.prepare('SELECT source FROM revit_user_aliases').get() as Record<string, unknown>;
  assert.equal(after.source, 'admin', 'админы source дарагдахгүй');

  assert.equal((await h.req(ARCH, 'POST', '/api/revit/identity', { revit_username: '' })).status, 400);
  assert.equal((await h.req(ARCH, 'POST', '/api/revit/identity', { revit_username: 'x'.repeat(129) })).status, 400);
  assert.equal((await h.req(CLIENT, 'POST', '/api/revit/identity', { revit_username: 'c' })).status, 403);
});

test('resolve: alias, username fallback, идэвхгүй хасагдана, төсөл doc_uid-аас', async () => {
  const h = harness();
  await h.req(ENG2, 'POST', '/api/revit/identity', { revit_username: 'Bolor' });
  await h.req(ENG, 'POST', '/api/revit/identity', { revit_username: 'bolor' });
  h.db.exec(`UPDATE revit_user_aliases SET last_seen_at = '2026-01-01 00:00:00' WHERE user_id = 8`);
  const r = await h.req(ARCH, 'POST', '/api/revit/change-notices/resolve', {
    revit_usernames: ['BOLOR', 'zya', 'old', 'nobody', 'zya'],
    doc_uid: 'doc-abc',
  });
  assert.equal(r.status, 200);
  const people = r.json.people as Array<{ revit_username: string; users: Array<{ id: number; team_name: string | null }> }>;
  assert.deepEqual(people.map((p) => p.revit_username), ['BOLOR', 'zya', 'old', 'nobody']);
  assert.deepEqual(people[0]!.users.map((u) => u.id), [3, 8], 'сүүлд харагдсан нь эхэнд');
  assert.equal(people[0]!.users[0]!.team_name, 'Барилга бүтээц');
  assert.deepEqual(people[1]!.users.map((u) => u.id), [5], 'users.username fallback');
  assert.deepEqual(people[2]!.users, [], 'идэвхгүй ажилтан');
  assert.deepEqual(people[3]!.users, []);
  assert.deepEqual(r.json.project, { id: 41, name: 'MGL-251006 EVERGREEN' });

  const tooMany = await h.req(ARCH, 'POST', '/api/revit/change-notices/resolve', { revit_usernames: new Array(201).fill('a') });
  assert.equal(tooMany.status, 400);
});

test('staff хайлт: кирилл нэр, username', async () => {
  const h = harness();
  const all = await h.req(ARCH, 'GET', '/api/revit/change-notices/staff');
  const ids = (all.json.users as Array<{ id: number }>).map((u) => u.id).sort();
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 8], 'идэвхгүй + захиалагч ороогүй');
  const q = await h.req(ARCH, 'GET', `/api/revit/change-notices/staff?q=${encodeURIComponent('инженер')}`);
  assert.deepEqual((q.json.users as Array<{ id: number }>).map((u) => u.id).sort(), [3, 5, 8]);
  const q2 = await h.req(ARCH, 'GET', '/api/revit/change-notices/staff?q=ENG1');
  assert.deepEqual((q2.json.users as Array<{ id: number }>).map((u) => u.id), [3]);
});

test('create: хүлээн авагч, холбогдоогүй нэр, мэдэгдэл, идемпотент client_uid', async () => {
  const h = harness();
  const r = await h.req(ARCH, 'POST', '/api/revit/change-notices', noticeBody({ manual_user_ids: [4, 2, 6], excluded_user_ids: [] }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.id as number;
  // zya → 5 (username), eng1 → 3 (username), saraa → 2 (илгээгчийн alias = илгээгч → хасагдана),
  // Ghost, old (идэвхгүй) → холбогдоогүй; manual 4 нэмэгдэнэ, 2 (илгээгч), 6 (идэвхгүй) хасагдана.
  const recIds = (r.json.recipients as Array<{ id: number }>).map((x) => x.id).sort();
  assert.deepEqual(recIds, [3, 4, 5]);
  assert.equal(r.json.notified, 3);
  assert.deepEqual(r.json.unresolved, ['Ghost', 'old']);

  const alias = h.db.prepare(`SELECT user_id FROM revit_user_aliases WHERE revit_username_norm = 'saraa'`).get() as Record<string, unknown>;
  assert.equal(alias.user_id, 2, 'илгээгчийн alias бүртгэгдэнэ');

  const row = h.db.prepare('SELECT * FROM revit_change_notices WHERE id = ?').get(id) as Record<string, unknown>;
  assert.equal(row.project_id, 41);
  assert.equal(JSON.parse(row.conflicts_json as string).length, 3);

  const rec5 = h.db.prepare('SELECT * FROM revit_change_notice_recipients WHERE notice_id = ? AND user_id = 5').get(id) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(rec5.reasons_json as string), ['creator']);
  assert.deepEqual(JSON.parse(rec5.element_keys_json as string), ['h:1']);
  const rec4 = h.db.prepare('SELECT * FROM revit_change_notice_recipients WHERE notice_id = ? AND user_id = 4').get(id) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(rec4.reasons_json as string), ['manual']);

  const notes = h.db.prepare(`SELECT user_id, type, title, body, link FROM notifications ORDER BY user_id`).all() as Array<Record<string, unknown>>;
  assert.deepEqual(notes.map((n) => n.user_id), [3, 4, 5]);
  assert.ok(notes.every((n) => n.type === 'revit_change_notice' && n.link === `/app/revit-changes?id=${id}`));
  assert.match(String(notes.find((n) => n.user_id === 4)!.title), /танд мэдэгдэл/);
  assert.match(String(notes.find((n) => n.user_id === 5)!.title), /огтлолцоно/);
  assert.match(String(notes[0]!.body), /Архитектор Сараа/);

  // Давтан илгээлт (offline outbox) — ижил хариу, шинэ мөр/мэдэгдэлгүй.
  const again = await h.req(ARCH, 'POST', '/api/revit/change-notices', noticeBody({ manual_user_ids: [4] }));
  assert.equal(again.status, 200);
  assert.equal(again.json.id, id);
  assert.equal(again.json.notified, 3);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM revit_change_notices').get() as { n: number }).n, 1);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n, 3);

  // Өөр хүн ижил client_uid → 409.
  assert.equal((await h.req(ENG, 'POST', '/api/revit/change-notices', noticeBody())).status, 409);
  // Excluded.
  const ex = await h.req(ARCH, 'POST', '/api/revit/change-notices', noticeBody({ client_uid: 'uid-0002', excluded_user_ids: [5] }));
  assert.deepEqual((ex.json.recipients as Array<{ id: number }>).map((x) => x.id), [3]);
  // Буруу бие.
  assert.equal((await h.req(ARCH, 'POST', '/api/revit/change-notices', { client_uid: 'x' })).status, 400);
});

test('list: inbox / sent / all эрх, хуудаслалт', async () => {
  const h = harness();
  const a = await h.req(ARCH, 'POST', '/api/revit/change-notices', noticeBody());
  const b = await h.req(ARCH, 'POST', '/api/revit/change-notices', noticeBody({ client_uid: 'uid-0002', conflicts: [], manual_user_ids: [8] }));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const inbox = await h.req(ZYA, 'GET', '/api/revit/change-notices?box=inbox');
  const items = inbox.json.notices as Array<Record<string, any>>;
  assert.deepEqual(items.map((n) => n.id), [a.json.id]);
  assert.equal(items[0]!.conflict_count, 3);
  assert.equal(items[0]!.recipient_count, 2);
  assert.equal(items[0]!.ack_count, 0);
  assert.deepEqual(items[0]!.my.reasons, ['creator']);
  assert.deepEqual(items[0]!.project, { id: 41, name: 'MGL-251006 EVERGREEN' });
  assert.equal(items[0]!.sender.full_name, 'Архитектор Сараа');

  const sent = await h.req(ARCH, 'GET', '/api/revit/change-notices?box=sent&limit=1');
  assert.deepEqual((sent.json.notices as Array<{ id: number }>).map((n) => n.id), [b.json.id]);
  assert.equal(sent.json.next_before, b.json.id);
  const page2 = await h.req(ARCH, 'GET', `/api/revit/change-notices?box=sent&limit=1&before=${b.json.id}`);
  assert.deepEqual((page2.json.notices as Array<{ id: number }>).map((n) => n.id), [a.json.id]);
  assert.equal(page2.json.next_before, null);

  assert.equal((await h.req(ENG, 'GET', '/api/revit/change-notices?box=all')).status, 403);
  const all = await h.req(SENIOR, 'GET', '/api/revit/change-notices?box=all');
  assert.equal((all.json.notices as unknown[]).length, 2);
  assert.equal((await h.req(ENG, 'GET', '/api/revit/change-notices?box=bogus')).status, 400);
});

test('detail: харагдац (404), read_at, my.element_keys; ack идемпотент + илгээгчид нэг мэдэгдэл', async () => {
  const h = harness();
  const c = await h.req(ARCH, 'POST', '/api/revit/change-notices', noticeBody());
  const id = c.json.id as number;

  assert.equal((await h.req(ENG2, 'GET', `/api/revit/change-notices/${id}`)).status, 404, 'хамааралгүй инженер');
  assert.equal((await h.req(ENG2, 'GET', '/api/revit/change-notices/9999')).status, 404);
  assert.equal((await h.req(SENIOR, 'GET', `/api/revit/change-notices/${id}`)).status, 200);
  const asSender = await h.req(ARCH, 'GET', `/api/revit/change-notices/${id}`);
  assert.equal(asSender.json.notice.my, null);
  assert.equal(asSender.json.notice.can_ack, false);

  const d = await h.req(ZYA, 'GET', `/api/revit/change-notices/${id}`);
  assert.equal(d.status, 200);
  const n = d.json.notice;
  assert.deepEqual(n.my.element_keys, ['h:1']);
  assert.ok(n.my.read_at, 'хүлээн авагч үзэхэд read_at');
  assert.equal(n.can_ack, true);
  assert.equal(n.conflicts.length, 3);
  assert.deepEqual(n.moved.ids, [1001]);
  assert.deepEqual(n.offset_mm, [500, 0, 0]);
  assert.equal(n.note, 'Цонхны байрлал өөрчлөгдсөн');
  assert.deepEqual(n.unresolved, ['Ghost', 'old']);
  assert.equal(n.recipients.length, 2);

  h.db.exec('DELETE FROM notifications');
  const ack = await h.req(ZYA, 'POST', `/api/revit/change-notices/${id}/ack`);
  assert.equal(ack.status, 200);
  assert.ok(ack.json.acknowledged_at);
  const ack2 = await h.req(ZYA, 'POST', `/api/revit/change-notices/${id}/ack`);
  assert.equal(ack2.json.acknowledged_at, ack.json.acknowledged_at);
  const toSender = h.db.prepare('SELECT user_id, title FROM notifications').all() as Array<Record<string, unknown>>;
  assert.equal(toSender.length, 1, 'илгээгчид ганц мэдэгдэл');
  assert.equal(toSender[0]!.user_id, 2);
  assert.match(String(toSender[0]!.title), /Зая Инженер танилцлаа/);

  assert.equal((await h.req(ARCH, 'POST', `/api/revit/change-notices/${id}/ack`)).status, 403, 'илгээгч ack хийхгүй');
  assert.equal((await h.req(ENG2, 'POST', `/api/revit/change-notices/${id}/ack`)).status, 404);

  const list = await h.req(SENIOR, 'GET', '/api/revit/change-notices?box=all');
  assert.equal((list.json.notices as Array<{ ack_count: number }>)[0]!.ack_count, 1);
});

test('aliases: admin эрх, холбоход хүлээгдэж буй мэдэгдлийг хүргэнэ, устгах', async () => {
  const h = harness();
  const c = await h.req(ARCH, 'POST', '/api/revit/change-notices', noticeBody());
  const id = c.json.id as number;
  // 31 хоногийн өмнөх мэдэгдэл — хүргэгдэхгүй.
  await h.req(ARCH, 'POST', '/api/revit/change-notices', noticeBody({ client_uid: 'uid-old' }));
  h.db.exec(`UPDATE revit_change_notices SET created_at = datetime('now', '-31 days') WHERE client_uid = 'uid-old'`);

  assert.equal((await h.req(ENG, 'GET', '/api/revit/aliases')).status, 403);
  const before = await h.req(ADMIN, 'GET', '/api/revit/aliases');
  const unresolved = before.json.unresolved as Array<{ revit_username: string; notice_count: number }>;
  assert.deepEqual(unresolved.map((u) => u.revit_username).sort(), ['Ghost', 'old']);
  assert.equal(unresolved.find((u) => u.revit_username === 'Ghost')!.notice_count, 2);

  assert.equal((await h.req(ADMIN, 'PUT', '/api/revit/aliases', { revit_username: 'ghost', user_id: 6 })).status, 400, 'идэвхгүй');
  h.db.exec('DELETE FROM notifications');
  const put = await h.req(ADMIN, 'PUT', '/api/revit/aliases', { revit_username: 'ghost', user_id: 8 });
  assert.equal(put.status, 200);
  assert.equal(put.json.delivered, 1);

  const rec = h.db.prepare('SELECT * FROM revit_change_notice_recipients WHERE notice_id = ? AND user_id = 8').get(id) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(rec.reasons_json as string), ['creator']);
  assert.deepEqual(JSON.parse(rec.element_keys_json as string), ['h:2']);
  const n = h.db.prepare('SELECT unresolved_json FROM revit_change_notices WHERE id = ?').get(id) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(n.unresolved_json as string), ['old']);
  const notes = h.db.prepare('SELECT user_id, link FROM notifications').all() as Array<Record<string, unknown>>;
  assert.deepEqual(notes.map((x) => ({ ...x })), [{ user_id: 8, link: `/app/revit-changes?id=${id}` }]);
  const src = h.db.prepare(`SELECT source FROM revit_user_aliases WHERE revit_username_norm = 'ghost'`).get() as Record<string, unknown>;
  assert.equal(src.source, 'admin');

  // Давтан PUT — дахин хүргэхгүй.
  const put2 = await h.req(ADMIN, 'PUT', '/api/revit/aliases', { revit_username: 'Ghost', user_id: 8 });
  assert.equal(put2.json.delivered, 0);

  // Одоо байгаа хүлээн авагч (3) руу холбоход шалтгаан нэгтгэгдэнэ, шинэ мэдэгдэлгүй.
  const put3 = await h.req(ADMIN, 'PUT', '/api/revit/aliases', { revit_username: 'old', user_id: 3 });
  assert.equal(put3.json.delivered, 0);
  const rec3 = h.db.prepare('SELECT * FROM revit_change_notice_recipients WHERE notice_id = ? AND user_id = 3').get(id) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(rec3.reasons_json as string), ['last_changed']);
  assert.deepEqual(JSON.parse(rec3.element_keys_json as string), ['h:1', 'l:2:3']);

  const after = await h.req(ADMIN, 'GET', '/api/revit/aliases');
  assert.deepEqual(after.json.unresolved, [], 'холбогдсон нэрс жагсаалтаас гарна');
  const aliases = after.json.aliases as Array<{ revit_username: string; user: { id: number } }>;
  assert.ok(aliases.some((a) => a.revit_username === 'Ghost' && a.user.id === 8));

  const del = await h.req(ADMIN, 'DELETE', '/api/revit/aliases', { revit_username: 'ghost', user_id: 8 });
  assert.equal(del.json.deleted, 1);
  assert.equal((await h.req(ARCH, 'PUT', '/api/revit/aliases', { revit_username: 'x', user_id: 3 })).status, 403);
});

// Revit 2027 дээр (Snowdon Towers, баганыг +1500 мм) add-in-ий БОДИТООР илгээсэн JSON — гэрээ add-in ⇄ ERP хоёр талд таарч буйг баталгаажуулна.
test('add-in-ий бодит payload (Revit 2027-аас барьсан): 201, зохиогч + гараар нэмсэн хүнд мэдэгдэл, relation хадгалагдана', async () => {
  const h = harness();
  const body = JSON.parse(readFileSync(new URL('./__fixtures__/revitAddinNotice.live-2026-10-06.json', import.meta.url), 'utf8'));
  // Paul_F_Aubin = элементийг үүсгэсэн Revit хэрэглэгч → Инженер Батаа (id 3).
  h.db.exec(`INSERT INTO revit_user_aliases (revit_username_norm, revit_username, user_id) VALUES ('paul_f_aubin', 'Paul_F_Aubin', 3)`);
  const res = await h.req(ARCH, 'POST', '/api/revit/change-notices', body);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.notified, 2);
  assert.deepEqual(res.json.recipients.map((r: { id: number }) => r.id).sort(), [3, 8]);
  // Эзэмшигч anandoctane4ZDUG2 = илгээгч өөрөө (sender_revit_username-аар тэр мөчид холбогдсон) → хүлээн авагч ч, холбогдоогүй ч БИШ.
  assert.deepEqual(res.json.unresolved, []);
  assert.equal((h.db.prepare(`SELECT user_id FROM revit_user_aliases WHERE revit_username_norm = 'anandoctane4zdug2'`).get() as { user_id: number }).user_id, 2);
  const detail = await h.req(ENG, 'GET', `/api/revit/change-notices/${res.json.id}`);
  assert.equal(detail.status, 200);
  const n = detail.json.notice;
  assert.equal(n.conflicts.length, 4);
  assert.equal(n.conflicts[0].relation, 'follows');
  assert.equal(n.conflicts[0].creator, 'Paul_F_Aubin');
  assert.ok(n.my.element_keys.length === 4, 'Батаа бүх 4 элементийг үүсгэсэн');
  assert.equal(n.moved.unique_ids[0], body.moved.unique_ids[0]);
  assert.equal(n.project?.id, 41);
  // Дахин илгээх (offline outbox) — ижил хариу, давхар мэдэгдэлгүй.
  const again = await h.req(ARCH, 'POST', '/api/revit/change-notices', body);
  assert.equal(again.status, 200);
  assert.equal(again.json.id, res.json.id);
  const notes = h.db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE type = 'revit_change_notice'`).get() as { n: number };
  assert.equal(notes.n, 2);
});
