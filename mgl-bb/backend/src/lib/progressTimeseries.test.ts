/**
 * `lib/progressTimeseries.ts` — нийт явцын график.  Цагаар бодогддог засварын
 * төсөл (`progress_mode = 'hours'`) ажилчдад олгосон хувийн хуримтлалаар
 * (суурь + Σ user_points.amount, олгосон УБ огноогоор, таазгүй — 2026-09-29)
 * зурагдах ёстой — толгойн «Бодит явц»-тай ижил тоо.  Ердийн (`tasks`) төсөл
 * жинлэсэн модоороо хэвээр.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// progressTimeseries.ts → reportWindows.ts → orgConfig.ts нь өргөтгөлгүй
// харьцангуй import-тэй тул resolver эхлээд, дараа нь dynamic import.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { snapshotProgressTimeseries, snapshotProgressTimeseriesRanged } = await import(
  './progressTimeseries.ts'
);

/** Minimal D1 shim over node:sqlite. */
function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
  });
  return { prepare: (sql: string) => mk(sql) } as unknown as D1Database;
}

function freshDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, progress_mode TEXT NOT NULL DEFAULT 'tasks',
      hours_progress_base REAL
    );
    CREATE TABLE repair_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, repair_project_id INTEGER,
      date TEXT NOT NULL, progress_pct REAL
    );
    CREATE TABLE user_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL DEFAULT 1,
      project_id INTEGER, repair_project_id INTEGER, amount REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'repair', awarded_at TEXT NOT NULL
    );
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER, team_id INTEGER, weight_percent REAL);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER, weight_percent REAL);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, component_id INTEGER, weight_percent REAL);
    CREATE TABLE project_team_shares (project_id INTEGER, team_id INTEGER, share_percent REAL);
    CREATE TABLE progress_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, date TEXT, percentage REAL,
      status TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return { db, d1: fakeD1(db) };
}

/** Нэг таск бүхий ердийн төсөл (share 100 × block 100 × task 100) + таскийн хувь. */
function seedTaskTree(db: DatabaseSync, projectId: number, pct: number, date: string): void {
  db.exec(`
    INSERT INTO blocks VALUES (${projectId}, ${projectId}, 1, 100);
    INSERT INTO drawings VALUES (${projectId}, ${projectId}, 100);
    INSERT INTO components VALUES (${projectId}, ${projectId});
    INSERT INTO tasks VALUES (${projectId}, ${projectId}, 100);
    INSERT INTO project_team_shares VALUES (${projectId}, 1, 100);
    INSERT INTO progress_entries (task_id, date, percentage, status)
      VALUES (${projectId}, '${date}', ${pct}, 'approved');
  `);
}

const pts = (series: { date: string; progress: number }[]) =>
  series.map((p) => `${p.date}=${p.progress}`);

describe('overall timeseries — hours-mode project', () => {
  test('cumulative Σ credited amount by UB award date, not the task tree nor progress_pct', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO projects VALUES (1, 'hours', NULL)`);
    // Таскийн хуучин хувь 30% — цагаар бодогддог төсөлд графикт ОРОХГҮЙ.
    seedTaskTree(db, 1, 30, '2026-09-01');
    db.exec(`
      INSERT INTO user_points (project_id, amount, source, awarded_at) VALUES
        (1, 2.5, 'progress', '2026-09-01 03:00:00'),
        (1, 1.5, 'repair',   '2026-08-31 17:30:00'), -- УБ 09-01 01:30 → 09-01
        (1, 1,   'repair',   '2026-09-03 08:00:00');
      INSERT INTO user_points (repair_project_id, amount, awarded_at) VALUES (1, 50, '2026-09-02 03:00:00');
      INSERT INTO repair_entries (project_id, date, progress_pct) VALUES (1, '2026-09-02', 40);
    `);
    const series = await snapshotProgressTimeseries(d1, 1, '', '2026-09-04');
    assert.deepEqual(pts(series), [
      '2026-09-01=4',
      '2026-09-02=4',
      '2026-09-03=5',
      '2026-09-04=5',
    ]);
  });

  test('ranged window folds in points credited before `from`', async () => {
    const { db, d1 } = freshDb();
    db.exec(`
      INSERT INTO projects VALUES (1, 'hours', NULL);
      INSERT INTO user_points (project_id, amount, awarded_at) VALUES
        (1, 4, '2026-09-01 03:00:00'), (1, 0.5, '2026-09-05 03:00:00');
    `);
    const series = await snapshotProgressTimeseriesRanged(d1, 1, '2026-09-04', '2026-09-05');
    assert.deepEqual(pts(series), ['2026-09-04=4', '2026-09-05=4.5']);
  });

  test('hours_progress_base is added and the line is NOT capped at 100', async () => {
    const { db, d1 } = freshDb();
    db.exec(`
      INSERT INTO projects VALUES (1, 'hours', 98);
      INSERT INTO user_points (project_id, amount, awarded_at) VALUES
        (1, 1.5, '2026-09-01 03:00:00'), (1, 1.5, '2026-09-02 03:00:00');
    `);
    const series = await snapshotProgressTimeseries(d1, 1, '', '2026-09-02');
    assert.deepEqual(pts(series), ['2026-09-01=99.5', '2026-09-02=101']);
  });

  test('no hours logged and no base → empty curve (chart empty state)', async () => {
    const { db, d1 } = freshDb();
    db.exec(`INSERT INTO projects VALUES (1, 'hours', NULL)`);
    seedTaskTree(db, 1, 30, '2026-09-01');
    assert.deepEqual(await snapshotProgressTimeseries(d1, 1, '', '2026-09-04'), []);
  });
});

describe('overall timeseries — tasks-mode project is unchanged', () => {
  test('weighted task tree, repair entries ignored', async () => {
    const { db, d1 } = freshDb();
    db.exec(`
      INSERT INTO projects VALUES (2, 'tasks', NULL);
      INSERT INTO repair_entries (project_id, date, progress_pct) VALUES (2, '2026-09-01', 7);
    `);
    seedTaskTree(db, 2, 40, '2026-09-02');
    const series = await snapshotProgressTimeseries(d1, 2, '', '2026-09-03');
    assert.deepEqual(pts(series), ['2026-09-02=40', '2026-09-03=40']);
  });
});
