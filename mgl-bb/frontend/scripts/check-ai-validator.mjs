/**
 * MGL AI · ИТГЭМЖЛЭГДСЭН БАРИМТЫН ШАЛГАГЧ — ГЭРЭЭНИЙ ХАЛДЛАГЫН ТЕСТ (§42).
 *
 *   node scripts/check-ai-validator.mjs        (frontend/ хавтаснаас)
 *
 * ── ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ ──────────────────────────────────────────────
 * Загварын ЗОРИУДЫН зөрчилтэй гаралтыг синтетикээр өгч, шалгагч REJECT
 * хийхийг барина:
 *   итгэмжлэгдсэн 24 → загвар «25»          → REJECT (NUMBER_CHANGED)
 *   В2 → «В3»                               → REJECT (CATEGORY_CHANGED)
 *   NO_MATCH → «БНбД X-д заасан»            → REJECT (FAKE_CITATION)
 *   1401–2200 MJ/m² → «10–20 м²»            → REJECT (UNSUPPORTED_NUMBER)
 *   эрх татгалзсан → «өөрчиллөө»            → REJECT (FORBIDDEN_PHRASE)
 * Мөн ХУДАЛ ЭЕРЭГ-ийн тест: зөв хариулт ХӨНДӨГДӨХГҮЙ; огноо, баримтын код,
 * заалтын дугаар тоо гэж баригдахгүй; засварын дараа ok болно; хоёр дахь
 * зөрчилд детерминист хариулт зөв.
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'mgl-ai', 'lib');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : LIB;
      const asFile = join(base, `${specifier}.ts`);
      if (existsSync(asFile)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const V = await import('@mgl/mglai-common/turn/validator');
const { validateAnswer, enforceContract, fallbackAnswer, normalizeUnit, numbersIn, dedupeSentences } = V;

let passed = 0;
let failed = 0;
const failures = [];
function scenario(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${String(err.message).split('\n')[0]}`);
  }
}
const codes = (r) => r.violations.map((v) => v.code);

const base = {
  version: 'tfc-1', facts: [], allowedNumbers: null, allowedCategories: null, requiredSentence: null,
  trailerText: null, requiredCitations: [], noMatch: false, forbiddenPhrases: [], template: null, taskIndex: null, legacyKind: 'none', reason: 't',
};
const fact = (id, kind, value, labelMn, extra = {}) => ({ id, kind, value, labelMn, labelEn: labelMn, authority: 'erp_tool', mustMention: true, ...extra });

const ERP_24 = {
  ...base, answerMode: 'grounded', risk: 'medium',
  facts: [fact('active_projects', 'number', 24, 'Идэвхтэй төсөл'), fact('total_projects', 'number', 31, 'Нийт төсөл', { mustMention: false })],
  allowedNumbers: [24, 31, 2026, 9, 10, 45.5, 12], template: 'Идэвхтэй төсөл: **24** (нийт 31 төслөөс).',
};
const V2 = {
  ...base, answerMode: 'authoritative', risk: 'high', legacyKind: 'norm_decision',
  facts: [
    fact('fire_category', 'category', 'В2', 'Ангилал', { authority: 'deterministic_rule' }),
    fact('range_min', 'number', 1401, 'Доод хязгаар', { unit: 'MJ/m2', authority: 'deterministic_rule' }),
    fact('range_max', 'number', 2200, 'Дээд хязгаар', { unit: 'MJ/m2', authority: 'deterministic_rule' }),
  ],
  allowedNumbers: [1401, 2200, 2201, 181, 1400, 1, 180, 13, 4, 2, 3],
  allowedCategories: ['В2'],
  requiredCitations: ['БД 21-101-12'],
  template: 'В2 ангилал: хувийн галын ачаалал g = 1401–2200 МДж/м² (БД 21-101-12, Хүснэгт 4, х.13).',
};
const REFUSAL = {
  ...base, answerMode: 'refusal', risk: 'high', legacyKind: 'norm_refusal',
  requiredSentence: 'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй.',
  allowedNumbers: [], allowedCategories: [], noMatch: true, template: 'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй.',
};
const DENIED = {
  ...base, answerMode: 'grounded', risk: 'high',
  facts: [fact('tool_failed:revit_set_parameter', 'status', 'permission_denied', 'Эрхгүй', { mustMention: false, authority: 'permission' })],
  forbiddenPhrases: ['өөрчиллөө', 'өөрчилсөн', 'амжилттай', 'changed'],
};

console.log('\n§42 — ХАЛДЛАГА: REJECT хийх ёстой');
scenario('24 идэвхтэй → загвар «25»', () => {
  const r = validateAnswer('Манай компанид 25 идэвхтэй төсөл байна.', ERP_24);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('NUMBER_CHANGED'), codes(r).join(','));
  assert.ok(codes(r).includes('FACT_MISSING'));
});
scenario('В2 → загвар «В3 ангилалд багтана»', () => {
  const r = validateAnswer('g=1800 нь В3 ангилалд багтана. Муж 1401–2200 МДж/м². Эх сурвалж: БД 21-101-12.', V2);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('CATEGORY_CHANGED'), codes(r).join(','));
});
scenario('NO_MATCH → загвар «БНбД 21-01-02-т заасан»', () => {
  const r = validateAnswer('БНбД 21-01-02-т заасны дагуу лифтний хана 2 цаг тэсвэрлэнэ.', REFUSAL);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('FAKE_CITATION'), codes(r).join(','));
  assert.ok(codes(r).includes('REFUSAL_MISSING'));
  assert.ok(codes(r).includes('UNSUPPORTED_NUMBER'));
});
scenario('1401–2200 MJ/m² → загвар «10–20 м²»', () => {
  const r = validateAnswer('В2 ангиллын галын ачаалал 10 м²-ээс 20 м²-ийг хамарна. Эх сурвалж: БД 21-101-12.', V2);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('UNSUPPORTED_NUMBER'), codes(r).join(','));
  assert.ok(codes(r).includes('FACT_MISSING'), 'муж дурдагдаагүй');
});
scenario('эрх татгалзсан → загвар «элементүүдийг өөрчиллөө»', () => {
  const r = validateAnswer('Сонгосон элементүүдийн параметрийг амжилттай өөрчиллөө.', DENIED);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('FORBIDDEN_PHRASE'));
});
scenario('нэгж зөрсөн: «1401 м²» (ёстой МДж/м²)', () => {
  const r = validateAnswer('В2 ангилал: 1401 м²-ээс 2200 м² хүртэл. Эх сурвалж: БД 21-101-12.', V2);
  assert.ok(codes(r).includes('UNIT_MISMATCH'), codes(r).join(','));
});
scenario('шийдвэр БҮРЭН атлаа «эх сурвалж олдсонгүй»', () => {
  const r = validateAnswer('В2 ангилал, муж 1401–2200 МДж/м² (БД 21-101-12). Гэхдээ баталгаатай эх сурвалж олдсонгүй.', V2);
  assert.ok(codes(r).includes('FALSE_UNCERTAINTY'), codes(r).join(','));
});
scenario('эшлэл дутуу', () => {
  const r = validateAnswer('В2 ангилал: 1401–2200 МДж/м².', V2);
  assert.ok(codes(r).includes('CITATION_MISSING'));
});

console.log('\nХУДАЛ ЭЕРЭГ — зөв хариулт ХӨНДӨГДӨХГҮЙ');
scenario('ERP зөв: «24 идэвхтэй, нийт 31» → ok', () => {
  const r = validateAnswer('2026-09-10-ны байдлаар 24 идэвхтэй төсөл байна (нийт 31). Явц дунджаар 45.5%.', ERP_24);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});
scenario('норм зөв: ангилал, муж, эшлэл, хуудас, хүснэгт → ok', () => {
  const r = validateAnswer('Ангилал: В2. Муж: 1401–2200 МДж/м². Эх сурвалж: БД 21-101-12, хүснэгт 4, хуудас 13. Дараагийн шалгалтад Q ба H хэрэгтэй.', V2);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});
scenario('норм зөв: бусад ангиллын мужийг ЗӨВШӨӨРӨГДСӨН тоогоор дурдах → ok', () => {
  const r = validateAnswer('Ангилал: В2 (1401–2200 МДж/м²). Харьцуулбал В3 нь 181–1400 МДж/м². Эх сурвалж: БД 21-101-12.', V2);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});
scenario('татгалзал зөв: канон өгүүлбэр + тоогүй тайлбар → ok', () => {
  const r = validateAnswer('Энэ шаардлагыг баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй. Холбогдох норм нь БНбД 21-01-02 байж болзошгүй.', REFUSAL);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});
scenario('огноо, цаг, заалт 4.20, «1) 2)» дугаарлалт тоо гэж баригдахгүй', () => {
  const r = validateAnswer('1) 24 идэвхтэй төсөл (2026-09-10, 10:30). Заалт 4.20-д үзнэ үү.', { ...ERP_24, allowedNumbers: [24] });
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});
scenario('free горим — юу ч шалгахгүй', () => {
  assert.equal(validateAnswer('Ямар ч тоо 123 456', { ...base, answerMode: 'free', risk: 'low' }).ok, true);
  assert.equal(validateAnswer('x', null).ok, true);
});
scenario('8.53 → «8.5%» дугуйлалт зөвшөөрөгдөнө', () => {
  const c = { ...ERP_24, facts: [fact('project_progress', 'number', 8.53, 'Явц', { unit: '%' })], allowedNumbers: [8.53] };
  assert.equal(validateAnswer('Явц 8.5% байна.', c).ok, true);
});

console.log('\nЗАСВАР (enforceContract)');
scenario('«25» → хасаад баримтын мөр нэмэгдэж ok болно', () => {
  const o = enforceContract('Манай компанид 25 идэвхтэй төсөл байна. Ихэнх нь барилгын шатанд.', ERP_24);
  assert.equal(o.validation.ok, true, JSON.stringify(o.validation.violations));
  assert.equal(o.outcome, 'repaired');
  assert.doesNotMatch(o.answer, /25 идэвхтэй/);
  assert.match(o.answer, /\*\*24\*\*/);
  assert.match(o.answer, /барилгын шатанд/, 'зөв өгүүлбэр үлдэнэ');
  assert.ok(o.notices.length > 0);
});
scenario('«10–20 м²» → хасаад муж + эшлэл нэмэгдэнэ', () => {
  const o = enforceContract('В2 ангиллын галын ачаалал 10 м²-ээс 20 м²-ийг хамарна.', V2);
  assert.equal(o.validation.ok, true, JSON.stringify(o.validation.violations));
  assert.doesNotMatch(o.answer, /10 м²/);
  assert.match(o.answer, /1401/);
  assert.match(o.answer, /21-101-12/);
});
scenario('олдоогүй атлаа эшилсэн → хасаад татгалзал нэмэгдэнэ', () => {
  const o = enforceContract('БНбД 21-01-02-т заасны дагуу 2 цаг. Лифтний хонгил нь тусгай шаардлагатай.', REFUSAL);
  assert.equal(o.validation.ok, true, JSON.stringify(o.validation.violations));
  assert.ok(o.answer.startsWith(REFUSAL.requiredSentence));
  assert.doesNotMatch(o.answer, /21-01-02-т заасны/);
});
scenario('зөв хариулт → outcome=model, хөндөгдөхгүй', () => {
  const a = 'Ангилал: В2. Муж: 1401–2200 МДж/м². Эх сурвалж: БД 21-101-12.';
  const o = enforceContract(a, V2);
  assert.equal(o.outcome, 'model');
  assert.equal(o.answer, a);
});
scenario('трейлер төгсгөлд нэмэгдэнэ', () => {
  const c = { ...base, answerMode: 'grounded', risk: 'high', trailerText: 'Анхаар: хуучин баримт.' };
  const o = enforceContract('Заалт 2.5-д захиалагч томилно.', c);
  assert.ok(o.answer.endsWith('Анхаар: хуучин баримт.'));
  assert.equal(o.validation.ok, true);
});
scenario('олон даалгавар: зөвхөн 2) хэсэг засагдана', () => {
  const o = enforceContract('1) Манай компанид 18 төсөл байна.\n2) В2 ангилал 10–20 м².', { ...V2, taskIndex: 2 });
  assert.match(o.answer, /1\) Манай компанид 18 төсөл/);
  assert.doesNotMatch(o.answer, /10–20 м²/);
  assert.equal(o.validation.ok, true, JSON.stringify(o.validation.violations));
});

