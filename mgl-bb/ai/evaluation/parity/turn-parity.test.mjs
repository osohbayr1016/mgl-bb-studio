/**
 * ДИФФЕРЕНЦИАЛ ПАРИТЕТ — хуучин хөтчийн orchestrator ↔ `@mgl/mglai-common/turn`
 * (Session R, Checkpoint 3B §4).  15 детерминист кейс, ИЖИЛ хуурамч сүлжээ, хэвийжүүлсэн
 * гаралт байт-ижил байх ёстой.  Зориудын зөрүү бүр `intentional`-д ЗАРЛАГДСАН:
 *
 *   INTENTIONAL-1  `/conversations` body.surface — хөтөч үргэлж 'web'; хуваалцсан хөдөлгүүр
 *                  `input.surface` (revit/voice) дамжуулна.  Зөвхөн кейс 15.
 *   INTENTIONAL-2  `/context` body.revit_context — хуучин orchestrator-т талбар өөрөө БАЙХГҮЙ.
 *                  Зөвхөн кейс 15.
 *   INTENTIONAL-3  `/plan` body.revit_selection — сонгосон элементийн тоо (R3.5): сервер «Энэ юу вэ?»-г
 *                  REVIT_READ гэж тайлахад.  Зөвхөн кейс 15 (revit_context байхгүй бол талбар ЯВАХГҮЙ).
 *   INTENTIONAL-4  `/messages` body.contract_diag.legacy — бүх кейст (`lib/differential.mjs` GLOBAL_INTENTIONAL).
 *
 *   node --test evaluation/parity/turn-parity.test.mjs     (ai/ дотроос)
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { differential } from './lib/differential.mjs';
import { sse, sseResponse, jsonResponse, contextResponse, DEFAULT_PLAN } from '../production-readiness/lib/fakeWire.mjs';

const tok = (t) => sse('token', { text: t });
const START = () => sse('start', { engine: { engine: 'llama.cpp' } });
const DONE = (over = {}) => sse('done', { stop_reason: 'stop', first_token_ms: 5, total_ms: 20, engine: 'llama.cpp', runtime_variant: 'employee-8b-q4', usage: { promptTokens: 10, completionTokens: 3 }, ...over });
const gen = (...frames) => () => sseResponse(frames);
const NORM_REFUSAL_MN = 'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй.';

function expectParity(r, label) {
  assert.deepEqual(r.unexplained, [], `${label}: зарлаагүй зөрүү:\n  ${r.unexplained.join('\n  ')}`);
}

/* 1 */
test('P01 хэвийн амжилттай хариулт', async () => {
  const r = await differential(() => ({ generate: gen(START(), tok('Сайн '), tok('байна.'), DONE()) }));
  expectParity(r, 'P01');
  assert.equal(r.neu.result.answer, 'Сайн байна.');
  assert.equal(r.neu.result.stopReason, 'stop');
  assert.ok(r.neu.calls.some((c) => c.url.includes('/mgl-ai/messages') && c.body?.role === 'assistant'), 'хадгалагдсан');
});

