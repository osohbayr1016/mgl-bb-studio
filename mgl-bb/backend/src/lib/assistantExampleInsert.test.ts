/**
 * ⚠️ ЭНЭ ТЕСТИЙН ГАНЦ ЗОРИЛГО: `assistant_examples`-ийн bind арифметикийг БАРИХ.
 *
 * 2026-08-28-нд ГУРВАН сесс энэ INSERT-ийг зэрэг өргөжүүлэв (1B-6, 1B-7) —
 * багана 7 → 13, bind 7 → 13.  Аль ч сесс нөгөөгийнхөө тоог хараагүй тул
 * нэгтгэх үед энэ гурвалсан нийцэл (багана ↔ `?` кортеж ↔ bind массив) нь
 * ЧИМЭЭГҮЙ эвдрэх хамгийн магадлалтай зүйл байв.  `tsc` үүнийг БАРИХГҮЙ;
 * D1 зөвхөн ЭХНИЙ БҮТЭН БАГЦ дээр bind-count алдаа өгнө.
 *
 * ⚠️ Тест унах нь ҮРГЭЛЖ бодит алдаа — тестийг сулруулж бүү зас, специйг зас.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  D1_MAX_BINDS,
  ASSISTANT_EXAMPLE_COLUMN_SPEC,
  ASSISTANT_EXAMPLE_COLUMNS,
  ASSISTANT_EXAMPLE_BINDS,
  ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT,
  ASSISTANT_EXAMPLE_TUPLE,
  ASSISTANT_EXAMPLE_COLUMN_SQL,
  SOURCE_TYPES,
  CLIENT_REVIEW_STATES,
  CURATION_ACTIONS,
  CLIENT_DECLARABLE_SOURCE_TYPES,
  deriveSourceType,
} from './assistantExampleInsert.ts';

test('баганын тоо нь специйн уртаас гарна', () => {
  assert.equal(ASSISTANT_EXAMPLE_COLUMNS.length, ASSISTANT_EXAMPLE_COLUMN_SPEC.length);
  // ⚠️ 0238_assistant_team_scope.sql (2-6) нь `team_code`-ыг нэмсэн: 13 -> 14.
  assert.equal(ASSISTANT_EXAMPLE_COLUMNS.length, 14);
});

test('баганын SQL нь мөн адил тооны нэртэй', () => {
  assert.equal(
    ASSISTANT_EXAMPLE_COLUMN_SQL.split(',').length,
    ASSISTANT_EXAMPLE_COLUMNS.length,
  );
});

test('кортеж дэх хэлтэрхийн тоо нь баганын тоотой ЯГ тэнцүү', () => {
  // Кортежийн гадна хаалтыг хасаад ДЭЭД түвшний таслалаар хуваана.
  // (`CASE ... END` дотор таслал БАЙХГҮЙ тул энгийн split хангалттай.)
  const inner = ASSISTANT_EXAMPLE_TUPLE.slice(1, -1);
  assert.equal(inner.split(',').length, ASSISTANT_EXAMPLE_COLUMNS.length);
});

test('bind тоо нь кортеж дэх `?`-ийн БОДИТ тоо', () => {
  assert.equal(ASSISTANT_EXAMPLE_BINDS, ASSISTANT_EXAMPLE_TUPLE.split('?').length - 1);
  // ⚠️ 0238 (2-6): `team_code` нэмэгдэв — 13 -> 14 bind.
  assert.equal(ASSISTANT_EXAMPLE_BINDS, 14);
});

test('⚠️ bind ≠ багана — `reviewed_at` нь CASE, нөхцөлдөө НЭГ bind нэмнэ', () => {
  // Энэ бол `assistantLogInsert.ts`-ээс ЯЛГААТАЙ гол зүйл.  Хэрэв энэ тэнцүү
  // болбол хэн нэгэн CASE-ыг энгийн `?` болгож, `pending` мөрд ХУДАЛ
  // хяналтын хугацаа бичих болсон гэсэн үг.
  const caseCols = ASSISTANT_EXAMPLE_COLUMN_SPEC.filter((c) => c[1] !== '?');
  assert.equal(caseCols.length, 1);
  assert.equal(caseCols[0]?.[0], 'reviewed_at');
  assert.equal(ASSISTANT_EXAMPLE_BINDS, ASSISTANT_EXAMPLE_COLUMNS.length);
  // (14 багана: 13 энгийн `?` + CASE-ийн 1 нөхцөлт bind = 14 bind.  Тоо
  //  тэнцүү боловч ШАЛТГААН нь өөр — доорх тест үүнийг ялгана.)
  const plain = ASSISTANT_EXAMPLE_COLUMN_SPEC.filter((c) => c[1] === '?').length;
  assert.equal(plain, 13);
  assert.equal(plain + 1, ASSISTANT_EXAMPLE_BINDS);
});

test('нэг statement D1-ийн 100 bind хязгаарт БАГТАНА', () => {
  const worst = ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT * ASSISTANT_EXAMPLE_BINDS;
  assert.ok(worst <= D1_MAX_BINDS, `${worst} > ${D1_MAX_BINDS}`);
  // ⚠️ 0238 (2-6): 14 bind x 7 мөр = 98.  Мөр/statement 7 ХЭВЭЭР.
  assert.equal(worst, 98);
});

test('нэмэлт нэг мөр хязгаарыг ДАВНА — PER нь хамгийн их утга мөн', () => {
  const over = (ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT + 1) * ASSISTANT_EXAMPLE_BINDS;
  assert.ok(over > D1_MAX_BINDS, `PER хэт бага: ${over} <= ${D1_MAX_BINDS}`);
});

test('баганын нэр давхардаагүй', () => {
  assert.equal(new Set(ASSISTANT_EXAMPLE_COLUMNS).size, ASSISTANT_EXAMPLE_COLUMNS.length);
});

test('баганын нэр бүр SQL-д аюулгүй (зөвхөн snake_case)', () => {
  for (const c of ASSISTANT_EXAMPLE_COLUMNS) assert.match(c, /^[a-z][a-z0-9_]*$/);
});

test('хуучин 7 багана ЯГ хэвээрээ, ЭХЭНД нь байна', () => {
  // ⚠️ Шинэ баганыг жагсаалтын ДУНД оруулбал bind бүр нэг байрлалаар
  // гулсаж, төрөл нь тохирвол D1 ч алдаа өгөхгүйгээр ЧИМЭЭГҮЙ буруу
  // баганад бичнэ.  Шинэ багана ЗААВАЛ ТӨГСГӨЛД.
  assert.deepEqual(ASSISTANT_EXAMPLE_COLUMNS.slice(0, 7), [
    'text', 'text_folded', 'intent', 'slot', 'style', 'source', 'created_by',
  ]);
});

test('0215-ийн итгэлийн 5 багана + 0214-ийн 1 багана байгаа', () => {
  for (const c of ['source_type', 'review_state', 'reviewed_by', 'reviewed_at', 'origin_log_id']) {
    assert.ok(ASSISTANT_EXAMPLE_COLUMNS.includes(c), `0215: ${c} дутуу`);
  }
  assert.ok(ASSISTANT_EXAMPLE_COLUMNS.includes('source_log_id'), '0214: source_log_id дутуу');
});

test('ХОЁР ХОЛБООСЫН багана ХОЁУЛАА байна (0214 ⇄ 0215 нэгтгэл)', () => {
  // Хоёр сесс нэг ойлголтыг өөр нэрээр нэмсэн.  Хоёулаа INSERT-д байх нь
  // ЗААВАЛ — аль нэгийг нь хасвал тэр миграцийн индекс үхэж, тухайн сессийн
  // уншигч NULL авна.  Хоёулаа НЭГ илэрхийллээс бичигддэгийг `revit.ts`
  // барина; энд зөвхөн ХОЁУЛАА байгааг барина.
  assert.ok(ASSISTANT_EXAMPLE_COLUMNS.includes('origin_log_id'));
  assert.ok(ASSISTANT_EXAMPLE_COLUMNS.includes('source_log_id'));
});

test('SOURCE_TYPES нь 0215-ийн CHECK-ийн 8 утга, ЯГ тэр дараалалд', () => {
  assert.deepEqual([...SOURCE_TYPES], [
    'HUMAN', 'HUMAN_CORRECTED', 'HUMAN_VERIFIED', 'RULE_VERIFIED',
    'SYNTHETIC', 'AI_GENERATED', 'IMPORTED', 'UNKNOWN',
  ]);
});

test("CLIENT_REVIEW_STATES-д 'rejected' БАЙХГҮЙ", () => {
  // Татгалзал нь `POST /assistant/reject`-ийн ажил: тэнд `is_active = 0`
  // мөн зэрэг бичигдэнэ.  Клиент шууд 'rejected' илгээж чадвал
  // `is_active = 0 ⟺ review_state = 'rejected'` инвариант эвдэрнэ.
  assert.ok(!(CLIENT_REVIEW_STATES as readonly string[]).includes('rejected'));
  assert.deepEqual([...CLIENT_REVIEW_STATES], ['pending', 'reviewed', 'verified']);
});

/* ================================================================== */
/*  ГУРВАЛСАН НИЙЦЛИЙН ГУРАВ ДАХЬ ХӨЛ — `routes/revit.ts`-ийн БОДИТ КОД  */
/* ================================================================== */
/**
 * ⚠️ ЭНЭ ХЭСЭГ ЯАГААД ЗААВАЛ ВЭ: дээрх тестүүд нь ЗӨВХӨН модулийг ӨӨРТЭЙ НЬ
 * тулгана — багана ↔ `?` кортеж ↔ PER.  Гурав дахь хөл нь `routes/revit.ts`-ийн
 * `binds.push(...)` МАССИВЫН УРТ бөгөөд түүнийг НЭГ Ч тест шалгадаггүй байв.
 * Модуль өөртэйгөө төгс нийцтэй байж байгаад роут нь НЭГ ДУТУУ bind түлхэхэд
 * `tsc` барихгүй, D1 нь зөвхөн ЭХНИЙ БҮТЭН БАГЦ дээр алдаа өгнө — эсвэл
 * төрлүүд тохирвол АЛДАА ӨГӨХГҮЙГЭЭР бүх утга НЭГ БАЙРЛАЛААР ГУЛСАЖ буруу
 * баганад бичигдэнэ.  `lib/modules.test.ts:33-37`-ын заншлаар эх файлыг
 * УНШИЖ тулгана.
 */
