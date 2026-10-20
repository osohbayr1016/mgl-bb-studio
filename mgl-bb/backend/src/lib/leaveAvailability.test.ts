/**
 * `lib/leaveAvailability.ts` — батлагдсан чөлөө бүтээмжийн хувийг ӨСГӨХГҮЙ,
 * БУУРУУЛАХГҮЙ: цонх нь хүний сүүлийн K АЖИЛЛАСАН өдөр.
 *
 * ⚠️ `workSchedule.ts` өргөтгөлгүй import-тэй тул `registerHooks` resolver
 *    эхлээд (workSchedule.test.ts-тэй ижил).
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

const { isFullDayLeave, workingDates, leaveDatesByUser, workedWindow, windowSum, loadLeaveNeutral } = await import(
  './leaveAvailability.ts'
);
const { addDays, isWeekend } = await import('./workSchedule.ts');

type Row = Parameters<typeof leaveDatesByUser>[0][number];
const row = (p: Partial<Row> & Pick<Row, 'user_id' | 'start_date' | 'end_date'>): Row => ({
  leave_type: 'annual',
  days: null,
  hours: null,
  start_time: null,
  ...p,
});

// 2026-09-07 = Даваа … 2026-09-13 = Ням.
const WEEK = { from: '2026-09-07', to: '2026-09-13' };
const NONE = new Set<string>();
const dates = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

describe('isFullDayLeave', () => {
  test('multi-day → full; single day ≥ 8 h (or legacy days=1, hours NULL) → full', () => {
    assert.equal(isFullDayLeave(row({ user_id: 1, start_date: '2026-09-07', end_date: '2026-09-09', days: 3, hours: 24 })), true);
    assert.equal(isFullDayLeave(row({ user_id: 1, start_date: '2026-09-07', end_date: '2026-09-07', days: 1, hours: 8 })), true);
    assert.equal(isFullDayLeave(row({ user_id: 1, start_date: '2026-09-07', end_date: '2026-09-07', days: 1 })), true);
  });
  test('sub-day leave (time range, or < 8 h) is NOT a leave day — the person worked that day', () => {
    assert.equal(
      isFullDayLeave(row({ user_id: 1, start_date: '2026-09-07', end_date: '2026-09-07', days: 0.25, hours: 2, start_time: '09:00' })),
      false,
    );
    assert.equal(isFullDayLeave(row({ user_id: 1, start_date: '2026-09-07', end_date: '2026-09-07', days: 0.13, hours: 1 })), false);
    assert.equal(isFullDayLeave(row({ user_id: 1, start_date: '2026-09-07', end_date: '2026-09-07', days: 0.5 })), false);
  });
  test('remote (зайнаас ажиллах) is a working day, not leave', () => {
    assert.equal(isFullDayLeave(row({ user_id: 1, start_date: '2026-09-07', end_date: '2026-09-11', leave_type: 'remote' })), false);
  });
});

describe('workingDates / leaveDatesByUser', () => {
  test('Mon–Fri minus holidays', () => {
    assert.deepEqual(workingDates(WEEK, NONE), ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
    assert.equal(workingDates(WEEK, new Set(['2026-09-09'])).length, 4);
  });
  test('weekends / holidays inside a leave are not leave days; overlaps count once; clipped to the range', () => {
    const m = leaveDatesByUser(
      [
        row({ user_id: 1, start_date: '2026-09-11', end_date: '2026-09-15' }),
        row({ user_id: 2, start_date: '2026-09-07', end_date: '2026-09-09' }),
        row({ user_id: 2, start_date: '2026-09-08', end_date: '2026-09-10' }),
        row({ user_id: 3, start_date: '2026-09-08', end_date: '2026-09-08', hours: 2, start_time: '09:00' }),
      ],
      WEEK,
      new Set(['2026-09-10']),
    );
    assert.deepEqual([...m.get(1)!], ['2026-09-11']);
    assert.deepEqual([...m.get(2)!].sort(), ['2026-09-07', '2026-09-08', '2026-09-09']);
    assert.equal(m.has(3), false);
  });
});

describe('workedWindow — replace each leave working day with one earlier working day', () => {
  test('no leave → the nominal window, nothing skipped', () => {
    assert.deepEqual(workedWindow(WEEK, new Set(), NONE), { ...WEEK, skip: new Set(), leaveDays: 0, complete: true });
    assert.deepEqual(workedWindow(WEEK, undefined, NONE).from, WEEK.from);
  });
  test('one leave day (Wed) → the window reaches back to the previous Friday, the weekend in between is not counted', () => {
    const w = workedWindow(WEEK, new Set(['2026-09-09']), NONE);
    assert.equal(w.from, '2026-09-04');
    assert.equal(w.leaveDays, 1);
    assert.deepEqual([...w.skip].sort(), ['2026-09-05', '2026-09-06', '2026-09-09']);
    const counted = dates(w.from, w.to).filter((d) => !w.skip.has(d) && !isWeekend(d));
    assert.equal(counted.length, 5, 'still exactly 5 working days');
  });
  test('whole week on leave → the previous week stands in for it', () => {
    const w = workedWindow(WEEK, new Set(dates('2026-09-07', '2026-09-11')), NONE);
    assert.equal(w.from, '2026-08-31');
    assert.deepEqual(
      dates(w.from, w.to).filter((d) => !w.skip.has(d)),
      ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-12', '2026-09-13'],
    );
  });
  test('earlier leave inside the extension is skipped too; holidays are never "leave"', () => {
    const w = workedWindow(WEEK, new Set(['2026-09-09', '2026-09-04']), new Set(['2026-09-10']));
    assert.equal(w.leaveDays, 1);
    assert.equal(w.from, '2026-09-03');
    assert.ok(w.skip.has('2026-09-04'));
  });
  test('lookback cap → complete = false (never loops forever)', () => {
    const leave = new Set(dates('2025-01-01', '2026-09-13'));
    const w = workedWindow(WEEK, leave, NONE, 30);
    assert.equal(w.complete, false);
    assert.equal(w.from, addDays(WEEK.from, -30));
  });
  test('windowSum skips the skipped dates', () => {
    const daily = new Map([
      ['2026-09-04', 1],
      ['2026-09-05', 7],
      ['2026-09-08', 2],
      ['2026-09-09', 9],
    ]);
    assert.equal(windowSum(daily, workedWindow(WEEK, new Set(['2026-09-09']), NONE)), 3);
    assert.equal(windowSum(daily, WEEK), 11);
  });
});

/**
 * ЭЗНИЙ ДҮРЭМ — «чөлөө авлаа гээд хувь нэмэгдэх, хасагдах ёсгүй, өмнө ямар
 * байсан тэндээсээ үргэлжилнэ»: ажилласан өдрийн цонхны нийлбэр нь ЯГ
 * «чөлөөт өдрүүд хуанлиас хасагдсан» мэт — сүүлийн K ажилласан өдрийн оноо.
 */
