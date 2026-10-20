/**
 * ДИФФЕРЕНЦИАЛ ПАРИТЕТЫН ХАРНЕСС (Session R, Checkpoint 3B §4).
 *
 * НЭГ ижил хуурамч сүлжээг (Session C-ийн `fakeWire`) ГУРВАН замаар гүйлгэнэ:
 *   A. ХӨЛДӨӨСӨН хуучин хөтчийн orchestrator — `./legacy/orchestrator.ts` (коммит 24694e7-ийн байт-ижил
 *      хуулбар; ОРАКУЛ, продакшнд ХЭЗЭЭ Ч импортлогдохгүй)                        runTurn(input)
 *   B. ХӨТЧИЙН ЖИНХЭНЭ зам — `frontend/.../lib/browserTurn.ts` (adapter: apiFetch + createLocalRuntimeTransport
 *      → `@mgl/mglai-common/turn`)                                                runTurn(input)
 *   C. RUNTIME/REVIT-ийн зам — `@mgl/mglai-common/turn` + createBackendTransport/createLocalRuntimeTransport
 *      (ажилтны runtime-ийн `POST /turn` яг ингэж угсардаг)                       runTurn(input, deps)
 * ба A↔B, A↔C хэвийжүүлсэн гаралтыг тулгана:
 *   · үр дүн (answer · citations · evidence · error{code,severity,action,message,hint} ·
 *     stopReason · engine · contractDiag · convStateNext · turn · usedMemoryIds · memoryHints ·
 *     normResult · verificationStates · regulatory · cache-ийн түлхүүрүүд)
 *   · үйл явдлын дараалал (type · stage · code · safeUserMessage · metadata; цаг хугацааг хасна)
 *   · утсан хүсэлтүүд (зам + бие; `*_ms` талбарыг хасна; олонлогоор тулгана)
 *
 * «Хоёр suite тус тусдаа тэнцэнэ» гэдгээс хүчтэй: ИЖИЛ оролт → ИЖИЛ гаралт гэдгийг
 * хэмжинэ.  Зориудын зөрүү бүрийг тест ӨӨРӨӨ `intentional` жагсаалтаар зарлана —
 * зарлаагүй зөрүү = унана.
 *
 * ⚠️ B-ийн тээвэр нь `createBackendTransport`/`createLocalRuntimeTransport` — хөтөч
 *    шилжсэний дараа ЯГ эдгээрийг хэрэглэнэ, тиймээс энэ харнесс нь ирээдүйн хөтчийн
 *    замыг ч хэмжиж байна.
 */
import { installFakeWire } from '../../production-readiness/lib/fakeWire.mjs';
import { installBrowserStubs, loadFrontend, loadRepo } from '../../production-readiness/lib/load.mjs';

const API_BASE = 'http://127.0.0.1:3000/api';
const RUNTIME_BASE = 'http://127.0.0.1:39217';

let legacyMod = null;
let browserMod = null;
let pkgMod = null;
async function engines() {
  if (!legacyMod) {
    installBrowserStubs();
    legacyMod = await loadRepo('ai/evaluation/parity/legacy/orchestrator.ts');
  }
  if (!browserMod) browserMod = await loadFrontend('browserTurn.ts');
  if (!pkgMod) pkgMod = await import('@mgl/mglai-common/turn');
  return { legacyMod, browserMod, pkgMod };
}

/** Мс-ийн тоог мөрөөс хасна («1 234 мс» → «N мс», «12 секунд» → «N секунд»). */
function scrubText(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\d[\d\s,.]*\s*(мс|ms|секунд|сек)/g, 'N $1');
}

const MS_KEY = /(_ms|Ms|_at|At|elapsed|duration|timestamp)$/;
/** Гүйлт бүрд санамсаргүй (newRequestId, uid үүсгэгч) — утга биш, БАЙГАА эсэхийг тулгана. */
const RANDOM_KEY = /^(request_id|requestId)$/;
function scrubDeep(v, path = '') {
  if (Array.isArray(v)) return v.map((x, i) => scrubDeep(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (RANDOM_KEY.test(k) && typeof v[k] === 'string') {
        out[k] = 'RANDOM';
        continue;
      }
      if (MS_KEY.test(k) && (typeof v[k] === 'number' || typeof v[k] === 'string')) {
        out[k] = v[k] === null ? null : 'N';
        continue;
      }
      out[k] = scrubDeep(v[k], `${path}.${k}`);
    }
    return out;
  }
  return scrubText(v);
}

