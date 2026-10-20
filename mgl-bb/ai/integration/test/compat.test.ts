/**
 * MGL AI · НИЙЦЛИЙН МАТРИЦ — ТЕСТ (Session D §7, §14, §15).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCompatibility, checkDataDrift, CONSTRAINTS, VERSION_KEYS } from '../src/compat/matrix.ts';
import { collectFromSources, registryIdentities } from '../src/compat/collect.ts';

test('матрицын хязгаарлалт бүр тайлбар, эзэн, зөв түлхүүртэй', () => {
  const ids = new Set<string>();
  for (const c of CONSTRAINTS) {
    assert.ok(!ids.has(c.id), `давхардсан id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.reason.length > 40, `${c.id}: reason хэт богино`);
    assert.ok((VERSION_KEYS as readonly string[]).includes(c.subject), `${c.id}: subject ${c.subject}`);
    if (c.kind === 'equal') assert.ok((VERSION_KEYS as readonly string[]).includes(String(c.target)), `${c.id}: target`);
  }
});

test('бүрэн нийцтэй хослол → ok', () => {
  const r = evaluateCompatibility({
    knowledge: '3',
    knowledgeSchema: '3',
    normRegistry: 'mgl-norm-compiler/1',
    trustedContract: 'tfc-1',
    runtimeApi: '1',
    runtime: '1.0.0',
    datasetIdentity: '1',
    registryManifest: '1',
    promptVersion: 'mglai-sys-6',
  });
  assert.equal(r.ok, true, JSON.stringify(r.blocking));
  assert.equal(r.warnings.length, 0);
});

test('§15: runtime SCHEMA_VERSION 4 + knowledge схем 3 → BLOCKING (мэдлэг устах зам)', () => {
  const r = evaluateCompatibility({ knowledge: '3', knowledgeSchema: '4', normRegistry: 'x', trustedContract: 'tfc-1', runtimeApi: '1', runtime: '1.0.0', datasetIdentity: '1', registryManifest: '1', promptVersion: 'p' });
  assert.equal(r.ok, false);
  assert.ok(r.blocking.some((i) => i.id === 'knowledge-schema-matches-runtime'));
});

test('хувилбар алга → present зөрчил, таамаглахгүй', () => {
  const r = evaluateCompatibility({});
  assert.equal(r.ok, false);
  assert.ok(r.blocking.some((i) => i.id === 'trusted-contract-twin'));
  assert.ok(r.blocking.some((i) => i.id === 'app-requires-runtime-api'));
});

test('§14: knowledge ↔ registry dataset sha', () => {
  const reg = [
    { documentId: 'BD-21-101-12-2012', datasetSha256: 'a'.repeat(64) },
    { documentId: 'ONLY-IN-REGISTRY', datasetSha256: 'c'.repeat(64) },
  ];
  const kn = [
    { documentId: 'BD-21-101-12-2012', datasetSha256: 'b'.repeat(64) },
    { documentId: 'ONLY-IN-KNOWLEDGE', datasetSha256: 'd'.repeat(64) },
  ];
  const issues = checkDataDrift(reg, kn);
  assert.deepEqual(
    issues.map((i) => i.code).sort(),
    ['NORM_DATA_VERSION_MISMATCH', 'REGISTRY_ONLY'],
  );
  // Санд байгаа ч бүртгэлд байхгүй = зөрчил БИШ
  assert.ok(!issues.some((i) => i.documentId === 'ONLY-IN-KNOWLEDGE'));
  // sha мэдээлээгүй (A хараахан гаргаагүй) = тусдаа код, mismatch БИШ
  const missing = checkDataDrift(reg.slice(0, 1), [{ documentId: 'BD-21-101-12-2012', datasetSha256: null }]);
  assert.equal(missing[0]?.code, 'KNOWLEDGE_SHA_MISSING');
});

test('эх кодоос цуглуулсан хувилбарууд — өнөөдрийн бодит зураг', (t) => {
  const v = collectFromSources();
  t.diagnostic(JSON.stringify(v));
  // Заавал олдох ёстой (репод байгаа) тогтмолууд:
  assert.equal(v.runtime, '1.0.0');
  assert.equal(v.knowledgeSchema, '3');
  assert.match(v.trustedContract ?? '', /^tfc-\d+$/, 'tfc twin зөрсөн эсвэл олдсонгүй (backend TRUSTED_CONTRACT_VERSION ∉ frontend validator version union)');
  assert.equal(v.runtimeApi, '1');
  assert.ok(v.promptVersion?.startsWith('mglai-sys-'));
  assert.ok(v.toolSchema?.startsWith('mglai-tools-'));
});

test('эх кодын матриц — blocking зөрчил байвал ИЛ (A/B-ийн WIP merge хийгдэх хүртэл warning гэж хэвлэнэ)', (t) => {
  const v = collectFromSources();
  const r = evaluateCompatibility(v);
  for (const i of [...r.blocking, ...r.warnings]) t.diagnostic(`${i.severity} ${i.id} [${i.owner}]: ${i.detail}`);
  // ⚠️ normRegistry нь A-ийн WIP (uncommitted) — main дээр байхгүй тул энд
  //    unit тест унагахгүй; release gate нь үүнийг BLOCKED_BY_A гэж ангилна.
  const hard = r.blocking.filter((i) => i.id !== 'registry-dataset-sha-matches-knowledge');
  assert.deepEqual(hard.map((i) => i.id), []);
});

test('registryIdentities — A-ийн манифест байвал баримт бүр sha-тай', (t) => {
  const rows = registryIdentities();
  if (rows.length === 0) {
    t.diagnostic('manifest.generated.ts алга (Session A WIP merge хийгдээгүй)');
    return;
  }
  for (const r of rows) assert.match(r.datasetSha256 ?? '', /^[0-9a-f]{64}$/, r.documentId);
});
