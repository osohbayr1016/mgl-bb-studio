/**
 * MGL AI deployment · ЭРҮҮЛ МЭНД — ТЕСТ (Session B §35).
 *
 * Run with:  node --test deployment/test/health.test.ts
 *
 *   • бүгд ok → READY
 *   • мэдлэг байхгүй → REPAIR_REQUIRED, KNOWLEDGE=MISSING
 *   • backend offline → LOCAL_AI READY + COMPANY_BACKEND OFFLINE, нийт DEGRADED (fatal БИШ)
 *   • загварын sha таарахгүй → хойд хүнд шалгалтууд АЛГАСАГДАНА
 *   • updating → UPDATING
 *   • norm smoke skipped → NORM DEGRADED, нийт DEGRADED — «давлаа» гэж худал хэлэхгүй
 *   • шалгалт шидвэл → _THREW код, унана (crash биш)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runHealthChecks, healthSummary, type HealthProbes, type CheckOutcome } from '../src/health.ts';
import { mockNormProviders } from '../src/normProviders.ts';

const ok = (code: string): CheckOutcome => ({ ok: true, code });
const bad = (code: string): CheckOutcome => ({ ok: false, code });

function probes(over: Partial<Record<keyof HealthProbes, CheckOutcome | (() => Promise<CheckOutcome>)>> = {}): HealthProbes {
  const mk = (k: keyof HealthProbes, def: CheckOutcome) => {
    const o = over[k];
    if (typeof o === 'function') return o;
    return async () => o ?? def;
  };
  return {
    filesValid: mk('filesValid', ok('FILES_OK')),
    modelExists: mk('modelExists', ok('MODEL_PRESENT')),
    modelShaMatches: mk('modelShaMatches', ok('MODEL_SHA_OK')),
    runtimeStarts: mk('runtimeStarts', ok('RUNTIME_UP')),
    healthReachable: mk('healthReachable', ok('HEALTH_OK')),
    versionsMatch: mk('versionsMatch', ok('VERSION_MATCH_OK')),
    modelLoads: mk('modelLoads', ok('MODEL_LOADED')),
    knowledgeOpens: mk('knowledgeOpens', ok('KNOWLEDGE_OK')),
    knowledgeManifestValid: mk('knowledgeManifestValid', ok('KNOWLEDGE_MANIFEST_OK')),
    generationSmoke: mk('generationSmoke', ok('GENERATION_OK')),
    backendReachable: mk('backendReachable', ok('BACKEND_OK')),
    revitBridge: mk('revitBridge', { ok: true, code: 'REVIT_NOT_INSTALLED', skipped: true }),
  };
}

test('бүгд ok → READY, Revit MISSING нь алдаа биш', async () => {
  const r = await runHealthChecks({ probes: probes(), norm: mockNormProviders({ smokeCalculator: async () => ({ ok: true, code: 'CALC_OK', skipped: false, ms: 1 }) }) });
  assert.equal(r.status, 'READY');
  assert.equal(r.facets.LOCAL_AI.status, 'READY');
  assert.equal(r.facets.REVIT.status, 'MISSING');
  assert.deepEqual(r.reasonCodes, []);
  assert.equal(r.checks.length, 15);
});

test('P0-6: заагч 1.2, процесс 1.1 → VERSION_MISMATCH → DEGRADED, READY БИШ', async () => {
  const r = await runHealthChecks({ probes: probes({ versionsMatch: { ok: false, code: 'VERSION_MISMATCH', detail: 'runtime:1.2!=1.1' } }), norm: mockNormProviders({ smokeCalculator: async () => ({ ok: true, code: 'CALC_OK', skipped: false, ms: 1 }) }) });
  assert.notEqual(r.status, 'READY');
  assert.equal(r.status, 'DEGRADED');
  assert.equal(r.facets.LOCAL_AI.status, 'DEGRADED');
  assert.ok(r.reasonCodes.includes('VERSION_MISMATCH'));
});

test('мэдлэг байхгүй → REPAIR_REQUIRED, KNOWLEDGE=MISSING', async () => {
  const r = await runHealthChecks({ probes: probes({ knowledgeOpens: bad('KNOWLEDGE_NOT_INSTALLED') }), norm: mockNormProviders({ installed: false }) });
  assert.equal(r.status, 'REPAIR_REQUIRED');
  assert.equal(r.facets.KNOWLEDGE.status, 'MISSING');
  assert.equal(r.facets.NORM.status, 'MISSING');
  assert.ok(r.reasonCodes.includes('KNOWLEDGE_NOT_INSTALLED'));
  assert.ok(r.reasonCodes.includes('NORM_NOT_INSTALLED'));
});

test('backend offline → LOCAL_AI READY, COMPANY_BACKEND OFFLINE, нийт DEGRADED', async () => {
  const r = await runHealthChecks({ probes: probes({ backendReachable: bad('BACKEND_UNREACHABLE') }), norm: mockNormProviders({ smokeCalculator: async () => ({ ok: true, code: 'CALC_OK', skipped: false, ms: 1 }) }) });
  assert.equal(r.status, 'DEGRADED');
  assert.equal(r.facets.LOCAL_AI.status, 'READY');
  assert.equal(r.facets.COMPANY_BACKEND.status, 'OFFLINE');
  assert.deepEqual(r.reasonCodes, ['BACKEND_UNREACHABLE']);
});

test('загварын sha таарахгүй → REPAIR_REQUIRED, model_loads/generation АЛГАСАГДАНА', async () => {
  let loads = 0;
  const r = await runHealthChecks({
    probes: probes({
      modelShaMatches: bad('MODEL_SHA_MISMATCH'),
      modelLoads: async () => {
        loads++;
        return ok('x');
      },
    }),
    norm: mockNormProviders(),
  });
  assert.equal(r.status, 'REPAIR_REQUIRED');
  assert.equal(loads, 0);
  const ml = r.checks.find((c) => c.id === 'model_loads')!;
  assert.equal(ml.skipped, true);
  assert.equal(ml.code, 'MODEL_LOADS_SKIPPED_AFTER_FATAL');
  assert.equal(r.checks.find((c) => c.id === 'generation_smoke')!.skipped, true);
});

test('light горим → хүнд шалгалт алгасна, гэхдээ READY биш (DEGRADED — мэдэхгүй)', async () => {
  const r = await runHealthChecks({ probes: probes(), norm: mockNormProviders({ smokeCalculator: async () => ({ ok: true, code: 'CALC_OK', skipped: false, ms: 1 }) }), light: true });
  assert.equal(r.checks.find((c) => c.id === 'model_loads')!.code, 'MODEL_LOADS_SKIPPED_LIGHT');
  assert.equal(r.status, 'DEGRADED');
});

test('updating → UPDATING (шалгалтууд хэвээр ажиллана)', async () => {
  const r = await runHealthChecks({ probes: probes(), norm: mockNormProviders(), updating: true });
  assert.equal(r.status, 'UPDATING');
  assert.equal(r.updating, true);
});

test('тооцоолуурын smoke skipped (Session A гараагүй) → NORM DEGRADED, «давлаа» гэхгүй', async () => {
  const r = await runHealthChecks({ probes: probes(), norm: mockNormProviders() });
  assert.equal(r.facets.NORM.status, 'DEGRADED');
  assert.ok(r.facets.NORM.reasons.includes('NORM_CALC_SMOKE_NOT_EXPOSED'));
  assert.equal(r.status, 'DEGRADED');
  assert.deepEqual(r.reasonCodes, []); // skipped нь reasonCodes-д орохгүй (унаагүй)
});

test('шалгалт шидвэл → _THREW, crash биш', async () => {
  const r = await runHealthChecks({
    probes: probes({
      runtimeStarts: async () => {
        throw new Error('spawn ENOENT');
      },
    }),
    norm: mockNormProviders(),
  });
  const c = r.checks.find((x) => x.id === 'runtime_starts')!;
  assert.equal(c.ok, false);
  assert.equal(c.code, 'RUNTIME_STARTS_THREW');
  assert.equal(c.detail, 'spawn ENOENT');
  assert.equal(r.status, 'REPAIR_REQUIRED');
});

test('healthSummary нь detail агуулахгүй', async () => {
  const r = await runHealthChecks({ probes: probes({ filesValid: { ok: false, code: 'FILE_MISSING', detail: 'C:/Users/secret/x' } }), norm: mockNormProviders() });
  const s = healthSummary(r);
  assert.equal(JSON.stringify(s).includes('secret'), false);
  assert.equal(s.facets.LOCAL_AI, 'REPAIR_REQUIRED');
});
