/**
 * ЗХ-ийн дугаарлалт (эзний шийдвэр 2026-09-29, миграц 0359): баг тус бүрд,
 * тайлангийн ОГНООНЫ дарааллаар 1..N.  Цэвэр төлөвлөгч + миграцын SQL +
 * `renumberAsrProject`-ийн batch-ийг бодит SQLite дээр (D1-ийн хэлбэртэй
 * жижиг адаптероор) шалгана — миграц ба ажиллах үеийн код ИЖИЛ дугаар
 * гаргадгийг нэг тестээр баталгаажуулна.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import type { AsrNumberingRow } from './asrNo';

// `asrNo.ts` нь өргөтгөлгүй импорт (`./asrProjectName`) бичдэг — `webPush.test.ts`-ийн адил.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { formatAsrDocNo, planAsrNumbering, renumberAsrProject } = await import('./asrNo.ts');
const { asrVisibleSql } = await import('./asrVisibility.ts');

const BB = { team_id: 1, team_code: 'BB' };
const BA = { team_id: 2, team_code: 'BA' };

function row(
  id: number,
  report_date: string,
  team: { team_id: number; team_code: string } | null,
  extra: Partial<AsrNumberingRow> = {},
): AsrNumberingRow {
  return {
    id,
    status: 'approved',
    report_date,
    seq: null,
    seq_team_id: null,
    doc_no: null,
    team_id: team?.team_id ?? null,
    team_code: team?.team_code ?? null,
    ...extra,
  };
}

/** Төлөвлөгөөг мөрүүд дээр хэрэглээд id → doc_no буцаана. */
function applied(rows: AsrNumberingRow[]): Record<number, string | null> {
  const plan = new Map(planAsrNumbering(rows).map((p) => [p.id, p]));
  return Object.fromEntries(rows.map((r) => [r.id, plan.get(r.id)?.doc_no ?? r.doc_no]));
}

describe('formatAsrDocNo', () => {
  test('includes the team code', () => {
    assert.equal(formatAsrDocNo(1, 'BB'), 'DASR-BB-001');
    assert.equal(formatAsrDocNo(12, 'TSAH'), 'DASR-TSAH-012');
  });
  test('no team → plain number', () => {
    assert.equal(formatAsrDocNo(7, null), 'DASR-007');
  });
});

