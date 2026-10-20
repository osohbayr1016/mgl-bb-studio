// «Өөртөө авах» = цаг эхэлнэ = таск дээрх нэр (эзэн 2026-10-01, migration 0368/0369).
// БОДИТ SQLite (0361 + 0368 миграц файлаас), D1 shim, Hono `app.request()`.
//
// Хамрах хүрээ: авах (/claim ба /api/task-timer/start ижил), өөр таск авахад өмнөх нь
// зогсох, эзлэгдсэн (TASK_OCCUPIED + хуваах өгөгдмөл), хуваагдахгүй таскт зэрэг,
// зэрэг ирсэн хоёр «авах», ирц, CEO, хувь оруулах эрх (TAKE_REQUIRED / SPLIT_DONE),
// хамгийн өндөр хувиас дээш л оноо (шууд ба дахин тооцоолол ижил), хуваалтын
// «хийгдсэн хэсэг»-ийн оноо, ирцийн «Гарах», 23:59, админ зогсоолт, «Одоо хийж буй»,
// «Миний ажлууд»-ын түүх.  Цэвэр дүрэм: `lib/taskTake.test.ts`, `lib/taskSplit.test.ts`.
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

const tasksRoute = (await import('./tasks.ts')).default;
const taskTimerRoute = (await import('./taskTimer.ts')).default;
const allocRoute = (await import('./taskAllocations.ts')).default;
const progressMod = await import('./progress.ts');
const progressRoute = progressMod.default;
const { submitProgressEntry, recalculateProjectPoints } = progressMod;
const { todayInUB } = await import('../lib/time.ts');
const { stopTimerOnClockOut, sweepDayEndTimers } = await import('../lib/taskTimerStore.ts');
const { ubDayWindow } = await import('../lib/taskTimer.ts');

