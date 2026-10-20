/**
 * MGL AI · УРСГАЛЫН РЕГРЕСС ШАЛГАЛТ (§33).
 *
 *   node scripts/check-ai-stream.mjs        (frontend/ хавтаснаас)
 *
 * ── Яагаад ЭНЭ хэлбэрээр вэ? ───────────────────────────────────────────────
 * Репод frontend тест байхгүй (CLAUDE.md) тул `check-quote-notes.mjs`-ийн
 * жишгээр гараар ажиллуулдаг шалгагч болгов — vitest суулгах шаардлага
 * үүсгэхгүй.  `registerHooks` нь өргөтгөлгүй импортыг шийднэ.
 *
 * ── ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ ──────────────────────────────────────────────
 * Энэ файлын оршин байх шалтгаан нь НЭГ УДААГИЙН БОДИТ АЛДАА: чат нь
 * `/context` дээр `timeoutMs: 20_000` тавьсан тул worker-ийн хүйтэн эхлэлт
 * (баримтжуулсан 9-20 сек) дээр УЛААН «Сервер 20 секундэд хариу өгсөнгүй»
 * гэж унадаг байв.  Тиймээс энд хамгаалагдах гол инвариант нь:
 *
 *      ТҮР ЗУУРЫН УДААШРАЛ ≠ ҮХЛИЙН АЛДАА
 *
 * Мөн §17-ийн ялгаа: «олдсонгүй» ≠ «хайлт унасан» ≠ «хайлт үргэлжилж байна».
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

const M = await import('@mgl/mglai-common/turn');
// aiEvents · aiErrors · aiBudget — бүгд багцын нэг барилаас (Session R, R3: хөтчийн хуулбар устсан).
const E = M;
const X = M;
const O = M;

const { emptyRun, reduce, isRunning, summarize } = M;
const { STAGE_LABEL, SLOW_NOTICE } = E;
const { classifyError, aiError } = X;

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
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

/** Үйл явдлын жагсаалтыг цувуулж эцсийн төлөвийг гаргана. */
function play(events, start = emptyRun('req_test')) {
  return events.reduce((run, e) => reduce(run, e), start);
}

let clock = 0;
const ev = (type, extra = {}) => ({
  requestId: 'req_test',
  atMs: (clock += 10),
  type,
  ...extra,
});

console.log('MGL AI · урсгалын шалгалт\n');

/* ================================================================== */
console.log('1. Хүлээн авах ба алхмын дараалал');
/* ================================================================== */

scenario('request.accepted нь ШУУД ACKNOWLEDGED болгоно (§2)', () => {
  const run = play([ev('request.accepted', { stage: 'accept', durationMs: 3 })]);
  assert.equal(run.state, 'ACKNOWLEDGED');
  assert.equal(run.steps.length, 1);
  assert.equal(run.steps[0].status, 'done');
  assert.ok(isRunning(run.state), 'хүлээн авсан нь «ажиллаж байна» гэсэн үг');
});

scenario('үе шат эхлэх → дуусах нь НЭГ мөр үлдээнэ, хоёр биш', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'plan' }),
    ev('stage.completed', { stage: 'plan', durationMs: 5 }),
  ]);
  const plan = run.steps.filter((s) => s.stage === 'plan');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].status, 'done');
  assert.equal(plan[0].durationMs, 5);
  assert.equal(plan[0].label, STAGE_LABEL.plan.done, 'дууссан алхам ҮРГЭЛЖИЛСЭН хэлбэрээр үлдэж болохгүй');
});

scenario('үе шатны дараалал хадгалагдана (§4-ийн урсгал)', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'plan' }),
    ev('stage.completed', { stage: 'plan' }),
    ev('stage.started', { stage: 'norm_retrieval' }),
    ev('stage.completed', { stage: 'norm_retrieval' }),
    ev('stage.started', { stage: 'context' }),
    ev('stage.completed', { stage: 'context' }),
    ev('stage.started', { stage: 'generation' }),
  ]);
  assert.deepEqual(
    run.steps.map((s) => s.stage),
    ['accept', 'plan', 'norm_retrieval', 'context', 'generation'],
  );
});

