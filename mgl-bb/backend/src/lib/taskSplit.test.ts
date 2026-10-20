/**
 * `lib/taskSplit.ts` — таск хуваах цэвэр дүрмийн тест.
 * Импортгүй файл тул `registerHooks` шаардлагагүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSplit, splitNames, splitOrder, MAX_SPLIT_PARTS } from './taskSplit.ts';

const ok = (total: number, raw: unknown) => {
  const r = validateSplit(total, raw);
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  return r.ok ? r.weights : [];
};

test('9% → 4.5 + 4.5', () => {
  assert.deepEqual(ok(9, [4.5, 4.5]), [4.5, 4.5]);
});

test('9% → 2 + 2 + 5 (тэнцүү биш)', () => {
  assert.deepEqual(ok(9, [2, 2, 5]), [2, 2, 5]);
});

test('9% → 7 + 1 + 1', () => {
  assert.deepEqual(ok(9, [7, 1, 1]), [7, 1, 1]);
});

test('нийлбэр хэтэрвэл / дутвал татгалзана', () => {
  assert.equal(validateSplit(9, [5, 5]).ok, false);
  assert.equal(validateSplit(9, [4, 4]).ok, false);
  assert.equal(validateSplit(9, [4.5, 4.49]).ok, false);
});

test('0 эсвэл сөрөг хэсэг татгалзагдана', () => {
  assert.equal(validateSplit(9, [9, 0]).ok, false);
  assert.equal(validateSplit(9, [10, -1]).ok, false);
});

test('0.01-ээс нарийн хувь татгалзагдана', () => {
  assert.equal(validateSplit(9, [4.505, 4.495]).ok, false);
});

test('хэсгийн тоо 2..MAX', () => {
  assert.equal(validateSplit(9, [9]).ok, false);
  assert.equal(validateSplit(9, []).ok, false);
  const many = Array.from({ length: MAX_SPLIT_PARTS + 1 }, () => 0.01);
  assert.equal(validateSplit(9, many).ok, false);
  assert.equal(validateSplit(9, 'x').ok, false);
});

test('жингүй таскийг хуваахгүй', () => {
  assert.equal(validateSplit(0, [0.01, 0.01]).ok, false);
});

test('3.3333% эх жин — эхний хэсэг үлдэгдлийг авч нийлбэр ЯГ хадгалагдана', () => {
  const w = ok(10 / 3, [1.11, 1.11, 1.11]);
  assert.equal(w.length, 3);
  assert.ok(Math.abs(w.reduce((s, x) => s + x, 0) - 10 / 3) < 1e-12);
  assert.deepEqual(w.slice(1), [1.11, 1.11]);
});

test('нэр «(i/N)» дагавартай', () => {
  assert.deepEqual(splitNames('  Фасад  ', 3), ['Фасад (1/3)', 'Фасад (2/3)', 'Фасад (3/3)']);
});

test('хуулбарууд эх таскийн ард орно', () => {
  assert.deepEqual(splitOrder([10, 20, 30], 20, 2), [10, 20, { copy: 0 }, { copy: 1 }, 30]);
  assert.deepEqual(splitOrder([10], 10, 1), [10, { copy: 0 }]);
  // эх id жагсаалтад байхгүй (уралдаан) бол төгсгөлд
  assert.deepEqual(splitOrder([10], 99, 1), [10, { copy: 0 }]);
});

// ── 2026-10-01: явцтай таскийн «үлдсэнийг л хуваах» ──────────────────────
import { planSplit, splitSeats, splitDefaults, defaultTakeIndex, equalCents } from './taskSplit.ts';

test('явцтай 75% таск (жин 10): хийгдсэн 7.5 хэвээр, үлдсэн 2.5-ийг 1.25 + 1.25', () => {
  const p = planSplit(10, 75, [1.25, 1.25]);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.mode, 'remainder');
  assert.equal(p.doneWeight, 7.5);
  assert.deepEqual(p.parts, [1.25, 1.25]);
  // Төслийн явц хадгалагдана: хийгдсэн хэсэг 100% × 7.5 = эх 75% × 10.
  assert.ok(Math.abs(p.doneWeight * 1 - 10 * 0.75) < 1e-12);
  assert.ok(Math.abs(p.doneWeight + p.parts.reduce((s, x) => s + x, 0) - 10) < 1e-12);
});

test('явцтай таскт ганц хэсэг (үлдсэнийг тусад нь салгах) зөвшөөрөгдөнө, явцгүйд 2+ шаардлагатай', () => {
  const one = planSplit(9, 40, [5.4]);
  assert.equal(one.ok, true);
  if (one.ok) assert.deepEqual([one.doneWeight, one.parts], [3.6, [5.4]]);
  assert.equal(planSplit(9, 0, [9]).ok, false);
});

test('үлдсэнийг ХУУЧИН нийт жингээр хуваах (явц өөрчлөгдсөн) → татгалзана', () => {
  // 40% үед 9%-ийг 4.5 + 4.5 гэж илгээвэл (үлдсэн нь 5.4) — нийлбэр таарахгүй.
  assert.equal(planSplit(9, 40, [4.5, 4.5]).ok, false);
});

test('олон аравтын оронтой хийгдсэн жин — эхний хэсэг үлдэгдлийг шингээнэ', () => {
  // W = 3, p = 33.333 → done = 0.99999, үлдсэн 2.00001 → 1 + 1 (цент) ойролцоо.
  const p = planSplit(3, 33.333, [1, 1]);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.ok(Math.abs(p.doneWeight + p.parts[0]! + p.parts[1]! - 3) < 1e-12);
  assert.equal(p.parts[1], 1);
});

test('үлдсэн хэсэг хэт бага (0.01-ээс бага хэсэг гарах) → татгалзана; дууссан таск → татгалзана', () => {
  assert.equal(planSplit(1, 99.5, [0.01, 0.01]).ok, false);
  assert.equal(planSplit(10, 100, [5, 5]).ok, false);
});

test('ажиллаж буй хүн ҮРГЭЛЖ part 0; авагч өгөгдмөл 1, ажиллаж буй хүнгүй бол 0', () => {
  assert.deepEqual(splitSeats(2, true, 1), { occupantIndex: 0, takerIndex: 1 });
  assert.equal(splitSeats(2, true, 0).error, 'Энэ хэсэг дээр өөр хүн ажиллаж байна');
  assert.deepEqual(splitSeats(2, false, 0), { occupantIndex: null, takerIndex: 0 });
  assert.equal(splitSeats(2, false, 5).error, 'Авах хэсэг буруу');
  assert.deepEqual(splitSeats(3, true, undefined), { occupantIndex: 0, takerIndex: null });
  assert.equal(defaultTakeIndex(true), 1);
  assert.equal(defaultTakeIndex(false), 0);
});

test('50/50 өгөгдмөл — явцгүйд бүх жин, явцтайд үлдсэн; цент нийлбэр ЯГ', () => {
  assert.deepEqual(splitDefaults(9, 0), { doneWeight: 0, splitTotal: 9, defaultHalves: [4.5, 4.5] });
  const d = splitDefaults(9.01, 0);
  assert.deepEqual(d.defaultHalves, [4.51, 4.5]);
  const r = splitDefaults(10, 75);
  assert.equal(r.doneWeight, 7.5);
  assert.equal(r.splitTotal, 2.5);
  assert.deepEqual(r.defaultHalves, [1.25, 1.25]);
  assert.deepEqual(equalCents(5, 2), [3, 2]);
});
