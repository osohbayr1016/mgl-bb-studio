/**
 * ДЕТЕРМИНИСТ ХӨДӨЛГҮҮР — GOLD A01–A10, B01–B10 (Level 1: загвар, хайлт ОРОЛЦОХГҮЙ).
 *
 * ⚠️ Алтан кейс унавал КОДЫГ засна, assertion-ыг сулруулахгүй (§22, §30).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { runNormEngine, namedDocumentAbsentResult } = await import('./engine');
const ENGINE_TURN = await import('./turnEngine');
const { emptyConvState } = await import('../convState');
const EMPTY_STATE = emptyConvState();
const { extractEngineeringEntities } = await import('./entities');
const { normRegistry } = await import('./registry');

const reg = normRegistry();
const run = (q: string, prior?: Record<string, unknown> | null) =>
  runNormEngine({ question: q, entities: extractEngineeringEntities(q), registry: reg, lang: 'mn-Cyrl', prior: (prior ?? null) as never });

const BD = 'БД 21-101-12';
const prov = (r: NonNullable<ReturnType<typeof run>>, pred: (p: { page: number | null; table: number | null; formula: string | null; clause: string | null; section: string | null }) => boolean) =>
  r.provenance.some((p) => p.documentCode === BD && pred(p));

test('A01 · 25 °C, 7 кПа → А (Хүснэгт 1, х.4), кодгүй атлаа БД 21-101-12', () => {
  const r = run('Өрөөнд 25°C авалцан асах хэмтэй шингэний уурын тэсрэлтийн илүүдэл даралт 7 кПа гарвал ямар ангилал вэ?');
  assert.ok(r);
  assert.equal(r.answerKind, 'classification');
  assert.equal(r.finalCategory, 'А');
  assert.equal(r.documentCode, BD);
  assert.equal(r.verification, 'verified');
  assert.equal(r.authoritative, true);
  assert.ok(prov(r, (p) => p.page === 4 && p.table === 1));
  assert.ok(!r.provenance.some((p) => p.documentCode !== BD));
});

test('A02 · 35 °C, ΔP=8 кПа → Б (х.4); 10 кПа, В4 ГЭРЭЭНД БАЙХГҮЙ', () => {
  const r = run('35°C авалцан асах хэмтэй шатамхай шингэнээс үүсэх агаар-уурын холимгийн ΔP=8 кПа бол өрөө ямар ангилал вэ?');
  assert.ok(r);
  assert.equal(r.finalCategory, 'Б');
  assert.ok(prov(r, (p) => p.page === 4));
  assert.ok(!r.allowedNumbers.includes(10));
  assert.ok(!r.allowedCategories.includes('В4'));
});

test('A03 · g=2500 → В1, Хүснэгт 4, х.13', () => {
  const r = run('Хувийн галын ачаалал g = 2500 МДж/м² бол аль ангилал вэ?');
  assert.ok(r);
  assert.equal(r.initialCategory, 'В1');
  assert.equal(r.finalCategory, 'В1');
  assert.ok(prov(r, (p) => p.table === 4 && p.page === 13));
  assert.equal(r.followups.length, 0);
});

test('A04 · g=1800 → эхний В2 + requires_4_20_upgrade_check (Q, H дутуу) — эцсийн ангилал ХЭЛЭХГҮЙ', () => {
  const r = run('Хувийн галын ачаалал g = 1800 МДж/м² бол эхний ангилал юу вэ?');
  assert.ok(r);
  assert.equal(r.initialCategory, 'В2');
  assert.equal(r.finalCategory, null);
  const fu = r.followups.find((f) => f.id === 'requires_4_20_upgrade_check');
  assert.ok(fu && fu.required);
  assert.deepEqual(fu.missingInputs, ['Q', 'H']);
  assert.match(r.textMn, /Q, H/);
});

test('A05 · g=500 → В3 + requires_4_20_upgrade_check', () => {
  const r = run('Хувийн галын ачаалал g = 500 МДж/м² бол аль ангилал вэ?');
  assert.ok(r);
  assert.equal(r.initialCategory, 'В3');
  assert.ok(r.followups.some((f) => f.id === 'requires_4_20_upgrade_check' && f.required));
});

test('A06 · g=100 → В4 + requires_spacing_check', () => {
  const r = run('Хувийн галын ачаалал g = 100 МДж/м² бол аль ангилал вэ?');
  assert.ok(r);
  assert.equal(r.initialCategory, 'В4');
  assert.ok(r.followups.some((f) => f.id === 'requires_spacing_check' && f.required));
});

test('A07 · Q=18000, S=20 → g=900 МДж/м², томьёо 22, х.13; УББ эшлэгдэхгүй', () => {
  const r = run('Галын нийт ачаалал Q=18000 МДж, талбай S=20 м². Хувийн галын ачаалал g хэд вэ?');
  assert.ok(r);
  assert.equal(r.answerKind, 'calculation');
  assert.equal(r.value, 900);
  assert.equal(r.calculation?.calculatorId, 'specificFireLoad');
  assert.ok(prov(r, (p) => p.formula === '22' && p.page === 13 && p.section === '4.20'));
  assert.ok(r.provenance.every((p) => p.documentCode === BD));
  assert.ok(r.calculation?.steps.some((s) => s.includes('18000 / 20')));
});

test('A08 · Q=5000, g=1000, H=2 → босго 2560, нөхцөл биелнэ, В3 → В2; х.15', () => {
  const r = run('Q=5000 МДж, g=1000 МДж/м², H=2 м. Q ≥ 0.64 × g × H² нөхцөл биелэх үү?');
  assert.ok(r);
  assert.equal(r.calculation?.calculatorId, 'vCategoryUpgrade');
  assert.equal(r.calculation?.result, true);
  assert.equal(r.calculation?.normalizedInputs.threshold_MJ, 2560);
  assert.equal(r.initialCategory, 'В3');
  assert.equal(r.finalCategory, 'В2');
  assert.ok(prov(r, (p) => p.page === 15 && p.section === '4.20'));
  assert.ok(r.allowedNumbers.includes(2560) && r.allowedNumbers.includes(0.64));
  assert.ok(r.calculation?.steps.some((s) => /0\.64 × 1000 × 2² = 2560/.test(s)));
});

test('A09 · H=8 м → 18 м (26 − H), томьёо 24, х.15', () => {
  const r = run('H=8 м үед хялбар авалцан асах шингэний галын ачааллын хэсгүүдийн хамгийн бага зай хэд вэ?');
  assert.ok(r);
  assert.equal(r.value, 18);
  assert.ok(prov(r, (p) => p.formula === '24' && p.page === 15));
});

test('A10 · H=12 м → 15 м, томьёо 23, х.14; 1.2 гэрээнд байхгүй', () => {
  const r = run('H=12 м үед холбогдох галын ачааллын хэсгүүдийн хамгийн бага зай хэд вэ?');
  assert.ok(r);
  assert.equal(r.value, 15);
  assert.ok(prov(r, (p) => p.formula === '23' && p.page === 14));
  assert.ok(!r.allowedNumbers.includes(1.2));
});

test('B01 · яг 2200 → В2 (багтаасан), В1 нь > 2200', () => {
  const r = run('Хувийн галын ачаалал яг 2200 МДж/м² бол В1 үү, В2 юу? Хязгаарын утгыг зөв тайлбарлаж, эх сурвалжаа дурд.');
  assert.ok(r);
  assert.equal(r.initialCategory, 'В2');
  const v1 = r.ranges.find((x) => x.category === 'В1');
  assert.equal(v1?.min, 2200);
  assert.equal(v1?.exclusiveMin, true);
  assert.ok(prov(r, (p) => p.table === 4 && p.page === 13));
});

test('B02 · 2201 → В1', () => {
  const r = run('Хувийн галын ачаалал 2201 МДж/м² бол ямар дэд ангилалд орох вэ?');
  assert.equal(r?.initialCategory, 'В1');
});

test('B03 · яг 180 → В4 + requires_spacing_check', () => {
  const r = run('Хувийн галын ачаалал яг 180 МДж/м² бол ямар дэд ангилал вэ? Үүний дараа нэмэлт ямар шалгалт шаардлагатайг хэл.');
  assert.equal(r?.initialCategory, 'В4');
  assert.ok(r?.followups.some((f) => f.id === 'requires_spacing_check'));
});

test('B04 · 181 → В3', () => {
  const r = run('Хувийн галын ачаалал 181 МДж/м² бол ямар дэд ангилал вэ? Хязгаарын утга учраас 180-тай андуурахгүй хариул.');
  assert.equal(r?.initialCategory, 'В3');
});

test('B05 · 750 м³, тоног төхөөрөмжийн эзлэхүүн тодорхойлох боломжгүй → 600 м³ (4.4, х.6); 750 нь ҮР ДҮН БИШ', () => {
  const r = run('Өрөөний геометр эзлэхүүн 750 м³. Тоног төхөөрөмжийн эзэлсэн эзлэхүүнийг тодорхойлох боломжгүй бол тооцоонд ашиглах чөлөөт эзлэхүүн хэд вэ? Томьёолон бодож, эх сурвалжаа хэл.');
  assert.ok(r);
  assert.equal(r.answerKind, 'calculation');
  assert.equal(r.value, 600);
  assert.equal(r.calculation?.calculatorId, 'freeRoomVolumeFallback');
  assert.ok(prov(r, (p) => p.clause === '4.4' && p.page === 6));
  assert.ok(r.calculation?.steps.some((s) => s.includes('750')));
});

test('B06 · Q=24000, S=30 → g=800 → эхний В3 + requires_4_20 (H дутуу); СНиП эшлэгдэхгүй; В2 ГЭРЭЭНД БАЙХГҮЙ', () => {
  const r = run('Галын нийт ачаалал Q=24,000 МДж, галын ачааллын хэсгийн талбай S=30 м². Эхлээд хувийн галын ачаалал g-г бод. Дараа нь В1–В4-ийн эхний ангиллыг тодорхойл. Эцсийн ангиллыг батлахын тулд нэмэлт өгөгдөл шаардлагатай эсэхийг бас хэл.');
  assert.ok(r);
  assert.equal(r.initialCategory, 'В3');
  assert.equal(r.finalCategory, null);
  assert.ok(r.calculation && r.calculation.result === 800);
  const fu = r.followups.find((f) => f.id === 'requires_4_20_upgrade_check');
  assert.ok(fu && fu.required && fu.missingInputs.includes('H'));
  assert.ok(r.provenance.every((p) => p.documentCode === BD));
  assert.ok(!r.allowedCategories.includes('В2'));
});

test('B07 · Q=2000, g=1000, H=2 → босго 2560, нөхцөл БИЕЛЭХГҮЙ, В3 хэвээр — ул мөртэй', () => {
  const r = run('Q=2000 МДж, g=1000 МДж/м², H=2 м. Q ≥ 0.64 × g × H² нөхцөл биелэх үү? Босгыг эхлээд тооцоод дараа нь харьцуул.');
  assert.ok(r);
  assert.equal(r.calculation?.result, false);
  assert.equal(r.calculation?.normalizedInputs.threshold_MJ, 2560);
  assert.equal(r.finalCategory, 'В3');
  assert.ok(r.calculation?.steps.length && r.calculation.steps.length >= 3);
});

test('B08 · БД 21-101-12, P=200 кПа, V=10 м³ → Va=20 м³, томьёо 7, 4.8, х.8; БНбД 21-04-05 ХЭЗЭЭ Ч', () => {
  const r = run('Аппаратын даралт 200 кПа, аппаратын эзлэхүүн 10 м³ бол БД 21-101-12-ын холбогдох тооцоогоор Vₐ хэд вэ? Ямар заалт/томьёонд тулгуурласнаа хэл.');
  assert.ok(r);
  assert.equal(r.requestedDocument, BD);
  assert.equal(r.value, 20);
  assert.equal(r.calculation?.calculatorId, 'apparatusGasVolume');
  assert.ok(prov(r, (p) => p.formula === '7' && p.page === 8 && p.section === '4.8'));
  assert.ok(r.provenance.every((p) => p.documentCode === BD));
});

test('B09 · масштаб (UBB-11-202-00 байхгүй) → хөдөлгүүр null (гүйцэтгэх гэр бүлгүй), баримт ЗОХИОХГҮЙ', () => {
  const r = run('Хот суурины хөгжлийн ерөнхий төлөвлөгөөний үндсэн шийдлийг ямар масштабаар боловсруулах ёстой вэ? Зөвхөн тухайн асуултад хамаарах норм, зааврыг ашиглаж хариул.');
  assert.equal(r, null);
});

test('B09b · бүртгэлд байхгүй баримт (УББ 11-202-00, БНбД 21-04-05) нэрлэвэл → хөдөлгүүр ХАРИУЛАХГҮЙ (өөр баримтаас тооцоолохгүй)', () => {
  // ⚠️ «Бүртгэлд байхгүй» ≠ «санд байхгүй»: БНбД 21-04-05 локал санд хайлтаар БИЙ.  Хөдөлгүүр
  //    null → локал хайлт тэр баримтад цоожлогдоно; санд ч байхгүйг runtime баталбал
  //    `/context` `namedDocumentAbsentResult`-ээр татгалзана (доорх тест).
  assert.equal(run('УББ 11-202-00-ын 3.5 заалтаар ерөнхий төлөвлөгөөний масштаб хэд вэ?'), null);
  assert.equal(run('БНбД 21-04-05-ын дагуу хувийн галын ачаалал g = 1800 МДж/м² бол ямар ангилал вэ?'), null, 'BD 21-101-12-оос ХАРИУЛАХГҮЙ');
  const { normEngineForTurn } = ENGINE_TURN;
  const out = normEngineForTurn({ question: 'БНбД 21-04-05-ын дагуу g = 1800 МДж/м² бол?', normTaskText: null, intent: 'NORMATIVE', state: EMPTY_STATE, lang: 'mn-Cyrl', registry: reg });
  assert.equal(out.result, null);
  assert.equal(out.namedOutsideRegistry, 'БНбД 21-04-05');
  const absent = namedDocumentAbsentResult('УББ 11-202-00');
  assert.equal(absent.verification, 'named_document_absent');
  assert.equal(absent.authoritative, false);
  assert.deepEqual(absent.provenance, []);
  assert.deepEqual(absent.allowedCategories, []);
});

test('B10 · needs_human_review record → authoritative=false, канон бодлогын хариу', () => {
  const r = run('Нормын сангаас асуултад хамгийн ойр record олдсон боловч needs_human_review=true гэж тэмдэглэгдсэн байвал тэр record дээр үндэслээд “шаардлага хангаж байна” гэсэн баттай норматив шийдвэр гаргаж болох уу? Яаж хариулах ёстой вэ?');
  assert.ok(r);
  assert.equal(r.authoritative, false);
  assert.equal(r.verification, 'needs_human_review');
  assert.match(r.textMn, /^Үгүй\./);
});

/* ── Хил (§25) ───────────────────────────────────────────────────── */