describe('owner rule: leave never moves the percentage', () => {
  // Ажлын өдөр бүр өөр оноо (детерминист «санамсаргүй»), амралтын өдөр 0.
  const pointsOf = (d: string) => (isWeekend(d) ? 0 : ((Number(d.slice(8, 10)) * 37 + Number(d.slice(5, 7)) * 11) % 17) / 10 + 0.1);
  const all = dates('2026-05-01', '2026-10-31');
  const leave = new Set(dates('2026-08-10', '2026-08-21').filter((d) => !isWeekend(d))); // 10 ажлын өдөр
  const daily = new Map(all.map((d) => [d, leave.has(d) ? 0 : pointsOf(d)] as const));
  const workedDaysBefore = (end: string) => all.filter((d) => d <= end && !isWeekend(d) && !leave.has(d));

  for (const days of [7, 30]) {
    test(`${days}-day window = exactly the last K worked days (+ the nominal weekend), every day during and after the leave`, () => {
      for (let end = '2026-08-10'; end <= '2026-09-30'; end = addDays(end, 1)) {
        const nominal = { from: addDays(end, -(days - 1)), to: end };
        const k = workingDates(nominal, NONE).length;
        const w = workedWindow(nominal, leave, NONE);
        const expected = workedDaysBefore(end).slice(-k).reduce((s, d) => s + pointsOf(d), 0);
        assert.ok(Math.abs(windowSum(daily, w) - expected) < 1e-9, `${days}d @ ${end}`);
      }
    });
  }

  test('7-day value is FROZEN during the leave at its pre-leave level (naive calendar window collapses to 0)', () => {
    const before = windowSum(daily, workedWindow({ from: '2026-08-01', to: '2026-08-07' }, leave, NONE));
    for (let end = '2026-08-10'; end <= '2026-08-21'; end = addDays(end, 1)) {
      const nominal = { from: addDays(end, -6), to: end };
      assert.ok(Math.abs(windowSum(daily, workedWindow(nominal, leave, NONE)) - before) < 1e-9, end);
    }
    assert.equal(windowSum(daily, { from: '2026-08-15', to: '2026-08-21' }), 0, 'old behaviour: 0 during leave');
  });

  test('a person at a constant pace scores the same as a coworker at that pace who never took leave', () => {
    const flat = new Map(all.map((d) => [d, isWeekend(d) || leave.has(d) ? 0 : 1] as const));
    const coworker = new Map(all.map((d) => [d, isWeekend(d) ? 0 : 1] as const));
    for (let end = '2026-08-10'; end <= '2026-09-30'; end = addDays(end, 1)) {
      const nominal = { from: addDays(end, -29), to: end };
      assert.equal(windowSum(flat, workedWindow(nominal, leave, NONE)), windowSum(coworker, nominal), end);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Ачаалагч — бодит SQL (node:sqlite)                                 */
/* ------------------------------------------------------------------ */

function fakeD1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => {
      let args: unknown[] = [];
      const s = {
        bind: (...a: unknown[]) => ((args = a), s),
        all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
      };
      return s;
    },
  } as unknown as D1Database;
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE leave_requests (
      id INTEGER PRIMARY KEY, user_id INTEGER, leave_type TEXT, start_date TEXT, end_date TEXT,
      days REAL, hours REAL, start_time TEXT, status TEXT
    );
    CREATE TABLE holidays (date TEXT PRIMARY KEY);
    CREATE TABLE user_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, source TEXT DEFAULT 'progress',
      awarded_at TEXT
    );
  `);
  return db;
}
/** УБ-ийн өдрийн 12:00 = UTC 04:00. */
const at = (d: string) => `${d} 04:00:00`;

describe('loadLeaveNeutral (real SQL)', () => {
  test('only approved leave counts; delta = worked-day window − calendar window; no leave → 0', async () => {
    const db = freshDb();
    db.exec(`
      INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, days, hours, start_time, status) VALUES
        (1, 'annual', '2026-09-07', '2026-09-11', 5, 40, NULL, 'approved'),
        (2, 'annual', '2026-09-07', '2026-09-11', 5, 40, NULL, 'pending'),
        (3, 'annual', '2026-09-07', '2026-09-11', 5, 40, NULL, 'rejected'),
        (4, 'annual', '2026-09-07', '2026-09-11', 5, 40, NULL, 'cancelled');
    `);
    for (const u of [1, 2, 3, 4, 5])
      for (const d of dates('2026-08-31', '2026-09-04')) db.exec(`INSERT INTO user_points (user_id, amount, awarded_at) VALUES (${u}, 0.5, '${at(d)}')`);
    const n = await loadLeaveNeutral(fakeD1(db), { ranges: [WEEK] });
    // user 1: whole week off → the previous week's 5 × 0.5 stands in (calendar week = 0)
    assert.equal(n.leaveDays(1, 0), 5);
    assert.ok(Math.abs(n.delta(1, 0) - 2.5) < 1e-9, `${n.delta(1, 0)}`);
    for (const u of [2, 3, 4, 5]) {
      assert.equal(n.delta(u, 0), 0, `user ${u}`);
      assert.equal(n.leaveDays(u, 0), 0, `user ${u}`);
    }
  });

  test('a leave day on which the person actually earned points is an ordinary working day', async () => {
    const db = freshDb();
    db.exec(`INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, days, hours, start_time, status)
             VALUES (1, 'annual', '2026-09-09', '2026-09-09', 1, 8, NULL, 'approved')`);
    db.exec(`INSERT INTO user_points (user_id, amount, awarded_at) VALUES (1, 0.3, '${at('2026-09-09')}'), (1, 0.9, '${at('2026-09-04')}')`);
    const n = await loadLeaveNeutral(fakeD1(db), { ranges: [WEEK] });
    assert.equal(n.leaveDays(1, 0), 0);
    assert.equal(n.delta(1, 0), 0, 'nothing replaced — the 0.3 counts, last Friday does not');
  });

  test('`where` / extra sums / userIds restriction', async () => {
    const db = freshDb();
    db.exec(`INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, days, hours, start_time, status)
             VALUES (1, 'annual', '2026-09-11', '2026-09-11', 1, 8, NULL, 'approved'),
                    (2, 'annual', '2026-09-11', '2026-09-11', 1, 8, NULL, 'approved')`);
    db.exec(`INSERT INTO user_points (user_id, amount, source, awarded_at) VALUES
               (1, 1.0, 'progress', '${at('2026-09-04')}'), (1, 5.0, 'repair', '${at('2026-09-04')}'),
               (2, 1.0, 'progress', '${at('2026-09-04')}')`);
    const n = await loadLeaveNeutral(fakeD1(db), {
      ranges: [WEEK],
      userIds: [1],
      sums: { pts: 'amount', repair: "CASE WHEN source = 'repair' THEN amount ELSE 0 END" },
    });
    assert.equal(n.delta(1, 0), 6);
    assert.equal(n.delta(1, 0, 'repair'), 5);
    assert.equal(n.delta(2, 0), 0, 'not in userIds');
    const p = await loadLeaveNeutral(fakeD1(db), { ranges: [WEEK], where: "source = 'progress'" });
    assert.equal(p.delta(1, 0), 1);
  });
});
