/**
 * `lib/bimEvents.ts` — BIM үйл явдлын леджерийн бичих гарцын тест.
 *
 * Run with:  node --test src/lib/bimEvents.test.ts
 *
 * ХАМГИЙН ЧУХАЛ ХОЁР ТЕСТ:
 *   1. `bind арифметик` — тогтмол нь `VALUES` цуваа-ны `?` тоотой ТЭНЦҮҮ.
 *      Тайлбар хуучирдаг, тест хуучирдаггүй: `routes/revit.ts:1703` дээр
 *      өнөөдөр production дээр «12 bind/мөр → 8 мөр/statement» гэж ХУДАЛ
 *      бичигдсэн байдаг, харин доор нь `BINDS = 13`, `PER = 7`.
 *   2. `миграцтай тулгах` — bind баганын жагсаалт нь шипсэн 0201..0210
 *      миграцын БОДИТ DDL-тэй таарна.  Багана нэмээд/хасаад жагсаалтаа
 *      мартвал энд барина, production дээр `no such column` БИШ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

// Апп-ын эх код нь өргөтгөлгүй импорт бичдэг; Node-ийн ESM loader түүнийг
// шийддэггүй.  `webPush.test.ts:18-25`, `modules.test.ts:13-20`-ийн заншил.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const M = await import('./bimEvents.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'migrations');
const SRC = join(HERE, '..');

/* ================================================================== */
/*  Миграцын DDL задлагч                                               */
/* ================================================================== */

interface ColumnDef {
  name: string;
  notNull: boolean;
  hasDefault: boolean;
  generated: boolean;
  pk: boolean;
}