console.log('\nДЕТЕРМИНИСТ ХАРИУЛТ (fallbackAnswer)');
scenario('норм: загвар зөв, шалгалтад тэнцэнэ', () => {
  const a = fallbackAnswer(V2);
  assert.match(a, /В2/);
  assert.match(a, /1401–2200/);
  assert.equal(validateAnswer(a, V2).ok, true);
});
scenario('ERP: template → ok', () => {
  const a = fallbackAnswer(ERP_24);
  assert.match(a, /24/);
  assert.equal(validateAnswer(a, ERP_24).ok, true);
});
scenario('татгалзал: канон өгүүлбэр л', () => {
  assert.equal(fallbackAnswer(REFUSAL), REFUSAL.requiredSentence);
});

console.log('\nОЛОН САНАА · ERP баримт нормын хэсгээс ГАДУУР');
scenario('taskIndex=2 · ERP тоо 1) хэсэгт, норм 2) хэсэгт → ok', () => {
  const c = {
    ...V2, taskIndex: 2,
    facts: [...V2.facts, fact('active_projects', 'number', 35, 'Идэвхтэй төсөл')],
    allowedNumbers: [...V2.allowedNumbers, 35],
  };
  const r = validateAnswer('1) Идэвхтэй төсөл 35 байна.\n2) В2 ангилал: g = 1401–2200 МДж/м² (БД 21-101-12, Хүснэгт 4, х.13).', c);
  assert.equal(r.ok, true, codes(r).join(','));
  const r2 = validateAnswer('1) Идэвхтэй төсөл 36 байна.\n2) В2 ангилал: g = 1401–2200 МДж/м² (БД 21-101-12, Хүснэгт 4, х.13).', c);
  assert.ok(codes(r2).includes('FACT_MISSING'), 'ERP тоо өөрчлөгдвөл баригдана');
});

