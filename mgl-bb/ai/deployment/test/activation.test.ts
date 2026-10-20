/**
 * MGL AI deployment · ИДЭВХЖҮҮЛЭЛТ / БУЦААЛТ — ТЕСТ (Session B §35, §37, §38).
 *
 * Run with:  node --test deployment/test/activation.test.ts
 *
 * Бодит файлын систем (temp хавтас), ЖИЖИГ fixture файлууд — GGUF хуулбар
 * БАЙХГҮЙ.  «Татах» = локал файлаас хуулах.
 *
 *   • sha буруу → идэвхжихгүй, staging устана, заагч хөндөгдөхгүй
 *   • шинэ мэдлэг health унав → өмнөх мэдлэг буцна (заагч + installed.json)
 *   • app + runtime хамт идэвхжээд health унав → ХОЁУЛАА буцна
 *   • давтан update → UP_TO_DATE, юу ч татахгүй
 *   • lastKnownGood зөвхөн health давсны дараа
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, copyFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { resolveLayout, ensureLayout, componentHome } from '../src/layout.ts';
import { InstalledStateStore } from '../src/installedState.ts';
import { validateManifest, type ReleaseManifest } from '../src/manifest.ts';
import { planUpdate } from '../src/updatePlan.ts';
import { runUpdate, readPointer, type UpdateDeps } from '../src/activation.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'mglai-deploy-'));
  const layout = resolveLayout(root);
  await ensureLayout(layout);
  const src = join(root, '_src');
  await mkdir(src, { recursive: true });
  const store = new InstalledStateStore(layout.installedFile);

  const artifacts = new Map<string, Buffer>();
  const putArtifact = async (name: string, body: string) => {
    const buf = Buffer.from(body);
    await writeFile(join(src, name), buf);
    artifacts.set(`fixture://${name}`, buf);
    return { url: `fixture://${name}`, sha256: sha(buf), sizeBytes: buf.length };
  };

  const downloads: string[] = [];
  const deps: UpdateDeps & { health: { ok: boolean; code: string } } = {
    layout,
    store,
    health: { ok: true, code: 'OK' },
    download: async (url, dest) => {
      downloads.push(url);
      const name = url.replace('fixture://', '');
      await copyFile(join(src, name), dest);
    },
    healthCheck: async () => deps.health,
    log: () => undefined,
  };
  return { root, layout, store, deps, putArtifact, downloads };
}

function manifestOf(releaseId: string, components: Record<string, unknown>): ReleaseManifest {
  const r = validateManifest({ schema: 'mgl-ai-release/1', releaseId, channel: 'stable', createdAt: '2026-09-11T00:00:00Z', components, compatibility: {} });
  if (!r.ok) throw new Error(r.errors.join(','));
  return r.manifest;
}

test('анхны суулгац: мэдлэг + runtime идэвхжинэ, заагч + installed.json бичигдэнэ, lastKnownGood тавигдана', async () => {
  const h = await harness();
  const k = await h.putArtifact('k1.sqlite', 'knowledge v1');
  const rt = await h.putArtifact('rt1.zip', 'runtime v1');
  const m = manifestOf('rel-1', {
    knowledge: { version: '2026.09.11.1', ...k, meta: { fileName: 'knowledge.sqlite' } },
    runtime: { version: '1.0.0', ...rt },
  });
  const plan = planUpdate({ manifest: m, installed: await h.store.read() });
  const r = await runUpdate(plan, h.deps);
  assert.equal(r.code, 'ACTIVATED');
  assert.deepEqual(r.activated.sort(), ['knowledge', 'runtime']);

  const p = await readPointer(h.layout, 'knowledge');
  assert.equal(p?.version, '2026.09.11.1');
  assert.equal(await readFile(p!.path, 'utf8'), 'knowledge v1');
  assert.ok(p!.path.endsWith('knowledge.sqlite'));

  const s = await h.store.read();
  assert.equal(s.components.knowledge?.version, '2026.09.11.1');
  assert.equal(s.currentRelease, 'rel-1');
  assert.equal(s.lastKnownGoodRelease, 'rel-1');
  assert.ok(s.installationId.startsWith('ins_'));
});

test('sha буруу → SHA_MISMATCH, staging устгагдана, заагч хөндөгдөхгүй', async () => {
  const h = await harness();
  const k = await h.putArtifact('k1.sqlite', 'knowledge v1');
  const m = manifestOf('rel-bad', { knowledge: { version: '1', url: k.url, sizeBytes: k.sizeBytes, sha256: 'f'.repeat(64) } });
  const r = await runUpdate(planUpdate({ manifest: m, installed: await h.store.read() }), h.deps);
  assert.equal(r.code, 'SHA_MISMATCH');
  assert.equal(await readPointer(h.layout, 'knowledge'), null);
  await assert.rejects(stat(join(h.layout.staging, 'knowledge-1.part')));
  await assert.rejects(stat(join(h.layout.staging, 'knowledge-1')));
  const s = await h.store.read();
  assert.equal(s.components.knowledge, undefined);
  assert.equal(s.currentRelease, null);
});

test('шинэ мэдлэг health унав → өмнөх мэдлэг буцна, хуучин файл ҮЛДЭНЭ, lastKnownGood хуучнаараа', async () => {
  const h = await harness();
  const k1 = await h.putArtifact('k1.sqlite', 'knowledge v1');
  const k2 = await h.putArtifact('k2.sqlite', 'knowledge v2 (эвдэрсэн)');
  const m1 = manifestOf('rel-1', { knowledge: { version: '1', ...k1, meta: { fileName: 'knowledge.sqlite' } } });
  assert.equal((await runUpdate(planUpdate({ manifest: m1, installed: await h.store.read() }), h.deps)).code, 'ACTIVATED');
  const before = (await readPointer(h.layout, 'knowledge'))!;

  // Health нь ИДЭВХТЭЙ хувилбараас хамаарна: v2 эвдэрсэн, v1 эрүүл — буцаалтын дараах шалгалт v1-ийг READY гэнэ.
  h.deps.healthCheck = async () => ((await readPointer(h.layout, 'knowledge'))?.version === '2' ? { ok: false, code: 'KNOWLEDGE_OPEN_FAILED' } : { ok: true, code: 'OK' });
  const m2 = manifestOf('rel-2', { knowledge: { version: '2', ...k2, meta: { fileName: 'knowledge.sqlite' } } });
  const r = await runUpdate(planUpdate({ manifest: m2, installed: await h.store.read() }), h.deps);
  assert.equal(r.code, 'HEALTH_FAILED_ROLLED_BACK');
  assert.deepEqual(r.rolledBack, ['knowledge']);
  assert.equal(r.rollbackOk, true);
  assert.equal(r.rollbackReason, 'HEALTH_FAILED: KNOWLEDGE_OPEN_FAILED');

  const after = (await readPointer(h.layout, 'knowledge'))!;
  assert.equal(after.version, '1');
  assert.equal(after.path, before.path);
  assert.equal(await readFile(after.path, 'utf8'), 'knowledge v1');
  // Шинэ хувилбарын хавтас устгагдаагүй (repair/дахин оролдлого хэрэглэж болно).
  const v2dir = join(componentHome(h.layout, 'knowledge').versionsDir, '2');
  assert.ok((await stat(v2dir)).isDirectory());

  const s = await h.store.read();
  assert.equal(s.components.knowledge?.version, '1');
  assert.equal(s.lastKnownGoodRelease, 'rel-1');
  assert.equal(s.currentRelease, 'rel-2'); // оролдсон релиз — previousRelease-ээс rel-1 руу буцах мэдээлэл хадгалагдана
  assert.equal(s.previousRelease, 'rel-1');
});

test('app + runtime хамт идэвхжээд health унав → ХОЁУЛАА буцна', async () => {
  const h = await harness();
  const a1 = await h.putArtifact('a1', 'app 1');
  const r1 = await h.putArtifact('r1', 'rt 1');
  const m1 = manifestOf('rel-1', { app: { version: '1.0.0', ...a1 }, runtime: { version: '1.0.0', ...r1 } });
  assert.equal((await runUpdate(planUpdate({ manifest: m1, installed: await h.store.read() }), h.deps)).code, 'ACTIVATED');

  const a2 = await h.putArtifact('a2', 'app 2');
  const r2 = await h.putArtifact('r2', 'rt 2');
  h.deps.healthCheck = async () => ((await readPointer(h.layout, 'runtime'))?.version === '1.1.0' ? { ok: false, code: 'GENERATION_SMOKE_FAILED' } : { ok: true, code: 'OK' });
  const m2 = manifestOf('rel-2', { app: { version: '1.1.0', ...a2, requires: [{ component: 'runtime', min: '1.1.0' }] }, runtime: { version: '1.1.0', ...r2 } });
  const r = await runUpdate(planUpdate({ manifest: m2, installed: await h.store.read() }), h.deps);
  assert.equal(r.code, 'HEALTH_FAILED_ROLLED_BACK');
  assert.deepEqual(r.rolledBack.sort(), ['app', 'runtime']);
  assert.equal((await readPointer(h.layout, 'app'))?.version, '1.0.0');
  assert.equal((await readPointer(h.layout, 'runtime'))?.version, '1.0.0');
});

test('давтан update → UP_TO_DATE, юу ч татахгүй', async () => {
  const h = await harness();
  const k = await h.putArtifact('k1.sqlite', 'knowledge v1');
  const m = manifestOf('rel-1', { knowledge: { version: '1', ...k } });
  await runUpdate(planUpdate({ manifest: m, installed: await h.store.read() }), h.deps);
  const n = h.downloads.length;
  const r = await runUpdate(planUpdate({ manifest: m, installed: await h.store.read() }), h.deps);
  assert.equal(r.code, 'UP_TO_DATE');
  assert.equal(h.downloads.length, n);
});

test('нийцгүй төлөвлөгөө → PLAN_NOT_OK, юу ч татахгүй', async () => {
  const h = await harness();
  const a = await h.putArtifact('a1', 'app');
  const m = manifestOf('rel-x', { app: { version: '1.0.0', ...a, requires: [{ component: 'runtime', min: '1.0.0' }] } });
  const r = await runUpdate(planUpdate({ manifest: m, installed: await h.store.read() }), h.deps);
  assert.equal(r.code, 'PLAN_NOT_OK');
  assert.equal(h.downloads.length, 0);
});

test('загвар: ModelActivator-оор, унавал бусад буцна', async () => {
  const h = await harness();
  const k = await h.putArtifact('k1.sqlite', 'k');
  let rolled = 0;
  h.deps.model = {
    activate: async () => {
      throw new Error('GGUF ачаалагдсангүй');
    },
    rollback: async () => {
      rolled++;
    },
  };
  const m = manifestOf('rel-m', {
    knowledge: { version: '1', ...k },
    model: { version: '0.5', sha256: 'c'.repeat(64), url: 'fixture://none', sizeBytes: 1 },
  });
  const r = await runUpdate(planUpdate({ manifest: m, installed: await h.store.read() }), h.deps);
  assert.equal(r.code, 'MODEL_FAILED');
  assert.deepEqual(r.rolledBack, ['knowledge']);
  assert.equal(rolled, 0); // загвар идэвхжээгүй тул буцаах юмгүй
  assert.equal(await readPointer(h.layout, 'knowledge'), null);
});

/* ── P1: диск · тасарсан · эвдэрсэн · цуцлагдсан · сүлжээ ─────────────── */

