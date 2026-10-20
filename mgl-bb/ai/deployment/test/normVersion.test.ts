/**
 * MGL AI · normVersion — B-ийн NormProviders-ийн бүртгэлтэй тулгах бүрхүүл (Session D §8/§14).
 *   node --test deployment/test/normVersion.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normCompatibility, withRegistryVersion } from '../src/normVersion.ts';
import { mockNormProviders } from '../src/normProviders.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function fakeFetch(map: Record<string, unknown | null>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [k, v] of Object.entries(map)) {
      if (url.endsWith(k)) {
        if (v === null) return new Response('down', { status: 503 });
        return new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    throw new TypeError('fetch failed');
  }) as typeof fetch;
}

const info = (sha: string | null, extra: Record<string, unknown> = {}) => ({
  installed: true,
  knowledge_version: 'kf1:0123456789abcdef',
  schema_version: 3,
  runtime_schema_version: 3,
  documents: [{ document_id: 'BD-21-101-12-2012', document_code: 'БД 21-101-12', dataset_id: 'x', dataset_version: '0.2.0', dataset_sha256: sha }],
  ...extra,
});
const registry = (sha: string) => ({
  registry_version: 'rf1:fedcba9876543210',
  documents: [{ document_id: 'BD-21-101-12-2012', document_code: 'БД 21-101-12', dataset_id: 'x', dataset_version: '0.2.0', dataset_sha256: sha }],
});

const deps = (f: typeof fetch, controlPlane: string | null = 'https://cp') => ({
  runtimeUrl: 'http://rt',
  runtimeHeaders: { 'x-mglai-secret': 's' },
  controlPlane,
  token: async () => 'jwt',
  fetchImpl: f,
});

test('таарсан → version() хоёр хурууны хээ, health ok хэвээр', async () => {
  const f = fakeFetch({ '/norm/info': info(A), '/api/mgl-ai/norm-registry': registry(A) });
  const p = withRegistryVersion(mockNormProviders(), deps(f));
  assert.deepEqual(await p.version(), { knowledgeVersion: 'kf1:0123456789abcdef', registryVersion: 'rf1:fedcba9876543210', schemaVersion: '3' });
  const h = await p.health();
  assert.equal(h.ok, true);
  assert.equal(h.code, 'NORM_OK');
});

test('sha зөрөв → NORM_DATA_VERSION_MISMATCH, ok=false (READY биш)', async () => {
  const f = fakeFetch({ '/norm/info': info(A), '/api/mgl-ai/norm-registry': registry(B) });
  const p = withRegistryVersion(mockNormProviders(), deps(f));
  const h = await p.health();
  assert.equal(h.ok, false);
  assert.equal(h.code, 'NORM_DATA_VERSION_MISMATCH');
  assert.match(h.detail ?? '', /BD-21-101-12-2012/);
  const c = await normCompatibility(deps(f));
  assert.equal(c.status, 'mismatch');
});

test('бүртгэл хүрэхгүй (backend offline) → ok ХЭВЭЭР, детайлд NORM_REGISTRY_UNREACHABLE', async () => {
  const f = fakeFetch({ '/norm/info': info(A), '/api/mgl-ai/norm-registry': null });
  const p = withRegistryVersion(mockNormProviders(), deps(f));
  const h = await p.health();
  assert.equal(h.ok, true);
  assert.match(h.detail ?? '', /NORM_REGISTRY_UNREACHABLE/);
  assert.equal((await p.version()).registryVersion, null);
});

test('control plane / токен байхгүй → registry_unreachable, unknown-оос ялгаатай', async () => {
  const f = fakeFetch({ '/norm/info': info(A) });
  assert.equal((await normCompatibility(deps(f, null))).status, 'registry_unreachable');
  const noToken = { ...deps(f), token: async () => null };
  assert.equal((await normCompatibility(noToken)).status, 'registry_unreachable');
});

test('хуучин шингээлт (sha-гүй) → unknown, health ok боловч детайл', async () => {
  const f = fakeFetch({ '/norm/info': info(null), '/api/mgl-ai/norm-registry': registry(A) });
  const p = withRegistryVersion(mockNormProviders(), deps(f));
  const h = await p.health();
  assert.equal(h.ok, true);
  assert.match(h.detail ?? '', /NORM_DATA_VERSION_UNKNOWN/);
});

test('схем зөрөв (§15) → NORM_SCHEMA_MISMATCH fatal', async () => {
  const f = fakeFetch({ '/norm/info': info(A, { schema_version: 3, runtime_schema_version: 4 }), '/api/mgl-ai/norm-registry': registry(A) });
  const p = withRegistryVersion(mockNormProviders(), deps(f));
  const h = await p.health();
  assert.equal(h.ok, false);
  assert.equal(h.code, 'NORM_SCHEMA_MISMATCH');
});

test('мэдлэг суулгаагүй → суурь health-ийн код хэвээр (NOT_INSTALLED), бүртгэл татахгүй', async () => {
  let registryCalls = 0;
  const f = (async (input: string | URL | Request) => {
    if (String(input).endsWith('/norm-registry')) registryCalls++;
    return new Response(JSON.stringify({ installed: false }), { status: 200 });
  }) as typeof fetch;
  const p = withRegistryVersion(mockNormProviders({ installed: false }), deps(f));
  const h = await p.health();
  assert.equal(h.code, 'NORM_NOT_INSTALLED');
  assert.equal(registryCalls, 0);
});