/** Бодит D1 шиг: `bind` шинэ statement, batch = НЭГ транзакц, RETURNING мөр `results`-д. */
function d1Shim(db: DatabaseSync) {
  const exec = (sql: string, params: unknown[]) => {
    if (/\bRETURNING\b/i.test(sql)) {
      const rows = db.prepare(sql).all(...(params as never[]));
      return { results: rows, meta: { last_row_id: 0, changes: rows.length } };
    }
    const r = db.prepare(sql).run(...(params as never[]));
    return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  };
  const prepare = (sql: string, params: unknown[] = []) => {
    const stmt = {
      bind(...args: unknown[]) {
        return prepare(sql, args);
      },
      async all() {
        return { results: db.prepare(sql).all(...(params as never[])) };
      },
      async first() {
        return db.prepare(sql).get(...(params as never[])) ?? null;
      },
      async run() {
        return exec(sql, params);
      },
      runSync: () => exec(sql, params),
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

const CEO = { sub: 2, role: 'admin' };
const BAT = { sub: 3, role: 'engineer' };
const DORJ = { sub: 4, role: 'engineer' };
const SARAA = { sub: 5, role: 'architect' };
const ADMIN = { sub: 9, role: 'admin' };
type U = { sub: number; role: string };

function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, role TEXT,
      status TEXT DEFAULT 'active', is_support INTEGER DEFAULT 0, profile_image TEXT,
      employee_id TEXT, attendance_unrestricted INTEGER DEFAULT 0);
    CREATE TABLE attendance_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT,
      clock_in TEXT, clock_out TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      category TEXT, progress_mode TEXT DEFAULT 'tasks', completion_questions TEXT,
      complexity TEXT, complexity_pct REAL, updated_at TEXT);
    CREATE TABLE project_team_shares (project_id INTEGER, team_id INTEGER, share_percent REAL);
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER, team_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER, name TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, component_id INTEGER, name TEXT NOT NULL,
      weight_percent REAL NOT NULL DEFAULT 10, assigned_to INTEGER, due_date TEXT, start_date TEXT,
      sort_order INTEGER DEFAULT 0, ai_completion_summary TEXT, ai_completion_summary_at TEXT);
    CREATE TABLE task_assignees (task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), self_joined INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (task_id, user_id));
    CREATE TABLE task_self_done (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, note TEXT,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE task_shares (task_id INTEGER, user_id INTEGER, share_percent REAL, is_owner INTEGER DEFAULT 0);
    CREATE TABLE task_checklist_items (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, is_done INTEGER);
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER,
      percentage REAL CHECK (percentage >= 0 AND percentage <= 100), date TEXT, notes TEXT, status TEXT,
      reviewed_by INTEGER, reviewed_at TEXT, image_url TEXT, is_rest_day INTEGER DEFAULT 0,
      defer_next_day INTEGER DEFAULT 0, completion_qa TEXT, attachments TEXT, source TEXT DEFAULT 'web',
      is_baseline INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE user_points (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, project_id INTEGER,
      repair_project_id INTEGER, task_id INTEGER, progress_entry_id INTEGER, amount REAL, delta_pct REAL,
      assignee_count INTEGER, awarded_by INTEGER, source TEXT NOT NULL DEFAULT 'progress',
      awarded_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, title TEXT, body TEXT,
      link TEXT, created_at TEXT DEFAULT (datetime('now')));
    -- Ирцийн цайны цонх (албан таймер ч хэрэглэнэ) — тест өдрийн аль ч цагт ижил байхын тулд унтраасан.
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by INTEGER);
    INSERT INTO app_settings (key, value) VALUES ('lunch_enabled', '0');
  `);
  for (const f of ['0361_task_timer.sql', '0368_task_live_take.sql', '0370_task_personal_list.sql', '0376_task_allocations.sql', '0377_task_contributions.sql', '0378_allocation_ledger_links.sql', '0379_task_timer_voids.sql', '0383_task_alloc_hardening.sql', '0384_task_alloc_gate.sql', '0385_task_conversions.sql', '0386_task_retractions.sql', '0387_task_unsplits.sql', '0394_task_parts.sql']) {
    db.exec(readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8'));
  }
  // Төсөл 10: нэг баг (100%), нэг блок/зураг (100) → таскийн жин × хувь = төслийн хувь.
  // complexity_pct 100 → оноо = төслийн Δ% (уншихад хялбар).
  db.exec(`
    INSERT INTO users (id, username, full_name, role) VALUES
      (2, 'ceo', 'Захирал', 'admin'), (3, 'bat', 'Бат', 'engineer'), (4, 'dorj', 'Дорж', 'engineer'),
      (5, 'saraa', 'Сараа', 'architect'), (8, 'ahlah', 'Ахлах', 'senior'), (9, 'admin', 'Админ', 'admin');
    INSERT INTO projects (id, name, status, category, progress_mode, complexity_pct) VALUES
      (10, 'ABC Tower', 'active', 'AZ', 'tasks', 100), (20, 'Засвар', 'active', 'ZA', 'hours', 100);
    INSERT INTO project_team_shares VALUES (10, 1, 100), (20, 1, 100);
    INSERT INTO blocks (id, project_id, team_id, name) VALUES (100, 10, 1, 'Блок'), (200, 20, 1, 'Блок');
    INSERT INTO drawings (id, block_id, name) VALUES (1000, 100, 'BA-01'), (2000, 200, 'ZA-01');
    INSERT INTO components (id, drawing_id, name) VALUES (1, 1000, 'К'), (2, 2000, 'К');
    INSERT INTO tasks (id, component_id, name, weight_percent, sort_order) VALUES
      (501, 1, 'Фасад', 10, 10), (502, 1, 'План', 20, 20), (503, 1, 'Хурлын даалгавар', 0, 30),
      (504, 1, 'Огтлол', 10, 40), (601, 2, 'Засвар', 10, 10);
  `);
  db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out) VALUES
       (3, ?1, '08:55', NULL), (4, ?1, '09:00', NULL), (5, ?1, '09:01', NULL), (8, ?1, '08:40', NULL)`,
  ).run(todayInUB());

  const d1 = d1Shim(db);
  const env = { DB: d1 } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/tasks', allocRoute as never);
  app.route('/api/tasks', tasksRoute as never);
  app.route('/api/task-timer', taskTimerRoute as never);
  app.route('/api/progress', progressRoute as never);
  const req = (user: U, method: string, path: string, body?: unknown) =>
    app.request(
      `http://x${path}`,
      {
        method,
        headers: {
          'x-test-user': JSON.stringify(user), 'x-task-alloc-contract': '1',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
      // `/allocation/progress` нь commit-ийн дараах ажлыг `waitUntil`-д өгдөг.
      { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as never,
    );
  const claim = (taskId: number, user: U = BAT) => req(user, 'POST', `/api/tasks/${taskId}/claim`, {});
  const start = (taskId: number, user: U = BAT) => req(user, 'POST', '/api/task-timer/start', { task_id: taskId });
  const pause = (user: U = BAT) => req(user, 'POST', '/api/task-timer/pause', {});
  const open = () =>
    (db.prepare('SELECT user_id, task_id FROM task_timer_sessions WHERE ended_at IS NULL ORDER BY user_id').all() as Array<{
      user_id: number;
      task_id: number;
    }>).map((r) => [r.user_id, r.task_id]);
  let seq = 0;
  /** Хувь оруулна (бодит pipeline) — дараа нь created_at-ийг секундээр салгана
   *  (production-ийн `created_at` секундын нарийвчлалтай; ижил секундэд хоёр бичлэг
   *  ирвэл «сүүлийн» нь тодорхойгүй — мэдэгдэж буй tiebreak, тест түүнийг тойрно). */
  const report = async (user: U, taskId: number, pct: number, extra: Record<string, unknown> = {}) => {
    const r = await submitProgressEntry(
      { db: d1, ai: undefined as never, waitUntil: () => {}, user },
      { task_id: taskId, percentage: pct, ...extra } as never,
    );
    if (r.ok) {
      seq += 1;
      db.prepare(`UPDATE progress_entries SET created_at = ? WHERE id = ?`).run(
        `2026-09-01 10:00:${String(seq).padStart(2, '0')}`,
        Number((r.body as { id: number }).id),
      );
    }
    return r;
  };
  const pointsOf = (userId: number) =>
    Math.round(
      ((db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM user_points WHERE user_id = ?`).get(userId) as { s: number })
        .s) * 1e6,
    ) / 1e6;
  return { db, d1, req, claim, start, pause, open, report, pointsOf };
}

const json = async <T>(r: Response) => (await r.json()) as T;
type Occupied = {
  error: string;
  message: string;
  occupied: {
    workers: Array<{ user_id: number; full_name: string | null }>;
    split: { weight_percent: number; progress: number; done_weight: number; split_total: number; default_weights: number[] };
  };
};

test('«Өөртөө авах» (/claim) = албан таймер эхэлнэ + ажилласан хүмүүсийн бүртгэл; assigned_to бичигдэхгүй', async () => {
  const h = harness();
  const r = await h.claim(501);
  assert.equal(r.status, 200);
  const body = await json<{ outcome: string; task_id: number; progress: number }>(r);
  assert.equal(body.outcome, 'started');
  assert.equal(body.task_id, 501);
  assert.deepEqual(h.open(), [[3, 501]]);
  assert.ok(h.db.prepare('SELECT 1 FROM task_assignees WHERE task_id = 501 AND user_id = 3').get());
  assert.equal((h.db.prepare('SELECT assigned_to FROM tasks WHERE id = 501').get() as { assigned_to: null }).assigned_to, null);
  // Давхар даралт — идемпотент.
  const again = await json<{ outcome: string }>(await h.claim(501));
  assert.equal(again.outcome, 'already_running');
  assert.deepEqual(h.open(), [[3, 501]]);
});

test('өөр таск авахад өмнөх нь АТОМ зогсож шинэ нь эхэлнэ (/claim ба /start ижил урсгал)', async () => {
  const h = harness();
  await h.claim(501);
  const r = await json<{ outcome: string }>(await h.start(504));
  assert.equal(r.outcome, 'switched');
  assert.deepEqual(h.open(), [[3, 504]]);
  const ev = h.db
    .prepare(`SELECT action, task_id, from_task_id FROM task_timer_events ORDER BY id`)
    .all() as Array<{ action: string; task_id: number; from_task_id: number | null }>;
  assert.deepEqual(
    ev.map((e) => [e.action, e.task_id, e.from_task_id]),
    [
      ['start', 501, null],
      ['switch', 504, 501],
    ],
  );
  // Хоёр таск хоёулаа түүхэнд.
  assert.equal(
    (h.db.prepare('SELECT COUNT(*) AS n FROM task_assignees WHERE user_id = 3').get() as { n: number }).n,
    2,
  );
});

test('өөр хүн ажиллаж буй хуваагдах таск → 409 TASK_OCCUPIED + хуваах өгөгдмөл; миний таймер хөндөгдөхгүй', async () => {
  const h = harness();
  await h.claim(501, SARAA);
  await h.claim(504); // Бат 504 дээр
  const r = await h.claim(501);
  assert.equal(r.status, 409);
  const b = await json<Occupied>(r);
  assert.equal(b.error, 'TASK_OCCUPIED');
  assert.deepEqual(b.occupied.workers.map((w) => [w.user_id, w.full_name]), [[5, 'Сараа']]);
  assert.deepEqual(b.occupied.split, {
    weight_percent: 10,
    progress: 0,
    done_weight: 0,
    split_total: 10,
    default_weights: [5, 5],
  });
  assert.deepEqual(h.open(), [
    [3, 504],
    [5, 501],
  ]);
  // Явцтай таск — хийгдсэн хэсэг хэвээр, ҮЛДСЭНИЙГ 50/50.
  await h.report(SARAA, 501, 40);
  const r2 = await json<Occupied>(await h.claim(501));
  assert.deepEqual(r2.occupied.split, {
    weight_percent: 10,
    progress: 40,
    done_weight: 4,
    split_total: 6,
    default_weights: [3, 3],
  });
});

test('хуваагдахгүй таск (жин 0, цагаар бодох ZA) — хэд хэдэн хүн ЗЭРЭГ', async () => {
  const h = harness();
  assert.equal((await h.claim(503)).status, 200);
  assert.equal((await h.claim(503, SARAA)).status, 200);
  assert.equal((await h.claim(601, DORJ)).status, 200);
  assert.equal((await h.claim(601, { sub: 8, role: 'senior' })).status, 200);
  assert.deepEqual(h.open(), [
    [3, 503],
    [4, 601],
    [5, 503],
    [8, 601],
  ]);
});

test('зэрэг ирсэн хоёр «авах» (чөлөөтэй хуваагдах таск) — ЯГ нэг нь ялна, ялагдагчийн өмнөх таймер хэвээр', async () => {
  const h = harness();
  await h.claim(502, DORJ); // Дорж 502 дээр ажиллаж байгаад 504-ийг авах гэнэ
  const [a, b] = await Promise.all([h.claim(504), h.claim(504, DORJ)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const runners = h.open().filter(([, t]) => t === 504);
  assert.equal(runners.length, 1, '504 дээр ЯГ нэг хүн');
  const winner = runners[0]![0];
  if (winner === 3) {
    assert.deepEqual(h.open(), [
      [3, 504],
      [4, 502],
    ], 'ялагдсан Доржийн 502 зогсоогүй');
  } else {
    assert.deepEqual(h.open(), [[4, 504]]);
  }
});

test('ирцгүй бол авахгүй (409 NOT_CLOCKED_IN); CEO ирцээс чөлөөтэй авна; энгийн админ 403', async () => {
  const h = harness();
  h.db.prepare(`UPDATE attendance_sessions SET clock_out = '12:00' WHERE user_id = 4`).run();
  const r = await h.claim(501, DORJ);
  assert.equal(r.status, 409);
  assert.equal((await json<{ error: string }>(r)).error, 'NOT_CLOCKED_IN');
  assert.equal((await h.claim(501, CEO)).status, 200, 'CEO (id 2) — admin боловч таск авдаг');
  const adm = await h.claim(502, ADMIN);
  assert.equal(adm.status, 403);
  assert.equal((await json<{ error: string }>(adm)).error, 'ROLE_NOT_ALLOWED');
  // Онцгой код (ERD) — ирцээс чөлөөтэй.
  h.db.prepare(`UPDATE users SET employee_id = 'ERD' WHERE id = 4`).run();
  assert.equal((await h.claim(502, DORJ)).status, 200);
});

test('хувь оруулах = таскийг авч ажилласан хүн (TAKE_REQUIRED); зогсоосны дараа ч болно; админ залруулна', async () => {
  const h = harness();
  const no = await h.report(BAT, 501, 30);
  assert.equal(no.status, 403);
  assert.equal((no.body as { error: string }).error, 'TAKE_REQUIRED');
  await h.claim(501);
  await h.pause();
  assert.deepEqual(h.open(), []);
  assert.equal((await h.report(BAT, 501, 30)).status, 201, 'оройн тайлан — таймер зогссон ч');
  assert.equal((await h.report(ADMIN, 501, 35)).status, 201, 'админ залруулга');
  // Өөр хүн (Сараа) авч ажиллаагүй тул бичихгүй.
  assert.equal((await h.report(SARAA, 501, 50)).status, 403);
});

test('ХАМГИЙН ӨНДӨР ХУВЬ: 60 → 20 (алдаа) → 60 → 80 — оноо 6 + 0 + 0 + 2; дахин тооцоолол ИЖИЛ', async () => {
  const h = harness();
  await h.claim(501);
  await h.report(BAT, 501, 60);
  assert.equal(h.pointsOf(3), 6);
  await h.report(BAT, 501, 20);
  assert.equal(h.pointsOf(3), 6, 'буурахад хасахгүй');
  await h.report(BAT, 501, 60);
  assert.equal(h.pointsOf(3), 6, 'урьд хүрсэн 60 хүртэл ДАВХАР оноо БАЙХГҮЙ (хуучин дүрэм +4 өгдөг байв)');
  await h.report(BAT, 501, 80);
  assert.equal(h.pointsOf(3), 8, 'зөвхөн 60-аас дээших 20% × 10 = 2');
  // Бат зогсооход Сараа авч бууруулаад (50) өсгөвөл (90) — зөвхөн 80-аас дээш 10%.
  await h.pause();
  await h.claim(501, SARAA);
  await h.report(SARAA, 501, 50);
  await h.report(SARAA, 501, 90);
  assert.equal(h.pointsOf(5), 1);
  // Σ оноо (complexity 100) = төслийн явц 9%.
  assert.equal(h.pointsOf(3) + h.pointsOf(5), 9);
  await recalculateProjectPoints(h.d1, 10);
  assert.equal(h.pointsOf(3), 8, 'recalc — шууд олголттой ижил');
  assert.equal(h.pointsOf(5), 1);
});

test('ирцийн «Гарах» → таймер тэр агшинд зогсоно (`+08:00` ч UTC болж хадгалагдана)', async () => {
  const h = harness();
  await h.claim(501);
  // Эхлэлийг 1 минутын өмнө болгоно — «Гарах» нь өнгөрсөн агшин (ирээдүйн агшин одоогоор хавчигдана).
  const started = new Date(Date.now() - 60_000).toISOString();
  h.db.prepare('UPDATE task_timer_sessions SET started_at = ?').run(started);
  // «Гарах» = эхэлснээс 1 секундийн дараа, УБ-ын бүсээр бичигдсэн.
  const outMs = Date.parse(started) + 1000;
  const ub = new Date(outMs + 8 * 3600_000).toISOString().replace('Z', '+08:00');
  assert.equal(await stopTimerOnClockOut(h.d1, { userId: 3, actorId: 3, clockOutIso: ub }), 1);
  const row = h.db.prepare('SELECT ended_at, duration_ms, end_reason, end_note FROM task_timer_sessions').get() as {
    ended_at: string;
    duration_ms: number;
    end_reason: string;
    end_note: string;
  };
  assert.equal(row.ended_at, new Date(outMs).toISOString());
  assert.equal(row.duration_ms, 1000);
  assert.deepEqual([row.end_reason, row.end_note], ['pause', 'clock_out']);
  const ev = h.db.prepare(`SELECT action, note FROM task_timer_events ORDER BY id DESC LIMIT 1`).get() as {
    action: string;
    note: string;
  };
  assert.deepEqual([ev.action, ev.note], ['pause', 'clock_out']);
});

test('23:59 — өчигдөр эхэлсэн мартагдсан таймер өчигдрийн 23:59:59.999-д хаагдана, өнөөдрийнх хэвээр', async () => {
  const h = harness();
  const offset = 8 * 60;
  const nowMs = Date.parse('2026-10-01T02:00:00.000Z'); // УБ 10:00
  const yStart = new Date(ubDayWindow('2026-09-30', offset).startMs + 9 * 3600_000).toISOString(); // өчигдөр 09:00
  const tStart = new Date(ubDayWindow('2026-10-01', offset).startMs + 9 * 3600_000).toISOString(); // өнөөдөр 09:00
  const ins = h.db.prepare(
    `INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, start_reason, started_by,
       start_request_id, created_at, updated_at) VALUES (?, ?, 10, ?, 'start', ?, ?, ?, ?)`,
  );
  ins.run(3, 501, yStart, 3, 'y', yStart, yStart);
  ins.run(5, 504, tStart, 5, 't', tStart, tStart);
  const closed = await sweepDayEndTimers(h.d1, nowMs, offset);
  assert.equal(closed.length, 1);
  assert.equal(closed[0]!.user_id, 3);
  const row = h.db
    .prepare(`SELECT ended_at, duration_ms, end_note, ended_by FROM task_timer_sessions WHERE user_id = 3`)
    .get() as { ended_at: string; duration_ms: number; end_note: string; ended_by: number };
  assert.equal(row.ended_at, '2026-09-30T15:59:59.999Z', 'УБ 23:59:59.999');
  assert.equal(row.duration_ms, 15 * 3600_000 - 1);
  assert.equal(row.end_note, 'day_end');
  assert.equal(row.ended_by, 0, 'систем');
  assert.deepEqual(h.open(), [[5, 504]]);
  // Дахин ажиллуулахад юу ч хийхгүй.
  assert.equal((await sweepDayEndTimers(h.d1, nowMs, offset)).length, 0);
});

test('админ бусдын таймерыг зогсооно (мэдэгдэлтэй); инженер 403', async () => {
  const h = harness();
  await h.claim(501);
  assert.equal((await h.req(SARAA, 'POST', '/api/task-timer/users/3/stop', {})).status, 403);
  const r = await h.req(ADMIN, 'POST', '/api/task-timer/users/3/stop', {});
  assert.equal(r.status, 200);
  assert.deepEqual(await json<{ stopped: number; task_id: number }>(r), { stopped: 1, task_id: 501 });
  assert.deepEqual(h.open(), []);
  const s = h.db.prepare(`SELECT end_note, ended_by FROM task_timer_sessions`).get() as { end_note: string; ended_by: number };
  assert.deepEqual([s.end_note, s.ended_by], ['admin_stop', 9]);
  const n = h.db.prepare(`SELECT user_id, title FROM notifications`).all() as Array<{ user_id: number; title: string }>;
  assert.equal(n.length, 1);
  assert.equal(n[0]!.user_id, 3);
  // Таск чөлөөтэй — өөр хүн шууд авна.
  assert.equal((await h.claim(501, SARAA)).status, 200);
});

test('«Одоо хийж буй» (/working) — нэр л, цаг буцаахгүй; зөвхөн тухайн төсөл', async () => {
  const h = harness();
  await h.claim(501);
  await h.claim(601, SARAA);
  const r = await json<{ workers: Array<Record<string, unknown>> }>(
    await h.req(DORJ, 'GET', '/api/task-timer/working?project_id=10'),
  );
  assert.deepEqual(r.workers.map((w) => [w.task_id, w.user_id, w.full_name]), [[501, 3, 'Бат']]);
  for (const w of r.workers) {
    assert.ok(!('started_at' in w) && !('duration_ms' in w), 'зарцуулсан цаг бусдад харагдахгүй');
  }
  assert.equal((await h.req(DORJ, 'GET', '/api/task-timer/working')).status, 400);
});

test('«Миний ажлууд» = түүх: ажилласан таскууд, can_report, worked_today, одоо хэн ажиллаж байна', async () => {
  const h = harness();
  await h.claim(501);
  await h.report(BAT, 501, 30);
  await h.claim(504); // 501 зогсож 504 эхэлнэ
  await h.claim(501, SARAA); // Сараа 501 дээр
  // Өмнөх өдөр ажилласан (өнөөдөр биш) таск — түүхэнд, «өнөөдрийн тайлан» хүлээгдэхгүй.
  h.db.exec(`
    INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms, start_reason,
      end_reason, started_by, ended_by, start_request_id, end_request_id, created_at, updated_at)
    VALUES (3, 502, 10, '2026-09-01T01:00:00.000Z', '2026-09-01T02:00:00.000Z', 3600000, 'start', 'pause', 3, 3,
      'old', 'old-e', '2026-09-01T01:00:00.000Z', '2026-09-01T02:00:00.000Z');
    INSERT INTO task_assignees (task_id, user_id) VALUES (502, 3);
  `);
  const r = await json<{
    items: Array<{ id: number; can_report: boolean; worked_today: boolean; working: Array<{ user_id: number }> }>;
    summary: { total: number; pending_today: number; reported_today: number };
  }>(await h.req(BAT, 'GET', '/api/progress/my-tasks'));
  const byId = new Map(r.items.map((i) => [i.id, i]));
  assert.deepEqual([...byId.keys()].sort(), [501, 502, 504]);
  assert.deepEqual(
    byId.get(501)!.working.map((w) => w.user_id),
    [5],
    'Сараа одоо 501 дээр — нэр л',
  );
  assert.deepEqual(byId.get(504)!.working.map((w) => w.user_id), [3]);
  assert.ok([501, 502, 504].every((id) => byId.get(id)!.can_report));
  assert.equal(byId.get(502)!.worked_today, false);
  assert.equal(byId.get(504)!.worked_today, true);
  // 501 өнөөдөр тайлагдсан; 504 өнөөдөр ажилласан ч тайлангүй; 502 өнөөдөр ажиллаагүй.
  assert.equal(r.summary.pending_today, 1);
});

// ───── Өөр хүн аль хэдийн хувь оруулсан таск → хуваах цонх (эзэн 2026-10-06) ─────
// Хуваарилалтын систем АСААЛТТАЙ (`task_alloc.state = enabled`) үед л; унтарсан/түр зогссон үед хуучин зан төлөв ХЭВЭЭР
// (хуваах цонхны «Хадгалах» 423 өгөх тул). Одоо ажиллаж буй хүн байхгүй ч, өмнөх хүний хувь түүнд хэвээр.
type ProgressSplit = { error: string; message: string; occupied: Occupied['occupied'] & { reason: string } };

/** Сараа 501 дээр 40% оруулаад таймерыг зогсоосон (одоо хэн ч ажиллахгүй). */
async function saraaDid40(h: ReturnType<typeof harness>) {
  assert.equal((await h.claim(501, SARAA)).status, 200);
  assert.equal((await h.report(SARAA, 501, 40)).ok, true);
  assert.equal((await h.pause(SARAA)).status, 200);
  assert.deepEqual(h.open(), []);
}
const setGate = (h: ReturnType<typeof harness>, state: string) =>
  h.db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('task_alloc.state', ?)`).run(state);

test('хувьтай таск + хуваарилалт АСААЛТТАЙ → хуваах цонх (reason=progress, ажиллаж буй хүнгүй); цаг эхлэхгүй', async () => {
  const h = harness();
  await saraaDid40(h);
  setGate(h, 'enabled');
  const r = await h.claim(501);
  assert.equal(r.status, 409);
  const b = await json<ProgressSplit>(r);
  assert.equal(b.error, 'TASK_OCCUPIED');
  assert.equal(b.occupied.reason, 'progress');
  assert.deepEqual(b.occupied.workers, []);
  assert.equal(b.occupied.split.progress, 40);
  assert.deepEqual(h.open(), [], 'Батын цаг эхлээгүй — хуваарилсны дараа л эхэлнэ');
  // /task-timer/start мөн ижил.
  assert.equal((await h.start(501)).status, 409);
});

test('хуваарилалт унтарсан / түр зогссон / тохируулаагүй үед хуучин зан төлөв — шууд авна', async () => {
  for (const state of [null, 'disabled', 'paused']) {
    const h = harness();
    await saraaDid40(h);
    if (state) setGate(h, state);
    const r = await h.claim(501);
    assert.equal(r.status, 200, `gate=${String(state)}`);
    assert.deepEqual(h.open(), [[3, 501]]);
  }
});

test('өөрийн хувь/цаг байгаа хүн (ажилласан) цонхгүй авна; хуваагдахгүй (жин 0) таск шууд; 100% биш', async () => {
  const h = harness();
  await saraaDid40(h);
  setGate(h, 'enabled');
  assert.equal((await h.claim(501, SARAA)).status, 200, 'өмнөх хүн өөрөө дахин авахад цонхгүй');
  await h.pause(SARAA);
  // Бат өмнө нь энэ таск дээр ажилласан (хаагдсан сэшн) → «шинэ хүн» биш.
  h.db
    .prepare(
      `INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms, start_reason, end_reason,
         started_by, ended_by, start_request_id, end_request_id, created_at, updated_at)
       VALUES (3, 501, 10, '2026-10-04T08:00:00.000Z', '2026-10-04T09:00:00.000Z', 3600000, 'start', 'pause', 3, 3, 'a', 'b',
         '2026-10-04T08:00:00.000Z', '2026-10-04T09:00:00.000Z')`,
    )
    .run();
  assert.equal((await h.claim(501)).status, 200, 'өмнө нь ажилласан хүнд цонх гарахгүй');
  // Хуваагдахгүй таск (жин 0) — хувьтай ч шууд.
  h.db.prepare(`INSERT INTO progress_entries (task_id, user_id, percentage, date, status, created_at) VALUES (503, 5, 30, '2026-10-04', 'approved', '2026-10-04 10:00:00')`).run();
  assert.equal((await h.claim(503, DORJ)).status, 200);
});

test('«Таскийг буцаах»-аар өөрийн хувь/цаг нуугдсан бол дахин авахад цонх ДАХИН гарна', async () => {
  const h = harness();
  h.db.exec(readFileSync(new URL('../../migrations/0386_task_retractions.sql', import.meta.url), 'utf8'));
  await saraaDid40(h);
  setGate(h, 'enabled');
  h.db
    .prepare(
      `INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms, start_reason, end_reason,
         started_by, ended_by, start_request_id, end_request_id, created_at, updated_at)
       VALUES (3, 501, 10, '2026-10-04T08:00:00.000Z', '2026-10-04T09:00:00.000Z', 3600000, 'start', 'pause', 3, 3, 'a', 'b',
         '2026-10-04T08:00:00.000Z', '2026-10-04T09:00:00.000Z')`,
    )
    .run();
  // «Буцаах» бүртгэлгүй: өмнө нь ажилласан хүн → цонхгүй (дээрх тест). Буцаасны дараа: хуучин сэшн нуугдсан → шинэ хүн мэт.
  h.db
    .prepare(`INSERT INTO task_retractions (task_id, user_id, retracted_at, entries_json, points_json) VALUES (501, 3, '2026-10-04T09:30:00.000Z', '[]', '[]')`)
    .run();
  const again = await h.claim(501);
  assert.equal(again.status, 409);
  assert.equal((await json<ProgressSplit>(again)).occupied.reason, 'progress');
  h.db.prepare('DELETE FROM task_retractions').run();
  assert.equal((await h.claim(501)).status, 200, 'буцаалтгүй бол өмнө нь ажилласан хүн шууд авна');
});

test('E2E (хуваарилалт АСААЛТТАЙ): хувьтай таск → 409 → хуваарилах (Сараа 40 хийсэн, Бат 60) → Батын цаг эхэлнэ', async () => {
  const h = harness();
  await saraaDid40(h);
  setGate(h, 'enabled');
  assert.equal((await h.claim(501)).status, 409);
  const ov = await h.req(BAT, 'GET', '/api/tasks/501/allocation');
  assert.equal(ov.status, 200);
  const split = await h.req(BAT, 'POST', '/api/tasks/501/allocation/split', {
    request_id: 'e2e-split-0001',
    expected_revision: null,
    mode: 'total',
    targets: [
      { user_id: 5, target_units: 400_000 },
      { user_id: 3, target_units: 600_000 },
    ],
  });
  assert.equal(split.status, 200, await split.clone().text());
  const take = await h.claim(501);
  assert.equal(take.status, 200, await take.clone().text());
  assert.deepEqual(h.open(), [[3, 501]]);
  // Сараагийн хийсэн 40% түүнд хэвээр (хуваарилалт D = 40).
  const row = h.db.prepare('SELECT done_units, target_units FROM task_allocations WHERE task_id = 501 AND user_id = 5').get() as { done_units: number; target_units: number };
  assert.equal(row.done_units, 400_000);
});
/** Хуваах (Сараа 40 хийсэн, Бат 60) → Бат авч хувь оруулна → `revision` буцаана. */
async function splitAndBatWorks(h: ReturnType<typeof harness>, batDoneUnits = 500_000) {
  await saraaDid40(h);
  setGate(h, 'enabled');
  const split = await h.req(BAT, 'POST', '/api/tasks/501/allocation/split', {
    request_id: 'unsplit-split-01',
    expected_revision: null,
    mode: 'total',
    targets: [
      { user_id: 5, target_units: 400_000 },
      { user_id: 3, target_units: 600_000 },
    ],
  });
  assert.equal(split.status, 200, await split.clone().text());
  assert.equal((await h.claim(501)).status, 200);
  const rev = (h.db.prepare('SELECT revision FROM task_roots WHERE task_id = 501').get() as { revision: number }).revision;
  const prog = await h.req(BAT, 'POST', '/api/tasks/501/allocation/progress', {
    request_id: 'unsplit-prog-01',
    expected_revision: rev,
    done_units: batDoneUnits,
  });
  assert.equal(prog.status, 200, await prog.clone().text());
}
const taskPct = (h: ReturnType<typeof harness>) =>
  (h.db
    .prepare(`SELECT percentage FROM progress_entries WHERE task_id = 501 AND status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get() as { percentage: number } | undefined)?.percentage ?? 0;

test('«Хуваалтыг цуцлах»: хуваах + хувь оруулсны дараа таск ЯГ хуваахаас өмнөх байдалдаа буцна', async () => {
  const h = harness();
  await saraaDid40(h);
  const saraaBefore = h.pointsOf(5);
  const entriesBefore = (h.db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = 501').get() as { n: number }).n;
  h.db.exec('DELETE FROM progress_entries; DELETE FROM user_points; DELETE FROM task_timer_sessions; DELETE FROM task_timer_events; DELETE FROM task_assignees');
  await splitAndBatWorks(h);
  assert.ok(taskPct(h) > 40, 'хуваасны дараа явц өссөн');
  assert.ok(h.pointsOf(3) > 0, 'Бат оноо авсан');
  assert.deepEqual(h.open(), [[3, 501]]);

  // Хуваалтад оролцоогүй хүн цуцалж чадахгүй.
  assert.equal((await h.req(DORJ, 'POST', '/api/tasks/501/allocation/unsplit', { request_id: 'unsplit-dorj-01' })).status, 403);

  const r = await h.req(BAT, 'POST', '/api/tasks/501/allocation/unsplit', { request_id: 'unsplit-bat-0001' });
  assert.equal(r.status, 200, await r.clone().text());
  const body = await json<{ progress_before: number; progress_after: number; timers_stopped: number; replayed: boolean }>(r);
  assert.equal(body.progress_after, 40);
  assert.equal(body.timers_stopped, 1);
  assert.equal(taskPct(h), 40, 'таскийн хувь хуучин 40% руу буцсан');
  assert.equal(h.pointsOf(5), saraaBefore, 'Сараагийн хуучин оноо хэвээр');
  assert.equal(h.pointsOf(3), 0, 'Батын хуваалтаас хойшх оноо устсан');
  for (const t of ['task_roots', 'task_allocations', 'task_contributions']) {
    assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE task_id = 501`).get() as { n: number }).n, 0, t);
  }
  assert.equal(
    (h.db.prepare(`SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = 501`).get() as { n: number }).n,
    entriesBefore,
    'зөвхөн хуучин бичлэгүүд үлдсэн',
  );
  assert.deepEqual(h.open(), [], 'явж буй таймер зогссон');
  assert.ok(
    (h.db.prepare('SELECT COUNT(*) AS n FROM task_timer_sessions WHERE user_id = 3').get() as { n: number }).n > 0,
    'цагийн сэшн устаагүй',
  );
  // Бат хуваалтаас хойш л оролцсон → таск дээрх цаг нь нуугдана; Сараа хуучин оролцогч → нуугдахгүй.
  const hidden = h.db.prepare('SELECT user_id FROM task_retractions WHERE task_id = 501 ORDER BY user_id').all() as Array<{ user_id: number }>;
  assert.deepEqual(hidden.map((x) => x.user_id), [3]);
  assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM task_unsplits WHERE task_id = 501').get() as { n: number }).n, 1, 'архив');

  // Ижил хүсэлт давтагдвал юу ч өөрчлөхгүй.
  const again = await h.req(BAT, 'POST', '/api/tasks/501/allocation/unsplit', { request_id: 'unsplit-bat-0001' });
  assert.equal(again.status, 200);
  assert.equal((await json<{ replayed: boolean }>(again)).replayed, true);
  // Дахин цуцлах — хуваагдаагүй таск.
  const third = await h.req(BAT, 'POST', '/api/tasks/501/allocation/unsplit', { request_id: 'unsplit-bat-0002' });
  assert.equal(third.status, 409);
  assert.equal((await json<{ error: string }>(third)).error, 'NOT_MANAGED');
  // Таск хуучин шиг: Бат дахин авах гэвэл хуваах цонх ДАХИН гарна (Сараагийн 40%).
  const take = await h.claim(501);
  assert.equal(take.status, 409);
  assert.equal((await json<ProgressSplit>(take)).occupied.reason, 'progress');
});