console.log('\nТООЛУУР 0 + ЖАГСААЛТ, ДАВХАРДАЛ');
scenario('overdue=0 атлаа 3 мөрт жагсаалт → CONTRADICTS_ZERO_COUNT (хасагдахгүй → дахилт)', () => {
  const c = { ...ERP_24, facts: [fact('overdue_tasks', 'number', 0, 'Хугацаа хэтэрсэн даалгавар')], allowedNumbers: [0, 2026, 6, 30, 39.85] };
  const r = validateAnswer('Хугацаа хэтэрсэн даалгавар: 0. Хамгийн хоцорсон нь:\n1. Төсөл А — 2026-06-30\n2. Төсөл Б — 39.85%\n3. Төсөл В', c);
  assert.ok(codes(r).includes('CONTRADICTS_ZERO_COUNT'), codes(r).join(','));
  assert.equal(enforceContract('Хугацаа хэтэрсэн даалгавар: 0.\n1. А\n2. Б', c).validation.ok, false, 'засвараар шийдэгдэхгүй');
  assert.equal(validateAnswer('Хугацаа хэтэрсэн даалгавар: 0. Одоогоор хоцорсон даалгавар алга.', c).ok, true);
});
scenario('dedupeSentences · яг ижил өгүүлбэр хасагдана, богино/жагсаалт хөндөгдөхгүй', () => {
  const d = dedupeSentences('Төслийн үе шат нь эхлээгүй байна. Дараа нь зураг төсөл хийгдэнэ. Төслийн үе шат нь эхлээгүй байна.\n- БНбД\n- БНбД');
  assert.equal(d.removed, 1);
  assert.equal((d.text.match(/эхлээгүй байна/g) ?? []).length, 1);
  assert.equal((d.text.match(/- БНбД/g) ?? []).length, 2, 'богино жагсаалтын мөр хөндөгдөхгүй');
});

