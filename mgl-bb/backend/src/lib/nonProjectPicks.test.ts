/**
 * Ирцийн цэгт СОНГОСОН төслийн бус ажил (0356/0357) — БОДИТ SQLite дээр
 * 0047 + 0342 + 0344 + 0356 + 0357 миграцыг ажиллуулж шалгана.  Эзний дүрэм
 * (2026-09-28): ирцийн сонголт ЗӨВХӨН хяналт — цаг, хувь, ажилласан цагийн
 * нэмэлт бодогдохгүй (цаггүй мөр үргэлж 0 минут); ажилтан ажлаа дуусгаад
 * «Миний ажлууд»-аас цаг + «юу хийсэн»-ээ оруулахад л тооцогдоно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const { applyNonProjectPicks, loadEntryPicks, loadTodayForAttendance, syncNonProjectCredit } = await import(
  './nonProjectWorkStore.ts'
);
const { afterNonProjectChange } = await import('./nonProjectSync.ts');
type Pick = import('./nonProjectWork.ts').NonProjectPick;

const migration = (name: string) =>
  readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        params = args;
        return stmt;
      },
      async all() {
        return { results: db.prepare(sql).all(...(params as never[])) };
      },
      async first() {
        return db.prepare(sql).get(...(params as never[])) ?? null;
      },
      async run() {
        const r = db.prepare(sql).run(...(params as never[]));
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
}

const DAY = '2026-09-28';

function harness() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1), (2);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE attendance_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE user_points (id INTEGER PRIMARY KEY, non_project_work_id INTEGER);
    -- \`afterNonProjectChange\` өнөөдрийн засварын тэмдэглэгээг шалгадаг (0348).
    CREATE TABLE repair_marks (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT);
  `);
  raw.exec(migration('0047_attendance_checkpoints.sql'));
  raw.exec(migration('0342_non_project_work.sql'));
  raw.exec(migration('0344_non_project_work_review.sql'));
  raw.exec(migration('0356_non_project_timeless.sql'));
  raw.exec(migration('0357_attendance_checkpoint_non_project.sql'));
  const db = d1Shim(raw);

  /** Нэг цэг бүртгэж (0047-ийн UNIQUE-ээр upsert), сонголтыг хэрэгжүүлнэ. */
  const checkpoint = async (
    userId: number,
    type: 'morning' | 'afternoon' | 'clock_out',
    time: string,
    picks: Pick[],
  ) => {
    raw
      .prepare(
        `INSERT INTO attendance_project_checkpoints (user_id, date, checkpoint_type, recorded_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, date, checkpoint_type) DO UPDATE SET recorded_at = excluded.recorded_at`,
      )
      .run(userId, DAY, type, `${DAY}T${time}:00+08:00`);
    const cp = raw
      .prepare(`SELECT id FROM attendance_project_checkpoints WHERE user_id = ? AND date = ? AND checkpoint_type = ?`)
      .get(userId, DAY, type) as { id: number };
    await applyNonProjectPicks(db, { userId, date: DAY, checkpointId: cp.id, picks, now: `${DAY}T${time}:00+08:00` });
    await afterNonProjectChange(db, userId, DAY);
  };
  const entries = (userId: number) =>
    raw
      .prepare(
        `SELECT id, category, note, start_time, minutes, report, status
           FROM non_project_work_entries WHERE user_id = ? ORDER BY id`,
      )
      .all(userId) as Array<{
      id: number;
      category: string;
      note: string | null;
      start_time: string | null;
      minutes: number;
      report: string | null;
      status: string;
    }>;
  return { raw, db, checkpoint, entries };
}

const pick = (category: string, extra: Partial<Pick> = {}): Pick =>
  ({ category, note: null, report: null, ...extra }) as Pick;

