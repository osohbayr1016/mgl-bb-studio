/**
 * MGL AI · НОРМЫН ШИЙДВЭР — ТЕСТ (§10, §15).
 *
 * Run with:  node --test src/lib/mglai/normDecide.test.ts
 *
 * ⚠️ ЭНЭ ФАЙЛ НЬ АЮУЛГҮЙ БАЙДЛЫН ЦООЖ.  Галын аюулын ангилал буруу
 *    гарвал бодит барилгын шийдвэрт нөлөөлнө.  Тиймээс:
 *      · ХИЛИЙН утга бүрийг шалгана (2200 нь В1 БИШ, В2)
 *      · баталгаажаагүй дүрмээр ХАРИУЛАХГҮЙг шалгана
 *      · дүрэм байхгүй ба оролт дутуу хоёрыг ЯЛГАНА
 *
 * ⚠️ ДҮРМИЙН ӨГӨГДӨЛ НЬ БОДИТ.  `ai/data-train-files/
 *    MGL_AI_BD_21_101_12_dataset/v_subcategory_rules.jsonl`-ээс шууд
 *    хуулсан — зохиомол фикстур биш.  Dataset өөрчлөгдвөл тест унана,
 *    тэр нь ЗӨВ (өгөгдөл өөрчлөгдсөнийг мэдэх ёстой).
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

const { decideVSubcategory, inRange, isVerified, renderNormDecision } =
  await import('./normDecide.ts');
const { extractNormEntities } = await import('./normEntities.ts');

/* ================================================================== */
/*  БД 21-101-12, Хүснэгт 4, хуудас 13 — БОДИТ өгөгдөл               */
/* ================================================================== */

const DOC = 'БД 21-101-12';

function rule(over: Record<string, unknown> = {}) {
  return {
    ruleId: 'BD-21-101-12-2012:room:V2:g',
    documentCode: DOC,
    category: 'В2',
    page: 13,
    tableNo: 4,
    quantity: 'g_mj_m2' as const,
    minValue: 1401,
    maxValue: 2200,
    minExclusive: false,
    maxExclusive: false,
    method: 'apply_4_20',
    verification: 'verified_from_page_image',
    ...over,
  };
}

/** Бодит дөрвөн дүрэм. */
const RULES = [
  rule({
    ruleId: 'BD-21-101-12-2012:room:V1:g',
    category: 'В1',
    minValue: 2200,
    maxValue: null,
    minExclusive: true,
    method: 'normalization_not_required',
  }),
  rule(),
  rule({
    ruleId: 'BD-21-101-12-2012:room:V3:g',
    category: 'В3',
    minValue: 181,
    maxValue: 1400,
  }),
  rule({
    ruleId: 'BD-21-101-12-2012:room:V4:g',
    category: 'В4',
    minValue: 1,
    maxValue: 180,
    method: '10m2_arbitrary_section_and_spacing',
  }),
];

function decideFor(q: string, rules = RULES) {
  return decideVSubcategory(extractNormEntities(q), rules);
}

/* ================================================================== */
/*  A. БАТАЛГААЖСАН ДҮРЭМ → ТОДОРХОЙЛОГДСОН ХАРИУ                     */
/* ================================================================== */

test('A · хэрэглэгчийн жишээ: g=1800 → В2, эх сурвалжтай', () => {
  // ⚠️ Энэ нь dataset-ийн golden case R004 — «expected: room_category В2,
  //    requires_4_20_upgrade_check: true».
  const d = decideFor('g=1800 MJ/m2 bol V2 yu V3 yu');
  assert.equal(d.status, 'verified');
  assert.equal(d.decision?.initial_category, 'В2');
  assert.equal(d.inputs_used.g_mj_m2, 1800);
  assert.equal(d.additional_checks.required, true);
  assert.deepEqual(d.additional_checks.missing_inputs, ['Q', 'H']);
  assert.deepEqual(d.source, { document: DOC, table: 4, page: 13 });
});

test('A · кирилл бичлэг ижил хариу өгнө', () => {
  const d = decideFor('Хувийн галын ачаалал 1800 МДж/м² бол ямар ангилал вэ?');
  assert.equal(d.decision?.initial_category, 'В2');
  assert.equal(d.inputs_used.g_mj_m2, 1800);
});

test('A · холимог монгол/англи ижил хариу өгнө', () => {
  const d = decideFor('Хувийн галын ачаалал 1800 MJ/m2 bol yamar angilal ve?');
  assert.equal(d.decision?.initial_category, 'В2');
});

test('A · golden case R003: 2500 → В1', () => {
  const d = decideFor('Хувийн галын ачаалал 2500 МДж/м² бол В ангиллын аль дэд ангилал вэ?');
  assert.equal(d.status, 'verified');
  assert.equal(d.decision?.initial_category, 'В1');
  // В1 нь «normalization_not_required» тул нэмэлт оролт ШААРДАХГҮЙ.
  assert.deepEqual(d.additional_checks.missing_inputs, []);
});