/* ================================================================== */
console.log('\n2. Курсор нь ҮНЭХЭЭР үүсгэж байхыг илэрхийлнэ (§8)');
/* ================================================================== */

scenario('хайлтын үед generationStarted нь FALSE', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'norm_retrieval' }),
  ]);
  assert.equal(run.generationStarted, false, 'хайж байхад курсор гарах ЁСГҮЙ');
  assert.equal(run.answer, '');
});

scenario('generation.started ирсний ДАРАА Л курсор асна', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
  ]);
  assert.equal(run.generationStarted, true);
  assert.equal(run.state, 'GENERATING');
});

/* ================================================================== */
console.log('\n3. Токен урсгал');
/* ================================================================== */

scenario('токенууд дарааллаараа нийлнэ, эхний токены хугацаа бичигдэнэ', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'Барилгын ' }),
    ev('token', { stage: 'generation', text: 'норм ' }),
    ev('token', { stage: 'generation', text: 'дүрэм.' }),
  ]);
  assert.equal(run.answer, 'Барилгын норм дүрэм.');
  assert.ok(run.firstTokenMs > 0, 'эхний токены хугацаа хэмжигдээгүй');
});

scenario('completed нь ажиллаж буй бүх алхмыг хаана', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'сайн' }),
    ev('completed', {}),
  ]);
  assert.equal(run.state, 'COMPLETED');
  assert.equal(run.steps.every((s) => s.status !== 'running'), true);
  assert.equal(isRunning(run.state), false);
});

/* ================================================================== */
console.log('\n4. ЦОХИЛТ — амьд эсэх (§10)');
/* ================================================================== */

scenario('цохилт нь ШИНЭ МӨР НЭМЭХГҮЙ', () => {
  const before = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'generation' }),
  ]);
  const after = reduce(before, ev('heartbeat', { stage: 'generation' }));
  assert.equal(after.steps.length, before.steps.length, 'цохилт мөр нэмсэн');
  assert.ok(after.lastHeartbeatMs > 0, 'цохилтын цаг бүртгэгдээгүй');
});

scenario('цохилт ирэхгүй → RECONNECTING, мессеж УСТАХГҮЙ (§23)', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'хагас хариу' }),
    ev('warning', { stage: 'generation', metadata: { connection: 'lost' } }),
  ]);
  assert.equal(run.state, 'RECONNECTING');
  assert.equal(run.answer, 'хагас хариу', 'сэргээх үед хариу УСТАХ ЁСГҮЙ');
  assert.ok(isRunning(run.state), 'сэргээж байгаа нь ажиллаж байна гэсэн үг');
});

scenario('цохилт эргэж ирэхэд GENERATING руу буцна', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ev('warning', { stage: 'generation', metadata: { connection: 'lost' } }),
    ev('heartbeat', { stage: 'generation' }),
  ]);
  assert.equal(run.state, 'GENERATING');
});

/* ================================================================== */
console.log('\n5. УДААШРАЛ ≠ АЛДАА (§9, §11) — гол регресс');
/* ================================================================== */

scenario('stage.slow нь АЖИЛЛАЖ БАЙГАА төлөвийг ХЭВЭЭР үлдээнэ', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'norm_retrieval' }),
    ev('stage.slow', { stage: 'norm_retrieval', safeUserMessage: SLOW_NOTICE.norm_retrieval }),
  ]);
  assert.equal(run.state, 'RETRIEVING', 'удаашрал нь төлөвийг ЭВДЭХ ЁСГҮЙ');
  assert.equal(run.error, null, 'удаашрал нь АЛДАА болох ЁСГҮЙ');
  assert.equal(run.steps.at(-1).status, 'running');
  assert.equal(run.steps.at(-1).slowNotice, SLOW_NOTICE.norm_retrieval);
});

scenario('удаан алхам ЭЦЭСТЭЭ амжилттай дуусахад тэмдэглэгээ АРИЛНА', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'context' }),
    ev('stage.slow', { stage: 'context', safeUserMessage: SLOW_NOTICE.context }),
    ev('stage.completed', { stage: 'context', durationMs: 21_000 }),
  ]);
  const step = run.steps.at(-1);
  assert.equal(step.status, 'done');
  assert.equal(step.slowNotice, null, 'дууссаны дараа удаашралын мөр үлдсэн');
  assert.equal(run.error, null);
});