test('P1 зай хүрэлцэхгүй → INSUFFICIENT_SPACE, юу ч татахгүй, заагч хэвээр', async () => {
  const h = await harness();
  const k1 = await h.putArtifact('k1.sqlite', 'knowledge v1');
  const m1 = manifestOf('rel-1', { knowledge: { version: '1', ...k1, meta: { fileName: 'knowledge.sqlite' } } });
  assert.equal((await runUpdate(planUpdate({ manifest: m1, installed: await h.store.read() }), h.deps)).code, 'ACTIVATED');
  const k2 = await h.putArtifact('k2.sqlite', 'knowledge v2');
  const m2 = manifestOf('rel-2', { knowledge: { version: '2', url: k2.url, sha256: k2.sha256, sizeBytes: 3_000_000_000 } });
  const n = h.downloads.length;
  const r = await runUpdate(planUpdate({ manifest: m2, installed: await h.store.read() }), { ...h.deps, freeBytes: async () => 1_000_000_000 });
  assert.equal(r.code, 'INSUFFICIENT_SPACE');
  assert.equal(h.downloads.length, n);
  assert.equal((await readPointer(h.layout, 'knowledge'))?.version, '1');
  assert.equal((await h.store.read()).components.knowledge?.version, '1');
});

test('P1 сүлжээ тасарсан / ENOSPC дундуур → .part устгагдана, идэвхтэй хувилбар хэвээр', async () => {
  const h = await harness();
  const k1 = await h.putArtifact('k1.sqlite', 'knowledge v1');
  const m1 = manifestOf('rel-1', { knowledge: { version: '1', ...k1, meta: { fileName: 'knowledge.sqlite' } } });
  assert.equal((await runUpdate(planUpdate({ manifest: m1, installed: await h.store.read() }), h.deps)).code, 'ACTIVATED');
  const k2 = await h.putArtifact('k2.sqlite', 'knowledge v2');
  const m2 = manifestOf('rel-2', { knowledge: { version: '2', ...k2 } });

  for (const [msg, code] of [
    ['ECONNRESET: socket hang up', 'DOWNLOAD_FAILED'],
    ['ENOSPC: no space left on device', 'INSUFFICIENT_SPACE'],
  ] as const) {
    const r = await runUpdate(planUpdate({ manifest: m2, installed: await h.store.read() }), {
      ...h.deps,
      download: async (_u, dest) => {
        await writeFile(dest, 'хагас'); // тасарсан .part
        throw new Error(msg);
      },
    });
    assert.equal(r.code, code);
    await assert.rejects(stat(join(h.layout.staging, 'knowledge-2.part')));
    assert.equal((await readPointer(h.layout, 'knowledge'))?.version, '1');
  }
});

