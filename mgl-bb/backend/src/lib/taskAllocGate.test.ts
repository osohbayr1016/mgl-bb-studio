// Таскийн хуваарилалтын хаалганы ЦЭВЭР дүрэм (2026-10-05): гэрээний толгой, төлөвийн шийдвэр, fail-safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_ALLOC_CONTRACT,
  contractHeaders,
  decideManagedWrite,
  parseClientContract,
  parseTaskAllocState,
  verdictBody,
  verdictHeaders,
  type GateSnapshot,
} from './taskAllocGate.ts';
import { correlationIdOf, opResultFields, sanitizeLogFields } from './taskAllocLog.ts';

const gate = (state: GateSnapshot['state'], configured = true): GateSnapshot => ({
  state,
  configured,
  updatedAt: null,
  updatedBy: null,
});

test('parseTaskAllocState: зөвхөн гурван утга', () => {
  assert.equal(parseTaskAllocState('enabled'), 'enabled');
  assert.equal(parseTaskAllocState('paused'), 'paused');
  assert.equal(parseTaskAllocState('disabled'), 'disabled');
  for (const bad of ['', 'ENABLED', 'on', null, undefined, 1, {}]) assert.equal(parseTaskAllocState(bad), null);
});

test('parseClientContract: толгойгүй / буруу / зөв', () => {
  assert.deepEqual(parseClientContract(undefined), { kind: 'missing' });
  assert.deepEqual(parseClientContract(null), { kind: 'missing' });
  assert.deepEqual(parseClientContract('  '), { kind: 'missing' });
  assert.deepEqual(parseClientContract('1'), { kind: 'ok', version: 1 });
  assert.deepEqual(parseClientContract(' 2 '), { kind: 'ok', version: 2 });
  for (const bad of ['0', '-1', '1.0', 'v1', '1;DROP', '1 2', '9999999', 'x']) {
    assert.equal(parseClientContract(bad).kind, 'invalid', bad);
  }
  const long = parseClientContract('x'.repeat(100));
  assert.equal(long.kind, 'invalid');
  assert.ok(long.kind === 'invalid' && long.raw.length <= 32, 'raw богиносгогдоно (лог)');
});

test('decideManagedWrite: enabled + одоогийн клиент = зөвшөөрнө', () => {
  assert.deepEqual(decideManagedWrite(gate('enabled'), { kind: 'ok', version: TASK_ALLOC_CONTRACT }), { ok: true });
});

test('decideManagedWrite: толгойгүй / буруу / ХУУЧИН клиент → 426 (төлөвөөс үл хамаарна)', () => {
  for (const state of ['enabled', 'paused', 'disabled'] as const) {
    for (const client of [{ kind: 'missing' } as const, { kind: 'invalid', raw: 'v1' } as const, { kind: 'ok', version: 0 } as const]) {
      const v = decideManagedWrite(gate(state), client);
      assert.ok(!v.ok, `${state}/${client.kind}`);
      assert.equal(v.status, 426);
      assert.equal(v.code, 'CONTRACT_UPGRADE_REQUIRED');
    }
  }
});

test('decideManagedWrite: клиент СЕРВЕРЭЭС ШИНЭ (frontend түрүүлж deploy) → 426 direction=server_older', () => {
  const v = decideManagedWrite(gate('enabled'), { kind: 'ok', version: TASK_ALLOC_CONTRACT + 1 });
  assert.ok(!v.ok);
  assert.equal(v.status, 426);
  assert.equal(v.extra.direction, 'server_older');
});

test('decideManagedWrite: paused / disabled / тохируулаагүй → 423 өөр өөр код', () => {
  const ok = { kind: 'ok', version: TASK_ALLOC_CONTRACT } as const;
  const paused = decideManagedWrite(gate('paused'), ok);
  const disabled = decideManagedWrite(gate('disabled'), ok);
  const unconfigured = decideManagedWrite(gate('paused', false), ok);
  assert.ok(!paused.ok && !disabled.ok && !unconfigured.ok);
  assert.equal(paused.status, 423);
  assert.equal(paused.code, 'TASK_ALLOC_PAUSED');
  assert.equal(disabled.code, 'TASK_ALLOC_DISABLED');
  assert.equal(unconfigured.code, 'TASK_ALLOC_UNCONFIGURED');
});

