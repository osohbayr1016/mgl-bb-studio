/**
 * lib/repairHours.ts — засварын АЖИЛЛАСАН ЦАГИЙН хураангуй (2026-09-24).
 * Цэвэр функц + 0341 миграцыг node:sqlite дээр бодитоор ажиллуулж, routes/repair.ts
 * `GET /hours`-ийн SQL-тэй ижил GROUP BY-г тулгана.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { roundHours, summarizeRepairHours, type RepairHoursRow } from './repairHours.ts';

describe('roundHours', () => {
  test('removes floating-point residue, keeps two decimals', () => {
    assert.equal(roundHours(9.3 + 9.9), 19.2);
    assert.equal(roundHours(0.1 + 0.2), 0.3);
    assert.equal(roundHours(1.005), 1);
    assert.equal(roundHours(Number.NaN), 0);
  });
});

describe('summarizeRepairHours', () => {
  test('empty → zeros, no people, no tasks', () => {
    assert.deepEqual(summarizeRepairHours([]), {
      total_hours: 0,
      entry_count: 0,
      people: [],
      tasks: [],
      unlinked_hours: 0,
    });
  });

  test('«А — 3 цаг, Б — 5 цаг»: people sorted by hours desc, per-task split kept', () => {
    const rows: RepairHoursRow[] = [
      { user_id: 1, full_name: 'А', task_id: 10, hours: 2, entries: 1, last_date: '2026-09-20' },
      { user_id: 1, full_name: 'А', task_id: null, hours: 1, entries: 1, last_date: '2026-09-22' },
      { user_id: 2, full_name: 'Б', task_id: 10, hours: 3, entries: 2, last_date: '2026-09-21' },
      { user_id: 2, full_name: 'Б', task_id: 11, hours: 2, entries: 1, last_date: '2026-09-19' },
    ];
    const s = summarizeRepairHours(rows);
    assert.equal(s.total_hours, 8);
    assert.equal(s.entry_count, 5);
    assert.equal(s.unlinked_hours, 1);
    assert.deepEqual(
      s.people.map((p) => [p.full_name, p.hours, p.entries, p.last_date]),
      [
        ['Б', 5, 3, '2026-09-21'],
        ['А', 3, 2, '2026-09-22'],
      ],
    );
    assert.deepEqual(
      s.tasks.map((t) => [t.task_id, t.hours, t.people.map((p) => `${p.full_name}:${p.hours}`)]),
      [
        [10, 5, ['Б:3', 'А:2']],
        [11, 2, ['Б:2']],
      ],
    );
    // Σ per-person = total; Σ per-task + unlinked = total.
    assert.equal(roundHours(s.people.reduce((a, p) => a + p.hours, 0)), s.total_hours);
    assert.equal(roundHours(s.tasks.reduce((a, t) => a + t.hours, 0) + s.unlinked_hours), s.total_hours);
  });

  test('ties break by name, then id; null name becomes empty string', () => {
    const s = summarizeRepairHours([
      { user_id: 3, full_name: 'Бат', task_id: null, hours: 4, entries: 1, last_date: null },
      { user_id: 4, full_name: 'Ану', task_id: null, hours: 4, entries: 1, last_date: null },
      { user_id: 5, full_name: null, task_id: null, hours: 1, entries: 1, last_date: null },
    ]);
    assert.deepEqual(
      s.people.map((p) => p.user_id),
      [4, 3, 5],
    );
    assert.equal(s.people[2]!.full_name, '');
    assert.equal(s.tasks.length, 0);
    assert.equal(s.unlinked_hours, 9);
  });
});

describe('migration 0341 + GET /hours SQL on node:sqlite', () => {
  test('task_id nullable, SET NULL on task delete, dangling id counts as unlinked', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE repair_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL, project_id INTEGER, repair_project_id INTEGER,
        description TEXT NOT NULL, hours REAL NOT NULL CHECK(hours > 0), date TEXT NOT NULL,
        CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))
      );
      INSERT INTO users VALUES (1, 'А'), (2, 'Б');
      INSERT INTO tasks VALUES (10, 'Огтлол'), (11, 'Фасад');
      INSERT INTO repair_entries (user_id, project_id, description, hours, date)
        VALUES (1, 71, 'хуучин тайлбар', 8, '2026-09-01');
    `);
    db.exec(readFileSync(new URL('../../migrations/0341_repair_entries_task.sql', import.meta.url), 'utf8'));
    db.exec(`
      INSERT INTO repair_entries (user_id, project_id, task_id, description, hours, date) VALUES
        (1, 71, 10, '', 3, '2026-09-20'),
        (2, 71, 10, '', 5, '2026-09-21'),
        (2, 71, 11, '', 2, '2026-09-22'),
        (2, 72, 11, '', 7, '2026-09-22');
    `);
    const sql = `SELECT re.user_id, u.full_name, t.id AS task_id,
                        SUM(re.hours) AS hours, COUNT(*) AS entries, MAX(re.date) AS last_date
                   FROM repair_entries re
                   JOIN users u      ON u.id = re.user_id
                   LEFT JOIN tasks t ON t.id = re.task_id
                  WHERE re.project_id = ?
                  GROUP BY re.user_id, t.id`;
    const run = () =>
      summarizeRepairHours(db.prepare(sql).all(71) as unknown as RepairHoursRow[]);

    const before = run();
    assert.equal(before.total_hours, 18);
    assert.equal(before.unlinked_hours, 8, 'the pre-0341 row stays, as project-level hours');
    assert.deepEqual(
      before.people.map((p) => [p.full_name, p.hours]),
      [
        ['А', 11],
        ['Б', 7],
      ],
    );
    assert.deepEqual(
      before.tasks.map((t) => [t.task_id, t.hours]),
      [
        [10, 8],
        [11, 2],
      ],
    );

    // ON DELETE SET NULL — hours survive, move to project level.
    db.exec('DELETE FROM tasks WHERE id = 11');
    const after = run();
    assert.equal(after.total_hours, 18);
    assert.equal(after.unlinked_hours, 10);
    assert.deepEqual(after.tasks.map((t) => t.task_id), [10]);

    // FK OFF (D1 runtime): a dangling id must not vanish either.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM tasks WHERE id = 10');
    const dangling = run();
    assert.equal(dangling.total_hours, 18);
    assert.equal(dangling.unlinked_hours, 18);
    assert.equal(dangling.tasks.length, 0);
  });
});
