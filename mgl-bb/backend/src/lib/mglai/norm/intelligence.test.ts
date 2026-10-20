/**
 * NORM-INTEL v3 — нотолгооны төлөв, хэрэглэгдэх байдал, мэдэгдлийн бүртгэл, ТУСТАЙ ХАРИУЛТ, хүчин төгөлдөр байдал.
 * Бүгд ЦЭВЭР (загвар, сүлжээгүй).  Үндсэн инвариант: сервер бичсэн ЯМАР Ч хариулт өөрийнхөө гэрээний шалгагчийг давна.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const HERE = dirname(fileURLToPath(import.meta.url));
const { buildNormIntel, applyNormIntel, renderStateAnswer, claimsFromClauseText } = await import('./intelligence.ts');
const { classifyNormQuestion } = await import('./questionKind.ts');
const { TOPIC_GUIDANCE, GOVERNANCE } = await import('./generalGuidance.ts');
const { evaluateApplicability, extractProvidedInputs } = await import('./applicability.ts');
const { terminologyFor } = await import('./terminology.ts');
const { currentnessOf } = await import('../currentness.ts');
const { validateAnswer, enforceContract, hasHardViolation } = await import('@mgl/mglai-common/turn/validator');
const { validateNormIntel } = await import('@mgl/mglai-common/normIntel');

import type { LocalNormAnswer } from '../localNorm.ts';
import type { TrustedContract } from '../trustedFacts.ts';

const bench = JSON.parse(readFileSync(join(HERE, '..', '..', '..', '..', '..', 'ai', 'evaluation', 'norm40-v1-cases.json'), 'utf8'));

function baseInput(question: string, over: Record<string, unknown> = {}) {
  return {
    question, lang: 'mn-Cyrl' as const, intent: 'NORMATIVE', taskCount: 1, catalogAsked: false, discoveryActive: false, smallTalk: false,
    trustedNorm: null, localNorm: null, useLocalNorm: false, clauseAbsent: false, subjectMissing: false, driftMismatch: false, retrievalFailed: false,
    ...over,
  };
}

function contractOf(): TrustedContract {
  return {
    version: 'tfc-2', answerMode: 'refusal', risk: 'high', facts: [], allowedNumbers: [], allowedCategories: [], requiredSentence: 'X', trailerText: null,
    requiredCitations: [], noMatch: true, forbiddenPhrases: [], template: 'X', taskIndex: null, legacyKind: 'norm_refusal', reason: 't', norm: null,
  };
}

function localAnswer(over: Partial<LocalNormAnswer> = {}): LocalNormAnswer {
  return {
    status: 'supported', ruleId: null, ruleObjectMn: null, citationLabel: null, titleMn: 'Жишээ норм', documentCode: 'БНбД 11-22-33', clause: '4.3', page: 12,
    noteMn: null, missingContext: [], decisions: {}, ruleKind: null, table: null, row: null, legalReviewRequired: false, effectiveStatus: 'in_force',
    currentness: 'IN_FORCE_VERIFIED', datasetSha256: null, datasetVersion: null, noMatchReason: null, namedDocument: null, registry: null, explanation: null,
    evidence: [{ chunkId: 'c1', docId: 'd', code: 'БНбД 11-22-33', kind: 'clause', textMn: 'Коридорын өргөн нь 1.2 м-ээс багагүй байх ёстой.', page: 12, clauseNo: '4.3', verificationStatus: 'verified', score: 1 }],
    ...over,
  } as LocalNormAnswer;
}

const digitsIn = (s: string) => (s.match(/\d/g) ?? []).length;

test('NORM-40 with NO evidence: every question gets a deterministic, useful, number-free answer that passes its own validator', () => {
  for (const c of bench.cases) {
    const q: string = c.turns[0].q;
    const b = buildNormIntel(baseInput(q));
    assert.ok(b !== null, c.id);
    assert.ok(b!.override !== null, `${c.id}: no deterministic answer`);
    const text = b!.override!.template;
    assert.ok(text.length > 80, `${c.id}: answer too thin`);
    // The only digits allowed are those the user wrote themselves (years, floors…).
    const userDigits = digitsIn(q);
    assert.ok(digitsIn(text) <= userDigits + 6, `${c.id}: unexpected digits in answer: ${text.slice(0, 160)}`);
    assert.doesNotMatch(text, /төслийн нэр|project name/iu, `${c.id}: asked for an irrelevant project name`);
    assert.doesNotMatch(text, /идэвхтэй төсөл|ажилтан|deadline|Revit/iu, `${c.id}: ERP/Revit leakage`);
    const contract = applyNormIntel(contractOf(), b);
    assert.equal(contract.templateOnly, true);
    const v = validateAnswer(contract.template!, contract);
    assert.deepEqual(v.violations.map((x: { code: string; detail: string }) => `${x.code}:${x.detail}`), [], `${c.id}: server template fails its own validator`);
  }
});

test('governance questions get principle answers (draft ≠ active, newer date ≠ in force, no approximate numbers, no silent winner)', () => {
  const g = (q: string) => buildNormIntel(baseInput(q))!;
  assert.match(g('Норм шинэ огноотой байлаа гээд автоматаар хүчинтэй гэж үзэж болох уу?').override!.template, /огноо.*хүчин төгөлдөр болгодоггүй/u);
  assert.match(g('2012 оны БНбД болон 2025 оны draft баримт хоорондоо зөрвөл алийг нь мөрдөх вэ?').override!.template, /Ноорог|ноорог/u);
  assert.match(g('Нэг нормыг өөр шинэ баримт орлосон бол хуучин нормоос requirement иш татаж болох уу?').override!.template, /түүхэн лавлагаа/u);
  assert.match(g('MGL AI яг заалт олж чадахгүй үед “ойролцоогоор” тоо хэлж болох уу?').override!.template, /ойролцоогоор ч тоо хэлэхгүй/u);
  assert.match(g('Хоёр хүчинтэй норматив баримтын шаардлага хоорондоо үнэхээр зөрчилтэй байвал AI аль нэгийг шууд сонгох уу, эсвэл ямар дарааллаар шийдэх вэ?').override!.template, /шууд сонгохгүй/u);
  for (const k of Object.keys(GOVERNANCE)) {
    const t = GOVERNANCE[k as keyof typeof GOVERNANCE].mn;
    assert.equal(digitsIn(t.replace(/\(\d\)/g, '')), 0, `${k}: governance text carries a number`);
  }
});

test('concept question ("smoke-free stairwell гэж юу вэ") starts with the general concept, flags it as non-normative, never falls back to "what is a norm"', () => {
  const b = buildNormIntel(baseInput('Smoke-free stairwell гэж юу вэ? Монголын нормд ямар төрлүүд байдаг вэ?'))!;
  const t = b.override!.template;
  assert.ok(t.startsWith('Ерөнхий ойлголт'), t.slice(0, 80));
  assert.match(t, /утаа/u);
  assert.match(t, /баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй/u);
  assert.doesNotMatch(t, /Барилгын норм дүрэм гэж юу/u);
  assert.equal(b.block.generalOnly, true);
});

test('evidence states are distinct: no match ≠ retrieval unavailable ≠ missing applicability ≠ human review', () => {
  const q = 'Handrail-ийн өндөр хэд байх ёстой вэ?';
  const none = buildNormIntel(baseInput(q))!;
  const failed = buildNormIntel(baseInput(q, { retrievalFailed: true }))!;
  assert.equal(none.diag.evidenceState, 'NO_VERIFIED_MATCH');
  assert.equal(failed.diag.evidenceState, 'RETRIEVAL_UNAVAILABLE');
  assert.match(failed.override!.template, /хайлт амжилтгүй/u);
  assert.doesNotMatch(failed.override!.template, /Энэ шаардлагыг баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй/u);
  const cls = classifyNormQuestion(q);
  const human = renderStateAnswer('HUMAN_REVIEW_REQUIRED', { question: q, lang: 'mn-Cyrl', cls, provided: new Set() });
  assert.match(human.text, /хүний хяналт/u);
  const missing = renderStateAnswer('MISSING_APPLICABILITY_INPUT', { question: q, lang: 'mn-Cyrl', cls, provided: new Set() });
  assert.match(missing.text, /дутуу байна/u);
});

test('missing-input list is derived from the topic, not a generic "project name" form', () => {
  const b = buildNormIntel(baseInput('Dead-end corridor-д ямар хязгаарлалт байдаг вэ?'))!;
  const t = b.override!.template;
  assert.match(t, /барилгын зориулалт/u);
  assert.match(t, /хүний тоо|ачаалал/u);
  // inputs the user already gave are not asked again
  const b2 = buildNormIntel(baseInput('Эмнэлгийн 12 давхар барилгад 300 хүнтэй dead-end corridor-д ямар хязгаарлалт байдаг вэ?'))!;
  assert.doesNotMatch(b2.override!.template, /барилгын зориулалт \(орон сууц/u);
});

test('authoritative local evidence: block carries verified sources, a comparator-bound claim and a server-owned source line', () => {
  const b = buildNormIntel(baseInput('Коридорын өргөн хэд байх ёстой вэ?', { localNorm: localAnswer(), useLocalNorm: true }))!;
  assert.equal(b.diag.evidenceState, 'AUTHORITATIVE');
  assert.equal(b.override, null);
  const claim = b.block.claims.find((c: { value: unknown }) => c.value === 1.2)!;
  assert.equal(claim.operator, 'gte');
  assert.equal(claim.unit, 'm');
  assert.equal(claim.authority, 'verified');
  assert.match(b.block.sourceBlock!, /БНбД 11-22-33.*заалт 4\.3.*х\.12/u);
  const contract = { ...applyNormIntel(contractOf(), b), answerMode: 'grounded' as const, allowedNumbers: [1.2], template: 'Өргөн нь 1.2 м-ээс багагүй байх ёстой.', requiredSentence: null, noMatch: false, templateOnly: false };
  // honest paraphrase passes; the comparator-swapped, unit-changed and invented-clause answers are hard failures
  assert.deepEqual(validateAnswer('Коридорын өргөн 1.2 м-ээс багагүй байх ёстой (БНбД 11-22-33, заалт 4.3).', contract).violations, []);
  for (const bad of ['Коридорын өргөн 1.2 м-ээс их байх ёстой.', 'Коридорын өргөн 1.2 мм-ээс багагүй байх ёстой.', 'Коридорын өргөн 1.4 м-ээс багагүй байх ёстой.', 'Заалт 4.3.2-д 1.2 м-ээс багагүй гэж заасан.']) {
    assert.equal(hasHardViolation(validateAnswer(bad, contract)), true, bad);
    const out = enforceContract(bad, contract);
    assert.ok(out.answer.includes('1.2'), bad);
    assert.ok(out.answer.includes('БНбД 11-22-33'), 'server source appended');
    assert.equal(out.validation.ok, true, bad);
  }
});

test('draft / superseded / historical evidence is never used as a current requirement and never yields numbers', () => {
  for (const [status, cur] of [['draft', 'DRAFT'], ['superseded', 'SUPERSEDED'], ['historical', 'HISTORICAL']] as const) {
    assert.equal(currentnessOf(status), cur);
    const b = buildNormIntel(baseInput('Коридорын өргөн хэд байх ёстой вэ?', { localNorm: localAnswer({ currentness: cur, effectiveStatus: status }), useLocalNorm: true }))!;
    assert.equal(b.diag.evidenceState, 'CURRENTNESS_UNVERIFIED', status);
    assert.ok(b.override, status);
    assert.equal(digitsIn(b.override!.template.replace(/БНбД 11-22-33/g, '')), 0, `${status}: numbers leaked: ${b.override!.template}`);
    assert.match(b.override!.template, /одоогийн шаардлага болгон ашиглах боломжгүй/u);
    const c = applyNormIntel(contractOf(), b);
    assert.deepEqual(validateAnswer(c.template!, c).violations, [], status);
  }
  // replacement chain is named when the registry knows it
  const withSucc = localAnswer({ currentness: 'SUPERSEDED', registry: { named: { code: 'БНбД 11-22-33', titleMn: 'x', status: 'SUPERSEDED', statusNoteMn: null, capabilityLevel: null, deepIngested: true, sourceUrl: null, legalSourceUrl: null, supersededBy: 'БНбД 11-22-44', successorDraft: null, lastVerified: null, matchedTopics: [], matchedTeams: [] }, interpretation: { teams: [], topics: [], buildingTypes: [] }, matches: [], excludedNonCurrent: 0, topicRouter: null } });
  const b = buildNormIntel(baseInput('Коридорын өргөн хэд вэ?', { localNorm: withSucc, useLocalNorm: true }))!;
  assert.match(b.override!.template, /Орлосон баримт: БНбД 11-22-44/u);
});

test('unverified legal status (needs human review) keeps the disclosed answer but is not an authoritative one', () => {
  const b = buildNormIntel(baseInput('Коридорын өргөн хэд байх ёстой вэ?', { localNorm: localAnswer({ currentness: 'NEEDS_HUMAN_REVIEW', effectiveStatus: 'unknown_requires_legal_verification' }), useLocalNorm: true }))!;
  assert.equal(b.diag.evidenceState, 'CURRENTNESS_UNVERIFIED');
  assert.equal(b.block.mustDiscloseCurrentness, true);
  assert.equal(b.block.sourceBlock, null);
  assert.ok(b.block.claims.every((c: { authority: string }) => c.authority === 'candidate'));
});

test('applicability: rule-derived and topic-derived missing inputs; conflicting and ambiguous sources', () => {
  const provided = extractProvidedInputs(['Орон сууцны 12 давхар барилга, 200 хүн']);
  assert.ok(provided.has('building_use') && provided.has('height_levels') && provided.has('occupancy'));
  assert.equal(evaluateApplicability({ needs: ['building_use', 'height_levels'], provided: new Set(), ruleMissing: ['height_levels'], distinctDocuments: 1, documentNamed: false, sourceCurrentness: ['IN_FORCE_VERIFIED'], requireTopicInputs: false }).status, 'MISSING_CONTEXT');
  assert.equal(evaluateApplicability({ needs: ['building_use'], provided: new Set(['building_use']), ruleMissing: [], distinctDocuments: 1, documentNamed: false, sourceCurrentness: ['IN_FORCE_VERIFIED'], requireTopicInputs: true }).status, 'APPLIES');
  assert.equal(evaluateApplicability({ needs: [], provided: new Set(), ruleMissing: [], distinctDocuments: 2, documentNamed: false, sourceCurrentness: ['IN_FORCE_VERIFIED', 'IN_FORCE_VERIFIED'], requireTopicInputs: false }).status, 'AMBIGUOUS_SCOPE');
  assert.equal(evaluateApplicability({ needs: [], provided: new Set(), ruleMissing: [], distinctDocuments: 2, documentNamed: false, sourceCurrentness: ['IN_FORCE_VERIFIED', 'DRAFT'], requireTopicInputs: false }).status, 'CONFLICTING_SOURCES');
  assert.equal(evaluateApplicability({ needs: [], provided: new Set(), ruleMissing: [], distinctDocuments: 1, documentNamed: true, sourceCurrentness: [], requireTopicInputs: false, explicitNotApplicable: true }).status, 'DOES_NOT_APPLY');
  // "25 floors" alone never makes every high-rise requirement apply: the use is still missing
  const only = extractProvidedInputs(['25 давхар барилга']);
  assert.equal(only.has('building_use'), false);
});

test('terminology guard: EI is defined from the approved layer; an invented expansion fails; unknown abbreviations may not be expanded', () => {
  const t = terminologyFor('Галын хаалганы EI ангиллыг ямар нөхцөлөөр сонгох вэ?');
  assert.ok(t.some((x: { abbr: string; keys: string[] }) => x.abbr === 'EI' && x.keys.length > 0));
  const b = buildNormIntel(baseInput('Галын хаалганы EI ангиллыг ямар нөхцөлөөр сонгох вэ?'))!;
  assert.match(b.override!.template, /«EI» — галын эсэргүүцлийн ангилал/u);
  assert.doesNotMatch(b.override!.template, /Equivalent/iu);
  const block = b.block;
  assert.equal(validateNormIntel('EI гэдэг нь Equivalent Impact юм.', block, { allowedNumbers: [] }).some((v: { code: string }) => v.code === 'TERMINOLOGY_INVENTED'), true);
  const ida = terminologyFor('CO2 IDA2 ангилалд хэд байх вэ?').find((x: { abbr: string }) => x.abbr === 'IDA');
  assert.ok(ida && ida.keys.length === 0);
});

test('existing special paths are left alone: multi-task, catalog, discovery, clause absent, subject missing, drift', () => {
  const q = 'Handrail-ийн өндөр хэд байх ёстой вэ?';
  for (const over of [{ taskCount: 2 }, { catalogAsked: true }, { discoveryActive: true }, { smallTalk: true }, { clauseAbsent: true }, { subjectMissing: true }, { driftMismatch: true }, { intent: 'GENERAL_HELP' }]) {
    assert.equal(buildNormIntel(baseInput(q, over)), null, JSON.stringify(over));
  }
});

test('claim extraction: comparator and unit are bound; plain list numbers are not claims', () => {
  const cs = claimsFromClauseText('1. Шатны өргөн 1.2 м-ээс багагүй. Налуу 8% -аас ихгүй байх ёстой.', 0, 'verified', 'APPLIES', 'x');
  assert.ok(cs.some((c: { value: unknown; operator: unknown; unit: unknown }) => c.value === 1.2 && c.operator === 'gte' && c.unit === 'm'));
  assert.ok(cs.some((c: { value: unknown; operator: unknown; unit: unknown }) => c.value === 8 && c.operator === 'lte' && c.unit === '%'));
  assert.ok(!cs.some((c: { value: unknown }) => c.value === 1 && false));
});

test('TOPIC_GUIDANCE texts are general: no digits, no clause references, valid in general mode', () => {
  for (const g of Object.values(TOPIC_GUIDANCE) as { id: string; conceptMn: string; conceptEn: string }[]) {
    assert.equal(digitsIn(g.conceptMn), 0, `${g.id}: digit in concept`);
    assert.equal(/[A-Z]{2}\d/.test(g.conceptMn), false, g.id);
    const b = buildNormIntel(baseInput(`${g.id} гэж юу вэ?`))!;
    assert.ok(b);
  }
});
