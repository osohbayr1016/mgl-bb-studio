/**
 * `lib/leaveWaiver.ts` — ирц бүртгэлийн ХААЛТЫГ цуцлах чөлөөний дүрэм.
 *
 * Run with:  node --test src/lib/leaveWaiver.test.ts
 *
 * ⚠️ ЯАГААД ЭНЭ ТЕСТ ОРШИН БАЙНА ВЭ (2026-09-09).  «Гарах бүртгэлгүй бол
 *    маргааш ирэх бүртгэл хийхгүй» сахилгын дүрэм (2026-08-26) нь тухайн
 *    өдөр БАТАЛГААЖСАН ЧӨЛӨӨТЭЙ явсан хүнийг ч түгжиж байсан: ажил тарах
 *    мөчид оффист байхгүй хүн гарах бүртгэлээ хийх БОЛОМЖГҮЙ.  Бодит
 *    тохиолдол — 2026-09-07-ны 11:00-17:00 цалингүй чөлөө нь дараагийн
 *    ажлын өдрийн ирц бүртгэлийг хаасан.
 *
 *    Дүрэм нь SQL-д амьдардаг тул тайлбар биш, БОДИТ sqlite дээр
 *    ажиллуулж шалгана (`bimEvents.test.ts`-ийн заншил).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// Апп-ын эх код нь өргөтгөлгүй импорт бичдэг; Node-ийн ESM loader түүнийг
// шийддэггүй.  `webPush.test.ts:18-25`, `bimEvents.test.ts:24-31`-ийн заншил.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { STALE_OPEN_SESSION_SQL, LATE_NOT_WAIVED_SQL } = await import('./leaveWaiver.ts');

const TODAY = '2026-09-09';
const RULE_FROM = '2026-08-26';
const USER = 42;

type Db = InstanceType<typeof DatabaseSync>;

/** Тестийн хамгийн бага схем — предикатын уншдаг багануудаар. */
function makeDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      clock_in TEXT NOT NULL,
      clock_out TEXT
    );
    CREATE TABLE leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE out_of_office_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      status TEXT NOT NULL
    );
  `);
  return db;
}

function openSession(db: Db, date: string, clockIn = '09:03'): void {
  db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out)
     VALUES (?, ?, ?, NULL)`,
  ).run(USER, date, `${date}T${clockIn}:00+08:00`);
}