/* 2 */
const NORM_PLAN = { ...DEFAULT_PLAN, intent: 'NORMATIVE', regulatory: true, evidence_required: true, needs_retrieval: true, ask_local_norm: true, norm_query: 'коридорын өргөн', turn: { ...DEFAULT_PLAN.turn, tasks: [{ text: 'x', intent: 'NORMATIVE', domain: 'norm' }] } };
const NORM_ANSWER = {
  status: 'verified', rule_id: 'r1', rule_object_mn: 'Коридорын өргөн 1.2 м-ээс багагүй', elapsed_ms: 9,
  citation: { document: 'БНбД 31-01-00', doc_id: 'd1', clause: '5.2', page: 12, label_mn: 'БНбД 31-01-00, заалт 5.2', table: null, row: null, legal_review_required: false, effective_status: 'in_force' },
  evidence: [{ chunk_id: 'c1', kind: 'clause', text_mn: 'Коридорын өргөн 1.2 м-ээс багагүй байна.', page: 12, clause_no: '5.2', score: 0.9 }],
  note_mn: null, missing_context: [],
};
const NORM_CTX = () => contextResponse({
  regulatory: true, intent: 'NORMATIVE', evidence_required: true,
  evidence: [{ id: 'ev1', kind: 'clause', title: 'БНбД 31-01-00 5.2', text: 'Коридорын өргөн 1.2 м-ээс багагүй байна.', source: 'local_norm', verification_state: 'verified', citation: { document: 'БНбД 31-01-00', clause: '5.2', page: 12 } }],
  verification_states: ['verified'],
  trusted_contract: { version: 'tfc-1', answerMode: 'grounded', risk: 'high', facts: [{ id: 'f1', kind: 'number', value: 1.2, unit: 'м', labelMn: 'коридорын өргөн', labelEn: 'corridor width', authority: 'local_norm', mustMention: true }], allowedNumbers: [1.2, 5.2], allowedCategories: null, requiredSentence: null, trailerText: null, requiredCitations: ['БНбД 31-01-00'], noMatch: false, forbiddenPhrases: [], template: 'Коридорын өргөн 1.2 м-ээс багагүй (БНбД 31-01-00, заалт 5.2).', taskIndex: null, legacyKind: 'norm', reason: 'test' },
});
test('P02 нормын хариулт (локал /norm → /context нотолгоо → эшлэл)', async () => {
  const r = await differential(() => ({
    plan: () => jsonResponse(NORM_PLAN),
    norm: () => jsonResponse(NORM_ANSWER),
    context: () => jsonResponse(NORM_CTX()),
    messages: (body) => jsonResponse({ msg_uid: body?.msg_uid ?? 'm', citations: body?.role === 'assistant' ? [{ id: 'cit1', label: 'БНбД 31-01-00, заалт 5.2', document: 'БНбД 31-01-00', clause: '5.2' }] : [], dropped_citations: [], confidence: 'verified' }),
    generate: gen(START(), tok('Коридорын өргөн 1.2 м-ээс багагүй '), tok('(БНбД 31-01-00, заалт 5.2).'), DONE()),
  }));
  expectParity(r, 'P02');
  assert.equal(r.neu.result.regulatory, true);
  assert.ok(r.neu.calls.find((c) => c.url.includes('/mgl-ai/context'))?.body?.norm_answer, 'norm_answer /context-д очсон');
});

/* 3 */
test('P03 нормын сан суулгаагүй (/norm 503 → not_installed, ээлж үргэлжилнэ)', async () => {
  const r = await differential(() => ({ plan: () => jsonResponse(NORM_PLAN), norm: () => jsonResponse({ error: 'not installed' }, 503), generate: gen(START(), tok('x'), DONE()) }));
  expectParity(r, 'P03');
  const ctx = r.neu.calls.find((c) => c.url.includes('/mgl-ai/context'));
  assert.equal(ctx?.body?.norm_retrieval?.reason, 'not_installed');
  assert.ok(r.neu.events.some((e) => e.type === 'warning' && e.stage === 'norm_retrieval'));
});

/* 4 */
test('P04 хайлт олдсонгүй (insufficient_evidence → татгалзлын гэрээ → засвар)', async () => {
  const r = await differential(() => ({
    plan: () => jsonResponse(NORM_PLAN),
    norm: () => jsonResponse({ ...NORM_ANSWER, status: 'insufficient_evidence', rule_id: null, rule_object_mn: null, citation: null, evidence: [], no_match_reason: 'no_content_overlap' }),
    context: () => jsonResponse(contextResponse({ regulatory: true, intent: 'NORMATIVE', evidence_required: true, evidence: [], trusted_contract: { version: 'tfc-1', answerMode: 'refusal', risk: 'high', facts: [], allowedNumbers: [], allowedCategories: null, requiredSentence: NORM_REFUSAL_MN, trailerText: null, requiredCitations: [], noMatch: true, forbiddenPhrases: [], template: NORM_REFUSAL_MN, taskIndex: null, legacyKind: 'norm_refusal', reason: 'no_match' } })),
    generate: gen(START(), tok('БНбД 99-99-99-ийн 4.2 заалтад коридорын өргөн 2.5 м байх ёстой.'), DONE()),
  }));
  expectParity(r, 'P04');
  assert.ok(r.neu.result.answer.includes(NORM_REFUSAL_MN));
  assert.ok(!r.neu.result.answer.includes('2.5'));
  assert.notEqual(r.neu.result.contractDiag?.final, 'model');
});

/* 5 */
test('P05 backend offline (/plan fetch throws) → BACKEND_OFFLINE', async () => {
  const r = await differential(() => ({ plan: () => { throw new TypeError('Failed to fetch'); } }));
  expectParity(r, 'P05');
  assert.equal(r.neu.result.error?.code, 'BACKEND_OFFLINE');
});

