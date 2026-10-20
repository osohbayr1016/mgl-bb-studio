/**
 * MGL AI · ИТГЭМЖЛЭГДСЭН БАРИМТЫН ГЭРЭЭ — ТЕСТ.
 *
 * Run with:  node --test src/lib/mglai/trustedFacts.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ: гэрээ нь нормын шийдвэр, ERP хэрэгслийн
 *    тоолуур, эрхийн татгалзал, татгалзлын дөрвөн эх сурвалжаас ЗӨВ
 *    хэлбэрээр угсрагдана; мөр тоолж баримт үүсгэхгүй; детерминист загвар
 *    нь хэрэглэгчид уншигдах монгол хариулт.
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

const { buildTrustedContract, factsFromTools, numbersInData, normalizeUnit, composeTemplate } = await import('./trustedFacts.ts');
const { decideVSubcategory } = await import('./normDecide.ts');
const { extractNormEntities } = await import('./normEntities.ts');

const RULE = (cat: string, min: number | null, max: number | null, minEx = false) => ({
  ruleId: `r:${cat}`, documentCode: 'БД 21-101-12', category: cat, page: 13, tableNo: 4, quantity: 'g_mj_m2' as const,
  minValue: min, maxValue: max, minExclusive: minEx, maxExclusive: false, method: cat === 'В2' ? 'apply_4_20' : null,
  verification: 'verified_from_page_image',
});
const RULES = [RULE('В1', 2200, null, true), RULE('В2', 1401, 2200), RULE('В3', 181, 1400), RULE('В4', 1, 180)];
const base = { regulatory: false, evidenceCount: 0, normDecision: null, responseLanguage: 'mn-Cyrl' as const, normTaskIndex: null, taskCount: 1, toolResults: [], intent: 'GENERAL_HELP', retrievalNoMatch: false };

test('нормын лавлагаа → authoritative/high, В2 + муж + эшлэл заавал, template зөв', () => {
  const d = decideVSubcategory(extractNormEntities('V2 galyn achaalal hed ve?'), RULES);
  const c = buildTrustedContract({ ...base, regulatory: true, normDecision: d, intent: 'NORMATIVE' });
  assert.equal(c.answerMode, 'authoritative');
  assert.equal(c.risk, 'high');
  const ids = c.facts.map((f) => f.id);
  assert.ok(ids.includes('fire_category') && ids.includes('range_min') && ids.includes('range_max'));
  assert.equal(c.facts.find((f) => f.id === 'range_min')?.unit, 'MJ/m2');
  assert.deepEqual(c.allowedCategories, ['В2']);
  assert.deepEqual(c.requiredCitations, ['БД 21-101-12']);
  assert.ok(c.allowedNumbers?.includes(1401) && c.allowedNumbers.includes(2200));
  assert.match(c.template ?? '', /В2.*1401–2200/);
  assert.equal(c.noMatch, false);
});

test('нормын ангилал (g=1800) → g_input баримт, template classify хэлбэр', () => {
  const d = decideVSubcategory(extractNormEntities('g=1800 MJ/m2 bol V2 yu V3 yu'), RULES);
  const c = buildTrustedContract({ ...base, regulatory: true, normDecision: d, intent: 'NORMATIVE' });
  assert.ok(c.facts.some((f) => f.id === 'g_input' && f.value === 1800));
  assert.match(c.template ?? '', /1800.*В2/);
});

test('норм нотолгоогүй → refusal/high, тоо хориотой, noMatch', () => {
  const c = buildTrustedContract({ ...base, regulatory: true, intent: 'NORMATIVE', retrievalNoMatch: true });
  assert.equal(c.answerMode, 'refusal');
  assert.deepEqual(c.allowedNumbers, []);
  assert.equal(c.noMatch, true);
  assert.ok(c.requiredSentence);
  assert.equal(c.template, c.requiredSentence);
});

test('ERP list_projects → grounded/medium; active_count заавал; хайрцгийн тоо зөвшөөрөгдөнө; мөр тоолохгүй', () => {
  const data = { total_visible: 31, active_count: 24, overdue_count: 3, projects: [{ id: 1, name: 'A', progress_percent: 45.5 }, { id: 2, name: 'B', progress_percent: 8.53 }] };
  const c = buildTrustedContract({ ...base, intent: 'COMPANY_FACT', toolResults: [{ tool: 'list_projects', ok: true, data }] });
  assert.equal(c.answerMode, 'grounded');
  assert.equal(c.risk, 'medium');
  const ap = c.facts.find((f) => f.id === 'active_projects');
  assert.equal(ap?.value, 24);
  assert.equal(ap?.mustMention, true);
  assert.ok(c.allowedNumbers?.includes(45.5) && c.allowedNumbers.includes(8.5) && c.allowedNumbers.includes(31));
  assert.match(c.template ?? '', /\*\*24\*\*/);
});