test('P1 цуцлагдсан татаж авалт (AbortSignal) → DOWNLOAD_FAILED, .part үгүй', async () => {
  const h = await harness();
  const k2 = await h.putArtifact('k2.sqlite', 'knowledge v2');
  const m2 = manifestOf('rel-2', { knowledge: { version: '2', ...k2 } });
  const ac = new AbortController();
  const r = await runUpdate(
    planUpdate({ manifest: m2, installed: await h.store.read() }),
    {
      ...h.deps,
      download: async (_u, dest, _p, signal) => {
        await writeFile(dest, 'хагас');
        ac.abort();
        if (signal?.aborted) throw new Error('цуцлагдсан');
      },
    },
    { signal: ac.signal },
  );
  assert.equal(r.code, 'DOWNLOAD_FAILED');
  await assert.rejects(stat(join(h.layout.staging, 'knowledge-2.part')));
  assert.equal(await readPointer(h.layout, 'knowledge'), null);
});

test('P1 эвдэрсэн (хуучирсан .ok-той) staging → дахин татна, sha таарахгүй бол устгана', async () => {
  const h = await harness();
  const k = await h.putArtifact('k1.sqlite', 'knowledge v1');
  // Өмнөх оролдлогын үлдэгдэл: .ok тэмдэгтэй ч агуулга эвдэрсэн
  await writeFile(join(h.layout.staging, 'knowledge-1'), 'эвдэрсэн');
  await writeFile(join(h.layout.staging, 'knowledge-1.ok'), '{"sha256":"x"}');
  const m = manifestOf('rel-1', { knowledge: { version: '1', ...k, meta: { fileName: 'knowledge.sqlite' } } });
  const r = await runUpdate(planUpdate({ manifest: m, installed: await h.store.read() }), h.deps);
  assert.equal(r.code, 'ACTIVATED'); // дахин татаж зөв файлыг идэвхжүүлсэн
  assert.equal(h.downloads.length, 1);
  assert.equal(await readFile((await readPointer(h.layout, 'knowledge'))!.path, 'utf8'), 'knowledge v1');
});

