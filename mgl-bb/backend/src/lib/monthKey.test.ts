// Run with:  node --test src/lib/monthKey.test.ts   (Node ≥ 22.18 / 24 strips types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonthKey, monthRange, monthKeyOf } from './monthKey.ts';

test('parseMonthKey: accepts valid YYYY-MM', () => {
  assert.equal(parseMonthKey('2026-01'), '2026-01');
  assert.equal(parseMonthKey('2026-08'), '2026-08');
  assert.equal(parseMonthKey('2026-12'), '2026-12');
});

test('parseMonthKey: rejects out-of-range months', () => {
  // Тайлангийн огноог зөвхөн regex-ээр шалгах нь `2026-13`-ыг нэвтрүүлдэг —
  // progress_entries.date дээр яг ийм нүх байгаа тул энд давтахгүй.
  assert.equal(parseMonthKey('2026-00'), null);
  assert.equal(parseMonthKey('2026-13'), null);
  assert.equal(parseMonthKey('2026-99'), null);
});

test('parseMonthKey: rejects malformed input', () => {
  assert.equal(parseMonthKey('2026-1'), null);
  assert.equal(parseMonthKey('2026-011'), null);
  assert.equal(parseMonthKey('2026/08'), null);
  assert.equal(parseMonthKey('2026-08-01'), null);
  assert.equal(parseMonthKey(''), null);
  assert.equal(parseMonthKey(undefined), null);
  assert.equal(parseMonthKey(null), null);
  assert.equal(parseMonthKey(202608), null);
});

test('monthRange: half-open range within a year', () => {
  assert.deepEqual(monthRange('2026-06'), { from: '2026-06-01', to: '2026-07-01' });
  assert.deepEqual(monthRange('2026-01'), { from: '2026-01-01', to: '2026-02-01' });
});

test('monthRange: December rolls into the next year', () => {
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2027-01-01' });
});

test('monthKeyOf: takes the YYYY-MM prefix of a UB date', () => {
  assert.equal(monthKeyOf('2026-08-11'), '2026-08');
  assert.equal(monthKeyOf('2026-12-31'), '2026-12');
});

test('monthKeyOf round-trips through parseMonthKey and monthRange', () => {
  const key = monthKeyOf('2026-12-31');
  assert.equal(parseMonthKey(key), '2026-12');
  const { from, to } = monthRange(key);
  assert.ok('2026-12-31' >= from && '2026-12-31' < to);
});

test('monthRange: `to` is exclusive so 31-day and 28-day months both work', () => {
  // Хагас нээлттэй муж нь сарын уртыг мэдэх шаардлагагүй — үүний тулд л
  // BETWEEN биш, `< to`-г сонгосон.
  const feb = monthRange('2026-02');
  assert.ok('2026-02-28' >= feb.from && '2026-02-28' < feb.to);
  assert.ok('2026-03-01' >= feb.to);
  const jan = monthRange('2026-01');
  assert.ok('2026-01-31' >= jan.from && '2026-01-31' < jan.to);
});
