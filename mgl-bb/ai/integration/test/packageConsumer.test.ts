/**
 * ХЭРЭГЛЭГЧИЙН SMOKE — `@mgl/mglai-common/turn` нь ЖИНХЭНЭ багцын export мөн үү
 * (Session R, Checkpoint 3B §1).
 *
 * Нотлох зүйл: runtime нь эх кодын байршлаар (`../../../packages/...`) БИШ, багцын
 * нэрээр (`ai/package.json` → `file:../packages/mglai-common` → node_modules холбоос →
 * `exports` зураглал) импортолж чадна; барил `src/turn/index.ts` бүх нийтийн гадаргууг
 * өгнө; дэд зам `./turn/*` ажиллана.
 *
 * ⚠️ Node нь node_modules доторх .ts-ийн төрлийг хуулдаггүй — гэхдээ `file:` хамаарал
 *    симлинк тул realpath нь packages/ дотор (node_modules-ийн гадна) → ажиллана.
 *    Энэ тест тэр таамаглалыг ХЭМЖИНЭ (realpath шалгалт).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const AI_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PKG_SRC = resolve(AI_DIR, '..', 'packages', 'mglai-common', 'src');

test('package: @mgl/mglai-common/turn resolves through node_modules to the package source', () => {
  const url = import.meta.resolve('@mgl/mglai-common/turn');
  const real = realpathSync(fileURLToPath(url));
  assert.equal(real, resolve(PKG_SRC, 'turn', 'index.ts'));
  assert.ok(!real.includes('node_modules'), 'realpath must be outside node_modules (type stripping)');
});

test('package: barrel exposes the engine + transports + events + memory surface', async () => {
  const m = await import('@mgl/mglai-common/turn');
  for (const fn of ['runTurn', 'renderRetrievalOnly', 'createBackendTransport', 'createLocalRuntimeTransport', 'reduce', 'emptyRun', 'classifyError', 'selectMemories', 'upsertFromHint', 'newRequestId']) {
    assert.equal(typeof (m as Record<string, unknown>)[fn], 'function', `${fn} missing from barrel`);
  }
  assert.ok(Array.isArray(m.AI_STAGES));
  assert.ok(m.STAGE_BUDGET);
});

test('package: subpaths ./turn/validator and ./turn/contract resolve (name-colliding modules stay on subpaths)', async () => {
  const v = await import('@mgl/mglai-common/turn/validator');
  const c = await import('@mgl/mglai-common/turn/contract');
  assert.equal(typeof v.enforceContract, 'function');
  assert.equal(typeof v.validateAnswer, 'function');
  assert.equal(typeof c.applyContract, 'function');
});

test('package: runtime imports the engine by package name, not by source layout', () => {
  for (const rel of ['runtime/src/turn.ts', 'runtime/src/server.ts']) {
    const src = readFileSync(resolve(AI_DIR, rel), 'utf8');
    assert.doesNotMatch(src, /from '\.\.\/\.\.\/\.\.\/packages\/mglai-common\//, `${rel} imports by relative source path`);
    assert.match(src, /from '@mgl\/mglai-common\//);
  }
});