test('хил · 180/181, 1400/1401, 2200/2201', () => {
  const cat = (g: number) => run(`Хувийн галын ачаалал g = ${g} МДж/м² бол ямар дэд ангилал вэ?`)?.initialCategory;
  assert.equal(cat(180), 'В4');
  assert.equal(cat(181), 'В3');
  assert.equal(cat(1400), 'В3');
  assert.equal(cat(1401), 'В2');
  assert.equal(cat(2200), 'В2');
  assert.equal(cat(2201), 'В1');
  // g < 1 нь ямар ч мужид байхгүй — ЗОХИОХГҮЙ, хүний хяналт.
  const r = run('Хувийн галын ачаалал g = 0.5 МДж/м² бол ямар дэд ангилал вэ?');
  assert.equal(r?.initialCategory, null);
  assert.equal(r?.verification, 'needs_human_review');
});

test('хил · ΔP 5 / 5.01 кПа', () => {
  assert.equal(run('Авалцан асах хэм 20°C, тэсрэлтийн илүүдэл даралт 5.01 кПа бол ямар ангилал вэ?')?.finalCategory, 'А');
  const r5 = run('Авалцан асах хэм 20°C, тэсрэлтийн илүүдэл даралт 5 кПа бол ямар ангилал вэ?');
  assert.notEqual(r5?.finalCategory, 'А');
});

