/**
 * MGL AI deployment · ЗАГВАРЫН СОЛИЛТ — ГАНЦ СЕМАНТИК (P0-5, Session D 2026-09-14).
 *
 * Run with:  node --test deployment/test/switchModel.test.ts
 *
 *   • smoke давав → rollback ХЭЗЭЭ Ч дуудагдахгүй, reload яг 1
 *   • smoke унав → rollback → reload → хуучин smoke → SMOKE_FAILED_ROLLED_BACK
 *   • хуучин ч ачаалагдахгүй → ROLLBACK_FAILED (нуухгүй)
 *   • rollback өөрөө шидвэл (анхны суулгац, буцах хувилбаргүй) залгигдана
 *   • updater.ts-ийн installBase / applyPendingAdapter ба server-ийн /model/activate нь
 *     ЭНЭ функцээр л явна — fake manager дээр дуудлагын ДАРААЛАЛ канонтой ижил
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { switchModel } from '../src/activation.ts';
import { Updater, CredentialStore } from '../../runtime/src/updater.ts';
import type { ModelManager, ReleaseManifestEntry } from '../../runtime/src/modelManager.ts';

function fakeTarget(opts: { smokeFails?: number[]; rollbackThrows?: boolean } = {}) {
  const calls: string[] = [];
  let smokeCalls = 0;
  return {
    calls,
    target: {
      activate: async () => {
        calls.push('activate');
      },
      rollback: async () => {
        calls.push('rollback');
        if (opts.rollbackThrows) throw new Error('Буцах хувилбар байхгүй.');
      },
      reloadEngine: async () => {
        calls.push('reload');
      },
      smokeTest: async () => {
        smokeCalls++;
        calls.push(`smoke${smokeCalls}`);
        if (opts.smokeFails?.includes(smokeCalls)) throw new Error(`GGUF ачаалагдсангүй #${smokeCalls}`);
      },
    },
  };
}

test('smoke давав → ACTIVATED, rollback дуудагдахгүй', async () => {
  const f = fakeTarget();
  const r = await switchModel(f.target);
  assert.deepEqual(r, { ok: true, code: 'ACTIVATED' });
  assert.deepEqual(f.calls, ['activate', 'reload', 'smoke1']);
});

test('smoke унав → rollback → reload → хуучин smoke → SMOKE_FAILED_ROLLED_BACK', async () => {
  const f = fakeTarget({ smokeFails: [1] });
  const r = await switchModel(f.target);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SMOKE_FAILED_ROLLED_BACK');
  assert.match(r.detail ?? '', /#1/);
  assert.deepEqual(f.calls, ['activate', 'reload', 'smoke1', 'rollback', 'reload', 'smoke2']);
});

test('хуучин ч ачаалагдахгүй → ROLLBACK_FAILED, хоёр шалтгаан хоёулаа', async () => {
  const f = fakeTarget({ smokeFails: [1, 2] });
  const r = await switchModel(f.target);
  assert.equal(r.code, 'ROLLBACK_FAILED');
  assert.match(r.detail ?? '', /#1.*буцаалт.*#2/);
});

test('rollback шидвэл (буцах хувилбаргүй анхны суулгац) залгигдана, дүн нь smoke-оос', async () => {
  const f = fakeTarget({ smokeFails: [1], rollbackThrows: true });
  const r = await switchModel(f.target);
  // Шидэлт залгигдаж, гинж ҮРГЭЛЖИЛНЭ: reload → smoke2; дүн нь smoke2-оос (энд давсан).
  assert.equal(r.code, 'SMOKE_FAILED_ROLLED_BACK');
  assert.deepEqual(f.calls, ['activate', 'reload', 'smoke1', 'rollback', 'reload', 'smoke2']);
});

/* ── updater.ts нь канон гинжээр явдаг эсэх (fake manager) ─────────── */

function fakeManager(calls: string[]): ModelManager {
  return {
    activate: async (uid: string) => {
      calls.push(`m.activate:${uid}`);
      return {} as never;
    },
    rollback: async () => {
      calls.push('m.rollback');
      return {} as never;
    },
    activateAdapter: async (uid: string | null) => {
      calls.push(`m.activateAdapter:${uid}`);
      return {} as never;
    },
    rollbackAdapter: async () => {
      calls.push('m.rollbackAdapter');
      return {} as never;
    },
    activeAdapterRow: async () => null,
    readState: async () => ({ candidateAdapter: 'ad-2', active: 'base-1' }) as never,
    install: async () => {
      calls.push('m.install');
      return {} as never;
    },
  } as unknown as ModelManager;
}

function updaterWith(calls: string[], smokeFail: boolean) {
  let smokes = 0;
  return new Updater({
    manager: fakeManager(calls),
    credentials: new CredentialStore('nul'),
    runtimeVersion: '1.0.0',
    knowledgeDir: 'x',
    controlPlane: 'http://127.0.0.1:1',
    isBusy: () => false,
    reloadEngine: async () => {
      calls.push('reload');
    },
    smokeTest: async () => {
      smokes++;
      calls.push(`smoke${smokes}`);
      if (smokeFail && smokes === 1) throw new Error('эвдэрсэн');
    },
    log: () => undefined,
  });
}

const entry: ReleaseManifestEntry = {
  release_uid: 'base-2',
  version: '0.5',
  runtime_variant: 'employee-8b-q4',
  base_model: 'x',
  quantization: 'Q4_K_M',
  runtime: 'llama.cpp',
  context_tokens: 4096,
  artifact_url: 'u',
  artifact_bytes: 1,
  artifact_sha256: 'a'.repeat(64),
  min_vram_mb: null,
  min_ram_mb: null,
  channel: 'stable',
  build_commit: null,
};

test('updater.installBase: smoke унав → канон дараалал, шидэлт ойлгомжтой', async () => {
  const calls: string[] = [];
  const u = updaterWith(calls, true);
  await assert.rejects(u.installBase(entry, 'tok'), /Загвар ачаалж чадсангүй/);
  assert.deepEqual(calls, ['m.install', 'm.activate:base-2', 'reload', 'smoke1', 'm.rollback', 'reload', 'smoke2']);
});

test('updater.applyPendingAdapter: smoke давав → rollbackAdapter дуудагдахгүй, status ready', async () => {
  const calls: string[] = [];
  const u = updaterWith(calls, false);
  assert.equal(await u.applyPendingAdapter(), true);
  assert.deepEqual(calls, ['m.activateAdapter:ad-2', 'reload', 'smoke1']);
  assert.equal(u.status.phase, 'ready');
});

test('updater.applyPendingAdapter: smoke унав → rollbackAdapter → reload → хуучин smoke, status failed', async () => {
  const calls: string[] = [];
  const u = updaterWith(calls, true);
  assert.equal(await u.applyPendingAdapter(), false);
  assert.deepEqual(calls, ['m.activateAdapter:ad-2', 'reload', 'smoke1', 'm.rollbackAdapter', 'reload', 'smoke2']);
  assert.equal(u.status.phase, 'failed');
  assert.match(u.status.message ?? '', /өмнөх хувилбар үргэлжилж/);
});