/* 6 */
test('P06a runtime суулгаагүй (probe not_running) → retrieval-only, /generate дуудагдахгүй', async () => {
  const r = await differential(() => ({}), { runtime: { installed: false, reason: 'not_running' } });
  expectParity(r, 'P06a');
  assert.equal(r.neu.result.engine, 'retrieval-only');
  assert.equal(r.neu.result.error?.code, 'LOCAL_RUNTIME_OFFLINE');
  assert.ok(!r.neu.calls.some((c) => c.url.includes('/generate')));
});
test('P06b runtime хүрэхгүй (/generate fetch throws) → LOCAL_RUNTIME_OFFLINE', async () => {
  const r = await differential(() => ({ generate: () => { throw new TypeError('connect ECONNREFUSED'); } }));
  expectParity(r, 'P06b');
  assert.equal(r.neu.result.error?.code, 'LOCAL_RUNTIME_OFFLINE');
});

/* 7 */
test('P07a үүсгэлтийн хугацаа (runtime stop_reason=timeout) → GENERATION_TIMEOUT, хадгалагдахгүй', async () => {
  const r = await differential(() => ({ generate: gen(START(), tok('удаан '), DONE({ stop_reason: 'timeout' })) }));
  expectParity(r, 'P07a');
  assert.equal(r.neu.result.error?.code, 'GENERATION_TIMEOUT');
  assert.ok(!r.neu.calls.some((c) => c.url.includes('/mgl-ai/messages') && c.body?.role === 'assistant'));
});
test('P07b /context хатуу хязгаар (60 с, mock timers) → RETRIEVAL_TIMEOUT (CANCELLED / BACKEND_OFFLINE БИШ)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const hang = (_body, { init }) => new Promise((_, rej) => { init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
    const r = await differential(() => ({ context: hang }), {}, {
      hooks: {
        during: async ({ calls }) => {
          for (let i = 0; i < 200 && !calls.some((c) => c.url.includes('/mgl-ai/context')); i++) await new Promise((res) => setImmediate(res));
          assert.ok(calls.some((c) => c.url.includes('/mgl-ai/context')), '/context дуудагдаагүй');
          mock.timers.tick(60_001);
        },
      },
    });
    expectParity(r, 'P07b');
    assert.equal(r.neu.result.error?.code, 'RETRIEVAL_TIMEOUT');
  } finally {
    mock.timers.reset();
  }
});

/* 8 */
test('P08 хэрэглэгч цуцлав (abort урсгал дунд) → CANCELLED, хадгалагдахгүй', async () => {
  const r = await differential(
    () => ({ generate: () => sseResponse([START(), tok('нэг '), tok('хоёр '), tok('гурав '), tok('дөрөв '), DONE()], { delayMs: 40 }) }),
    {},
    { hooks: { during: ({ ctrl }) => { setTimeout(() => ctrl.abort(), 90); } } },
  );
  expectParity(r, 'P08');
  assert.equal(r.neu.result.error?.code, 'CANCELLED');
  assert.ok(!r.neu.calls.some((c) => c.url.includes('/mgl-ai/messages') && c.body?.role === 'assistant'));
});

/* 9 */
test('P09 урсгал дунд тасрав (сүлжээ) → interrupted, GENERATION_INTERRUPTED (notice)', async () => {
  const r = await differential(() => ({ generate: () => sseResponse([START(), tok('Хариулт '), tok('эхэлж ')], { failAfter: 3 }) }));
  expectParity(r, 'P09');
  assert.equal(r.neu.result.stopReason, 'interrupted');
  assert.equal(r.neu.result.error?.code, 'GENERATION_INTERRUPTED');
});

/* 10 */
test('P10 давталтын хамгаалалт (stop_reason=repetition) → GENERATION_REPETITION, хадгалагдахгүй', async () => {
  const r = await differential(() => ({ generate: gen(START(), tok('давт давт давт '), DONE({ stop_reason: 'repetition', repetition: { cycle_words: 1, repeats: 6 } })) }));
  expectParity(r, 'P10');
  assert.equal(r.neu.result.error?.code, 'GENERATION_REPETITION');
});