scenario('21 СЕКУНД үргэлжилсэн ээлж БҮТЭЛГҮЙТЭХГҮЙ (хуучин 20с алдааны регресс)', () => {
  // ⚠️ Хуучин код яг энд «Сервер 20 секундэд хариу өгсөнгүй» гэж УНАДАГ байв.
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'context' }),
    ev('stage.slow', { stage: 'context', safeUserMessage: SLOW_NOTICE.context }),
    ev('stage.completed', { stage: 'context', durationMs: 21_000 }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'Хариулт' }),
    ev('completed', {}),
  ]);
  assert.equal(run.state, 'COMPLETED');
  assert.equal(run.answer, 'Хариулт');
  assert.notEqual(run.state, 'FAILED');
});

/* ================================================================== */
console.log('\n6. ЭХ СУРВАЛЖ (§17, §18)');
/* ================================================================== */

const NORM_SOURCE = {
  id: 'local:UBB-12-01-01-2001:clause:2.5',
  document: 'УББ 12-01-01',
  clause: '2.5',
  page: 6,
  title: 'УББ 12-01-01, Хоёр. Захиалагчийн үүрэг, заалт 2.5, хуудас 6',
  origin: 'local-norm',
};

scenario('нормын эх сурвалж бүртгэгдэнэ', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('source.found', { stage: 'norm_retrieval', source: NORM_SOURCE }),
  ]);
  assert.equal(run.sources.length, 1);
  assert.equal(run.sources[0].document, 'УББ 12-01-01');
  assert.equal(run.sources[0].page, 6);
});

scenario('ижил эх сурвалж ХОЁР ХӨЛӨӨС ирвэл НЭГ Л удаа', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('source.found', { stage: 'norm_retrieval', source: NORM_SOURCE }),
    ev('source.found', { stage: 'context', source: NORM_SOURCE }),
  ]);
  assert.equal(run.sources.length, 1, 'давхардсан эх сурвалж хоёр удаа орсон');
});

scenario('хуудасгүй эх сурвалжид хуудас ЗОХИОХГҮЙ (§6)', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('source.found', {
      stage: 'context',
      source: { ...NORM_SOURCE, id: 'x', page: null, clause: null },
    }),
  ]);
  assert.equal(run.sources[0].page, null);
  assert.equal(run.sources[0].clause, null);
});

/* ================================================================== */
console.log('\n7. ЦУЦЛАЛТ (§22) ба ДУТУУ ХАРИУЛТ (§24)');
/* ================================================================== */

scenario('үүсгэлт дундуур цуцлахад хариулт ДУТУУ гэж тэмдэглэгдэнэ', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'generation' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'Хагас өгүүлб' }),
    ev('cancelled', {}),
  ]);
  assert.equal(run.state, 'CANCELLED');
  assert.equal(run.incomplete, true, 'дутуу хариулт тэмдэглэгдээгүй (§24)');
  assert.equal(run.answer, 'Хагас өгүүлб', 'цуцлахад бичигдсэн хэсэг УСТАХ ЁСГҮЙ');
  assert.equal(isRunning(run.state), false);
});

scenario('үүсгэлт ЭХЛЭЭГҮЙ байхад цуцалбал ДУТУУ гэж тэмдэглэгдэхгүй', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'norm_retrieval' }),
    ev('cancelled', {}),
  ]);
  assert.equal(run.incomplete, false);
  assert.equal(run.steps.at(-1).status, 'skipped');
});

/* ================================================================== */
console.log('\n8. АЛДААНЫ АНГИЛАЛ (§20)');
/* ================================================================== */

scenario('ҮЕ ШАТ нь timeout-ийн УТГЫГ шийднэ', () => {
  const timeout = { name: 'ApiNetworkError', timedOut: true };
  assert.equal(classifyError(timeout, 'tools').code, 'ERP_TIMEOUT');
  assert.equal(classifyError(timeout, 'norm_retrieval').code, 'RETRIEVAL_TIMEOUT');
  assert.equal(classifyError(timeout, 'context').code, 'RETRIEVAL_TIMEOUT');
  assert.equal(classifyError(timeout, 'plan').code, 'NETWORK_ERROR');
});

