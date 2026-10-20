/**
 * `lib/asrStats.ts`-ийн тест.  Импортгүй цэвэр функцүүд — статик импорт хангалттай.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween,
  fillMonthSeries,
  monthOf,
  shiftDays,
  shiftMonth,
  statsWindows,
} from './asrStats.ts';

test('shiftMonth жилийн хилийг давна', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-09', -11), '2025-10');
  assert.equal(shiftMonth('2026-09', 0), '2026-09');
});

test('shiftDays сар/жилийн хилийг давна', () => {
  assert.equal(shiftDays('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDays('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDays('2026-09-21', -29), '2026-08-23');
});

test('daysBetween', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-21'), 20);
  assert.equal(daysBetween('2026-09-21', '2026-09-21'), 0);
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
});

test('statsWindows — сар ба 30 хоногийн цонх', () => {
  const w = statsWindows('2026-09-21');
  assert.equal(w.thisMonth, '2026-09');
  assert.equal(w.prevMonth, '2026-08');
  assert.equal(w.thisMonthFrom, '2026-09-01');
  assert.equal(w.thisMonthTo, '2026-10-01');
  assert.equal(w.prevMonthFrom, '2026-08-01');
  // 30 хоног = өнөөдрийг оруулаад [08-23, 09-21]; өмнөх 30 = [07-24, 08-22].
  assert.equal(w.last30From, '2026-08-23');
  assert.equal(w.prev30From, '2026-07-24');
  assert.equal(w.prev30To, '2026-08-22');
  assert.equal(daysBetween(w.last30From, '2026-09-21') + 1, 30);
  assert.equal(daysBetween(w.prev30From, w.prev30To) + 1, 30);
});

test('statsWindows — 1-р сарын өмнөх сар нь өмнөх жилийн 12', () => {
  const w = statsWindows('2026-01-05');
  assert.equal(w.prevMonth, '2025-12');
  assert.equal(w.prevMonthFrom, '2025-12-01');
  assert.equal(w.thisMonthTo, '2026-02-01');
});

test('fillMonthSeries хоосон сарыг 0-оор нөхөж, дарааллаар буцаана', () => {
  const rows = [
    { month: '2026-05', visits: 2, approved: 1 },
    { month: '2026-09', visits: 15, approved: 4 },
  ];
  const s = fillMonthSeries(rows, '2026-09-21', 6);
  assert.deepEqual(
    s.map((b) => b.month),
    ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  );
  assert.deepEqual(s[0], { month: '2026-04', visits: 0, approved: 0 });
  assert.deepEqual(s[1], { month: '2026-05', visits: 2, approved: 1 });
  assert.deepEqual(s[5], { month: '2026-09', visits: 15, approved: 4 });
  // Цонхноос гадуурх сар (2026-03) орохгүй.
  assert.equal(s.length, 6);
});

test('monthOf', () => {
  assert.equal(monthOf('2026-09-21'), '2026-09');
});