/* 11 */
test('P11 засварласан хариулт (grounded гэрээ, зохиомол тоо хасагдана → contractDiag.final=repaired)', async () => {
  const r = await differential(() => ({
    plan: () => jsonResponse({ ...DEFAULT_PLAN, intent: 'COMPANY_FACT', tools: [{ name: 'list_projects', args: {} }] }),
    tool: () => jsonResponse({ ok: true, tool: 'list_projects', data: { active_count: 24, total_visible: 31, projects: [] } }),
    context: () => jsonResponse(contextResponse({ intent: 'COMPANY_FACT', tool_results_used: ['list_projects'], trusted_contract: { version: 'tfc-1', answerMode: 'grounded', risk: 'medium', facts: [{ id: 'f1', kind: 'number', value: 24, labelMn: 'идэвхтэй төсөл', labelEn: 'active projects', authority: 'erp_tool', mustMention: true }], allowedNumbers: [24, 31], allowedCategories: null, requiredSentence: null, trailerText: null, requiredCitations: [], noMatch: false, forbiddenPhrases: [], template: 'Идэвхтэй төсөл: 24.', taskIndex: null, legacyKind: 'grounded', reason: 'test' } })),
    generate: gen(START(), tok('Одоо 24 идэвхтэй төсөл байна. '), tok('Компани 2025 онд яг 481 төсөл хийсэн.'), DONE()),
  }));
  expectParity(r, 'P11');
  assert.equal(r.neu.result.contractDiag?.final, 'repaired');
  assert.ok(r.neu.result.answer.includes('24') && !r.neu.result.answer.includes('481'));
});

/* 12 */
test('P12 хүний хяналт шаардлагатай (tfc-2 norm.verification=needs_human_review → детерминист template)', async () => {
  const r = await differential(() => ({
    plan: () => jsonResponse(NORM_PLAN),
    norm: () => jsonResponse({ ...NORM_ANSWER, status: 'uncertain' }),
    context: () => jsonResponse(contextResponse({
      regulatory: true, intent: 'NORMATIVE', evidence_required: true, verification_states: ['needs_human_review'],
      trusted_contract: {
        version: 'tfc-2', answerMode: 'refusal', risk: 'high', facts: [], allowedNumbers: [], allowedCategories: null,
        requiredSentence: 'Энэ заалтын хүчин төгөлдөр байдлыг хүн шалгах шаардлагатай.', trailerText: null, requiredCitations: [], noMatch: false, forbiddenPhrases: ['шаардлага хангаж байна'],
        template: 'Энэ заалтын хүчин төгөлдөр байдлыг хүн шалгах шаардлагатай. Эх сурвалж: БНбД 31-01-00, заалт 5.2.', taskIndex: null, legacyKind: 'norm_human_review', reason: 'needs_human_review',
        norm: { verification: 'needs_human_review', authoritative: false, answerKind: 'lookup', document: 'БНбД 31-01-00', documentAliases: [], resultValue: null, resultUnit: null, initialCategory: null, finalCategory: null, requiredFollowups: [], maskTokens: [], citationLabels: ['БНбД 31-01-00, заалт 5.2'], currentnessNote: null, template: 'Энэ заалтын хүчин төгөлдөр байдлыг хүн шалгах шаардлагатай. Эх сурвалж: БНбД 31-01-00, заалт 5.2.' },
      },
    })),
    generate: gen(START(), tok('Тийм, коридор 1.2 м бол шаардлага хангаж байна, баттай.'), DONE()),
  }));
  expectParity(r, 'P12');
  assert.ok(r.neu.result.answer.includes('хүн шалгах шаардлагатай'));
  assert.ok(!r.neu.result.answer.includes('шаардлага хангаж байна'));
  assert.notEqual(r.neu.result.contractDiag?.final, 'model');
});

