/**
 * `lib/repairProgress.ts` — засварын төслийн явц цагийн бүртгэлээс (0339).
 * Цэвэр функцууд + бодит SQL-ийг `node:sqlite` дээр (миграц 0339 ажиллуулж)
 * шалгана: ханшийн шат хоёр хэмжигдэхүүнээр, «тэр үеийн» цонх, явцын
 * нийлбэр/тааз, горимын CASE, нөхөн тооцооллын идемпотент байдал.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// repairProgress.ts → leaveAvailability.ts → workSchedule.ts нь өргөтгөлгүй
// харьцангуй import-тэй тул resolver эхлээд, дараа нь dynamic import.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  pickLadderRate,
  pctForHours,
  sumProgress,
  defaultProgressMode,
  isProgressMode,
  baseDailyRate,
  hoursProgressSql,
  projectProgressSql,
  hoursProgressOf,
  backfillProgressPct,
  WORK_DAY_HOURS,
} = await import('./repairProgress.ts');
const { todayInUB } = await import('./time.ts');
const { addDays, isWeekend } = await import('./workSchedule.ts');

/* ------------------------------------------------------------------ */
/*  Цэвэр функцууд                                                     */
/* ------------------------------------------------------------------ */

describe('pickLadderRate', () => {
  test('first non-zero rung wins in order self30 → self90 → team30 → company30', () => {
    const base = { self30: 0, self90: 0, team_sum: 0, team_n: 0, company_sum: 0, company_n: 0 };
    assert.deepEqual(pickLadderRate({ ...base, self30: 1.2, self90: 0.5 }), { rate: 1.2, source: 'self30' });
    assert.deepEqual(pickLadderRate({ ...base, self90: 0.5 }), { rate: 0.5, source: 'self90' });
    assert.deepEqual(pickLadderRate({ ...base, team_sum: 3, team_n: 4 }), { rate: 0.75, source: 'team30' });
    assert.deepEqual(pickLadderRate({ ...base, company_sum: 10, company_n: 40 }), {
      rate: 0.25,
      source: 'company30',
    });
  });
  test('all zero / null row → none', () => {
    assert.deepEqual(pickLadderRate(null), { rate: 0, source: 'none' });
    assert.deepEqual(
      pickLadderRate({ self30: 0, self90: 0, team_sum: 0, team_n: 0, company_sum: 0, company_n: 0 }),
      { rate: 0, source: 'none' },
    );
  });
  test('team with members but zero points falls through to company', () => {
    assert.deepEqual(
      pickLadderRate({ self30: 0, self90: 0, team_sum: 0, team_n: 5, company_sum: 2, company_n: 10 }),
      { rate: 0.2, source: 'company30' },
    );
  });
});

describe('pctForHours / sumProgress', () => {
  test('rate × hours / 8 — the owner\'s «1.2%/day, 4 h → 0.6%» example', () => {
    assert.equal(pctForHours(1.2, 4), 0.6);
    assert.equal(pctForHours(1.2, WORK_DAY_HOURS), 1.2);
  });
  test('non-positive / non-finite inputs → 0', () => {
    assert.equal(pctForHours(0, 8), 0);
    assert.equal(pctForHours(1, 0), 0);
    assert.equal(pctForHours(NaN, 8), 0);
    assert.equal(pctForHours(1, -2), 0);
  });
  test('sumProgress adds, ignores garbage, never caps (2026-09-29), rounds to 2 dp', () => {
    assert.equal(sumProgress([0.6, 1.2, 0.333]), 2.13);
    assert.equal(sumProgress([60, 50]), 110);
    assert.equal(sumProgress([NaN, -3, 2]), 2);
    assert.equal(sumProgress([]), 0);
  });
});

