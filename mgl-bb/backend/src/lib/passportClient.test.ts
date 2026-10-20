/**
 * `lib/passportClient.ts` — паспортын захиалагчийн нүд → `project_clients`.
 * Импортгүй файл тул `registerHooks` шаардлагагүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_NAME_MAX, parseClientName, planClientNameSync } from './passportClient.ts';

test('талбар ирээгүй бол хөндөхгүй', () => {
  assert.deepEqual(parseClientName(undefined), { ok: true, value: undefined });
});

test('null ба хоосон мөр = хасах', () => {
  assert.deepEqual(parseClientName(null), { ok: true, value: '' });
  assert.deepEqual(parseClientName('   '), { ok: true, value: '' });
});

test('буруу төрөл, хэт урт нэр татгалзана', () => {
  assert.equal(parseClientName(12).ok, false);
  assert.equal(parseClientName('x'.repeat(CLIENT_NAME_MAX + 1)).ok, false);
  assert.deepEqual(parseClientName('  МАК ХХК  '), { ok: true, value: 'МАК ХХК' });
});

test('мөргүй төсөлд нэр бичвэл нэг мөр нэмнэ', () => {
  assert.deepEqual(planClientNameSync([], 'МАК'), { kind: 'insert', name: 'МАК' });
});

test('мөргүй төсөлд хоосон бол юу ч хийхгүй', () => {
  assert.deepEqual(planClientNameSync([], ''), { kind: 'none' });
});

test('нэр ижил бол юу ч хийхгүй', () => {
  assert.deepEqual(planClientNameSync([{ id: 3, name: ' МАК ' }], 'МАК'), { kind: 'none' });
});

test('нэр солигдвол эхний мөрийг л засна', () => {
  assert.deepEqual(planClientNameSync([{ id: 3, name: 'МАК' }], 'UB Group'), {
    kind: 'rename',
    id: 3,
    name: 'UB Group',
    dropIds: [],
  });
});

test('хоосолбол бүх мөрийг устгана', () => {
  assert.deepEqual(planClientNameSync([{ id: 3, name: 'МАК' }], '  '), { kind: 'delete_all' });
});

test('олон мөр: харагдацтай ижил бол хөндөхгүй, өөр бол нэг мөр болно', () => {
  const rows = [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
  ];
  assert.deepEqual(planClientNameSync(rows, 'A, B'), { kind: 'none' });
  assert.deepEqual(planClientNameSync(rows, 'C'), {
    kind: 'rename',
    id: 1,
    name: 'C',
    dropIds: [2],
  });
});
