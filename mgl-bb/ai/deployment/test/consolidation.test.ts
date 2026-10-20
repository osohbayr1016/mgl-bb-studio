/**
 * MGL AI deployment · ИДЭВХЖҮҮЛЭЛТИЙН ГАНЦ СЕМАНТИК — ХАМГААЛАЛТ (P0-5).
 *
 * Run with:  node --test deployment/test/consolidation.test.ts
 *
 * Заагч солих / буцаах / lastKnownGood бичих код нь ЗӨВХӨН `deployment/src/activation.ts`
 * (+ `installedState.ts`-ийн бүртгэл) дотор байна.  Runtime-ийн `updater.ts`,
 * `modelManager.ts`, `server.ts`, `bin/*` — хэн нь ч заагчийн файлыг шууд бичих,
 * `installed.json`-ийн components/previous-ийг өөрөө өөрчлөх ёсгүй.
 *
 *   • `ai/runtime/src`-д `current.<component>.json` / `writePointer` / `recordActivation` /
 *     `recordRollback` / `markHealthy` гарч ирвэл УНАНА
 *   • загвар/адаптерын `manager.activate(`… дуудлага ЗӨВХӨН `switchModel({…})` дотор (доор)
 *   • `updater.ts` нь `installKnowledgePack`-ийг ДАХИН дуудвал УНАНА (хуучин .pack зам)
 *   • `bin/update.ts` нь заагч бичихгүй — `runUpdate`-ээр л
 *   • `deployment/src`-д `writePointer` / `switchModel` нь activation.ts-д Л тодорхойлогдоно
 *
 * ⚠️ `modelManager.ts`-ийн `activate/rollback` нь ЗАГВАРЫН (state.json) семантик —
 *    activation.ts түүнийг `ModelActivator`/`switchModel`-оор ДУУДДАГ, давхардуулдаггүй.
 *    Тэр файлд заагчийн (current.*.json) бичилт гарч ирвэл л унана.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AI = join(here, '..', '..');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|mjs|js)$/.test(n) && !n.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Тайлбар дурдах нь код биш — тайлбарыг хасаад шалгана. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const POINTER_MUTATION = [/current\.(runtime|app|knowledge|normRegistry|revit)\.json/, /\bwritePointer\b/, /\brecordActivation\b/, /\brecordRollback\b/, /\bmarkHealthy\b/, /lastKnownGoodRelease\s*=/];

test('ai/runtime/src нь заагч/идэвхжүүлэлтийн төлөвийг ӨӨРӨӨ бичдэггүй', () => {
  const hits: string[] = [];
  for (const f of files(join(AI, 'runtime', 'src'))) {
    const src = code(readFileSync(f, 'utf8'));
    for (const re of POINTER_MUTATION) if (re.test(src)) hits.push(`${f.replace(AI, '')}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

/**
 * P0-5 (Session D 2026-09-14): ЗАГВАР/АДАПТЕРЫН activate→smoke→rollback семантик ЗӨВХӨН
 * `activation.ts switchModel`.  `ai/runtime/src`-д `manager.activate(`/`rollback(`/
 * `activateAdapter(`/`rollbackAdapter(` дуудлага нь ЗӨВХӨН `switchModel({ … })`-ийн
 * `activate:`/`rollback:` шинж дотор байж болно — өөр газар гарвал хоёр дахь
 * идэвхжүүлэлтийн хэрэгжүүлэлт гэсэн үг, УНАНА.  `modelManager.ts` нь тодорхойлолт (state.json
 * бичигч), дуудагч биш — түүнд `this.activate(` гэх мэт дотоод дуудлага л байж болно.
 *
 * Хэмжсэн (2026-09-14, Session D dry-run): `updater.ts` 408/415/478/484 + `server.ts` 1328/1336
 * нь тус бүр өөрийн activate→reload→load→rollback гинжтэй байв — гурван хуулбар.
 */