test('ERP list_projects (id-гүй) → мөрийн тоо зөвшөөрөгдсөн олонлогт ОРОХГҮЙ', () => {
  const data = { total_visible: 31, active_count: 24, projects: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
  const c = buildTrustedContract({ ...base, intent: 'COMPANY_FACT', toolResults: [{ tool: 'list_projects', ok: true, data }] });
  assert.ok(!c.allowedNumbers?.includes(3));
});

test('get_upcoming_deadlines → эхний төслийн нэр заавал, хоног d нэгжтэй', () => {
  const data = { count: 2, projects: [{ id: 32, name: 'MITIC', finish_date: '2026-09-15', days_remaining: 5 }, { id: 9, name: 'X', days_remaining: 20 }] };
  const c = buildTrustedContract({ ...base, intent: 'COMPANY_FACT', toolResults: [{ tool: 'get_upcoming_deadlines', ok: true, data }] });
  const np = c.facts.find((f) => f.id === 'nearest_project');
  assert.equal(np?.value, 'MITIC');
  assert.equal(np?.mustMention, true);
  assert.equal(c.facts.find((f) => f.id === 'nearest_days')?.unit, 'd');
  assert.match(c.template ?? '', /MITIC.*5 хоног/);
});

test('analyze_project → серверийн тоолуурууд баримт болно', () => {
  const data = { project: { id: 32, name: 'MITIC', progress_percent: 8.53 }, facts: { tasks_overdue: 0, tasks_stale_14d: 43, tasks_unassigned_open: 299, pending_approvals: 4 } };
  const c = buildTrustedContract({ ...base, intent: 'ERP_ANALYSIS', toolResults: [{ tool: 'analyze_project', ok: true, data }] });
  assert.equal(c.facts.find((f) => f.id === 'tasks_stale_14d')?.value, 43);
  assert.match(c.template ?? '', /MITIC.*8\.53%.*43.*299/);
});

test('эрх татгалзсан хэрэгсэл → хориотой хэллэг, risk ≥ medium', () => {
  const c = buildTrustedContract({ ...base, intent: 'REVIT_ACTION', toolResults: [{ tool: 'revit_set_parameter', ok: false, data: null, error: 'Энэ хэрэгслийг ажиллуулах эрхгүй.' }] });
  assert.ok(c.forbiddenPhrases.includes('өөрчиллөө'));
  assert.ok(c.facts.some((f) => f.value === 'permission_denied'));
  assert.notEqual(c.risk, 'low');
});

test('хэрэгсэл унасан (эрхийн биш) → хориотой хэллэггүй, төлөв unavailable', () => {
  const c = buildTrustedContract({ ...base, intent: 'COMPANY_FACT', toolResults: [{ tool: 'list_projects', ok: false, data: null, error: 'exception' }] });
  assert.deepEqual(c.forbiddenPhrases, []);
  assert.ok(c.facts.some((f) => f.value === 'unavailable'));
});

test('мэндчилгээ → free/low, гэрээгүй', () => {
  const c = buildTrustedContract({ ...base, intent: 'CASUAL' });
  assert.equal(c.answerMode, 'free');
  assert.equal(c.allowedNumbers, null);
  assert.equal(c.template, null);
});

test('олон даалгавар → taskIndex дамжина', () => {
  const d = decideVSubcategory(extractNormEntities('В2 ангиллын галын ачаалал'), RULES);
  const c = buildTrustedContract({ ...base, regulatory: true, normDecision: d, intent: 'NORMATIVE', normTaskIndex: 2, taskCount: 2 });
  assert.equal(c.taskIndex, 2);
});

test('numbersInData · мөрөн доторх тоо, дугуйлалт', () => {
  const s = numbersInData({ a: 8.53, b: 'x 12 y', c: [{ d: 45.5 }] });
  assert.ok(s.has(8.53) && s.has(8.5) && s.has(9) && s.has(12) && s.has(45.5) && s.has(46));
});

test('normalizeUnit · сервер талын хос', () => {
  assert.equal(normalizeUnit('МДж/м²'), 'MJ/m2');
  assert.equal(normalizeUnit('MJ/m2'), 'MJ/m2');
  assert.equal(normalizeUnit('кПа'), 'kPa');
  assert.equal(normalizeUnit('м²'), 'm2');
  assert.equal(normalizeUnit(null), null);
});

test('factsFromTools · танихгүй хэрэгсэл → баримтгүй', () => {
  assert.deepEqual(factsFromTools([{ tool: 'search_regulations', ok: true, data: { count: 3 } }]), []);
});

test('composeTemplate · англи', () => {
  const c = buildTrustedContract({ ...base, responseLanguage: 'en', intent: 'COMPANY_FACT', toolResults: [{ tool: 'get_active_employees', ok: true, data: { total_active: 57 } }] });
  assert.match(c.template ?? '', /Active employees: \*\*57\*\*/);
  assert.ok(composeTemplate([], null, 'en', { kind: 'none', requiredSentence: null, mustMention: [], allowedNumbers: null, trustedText: null, trailerText: null, taskIndex: null, reason: '' }) === null);
});

/* ── R3.5: Revit-ийн хэмжсэн баримт (revit_selection) ─────────────────── */
test('R3.5: revit_selection → revit_model баримт, grounded, тоо зөвхөн хэмжээнээс, REVIT_MODEL trailer', () => {
  const data = { source: 'REVIT_MODEL', selected_total: 1, measured_count: 1, document: 'fixture', elements: [{ id: '2786', category: 'Walls', family: 'Basic Wall', type: 'Wall 1', name: 'Wall 1', level: 'Level 1', width_mm: 200, length_mm: 10000, height_mm: 3000, area_m2: 30, units: { width_mm: 'MM', length_mm: 'MM', height_mm: 'MM', area_m2: 'M2' }, measure_source: 'TYPED_PARAM' }] };
  const facts = factsFromTools([{ tool: 'revit_selection', ok: true, data }]);
  assert.ok(facts.some((f) => f.id === 'revit_0_width_mm' && f.value === 200 && f.authority === 'revit_model' && f.unit === 'mm'));
  assert.ok(facts.some((f) => f.id === 'revit_0_category' && f.value === 'Walls'));
  const c = buildTrustedContract({ ...base, intent: 'GENERAL_HELP', toolResults: [{ tool: 'revit_selection', ok: true, data }] });
  assert.equal(c.answerMode, 'grounded');
  assert.equal(c.trailerText, 'Эх сурвалж: REVIT_MODEL');
  for (const n of [200, 10000, 3000, 30]) assert.ok(c.allowedNumbers!.includes(n), `${n} зөвшөөрөгдөнө`);
  assert.ok(!c.allowedNumbers!.includes(2.5), 'зохиомол тоо зөвшөөрөгдөхгүй');
});

test('R3.5: revit issues — тоо заавал (0 ч), синтетик ангилал тэмдэглэгдэнэ, VERIFIED_NORM байхгүй бол «норм зөрчсөн» хориотой', () => {
  const mk = (issues: unknown[]) => ({ source: 'REVIT_MODEL', selected_total: 1, measured_count: 1, document: 'f', production_rules: 'NO_EXECUTABLE_BIM_RULES', elements: [{ id: '1', category: 'Walls', width_mm: 200, units: { width_mm: 'MM' }, issue_count: issues.length, issues }] });
  const none = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_selection', ok: true, data: mk([]) }] });
  assert.ok(none.facts.some((f) => f.id === 'revit_0_issue_count' && f.value === 0 && f.mustMention));
  assert.ok(none.forbiddenPhrases.includes('норм зөрчсөн') && none.forbiddenPhrases.includes('БНбД'));
  const syn = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_selection', ok: true, data: mk([{ class: 'REVIEW_CANDIDATE', synthetic: true, status: 'HUMAN_REVIEW_REQUIRED' }]) }] });
  assert.ok(syn.facts.some((f) => f.id === 'revit_0_issue_0_class' && String(f.value).startsWith('REVIEW_CANDIDATE') && String(f.value).includes('СИНТЕТИК')));
  assert.ok(syn.forbiddenPhrases.includes('норм зөрчсөн'), 'REVIEW_CANDIDATE нь норм зөрчил болж дээшлэхгүй');
  const ver = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_selection', ok: true, data: mk([{ class: 'VERIFIED_NORM', synthetic: false, status: 'OPEN' }]) }] });
  assert.ok(!ver.forbiddenPhrases.includes('норм зөрчсөн'), 'VERIFIED_NORM байвал зөрчлийн үг зөвшөөрөгдөнө');
});

test('R3.5: revit_report → тоон баримт revit_model, синтетик загвар заавал, явцын хувь хориотой', () => {
  const data = { source: 'REVIT_MODEL', document: 'f', document_is_test_fixture: true, period: 'TODAY', lines: ['Хана 6 үүсгэсэн'], facts: [{ kind: 'SESSION_DURATION_MIN', number: 42, unit: 'min' }], fact_count: 1, progress_estimate: 'PROGRESS_ESTIMATE_UNAVAILABLE' };
  const c = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_report', ok: true, data }] });
  assert.equal(c.answerMode, 'grounded');
  assert.ok(c.facts.some((f) => f.id === 'report_0_SESSION_DURATION_MIN' && f.value === 42 && f.authority === 'revit_model'));
  assert.ok(c.facts.some((f) => f.id === 'report_fixture' && f.mustMention));
  assert.ok(c.allowedNumbers!.includes(42) && !c.allowedNumbers!.includes(55), 'зохиомол 55% зөвшөөрөгдөхгүй');
  assert.ok(c.forbiddenPhrases.includes('хувь дууссан'));
  assert.equal(c.trailerText, 'Эх сурвалж: REVIT_MODEL');
});

test('R3.5: тайлангийн ээлжид revit_selection баримт гэрээнээс хасагдана (issue_count 0 ↔ нээлттэй 2 зөрчилдөхгүй), тайлангийн шошго монголоор', () => {
  const sel = { source: 'REVIT_MODEL', document_is_test_fixture: true, elements: [{ id: '1', category: 'Walls', width_mm: 200, units: { width_mm: 'MM' }, issue_count: 0, issues: [] }] };
  const rep = { source: 'REVIT_MODEL', document_is_test_fixture: true, lines: ['Нээлттэй асуудал: 2'], facts: [{ kind: 'ISSUES_REMAINING', number: 2 }, { kind: 'CATEGORY_TOUCHED', subject: 'Walls', number: 6 }], progress_estimate: 'PROGRESS_ESTIMATE_UNAVAILABLE' };
  const c = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_selection', ok: true, data: sel }, { tool: 'revit_report', ok: true, data: rep }] });
  assert.ok(!c.facts.some((f) => f.id.startsWith('revit_0_')), 'сонголтын баримт хасагдсан');
  assert.ok(c.facts.some((f) => f.id === 'report_0_ISSUES_REMAINING' && f.labelMn === 'Нээлттэй асуудал' && f.value === 2));
  assert.ok(c.facts.some((f) => f.labelMn === 'Хөндсөн Walls' && f.value === 6));
  assert.ok(c.facts.some((f) => f.id === 'report_fixture' && f.mustMention));
  const only = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_selection', ok: true, data: sel }] });
  assert.equal(only.facts.filter((f) => f.id === 'revit_0_issue_count').length, 1, 'issue_count баримт давхардахгүй');
});

test('R3.5: асуудалтай элементэд «асуудал олдсонгүй» хориотой; асуудалгүй үед хориогүй', () => {
  const mk = (issues: unknown[]) => ({ source: 'REVIT_MODEL', elements: [{ id: '1', category: 'Walls', width_mm: 200, units: { width_mm: 'MM' }, issue_count: issues.length, issues }] });
  const withIssue = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_selection', ok: true, data: mk([{ class: 'REVIEW_CANDIDATE', synthetic: true }]) }] });
  assert.ok(withIssue.forbiddenPhrases.includes('асуудал олдсонгүй'));
  const clean = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_selection', ok: true, data: mk([]) }] });
  assert.ok(!clean.forbiddenPhrases.includes('асуудал олдсонгүй'));
});

test('R4.2: REVIT_ACTION → «өөрчиллөө/солилоо/зөөлөө» хориотой (гүйцэтгэл зөвхөн Apply-аас)', () => {
  const data = { source: 'REVIT_MODEL', elements: [{ id: '1', category: 'Walls', width_mm: 200, units: { width_mm: 'MM' }, issue_count: 0, issues: [] }] };
  const c = buildTrustedContract({ ...base, intent: 'REVIT_ACTION', toolResults: [{ tool: 'revit_selection', ok: true, data }] });
  for (const p of ['өөрчиллөө', 'солилоо', 'зөөлөө']) assert.ok(c.forbiddenPhrases.includes(p), p);
  const r = buildTrustedContract({ ...base, intent: 'REVIT_READ', toolResults: [{ tool: 'revit_selection', ok: true, data }] });
  assert.ok(!r.forbiddenPhrases.includes('өөрчиллөө'));
});
