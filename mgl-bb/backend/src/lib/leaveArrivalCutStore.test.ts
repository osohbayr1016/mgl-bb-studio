/**
 * `lib/leaveArrivalCutStore.ts` — ирцтэй чөлөөний богиносголтыг тааруулах
 * sync, БОДИТ миграц 0364 дээр (node:sqlite + D1 shim).
 *
 * Run with:  node --test src/lib/leaveArrivalCutStore.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { syncLeaveArrivalCuts, syncLeaveArrivalCutsForLeave } = await import('./leaveArrivalCutStore.ts');

/** node:sqlite дээрх D1 shim — `batch` нь нэг transaction-д. */
function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    __sql: sql,
    __args: args,
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } } as never;
    },
  });
  return {
    prepare: (sql: string) => mk(sql),
    batch: async (stmts: Array<{ __sql: string; __args: unknown[] }>) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => db.prepare(s.__sql).run(...(s.__args as never[])));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

const USER = 7;
const DAY = '2026-09-29'; // Мягмар, зуны албадлагаас гадуур

function freshDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, work_schedule TEXT);
    INSERT INTO users (id, role, work_schedule) VALUES (${USER}, 'engineer', 'early');
    CREATE TABLE user_work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, schedule TEXT NOT NULL,
      effective_from TEXT NOT NULL, created_by INTEGER
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE holidays (date TEXT PRIMARY KEY);
    CREATE TABLE attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL,
      clock_in TEXT NOT NULL, clock_out TEXT
    );
    -- 0028 + 0029 + 0051 + 0086 + 0100 + 0102-ийн баганууд (0364-ийн өмнөх хэлбэр).
    CREATE TABLE leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      leave_type TEXT NOT NULL DEFAULT 'annual',
      start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      days REAL NOT NULL DEFAULT 1, reason TEXT, attachment_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer_id INTEGER, reviewer_note TEXT, decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      hours REAL, start_time TEXT, end_time TEXT, reason_code TEXT, is_paid INTEGER,
      cancelled_by INTEGER, cancelled_at TEXT, cancel_note TEXT, created_by INTEGER
    );
  `);
  db.exec(readFileSync(new URL('../../migrations/0364_leave_arrival_cut.sql', import.meta.url), 'utf8'));
  return { db, d1: fakeD1(db) };
}

function addLeave(
  db: DatabaseSync,
  l: { start: string; end?: string; st?: string | null; et?: string | null; hours: number; days: number; status?: string; type?: string },
): number {
  const r = db
    .prepare(
      `INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, start_time, end_time, hours, days, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(USER, l.type ?? 'unpaid', l.start, l.end ?? l.start, l.st ?? null, l.et ?? null, l.hours, l.days, l.status ?? 'approved');
  return Number(r.lastInsertRowid);
}
function clockIn(db: DatabaseSync, date: string, hhmm: string): number {
  const r = db
    .prepare(`INSERT INTO attendance_sessions (user_id, date, clock_in) VALUES (?, ?, ?)`)
    .run(USER, date, `${date}T${hhmm}:00+08:00`);
  return Number(r.lastInsertRowid);
}
const leaveRow = (db: DatabaseSync, id: number) => ({
  ...(db
    .prepare(
      `SELECT start_time, end_time, hours, days, arrival_orig_start_time AS o_st, arrival_orig_end_time AS o_et,
              arrival_orig_hours AS o_h, arrival_orig_days AS o_d
         FROM leave_requests WHERE id = ?`,
    )
    .get(id) as Record<string, unknown>),
});
const cuts = (db: DatabaseSync) =>
  db.prepare(`SELECT leave_id, date, arrival, start_time, end_time, full_minutes, used_minutes FROM leave_arrival_cuts ORDER BY date`).all() as Record<string, unknown>[];

test('эзний жишээ: 08:00–12:00 → 09:00-д ирсэн → 08:00–09:00, анхны утга хадгалагдана', async () => {
  const { db, d1 } = freshDb();
  const id = addLeave(db, { start: DAY, st: '08:00', et: '12:00', hours: 4, days: 0.5 });
  clockIn(db, DAY, '09:00');
  const res = await syncLeaveArrivalCuts(d1, USER, DAY);
  assert.equal(res.length, 1);
  assert.equal(res[0]!.changed, true);
  assert.deepEqual(leaveRow(db, id), {
    start_time: '08:00', end_time: '09:00', hours: 1, days: 0.13,
    o_st: '08:00', o_et: '12:00', o_h: 4, o_d: 0.5,
  });
  assert.equal(cuts(db)[0]!.used_minutes, 60);
  // Идемпотент: дахин дуудахад юу ч өөрчлөгдөхгүй.
  const again = await syncLeaveArrivalCuts(d1, USER, DAY);
  assert.equal(again[0]!.changed, false);
  assert.equal(cuts(db).length, 1);
});

test('ирц устгагдвал чөлөө анхны хэмжээндээ буцна, тэмдэг арилна', async () => {
  const { db, d1 } = freshDb();
  const id = addLeave(db, { start: DAY, st: '08:00', et: '12:00', hours: 4, days: 0.5 });
  const sid = clockIn(db, DAY, '09:30');
  await syncLeaveArrivalCuts(d1, USER, DAY);
  assert.equal(leaveRow(db, id).hours, 1.5);
  db.prepare(`DELETE FROM attendance_sessions WHERE id = ?`).run(sid);
  await syncLeaveArrivalCuts(d1, USER, DAY);
  assert.deepEqual(leaveRow(db, id), {
    start_time: '08:00', end_time: '12:00', hours: 4, days: 0.5,
    o_st: null, o_et: null, o_h: null, o_d: null,
  });
  assert.equal(cuts(db).length, 0);
});

