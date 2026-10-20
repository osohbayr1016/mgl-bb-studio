/**
 * ⚠️ ЭНЭ ТЕСТИЙН ГАНЦ ЗОРИЛГО: `assistant_logs`-ийн bind арифметикийг БАРИХ.
 *
 * `routes/revit.ts`-ийн `assistant_logs` INSERT нь урьд нь баганын жагсаалт,
 * `?` кортеж ба bind тоог ГУРВАН тусдаа газар ГАРААР бичдэг байв, тайлбар нь
 * тогтмолоосоо ӨӨР тоо хэлж байсан («12 bind → 8 мөр» / `BINDS = 13`).
 * Зөрүүг `tsc` БАРИХГҮЙ — D1 зөвхөн ЭХНИЙ БҮТЭН БАГЦ дээр bind-count алдаа
 * өгнө.  Тиймээс тоог ТАЙЛБАРААР биш, ЭНД барина.
 *
 * ⚠️ Тест унах нь ҮРГЭЛЖ бодит алдаа — тестийг сулруулж бүү зас, баганын
 * жагсаалтыг зас.
 *
 * Модуль нь импортгүй, цэвэр тул `registerHooks` шаардлагагүй
 * (`leaveOverlap.test.ts`-тэй ижил хэв маяг).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  D1_MAX_BINDS,
  ASSISTANT_LOG_COLUMNS,
  ASSISTANT_LOG_BINDS,
  ASSISTANT_LOG_ROWS_PER_STATEMENT,
  ASSISTANT_LOG_TUPLE,
  ASSISTANT_LOG_COLUMN_SQL,
  ASSISTANT_TIMING_NUMERIC,
  ASSISTANT_TIMING_TEXT,
  ASSISTANT_TIMING_FIELDS,
  buildTimingJson,
} from './assistantLogInsert.ts';

test('bind тоо нь баганын тоотой ЯГ тэнцүү', () => {
  assert.equal(ASSISTANT_LOG_BINDS, ASSISTANT_LOG_COLUMNS.length);
});

test('VALUES кортежийн `?` тоо нь bind тоотой ЯГ тэнцүү', () => {
  const marks = ASSISTANT_LOG_TUPLE.split('?').length - 1;
  assert.equal(marks, ASSISTANT_LOG_BINDS);
});

test('багана SQL нь мөн адил тооны нэртэй', () => {
  assert.equal(ASSISTANT_LOG_COLUMN_SQL.split(',').length, ASSISTANT_LOG_BINDS);
});

test('нэг statement D1-ийн 100 bind хязгаарт БАГТАНА', () => {
  const worst = ASSISTANT_LOG_ROWS_PER_STATEMENT * ASSISTANT_LOG_BINDS;
  assert.ok(worst <= D1_MAX_BINDS, `${worst} bind > ${D1_MAX_BINDS}`);
  assert.ok(ASSISTANT_LOG_ROWS_PER_STATEMENT >= 1, 'нэг мөр ч багтахгүй байна');
});

test('нэмэлт нэг мөр хязгаарыг ДАВНА — PER нь хамгийн их утга мөн', () => {
  // PER нь floor() тул (PER + 1) мөр ЗААВАЛ 100-г давах ёстой.  Энэ нь
  // «PER хэт бага тавигдсан» (дэмий олон statement) тохиолдлыг ч барина.
  const over = (ASSISTANT_LOG_ROWS_PER_STATEMENT + 1) * ASSISTANT_LOG_BINDS;
  assert.ok(over > D1_MAX_BINDS, `PER = ${ASSISTANT_LOG_ROWS_PER_STATEMENT} хэт бага`);
});

test('баганын нэр давхардаагүй', () => {
  assert.equal(new Set(ASSISTANT_LOG_COLUMNS).size, ASSISTANT_LOG_COLUMNS.length);
});

test('0212-ийн ГАРАЛ ҮҮСЛИЙН гурван багана байгаа', () => {
  for (const col of ['model_version', 'addin_version', 'client_ts']) {
    assert.ok(
      (ASSISTANT_LOG_COLUMNS as readonly string[]).includes(col),
      `${col} багана жагсаалтад алга`,
    );
  }
});

test('хуучин 13 багана ЯГ хэвээрээ, ЭХЭНД нь байна', () => {
  // ⚠️ `routes/revit.ts` bind-уудаа ТОГТСОН дарааллаар түлхдэг.  Шинэ багана
  // ЗААВАЛ ЖАГСААЛТЫН ТӨГСГӨЛД нэмэгдэх ёстой — дунд нь оруулбал bind бүр
  // нэг байрлалаар гулсаж, ЧИМЭЭГҮЙ буруу баганад бичигдэнэ (төрөл нь
  // тохирвол D1 ч алдаа өгөхгүй).
  const legacy = [
    'user_id', 'project_id', 'doc_uid', 'revit_version', 'text',
    'predicted', 'confidence', 'decided_by', 'corrected', 'feedback',
    'acted', 'client_id', 'feedback_note',
  ];
  assert.deepEqual(ASSISTANT_LOG_COLUMNS.slice(0, legacy.length), legacy);
});

test('баганын нэр бүр SQL-д аюулгүй (зөвхөн snake_case)', () => {
  for (const col of ASSISTANT_LOG_COLUMNS) {
    assert.match(col, /^[a-z][a-z0-9_]*$/, `сэжигтэй баганын нэр: ${col}`);
  }
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

test('routes/revit.ts-ийн assistant_logs binds.push нь баганын тоотой ТААРНА', () => {
  const arity = bindsPushArity('assistant_logs');
  assert.notEqual(arity, null, 'binds.push блок олдсонгүй — роут өөрчлөгдсөн бол тестийг зас');
  assert.equal(
    arity,
    ASSISTANT_LOG_BINDS,
    `revit.ts ${arity} bind түлхэж байна, багана нь ${ASSISTANT_LOG_BINDS}`,
  );
});

test('routes/revit.ts баганын жагсаалтыг ГАРААР бичдэггүй', () => {
  // Гараар бичсэн жагсаалт нь энэ файлтай ЧИМЭЭГҮЙ зөрж чадна.
  assert.match(
    revitSource(),
    /INSERT INTO assistant_logs\s*\n\s*\(\$\{ASSISTANT_LOG_COLUMN_SQL\}\)/,
  );
});

test('ШИНЭ багана ҮРГЭЛЖ ЖАГСААЛТЫН ТӨГСГӨЛД нэмэгдэнэ', () => {
  // ⚠️ ЭНЭ ТЕСТИЙН УТГА нь «сүүлчийнх нь ЯГ ЭНЭ нэр» БИШ, харин «шинэ
  //    багана ДУНД нь ОРООГҮЙ» — дунд оруулах нь bind бүрийг нэг
  //    байрлалаар гулсуулж, ЧИМЭЭГҮЙ буруу баганад бичүүлнэ.  Тиймээс
  //    багана нэмэх бүрд ЭНЭ ЖАГСААЛТЫН СҮҮЛД нэрээ нэмнэ.
  //    Түүх: 0216 -> `timing_json`, 0238 (2-6) -> `team_code`.
  assert.deepEqual(
    ASSISTANT_LOG_COLUMNS.slice(-2),
    ['timing_json', 'team_code'],
  );
});

test('хугацааны талбарууд нь AssistantLog.cs-ийн DTO-той ЯГ ТААРНА (гэрээ G3)', () => {
  // ⚠️ C# тал нь ӨӨР СЕССИЙН ЭЗЭМШИЛД — энд зөвхөн ХУУЛБАР барина.
  assert.deepEqual([...ASSISTANT_TIMING_FIELDS], [
    't_total_ms', 't_route_ms', 't_model_load_ms',
    't_tool_total_ms', 't_tool_queue_ms', 't_tool_event_ms', 't_tool_exec_ms',
    't_agent_ttft_ms', 't_agent_total_ms',
    'route_layer', 'exit_path', 'model_load_source',
  ]);
  assert.equal(ASSISTANT_TIMING_NUMERIC.length + ASSISTANT_TIMING_TEXT.length, 12);
});

test('0216-ын GENERATED багана бүр телеметрийн талбартай ТААРНА', () => {
  // ⚠️ Миграц `json_extract(timing_json, "$.<нэр>")` гэж бичдэг тул буруу
  //    бичвэрлэсэн нэр НЭГ Ч алдаа өгөхгүйгээр БҮГД NULL болгоно.
  const sql = readFileSync(
    new URL('../../migrations/0216_assistant_log_timing.sql', import.meta.url),
    'utf8',
  );
  const keys = [...sql.matchAll(/json_extract\(timing_json, '\$\.(\w+)'\)/g)].map((m) => m[1]);
  assert.ok(keys.length >= 3, `0216-д json_extract олдсонгүй: ${keys.length}`);
  for (const k of keys) {
    assert.ok(
      (ASSISTANT_TIMING_FIELDS as readonly string[]).includes(k as string),
      `0216 нь '${k}' талбарыг уншихыг оролдож байна, гэтэл тийм талбар АЛГА`,
    );
  }
});

test('buildTimingJson — талбаргүй бол NULL, ХООСОН ОБЪЕКТ БИШ', () => {
  // ⚠️ ЭНЭ ГОЛ ИНВАРИАНТ (0216-ын толгой).  '{}' буцаавал «хэмжээгүй» ба
  //    «хэмжсэн боловч үе шат болоогүй» ЯЛГАГДАХГҮЙ болно.
  assert.equal(buildTimingJson({}), null);
  assert.equal(buildTimingJson({ text: 'x', acted: true }), null);
  assert.equal(buildTimingJson({ t_total_ms: null, route_layer: null }), null);
  assert.equal(buildTimingJson({ route_layer: '   ' }), null);
});

test('buildTimingJson — ХОГ тоог ТАТГАЛЗана, ЗАСАХГҮЙ', () => {
  assert.equal(buildTimingJson({ t_total_ms: '241.5' }), null, 'мөр хэлбэртэй тоо');
  assert.equal(buildTimingJson({ t_total_ms: NaN }), null, 'NaN');
  assert.equal(buildTimingJson({ t_total_ms: Infinity }), null, 'Infinity');
  assert.equal(buildTimingJson({ t_total_ms: -1 }), null, 'сөрөг үргэлжлэх хугацаа');
  assert.equal(buildTimingJson({ t_total_ms: 0 }), '{"t_total_ms":0}', 'тэг НЬ хүчинтэй');
});

test('buildTimingJson — бүрэн бус багц НЭГ талбараар ч ОБЪЕКТ өгнө', () => {
  assert.equal(buildTimingJson({ t_total_ms: 241.5 }), '{"t_total_ms":241.5}');
  const full = buildTimingJson({
    t_total_ms: 240, t_route_ms: 12, route_layer: 'model', exit_path: 'acted',
    t_agent_ttft_ms: null,
  });
  assert.equal(full, '{"t_total_ms":240,"t_route_ms":12,"route_layer":"model","exit_path":"acted"}');
});

test('buildTimingJson — шошгыг УРТААР таслана, ЖАГСААЛТААР ШҮҮХГҮЙ', () => {
  // ⚠️ Жагсаалтаар шүүвэл add-in-ы ШИНЭ давхарга чимээгүй АЛГА болно.
  const out = buildTimingJson({ route_layer: 'brand_new_layer_that_is_very_long_indeed' });
  assert.equal(out, '{"route_layer":"brand_new_layer_that_is_"}');
});
