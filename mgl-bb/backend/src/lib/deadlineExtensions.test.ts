/**
 * `lib/deadlineExtensions.ts` — төслийн дуусах хугацааны сунгалт + түүх
 * (migration 0337).  Цэвэр дүрмүүд + миграцын бодит SQL-ийг `node:sqlite`
 * дээр ажиллуулсан шалгалт (`attendanceDevice.test.ts`-ийн D1 shim).
 *
 * Файл нь `./projectRisk`, `./passportTimeline`-ыг өргөтгөлгүй импортолдог
 * тул `leaveWindow.test.ts`-ийн адил `registerHooks` + динамик импорт.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { DeadlineChangeRow } from './deadlineExtensions';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  applyExtensionToTimelineRows,
  deadlineChangeInsert,
  extensionDays,
  extensionRequiredBody,
  isLaterThan,
  recordDeadlineCorrection,
  revertExtensionInTimelineRows,
  summarizeDeadlineChanges,
  toIsoDateLoose,
  validateExtensionInput,
} = await import('./deadlineExtensions.ts');
const { columnsFromTimelineRows, defaultTimelineRows } = await import('./passportTimeline.ts');

const TODAY = '2026-09-21';

/* ------------------------------------------------------------------ */
/*  Огноо                                                              */
/* ------------------------------------------------------------------ */

describe('toIsoDateLoose / isLaterThan / extensionDays', () => {
  test('ISO ба цэгтэй хэлбэрийг уншина, хогийг null', () => {
    assert.equal(toIsoDateLoose('2026-07-09'), '2026-07-09');
    assert.equal(toIsoDateLoose('2026.07.09'), '2026-07-09');
    assert.equal(toIsoDateLoose('2026/7/9'), '2026-07-09');
    assert.equal(toIsoDateLoose('-'), null);
    assert.equal(toIsoDateLoose(''), null);
    assert.equal(toIsoDateLoose(null), null);
    assert.equal(toIsoDateLoose('2026-02-30'), null);
  });

  test('isLaterThan — зөвхөн хоёулаа уншигдаж, шинэ нь хойно байвал', () => {
    assert.equal(isLaterThan('2026-09-30', '2026-07-09'), true);
    assert.equal(isLaterThan('2026-09-30', '2026.07.09'), true);
    assert.equal(isLaterThan('2026-07-09', '2026-07-09'), false);
    assert.equal(isLaterThan('2026-07-01', '2026-07-09'), false);
    assert.equal(isLaterThan('2026-09-30', null), false);
    assert.equal(isLaterThan('2026-09-30', '-'), false);
    assert.equal(isLaterThan(null, '2026-07-09'), false);
  });

  test('extensionDays', () => {
    assert.equal(extensionDays('2026-07-09', '2026-09-30'), 83);
    assert.equal(extensionDays('2026.07.09', '2026-09-30'), 83);
    assert.equal(extensionDays(null, '2026-09-30'), null);
    assert.equal(extensionDays('2026-09-30', '2026-07-09'), -83);
  });
});

/* ------------------------------------------------------------------ */
/*  Оролтын шалгалт                                                    */
/* ------------------------------------------------------------------ */