scenario('«олдсонгүй» ба «хайлт унасан» нь ӨӨР код (§17)', () => {
  assert.notEqual(aiError('RETRIEVAL_NO_MATCH').code, aiError('RETRIEVAL_TIMEOUT').code);
  assert.notEqual(aiError('RETRIEVAL_NO_MATCH').message, aiError('RETRIEVAL_TIMEOUT').message);
});

scenario('нотолгоо олдоогүй нь УЛААН БИШ (§20)', () => {
  assert.equal(aiError('NORM_EVIDENCE_MISSING').severity, 'notice');
  assert.equal(aiError('RETRIEVAL_NO_MATCH').severity, 'notice');
  assert.equal(aiError('RETRIEVAL_TIMEOUT').severity, 'notice');
  assert.equal(aiError('CANCELLED').severity, 'notice');
  assert.equal(aiError('ERP_TIMEOUT').severity, 'notice');
});

scenario('локал runtime унтарсан нь үйлдэлтэй заавар өгнө', () => {
  const e = aiError('LOCAL_RUNTIME_OFFLINE');
  assert.equal(e.severity, 'offline');
  assert.equal(e.action, 'start_runtime');
  assert.ok(e.hint.length > 0);
});

scenario('ЖИНХЭНЭ гэмтэл нь улаан хэвээр (§8-ийн «бодит алдаа харагдана»)', () => {
  assert.equal(aiError('MODEL_ERROR').severity, 'error');
  assert.equal(aiError('GENERATION_FAILED').severity, 'error');
  assert.equal(aiError('PERMISSION_DENIED').severity, 'error');
  assert.equal(aiError('NETWORK_ERROR').severity, 'error');
});

scenario('цуцлалт нь алдаа гэж ангилагдахгүй', () => {
  assert.equal(classifyError({ name: 'AbortError' }, 'generation').code, 'CANCELLED');
});

scenario('403 нь эрхийн алдаа, сүлжээнийх БИШ', () => {
  assert.equal(classifyError({ status: 403 }, 'tools').code, 'PERMISSION_DENIED');
});

scenario('ХАТУУ ХЯЗГААР нь ЦУЦЛАЛТ гэж уншигдахгүй (StageTimeoutError)', () => {
  // ⚠️ Хоёулаа AbortSignal-аар хэрэгждэг тул ялгахгүй бол хэрэглэгч юу ч
  //    дараагүй атлаа «Зогсоолоо» гэсэн мессеж авна.
  const timeout = new O.StageTimeoutError('norm_retrieval', 15_000);
  assert.equal(timeout.name, 'ApiNetworkError');
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.stage, 'norm_retrieval');
  const shaped = classifyError(timeout, timeout.stage);
  assert.equal(shaped.code, 'RETRIEVAL_TIMEOUT');
  assert.notEqual(shaped.code, 'CANCELLED');
  assert.equal(shaped.severity, 'notice', 'хугацаа дуусах нь УЛААН байх ЁСГҮЙ');
});

scenario('үе шат бүр өөрийн ХУГАЦААНЫ ТӨСӨВТЭЙ, глобал таймер БАЙХГҮЙ (§9)', () => {
  const b = O.STAGE_BUDGET;
  // ⚠️ Хуучин архитектурын ганц 20 сек нь ЭНД БАЙХ ЁСГҮЙ.
  assert.ok(b.context.hardMs > 20_000, 'context нь хуучин 20с хязгаартаа буцжээ');
  assert.ok(b.plan.hardMs > 20_000, 'plan нь хүйтэн worker-ийг барихгүй');
  assert.equal(
    b.generation.hardMs,
    Number.POSITIVE_INFINITY,
    'үүсгэлтэд хатуу хязгаар тавьсан нь урт хариултыг тасална',
  );
  // Санаа зовох хугацаа нь ҮРГЭЛЖ хатуу хязгаараас БАГА байх ёстой.
  for (const [stage, v] of Object.entries(b)) {
    assert.ok(v.slowMs < v.hardMs, `${stage}: slowMs нь hardMs-ээс бага байх ёстой`);
  }
});

