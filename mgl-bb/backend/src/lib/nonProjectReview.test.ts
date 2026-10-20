/**
 * `lib/nonProjectReview.ts`-ийн тест + 0343/0344 миграцыг БОДИТ SQLite дээр
 * ажиллуулна: `user_points`-ийн шинэ CHECK (төслийн бус мөр зөвшөөрөгдөж,
 * хуучин дүрэм хэвээр), хуучин мөр бүтэн хуулагдсан эсэх, шатны SQL нь
 * `entryStage`-тэй ижил мөрүүдийг сонгох эсэх.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// `nonProjectReview.ts` нь `./nonProjectWork`-ийг өргөтгөлгүй импортлодог —
// `leaveWindow.test.ts`-ийн адил зөвхөн тестийн хүрээнд `.ts` руу буулгана.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  NON_PROJECT_POINTS_SOURCE,
  REVIEW_FILTERS,
  STAGE_WHERE,
  filterWhere,
  minutesToHours,
  normalizeReviewNote,
  parseReviewFilter,
  reviewBlock,
  workDateAwardedAt,
} = await import('./nonProjectReview.ts');
const { entryStage } = await import('./nonProjectWork.ts');

const migration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

test('шүүлт: танихгүй утга → шалгах ёстой нь (awaiting_review)', () => {
  assert.equal(parseReviewFilter(undefined), 'awaiting_review');
  assert.equal(parseReviewFilter('pending'), 'awaiting_review');
  for (const f of REVIEW_FILTERS) assert.equal(parseReviewFilter(f), f);
  assert.equal(filterWhere('all'), '1 = 1');
});

test('шийдвэр: зөвхөн илгээсэн (тайлбар + цагтай), шийдэгдээгүй мөр', () => {
  const at = '10:00';
  assert.equal(reviewBlock({ status: 'pending', report: 'Архивын хавтас янзалсан', start_time: at }), null);
  assert.equal(reviewBlock({ status: 'pending', report: null, start_time: at })?.code, 'NOT_SUBMITTED');
  // Хоосон зай = бичээгүй — `entryStage`-тэй ижил.
  assert.equal(reviewBlock({ status: 'pending', report: '   ', start_time: at })?.code, 'NOT_SUBMITTED');
  // Ирцэд сонгосон, цаг оруулаагүй мөр (2026-09-28) — тайлбартай ч илгээгдээгүй.
  assert.equal(reviewBlock({ status: 'pending', report: 'хийсэн', start_time: null })?.code, 'NOT_SUBMITTED');
  assert.equal(reviewBlock({ status: 'approved', report: 'x', start_time: at })?.code, 'ALREADY_DECIDED');
  assert.equal(reviewBlock({ status: 'rejected', report: 'x', start_time: at })?.code, 'ALREADY_DECIDED');
});

test('шийдвэрийн тэмдэглэл: сонголттой, тайрсан, 1000 тэмдэгт', () => {
  assert.equal(normalizeReviewNote(undefined), null);
  assert.equal(normalizeReviewNote('   '), null);
  assert.equal(normalizeReviewNote('  зөв  '), 'зөв');
  assert.equal(normalizeReviewNote('ё'.repeat(1500))?.length, 1000);
});

test('минут → цаг (засварын томьёо цагаар)', () => {
  assert.equal(minutesToHours(480), 8);
  assert.equal(minutesToHours(90), 1.5);
  assert.equal(minutesToHours(0), 0);
  assert.equal(minutesToHours(Number.NaN), 0);
});

/** 0194-ийн дараах БОДИТ `user_points` (prod хуулбарын sqlite_master) + эцэг хүснэгтүүд. */
function dbBefore0343() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE projects (id INTEGER PRIMARY KEY);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY);
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY);
    CREATE TABLE repair_projects (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1), (2);
    INSERT INTO projects (id) VALUES (10);
    INSERT INTO repair_projects (id) VALUES (20);
    CREATE TABLE "user_points" (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id)             ON DELETE CASCADE,
      project_id        INTEGER          REFERENCES projects(id)          ON DELETE CASCADE,
      task_id           INTEGER          REFERENCES tasks(id)             ON DELETE SET NULL,
      progress_entry_id INTEGER          REFERENCES progress_entries(id)  ON DELETE SET NULL,
      amount            REAL    NOT NULL,
      delta_pct         REAL    NOT NULL,
      assignee_count    INTEGER NOT NULL,
      awarded_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      awarded_by        INTEGER          REFERENCES users(id),
      source            TEXT    NOT NULL DEFAULT 'progress',
      repair_entry_id   INTEGER,
      repair_project_id INTEGER          REFERENCES repair_projects(id),
      CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))
    );
    CREATE INDEX idx_user_points_user_date ON user_points(user_id, awarded_at);
    INSERT INTO user_points (user_id, project_id, amount, delta_pct, assignee_count, awarded_at, awarded_by)
      VALUES (1, 10, 0.5, 0.25, 1, '2026-09-01 03:00:00', 1);
    INSERT INTO user_points (user_id, repair_project_id, amount, delta_pct, assignee_count, source, repair_entry_id)
      VALUES (2, 20, 0.1, 0.1, 1, 'repair', 7);
  `);
  db.exec(migration('0342_non_project_work.sql'));
  return db;
}

test('0343: хуучин мөрүүд бүтэн хуулагдана, DEFAULT-ууд амьд', () => {
  const db = dbBefore0343();
  db.exec(migration('0343_user_points_non_project.sql'));
  db.exec(migration('0344_non_project_work_review.sql'));
  const rows = db.prepare('SELECT * FROM user_points ORDER BY id').all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { ...rows[0] },
    {
      id: 1, user_id: 1, project_id: 10, task_id: null, progress_entry_id: null, amount: 0.5, delta_pct: 0.25,
      assignee_count: 1, awarded_at: '2026-09-01 03:00:00', awarded_by: 1, source: 'progress',
      repair_entry_id: null, repair_project_id: null, non_project_work_id: null,
    },
  );
  assert.equal(rows[1]?.source, 'repair');
  assert.equal(rows[1]?.repair_project_id, 20);
  // progress.ts-ийн INSERT `source`, `awarded_at`-ыг нэрлэдэггүй — DEFAULT хэвээр байх ЁСТОЙ.
  db.prepare('INSERT INTO user_points (user_id, project_id, amount, delta_pct, assignee_count) VALUES (1, 10, 1, 1, 1)').run();
  const last = db.prepare('SELECT source, awarded_at FROM user_points ORDER BY id DESC LIMIT 1').get() as { source: string; awarded_at: string };
  assert.equal(last.source, 'progress');
  assert.match(last.awarded_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  // 0194-ийн дөрвөн индекс + 0344-ийн partial индекс.
  const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_points' AND name LIKE 'idx_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  assert.deepEqual(idx, [
    'idx_user_points_awarded',
    'idx_user_points_non_project',
    'idx_user_points_project',
    'idx_user_points_repair_project',
    'idx_user_points_user_date',
  ]);
});

test('0343: шинэ CHECK — төслийн бус мөр зөвшөөрөгдөнө, хуучин дүрэм хэвээр', () => {
  const db = dbBefore0343();
  db.exec(migration('0343_user_points_non_project.sql'));
  const ins = (cols: string, vals: string) =>
    db.prepare(`INSERT INTO user_points (user_id, amount, delta_pct, assignee_count, ${cols}) VALUES (1, 0.2, 0.2, 1, ${vals})`);

  // Зөв: төсөл ч, засварын төсөл ч биш, бүртгэлтэй холбоотой.
  ins('source, non_project_work_id', `'${NON_PROJECT_POINTS_SOURCE}', 5`).run();
  // Буруу: бүртгэлгүй төслийн бус мөр.
  assert.throws(() => ins('source', `'${NON_PROJECT_POINTS_SOURCE}'`).run(), /CHECK/);
  // Буруу: төслийн бус мөр төсөлтэй.
  assert.throws(() => ins('source, project_id, non_project_work_id', `'${NON_PROJECT_POINTS_SOURCE}', 10, 5`).run(), /CHECK/);
  // Хуучин дүрэм: эзэнгүй progress / хоёр эзэнтэй repair — хэвээр хориотой.
  assert.throws(() => ins('source', `'progress'`).run(), /CHECK/);
  assert.throws(() => ins('source, project_id, repair_project_id', `'repair', 10, 20`).run(), /CHECK/);
});

test('шатны SQL = entryStage (бодит 0342 хүснэгт дээр)', () => {
  const db = dbBefore0343();
  db.exec(migration('0343_user_points_non_project.sql'));
  db.exec(migration('0344_non_project_work_review.sql'));
  db.exec(migration('0356_non_project_timeless.sql'));
  // [status, report, цагтай эсэх] — цаггүй мөр = ирцэд сонгосон (0356/0357).
  const rows: Array<[string, string | null, boolean]> = [
    ['pending', null, true],
    ['pending', '', true],
    ['pending', '   ', true],
    ['pending', 'Хавтас янзалсан', true],
    ['pending', 'Хавтас янзалсан', false],
    ['pending', null, false],
    ['approved', 'x', true],
    ['rejected', 'y', true],
    ['rejected', null, false],
  ];
  const timed = db.prepare(
    `INSERT INTO non_project_work_entries (user_id, date, category, start_time, end_time, minutes, report, status)
     VALUES (1, '2026-09-24', 'drawing_printing', '09:00', '10:00', 60, ?, ?)`,
  );
  const timeless = db.prepare(
    `INSERT INTO non_project_work_entries (user_id, date, category, minutes, report, status)
     VALUES (1, '2026-09-24', 'drawing_printing', 0, ?, ?)`,
  );
  for (const [status, report, hasTime] of rows) (hasTime ? timed : timeless).run(report, status);
  const all = db.prepare('SELECT id, status, report, start_time FROM non_project_work_entries').all() as Array<{
    id: number;
    status: 'pending' | 'approved' | 'rejected';
    report: string | null;
    start_time: string | null;
  }>;
  for (const [stage, where] of Object.entries(STAGE_WHERE)) {
    const sqlIds = (db.prepare(`SELECT e.id FROM non_project_work_entries e WHERE ${where} ORDER BY e.id`).all() as Array<{ id: number }>).map((r) => r.id);
    const jsIds = all.filter((r) => entryStage(r) === stage).map((r) => r.id);
    assert.deepEqual(sqlIds, jsIds, stage);
  }
  const allIds = (db.prepare(`SELECT e.id FROM non_project_work_entries e WHERE ${filterWhere('all')}`).all() as unknown[]).length;
  assert.equal(allIds, rows.length);
});

test('оноо АЖЛЫН ӨДӨРТ: 22-нд хийсэн ажлыг 24-нд баталбал awarded_at нь 22-ны (УБ) дуусах цаг', () => {
  const now = Date.parse('2026-09-24T05:00:00Z'); // УБ 13:00, 24-ний өдөр
  // 22-ны 16:00 УБ = 08:00 UTC — УБ огноо 22 хэвээр.
  assert.equal(workDateAwardedAt({ date: '2026-09-22', end_time: '16:00' }, 480, now), '2026-09-22 08:00:00');
  // Өмнөх 7 хоног / сар: огноо нь ажлын өдрийнх.
  assert.equal(workDateAwardedAt({ date: '2026-08-31', end_time: '18:00' }, 480, now), '2026-08-31 10:00:00');
  // УБ 07:00 = өмнөх өдрийн 23:00 UTC — тайлангууд +8-аар буцааж 22 гэж уншина.
  assert.equal(workDateAwardedAt({ date: '2026-09-22', end_time: '07:00' }, 480, now), '2026-09-21 23:00:00');
});

test('оноо АЖЛЫН ӨДӨРТ: өнөөдрийн ажлыг дуусахаас нь өмнө баталбал одоогийн мөч (ирээдүйн огноо биш)', () => {
  const now = Date.parse('2026-09-24T05:00:00Z'); // УБ 13:00
  assert.equal(workDateAwardedAt({ date: '2026-09-24', end_time: '18:00' }, 480, now), '2026-09-24 05:00:00');
  assert.equal(workDateAwardedAt({ date: '2026-09-24', end_time: '11:30' }, 480, now), '2026-09-24 03:30:00');
});

test('оноо АЖЛЫН ӨДӨРТ: буруу огноо/цаг → null (дуудагч одоогоор бичнэ)', () => {
  assert.equal(workDateAwardedAt({ date: '24/09/2026', end_time: '10:00' }, 480, Date.now()), null);
  assert.equal(workDateAwardedAt({ date: '2026-09-24', end_time: '' }, 480, Date.now()), null);
});