test('P1 cleanStaleStaging: .part ба хуучин файл устана, шинэ .ok-той файл үлдэнэ, versions/ хөндөгдөхгүй', async () => {
  const h = await harness();
  const { cleanStaleStaging } = await import('../src/activation.ts');
  await writeFile(join(h.layout.staging, 'model-0.5.part'), 'x');
  await writeFile(join(h.layout.staging, 'runtime-1.1'), 'fresh');
  await writeFile(join(h.layout.staging, 'runtime-0.9'), 'old');
  const old = Date.now() - 30 * 24 * 3600_000;
  const { utimes } = await import('node:fs/promises');
  await utimes(join(h.layout.staging, 'runtime-0.9'), new Date(old), new Date(old));
  const removed = await cleanStaleStaging(h.layout);
  assert.deepEqual(removed.sort(), ['model-0.5.part', 'runtime-0.9']);
  await stat(join(h.layout.staging, 'runtime-1.1'));
});

test('last-update.json — амжилт ба буцаалтын шалтгаан бичигдэнэ', async () => {
  const h = await harness();
  const { lastUpdateFile } = await import('../src/activation.ts');
  const k1 = await h.putArtifact('k1.sqlite', 'k1');
  const m1 = manifestOf('rel-1', { knowledge: { version: '1', ...k1 } });
  await runUpdate(planUpdate({ manifest: m1, installed: await h.store.read() }), h.deps);
  let rec = JSON.parse(await readFile(lastUpdateFile(h.layout), 'utf8')) as { code: string; rollbackReason: string | null };
  assert.equal(rec.code, 'ACTIVATED');
  const k2 = await h.putArtifact('k2.sqlite', 'k2');
  const m2 = manifestOf('rel-2', { knowledge: { version: '2', ...k2 } });
  h.deps.healthCheck = async () => ((await readPointer(h.layout, 'knowledge'))?.version === '2' ? { ok: false, code: 'BAD' } : { ok: true, code: 'OK' });
  await runUpdate(planUpdate({ manifest: m2, installed: await h.store.read() }), h.deps);
  rec = JSON.parse(await readFile(lastUpdateFile(h.layout), 'utf8')) as { code: string; rollbackReason: string | null };
  assert.equal(rec.code, 'HEALTH_FAILED_ROLLED_BACK');
  assert.equal(rec.rollbackReason, 'HEALTH_FAILED: BAD');
});