function revitSource(): string {
  return readFileSync(new URL('../routes/revit.ts', import.meta.url), 'utf8');
}

/**
 * `binds.push( … );` блок бүрийг түүний ДАРАА ирэх `INSERT INTO <хүснэгт>`-ээр
 * нь ялгаж, аргументын ТООГ буцаана.  Олдоогүй бол `null`.
 *
 * ⚠️ ТААМАГЛАЛ: bind аргументуудад ТАСЛАЛ агуулсан МӨРИЙН ЛИТЕРАЛ БАЙХГҮЙ
 *    (өнөөдөр: `'pending'` ганцхан).  Хэрэв тийм литерал нэмэгдвэл энэ тест
 *    ХУДАЛ УНАНА — тэр үед тестийг засна, bind-ыг БИШ.
 */
function bindsPushArity(table: string): number | null {
  const src = revitSource();
  for (const m of src.matchAll(/binds\.push\(([\s\S]*?)\n\s*\);/g)) {
    const after = src.slice((m.index ?? 0) + m[0].length);
    const insert = /INSERT\s+INTO\s+(\w+)/.exec(after);
    if (!insert || insert[1] !== table) continue;

    const body = (m[1] ?? '').replace(/\/\/[^\n]*/g, '');
    let depth = 0;
    let cur = '';
    const parts: string[] = [];
    for (const ch of body) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    parts.push(cur);
    return parts.filter((s) => s.trim().length > 0).length;
  }
  return null;
}

