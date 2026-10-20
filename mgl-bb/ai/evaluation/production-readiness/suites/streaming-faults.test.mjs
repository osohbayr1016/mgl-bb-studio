/**
 * MGL AI · STREAMING / ERROR-SEMANTICS FAULT SUITE (Session C, 2026-09-11).
 *
 *   node --test ai/evaluation/production-readiness/suites/streaming-faults.test.mjs
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ.  Хөтчийн `orchestrator.runTurn`-ыг ХУУРАМЧ
 *    сүлжээгээр (fakeWire) ажиллуулж, урсгал/сүлжээний 13 гэмтэлд:
 *      · дутуу хариулт «бүрэн» мэт харагдахгүй, ХАДГАЛАГДАХГҮЙ (GAP-008);
 *      · runtime-ийн 413/503 тайлбар хаягдахгүй (GAP-009);
 *      · алдааны код ҮЕ ШАТ + СТАТУСААР ялгаатай (GAP-010, мандат §18):
 *        401 ≠ 403, backend offline ≠ retrieval timeout, 503 ≠ network;
 *      · гажуудсан фрейм / давхар done унагахгүй; цуцлалт = CANCELLED.
 *
 *    Хэмжигдсэн (2026-09-11, засварын ӨМНӨ): 2/3/13 → stop=null, error=null,
 *    persisted=1; 4/5 → «Локал MGL AI алдаа: 413»; 8 → PERMISSION_DENIED;
 *    10 → RETRIEVAL_TIMEOUT.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeWire, runFakeTurn, sse, sseResponse, jsonResponse, contextResponse, DEFAULT_PLAN } from '../lib/fakeWire.mjs';
import { loadFrontend } from '../lib/load.mjs';

const { isInvalidAnswer } = await import('@mgl/mglai-common/turn');
const tok = (t) => sse('token', { text: t });
const DONE = (over = {}) => sse('done', { stop_reason: 'stop', first_token_ms: 5, total_ms: 20, engine: 'llama.cpp', runtime_variant: 'employee-4b-q4', ...over });

async function run(routes, opts = {}) {
  const wire = installFakeWire(routes);
  try {
    const out = await runFakeTurn(opts.input ?? {});
    const persisted = wire.calls.filter((c) => c.url.includes('/mgl-ai/messages') && c.body?.role === 'assistant').length;
    return { ...out, calls: wire.calls, persisted };
  } finally {
    wire.restore();
  }
}

test('1 хэвийн урсгал → бүрэн хариулт, stop=stop, error null, ХАДГАЛАГДАНА', async () => {
  const { result, persisted } = await run({ generate: () => sseResponse([sse('start', {}), tok('Сайн '), tok('байна.'), DONE()]) });
  assert.equal(result.answer, 'Сайн байна.');
  assert.equal(result.stopReason, 'stop');
  assert.equal(result.error, null);
  assert.equal(persisted, 1);
});

test('2 runtime урсгал дунд УНАВ (сүлжээ тасрав) → interrupted, GENERATION_INTERRUPTED (notice), хадгалагдахгүй', async () => {
  const { result, persisted } = await run({ generate: () => sseResponse([sse('start', {}), tok('Хариулт '), tok('эхэлж ')], { failAfter: 3 }) });
  assert.equal(result.stopReason, 'interrupted');
  assert.equal(result.error?.code, 'GENERATION_INTERRUPTED');
  assert.equal(result.error?.severity, 'notice');
  assert.equal(result.error?.action, 'retry_generation');
  assert.equal(persisted, 0, 'дутуу хариулт хадгалагдсан');
  assert.ok(result.answer.length > 0, 'дутуу текст хэрэглэгчид харагдана (устгахгүй)');
  assert.equal(isInvalidAnswer(result.error), true, 'дараагийн түүхэд орох ёсгүй');
});

test('3 урсгал `done`-гүй цэвэр хаагдав → interrupted, хадгалагдахгүй', async () => {
  const { result, persisted } = await run({ generate: () => sseResponse([sse('start', {}), tok('Хагас '), tok('хариулт')]) });
  assert.equal(result.stopReason, 'interrupted');
  assert.equal(result.error?.code, 'GENERATION_INTERRUPTED');
  assert.equal(persisted, 0);
});

test('4 runtime 413 context_overflow → CONTEXT_OVERFLOW (notice), runtime-ийн тайлбар алдагдахгүй', async () => {
  const { result, persisted } = await run({ generate: () => jsonResponse({ error: 'Асуулт болон нотолгоо нь контекстын цонхонд багтахгүй байна.', code: 'context_overflow' }, 413) });
  assert.equal(result.error?.code, 'CONTEXT_OVERFLOW');
  assert.equal(result.error?.severity, 'notice');
  assert.ok(!result.error?.message.includes('413'), 'статусын тоо хэрэглэгчид гарсан');
  assert.equal(persisted, 0);
});

test('5 runtime 503 (загвар суулгаагүй) → MODEL_NOT_READY, серверийн мессежтэй', async () => {
  const { result } = await run({ generate: () => jsonResponse({ error: 'Загвар суулгаагүй.', code: 'model_not_ready' }, 503) });
  assert.equal(result.error?.code, 'MODEL_NOT_READY');
  assert.equal(result.error?.message, 'Загвар суулгаагүй.');
});

test('6 гажуудсан фрейм + давхар done → унахгүй, хариулт бүрэн, stop=stop', async () => {
  const { result } = await run({ generate: () => sseResponse([sse('start', {}), tok('А'), new TextEncoder().encode('event: token\ndata: {broken\n\n'), tok('Б'), DONE(), DONE()]) });
  assert.equal(result.answer, 'АБ');
  assert.equal(result.stopReason, 'stop');
  assert.equal(result.error, null);
});

test('7 runtime огт хүрэхгүй (fetch throws) → LOCAL_RUNTIME_OFFLINE (offline, start_runtime)', async () => {
  const { result } = await run({ generate: () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(result.error?.code, 'LOCAL_RUNTIME_OFFLINE');
  assert.equal(result.error?.severity, 'offline');
  assert.equal(result.error?.action, 'start_runtime');
});

test('8 backend /plan 401 → AUTH_EXPIRED (PERMISSION_DENIED БИШ)', async () => {
  const { result, events } = await run({ plan: () => jsonResponse({ error: 'Unauthorized' }, 401) });
  assert.equal(result.error?.code, 'AUTH_EXPIRED');
  assert.equal(events.find((e) => e.type === 'failed')?.code, 'AUTH_EXPIRED');
});

test('8b backend /plan 403 → PERMISSION_DENIED хэвээр', async () => {
  const { result } = await run({ plan: () => jsonResponse({ error: 'Эрхгүй.' }, 403) });
  assert.equal(result.error?.code, 'PERMISSION_DENIED');
});

test('9 backend /context 503 mglai_disabled → SERVICE_UNAVAILABLE (notice), серверийн мессеж', async () => {
  const { result } = await run({ context: () => jsonResponse({ error: 'MGL AI түр зогсоосон байна.', code: 'mglai_disabled' }, 503) });
  assert.equal(result.error?.code, 'SERVICE_UNAVAILABLE');
  assert.equal(result.error?.message, 'MGL AI түр зогсоосон байна.');
  assert.equal(result.error?.severity, 'notice');
});

test('10 backend /plan сүлжээний алдаа → BACKEND_OFFLINE (RETRIEVAL_TIMEOUT БИШ)', async () => {
  const { result } = await run({ plan: () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(result.error?.code, 'BACKEND_OFFLINE');
  assert.notEqual(result.error?.message, 'Эх сурвалжийн хайлт хугацаанд дууссангүй.');
});

test('10b backend /context сүлжээний алдаа → BACKEND_OFFLINE', async () => {
  const { result } = await run({ context: () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(result.error?.code, 'BACKEND_OFFLINE');
});

test('11 repetition → GENERATION_REPETITION, хадгалагдахгүй, түүхэд орохгүй', async () => {
  const { result, persisted } = await run({ generate: () => sseResponse([sse('start', {}), tok('давт давт '), DONE({ stop_reason: 'repetition', repetition: { cycle_words: 1, repeats: 6 } })]) });
  assert.equal(result.error?.code, 'GENERATION_REPETITION');
  assert.equal(persisted, 0);
  assert.equal(isInvalidAnswer(result.error), true);
});

test('12 timeout → GENERATION_TIMEOUT, хадгалагдахгүй', async () => {
  const { result, persisted } = await run({ generate: () => sseResponse([sse('start', {}), tok('удаан '), DONE({ stop_reason: 'timeout' })]) });
  assert.equal(result.error?.code, 'GENERATION_TIMEOUT');
  assert.equal(persisted, 0);
});

test('13 `error` фрейм ирээд урсгал хаагдав → interrupted, runtime-ийн мессеж hint-д', async () => {
  const { result, persisted } = await run({ generate: () => sseResponse([sse('start', {}), tok('А '), sse('error', { message: 'llama-server exited' })]) });
  assert.equal(result.stopReason, 'interrupted');
  assert.equal(result.error?.code, 'GENERATION_INTERRUPTED');
  assert.ok(result.error?.hint?.includes('llama-server exited'));
  assert.equal(persisted, 0);
});

test('14 хэрэглэгч ЦУЦЛАВ (abort дунд) → CANCELLED, дутуу текст хадгалагдахгүй', async () => {
  const wire = installFakeWire({
    generate: () => sseResponse([sse('start', {}), tok('А '), tok('Б '), tok('В ')], { delayMs: 30 }),
  });
  try {
    const { loadFrontend } = await import('../lib/load.mjs');
    const { runTurn } = await loadFrontend('browserTurn.ts');
    const ctrl = new AbortController();
    const events = [];
    const p = runTurn({
      question: 'x', convUid: 'c', userMsgUid: 'u', aiMsgUid: 'a', seq: 0, history: [], convState: null, memories: [],
      runtime: { installed: true, authorized: true, info: {} }, mode: 'employee', signal: ctrl.signal, emit: (e) => events.push(e),
    });
    setTimeout(() => ctrl.abort(), 60);
    const result = await p;
    assert.equal(result.error?.code, 'CANCELLED');
    const persisted = wire.calls.filter((c) => c.url.includes('/mgl-ai/messages') && c.body?.role === 'assistant').length;
    assert.equal(persisted, 0);
  } finally {
    wire.restore();
  }
});

test('15 runtime суулгаагүй (probe not_running) → retrieval-only хариулт + LOCAL_RUNTIME_OFFLINE, /generate дуудагдахгүй', async () => {
  const { result, calls } = await run({}, { input: { runtime: { installed: false, reason: 'not_running' } } });
  assert.equal(result.error?.code, 'LOCAL_RUNTIME_OFFLINE');
  assert.equal(result.engine, 'retrieval-only');
  assert.ok(!calls.some((c) => c.url.includes('/generate')));
});

test('16 хэрэгслийн алдаа ээлжийг УНАГААХГҮЙ — /tool 500 → ok:false, context дуудагдана', async () => {
  const { result, calls } = await run({
    plan: () => jsonResponse({ ...structuredClone(DEFAULT_PLAN), intent: 'COMPANY_FACT', tools: [{ name: 'list_projects', args: {} }] }),
    tool: () => jsonResponse({ ok: false, error: 'Хэрэгсэл ажиллахад алдаа гарлаа.', code: 'exception' }, 500),
    generate: () => sseResponse([sse('start', {}), tok('Хариулт'), DONE()]),
  });
  const ctxCall = calls.find((c) => c.url.includes('/mgl-ai/context'));
  assert.ok(ctxCall, '/context дуудагдаагүй');
  assert.equal(ctxCall.body.tool_results.length, 1);
  assert.equal(ctxCall.body.tool_results[0].ok, false);
  assert.equal(result.error, null);
});

/* ── L1 БАРИМТ ОЛОХ — ДЕТЕРМИНИСТ Л (2026-09-18) ─────────────────────────────── */
test('17 norm_documents (templateOnly) → /generate ДУУДАГДАХГҮЙ, хариулт = template + трейлер ЯГ НЭГ удаа, «эх сурвалж олдсонгүй» notice ҮГҮЙ, contract_diag legacy/final', async () => {
  const template = [
    '**Олдсон холбогдох баримт: 2** (MCIS-хүчинтэй 1 · шалгагдаагүй 1)',
    '',
    '| № | Код | Нэр | Төлөв | Холбоос |',
    '|---|---|---|---|---|',
    '| 1 | **БНбД 23-02-08** | Байгалийн ба зохиомол гэрэлтүүлэг | MCIS-хүчинтэй | [MCIS PDF](https://mcis.gov.mn/storage/x.pdf) |',
    '| 2 | **БД 31-110-11** | Орон сууцны гэрэлтүүлэг | ШАЛГАГДААГҮЙ | [Бүртгэл х.41](https://www1.gazar.gov.mn/a.pdf#page=41) |',
    '',
    'Төлөвийн тайлбар: …',
  ].join(String.fromCharCode(10));
  const trailer = 'Анхаарах нь: эдгээрийн 1 нь 2025 оны бүртгэлийн жагсаалтаас бөгөөд одоогийн хүчин төгөлдөр байдал нь шалгагдаагүй.';
  let generated = 0;
  const { result, calls, persisted } = await run({
    plan: () => jsonResponse({ ...structuredClone(DEFAULT_PLAN), intent: 'NORMATIVE', regulatory: true, evidence_required: true, needs_retrieval: true, show_confidence: true }),
    context: () => jsonResponse(contextResponse({
      regulatory: true, evidence_required: true, show_confidence: true, intent: 'NORMATIVE',
      trusted_contract: {
        version: 'tfc-1', answerMode: 'grounded', risk: 'medium',
        facts: [{ id: 'norm_doc_0', kind: 'text', value: 'БНбД 23-02-08', labelMn: 'Норм', labelEn: 'Norm', authority: 'retrieval', mustMention: true }],
        allowedNumbers: [2, 1, 23, 8, 31, 110, 11, 41, 2025], allowedCategories: null, requiredSentence: null, trailerText: trailer, requiredCitations: [],
        noMatch: false, forbiddenPhrases: [], template, templateOnly: true, taskIndex: null, legacyKind: 'norm_documents', reason: 'test', norm: null,
      },
    })),
    generate: () => { generated += 1; return sseResponse([sse('start', {}), tok('ЗАГВАРЫН ЗОХИОМОЛ'), DONE()]); },
  });
  assert.equal(generated, 0, '/generate дуудагдав — жагсаалт детерминист байх ёстой');
  assert.equal(result.stopReason, 'template');
  assert.equal(result.error, null, `notice гарав: ${result.error?.code}`);
  assert.ok(result.answer.startsWith('**Олдсон холбогдох баримт: 2**'));
  assert.ok(result.answer.includes('[Бүртгэл х.41](https://www1.gazar.gov.mn/a.pdf#page=41)'), 'холбоос алга');
  assert.equal((result.answer.match(/Анхаарах нь:/g) ?? []).length, 1, 'трейлер давхардав');
  assert.ok(!result.answer.includes('ЗАГВАРЫН ЗОХИОМОЛ'));
  assert.equal(persisted, 1);
  const msg = calls.find((c) => c.url.includes('/mgl-ai/messages') && c.body?.role === 'assistant');
  assert.equal(msg.body.contract_diag.final, 'template');
  assert.equal(msg.body.contract_diag.legacy, 'norm_documents');
});