describe('planAsrNumbering', () => {
  test('эзний жишээ: 12-р сард 001 байсан, 11-р сарынх нөхөгдвөл 11 → 001, 12 → 002', () => {
    const dec = row(10, '2026-12-05', BB, { seq: 1, seq_team_id: 1, doc_no: 'DASR-BB-001' });
    const nov = row(11, '2026-11-20', BB, { status: 'submitted', seq: 2, doc_no: 'DASR-002' });
    assert.deepEqual(applied([dec, nov]), { 10: 'DASR-BB-002', 11: 'DASR-BB-001' });
  });

  test('баг тус бүр өөрийн дараалал', () => {
    const rows = [
      row(1, '2026-09-01', BB),
      row(2, '2026-09-02', BA),
      row(3, '2026-09-03', BB),
      row(4, '2026-09-04', BA),
    ];
    assert.deepEqual(applied(rows), {
      1: 'DASR-BB-001',
      2: 'DASR-BA-001',
      3: 'DASR-BB-002',
      4: 'DASR-BA-002',
    });
  });

  test('ноорог дугаар авахгүй, буцаагдсан авна', () => {
    const rows = [
      row(1, '2026-09-01', BB, { status: 'draft' }),
      row(2, '2026-09-02', BB, { status: 'rejected' }),
    ];
    assert.deepEqual(applied(rows), { 1: null, 2: 'DASR-BB-001' });
  });

  test('ижил огноо: хуучин дугаарын дараалал хадгалагдана, шинэ нь ард', () => {
    const rows = [
      row(20, '2026-09-14', BB, { seq: 2, seq_team_id: 1, doc_no: 'DASR-BB-002' }),
      row(21, '2026-09-14', BB, { seq: 1, seq_team_id: 1, doc_no: 'DASR-BB-001' }),
      // Шинээр илгээсэн (ТҮР дугаар, seq_team_id NULL) — id нь бага ч ард.
      row(5, '2026-09-14', BB, { seq: 30, doc_no: 'DASR-030' }),
    ];
    assert.deepEqual(applied(rows), { 20: 'DASR-BB-002', 21: 'DASR-BB-001', 5: 'DASR-BB-003' });
  });

  test('аль хэдийн зөв бол өөрчлөлт 0', () => {
    const rows = [
      row(1, '2026-09-01', BB, { seq: 1, seq_team_id: 1, doc_no: 'DASR-BB-001' }),
      row(2, '2026-09-05', BB, { seq: 2, seq_team_id: 1, doc_no: 'DASR-BB-002' }),
    ];
    assert.deepEqual(planAsrNumbering(rows), []);
  });

  test('багаа сольсон тайлан шинэ багийн дараалалд огноогоороо орно', () => {
    const rows = [
      row(1, '2026-09-01', BA, { seq: 1, seq_team_id: 1, doc_no: 'DASR-BB-001' }),
      row(2, '2026-09-05', BB, { seq: 2, seq_team_id: 1, doc_no: 'DASR-BB-002' }),
      row(3, '2026-09-03', BA, { seq: 1, seq_team_id: 2, doc_no: 'DASR-BA-001' }),
    ];
    assert.deepEqual(applied(rows), { 1: 'DASR-BA-001', 2: 'DASR-BB-001', 3: 'DASR-BA-002' });
  });

  test('Drive-аас нөхсөн хуучин тайлан (seq NULL) огноогоороо дараалалд орно', () => {
    const rows = [
      row(1, '2026-06-01', BB, { seq: 1, seq_team_id: 1, doc_no: 'DASR-BB-001' }),
      row(2, '2026-05-10', BB, { doc_no: 'ASR-BB-005' }),
    ];
    assert.deepEqual(applied(rows), { 1: 'DASR-BB-002', 2: 'DASR-BB-001' });
  });
});

/* ------------------------------------------------------------------ */
/*  Бодит SQLite: миграц 0359 ба renumberAsrProject                    */
/* ------------------------------------------------------------------ */

const SCHEMA = `
  CREATE TABLE teams (id INTEGER PRIMARY KEY, code TEXT);
  CREATE TABLE author_supervision_reports (
    id INTEGER PRIMARY KEY, project_id INTEGER, author_id INTEGER, status TEXT,
    report_date TEXT, seq INTEGER, doc_no TEXT, updated_at TEXT DEFAULT 'orig'
  );
  CREATE UNIQUE INDEX idx_asr_seq ON author_supervision_reports(project_id, seq) WHERE seq IS NOT NULL;
  CREATE TABLE author_supervision_report_teams (report_id INTEGER, team_id INTEGER, sort_order INTEGER);
  CREATE TABLE asr_issue_resolutions (id INTEGER PRIMARY KEY, report_id INTEGER, prev_report_id INTEGER, prev_doc_no TEXT);
  INSERT INTO teams VALUES (1, 'BB'), (2, 'BA'), (3, 'TSAH');
`;