test('гурван цэгт ижил ажил → НЭГ мөр, 0 минут (зөвхөн хяналт); анх сонгосон цаг хадгалагдана', async () => {
  const h = harness();
  await h.checkpoint(1, 'morning', '08:52', [pick('author_supervision')]);
  let rows = h.entries(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.start_time, null);
  assert.equal(rows[0]!.minutes, 0, 'ирцийн сонголтоос цаг бодохгүй');

  await h.checkpoint(1, 'afternoon', '14:05', [pick('author_supervision')]);
  // Хуучин клиент гарах үед «юу хийсэн» илгээж болно — хадгална, гэхдээ цаггүй тул илгээгдээгүй.
  await h.checkpoint(1, 'clock_out', '18:01', [pick('author_supervision', { report: 'Талбайд хяналт хийв' })]);
  rows = h.entries(1);
  assert.equal(rows.length, 1, 'дахин сонгоход шинэ мөр үүсэхгүй');
  assert.equal(rows[0]!.minutes, 0);
  assert.equal(rows[0]!.report, 'Талбайд хяналт хийв');

  const today = await loadTodayForAttendance(h.db, 1, DAY);
  assert.deepEqual(today[0]!.halves, ['am', 'pm']);
  assert.equal(today[0]!.picked_at, '08:52', 'хамгийн эрт сонгосон цэгийн цаг');
  assert.equal(today[0]!.active, true);
  assert.equal(today[0]!.timed, false);
  assert.equal(today[0]!.stage, 'needs_report', 'цаг оруулаагүй тул шалгуулахаар илгээгдээгүй');
});

test('«Миний ажлууд»-аас цаг оруулахад л минут + шалгалтын шат', async () => {
  const h = harness();
  await h.checkpoint(1, 'clock_out', '15:00', [pick('author_supervision')]);
  const [row] = h.entries(1);
  // = PATCH /api/non-project-work/:id (цаг + «юу хийсэн»).
  h.raw
    .prepare(
      `UPDATE non_project_work_entries
          SET start_time = '15:00', end_time = '17:00', minutes = 120, report = 'Талбайд хяналт хийв'
        WHERE id = ?`,
    )
    .run(row!.id);
  await afterNonProjectChange(h.db, 1, DAY);
  assert.equal(h.entries(1)[0]!.minutes, 120, 'цагтай мөрийн минут хөдлөхгүй');
  const [today] = await loadTodayForAttendance(h.db, 1, DAY);
  assert.equal(today!.stage, 'awaiting_review');
  assert.equal(today!.picked_at, '15:00');
});

test('14:00-оос өөр ажил сонговол хоёр мөр, хоёулаа 0 минут; идэвхтэй нь сүүлийнх', async () => {
  const h = harness();
  await h.checkpoint(2, 'morning', '09:00', [pick('author_supervision')]);
  await h.checkpoint(2, 'afternoon', '14:00', [pick('meeting')]);
  await h.checkpoint(2, 'clock_out', '18:00', [pick('meeting')]);
  const rows = h.entries(2);
  assert.deepEqual(
    rows.map((r) => [r.category, r.minutes]),
    [
      ['author_supervision', 0],
      ['meeting', 0],
    ],
  );
  const today = await loadTodayForAttendance(h.db, 2, DAY);
  assert.deepEqual(
    today.map((e) => [e.category, e.active, e.halves, e.picked_at]),
    [
      ['author_supervision', false, ['am'], '09:00'],
      ['meeting', true, ['pm'], '14:00'],
    ],
  );
});

test('«Бусад» тайлбараар таниулна (том/жижиг үсэг, зай үл тоогдоно)', async () => {
  const h = harness();
  await h.checkpoint(1, 'morning', '09:00', [
    pick('author_supervision'),
    pick('other', { note: 'Цаас хэвлэх' }),
  ]);
  assert.equal(h.entries(1).length, 2);
  await h.checkpoint(1, 'afternoon', '14:00', [pick('other', { note: '  цаас   ХЭВЛЭХ ' })]);
  assert.equal(h.entries(1).length, 2);
  // Өөр тайлбартай «Бусад» = өөр ажил.
  await h.checkpoint(1, 'clock_out', '18:00', [
    pick('other', { note: 'Цаас хэвлэх' }),
    pick('other', { note: 'Хурал' }),
  ]);
  const rows = h.entries(1);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.minutes),
    [0, 0, 0],
  );
});

