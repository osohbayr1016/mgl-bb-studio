/**
 * MGL AI · СЕССИЙН ХООРОНДЫН DRIFT — ЭХ КОДЫН ТҮВШНИЙ ТЕСТ (Session D §8).
 *
 * Нэг гэрээ хоёр (заримдаа гурав) газар ГАРААР бичигдсэн байдаг.  Энэ файл
 * тэр газруудыг НЭРЛЭЖ, зөрөхөд нь ХЭН ЭВДРЭХИЙГ алдааны мессежээр хэлнэ.
 *
 * ⚠️ Хараахан merge хийгдээгүй сессийн файл (B `ai/deployment/`, A
 *    `norm/registryTypes.ts`) байхгүй бол тухайн тест `skip` — ногоон биш.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { P, readSource, constStringArray, constStringSet, constString, unionLiterals, interfaceKeys } from '../src/contracts/sources.ts';
import { NORM_STATUSES, GENERATE_STOP_REASONS } from '../src/contracts/runtimeApi.ts';

const beVersion = readSource(P.beVersion)!;
const runtimeServer = readSource(P.runtimeServer)!;
const runtimeConfig = readSource(P.runtimeConfig)!;
const runtimeUpdater = readSource(P.runtimeUpdater)!;
const feRuntime = readSource(P.feRuntime)!;
// NormAnswer · RuntimeUpdateStatus · stop_reason тайлбар — канон багцын runtimeTypes.ts (Session R, R3).
const pkgRuntimeTypes = readSource(P.pkgRuntimeTypes)!;
const beLocalNorm = readSource(P.beLocalNorm)!;
const beRoutes = readSource(P.beRoutes)!;
const feApiHost = readSource(P.feApiHost)!;

/* ------------------------------------------------------------------ */
/*  1. RUNTIME VARIANT — «аль загвар хариулсан бэ»                     */
/* ------------------------------------------------------------------ */

test('registry/models.json-ийн runtime_variant бүр backend RUNTIME_VARIANTS-д БАЙНА (эс тэгвэл ai_messages.runtime_variant = NULL)', () => {
  const registry = JSON.parse(readFileSync(P.registryModels, 'utf8')) as { candidates: { runtime_variant: string }[] };
  const backend = constStringArray(beVersion, 'RUNTIME_VARIANTS');
  assert.ok(backend, 'backend/src/lib/mglai/version.ts RUNTIME_VARIANTS олдсонгүй');
  const missing = registry.candidates.map((c) => c.runtime_variant).filter((v) => !backend!.includes(v));
  assert.deepEqual(
    missing,
    [],
    `Эдгээр variant-ыг /messages-ийн isRuntimeVariant ТАТГАЛЗАЖ, ai_messages.runtime_variant NULL болно: ${missing.join(', ')}.  ` +
      'Засвар: backend/src/lib/mglai/version.ts RUNTIME_VARIANTS-д нэмэх (хаалттай олонлог, ЗОРИУД).',
  );
});

test('runtime нь variant-ыг файлын нэрээс гаргадаг (server.ts) — тэр дүрэм backend-ийн олонлогтой нийцнэ', () => {
  // server.ts: «Qwen3-8B-Q4_K_M.gguf» → «employee-8b-q4» гэсэн баримтжсан дүрэм.
  const backend = constStringArray(beVersion, 'RUNTIME_VARIANTS')!;
  for (const v of ['employee-8b-q4', 'employee-4b-q4', 'echo']) {
    assert.ok(backend.includes(v), `runtime гаргаж чадах '${v}' нь backend RUNTIME_VARIANTS-д алга`);
  }
});

/* ------------------------------------------------------------------ */
/*  2. /norm — status цагаан жагсаалт ГУРВАН газар                     */
/* ------------------------------------------------------------------ */