function stripLineComments(sql: string): string {
  // ⚠️ Миграцын файлууд CRLF.  `split('\n')` нь мөр бүрийн төгсгөлд `\r`
  // үлдээдэг ба `.` нь `\r`-ыг таарууладаггүй тул `$` ХЭЗЭЭ Ч бэхлэгддэггүй
  // — тайлбар СТРИПЛЭГДЭХГҮЙ, тайлбартай багана `splitTopLevel`-ийн нэг
  // хэсэгт наалдаж, `--`-аар эхэлсэн тул чимээгүй АЛГАСАГДДАГ байв.
  return sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/** Дээд түвшний таслалаар хуваах (хаалт доторх таслалыг хүндэтгэнэ). */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const TABLE_CONSTRAINT = /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i;

/** `CREATE TABLE` + дараагийн миграцын `ALTER TABLE … ADD COLUMN`-ыг нэгтгэнэ. */
function tableColumns(table: string): Map<string, ColumnDef> {
  const cols = new Map<string, ColumnDef>();
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS, f), 'utf8'));

    const create = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\(([\\s\\S]*?)\\n\\)\\s*;`,
      'i',
    ).exec(sql);
    if (create?.[1]) {
      for (const raw of splitTopLevel(create[1])) {
        const line = raw.trim();
        if (!line || TABLE_CONSTRAINT.test(line)) continue;
        const name = /^["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?/.exec(line)?.[1];
        if (!name) continue;
        cols.set(name, {
          name,
          notNull: /\bNOT\s+NULL\b/i.test(line),
          hasDefault: /\bDEFAULT\b/i.test(line),
          generated: /\bGENERATED\s+ALWAYS\b/i.test(line),
          pk: /\bPRIMARY\s+KEY\b/i.test(line),
        });
      }
    }

    const alter = new RegExp(
      `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+([\\s\\S]*?);`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = alter.exec(sql)) !== null) {
      const line = (m[1] ?? '').trim();
      const name = /^["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?/.exec(line)?.[1];
      if (!name) continue;
      cols.set(name, {
        name,
        notNull: /\bNOT\s+NULL\b/i.test(line),
        hasDefault: /\bDEFAULT\b/i.test(line),
        generated: /\bGENERATED\s+ALWAYS\b/i.test(line),
        pk: false,
      });
    }
  }
  return cols;
}

/* ================================================================== */
/*  1. BIND АРИФМЕТИК                                                  */
/* ================================================================== */

const TABLES = [
  {
    label: 'bim_artifacts',
    columns: M.ARTIFACT_INSERT_COLUMNS,
    binds: M.ARTIFACT_BINDS,
    tuple: M.ARTIFACT_VALUES_TUPLE,
    per: M.ARTIFACT_ROWS_PER_STATEMENT,
  },
  {
    label: 'bim_sessions',
    columns: M.SESSION_INSERT_COLUMNS,
    binds: M.SESSION_BINDS,
    tuple: M.SESSION_VALUES_TUPLE,
    per: M.SESSION_ROWS_PER_STATEMENT,
  },
  {
    label: 'revit_transactions',
    columns: M.TXN_INSERT_COLUMNS,
    binds: M.TXN_BINDS,
    tuple: M.TXN_VALUES_TUPLE,
    per: M.TXN_ROWS_PER_STATEMENT,
  },
  {
    label: 'revit_element_touches',
    columns: M.TOUCH_INSERT_COLUMNS,
    binds: M.TOUCH_BINDS,
    tuple: M.TOUCH_VALUES_TUPLE,
    per: M.TOUCH_ROWS_PER_STATEMENT,
  },
  {
    label: 'learning_events',
    columns: M.EVENT_INSERT_COLUMNS,
    binds: M.EVENT_BINDS,
    tuple: M.EVENT_VALUES_TUPLE,
    per: M.EVENT_ROWS_PER_STATEMENT,
  },
] as const;

for (const t of TABLES) {
  test(`${t.label}: VALUES цуваа-ны ? тоо = bind баганын тоо`, () => {
    const q = (t.tuple.match(/\?/g) ?? []).length;
    assert.equal(q, t.binds, `${t.label}: цуваанд ${q} тэмдэгт, тогтмол нь ${t.binds}`);
    assert.equal(t.columns.length, t.binds);
  });

  test(`${t.label}: нэг statement D1-ийн 100 bind таазыг давахгүй`, () => {
    assert.ok(t.per >= 1, `${t.label}: нэг мөр ч багтахгүй байна`);
    assert.ok(t.per * t.binds <= 100, `${t.label}: ${t.per} × ${t.binds} > 100`);
  });

  test(`${t.label}: НЭГ БАГАНЫН НӨӨЦ хэвээр байна`, () => {
    // Маргааш `ALTER TABLE ADD COLUMN` хийхэд statement ЧИМЭЭГҮЙ унахгүй.
    assert.ok(
      t.per * (t.binds + 1) <= 100,
      `${t.label}: нөөц алга — ROWS_PER_STATEMENT-ийг бууруул`,
    );
  });

  test(`${t.label}: INSERT баганын жагсаалт давхардаагүй`, () => {
    assert.equal(new Set(t.columns).size, t.columns.length);
  });
}

/* ================================================================== */
/*  2. ШИПСЭН МИГРАЦТАЙ ТУЛГАХ                                         */
/* ================================================================== */

for (const t of TABLES) {
  test(`${t.label}: bind багана бүр миграцад БАЙГАА, GENERATED БИШ`, () => {
    const cols = tableColumns(t.label);
    assert.ok(cols.size > 0, `${t.label}: миграцаас DDL олдсонгүй`);
    for (const name of t.columns) {
      const def = cols.get(name);
      assert.ok(def, `${t.label}.${name} нь миграцад БАЙХГҮЙ`);
      assert.equal(
        def.generated,
        false,
        `${t.label}.${name} нь GENERATED — түүнд bind зарцуулах нь SQLite алдаа`,
      );
    }
  });

  test(`${t.label}: DEFAULT-гүй NOT NULL багана бүр bind жагсаалтад байна`, () => {
    // ⚠️ Энэ тест нь «production дээр NOT NULL constraint failed» гэсэн
    //    ангиллыг бүхэлд нь устгана.
    const cols = tableColumns(t.label);
    const declared = new Set<string>(t.columns);
    const missing = [...cols.values()]
      .filter((c) => c.notNull && !c.hasDefault && !c.pk && !c.generated)
      .map((c) => c.name)
      .filter((n) => !declared.has(n));
    assert.deepEqual(missing, [], `${t.label}: bind жагсаалтаас дутуу: ${missing.join(', ')}`);
  });
}

test('subquery-ээр шийдэгддэг багана нь uid-ээр bind хийгддэг', () => {
  // `txn_id` / `parent_event_id` / `causal_event_id` / `cause_event_id` /
  // `parent_txn_id` — тавуулаа id, гэвч клиент зөвхөн uid мэднэ.
  assert.match(M.TOUCH_VALUES_TUPLE, /SELECT id FROM revit_transactions WHERE txn_uid = \?/);
  assert.match(M.EVENT_VALUES_TUPLE, /SELECT id FROM revit_transactions WHERE txn_uid = \?/);
  assert.equal(
    (M.EVENT_VALUES_TUPLE.match(/SELECT id FROM learning_events WHERE event_uid = \?/g) ?? [])
      .length,
    2,
    'parent_event_id ба causal_event_id ХОЁУЛАА дэд асуулгатай байх ёстой',
  );
  assert.match(M.TXN_VALUES_TUPLE, /SELECT id FROM learning_events WHERE event_uid = \?/);
  assert.match(M.TXN_VALUES_TUPLE, /SELECT id FROM revit_transactions WHERE txn_uid = \?/);
});

test('parts_missing нь хоёулан хүснэгтэд GENERATED баганаар байна', () => {
  for (const table of ['revit_transactions', 'learning_events']) {
    const def = tableColumns(table).get('parts_missing');
    assert.ok(def, `${table}.parts_missing миграцад алга`);
    assert.equal(def.generated, true, `${table}.parts_missing нь GENERATED байх ёстой`);
  }
  assert.match(M.DATASET_ELIGIBLE_SQL, /parts_missing/);
});

/* ================================================================== */
/*  3. ХААЛТТАЙ БАГЦУУД — БҮРЭН Record                                 */
/* ================================================================== */

test('REQUIRED_PARTS_OF нь kind БҮРИЙГ хамарна', () => {
  for (const k of M.LEARNING_EVENT_KINDS) {
    assert.ok(Array.isArray(M.REQUIRED_PARTS_OF[k]), `${k} дутуу`);
  }
  assert.equal(Object.keys(M.REQUIRED_PARTS_OF).length, M.LEARNING_EVENT_KINDS.length);
});

test('DEFAULT_ACTOR_OF нь kind БҮРИЙГ хамарна', () => {
  for (const k of M.LEARNING_EVENT_KINDS) {
    assert.ok(
      (M.ACTOR_KINDS as readonly string[]).includes(M.DEFAULT_ACTOR_OF[k]),
      `${k}-ийн анхдагч actor буруу`,
    );
  }
  assert.equal(Object.keys(M.DEFAULT_ACTOR_OF).length, M.LEARNING_EVENT_KINDS.length);
});

test('PART_BIT нь давхардаагүй, хоёрын зэрэг утгууд', () => {
  const seen = new Set<number>();
  for (const p of M.SATELLITE_PARTS) {
    const bit = M.PART_BIT[p];
    assert.ok(bit > 0 && (bit & (bit - 1)) === 0, `${p} = ${bit} нь хоёрын зэрэг БИШ`);
    assert.ok(!seen.has(bit), `${p}-ийн бит давхардсан`);
    seen.add(bit);
  }
  assert.equal(Object.keys(M.PART_BIT).length, M.SATELLITE_PARTS.length);
});

test('0203-ын битийн хуваарь ЯГ ХЭВЭЭР (шипсэн мөрүүдийн утга)', () => {
  // ⚠️ Утга солих нь аль хэдийн бичигдсэн мөрүүдийн утгыг өөрчилнө.
  assert.deepEqual(M.PART_BIT, {
    ELEMENT_ROWS: 1,
    ELEMENT_DELTA: 2,
    ELEMENT_ATTRS: 4,
    VIEW_IMAGE: 8,
    AI_CAUSE: 16,
    RULE_VERDICT: 32,
    CORRECTION: 64,
    APPROVAL: 128,
    REPORT: 256,
  });
});

test('maskOf / partsOfMask нь тойрог хийнэ', () => {
  const parts = ['ELEMENT_ROWS', 'AI_CAUSE', 'REPORT'] as const;
  const mask = M.maskOf(parts);
  assert.equal(mask, 1 + 16 + 256);
  assert.deepEqual(M.partsOfMask(mask).sort(), [...parts].sort());
  assert.equal(M.maskOf([]), 0);
  assert.deepEqual(M.partsOfMask(0), []);
});

test('WRITE_TIME_PARTS ба DEFERRED_PARTS нь SATELLITE_PARTS-ыг бүрэн хуваана', () => {
  const union = [...M.WRITE_TIME_PARTS, ...M.DEFERRED_PARTS].sort();
  assert.deepEqual(union, [...M.SATELLITE_PARTS].sort());
  for (const p of M.DEFERRED_PARTS) {
    assert.ok(!M.WRITE_TIME_PARTS.includes(p), `${p} хоёуланд нь байна`);
  }
});

test('contractTag нь DB-ийн GLOB CHECK-д таарна', () => {
  // CHECK (payload_contract GLOB 'v[0-9]*:*')
  for (const k of M.LEARNING_EVENT_KINDS) {
    const tag = M.contractTag(k);
    assert.match(tag, /^v[0-9][^:]*:.+/, `${k} → ${tag}`);
    assert.ok(tag.startsWith(`v${M.CONTRACT_VERSION}:${k}`));
  }
});

test('PROVENANCE / ARTIFACT / OP_CLASS / ORIGIN багцууд хоосон биш, давхардаагүй', () => {
  for (const list of [
    M.PROVENANCE_VALUES,
    M.ARTIFACT_KINDS,
    M.OP_CLASSES,
    M.TXN_ORIGINS,
    M.TOUCH_CHANGES,
    M.ACTOR_KINDS,
    M.LEARNING_EVENT_KINDS,
  ]) {
    assert.ok(list.length > 0);
    assert.equal(new Set(list).size, list.length);
  }
});

test('TOUCH_CHANGES нь 0204-ийн CHECK-тэй ЯГ таарна', () => {
  // CHECK (change IN ('add','modify','delete')) — DB дээр хатуу хаалттай.
  assert.deepEqual([...M.TOUCH_CHANGES], ['add', 'modify', 'delete']);
});

/* ================================================================== */
/*  4. МАСК ТООЦООЛОХ ЛОГИК                                            */
/* ================================================================== */

const B = M.PART_BIT;

test('partsForTxn: элементгүй гүйлгээ юу ч хүлээхгүй', () => {
  const r = M.partsForTxn({
    elementTotal: 0,
    touchRowsSent: 0,
    touchesHaveAttrs: false,
    touchesTruncated: false,
    elementArtifact: 'none',
    cause: 'none',
  });
  assert.equal(r.expected, 0);
  assert.equal(r.present, 0);
});

test('partsForTxn: бүрэн ирсэн мөрүүд → дутуу зүйл БАЙХГҮЙ', () => {
  const r = M.partsForTxn({
    elementTotal: 3,
    touchRowsSent: 3,
    touchesHaveAttrs: true,
    touchesTruncated: false,
    elementArtifact: 'resolved',
    cause: 'resolved',
  });
  assert.equal(r.expected & ~r.present, 0, 'parts_missing тэг байх ёстой');
  assert.ok((r.present & B.ELEMENT_ROWS) !== 0);
  assert.ok((r.present & B.ELEMENT_ATTRS) !== 0);
  assert.ok((r.present & B.ELEMENT_DELTA) !== 0);
  assert.ok((r.present & B.AI_CAUSE) !== 0);
});

test('partsForTxn: ТАСАЛСАН мөр нь ELEMENT_ROWS-ыг УНТРААНА (алдагдал ил гарна)', () => {
  const r = M.partsForTxn({
    elementTotal: 100,
    touchRowsSent: 24,
    touchesHaveAttrs: true,
    touchesTruncated: true,
    elementArtifact: 'none',
    cause: 'none',
  });
  assert.ok((r.expected & B.ELEMENT_ROWS) !== 0, 'хүлээгдэж байх ёстой');
  assert.equal(r.present & B.ELEMENT_ROWS, 0, 'ирээгүй гэж тэмдэглэгдэх ёстой');
  assert.notEqual(r.expected & ~r.present, 0, 'parts_missing тэг БИШ байх ёстой');
});

test('partsForTxn: атрибутгүй мөр нь ELEMENT_ATTRS-ыг УНТРААНА (2-р үе шат ажиллаагүй)', () => {
  const r = M.partsForTxn({
    elementTotal: 5,
    touchRowsSent: 5,
    touchesHaveAttrs: false,
    touchesTruncated: false,
    elementArtifact: 'none',
    cause: 'none',
  });
  assert.ok((r.present & B.ELEMENT_ROWS) !== 0);
  assert.equal(r.present & B.ELEMENT_ATTRS, 0);
});

test('partsForTxn: ЗАРЛАСАН ч шийдэгдээгүй cause нь AI_CAUSE-ыг дутуу болгоно', () => {
  const r = M.partsForTxn({
    elementTotal: 0,
    touchRowsSent: 0,
    touchesHaveAttrs: false,
    touchesTruncated: false,
    elementArtifact: 'none',
    cause: 'declared',
  });
  assert.ok((r.expected & B.AI_CAUSE) !== 0);
  assert.equal(r.present & B.AI_CAUSE, 0);
});

test('partsForTxn: ХОЖИМ мэдэгдэх битийг ХЭЗЭЭ Ч хүлээхгүй', () => {
  // Эс тэгвээс гүйлгээ бүр МӨНХӨД «дутуу» гэж тэмдэглэгдэнэ.
  const r = M.partsForTxn({
    elementTotal: 9,
    touchRowsSent: 9,
    touchesHaveAttrs: true,
    touchesTruncated: false,
    elementArtifact: 'resolved',
    cause: 'resolved',
  });
  for (const p of M.DEFERRED_PARTS) {
    assert.equal(r.expected & B[p], 0, `${p} нь гүйлгээний expected-д байх ЁСГҮЙ`);
  }
});

test('partsForEvent: IMAGE нь артефактгүй бол дутуу', () => {
  const без = M.partsForEvent({
    kind: 'IMAGE',
    artifactResolved: false,
    txn: 'none',
    parent: 'none',
    payload: {},
  });
  assert.ok((без.expected & B.VIEW_IMAGE) !== 0);
  assert.equal(без.present & B.VIEW_IMAGE, 0);

  const c = M.partsForEvent({
    kind: 'IMAGE',
    artifactResolved: true,
    txn: 'none',
    parent: 'none',
    payload: {},
  });
  assert.equal(c.expected & ~c.present, 0);
});

test('partsForEvent: эцэггүй HUMAN_CORRECTION нь дутуу гэж тэмдэглэгдэнэ', () => {
  const orphan = M.partsForEvent({
    kind: 'HUMAN_CORRECTION',
    artifactResolved: false,
    txn: 'none',
    parent: 'declared',
    payload: { corrected_intent: 'isolate_sheet' },
  });
  assert.notEqual(orphan.expected & ~orphan.present, 0);

  const linked = M.partsForEvent({
    kind: 'HUMAN_CORRECTION',
    artifactResolved: false,
    txn: 'none',
    parent: 'resolved',
    payload: { corrected_intent: 'isolate_sheet' },
  });
  assert.equal(linked.expected & ~linked.present, 0);
});

test('partsForEvent: RULE_VALIDATION / FINAL_APPROVAL нь агуулгаараа шийдэгдэнэ', () => {
  const badRule = M.partsForEvent({
    kind: 'RULE_VALIDATION',
    artifactResolved: false,
    txn: 'none',
    parent: 'none',
    payload: { rule_id: 'MGL-BA-014' }, // `passed` дутуу
  });
  assert.notEqual(badRule.expected & ~badRule.present, 0);

  const okApproval = M.partsForEvent({
    kind: 'FINAL_APPROVAL',
    artifactResolved: false,
    txn: 'none',
    parent: 'none',
    payload: { progress_entry_id: 123, decision: 'approved' },
  });
  assert.equal(okApproval.expected & ~okApproval.present, 0);
});

test('partsForEvent: txn заасан ч олдоогүй бол AI_CAUSE дутуу', () => {
  const r = M.partsForEvent({
    kind: 'USER_ACTION',
    artifactResolved: false,
    txn: 'declared',
    parent: 'none',
    payload: {},
  });
  assert.ok((r.expected & B.AI_CAUSE) !== 0);
  assert.equal(r.present & B.AI_CAUSE, 0);
});

/* ================================================================== */
/*  5. ТОПОЛОГИЙН ЧАНКЛАЛТ                                             */
/* ================================================================== */

test('chunkTopologically: эцэг нь хүүхэдтэйгээ НЭГ statement-д орохгүй', () => {
  const rows = [
    { uid: 'a', parent: null },
    { uid: 'b', parent: 'a' },
    { uid: 'c', parent: null },
    { uid: 'd', parent: null },
  ];
  const chunks = M.chunkTopologically(
    rows,
    4,
    (r) => r.uid,
    (r) => [r.parent],
  );
  assert.equal(chunks.length, 2, 'b нь a-тай нэг чанкт орох ЁСГҮЙ');
  assert.deepEqual(chunks[0]?.map((r) => r.uid), ['a']);
  assert.deepEqual(chunks[1]?.map((r) => r.uid), ['b', 'c', 'd']);
});

test('chunkTopologically: чанкийн дээд хэмжээг хүндэтгэнэ', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ uid: `u${i}`, parent: null }));
  const chunks = M.chunkTopologically(
    rows,
    4,
    (r) => r.uid,
    (r) => [r.parent],
  );
  assert.deepEqual(
    chunks.map((c) => c.length),
    [4, 4, 1],
  );
});

test('chunkTopologically: багцын ГАДНАХ эцэг нь чанклалтад нөлөөлөхгүй', () => {
  const rows = [
    { uid: 'x', parent: 'somewhere-else' },
    { uid: 'y', parent: 'also-outside' },
  ];
  const chunks = M.chunkTopologically(
    rows,
    4,
    (r) => r.uid,
    (r) => [r.parent],
  );
  assert.equal(chunks.length, 1);
});

test('chunkTopologically: хоосон оролт → хоосон гаралт', () => {
  assert.deepEqual(
    M.chunkTopologically(
      [] as Array<{ uid: string }>,
      4,
      (r) => r.uid,
      () => [],
    ),
    [],
  );
});

/* ================================================================== */
/*  6. НЭГ ФАЙЛЫН ДҮРЭМ — бичих гарц хаалттай                          */
/* ================================================================== */

/**
 * ⚠️ `scripts/check-bim-events.mjs`-ийн ХУУЛБАР, ЗОРИУДААР.  `npm test` нь
 *    энэ репод БОДИТООР ажилладаг цорын ганц гарц (frontend-д тест байхгүй,
 *    GitHub workflow хоёул унадаг, `wrangler deploy` нь typecheck хийдэггүй).
 *    Тиймээс grep баталгааг ЗӨВХӨН скриптэд үлдээх нь түүнийг хэн ч
 *    ажиллуулахгүй гэсэн үг.
 */
const GUARDED_TABLES = [
  'bim_artifacts',
  'bim_sessions',
  'revit_transactions',
  'revit_element_touches',
  'learning_events',
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('BIM хүснэгтүүдэд INSERT хийх нь ЗӨВХӨН lib/bimEvents.ts-д зөвшөөрөгдөнө', () => {
  const re = new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+(${GUARDED_TABLES.join('|')})\\b`, 'i');
  const bad = tsFiles(SRC)
    .filter((p) => !p.replace(/\\/g, '/').endsWith('src/lib/bimEvents.ts'))
    .filter((p) => !p.endsWith('.test.ts'))
    .filter((p) => re.test(readFileSync(p, 'utf8')));
  assert.deepEqual(bad, [], `bimEvents.ts-ээс ГАДНА INSERT хийсэн файл: ${bad.join(', ')}`);
});