console.log('\nНЭГЖ');
scenario('normalizeUnit · MJ/m², MJ/m2, МДж/м², мдж/м2 → MJ/m2; кПа → kPa; м² → m2; хоног → d', () => {
  for (const u of ['MJ/m²', 'MJ/m2', 'МДж/м²', 'мдж/м2', 'МДж / м2']) assert.equal(normalizeUnit(u), 'MJ/m2', u);
  assert.equal(normalizeUnit('кПа'), 'kPa');
  assert.equal(normalizeUnit('м²'), 'm2');
  assert.equal(normalizeUnit('хоног'), 'd');
  assert.equal(normalizeUnit('%'), '%');
  assert.equal(normalizeUnit('°C'), 'C');
});
scenario('numbersIn · «1 800», «1,5»', () => {
  assert.deepEqual(numbersIn('1 800 МДж, 1,5 м'), [1800, 1.5]);
  assert.deepEqual(numbersIn('1,401–2,200 МДж/м², 12,345.6 ба 3,25'), [1401, 2200, 12345.6, 3.25], 'мянгатын таслал vs аравтын таслал');
});

/* ================================================================== */
/*  tfc-2 — TrustedNormResult-ийн блок, ХАТУУ инвариант (§13, 2026-09-11)  */
/* ================================================================== */