test('ирсэн цаг засагдвал (upsert) АНХНЫ утгаас дахин тооцно', async () => {
  const { db, d1 } = freshDb();
  const id = addLeave(db, { start: DAY, st: '08:00', et: '12:00', hours: 4, days: 0.5 });
  const sid = clockIn(db, DAY, '09:00');
  await syncLeaveArrivalCuts(d1, USER, DAY);
  db.prepare(`UPDATE attendance_sessions SET clock_in = ? WHERE id = ?`).run(`${DAY}T10:30:00+08:00`, sid);
  await syncLeaveArrivalCuts(d1, USER, DAY);
  const row = leaveRow(db, id);
  assert.equal(row.end_time, '10:30');
  assert.equal(row.hours, 2.5);
  assert.equal(row.o_et, '12:00');
  // Чөлөө дууссаны дараах цаг руу засвал бүтэн чөлөө буцна.
  db.prepare(`UPDATE attendance_sessions SET clock_in = ? WHERE id = ?`).run(`${DAY}T12:20:00+08:00`, sid);
  await syncLeaveArrivalCuts(d1, USER, DAY);
  assert.equal(leaveRow(db, id).hours, 4);
  assert.equal(leaveRow(db, id).o_d, null);
});

test('өдрийн анхны ирэлт л тоологдоно (дахин орсон session хамаагүй)', async () => {
  const { db, d1 } = freshDb();
  const id = addLeave(db, { start: DAY, st: '08:00', et: '12:00', hours: 4, days: 0.5 });
  clockIn(db, DAY, '11:00');
  clockIn(db, DAY, '09:15');
  await syncLeaveArrivalCuts(d1, USER, DAY);
  assert.equal(leaveRow(db, id).end_time, '09:15');
});

test('батлагдаагүй / цуцлагдсан чөлөө хөндөгдөхгүй', async () => {
  const { db, d1 } = freshDb();
  const pending = addLeave(db, { start: DAY, st: '08:00', et: '12:00', hours: 4, days: 0.5, status: 'pending' });
  const cancelled = addLeave(db, { start: DAY, st: '08:00', et: '12:00', hours: 4, days: 0.5, status: 'cancelled' });
  clockIn(db, DAY, '09:00');
  assert.deepEqual(await syncLeaveArrivalCuts(d1, USER, DAY), []);
  assert.equal(leaveRow(db, pending).hours, 4);
  assert.equal(leaveRow(db, cancelled).hours, 4);
  // Батлагдмагц (`decide`) аль хэдийн ирсэн өдөр богиносно.
  db.prepare(`UPDATE leave_requests SET status = 'approved' WHERE id = ?`).run(pending);
  await syncLeaveArrivalCutsForLeave(d1, pending);
  assert.equal(leaveRow(db, pending).hours, 1);
  assert.equal(leaveRow(db, cancelled).hours, 4);
});

test('олон хоногийн чөлөө: зөвхөн ирсэн өдрүүд, цаг хэвээр, нийт hours/days багасна', async () => {
  const { db, d1 } = freshDb();
  // Даваа 09-28 — Баасан 10-02: 5 хоног, 40 цаг.
  const id = addLeave(db, { start: '2026-09-28', end: '2026-10-02', hours: 40, days: 5, type: 'annual' });
  clockIn(db, '2026-09-30', '09:00');
  clockIn(db, '2026-10-01', '07:58');
  await syncLeaveArrivalCuts(d1, USER, '2026-09-30');
  await syncLeaveArrivalCuts(d1, USER, '2026-10-01');
  assert.deepEqual(leaveRow(db, id), {
    start_time: null, end_time: null, hours: 25, days: 3.13,
    o_st: null, o_et: null, o_h: 40, o_d: 5,
  });
  assert.deepEqual(
    cuts(db).map((c) => [c.date, c.used_minutes]),
    [['2026-09-30', 60], ['2026-10-01', 0]],
  );
});

test('амралтын өдөр ирсэн бол чөлөө хөндөгдөхгүй', async () => {
  const { db, d1 } = freshDb();
  db.exec(`INSERT INTO holidays (date) VALUES ('${DAY}')`);
  const id = addLeave(db, { start: DAY, hours: 8, days: 1 });
  clockIn(db, DAY, '09:00');
  await syncLeaveArrivalCuts(d1, USER, DAY);
  assert.equal(leaveRow(db, id).hours, 8);
  assert.equal(cuts(db).length, 0);
});

test('ирц ирээдүйд биш — батлах үед зөвхөн өнөөдөр хүртэлх ирцтэй өдрүүд', async () => {
  const { db, d1 } = freshDb();
  const id = addLeave(db, { start: '2020-01-06', hours: 8, days: 1 });
  clockIn(db, '2020-01-06', '10:00');
  await syncLeaveArrivalCutsForLeave(d1, id);
  assert.equal(leaveRow(db, id).hours, 2);
  assert.equal(leaveRow(db, id).start_time, '08:00');
});
