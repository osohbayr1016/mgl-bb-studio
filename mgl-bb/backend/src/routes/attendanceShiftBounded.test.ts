/**
 * `buildDailyAttendanceRows` — 2026-10-01-ээс ажилласан цаг ЭЭЛЖИЙН ЦОНХ дотор
 * (эзний шийдвэр, `lib/shiftBoundedHours.ts`), БОДИТ SQLite (node:sqlite + D1
 * shim) дээр.
 *
 * Анхны гомдол: 08:00 ээлжтэй хүн 07:40-д ирээд 16:40-д гарахад цагийн хүснэгт
 * 8ц өгдөг байв (гарсан цагаас үл хамааран «8ц − хоцролт»).  Одоо 7ц40м.
 *
 * Run with:  node --test src/routes/attendanceShiftBounded.test.ts
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

/** node:sqlite дээрх D1 shim (бусад *.test.ts-тэй ижил хэлбэр). */
function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
  });
  return { prepare: (sql: string) => mk(sql) } as unknown as D1Database;
}

const EARLY_USER = 7; // 08:00–17:00
const MID_USER = 8; // 08:30–17:30 (хуваарилалтын түүхээр)
const WORKER = 9; // цэвэрлэгч — цонхгүй
const clock = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE user_work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, schedule TEXT NOT NULL,
      effective_from TEXT NOT NULL, created_by INTEGER
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO app_settings (key, value) VALUES ('lunch_start', '13:00'), ('lunch_end', '14:00');
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
  db.prepare(
    `INSERT INTO user_work_schedules (user_id, schedule, effective_from) VALUES (?, 'mid', '2026-09-01')`,
  ).run(MID_USER);
  // `hours_worked`-ийг ЗОРИУДААР хуучин дүрмээр (бүтэн интервал − цай) бичнэ —
  // deploy-оос өмнө хаагдсан session-ийг дуурайна: хүснэгт интервалаас дахин бодох ёстой.
  const ins = db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out, hours_worked, non_project_credit_hours, late_minutes)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  );
  const add = (user: number, date: string, inT: string, outT: string, hours: number, late = 0) =>
    ins.run(user, date, clock(date, inT), clock(date, outT), hours, late);

  add(EARLY_USER, '2026-09-30', '07:40', '16:40', 8); // 9-р сар — хуучин дүрэм
  add(EARLY_USER, '2026-10-01', '07:40', '16:40', 8); // эзний жишээ 1
  add(EARLY_USER, '2026-10-02', '07:20', '16:57', 8.62); // эзний жишээ 2
  add(EARLY_USER, '2026-10-05', '08:10', '17:30', 8.33, 10); // 10 минут хоцорсон
  add(EARLY_USER, '2026-10-06', '07:00', '19:00', 11); // ээлжээс урт
  add(EARLY_USER, '2026-10-07', '08:00', '17:00', 8); // давхар бүртгэл
  add(EARLY_USER, '2026-10-07', '08:00', '17:00', 0); //   …ихэр (0 цаг)
  add(EARLY_USER, '2026-10-08', '08:00', '11:00', 3); // гараад
  add(EARLY_USER, '2026-10-08', '14:00', '17:00', 3); //   …буцаж орсон
  add(EARLY_USER, '2026-10-09', '08:00', '12:00', 4); // 14:00-ээс чөлөөтэй, 12:00-д гарсан
  db.prepare(
    `INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, start_time, end_time, hours, status)
     VALUES (?, 'unpaid', '2026-10-09', '2026-10-09', '14:00', '17:00', 3, 'approved')`,
  ).run(EARLY_USER);

  // 2026-10-12: 08:00–14:30 чөлөө (цай хассан 330 мин = 5.5ц), 14:30-д ирж 17:00-д гарсан.
  add(EARLY_USER, '2026-10-12', '14:30', '17:00', 2.5, 390);
  db.prepare(
    `INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, start_time, end_time, hours, status)
     VALUES (?, 'unpaid', '2026-10-12', '2026-10-12', '08:00', '14:30', 5.5, 'approved')`,
  ).run(EARLY_USER);

  add(MID_USER, '2026-10-01', '08:00', '17:00', 8); // 08:30-аас тоологдоно
  add(MID_USER, '2026-10-02', '08:25', '17:40', 8.25);
  add(WORKER, '2026-10-01', '10:53', '20:01', 8.13); // ээлжээс хожуу ирж хожуу гарсан
  add(WORKER, '2026-10-02', '10:30', '16:00', 4.5); // эрт гарсан
  return fakeD1(db);
}

