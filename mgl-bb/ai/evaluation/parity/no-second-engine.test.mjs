/**
 * ХОЁР ДАХЬ ЭЭЛЖИЙН ХӨДӨЛГҮҮР ҮҮСЭХГҮЙ — бүтцийн инвариантууд (Session R, Checkpoint 3B §8).
 *
 * «runTurn» гэдэг үгийг grep-дэхгүй.  Оронд нь:
 *   I1  Канон хөдөлгүүрийн байршил ГАНЦ: `packages/mglai-common/src/turn/engine.ts`, барил `index.ts`,
 *       багцын `exports["./turn"]` тэр барил руу заана.
 *   I2  Хөтөч канон замыг импортолно: `frontend/.../lib/browserTurn.ts` нь `@mgl/mglai-common/turn`-аас
 *       `runTurn`-ыг ИМПОРТОЛЖ (тодорхойлохгүй) дамжуулна; `MglAiPage.tsx` зөвхөн `./lib/browserTurn`-оос авна.
 *   I3  Runtime канон замыг импортолно: `ai/runtime/src/turn.ts` нь `@mgl/mglai-common/turn`-аас импортолно,
 *       `packages/…` харьцангуй замаар БИШ.
 *   I4  Устгасан хуулбар модулиуд ДАХИН ҮҮСЭЭГҮЙ: `frontend/src/features/mgl-ai/lib/{orchestrator,aiEvents,
 *       aiBudget,aiErrors,aiMachine,contract,validator,validate,types}.ts` байхгүй.
 *   I5  Хөдөлгүүрийн ЦӨМИЙН экспортыг (`runTurn`, `enforceContract`, `validateAnswer`, `applyContract`,
 *       `reduce`+`emptyRun`, `classifyError`, `selectMemories`) канон багцаас ГАДНА хэн ч ЭКСПОРТЛОХГҮЙ
 *       (`export function`/`export const`/`export async function` тодорхойлолтоор) — зөвхөн
 *       `packages/mglai-common/src/turn/**` ба хөлдөөсөн оракул `ai/evaluation/parity/legacy/**`.
 *   I6  Хөлдөөсөн оракулыг продакшн код импортолдоггүй: `frontend/src`, `backend/src`, `ai/runtime`,
 *       `ai/deployment`, `ai/retrieval`, `revit-mcp` дотор `parity/legacy` гэсэн импорт байхгүй.
 *   I7  Revit add-in-д оркестраци/validator БАЙХГҮЙ: `revit-mcp/addin` доторх .cs файлуудад `enforceContract`,
 *       `validateAnswer`, `/generate` дуудлага байхгүй (зөвхөн `/turn` SSE уншигч).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const rd = (p) => readFileSync(join(REPO, p), 'utf8');

function walk(dir, exts, out = [], skip = /node_modules|[\\/]dist[\\/]|[\\/]bin[\\/]|[\\/]obj[\\/]|\.git[\\/]/) {
  const abs = join(REPO, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    const rel = relative(REPO, p).replace(/\\/g, '/');
    if (skip.test(p)) continue;
    if (statSync(p).isDirectory()) walk(rel, exts, out, skip);
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
}

test('I1 канон хөдөлгүүрийн байршил ганц, багцын ./turn export барил руу заана', () => {
  assert.ok(existsSync(join(REPO, 'packages/mglai-common/src/turn/engine.ts')));
  const pkg = JSON.parse(rd('packages/mglai-common/package.json'));
  assert.equal(pkg.exports['./turn'], './src/turn/index.ts');
  assert.match(rd('packages/mglai-common/src/turn/index.ts'), /export \* from '\.\/engine\.ts'/);
  assert.match(rd('packages/mglai-common/src/turn/engine.ts'), /^export async function runTurn\(/m);
});

test('I2 хөтөч канон замыг импортолно (browserTurn adapter → @mgl/mglai-common/turn; хуудас зөвхөн adapter-оос)', () => {
  const adapter = rd('frontend/src/features/mgl-ai/lib/browserTurn.ts');
  assert.match(adapter, /import \{[^}]*\brunTurn as engineRunTurn\b[^}]*\} from '@mgl\/mglai-common\/turn'/s);
  // Adapter-ийн runTurn нь ЦЭВЭР дамжуулалт: биед зөвхөн engineRunTurn(input, deps()) байна.
  const body = adapter.match(/^export function runTurn\(input: TurnInput\): Promise<TurnResult> \{\r?\n([\s\S]*?)\r?\n\}/m);
  assert.ok(body, 'adapter runTurn олдсонгүй');
  assert.equal(body[1].trim(), 'return engineRunTurn(input, deps());', 'adapter runTurn нь дамжуулалтаас өөр зүйл хийж байна');
  const page = rd('frontend/src/features/mgl-ai/MglAiPage.tsx');
  assert.match(page, /from '\.\/lib\/browserTurn'/);
  assert.doesNotMatch(page, /from '\.\/lib\/(orchestrator|aiMachine|aiEvents|aiErrors|validator|contract|types)'/);
});

test('I3 runtime канон замыг багцын нэрээр импортолно', () => {
  const turn = rd('ai/runtime/src/turn.ts');
  assert.match(turn, /from '@mgl\/mglai-common\/turn'/);
  assert.doesNotMatch(turn, /packages\/mglai-common\/src/);
});

test('I4 устгасан хөтчийн хуулбар модулиуд дахин үүсээгүй', () => {
  for (const m of ['orchestrator', 'aiEvents', 'aiBudget', 'aiErrors', 'aiMachine', 'contract', 'validator', 'validate', 'types']) {
    assert.ok(!existsSync(join(REPO, `frontend/src/features/mgl-ai/lib/${m}.ts`)), `frontend lib/${m}.ts дахин гарч ирсэн`);
  }
});

test('I5 хөдөлгүүрийн цөмийн экспортыг канон багцаас гадна хэн ч тодорхойлохгүй', () => {
  const CORE = ['runTurn', 'enforceContract', 'validateAnswer', 'applyContract', 'emptyRun', 'classifyError', 'selectMemories', 'renderRetrievalOnly'];
  const files = [
    ...walk('frontend/src', ['.ts', '.tsx']),
    ...walk('backend/src', ['.ts']),
    ...walk('ai/runtime', ['.ts']),
    ...walk('ai/deployment', ['.ts']),
    ...walk('ai/retrieval', ['.ts']),
    ...walk('ai/integration', ['.ts']),
    ...walk('packages', ['.ts']),
  ];
  const offenders = [];
  for (const f of files) {
    if (f.startsWith('packages/mglai-common/src/turn/')) continue;
    if (f.includes('/parity/legacy/')) continue;
    // Хөтчийн adapter — I2-оор батлагдсан ЦЭВЭР дамжуулалт (runTurn нэрийг л хадгална).
    if (f === 'frontend/src/features/mgl-ai/lib/browserTurn.ts') continue;
    const src = readFileSync(join(REPO, f), 'utf8');
    for (const name of CORE) {
      const re = new RegExp(`^export (async )?(function|const|let)\\s+${name}\\b`, 'm');
      if (re.test(src)) offenders.push(`${f}: ${name}`);
    }
  }
  // backend-ийн СЕРВЕР талын validateAnswer (lib/mglai/validate.ts) нь өөр гэрээний хос (prompt-ын өмнөх шалгалт), хөтчийн validator биш —
  // тэр нь Session A/C-ийн эзэмшилд, энэ инвариантын хамрах хүрээнд ОРОХГҮЙ.
  const filtered = offenders.filter((o) => !/^backend\/src\/lib\/mglai\/(validate|trustedFacts|answerContract)\.ts: validateAnswer$/.test(o));
  assert.deepEqual(filtered, [], `канон багцаас гадна цөмийн экспорт: ${filtered.join(', ')}`);
});

test('I6 хөлдөөсөн паритетын оракулыг продакшн код импортолдоггүй', () => {
  const files = [
    ...walk('frontend/src', ['.ts', '.tsx']),
    ...walk('backend/src', ['.ts']),
    ...walk('ai/runtime', ['.ts']),
    ...walk('ai/deployment', ['.ts']),
    ...walk('ai/retrieval', ['.ts']),
    ...walk('revit-mcp/addin', ['.cs']),
  ];
  const bad = files.filter((f) => /parity\/legacy/.test(readFileSync(join(REPO, f), 'utf8')));
  assert.deepEqual(bad, []);
});

test('I7 Revit add-in-д оркестраци, validator, шууд /generate байхгүй (зөвхөн /turn SSE уншигч)', () => {
  const files = walk('revit-mcp/addin', ['.cs']);
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join(REPO, f), 'utf8');
    if (/enforceContract|validateAnswer|applyContract|"\/generate"|'\/generate'|\/generate"/.test(src)) bad.push(f);
  }
  assert.deepEqual(bad, []);
  assert.match(rd('revit-mcp/addin/Intelligence/Ai/MglAiTurnClient.cs'), /"\/turn"/);
});