/** Прод дээрх хэлбэр: EVERGREEN-д 07-01-ний тайлан хожим DASR-016 авсан. */
function seedProd(db: DatabaseSync) {
  const add = db.prepare(
    `INSERT INTO author_supervision_reports (id, project_id, author_id, status, report_date, seq, doc_no)
     VALUES (?, ?, 30, ?, ?, ?, ?)`,
  );
  const team = db.prepare(`INSERT INTO author_supervision_report_teams VALUES (?, ?, ?)`);
  const bb: [number, string, number][] = [
    [44, '2026-05-05', 1], [46, '2026-05-11', 2], [45, '2026-06-11', 3], [42, '2026-06-14', 4],
    [41, '2026-06-19', 5], [39, '2026-06-22', 6], [84, '2026-07-01', 16], [38, '2026-07-28', 7],
    [37, '2026-08-12', 8], [36, '2026-08-13', 9], [35, '2026-08-26', 10], [48, '2026-08-31', 11],
    [55, '2026-09-05', 12], [70, '2026-09-20', 13], [79, '2026-09-25', 14], [80, '2026-09-25', 15],
  ];
  for (const [id, d, seq] of bb) {
    add.run(id, 37, 'approved', d, seq, `DASR-${String(seq).padStart(3, '0')}`);
    team.run(id, 1, 0);
  }
  // Нэг өдөр гурван баг (төсөл 55-ын хэлбэр) + нэг ноорог.
  const same: [number, number, number][] = [[60, 4, 3], [62, 1, 1], [63, 2, 2]];
  for (const [id, seq, t] of same) {
    add.run(id, 55, 'submitted', '2026-09-14', seq, `DASR-${String(seq).padStart(3, '0')}`);
    team.run(id, t, 0);
  }
  add.run(90, 55, 'draft', '2026-09-15', null, null);
  team.run(90, 1, 0);
  // Олон багтай тайлан — эхний баг (sort_order 0) = TSAH.
  add.run(64, 55, 'approved', '2026-09-20', 5, 'DASR-005');
  team.run(64, 1, 1);
  team.run(64, 3, 0);
  // Өмнөх тайлангийн асуудлын холбоос.
  db.prepare(`INSERT INTO asr_issue_resolutions (report_id, prev_report_id, prev_doc_no) VALUES (?, ?, ?)`)
    .run(38, 84, 'DASR-016');
}

function docNos(db: DatabaseSync) {
  const rows = db
    .prepare(`SELECT id, seq, doc_no FROM author_supervision_reports ORDER BY id`)
    .all() as { id: number; seq: number | null; doc_no: string | null }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.doc_no]));
}

/** `D1Database`-ийн хэрэглэдэг хэсэг — prepare/bind/all/first/run/batch. */
function d1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: Number(r.changes) } };
    },
    _exec: () => db.prepare(sql).run(...(args as never[])),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: { _exec: () => unknown }[]) => {
      db.exec('BEGIN');
      try {
        for (const s of list) s._exec();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return [];
    },
  } as unknown as D1Database;
}

describe('migration 0359 on SQLite', () => {
  const migration = readFileSync(
    new URL('../../migrations/0359_asr_team_numbering.sql', import.meta.url),
    'utf8',
  );

  test('EVERGREEN: 07-01 → DASR-BB-007, дараагийнх нь нэгээр шилжинэ', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    seedProd(db);
    db.exec(migration);
    const got = docNos(db);
    assert.equal(got[84], 'DASR-BB-007');
    assert.equal(got[38], 'DASR-BB-008');
    assert.equal(got[80], 'DASR-BB-016');
    assert.equal(got[44], 'DASR-BB-001');
    // Нэг өдрийн гурван баг — баг бүр 001; олон багтай нь ЭХНИЙ багаараа (TSAH).
    assert.equal(got[60], 'DASR-TSAH-001');
    assert.equal(got[62], 'DASR-BB-001');
    assert.equal(got[63], 'DASR-BA-001');
    assert.equal(got[64], 'DASR-TSAH-002');
    assert.equal(got[90], null);
    const res = db.prepare(`SELECT prev_doc_no FROM asr_issue_resolutions`).get() as { prev_doc_no: string };
    assert.equal(res.prev_doc_no, 'DASR-BB-007');
    // updated_at хөндөгдөхгүй.
    const touched = db.prepare(`SELECT COUNT(*) AS n FROM author_supervision_reports WHERE updated_at <> 'orig'`).get() as { n: number };
    assert.equal(touched.n, 0);
  });

  test('миграц ба renumberAsrProject ИЖИЛ дугаар гаргана (дахин ажиллуулахад өөрчлөлт 0)', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    seedProd(db);
    db.exec(migration);
    const before = docNos(db);
    assert.equal(await renumberAsrProject(d1(db), 37), 0);
    assert.equal(await renumberAsrProject(d1(db), 55), 0);
    assert.deepEqual(docNos(db), before);
  });
});