test('BIM хүснэгтүүдэд UPDATE хийх нь bim_sessions-оос БУСДАД хориотой', () => {
  // ⚠️ 0206-ын trigger нь UPDATE-ыг таслана (redaction-оос бусад).  Кодод
  //    ийм UPDATE байх нь ажиллах үед `RAISE(ABORT)` болно — тестээр урьдчил.
  const immutable = GUARDED_TABLES.filter((t) => t !== 'bim_sessions');
  const re = new RegExp(`UPDATE\\s+(${immutable.join('|')})\\b`, 'i');
  const bad = tsFiles(SRC)
    .filter((p) => !p.endsWith('.test.ts'))
    .filter((p) => re.test(readFileSync(p, 'utf8')));
  assert.deepEqual(bad, [], `append-only хүснэгтэд UPDATE бичсэн файл: ${bad.join(', ')}`);
});

test('MCP давхаргад BIM леджер ГООЖООГҮЙ', () => {
  // `/mcp` нь workerScopeGuard, entitlementGuard, tenant-ийн хил ГУРВУУЛАНГ
  // тойрдог.  Ажилтны зан төлөвийн бүртгэлийг тэндээс ХЭЗЭЭ Ч гаргахгүй.
  const re = new RegExp(`(${GUARDED_TABLES.join('|')})|bimEvents`, 'i');
  const bad = tsFiles(join(SRC, 'mcp')).filter((p) => re.test(readFileSync(p, 'utf8')));
  assert.deepEqual(bad, [], `MCP-д BIM леджер дурдсан файл: ${bad.join(', ')}`);
});

