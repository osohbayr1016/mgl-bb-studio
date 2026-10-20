/**
 * MGL AI deployment · ТЕЛЕМЕТРИЙН НУУЦЛАЛ + ДИАГНОСТИК + ЛОГ — ТЕСТ (Session B §35).
 *
 * Run with:  node --test deployment/test/telemetry.test.ts
 *
 *   • OFF → null
 *   • MINIMAL → зөвхөн цагаан жагсаалт; prompt/answer/token ХЭЗЭЭ Ч явахгүй
 *   • QUALITY → intent/tool_route нэмэгдэнэ, агуулга хэвээр явахгүй
 *   • цагаан жагсаалтад санамсаргүй нууц түлхүүр нэмсэн ч FORBIDDEN давхарга барина
 *   • heartbeat ачаалалд hostname/JWT байхгүй
 *   • диагностик багц: JWT бүхий лог мөр redact-лагдана; credential.json ОРОХГҮЙ
 *   • лог эргэлт: maxBytes давахад .1.log үүснэ, maxFiles-аас хэтрэхгүй
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildTelemetryEvent, findSensitiveKeys, assertNoSensitive, redactText, allowedKeysFor } from '../src/telemetry.ts';
import * as canon from '../../../packages/mglai-common/src/redaction.ts';
import { buildHeartbeat } from '../src/heartbeat.ts';
import { buildDiagnosticBundle } from '../src/diagnostics.ts';
import { createLogger } from '../src/logger.ts';
import { emptyState } from '../src/installedState.ts';
import { resolveLayout, ensureLayout } from '../src/layout.ts';
import { runHealthChecks, type HealthProbes } from '../src/health.ts';
import { mockNormProviders } from '../src/normProviders.ts';
import type { HardwareProfile } from '../../runtime/src/hardware.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyLCJyb2xlIjoiYWRtaW4ifQ.abcdefghijklmnopqrstuvwxyz0123456789';

const RAW = {
  installation_id: 'ins_1',
  channel: 'stable',
  versions: { runtime: '1.0.0' },
  health: { status: 'READY' },
  intent: 'norm_lookup',
  tool_route: 'get_active_employees',
  prompt: 'Барилгын норм юу вэ?',
  answer: 'Хариулт…',
  token: JWT,
  hostname: 'DESKTOP-ABC',
  trace: [{ step: 'plan', ms: 12 }],
};

test('OFF → null', () => {
  assert.equal(buildTelemetryEvent('OFF', RAW), null);
});

test('MINIMAL → зөвхөн цагаан жагсаалт, агуулга/токен/хост байхгүй', () => {
  const e = buildTelemetryEvent('MINIMAL', RAW)!;
  assert.deepEqual(Object.keys(e).sort(), ['channel', 'health', 'installation_id', 'telemetry_level', 'versions']);
  assert.deepEqual(findSensitiveKeys(e), []);
});

test('QUALITY → intent/tool_route нэмэгдэнэ; prompt/answer ХЭВЭЭР үгүй', () => {
  const e = buildTelemetryEvent('QUALITY', RAW)!;
  assert.equal(e.intent, 'norm_lookup');
  assert.equal(e.tool_route, 'get_active_employees');
  assert.equal('prompt' in e, false);
  assert.equal('answer' in e, false);
  assert.equal('trace' in e, false);
});

test('DEBUG → trace орно, гэхдээ trace дотор нууц түлхүүр хасагдана', () => {
  const e = buildTelemetryEvent('DEBUG', { ...RAW, trace: [{ step: 'ctx', prompt: 'x', authorization: 'y', ms: 1 }] })!;
  assert.deepEqual(e.trace, [{ step: 'ctx', ms: 1 }]);
  assertNoSensitive(e);
});

test('цагаан жагсаалтын түлхүүр нууц мөр агуулбал redact', () => {
  const e = buildTelemetryEvent('MINIMAL', { ...RAW, health: { status: 'READY', note: `Bearer ${JWT.slice(0, 40)}` } })!;
  assert.equal(JSON.stringify(e).includes('eyJ'), false);
  assert.ok(JSON.stringify(e).includes('[REDACTED]'));
});

test('findSensitiveKeys нь гүнд ч, утгад ч барина', () => {
  assert.deepEqual(findSensitiveKeys({ a: { b: { api_key: 'x' } } }), ['a.b.api_key']);
  assert.deepEqual(findSensitiveKeys({ a: [{ ok: 1 }, { cookie: 'x' }] }), ['a[1].cookie']);
  assert.ok(findSensitiveKeys({ note: `x-mglai-secret: abc123def` }).length > 0);
  assert.throws(() => assertNoSensitive({ user_password: '1' }), /user_password/);
});

test('redactText нь КАНОН функц (packages/mglai-common) — хуулбар биш, sentinel багц ижил гаралт', () => {
  assert.equal(redactText, canon.redactText);
  for (const s of canon.CROSS_CONSUMER_SENTINELS) {
    assert.equal(redactText(s), canon.redact(s));
    assert.ok(!canon.containsSentinel(redactText(s)));
  }
  assert.equal(redactText(canon.CROSS_CONSUMER_SENTINELS.at(-1)!), canon.CROSS_CONSUMER_SENTINELS.at(-1));
});

test('findSensitiveKeys: бүтэн sha256 нууц БИШ (канон phone дүрмийн hex-доторх худал эерэгийн үл хамаарах зүйл)', () => {
  // Хэмжсэн 2026-09-14: sha256("model 0.4") = 836fb811a8b2c3f84894884e… → канон `phone` дүрэм «84894884»-ийг барьдаг.
  const sha = '836fb811a8b2c3f84894884e453f66da42aea717f4d3e8c419c82ca432926c53';
  assert.deepEqual(findSensitiveKeys({ versions: { model: { sha256: sha } } }), []);
  // Харин бодит утасны дугаар хэвээр баригдана.
  assert.ok(findSensitiveKeys({ note: 'залгаарай 99112233' }).length > 0);
});

test('redactText', () => {
  assert.equal(redactText(`Authorization: Bearer ${JWT}`), 'Authorization: Bearer [REDACTED]');
  assert.equal(redactText('Bearer abcdefghijklmnopqrstuvwxyz'), 'Bearer [REDACTED]'); // канон формат (Session D)
  assert.equal(redactText('secret=abcdef123456 done'), 'secret=[REDACTED] done');
  assert.equal(redactText('энгийн мөр 123'), 'энгийн мөр 123');
});

test('allowedKeysFor нь өссөн олонлог', () => {
  const m = allowedKeysFor('MINIMAL');
  const q = allowedKeysFor('QUALITY');
  for (const k of m) assert.ok(q.has(k));
  assert.equal(allowedKeysFor('OFF').size, 0);
});

const HW: HardwareProfile = {
  os: 'win32 10.0.26200',
  arch: 'x64',
  cpu: 'Intel i7-12700KF',
  cpuCores: 20,
  cpuPhysicalCores: 12,
  ramMb: 32000,
  freeRamMb: 10000,
  gpu: 'NVIDIA GeForce RTX 3070',
  vramMb: 8192,
  vramFreeMb: 6000,
  cuda: '12.6',
  isLaptop: false,
  onBattery: false,
  detectedAt: 't',
};

test('heartbeat: hostname/JWT/агуулга байхгүй, MINIMAL-д hardware+versions+health', async () => {
  const s = emptyState();
  s.components.runtime = { version: '1.0.0', sha256: 'a'.repeat(64), path: `C:/Users/bat/AppData/Local/MglAi/app`, installedAt: 't', releaseId: 'r1' };
  const hb = buildHeartbeat({ installed: s, hardware: HW, health: null, level: 'MINIMAL' })!;
  assertNoSensitive(hb);
  assert.equal((hb.hardware as { hardwareClass: string }).hardwareClass, 'STANDARD_8GB_GPU');
  assert.equal((hb.versions as { runtime: string }).runtime, '1.0.0');
  // Зам (хэрэглэгчийн нэртэй) явахгүй — зөвхөн хувилбар
  assert.equal(JSON.stringify(hb).includes('Users/bat'), false);
  assert.equal(buildHeartbeat({ installed: s, hardware: HW, health: null, level: 'OFF' }), null);
});

test('диагностик багц: JWT-тэй лог мөр redact-лагдана, credential түлхүүр ОРОХГҮЙ', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mglai-diag-'));
  const layout = resolveLayout(root);
  await ensureLayout(layout);
  const log = createLogger({ dir: layout.logs, category: 'updater' });
  log.info(`манифест татав Authorization: Bearer ${JWT}`);
  log.error('унав', { detail: 'x-mglai-secret=abcdefgh12345678' });
  // Хуучин redact-гүй лог (start.ps1-ийн runtime.log мэт)
  const legacy = join(root, 'runtime.log');
  await writeFile(legacy, `2026-09-11 pair token=${JWT}\n2026-09-11 ok\n`, 'utf8');

  const probes: HealthProbes = Object.fromEntries(
    ['filesValid', 'modelExists', 'modelShaMatches', 'runtimeStarts', 'healthReachable', 'versionsMatch', 'modelLoads', 'knowledgeOpens', 'knowledgeManifestValid', 'generationSmoke', 'backendReachable', 'revitBridge'].map((k) => [k, async () => ({ ok: true, code: 'OK' })]),
  ) as unknown as HealthProbes;
  const health = await runHealthChecks({ probes, norm: mockNormProviders() });

  const r = buildDiagnosticBundle({
    layout,
    installed: emptyState(),
    telemetryLevel: 'MINIMAL',
    health,
    hardware: null,
    extraLogFiles: [legacy],
    // P1: бодит хувилбар + сүүлийн шинэчлэлт/буцаалтын дүн орно
    runningVersions: { runtime: '1.1.0', knowledge: 'legacy' },
    lastUpdate: { releaseId: 'rel-2', code: 'VERSION_MISMATCH', ok: false, activated: ['runtime'], rolledBack: ['runtime'], rollbackReason: 'VERSION_MISMATCH: runtime:1.2.0!=1.1.0', rollbackOk: true, finishedAt: 't' },
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const json = JSON.stringify(r.bundle);
  assert.equal(json.includes('eyJ'), false);
  assert.ok(json.includes('[REDACTED]'));
  assert.ok(r.bundle.logs.updater?.length === 2);
  assert.ok(r.bundle.logs['runtime.log']?.length === 2);
  assert.equal(r.bundle.healthChecks.length, 15);
  assert.deepEqual(r.bundle.runningVersions, { runtime: '1.1.0', knowledge: 'legacy' });
  assert.equal(r.bundle.lastUpdate?.rollbackReason, 'VERSION_MISMATCH: runtime:1.2.0!=1.1.0');
  assert.equal(r.bundle.lastUpdate?.rollbackOk, true);
  assert.equal(r.bundle.releases.lastKnownGood, null);
});

test('диагностик багц: redact давсан нууц олдвол ЭКСПОРТЛОХГҮЙ', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mglai-diag2-'));
  const layout = resolveLayout(root);
  await ensureLayout(layout);
  const r = buildDiagnosticBundle({
    layout,
    installed: emptyState(),
    telemetryLevel: 'MINIMAL',
    health: null,
    hardware: null,
    // `updateTrace` доторх мөрийг redactText цэвэрлэнэ; харин latency-д нууц түлхүүр өгвөл
    latency: { api_key_ms: 1 } as Record<string, number>,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.violations.some((v) => v.includes('api_key')));
});

test('лог эргэлт: maxBytes давахад .1.log, maxFiles хязгаар', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mglai-log-'));
  const log = createLogger({ dir, category: 'runtime', maxBytes: 300, maxFiles: 3 });
  for (let i = 0; i < 40; i++) log.info(`мөр ${i} ${'x'.repeat(40)}`);
  const files = (await readdir(dir)).sort();
  assert.deepEqual(files, ['runtime.1.log', 'runtime.2.log', 'runtime.log']);
});