test('Amendment C · 27.9 → А, 28.1 → Б, ЯГ 28.0 → needs_human_review / source_boundary_conflict', () => {
  assert.equal(run('Авалцан асах хэм 27.9°C, тэсрэлтийн илүүдэл даралт 7 кПа бол ямар ангилал вэ?')?.finalCategory, 'А');
  assert.equal(run('Авалцан асах хэм 28.1°C, тэсрэлтийн илүүдэл даралт 7 кПа бол ямар ангилал вэ?')?.finalCategory, 'Б');
  const r = run('Авалцан асах хэм 28°C, тэсрэлтийн илүүдэл даралт 7 кПа бол ямар ангилал вэ?');
  assert.ok(r);
  assert.equal(r.verification, 'needs_human_review');
  assert.equal(r.authoritative, false);
  assert.equal(r.finalCategory, null);
  assert.ok(r.warnings.includes('source_boundary_conflict'));
  assert.equal(r.allowedCategories.length, 0);
});

test('хил · 4.2 хаах хугацаа: 0.000002/жил нөөцгүй → 120 с; гараар → 300 с', () => {
  assert.equal(run('Автомат хаалтын системийн ажиллагаагүй болох магадлал 0.000002/жил, нөөц системгүй бол хаах хугацааг хэдээр авах вэ?')?.value, 120);
  assert.equal(run('Гараар хаах шугам хоолойн тооцоот хаах хугацаа хэд вэ?')?.value, 300);
});