/* ================================================================== */
/*  10. АЛДАГДЛЫН ТООЛУУР — БОДИТ SQLite ДЭЭР (0243)                   */
/* ================================================================== */

/**
 * ⚠️ ЭНЭ БҮЛГИЙН ШАЛТГААН — 2026-09-01-нд АМЬД хэмжсэн алдаа.
 *
 *    `bim_sessions.dropped_count` руу ХОЁР ХООРОНДОО НИЙЦГҮЙ дүрэм бичдэг
 *    байв: `upsertBimSession` нь MAX (клиентийн ХУРИМТЛАГДСАН тоолуур),
 *    `bumpSessionCounters` нь нэмэх (серверийн татгалзал).  Дараалал:
 *      POST1 — клиент 0 зарлав, сервер 3 хаяв → багана = 3
 *      POST2 — клиент 5 зарлав, цэвэр багц   → MAX(3, 5) = 5
 *    ҮНЭН НИЙЛБЭР нь 8.  Гурван алдагдал ЧИМЭЭГҮЙ УСТСАН.
 *
 *    ~20 машин дээр цуглуулга зөв явж байгаа эсэхийг хэмжих ЦОРЫН ГАНЦ
 *    хэрэгсэл нь энэ тоо тул доорх тест нь ЯГ ТЭР дарааллыг давтаж, 5 БИШ
 *    8 гэдгийг батална.  Тест унавал алдагдал дахин чимээгүй болсон гэсэн
 *    үг — SQL-ээ буцааж бүү «хялбарчил».
 *
 * ⚠️ Схемийг ФИКСТУРААС биш, МИГРАЦААС барина: багана нэмэгдээд миграцад
 *    тусгагдаагүй бол энд унана, production дээр `no such column` БИШ.
 */

