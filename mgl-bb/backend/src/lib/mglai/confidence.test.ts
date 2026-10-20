/**
 * MGL AI · ИТГЭЛ ба ЭШЛЭЛ — ТЕСТ (§27, §28, §48-ийн «forged citations»).
 *
 * Run with:  node --test src/lib/mglai/confidence.test.ts
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

const { scoreConfidence, resolveCitations, extractCitationIds, enforceCitationRule } = await import(
  './confidence.ts'
);

function ev(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'clause',
    title: `t-${id}`,
    text: 'x',
    classification: 'internal',
    visibilityScope: 'company',
    allowedRoles: [],
    ...over,
  } as never;
}

/* ================================================================== */
/*  1. Нотолгоогүй                                                     */
/* ================================================================== */

test('нотолгоогүй нормын асуулт нь «нотолгоо хүрэлцэхгүй»', () => {
  const s = scoreConfidence({ evidence: [], verificationStates: [], toolsOk: true, regulatory: true });
  assert.equal(s, 'insufficient');
});

test('нотолгоогүй ч ХЭРЭГСЭЛ ажилласан ERP асуулт нь «нотолгоотой»', () => {
  // Амьд ERP өгөгдөл нь өөрөө нотолгоо — эшлэх баримт хэрэггүй.
  // ⚠️ ГЭХДЭЭ `toolCount` ЗААВАЛ: анх энэ тест түүнийг өгөхгүйгээр
  //    'supported' хүлээж байсан бөгөөд яг тэр нь дэлгэц дээр «Нотолгоотой»
  //    ба «эх сурвалж олдсонгүй» хоёрыг ЗЭРЭГ гаргаж байсан алдаа юм.
  //    Тест нь алдаатай зан төлөвийг бататгаж байсан — 2026-09-08-нд зассан.
  const s = scoreConfidence({
    evidence: [],
    verificationStates: [],
    toolsOk: true,
    regulatory: false,
    toolCount: 1,
  });
  assert.equal(s, 'supported');
});

test('хэрэгсэл унасан бол нотолгоогүй нь «хүрэлцэхгүй»', () => {
  const s = scoreConfidence({ evidence: [], verificationStates: [], toolsOk: false, regulatory: false });
  assert.equal(s, 'insufficient');
});

/* ================================================================== */
/*  2. Нормын онцгой дүрэм                                             */
/* ================================================================== */

test('UNVERIFIED дүрэм нь ХЭЗЭЭ Ч «баталгаажсан» болохгүй', () => {
  // 0221-ийн зорилго: албан ёсны баримт ирэх хүртэл бүх дүрэм UNVERIFIED.
  const s = scoreConfidence({
    evidence: [ev('a'), ev('b')],
    verificationStates: ['UNVERIFIED', 'UNVERIFIED'],
    toolsOk: true,
    regulatory: true,
  });
  assert.equal(s, 'uncertain');
});

test('CLAUSE_CITED дүрэм нь «баталгаажсан» болно', () => {
  const s = scoreConfidence({
    evidence: [ev('a')],
    verificationStates: ['CLAUSE_CITED'],
    toolsOk: true,
    regulatory: true,
  });
  assert.equal(s, 'verified');
});

test('баталгаажсан ч КЭШЭЭС ирсэн бол нэг шат доошилно', () => {
  const s = scoreConfidence({
    evidence: [ev('a')],
    verificationStates: ['HUMAN_VERIFIED'],
    toolsOk: true,
    regulatory: true,
    staleSince: '2026-09-01',
  });
  assert.equal(s, 'supported');
});

test('зөрчилдсөн нотолгоо нь «эргэлзээтэй»', () => {
  const s = scoreConfidence({
    evidence: [ev('a'), ev('b')],
    verificationStates: ['CLAUSE_CITED', 'CLAUSE_CITED'],
    toolsOk: true,
    regulatory: true,
    conflicting: true,
  });
  assert.equal(s, 'uncertain');
});

/* ================================================================== */
/*  3. Норм биш асуулт                                                 */
/* ================================================================== */

test('нэг нотолгоо нь «эргэлзээтэй», хоёр нь «нотолгоотой»', () => {
  const base = { verificationStates: [], toolsOk: true, regulatory: false } as const;
  assert.equal(scoreConfidence({ ...base, evidence: [ev('a')] }), 'uncertain');
  assert.equal(scoreConfidence({ ...base, evidence: [ev('a'), ev('b')] }), 'supported');
});