/* ── Paraphrase (§31) ───────────────────────────────────────────── */

test('paraphrase · mn-Latn / en → ижил дүрэм', () => {
  assert.equal(run('Khuviin galyn achaalal 2201 MJ/m2 bol?')?.initialCategory, 'В1');
  assert.equal(run('specific fire load 2201 MJ/m2?')?.initialCategory, 'В1');
  assert.equal(run('Хувийн галын ачаалал 2201 бол?')?.initialCategory, 'В1');
});

/* ── Multi-turn (P0-13) ─────────────────────────────────────────── */

test('follow-up · өмнөх g=1800 + одоогийн Q=50000, H=6 → 4.20 шалгалт хийгдэж эцсийн ангилал', () => {
  const prior = extractEngineeringEntities('Хувийн галын ачаалал g = 1800 МДж/м² бол эхний ангилал юу вэ?');
  const r = run('Тэгвэл Q=50000 МДж, H=6 м бол ангилал өөрчлөгдөх үү?', prior as never);
  assert.ok(r);
  assert.equal(r.initialCategory, 'В2');
  assert.equal(r.calculation?.calculatorId, 'vCategoryUpgrade');
  assert.equal(r.calculation?.result, true);
  assert.equal(r.finalCategory, 'В1');
});

test('follow-up · ОДООГИЙН утга давамгайлна', () => {
  const prior = extractEngineeringEntities('g = 1800 МДж/м²');
  const r = run('Хувийн галын ачаалал g = 100 МДж/м² бол?', prior as never);
  assert.equal(r?.initialCategory, 'В4');
});

