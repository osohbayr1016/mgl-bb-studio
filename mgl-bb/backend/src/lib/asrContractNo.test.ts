/**
 * ЗХ-ийн төслийн «Гэрээний дугаар» (миграц 0365, эзний хүсэлт 2026-09-30):
 * хүчин төгөлдөр утга = тайлангийн хүчингүйлэгч ?? төслийн дугаар, төслийн
 * дугаар ӨӨРЧЛӨГДӨХӨД тайлангуудын гараар бичсэн утгыг цэвэрлэнэ.  Цэвэр
 * дүрмүүд + жинхэнэ миграц ба SQL хэсгүүдийг бодит SQLite дээр шалгана.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CLEAR_REPORT_CONTRACT_OVERRIDES_SQL,
  PROJECT_CONTRACT_SQL,
  planContractNoUpdate,
  resolveAsrContractNo,
} from './asrContractNo.ts';

describe('resolveAsrContractNo', () => {
  test('төслийн дугаартай, тайлан хоосон → төслийг дагана', () => {
    assert.deepEqual(resolveAsrContractNo(null, 'ГД-25/07'), {
      contract_no: 'ГД-25/07',
      contract_no_override: null,
      contract_no_source: 'project',
      project_contract_no: 'ГД-25/07',
    });
  });

  test('тайланд гараар бичсэн бол тэр хожно, төслийн утга ч хадгалагдана', () => {
    assert.deepEqual(resolveAsrContractNo('А-1', 'ГД-25/07'), {
      contract_no: 'А-1',
      contract_no_override: 'А-1',
      contract_no_source: 'override',
      project_contract_no: 'ГД-25/07',
    });
  });

  test('хоёул хоосон → null, зөвхөн хоосон зайтай утга ч хоосон', () => {
    assert.deepEqual(resolveAsrContractNo('  ', undefined), {
      contract_no: null,
      contract_no_override: null,
      contract_no_source: null,
      project_contract_no: null,
    });
  });

  test('тайланд л дугаартай (төсөлд байхгүй) → override', () => {
    const r = resolveAsrContractNo(' Б-2 ', '');
    assert.equal(r.contract_no, 'Б-2');
    assert.equal(r.contract_no_source, 'override');
    assert.equal(r.project_contract_no, null);
  });
});

describe('planContractNoUpdate', () => {
  test('шинэ дугаар тогтвол тайлангийн override-ыг цэвэрлэнэ', () => {
    assert.deepEqual(planContractNoUpdate(null, ' ГД-25/07 '), {
      value: 'ГД-25/07',
      clearReportOverrides: true,
    });
    assert.equal(planContractNoUpdate('ГД-1', 'ГД-2').clearReportOverrides, true);
  });

  test('ижил дугаарыг дахин хадгалахад тайлангуудыг хөндөхгүй', () => {
    assert.equal(planContractNoUpdate('ГД-1', ' ГД-1 ').clearReportOverrides, false);
  });

  test('дугаарыг хасахад тайлангийн утгыг хөндөхгүй', () => {
    assert.deepEqual(planContractNoUpdate('ГД-1', ''), { value: null, clearReportOverrides: false });
    assert.equal(planContractNoUpdate('ГД-1', null).clearReportOverrides, false);
  });
});

/** Прод шиг хэлбэрийн БАГА схем — `projects` нь 0365-аас ӨМНӨХ (багана байхгүй). */
function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, asr_name TEXT);
    CREATE TABLE author_supervision_reports (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      contract_no TEXT
    );
  `);
  db.exec(readFileSync(new URL('../../migrations/0365_asr_project_contract_no.sql', import.meta.url), 'utf8'));
  return db;
}

describe('миграц 0365 + SQL хэсгүүд (бодит SQLite)', () => {
  test('миграц projects.asr_contract_no нэмнэ, одоо байгаа мөр NULL', () => {
    const db = openDb();
    db.exec(`INSERT INTO projects (id, name) VALUES (1, 'A')`);
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[];
    assert.ok(cols.some((c) => c.name === 'asr_contract_no'));
    const row = db.prepare(`SELECT asr_contract_no FROM projects WHERE id = 1`).get() as {
      asr_contract_no: string | null;
    };
    assert.equal(row.asr_contract_no, null);
  });

  test('PROJECT_CONTRACT_SQL: тайлан бүр өөрийн төслийн дугаарыг авна, хоосон зай NULL', () => {
    const db = openDb();
    db.exec(`
      INSERT INTO projects (id, name, asr_contract_no) VALUES (1, 'A', ' ГД-1 '), (2, 'B', '   '), (3, 'C', NULL);
      INSERT INTO author_supervision_reports (id, project_id, contract_no) VALUES (10, 1, NULL), (11, 2, NULL), (12, 3, NULL);
    `);
    const rows = db
      .prepare(
        `SELECT r.id, ${PROJECT_CONTRACT_SQL} AS project_contract_no
           FROM author_supervision_reports r ORDER BY r.id`,
      )
      .all() as { id: number; project_contract_no: string | null }[];
    assert.deepEqual(
      rows.map((r) => [r.id, r.project_contract_no]),
      [
        [10, 'ГД-1'],
        [11, null],
        [12, null],
      ],
    );
  });

  test('CLEAR_REPORT_CONTRACT_OVERRIDES_SQL: зөвхөн тухайн төслийн тайлангийн override арилна', () => {
    const db = openDb();
    db.exec(`
      INSERT INTO projects (id, name) VALUES (1, 'A'), (2, 'B');
      INSERT INTO author_supervision_reports (id, project_id, contract_no)
        VALUES (10, 1, 'гар-1'), (11, 1, NULL), (12, 2, 'гар-2');
    `);
    db.prepare(CLEAR_REPORT_CONTRACT_OVERRIDES_SQL).run(1);
    const rows = db
      .prepare(`SELECT id, contract_no FROM author_supervision_reports ORDER BY id`)
      .all() as { id: number; contract_no: string | null }[];
    assert.deepEqual(
      rows.map((r) => [r.id, r.contract_no]),
      [
        [10, null],
        [11, null],
        [12, 'гар-2'],
      ],
    );
  });

  test('төслийн дугаар өөрчлөгдөхөд шинэ тайлан ч, хуучин тайлан ч шинэ дугаарыг авна', () => {
    const db = openDb();
    db.exec(`
      INSERT INTO projects (id, name) VALUES (1, 'A');
      INSERT INTO author_supervision_reports (id, project_id, contract_no) VALUES (10, 1, 'хуучин гар');
    `);
    const project = () =>
      (db.prepare(`SELECT asr_contract_no FROM projects WHERE id = 1`).get() as {
        asr_contract_no: string | null;
      }).asr_contract_no;

    const plan = planContractNoUpdate(project(), 'ГД-25/07');
    db.prepare(`UPDATE projects SET asr_contract_no = ? WHERE id = 1`).run(plan.value);
    if (plan.clearReportOverrides) db.prepare(CLEAR_REPORT_CONTRACT_OVERRIDES_SQL).run(1);
    // Дараа нь орсон шинэ тайлан.
    db.exec(`INSERT INTO author_supervision_reports (id, project_id) VALUES (11, 1)`);

    const rows = db
      .prepare(
        `SELECT r.id, r.contract_no, ${PROJECT_CONTRACT_SQL} AS project_contract_no
           FROM author_supervision_reports r ORDER BY r.id`,
      )
      .all() as { id: number; contract_no: string | null; project_contract_no: string | null }[];
    for (const r of rows) {
      assert.equal(resolveAsrContractNo(r.contract_no, r.project_contract_no).contract_no, 'ГД-25/07');
    }
    assert.equal(rows.length, 2);
  });
});
