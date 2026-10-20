/**
 * `lib/repairDayStore.ts` — засварын цагийн автомат хуваарилалтын D1 давхарга
 * (миграц 0348) бодит SQLite (`node:sqlite`) дээр: миграцын файлыг өөрийг нь
 * ажиллуулж, тэмдэглэгээ → цаг → оноо, хувийн бөглөлтийн хил, болиулах,
 * төслийн бус ажлын хасалт, гараар бичсэн хуучин цаг, хуучин ZA бөглөлтийн
 * нөхөлтийг шалгана.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// repairDayStore.ts → settings/specialShift/repairProgress … өргөтгөлгүй
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
  syncRepairDay,
  createLiveMark,
  deleteMark,
  runHoursBackfill,
  hoursBackfillStatus,
  dayStartUtc,
  loadDayWindow,
} = await import('./repairDayStore.ts');
const { todayInUB } = await import('./time.ts');

/** node:sqlite дээрх D1 shim — `batch` нь дарааллаар, нэг transaction-д. */
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
    raw: async () => [] as never,
  });
  return {
    prepare: (sql: string) => mk(sql),
    batch: async (stmts: Array<{ __sql: string; __args: unknown[] }>) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => {
          const r = db.prepare(s.__sql).run(...(s.__args as never[]));
          return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

const DAY = '2026-09-22'; // Мягмар, зуны албадлагаас гадуур

function freshDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      is_support INTEGER NOT NULL DEFAULT 0, team_id INTEGER, work_schedule TEXT,
      created_at TEXT DEFAULT '2025-01-06 01:00:00'
    );
    CREATE TABLE user_work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, schedule TEXT NOT NULL,
      effective_from TEXT NOT NULL, created_by INTEGER
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT, updated_by INTEGER);
    INSERT INTO app_settings (key, value) VALUES ('lunch_enabled','1'),('lunch_start','13:00'),('lunch_end','14:00');
    CREATE TABLE holidays (date TEXT PRIMARY KEY);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
      status TEXT NOT NULL DEFAULT 'active', progress_mode TEXT NOT NULL DEFAULT 'tasks'
    );
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, team_id INTEGER, weight_percent REAL NOT NULL DEFAULT 0);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER NOT NULL, weight_percent REAL NOT NULL DEFAULT 0);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER NOT NULL);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, component_id INTEGER NOT NULL, name TEXT, weight_percent REAL NOT NULL DEFAULT 0);
    CREATE TABLE project_team_shares (project_id INTEGER NOT NULL, team_id INTEGER NOT NULL, share_percent REAL NOT NULL);
    CREATE TABLE progress_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      percentage REAL NOT NULL DEFAULT 0, date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved',
      is_rest_day INTEGER DEFAULT 0, defer_next_day INTEGER DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'web',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE repair_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE user_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      project_id INTEGER, repair_project_id INTEGER, task_id INTEGER, progress_entry_id INTEGER,
      amount REAL NOT NULL, delta_pct REAL NOT NULL, assignee_count INTEGER NOT NULL DEFAULT 1,
      awarded_at TEXT NOT NULL DEFAULT (datetime('now')), awarded_by INTEGER,
      source TEXT NOT NULL DEFAULT 'progress', repair_entry_id INTEGER
    );
    CREATE TABLE repair_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      project_id INTEGER, repair_project_id INTEGER, task_id INTEGER,
      description TEXT NOT NULL DEFAULT '', hours REAL NOT NULL CHECK (hours > 0),
      day_hours REAL NOT NULL DEFAULT 8, weekly_avg_pct REAL NOT NULL DEFAULT 0,
      rate_source TEXT, computed_pct REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
      progress_rate REAL NOT NULL DEFAULT 0, progress_rate_source TEXT, progress_pct REAL NOT NULL DEFAULT 0,
      CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))
    );
    CREATE TABLE non_project_work_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type TEXT NOT NULL DEFAULT 'annual',
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, days REAL NOT NULL DEFAULT 1, hours REAL,
      start_time TEXT, end_time TEXT, status TEXT NOT NULL DEFAULT 'pending'
    );
    -- хэрэглэгч 1: 08:00–17:00 ээлж (early); ZA төсөл 1 (таск 11, 12), AZ төсөл 2 (таск 21, 22)
    INSERT INTO users (id, role, team_id, work_schedule) VALUES (1,'engineer',10,'early'),(2,'engineer',10,'early');
    INSERT INTO projects (id, name, category, progress_mode) VALUES (1,'ZA','ZA','tasks'),(2,'AZ','AZ','tasks');
    INSERT INTO blocks (id, project_id) VALUES (1,1),(2,2);
    INSERT INTO drawings (id, block_id) VALUES (1,1),(2,2);
    INSERT INTO components (id, drawing_id) VALUES (1,1),(2,2);
    INSERT INTO tasks (id, component_id, name) VALUES (11,1,'za-a'),(12,1,'za-b'),(21,2,'az-a'),(22,2,'az-b');
    INSERT INTO repair_projects (id, name) VALUES (5,'Оффисын засвар');
  `);
  db.exec(readFileSync(new URL('../../migrations/0348_repair_auto_hours.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0349_repair_progress_carryover.sql', import.meta.url), 'utf8'));
  return { db, d1: fakeD1(db) };
}

/** УБ 'HH:MM' → тэр өдрийн UTC sqlite timestamp. */
function ubAt(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ms = Date.parse(`${date}T00:00:00Z`) + ((h! * 60 + m!) - 480) * 60_000;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function addMark(
  db: DatabaseSync,
  m: { id: number; task?: number; project?: number; rp?: number; at: string; award?: 0 | 1; date?: string },
) {
  db.prepare(
    `INSERT INTO repair_marks (id, user_id, date, project_id, repair_project_id, task_id, marked_at,
                               award_points, daily_rate, rate_source, progress_rate, progress_rate_source)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, 0.4, 'self30', 0.2, 'self30')`,
  ).run(
    m.id,
    m.date ?? DAY,
    m.rp ? null : (m.project ?? 1),
    m.rp ?? null,
    m.task ?? null,
    ubAt(m.date ?? DAY, m.at),
    m.award ?? 1,
  );
}

function addFill(db: DatabaseSync, task: number, at: string, date = DAY) {
  db.prepare(`INSERT INTO progress_entries (task_id, user_id, percentage, date, created_at) VALUES (?, 1, 30, ?, ?)`).run(
    task,
    date,
    ubAt(date, at),
  );
}

const rowsOf = (db: DatabaseSync) =>
  db
    .prepare(
      `SELECT re.mark_id, re.hours, re.computed_pct, re.progress_pct, re.hours_source, re.task_id,
              up.amount AS pts, up.awarded_at
         FROM repair_entries re LEFT JOIN user_points up ON up.repair_entry_id = re.id
        WHERE re.mark_id IS NOT NULL ORDER BY re.mark_id`,
    )
    .all() as {
    mark_id: number;
    hours: number;
    computed_pct: number;
    progress_pct: number;
    hours_source: string;
    task_id: number | null;
    pts: number | null;
    awarded_at: string | null;
  }[];

describe('migration 0348', () => {
  test('flips every ZA project to hours mode, leaves the rest alone; new columns default sanely', () => {
    const { db } = freshDb();
    const modes = db.prepare(`SELECT id, progress_mode FROM projects ORDER BY id`).all() as { progress_mode: string }[];
    assert.deepEqual(
      modes.map((r) => r.progress_mode),
      ['hours', 'tasks'],
    );
    db.exec(`INSERT INTO repair_entries (user_id, project_id, hours, date) VALUES (1, 2, 3, '${DAY}')`);
    const r = db.prepare(`SELECT hours_source, mark_id FROM repair_entries`).get() as Record<string, unknown>;
    assert.equal(r.hours_source, 'manual', 'pre-0348 rows are hand-typed');
    assert.equal(r.mark_id, null);
    assert.throws(() => db.exec(`UPDATE repair_entries SET hours_source = 'x'`), /CHECK/);
    assert.throws(
      () => db.exec(`INSERT INTO repair_marks (user_id, date, project_id, repair_project_id) VALUES (1, '${DAY}', 1, 5)`),
      /CHECK/,
      'exactly one owner, like repair_entries',
    );
  });
});

describe('syncRepairDay', () => {
  test('one repair task marked at the end of the day → 8 h, points = daily rate', async () => {
    const { db, d1 } = freshDb();
    addMark(db, { id: 1, task: 11, at: '16:55' });
    const res = await syncRepairDay(d1, 1, DAY);
    assert.equal(res.hoursByMark.get(1), 8);
    const [row] = rowsOf(db);
    assert.equal(row!.hours, 8);
    assert.equal(row!.hours_source, 'auto');
    assert.equal(row!.task_id, 11);
    assert.ok(Math.abs(row!.computed_pct - 0.4) < 1e-9, 'rate 0.4 × 8/8');
    assert.ok(Math.abs(row!.progress_pct - 0.2) < 1e-9);
    assert.ok(Math.abs(row!.pts! - 0.4) < 1e-9, 'user_points mirrors computed_pct');
    assert.equal(row!.awarded_at, ubAt(DAY, '16:55'), 'points belong to the work day');
  });

  test('a second repair task in the same sitting → 4 + 4, points follow; re-sync is a no-op', async () => {
    const { db, d1 } = freshDb();
    addMark(db, { id: 1, task: 11, at: '16:50' });
    await syncRepairDay(d1, 1, DAY);
    addMark(db, { id: 2, task: 12, at: '16:52' });
    await syncRepairDay(d1, 1, DAY);
    const rows = rowsOf(db);
    assert.deepEqual(
      rows.map((r) => r.hours),
      [4, 4],
    );
    assert.ok(Math.abs(rows[0]!.pts! - 0.2) < 1e-9, 'the first mark’s points shrank to its new 4 h');
    const again = await syncRepairDay(d1, 1, DAY);
    assert.equal(again.writes, 0, 'idempotent');
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM user_points`).get() as { n: number }).n, 2);
  });

  test('a %-fill on a normal project at 12:00 moves the start of the repair time', async () => {
    const { db, d1 } = freshDb();
    addFill(db, 21, '12:00'); // AZ таск, хувиар
    addMark(db, { id: 1, task: 11, at: '16:58' });
    await syncRepairDay(d1, 1, DAY);
    assert.equal(rowsOf(db)[0]!.hours, 4, '12:00–17:00 minus lunch 13–14');
  });

  test('normal tasks filled in the same sitting share the day equally (1 repair + 3 normal → 2 h)', async () => {
    const { db, d1 } = freshDb();
    addFill(db, 21, '16:40');
    addFill(db, 22, '16:41');
    addMark(db, { id: 1, task: 11, at: '16:42' });
    addMark(db, { id: 2, rp: 5, at: '16:43' });
    await syncRepairDay(d1, 1, DAY);
    assert.deepEqual(
      rowsOf(db).map((r) => r.hours),
      [2, 2],
    );
  });

  test('rest-day / defer / rejected entries and hours-mode %-fills are not boundaries', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO progress_entries (task_id, user_id, date, is_rest_day, created_at) VALUES (21, 1, '${DAY}', 1, '${ubAt(DAY, '10:00')}')`);
    db.exec(`INSERT INTO progress_entries (task_id, user_id, date, status, created_at) VALUES (22, 1, '${DAY}', 'rejected', '${ubAt(DAY, '10:00')}')`);
    addFill(db, 12, '10:00'); // ZA (hours) таскийн хуучин хувь — нөхөлтийн ажил, энд биш
    addMark(db, { id: 1, task: 11, at: '16:50' });
    await syncRepairDay(d1, 1, DAY);
    assert.equal(rowsOf(db)[0]!.hours, 8);
  });

  test('unmarking gives the time back to the remaining marks', async () => {
    const { db, d1 } = freshDb();
    addMark(db, { id: 1, task: 11, at: '16:50' });
    addMark(db, { id: 2, task: 12, at: '16:51' });
    await syncRepairDay(d1, 1, DAY);
    await deleteMark(d1, 2);
    await syncRepairDay(d1, 1, DAY);
    const rows = rowsOf(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.hours, 8);
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM user_points`).get() as { n: number }).n, 1);
  });

  test('non-project work and approved sub-day leave are not repair time', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO non_project_work_entries (user_id, date, start_time, end_time) VALUES (1, '${DAY}', '09:00', '11:00')`);
    db.exec(`INSERT INTO non_project_work_entries (user_id, date, start_time, end_time, status) VALUES (1, '${DAY}', '14:00', '15:00', 'rejected')`);
    db.exec(`INSERT INTO leave_requests (user_id, start_date, end_date, start_time, end_time, status)
             VALUES (1, '${DAY}', '${DAY}', '15:00', '16:00', 'approved')`);
    const w = await loadDayWindow(d1, 1, DAY);
    assert.deepEqual([w.start, w.end], [480, 1020], 'early shift 08:00–17:00');
    addMark(db, { id: 1, task: 11, at: '16:50' });
    await syncRepairDay(d1, 1, DAY);
    assert.equal(rowsOf(db)[0]!.hours, 5, '8 − 2 (non-project) − 1 (leave); the rejected one does not count');
  });

  test('hand-typed legacy hours are taken first; a zero share leaves no row but keeps the mark', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO repair_entries (user_id, repair_project_id, hours, date) VALUES (1, 5, 6, '${DAY}')`);
    addMark(db, { id: 1, task: 11, at: '16:50' });
    await syncRepairDay(d1, 1, DAY);
    assert.equal(rowsOf(db)[0]!.hours, 2);
    db.exec(`UPDATE repair_entries SET hours = 9 WHERE mark_id IS NULL`);
    const res = await syncRepairDay(d1, 1, DAY);
    assert.equal(res.hoursByMark.get(1), 0);
    assert.equal(rowsOf(db).length, 0, 'CHECK(hours > 0) — no row for 0 h');
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM repair_marks`).get() as { n: number }).n, 1);
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM user_points`).get() as { n: number }).n, 0);
  });
});

