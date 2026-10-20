import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  parseCompanionIds,
  personVisitsSql,
  planCompanionReplace,
  teamPeopleSql,
} from './asrCompanions.ts';

describe('parseCompanionIds', () => {
  test('drops the author and duplicates', () => {
    assert.deepEqual(parseCompanionIds([2, 2, '3', 1], 1), [2, 3]);
  });
  test('rejects junk', () => {
    assert.equal(parseCompanionIds(['x'], 1), null);
    assert.equal(parseCompanionIds({} as unknown, 1), null);
  });
});

describe('planCompanionReplace', () => {
  test('adds and removes', () => {
    const plan = planCompanionReplace([{ user_id: 2, red_book_verified_at: null }], [3]);
    assert.deepEqual(plan, { ok: true, add: [3], remove: [2] });
  });
  test('refuses to drop a verified red book', () => {
    const plan = planCompanionReplace([{ user_id: 2, red_book_verified_at: '2026-09-25' }], []);
    assert.equal(plan.ok, false);
  });
  test('caps the list', () => {
    const plan = planCompanionReplace([], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(plan.ok, false);
  });
});

describe('visit counts include companions', () => {
  test('each person who went is counted once per report, on their own team', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, profile_image TEXT, status TEXT, role TEXT);
      CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT, name_mn TEXT, name_en TEXT, sort_order INTEGER);
      CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER, is_primary INTEGER);
      CREATE TABLE author_supervision_reports (
        id INTEGER PRIMARY KEY, project_id INTEGER, author_id INTEGER, status TEXT, report_date TEXT
      );
      CREATE TABLE author_supervision_report_teams (report_id INTEGER, team_id INTEGER);
    `);
    db.exec(readFileSync(new URL('../../migrations/0351_asr_companions.sql', import.meta.url), 'utf8'));
    db.exec(`
      INSERT INTO teams VALUES (1, 'BA', 'Архитектур', NULL, 1), (2, 'BB', 'Бүтээц', NULL, 2);
      INSERT INTO users VALUES (1, 'А', NULL, 'active', 'engineer'), (2, 'Б', NULL, 'active', 'engineer'), (3, 'В', NULL, 'active', 'engineer');
      INSERT INTO user_teams VALUES (1, 1, 1), (2, 1, 1), (3, 2, 1);
      INSERT INTO author_supervision_reports VALUES (10, 7, 1, 'approved', '2026-09-20');
      INSERT INTO author_supervision_report_teams VALUES (10, 1), (10, 2);
      INSERT INTO asr_report_companions (report_id, user_id, sort_order) VALUES (10, 2, 0);
    `);
    const where = `r.project_id = ? AND r.status IN ('submitted','approved')`;
    const people = db.prepare(personVisitsSql(where)).all(7, 7) as { user_id: number; visits: number }[];
    assert.deepEqual(
      people.map((p) => p.user_id).sort(),
      [1, 2],
    );
    const teams = db.prepare(teamPeopleSql(where)).all(7, 7) as { team_code: string; user_id: number }[];
    const key = (r: { team_code: string; user_id: number }) => `${r.team_code}:${r.user_id}`;
    assert.deepEqual(teams.map(key).sort(), ['BA:1', 'BA:2', 'BB:1']);
    db.close();
  });
});
