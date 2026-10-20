import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countHoldDays, doneSpans, holdSpan, utcToLocalDate } from './taskHold.ts';

const UB = 480;

test('UTC → УБ огноо: 16:00 UTC нь дараагийн өдөр', () => {
  assert.equal(utcToLocalDate('2026-09-24 15:59:59', UB), '2026-09-24');
  assert.equal(utcToLocalDate('2026-09-24 16:00:00', UB), '2026-09-25');
  assert.equal(utcToLocalDate('2026-09-24T16:00:00Z', UB), '2026-09-25');
  assert.equal(utcToLocalDate('2026-09-25T09:00:00+08:00', UB), '2026-09-25');
  assert.equal(utcToLocalDate('garbage', UB), null);
});

test('авсан өдөр өөрөө 1-р өдөр', () => {
  // Пүрэв 2026-09-24 УБ-аар авсан, өнөөдөр мөн өдөр.
  const s = holdSpan('2026-09-24 01:00:00', null, '2026-09-24', UB);
  assert.deepEqual(s, { from: '2026-09-24', to: '2026-09-24' });
  assert.equal(countHoldDays([s!], new Set()), 1);
});

test('амралтын өдөр тоологдохгүй: Баасан → Даваа = 2', () => {
  const s = holdSpan('2026-09-18 01:00:00', null, '2026-09-21', UB);
  assert.equal(countHoldDays([s!], new Set()), 2);
});

test('баярын өдөр тоологдохгүй', () => {
  const s = holdSpan('2026-09-21 01:00:00', null, '2026-09-25', UB);
  assert.equal(countHoldDays([s!], new Set()), 5);
  assert.equal(countHoldDays([s!], new Set(['2026-09-23'])), 4);
});

test('7 өдөр ажиллаад буцаагаад дахин авбал 8 дахь өдрөөс үргэлжилнэ', () => {
  // 09-01 (Мягмар) → 09-09 (Лхагва) = 7 ажлын өдөр, буцаасан.
  const first = holdSpan('2026-09-01 01:00:00', '2026-09-09 08:00:00', '2026-09-21', UB)!;
  assert.equal(countHoldDays([first], new Set()), 7);
  // 09-21 (Даваа) дахин авсан — хоорондох 09-10..09-18 тоологдохгүй.
  const again = holdSpan('2026-09-21 01:00:00', null, '2026-09-21', UB)!;
  assert.equal(countHoldDays([first, again], new Set()), 8);
});

test('нэг өдөр хэд авч/буцаасан ч НЭГ удаа', () => {
  const a = holdSpan('2026-09-24 01:00:00', '2026-09-24 02:00:00', '2026-09-25', UB)!;
  const b = holdSpan('2026-09-24 03:00:00', '2026-09-24 04:00:00', '2026-09-25', UB)!;
  const c = holdSpan('2026-09-24 05:00:00', null, '2026-09-25', UB)!;
  assert.equal(countHoldDays([a, b, c], new Set()), 2);
});

test('ирээдүйн эхлэл (цагийн зөрүү) → тоологдохгүй', () => {
  assert.equal(holdSpan('2026-10-01 01:00:00', null, '2026-09-25', UB), null);
});

test('Бямба гарагт авсан шинэ таск = 0 өдөр', () => {
  const s = holdSpan('2026-09-26 01:00:00', null, '2026-09-26', UB)!;
  assert.equal(countHoldDays([s], new Set()), 0);
});

// ── 100% болоход зогсоно (2026-09-29) ─────────────────────────────────

test('100% болсон өдөр тоологдоно, түүнээс хойш зогсоно', () => {
  // 09-01 (Мягмар) авсан, 09-09 (Лхагва) 100% болсон, өнөөдөр 09-29.
  const s = holdSpan('2026-09-01 01:00:00', null, '2026-09-29', UB)!;
  const done = doneSpans([
    { date: '2026-09-03', percentage: 40 },
    { date: '2026-09-09', percentage: 100 },
  ]);
  assert.equal(done.doneOn, '2026-09-09');
  assert.equal(countHoldDays([s], new Set(), done.spans), 7);
  // Дууссаны дараа дахин 100% бичсэн ч өдөр сунахгүй.
  const again = doneSpans([
    { date: '2026-09-09', percentage: 100 },
    { date: '2026-09-15', percentage: 100 },
  ]);
  assert.equal(again.doneOn, '2026-09-09');
  assert.equal(countHoldDays([s], new Set(), again.spans), 7);
});

test('дуусаагүй таск өнөөдөр хүртэл тоологдсоор', () => {
  const s = holdSpan('2026-09-01 01:00:00', null, '2026-09-29', UB)!;
  const done = doneSpans([{ date: '2026-09-09', percentage: 90 }]);
  assert.equal(done.doneOn, null);
  assert.deepEqual(done.spans, []);
  assert.equal(countHoldDays([s], new Set(), done.spans), 21);
});

test('дахин нээгдвэл тэр өдрөөс үргэлжилнэ, дууссан хоорондох өдрүүд тоологдохгүй', () => {
  const s = holdSpan('2026-09-01 01:00:00', null, '2026-09-29', UB)!;
  // 09-09 100% → 09-21 (Даваа) 80% болгож засав → 09-23 (Лхагва) дахин 100%.
  const done = doneSpans([
    { date: '2026-09-09', percentage: 100 },
    { date: '2026-09-21', percentage: 80 },
    { date: '2026-09-23', percentage: 100 },
  ]);
  assert.equal(done.doneOn, '2026-09-23');
  // 09-01..09-09 = 7, 09-21..09-23 = 3.
  assert.equal(countHoldDays([s], new Set(), done.spans), 10);
});

test('таск дууссаны дараа оноогдсон хүнд 0 өдөр', () => {
  const s = holdSpan('2026-09-14 01:00:00', null, '2026-09-29', UB)!;
  const done = doneSpans([{ date: '2026-09-09', percentage: 100 }]);
  assert.equal(countHoldDays([s], new Set(), done.spans), 0);
});

test('буцаасан хугацааны мужийг ч дууссан өдрөөр тасална', () => {
  // 09-01..09-24 эзэмшээд буцаасан, таск 09-04 (Баасан) дууссан.
  const past = holdSpan('2026-09-01 01:00:00', '2026-09-24 08:00:00', '2026-09-29', UB)!;
  const done = doneSpans([{ date: '2026-09-04', percentage: 100 }]);
  assert.equal(countHoldDays([past], new Set(), done.spans), 4);
});