describe('createLiveMark', () => {
  test('snapshots both rates (30-day, all work) and never duplicates the same item today', async () => {
    const { db, d1 } = freshDb();
    const today = todayInUB();
    db.exec(`INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at, source)
             VALUES (1, 2, 0.3, 1.5, datetime('now','-3 days'), 'progress')`);
    const a = await createLiveMark(d1, 1, today, { project_id: 1, repair_project_id: null, task_id: 11 });
    assert.equal(a.created, true);
    assert.equal(a.mark.award_points, 1);
    assert.equal(a.mark.rate_source, 'self30');
    assert.ok(a.mark.daily_rate > 0 && a.mark.progress_rate > a.mark.daily_rate);
    const b = await createLiveMark(d1, 1, today, { project_id: 1, repair_project_id: null, task_id: 11 });
    assert.equal(b.created, false);
    assert.equal(b.mark.id, a.mark.id);
    const c = await createLiveMark(d1, 1, today, { project_id: null, repair_project_id: 5, task_id: null });
    assert.equal(c.created, true, 'a different item is a new mark');
  });
});

describe('runHoursBackfill (old ZA %-fills → hours)', () => {
  test('turns each day’s ZA %-fills into point-less marks, splits the day with the other fills, idempotent', async () => {
    const { db, d1 } = freshDb();
    const d0 = '2026-09-21';
    // Хувь хүний түүх: өмнөх өдрүүдэд төслийн-% 3 (явцын ханш = 3 / 21 — сүүлийн 21
    // ажилласан өдөр, lib/dailyAverage.ts).
    db.exec(`INSERT INTO user_points (user_id, project_id, amount, delta_pct, awarded_at, source)
             VALUES (1, 1, 0.5, 3, '2026-09-10 05:00:00', 'progress')`);
    addFill(db, 11, '16:50', d0); // ZA таск
    addFill(db, 11, '16:55', d0); // ижил таскийг дахин (нэг суулт)
    addFill(db, 21, '16:52', d0); // AZ таск — нэг суултад
    addFill(db, 12, '11:00', DAY); // өөр өдөр, ганц ZA бөглөлт
    const before = await hoursBackfillStatus(d1);
    assert.deepEqual(before, { pending_entries: 3, pending_days: 2 });

    const run = await runHoursBackfill(d1, { maxDays: 10 });
    assert.deepEqual(run, { days: 2, marks: 3, remaining_days: 0 });
    const rows = rowsOf(db);
    const d0rows = rows.filter((r) => r.task_id === 11);
    // d0: ZA таск 11 + AZ таск 21 нэг суултад → ZA 4 цаг (хоёр бөглөлтөд 2 + 2)
    assert.equal(
      d0rows.reduce((s, r) => s + r.hours, 0),
      4,
    );
    assert.ok(rows.every((r) => r.hours_source === 'backfill' && r.pts === null && r.computed_pct === 0));
    // DAY: ганц бөглөлт → бүтэн өдөр
    assert.equal(rows.find((r) => r.task_id === 12)!.hours, 8);
    // явц = тэр өдрийн эхэнд мэдэгдэж байсан 30 хоногийн дундаж × цаг/8
    const expected = (3 / 21) * (8 / 8);
    assert.ok(Math.abs(rows.find((r) => r.task_id === 12)!.progress_pct - expected) < 1e-9);

    assert.deepEqual(await runHoursBackfill(d1, { maxDays: 10 }), { days: 0, marks: 0, remaining_days: 0 });
    assert.equal(rowsOf(db).length, 3, 'no duplicates on re-run');
  });

  test('dayStartUtc = UB midnight in UTC', () => {
    assert.equal(dayStartUtc('2026-09-22'), '2026-09-21 16:00:00');
  });
});