/* ================================================================== */
/*  ХИЛИЙН УТГА — хамгийн алдаа гаргамтгай хэсэг                       */
/* ================================================================== */

test('ХИЛ · 2200 нь В2 (В1 БИШ — В1 нь ХАТУУ их)', () => {
  // ⚠️ `min_exclusive: 1` -ийг үл тоовол 2200 нь хоёр ангилалд зэрэг
  //    таарч, «өгөгдлийн зөрчил» гэж буруу мэдээлнэ.
  const d = decideFor('g=2200 МДж/м²');
  assert.equal(d.decision?.initial_category, 'В2');
});

test('ХИЛ · 2201 нь В1', () => {
  assert.equal(decideFor('g=2201 МДж/м²').decision?.initial_category, 'В1');
});

test('ХИЛ · 1401 нь В2, 1400 нь В3', () => {
  assert.equal(decideFor('g=1401 МДж/м²').decision?.initial_category, 'В2');
  assert.equal(decideFor('g=1400 МДж/м²').decision?.initial_category, 'В3');
});

test('ХИЛ · 181 нь В3, 180 нь В4', () => {
  assert.equal(decideFor('g=181 МДж/м²').decision?.initial_category, 'В3');
  assert.equal(decideFor('g=180 МДж/м²').decision?.initial_category, 'В4');
});

test('ХИЛ · 1-ээс бага нь АЛЬ Ч мужид багтахгүй', () => {
  // ⚠️ Дүрмийн цоорхойг ЧИМЭЭГҮЙ дүүргэхгүй.  0.5 нь В4-т багтахгүй.
  const d = decideFor('g=0.5 МДж/м²');
  assert.equal(d.status, 'no_rule');
  assert.equal(d.decision, null);
});

test('ХИЛ · inRange нь хаалттай/нээлттэй мужийг ЗӨВ уншина', () => {
  const v1 = RULES[0]!;
  assert.equal(inRange(2200, v1), false, '2200 нь В1-д БАГТАХГҮЙ');
  assert.equal(inRange(2200.01, v1), true);
  const v2 = RULES[1]!;
  assert.equal(inRange(1401, v2), true);
  assert.equal(inRange(2200, v2), true);
  assert.equal(inRange(1400.99, v2), false);
});

/* ================================================================== */
/*  B. ДҮРЭМ БАЙГАА ч БАТАЛГААЖААГҮЙ → ЭРХ БҮХИЙ ХАРИУ ӨГӨХГҮЙ       */
/* ================================================================== */

test('B · needs_human_review дүрмээр ангилал ХЭЛЭХГҮЙ', () => {
  // ⚠️ ХАМГИЙН ЧУХАЛ ТЕСТ.  Баталгаажаагүй норм тараах нь зохиосон
  //    нормтой ижил хэмжээний эрсдэл.
  const unverified = RULES.map((r) => ({ ...r, verification: 'needs_human_review' }));
  const d = decideFor('g=1800 МДж/м²', unverified);
  assert.equal(d.status, 'needs_human_review');
  assert.equal(d.decision, null, 'баталгаажаагүй атал ангилал өгсөн!');
  // Эх сурвалжийг ХЭЛНЭ — хүн шалгах гарц.
  assert.equal(d.source?.document, DOC);
});

test('B · баталгаажсан ба баталгаажаагүй давхцвал БАТАЛГААЖСАНЫГ авна', () => {
  const mixed = [
    { ...RULES[1]!, ruleId: 'dup:unverified', verification: 'needs_human_review' },
    RULES[1]!,
  ];
  const d = decideFor('g=1800 МДж/м²', mixed);
  assert.equal(d.status, 'verified');
  assert.equal(d.decision?.initial_category, 'В2');
});

test('B · ХОЁР баталгаажсан дүрэм давхцвал хүн шалгана', () => {
  // ⚠️ Өгөгдлийн алдааг ЧИМЭЭГҮЙ залруулахгүй — буруу ангилал өгөх
  //    эрсдэлээс «шалгуулах» нь дээр.
  const conflicting = [RULES[1]!, { ...RULES[2]!, minValue: 1401, maxValue: 2200 }];
  const d = decideFor('g=1800 МДж/м²', conflicting);
  assert.equal(d.status, 'needs_human_review');
  assert.equal(d.decision, null);
  assert.match(d.reason, /зөрчил/);
});

test('B · isVerified нь ЗӨВХӨН нэг утгыг хүлээн авна', () => {
  assert.equal(isVerified('verified_from_page_image'), true);
  for (const v of ['needs_human_review', 'verified', 'ok', 'true', '']) {
    assert.equal(isVerified(v), false, v);
  }
});

/* ================================================================== */
/*  C. ДҮРЭМ АЛГА → «эх сурвалж олдсонгүй»                            */
/* ================================================================== */

test('C · дүрэм огт суулгаагүй бол no_rule', () => {
  const d = decideFor('g=1800 МДж/м²', []);
  assert.equal(d.status, 'no_rule');
  assert.equal(d.decision, null);
  assert.equal(d.source, null);
});