/** Миграцаас `bim_sessions`-ийн БОДИТ DDL-ийг гаргаж авна. */
function bimSessionsDdl(): string[] {
  const stmts: string[] = [];
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS, f), 'utf8'));
    const create =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?bim_sessions\s*\(([\s\S]*?)\n\)\s*;/i.exec(sql);
    if (create?.[1]) stmts.push(`CREATE TABLE bim_sessions (${create[1]}\n);`);
    const alter = /ALTER\s+TABLE\s+bim_sessions\s+ADD\s+COLUMN\s+([\s\S]*?);/gi;
    let m: RegExpExecArray | null;
    while ((m = alter.exec(sql)) !== null) {
      stmts.push(`ALTER TABLE bim_sessions ADD COLUMN ${(m[1] ?? '').trim()};`);
    }
  }
  // `ON CONFLICT (session_uid)` нь UNIQUE индекс ШААРДАНА (0202-т тусдаа).
  stmts.push('CREATE UNIQUE INDEX idx_bim_sessions_uid ON bim_sessions (session_uid);');
  return stmts;
}

/** `D1Database`-ийн ХЭРЭГЛЭГДДЭГ хэсгийг node:sqlite дээр дуурайлгана. */
function d1Shim(db: DatabaseSync): D1Database {
  const bound = (sql: string, args: SQLInputValue[]) => ({
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return {
    prepare: (sql: string) => ({
      ...bound(sql, []),
      bind: (...args: SQLInputValue[]) => bound(sql, args),
    }),
  } as unknown as D1Database;
}

function freshSessionsDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const stmt of bimSessionsDdl()) db.exec(stmt);
  return db;
}