describe('progress mode helpers', () => {
  test('new ZA → hours, everything else → tasks', () => {
    assert.equal(defaultProgressMode('ZA'), 'hours');
    assert.equal(defaultProgressMode('AZ'), 'tasks');
    assert.equal(defaultProgressMode(null), 'tasks');
    assert.equal(defaultProgressMode(undefined), 'tasks');
  });
  test('isProgressMode', () => {
    assert.equal(isProgressMode('hours'), true);
    assert.equal(isProgressMode('tasks'), true);
    assert.equal(isProgressMode('manual'), false);
    assert.equal(isProgressMode(1), false);
  });
});

/* ------------------------------------------------------------------ */
/*  Real SQL on node:sqlite                                            */
/* ------------------------------------------------------------------ */

/** Minimal D1 shim over node:sqlite — enough for the statements the lib runs. */
function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } } as never;
    },
    raw: async () => [] as never,
  });
  return { prepare: (sql: string) => mk(sql) } as unknown as D1Database;
}

const MEMBER = "(u.role IN ('engineer','architect','senior'))";

/** Pre-0339 schema (the columns the lib and the migration touch), then 0339. */
function freshDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      is_support INTEGER NOT NULL DEFAULT 0, team_id INTEGER,
      -- тест хүмүүс удаан ажилласан (шинэ ажилтны тест created_at-ийг өөрөө өгнө)
      created_at TEXT DEFAULT '2025-01-06 01:00:00'
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
      status TEXT NOT NULL DEFAULT 'active', manual_progress REAL,
      hours_progress_base REAL -- 0349
    );
    CREATE TABLE repair_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE user_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      project_id INTEGER, repair_project_id INTEGER,
      amount REAL NOT NULL, delta_pct REAL NOT NULL,
      awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL DEFAULT 'progress', repair_entry_id INTEGER
    );
    CREATE TABLE repair_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      project_id INTEGER, repair_project_id INTEGER,
      description TEXT NOT NULL DEFAULT '', hours REAL NOT NULL,
      day_hours REAL NOT NULL DEFAULT 8, weekly_avg_pct REAL NOT NULL DEFAULT 0,
      rate_source TEXT, computed_pct REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_repair_project ON repair_entries(project_id);
    CREATE INDEX idx_repair_repair_project ON repair_entries(repair_project_id);
    CREATE TABLE leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type TEXT NOT NULL DEFAULT 'annual',
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, days REAL NOT NULL DEFAULT 1, hours REAL,
      start_time TEXT, status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE holidays (date TEXT PRIMARY KEY);
  `);
  const migration = readFileSync(new URL('../../migrations/0339_repair_hours_progress.sql', import.meta.url), 'utf8');
  db.exec(migration);
  return { db, d1: fakeD1(db) };
}

describe('migration 0339', () => {
  test('adds progress_mode (default tasks, CHECK) and the three repair_entries columns', () => {
    const { db } = freshDb();
    db.exec(`INSERT INTO projects (name, category) VALUES ('old ZA', 'ZA')`);
    const p = db.prepare(`SELECT progress_mode FROM projects`).get() as { progress_mode: string };
    assert.equal(p.progress_mode, 'tasks', 'existing rows stay on the weighted tree');
    assert.throws(() => db.exec(`UPDATE projects SET progress_mode = 'manual'`), /CHECK/);
    db.exec(`INSERT INTO repair_entries (user_id, hours, date, repair_project_id) VALUES (1, 4, '2026-09-01', 1)`);
    const r = db
      .prepare(`SELECT progress_rate, progress_rate_source, progress_pct FROM repair_entries`)
      .get() as Record<string, unknown>;
    assert.equal(r.progress_rate, 0);
    assert.equal(r.progress_rate_source, null);
    assert.equal(r.progress_pct, 0);
  });
});

/** Seed: user 1 (team 10) with points on two days; user 2 same team, no points;
 *  user 3 other team. `awarded_at` relative to NOW so the live window works. */
function seedPoints(db: DatabaseSync) {
  db.exec(`
    INSERT INTO users (id, role, team_id) VALUES (1,'engineer',10),(2,'engineer',10),(3,'architect',20),
                                                (4,'admin',10),(5,'engineer',10);
    UPDATE users SET status='inactive' WHERE id = 5;
    -- user 1: amount 0.05 / delta 1.0 two days ago, amount 0.10 / delta 2.0 five days ago
    INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at, source)
      VALUES (1, 7, 0.05, 1.0, datetime('now','-2 days'), 'progress'),
             (1, 7, 0.10, 2.0, datetime('now','-5 days'), 'progress'),
             -- repair points must NOT feed the ladder
             (1, 7, 9.0, 9.0, datetime('now','-1 days'), 'repair'),
             -- 40 days ago: outside 7/30, inside 90
             (1, 7, 0.20, 4.0, datetime('now','-40 days'), 'progress'),
             -- user 3 (other team), inside 30
             (3, 8, 0.30, 6.0, datetime('now','-3 days'), 'progress');
  `);
}

/** Шатны хуваарь: сүүлийн K АЖИЛЛАСАН өдөр (lib/dailyAverage.ts) — 30 хоног = 21, 90 = 64. */
const W30 = 21;
const W90 = 64;

describe('baseDailyRate', () => {
  test('amount vs delta_pct measure: same 30-day window, different unit', async () => {
    const { db, d1 } = freshDb();
    seedPoints(db);
    const pts = await baseDailyRate(d1, 1, 'amount', MEMBER);
    const pct = await baseDailyRate(d1, 1, 'delta_pct', MEMBER);
    // self30 оноо: хувиар (0.05 + 0.10) + засвар 9.0 — хүний БҮХ ажил (0348).
    // self30 явц: (1 + 2) — засварын мөр repair_entry-гүй тул төслийн-% 0.
    // 40 хоногийн өмнөх мөр 30 хоногт ОРОХГҮЙ.
    assert.equal(pts.source, 'self30');
    assert.ok(Math.abs(pts.rate - 9.15 / W30) < 1e-9, `amount rate ${pts.rate}`);
    assert.equal(pct.source, 'self30');
    assert.ok(Math.abs(pct.rate - 3 / W30) < 1e-9, `delta rate ${pct.rate}`);
  });

  test('repair and non-project work feed the person’s own average (0348): points by amount, progress by the entry’s progress_pct', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (1,'engineer',10)`);
    db.exec(`INSERT INTO repair_entries (id, user_id, project_id, hours, date, progress_pct)
             VALUES (50, 1, 7, 8, date('now','-1 days'), 0.4)`);
    db.exec(`INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at, source, repair_entry_id)
             VALUES (1, 7, 0.2, 0.2, datetime('now','-1 days'), 'repair', 50),
                    (1, NULL, 0.1, 0.1, datetime('now','-2 days'), 'non_project', NULL)`);
    const pts = await baseDailyRate(d1, 1, 'amount', MEMBER);
    assert.equal(pts.source, 'self30');
    assert.ok(Math.abs(pts.rate - 0.3 / W30) < 1e-9, `amount ${pts.rate}`);
    const pct = await baseDailyRate(d1, 1, 'delta_pct', MEMBER);
    assert.equal(pct.source, 'self30');
    // Засварын мөрийн delta_pct (0.2 = оноо) БИШ, repair_entries.progress_pct (0.4);
    // төслийн бус ажил төслийн явц өгөхгүй.
    assert.ok(Math.abs(pct.rate - 0.4 / W30) < 1e-9, `delta ${pct.rate}`);
  });

  test('a purely hours-based worker keeps their own rate (self-feeding is stable)', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (1,'engineer',10),(2,'engineer',10)`);
    // 30 хоногийн турш өдөр бүр 8 цаг засвар, өдрийн оноо = ханш 0.05
    for (let i = 1; i <= 21; i++) {
      db.exec(`INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at, source)
               VALUES (1, 7, 0.05, 0.05, datetime('now','-${i} days'), 'repair')`);
    }
    const r = await baseDailyRate(d1, 1, 'amount', MEMBER);
    assert.equal(r.source, 'self30', 'not the team/company fallback');
    // 21 хуанлийн өдөр ≈ 15 ажлын + 6 амралтын өдөр — бүх оноо сүүлийн 21
    // ажилласан өдрийн мужид; хуваарь 21.
    assert.ok(Math.abs(r.rate - (21 * 0.05) / W30) < 1e-9, `${r.rate}`);
    assert.ok(r.rate <= 0.05 + 1e-12, 'never grows above the day rate');
  });

  test('falls to self90, then team30 (same team, active, eligible only), then company30', async () => {
    const { db, d1 } = freshDb();
    seedPoints(db);
    // user 1 only has the 40-day-old row → self90
    db.exec(`DELETE FROM user_points WHERE user_id = 1 AND awarded_at > datetime('now','-30 days')`);
    const s90 = await baseDailyRate(d1, 1, 'delta_pct', MEMBER);
    assert.equal(s90.source, 'self90');
    assert.ok(Math.abs(s90.rate - 4.0 / W90) < 1e-9, `self90 ${s90.rate}`);

    // user 2 (team 10) has nothing; team 10 has no progress rows in 30 d → company30
    const c30 = await baseDailyRate(d1, 2, 'delta_pct', MEMBER);
    assert.equal(c30.source, 'company30');
    // company: users 1,2,3 eligible+active (4 admin, 5 inactive excluded) → n=3;
    // гишүүн бүрийн өдрийн дундажийн дундаж = (0 + 0 + 6/21) / 3
    assert.ok(Math.abs(c30.rate - 6.0 / W30 / 3) < 1e-9, `company ${c30.rate}`);

    // give team 10 a member with recent points → team30 wins for user 2
    db.exec(`INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at)
             VALUES (1, 7, 0.1, 2.0, datetime('now','-3 days'))`);
    const t30 = await baseDailyRate(d1, 2, 'delta_pct', MEMBER);
    assert.equal(t30.source, 'team30');
    // team 10 eligible+active: users 1, 2 → n=2
    assert.ok(Math.abs(t30.rate - 2.0 / W30 / 2) < 1e-9, `team ${t30.rate}`);
  });

  test('`until` bounds the window on both sides (as-of backfill semantics)', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (1,'engineer',10)`);
    db.exec(`INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at)
             VALUES (1, 7, 0.1, 1.0, '2026-08-01 10:00:00'),
                    (1, 7, 0.1, 2.0, '2026-08-05 10:00:00'),
                    (1, 7, 0.1, 4.0, '2026-08-20 10:00:00')`);
    // as of 2026-08-06 (УБ 08:00, тэр өдөр оноогүй → өчигдрөөр төгсөх 21 өдөр):
    // only the two August rows before it → (1+2)/21
    const r = await baseDailyRate(d1, 1, 'delta_pct', MEMBER, '2026-08-06 00:00:00');
    assert.equal(r.source, 'self30');
    assert.ok(Math.abs(r.rate - 3 / W30) < 1e-9, `${r.rate}`);
    // as of 2026-08-03: only the first row (Бямба — нийлбэрт орно); 08-05 is in the future → 1/21
    const r2 = await baseDailyRate(d1, 1, 'delta_pct', MEMBER, '2026-08-03 00:00:00');
    assert.ok(Math.abs(r2.rate - 1 / W30) < 1e-9, `${r2.rate}`);
  });

  test('шинэ ажилтан: ажилд орсноос хойш ажилласан өдрөөрөө (21-д биш), багийн дундажийг доош татахгүй', async () => {
    const { db, d1 } = freshDb();
    const today = todayInUB();
    const [d0, d1day] = weekdaysBefore(today, 2);
    // 2: хоёр ажлын өдрийн өмнө орсон; 1: удаан ажилласан багийн гишүүн; 3: өнөөдөр орсон, ажиллаагүй
    db.exec(`INSERT INTO users (id, role, team_id, created_at) VALUES (1,'engineer',10,'2025-01-06 01:00:00'),
                                                             (2,'engineer',10,'${d0} 01:00:00'),
                                                             (3,'engineer',10,datetime('now'))`);
    addPoint(db, 2, d0!, 1.2);
    addPoint(db, 2, d1day!, 0.6);
    for (const d of weekdaysBefore(today, 30)) addPoint(db, 1, d, 0.4);
    const r = await baseDailyRate(d1, 2, 'delta_pct', MEMBER);
    assert.equal(r.source, 'self30');
    // өнөөдөр оноогүй тул өнөөдөр хуваарьт орохгүй: (1.2 + 0.6) / 2
    assert.ok(Math.abs(r.rate - 0.9) < 1e-9, `new hire ${r.rate}`);
    // 3 (өнөөдөр орсон, оноогүй) → өөрийн дундаж алга → баг: (0.4 + 0.9) / 2 — 3 тоологдохгүй
    const t = await baseDailyRate(d1, 3, 'delta_pct', MEMBER);
    assert.equal(t.source, 'team30');
    assert.ok(Math.abs(t.rate - (0.4 + 0.9) / 2) < 1e-9, `team ${t.rate}`);
    // өнөөдөр ажиллаж эхэлмэгц — тэр өдрийн хувь нь өдрийн дундаж
    addPoint(db, 3, today, 0.3);
    const own = await baseDailyRate(d1, 3, 'delta_pct', MEMBER);
    assert.equal(own.source, 'self30');
    assert.ok(Math.abs(own.rate - 0.3) < 1e-9, `first day ${own.rate}`);
  });
});

