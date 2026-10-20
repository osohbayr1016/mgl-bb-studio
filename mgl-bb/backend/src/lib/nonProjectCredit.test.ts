/**
 * `syncNonProjectCredit` (миграц 0352) — БОДИТ SQLite дээр 0342 + 0352
 * миграцыг ажиллуулж, ирцийн `hours_worked`-д төслийн бус ажлын цаг зөв,
 * идемпотент нэмэгдэж/хасагдахыг шалгана.
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

const { syncNonProjectCredit } = await import('./nonProjectWorkStore.ts');

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
const at = (hhmm: string) => `${DAY}T${hhmm}:00+08:00`;

function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1), (2);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      hours_worked REAL,
      date TEXT NOT NULL
    );
  `);
  db.exec(migration('0342_non_project_work.sql'));
  db.exec(migration('0352_attendance_non_project_credit.sql'));
  const d1 = d1Shim(db);
  const session = (userId: number, inT: string, outT: string | null, hours: number | null) =>
    Number(
      db
        .prepare(
          `INSERT INTO attendance_sessions (user_id, clock_in, clock_out, hours_worked, date) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(userId, at(inT), outT ? at(outT) : null, hours, DAY).lastInsertRowid,
    );
  const work = (userId: number, start: string, end: string, status = 'pending') =>
    Number(
      db
        .prepare(
          `INSERT INTO non_project_work_entries (user_id, date, category, start_time, end_time, minutes, status)
           VALUES (?, ?, 'author_supervision', ?, ?, 60, ?)`,
        )
        .run(userId, DAY, start, end, status).lastInsertRowid,
    );
  const row = (id: number) => {
    const r = db
      .prepare(`SELECT hours_worked, non_project_credit_hours FROM attendance_sessions WHERE id = ?`)
      .get(id) as { hours_worked: number | null; non_project_credit_hours: number };
    return { hours_worked: r.hours_worked, non_project_credit_hours: r.non_project_credit_hours };
  };
  return { db, d1, session, work, row };
}

test('15:00-д гараад 15–17 зохиогчийн хяналт → 5ц + 2ц = 7ц, гарах цаг хэвээр', async () => {
  const h = harness();
  const s = h.session(1, '09:00', '15:00', 5); // 09–15 − цай 1ц
  h.work(1, '15:00', '17:00');
  const r = await syncNonProjectCredit(h.d1, 1, DAY);
  assert.deepEqual(r, { creditHours: 2, sessionId: s });
  assert.deepEqual(h.row(s), { hours_worked: 7, non_project_credit_hours: 2 });
  const out = h.db.prepare(`SELECT clock_out FROM attendance_sessions WHERE id = ?`).get(s) as {
    clock_out: string;
  };
  assert.equal(out.clock_out, at('15:00'));
});

test('идемпотент: дахин дуудахад давхар нэмэгдэхгүй; ажил устахад буцаж хасагдана', async () => {
  const h = harness();
  const s = h.session(1, '09:00', '15:00', 5);
  const w = h.work(1, '15:00', '17:00');
  await syncNonProjectCredit(h.d1, 1, DAY);
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.equal(h.row(s).hours_worked, 7);
  h.db.prepare(`DELETE FROM non_project_work_entries WHERE id = ?`).run(w);
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.deepEqual(h.row(s), { hours_worked: 5, non_project_credit_hours: 0 });
});

test('татгалзсан ажил тооцогдохгүй; өөр ажилтны ажил нөлөөлөхгүй', async () => {
  const h = harness();
  const s = h.session(1, '09:00', '15:00', 5);
  h.work(1, '15:00', '17:00', 'rejected');
  h.work(2, '15:00', '17:00');
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.deepEqual(h.row(s), { hours_worked: 5, non_project_credit_hours: 0 });
});

test('оффист байх үеийн ажил нэмэгдэхгүй', async () => {
  const h = harness();
  const s = h.session(1, '09:00', '18:00', 8);
  h.work(1, '10:00', '11:00');
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.deepEqual(h.row(s), { hours_worked: 8, non_project_credit_hours: 0 });
});

test('хаагдаагүй өдөр юу ч нэмэхгүй (тайланд тооцогдохгүй дүрэм хэвээр)', async () => {
  const h = harness();
  const s = h.session(1, '09:00', null, null);
  h.work(1, '15:00', '17:00');
  const r = await syncNonProjectCredit(h.d1, 1, DAY);
  assert.deepEqual(r, { creditHours: 0, sessionId: null });
  assert.deepEqual(h.row(s), { hours_worked: null, non_project_credit_hours: 0 });
});

test('дахин орж ирэхэд кредит хөдөлж, эцэст нь сүүлийн session дээр очно', async () => {
  const h = harness();
  const s1 = h.session(1, '09:00', '14:00', 4); // 09–14 − цай
  h.work(1, '14:00', '16:00');
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.equal(h.row(s1).hours_worked, 6);
  // 15:00-д буцаж орсон (нээлттэй) → зөвхөн 14–15 гадуур.
  const s2 = h.session(1, '15:00', null, null);
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.deepEqual(h.row(s1), { hours_worked: 5, non_project_credit_hours: 1 });
  // 18:00-д гарсан → кредит сүүлийн session руу шилжинэ, нийлбэр ижил.
  h.db
    .prepare(`UPDATE attendance_sessions SET clock_out = ?, hours_worked = 3 WHERE id = ?`)
    .run(at('18:00'), s2);
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.deepEqual(h.row(s1), { hours_worked: 4, non_project_credit_hours: 0 });
  assert.deepEqual(h.row(s2), { hours_worked: 4, non_project_credit_hours: 1 });
});

test('давхар бүртгэлийн ихэр (0 цаг) кредит авахгүй', async () => {
  const h = harness();
  const main = h.session(1, '09:00', '15:00', 5);
  const twin = h.session(1, '09:00', '15:00', 0);
  h.work(1, '15:00', '17:00');
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.equal(h.row(main).hours_worked, 7);
  assert.deepEqual(h.row(twin), { hours_worked: 0, non_project_credit_hours: 0 });
});

test('цайны цаг хасагдана (11:00-д гараад 11–17)', async () => {
  const h = harness();
  const s = h.session(1, '09:00', '11:00', 2);
  h.work(1, '11:00', '17:00');
  await syncNonProjectCredit(h.d1, 1, DAY);
  assert.deepEqual(h.row(s), { hours_worked: 7, non_project_credit_hours: 5 });
});

test('2026-10-01-ээс: ээлжийн цонхоос гадуурх ажил нэмэгдэхгүй (15:00-д гараад 15–19 → 2ц)', async () => {
  const h = harness();
  h.db.exec(`
    ALTER TABLE users ADD COLUMN work_schedule TEXT;
    ALTER TABLE users ADD COLUMN role TEXT;
    UPDATE users SET work_schedule = 'early', role = 'engineer';
    CREATE TABLE user_work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, schedule TEXT NOT NULL,
      effective_from TEXT NOT NULL, created_by INTEGER
    );
  `);
  const OCT = '2026-10-02';
  const s = Number(
    h.db
      .prepare(
        `INSERT INTO attendance_sessions (user_id, clock_in, clock_out, hours_worked, date) VALUES (1, ?, ?, 6, ?)`,
      )
      .run(`${OCT}T08:00:00+08:00`, `${OCT}T15:00:00+08:00`, OCT).lastInsertRowid,
  );
  h.db
    .prepare(
      `INSERT INTO non_project_work_entries (user_id, date, category, start_time, end_time, minutes, status)
       VALUES (1, ?, 'author_supervision', '15:00', '19:00', 240, 'pending')`,
    )
    .run(OCT);
  const r = await syncNonProjectCredit(h.d1, 1, OCT);
  assert.deepEqual(r, { creditHours: 2, sessionId: s });
  assert.deepEqual(h.row(s), { hours_worked: 8, non_project_credit_hours: 2 });
});