describe('migration 0349 — FURNITURE LAND keeps its progress', () => {
  /** ZA #49: 1 блок (баг 10, жин 100, багийн хувь 100) → 2 зураг (60 / 40) →
   *  таск 30@100%, 30@50% | 40@25% (хуучин 80%, шинэ татгалзсан 99% — сүүлийн
   *  БАТЛАГДСАН нь 25).  Жинлэсэн = (60·75 + 40·25)/100 = 55.  Засварын бүртгэл
   *  progress_pct 1.5 → суурь 53.5, харагдах явц хэвээр 55. */
  function seed49(db: DatabaseSync) {
    db.exec(`
      INSERT INTO projects (id, name, category, progress_mode) VALUES (49,'MGL-240506_FURNITURE LAND_ZA','ZA','hours');
      INSERT INTO blocks (id, project_id, team_id, weight_percent) VALUES (490, 49, 10, 100);
      INSERT INTO drawings (id, block_id, weight_percent) VALUES (491, 490, 60), (492, 490, 40);
      INSERT INTO components (id, drawing_id) VALUES (491, 491), (492, 492);
      INSERT INTO tasks (id, component_id, name, weight_percent) VALUES (4901, 491, 'a', 30), (4902, 491, 'b', 30), (4903, 492, 'c', 40);
      INSERT INTO project_team_shares (project_id, team_id, share_percent) VALUES (49, 10, 100);
      INSERT INTO progress_entries (task_id, user_id, percentage, date, status, created_at) VALUES
        (4901, 1, 100, '2026-09-10', 'approved', '2026-09-10 05:00:00'),
        (4902, 1, 50,  '2026-09-11', 'approved', '2026-09-11 05:00:00'),
        (4903, 1, 80,  '2026-09-01', 'approved', '2026-09-01 05:00:00'),
        (4903, 1, 25,  '2026-09-12', 'approved', '2026-09-12 05:00:00'),
        (4903, 1, 99,  '2026-09-13', 'rejected', '2026-09-13 05:00:00');
      INSERT INTO repair_entries (user_id, project_id, hours, date, progress_pct) VALUES (1, 49, 8, '2026-09-12', 1.5);
    `);
  }

  test('base = weighted progress at the switch − its existing hours progress; the shown number does not move', async () => {
    const fresh = freshDbWith49();
    const row = fresh.db.prepare(`SELECT hours_progress_base AS b FROM projects WHERE id = 49`).get() as { b: number };
    assert.ok(Math.abs(row.b - 53.5) < 1e-9, `base ${row.b}`);
    const { hoursProgressOf } = await import('./repairProgress.ts');
    // 2026-09-29-нөөс цагийн явц = суурь + Σ олгосон оноо (энд оноо байхгүй) —
    // 0349 нь суурийг л тогтооно; #49 нь 0353-аар хувь руу буцсан.
    assert.equal(await hoursProgressOf(fresh.d1, 'project_id', 49), 53.5, 'base + Σ credited (none seeded)');
    const other = fresh.db.prepare(`SELECT hours_progress_base AS b FROM projects WHERE id = 1`).get() as { b: number | null };
    assert.equal(other.b, null, 'every other ZA project recomputes from hours');
  });

  test('the backfill never converts the carried-over project’s old %-fills, but they still take their share of the day', async () => {
    const fresh = freshDbWith49();
    addFill(fresh.db, 11, '16:50'); // ZA #1 — нөхөгдөнө
    fresh.db.exec(`INSERT INTO progress_entries (task_id, user_id, percentage, date, created_at) VALUES (4901, 1, 100, '${DAY}', '${ubAt(DAY, '16:55')}')`);
    const st = await hoursBackfillStatus(fresh.d1);
    assert.deepEqual(st, { pending_entries: 1, pending_days: 1 }, 'only project 1');
    await runHoursBackfill(fresh.d1, { maxDays: 10 });
    const marks = fresh.db.prepare(`SELECT project_id FROM repair_marks`).all() as { project_id: number }[];
    assert.deepEqual(marks.map((m) => m.project_id), [1]);
    const hours = (fresh.db.prepare(`SELECT hours FROM repair_entries WHERE mark_id IS NOT NULL`).get() as { hours: number }).hours;
    assert.equal(hours, 4, 'the FURNITURE LAND fill in the same sitting keeps half of the day');
  });

  test('0353 puts FURNITURE LAND back on the weighted % tree, every other ZA stays on hours', async () => {
    const fresh = freshDbWith49();
    fresh.db.exec(readFileSync(new URL('../../migrations/0353_furniture_land_back_to_percent.sql', import.meta.url), 'utf8'));
    const rows = fresh.db
      .prepare(`SELECT id, progress_mode AS m, hours_progress_base AS b FROM projects WHERE category = 'ZA' ORDER BY id`)
      .all() as { id: number; m: string; b: number | null }[];
    assert.deepEqual(
      rows.map((r) => [r.id, r.m, r.b]),
      [[1, 'hours', null], [49, 'tasks', null]],
    );
    // Хувийн бөглөлт нь нөхөлтөөр тэмдэглэгээ болохгүй, өдрийн хуваарилалтад энгийн ажил.
    fresh.db.exec(`INSERT INTO progress_entries (task_id, user_id, percentage, date, created_at) VALUES (4901, 1, 100, '${DAY}', '${ubAt(DAY, '16:55')}')`);
    assert.deepEqual(await hoursBackfillStatus(fresh.d1), { pending_entries: 0, pending_days: 0 });
  });

  /** 0348 → #49-ийн бүтэц → 0349 (миграцын дараалал проддой ижил). */
  function freshDbWith49(): { db: DatabaseSync; d1: D1Database } {
    const { db } = freshDbNo0349();
    seed49(db);
    db.exec(readFileSync(new URL('../../migrations/0349_repair_progress_carryover.sql', import.meta.url), 'utf8'));
    return { db, d1: fakeD1(db) };
  }
});

/** freshDb-тэй ижил боловч 0349-гүй (0349-ийг тестийн өгөгдлийн ДАРАА ажиллуулахад). */
function freshDbNo0349(): { db: DatabaseSync } {
  const { db } = freshDb();
  // freshDb 0349-ийг аль хэдийн ажиллуулсан: баганыг хасаад дахин ажиллуулах боломжтой болгоно.
  db.exec(`ALTER TABLE projects DROP COLUMN hours_progress_base`);
  return { db };
}
