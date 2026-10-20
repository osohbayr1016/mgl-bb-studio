// Migration 0368 + 0369 («таск дээрх нэр = одоо хийж буй хүн», 2026-10-01) — БОДИТ
// миграцын файлуудыг SQLite дээр ажиллуулж, хэн бүртгэлд үлдэх, хэн арилах, оноо/явц
// хөндөгдөхгүйг шалгана.  Хүснэгтийн хэлбэр нь production-ийн хамаарах баганууд л.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const mig = (f: string) => readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8');

function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, component_id INTEGER, name TEXT,
      weight_percent REAL, assigned_to INTEGER);
    CREATE TABLE task_assignees (task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), self_joined INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (task_id, user_id));
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER,
      percentage REAL, date TEXT, status TEXT, is_rest_day INTEGER DEFAULT 0, defer_next_day INTEGER DEFAULT 0,
      is_baseline INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO users VALUES (1, 'Бат'), (2, 'Сараа'), (3, 'Дорж'), (4, 'Цэцэг'), (5, 'Админ');
    INSERT INTO blocks VALUES (1, 10, 'Блок'), (2, 10, 'Хурлын даалгавар');
    INSERT INTO drawings VALUES (1, 1), (2, 2);
    INSERT INTO components VALUES (1, 1), (2, 2);
    -- 101: Бат «авсан» ч ажиллаагүй (цэвэр эзэмшил, 30 хоногийн өмнө)
    -- 102: Сараа хувь оруулсан
    -- 103: Дорж зөвхөн «Маргааш хийнэ» бичсэн (жинхэнэ ажил биш)
    -- 104: Цэцэг-ийн нэрээр админ «Анхны явц» оруулсан (оноо нь Цэцэгт)
    -- 105: хурлын даалгавар — Бат, Дорж оноогдсон, ажиллаагүй
    -- 106: Сараа бүртгэлд байхгүй ч хувь оруулсан (хуучин assigned_to-оор)
    -- 107: Дорж албан таймер эхлүүлсэн (0361), бүртгэлд байхгүй
    INSERT INTO tasks VALUES
      (101, 1, 'A', 10, 1), (102, 1, 'B', 10, 2), (103, 1, 'C', 10, 3), (104, 1, 'D', 10, 4),
      (105, 2, 'Хурлын', 0, 1), (106, 1, 'E', 10, 2), (107, 1, 'F', 10, NULL);
    INSERT INTO task_assignees (task_id, user_id, created_at) VALUES
      (101, 1, '2026-09-01 08:00:00'), (102, 2, '2026-09-02 08:00:00'),
      (103, 3, '2026-09-03 08:00:00'), (104, 4, '2026-09-04 08:00:00'),
      (105, 1, '2026-09-05 08:00:00'), (105, 3, '2026-09-05 08:00:00');
    INSERT INTO progress_entries (task_id, user_id, percentage, date, status, defer_next_day, is_baseline, created_at) VALUES
      (102, 2, 40, '2026-09-10', 'approved', 0, 0, '2026-09-10 10:00:00'),
      (103, 3, 0, '2026-09-11', 'approved', 1, 0, '2026-09-11 10:00:00'),
      (104, 5, 30, '2026-09-12', 'approved', 0, 1, '2026-09-12 10:00:00'),
      (106, 2, 20, '2026-09-13', 'approved', 0, 0, '2026-09-13 10:00:00');
  `);
  db.exec(mig('0350_task_hold_periods.sql'));
  db.exec(mig('0361_task_timer.sql'));
  db.exec(`
    INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms, start_reason,
      end_reason, started_by, ended_by, start_request_id, end_request_id, created_at, updated_at)
    VALUES (3, 107, 10, '2026-09-29T01:00:00.000Z', '2026-09-29T02:00:00.000Z', 3600000, 'start', 'pause', 3, 3,
      'r', 're', '2026-09-29T01:00:00.000Z', '2026-09-29T02:00:00.000Z');
  `);
  return db;
}

const registry = (db: DatabaseSync) =>
  (db.prepare('SELECT task_id, user_id FROM task_assignees ORDER BY task_id, user_id').all() as Array<{
    task_id: number;
    user_id: number;
  }>).map((r) => [r.task_id, r.user_id]);

test('0368: «Анхны явц»-ын онооны эзэн тэр мөчийн хариуцагчаар хөлдөнө', () => {
  const db = seed();
  db.exec(mig('0368_task_live_take.sql'));
  const row = db.prepare('SELECT credit_user_id FROM progress_entries WHERE is_baseline = 1').get() as {
    credit_user_id: number;
  };
  assert.equal(row.credit_user_id, 4);
  const normal = db.prepare('SELECT credit_user_id FROM progress_entries WHERE task_id = 102').get() as {
    credit_user_id: number | null;
  };
  assert.equal(normal.credit_user_id, null, 'энгийн бичлэгт хамаагүй');
});

test('0369: цэвэр эзэмшил арилна (түүх хадгалагдана), ажилласан хүмүүс бүртгэлд, хурлын даалгавар хөндөгдөхгүй', () => {
  const db = seed();
  db.exec(mig('0368_task_live_take.sql'));
  const pointsBefore = db.prepare('SELECT COUNT(*) AS n, SUM(percentage) AS s FROM progress_entries').get();
  db.exec(mig('0369_task_names_reset.sql'));
  assert.deepEqual(registry(db), [
    [102, 2], // хувь оруулсан — үлдэнэ
    [104, 4], // «Анхны явц»-ын онооны эзэн — үлдэнэ
    [105, 1], // хурлын даалгавар — хөндөгдөхгүй
    [105, 3],
    [106, 2], // хувь оруулсан ч бүртгэлгүй байсан — нэмэгдэнэ
    [107, 3], // албан таймер эхлүүлсэн — нэмэгдэнэ
  ]);
  // Бат (101) ба Дорж (103, зөвхөн «Маргааш хийнэ») — арилж, эзэмшил нь түүхэнд.
  const holds = db
    .prepare('SELECT task_id, user_id, started_at FROM task_hold_periods ORDER BY task_id')
    .all() as Array<{ task_id: number; user_id: number; started_at: string }>;
  assert.deepEqual(
    holds.map((h) => [h.task_id, h.user_id, h.started_at]),
    [
      [101, 1, '2026-09-01 08:00:00'],
      [103, 3, '2026-09-03 08:00:00'],
    ],
  );
  // Нэмэгдсэн мөрийн огноо = анх ажилласан агшин.
  const added = db.prepare('SELECT created_at FROM task_assignees WHERE task_id = 107').get() as { created_at: string };
  assert.equal(added.created_at, '2026-09-29 01:00:00');
  // assigned_to — хурлын даалгавраас бусад нь хоосон.
  const scalar = (db.prepare('SELECT id, assigned_to FROM tasks ORDER BY id').all() as Array<{
    id: number;
    assigned_to: number | null;
  }>).map((r) => [r.id, r.assigned_to]);
  assert.deepEqual(scalar, [
    [101, null],
    [102, null],
    [103, null],
    [104, null],
    [105, 1],
    [106, null],
    [107, null],
  ]);
  // Бичлэг хөндөгдөөгүй.
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n, SUM(percentage) AS s FROM progress_entries').get(), pointsBefore);
});

test('0369 дахин ажиллавал (idempotent) юу ч өөрчлөгдөхгүй', () => {
  const db = seed();
  db.exec(mig('0368_task_live_take.sql'));
  db.exec(mig('0369_task_names_reset.sql'));
  const reg = registry(db);
  const holds = (db.prepare('SELECT COUNT(*) AS n FROM task_hold_periods').get() as { n: number }).n;
  db.exec(mig('0369_task_names_reset.sql'));
  assert.deepEqual(registry(db), reg);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM task_hold_periods').get() as { n: number }).n, holds);
});