/** [today−(n−1), today] мужийн ажлын өдрүүд (холидэйгүй тест DB). */
function weekdaysBack(n: number): string[] {
  const today = todayInUB();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    if (!isWeekend(d)) out.push(d);
  }
  return out;
}

/** `date`-ээс өмнөх хамгийн ойрын `n` ажлын өдөр (хуучнаас шинэ рүү). */
function weekdaysBefore(date: string, n: number): string[] {
  const out: string[] = [];
  for (let d = addDays(date, -1); out.length < n; d = addDays(d, -1)) if (!isWeekend(d)) out.unshift(d);
  return out;
}

function addLeave(db: DatabaseSync, userId: number, from: string, to: string, status = 'approved', extra = '') {
  db.exec(`INSERT INTO leave_requests (user_id, start_date, end_date, days, status${extra ? ', start_time, hours' : ''})
           VALUES (${userId}, '${from}', '${to}', 1, '${status}'${extra ? `, ${extra}` : ''})`);
}

/** УБ-ийн тэр өдрийн 12:00 = UTC 04:00. */
function addPoint(db: DatabaseSync, userId: number, date: string, delta: number) {
  db.exec(`INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at)
           VALUES (${userId}, 7, ${delta / 20}, ${delta}, '${date} 04:00:00')`);
}