/* ================================================================== */
console.log('\n9. БҮТЭЛГҮЙТЭЛ');
/* ================================================================== */

scenario('failed нь ажиллаж буй алхмыг failed болгоно', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'generation' }),
    ev('failed', { code: 'MODEL_ERROR', safeUserMessage: 'Загвар унав' }),
  ]);
  assert.equal(run.state, 'FAILED');
  assert.equal(run.steps.at(-1).status, 'failed');
  assert.equal(isRunning(run.state), false);
});

scenario('ERP хэрэгсэл унасан ч ээлж ҮРГЭЛЖИЛНЭ', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'tools' }),
    ev('tool.completed', { stage: 'tools', metadata: { tool: 'list_projects', ok: false } }),
    ev('stage.completed', { stage: 'tools' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'ok' }),
    ev('completed', {}),
  ]);
  assert.equal(run.state, 'COMPLETED');
});

/* ================================================================== */
console.log('\n9b. ДАВТАЛТЫН ГАЖИГ (2026-09-09)');
/* ================================================================== */

scenario('давталтаар зогссон хариулт нь ДУТУУ гэж тэмдэглэгдэнэ', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'үндэслэл, төлөвлөгөөний '.repeat(5) }),
    ev('failed', {
      code: 'GENERATION_REPETITION',
      safeUserMessage: 'Хариулт давтагдаж эхэлсэн тул зогсоолоо.',
    }),
  ]);
  assert.equal(run.state, 'FAILED');
  assert.equal(run.incomplete, true, 'давталтад орсон хариулт ДУТУУ гэж тэмдэглэгдээгүй');
});

scenario('давталт нь УЛААН дэд бүтцийн алдаа БИШ (§20)', () => {
  const e = aiError('GENERATION_REPETITION');
  assert.equal(e.severity, 'notice');
  assert.equal(e.action, 'retry_generation', 'дахин бичих боломж санал болгогдоогүй');
});

scenario('үүсгэлтийн ХУГАЦАА нь цуцлалтаас ӨӨР', () => {
  assert.notEqual(aiError('GENERATION_TIMEOUT').message, aiError('CANCELLED').message);
  assert.equal(aiError('GENERATION_TIMEOUT').severity, 'notice');
});

scenario('answer.reset нь ТЕКСТИЙГ цэвэрлэнэ, алхмуудыг ХЭВЭЭР үлдээнэ', () => {
  // ⚠️ Хэлний засварын зам: загвар хариултыг БҮХЭЛД НЬ дахин бичнэ.
  //    Reset хийхгүй бол хуучин + шинэ нийлж, хэрэглэгч ижил агуулгыг
  //    ХОЁР удаа хардаг — «AI өөрийгөө давтаж байна» гэсэн гомдлын
  //    ПРОГРАМ талын эх үүсвэр.
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'generation' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'The client must ensure' }),
    ev('answer.reset', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'Захиалагч нь хангах ёстой' }),
  ]);
  assert.equal(run.answer, 'Захиалагч нь хангах ёстой', `наалдсан: ${run.answer}`);
  assert.ok(run.steps.length >= 2, 'reset нь алхмуудыг устгав');
  assert.equal(run.generationStarted, true, 'reset нь үүсгэлтийн төлөвийг устгав');
});

/* ================================================================== */
console.log('\n9c. УРСГАЛЫН ХЭСГИЙН ХИЛ (§4, §8)');
/* ================================================================== */

scenario('ТАСАРСАН болон НИЙЛСЭН хэсгүүд ижил үр дүн өгнө', () => {
  const full = 'Барилгын захиалагч нь зөвшөөрөл авах үүрэгтэй.';
  const a = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: full }),
  ]);
  const parts = full.match(/.{1,3}/gu) ?? [];
  const b = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ...parts.map((t) => ev('token', { stage: 'generation', text: t })),
  ]);
  assert.equal(a.answer, b.answer, 'хэсгийн хил дээр текст зөрөв');
  assert.equal(b.answer, full);
});

