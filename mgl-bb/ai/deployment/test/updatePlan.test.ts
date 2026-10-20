/**
 * MGL AI deployment · ШИНЭЧЛЭЛТИЙН ТӨЛӨВЛӨГӨӨ — ТЕСТ (Session B §35).
 *
 * Run with:  node --test deployment/test/updatePlan.test.ts
 *
 *   • шинэчлэлт алга · зөвхөн загвар · зөвхөн мэдлэг · зөвхөн app · олон
 *   • ижил хувилбар, өөр sha → шинэчлэнэ
 *   • нийцгүй → ok=false, actions хэвээр (админ харна)
 *   • хардверийн ангилал хүрэхгүй → blocked
 *   • буулгалт өгөгдмөлөөр татгалзана
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateManifest, type ReleaseManifest } from '../src/manifest.ts';
import { emptyState, type InstalledState } from '../src/installedState.ts';
import { planUpdate, describePlanMn } from '../src/updatePlan.ts';
import { goodManifest } from './fixtures.ts';

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);

function manifest(mut?: (m: Record<string, unknown>) => void): ReleaseManifest {
  const raw = goodManifest();
  mut?.(raw);
  const r = validateManifest(raw);
  if (!r.ok) throw new Error(r.errors.join(','));
  return r.manifest;
}

function installedAll(): InstalledState {
  const s = emptyState('2026-09-11T00:00:00Z');
  const c = (version: string, sha = SHA) => ({ version, sha256: sha, path: '/x', installedAt: 't', releaseId: 'r0' });
  s.components = {
    app: c('1.0.0'),
    runtime: c('1.0.0'),
    model: c('0.4'),
    knowledge: c('norms-2026.09.11.3'),
    normRegistry: c('nr-18'),
  };
  s.currentRelease = 'r0';
  return s;
}

test('шинэчлэлт алга → actions хоосон, ok', () => {
  const p = planUpdate({ manifest: manifest(), installed: installedAll() });
  assert.equal(p.actions.length, 0);
  assert.equal(p.ok, true);
  assert.equal(p.unchanged.length, 5);
  assert.equal(describePlanMn(p), 'MGL AI шинэчлэгдсэн байна.');
});

test('шинэ суулгац → бүх бүрэлдэхүүн missing', () => {
  const p = planUpdate({ manifest: manifest(), installed: emptyState() });
  assert.equal(p.actions.length, 5);
  assert.ok(p.actions.every((a) => a.reason === 'missing' && a.from === null));
  assert.equal(p.totalBytes, 100 + 100 + 5_000_000_000 + 5_000_000);
});

test('зөвхөн загвар → ганц action, мэдлэг ХӨНДӨГДӨХГҮЙ', () => {
  const m = manifest((r) => {
    (r.components as Record<string, Record<string, unknown>>).model!.version = '0.5';
    (r.components as Record<string, Record<string, unknown>>).model!.sha256 = SHA2;
  });
  const p = planUpdate({ manifest: m, installed: installedAll() });
  assert.deepEqual(p.actions.map((a) => [a.component, a.from, a.to, a.reason]), [['model', '0.4', '0.5', 'version']]);
  assert.ok(p.unchanged.includes('knowledge'));
  assert.equal(p.totalBytes, 5_000_000_000);
  assert.equal(describePlanMn(p), 'MGL AI шинэчлэл: AI загвар · 4768 MB');
});

test('зөвхөн мэдлэг + бүртгэл → загвар ТАТАГДАХГҮЙ', () => {
  const m = manifest((r) => {
    const c = r.components as Record<string, Record<string, unknown>>;
    c.knowledge!.version = 'norms-2026.09.12.1';
    c.knowledge!.sha256 = SHA2;
    c.normRegistry!.version = 'nr-19';
  });
  const p = planUpdate({ manifest: m, installed: installedAll() });
  assert.deepEqual(p.actions.map((a) => a.component).sort(), ['knowledge', 'normRegistry']);
  assert.equal(p.totalBytes, 5_000_000); // normRegistry url=null → 0
});

test('зөвхөн app → 100 байт', () => {
  const m = manifest((r) => {
    (r.components as Record<string, Record<string, unknown>>).app!.version = '1.0.1';
  });
  const p = planUpdate({ manifest: m, installed: installedAll() });
  assert.deepEqual(p.actions.map((a) => a.component), ['app']);
  assert.equal(p.totalBytes, 100);
});

test('ижил хувилбар, ӨӨР sha → reason=sha', () => {
  const m = manifest((r) => {
    (r.components as Record<string, Record<string, unknown>>).runtime!.sha256 = SHA2;
  });
  const p = planUpdate({ manifest: m, installed: installedAll() });
  assert.deepEqual(p.actions.map((a) => [a.component, a.reason]), [['runtime', 'sha']]);
});

test('олон бүрэлдэхүүн: app 1.1 нь runtime ≥1.1 шаардана, runtime мөн шинэчлэгдэж байвал ok', () => {
  const m = manifest((r) => {
    const c = r.components as Record<string, Record<string, unknown>>;
    c.app!.version = '1.1.0';
    c.app!.requires = [{ component: 'runtime', min: '1.1.0' }];
    c.runtime!.version = '1.1.0';
  });
  const p = planUpdate({ manifest: m, installed: installedAll() });
  assert.equal(p.ok, true);
  assert.deepEqual(p.actions.map((a) => a.component).sort(), ['app', 'runtime']);
});

test('нийцгүй: app 1.1 шаардана runtime ≥1.1, гэвч runtime манифестад хуучин → ok=false', () => {
  const m = manifest((r) => {
    const c = r.components as Record<string, Record<string, unknown>>;
    c.app!.version = '1.1.0';
    c.app!.requires = [{ component: 'runtime', min: '1.1.0' }];
  });
  const p = planUpdate({ manifest: m, installed: installedAll() });
  assert.equal(p.ok, false);
  assert.equal(p.issues[0]?.code, 'REQUIRES_UNMET');
  assert.equal(p.actions.length, 1); // төлөвлөгөө харагдана, идэвхжихгүй
  assert.equal(describePlanMn(p), 'MGL AI шинэчлэл энэ компьютерт тохирсонгүй.');
});

test('хардверийн ангилал хүрэхгүй → blocked, бусад нь явна', () => {
  const m = manifest((r) => {
    const c = r.components as Record<string, Record<string, unknown>>;
    c.model!.version = '0.5';
    c.model!.meta = { minHardwareClass: 'STANDARD_8GB_GPU' };
    c.app!.version = '1.0.1';
  });
  const p = planUpdate({ manifest: m, installed: installedAll(), hardwareClass: 'CPU_FALLBACK' });
  assert.deepEqual(p.blocked.map((b) => [b.component, b.code]), [['model', 'HARDWARE_CLASS_UNMET']]);
  assert.deepEqual(p.actions.map((a) => a.component), ['app']);
  assert.equal(p.ok, false);
});

test('буулгалт өгөгдмөлөөр татгалзана, allowDowngrade бол зөвшөөрнө', () => {
  const m = manifest((r) => {
    (r.components as Record<string, Record<string, unknown>>).runtime!.version = '0.9.0';
  });
  const a = planUpdate({ manifest: m, installed: installedAll() });
  assert.equal(a.blocked[0]?.code, 'DOWNGRADE_REFUSED');
  const b = planUpdate({ manifest: m, installed: installedAll(), allowDowngrade: true });
  assert.equal(b.actions[0]?.downgrade, true);
});

test('force → бүгд forced (repair)', () => {
  const p = planUpdate({ manifest: manifest(), installed: installedAll(), force: true });
  assert.equal(p.actions.length, 5);
  assert.ok(p.actions.every((a) => a.reason === 'forced'));
});
