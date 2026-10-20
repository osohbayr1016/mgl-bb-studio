/**
 * `lib/dailyAverage.ts` — ажилтны өдрийн дундаж = сүүлийн K АЖИЛЛАСАН өдрийн
 * дундаж: шинэ хүн ажилласан өдрөөрөө, ээлжийн амралтаас ирсэн хүн
 * амралтаас өмнөх хувиасаа үргэлжилнэ (эзний дүрэм 2026-09-28).
 *
 * ⚠️ `workSchedule.ts` өргөтгөлгүй import-тэй тул `registerHooks` resolver
 *    эхлээд (leaveAvailability.test.ts-тэй ижил).
 */
import { test, describe } from 'node:test';
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

const { computeDailyAverage, loadDailyAverages, orgDateOfUtc } = await import('./dailyAverage.ts');
const { addDays, isWeekend } = await import('./workSchedule.ts');

const NONE = new Set<string>();
const near = (a: number | null, b: number, msg?: string) =>
  assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≠ ${b}`);

/** [from, to] мужийн ажлын өдрүүд (баяргүй). */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d)) out.push(d);
  return out;
}

const base = {
  calendarDays: 30,
  joined: '2026-01-05' as string | null,
  leave: undefined as ReadonlySet<string> | undefined,
  holidays: NONE as ReadonlySet<string>,
  openDay: false,
};

// 2026-09-07 = Даваа … 2026-09-11 = Баасан.
describe('шинэ ажилтан — ажилласан өдрөөрөө хуваагдана', () => {
  test('эхний өдөр: тэр өдрийн хувь = өдрийн дундаж', () => {
    const r = computeDailyAverage({
      ...base,
      joined: '2026-09-07',
      to: '2026-09-07',
      openDay: true,
      daily: new Map([['2026-09-07', 1.2]]),
    });
    assert.equal(r.days, 1);
    near(r.avg, 1.2);
    assert.equal(r.sinceJoined, true);
    assert.ok(r.target > 20, 'нэрлэсэн цонх 30 хоног хэвээр');
  });

  test('маргааш нь 2 өдрийн дундаж; өглөө ажиллаагүй байхад өчигдрийнх хэвээр', () => {
    const daily = new Map([['2026-09-07', 1.2]]);
    const morning = computeDailyAverage({ ...base, joined: '2026-09-07', to: '2026-09-08', openDay: true, daily });
    assert.equal(morning.days, 1, 'дуусаагүй, оноогүй өнөөдөр хуваарьт орохгүй');
    near(morning.avg, 1.2, 'өглөө хагас болж унахгүй');
    daily.set('2026-09-08', 0.6);
    const evening = computeDailyAverage({ ...base, joined: '2026-09-07', to: '2026-09-08', openDay: true, daily });
    assert.equal(evening.days, 2);
    near(evening.avg, 0.9);
  });

  test('ажилд орсон өдрөө ажиллаагүй → дундаж алга (null), 0 биш', () => {
    const r = computeDailyAverage({ ...base, joined: '2026-09-07', to: '2026-09-07', openDay: true, daily: new Map() });
    assert.equal(r.days, 0);
    assert.equal(r.avg, null);
  });

  test('ажилд орсноос хойш ажил бүртгээгүй ажлын өдөр 0 болж тоологдоно', () => {
    const r = computeDailyAverage({
      ...base,
      joined: '2026-09-07',
      to: '2026-09-09',
      daily: new Map([['2026-09-07', 0.9]]),
    });
    assert.equal(r.days, 3);
    near(r.avg, 0.3);
  });

  test('Бямба гарагт орсон бол Даваагаас тоолно; амралтын өдрийн оноо нийлбэрт орно', () => {
    const r = computeDailyAverage({
      ...base,
      joined: '2026-09-05',
      to: '2026-09-08',
      daily: new Map([
        ['2026-09-05', 0.4],
        ['2026-09-07', 0.5],
        ['2026-09-08', 0.3],
      ]),
    });
    assert.equal(r.days, 2);
    // Бямбын оноо Даваагаас өмнө тул [from, to]-д орохгүй — хуваарь ч, нийлбэр ч
    // нэг мужаас (Даваа–Мягмар).
    near(r.avg, 0.4);
  });

  test('30+ хоногийн дараа ердийн цонх (K ажлын өдөр), тасалгүй', () => {
    const daily = new Map(weekdays('2026-07-01', '2026-09-11').map((d) => [d, 0.2] as const));
    const r = computeDailyAverage({ ...base, joined: '2026-07-01', to: '2026-09-11', daily });
    assert.equal(r.sinceJoined, false);
    assert.equal(r.days, r.target);
    near(r.avg, 0.2);
  });

  test('`to` нь ажилд орохоос өмнө (нөхөн тооцоолол) → тоологдох өдөргүй', () => {
    const r = computeDailyAverage({ ...base, joined: '2026-09-10', to: '2026-09-08', daily: new Map() });
    assert.equal(r.days, 0);
    assert.equal(r.avg, null);
  });
});

describe('ээлжийн амралт — амралтаас өмнөх хувиасаа үргэлжилнэ', () => {
  // Амралтаас өмнө өдөр бүр ӨӨР утга (тогтмол утга хөлдөлтийг баталдаггүй).
  const before = weekdays('2026-06-01', '2026-09-04');
  const mk = () => new Map(before.map((d, i) => [d, 0.1 + (i % 7) * 0.05] as const));
  const vacation = new Set(weekdays('2026-09-07', '2026-09-11'));

  test('амралтын үеэр дундаж ХӨЛДӨНӨ — амралтын өмнөх өдрийнхтэй яг ижил', () => {
    const daily = mk();
    const lastDay = computeDailyAverage({ ...base, to: '2026-09-04', daily });
    for (const to of ['2026-09-07', '2026-09-09', '2026-09-11', '2026-09-13']) {
      const r = computeDailyAverage({ ...base, to, daily, leave: vacation, openDay: true });
      assert.equal(r.days, lastDay.days, to);
      near(r.avg, lastDay.avg!, to);
    }
  });

  test('ирсэн өдрөөс сүүлийн K ажилласан өдрийн дундаж — амралт 0 болж орохгүй', () => {
    const daily = mk();
    const lastDay = computeDailyAverage({ ...base, to: '2026-09-04', daily });
    daily.set('2026-09-14', 0.9);
    const back = computeDailyAverage({ ...base, to: '2026-09-14', daily, leave: vacation, openDay: true });
    assert.equal(back.days, back.target);
    assert.equal(back.leaveDays, 5);
    // Цонх = ирсэн өдөр + амралтын өмнөх K−1 ажилласан өдөр.
    const prior = before.slice(-(back.target - 1));
    const expected = (0.9 + prior.reduce((s, d) => s + daily.get(d)!, 0)) / back.target;
    near(back.avg, expected);
    // Амралтыг бүртгээгүй бол 5 өдөр 0 болж дундаж унана.
    const naive = computeDailyAverage({ ...base, to: '2026-09-14', daily, openDay: true });
    assert.ok(naive.avg! < back.avg!, `${naive.avg} < ${back.avg}`);
    assert.ok(Math.abs(back.avg! - lastDay.avg!) < 0.1, 'үсрэхгүй, тэндээсээ үргэлжилнэ');
  });

  test('чөлөөтэй өдөр бодитоор ажилласан бол энгийн ажлын өдөр', () => {
    const daily = mk();
    daily.set('2026-09-09', 1.0);
    const r = computeDailyAverage({ ...base, to: '2026-09-11', daily, leave: vacation });
    assert.equal(r.leaveDays, 4);
    assert.equal(r.days, r.target);
  });

  test('шинэ хүн орсон даруйдаа чөлөө авсан — зөвхөн ажилласан өдрүүдэд хуваагдана', () => {
    const r = computeDailyAverage({
      ...base,
      joined: '2026-09-07',
      to: '2026-09-11',
      daily: new Map([
        ['2026-09-07', 0.4],
        ['2026-09-11', 0.2],
      ]),
      leave: new Set(['2026-09-08', '2026-09-09', '2026-09-10']),
    });
    assert.equal(r.days, 2);
    near(r.avg, 0.3);
  });
});

describe('бусад дүрэм', () => {
  test('нийтийн амралтын өдөр хуваарьт орохгүй', () => {
    const daily = new Map(weekdays('2026-06-01', '2026-09-11').map((d) => [d, 0.2] as const));
    const holidays = new Set(['2026-09-09']);
    const r = computeDailyAverage({ ...base, to: '2026-09-11', daily, holidays });
    near(r.avg, (0.2 * r.days + 0.2) / r.days, 'баярын өдөр ажилласан оноо нийлбэрт л орно');
  });

  test('хаалттай `to` (өнгөрсөн өдөр) оноогүй бол 0 өдөр болж тоологдоно', () => {
    const daily = new Map([['2026-09-10', 0.6]]);
    const closed = computeDailyAverage({ ...base, joined: '2026-09-10', to: '2026-09-11', daily });
    near(closed.avg, 0.3);
    const open = computeDailyAverage({ ...base, joined: '2026-09-10', to: '2026-09-11', daily, openDay: true });
    near(open.avg, 0.6);
  });

  test('orgDateOfUtc — UTC агшин → УБ огноо', () => {
    assert.equal(orgDateOfUtc('2026-09-07 17:00:00'), '2026-09-08');
    assert.equal(orgDateOfUtc('2026-09-07 15:59:59'), '2026-09-07');
  });
});

/* ------------------------------------------------------------------ */
/*  Ачаалагч — бодит SQL (node:sqlite)                                 */
/* ------------------------------------------------------------------ */

function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
  });
  return { prepare: (sql: string) => mk(sql) } as unknown as D1Database;
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE user_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount REAL NOT NULL,
      delta_pct REAL NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'progress',
      awarded_at TEXT NOT NULL
    );
    CREATE INDEX idx_user_points_user_date ON user_points(user_id, awarded_at);
    CREATE TABLE leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type TEXT NOT NULL DEFAULT 'annual',
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, days REAL, hours REAL, start_time TEXT,
      status TEXT NOT NULL DEFAULT 'approved'
    );
    CREATE TABLE holidays (date TEXT PRIMARY KEY);
  `);
  return db;
}