test('цэгийг дахин бүртгэхэд тэр цэгийн сонголт солигдоно', async () => {
  const h = harness();
  await h.checkpoint(1, 'morning', '09:00', [pick('meeting')]);
  await h.checkpoint(1, 'morning', '10:30', [pick('document_exchange')]);
  const rows = h.entries(1);
  assert.deepEqual(
    rows.map((r) => r.category),
    ['meeting', 'document_exchange'],
  );
  const ids = rows.map((r) => r.id);
  const picks = await loadEntryPicks(h.db, ids);
  assert.equal(picks.get(rows[0]!.id), undefined, 'солигдсон сонголт арилна');
  assert.deepEqual(picks.get(rows[1]!.id), { halves: ['am'], pickedAt: '10:30' });
  // Хоосон сонголт = энэ цэгт төслийн бус ажил алга.
  await h.checkpoint(1, 'morning', '10:40', []);
  assert.equal((await loadEntryPicks(h.db, ids)).size, 0);
});

test('батлагдсан мөрийг дахин ашиглахгүй — ижил ажлыг дахин сонгоход ШИНЭ мөр', async () => {
  const h = harness();
  await h.checkpoint(1, 'morning', '09:00', [pick('meeting')]);
  h.raw.exec(
    `UPDATE non_project_work_entries SET status = 'approved', report = 'ok', start_time = '09:00', end_time = '11:00', minutes = 120`,
  );
  await h.checkpoint(1, 'afternoon', '14:00', [pick('meeting')]);
  const rows = h.entries(1);
  assert.deepEqual(
    rows.map((r) => [r.status, r.minutes]),
    [
      ['approved', 120],
      ['pending', 0],
    ],
  );
});

test('цагтай мөр сонгогдож болно — өөрийн цагаа хадгална', async () => {
  const h = harness();
  h.raw
    .prepare(
      `INSERT INTO non_project_work_entries (user_id, date, category, start_time, end_time, minutes)
       VALUES (1, ?, 'author_supervision', '15:00', '17:00', 120)`,
    )
    .run(DAY);
  // Цагтай ижил ангиллын мөр байхад цаггүй мөр үүсэхгүй — түүнийг сонгоно.
  await h.checkpoint(1, 'afternoon', '14:00', [pick('author_supervision'), pick('meeting')]);
  const rows = h.entries(1);
  assert.deepEqual(
    rows.map((r) => [r.category, r.start_time, r.minutes]),
    [
      ['author_supervision', '15:00', 120],
      ['meeting', null, 0],
    ],
  );
});

test('0356: хуучин мөр хадгалагдана, цагийн CHECK-ууд ажиллана', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1);
    CREATE TABLE user_points (id INTEGER PRIMARY KEY, non_project_work_id INTEGER);
  `);
  raw.exec(migration('0342_non_project_work.sql'));
  raw.exec(migration('0344_non_project_work_review.sql'));
  raw.exec(`
    INSERT INTO non_project_work_entries
      (user_id, date, category, start_time, end_time, minutes, report, status, computed_pct)
    VALUES (1, '2026-09-25', 'meeting', '10:00', '12:00', 120, 'хурал', 'approved', 0.25);
  `);
  raw.exec(migration('0356_non_project_timeless.sql'));
  const row = raw.prepare(`SELECT * FROM non_project_work_entries`).get() as Record<string, unknown>;
  assert.equal(row.start_time, '10:00');
  assert.equal(row.minutes, 120);
  assert.equal(row.computed_pct, 0.25);
  assert.equal(
    (raw.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'idx_npw_%'`).get() as { n: number }).n,
    2,
  );
  // Цаггүй мөр 0 минуттай байж болно.
  raw.exec(`INSERT INTO non_project_work_entries (user_id, date, category) VALUES (1, '2026-09-28', 'meeting')`);
  // Нэг цаг л бөглөсөн, эсвэл цагтай атлаа 0 минут — хоёулаа хориотой.
  assert.throws(() =>
    raw.exec(
      `INSERT INTO non_project_work_entries (user_id, date, category, start_time, minutes) VALUES (1, '2026-09-28', 'meeting', '10:00', 60)`,
    ),
  );
  assert.throws(() =>
    raw.exec(
      `INSERT INTO non_project_work_entries (user_id, date, category, start_time, end_time, minutes) VALUES (1, '2026-09-28', 'meeting', '10:00', '11:00', 0)`,
    ),
  );
});

/* ---- Ирцийн ажилласан цаг (0352) — цаггүй сонголт юу ч нэмэхгүй ---- */

