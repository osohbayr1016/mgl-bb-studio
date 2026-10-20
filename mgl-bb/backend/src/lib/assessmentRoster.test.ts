/**
 * `lib/assessmentRoster.ts`-ийн цэвэр хэсгийн тест.
 *
 * D1 шаарддаг гарцууд (`resolveCohortIds`, `autoEnrollUserIntoOpenRounds`,
 * `pruneInactiveUserFromRosters`) энд оролцохгүй.  Харин `enrollStatements`
 * нь `db`-г ЗӨВХӨН `prepare().bind()` дуудахад хэрэглэдэг тул хуурамч
 * бүртгэгч db-ээр бүрэн шалгаж болно — энэ функцийн ИДЕМПОТЕНТ байдал
 * (`INSERT OR IGNORE`) нь «нэмэх» товчийг хоёр дарахад давхардал үүсэхээс
 * сэргийлдэг цорын ганц хамгаалалт тул тестээр барьж авах нь чухал.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { AssessmentRoundRow } from '../types';

// `assessmentRoster.ts` нь өргөтгөлгүй харьцангуй импорт бичдэг (`./notify`) —
// Worker-ийн bundler үүнийг шийддэг ч Node-ийн ESM loader шийддэггүй.
// `webPush.test.ts` / `leaveWindow.test.ts`-ийн адил зөвхөн тестийн хүрээнд
// `.ts` руу буулгана.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

// Hook-ийн ДАРАА ачаалагдах ёстой тул динамик импорт.
const {
  PARTICIPANT_ROLES,
  cohortSpecOf,
  enrollStatements,
  isCohortKnown,
  jsonTextToIds,
  jsonTextToStrings,
  toJsonText,
} = await import('./assessmentRoster.ts');

/** Бичигдсэн SQL-ийг цуглуулдаг хамгийн бага db хуулбар. */
function recordingDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          calls.push({ sql, binds });
          return this;
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

