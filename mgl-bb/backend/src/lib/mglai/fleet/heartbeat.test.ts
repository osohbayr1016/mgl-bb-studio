/**
 * MGL AI · ФЛОТЫН HEARTBEAT (сервер) — ТЕСТ (Session B §35).
 *
 * Run with:  node --test src/lib/mglai/fleet/heartbeat.test.ts
 *
 *   • зөв ачаалал → цагаан жагсаалтын талбарууд Л
 *   • hostname / token / prompt агуулсан ачаалал → 400 FORBIDDEN_FIELD (бүхэлдээ)
 *   • буруу install_id → татгалзана
 *   • OFF түвшин → TELEMETRY_OFF
 *   • админы override > төхөөрөмжийн өөрийн
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { parseHeartbeat, findForbiddenKeys, effectiveChannel, effectiveTelemetryLevel, summarizeFleet, FORBIDDEN_KEY_PARTS } =
  await import('./heartbeat.ts');

const GOOD = {
  installation_id: 'ins_0c1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8',
  channel: 'stable',
  telemetry_level: 'MINIMAL',
  versions: { runtime: '1.0.0', model: '0.4', knowledge: 'norms-2026.09.11.1', release: 'rel-1', last_known_good: 'rel-1', bogus: 'x' },
  hardware: { os: 'win32 10.0.26200', arch: 'x64', cpu: 'i7', cpuPhysicalCores: 12, ramMb: 32000, gpu: 'RTX 3070', vramMb: 8192, cuda: '12.6', isLaptop: false, hardwareClass: 'STANDARD_8GB_GPU', serial: 'SN123' },
  health: { status: 'READY', facets: { LOCAL_AI: 'READY', COMPANY_BACKEND: 'OFFLINE', FOO: 'x' }, reasonCodes: ['BACKEND_UNREACHABLE'] },
  update: { phase: 'idle', what: null, percent: null, failed: false },
  latency: { ttft_p50_ms: 420, 'bad key!': 1 },
  runtime_uptime_s: 3600,
  measured_at: '2026-09-11T10:00:00Z',
};

test('зөв ачаалал → зөвхөн цагаан жагсаалт', () => {
  const r = parseHeartbeat(GOOD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const h = r.heartbeat;
  assert.equal(h.installation_id, GOOD.installation_id);
  assert.deepEqual(Object.keys(h.versions).sort(), ['knowledge', 'last_known_good', 'model', 'release', 'runtime']);
  assert.equal('serial' in h.hardware, false);
  assert.equal(h.hardware_class, 'STANDARD_8GB_GPU');
  assert.deepEqual(h.health?.facets, { LOCAL_AI: 'READY', COMPANY_BACKEND: 'OFFLINE' });
  assert.deepEqual(h.latency, { ttft_p50_ms: 420 });
  assert.equal(h.runtime_uptime_s, 3600);
});

test('hostname / токен / prompt → FORBIDDEN_FIELD, бүхэлдээ татгалзана', () => {
  for (const bad of [{ hostname: 'PC' }, { versions: { runtime: '1', token: 'x' } }, { health: { status: 'READY', prompt: 'x' } }, { hardware: { cpu: 'i7', username: 'bat' } }]) {
    const r = parseHeartbeat({ ...GOOD, ...bad });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'FORBIDDEN_FIELD');
  }
});

test('install_id буруу → INSTALLATION_ID_INVALID', () => {
  for (const id of ['DESKTOP-ABC', 'ins_', '', 42, 'ins_' + 'x'.repeat(80)]) {
    const r = parseHeartbeat({ ...GOOD, installation_id: id });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'INSTALLATION_ID_INVALID');
  }
});

test('OFF → TELEMETRY_OFF (юу ч бүртгэхгүй)', () => {
  const r = parseHeartbeat({ ...GOOD, telemetry_level: 'OFF' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'TELEMETRY_OFF');
});

test('мэдэгдэхгүй суваг/төлөв → өгөгдмөл, алдаа биш', () => {
  const r = parseHeartbeat({ ...GOOD, channel: 'prod', health: { status: 'GREEN' } });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.heartbeat.channel, 'stable');
    assert.equal(r.heartbeat.health?.status, 'UNKNOWN');
  }
});

test('findForbiddenKeys гүнд барина; жагсаалт ≥ 20 үг', () => {
  assert.deepEqual(findForbiddenKeys({ a: { b: [{ api_key: 1 }] } }), ['a.b[0].api_key']);
  assert.ok(FORBIDDEN_KEY_PARTS.length >= 20);
});

test('админы override давамгайлна', () => {
  assert.equal(effectiveChannel({ channel: 'stable', channel_override: 'canary' }), 'canary');
  assert.equal(effectiveChannel({ channel: 'stable', channel_override: null }), 'stable');
  assert.equal(effectiveTelemetryLevel({ telemetry_level: 'MINIMAL', telemetry_level_override: 'DEBUG' }), 'DEBUG');
  assert.equal(effectiveTelemetryLevel({ telemetry_level: 'bogus', telemetry_level_override: null }), 'MINIMAL');
});

test('summarizeFleet — online 45 мин дотор', () => {
  const s = summarizeFleet(
    [
      { health_status: 'READY', last_seen_at: '2026-09-11 09:50:00', versions_json: '{"runtime":"1.0.0"}' },
      { health_status: 'READY', last_seen_at: '2026-09-11 07:00:00', versions_json: '{"runtime":"1.0.0"}' },
      { health_status: null, last_seen_at: '2026-09-11 09:59:00', versions_json: 'garbage' },
    ],
    '2026-09-11T10:00:00Z',
  );
  assert.equal(s.total, 3);
  assert.equal(s.online, 2);
  assert.deepEqual(s.byHealth, { READY: 2, UNKNOWN: 1 });
  assert.deepEqual(s.byRuntimeVersion, { '1.0.0': 2, unknown: 1 });
});

test('P0-6: running_versions + update.last цагаан жагсаалтаар орно', () => {
  const r = parseHeartbeat({ ...GOOD, running_versions: { runtime: '1.1.0', knowledge: 'legacy', bogus: 'x' }, update: { phase: 'idle', what: null, percent: null, failed: true, last: { code: 'VERSION_MISMATCH', ok: false, release: 'rel-2', extra: 1 } } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.heartbeat.running_versions, { runtime: '1.1.0', knowledge: 'legacy' });
  assert.deepEqual(r.heartbeat.update?.last, { code: 'VERSION_MISMATCH', ok: false, release: 'rel-2' });
});
