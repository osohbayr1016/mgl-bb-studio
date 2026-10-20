/**
 * MGL AI · ХАРИУЛТЫН ШАЛГАЛТ — ТЕСТ (§12, §13).
 *
 * Run with:  node --test src/lib/mglai/validate.test.ts
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

const { cleanOutput, validateAnswer, mongolianRatio, hasUnnaturalMongolian, REPAIR_PROMPT_MN } =
  await import('./validate.ts');

/* ================================================================== */
/*  1. Тээврийн гажиг цэвэрлэх (§13)                                   */
/* ================================================================== */

test('HTML entity нь хэрэглэгчид ХҮРЭХГҮЙ', () => {
  // ⚠️ БОДИТ АЛДАА: дэлгэц дээр `&#x20;` гэж гарсан.
  assert.equal(cleanOutput('Сайн&#x20;уу'), 'Сайн уу');
  assert.equal(cleanOutput('a&amp;b'), 'a&b');
  assert.equal(cleanOutput('1&lt;2'), '1<2');
});

test('давхар escape хийсэн markdown засагдана', () => {
  // ⚠️ БОДИТ АЛДАА: `\*\*` гэж түүхийгээр харагдсан.
  assert.equal(cleanOutput('\\*\\*чухал\\*\\*'), '**чухал**');
  assert.equal(cleanOutput('a\\_b'), 'a_b');
});

test('текстээс «svg» ХАСАХГҮЙ — band-aid хасагдсан (2026-09-11)', () => {
  // ⚠️ Өмнө нь `svgНотолгоо` → `Нотолгоо` гэж ТЕКСТ ЗАСДАГ байсан нь «logo.svgФайл»
  //    гэх мэт зөв текстийг эвддэг; эх шалтгаан нь UI-ийн DOM (aria-hidden дүрс + зай),
  //    рендерийн тест `frontend/scripts/check-ai-ui-leak.mjs` барина.
  assert.equal(cleanOutput('logo.svgФайлыг нээнэ'), 'logo.svgФайлыг нээнэ');
  assert.match(cleanOutput('svg файл экспортло'), /svg файл/);
});

test('МОНГОЛ ҮГИЙГ ХӨНДӨХГҮЙ', () => {
  // ⚠️ §13: «Do not post-process Mongolian words aggressively.»
  const mn = 'Эвакуацын гарц 1.2 м-ээс багагүй байна. Тайлбар: **чухал**';
  assert.equal(cleanOutput(mn), mn);
});

/* ================================================================== */
/*  2. Хэлний шалгалт                                                  */
/* ================================================================== */

test('англи хариу монгол горимд БАРИГДАНА', () => {
  const r = validateAnswer('I can help you with projects and deadlines.', 'mn-Cyrl');
  assert.equal(r.ok, false);
  assert.ok(r.issues.includes('wrong_language'));
  assert.equal(r.needsRepair, true);
});

test('монгол хариу нь ӨНГӨРНӨ', () => {
  const r = validateAnswer('Би төсөл, deadline, task-тай холбоотой асуултад тусална.', 'mn-Cyrl');
  assert.equal(r.ok, true);
  assert.equal(r.needsRepair, false);
});

test('НЭР ТОМЬЁО олонтой монгол хариу нь англи гэж БУРУУ тэмдэглэгдэхгүй', () => {
  // ⚠️ §8-ийн жишээ.  Нэр томьёог тоовол зөв хариулт «англи» болно.
  const r = validateAnswer('Одоогийн Revit view дээр 17 wall сонгогдсон байна.', 'mn-Cyrl');
  assert.equal(r.needsRepair, false, `харьцаа=${mongolianRatio('Одоогийн Revit view дээр 17 wall сонгогдсон байна.')}`);
});

test('англи горимд англи хариу нь ӨНГӨРНӨ', () => {
  const r = validateAnswer('I can help with projects and deadlines.', 'en');
  assert.equal(r.needsRepair, false);
});

test('кирилл боловч эвдэрсэн монгол хэллэг засварт орно', () => {
  for (const s of [
    'Төсөл нь 53.15% үнэлгээтэй байна.',
    'Энэ нь хамгийн баруун deadline байна.',
    'Төсөл удааширсан нь шалтгаануудын хүчин зүйлсээс болсон.',
    'Идвэхтэй төсөл 12 байна.',
    'Энэ мэдээллийг ажилтнад харуулна.',
    'Хэмжээсийн өгөөгөө оруулна уу.',
  ]) {
    assert.equal(hasUnnaturalMongolian(s), true, s);
    const r = validateAnswer(s, 'mn-Cyrl');
    assert.ok(r.issues.includes('unnatural_mongolian'), s);
    assert.equal(r.needsRepair, true, s);
  }
});

test('зөв мэргэжлийн монголыг natural-language gate дэмий засахгүй', () => {
  const s = 'Төслийн явц 53.2% байна. Deadline ойртсон тул хоцорсон task-уудаа эхэлж шалгана.';
  assert.equal(hasUnnaturalMongolian(s), false);
  assert.equal(validateAnswer(s, 'mn-Cyrl').needsRepair, false);
});


test('хоосон хариу нь баригдана, ГЭХДЭЭ дахин үүсгэхгүй', () => {
  // ⚠️ Хоосон хариу нь ихэвчлэн техникийн алдаа (max_tokens дуусах,
  //    сэтгэх горим) — дахин үүсгэх нь дахин хоосон гаргана.
  const r = validateAnswer('   ', 'mn-Cyrl');
  assert.equal(r.ok, false);
  assert.ok(r.issues.includes('empty'));
  assert.equal(r.needsRepair, false);
});

/* ================================================================== */
/*  3. Давталт                                                         */
/* ================================================================== */

test('гацсан давталт баригдана', () => {
  const s = 'Багт хуваарилсан ажлын үр дүнг харах боломжтой болго. '.repeat(4);
  const r = validateAnswer(s, 'mn-Cyrl');
  assert.ok(r.issues.includes('repetition'));
});

test('ердийн хариу нь давталт гэж тэмдэглэгдэхгүй', () => {
  const r = validateAnswer(
    'Төслийн task болон deadline-г шалгая. Дараа нь ачааллыг харна. Эцэст нь тайлан гаргана.',
    'mn-Cyrl',
  );
  assert.equal(r.issues.includes('repetition'), false);
});

/* ================================================================== */
/*  4. Засварын prompt (§12)                                           */
/* ================================================================== */

test('засварын заавар нь баримт хадгалахыг ШААРДАНА', () => {
  // ⚠️ Засвар нь ЗӨВХӨН хэлийг өөрчилнө.  Шинэ мэдээлэл нэмэх нь
  //    засварыг шинэ худал үүсгэх зам болгоно.
  assert.match(REPAIR_PROMPT_MN, /ЯГ ХЭВЭЭР/);
  assert.match(REPAIR_PROMPT_MN, /БАЙГАЛИЙН МОНГОЛ/);
  assert.match(REPAIR_PROMPT_MN, /ШИНЭ мэдээлэл.*НЭМЭХГҮЙ/);
  assert.match(REPAIR_PROMPT_MN, /битгий тайлбарла/);
});

test('цэвэрлэгээ нь шалгалтын үр дүнд ҮРГЭЛЖ буцаана', () => {
  const r = validateAnswer('Сайн&#x20;уу, энэ бол монгол хариулт байна.', 'mn-Cyrl');
  assert.equal(r.cleaned.includes('&#x20;'), false);
  assert.ok(r.issues.includes('html_entities'));
});
