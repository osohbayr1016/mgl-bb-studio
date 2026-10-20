#!/usr/bin/env node
/**
 * MGL AI · НЭГ ТУШААЛААР БҮРЭН ШАЛГАЛТ (Session D §9, §10, §11).
 *
 *   cd ai && npm run mgl-ai:verify            # --fast (өгөгдмөл): unit + гэрээ + drift, ~1 мин
 *   cd ai && npm run mgl-ai:verify -- --full  # + typecheck ×4, backend бүх тест, frontend check-ai-*
 *   cd ai && npm run mgl-ai:verify -- --e2e   # + MODEL_EVAL/E2E/PERFORMANCE (локал backend :3000 + runtime :39217 хэрэгтэй)
 *   … --json <зам>   гаралтын файл (өгөгдмөл integration/reports/release-gate.json)
 *   … --only <id,…>  зөвхөн нэрлэсэн suite
 *
 * ⚠️ ЭНЭ ФАЙЛ ТЕСТ ДАВХАРДУУЛДАГГҮЙ.  Эзэн бүрийн БАЙГАА suite-ийг дуудаж,
 *    үр дүнг АНГИЛЛААР (UNIT/INTEGRATION/E2E/MODEL_EVAL/SECURITY/PERFORMANCE/
 *    INSTALLATION) тусад нь тайлагнана.  Unit ногоон ≠ release-ready.
 *
 * ⚠️ ХЭЗЭЭ Ч prod руу хүрэхгүй: wrangler, --remote, D1 бичилт ЭНД БАЙХГҮЙ.
 *
 * ⚠️ Эзний WIP (A norm-compiler, B deployment) merge хийгдээгүй бол тэр suite
 *    `BLOCKED` — «давлаа» гэж бичигдэхгүй, хаалга нээгдэхгүй.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeGate, TEST_CLASSES } from './src/gate/releaseGate.ts';
import { evaluateCompatibility } from './src/compat/matrix.ts';
import { collectFromSources } from './src/compat/collect.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI = resolve(HERE, '..');
const REPO = resolve(AI, '..');
const BACKEND = join(REPO, 'backend');
const FRONTEND = join(REPO, 'frontend');

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : (argv[i + 1] ?? true);
};
const mode = argv.includes('--e2e') ? 'e2e' : argv.includes('--full') ? 'full' : 'fast';
const only = flag('only') ? String(flag('only')).split(',') : null;
const jsonOut = typeof flag('json') === 'string' ? resolve(String(flag('json'))) : join(HERE, 'reports', 'release-gate.json');

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const NODE = process.execPath;

/* ------------------------------------------------------------------ */
/*  Эзний WIP байгаа эсэх                                              */
/* ------------------------------------------------------------------ */
const presence = {
  normCompiler: existsSync(join(AI, 'norm-compiler', 'test')),
  deployment: existsSync(join(AI, 'deployment', 'src')),
  registry: existsSync(join(BACKEND, 'src', 'lib', 'mglai', 'norm', 'generated', 'manifest.generated.ts')),
  readiness: existsSync(join(AI, 'evaluation', 'production-readiness', 'suites')),
};

/* ------------------------------------------------------------------ */
/*  --e2e: ЭНЭ tree-ийн backend-ийг өөрөө асаана (prod-copy D1)         */
/* ------------------------------------------------------------------ */
/**
 * ⚠️ ЯАГААД ӨӨРӨӨ АСААДАГ ВЭ.  Машин дээр :3000 дээр ӨӨР tree-ийн (жишээ нь Session A-ийн
 *    WIP) `wrangler dev` ажиллаж байж болно — түүн рүү C-ийн үнэлгээг явуулбал ХААЛГАНЫ ҮР ДҮН
 *    ШАЛГАЖ БУЙ КОДТОЙ ХОЛБОГДОХГҮЙ.  Тиймээс --e2e нь өөрийн tree-ийн worker-ийг 3998 дээр
 *    асааж, `eval:*` + `int:e2e-smoke`-д `--api`/`MGLAI_EVAL_API`-аар өгнө.  Runtime (:39217)
 *    нь ажилтны БОДИТ runtime (Qwen) — MODEL_EVAL-д зориуд тэр; байхгүй бол BLOCKED.
 */
