/**
 * ҮҮСГЭСЭН БҮРТГЭЛИЙН БҮРЭН БҮТЭН БАЙДАЛ (Amendment A) — багц байхгүй машин дээр ч ажиллана.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { NORM_REGISTRY_MANIFEST, NORM_REGISTRY_DOCUMENTS } = await import('./generated/manifest.generated');
const { normRegistry } = await import('./registry');
const { currentnessOf } = await import('../currentness');

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

test('манифест · баримт бүрийн contentSha256 нь файлын агуулгатай таарна (гараар засвал улаан)', () => {
  assert.equal(NORM_REGISTRY_MANIFEST.documents.length, NORM_REGISTRY_DOCUMENTS.length);
  for (const d of NORM_REGISTRY_DOCUMENTS) {
    const entry = NORM_REGISTRY_MANIFEST.documents.find((m) => m.documentId === d.documentId)!;
    assert.ok(entry, d.documentId);
    const sha = createHash('sha256').update(JSON.stringify(sortKeys(d))).digest('hex');
    assert.equal(entry.contentSha256, sha, `${d.documentId} content sha`);
    assert.equal(entry.datasetSha256, d.datasetSha256);
    assert.match(d.datasetSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(entry.counts, { rules: d.rules.length, formulas: d.formulas.length, clauses: d.clauses.length, cases: d.cases.length });
  }
});

test('currentness · хөрвүүлэгчийн стамп = backend currentnessOf(legalStatusRaw) (хос логикийн зөрүү барина)', () => {
  for (const d of NORM_REGISTRY_DOCUMENTS) assert.equal(d.currentness, currentnessOf(d.legalStatusRaw), d.documentId);
});

test('бүртгэл · код, alias-аар олдоно; дүрэм/томьёо id-аар олдоно; needs_human_review бичлэг гүйцэтгэхгүй', () => {
  const reg = normRegistry();
  const bd = reg.byCode('БД 21-101-12');
  assert.ok(bd);
  assert.equal(reg.byCode('BD 21-101-12'), bd);
  assert.equal(reg.byCode('21-101-12'), bd);
  assert.equal(reg.byCode('bd21-101-12'), bd);
  assert.equal(reg.byCode('БНбД 21-04-05'), null);
  for (const r of bd.rules) {
    assert.equal(r.provenance.documentId, bd.documentId);
    assert.equal(reg.rule(r.ruleId)?.rule, r);
    if (r.provenance.verificationStatus === 'needs_human_review') assert.equal(r.executable, false, r.ruleId);
  }
  for (const f of bd.formulas) {
    assert.equal(reg.formula(f.formulaId)?.formula, f);
    if (f.provenance.verificationStatus === 'needs_human_review') assert.equal(f.executable, false, f.formulaId);
  }
});