/** УБ-ийн тэр өдрийн 12:00 = UTC 04:00. */
function point(db: DatabaseSync, userId: number, date: string, amount: number, source = 'progress') {
  db.exec(`INSERT INTO user_points (user_id, amount, delta_pct, source, awarded_at)
           VALUES (${userId}, ${amount}, ${amount * 10}, '${source}', '${date} 04:00:00')`);
}

describe('loadDailyAverages (real SQL)', () => {
  test('шинэ хүн ба ажилласан хүн нэг дуудлагаар; `through` хаалттай өдөр', async () => {
    const db = freshDb();
    // 1: 2026-06-01-нээс хойш; 2: 2026-09-09-нд орсон (УБ 09:00 = UTC 01:00).
    db.exec(`INSERT INTO users (id, created_at) VALUES (1, '2026-06-01 01:00:00'), (2, '2026-09-09 01:00:00')`);
    for (const d of weekdays('2026-06-01', '2026-09-11')) point(db, 1, d, 0.2);
    point(db, 2, '2026-09-09', 0.6);
    point(db, 2, '2026-09-10', 0.3);
    const avg = await loadDailyAverages(fakeD1(db), { windows: [{ days: 30, userIds: [1, 2] }], through: '2026-09-11' });
    near(avg.get(1)!.avg, 0.2);
    const nu = avg.get(2)!;
    assert.equal(nu.days, 3, 'Лхагва, Пүрэв, Баасан (Баасан 0)');
    near(nu.avg, 0.3);
    assert.equal(avg.get(3), null, 'хүн амд байхгүй');
  });

  test('`asOf` — тэр мөч хүртэлх оноо, тэр өдөр дуусаагүй', async () => {
    const db = freshDb();
    db.exec(`INSERT INTO users (id, created_at) VALUES (1, '2026-09-07 01:00:00')`);
    point(db, 1, '2026-09-07', 1.0);
    point(db, 1, '2026-09-08', 0.2); // 04:00 UTC
    const d1 = fakeD1(db);
    // 09-08 өглөө (UTC 00:30 = УБ 08:30) — өнөөдөр оноогүй → өчигдрийнх
    const morning = await loadDailyAverages(d1, { windows: [{ days: 30, userIds: [1] }], asOf: '2026-09-08 00:30:00' });
    assert.equal(morning.to, '2026-09-08');
    near(morning.get(1)!.avg, 1.0);
    const evening = await loadDailyAverages(d1, { windows: [{ days: 30, userIds: [1] }], asOf: '2026-09-08 10:00:00' });
    near(evening.get(1)!.avg, 0.6);
  });

  test('урт амралт — тусдаа уншигдаж амралтаас өмнөх дундаж; `expr`/`where`', async () => {
    const db = freshDb();
    db.exec(`INSERT INTO users (id, created_at) VALUES (1, '2026-01-05 01:00:00'), (2, '2026-01-05 01:00:00')`);
    for (const d of weekdays('2026-03-02', '2026-09-11')) {
      point(db, 1, d, 0.1);
      if (d >= '2026-07-13') continue; // 2-р хүн 07-13-аас хойш амралтанд
      point(db, 2, d, 0.4);
      point(db, 2, d, 5, 'bonus');
    }
    db.exec(`INSERT INTO leave_requests (user_id, start_date, end_date) VALUES (2, '2026-07-13', '2026-09-11')`);
    const avg = await loadDailyAverages(fakeD1(db), {
      windows: [{ days: 30, userIds: [1, 2] }],
      through: '2026-09-11',
      where: "source = 'progress'",
    });
    near(avg.get(1)!.avg, 0.1);
    const r2 = avg.get(2)!;
    assert.equal(r2.days, r2.target);
    assert.ok(r2.leaveDays >= 40, `${r2.leaveDays}`);
    near(r2.avg, 0.4, 'урт амралтаас өмнөх, bonus-гүй');
    const pct = await loadDailyAverages(fakeD1(db), {
      windows: [{ days: 30, userIds: [2] }, { days: 90, userIds: [1] }],
      through: '2026-09-11',
      expr: 'delta_pct',
      where: "source = 'progress'",
    });
    near(pct.get(2, 0)!.avg, 4);
    near(pct.get(1, 1)!.avg, 1);
    assert.equal(pct.get(1, 0), null);
  });

  test('нийтийн амралт ба цагаар/зайнаас авсан чөлөө', async () => {
    const db = freshDb();
    db.exec(`INSERT INTO users (id, created_at) VALUES (1, '2026-01-05 01:00:00')`);
    for (const d of weekdays('2026-06-01', '2026-09-11')) if (d !== '2026-09-09' && d !== '2026-09-10') point(db, 1, d, 0.3);
    db.exec(`INSERT INTO holidays (date) VALUES ('2026-09-09')`);
    db.exec(`INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, hours, start_time)
             VALUES (1, 'annual', '2026-09-10', '2026-09-10', 2, '09:00')`);
    const avg = await loadDailyAverages(fakeD1(db), { windows: [{ days: 30, userIds: [1] }], through: '2026-09-11' });
    const r = avg.get(1)!;
    // Баяр хуваарьт орохгүй; 2 цагийн чөлөөтэй өдөр ажлын өдөр (0 оноотой) хэвээр.
    near(r.avg, (0.3 * (r.days - 1)) / r.days);
  });
});