test('routes/revit.ts-ийн assistant_examples binds.push нь bind тоотой ТААРНА', () => {
  const arity = bindsPushArity('assistant_examples');
  assert.notEqual(arity, null, 'binds.push блок олдсонгүй — роут өөрчлөгдсөн бол тестийг зас');
  assert.equal(
    arity,
    ASSISTANT_EXAMPLE_BINDS,
    `revit.ts ${arity} bind түлхэж байна, кортеж нь ${ASSISTANT_EXAMPLE_BINDS}`,
  );
});

test('routes/revit.ts баганын жагсаалтыг ГАРААР бичдэггүй', () => {
  assert.match(
    revitSource(),
    /INSERT INTO assistant_examples\s*\n\s*\(\$\{ASSISTANT_EXAMPLE_COLUMN_SQL\}\)/,
  );
});

test('deriveSourceType — хүний кураци ХЭЗЭЭ Ч UNKNOWN биш (гэрээ G1)', () => {
  for (const action of CURATION_ACTIONS) {
    for (const predicted of [null, 'list_sheets']) {
      const t = deriveSourceType({
        source: 'usage', curationAction: action, declared: 'UNKNOWN', predicted,
      });
      assert.notEqual(t, 'UNKNOWN', `${action}/${predicted} → UNKNOWN болов`);
      assert.ok(t.startsWith('HUMAN'), `${action}/${predicted} → ${t}`);
    }
  }
});