test('«Хуваалтыг цуцлах»: бусдын хийсэн ажилтай бол оролцогч 403, ахлах/админ цуцална', async () => {
  const h = harness();
  await splitAndBatWorks(h);
  // Сараа (40% seed-тэй) хуваалтаас хойш бас ажилласан.
  const rev = (h.db.prepare('SELECT revision FROM task_roots WHERE task_id = 501').get() as { revision: number }).revision;
  h.db.prepare(
    `INSERT INTO task_contributions (task_id, user_id, actor_id, kind, units, work_date, awarded_at, recorded_at, request_id, seq, root_revision)
     VALUES (501, 5, 5, 'work', 10000, '2026-10-06', '2026-10-06T01:00:00Z', '2026-10-06T01:00:00Z', 'saraa-w', 0, ?)`,
  ).run(rev);
  const r = await h.req(BAT, 'POST', '/api/tasks/501/allocation/unsplit', { request_id: 'unsplit-bat-1001' });
  assert.equal(r.status, 403);
  assert.equal((await json<{ error: string }>(r)).error, 'UNSPLIT_OTHERS_WORK');
  const admin = await h.req(ADMIN, 'POST', '/api/tasks/501/allocation/unsplit', { request_id: 'unsplit-adm-1001' });
  assert.equal(admin.status, 200, await admin.clone().text());
  assert.equal(taskPct(h), 40);
});