const person = (user_id: number, name: string) => ({
  user_id,
  full_name: name,
  employee_id: null,
  profile_image: null,
  position: null,
  work_schedule: 'early' as const,
  team_code: 'BA',
  team_name: 'Архитектур',
});
const roster = [
  person(EARLY_USER, 'Эрт ээлж'),
  person(MID_USER, 'Дунд ээлж'),
  { ...person(WORKER, 'Цэвэрлэгч'), role: 'worker' },
];

async function rowsOf() {
  const { rows } = await buildDailyAttendanceRows(seed(), '2026-09-30', '2026-10-12', roster);
  return (user: number, date: string) => rows.find((r) => r.user_id === user && r.date === date)!;
}

test('эзний жишээ 1: 07:40 ирээд 16:40 гарсан → 7ц40м (өмнө нь 8ц)', async () => {
  const row = await rowsOf();
  const r = row(EARLY_USER, '2026-10-01');
  assert.equal(r.work_minutes, 460);
  assert.equal(r.credited_minutes, 460);
  assert.equal(r.worked_effective_minutes, 460);
  assert.equal(r.late_minutes, 0);
});

test('эзний жишээ 2: 07:20 ирээд 16:57 гарсан → 7ц57м', async () => {
  const row = await rowsOf();
  assert.equal(row(EARLY_USER, '2026-10-02').worked_effective_minutes, 477);
});

test('хоцорсон минут давхар хасагдахгүй; ээлжээс урт ажилласан ч 8ц', async () => {
  const row = await rowsOf();
  const late = row(EARLY_USER, '2026-10-05');
  assert.equal(late.late_minutes, 10);
  assert.equal(late.worked_effective_minutes, 470); // 480 − 10, 470 − 10 БИШ
  assert.equal(row(EARLY_USER, '2026-10-06').worked_effective_minutes, 480);
});

test('давхар бүртгэлийн ихэр нэг удаа, гараад буцаж орсон өдөр нийлнэ', async () => {
  const row = await rowsOf();
  assert.equal(row(EARLY_USER, '2026-10-07').worked_effective_minutes, 480);
  // 08–11 (180) + 14–17 (180); 11:00–14:00 тоологдохгүй.
  assert.equal(row(EARLY_USER, '2026-10-08').worked_effective_minutes, 360);
});

test('чөлөөтэй өдөр: чөлөө эхлэхээс өмнө гарсан хугацаа ч хасагдана', async () => {
  const row = await rowsOf();
  const r = row(EARLY_USER, '2026-10-09');
  assert.equal(r.leave_minutes, 180);
  // Хуучнаар 8ц − чөлөө 3ц = 5ц; одоо 08:00–12:00 = 4ц.
  assert.equal(r.credited_minutes, 240);
  assert.equal(r.worked_effective_minutes, 240);
});

test('08:30–17:30 ээлж өөрийн цонхоор тоологдоно', async () => {
  const row = await rowsOf();
  assert.equal(row(MID_USER, '2026-10-01').worked_effective_minutes, 450); // 08:30–17:00
  assert.equal(row(MID_USER, '2026-10-02').worked_effective_minutes, 480); // 08:30–17:30
});

test('worker (цэвэрлэгч) ээлжийн цонхоор хязгаарлагдахгүй, дээд тал 8ц, эрт гарвал багасна', async () => {
  const row = await rowsOf();
  assert.equal(row(WORKER, '2026-10-01').worked_effective_minutes, 480);
  assert.equal(row(WORKER, '2026-10-02').worked_effective_minutes, 270); // 10:30–16:00 − цай
});

test('9-р сар (2026-10-01-ээс өмнө) хуучин дүрмээрээ — 8ц хэвээр', async () => {
  const row = await rowsOf();
  const r = row(EARLY_USER, '2026-09-30');
  assert.equal(r.work_minutes, 480); // хадгалсан hours_worked
  assert.equal(r.worked_effective_minutes, 480);
});

test('цай дамнасан чөлөө (2026-10-12): чөлөө дууссан цагт ирсэн хүн хоцроогүй, кредит = үлдсэн ажлын цаг', async () => {
  const row = await rowsOf();
  const r = row(EARLY_USER, '2026-10-12');
  assert.equal(r.leave_minutes, 330);
  // Хоцролтын суурь цайг алгасна: 08:00 + 330 ажлын мин = 14:30 (13:30 БИШ).
  assert.equal(r.late_minutes, 0);
  // 8ц − 5.5ц = 2.5ц = 14:30–17:00.
  assert.equal(r.credited_minutes, 150);
});
