/**
 * MGL AI · РЕЛИЗИЙН МАНИФЕСТ (сервер) — ТЕСТ (Session B §35).
 *
 * Run with:  node --test src/lib/mglai/releases/manifest.test.ts
 *
 *   • угсралт: sha-гүй загвар → алдаа; адаптер суурь зөрвөл → алдаа
 *   • төлөвийн машин: CANDIDATE → STABLE шууд БАЙХГҮЙ
 *   • сувгаар сонголт: stable зөвхөн STABLE, canary → CANARY эсвэл STABLE
 *   • diff
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { assembleManifest, canTransitionManifest, manifestForChannel, diffManifests, channelForStatus, MANIFEST_STATUSES } =
  await import('./manifest.ts');

const SHA = 'a'.repeat(64);
const model = (over: Partial<Record<string, unknown>> = {}) => ({
  release_uid: 'rel_8b_04',
  version: '0.4',
  artifact_url: 'https://r2/model.gguf',
  artifact_bytes: 5_000_000_000,
  artifact_sha256: SHA,
  quantization: 'Q4_K_M',
  min_vram_mb: 7500,
  minimum_runtime_version: '1.0.0',
  kind: 'base',
  base_release_uid: null,
  ...over,
});
const knowledge = { pack_id: 'norms', version: 'norms-2026.09.11.1', url: 'https://r2/k.sqlite', sha256: SHA, bytes: 5_000_000 };
const runtimeCode = { component: 'runtime-code', version: '1.0.0', url: 'https://r2/rt.zip', sha256: SHA, bytes: 150_000 };

test('бүрэн угсралт → 5 бүрэлдэхүүн, model.requires runtime, minHardwareClass', () => {
  const r = assembleManifest({ releaseId: 'rel-1', createdAt: '2026-09-11T00:00:00Z', model: model(), adapter: null, knowledge, runtimeCode, normRegistryVersion: 'nr-18', revit: null });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const m = r.manifest;
  assert.deepEqual(Object.keys(m.components).sort(), ['knowledge', 'model', 'normRegistry', 'runtime']);
  assert.deepEqual(m.components.model?.requires, [{ component: 'runtime', min: '1.0.0' }]);
  assert.equal(m.components.model?.meta?.minHardwareClass, 'STANDARD_8GB_GPU');
  assert.equal(m.components.normRegistry?.url, null);
  assert.equal(m.channel, 'admin');
  assert.equal(m.schema, 'mgl-ai-release/1');
});

test('sha-гүй загвар → MODEL_SHA_MISSING (дараа нэмнэ гэсэн зам байхгүй)', () => {
  const r = assembleManifest({ releaseId: 'r', createdAt: 't', model: model({ artifact_sha256: null }), adapter: null, knowledge: null, runtimeCode: null, normRegistryVersion: null, revit: null });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.includes('MODEL_SHA_MISSING'));
});

test('адаптер өөр суурьт → ADAPTER_BASE_MISMATCH; таарвал model.version = base+adapter', () => {
  const bad = assembleManifest({ releaseId: 'r', createdAt: 't', model: model(), adapter: model({ release_uid: 'ad1', version: '0.4-lora', kind: 'adapter', base_release_uid: 'OTHER' }), knowledge: null, runtimeCode: null, normRegistryVersion: null, revit: null });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.includes('ADAPTER_BASE_MISMATCH'));
  const good = assembleManifest({ releaseId: 'r', createdAt: 't', model: model(), adapter: model({ release_uid: 'ad1', version: '0.4-lora', kind: 'adapter', base_release_uid: 'rel_8b_04' }), knowledge: null, runtimeCode: null, normRegistryVersion: null, revit: null });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.manifest.components.model?.version, '0.4+0.4-lora');
    assert.equal(good.manifest.components.model?.meta?.adapterReleaseUid, 'ad1');
  }
});

test('normRegistry мэдлэггүй → алдаа; бүрэлдэхүүнгүй → NO_COMPONENTS', () => {
  const a = assembleManifest({ releaseId: 'r', createdAt: 't', model: null, adapter: null, knowledge: null, runtimeCode: null, normRegistryVersion: 'nr-1', revit: null });
  assert.equal(a.ok, false);
  if (!a.ok) assert.deepEqual(a.errors.sort(), ['NORM_REGISTRY_WITHOUT_KNOWLEDGE', 'NO_COMPONENTS']);
});

test('төлөвийн машин: CANDIDATE→STABLE байхгүй, ARCHIVED эцсийн', () => {
  assert.equal(canTransitionManifest('CANDIDATE', 'STABLE'), false);
  assert.equal(canTransitionManifest('CANDIDATE', 'APPROVED'), true);
  assert.equal(canTransitionManifest('APPROVED', 'CANARY'), true);
  assert.equal(canTransitionManifest('CANARY', 'STABLE'), true);
  assert.equal(canTransitionManifest('STABLE', 'ROLLED_BACK'), true);
  for (const s of MANIFEST_STATUSES) assert.equal(canTransitionManifest('ARCHIVED', s), false);
  assert.equal(channelForStatus('STABLE'), 'stable');
  assert.equal(channelForStatus('APPROVED'), 'admin');
});

test('сувгаар сонголт', () => {
  const rows = [
    { release_id: 'r1', status: 'STABLE', created_at: '2026-09-01' },
    { release_id: 'r2', status: 'CANARY', created_at: '2026-09-05' },
    { release_id: 'r3', status: 'APPROVED', created_at: '2026-09-10' },
    { release_id: 'r4', status: 'CANDIDATE', created_at: '2026-09-11' },
  ];
  assert.equal(manifestForChannel(rows, 'stable')?.release_id, 'r1');
  assert.equal(manifestForChannel(rows, 'canary')?.release_id, 'r2');
  assert.equal(manifestForChannel(rows, 'admin')?.release_id, 'r3');
  assert.equal(manifestForChannel(rows.filter((r) => r.status === 'CANDIDATE'), 'stable'), null);
  // canary-д CANARY байхгүй бол STABLE
  assert.equal(manifestForChannel(rows.filter((r) => r.status !== 'CANARY'), 'canary')?.release_id, 'r1');
});

test('diffManifests зөвхөн өөрчлөгдсөнийг', () => {
  const a = assembleManifest({ releaseId: 'r1', createdAt: 't', model: model(), adapter: null, knowledge, runtimeCode, normRegistryVersion: null, revit: null });
  const b = assembleManifest({ releaseId: 'r2', createdAt: 't', model: model(), adapter: null, knowledge: { ...knowledge, version: 'norms-2', sha256: 'b'.repeat(64) }, runtimeCode, normRegistryVersion: null, revit: null });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(diffManifests(a.manifest, b.manifest), [{ component: 'knowledge', from: 'norms-2026.09.11.1', to: 'norms-2' }]);
  assert.equal(diffManifests(null, b.manifest).length, 3);
});