describe('approved leave never moves the rate', () => {
  test('one approved leave day with no output → rate does NOT change (old behaviour dropped it, share-based rose it)', async () => {
    const { db, d1 } = freshDb();
    seedPoints(db);
    const before = await baseDailyRate(d1, 1, 'delta_pct', MEMBER);
    assert.ok(Math.abs(before.rate - 3 / W30) < 1e-9, `baseline ${before.rate}`);
    // a weekday in the window without points; the extra earlier weekday has no points either
    const pointDays = new Set([addDays(todayInUB(), -2), addDays(todayInUB(), -5)]);
    const day = weekdaysBack(7).find((d) => !pointDays.has(d))!;
    addLeave(db, 1, day, day);
    const after = await baseDailyRate(d1, 1, 'delta_pct', MEMBER);
    assert.equal(after.source, 'self30');
    assert.ok(Math.abs(after.rate - 3 / W30) < 1e-9, `with leave ${after.rate}`);
  });

  test('whole 30-day window on approved leave → rate continues from the worked days before the leave', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (1,'engineer',10)`);
    const days30 = weekdaysBack(30);
    const prior = weekdaysBefore(days30[0]!, days30.length);
    prior.forEach((d) => addPoint(db, 1, d, 1)); // 1 / worked day
    addLeave(db, 1, days30[0]!, days30[days30.length - 1]!);
    const r = await baseDailyRate(d1, 1, 'delta_pct', MEMBER);
    assert.equal(r.source, 'self30', 'not 0, not a fallback');
    // амралтаас өмнөх сүүлийн 21 ажилласан өдөр — өдөр бүр 1
    assert.ok(Math.abs(r.rate - 1) < 1e-9, `${r.rate}`);
    // the same person without the leave record: the calendar month is (almost) empty
    // (the UTC `now − 30 days` edge may still catch the last pre-leave point)
    db.exec(`DELETE FROM leave_requests`);
    const naive = await baseDailyRate(d1, 1, 'delta_pct', MEMBER);
    assert.ok(naive.source !== 'self30' || naive.rate < r.rate, `naive ${naive.source} ${naive.rate}`);
  });

  test('pending / rejected leave and sub-day leave change nothing; absence without leave stays a 0 day', async () => {
    const { db, d1 } = freshDb();
    seedPoints(db);
    const [d0, d1day, d2] = weekdaysBack(7);
    addLeave(db, 1, d0!, d0!, 'pending');
    addLeave(db, 1, d1day!, d1day!, 'rejected');
    addLeave(db, 1, d2!, d2!, 'approved', `'09:00', 2`);
    const r = await baseDailyRate(d1, 1, 'delta_pct', MEMBER);
    assert.equal(r.source, 'self30');
    assert.ok(Math.abs(r.rate - 3 / W30) < 1e-9, `${r.rate}`);
  });

  test('team30: a member on leave all month contributes their pre-leave worked days, not 0', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (1,'engineer',10),(2,'engineer',10)`);
    addPoint(db, 1, weekdaysBack(30).at(-3)!, 2.0); // user 1 works normally
    const w30 = weekdaysBack(30);
    addLeave(db, 2, w30[0]!, w30.at(-1)!);
    const pre = weekdaysBefore(w30[0]!, 3);
    pre.forEach((d) => addPoint(db, 2, d, 1.0)); // user 2's last worked days before the leave
    // user 3 (no team) asks → no self points → team? no team → company
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (3,'engineer',NULL)`);
    const c30 = await baseDailyRate(d1, 3, 'delta_pct', MEMBER);
    assert.equal(c30.source, 'company30');
    assert.ok(Math.abs(c30.rate - (2.0 + 3.0) / W30 / 3) < 1e-9, `company ${c30.rate}`);
    // user 1 has own points → self30/self90; ask through a teammate without points
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (4,'engineer',10)`);
    const t30 = await baseDailyRate(d1, 4, 'delta_pct', MEMBER);
    assert.equal(t30.source, 'team30');
    assert.ok(Math.abs(t30.rate - (2.0 + 3.0) / W30 / 3) < 1e-9, `team ${t30.rate}`);
    // without the leave record user 2 counts as ~0 for the whole month
    db.exec(`DELETE FROM leave_requests`);
    const naive = await baseDailyRate(d1, 4, 'delta_pct', MEMBER);
    assert.ok(naive.rate < t30.rate, `naive ${naive.rate}`);
  });
});

