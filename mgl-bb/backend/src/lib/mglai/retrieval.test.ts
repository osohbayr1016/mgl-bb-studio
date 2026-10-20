/**
 * MGL AI · ХАЙЛТ — ТЕСТ.
 *
 * Run with:  node --test src/lib/mglai/retrieval.test.ts
 *
 * ⚠️ ЭНЭ ФАЙЛ НЬ 2026-09-08-НЫ ХОЁР ЖИНХЭНЭ АЛДААНЫ ЦООЖ:
 *
 *   1. Асуултын үгийг ФОЛДЛОХГҮЙГЭЭР `text_folded` багантай тулгаж
 *      байсан.  `foldText` нь кириллийг ЛАТИН галиг болгодог
 *      («Эвакуацын» → «evakuacin») тул кирилл проб нь ХЭЗЭЭ Ч таарахгүй
 *      — фолдлогдсон индекс бүхэлдээ ҮХМЭЛ байв.
 *
 *   2. Нөхөх зам болох `instr(LOWER(text), проб)` нь SQLite-ийн `LOWER()`
 *      ЗӨВХӨН ASCII дээр ажилладаг тул өгүүлбэрийн ЭХЭНД байгаа кирилл
 *      үгийг олдоггүй байв.  Монгол нормын заалт нь гол нэр томьёогоороо
 *      эхэлдэг — өөрөөр хэлбэл хамгийн чухал заалтууд яг олдохгүй байсан.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { tokenizeQuery, buildProbes, probeBinds, rowToEvidence } = await import('./retrieval.ts');
const { foldText } = await import('../textFold.ts');

/* ================================================================== */
/*  1. Токенчлол                                                       */
/* ================================================================== */

test('богино туслах үгс хаягдана', () => {
  const t = tokenizeQuery('Барилгын нь ба гарц');
  assert.equal(t.includes('нь'), false);
  assert.equal(t.includes('ба'), false);
  assert.ok(t.includes('барилгын'));
});

test('цэг таслал арилна', () => {
  assert.deepEqual(tokenizeQuery('гарц, хэдэн?'), ['гарц', 'хэдэн']);
});

/* ================================================================== */
/*  2. ФОЛД — үхмэл индексийн цоож                                     */
/* ================================================================== */

test('проб бүр ФОЛДЛОГДСОН хувилбартайгаа хосолж bind-лагдана', () => {
  const tokens = tokenizeQuery('эвакуацын гарц шаардлагатай');
  const probes = buildProbes(tokens);
  const binds = probeBinds(tokens);

  // Хос тус бүр: [фолдлогдсон, түүхий]
  assert.equal(binds.length, probes.length * 2);
  for (const [i, p] of probes.entries()) {
    assert.equal(binds[i * 2], foldText(p), 'эхний bind нь ФОЛДЛОГДСОН байх ёстой');
    assert.equal(binds[i * 2 + 1], p, 'хоёр дахь bind нь ТҮҮХИЙ байх ёстой');
  }
});

test('фолдлогдсон проб нь ЛАТИН байна — кирилл үлдвэл индекс үхмэл', () => {
  const binds = probeBinds(tokenizeQuery('эвакуацын гарц'));
  const foldedOnes = binds.filter((_, i) => i % 2 === 0);
  for (const f of foldedOnes) {
    assert.equal(/[Ѐ-ӿ]/.test(f), false, `фолдлогдоогүй проб: ${f}`);
  }
});

test('ТОМ ба жижиг үсэг ижил фолд өгнө — LOWER()-ийн ASCII хязгаарыг тойрно', () => {
  // SQLite-ийн LOWER() нь «Эвакуацын»-г өөрчилдөггүй тул фолд нь ЦОРЫН
  // ГАНЦ найдвартай зам.
  assert.equal(foldText('Эвакуацын'), foldText('эвакуацын'));
  assert.equal(foldText('ГАРЦ'), foldText('гарц'));
});

test('латин галигаар бичсэн асуулт ч кирилл текстийг олно', () => {
  // Хэрэглэгч «evakuatsiin garts» гэж бичсэн ч фолд нь ойртуулна.
  const cyr = foldText('эвакуацын');
  const lat = foldText('evakuacin');
  assert.equal(cyr, lat);
});

/* ================================================================== */
/*  3. Проб сонголт                                                    */
/* ================================================================== */

test('хамгийн УРТ гурван үг сонгогдоно', () => {
  const probes = buildProbes(['аб', 'урт-урт-урт', 'дунджхан', 'бага', 'хамгийн-урт-үг-энэ']);
  assert.equal(probes.length, 3);
  // Уртаараа буурах дараалалтай.
  assert.ok(probes[0]!.length >= probes[1]!.length);
  assert.ok(probes[1]!.length >= probes[2]!.length);
});

test('гурваас цөөн үг байвал бүгдийг авна', () => {
  assert.equal(buildProbes(['гарц', 'өргөн']).length, 2);
  assert.equal(buildProbes([]).length, 0);
});

/* ================================================================== */
/*  4. Оноо                                                            */
/* ================================================================== */

function row(over: Record<string, unknown> = {}) {
  return {
    chunk_uid: 'c1',
    doc_uid: 'BNBD-21-01-02',
    title: 'БНбД 21-01-02',
    heading: null,
    section: '4.2.1',
    page_no: 17,
    clause_uid: 'BNBD-21-01-02#4.2.1',
    text: 'Эвакуацын гарц хоёроос доошгүй байна.',
    classification: 'public',
    visibility_scope: 'public',
    allowed_roles_json: '[]',
    project_id: null,
    org_id: null,
    ...over,
  } as never;
}

test('оноо нь таарсан үгийн ХУВИАР бодогдоно', () => {
  const e = rowToEvidence(row(), ['эвакуацын', 'гарц']);
  assert.equal(e.score, 1);
  const half = rowToEvidence(row(), ['эвакуацын', 'байхгүйүг']);
  assert.equal(half.score, 0.5);
});

test('оноо нь ТОМ үсгээс хамаарахгүй — JS toLowerCase кириллийг мэднэ', () => {
  // ⚠️ SQLite-ийн LOWER()-аас ялгаатай нь JS-ийнх кириллийг зөв
  //    жижигрүүлдэг тул оноололт найдвартай.
  const e = rowToEvidence(row({ text: 'ЭВАКУАЦЫН ГАРЦ хоёроос доошгүй.' }), ['эвакуацын']);
  assert.equal(e.score, 1);
});

test('заалттай мөр нь clause төрөлтэй, заалтгүй нь chunk', () => {
  assert.equal(rowToEvidence(row(), ['гарц']).kind, 'clause');
  assert.equal(rowToEvidence(row({ clause_uid: null }), ['гарц']).kind, 'chunk');
});

test('эшлэлийн талбарууд бүрэн дамжина', () => {
  const e = rowToEvidence(row(), ['гарц']);
  assert.equal(e.documentUid, 'BNBD-21-01-02');
  assert.equal(e.clauseUid, 'BNBD-21-01-02#4.2.1');
  assert.equal(e.page, 17);
  assert.equal(e.section, '4.2.1');
});

test('эвдэрсэн allowed_roles_json нь УНАХГҮЙ', () => {
  const e = rowToEvidence(row({ allowed_roles_json: '{ буруу' }), ['гарц']);
  assert.deepEqual(e.allowedRoles, []);
});
