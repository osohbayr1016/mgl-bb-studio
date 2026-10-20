/**
 * MGL AI · САНААНЫ АНГИЛАЛ — ТЕСТ (§4, §5).
 *
 * Run with:  node --test src/lib/mglai/intent.test.ts
 *
 * ⚠️ ХОЁР ЭСРЭГ АЛДААНААС ХАМГААЛНА:
 *    1. Хэт ХАТУУ — мэндчилгээнд «Нотолгоо хүрэлцэхгүй» гэх.
 *    2. Хэт ЗӨӨЛӨН — нормын асуултыг энгийн гэж үзэж, шаардлага ЗОХИОХ.
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

const { classifyIntent, shouldShowConfidence, isNormativeQuestion, hasRevitWriteHint } = await import('./intent.ts');
const { looksRegulatory } = await import('./context.ts');

test('isNormativeQuestion ≡ looksRegulatory — нэг эх сурвалж, латин галиг ХЭВИЙЖҮҮЛЭГДЭНЭ', () => {
  const norm = [
    'guurnii tulguuriin betonii hamgiin baga mark hed ve',
    'V2 galyn achaalal hed ve',
    'g=1800 MJ/m2 bol V2 yu V3 yu',
    'MNS 5566 стандарт юу гэдэг вэ',
    'Хүснэгт 4-т юу байдаг вэ',
    'How many egress routes does a hall need?',
    'Шатны өргөн хэд байх ёстой вэ?',
    'Шатны гишгүүрийн өндөр хамгийн ихдээ хэд байх ёстой вэ?',
    'Захиалагч зураг төслийн даалгаврыг хэдэн хоногийн дотор батлах ёстой вэ?',
    'Барилгын захиалагчийн үндсэн үүрэг юу вэ?',
  ];
  // ⚠️ ERP-ийн «даалгавар», «захиалагчийн портал» нь норм БИШ хэвээр.
  for (const q of ['Миний даалгавар юу байна?', 'Захиалагчийн порталд юу харагддаг вэ?', 'Хугацаа хэтэрсэн даалгавар хэд вэ', 'Зураг төслийн даалгавар гэж юу вэ, юу агуулдаг вэ?']) assert.equal(isNormativeQuestion(q), false, q);
  const notNorm = ['Хэдэн төсөл идэвхтэй байна', 'хэний ачаалал өндөр вэ', 'сайн уу', 'Revit дээр юу сонгосон бэ'];
  for (const q of norm) {
    assert.equal(isNormativeQuestion(q), true, q);
    assert.equal(looksRegulatory(q), true, q);
  }
  for (const q of notNorm) {
    assert.equal(isNormativeQuestion(q), false, q);
    assert.equal(looksRegulatory(q), false, q);
  }
});

/* ================================================================== */
/*  1. МЕТА / ЭНГИЙН — нотолгоо ШААРДАХГҮЙ                             */
/* ================================================================== */

test('«чи юу хийж чадах вэ» нь МЕТА — нотолгоо хэрэггүй', () => {
  // ⚠️ Энэ бол шинэ хэрэглэгчийн ЭХНИЙ асуулт.  «Нотолгоо хүрэлцэхгүй»
  //    гэж хариулах нь бүтээгдэхүүнийг үхсэн мэт харуулна.
  for (const q of [
    'Чи юу хийж чаддаг вэ?',
    'Чи хэн бэ?',
    'Надад яаж туслах вэ?',
    'chi ymar asuultand hariulj chadah ve',
    'What can you do?',
  ]) {
    const r = classifyIntent(q);
    assert.equal(r.intent, 'META', q);
    assert.equal(r.policy.evidenceMandatory, false, q);
    assert.equal(r.policy.showConfidenceBadge, false, `${q}: шошго харуулж байна`);
  }
});

test('мэндчилгээ нь CASUAL — шошго харуулахгүй', () => {
  for (const q of ['Сайн уу', 'Баярлалаа', 'sain uu', 'Hello']) {
    const r = classifyIntent(q);
    assert.equal(r.policy.showConfidenceBadge, false, q);
    assert.equal(r.policy.evidenceMandatory, false, q);
  }
});

/* ================================================================== */
/*  2. НОРМ — нотолгоо ЗААВАЛ                                          */
/* ================================================================== */