describe('hoursProgressSql / projectProgressSql', () => {
  test('Σ credited user_points.amount per target, NOT capped, 0 when nothing credited (2026-09-29)', async () => {
    const { db, d1 } = freshDb();
    db.exec(`
      INSERT INTO repair_projects (id, name) VALUES (1,'A'),(2,'B'),(3,'C');
      INSERT INTO user_points (user_id, repair_project_id, amount, delta_pct, source)
        VALUES (1,1,0.6,0.6,'repair'),(2,1,0.25,0.25,'repair'),(1,2,70,70,'repair'),(3,2,45,45,'repair');
      -- progress_pct is a 0339 snapshot now — a huge value must not move the progress
      INSERT INTO repair_entries (user_id, repair_project_id, hours, date, progress_pct) VALUES (1,3,8,'2026-09-01',55);
    `);
    const rows = db
      .prepare(`SELECT id, ${hoursProgressSql('repair_project_id', 'rp.id')} AS progress FROM repair_projects rp ORDER BY id`)
      .all() as { id: number; progress: number }[];
    assert.ok(Math.abs(rows[0]!.progress - 0.85) < 1e-9);
    assert.equal(rows[1]!.progress, 115, 'above 100 on purpose — repair work has no finish line');
    assert.equal(rows[2]!.progress, 0, 'entries without credited points add nothing');
    assert.equal(await hoursProgressOf(d1, 'repair_project_id', 1), 0.85);
    assert.equal(await hoursProgressOf(d1, 'repair_project_id', 99), 0, 'unknown target → 0');
  });

  test('projectProgressSql: hours mode = every % credited on the project (old %-fills + repair), tasks mode keeps the rollup', () => {
    const { db } = freshDb();
    db.exec(`
      INSERT INTO projects (id, name, category, progress_mode) VALUES (1,'legacy ZA','ZA','tasks'),(2,'new ZA','ZA','hours'),(3,'empty new ZA','ZA','hours');
      INSERT INTO user_points (user_id, project_id, amount, delta_pct, source)
        VALUES (1,1,5,5,'progress'),
               (1,2,1.2,3,'progress'),   -- %-fill points from before the project switched to hours
               (1,2,0.3,0.3,'repair'),(2,2,0.5,0.5,'repair');
      INSERT INTO repair_entries (user_id, project_id, hours, date, progress_pct) VALUES (1,2,8,'2026-09-01',40);
    `);
    // stand-in for the weighted rollup CTE value
    const rows = db
      .prepare(`SELECT p.id, ROUND(COALESCE(p.manual_progress, ${projectProgressSql('p', '91.66')}, 0), 2) AS progress FROM projects p ORDER BY p.id`)
      .all() as { id: number; progress: number }[];
    assert.equal(rows[0]!.progress, 91.66, 'legacy ZA keeps its weighted progress even with credited points');
    assert.equal(rows[1]!.progress, 2, 'hours mode = Σ amount (1.2 + 0.3 + 0.5), progress_pct ignored');
    assert.equal(rows[2]!.progress, 0, 'a new repair project starts at 0%');
    // manual_progress still beats both (existing precedence)
    db.exec(`UPDATE projects SET manual_progress = 42 WHERE id = 2`);
    const m = db
      .prepare(`SELECT ROUND(COALESCE(p.manual_progress, ${projectProgressSql('p', '0')}, 0), 2) AS progress FROM projects p WHERE id = 2`)
      .get() as { progress: number };
    assert.equal(m.progress, 42);
  });

  test('a carried-over base (0349, FURNITURE LAND) adds to the credited sum; repair_projects never have one', async () => {
    const { db, d1 } = freshDb();
    db.exec(`
      INSERT INTO projects (id, name, category, progress_mode, hours_progress_base) VALUES (5,'FL','ZA','hours',93.4),(6,'ZA2','ZA','hours',NULL);
      INSERT INTO repair_projects (id, name) VALUES (5,'internal 5');
      INSERT INTO user_points (user_id, project_id, amount, delta_pct, source) VALUES (1,5,0.5,0.5,'repair'),(1,6,0.7,0.7,'repair');
      INSERT INTO user_points (user_id, repair_project_id, amount, delta_pct, source) VALUES (1,5,2,2,'repair');
    `);
    assert.equal(await hoursProgressOf(d1, 'project_id', 5), 93.9, 'base + Σ credited');
    assert.equal(await hoursProgressOf(d1, 'project_id', 6), 0.7, 'no base → credited points only');
    assert.equal(await hoursProgressOf(d1, 'repair_project_id', 5), 2, 'same id in repair_projects ignores the project base');
    db.exec(`UPDATE projects SET hours_progress_base = 99.8 WHERE id = 5`);
    assert.equal(await hoursProgressOf(d1, 'project_id', 5), 100.3, 'no cap any more');
  });
});

