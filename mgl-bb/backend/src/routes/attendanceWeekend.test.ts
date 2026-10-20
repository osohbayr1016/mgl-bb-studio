/**
 * `buildDailyAttendanceRows` — Бямба/Ням өдөр цагт ТООЦОГДОХГҮЙ (эзний шийдвэр
 * 2026-10-01), БОДИТ SQLite (node:sqlite + D1 shim) дээр.
 *
 * Анхны гэмтэл: Батзориг А. (BB, 2026-09) 22 ажлын өдөр бүгдэд ирсэн, 9/26 + 9/27
 * (Бя/Ня) зохиогчийн хяналтаар гадуур ажил 2.00 ц → цагийн хүснэгтэд 2 нэмэлт мөр
 * болж «24 өдөр · 22 ирсэн» харагдаж, нийт цаг 4 ц-аар хөөрөгддөг байв.
 *
 * Run with:  node --test src/routes/attendanceWeekend.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

const { buildDailyAttendanceRows } = await import('./attendance.ts');
const { countAttendanceDays } = await import('../lib/attendanceDayCount.ts');

/** node:sqlite дээрх D1 shim (бусад *.test.ts-тэй ижил хэлбэр). */
function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
  });
  return { prepare: (sql: string) => mk(sql) } as unknown as D1Database;
}

const USER = 7;
const FROM = '2026-09-01';
const TO = '2026-09-30';
const HOLIDAY = '2026-09-10'; // Пүрэв — нийтийн баярын өдөр (туршилтын)

/** 2026-09-ийн Дав–Баа өдрүүд (22). */
function septWeekdays(): string[] {
  const out: string[] = [];
  for (let d = new Date(`${FROM}T00:00:00Z`); d <= new Date(`${TO}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function seed(opts: { weekendSession?: boolean; weekendOoo?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE user_work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, schedule TEXT NOT NULL,
      effective_from TEXT NOT NULL, created_by INTEGER
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE holidays (date TEXT PRIMARY KEY);
    CREATE TABLE attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL,
      clock_in TEXT NOT NULL, clock_out TEXT,
      hours_worked REAL, non_project_credit_hours REAL, late_minutes INTEGER
    );
    CREATE TABLE leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, start_time TEXT, end_time TEXT,
      reason TEXT, hours REAL, status TEXT NOT NULL DEFAULT 'pending',
      arrival_orig_hours REAL, arrival_orig_days REAL, is_paid INTEGER
    );
    CREATE TABLE leave_arrival_cuts (
      leave_id INTEGER NOT NULL, user_id INTEGER NOT NULL, date TEXT NOT NULL, used_minutes INTEGER NOT NULL
    );
    CREATE TABLE out_of_office_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, work_date TEXT NOT NULL,
      hours REAL, start_time TEXT, end_time TEXT, status TEXT NOT NULL DEFAULT 'pending'
    );
  `);
  const ins = db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out, hours_worked, non_project_credit_hours, late_minutes)
     VALUES (?, ?, ?, ?, ?, 0, 0)`,
  );
  const clock = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
  for (const date of septWeekdays()) {
    if (date === HOLIDAY) ins.run(USER, date, clock(date, '09:00'), clock(date, '14:00'), 5); // баярт 5 ц ажилласан
    else ins.run(USER, date, clock(date, '08:00'), clock(date, '17:00'), 8);
  }
  db.prepare('INSERT INTO holidays (date) VALUES (?)').run(HOLIDAY);
  if (opts.weekendSession) ins.run(USER, '2026-09-20', clock('2026-09-20', '10:00'), clock('2026-09-20', '16:00'), 6);
  if (opts.weekendOoo) {
    const o = db.prepare(
      `INSERT INTO out_of_office_requests (user_id, work_date, hours, status) VALUES (?, ?, 2, 'approved')`,
    );
    o.run(USER, '2026-09-26'); // Бямба — зохиогчийн хяналт
    o.run(USER, '2026-09-27'); // Ням
  }
  return fakeD1(db);
}

const roster = [
  {
    user_id: USER,
    full_name: 'Батзориг Амар',
    employee_id: null,
    profile_image: null,
    position: null,
    work_schedule: 'early' as const,
    team_code: 'BB',
    team_name: 'Барилга бүтээц',
  },
];

test('Бя/Ня гадуур ажил (зохиогчийн хяналт) мөр үүсгэхгүй, цагт тоологдохгүй', async () => {
  const { rows, workingDays } = await buildDailyAttendanceRows(seed({ weekendOoo: true }), FROM, TO, roster);
  const dates = rows.map((r) => r.date);
  assert.equal(rows.length, 22, 'зөвхөн 22 Дав–Баа өдөр');
  assert.ok(!dates.includes('2026-09-26') && !dates.includes('2026-09-27'));
  assert.ok(rows.every((r) => !r.is_rest_day));
  assert.equal(rows.reduce((s, r) => s + r.out_of_office_minutes, 0), 0, 'Бя/Ня-ийн гадуур ажлын 4 ц орохгүй');
  // 21 ердийн өдөр × 8 ц + баярт 5 ц (бодит цагаар).
  assert.equal(rows.reduce((s, r) => s + r.worked_effective_minutes, 0), 21 * 480 + 5 * 60);
  assert.equal(workingDays, 21, 'баярын өдөр хүлээгдэх өдрөөс хасагдана');
});

test('Бямба гараар ирц бүртгэсэн ч мөр үүсэхгүй, цагт тоологдохгүй', async () => {
  const { rows } = await buildDailyAttendanceRows(seed({ weekendSession: true }), FROM, TO, roster);
  assert.equal(rows.length, 22);
  assert.ok(!rows.some((r) => r.date === '2026-09-20'));
  assert.equal(rows.reduce((s, r) => s + r.worked_effective_minutes, 0), 21 * 480 + 5 * 60);
});

test('Бя/Ням ажилласан хүн ба ажиллаагүй хүн цагийн хувьд ЯГ ижил', async () => {
  const none = await buildDailyAttendanceRows(seed(), FROM, TO, roster);
  const both = await buildDailyAttendanceRows(seed({ weekendSession: true, weekendOoo: true }), FROM, TO, roster);
  assert.deepEqual(both.rows, none.rows);
});

test('нийтийн баярын өдөр МӨР хэвээр, бодит цагаараа тоологдоно (зөвхөн Бя/Ня хасагдсан)', async () => {
  const { rows } = await buildDailyAttendanceRows(seed({ weekendOoo: true }), FROM, TO, roster);
  const h = rows.find((r) => r.date === HOLIDAY)!;
  assert.equal(h.is_holiday, true);
  assert.equal(h.worked_effective_minutes, 300);
  const c = countAttendanceDays(rows);
  assert.deepEqual(c, { present_days: 21, extra_days: 1 }); // 21 ажлын өдөр ирсэн, 1 баярт ажилласан
});