const E2E_PORT = Number(process.env.MGL_AI_E2E_PORT ?? 3998);
const E2E_API = `http://127.0.0.1:${E2E_PORT}/api`;
const RT_URL = process.env.MGL_AI_E2E_RUNTIME ?? 'http://127.0.0.1:39217';
let backendProc = null;

function prepareBackendState() {
  const main = process.env.MGL_AI_MAIN_TREE ?? 'C:/Users/User/project/mgl-e-c';
  const devVars = join(BACKEND, '.dev.vars');
  if (!existsSync(devVars)) {
    const src = join(main, 'backend', '.dev.vars');
    if (!existsSync(src)) return '.dev.vars алга (JWT_SECRET)';
    cpSync(src, devVars);
  }
  const d1 = join(BACKEND, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const src = join(main, 'backend', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const big = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sqlite') && statSync(join(dir, f)).size > 1_000_000) : []);
  if (big(d1).length === 0) {
    const files = big(src);
    if (files.length === 0) return 'prod-copy локал D1 алга';
    mkdirSync(d1, { recursive: true });
    const newest = files.sort((a, b) => statSync(join(src, b)).mtimeMs - statSync(join(src, a)).mtimeMs)[0];
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(join(src, newest + suffix))) cpSync(join(src, newest + suffix), join(d1, newest + suffix));
  }
  return null;
}

function startBackend() {
  const prep = prepareBackendState();
  if (prep) return prep;
  backendProc = spawn(NPX, ['wrangler', 'dev', '--local', '--port', String(E2E_PORT), '--config', 'wrangler.toml'], {
    cwd: BACKEND,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    if (reachable(`${E2E_API}/landing/public`, 1500)) return null;
    spawnSync(NODE, ['-e', 'setTimeout(()=>{},1000)']);
  }
  return `wrangler dev :${E2E_PORT} 60 с-д эхэлсэнгүй`;
}

function stopBackend() {
  if (!backendProc?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(backendProc.pid), '/T', '/F'], { stdio: 'ignore' });
  else backendProc.kill('SIGTERM');
}

const C_SUITES = join(AI, 'evaluation', 'production-readiness', 'suites');
/** Датасет багцууд gitignore-д — энэ tree-д байхгүй бол үндсэн tree-ийнхийг УНШИНА (бичихгүй). */
const DATA_ROOT = existsSync(join(AI, 'data-train-files'))
  ? join(AI, 'data-train-files')
  : join(process.env.MGL_AI_MAIN_TREE ?? 'C:/Users/User/project/mgl-e-c', 'ai', 'data-train-files');

/** Session C-ийн загваргүй suite — файл байхгүй бол BLOCKED_BY_C. */
function cSuite(id, cls, file) {
  return [
    {
      id,
      cls,
      owner: 'C',
      modes: ['fast', 'full', 'e2e'],
      blocking: true,
      blockedIf: () => (!presence.readiness ? 'ai/evaluation/production-readiness алга (Session C WIP merge хийгдээгүй)' : !existsSync(join(C_SUITES, file)) ? `${file} алга` : null),
      ...nodeTest(AI, [`evaluation/production-readiness/suites/${file}`]),
    },
  ];
}

function reachable(url, ms = 1500) {
  // Синхрон probe — child node процессоор (spawnSync).
  const r = spawnSync(NODE, ['-e', `fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(${ms})}).then(r=>process.exit(r.ok?0:2)).catch(()=>process.exit(3))`], { encoding: 'utf8' });
  return r.status === 0;
}

/* ------------------------------------------------------------------ */
/*  SUITE ЖАГСААЛТ — id · ангилал · эзэн · горим · тушаал                */
/* ------------------------------------------------------------------ */
const nodeTest = (cwd, globs) => ({ cmd: NODE, args: ['--test', '--test-reporter=tap', ...globs], cwd, parse: parseTap });
const tsc = (cwd, extra = []) => ({ cmd: NPX, args: ['tsc', '--noEmit', ...extra], cwd, parse: parseExit, shell: true });

const SUITES = [
  // ── UNIT ──
  { id: 'ai:runtime', cls: 'UNIT', owner: 'runtime', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['runtime/test/**/*.test.ts']) },
  { id: 'ai:retrieval', cls: 'UNIT', owner: 'A', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['retrieval/test/**/*.test.ts']) },
  {
    id: 'ai:norm-compiler',
    cls: 'UNIT',
    owner: 'A',
    modes: ['fast', 'full', 'e2e'],
    blocking: true,
    blockedIf: () => (!presence.normCompiler ? 'ai/norm-compiler/test алга (Session A WIP merge хийгдээгүй)' : null),
    ...nodeTest(AI, ['norm-compiler/test/**/*.test.ts']),
  },
  {
    id: 'ai:deployment',
    cls: 'UNIT',
    owner: 'B',
    modes: ['fast', 'full', 'e2e'],
    blocking: true,
    blockedIf: () => (!presence.deployment ? 'ai/deployment алга (Session B WIP merge хийгдээгүй)' : !existsSync(join(AI, 'deployment', 'test')) ? 'ai/deployment/test алга' : null),
    ...nodeTest(AI, ['deployment/test/**/*.test.ts']),
  },
  { id: 'backend:mglai', cls: 'UNIT', owner: 'backend', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(BACKEND, ['src/lib/mglai/**/*.test.ts']) },
  {
    id: 'backend:releases',
    cls: 'INTEGRATION',
    owner: 'B',
    modes: ['fast', 'full', 'e2e'],
    blocking: true,
    blockedIf: () => (!existsSync(join(BACKEND, 'src', 'lib', 'mglai', 'releases')) ? 'backend/src/lib/mglai/releases алга (Session B WIP merge хийгдээгүй)' : null),
    ...nodeTest(BACKEND, ['src/lib/mglai/releases/**/*.test.ts', 'src/lib/mglai/fleet/**/*.test.ts', 'src/lib/mglai/improvement/**/*.test.ts']),
  },
  { id: 'backend:all', cls: 'UNIT', owner: 'repo', modes: ['full', 'e2e'], blocking: false, ...nodeTest(BACKEND, ['src/**/*.test.ts']) },
  {
    id: 'fe:check-ai',
    cls: 'UNIT',
    owner: 'frontend',
    modes: ['fast', 'full', 'e2e'],
    blocking: true,
    cmd: NODE,
    args: ['-e', "for (const s of ['check-ai-stream','check-ai-contract','check-ai-validator','check-ai-memory','check-ai-markdown']) { const r = require('node:child_process').spawnSync(process.execPath, ['scripts/'+s+'.mjs'], {encoding:'utf8'}); process.stdout.write(s+': '+(r.stdout||'').trim().split('\\n').pop()+'\\n'); if (r.status !== 0) { process.stdout.write((r.stderr||'').slice(-800)); process.exit(1); } }"],
    cwd: FRONTEND,
    parse: parseFeChecks,
  },

  // ── Хуваалцсан багц (packages/mglai-common) — канон redaction (GAP-027) ──
  { id: 'common:redaction', cls: 'UNIT', owner: 'D', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(join(REPO, 'packages', 'mglai-common'), ['test/**/*.test.ts']) },
  { id: 'common:tsc-agnostic', cls: 'INTEGRATION', owner: 'D', modes: ['full', 'e2e'], blocking: true, cmd: NPX, args: ['tsc', '--noEmit', '-p', join(REPO, 'packages', 'mglai-common')], cwd: AI, parse: parseExit, shell: true },

  // ── INTEGRATION (Session D) ──
  { id: 'int:runtime-contract', cls: 'INTEGRATION', owner: 'D', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['integration/test/runtime.contract.test.ts']) },
  { id: 'int:drift', cls: 'INTEGRATION', owner: 'D', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['integration/test/drift.test.ts']) },
  { id: 'int:compat', cls: 'INTEGRATION', owner: 'D', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['integration/test/compat.test.ts']) },
  { id: 'int:gate', cls: 'INTEGRATION', owner: 'D', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['integration/test/gate.test.ts']) },
  { id: 'ai:tsc', cls: 'INTEGRATION', owner: 'runtime', modes: ['full', 'e2e'], blocking: true, ...tsc(AI) },
  { id: 'int:tsc', cls: 'INTEGRATION', owner: 'D', modes: ['full', 'e2e'], blocking: true, ...tsc(AI, ['-p', 'integration']) },
  { id: 'backend:tsc', cls: 'INTEGRATION', owner: 'backend', modes: ['full', 'e2e'], blocking: true, ...tsc(BACKEND) },
  { id: 'fe:tsc', cls: 'INTEGRATION', owner: 'frontend', modes: ['full', 'e2e'], blocking: true, cmd: NPX, args: ['tsc', '-b'], cwd: FRONTEND, parse: parseExit, shell: true },

  // ── Session C production-readiness (загваргүй, fakeWire) — C-ийн `ai:readiness`-ийн suite бүрийг ТУС ТУСАД нь ──
  // ⚠️ C-ийн scorecard.mjs (нэгтгэгч) энд ДАХИН ажиллуулахгүй — энэ файл нь нэгтгэгч.  Suite бүр
  //    өөрийн ангилалд орж, merge хийгдтэл BLOCKED_BY_C.  `npm run ai:readiness` нь C-ийн өөрийн харагдац хэвээр.
  ...cSuite('c:intent-routing', 'UNIT', 'intent-routing.test.mjs'),
  ...cSuite('c:conversation-context', 'UNIT', 'conversation-context.test.mjs'),
  ...cSuite('c:units-numbers-language', 'UNIT', 'units-numbers-language.test.mjs'),
  ...cSuite('c:streaming-faults', 'INTEGRATION', 'streaming-faults.test.mjs'),
  ...cSuite('c:hallucination-contract', 'SECURITY', 'hallucination-contract.test.mjs'),
  ...cSuite('c:security-injection', 'SECURITY', 'security-injection.test.mjs'),
  {
    id: 'c:live-backend',
    cls: 'E2E',
    owner: 'C',
    modes: ['e2e'],
    blocking: true,
    blockedIf: () => (!presence.readiness ? 'Session C WIP merge хийгдээгүй' : !existsSync(join(C_SUITES, 'live-backend.test.mjs')) ? 'live-backend.test.mjs алга' : !backendProc ? 'энэ tree-ийн backend асаагүй' : null),
    env: { MGLAI_API: E2E_API },
    ...nodeTest(AI, ['evaluation/production-readiness/suites/live-backend.test.mjs']),
  },
  {
    id: 'c:dataset-lint',
    cls: 'MODEL_EVAL',
    owner: 'A',
    modes: ['full', 'e2e'],
    blocking: true,
    blockedIf: () => (!existsSync(join(AI, 'tools', 'dataset-lint', 'lint.mjs')) ? 'ai/tools/dataset-lint алга (Session C WIP merge хийгдээгүй)' : !existsSync(DATA_ROOT) ? `data-train-files алга (${DATA_ROOT})` : null),
    cmd: NODE,
    args: ['tools/dataset-lint/lint.mjs', '--root', DATA_ROOT, '--strict'],
    cwd: AI,
    parse: parseExit,
  },
  {
    id: 'c:training-lint',
    cls: 'MODEL_EVAL',
    owner: 'C',
    modes: ['e2e'],
    blocking: true,
    blockedIf: () => (!existsSync(join(AI, 'tools', 'training-lint', 'lint.mjs')) ? 'ai/tools/training-lint алга (Session C WIP merge хийгдээгүй)' : !existsSync(join(AI, 'training', 'out')) ? 'ai/training/out алга (ai:build:sft)' : null),
    cmd: NODE,
    args: ['tools/training-lint/lint.mjs', '--strict'],
    cwd: AI,
    parse: parseExit,
  },
  {
    id: 'c:perf-baseline',
    cls: 'PERFORMANCE',
    owner: 'C',
    modes: ['e2e'],
    blocking: false,
    blockedIf: () => (!existsSync(join(AI, 'evaluation', 'production-readiness', 'perf-baseline.mjs')) ? 'Session C WIP merge хийгдээгүй' : !reachable(`${RT_URL}/health`) ? `runtime ${RT_URL} хүрэхгүй` : null),
    env: { MGLAI_API: E2E_API, MGLAI_RUNTIME: RT_URL },
    cmd: NODE,
    args: ['evaluation/production-readiness/perf-baseline.mjs'],
    cwd: AI,
    parse: parseExit,
  },

  // ── SECURITY ──
  { id: 'int:secrets', cls: 'SECURITY', owner: 'D', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['integration/test/secrets.security.test.ts']) },
  { id: 'int:redaction-cross', cls: 'SECURITY', owner: 'D', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['integration/test/redaction.crossConsumer.test.ts']) },
  { id: 'ai:auth', cls: 'SECURITY', owner: 'runtime', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['runtime/test/auth.test.ts']) },
  { id: 'backend:visibility', cls: 'SECURITY', owner: 'backend', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(BACKEND, ['src/lib/mglai/visibility.test.ts', 'src/lib/mglai/permissions.test.ts']) },

  // ── INSTALLATION ──
  { id: 'int:clean-machine', cls: 'INSTALLATION', owner: 'repo', modes: ['fast', 'full', 'e2e'], blocking: true, ...nodeTest(AI, ['integration/test/cleanMachine.install.test.ts']) },

  // ── E2E (Session D) — бодит wrangler dev (prod-copy D1) + echo runtime, загваргүй ──
  {
    id: 'int:e2e-smoke',
    cls: 'E2E',
    owner: 'D',
    modes: ['e2e'],
    blocking: true,
    blockedIf: () => {
      const main = process.env.MGL_AI_MAIN_TREE ?? 'C:/Users/User/project/mgl-e-c';
      const devVars = existsSync(join(BACKEND, '.dev.vars')) || existsSync(join(main, 'backend', '.dev.vars'));
      const d1 = existsSync(join(BACKEND, '.wrangler', 'state', 'v3', 'd1')) || existsSync(join(main, 'backend', '.wrangler', 'state', 'v3', 'd1'));
      return !devVars ? 'backend/.dev.vars алга' : !d1 ? 'prod-copy локал D1 алга' : null;
    },
    env: { MGL_AI_E2E: '1', MGL_AI_E2E_API: E2E_API },
    ...nodeTest(AI, ['integration/test/e2e.smoke.test.ts']),
  },

  // ── MODEL_EVAL / E2E / PERFORMANCE — зөвхөн --e2e ──
  {
    id: 'eval:norm',
    cls: 'MODEL_EVAL',
    owner: 'A',
    modes: ['e2e'],
    blocking: true,
    blockedIf: () => (!existsSync(join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'knowledge', 'knowledge.sqlite')) ? 'knowledge.sqlite алга (ai:ingest:norm)' : null),
    cmd: NODE,
    args: ['evaluation/norm-golden.mjs'],
    cwd: AI,
    parse: parseExit,
  },
  {
    id: 'eval:conv',
    cls: 'E2E',
    owner: 'C',
    modes: ['e2e'],
    blocking: true,
    blockedIf: () => (!backendProc ? 'энэ tree-ийн backend асаагүй' : !reachable(`${RT_URL}/health`) ? `runtime ${RT_URL} хүрэхгүй (ai:start)` : null),
    cmd: NODE,
    args: ['evaluation/conversation-e2e.mjs', '--api', E2E_API, '--rt', RT_URL],
    cwd: AI,
    parse: parseExit,
  },
  {
    // Эзний шийдвэр (2026-09-14, эцсийн нэгтгэлийн §16): бодит Qwen3-8B дээрх company golden нь СТОХАСТИК —
    // 6/10–8/10 нь MODEL_EVAL АНХААРУУЛГА (E2E blocking БИШ), <6/10 буюу тоо олдохгүй бол blocking; бодит тоо detail-д.
    id: 'eval:company',
    cls: 'MODEL_EVAL',
    owner: 'C',
    modes: ['e2e'],
    blocking: true,
    blockedIf: () => (!backendProc ? 'энэ tree-ийн backend асаагүй' : !reachable(`${RT_URL}/health`) ? `runtime ${RT_URL} хүрэхгүй (ai:start)` : null),
    env: { MGLAI_EVAL_API: E2E_API, MGLAI_EVAL_RUNTIME: RT_URL },
    cmd: NODE,
    args: ['evaluation/company-golden.mjs'],
    cwd: AI,
    parse: parseCompanyGolden,
  },
  {
    id: 'perf:responsiveness',
    cls: 'PERFORMANCE',
    owner: 'C',
    modes: ['e2e'],
    blocking: false,
    blockedIf: () => (!reachable(`${RT_URL}/health`) ? `runtime ${RT_URL} хүрэхгүй` : null),
    cmd: NODE,
    args: ['scripts/bench-responsiveness.mjs'],
    cwd: AI,
    parse: parseExit,
  },
];