test('C · no_rule үед prompt блок ХООСОН — татгалзлын команд ажиллана', () => {
  const d = decideFor('g=1800 МДж/м²', []);
  assert.equal(renderNormDecision(d), '');
});

/* ================================================================== */
/*  ОРОЛТ ДУТУУ — `no_rule`-ЭЭС ЯЛГААТАЙ                              */
/* ================================================================== */

test('оролт дутуу нь no_rule БИШ — юу хэрэгтэйг НЭРЛЭНЭ', () => {
  // ⚠️ «Эх сурвалж олдсонгүй» гэж хэлэх нь ТӨӨРӨГДҮҮЛНЭ: дүрэм байгаа,
  //    зөвхөн утга алга.
  const d = decideFor('В ангиллын дэд ангилал яаж тодорхойлох вэ?');
  assert.equal(d.status, 'missing_input');
  assert.deepEqual(d.additional_checks.missing_inputs, ['g']);
  assert.equal(d.decision, null);
});

test('Q ба H өгвөл дутуу оролт БАГАСНА', () => {
  const d = decideFor('g=1800 МДж/м², Q=50000 МДж, H=6 м');
  assert.equal(d.decision?.initial_category, 'В2');
  assert.deepEqual(d.additional_checks.missing_inputs, []);
  assert.equal(d.inputs_used.q_mj, 50000);
  assert.equal(d.inputs_used.h_m, 6);
});

/* ================================================================== */
/*  PROMPT БЛОК                                                        */
/* ================================================================== */

test('шийдвэрийн блок нь ангилал, эх сурвалж, дутуу оролтыг агуулна', () => {
  const d = decideFor('g=1800 MJ/m2 bol V2 yu V3 yu');
  const block = renderNormDecision(d);
  assert.match(block, /ЭХНИЙ АНГИЛАЛ: В2/);
  assert.match(block, /БД 21-101-12/);
  assert.match(block, /хүснэгт 4/);
  assert.match(block, /хуудас 13/);
  assert.match(block, /дутуу оролт: Q, H/);
});

test('needs_human_review блок нь АНГИЛАЛ АГУУЛАХГҮЙ', () => {
  // ⚠️ Загвар блокоос ангилал уншиж чадвал баталгаажаагүй нормыг
  //    эрх бүхий мэт хэлнэ.
  const unverified = RULES.map((r) => ({ ...r, verification: 'needs_human_review' }));
  const block = renderNormDecision(decideFor('g=1800 МДж/м²', unverified));
  assert.equal(block.includes('ЭХНИЙ АНГИЛАЛ'), false);
  assert.match(block, /needs_human_review/);
});

/* ================================================================== */
/*  МУЖИЙН ЛАВЛАГАА — g алга, ангилал нэрлэсэн (2026-09-10)           */
/* ================================================================== */

test('lookup · «В2 галын ачаалал хэдээс хэд вэ» → verified, mode=lookup, В2-ийн муж', () => {
  const d = decideFor('В2 ангиллын галын ачаалал хэдээс хэд вэ?');
  assert.equal(d.status, 'verified');
  assert.equal(d.mode, 'lookup');
  assert.equal(d.decision?.initial_category, 'В2');
  assert.deepEqual(d.inputs_used, {});
  const v2 = d.ranges.find((r) => r.category === 'В2');
  assert.equal(v2?.min, 1401);
  assert.equal(v2?.max, 2200);
  assert.equal(d.source?.document, DOC);
  const block = renderNormDecision(d);
  assert.match(block, /ХҮСЭЛТ: В2 ангиллын муж/);
  assert.match(block, /муж В2: ≥1401 … ≤2200/);
  assert.doesNotMatch(block, /дутуу оролт/);
});

test('lookup · латин «V2 galyn achaalal hed ve?» ч мөн адил', () => {
  const d = decideFor('V2 galyn achaalal hed ve?');
  assert.equal(d.status, 'verified');
  assert.equal(d.mode, 'lookup');
  assert.equal(d.decision?.initial_category, 'В2');
});

test('lookup · g өгөгдсөн бол classify горим ялна (ангилал дурдсан ч)', () => {
  const d = decideFor('g=1800 MJ/m2 bol V2 yu V3 yu');
  assert.equal(d.mode, 'classify');
  assert.equal(d.decision?.initial_category, 'В2');
});

test('lookup · баталгаажаагүй ангилал → needs_human_review, муж ӨГӨХГҮЙ', () => {
  const unverified = RULES.map((r) =>
    r.category === 'В4' ? { ...r, verification: 'needs_human_review' } : r,
  );
  const d = decideFor('В4 ангиллын муж хэд вэ', unverified);
  assert.equal(d.status, 'needs_human_review');
  assert.equal(d.mode, 'lookup');
  assert.equal(d.ranges.length, 0);
});

test('lookup · суулгаагүй ангилал (Г) → missing_input руу унана, зохиохгүй', () => {
  const d = decideFor('Г ангиллын галын ачаалал хэд вэ');
  assert.notEqual(d.status, 'verified');
});