scenario('КИРИЛЛ текст хэсгээр ирэхэд эвдрэхгүй (§4-ийн UTF-8)', () => {
  const mn = 'Зөвшөөрөл авах шаардлагатай — БНбД 11-01-98-ын дагуу.';
  const parts = mn.match(/.{1,2}/gu) ?? [];
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ...parts.map((t) => ev('token', { stage: 'generation', text: t })),
  ]);
  assert.equal(run.answer, mn, 'кирилл текст эвдэрсэн');
  assert.equal(run.answer.includes(String.fromCharCode(0xfffd)), false, 'орлуулах тэмдэгт үүсэв');
});

scenario('ИЖИЛ дараалсан хэсгүүдийг ХАСАХГҮЙ (хууль ёсны байж болно)', () => {
  // ⚠️ §4: «Do not deduplicate arbitrary equal text chunks».
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'та ' }),
    ev('token', { stage: 'generation', text: 'та ' }),
  ]);
  assert.equal(run.answer, 'та та ', 'ижил хэсгүүд хасагдав');
});

scenario('нэг токен ХОЁР удаа нэмэгдэхгүй (нэг үйл явдал = нэг нэмэлт)', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('generation.started', { stage: 'generation' }),
    ev('token', { stage: 'generation', text: 'нэг' }),
    ev('token', { stage: 'generation', text: 'хоёр' }),
    ev('token', { stage: 'generation', text: 'гурав' }),
  ]);
  assert.equal(run.answer, 'нэгхоёргурав');
});

/* ================================================================== */
console.log('\n10. ХУРААНГУЙ (§28)');
/* ================================================================== */

scenario('хураангуй нь дууссан алхам + эх сурвалж + хугацааг тоолно', () => {
  const run = play([
    ev('request.accepted', { stage: 'accept' }),
    ev('stage.started', { stage: 'plan' }),
    ev('stage.completed', { stage: 'plan' }),
    ev('stage.started', { stage: 'norm_retrieval' }),
    ev('source.found', { stage: 'norm_retrieval', source: NORM_SOURCE }),
    ev('stage.completed', { stage: 'norm_retrieval' }),
    ev('generation.started', { stage: 'generation' }),
    ev('completed', {}),
  ]);
  const sum = summarize(run);
  assert.equal(sum.steps, 3, 'accept + plan + norm_retrieval');
  assert.equal(sum.sources, 1);
  assert.ok(sum.totalMs > 0);
});

/* ================================================================== */
console.log('\n11. НУУЦЛАЛ — гүйцэтгэлийн мөшгөлт ≠ сэтгэлгээ (§36)');
/* ================================================================== */

scenario('бүх шошго нь БИДНИЙ бичсэн тогтмол мөр байх ёстой', () => {
  for (const [stage, pair] of Object.entries(STAGE_LABEL)) {
    assert.ok(pair.running.length > 0, `${stage} running шошгогүй`);
    assert.ok(pair.done.length > 0, `${stage} done шошгогүй`);
    // ⚠️ Загварын сэтгэлгээний ул мөр агуулсан шошго БАЙЖ БОЛОХГҮЙ.
    for (const text of [pair.running, pair.done]) {
      assert.ok(
        !/бодож байна|reasoning|thought|бодол|I think/i.test(text),
        `${stage}: шошго нь сэтгэлгээ илэрхийлж байна — "${text}"`,
      );
    }
  }
});

scenario('удаашралын мөрүүд нь ТӨВИЙГ САХИСАН, айлгадаггүй (§30)', () => {
  for (const [stage, text] of Object.entries(SLOW_NOTICE)) {
    assert.ok(text.length > 0, `${stage} мөргүй`);
    assert.ok(
      !/алдаа|amjiltgui|бүтэлгүй|failed|error/i.test(text),
      `${stage}: удаашралын мөр АЛДАА гэж хэлж байна — "${text}"`,
    );
    assert.ok(
      /үргэлжлүүлж байна|удаж байна/i.test(text),
      `${stage}: удаашралын мөр «үргэлжилж байна» гэдгийг хэлэхгүй байна`,
    );
  }
});

/* ================================================================== */
console.log(`\n${passed} тэнцсэн, ${failed} унасан`);
if (failed > 0) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
