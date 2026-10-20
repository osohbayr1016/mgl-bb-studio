/**
 * Ирсэн / гарсан бүртгэл АТОМИК — `writeClockIn` / `writeClockOut`, БОДИТ
 * SQLite (node:sqlite) + бодит 0044/0047/0324 миграц дээр.
 *
 * Эх гажиг: session INSERT амжилттай болсны ДАРАА төсөл, цэгийг тусдаа
 * дуудлагаар бичдэг байсан тул дундаас D1 алдаа гарвал ажилтан «ирсэн»
 * боловч төсөлгүй/цэггүй үлддэг байв.  Одоо бүгд нэг batch (= транзакц).
 *
 * D1 shim нь `batch`-ийг жинхэнэ D1 шиг НЭГ транзакцад ажиллуулна — алдаа
 * гарвал бүгд ROLLBACK.
 *
 * Run with:  node --test src/routes/attendanceAtomic.test.ts
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

const { writeClockIn, writeClockOut } = await import('./attendance.ts');

const mig = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

function fakeD1(db: DatabaseSync): D1Database {
  type Stmt = { sql: string; args: unknown[] };
  const exec = (s: Stmt) => {
    const st = db.prepare(s.sql);
    if (/^\s*SELECT/i.test(s.sql)) {
      return { results: st.all(...(s.args as never[])), meta: { changes: 0, last_row_id: 0 } };
    }
    const r = st.run(...(s.args as never[]));
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const mk = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...a: unknown[]) => mk(sql, a),
    all: async () => exec({ sql, args }),
    run: async () => exec({ sql, args }),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
  });
  return {
    prepare: (sql: string) => mk(sql),
    batch: async (stmts: Stmt[]) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map(exec);
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  } as unknown as D1Database;
}

const USER = 5;
const DAY = '2026-10-15';
const at = (hhmm: string) => `${DAY}T${hhmm}:00+08:00`;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE projects (id INTEGER PRIMARY KEY);
    CREATE TABLE repair_projects (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (${USER});
    INSERT INTO projects (id) VALUES (10), (11);
    INSERT INTO repair_projects (id) VALUES (3);
    CREATE TABLE attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      clock_in TEXT NOT NULL, clock_out TEXT, hours_worked REAL, device_id TEXT, ip_address TEXT,
      date TEXT NOT NULL, notes TEXT, late_minutes INTEGER NOT NULL DEFAULT 0, edit_note TEXT
    );
  `);
  db.exec(mig('0044_daily_active_projects.sql'));
  db.exec(mig('0047_attendance_checkpoints.sql'));
  db.exec(mig('0324_daily_active_repairs.sql'));
  db.exec('PRAGMA foreign_keys = ON');
  return { raw: db, d1: fakeD1(db) };
}

const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

const clockInArgs = (over: Partial<Parameters<typeof writeClockIn>[1]> = {}) => ({
  userId: USER,
  date: DAY,
  clockIn: at('08:55'),
  ip: '10.0.0.1',
  notes: null,
  lateMinutes: 0,
  deviceId: 'dev-1',
  projectIds: [10, 11],
  repairProjectIds: [3],
  ...over,
});

test('ирсэн бүртгэл: session, сонголт, өглөөний цэг бүгд нэг дор, цэг session-д холбоотой', async () => {
  const { raw, d1 } = setup();
  const r = await writeClockIn(d1, clockInArgs());
  assert.ok(r);
  const cp = raw.prepare(`SELECT * FROM attendance_project_checkpoints WHERE id = ?`).get(r.checkpointId) as {
    session_id: number;
    checkpoint_type: string;
  };
  assert.equal(cp.session_id, r.sessionId);
  assert.equal(cp.checkpoint_type, 'morning');
  assert.equal(count(raw, `SELECT COUNT(*) n FROM daily_active_projects`), 2);
  assert.equal(count(raw, `SELECT COUNT(*) n FROM daily_active_repairs`), 1);
  assert.equal(count(raw, `SELECT COUNT(*) n FROM attendance_checkpoint_projects`), 2);
  assert.equal(count(raw, `SELECT COUNT(*) n FROM attendance_checkpoint_repairs`), 1);
});

test('давхар хүсэлт: хоёр дахь нь null, ЮУ Ч бичихгүй (эхнийхийн сонголт хэвээр)', async () => {
  const { raw, d1 } = setup();
  const first = await writeClockIn(d1, clockInArgs());
  const second = await writeClockIn(d1, clockInArgs({ projectIds: [11], repairProjectIds: [] }));
  assert.equal(second, null);
  assert.equal(count(raw, `SELECT COUNT(*) n FROM attendance_sessions`), 1);
  assert.deepEqual(
    raw.prepare(`SELECT project_id FROM daily_active_projects ORDER BY project_id`).all().map((r) => r.project_id),
    [10, 11],
  );
  assert.equal(count(raw, `SELECT COUNT(*) n FROM daily_active_repairs`), 1);
  const cp = raw.prepare(`SELECT session_id FROM attendance_project_checkpoints`).get() as { session_id: number };
  assert.equal(cp.session_id, first!.sessionId);
});

test('дундаас унавал (FK алдаа) бүгд буцна — «ирсэн боловч төсөлгүй» төлөв үүсэхгүй', async () => {
  const { raw, d1 } = setup();
  // repair_project 999 байхгүй → attendance_checkpoint_repairs FK алдаа (batch-ийн дунд).
  await assert.rejects(writeClockIn(d1, clockInArgs({ repairProjectIds: [999] })));
  for (const t of [
    'attendance_sessions',
    'daily_active_projects',
    'daily_active_repairs',
    'attendance_project_checkpoints',
    'attendance_checkpoint_projects',
  ]) {
    assert.equal(count(raw, `SELECT COUNT(*) n FROM ${t}`), 0, t);
  }
  // Ажилтан ДАХИН оролдож чадна (нээлттэй session үлдээгүй).
  assert.ok(await writeClockIn(d1, clockInArgs()));
});

test('буцаж орох: өглөөний цэг шинэ session руу шилжинэ, сонголт солигдоно', async () => {
  const { raw, d1 } = setup();
  const first = (await writeClockIn(d1, clockInArgs()))!;
  assert.ok(await writeClockOut(d1, {
    userId: USER, date: DAY, sessionId: first.sessionId, clockOut: at('11:00'), hours: 2,
    notes: null, projectIds: [10], repairProjectIds: [],
  }));
  const again = (await writeClockIn(d1, clockInArgs({ clockIn: at('11:30'), projectIds: [11], repairProjectIds: [] })))!;
  assert.notEqual(again.sessionId, first.sessionId);
  assert.equal(again.checkpointId, first.checkpointId);
  const cp = raw.prepare(`SELECT session_id, recorded_at FROM attendance_project_checkpoints WHERE checkpoint_type = 'morning'`).get() as {
    session_id: number;
    recorded_at: string;
  };
  assert.equal(cp.session_id, again.sessionId);
  assert.equal(cp.recorded_at, at('11:30'));
  assert.deepEqual(
    raw.prepare(`SELECT project_id FROM attendance_checkpoint_projects WHERE checkpoint_id = ?`).all(again.checkpointId).map((r) => r.project_id),
    [11],
  );
});

test('гарсан бүртгэл: хаалт + гарах цэг атомик, давхар «Гарах» null, давхар нээлттэй мөр хаагдана', async () => {
  const { raw, d1 } = setup();
  const s = (await writeClockIn(d1, clockInArgs()))!;
  // Атомик clock-in-ээс өмнө үүссэн хуучин давхар нээлттэй мөр.
  raw.prepare(`INSERT INTO attendance_sessions (user_id, clock_in, date) VALUES (?, ?, ?)`).run(USER, at('08:55'), DAY);
  const out = { userId: USER, date: DAY, sessionId: s.sessionId, clockOut: at('18:00'), hours: 8, notes: null, projectIds: [11], repairProjectIds: [] };
  const cpId = await writeClockOut(d1, out);
  assert.ok(cpId);
  assert.equal(count(raw, `SELECT COUNT(*) n FROM attendance_sessions WHERE clock_out IS NULL`), 0);
  assert.equal(count(raw, `SELECT COUNT(*) n FROM attendance_sessions WHERE hours_worked = 0`), 1);
  const cp = raw.prepare(`SELECT session_id, checkpoint_type FROM attendance_project_checkpoints WHERE id = ?`).get(cpId) as {
    session_id: number;
    checkpoint_type: string;
  };
  assert.deepEqual({ ...cp }, { session_id: s.sessionId, checkpoint_type: 'clock_out' });

  // Хоёр дахь «Гарах» — session аль хэдийн хаалттай → null, сонголт хөндөгдөхгүй.
  assert.equal(await writeClockOut(d1, { ...out, clockOut: at('18:05'), projectIds: [10] }), null);
  assert.deepEqual(raw.prepare(`SELECT project_id FROM daily_active_projects`).all().map((r) => r.project_id), [11]);
  const closed = raw.prepare(`SELECT clock_out FROM attendance_sessions WHERE id = ?`).get(s.sessionId) as { clock_out: string };
  assert.equal(closed.clock_out, at('18:00'));
});

test('гарсан бүртгэл дундаас унавал session нээлттэй хэвээр — дахин оролдож болно', async () => {
  const { raw, d1 } = setup();
  const s = (await writeClockIn(d1, clockInArgs()))!;
  const out = { userId: USER, date: DAY, sessionId: s.sessionId, clockOut: at('18:00'), hours: 8, notes: null, projectIds: [10], repairProjectIds: [999] };
  await assert.rejects(writeClockOut(d1, out));
  assert.equal(count(raw, `SELECT COUNT(*) n FROM attendance_sessions WHERE clock_out IS NULL`), 1);
  assert.equal(count(raw, `SELECT COUNT(*) n FROM attendance_project_checkpoints WHERE checkpoint_type = 'clock_out'`), 0);
  assert.ok(await writeClockOut(d1, { ...out, repairProjectIds: [] }));
});
