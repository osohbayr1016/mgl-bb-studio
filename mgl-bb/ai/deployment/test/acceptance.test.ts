/**
 * MGL AI deployment · СУУЛГАЦЫН ХҮЛЭЭН АВАЛТЫН HARNESS (Session B §37, §38).
 *
 * Run with:  node --test deployment/test/acceptance.test.ts
 *
 *   цэвэр төлөв → bootstrap (манифестаас) → runtime «асна» → загвар танигдана →
 *   мэдлэг танигдана → health READY → smoke үүсгэлт → heartbeat бүртгэл →
 *   шинэчлэлтийн симуляц → буцаалтын симуляц
 *
 * ⚠️ GGUF ХУУЛБАРГҮЙ (§38): «загвар» нь 64 байтын fixture, ModelActivator нь
 *    fake.  Windows VM-гүй үед энэ нь хамгийн ойрын детерминист симуляц;
 *    үлдсэн ГАНЦ бодит шалгалт нь `docs/mgl-ai/DEPLOYMENT.md`-д
 *    («Бодит PC дээрх нэг шалгалт»).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, copyFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { resolveLayout, ensureLayout } from '../src/layout.ts';
import { InstalledStateStore } from '../src/installedState.ts';
import { validateManifest } from '../src/manifest.ts';
import { planUpdate } from '../src/updatePlan.ts';
import { runUpdate, readPointer, type UpdateDeps } from '../src/activation.ts';
import { runHealthChecks, type HealthProbes, type CheckOutcome } from '../src/health.ts';
import { mockNormProviders } from '../src/normProviders.ts';
import { buildHeartbeat, sendHeartbeat } from '../src/heartbeat.ts';
import { verifyFile } from '../src/integrity.ts';
import { assertNoSensitive } from '../src/telemetry.ts';
import { buildDiagnosticBundle } from '../src/diagnostics.ts';
import type { HardwareProfile } from '../../runtime/src/hardware.ts';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const HW: HardwareProfile = {
  os: 'win32 10.0.26200', arch: 'x64', cpu: 'i7', cpuCores: 20, cpuPhysicalCores: 12, ramMb: 32000, freeRamMb: 8000,
  gpu: 'RTX 3070', vramMb: 8192, vramFreeMb: 7000, cuda: '12.6', isLaptop: false, onBattery: false, detectedAt: 't',
};

test('хүлээн авалт: суулгац → READY → heartbeat → шинэчлэлт → буцаалт', async () => {
  /* ── 0. цэвэр төлөв ────────────────────────────────────────────── */
  const root = await mkdtemp(join(tmpdir(), 'mglai-accept-'));
  const layout = resolveLayout(root);
  await ensureLayout(layout);
  const store = new InstalledStateStore(layout.installedFile);
  const src = join(root, '_cdn');
  await mkdir(src);

  const art = async (name: string, body: string) => {
    const buf = Buffer.from(body);
    await writeFile(join(src, name), buf);
    return { url: `cdn://${name}`, sha256: sha(buf), sizeBytes: buf.length };
  };
  const rt1 = await art('runtime-1.0.0.zip', 'runtime code v1');
  const k1 = await art('knowledge-1.sqlite', 'SQLite format 3 (fixture) v1');
  const m1 = await art('model-0.4.gguf', 'GGUF fixture v0.4 ' + 'x'.repeat(40));

  // fake ModelActivator — modelManager-ийн оронд, ижил гэрээ
  const modelDir = join(layout.models);
  type ActiveModel = { path: string; sha256: string; version: string } | null;
  const slot: { active: ActiveModel; prev: ActiveModel } = { active: null, prev: null };
  let modelHealthy = true;
  const model: NonNullable<UpdateDeps['model']> = {
    activate: async (spec) => {
      const p = join(modelDir, `${spec.version}.gguf`);
      await copyFile(join(src, spec.url!.replace('cdn://', '')), p);
      const v = await verifyFile(p, spec.sha256);
      if (!v.ok) throw new Error(v.code);
      if (!modelHealthy) throw new Error('GGUF ачаалагдсангүй');
      slot.prev = slot.active;
      slot.active = { path: p, sha256: v.sha256, version: spec.version };
      return { path: p, sha256: v.sha256 };
    },
    rollback: async () => {
      slot.active = slot.prev;
    },
  };

  // health probes — файлын систем дээрх БОДИТ шалгалт (fixture файлууд)
  const backend = { online: true };
  const probes: HealthProbes = {
    filesValid: async () => ({ ok: (await readPointer(layout, 'runtime')) !== null, code: 'RUNTIME_FILES' }),
    modelExists: async () => ({ ok: slot.active !== null, code: slot.active ? 'MODEL_PRESENT' : 'MODEL_MISSING' }),
    modelShaMatches: async (): Promise<CheckOutcome> => {
      if (!slot.active) return { ok: false, code: 'MODEL_MISSING' };
      const v = await verifyFile(slot.active.path, slot.active.sha256);
      return { ok: v.ok, code: v.ok ? 'MODEL_SHA_OK' : v.code };
    },
    runtimeStarts: async () => ({ ok: true, code: 'RUNTIME_UP' }),
    healthReachable: async () => ({ ok: true, code: 'HEALTH_OK' }),
    versionsMatch: async () => ({ ok: true, code: 'VERSION_MATCH_OK' }),
    modelLoads: async () => ({ ok: modelHealthy, code: modelHealthy ? 'MODEL_LOADED' : 'MODEL_LOAD_FAILED' }),
    knowledgeOpens: async (): Promise<CheckOutcome> => {
      const p = await readPointer(layout, 'knowledge');
      if (!p) return { ok: false, code: 'KNOWLEDGE_NOT_INSTALLED' };
      const head = (await readFile(p.path, 'utf8')).slice(0, 15);
      return { ok: head === 'SQLite format 3', code: head === 'SQLite format 3' ? 'KNOWLEDGE_OK' : 'KNOWLEDGE_CORRUPT' };
    },
    knowledgeManifestValid: async () => ({ ok: true, code: 'KNOWLEDGE_MANIFEST_OK' }),
    generationSmoke: async () => ({ ok: modelHealthy, code: 'GENERATION_OK' }),
    backendReachable: async () => ({ ok: backend.online, code: backend.online ? 'BACKEND_OK' : 'BACKEND_UNREACHABLE' }),
    revitBridge: async () => ({ ok: true, code: 'REVIT_NOT_INSTALLED', skipped: true }),
  };
  const norm = mockNormProviders({ smokeCalculator: async () => ({ ok: true, code: 'CALC_OK', skipped: false, ms: 1 }) });
  const health = () => runHealthChecks({ probes, norm });

  const deps: UpdateDeps = {
    layout,
    store,
    model,
    download: async (url, dest) => copyFile(join(src, url.replace('cdn://', '')), dest),
    healthCheck: async () => {
      const h = await health();
      return { ok: h.status === 'READY' || h.status === 'DEGRADED', code: h.status };
    },
  };

  /* ── 1. bootstrap — анхны манифест ─────────────────────────────── */
  const rel1 = validateManifest({
    schema: 'mgl-ai-release/1', releaseId: 'rel-2026.09.11.1', channel: 'stable', createdAt: '2026-09-11T00:00:00Z',
    components: {
      runtime: { version: '1.0.0', ...rt1 },
      model: { id: 'mgl-qwen3-8b', version: '0.4', ...m1, meta: { minHardwareClass: 'LOW_GPU' } },
      knowledge: { version: 'norms-2026.09.11.1', ...k1, meta: { fileName: 'knowledge.sqlite', schemaVersion: 3 } },
      normRegistry: { version: 'nr-18', sha256: k1.sha256, url: null, sizeBytes: null },
    },
    compatibility: { minRuntimeVersion: '1.0.0' },
  });
  assert.ok(rel1.ok);
  if (!rel1.ok) return;

  // Суулгахаас ӨМНӨ health → REPAIR_REQUIRED (юу ч байхгүй)
  assert.equal((await health()).status, 'REPAIR_REQUIRED');

  const plan1 = planUpdate({ manifest: rel1.manifest, installed: await store.read(), hardwareClass: 'STANDARD_8GB_GPU' });
  assert.equal(plan1.ok, true);
  assert.equal(plan1.actions.length, 4);
  const r1 = await runUpdate(plan1, deps);
  assert.equal(r1.code, 'ACTIVATED');

  /* ── 2. загвар + мэдлэг танигдана, health READY ────────────────── */
  const h1 = await health();
  assert.equal(h1.status, 'READY');
  assert.equal(h1.facets.LOCAL_AI.status, 'READY');
  assert.equal(h1.facets.KNOWLEDGE.status, 'READY');
  const s1 = await store.read();
  assert.equal(s1.components.model?.version, '0.4');
  assert.equal(s1.components.knowledge?.version, 'norms-2026.09.11.1');
  assert.equal(s1.lastKnownGoodRelease, 'rel-2026.09.11.1');

  /* ── 3. heartbeat бүртгэл (fake сервер) ────────────────────────── */
  const received: Record<string, unknown>[] = [];
  const hb = buildHeartbeat({ installed: s1, hardware: HW, health: h1, level: 'MINIMAL' })!;
  assertNoSensitive(hb);
  const resp = await sendHeartbeat(
    {
      controlPlane: 'https://worker.test',
      token: 'tok',
      fetchImpl: (async (_u: string, init: RequestInit) => {
        received.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ ok: true, channel: 'canary' }), { status: 200 });
      }) as unknown as typeof fetch,
    },
    hb,
  );
  assert.equal(resp.ok, true);
  assert.equal(resp.channel, 'canary');
  assert.equal(received[0]!.installation_id, s1.installationId);
  assert.equal((received[0]!.versions as { model: string }).model, '0.4');
  assert.equal((received[0]!.health as { status: string }).status, 'READY');

  /* ── 4. offline: локал READY, backend OFFLINE ───────────────────── */
  backend.online = false;
  const hOff = await health();
  assert.equal(hOff.facets.LOCAL_AI.status, 'READY');
  assert.equal(hOff.facets.COMPANY_BACKEND.status, 'OFFLINE');
  assert.equal(hOff.status, 'DEGRADED');
  backend.online = true;

  /* ── 5. шинэчлэлт: ЗӨВХӨН мэдлэг (загвар татагдахгүй) ──────────── */
  const k2 = await art('knowledge-2.sqlite', 'SQLite format 3 (fixture) v2');
  const rel2 = validateManifest({
    ...(rel1.manifest as unknown as Record<string, unknown>),
    releaseId: 'rel-2026.09.12.1',
    components: { ...rel1.manifest.components, knowledge: { version: 'norms-2026.09.12.1', ...k2, meta: { fileName: 'knowledge.sqlite' } }, normRegistry: { version: 'nr-19', sha256: k2.sha256, url: null, sizeBytes: null } },
  });
  assert.ok(rel2.ok);
  if (!rel2.ok) return;
  const plan2 = planUpdate({ manifest: rel2.manifest, installed: await store.read(), hardwareClass: 'STANDARD_8GB_GPU' });
  assert.deepEqual(plan2.actions.map((a) => a.component).sort(), ['knowledge', 'normRegistry']);
  const r2 = await runUpdate(plan2, deps);
  assert.equal(r2.code, 'ACTIVATED');
  assert.equal((await readPointer(layout, 'knowledge'))?.version, 'norms-2026.09.12.1');
  assert.equal((await store.read()).lastKnownGoodRelease, 'rel-2026.09.12.1');
  assert.equal(slot.active?.version, '0.4'); // загвар хөндөгдөөгүй

  /* ── 6. буцаалт: шинэ загвар health унав → 0.4 сэргэнэ ──────────── */
  const m2 = await art('model-0.5.gguf', 'GGUF fixture v0.5 ' + 'y'.repeat(40));
  const rel3 = validateManifest({
    ...(rel2.manifest as unknown as Record<string, unknown>),
    releaseId: 'rel-2026.09.13.1',
    components: { ...rel2.manifest.components, model: { id: 'mgl-qwen3-8b', version: '0.5', ...m2 } },
  });
  assert.ok(rel3.ok);
  if (!rel3.ok) return;
  modelHealthy = false; // 0.5 ачаалагдахгүй
  const plan3 = planUpdate({ manifest: rel3.manifest, installed: await store.read() });
  assert.deepEqual(plan3.actions.map((a) => a.component), ['model']);
  const r3 = await runUpdate(plan3, deps);
  assert.equal(r3.code, 'MODEL_FAILED');
  modelHealthy = true;
  assert.equal(slot.active?.version, '0.4');
  const s3 = await store.read();
  assert.equal(s3.components.model?.version, '0.4');
  assert.equal(s3.lastKnownGoodRelease, 'rel-2026.09.12.1');
  assert.equal((await health()).status, 'READY');

  /* ── 7. буцаалт #2: загвар идэвхжсэн ч health унав → өмнөх сэргэнэ ─ */
  const r4plan = planUpdate({ manifest: rel3.manifest, installed: await store.read() });
  // Health: 0.5 идэвхтэй үед унана, 0.4 руу буцсаны дараа эрүүл.
  const failingDeps: UpdateDeps = { ...deps, healthCheck: async () => (slot.active?.version === '0.5' ? { ok: false, code: 'GENERATION_SMOKE_FAILED' } : { ok: true, code: 'OK' }) };
  const r4 = await runUpdate(r4plan, failingDeps);
  assert.equal(r4.code, 'HEALTH_FAILED_ROLLED_BACK');
  assert.deepEqual(r4.rolledBack, ['model']);
  assert.equal(r4.rollbackOk, true);
  assert.equal(slot.active?.version, '0.4');
  assert.equal((await store.read()).components.model?.version, '0.4');

  /* ── 8. диагностик багц гарна, нууцгүй ─────────────────────────── */
  const diag = buildDiagnosticBundle({ layout, installed: await store.read(), telemetryLevel: 'MINIMAL', health: await health(), hardware: { hardwareClass: 'STANDARD_8GB_GPU', os: HW.os, arch: HW.arch, ramMb: HW.ramMb, gpu: HW.gpu, vramMb: HW.vramMb } });
  assert.equal(diag.ok, true, diag.ok ? "" : `diagnostics violations: ${diag.violations.join(", ")}`);
});