function creditHarness() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, work_schedule TEXT);
    INSERT INTO users (id, work_schedule) VALUES (1, 'standard');
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO app_settings (key, value) VALUES
      ('lunch_enabled', '1'), ('lunch_start', '13:00'), ('lunch_end', '14:00');
    CREATE TABLE user_points (id INTEGER PRIMARY KEY, non_project_work_id INTEGER);
    CREATE TABLE repair_marks (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT);
    CREATE TABLE attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      hours_worked REAL,
      date TEXT NOT NULL
    );
  `);
  for (const m of [
    '0047_attendance_checkpoints.sql',
    '0199_user_work_schedules.sql',
    '0342_non_project_work.sql',
    '0344_non_project_work_review.sql',
    '0352_attendance_non_project_credit.sql',
    '0356_non_project_timeless.sql',
    '0357_attendance_checkpoint_non_project.sql',
  ]) {
    raw.exec(migration(m));
  }
  const db = d1Shim(raw);
  const at = (hhmm: string) => `${DAY}T${hhmm}:00+08:00`;
  const session = (inAt: string, outAt: string | null, hours: number | null) =>
    raw
      .prepare(`INSERT INTO attendance_sessions (user_id, clock_in, clock_out, hours_worked, date) VALUES (1, ?, ?, ?, ?)`)
      .run(at(inAt), outAt ? at(outAt) : null, hours, DAY);
  const pickAt = async (type: 'morning' | 'afternoon' | 'clock_out', time: string, picks: Pick[]) => {
    raw
      .prepare(`INSERT INTO attendance_project_checkpoints (user_id, date, checkpoint_type, recorded_at) VALUES (1, ?, ?, ?)`)
      .run(DAY, type, at(time));
    const cp = raw
      .prepare(`SELECT id FROM attendance_project_checkpoints WHERE date = ? AND checkpoint_type = ?`)
      .get(DAY, type) as { id: number };
    await applyNonProjectPicks(db, { userId: 1, date: DAY, checkpointId: cp.id, picks, now: at(time) });
  };
  const sessionRow = () =>
    raw.prepare(`SELECT hours_worked, non_project_credit_hours FROM attendance_sessions ORDER BY id DESC LIMIT 1`).get() as {
      hours_worked: number;
      non_project_credit_hours: number;
    };
  return { raw, db, session, pickAt, sessionRow };
}

test('15:00-д гарахдаа ажил СОНГОСОН нь цаг нэмэхгүй; «Миний ажлууд»-аас 15:00–17:00 оруулахад нэмэгдэнэ', async () => {
  const h = creditHarness();
  h.session('09:00', '15:00', 5);
  await h.pickAt('clock_out', '15:00', [pick('author_supervision')]);
  assert.equal((await syncNonProjectCredit(h.db, 1, DAY)).creditHours, 0, 'ирцийн сонголт зөвхөн хяналт');
  assert.deepEqual({ ...h.sessionRow() }, { hours_worked: 5, non_project_credit_hours: 0 });

  h.raw.exec(
    `UPDATE non_project_work_entries SET start_time = '15:00', end_time = '17:00', minutes = 120, report = 'хяналт'`,
  );
  await afterNonProjectChange(h.db, 1, DAY);
  assert.deepEqual({ ...h.sessionRow() }, { hours_worked: 7, non_project_credit_hours: 2 });
  // Идемпотент.
  await syncNonProjectCredit(h.db, 1, DAY);
  assert.equal(h.sessionRow().hours_worked, 7);
});

test('цагтай ажлыг татгалзвал нэмэлт арилна', async () => {
  const h = creditHarness();
  h.session('09:00', '16:00', 6);
  await h.pickAt('afternoon', '14:00', [pick('meeting')]);
  assert.equal((await syncNonProjectCredit(h.db, 1, DAY)).creditHours, 0);
  h.raw.exec(`UPDATE non_project_work_entries SET start_time = '16:00', end_time = '18:00', minutes = 120`);
  assert.equal((await syncNonProjectCredit(h.db, 1, DAY)).creditHours, 2);
  h.raw.exec(`UPDATE non_project_work_entries SET status = 'rejected'`);
  assert.equal((await syncNonProjectCredit(h.db, 1, DAY)).creditHours, 0);
  assert.deepEqual({ ...h.sessionRow() }, { hours_worked: 6, non_project_credit_hours: 0 });
});