test('deriveSourceType — үйлдэл бүрийн буулгалт', () => {
  const d = (a: 'approved' | 'corrected' | 'manual', predicted: string | null) =>
    deriveSourceType({ source: 'usage', curationAction: a, declared: null, predicted });
  assert.equal(d('corrected', 'help'), 'HUMAN_CORRECTED');
  assert.equal(d('corrected', null), 'HUMAN_CORRECTED');
  assert.equal(d('manual', null), 'HUMAN');
  assert.equal(d('approved', 'help'), 'HUMAN_VERIFIED');
  // Таамаг байхгүй үед «баталгаажуулсан» гэх нь ХУДАЛ — юуг нь?
  assert.equal(d('approved', null), 'HUMAN');
});

test('deriveSourceType — үйлдэлгүй үед 0215-ын backfill-тай ТААРНА', () => {
  const d = (source: string, predicted: string | null) =>
    deriveSourceType({ source, curationAction: null, declared: null, predicted });
  assert.equal(d('manual', null), 'HUMAN');       // 0215: manual → HUMAN
  assert.equal(d('seed', null), 'AI_GENERATED');  // 0215: seed   → AI_GENERATED
  // ⚠️ 0215 нь `usage → UNKNOWN` гэж backfill хийсэн нь ТҮҮХИЙ мөрүүдэд
  //    хамаарна (тэдний гарал үнэхээр мэдэгдэхгүй: дэвшүүлэлтийн зам нь
  //    «зассан» ба «зөвшөөрсөн»-ийг ялгадаггүй байсан).  ШИНЭЭР орж ирэх мөр
  //    бол `isManager`-ын дэвшүүлэлт тул тодорхойлолтоороо хүний үйлдэл (G1).
  assert.equal(d('usage', 'help'), 'HUMAN_VERIFIED');
  assert.equal(d('usage', null), 'HUMAN');
});

test('deriveSourceType — клиент ЗӨВХӨН ИТГЭЛ БУУРУУЛЖ чадна', () => {
  const d = (declared: string) =>
    deriveSourceType({ source: 'seed', curationAction: null, declared, predicted: null });
  for (const t of CLIENT_DECLARABLE_SOURCE_TYPES) assert.equal(d(t), t);
  // БАТАЛГААНЫ мэдэгдлүүдийг КЛИЕНТЭЭС АВАХГҮЙ.
  for (const t of ['HUMAN', 'HUMAN_CORRECTED', 'HUMAN_VERIFIED', 'RULE_VERIFIED']) {
    assert.equal(d(t), 'AI_GENERATED', `${t}-ыг клиентээс авч болохгүй`);
  }
  assert.equal(d('хог'), 'AI_GENERATED');
});

test('deriveSourceType — буцаах утга бүр 0215-ын CHECK-д БАЙНА', () => {
  const seen = new Set<string>();
  for (const source of ['seed', 'manual', 'usage', 'танихгүй']) {
    for (const action of [null, ...CURATION_ACTIONS]) {
      for (const declared of [null, 'UNKNOWN', 'IMPORTED', 'HUMAN_VERIFIED']) {
        for (const predicted of [null, 'help']) {
          seen.add(deriveSourceType({ source, curationAction: action, declared, predicted }));
        }
      }
    }
  }
  for (const t of seen) {
    assert.ok((SOURCE_TYPES as readonly string[]).includes(t), `${t} нь CHECK-д АЛГА`);
  }
});