describe('validateExtensionInput', () => {
  const good = {
    new_finish_date: '2026-09-30',
    reason: 'Захиалагч техникийн даалгавраа өөрчилсөн',
    approved_by_kind: 'client',
    approved_by_name: 'Б.Бат (ХХК захирал)',
    reference_no: 'Албан бичиг №12/45',
  };

  test('хүчинтэй бие — approved_on өгөгдмөл өнөөдөр', () => {
    const v = validateExtensionInput(good, '2026-07-09', TODAY);
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.equal(v.value.new_finish_date, '2026-09-30');
    assert.equal(v.value.approved_on, TODAY);
    assert.equal(v.value.approved_by_kind, 'client');
    assert.equal(v.value.reference_no, 'Албан бичиг №12/45');
    assert.equal(v.value.note, null);
  });

  test('одоогийн хугацаагүй / уншигдахгүй бол сунгалт боломжгүй', () => {
    for (const cur of [null, '', '-', 'tbd']) {
      const v = validateExtensionInput(good, cur, TODAY);
      assert.equal(v.ok, false);
      if (!v.ok) assert.equal(v.code, 'NO_CURRENT_DEADLINE');
    }
  });

  test('чөлөөт хэлбэрийн одоогийн хугацаа (2026.07.09) уншигдана', () => {
    const v = validateExtensionInput(good, '2026.07.09', TODAY);
    assert.equal(v.ok, true);
  });

  test('шинэ огноо буруу / хойш биш', () => {
    let v = validateExtensionInput({ ...good, new_finish_date: '30.09.2026' }, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, 'INVALID_DATE');
    v = validateExtensionInput({ ...good, new_finish_date: '2026-07-09' }, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, 'NOT_LATER');
    v = validateExtensionInput({ ...good, new_finish_date: '2026-06-01' }, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, 'NOT_LATER');
  });

  test('батлагчийн төрөл заавал; other бол нэр заавал; шалтгаан заавал', () => {
    let v = validateExtensionInput({ ...good, approved_by_kind: 'boss' }, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
    v = validateExtensionInput({ ...good, approved_by_kind: undefined }, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
    v = validateExtensionInput({ ...good, approved_by_kind: 'other', approved_by_name: '  ' }, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
    v = validateExtensionInput({ ...good, approved_by_kind: 'director', approved_by_name: '' }, '2026-07-09', TODAY);
    assert.equal(v.ok, true);
    v = validateExtensionInput({ ...good, reason: '' }, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
  });

  test('approved_on буруу бол 400, зөв бол хэвээр; урт мөр тайрагдана', () => {
    let v = validateExtensionInput({ ...good, approved_on: '2026-09-99' }, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
    v = validateExtensionInput({ ...good, approved_on: '2026-09-15', note: 'x'.repeat(5000) }, '2026-07-09', TODAY);
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.equal(v.value.approved_on, '2026-09-15');
      assert.equal(v.value.note?.length, 1000);
    }
  });

  test('бие объект биш бол ойлгомжтой алдаа', () => {
    const v = validateExtensionInput(null, '2026-07-09', TODAY);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, 'INVALID_DATE');
  });
});

/* ------------------------------------------------------------------ */
/*  Хураангуй                                                          */
/* ------------------------------------------------------------------ */

const row = (p: Partial<DeadlineChangeRow> & { id: number }): DeadlineChangeRow => ({
  project_id: 1,
  kind: 'extension',
  seq: null,
  from_date: null,
  to_date: null,
  days: null,
  reason: null,
  approved_by_kind: null,
  approved_by_name: null,
  approved_on: null,
  reference_no: null,
  note: null,
  created_by: null,
  created_at: '2026-09-21 01:00:00',
  ...p,
});

describe('summarizeDeadlineChanges', () => {
  test('сунгалтгүй: анхны = одоогийн', () => {
    const s = summarizeDeadlineChanges([], '2026-07-09');
    assert.deepEqual(s, {
      current_finish_date: '2026-07-09',
      original_finish_date: '2026-07-09',
      extension_count: 0,
      total_extended_days: 0,
      last_extension: null,
    });
  });

  test('correction мөр тоологдохгүй; анхны = ЭХНИЙ сунгалтын from_date', () => {
    const rows = [
      row({ id: 1, kind: 'correction', from_date: null, to_date: '2026-07-01' }),
      row({ id: 2, kind: 'correction', from_date: '2026-07-01', to_date: '2026-07-09' }),
      row({ id: 3, seq: 1, from_date: '2026-07-09', to_date: '2026-09-30', days: 83 }),
      row({ id: 4, seq: 2, from_date: '2026-09-30', to_date: '2026-10-15', days: 15 }),
    ];
    const s = summarizeDeadlineChanges(rows, '2026-10-15');
    assert.equal(s.extension_count, 2);
    assert.equal(s.total_extended_days, 98);
    assert.equal(s.original_finish_date, '2026-07-09');
    assert.equal(s.last_extension?.id, 4);
  });
});

/* ------------------------------------------------------------------ */
/*  1.3 хүснэгт                                                        */
/* ------------------------------------------------------------------ */

describe('applyExtensionToTimelineRows', () => {
  test('хүснэгтгүй төсөл: гурван канон мөр үүсч, finish + ext хоёулаа шинэ огноо', () => {
    const rows = applyExtensionToTimelineRows([], '2026-09-30', { start_date: '2025-12-04' });
    assert.deepEqual(
      rows.map((r) => [r.id, r.date]),
      [['tl-start', '2025-12-04'], ['tl-finish', '2026-09-30'], ['tl-ext', '2026-09-30']],
    );
    // Багана ↔ мөрийн тойрог: дараагийн паспорт хадгалалт finish_date-ыг
    // шинэ огноогоор УНШИНА (сунгалт чимээгүй буцахгүй).
    const cols = columnsFromTimelineRows(rows);
    assert.equal(cols?.finish_date, '2026-09-30');
    assert.equal(cols?.extension_date, '2026-09-30');
    assert.equal(cols?.start_date, '2025-12-04');
  });

  test('1-р сунгалт хоосон tl-ext мөрд, 2-р сунгалт ШИНЭ мөр нэмнэ', () => {
    const base = defaultTimelineRows().map((r) =>
      r.id === 'tl-start' ? { ...r, date: '2025-12-04' } : r.id === 'tl-finish' ? { ...r, date: '2026-07-09' } : r,
    );
    const one = applyExtensionToTimelineRows(base, '2026-09-30');
    assert.deepEqual(one.map((r) => [r.id, r.date]), [
      ['tl-start', '2025-12-04'],
      ['tl-finish', '2026-09-30'],
      ['tl-ext', '2026-09-30'],
    ]);
    const two = applyExtensionToTimelineRows(one, '2026-10-15');
    assert.deepEqual(two.map((r) => [r.id, r.date]), [
      ['tl-start', '2025-12-04'],
      ['tl-finish', '2026-10-15'],
      ['tl-ext', '2026-09-30'],
      ['tl-ext-2', '2026-10-15'],
    ]);
    assert.equal(two[3]?.labelMn, 'Сунгалт');
    assert.equal(columnsFromTimelineRows(two)?.finish_date, '2026-10-15');
    assert.equal(columnsFromTimelineRows(two)?.extension_date, '2026-10-15');
    // Идемпотент: ижил огноогоор дахин дуудахад мөр нэмэгдэхгүй.
    assert.equal(applyExtensionToTimelineRows(two, '2026-10-15').length, 4);
  });

  test('хэрэглэгчийн гараар бичсэн шошго, нэмэлт мөр хэвээр', () => {
    const custom = [
      { id: 'tl-start', labelEn: 'Start', labelMn: 'Гэрээ байгуулсан', date: '2025-12-04' },
      { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Гэрээний хугацаа', date: '2026-07-09' },
      { id: 'tl-ext', labelEn: 'Extension', labelMn: 'Сунгалт', date: '' },
      { id: 'tl-ext-x9f2k', labelEn: 'Extension', labelMn: 'Сунгалт 2', date: '' },
    ];
    const out = applyExtensionToTimelineRows(custom, '2026-09-30');
    assert.equal(out[1]?.labelMn, 'Гэрээний хугацаа');
    assert.equal(out[2]?.date, '2026-09-30');
    assert.equal(out[3]?.date, '');
    assert.equal(out.length, 4);
  });

  test('хуучин байрлалын id (tl-0/tl-1/tl-2) — байрлалаар', () => {
    const legacy = [
      { id: 'tl-0', labelEn: 'Start', labelMn: 'Эхлэх', date: '2025-12-04' },
      { id: 'tl-1', labelEn: 'Finish', labelMn: 'Дуусах', date: '2026-07-09' },
      { id: 'tl-2', labelEn: 'Extension', labelMn: 'Сунгалт', date: '' },
    ];
    const out = applyExtensionToTimelineRows(legacy, '2026-09-30');
    assert.equal(out[1]?.date, '2026-09-30');
    // tl-2 нь `tl-ext` угтваргүй тул сунгалтын мөр гэж танигдахгүй — шинэ мөр.
    assert.equal(out[3]?.id, 'tl-ext-2');
    assert.equal(columnsFromTimelineRows(out)?.finish_date, '2026-09-30');
  });
});

describe('revertExtensionInTimelineRows', () => {
  test('2-р сунгалтыг буцаахад нэмэгдсэн мөр устаж, finish өмнөх огноо', () => {
    const two = [
      { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх', date: '2025-12-04' },
      { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Дуусах', date: '2026-10-15' },
      { id: 'tl-ext', labelEn: 'Extension', labelMn: 'Сунгалт', date: '2026-09-30' },
      { id: 'tl-ext-2', labelEn: 'Extension', labelMn: 'Сунгалт', date: '2026-10-15' },
    ];
    const one = revertExtensionInTimelineRows(two, '2026-09-30', '2026-10-15');
    assert.deepEqual(one.map((r) => [r.id, r.date]), [
      ['tl-start', '2025-12-04'],
      ['tl-finish', '2026-09-30'],
      ['tl-ext', '2026-09-30'],
    ]);
    // 1-р сунгалтыг буцаахад канон tl-ext ганцаараа тул ХООСЛОНО.
    const zero = revertExtensionInTimelineRows(one, '2026-07-09', '2026-09-30');
    assert.deepEqual(zero.map((r) => [r.id, r.date]), [
      ['tl-start', '2025-12-04'],
      ['tl-finish', '2026-07-09'],
      ['tl-ext', ''],
    ]);
    assert.deepEqual(revertExtensionInTimelineRows([], '2026-07-09', '2026-09-30'), []);
  });
});

/* ------------------------------------------------------------------ */
/*  Migration 0337 on node:sqlite                                      */
/* ------------------------------------------------------------------ */

function fakeD1(db: DatabaseSync): D1Database {
  const mk = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mk(sql, a),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) as never,
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } } as never;
    },
    raw: async () => [] as never,
  });
  return { prepare: (sql: string) => mk(sql) } as unknown as D1Database;
}

function freshDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT)`);
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT)`);
  db.exec(`INSERT INTO users VALUES (7, 'А.Анар'); INSERT INTO projects VALUES (30, 'MGL-251006')`);
  const migration = readFileSync(new URL('../../migrations/0337_project_deadline_changes.sql', import.meta.url), 'utf8');
  db.exec(migration);
  return { db, d1: fakeD1(db) };
}

describe('migration 0337 + insert helpers (SQL)', () => {
  test('extension мөр: days бодогдоно, CHECK нь буруу kind/approver-ийг хаана', async () => {
    const { db, d1 } = freshDb();
    await deadlineChangeInsert(d1, {
      project_id: 30, kind: 'extension', seq: 1, from_date: '2026.07.09', to_date: '2026-09-30',
      reason: 'ТД өөрчлөгдсөн', approved_by_kind: 'client', approved_by_name: 'Б.Бат',
      approved_on: TODAY, reference_no: '№12', created_by: 7,
    }).run();
    const r = db.prepare('SELECT * FROM project_deadline_changes').get() as Record<string, unknown>;
    assert.equal(r.days, 83);
    assert.equal(r.seq, 1);
    assert.equal(r.approved_by_kind, 'client');
    assert.ok(typeof r.created_at === 'string' && r.created_at.length >= 19);
    assert.throws(() =>
      db.prepare(`INSERT INTO project_deadline_changes (project_id, kind) VALUES (30, 'bogus')`).run(),
    );
    assert.throws(() =>
      db.prepare(`INSERT INTO project_deadline_changes (project_id, kind, approved_by_kind) VALUES (30, 'extension', 'boss')`).run(),
    );
  });

  test('recordDeadlineCorrection — ижил утга алгасна, өөрчлөлт бичигдэнэ', async () => {
    const { db, d1 } = freshDb();
    assert.equal(await recordDeadlineCorrection(d1, { project_id: 30, from_date: null, to_date: null, created_by: 7 }), false);
    assert.equal(await recordDeadlineCorrection(d1, { project_id: 30, from_date: '2026-07-09', to_date: '2026-07-09', created_by: 7 }), false);
    assert.equal(await recordDeadlineCorrection(d1, { project_id: 30, from_date: null, to_date: '2026-07-09', created_by: 7 }), true);
    assert.equal(
      await recordDeadlineCorrection(d1, { project_id: 30, from_date: '2026-07-09', to_date: '2026-07-01', created_by: 7, note: 'алдаа' }),
      true,
    );
    const rows = db.prepare('SELECT kind, seq, from_date, to_date, days, note FROM project_deadline_changes ORDER BY id').all().map((r) => ({ ...r }));
    assert.deepEqual(rows, [
      { kind: 'correction', seq: null, from_date: null, to_date: '2026-07-09', days: null, note: null },
      { kind: 'correction', seq: null, from_date: '2026-07-09', to_date: '2026-07-01', days: -8, note: 'алдаа' },
    ]);
  });

  test('extensionRequiredBody — 409-ийн бие одоогийн хугацааг ISO-гоор өгнө', () => {
    const b = extensionRequiredBody('2026.07.09');
    assert.equal(b.code, 'EXTENSION_REQUIRED');
    assert.equal(b.current_finish_date, '2026-07-09');
    assert.ok(b.error.includes('сунгах'));
  });
});
