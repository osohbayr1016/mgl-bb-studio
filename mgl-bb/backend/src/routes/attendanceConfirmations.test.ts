// `GET /api/attendance-confirmations/due` — сарын эхний «ирцээ батал»
// сануулга.  БОДИТ SQLite, D1 shim, Hono `app.request()`; огноог
// `mock.timers`-ээр УБ-ын 2026-10-01 болгоно.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
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

const mod = await import('./attendanceConfirmations.ts');
const router = mod.default;
const { dueMonthOf } = mod;

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
    async run() {
      const r = db.prepare(sql).run(...(params as never[]));
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  return { prepare } as unknown as D1Database;
}

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, employee_id TEXT, profile_image TEXT,
      role TEXT, status TEXT, is_support INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER, is_primary INTEGER);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT,
      title TEXT, body TEXT, link TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE attendance_confirmations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT,
      status TEXT, requested_by INTEGER, requested_at TEXT, responded_at TEXT, request_note TEXT,
      response_note TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT,
      UNIQUE(user_id, date));
    CREATE TABLE attendance_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT,
      clock_in TEXT, clock_out TEXT, hours_worked REAL, late_minutes INTEGER, non_project_credit_hours REAL);
    CREATE TABLE leave_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT, leave_type TEXT,
      start_date TEXT, end_date TEXT, start_time TEXT, end_time TEXT, hours REAL, days REAL, is_paid INTEGER);
    CREATE TABLE leave_arrival_cuts (leave_id INTEGER, user_id INTEGER, date TEXT, used_minutes INTEGER);
    CREATE TABLE out_of_office_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT,
      work_date TEXT, hours REAL, start_time TEXT, end_time TEXT);
    CREATE TABLE holidays (date TEXT PRIMARY KEY, name TEXT);
    INSERT INTO users (id, full_name, role, status, is_support, created_at) VALUES
      (2,  'Захирал',     'admin',    'active',   0, '2024-01-01 00:00:00'),
      (10, 'Инженер',     'engineer', 'active',   0, '2025-03-01 00:00:00'),
      (11, 'Архитектор',  'architect','active',   0, '2026-09-15 02:00:00'),
      (12, 'Шинэ',        'engineer', 'active',   0, '2026-10-01 00:30:00'),
      (13, 'Цэвэрлэгч',   'worker',   'active',   0, '2025-01-01 00:00:00'),
      (14, 'Захиалагч',   'client',   'active',   0, '2025-01-01 00:00:00'),
      (15, 'TV',          'engineer', 'active',   1, '2025-01-01 00:00:00'),
      (16, 'Гарсан',      'engineer', 'inactive', 0, '2025-01-01 00:00:00'),
      (17, 'Ахлах',       'senior',   'active',   0, NULL);
  `);
  db.exec(readFileSync(new URL('../../migrations/0403_attendance_confirmation_fingerprint.sql', import.meta.url), 'utf8'));
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/', router as never);
  const env = { DB: d1Shim(db) };
  const call = async (sub: number, role: string, method = 'GET', path = '/due', body?: unknown) => {
    const res = await app.request(
      path,
      {
        method,
        headers: {
          'x-test-user': JSON.stringify({ sub, role }),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      env,
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  return { db, call };
}

/** УБ-ын 2026-10-01 10:00 (= 02:00 UTC). */
function atUbOct1() {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T02:00:00Z') });
}

test('dueMonthOf — өмнөх сар, EARLIEST_MONTH-ээс өмнөх нь null', () => {
  assert.equal(dueMonthOf('2026-10-01'), '2026-09');
  assert.equal(dueMonthOf('2026-10-31'), '2026-09');
  assert.equal(dueMonthOf('2027-01-01'), '2026-12');
  assert.equal(dueMonthOf('2026-07-01'), '2026-06');
  assert.equal(dueMonthOf('2026-06-15'), null);
});

test('roster-ын ажилтан өмнөх сараа батлаагүй бол due', async () => {
  atUbOct1();
  try {
    const { call } = setup();
    for (const [sub, role] of [
      [10, 'engineer'],
      [11, 'architect'], // 9-р сарын дундуур орсон — хагас сар ч батлах ёстой
      [17, 'senior'], // created_at NULL
    ] as const) {
      const r = await call(sub, role);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { due: { month: '2026-09', reason: 'unanswered' } }, `user ${sub}`);
    }
  } finally {
    mock.timers.reset();
  }
});

test('roster-оос гадуурх хүнд сануулга гарахгүй', async () => {
  atUbOct1();
  try {
    const { call } = setup();
    for (const [sub, role] of [
      [2, 'admin'], // CEO (CEO_USER_ID = 2)
      [12, 'engineer'], // 10-р сард орсон
      [13, 'worker'],
      [14, 'client'],
      [15, 'engineer'], // is_support
      [16, 'engineer'], // идэвхгүй
    ] as const) {
      const r = await call(sub, role);
      assert.deepEqual(r.json, { due: null }, `user ${sub}`);
    }
  } finally {
    mock.timers.reset();
  }
});

test('«Батлах» эсвэл «Зөрчилтэй» дармагц сануулга алга болно; хуучин requested мөр хариулт биш', async () => {
  atUbOct1();
  try {
    const { db, call } = setup();
    db.exec(`INSERT INTO attendance_confirmations (user_id, date, status, requested_by)
             VALUES (17, '2026-09-01', 'requested', 2), (10, '2026-08-01', 'confirmed', 10)`);
    // Өмнөх (8-р) сарын батлалт 9-р сарыг хаахгүй.
    assert.deepEqual((await call(10, 'engineer')).json, { due: { month: '2026-09', reason: 'unanswered' } });
    assert.deepEqual((await call(17, 'senior')).json, { due: { month: '2026-09', reason: 'unanswered' } });

    const ok = await call(10, 'engineer', 'POST', '/approve-month', {
      month: '2026-09',
      status: 'confirmed',
    });
    assert.equal(ok.status, 201);
    assert.deepEqual((await call(10, 'engineer')).json, { due: null });

    const bad = await call(11, 'architect', 'POST', '/approve-month', {
      month: '2026-09',
      status: 'disputed',
      note: '9/12-нд ирсэн бүртгэл алга',
    });
    assert.equal(bad.status, 201);
    assert.deepEqual((await call(11, 'architect')).json, { due: null });

    // Одоогийн (10-р) сар хэвээр хаалттай — сануулга зөвхөн дууссан сарынх.
    const early = await call(17, 'senior', 'POST', '/approve-month', {
      month: '2026-10',
      status: 'confirmed',
    });
    assert.equal(early.status, 400);
  } finally {
    mock.timers.reset();
  }
});

test('хариулсны ДАРАА ирц засагдвал changed_since_answer + дахин due (reason: changed)', async () => {
  atUbOct1();
  try {
    const { db, call } = setup();
    db.exec(`INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out, hours_worked, late_minutes)
             VALUES (10, '2026-09-10', '2026-09-10T09:00:00+08:00', '2026-09-10T18:00:00+08:00', 8, 0),
                    (11, '2026-09-10', '2026-09-10T09:00:00+08:00', '2026-09-10T18:00:00+08:00', 8, 0)`);
    for (const [sub, role, status] of [
      [10, 'engineer', 'confirmed'],
      [11, 'architect', 'disputed'],
    ] as const) {
      const r = await call(sub, role, 'POST', '/approve-month', { month: '2026-09', status, note: 'x' });
      assert.equal(r.status, 201);
      assert.equal((r.json.confirmation as { changed_since_answer: boolean }).changed_since_answer, false);
      assert.equal('data_fingerprint' in (r.json.confirmation as object), false, 'хээ хариунд гарахгүй');
    }
    assert.deepEqual((await call(10, 'engineer')).json, { due: null });

    // Өөр сарын засвар нөлөөлөхгүй.
    db.exec(`INSERT INTO attendance_sessions (user_id, date, clock_in, hours_worked) VALUES (10, '2026-10-01', '2026-10-01T09:00:00+08:00', 0)`);
    assert.deepEqual((await call(10, 'engineer')).json, { due: null });

    // Админ 9-р сарын гарах цагийг засав + 11-ийн зөрчлийг шийдэж чөлөө батлав.
    db.exec(`UPDATE attendance_sessions SET clock_out = '2026-09-10T17:00:00+08:00', hours_worked = 7
              WHERE user_id = 10 AND date = '2026-09-10'`);
    db.exec(`INSERT INTO leave_requests (user_id, status, leave_type, start_date, end_date, hours, days, is_paid)
             VALUES (11, 'approved', 'annual', '2026-09-12', '2026-09-12', 8, 1, 1)`);
    assert.deepEqual((await call(10, 'engineer')).json, { due: { month: '2026-09', reason: 'changed' } });
    assert.deepEqual((await call(11, 'architect')).json, { due: { month: '2026-09', reason: 'changed' } });

    const mine = (await call(10, 'engineer', 'GET', '/mine')).json.confirmations as Array<{
      date: string;
      changed_since_answer: boolean;
    }>;
    assert.equal(mine.find((r) => r.date === '2026-09-01')?.changed_since_answer, true);

    const ov = (await call(2, 'admin', 'GET', '/overview?month=2026-09')).json.rows as Array<{
      user_id: number;
      changed_since_answer: boolean;
    }>;
    assert.equal(ov.find((r) => r.user_id === 10)?.changed_since_answer, true);
    assert.equal(ov.find((r) => r.user_id === 17)?.changed_since_answer, false);

    // Дахин баталмагц хээ шинэчлэгдэж сануулга алга.
    await call(10, 'engineer', 'POST', '/approve-month', { month: '2026-09', status: 'confirmed' });
    assert.deepEqual((await call(10, 'engineer')).json, { due: null });

    // 0403-аас өмнөх (хээгүй) хариулт хэзээ ч «өөрчлөгдсөн» гэж тооцогдохгүй.
    db.exec(`UPDATE attendance_confirmations SET data_fingerprint = NULL WHERE user_id = 11`);
    assert.deepEqual((await call(11, 'architect')).json, { due: null });
  } finally {
    mock.timers.reset();
  }
});
