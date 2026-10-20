/**
 * ТООЦООЛУУР — бүртгэлийн 14 алтан кейс, тогтмолын хос (expression_python), хил.
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

const { normRegistry } = await import('./registry');
const { runCalculator, runFallbackRatio, calculatorFor, supportedFormulaIds, CALCULATOR_CONSTANTS } = await import('./calculators');
const { runNormEngine } = await import('./engine');
const { extractEngineeringEntities } = await import('./entities');

const reg = normRegistry();
const bd = reg.byCode('БД 21-101-12')!;

test('бүртгэлийн 14 тооцооны кейс — хөдөлгүүрээр (Level 1, загваргүй)', () => {
  assert.equal(bd.cases.length, 14);
  const failures: string[] = [];
  for (const c of bd.cases) {
    const r = runNormEngine({ question: c.queryMn, entities: extractEngineeringEntities(c.queryMn), registry: reg, lang: 'mn-Cyrl' });
    const exp = c.expected;
    const check = (ok: boolean, what: string) => {
      if (!ok) failures.push(`${c.caseId}: ${what} — got ${JSON.stringify({ cat: r?.initialCategory, final: r?.finalCategory, value: r?.value, calc: r?.calculation?.normalizedInputs, fu: r?.followups.map((f) => f.id) })}`);
    };
    if (typeof exp.room_category === 'string') check(r?.initialCategory === exp.room_category, `room_category=${exp.room_category}`);
    if (typeof exp.g_MJ_m2 === 'number') check(r?.calculation?.result === exp.g_MJ_m2 || r?.value === exp.g_MJ_m2, `g=${exp.g_MJ_m2}`);
    if (typeof exp.min_spacing_m === 'number') check(r?.value === exp.min_spacing_m, `spacing=${exp.min_spacing_m}`);
    if (typeof exp.threshold_MJ === 'number') check(r?.calculation?.normalizedInputs.threshold_MJ === exp.threshold_MJ, `threshold=${exp.threshold_MJ}`);
    if (typeof exp.upgrade_required === 'boolean') check(r?.calculation?.result === exp.upgrade_required, `upgrade=${exp.upgrade_required}`);
    if (typeof exp.Va_m3 === 'number') check(r?.value === exp.Va_m3, `Va=${exp.Va_m3}`);
    if (typeof exp.closure_time_s === 'number') check(r?.value === exp.closure_time_s, `closure=${exp.closure_time_s}`);
    if (typeof exp.free_volume_m3 === 'number') check(r?.value === exp.free_volume_m3, `free=${exp.free_volume_m3}`);
    if (exp.requires_4_20_upgrade_check === true) check(r?.followups.some((f) => f.id === 'requires_4_20_upgrade_check' && f.required) === true, 'requires_4_20_upgrade_check');
    if (exp.requires_spacing_check === true) check(r?.followups.some((f) => f.id === 'requires_spacing_check' && f.required) === true, 'requires_spacing_check');
    if (r) check(r.provenance.every((p) => p.documentCode === 'БД 21-101-12'), 'provenance doc');
    if (c.page !== null && r) check(r.provenance.some((p) => p.page === c.page), `page=${c.page}`);
  }
  assert.deepEqual(failures, []);
});

test('тогтмолууд бүртгэлийн томьёоны илэрхийлэлтэй ТААРНА (expression_python / equation)', () => {
  const f = (suffix: string) => bd.formulas.find((x) => x.formulaId.endsWith(suffix))!;
  assert.ok(f(':4.20:upgrade').expressionPython?.includes(String(CALCULATOR_CONSTANTS.vCategoryUpgrade.coefficient)));
  assert.ok(f(':4.8:7').expressionPython?.includes(String(CALCULATOR_CONSTANTS.apparatusGasVolume.coefficient)));
  assert.ok(f(':4.20:24').expressionPython?.includes(String(CALCULATOR_CONSTANTS.liquidSpacing.subtractFromM)));
  assert.ok(f(':4.20:23').equationLatex.includes(String(CALCULATOR_CONSTANTS.liquidSpacing.fixedSpacingM)));
  assert.ok(f(':4.20:23').equationLatex.includes(String(CALCULATOR_CONSTANTS.liquidSpacing.heightThresholdM)));
  assert.equal(f(':4.20:22').constraints.S_m2_min, CALCULATOR_CONSTANTS.specificFireLoad.minAreaM2);
  const r44 = bd.rules.find((r) => r.ruleId.endsWith(':clause:4.4'))!;
  assert.equal(r44.value, 0.8);
});

test('тооцоолуур бүр ГҮЙЦЭТГЭХ БОЛОМЖТОЙ томьёотой холбогдсон; needs_human_review томьёонд ажиллахгүй', () => {
  for (const id of supportedFormulaIds(bd)) assert.ok(reg.formula(id)?.formula.executable, id);
  const f46 = bd.formulas.find((x) => x.formulaId.endsWith(':4.6:4'))!;
  assert.equal(f46.executable, false);
  assert.equal(runCalculator(bd, f46, { a: 1 }), null);
  assert.equal(calculatorFor(f46.formulaId), null);
});

test('specificFireLoad · S < 10 м² бол 10 гэж авч ил тэмдэглэнэ', () => {
  const f = bd.formulas.find((x) => x.formulaId.endsWith(':4.20:22'))!;
  const run = runCalculator(bd, f, { Q_MJ: 1000, S_m2: 5 })!;
  assert.equal(run.trace.result, 100);
  assert.equal(run.trace.normalizedInputs.S_m2, 10);
  assert.equal(run.assumptions.length, 1);
});

test('liquidSpacing · 10.99 → 15.01 (26−H), 11 → 15 (яг хил томьёо 23-д)', () => {
  const lo = bd.formulas.find((x) => x.formulaId.endsWith(':4.20:24'))!;
  const hi = bd.formulas.find((x) => x.formulaId.endsWith(':4.20:23'))!;
  assert.equal(runCalculator(bd, lo, { H_m: 10.99 })!.trace.result, 15.01);
  assert.equal(runCalculator(bd, lo, { H_m: 11 }), null);
  assert.equal(runCalculator(bd, hi, { H_m: 11 })!.trace.result, 15);
});

test('freeRoomVolumeFallback · 750 → 600, 500 → 400; ratio бүртгэлээс', () => {
  const r44 = bd.rules.find((r) => r.ruleId.endsWith(':clause:4.4'))!;
  assert.equal(runFallbackRatio(r44, 750)!.trace.result, 600);
  assert.equal(runFallbackRatio(r44, 500)!.trace.result, 400);
});