/* ------------------------------------------------------------------ */
/*  Гаралт задлагч                                                     */
/* ------------------------------------------------------------------ */
function parseTap(out, code) {
  const n = (k) => {
    const m = out.match(new RegExp(`^# ${k} (\\d+)`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const failures = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim()).filter((s) => !/\.test\.ts$/.test(s));
  const fail = n('fail');
  return { pass: n('pass'), fail, skipped: n('skipped'), status: code === 0 && fail === 0 ? 'PASS' : 'FAIL', failures: failures.slice(0, 10) };
}
function parseExit(out, code) {
  return { pass: code === 0 ? 1 : 0, fail: code === 0 ? 0 : 1, skipped: 0, status: code === 0 ? 'PASS' : 'FAIL', failures: code === 0 ? [] : [out.trim().split('\n').slice(-3).join(' | ').slice(0, 300)] };
}
/** company-golden: «N/10 тэнцэв» — N === нийт → PASS; N ≥ COMPANY_WARN_MIN → FAIL боловч blocking БИШ (стохастик анхааруулга); доош → blocking. */
const COMPANY_WARN_MIN = 6;
function parseCompanyGolden(out, code) {
  const m = out.match(/(\d+)\/(\d+) тэнцэв/);
  const passed = m ? Number(m[1]) : null;
  const total = m ? Number(m[2]) : null;
  const failedCases = [...out.matchAll(/^✗ ([A-Z]) (.+)$/gm)].map((x) => `${x[1]} «${x[2].trim().slice(0, 48)}»`);
  const status = code === 0 && passed !== null && passed === total ? 'PASS' : 'FAIL';
  const blocking = passed === null || total === null || passed < COMPANY_WARN_MIN;
  const label = status === 'PASS' ? '' : blocking ? `BLOCKING (<${COMPANY_WARN_MIN}/${total ?? 10} эсвэл тоо олдсонгүй)` : `MODEL_EVAL анхааруулга (${COMPANY_WARN_MIN}–${(total ?? 10) - 1}/${total ?? 10} стохастик, эзний шийдвэр)`;
  return {
    pass: passed,
    fail: passed !== null && total !== null ? total - passed : 1,
    skipped: 0,
    status,
    blocking,
    failures: status === 'PASS' ? [] : [`${passed ?? '?'}/${total ?? '?'} тэнцэв · ${label} · унасан: ${failedCases.join(' · ') || out.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`],
  };
}
function parseFeChecks(out, code) {
  let pass = 0;
  let fail = 0;
  for (const m of out.matchAll(/(\d+) тэнцсэн, (\d+) унасан/g)) {
    pass += Number(m[1]);
    fail += Number(m[2]);
  }
  return { pass, fail, skipped: 0, status: code === 0 && fail === 0 ? 'PASS' : 'FAIL', failures: code === 0 ? [] : [out.trim().split('\n').pop() ?? ''] };
}

/* ------------------------------------------------------------------ */
/*  Ажиллуулах                                                         */
/* ------------------------------------------------------------------ */
function run(s) {
  const t0 = Date.now();
  const cmdStr = `${s.cmd === NODE ? 'node' : s.cmd} ${s.args.join(' ')}`.replace(/\s+-e\s+"[\s\S]*$/, ' -e <inline>');
  const base = { id: s.id, class: s.cls, owner: s.owner, blocking: s.blocking, cmd: `(${relCwd(s.cwd)}) ${cmdStr}`, pass: null, fail: null, skipped: null };
  if (!s.modes.includes(mode)) return { ...base, status: 'NOT_RUN', ms: 0, note: `горим ${mode}-д ажиллахгүй` };
  if (only && !only.includes(s.id)) return { ...base, status: 'NOT_RUN', ms: 0, note: '--only-д ороогүй' };
  const blocked = s.blockedIf?.();
  if (blocked) return { ...base, status: 'BLOCKED', ms: 0, note: blocked };

  process.stdout.write(`  ▸ ${s.id.padEnd(24)} `);
  const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, encoding: 'utf8', shell: s.shell === true, env: { ...process.env, FORCE_COLOR: '0', ...(s.env ?? {}) }, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const parsed = s.parse(out, r.status ?? 1);
  const ms = Date.now() - t0;
  const icon = parsed.status === 'PASS' ? '✔' : '✖';
  process.stdout.write(`${icon} ${parsed.status}  pass=${parsed.pass ?? '-'} fail=${parsed.fail ?? '-'} skip=${parsed.skipped ?? '-'}  ${ms} мс\n`);
  if (parsed.status === 'FAIL') for (const f of parsed.failures) process.stdout.write(`      ✖ ${f}\n`);
  return { ...base, ...parsed, ms };
}
function relCwd(p) {
  return p === AI ? 'ai' : p === BACKEND ? 'backend' : p === FRONTEND ? 'frontend' : p;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

console.log(`\nMGL AI · mgl-ai:verify --${mode}\n`);
let backendNote = null;
if (mode === 'e2e') {
  backendNote = startBackend();
  console.log(backendNote ? `  ⚠ backend асаагүй: ${backendNote}` : `  ▸ backend (энэ tree) ${E2E_API} · runtime ${RT_URL}${reachable(`${RT_URL}/health`) ? '' : ' (хүрэхгүй)'}\n`);
}
let suites;
try {
  suites = SUITES.map(run);
} finally {
  stopBackend();
}

const versions = collectFromSources();
const compat = evaluateCompatibility(versions);

const gate = composeGate({
  mode,
  git: { commit: git(['rev-parse', '--short', 'HEAD']), branch: git(['branch', '--show-current']), dirty: (git(['status', '--porcelain']) ?? '') !== '' },
  versions,
  suites,
  compat,
  presence,
});

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, JSON.stringify(gate, null, 2), 'utf8');

/* ------------------------------------------------------------------ */
/*  Хүнд уншигдах хураангуй                                            */
/* ------------------------------------------------------------------ */
console.log('\n  Ангилал бүр ТУСДАА:');
for (const c of TEST_CLASSES) {
  const r = gate.results[c];
  const ran = r.suites.filter((s) => s.status !== 'NOT_RUN');
  console.log(`    ${c.padEnd(13)} ${r.status.padEnd(8)} ${ran.map((s) => `${s.id}=${s.status}`).join(' ')}`);
}
console.log('\n  Release-readiness матриц (§35):');
for (const [area, v] of Object.entries(gate.matrix)) console.log(`    ${area.padEnd(20)} ${v.status.padEnd(16)} ${v.note}`);
if (gate.blocking.length) {
  console.log('\n  BLOCKING:');
  for (const b of gate.blocking) console.log(`    ✖ [${b.class}/${b.owner}] ${b.id}: ${b.detail}`);
}
if (gate.warnings.length) {
  console.log('\n  WARNINGS:');
  for (const w of gate.warnings) console.log(`    ⚠ [${w.class}/${w.owner}] ${w.id}: ${w.detail}`);
}
console.log(`\n  releaseReady: ${gate.releaseReady}`);
for (const why of gate.notReadyBecause) console.log(`    – ${why}`);
console.log(`\n  → ${jsonOut}\n`);

// Гаралтын код: энэ горимд АЖИЛЛАСАН blocking suite унасан, эсвэл compat blocking → 1.
const ranFail = suites.some((s) => s.status === 'FAIL' && s.blocking);
const compatFail = compat.blocking.some((i) => i.id !== 'registry-dataset-sha-matches-knowledge' || presence.registry);
process.exit(ranFail || compatFail ? 1 : 0);