const NORM_UPGRADE = {
  ...base, version: 'tfc-2', answerMode: 'authoritative', risk: 'high', legacyKind: 'norm_trusted',
  facts: [
    fact('fire_category', 'category', 'В1', 'Эцсийн ангилал', { authority: 'deterministic_rule' }),
    fact('source', 'text', 'БД 21-101-12', 'Эх сурвалж', { authority: 'deterministic_rule', mustMention: false }),
  ],
  allowedNumbers: [1800, 50000, 6, 0.64, 41472, 1401, 2200, 2201, 13, 4, 20, 8, 22],
  allowedCategories: ['В2', 'В1'],
  requiredCitations: ['БД 21-101-12'],
  template: 'g = 1800 МДж/м² бол эхний ангилал В2; Q = 50000 МДж ≥ 0.64·g·H² = 41472 тул эцсийн ангилал **В1** (БД 21-101-12, заалт 4.20, х.22).',
  norm: {
    verification: 'verified', authoritative: true, answerKind: 'classification',
    document: 'БД 21-101-12', documentAliases: ['БД 21-101-12', 'BD 21-101-12', '21-101-12'],
    resultValue: null, resultUnit: null, initialCategory: 'В2', finalCategory: 'В1',
    requiredFollowups: [],
    maskTokens: ['4.20', 'Хүснэгт 4', 'х.22', 'х.13'],
    citationLabels: ['БД 21-101-12, заалт 4.20, х.22'],
    currentnessNote: 'Энэ эх сурвалжийн дараагийн нэмэлт, өөрчлөлтийн хүчин төгөлдөр байдлыг одоогийн багцад бүрэн баталгаажуулаагүй.',
    template: 'g = 1800 МДж/м² бол эхний ангилал В2; Q = 50000 МДж ≥ 0.64·g·H² = 41472 тул эцсийн ангилал **В1** (БД 21-101-12, заалт 4.20, х.22).',
  },
};
const NORM_CALC = {
  ...base, version: 'tfc-2', answerMode: 'authoritative', risk: 'high', legacyKind: 'norm_trusted',
  facts: [fact('norm_result', 'number', 600, 'Чөлөөт эзлэхүүн', { unit: 'm3', authority: 'deterministic_rule' })],
  allowedNumbers: [750, 600, 0.8, 80, 4.4, 5],
  allowedCategories: [],
  requiredCitations: ['БД 21-101-12'],
  template: 'Тоног төхөөрөмжийн эзлэхүүн мэдэгдэхгүй бол чөлөөт эзлэхүүнийг геометрийн эзлэхүүний 80% гэж авна: 0.8 × 750 = **600 м³** (БД 21-101-12, заалт 4.4, х.5).',
  norm: {
    verification: 'verified', authoritative: true, answerKind: 'calculation',
    document: 'БД 21-101-12', documentAliases: ['БД 21-101-12', 'BD 21-101-12', '21-101-12'],
    resultValue: 600, resultUnit: 'm3', initialCategory: null, finalCategory: null,
    requiredFollowups: [], maskTokens: ['4.4', 'х.5'], citationLabels: ['БД 21-101-12, заалт 4.4, х.5'], currentnessNote: null,
    template: 'Тоног төхөөрөмжийн эзлэхүүн мэдэгдэхгүй бол чөлөөт эзлэхүүнийг геометрийн эзлэхүүний 80% гэж авна: 0.8 × 750 = **600 м³** (БД 21-101-12, заалт 4.4, х.5).',
  },
};
const FOLLOWUP_SENTENCE = 'Q (нийт галын ачаалал, МДж) ба H (өрөөний өндөр, м) өгвөл 4.20-ийн шалгалтаар ангилал В1 болж өөрчлөгдөх эсэхийг тогтооно.';
const NORM_V2_FOLLOWUP = {
  ...NORM_UPGRADE,
  facts: [fact('fire_category', 'category', 'В2', 'Ангилал', { authority: 'deterministic_rule' })],
  allowedCategories: ['В2'],
  template: 'g = 1800 МДж/м² бол В2 ангилал (муж 1401–2200 МДж/м²; БД 21-101-12, Хүснэгт 4, х.13). ' + FOLLOWUP_SENTENCE,
  norm: {
    ...NORM_UPGRADE.norm, initialCategory: 'В2', finalCategory: null,
    requiredFollowups: [{ key: '4.20', sentence: FOLLOWUP_SENTENCE }],
    template: 'g = 1800 МДж/м² бол В2 ангилал (муж 1401–2200 МДж/м²; БД 21-101-12, Хүснэгт 4, х.13). ' + FOLLOWUP_SENTENCE,
  },
};
const NORM_REVIEW = {
  ...base, version: 'tfc-2', answerMode: 'refusal', risk: 'high', legacyKind: 'norm_review',
  requiredSentence: 'Энэ бичлэг хүний хяналт шаардлагатай тул эрх бүхий хариулт өгөх боломжгүй.',
  allowedNumbers: [28, 13], allowedCategories: [], requiredCitations: [],
  template: 'Энэ бичлэг хүний хяналт шаардлагатай тул эрх бүхий хариулт өгөх боломжгүй.\n\nЭх сурвалжийн хил зөрчилтэй (БД 21-101-12, Хүснэгт 1: 28 °C ≤ ба <).',
  norm: {
    verification: 'needs_human_review', authoritative: false, answerKind: 'unverified',
    document: 'БД 21-101-12', documentAliases: ['БД 21-101-12', 'BD 21-101-12', '21-101-12'],
    resultValue: null, resultUnit: null, initialCategory: null, finalCategory: null,
    requiredFollowups: [], maskTokens: ['Хүснэгт 1', 'х.13'], citationLabels: ['БД 21-101-12, Хүснэгт 1, х.13'], currentnessNote: null,
    template: 'Энэ бичлэг хүний хяналт шаардлагатай тул эрх бүхий хариулт өгөх боломжгүй.',
  },
};

