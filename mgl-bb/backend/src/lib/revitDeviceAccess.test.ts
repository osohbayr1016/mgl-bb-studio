// Revit төхөөрөмжийн хаалт, хувилбарын бодлого, proof-ийн канон мөр — ЦЭВЭР тестүүд (migration 0375).
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

const A = await import('./revitDeviceAccess.ts');
const P = await import('./revitPolicy.ts');
const K = await import('./revitDeviceKey.ts');
const L = await import('./revitLicense.ts');

const policy = (o: Partial<ReturnType<typeof P.parsePolicy>> = {}) => ({ ...P.parsePolicy([]), ...o });
const keyed = { status: 'auto' as const, hasKey: true, securityLevel: 'tpm' };

test('gate: унтраалга → хувилбар → төлөв → proof дарааллаар', () => {
  const base = { version: '1.10.0', device: keyed, proofSent: true, proof: 'valid' as const, purpose: 'license' as const };
  assert.deepEqual(A.gateDevice({ ...base, policy: policy() }), { ok: true, mode: 'key' });
  assert.deepEqual(A.gateDevice({ ...base, policy: policy({ disabled: true }) }), { ok: false, code: 'REVIT_LICENSES_DISABLED' });
  assert.deepEqual(A.gateDevice({ ...base, policy: policy({ minVersion: '1.10.1' }) }), { ok: false, code: 'ADDIN_UPDATE_REQUIRED' });
  assert.deepEqual(A.gateDevice({ ...base, policy: policy({ blockedVersions: ['1.10.0'] }) }), { ok: false, code: 'ADDIN_VERSION_BLOCKED' });
  for (const [status, code] of [['blocked', 'DEVICE_BLOCKED'], ['revoked', 'DEVICE_REVOKED'], ['pending', 'DEVICE_PENDING']] as const) {
    assert.deepEqual(A.gateDevice({ ...base, policy: policy(), device: { ...keyed, status } }), { ok: false, code });
  }
  assert.deepEqual(A.gateDevice({ ...base, policy: policy(), proof: 'missing' }), { ok: false, code: 'DEVICE_PROOF_REQUIRED' });
  assert.deepEqual(A.gateDevice({ ...base, policy: policy(), proof: 'invalid' }), { ok: false, code: 'DEVICE_PROOF_INVALID' });
  assert.deepEqual(A.gateDevice({ ...base, policy: policy({ requireTpm: true }), device: { ...keyed, securityLevel: 'software' } }), { ok: false, code: 'DEVICE_KEY_WEAK' });
});

test('gate: түлхүүргүй төхөөрөмж — optional → legacy, required → KEY_REQUIRED, session → NOT_ENROLLED, proof ирсэн → NOT_ENROLLED', () => {
  const base = { version: '1.9.0', device: null, proofSent: false, proof: 'missing' as const, purpose: 'license' as const };
  assert.deepEqual(A.gateDevice({ ...base, policy: policy() }), { ok: true, mode: 'legacy' });
  assert.deepEqual(A.gateDevice({ ...base, policy: policy({ deviceKeyPolicy: 'required' }) }), { ok: false, code: 'DEVICE_KEY_REQUIRED' });
  assert.deepEqual(A.gateDevice({ ...base, policy: policy(), purpose: 'session' }), { ok: false, code: 'DEVICE_NOT_ENROLLED' });
  assert.deepEqual(A.gateDevice({ ...base, policy: policy(), proofSent: true }), { ok: false, code: 'DEVICE_NOT_ENROLLED' });
  // downgrade: түлхүүртэй мөр + proof-гүй → legacy биш
  assert.deepEqual(A.gateDevice({ ...base, policy: policy(), device: keyed }), { ok: false, code: 'DEVICE_PROOF_REQUIRED' });
});

test('enrollStatus: ШИНЭ төхөөрөмж admin-гүйгээр approved болохгүй; таарсан + хязгаар дүүрээгүй → auto', () => {
  const ok = { hardwareMatches: true, activeKeyedDevices: 0, maxDevices: 2, securityLevel: 'tpm', requireTpm: false };
  assert.deepEqual(A.enrollStatus(ok), { status: 'auto', reason: 'ok' });
  assert.deepEqual(A.enrollStatus({ ...ok, hardwareMatches: false }), { status: 'pending', reason: 'not_work_pc' });
  assert.deepEqual(A.enrollStatus({ ...ok, activeKeyedDevices: 2 }), { status: 'pending', reason: 'limit' });
  assert.deepEqual(A.enrollStatus({ ...ok, securityLevel: 'software', requireTpm: true }), { status: 'pending', reason: 'weak' });
  assert.deepEqual(A.enrollStatus({ ...ok, adminApprovalRequired: true }), { status: 'pending', reason: 'admin_required' }, 'хамгийн хатуу горим');
  assert.deepEqual(A.enrollStatus({ ...ok, maxDevices: null, activeKeyedDevices: 50 }), { status: 'auto', reason: 'ok' }, 'хязгааргүй');
});

