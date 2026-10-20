// Revit-ийн автомат цаг бүртгэлийн route-ууд — БОДИТ SQLite (миграц 0360 файлаас),
// D1 shim, Hono `app.request()`.  MAX семантик (давтан хүргэлт), эзэмшил, устгасан
// таск, эрх (admin-only live), stale → offline, өдрийн тайлан, эзний Session 5-ын
// бодит урсгал (A → idle → A → B, өдөрт хоёулаа).
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

const revitTracking = (await import('./revitTracking.ts')).default;
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
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT, status TEXT);
    INSERT INTO users VALUES (1,'ceo','Захирал','admin','active'),(2,'bat','Бат','engineer','active'),
                             (3,'saraa','Сараа','architect','active'),(4,'old','Хуучин','engineer','inactive');
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO projects VALUES (10,'Project A'),(20,'Project B');
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER);
    INSERT INTO blocks VALUES (100,10),(200,20);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER, name TEXT);
    INSERT INTO drawings VALUES (1000,100,'BA-01'),(2000,200,'BB-01');
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER);
    INSERT INTO components VALUES (1,1000),(2,2000);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, component_id INTEGER, name TEXT);
    INSERT INTO tasks VALUES (501,1,'Task A'),(502,1,'Task B'),(601,2,'Task C');
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, percentage REAL,
      date TEXT, notes TEXT, created_at TEXT, status TEXT, source TEXT, is_rest_day INTEGER DEFAULT 0, defer_next_day INTEGER DEFAULT 0);
    CREATE TABLE revit_submissions (id INTEGER PRIMARY KEY, draft_uid TEXT);
  `);
  db.exec(readFileSync(new URL('../../migrations/0360_revit_work_tracking.sql', import.meta.url), 'utf8'));
  const env = { DB: d1Shim(db) } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/revit', revitTracking as never);
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

const CEO = { sub: 1, role: 'admin' };
const BAT = { sub: 2, role: 'engineer' };
const SARAA = { sub: 3, role: 'architect' };
const WORKER = { sub: 9, role: 'worker' };
const TODAY = todayInUB();
const SESS = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SESS2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

type Ack = { segment_id: string; rev: number; status: string; reason?: string };
type SyncRes = { acks: Ack[]; other_sessions: { task_id: number; other_ms: number }[]; work_date: string };
const json = async <T>(r: Response) => (await r.json()) as T;

const segment = (n: number, taskId: number, activeMs: number, rev: number, session = SESS, userId = 2) => ({
  segment_id: `${session}-${n}`,
  session_id: session,
  user_id: userId,
  task_id: taskId,
  work_date: TODAY,
  doc_key: 'docA',
  active_ms: activeMs,
  idle_ms: 0,
  rev,
  first_at: new Date().toISOString(),
  last_at: new Date().toISOString(),
});

const sync = (h: ReturnType<typeof harness>, user: { sub: number; role: string }, body: Record<string, unknown>) =>
  h.req(user, 'POST', '/api/revit/tracking/sync', { session_id: SESS, work_date: TODAY, ...body });

test('sync: cumulative MAX — replay and out-of-order delivery never double count', async () => {
  const h = harness();
  let r = await sync(h, BAT, { segments: [segment(1, 501, 60_000, 1)] });
  assert.equal(r.status, 200);
  assert.deepEqual((await json<SyncRes>(r)).acks.map((a) => a.status), ['accepted']);
  await sync(h, BAT, { segments: [segment(1, 501, 180_000, 3)] });
  await sync(h, BAT, { segments: [segment(1, 501, 60_000, 1)] });     // хожимдсон дахин хүргэлт
  await sync(h, BAT, { segments: [segment(1, 501, 180_000, 3)] });    // давтан
  const row = h.db.prepare('SELECT active_ms, rev, project_id, user_id FROM revit_work_segments').get() as Record<string, number>;
  assert.equal(row.active_ms, 180_000);
  assert.equal(row.rev, 3);
  assert.equal(row.project_id, 10, 'project derived server-side from the task');
  assert.equal(row.user_id, 2);
});

test('sync: identity from token — cannot write as someone else or over their segment', async () => {
  const h = harness();
  await sync(h, BAT, { segments: [segment(1, 501, 60_000, 1)] });
  // Сараа Батын сегмент id-г дарахыг оролдов.
  const r = await sync(h, SARAA, { session_id: SESS2, segments: [segment(1, 501, 9_999_999, 9, SESS, 3)] });
  assert.deepEqual((await json<SyncRes>(r)).acks[0], { segment_id: `${SESS}-1`, rev: 9, status: 'rejected', reason: 'owner_mismatch' });
  // Биеийн user_id нь токентой зөрвөл.
  const r2 = await sync(h, SARAA, { session_id: SESS2, segments: [segment(2, 501, 1000, 1, SESS2, 2)] });
  assert.equal((await json<SyncRes>(r2)).acks[0].reason, 'user_mismatch');
  const row = h.db.prepare('SELECT active_ms, user_id FROM revit_work_segments').get() as Record<string, number>;
  assert.equal(row.active_ms, 60_000);
  assert.equal(row.user_id, 2);
});

test('sync: deleted task is rejected (client drops it), bad payloads 400/413', async () => {
  const h = harness();
  const r = await sync(h, BAT, { segments: [segment(1, 99999, 1000, 1)] });
  assert.equal((await json<SyncRes>(r)).acks[0].reason, 'task_not_found');
  assert.equal((await h.req(BAT, 'POST', '/api/revit/tracking/sync', { segments: [] })).status, 400);
  const many = Array.from({ length: 201 }, (_, i) => segment(i + 1, 501, 1, 1));
  assert.equal((await sync(h, BAT, { segments: many })).status, 413);
});

test('roles: worker 403; live and day are admin-only (hidden system, no employee view)', async () => {
  const h = harness();
  assert.equal((await sync(h, WORKER, { segments: [] })).status, 403);
  assert.equal((await h.req(BAT, 'GET', '/api/revit/tracking/live')).status, 403);
  assert.equal((await h.req({ sub: 5, role: 'senior' }, 'GET', '/api/revit/tracking/live')).status, 403);
  assert.equal((await h.req(CEO, 'GET', '/api/revit/tracking/live')).status, 200);
  assert.equal((await h.req(BAT, 'GET', '/api/revit/tracking/day?user_id=3')).status, 403);
  assert.equal((await h.req(BAT, 'GET', '/api/revit/tracking/day')).status, 403);
  assert.equal((await h.req(CEO, 'GET', '/api/revit/tracking/day?user_id=2')).status, 200);
});

test('other_sessions: morning session feeds the afternoon client display', async () => {
  const h = harness();
  await sync(h, BAT, { session_id: SESS2, segments: [segment(1, 501, 3_600_000, 5, SESS2)] });
  const r = await sync(h, BAT, { segments: [segment(1, 501, 60_000, 1)] });
  const body = await json<SyncRes>(r);
  assert.deepEqual(body.other_sessions, [{ task_id: 501, other_ms: 3_600_000 }]);
});

type Live = {
  employees: {
    user_id: number;
    name: string;
    status: string;
    task_name: string | null;
    project_name: string | null;
    current_task_today_ms: number;
    revit_today_ms: number;
    stale: boolean;
  }[];
};

test('Session 5 flow: login → Project A / Task A working → idle → back → Task B; day has both', async () => {
  const h = harness();
  const presence = (state: string, taskId: number | null) => ({
    state,
    task_id: taskId,
    project_id: taskId ? 10 : null,
    doc_name: 'A.rvt',
    client_at: new Date().toISOString(),
  });

  // Ажилтан Revit-ээс нэвтэрч, А төслийн баримт, А таск — ажиллаж байна.
  await sync(h, BAT, { presence: presence('working', 501), segments: [segment(1, 501, 20 * 60_000, 40)] });
  let live = await json<Live>(await h.req(CEO, 'GET', '/api/revit/tracking/live'));
  let bat = live.employees.find((e) => e.user_id === 2)!;
  assert.equal(bat.status, 'working');
  assert.equal(bat.project_name, 'Project A');
  assert.equal(bat.task_name, 'Task A');
  assert.equal(bat.current_task_today_ms, 20 * 60_000);

  // Идэвхгүй болов (5 мин хүлцлийн дараа) — admin «idle» харна, цаг өсөхгүй.
  await sync(h, BAT, { presence: presence('idle', 501), segments: [segment(1, 501, 25 * 60_000, 60)] });
  live = await json<Live>(await h.req(CEO, 'GET', '/api/revit/tracking/live'));
  bat = live.employees.find((e) => e.user_id === 2)!;
  assert.equal(bat.status, 'idle');
  assert.equal(bat.current_task_today_ms, 25 * 60_000);

  // Буцаж ирэв — ижил таск дээр автоматаар үргэлжилнэ.
  await sync(h, BAT, { presence: presence('working', 501), segments: [segment(1, 501, 35 * 60_000, 90)] });
  // Б таск руу шилжив: А зогсоно (сегмент 1 хөдлөхгүй), Б өснө.
  await sync(h, BAT, { presence: presence('working', 502), segments: [segment(2, 502, 15 * 60_000, 30)] });
  live = await json<Live>(await h.req(CEO, 'GET', '/api/revit/tracking/live'));
  bat = live.employees.find((e) => e.user_id === 2)!;
  assert.equal(bat.status, 'working');
  assert.equal(bat.task_name, 'Task B');
  assert.equal(bat.current_task_today_ms, 15 * 60_000);
  assert.equal(bat.revit_today_ms, 50 * 60_000);

  // Revit-ээс тайлан (явц 60% + тэмдэглэл) — progress_entries-д ирсэн гэж үзье.
  h.db.prepare(
    `INSERT INTO progress_entries (task_id, user_id, percentage, date, notes, created_at, status, source)
     VALUES (501, 2, 60, ?, 'Хана, хаалганы тэмдэглэгээ', datetime('now'), 'approved', 'revit')`,
  ).run(TODAY);

  type Day = { total_active_ms: number; tasks: { task_id: number; active_ms: number; entries: { percentage: number; source: string; notes: string }[] }[] };
  const day = await json<Day>(await h.req(CEO, 'GET', '/api/revit/tracking/day?user_id=2'));
  assert.equal(day.total_active_ms, 50 * 60_000);
  const a = day.tasks.find((t) => t.task_id === 501)!;
  const b = day.tasks.find((t) => t.task_id === 502)!;
  assert.equal(a.active_ms, 35 * 60_000, 'Task A stopped growing at the switch');
  assert.equal(b.active_ms, 15 * 60_000);
  assert.deepEqual(a.entries.map((e) => [e.percentage, e.source]), [[60, 'revit']]);
  assert.equal(b.entries.length, 0, 'contributions do not overwrite each other');

  // Revit хаагдлаа (ended) — шууд offline.
  await sync(h, BAT, { presence: presence('working', 502), segments: [], ended: true });
  live = await json<Live>(await h.req(CEO, 'GET', '/api/revit/tracking/live'));
  assert.equal(live.employees.find((e) => e.user_id === 2)!.status, 'offline');
});

test('live: a crashed client (no heartbeat) turns offline — never "working" forever', async () => {
  const h = harness();
  await sync(h, SARAA, { presence: { state: 'working', task_id: 601 }, segments: [] });
  h.db.prepare("UPDATE revit_work_presence SET last_seen_at = ? WHERE user_id = 3").run(new Date(Date.now() - 60_000).toISOString());
  const live = await json<Live>(await h.req(CEO, 'GET', '/api/revit/tracking/live'));
  const s = live.employees.find((e) => e.user_id === 3)!;
  assert.equal(s.status, 'offline');
  assert.equal(s.stale, true);
  assert.equal(s.task_name, 'Task C', 'still shows what they were last on');
});

test('live: inactive users and week-old presence are hidden; no_task shows as online_no_task', async () => {
  const h = harness();
  h.db.prepare(
    `INSERT INTO revit_work_presence (session_id, user_id, state, started_at, last_seen_at)
     VALUES ('s-inactive', 4, 'working', ?, ?), ('s-ancient', 3, 'working', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
  ).run(new Date().toISOString(), new Date().toISOString());
  await sync(h, BAT, { presence: { state: 'no_task', task_id: null }, segments: [] });
  const live = await json<Live>(await h.req(CEO, 'GET', '/api/revit/tracking/live'));
  assert.deepEqual(live.employees.map((e) => [e.user_id, e.status]), [[2, 'online_no_task']]);
});

test('presence: garbage state is normalised; unknown task is dropped from presence', async () => {
  const h = harness();
  await sync(h, BAT, { presence: { state: 'hacked', task_id: 424242 }, segments: [] });
  const row = h.db.prepare('SELECT state, task_id FROM revit_work_presence').get() as Record<string, unknown>;
  assert.equal(row.state, 'no_task');
  assert.equal(row.task_id, null);
});