console.log('\ntfc-2 — ХАТУУ ИНВАРИАНТ: эх сурвалж / үр дүн / ангилал');
scenario('provenance-ийн бус баримт (БНбД 21-04-05) эшилсэн → FOREIGN_CITATION (hard) → template, дахилтгүй', () => {
  const r = validateAnswer('g=1800 бол В2, Q=50000 тул В1 болно. БНбД 21-04-05-д заасан. Эх сурвалж: БД 21-101-12, заалт 4.20, х.22.', NORM_UPGRADE);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('FOREIGN_CITATION'), codes(r).join(','));
  assert.ok(r.violations.some((v) => v.code === 'FOREIGN_CITATION' && v.hard === true));
  const e = enforceContract('g=1800 бол В2, Q=50000 тул В1 болно. БНбД 21-04-05-д заасан. Эх сурвалж: БД 21-101-12, заалт 4.20, х.22.', NORM_UPGRADE);
  assert.equal(e.answer, NORM_UPGRADE.template, 'загварын хариулт ХАЯГДАЖ серверийн template');
  assert.equal(e.validation.ok, true);
  assert.equal(e.outcome, 'repaired');
});
scenario('ижил баримтын alias (BD 21-101-12, 21-101-12) нь FOREIGN биш', () => {
  const r = validateAnswer('g = 1800 МДж/м² бол В2, Q = 50000 ≥ 41472 тул В1 (BD 21-101-12, заалт 4.20, х.22).', NORM_UPGRADE);
  assert.equal(r.ok, true, codes(r).join(','));
  assert.equal(V.citationBelongsTo('21-101-12', NORM_UPGRADE.norm), true);
  assert.equal(V.citationBelongsTo('БНбД 21-04-05', NORM_UPGRADE.norm), false);
});
scenario('эцсийн ангилал В1 орхигдсон (зөвхөн В2) → CATEGORY_MISSING (hard) → template', () => {
  const a = 'g = 1800 МДж/м² бол В2 ангилал (БД 21-101-12, заалт 4.20, х.22).';
  const r = validateAnswer(a, NORM_UPGRADE);
  assert.ok(codes(r).includes('CATEGORY_MISSING'), codes(r).join(','));
  const e = enforceContract(a, NORM_UPGRADE);
  assert.equal(e.answer, NORM_UPGRADE.template);
  assert.equal(e.validation.ok, true);
});
scenario('эцсийн ангилал тогтсон байхад ӨӨР ангилал ЗАРЛАХ («В3 ангилалд багтана») → hard', () => {
  const a = 'g = 1800 бол В2, Q = 50000 тул В1. Гэхдээ энэ өрөө В3 ангилалд багтана (БД 21-101-12, заалт 4.20, х.22).';
  const r = validateAnswer(a, NORM_UPGRADE);
  assert.ok(r.violations.some((v) => v.code === 'CATEGORY_CHANGED' && v.hard === true), codes(r).join(','));
  assert.equal(enforceContract(a, NORM_UPGRADE).answer, NORM_UPGRADE.template);
});
scenario('тооцооны үр дүн 600 орхигдсон → RESULT_MISSING (hard) → template', () => {
  const a = 'Чөлөөт эзлэхүүнийг геометрийн эзлэхүүний 80% гэж авна (БД 21-101-12, заалт 4.4, х.5).';
  const r = validateAnswer(a, NORM_CALC);
  assert.ok(codes(r).includes('RESULT_MISSING'), codes(r).join(','));
  assert.equal(enforceContract(a, NORM_CALC).answer, NORM_CALC.template);
});
scenario('үр дүн 600 м³ бичигдсэн, заалт/хуудас маск → ok', () => {
  const r = validateAnswer('0.8 × 750 = 600 м³ (БД 21-101-12, заалт 4.4, х.5).', NORM_CALC);
  assert.equal(r.ok, true, codes(r).join(','));
});
scenario('maskTokens · «4.20-р заалт», «Хүснэгт 4», «х.22» нь баталгаагүй тоо БИШ', () => {
  const r = validateAnswer('g = 1800 → В2; 4.20-р заалтаар Q = 50000 ≥ 41472 тул В1 (БД 21-101-12, Хүснэгт 4, х.22).', NORM_UPGRADE);
  assert.equal(r.ok, true, codes(r).join(','));
});
scenario('follow-up өгүүлбэр алга → FOLLOWUP_MISSING → серверийн ЯГ өгүүлбэр НЭМЭГДЭНЭ (таамаглалгүй)', () => {
  const a = 'g = 1800 МДж/м² бол В2 ангилал (муж 1401–2200 МДж/м²; БД 21-101-12, Хүснэгт 4, х.13).';
  const r = validateAnswer(a, NORM_V2_FOLLOWUP);
  assert.ok(codes(r).includes('FOLLOWUP_MISSING'), codes(r).join(','));
  assert.ok(!r.violations.some((v) => v.hard), 'follow-up нь хатуу биш — детерминист нэмэлт');
  const e = enforceContract(a, NORM_V2_FOLLOWUP);
  assert.ok(e.answer.includes(FOLLOWUP_SENTENCE));
  assert.ok(e.answer.startsWith(a), 'загварын зөв текст хэвээр');
  assert.equal(e.validation.ok, true);
  assert.ok(e.notices.some((n) => /Нэмэлт шалгалт/u.test(n)));
});
scenario('needs_human_review → канон өгүүлбэр заавал, «В2»/PASS зарлавал хасагдана; template-д follow-up давхардахгүй', () => {
  const a = 'Авалцан асах хэм 28 °C тул өрөө А ангилалд багтана.';
  const r = validateAnswer(a, NORM_REVIEW);
  assert.ok(codes(r).includes('REFUSAL_MISSING'), codes(r).join(','));
  const e = enforceContract(a, NORM_REVIEW);
  assert.ok(e.answer.startsWith(NORM_REVIEW.requiredSentence));
  assert.equal(fallbackAnswer(NORM_V2_FOLLOWUP).split(FOLLOWUP_SENTENCE).length - 1, 1, 'follow-up ганц удаа');
});
scenario('GOLD B10: хүний хяналтад БАТТАЙ «шаардлага хангаж байна» өгүүлбэр хасагдана; үгүйсгэлтэй ба канон өгүүлбэр ҮЛДЭНЭ', () => {
  const c = { ...NORM_REVIEW, forbiddenPhrases: ['шаардлага хангаж байна', 'шаардлага хангана', 'PASS', 'FAIL'] };
  const neg = 'Үгүй — needs_human_review бичлэг дээр үндэслэн «шаардлага хангаж байна» гэсэн баттай шийдвэр гаргаж болохгүй.';
  const bad = 'Хамгийн ойрхон record-ийн хувилбар дээр зөвхөн «шаардлага хангаж байна» гэсэн баттай хариулт үлдэнэ.';
  const a = `${NORM_REVIEW.requiredSentence} ${neg} ${bad}`;
  const r = validateAnswer(a, c);
  assert.deepEqual(codes(r), ['FORBIDDEN_PHRASE'], codes(r).join(','));
  assert.equal(r.violations[0].sentence, bad);
  const e = enforceContract(a, c);
  assert.ok(!e.answer.includes('баттай хариулт үлдэнэ'), 'баттай мэдэгдэл хасагдсан');
  assert.ok(e.answer.includes(neg), 'үгүйсгэлтэй өгүүлбэр үлдсэн');
  assert.ok(e.answer.includes(NORM_REVIEW.requiredSentence), 'канон өгүүлбэр үлдсэн');
  assert.equal(e.validation.ok, true);
  // ERP гэрээнд (norm биш) хориотой хэллэг үгүйсгэлтэй ч хасагдана — өмнөх хатуу дүрэм хэвээр.
  const erp = { ...base, forbiddenPhrases: ['хоцорсон'] };
  assert.equal(validateAnswer('Энэ төсөл хоцорсон биш.', erp).ok, false);
});
scenario('tfc-1 гэрээ (`norm` талбаргүй) хэвээр ажиллана — регресс', () => {
  const ok = validateAnswer('В2 ангилалд багтана. Муж 1401–2200 МДж/м². Эх сурвалж: БД 21-101-12.', V2);
  assert.equal(ok.ok, true, codes(ok).join(','));
  assert.equal(validateAnswer('g=1800 нь В3 ангилалд багтана.', V2).ok, false);
});

console.log(`\n${passed} тэнцсэн, ${failed} унасан${failed ? ' · ' + failures.join(' | ') : ''}`);
process.exit(failed ? 1 : 0);