/* ── Өрөөний ангилал — Хүснэгт 1-ийн В мөр, not_category (2026-09-11 засвар) ── */

test('room · «ΔP=5 кПа бол?» + өмнөх g=1800/Q/H → Хүснэгт 1 В мөр → Хүснэгт 4 дэд ангилал (В1)', () => {
  // ⚠️ Өмнө нь not_category(А,Б) нь ҮНЭЛСЭН бүх ангиллыг «шийдэгдсэн» гэж үзээд В мөрийг
  //    ХЭЗЭЭ Ч биелүүлдэггүй байв; мөн ΔP-тэй ээлж өмнөх g-ийн В-мужийг давтдаг байв.
  const prior = { ...extractEngineeringEntities('g = 1800 МДж/м²'), qMj: 50000, hM: 6 };
  const r = run('ΔP=5 кПа бол?', prior as never);
  assert.ok(r);
  assert.equal(r.answerKind, 'classification');
  assert.equal(r.verification, 'verified');
  assert.equal(r.initialCategory, 'В2');
  assert.equal(r.finalCategory, 'В1');
  assert.ok(r.provenance.length >= 2, 'Хүснэгт 1-ийн В мөр + Хүснэгт 4 хоёулаа провенанст');
  assert.ok(r.provenance.every((p) => p.documentCode === BD));
  assert.ok(r.assumptions.some((a) => /шатамхай материал/u.test(a)), 'g-ээс шатамхай материал гэж үзсэнээ ил хэлнэ');
});

test('room · зөвхөн ΔP=5 кПа → insufficient_context, А/Б хасагдсан гэж хэлнэ, null БИШ', () => {
  const r = run('ΔP=5 кПа бол өрөө ямар ангилал вэ?');
  assert.ok(r);
  assert.equal(r.answerKind, 'insufficient_context');
  assert.equal(r.verification, 'verified');
  assert.equal(r.finalCategory, null);
  assert.ok(r.missingInputs.includes('medium'));
  assert.ok(r.missingInputs.includes('combustible_material_present'));
  assert.match(r.textMn, /А\/Б.*хамаарахгүй/u);
});

test('room · шатамхай хий + авалцан асах хэм 20 °C, ΔP ӨГӨӨГҮЙ → ΔP дутуу (А ч, В ч шийдэгдэхгүй)', () => {
  const r = run('Шатамхай хий, авалцан асах хэм 20 °C — өрөө ямар ангилал вэ?');
  assert.ok(r);
  assert.equal(r.answerKind, 'insufficient_context');
  assert.deepEqual(r.missingInputs, ['explosion_overpressure_kpa']);
  assert.equal(r.finalCategory, null);
});

test('GAP-022 · «g = 1.800 MJ/m2» → insufficient_context (хоёрдмол тоо), ангилал/муж ТААМАГЛАХГҮЙ', () => {
  const r = run('Хувийн галын ачаалал g = 1.800 MJ/m2 бол ямар ангилал вэ?');
  assert.ok(r);
  assert.equal(r.answerKind, 'insufficient_context');
  assert.equal(r.finalCategory, null);
  assert.equal(r.initialCategory, null);
  assert.ok(r.warnings.includes('ambiguous_number'));
  assert.match(r.textMn, /1\.800/);
  assert.equal(run('Хувийн галын ачаалал g = 1 800 MJ/m2 бол ямар ангилал вэ?')?.initialCategory, 'В2', 'зайн мянгат хэвийн');
});