export function normalizeResult(r) {
  return scrubDeep({
    answer: r.answer,
    citations: r.citations,
    evidence: r.evidence,
    confidence: r.confidence,
    error: r.error ? { code: r.error.code, severity: r.error.severity, action: r.error.action, message: r.error.message, hint: r.error.hint ?? null } : null,
    firstTokenMs: r.firstTokenMs === null ? null : 'N',
    totalMs: r.totalMs === null ? null : 'N',
    engine: r.engine,
    runtimeVariant: r.runtimeVariant,
    regulatory: r.regulatory,
    verificationStates: r.verificationStates,
    stopReason: r.stopReason,
    convStateNext: r.convStateNext,
    turn: r.turn,
    usedMemoryIds: r.usedMemoryIds,
    contractDiag: r.contractDiag,
    memoryHints: r.memoryHints,
    normResult: r.normResult,
    cacheKeys: Object.keys(r.cache ?? {}).filter((k) => r.cache[k] !== undefined).sort(),
  });
}

export function normalizeEvents(events) {
  return events.map((e) => scrubDeep({
    type: e.type,
    stage: e.stage ?? null,
    code: e.code ?? null,
    text: e.type === 'token' ? e.text : undefined,
    source: e.source ?? undefined,
    safeUserMessage: e.safeUserMessage ?? null,
    metadata: e.metadata ?? null,
  }));
}

export function normalizeCalls(calls) {
  return calls
    .map((c) => ({ path: c.url.replace(/^https?:\/\/[^/]+/, ''), body: scrubDeep(c.body) }))
    .sort((a, b) => (a.path + JSON.stringify(a.body)).localeCompare(b.path + JSON.stringify(b.body)));
}

function baseInput(overrides) {
  return {
    question: 'Тест асуулт',
    convUid: 'conv_test',
    userMsgUid: 'u1',
    aiMsgUid: 'a1',
    seq: 0,
    history: [],
    convState: null,
    memories: [],
    runtime: { installed: true, authorized: true, info: { engine: 'llama.cpp' } },
    mode: 'employee',
    ...overrides,
  };
}

/**
 * Нэг замаар гүйлгэнэ.
 * @param {'legacy'|'browser'|'runtime'} which
 * @param {() => object} routesFactory  fakeWire routes — ГҮЙЛТ БҮРД шинээр (төлөвтэй тоолуур байж болно)
 * @param {object} inputOverrides
 * @param {{ during?: (h:{ctrl:AbortController, calls:any[]}) => Promise<void>|void }} hooks
 */
export async function runOne(which, routesFactory, inputOverrides = {}, hooks = {}) {
  const { legacyMod, browserMod, pkgMod } = await engines();
  const routes = routesFactory();
  const wire = installFakeWire(routes);
  const events = [];
  const ctrl = new AbortController();
  const input = baseInput({ ...inputOverrides, signal: ctrl.signal, emit: (e) => events.push(e) });
  try {
    let p;
    if (which === 'legacy') {
      p = legacyMod.runTurn(input);
    } else if (which === 'browser') {
      p = browserMod.runTurn(input);
    } else {
      const backend = pkgMod.createBackendTransport({ apiBase: API_BASE, token: () => null });
      const runtime = pkgMod.createLocalRuntimeTransport({ baseUrl: RUNTIME_BASE });
      p = pkgMod.runTurn(input, { backend, runtime });
    }
    if (hooks.during) await hooks.during({ ctrl, calls: wire.calls });
    const result = await p;
    // fire-and-forget /messages, /conversations буулгах
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    return { result, events, calls: wire.calls.slice(), routes };
  } finally {
    wire.restore();
  }
}