const LOSS_UID = 'S-LOSS-1';

/** Клиентийн зарласан алдагдлаас бусад талбар нь энэ тестэд ач холбогдолгүй. */
function sessionRow(clientDropped: number): M.BimSessionRow {
  return {
    session_uid: LOSS_UID,
    user_id: 7,
    project_id: null,
    revit_document_id: null,
    doc_uid: null,
    doc_title: 'Тест',
    is_link: 0,
    central_path_hash: null,
    machine_hash: null,
    worksharing: null,
    revit_version: '2027',
    revit_build: null,
    addin_version: '1.2.1',
    addin_channel: 'prod',
    model_version: null,
    prompt_version: null,
    ruleset_version: null,
    capture_schema: 1,
    capture_policy: 'full',
    notice_version: 'v1',
    started_at: '2026-09-01T00:00:00.000Z',
    ended_at: null,
    client_tz_offset_min: 480,
    clock_skew_sec: 0,
    txn_count: 0,
    event_count: 0,
    client_dropped_count: clientDropped,
  };
}

function counters(db: DatabaseSync): {
  dropped_count: number;
  client_dropped_count: number;
  server_dropped_count: number;
} {
  const r = db
    .prepare(
      `SELECT dropped_count, client_dropped_count, server_dropped_count
         FROM bim_sessions WHERE session_uid = ?`,
    )
    .get(LOSS_UID) as Record<string, number>;
  return {
    dropped_count: Number(r.dropped_count),
    client_dropped_count: Number(r.client_dropped_count),
    server_dropped_count: Number(r.server_dropped_count),
  };
}