function roundRow(overrides: Partial<AssessmentRoundRow> = {}): AssessmentRoundRow {
  return {
    id: 2,
    template_id: 1,
    name: 'test',
    period: '2026',
    status: 'open',
    schema_json: '{}',
    opens_at: null,
    closes_at: null,
    team_codes: null,
    senior_user_ids: null,
    roles: null,
    user_ids: null,
    excluded_user_ids: null,
    auto_enroll: 1,
    created_by_id: null,
    created_at: '2026-08-06 00:51:23',
    updated_at: '2026-08-06 00:51:23',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// JSON текст багануудын хос функц
// ---------------------------------------------------------------------------

test('jsonTextToIds / jsonTextToStrings: гэмтэлтэй JSON бол хоосон массив', () => {
  assert.deepEqual(jsonTextToIds(null), []);
  assert.deepEqual(jsonTextToIds(''), []);
  assert.deepEqual(jsonTextToIds('{ not json'), []);
  assert.deepEqual(jsonTextToIds('{"a":1}'), [], 'массив биш бол хоосон');
  assert.deepEqual(jsonTextToIds('[4,11,4]'), [4, 11], 'давхардал арилна');
  assert.deepEqual(jsonTextToIds('[1,"x",2.5,3]'), [1, 3], 'бүхэл тоо биш утга хаягдана');

  assert.deepEqual(jsonTextToStrings('["BA"," BB "]'), ['BA', 'BB'], 'зай тайрагдана');
  assert.deepEqual(jsonTextToStrings('["", "BA"]'), ['BA'], 'хоосон мөр хаягдана');
  assert.deepEqual(jsonTextToStrings('nope'), []);
});

test('toJsonText: хоосон массив бол NULL (шүүлт хялбар болно)', () => {
  assert.equal(toJsonText([]), null);
  assert.equal(toJsonText(['BA']), '["BA"]');
  assert.equal(toJsonText([4, 11]), '[4,11]');
});

// ---------------------------------------------------------------------------
// Хамрах хүрээ
// ---------------------------------------------------------------------------

test('cohortSpecOf: гурван баганыг уншина', () => {
  const spec = cohortSpecOf(
    roundRow({ team_codes: '["BB"]', roles: '["engineer"]', user_ids: '[12,15]' }),
  );
  assert.deepEqual(spec, { userIds: [12, 15], teamCodes: ['BB'], roles: ['engineer'] });
});

test('isCohortKnown: 0182-оос ӨМНӨХ раунд (гурвуулаа NULL) нь МЭДЭГДЭХГҮЙ', () => {
  // Энэ бол production дээрх 2-р раундын яг хэлбэр.  Sync нь ийм раунд дээр
  // ЮУ Ч ХИЙХГҮЙ байх ёстой — таамаглаж «бүх хүн» гэвэл хэдэн арван хүнд
  // буруу мэдэгдэл явна.
  assert.equal(isCohortKnown(cohortSpecOf(roundRow())), false);

  assert.equal(isCohortKnown(cohortSpecOf(roundRow({ team_codes: '["BB"]' }))), true);
  assert.equal(isCohortKnown(cohortSpecOf(roundRow({ roles: '["engineer"]' }))), true);
  assert.equal(isCohortKnown(cohortSpecOf(roundRow({ user_ids: '[7]' }))), true);
  // Хоосон массив нь NULL-тай адил — «сонгоогүй».
  assert.equal(isCohortKnown(cohortSpecOf(roundRow({ team_codes: '[]' }))), false);
});

test('PARTICIPANT_ROLES: admin нь оролцогч БИШ (2026-08-19 шийдвэр)', () => {
  assert.ok(!PARTICIPANT_ROLES.includes('admin'), 'админ бол зохион байгуулагч');
  assert.ok(!PARTICIPANT_ROLES.includes('client'));
  assert.ok(!PARTICIPANT_ROLES.includes('worker'));
  assert.deepEqual([...PARTICIPANT_ROLES].sort(), ['architect', 'engineer', 'senior']);
});

// ---------------------------------------------------------------------------
// Бүртгэл — идемпотент байдал ба үнэлэгчийн ачаалал
// ---------------------------------------------------------------------------

test('enrollStatements: БҮХ INSERT нь OR IGNORE — sync давхар дарахад аюулгүй', () => {
  const { db, calls } = recordingDb();
  enrollStatements(db, 2, [79], () => [26, 27]);

  assert.ok(calls.length > 0);
  for (const { sql } of calls) {
    assert.match(
      sql,
      /INSERT OR IGNORE/,
      `идемпотент биш statement олдлоо — давхардал үүснэ:\n${sql}`,
    );
  }
});

test('enrollStatements: нэг оролцогч + self маягт + үнэлэгч тус бүрд нэг маягт', () => {
  const { db, calls } = recordingDb();
  enrollStatements(db, 2, [79], () => [26, 27]);

  const participants = calls.filter((c) => /assessment_participants/.test(c.sql));
  const selfRows = calls.filter((c) => /'self'/.test(c.sql));
  const seniorRows = calls.filter((c) => /'senior'/.test(c.sql));

  assert.equal(participants.length, 1);
  assert.equal(selfRows.length, 1);
  assert.equal(seniorRows.length, 2, 'үнэлэгч бүрд нэг мөр');

  // `assessment_participants` нь нэг л үнэлэгч барина — ЭХНИЙХ нь.
  assert.deepEqual(participants[0]?.binds, [2, 79, 26]);
  // self маягтын эзэн нь ажилтан өөрөө.
  assert.deepEqual(selfRows[0]?.binds, [2, 79, 79]);
  assert.deepEqual(seniorRows.map((c) => c.binds[2]), [26, 27]);
});

test('enrollStatements: үнэлэгчгүй хүн ч self маягтаа авна (primary = NULL)', () => {
  const { db, calls } = recordingDb();
  enrollStatements(db, 2, [79], () => []);

  const participants = calls.filter((c) => /assessment_participants/.test(c.sql));
  assert.deepEqual(participants[0]?.binds, [2, 79, null], 'ахлагчгүй бол NULL');
  assert.equal(calls.filter((c) => /'self'/.test(c.sql)).length, 1);
  assert.equal(calls.filter((c) => /'senior'/.test(c.sql)).length, 0);
});

test('enrollStatements: evaluatorLoad нь мэдэгдэлд бичих БОДИТ ачааллыг тоолно', () => {
  const { db } = recordingDb();
  // Хоёр ажилтан, хоёулаа ижил хоёр ахлагчид оногдоно.
  const { evaluatorLoad } = enrollStatements(db, 2, [79, 80], () => [26, 27]);
  assert.equal(evaluatorLoad.get(26), 2);
  assert.equal(evaluatorLoad.get(27), 2);
  assert.equal(evaluatorLoad.size, 2, 'өөр хэн ч мэдэгдэл авахгүй');
});

test('enrollStatements: хоосон жагсаалт бол нэг ч statement үүсэхгүй', () => {
  const { db, calls } = recordingDb();
  const { evaluatorLoad } = enrollStatements(db, 2, [], () => [26]);
  assert.equal(calls.length, 0);
  assert.equal(evaluatorLoad.size, 0, 'хэн ч мэдэгдэл авахгүй');
});