describe('renumberAsrProject on SQLite', () => {
  function fresh() {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    seedProd(db);
    db.exec(readFileSync(new URL('../../migrations/0359_asr_team_numbering.sql', import.meta.url), 'utf8'));
    return db;
  }

  test('өмнөх огноотой тайлан нэмэгдвэл UNIQUE индекс мөргөлдөхгүйгээр бүгд шилжинэ', async () => {
    const db = fresh();
    // Илгээх мөчийн ТҮР дугаар (allocateAndSubmit): seq = төслийн MAX+1, seq_team_id NULL.
    db.prepare(
      `INSERT INTO author_supervision_reports (id, project_id, author_id, status, report_date, seq, doc_no)
       VALUES (100, 37, 30, 'submitted', '2026-04-20', 17, 'DASR-017')`,
    ).run();
    db.prepare(`INSERT INTO author_supervision_report_teams VALUES (100, 1, 0)`).run();
    const changed = await renumberAsrProject(d1(db), 37);
    assert.equal(changed, 17);
    const got = docNos(db);
    assert.equal(got[100], 'DASR-BB-001');
    assert.equal(got[44], 'DASR-BB-002');
    assert.equal(got[80], 'DASR-BB-017');
    // Холбоотой асуудлын дугаар дагана.
    const res = db.prepare(`SELECT prev_doc_no FROM asr_issue_resolutions`).get() as { prev_doc_no: string };
    assert.equal(res.prev_doc_no, 'DASR-BB-008');
  });

  test('устгасны дараа завсар хаагдана', async () => {
    const db = fresh();
    db.prepare(`DELETE FROM author_supervision_reports WHERE id = 44`).run();
    await renumberAsrProject(d1(db), 37);
    const got = docNos(db);
    assert.equal(got[46], 'DASR-BB-001');
    assert.equal(got[80], 'DASR-BB-015');
  });
});

describe('asrVisibleSql', () => {
  function db() {
    const d = new DatabaseSync(':memory:');
    d.exec(`
      CREATE TABLE author_supervision_reports (id INTEGER PRIMARY KEY, author_id INTEGER, status TEXT);
      CREATE TABLE author_supervision_report_teams (report_id INTEGER, team_id INTEGER);
      CREATE TABLE user_teams (user_id INTEGER, team_id INTEGER);
      CREATE TABLE asr_report_companions (report_id INTEGER, user_id INTEGER);
      INSERT INTO author_supervision_reports VALUES (1, 10, 'approved'), (2, 20, 'approved'), (3, 30, 'approved');
      INSERT INTO author_supervision_report_teams VALUES (1, 1), (2, 2), (3, 2);
      -- 11 = ББ, 12 = БА, 13 = хоёулаа, 14 = ББ-гийнх боловч 3-р тайланд хамт явсан.
      INSERT INTO user_teams VALUES (11, 1), (12, 2), (13, 1), (13, 2), (14, 1), (20, 1);
      INSERT INTO asr_report_companions VALUES (3, 14);
    `);
    return d;
  }
  const seen = (d: DatabaseSync, sub: number, isAdmin = false) =>
    (d
      .prepare(`SELECT r.id FROM author_supervision_reports r WHERE ${asrVisibleSql({ sub, isAdmin })} ORDER BY r.id`)
      .all() as { id: number }[]).map((r) => r.id);

  test('ББ-гийнх зөвхөн ББ-гийн тайланг', () => assert.deepEqual(seen(db(), 11), [1]));
  test('БА-гийнх зөвхөн БА-гийн тайланг', () => assert.deepEqual(seen(db(), 12), [2, 3]));
  test('хоёр багийнх хоёуланг', () => assert.deepEqual(seen(db(), 13), [1, 2, 3]));
  test('зохиогч өөр багт шилжсэн ч өөрийн тайлангаа', () => assert.deepEqual(seen(db(), 20), [1, 2]));
  test('хамт явсан хүн тэр тайланг', () => assert.deepEqual(seen(db(), 14), [1, 3]));
  test('админ бүгдийг', () => assert.deepEqual(seen(db(), 99, true), [1, 2, 3]));
  test('бүхэл биш id юу ч харахгүй', () => assert.deepEqual(seen(db(), Number.NaN), []));
});