test('/norm status: гэрээ = backend localNorm STATUSES = frontend NormAnswer.status', () => {
  const be = constStringSet(beLocalNorm, 'STATUSES');
  assert.ok(be, 'localNorm.ts STATUSES олдсонгүй');
  const fe = unionLiterals(pkgRuntimeTypes, /interface NormAnswer \{[\s\S]*?status:/);
  assert.ok(fe && fe.length > 0, 'frontend NormAnswer.status union олдсонгүй');
  assert.deepEqual([...be!].sort(), [...NORM_STATUSES].sort(), 'backend STATUSES ≠ гэрээ');
  assert.deepEqual([...fe!].sort(), [...NORM_STATUSES].sort(), 'frontend NormAnswer.status ≠ гэрээ');
});

test('/norm хариуны түлхүүр: frontend NormAnswer ⊆ runtime json(res, 200, {…})', () => {
  const fe = interfaceKeys(pkgRuntimeTypes, 'NormAnswer')!;
  const m = runtimeServer.match(/path === '\/norm' && req\.method === 'POST'[\s\S]*?return json\(res, 200, \{([\s\S]*?)\n\s*\}\);/);
  assert.ok(m, 'server.ts /norm 200 блок олдсонгүй');
  const runtimeKeys = [...m![1]!.matchAll(/^\s*([a-z_]+)\s*[:,]/gm)].map((x) => x[1]!);
  const missing = fe.filter((k) => !runtimeKeys.includes(k));
  assert.deepEqual(missing, [], `frontend NormAnswer хүлээж буй ч runtime /norm өгдөггүй: ${missing.join(', ')}`);
});

test('backend parseLocalNorm уншдаг түлхүүр бүрийг runtime /norm өгдөг', () => {
  const m = runtimeServer.match(/path === '\/norm' && req\.method === 'POST'[\s\S]*?return json\(res, 200, \{([\s\S]*?)\n\s*\}\);/)!;
  const runtimeKeys = new Set([...m[1]!.matchAll(/^\s*([a-z_]+)\s*[:,]/gm)].map((x) => x[1]!));
  const beReads = [...beLocalNorm.matchAll(/\br\.([a-z_]+)/g)].map((x) => x[1]!).filter((k) => !['status'].includes(k));
  const missing = [...new Set(beReads)].filter((k) => !runtimeKeys.has(k));
  assert.deepEqual(missing, [], `localNorm.ts уншдаг ч runtime өгдөггүй: ${missing.join(', ')}`);
});

/* ------------------------------------------------------------------ */
/*  3. /generate — stop_reason, update phase                           */
/* ------------------------------------------------------------------ */

test('UpdatePhase: runtime updater.ts = frontend RuntimeUpdateStatus.phase', () => {
  const rt = unionLiterals(runtimeUpdater, /export type UpdatePhase =/);
  const fe = unionLiterals(pkgRuntimeTypes, /interface RuntimeUpdateStatus \{\s*phase:/);
  assert.ok(rt && fe);
  assert.deepEqual(fe!.sort(), rt!.sort(), 'frontend RuntimeUpdateStatus.phase ≠ runtime UpdatePhase (twin)');
});

test('stop_reason: frontend тайлбарт баримтжсан 5 утга = гэрээ', () => {
  // runtime.ts тайлбар: `stop` | `length` | `aborted` | `repetition` | `timeout`
  const m = pkgRuntimeTypes.match(/`stop` \| `length` \| `aborted` \| `repetition` \| `timeout`/);
  assert.ok(m, 'frontend StreamCallbacks.onDone-ийн stop_reason баримт өөрчлөгдсөн — гэрээг шинэчил');
  assert.equal(GENERATE_STOP_REASONS.length, 5);
});

/* ------------------------------------------------------------------ */
/*  4. Тохиргооны хос: control plane                                   */
/* ------------------------------------------------------------------ */

test('DEFAULT_CONTROL_PLANE (runtime) = DEFAULT_API_HOST (frontend)', () => {
  const rt = constString(runtimeConfig, 'DEFAULT_CONTROL_PLANE');
  const fe = constString(feApiHost, 'DEFAULT_API_HOST');
  assert.ok(rt && fe);
  assert.equal(rt, fe, 'runtime ба frontend өөр Worker руу залгаж байна');
});

test('runtime DEFAULT_PORT = frontend DEFAULT_PORT (39217)', () => {
  const rt = runtimeConfig.match(/DEFAULT_PORT = (\d+)/)?.[1];
  const fe = feRuntime.match(/DEFAULT_PORT = (\d+)/)?.[1];
  assert.equal(rt, fe);
});

/* ------------------------------------------------------------------ */
/*  5. Хувилбарын таних тэмдэг — гурван «1.0.0»                         */
/* ------------------------------------------------------------------ */

test('MGL_AI_VERSION / RUNTIME_VERSION / ai/package.json version — гурав нь ЯЛГААТАЙ хувилбарууд, нэг нь нөгөөг орлохгүй (баримтжуулалт)', () => {
  const product = constString(beVersion, 'MGL_AI_VERSION');
  const runtime = constString(runtimeConfig, 'RUNTIME_VERSION');
  const pkg = (JSON.parse(readFileSync(P.aiPackage, 'utf8')) as { version: string }).version;
  assert.ok(product && runtime && pkg);
  // ⚠️ Тэнцүү байхыг ШААРДАХГҮЙ — гурав нь өөр бүрэлдэхүүн.  Гэхдээ publish-installer
  //    нь ai/package.json version-ыг runtime-code хувилбар болгон хэрэглэдэг тул
  //    RUNTIME_VERSION-той таарахгүй бол манифест ба /info өөр тоо хэлнэ.
  assert.equal(pkg, runtime, `ai/package.json version (${pkg}) ≠ RUNTIME_VERSION (${runtime}): publish-installer манифест ба /info өөр тоо мэдээлнэ`);
});

/* ------------------------------------------------------------------ */
/*  6. Session B ↔ runtime (merge хийгдсэн бол)                        */
/* ------------------------------------------------------------------ */

test('B httpNormProviders хүлээж буй /norm/info талбарууд', { skip: !readSource(P.deploymentNormProviders) && 'ai/deployment merge хийгдээгүй' }, () => {
  const src = readSource(P.deploymentNormProviders)!;
  const keys = interfaceKeys(src, 'NormInfoBody')!;
  const handler = runtimeServer.slice(runtimeServer.indexOf("path === '/norm/info'"), runtimeServer.indexOf("path === '/generate'"));
  const block = handler.slice(handler.lastIndexOf('return json(res, 200, {'));
  const rt = new Set([...block.matchAll(/^\s*([a-z_]+)\s*[:,]/gm)].map((x) => x[1]!));
  // Session D §8 (2026-09-14): knowledge_version / registry_version / schema_version одоо ХАТУУ гэрээ.
  const missing = keys.filter((k) => !rt.has(k));
  assert.deepEqual(missing, [], `B уншдаг ч runtime /norm/info өгдөггүй: ${missing.join(', ')}`);
});

test('B ReleaseManifest schema ба COMPONENT_IDS', { skip: !readSource(P.deploymentManifest) && 'ai/deployment merge хийгдээгүй' }, () => {
  const src = readSource(P.deploymentManifest)!;
  assert.equal(constString(src, 'MANIFEST_SCHEMA'), 'mgl-ai-release/1');
  const ids = constStringArray(src, 'COMPONENT_IDS')!;
  for (const id of ['app', 'runtime', 'model', 'knowledge', 'normRegistry', 'revit']) assert.ok(ids.includes(id), id);
});

/* ------------------------------------------------------------------ */
/*  7. Session A ↔ runtime (merge хийгдсэн бол)                        */
/* ------------------------------------------------------------------ */

test('A datasetIdentity: ingest ба norm-compiler ИЖИЛ функц/хувилбар', { skip: !readSource(P.datasetIdentity) && 'datasetIdentity.ts merge хийгдээгүй' }, () => {
  const src = readSource(P.datasetIdentity)!;
  assert.match(src, /export const DATASET_IDENTITY_VERSION = 1/);
  const manifest = readSource(P.beRegistryManifest);
  if (manifest) {
    // Бүртгэлийн манифест бүр datasetSha256-тай — «хувилбаргүй бүртгэл» гарахгүй.
    const entries = [...manifest.matchAll(/"datasetSha256":\s*"([0-9a-f]{64})"/g)];
    assert.ok(entries.length > 0, 'manifest.generated.ts-д datasetSha256 алга');
  }
});

/* ------------------------------------------------------------------ */
/*  8. request_id — хаана хадгалагддаг вэ (§19)                        */
/* ------------------------------------------------------------------ */

test('request_id: хөтөч бүх шатанд илгээдэг; backend ХАДГАЛДАГ эсэх (warning)', () => {
  const orch = readSource(P.feOrchestrator)!;
  for (const route of ['/mgl-ai/plan', '/mgl-ai/context', '/mgl-ai/messages']) {
    const idx = orch.indexOf(route);
    assert.ok(idx > 0, route);
    const window = orch.slice(idx, idx + 1500);
    assert.match(window, /request_id: requestId/, `${route}-д request_id явдаггүй`);
  }
  const persisted = /request_id/.test(beRoutes.slice(beRoutes.indexOf("mglAi.post('/messages'"), beRoutes.indexOf("mglAi.post('/feedback'")));
  if (!persisted) {
    console.warn('  ⚠ /messages нь request_id-г ХАДГАЛДАГГҮЙ (ai_messages-д багана алга) — санал хүсэлт → хүсэлт мөшгих боломжгүй (release gate: warning)');
  }
});

/* ------------------------------------------------------------------ */
/*  9. /context — frontend AiContextResponse ⊆ backend c.json({…})     */
/* ------------------------------------------------------------------ */

test('/context хариу: frontend AiContextResponse-ийн түлхүүр бүрийг backend буцаадаг', () => {
  const feTypes = readSource(P.feTypes)!;
  const fe = interfaceKeys(feTypes, 'AiContextResponse')!;
  assert.ok(fe.length > 10, 'AiContextResponse олдсонгүй');
  const start = beRoutes.indexOf("mglAi.post('/context'");
  const end = beRoutes.indexOf("mglAi.post('/tool'");
  const handler = beRoutes.slice(start, end);
  const lastReturn = handler.lastIndexOf('return c.json({');
  const block = handler.slice(lastReturn);
  const keys = new Set([...block.matchAll(/^\s+([a-z_]+)\s*[:,]/gm)].map((m) => m[1]!));
  const missing = fe.filter((k) => !keys.has(k));
  assert.deepEqual(missing, [], `frontend хүлээж буй ч backend /context өгдөггүй: ${missing.join(', ')}`);
});

test('/plan хариу: frontend PlanResponse-ийн түлхүүр бүрийг backend буцаадаг', () => {
  const orch = readSource(P.feOrchestrator)!;
  const fe = interfaceKeys(orch, 'PlanResponse');
  if (!fe) return; // PlanResponse өөр файлд шилжсэн бол алгасна
  const start = beRoutes.indexOf("mglAi.post('/plan'");
  const end = beRoutes.indexOf("mglAi.get('/capabilities'");
  const handler = beRoutes.slice(start, end);
  const block = handler.slice(handler.lastIndexOf('return c.json({'));
  const keys = new Set([...block.matchAll(/^\s+([a-z_]+)\s*[:,]/gm)].map((m) => m[1]!));
  const missing = fe.filter((k) => !keys.has(k));
  assert.deepEqual(missing, [], `frontend PlanResponse хүлээж буй ч backend /plan өгдөггүй: ${missing.join(', ')}`);
});

/* ------------------------------------------------------------------ */
/*  10. ГАНЦ ИДЭВХЖҮҮЛЭЛТИЙН ЗАМ (эзний шийдвэр 2026-09-11)             */
/* ------------------------------------------------------------------ */

/**
 * Эзний шийдвэр: `ai/deployment/src/activation.ts` нь идэвхжүүлэлт/буцаалтын
 * ЦОРЫН ГАНЦ хөдөлгүүр (шалгах → нийцэл/хэш → зогсоох → атомоор солих →
 * health → known-good эсвэл rollback).  `updater.ts` нь манифест шалгаж,
 * татаж, staging хийгээд activation.ts-ийг ДУУДНА — өөрөө идэвхжүүлэхгүй.
 *
 * ⚠️ B merge хийгдтэл skip.  Merge-ийн дараа `updater.ts` ба `server.ts`-д
 *    `manager.activate(` / `manager.rollback(` / `activateAdapter(` /
 *    `rollbackAdapter(` шууд дуудлага ҮЛДЭХГҮЙ (2026-09-11-д 4+2 байсан).
 */
test('идэвхжүүлэлтийн семантик ЗӨВХӨН deployment/src/activation.ts-д', { skip: !readSource(P.deploymentManifest.replace('manifest.ts', 'activation.ts')) && 'B activation.ts merge хийгдээгүй' }, () => {
  const direct = /\.(activate|rollback|activateAdapter|rollbackAdapter)\(/g;
  const offenders: string[] = [];
  for (const [label, src] of [['updater.ts', runtimeUpdater], ['server.ts', runtimeServer]] as const) {
    for (const m of src.matchAll(direct)) {
      const before = src.slice(0, m.index);
      const line = before.split('\n').length;
      // B-ийн эцсийн загвар (e9819a5): идэвхжүүл → reload → smoke → rollback ДАРААЛАЛ нь ЗӨВХӨН
      // `activation.ts switchModel(...)`-д; manager-ийн primitive нь түүнд callback болж л орно.
      const window = before.slice(-600);
      const inSwitch = /switchModel\(\{[^}]*$/s.test(window) || /switchModel\(\s*\{[\s\S]{0,500}$/.test(window) && !/\}\);\s*$/.test(window);
      const isCallback = /(?:activate|rollback):\s*(?:async\s*)?\(\)\s*=>\s*[\w.#]*$/.test(before);
      if (inSwitch && isCallback) continue;
      offenders.push(`${label}:${line} ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `идэвхжүүлэлт/буцаалт activation.ts-ийн switchModel-оос ГАДУУР: ${offenders.join(', ')} — эзний шийдвэр: нэг хэрэгжүүлэлт (B)`);
  // Дараалал өөрөө activation.ts-д л байгааг ч барина: updater/server-д «smoke дараа rollback» гэсэн өөрийн гогцоо БАЙХГҮЙ.
  for (const [label, src] of [['updater.ts', runtimeUpdater], ['server.ts', runtimeServer]] as const) {
    assert.ok(/switchModel\(/.test(src), `${label} нь switchModel-ийг дууддаггүй — идэвхжүүлэлт өөр замаар явж байна`);
  }
});

/* ------------------------------------------------------------------ */
/*  11. §18 — norm_retrieval wire (A final): хөтөч ҮРГЭЛЖ илгээнэ       */
/* ------------------------------------------------------------------ */

test('§18: orchestrator /context-д norm_retrieval {attempted, reason} илгээдэг; backend цагаан жагсаалт нь frontend-ийн шалтгаануудыг агуулна', { skip: !/norm_retrieval/.test(beRoutes) && 'A final (norm_retrieval) merge хийгдээгүй' }, () => {
  const orch = readSource(P.feOrchestrator)!;
  assert.match(orch, /norm_retrieval:\s*\{\s*attempted:/, 'orchestrator norm_retrieval илгээдэггүй — runtime_down нь «олдсонгүй» болно');
  const be = constStringSet(beRoutes, 'REASONS');
  assert.ok(be, 'backend parseNormRetrieval REASONS олдсонгүй');
  for (const r of ['runtime_down', 'not_installed', 'timeout', 'offline', 'error', 'ok', 'not_asked']) {
    assert.ok(be!.includes(r), `backend REASONS-д '${r}' алга — frontend тэр шалтгааныг илгээвэл not_asked болж «олдсонгүй» руу унана`);
  }
});
