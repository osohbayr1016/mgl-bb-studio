/**
 * MGL AI deployment · МАНИФЕСТ — ТЕСТ (Session B §35).
 *
 * Run with:  node --test deployment/test/manifest.test.ts
 *
 *   • зөв манифест → ok
 *   • бүрэлдэхүүн дутуу / sha буруу / хувилбар буруу → ok=false, код бүр тодорхой
 *   • хагас зөв манифест БҮХЭЛДЭЭ татгалзагдана
 *   • нийцтэй байдал: requires / minRuntime / байхгүй бүрэлдэхүүн
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateManifest, checkCompatibility, type ReleaseManifest } from '../src/manifest.ts';
import { goodManifest } from './fixtures.ts';

const SHA = 'a'.repeat(64);

test('зөв манифест → ok, sha жижиг үсэг болно', () => {
  const r = validateManifest(goodManifest({ components: { ...(goodManifest().components as object), runtime: { version: '1.0.0', sha256: SHA.toUpperCase(), url: 'u', sizeBytes: 1 } } }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.manifest.components.runtime?.sha256, SHA);
    assert.equal(r.manifest.channel, 'stable');
    assert.equal(r.manifest.components.normRegistry?.url, null);
  }
});

test('объект биш → MANIFEST_NOT_OBJECT', () => {
  const r = validateManifest('x');
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.errors, ['MANIFEST_NOT_OBJECT']);
});

test('бүрэлдэхүүн байхгүй → COMPONENTS_MISSING / EMPTY', () => {
  const a = validateManifest(goodManifest({ components: undefined }));
  assert.equal(a.ok, false);
  if (!a.ok) assert.ok(a.errors.includes('COMPONENTS_MISSING'));
  const b = validateManifest(goodManifest({ components: {} }));
  assert.equal(b.ok, false);
  if (!b.ok) assert.ok(b.errors.includes('COMPONENTS_EMPTY'));
});

test('sha буруу → SHA256_INVALID:<component>, БҮХЭЛДЭЭ татгалзана', () => {
  const m = goodManifest();
  (m.components as Record<string, Record<string, unknown>>).model!.sha256 = 'deadbeef';
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.includes('SHA256_INVALID:model'));
    assert.equal(r.errors.length, 1); // бусад нь зөв — гэвч манифест хэрэглэгдэхгүй
  }
});

test('sha байхгүй → мөн татгалзана (checksum заавал)', () => {
  const m = goodManifest();
  delete (m.components as Record<string, Record<string, unknown>>).knowledge!.sha256;
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.includes('SHA256_INVALID:knowledge'));
});

test('мэдэгдэхгүй бүрэлдэхүүн, буруу суваг, буруу схем', () => {
  const r = validateManifest(goodManifest({ channel: 'prod', schema: 'v9', components: { foo: { version: '1', sha256: SHA, url: null } } }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.startsWith('CHANNEL_INVALID')));
    assert.ok(r.errors.some((e) => e.startsWith('SCHEMA_UNSUPPORTED')));
    assert.ok(r.errors.includes('COMPONENT_UNKNOWN:foo'));
  }
});

test('requires өөрийгөө заавал → REQUIRES_SELF', () => {
  const m = goodManifest();
  (m.components as Record<string, Record<string, unknown>>).runtime!.requires = [{ component: 'runtime', min: '1.0.0' }];
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.includes('REQUIRES_SELF:runtime'));
});

function parsed(): ReleaseManifest {
  const r = validateManifest(goodManifest());
  if (!r.ok) throw new Error(r.errors.join(','));
  return r.manifest;
}

test('нийцтэй: бүх шаардлага хангагдсан → хоосон', () => {
  const issues = checkCompatibility(parsed(), { app: '1.0.0', runtime: '1.0.0', model: '0.4', knowledge: 'x', normRegistry: 'nr-18' });
  assert.deepEqual(issues, []);
});

test('нийцгүй: runtime хуучин → REQUIRES_UNMET + MIN_RUNTIME_UNMET', () => {
  const issues = checkCompatibility(parsed(), { app: '1.0.0', runtime: '0.9.0' });
  const codes = issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ['MIN_RUNTIME_UNMET', 'REQUIRES_UNMET']);
  assert.equal(issues.find((i) => i.code === 'REQUIRES_UNMET')?.have, '0.9.0');
});

test('нийцгүй: шаардсан бүрэлдэхүүн ОГТ байхгүй → REQUIRES_MISSING (мэдэхгүй биш)', () => {
  const issues = checkCompatibility(parsed(), { app: '1.0.0' });
  assert.ok(issues.some((i) => i.code === 'REQUIRES_MISSING' && i.component === 'app'));
  assert.ok(issues.some((i) => i.code === 'MIN_RUNTIME_UNMET' && i.have === null));
});

test('1.10 > 1.9 (мөрөөр биш тоогоор)', () => {
  const m = parsed();
  m.compatibility.minRuntimeVersion = '1.9.0';
  assert.deepEqual(checkCompatibility(m, { app: '1.0.0', runtime: '1.10.0' }).filter((i) => i.code === 'MIN_RUNTIME_UNMET'), []);
});