const MODEL_SWITCH_CALL = /\bmanager\.(activate|rollback|activateAdapter|rollbackAdapter)\(/;

test('ai/runtime/src + deployment/bin: manager.activate/rollback дуудлага ЗӨВХӨН switchModel({…}) дотор', () => {
  const bad: string[] = [];
  for (const f of [...files(join(AI, 'runtime', 'src')), ...files(join(AI, 'deployment', 'bin'))]) {
    const src = code(readFileSync(f, 'utf8'));
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!MODEL_SWITCH_CALL.test(line)) return;
      const isTargetProp = /^\s*(activate|rollback):\s*\(\)\s*=>\s*/.test(line);
      const window = lines.slice(Math.max(0, i - 8), i).join('\n');
      if (!isTargetProp || !/switchModel\(\{/.test(window)) bad.push(`${f.replace(AI, '')}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('switchModel нь deployment/src/activation.ts-д Л тодорхойлогдоно', () => {
  const defs: string[] = [];
  for (const f of [...files(join(AI, 'deployment', 'src')), ...files(join(AI, 'runtime', 'src'))]) {
    if (/function switchModel\b/.test(readFileSync(f, 'utf8'))) defs.push(f.replace(AI, '').replace(/\\/g, '/'));
  }
  assert.deepEqual(defs, ['/deployment/src/activation.ts']);
});

test('updater.ts нь installKnowledgePack (хуучин .pack зам)-ийг дуудахгүй, activateKnowledge-ээр л', () => {
  const src = code(readFileSync(join(AI, 'runtime', 'src', 'updater.ts'), 'utf8'));
  assert.equal(/installKnowledgePack/.test(src), false);
  assert.equal(/activateKnowledge/.test(src), true);
});

test('deployment/bin/* заагч бичихгүй — runUpdate/activateSingleComponent-ээр', () => {
  for (const f of files(join(AI, 'deployment', 'bin'))) {
    const src = code(readFileSync(f, 'utf8'));
    for (const re of POINTER_MUTATION) assert.equal(re.test(src), false, `${f}: ${re}`);
  }
});

test('writePointer нь deployment/src/activation.ts-д Л тодорхойлогдоно', () => {
  const defs: string[] = [];
  for (const f of files(join(AI, 'deployment', 'src'))) {
    if (/function writePointer\b/.test(readFileSync(f, 'utf8'))) defs.push(f.replace(AI, ''));
  }
  assert.deepEqual(defs.map((d) => d.replace(/\\/g, '/')), ['/deployment/src/activation.ts']);
});

test('server.ts нь мэдлэгийн санг заагчаар нээнэ (resolveKnowledgeDb), шууд замаар биш', () => {
  const src = readFileSync(join(AI, 'runtime', 'src', 'server.ts'), 'utf8');
  assert.equal(/resolveKnowledgeDb\(/.test(src), true);
  assert.equal(/openKnowledgeDb\(\{ path: cfg\.knowledgeDb \}\)/.test(src), false);
});

/**
 * Редакцын хуулбар ч мөн ХОРИОТОЙ (GAP-027, Session D-ийн канон): ai/deployment-д
 * нууцын regex жагсаалт (`SECRET_VALUE_RES` г.м.) буцаж гарвал унана — `redactText` нь
 * `packages/mglai-common`-ийн re-export.
 */
test('ai/deployment/src-д нууцын regex хуулбар байхгүй — redactText нь канон re-export', () => {
  const tel = readFileSync(join(AI, 'deployment', 'src', 'telemetry.ts'), 'utf8');
  assert.equal(/SECRET_VALUE_RES/.test(code(tel)), false);
  // Bare `@mgl/mglai-common/redaction` (2026-09-16): relative `../../../packages/…` зам нь
  // багцалсан runtime-д (app\versions\<v>\) хүрдэггүй байсан — publish-installer.mjs нь
  // тэр package-ийг JS болгож node_modules-д тавьдаг тул bare specifier л ажиллана.
  assert.ok(
    /export \{ redactText \} from '(@mgl\/mglai-common\/redaction|\.\.\/\.\.\/\.\.\/packages\/mglai-common\/src\/redaction\.ts)'/.test(tel),
  );
  for (const f of files(join(AI, 'deployment', 'src'))) {
    const src = code(readFileSync(f, 'utf8'));
    assert.equal(/eyJ\[A-Za-z0-9_-\]/.test(src), false, `${f}: JWT regex хуулбар`);
    assert.equal(/Bearer\\s\+/.test(src), false, `${f}: Bearer regex хуулбар`);
  }
});