test('426 нь клиентийн толгойг 423-аас ӨМНӨ шалгана (хуучин клиент төлөвийн утгыг ойлгохгүй)', () => {
  const v = decideManagedWrite(gate('paused'), { kind: 'missing' });
  assert.ok(!v.ok);
  assert.equal(v.status, 426);
});

test('verdictHeaders: 426-д Upgrade (RFC 7231), хоёуланд гэрээ + төлөв + no-store; body-д код', () => {
  const v426 = decideManagedWrite(gate('enabled'), { kind: 'missing' });
  const v423 = decideManagedWrite(gate('paused'), { kind: 'ok', version: 1 });
  assert.ok(!v426.ok && !v423.ok);
  const h426 = verdictHeaders(v426, 'enabled');
  const h423 = verdictHeaders(v423, 'paused');
  assert.equal(h426.Upgrade, `MGL-Task-Alloc/${TASK_ALLOC_CONTRACT}`);
  assert.equal(h423.Upgrade, undefined);
  assert.equal(h423['X-Task-Alloc-State'], 'paused');
  assert.equal(h423['X-Task-Alloc-Contract'], String(TASK_ALLOC_CONTRACT));
  assert.equal(h423['Cache-Control'], 'no-store');
  const body = verdictBody(v423);
  assert.equal(body.error, 'TASK_ALLOC_PAUSED');
  assert.equal(body.contract, TASK_ALLOC_CONTRACT);
});

test('contractHeaders: төлөвгүй бол зөвхөн гэрээ', () => {
  assert.deepEqual(contractHeaders(), { 'X-Task-Alloc-Contract': String(TASK_ALLOC_CONTRACT) });
  assert.equal(contractHeaders('enabled')['X-Task-Alloc-State'], 'enabled');
});

test('лог: зөвшөөрөгдсөн түлхүүр л, нэр/тайлбар орохгүй, мөр богиносно', () => {
  const clean = sanitizeLogFields({
    evt: 'op',
    op: 'progress',
    task_id: 5,
    // @ts-expect-error — зориуд хориотой түлхүүр
    full_name: 'Болд Бат',
    // @ts-expect-error
    notes: 'нууц тайлбар',
    request_id: 'r'.repeat(200),
    code: 'a\nb\u0000c',
  });
  assert.equal(clean.task_id, 5);
  assert.equal('full_name' in clean, false);
  assert.equal('notes' in clean, false);
  assert.equal((clean.request_id as string).length, 80);
  assert.equal(clean.code, 'a b c');
});

test('correlationIdOf: зөв толгойг хэвээр, буруу/хоосныг серверийн UUID-ээр сольно', () => {
  assert.equal(correlationIdOf('abc-12345_X.y'), 'abc-12345_X.y');
  for (const bad of [undefined, null, '', 'short', 'has space here', 'x'.repeat(65), 'a\nb-123456']) {
    const id = correlationIdOf(bad as string | null | undefined);
    assert.match(id, /^[0-9a-f-]{36}$/);
  }
});

test('opResultFields: амжилт / replay / татгалзал', () => {
  assert.deepEqual(opResultFields({ ok: true, revisionAfter: 7 }), { result: 'ok', status: 200, code: null, rev_after: 7 });
  assert.equal(opResultFields({ ok: true, replayed: true }).result, 'replayed');
  assert.deepEqual(opResultFields({ ok: false, status: 409, code: 'STALE_REVISION' }), {
    result: 'fail',
    status: 409,
    code: 'STALE_REVISION',
    rev_after: null,
  });
});