test('enrollStatus: account горим (өгөгдмөл 2026-10-02) — ажлын компьютер биш ч бүртгэлээр auto; admin-ы хатуу бодлого хэвээр', () => {
  const acc = { hardwareMatches: false, activeKeyedDevices: 0, maxDevices: null, securityLevel: 'software', requireTpm: false, accountMode: true };
  assert.deepEqual(A.enrollStatus(acc), { status: 'auto', reason: 'ok' });
  assert.deepEqual(A.enrollStatus({ ...acc, activeKeyedDevices: 30 }), { status: 'auto', reason: 'ok' }, 'хязгаар тохируулаагүй');
  assert.deepEqual(A.enrollStatus({ ...acc, maxDevices: 2, activeKeyedDevices: 2 }), { status: 'pending', reason: 'limit' }, 'admin хязгаар тавьсан');
  assert.deepEqual(A.enrollStatus({ ...acc, requireTpm: true }), { status: 'pending', reason: 'weak' });
  assert.deepEqual(A.enrollStatus({ ...acc, adminApprovalRequired: true }), { status: 'pending', reason: 'admin_required' });
});

test('policy: parse + өгөгдмөл + хувилбарын харьцуулалт', () => {
  const d = P.parsePolicy([]);
  assert.deepEqual(d, P.DEFAULT_POLICY);
  const p = P.parsePolicy([
    { key: 'revit.min_version', value: '1.10.4' },
    { key: 'revit.blocked_versions', value: '1.9.0, 1.9.2' },
    { key: 'revit.max_devices', value: '3' },
    { key: 'revit.device_key_policy', value: 'required' },
    { key: 'revit.legacy_token_policy', value: 'deny' },
    { key: 'revit.disabled', value: '1' },
    { key: 'revit.require_tpm', value: '1' },
    { key: 'revit.enroll_approval', value: 'admin' },
  ]);
  assert.equal(P.parsePolicy([...[]]).enrollApproval, 'account', 'өгөгдмөл — бүртгэлээр (2026-10-02)');
  assert.equal(P.parsePolicy([{ key: 'revit.enroll_approval', value: 'auto' }]).enrollApproval, 'auto');
  assert.equal(P.parsePolicy([{ key: 'revit.enroll_approval', value: 'бусад' }]).enrollApproval, 'account');
  assert.equal(P.parsePolicy([]).maxDevices, null, 'өгөгдмөл — хязгааргүй');
  assert.equal(P.parsePolicy([{ key: 'revit.max_devices', value: '0' }]).maxDevices, null, '0 = хязгааргүй');
  assert.equal(p.maxDevices, 3);
  assert.deepEqual(p.blockedVersions, ['1.9.0', '1.9.2']);
  assert.equal(p.deviceKeyPolicy, 'required');
  assert.equal(p.legacyTokenPolicy, 'deny');
  assert.equal(p.enrollApproval, 'admin');
  assert.ok(p.disabled && p.requireTpm);
  assert.equal(P.parsePolicy([{ key: 'revit.max_devices', value: '999' }]).maxDevices, null, 'хэт их → өгөгдмөл (хязгааргүй)');
  assert.equal(P.compareVersions('1.10.0', '1.9.9'), 1, '1.10 > 1.9 (тоогоор)');
  assert.equal(P.compareVersions('1.9', '1.9.0'), 0);
  assert.equal(P.versionVerdict(p, '1.9.2'), 'blocked');
  assert.equal(P.versionVerdict(p, '1.10.3'), 'update_required');
  assert.equal(P.versionVerdict(p, null), 'update_required');
  assert.equal(P.versionVerdict(P.DEFAULT_POLICY, null), 'ok');
});

test('proof: канон мөр тогтмол (add-in `DeviceProof.Message`-тэй байт-ижил) + subtle гарын үсэг', async () => {
  const msg = K.proofMessage({ purpose: 'license', challengeId: 'c'.repeat(32), nonce: 'NONCE', userId: 7, deviceId: 'd'.repeat(64), keyId: 'k'.repeat(64) });
  assert.equal(msg, `mgl-revit-device-proof|v1|license|${'c'.repeat(32)}|NONCE|7|${'d'.repeat(64)}|${'k'.repeat(64)}`);
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const pub = K.parsePublicKey({ x: jwk.x, y: jwk.y });
  assert.ok(pub);
  const sig = L.b64urlEncode(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(msg))));
  assert.equal(await K.verifyProofSignature(pub!, msg, sig), true);
  assert.equal(await K.verifyProofSignature(pub!, msg + 'x', sig), false, 'агуулга өөрчлөгдвөл');
  assert.equal(await K.verifyProofSignature(pub!, msg, sig.slice(0, -2) + 'AA'), false, 'гарын үсэг өөрчлөгдвөл');
  assert.equal(await K.verifyProofSignature(pub!, msg, 'AAAA'), false, 'урт буруу');
  // Муруй дээр биш цэг
  assert.equal(await K.verifyProofSignature({ x: pub!.x, y: pub!.x }, msg, sig), false);
  assert.equal(K.parsePublicKey({ x: 'short', y: 'short' }), null);
  assert.equal((await K.keyThumbprint(pub!)).length, 64);
  const m = K.newChallengeMaterial();
  assert.match(m.id, /^[0-9a-f]{32}$/);
  assert.notEqual(m.nonce, K.newChallengeMaterial().nonce, 'nonce санамсаргүй');
});