test('АЛДАГДАЛ УСТДАГГҮЙ: сервер 3 → клиент 5 нь 5 БИШ, 8', async () => {
  const raw = freshSessionsDb();
  const db = d1Shim(raw);

  // POST1 — клиент 0 зарлав, сервер 3 муу гүйлгээг татгалзав.
  const first = await M.upsertBimSession(db, sessionRow(0));
  assert.equal(first.created, true);
  await M.bumpSessionCounters(db, first.id, { txns: 0, events: 0, dropped: 3 });
  assert.equal(counters(raw).dropped_count, 3, 'POST1-ийн дараа серверийн 3 харагдана');

  // POST2 — клиент ӨӨРИЙН ХУРИМТЛАГДСАН 5-ыг зарлав, багц нь цэвэр.
  const second = await M.upsertBimSession(db, sessionRow(5));
  assert.equal(second.id, first.id);
  await M.bumpSessionCounters(db, second.id, { txns: 2, events: 2, dropped: 0 });

  const c = counters(raw);
  assert.equal(c.client_dropped_count, 5, 'клиентийн хэмжигч = 5');
  assert.equal(c.server_dropped_count, 3, 'серверийн хуримтлагч = 3');
  assert.equal(c.dropped_count, 8, 'НИЙТ = 8 (хуучин код 5 өгдөг байсан)');
});

