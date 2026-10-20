/**
 * MGL AI · ҮНДЭСЛЭЛИЙН ХААЛГА — ТЕСТ (Session C, 2026-09-11).
 *
 * Run with:  node --test src/lib/mglai/groundingGuard.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ: дөрвөн репродукц хийсэн P0/P1 гажиг —
 *    хэрэгсэлгүй ERP асуулт, БҮГД унасан хэрэгсэл, баримт үүсгэдэггүй
 *    хэрэгслийн үр дүн, Revit контекстгүй Revit асуулт — `free` гэрээгээр
 *    ӨНГӨРӨХГҮЙ.  Нормын гэрээ (A-ийн хүрээ) хөндөгдөхгүй.
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

const { buildTrustedContract } = await import('./trustedFacts.ts');
const { applyGroundingGuard, ERP_NO_DATA_MN, ERP_UNAVAILABLE_MN, REVIT_NO_CONTEXT_MN, REVIT_NO_CONTEXT_EN } =
  await import('./groundingGuard.ts');
const { decideVSubcategory } = await import('./normDecide.ts');
const { extractNormEntities } = await import('./normEntities.ts');

type Tool = { tool: string; ok: boolean; data: unknown; error?: string | null };
const base = {
  regulatory: false,
  evidenceCount: 0,
  normDecision: null,
  responseLanguage: 'mn-Cyrl' as const,
  normTaskIndex: null,
  taskCount: 1,
  retrievalNoMatch: false,
};

function guarded(intent: string, toolResults: Tool[], revit = false, lang: 'mn-Cyrl' | 'en' = 'mn-Cyrl') {
  const c = buildTrustedContract({ ...base, responseLanguage: lang, toolResults, intent });
  return { before: c, after: applyGroundingGuard(c, { intent, toolResults, revitContextPresent: revit, responseLanguage: lang }) };
}

test('GAP-001: COMPANY_FACT + хэрэгсэл 0 → refusal, тоо хориотой, канон өгүүлбэр заавал', () => {
  const { before, after } = guarded('COMPANY_FACT', []);
  assert.equal(before.answerMode, 'free', 'суурь гэрээ free байсан (репродукц)');
  assert.equal(after.answerMode, 'refusal');
  assert.equal(after.risk, 'high');
  assert.deepEqual(after.allowedNumbers, []);
  assert.equal(after.requiredSentence, ERP_NO_DATA_MN);
  assert.equal(after.template, ERP_NO_DATA_MN);
  assert.ok(after.facts.some((f) => f.id === 'erp_no_data'));
});

test('GAP-001: ERP_ANALYSIS + хэрэгсэл 0 → мөн refusal', () => {
  const { after } = guarded('ERP_ANALYSIS', []);
  assert.equal(after.answerMode, 'refusal');
  assert.deepEqual(after.allowedNumbers, []);
});

test('GAP-002: БҮХ хэрэгсэл унасан (denied биш) → refusal, «амьд өгөгдөл татаж чадсангүй»', () => {
  const { before, after } = guarded('COMPANY_FACT', [{ tool: 'list_projects', ok: false, data: null, error: 'timeout' }]);
  assert.equal(before.answerMode, 'free', 'репродукц: унасан хэрэгсэл free үлдээдэг байсан');
  assert.equal(after.answerMode, 'refusal');
  assert.equal(after.requiredSentence, ERP_UNAVAILABLE_MN);
  assert.deepEqual(after.allowedNumbers, []);
  // Унасан хэрэгслийн төлөвийн баримт ХЭВЭЭР (factsFromFailures).
  assert.ok(after.facts.some((f) => f.id === 'tool_failed:list_projects'));
});

test('GAP-002: GENERAL_HELP санаатай ч хэрэгсэл бүгд унавал refusal (санаанаас үл хамаарна)', () => {
  const { after } = guarded('GENERAL_HELP', [{ tool: 'get_active_employees', ok: false, data: null, error: 'exception' }]);
  assert.equal(after.answerMode, 'refusal');
});

test('GAP-003: query_entities амжилттай → grounded, тоо зөвхөн хайрцгаас', () => {
  const data = { entity: 'employees', count: 2, rows: [{ id: 7, name: 'А' }, { id: 12, name: 'Б' }] };
  const { before, after } = guarded('COMPANY_FACT', [{ tool: 'query_entities', ok: true, data }]);
  assert.equal(before.answerMode, 'free', 'репродукц: баримтгүй хэрэгсэл free үлдээдэг байсан');
  assert.equal(after.answerMode, 'grounded');
  assert.equal(after.risk, 'medium');
  assert.ok(after.allowedNumbers !== null);
  const allowed = new Set(after.allowedNumbers);
  assert.ok(allowed.has(2) && allowed.has(7) && allowed.has(12));
  assert.ok(!allowed.has(87), 'хайрцагт байхгүй тоо зөвшөөрөгдөхгүй');
});

test('GAP-003: зарим хэрэгсэл унасан, зарим нь амжилттай → grounded (унасныг нуухгүй)', () => {
  const { after } = guarded('COMPANY_FACT', [
    { tool: 'query_entities', ok: true, data: { count: 5 } },
    { tool: 'get_employee_activity', ok: false, data: null, error: 'timeout' },
  ]);
  assert.equal(after.answerMode, 'grounded');
  assert.ok(after.facts.some((f) => f.id === 'tool_failed:get_employee_activity'));
});

test('GAP-004: REVIT_READ контекстгүй → refusal, Revit-ийн канон өгүүлбэр', () => {
  const { before, after } = guarded('REVIT_READ', []);
  assert.equal(before.answerMode, 'free');
  assert.equal(after.answerMode, 'refusal');
  assert.equal(after.requiredSentence, REVIT_NO_CONTEXT_MN);
  assert.deepEqual(after.allowedNumbers, []);
});

test('GAP-004: REVIT_ACTION контекстгүй → refusal, high', () => {
  const { after } = guarded('REVIT_ACTION', []);
  assert.equal(after.answerMode, 'refusal');
  assert.equal(after.risk, 'high');
});

test('GAP-004: Revit контекст ИРСЭН бол хөндөхгүй (free хэвээр)', () => {
  const { before, after } = guarded('REVIT_READ', [], true);
  assert.equal(after, before);
});

test('англи хариултын хэлэнд англи өгүүлбэр', () => {
  const { after } = guarded('REVIT_READ', [], false, 'en');
  assert.equal(after.requiredSentence, REVIT_NO_CONTEXT_EN);
});

test('CASUAL / META хэрэгсэлгүй → ХӨНДӨХГҮЙ (мэндчилгээнд татгалзал орохгүй)', () => {
  for (const intent of ['CASUAL', 'META']) {
    const { before, after } = guarded(intent, []);
    assert.equal(after, before, `${intent} ижил объект`);
  }
});

test('GENERAL_HELP / DOCUMENT_ANALYSIS / CALCULATION хэрэгсэлгүй → норм, эшлэл ЗОХИОХГҮЙ; тоо, татгалзал хөндөхгүй (2026-09-23, HL10)', () => {
  for (const intent of ['GENERAL_HELP', 'DOCUMENT_ANALYSIS', 'CALCULATION']) {
    const { after } = guarded(intent, []);
    assert.equal(after.answerMode, 'grounded', intent);
    assert.equal(after.allowedNumbers, null, `${intent}: тоо шалгахгүй`);
    assert.equal(after.noMatch, true, `${intent}: хуурамч нормын эшлэл хасагдана`);
    assert.equal(after.requiredSentence ?? null, null, `${intent}: татгалзлын өгүүлбэр ХҮЧЭЭР оруулахгүй`);
    assert.ok(after.forbiddenPhrases.includes('норм дүрэм:'), intent);
    assert.ok(after.template && after.template.length > 0, `${intent}: бүгд хасагдвал шударга template`);
  }
});

test('7 хэрэгслийн grounded гэрээ ХЭВЭЭР (get_active_employees)', () => {
  const { before, after } = guarded('COMPANY_FACT', [{ tool: 'get_active_employees', ok: true, data: { total_active: 41 } }]);
  assert.equal(before.answerMode, 'grounded');
  assert.equal(after, before, 'аль хэдийн grounded — ижил объект');
});

test('НОРМЫН гэрээг хөндөхгүй — authoritative хэвээр (Session A-ийн хүрээ)', () => {
  const RULE = (cat: string, min: number | null, max: number | null, minEx = false) => ({
    ruleId: `r:${cat}`, documentCode: 'БД 21-101-12', category: cat, page: 13, tableNo: 4, quantity: 'g_mj_m2' as const,
    minValue: min, maxValue: max, minExclusive: minEx, maxExclusive: false, method: null,
    verification: 'verified_from_page_image',
  });
  const d = decideVSubcategory(extractNormEntities('g=1800 MJ/m2 bol V2 yu?'), [RULE('В1', 2200, null, true), RULE('В2', 1401, 2200), RULE('В3', 181, 1400), RULE('В4', 1, 180)]);
  const c = buildTrustedContract({ ...base, regulatory: true, normDecision: d, intent: 'NORMATIVE', toolResults: [] });
  const g = applyGroundingGuard(c, { intent: 'NORMATIVE', toolResults: [], revitContextPresent: false, responseLanguage: 'mn-Cyrl' });
  assert.equal(g, c);
  assert.equal(g.answerMode, 'authoritative');
});

test('НОРМЫН татгалзлын гэрээг хөндөхгүй', () => {
  const c = buildTrustedContract({ ...base, regulatory: true, intent: 'NORMATIVE', toolResults: [] });
  assert.equal(c.answerMode, 'refusal');
  const g = applyGroundingGuard(c, { intent: 'NORMATIVE', toolResults: [], revitContextPresent: false, responseLanguage: 'mn-Cyrl' });
  assert.equal(g, c);
});

test('GAP-003: grounded гэрээ ДЕТЕРМИНИСТ template-тэй (хоосон fallback-аас сэргийлнэ)', () => {
  const { after } = guarded('COMPANY_FACT', [{ tool: 'describe_system', ok: true, data: { page_count: 19 } }]);
  assert.equal(after.answerMode, 'grounded');
  assert.ok(after.template && after.template.includes('describe_system') && after.template.includes('19'));
});