/**
 * Гурван замыг гүйлгээд A↔B, A↔C тулгана.
 * @returns {{ old, neu, rt, diffs: string[], unexplained: string[] }}  old = legacy (A), neu = browser (B), rt = runtime (C)
 * @param {object} opts
 *   intentional: {(path: string) => boolean}  — зориудын зөрүүний зам (жишээ: /conversations.body.surface)
 */
/**
 * Бүх кейст хамаарах ЗОРИУДЫН зөрүү (хуучин orchestrator нь хөлдөөсөн хуулбар — шинэ талбар нэмэгдэхэд
 * түүнийг засахгүй, энд ЗАРЛАНА):
 *   INTENTIONAL-4  `/messages` body.contract_diag.legacy — гэрээний `legacyKind` (2026-09-18, L1 баримт олох:
 *                  сервер «norm_documents» бол итгэлийн шошгыг «Нотолгоотой» болгодог).  Хуучин orchestrator
 *                  талбарыг ЯВУУЛДАГГҮЙ; шинэ хөдөлгүүр хөтөч/runtime ХОЁУЛАНД ижил явуулна (паритет хэвээр).
 *   INTENTIONAL-5  `result.cacheKeys` — шинэ хөдөлгүүрийн StageCache-д `catalog` түлхүүр нэмэгдсэн (2026-09-18,
 *                  мэдлэгийн сангийн каталог: `runCatalog` нь tools/norm-той зэрэгцээ, `/plan.ask_norm_catalog`
 *                  байхгүй бол `{attempted:false}` гэж хадгалагдана).  Хуучин orchestrator-т тэр шат байхгүй тул
 *                  түлхүүрийн жагсаалт зөрнө; `/context` body-д `norm_catalog`/`norm_catalog_retrieval` шинэ талбар.
 *   INTENTIONAL-6  `/messages` body.contract_diag.norm_state — NORM-INTEL v3 (2026-10-04): нормын нотолгооны төлөв
 *                  (`trusted_contract.normIntel.evidenceState`) — серверийн итгэлийн шошгыг үнэнээр тогтооно
 *                  («Нотолгоотой» нь зөвхөн AUTHORITATIVE).  Хуучин orchestrator талбарыг ЯВУУЛДАГГҮЙ; хөтөч/runtime ижил.
 */
const GLOBAL_INTENTIONAL = [
  /^(browser|runtime)\.calls\.\d+\.body\.contract_diag\.legacy: undefined ≠ /,
  /^(browser|runtime)\.calls\.\d+\.body\.contract_diag\.norm_state: undefined ≠ /,
  /^(browser|runtime|legacy)\.result\.cacheKeys(\.\d+|\.length)?: /,
  // INTENTIONAL-5 (үргэлжлэл): `/context` body-д `norm_catalog` (null) + `norm_catalog_retrieval` ({attempted:false})
  //    ҮРГЭЛЖ явна — хуучин orchestrator-т талбар байхгүй; хөтөч/runtime хоёулаа ижил явуулна (паритет хэвээр).
  /^(browser|runtime)\.calls\.\d+\.body\.norm_catalog(_retrieval)?: undefined ≠ /,
];

export async function differential(routesFactory, inputOverrides = {}, opts = {}) {
  const old = await runOne('legacy', routesFactory, inputOverrides, opts.hooks);
  const neu = await runOne('browser', routesFactory, inputOverrides, opts.hooks);
  const rt = await runOne('runtime', routesFactory, inputOverrides, opts.hooks);
  const diffs = [];
  for (const [tag, other] of [['browser', neu], ['runtime', rt]]) {
    compare(`${tag}.result`, normalizeResult(old.result), normalizeResult(other.result), diffs);
    compare(`${tag}.events`, normalizeEvents(old.events), normalizeEvents(other.events), diffs);
    compare(`${tag}.calls`, normalizeCalls(old.calls), normalizeCalls(other.calls), diffs);
  }
  const intentional = opts.intentional ?? (() => false);
  const unexplained = diffs.filter((d) => !intentional(d) && !GLOBAL_INTENTIONAL.some((re) => re.test(d)));
  return { old, neu, rt, diffs, unexplained };
}

function compare(path, a, b, out) {
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    out.push(`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: array/object mismatch`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) compare(`${path}.${k}`, a[k], b[k], out);
}