test('АЛДАГДАЛ УСТДАГГҮЙ: эсрэг дараалал (клиент 5 → сервер 3) ч мөн 8', async () => {
  const raw = freshSessionsDb();
  const db = d1Shim(raw);

  const first = await M.upsertBimSession(db, sessionRow(5));
  await M.bumpSessionCounters(db, first.id, { txns: 0, events: 0, dropped: 3 });

  const c = counters(raw);
  assert.equal(c.client_dropped_count, 5);
  assert.equal(c.server_dropped_count, 3);
  assert.equal(c.dropped_count, 8);
});

test('клиентийн хэмжигч нь ДАХИН ИЛГЭЭЛТЭД буурахгүй (MAX хэвээр)', async () => {
  const raw = freshSessionsDb();
  const db = d1Shim(raw);

  const s = await M.upsertBimSession(db, sessionRow(5));
  await M.bumpSessionCounters(db, s.id, { txns: 0, events: 0, dropped: 2 });
  // Хуучин багцыг дахин илгээв — тэр үеийн клиентийн тоолуур нь ЖИЖИГ (2).
  await M.upsertBimSession(db, sessionRow(2));

  const c = counters(raw);
  assert.equal(c.client_dropped_count, 5, 'жижиг утга нь томыг дарахгүй');
  assert.equal(c.server_dropped_count, 2, 'upsert нь серверийн тоолуурыг ХӨНДӨХГҮЙ');
  assert.equal(c.dropped_count, 7);
});

test('серверийн татгалзал ХУРИМТЛАГДАНА (гурван багц 1+2+3 = 6)', async () => {
  const raw = freshSessionsDb();
  const db = d1Shim(raw);

  const s = await M.upsertBimSession(db, sessionRow(0));
  for (const n of [1, 2, 3]) {
    await M.upsertBimSession(db, sessionRow(0));
    await M.bumpSessionCounters(db, s.id, { txns: 0, events: 0, dropped: n });
  }

  const c = counters(raw);
  assert.equal(c.server_dropped_count, 6);
  assert.equal(c.dropped_count, 6);
});

test('dropped_count нь ҮРГЭЛЖ хоёр бүрэлдэхүүний НИЙЛБЭР (инвариант)', async () => {
  const raw = freshSessionsDb();
  const db = d1Shim(raw);

  const s = await M.upsertBimSession(db, sessionRow(1));
  await M.bumpSessionCounters(db, s.id, { txns: 1, events: 1, dropped: 4 });
  await M.upsertBimSession(db, sessionRow(9));
  await M.bumpSessionCounters(db, s.id, { txns: 0, events: 0, dropped: 2 });
  await M.upsertBimSession(db, sessionRow(9));

  const c = counters(raw);
  assert.equal(c.dropped_count, c.client_dropped_count + c.server_dropped_count);
  assert.equal(c.dropped_count, 15);
});

test('СОРИЛТ: хуучин НЭГ БАГАНЫН дүрэм эргэж ирээгүй', () => {
  // ⚠️ Тайлбарын мөрүүдийг ХАСНА: энэ файлын СЭРЭМЖЛҮҮЛЭГ өөрөө хуучин
  //    хэв маягийг иш татдаг тул түүхий текстээр хайвал ХУДАЛ унана.
  const raw = readFileSync(join(SRC, 'lib', 'bimEvents.ts'), 'utf8');
  const src = raw
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trimStart();
      return (
        !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('--')
      );
    })
    .join('\n');
  // (а) upsert нь `dropped_count`-ыг клиентийн утгатай MAX хийхээ БОЛЬСОН.
  assert.ok(
    !/dropped_count\s*=\s*MAX\(\s*bim_sessions\.dropped_count/.test(src),
    'upsert нь dropped_count-ыг ДАХИН MAX хийж байна — алдагдал дарагдана',
  );
  // (б) bump нь `dropped_count`-ыг ШУУД нэмэхээ БОЛЬСОН.
  assert.ok(
    !/dropped_count\s*=\s*dropped_count\s*\+/.test(src),
    'bump нь dropped_count-ыг шууд нэмж байна — upsert-ийн MAX-тай мөргөлдөнө',
  );
  // (в) Хоёр эх сурвалж нь тус тусдаа баганатай хэвээр.
  assert.ok(src.includes('client_dropped_count'), 'client_dropped_count алга');
  assert.ok(src.includes('server_dropped_count'), 'server_dropped_count алга');
});