/* ================================================================== */
/*  4. Хуурамч эшлэл                                                   */
/* ================================================================== */

test('загварын ЗОХИОСОН эшлэл ХАЯГДАНА', () => {
  const evidence = [ev('real-1'), ev('real-2')];
  const out = resolveCitations(['real-1', 'zohioson-3', 'real-2'], evidence);
  assert.deepEqual(
    out.citations.map((c) => c.id),
    ['real-1', 'real-2'],
  );
  assert.deepEqual(out.dropped, ['zohioson-3']);
});

test('давхардсан эшлэл нэг удаа гарна', () => {
  const out = resolveCitations(['a', 'a', 'a'], [ev('a')]);
  assert.equal(out.citations.length, 1);
});

test('[n] дугаар нь renderEvidence-ийн байрлалтай таарна', () => {
  const evidence = [ev('first'), ev('second'), ev('third')];
  assert.deepEqual(extractCitationIds('Хариу [1] ба [3].', evidence), ['first', 'third']);
});

test('хүрээнээс гарсан [n] нь чимээгүй алгасагдана', () => {
  assert.deepEqual(extractCitationIds('[9]', [ev('only')]), []);
});

/* ================================================================== */
/*  5. Эшлэл ЗААВАЛ дүрэм                                              */
/* ================================================================== */

test('эшлэлгүй нормын хариу нь «баталгаажсан» хэвээр үлдэхгүй', () => {
  assert.equal(enforceCitationRule('verified', true, 0), 'uncertain');
  assert.equal(enforceCitationRule('supported', true, 0), 'uncertain');
});

test('эшлэлтэй нормын хариу нь төлвөө хадгална', () => {
  assert.equal(enforceCitationRule('verified', true, 2), 'verified');
});

test('норм БИШ хариу нь эшлэлгүй ч доошлохгүй', () => {
  assert.equal(enforceCitationRule('supported', false, 0), 'supported');
});

/* ================================================================== */
/*  6. ЗӨРЧИЛТЭЙ ИТГЭЛ — 2026-09-08-ны регрессийн цоож                 */
/* ================================================================== */

test('нотолгоо ч, ХЭРЭГСЭЛ ч байхгүй бол «Нотолгоотой» гэж ХЭЛЭХГҮЙ', () => {
  // ⚠️ РЕГРЕСС: хэрэглэгчийн дэлгэц дээр «Нотолгоотой» гэсэн шошго ба
  //    «эх сурвалж олдсонгүй» гэсэн текст ЗЭРЭГ гарч байв.  Шалтгаан:
  //    `toolsOk` нь «унасан хэрэгсэл байхгүй» гэсэн утгатай тул хэрэгсэл
  //    ОГТ дуудаагүй үед ч true байдаг.
  const s = scoreConfidence({
    evidence: [],
    verificationStates: [],
    toolsOk: true,
    regulatory: false,
    toolCount: 0,
  });
  assert.equal(s, 'insufficient');
});

test('хэрэгсэл БОДИТООР ажилласан бол нотолгоогүй ч «Нотолгоотой»', () => {
  const s = scoreConfidence({
    evidence: [],
    verificationStates: [],
    toolsOk: true,
    regulatory: false,
    toolCount: 1,
  });
  assert.equal(s, 'supported');
});

test('toolCount өгөөгүй бол ХАМГИЙН ХАТУУ тал руу унана', () => {
  // Хуучин дуудагч `toolCount` илгээхгүй байж болно — тэр үед «нотолгоотой»
  // гэж ХУДЛАА хэлэхээс «хүрэлцэхгүй» гэж хэлэх нь дээр.
  const s = scoreConfidence({
    evidence: [],
    verificationStates: [],
    toolsOk: true,
    regulatory: false,
  });
  assert.equal(s, 'insufficient');
});

test('хэрэгсэл ажилласан ч УНАСАН бол «хүрэлцэхгүй»', () => {
  const s = scoreConfidence({
    evidence: [],
    verificationStates: [],
    toolsOk: false,
    regulatory: false,
    toolCount: 1,
  });
  assert.equal(s, 'insufficient');
});