test('нормын асуулт нь нотолгоог ЗААВАЛ шаардана', () => {
  // ⚠️ §15: «MGL AI must NEVER invent a regulation.»
  for (const q of [
    'Олон нийтийн барилгад хэдэн эвакуацын гарц шаардлагатай вэ?',
    'Галын аюулгүй байдлын норм юу гэж заасан бэ?',
    // ⚠️ «БНбД 21-01-02-д юу гэж бичсэн бэ?» (сэдэвгүй, баримт бүхэлдээ) нь 2026-09-18-аас META — баримтын
    //    бүтцийн тойм (`normCatalog.ts`); сэдэвтэй хэлбэр нь норм хэвээр:
    'БНбД 21-01-02-д галын хамгаалалтын тухай юу гэж бичсэн бэ?',
    'g=1800 MJ/m2 bol V2 yu V3 yu',
    'Хананы зузаан ямар шаардлагатай вэ?',
  ]) {
    const r = classifyIntent(q);
    assert.equal(r.intent, 'NORMATIVE', q);
    assert.equal(r.policy.evidenceMandatory, true, q);
  }
});

test('норм нь бусад түлхүүр үгээс ДЭЭГҮҮР', () => {
  // «төсөл» гэсэн үг байсан ч эвакуацын гарц нь НОРМ хэвээр.
  const r = classifyIntent('Энэ төсөл дээр хэдэн эвакуацын гарц хэрэгтэй вэ?');
  assert.equal(r.intent, 'NORMATIVE');
});

/* ================================================================== */
/*  3. КОМПАНИЙН ӨГӨГДӨЛ — ERP хэрэгсэл                                */
/* ================================================================== */

test('компанийн баримт нь ERP хэрэгсэл шаардана', () => {
  for (const q of [
    'Манайд одоо хэдэн хүн ажиллаж байгаа вэ?',
    'manai company heden ajiltantai ve',
    'ene task deadline hezee ve',
  ]) {
    const r = classifyIntent(q);
    assert.ok(
      r.intent === 'COMPANY_FACT' || r.intent === 'ERP_ANALYSIS',
      `${q} → ${r.intent}`,
    );
    assert.equal(r.policy.needsErpTools, true, q);
  }
});

test('«яагаад» асуулт нь ШИНЖИЛГЭЭ', () => {
  const r = classifyIntent('ene project yagaad udaad bna');
  assert.equal(r.intent, 'ERP_ANALYSIS');
  assert.equal(r.policy.needsErpTools, true);
});

/* ================================================================== */
/*  4. REVIT                                                           */
/* ================================================================== */

test('Revit-ийн асуулт нь амьд контекст шаардана', () => {
  for (const q of ['Revit deer songoson wall yu bna', 'Би Revit дээр юу сонгосон байна?']) {
    const r = classifyIntent(q);
    assert.equal(r.intent, 'REVIT_READ', q);
    assert.equal(r.policy.needsRevit, true, q);
  }
});

test('Revit дээр ӨӨРЧЛӨХ хүсэлт нь тусдаа ангилал', () => {
  const r = classifyIntent('Revit дээр энэ wall-ын параметрийг өөрчилж өгөөч');
  assert.equal(r.intent, 'REVIT_ACTION');
});

/* ================================================================== */
/*  5. ӨГӨГДМӨЛ нь ТАТГАЛЗАЛ БИШ (§5)                                  */
/* ================================================================== */

test('танихгүй асуулт нь GENERAL_HELP — ТАТГАЛЗАХГҮЙ', () => {
  // ⚠️ §5: «Do NOT create arbitrary categories like administrative or
  //    personal questions are prohibited.»
  for (const q of [
    'Өнөөдөр юун дээр төвлөрөх вэ?',
    'Энэ текстийг илүү ойлгомжтой болго',
    'Надад санаа өгөөч',
    'Хэрхэн илүү бүтээмжтэй ажиллах вэ?',
  ]) {
    const r = classifyIntent(q);
    assert.notEqual(r.intent, 'NORMATIVE', q);
    assert.equal(r.policy.evidenceMandatory, false, `${q}: нотолгоо шаардаж байна`);
  }
});

test('ЯМАР Ч асуулт нотолгоогүйгээр ТАТГАЛЗАХГҮЙ — НОРМоос бусад', () => {
  // Цорын ганц заавал нотолгоотой ангилал нь NORMATIVE.
  const mandatory = [
    'Сайн уу',
    'Чи юу хийж чадах вэ?',
    'Манай хэдэн төсөл байна?',
    'Энэ тайланг товчилж өгөөч',
    'Revit дээр юу сонгосон бэ?',
    'Талбайг тооцоолж өгөөч',
  ].filter((q) => classifyIntent(q).policy.evidenceMandatory);
  assert.deepEqual(mandatory, [], `эдгээр нотолгоо шаардаж байна: ${mandatory.join(', ')}`);
});

/* ================================================================== */
/*  6. Шошгыг харуулах бодлого                                         */
/* ================================================================== */