describe('backfillProgressPct', () => {
  test('fills NULL-source rows as of their own date, is idempotent, `all` redoes everything', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (1,'engineer',10),(2,'engineer',10)`);
    // user 1 progress history: 1%/day-ish in early August, nothing later
    db.exec(`INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at)
             VALUES (1,7,0.1,2.5,'2026-08-01 09:00:00'),(1,7,0.1,2.5,'2026-08-03 09:00:00')`);
    db.exec(`INSERT INTO repair_projects (id, name) VALUES (1,'A')`);
    // entry a: 2026-08-04 (created_at known) → self30 = 5/21 → 4 h → half of it
    // entry b: 2026-09-15 (created_at NULL → date end) → self30 0, self90 = 5/64 → 8 h
    // entry c: user 2, no own history → team30 (user 1 is on team 10) as of 2026-08-04 = (5/21)/2 → 8 h
    db.exec(`INSERT INTO repair_entries (id, user_id, repair_project_id, hours, date, created_at)
             VALUES (10,1,1,4,'2026-08-04','2026-08-04 10:00:00'),
                    (11,1,1,8,'2026-09-15',NULL),
                    (12,2,1,8,'2026-08-04','2026-08-04 11:00:00')`);
    const r1 = await backfillProgressPct(d1, MEMBER);
    assert.deepEqual(r1, { scanned: 3, updated: 3 });
    const rows = db
      .prepare(`SELECT id, progress_rate, progress_rate_source, progress_pct FROM repair_entries ORDER BY id`)
      .all() as { id: number; progress_rate: number; progress_rate_source: string; progress_pct: number }[];
    assert.equal(rows[0]!.progress_rate_source, 'self30');
    assert.ok(Math.abs(rows[0]!.progress_pct - 5 / W30 / 2) < 1e-9, `a ${rows[0]!.progress_pct}`);
    assert.equal(rows[1]!.progress_rate_source, 'self90');
    assert.ok(Math.abs(rows[1]!.progress_pct - 5 / W90) < 1e-9, `b ${rows[1]!.progress_pct}`);
    assert.equal(rows[2]!.progress_rate_source, 'team30');
    assert.ok(Math.abs(rows[2]!.progress_pct - 5 / W30 / 2) < 1e-9, `c ${rows[2]!.progress_pct}`);

    // idempotent: nothing left with NULL source
    assert.deepEqual(await backfillProgressPct(d1, MEMBER), { scanned: 0, updated: 0 });
    // `all` recomputes (same inputs → same numbers)
    const r3 = await backfillProgressPct(d1, MEMBER, { all: true });
    assert.deepEqual(r3, { scanned: 3, updated: 3 });
    const again = db.prepare(`SELECT progress_pct FROM repair_entries WHERE id = 10`).get() as { progress_pct: number };
    assert.ok(Math.abs(again.progress_pct - 5 / W30 / 2) < 1e-9);

    // progress_pct is only a snapshot since 2026-09-29 — the backfill never
    // moves the repair project's progress (nothing was credited on it here)
    assert.equal(await hoursProgressOf(d1, 'repair_project_id', 1), 0);
  });

  test('never touches computed_pct (the points ledger)', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO users (id, role, team_id) VALUES (1,'engineer',10)`);
    db.exec(`INSERT INTO repair_projects (id, name) VALUES (1,'A')`);
    db.exec(`INSERT INTO repair_entries (id, user_id, repair_project_id, hours, date, computed_pct, weekly_avg_pct, rate_source)
             VALUES (1,1,1,8,'2026-09-01',0.0104,0.0104,'self7')`);
    await backfillProgressPct(d1, MEMBER);
    const r = db.prepare(`SELECT computed_pct, weekly_avg_pct, rate_source, progress_rate_source FROM repair_entries`).get() as Record<string, unknown>;
    assert.equal(r.computed_pct, 0.0104);
    assert.equal(r.weekly_avg_pct, 0.0104);
    assert.equal(r.rate_source, 'self7');
    assert.equal(r.progress_rate_source, 'none');
  });
});
