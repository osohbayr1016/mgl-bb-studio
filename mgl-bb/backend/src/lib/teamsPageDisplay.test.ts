/**
 * `lib/teamsPageDisplay.ts`-ийн тест.  Импортгүй, цэвэр модуль тул
 * `registerHooks` шаардлагагүй.  SQL-ийг бодит `node:sqlite` дээр ажиллуулж
 * шилжүүлэг, буцалт (код олдохгүй), унтраалт гурвыг шалгана.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  TEAMS_PAGE_TEAM_OVERRIDES,
  isTeamsView,
  primaryTeamSql,
  primaryTeamCodeSql,
  type TeamsPageOverride,
} from './teamsPageDisplay.ts';

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE users (id INTEGER PRIMARY KEY, status TEXT DEFAULT 'active');
    CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER, is_primary INTEGER);
    INSERT INTO teams VALUES (5, 'TSAH', 5), (7, 'AU', 7);
    INSERT INTO users (id) VALUES (41), (45), (50);
    INSERT INTO user_teams VALUES (41, 7, 1), (41, 5, 0), (45, 7, 1), (45, 5, 0), (50, 7, 1);
  `);
  return db;
}

const FALLBACK = `(SELECT tm.code FROM user_teams ut JOIN teams tm ON tm.id = ut.team_id
  WHERE ut.user_id = u.id ORDER BY ut.is_primary DESC, tm.sort_order, tm.id LIMIT 1)`;

const rows = (db: DatabaseSync, sql: string) =>
  (db.prepare(sql).all() as Array<{ user_id: number; team_id: number }>)
    .map((r) => `${r.user_id}:${r.team_id}`)
    .sort();

test('бүртгэлийн жагсаалт нь хүлээгдсэн хоёр хүн, хоёулаа TSAH', () => {
  assert.deepEqual(
    TEAMS_PAGE_TEAM_OVERRIDES.map((o) => `${o.userId}→${o.teamCode}`),
    ['41→TSAH', '45→TSAH'],
  );
});

test('isTeamsView зөвхөн "1"-д үнэн', () => {
  assert.equal(isTeamsView('1'), true);
  assert.equal(isTeamsView('true'), false);
  assert.equal(isTeamsView(undefined), false);
});

test('teamsView=false → хуучин is_primary харьцаа, шилжүүлэггүй', () => {
  const db = fixture();
  const sql = `SELECT ut.user_id, ut.team_id FROM users u JOIN ${primaryTeamSql({ teamsView: false })} ut ON ut.user_id = u.id`;
  assert.deepEqual(rows(db, sql), ['41:7', '45:7', '50:7']);
  assert.equal(primaryTeamCodeSql('u.id', FALLBACK, { teamsView: false }), FALLBACK);
});

test('teamsView=true → жагсаалтын хүн TSAH-д, бусад нь хэвээр; user_teams хөндөгдөөгүй', () => {
  const db = fixture();
  const sql = `SELECT ut.user_id, ut.team_id FROM users u JOIN ${primaryTeamSql({ teamsView: true })} ut ON ut.user_id = u.id`;
  assert.deepEqual(rows(db, sql), ['41:5', '45:5', '50:7']);
  const codes = db
    .prepare(`SELECT u.id AS user_id, ${primaryTeamCodeSql('u.id', FALLBACK, { teamsView: true })} AS code FROM users u ORDER BY u.id`)
    .all() as Array<{ user_id: number; code: string }>;
  // node:sqlite мөр нь null-prototype тул объектоор биш, мөрөөр тулгана.
  assert.deepEqual(
    codes.map((r) => `${r.user_id}:${r.code}`),
    ['41:TSAH', '45:TSAH', '50:AU'],
  );
  // Нэг хүн = нэг мөр: шилжүүлэг хоёр дахь мөр үүсгэхгүй (нүдний нийлбэр ≠ толгойн тоо болохгүй).
  assert.equal(rows(db, sql).length, 3);
  assert.deepEqual(
    (db.prepare('SELECT user_id, team_id, is_primary FROM user_teams ORDER BY user_id, team_id').all() as unknown[]).length,
    5,
  );
});

test('багийн код олдохгүй бол жинхэнэ баг руу буцна — хүн алга болохгүй', () => {
  const db = fixture();
  const list: TeamsPageOverride[] = [{ userId: 41, teamCode: 'GONE' }];
  const sql = `SELECT ut.user_id, ut.team_id FROM users u JOIN ${primaryTeamSql({ teamsView: true }, list)} ut ON ut.user_id = u.id`;
  assert.deepEqual(rows(db, sql), ['41:7', '45:7', '50:7']);
  const code = db
    .prepare(`SELECT ${primaryTeamCodeSql('u.id', FALLBACK, { teamsView: true }, list)} AS code FROM users u WHERE u.id = 41`)
    .get() as { code: string };
  assert.equal(code.code, 'AU');
});

test('хоосон жагсаалт = унтраалттай адил', () => {
  assert.equal(primaryTeamSql({ teamsView: true }, []), primaryTeamSql({ teamsView: false }));
  assert.equal(primaryTeamCodeSql('u.id', FALLBACK, { teamsView: true }, []), FALLBACK);
});