function leave(
  db: Db,
  o: {
    start: string;
    end?: string;
    status?: string;
    startTime?: string | null;
    endTime?: string | null;
    userId?: number;
  },
): void {
  db.prepare(
    `INSERT INTO leave_requests (user_id, start_date, end_date, start_time, end_time, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    o.userId ?? USER,
    o.start,
    o.end ?? o.start,
    o.startTime ?? null,
    o.endTime ?? null,
    o.status ?? 'approved',
  );
}

function ooo(
  db: Db,
  o: { date: string; status?: string; startTime?: string | null; endTime?: string | null },
): void {
  db.prepare(
    `INSERT INTO out_of_office_requests (user_id, work_date, start_time, end_time, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(USER, o.date, o.startTime ?? null, o.endTime ?? null, o.status ?? 'approved');
}

/** `findStaleOpenSession`-ийн ЯГ тэр bind дараалал. */
function blocking(db: Db): { date: string } | undefined {
  return db.prepare(STALE_OPEN_SESSION_SQL).get(USER, TODAY, RULE_FROM) as
    | { date: string }
    | undefined;
}

test('хаагдаагүй бүртгэл + чөлөөгүй бол ХААЛТ хэвээр', () => {
  const db = makeDb();
  openSession(db, '2026-09-07');
  assert.equal(blocking(db)?.date, '2026-09-07');
  db.close();
});

test('баталгаажсан цагийн мужтай чөлөө ХААЛТЫГ ЦУЦАЛНА (бодит тохиолдол)', () => {
  const db = makeDb();
  openSession(db, '2026-09-07');
  // 11:00-17:00 цалингүй чөлөө — ажилтан тарах үед оффист байгаагүй.
  leave(db, { start: '2026-09-07', startTime: '11:00', endTime: '17:00' });
  assert.equal(blocking(db), undefined);
  db.close();
});

test('бүтэн өдрийн чөлөө ХААЛТЫГ ЦУЦАЛНА', () => {
  const db = makeDb();
  openSession(db, '2026-09-07');
  leave(db, { start: '2026-09-07' });
  assert.equal(blocking(db), undefined);
  db.close();
});

test('олон өдрийн чөлөөний ДУНД өдөр ч цуцлагдана', () => {
  const db = makeDb();
  openSession(db, '2026-09-02');
  leave(db, { start: '2026-09-01', end: '2026-09-04' });
  assert.equal(blocking(db), undefined);
  db.close();
});

test('pending / rejected / cancelled чөлөө ЦУЦЛАХГҮЙ', () => {
  for (const status of ['pending', 'rejected', 'cancelled']) {
    const db = makeDb();
    openSession(db, '2026-09-07');
    leave(db, { start: '2026-09-07', status });
    assert.equal(blocking(db)?.date, '2026-09-07', `status=${status}`);
    db.close();
  }
});

test('ӨӨР ӨДРИЙН чөлөө ЦУЦЛАХГҮЙ', () => {
  const db = makeDb();
  openSession(db, '2026-09-07');
  leave(db, { start: '2026-09-04' });
  assert.equal(blocking(db)?.date, '2026-09-07');
  db.close();
});

test('ӨӨР ХҮНИЙ чөлөө ЦУЦЛАХГҮЙ', () => {
  const db = makeDb();
  openSession(db, '2026-09-07');
  leave(db, { start: '2026-09-07', userId: USER + 1 });
  assert.equal(blocking(db)?.date, '2026-09-07');
  db.close();
});

test('бүтэн өдрийн гадуур ажил цуцална, цагийн мужтай нь ЦУЦЛАХГҮЙ', () => {
  const full = makeDb();
  openSession(full, '2026-09-07');
  ooo(full, { date: '2026-09-07' });
  assert.equal(blocking(full), undefined);
  full.close();

  const ranged = makeDb();
  openSession(ranged, '2026-09-07');
  // 14:00-16:00 гадуур ажил — тарахдаа оффист буцаж ирсэн байх ёстой.
  ooo(ranged, { date: '2026-09-07', startTime: '14:00', endTime: '16:00' });
  assert.equal(blocking(ranged)?.date, '2026-09-07');
  ranged.close();
});

test('чөлөөтэй өдөр АЛГАСАГДАЖ, чөлөөгүй ДАРААГИЙН өдөр хаана', () => {
  const db = makeDb();
  openSession(db, '2026-09-02');
  openSession(db, '2026-09-07');
  leave(db, { start: '2026-09-02' });
  assert.equal(blocking(db)?.date, '2026-09-07');
  db.close();
});

test('хаагдсан (clock_out бөглөгдсөн) бүртгэл ХЭЗЭЭ Ч хаахгүй', () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out)
     VALUES (?, ?, ?, ?)`,
  ).run(USER, '2026-09-07', '2026-09-07T09:00:00+08:00', '2026-09-07T18:00:00+08:00');
  assert.equal(blocking(db), undefined);
  db.close();
});

test('ДАВХАР clock-in-ийн үлдэгдэл (ижил clock_in-тэй хаагдсан ихэртэй) хаахгүй — прод 4407/4408', () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out)
     VALUES (?, ?, ?, ?)`,
  ).run(USER, '2026-09-07', '2026-09-07T08:04:51+08:00', '2026-09-07T17:13:40+08:00');
  openSession(db, '2026-09-07', '08:04');
  // Секунд хүртэл ижил байх ёстой — helper нь :00 өгдөг тул шууд бичнэ.
  db.prepare(`UPDATE attendance_sessions SET clock_in = ? WHERE clock_out IS NULL`).run(
    '2026-09-07T08:04:51+08:00',
  );
  assert.equal(blocking(db), undefined);
  db.close();
});

test('үдэд гараад орой мартсан (ӨӨР clock_in) бол ХААЛТ хэвээр', () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out)
     VALUES (?, ?, ?, ?)`,
  ).run(USER, '2026-09-07', '2026-09-07T08:00:00+08:00', '2026-09-07T12:30:00+08:00');
  openSession(db, '2026-09-07', '13:30');
  assert.equal(blocking(db)?.date, '2026-09-07');
  db.close();
});

test('дүрэм хүчин төгөлдөр болохоос ӨМНӨХ өв мөр хаахгүй', () => {
  const db = makeDb();
  openSession(db, '2026-08-20');
  assert.equal(blocking(db), undefined);
  db.close();
});

test('ӨНӨӨДРИЙН нээлттэй session хаалт үүсгэхгүй (clock-in доторх өөр 409 барина)', () => {
  const db = makeDb();
  openSession(db, TODAY);
  assert.equal(blocking(db), undefined);
  db.close();
});

test('чөлөөний дүрэм хоцролтын waiver-тай НЭГ ижил хэлбэртэй байх', () => {
  // Хоёр предикат чөлөөг ЦАГААС ҮЛ ХАМААРУУЛЖ хардаг нь санаатай — нэг өдрийн
  // чөлөөг нэгээр нь хөнгөлөөд нөгөөгөөр торгож болохгүй.  Хэлбэр зөрвөл энд
  // барина (`LATE_NOT_WAIVED_SQL`-д цагийн нөхцөл нэмбэл заавал дахин бодох).
  const leaveClause = 'lr.start_date <= a.date AND lr.end_date >= a.date';
  assert.ok(LATE_NOT_WAIVED_SQL.includes(leaveClause));
  assert.ok(STALE_OPEN_SESSION_SQL.includes(leaveClause));
});