test('шошго нь ЗӨВХӨН хамааралтай ангилалд', () => {
  assert.equal(shouldShowConfidence('META'), false);
  assert.equal(shouldShowConfidence('CASUAL'), false);
  assert.equal(shouldShowConfidence('GENERAL_HELP'), false);
  assert.equal(shouldShowConfidence('NORMATIVE'), true);
  assert.equal(shouldShowConfidence('COMPANY_FACT'), true);
});

test('хоосон асуулт нь УНАХГҮЙ', () => {
  const r = classifyIntent('');
  assert.equal(r.intent, 'GENERAL_HELP');
});

/* ── R4.2: ил мутацийн үйл үг л бичих санаа болно ─────────────────────── */
test('R4.2: «болго/зөө/соли» → REVIT_ACTION; унших асуулт бичих санаа болохгүй', () => {
  assert.equal(classifyIntent("Энэ хананы Comments-ийг 'Reviewed' болго.").intent, 'REVIT_ACTION');
  assert.equal(classifyIntent('Энэ ханыг Y чиглэлд 100 мм зөө.').intent, 'REVIT_ACTION');
  assert.equal(classifyIntent('Энэ хананы төрлийг Test Alt болгож солино уу.').intent, 'REVIT_ACTION');
  assert.equal(classifyIntent("Энэ хананы Comments-ийг 'AI санал тест' болгож өөрчлөх санал гарга.").intent, 'REVIT_ACTION');
  assert.equal(classifyIntent('Энэ хана ямар байна?').intent, 'REVIT_READ');
  assert.equal(classifyIntent('Энэ хананд ямар асуудал байна?').intent, 'REVIT_READ');
});

test('AEC design-advice «ёстой» нь норм болж хэт ангилагдахгүй', () => {
  for (const q of [
    'Өндөр барилгын core-оо concept шатанд яагаад эрт шийдэх ёстой вэ?',
    'Concept дээр core-оо яаж шийдэх ёстой вэ?',
  ]) {
    assert.equal(classifyIntent(q).intent, 'GENERAL_HELP', q);
  }
});

test('Revit what-if coordination асуулт нь document mutation биш', () => {
  const q = 'Revit дээр нэг duct-ийг зөөхөд downstream юуг шалгах вэ?';
  assert.equal(hasRevitWriteHint(q), false);
  assert.equal(classifyIntent(q).intent, 'GENERAL_HELP');
  // Харин бодит тушаал хэвээр action.
  assert.equal(hasRevitWriteHint('Revit дээр энэ duct-ийг 100 мм зөө.'), true);
  assert.equal(classifyIntent('Revit дээр энэ duct-ийг 100 мм зөө.').intent, 'REVIT_ACTION');
});

test('угтваргүй нормын код + currentness асуулт → NORMATIVE', () => {
  for (const q of [
    '31-17-10 ба 31-17-23 хоёрын аль нь одоо мөрдөгдөх вэ?',
    '31-17-23 одоо хүчинтэй юу?',
  ]) {
    assert.equal(classifyIntent(q).intent, 'NORMATIVE', q);
  }
  // Ердийн огноо norm болохгүй.
  assert.notEqual(classifyIntent('26-10-03-нд уулзъя').intent, 'NORMATIVE');
});

test('Latin AEC diagnosis and site coordination stay qualitative; dimensions stay normative', () => {
  const advice = [
    'Agaarjuulaltiin suvgaar us duslaa. Yamar shaltgaan baij boloh ve?',
    'Jijig talbaid gal togoo zochny uruutai niiluulehdee yu anhaarah ve?',
    'Armatur dutuu tavisan ni tsutgaltiin omno medegdlee. Hugatsaa davchuu bol yah ve?',
    'Gazar deer ajil davhtsaad baguud bie biedee saad bolood bn. Yaj zohitsuulah ve?',
  ];
  for (const q of advice) {
    assert.equal(classifyIntent(q).intent, 'GENERAL_HELP', q);
    assert.equal(isNormativeQuestion(q), false, q);
  }
  const norms = [
    'Manai office-iin garah haalga heden metr urguntei baih yostoi ve?',
    'Galyn haalga heden mm urguntei baih yostoi ve?',
    'Betonii hamgaalah davharga normoor heden mm baih yostoi ve?',
  ];
  for (const q of norms) {
    assert.equal(classifyIntent(q).intent, 'NORMATIVE', q);
    assert.equal(isNormativeQuestion(q), true, q);
  }
  assert.equal(classifyIntent('Manai tosliin ajil yagaad hotsorood baina ve?').intent, 'ERP_ANALYSIS');
  assert.equal(classifyIntent('Ene uruunii talbaig tootsoolood ogooch').intent, 'CALCULATION');
});