/* 13 */
const MEM = (id, type, value, text) => ({ id, type, value, text, label: text, importance: 2, confidence: 0.9, createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: '2026-09-10T00:00:00.000Z', lastConfirmedAt: '2026-09-01T00:00:00.000Z', expiresAt: null, useCount: 3 });
test('P13 ярианы санамж + үргэлжлэл (memories → local_memory, memory_hints, conv_state_next, FOLLOW_UP notice)', async () => {
  const followUp = { kind: 'FOLLOW_UP', reason: 'тест', subject: { kind: 'project', id: 30, name: 'Сургууль' }, history_messages: 2, tasks: [{ text: 'x', intent: 'ERP_ANALYSIS', domain: 'erp' }] };
  const r = await differential(() => ({
    plan: () => jsonResponse({ ...DEFAULT_PLAN, intent: 'ERP_ANALYSIS', turn: followUp, memory_hints: [{ type: 'answer_length', value: 'short', text: 'богино хариулт', label: 'Богино', reason: 'ил хүсэлт' }] }),
    context: () => jsonResponse(contextResponse({ intent: 'ERP_ANALYSIS', turn: followUp, conv_state_next: { version: 1, subject: { kind: 'project', id: 30, name: 'Сургууль' }, lastIntent: 'ERP_ANALYSIS', lastTools: ['analyze_project'], projectsSeen: [30], turnsSinceSubject: 0 } })),
    generate: gen(START(), tok('Удаашралын шалтгаан: батлагдаагүй даалгавар.'), DONE()),
  }), {
    question: 'Яагаад удаад байна?',
    history: [{ role: 'user', content: 'Сургууль төслийн deadline?' }, { role: 'assistant', content: '2026-10-01.' }],
    convState: { version: 1, subject: { kind: 'project', id: 30, name: 'Сургууль' }, lastIntent: 'COMPANY_FACT', lastTools: ['list_projects'], projectsSeen: [30], turnsSinceSubject: 1 },
    memories: [MEM('m1', 'answer_length', 'short', 'богино хариулт өг'), MEM('m2', 'terminology', 'ЗТАҮ', 'ЗТАҮ = зураг төслийн ажлын үнэ')],
  });
  expectParity(r, 'P13');
  assert.deepEqual(r.neu.result.usedMemoryIds, ['m1']);
  assert.equal(r.neu.result.memoryHints.length, 1);
  assert.equal(r.neu.result.convStateNext?.subject?.id, 30);
  const ctx = r.neu.calls.find((c) => c.url.includes('/mgl-ai/context'));
  assert.equal(ctx?.body?.local_memory?.length, 1);
  assert.ok(r.neu.events.some((e) => e.type === 'turn.interpreted' && String(e.safeUserMessage).includes('Өмнөх сэдвийг')));
});

/* 14 */
test('P14 Revit контекст БАЙХГҮЙ (surface өгөгдмөл) → хөтөчтэй байт-ижил, revit_context талбар ИЛГЭЭГДЭХГҮЙ', async () => {
  const r = await differential(() => ({ generate: gen(START(), tok('x'), DONE()) }));
  expectParity(r, 'P14');
  const ctx = r.neu.calls.find((c) => c.url.includes('/mgl-ai/context'));
  assert.ok(!('revit_context' in (ctx?.body ?? {})));
  assert.equal(r.neu.calls.find((c) => c.url.includes('/mgl-ai/conversations'))?.body?.surface, 'web');
});

/* 15 */
test('P15 Revit контекст БАЙГАА (surface=revit) → үр дүн/үйл явдал ижил; зөвхөн INTENTIONAL-1/2 утсан зөрүү', async () => {
  const revit = { schema: 1, document: { title: 'test.rvt', is_test_fixture: true }, selection: [{ id: 101, category: 'Walls', name: 'wall.exterior.north' }] };
  const r = await differential(() => ({ generate: gen(START(), tok('Энэ бол хана.'), DONE()) }), { surface: 'revit', revitContext: revit }, {
    intentional: (d) => /^(browser|runtime)\.calls\.\d+\.body\.surface: "web" ≠ "revit"$/.test(d) || /^(browser|runtime)\.calls\.\d+\.body\.revit_context: undefined ≠ /.test(d) || /^(browser|runtime)\.calls\.\d+\.body\.revit_selection: undefined ≠ 1$/.test(d),
  });
  expectParity(r, 'P15');
  // Зөвхөн ЭНЭ кейсийн зориудын зөрүүг тоолно — GLOBAL_INTENTIONAL (cacheKeys, norm_catalog, contract_diag.legacy)
  //    нь кейс бүрд байдаг, `expectParity` тэднийг аль хэдийн ялгасан (2026-09-18, INTENTIONAL-5).
  const local = r.diffs.filter((d) => /\.body\.(surface|revit_context|revit_selection): /.test(d));
  assert.equal(local.length, 6, `яг 3 зориудын зөрүү × 2 зам, олдсон: ${r.diffs.join(' | ')}`);
  assert.equal(r.neu.calls.find((c) => c.url.includes('/mgl-ai/plan'))?.body?.revit_selection, 1);
  assert.deepEqual(r.neu.calls.find((c) => c.url.includes('/mgl-ai/context'))?.body?.revit_context, revit);
  assert.equal(r.neu.calls.find((c) => c.url.includes('/mgl-ai/conversations'))?.body?.surface, 'revit');
});
