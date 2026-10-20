/**
 * `lib/reportTrend.ts` — хандлагын ангилал, RANK() семантик, дельта.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrend, rankWithTies, rankDelta, pctDelta, leastSquaresSlope } from './reportTrend.ts';

const zeros = (n: number) => new Array<number>(n).fill(0);

test('classifyTrend: хоёулаа бараг тэг → flat (0.01→0.02 нь дохио биш)', () => {
  const t = classifyTrend([...zeros(6), 0.01, ...zeros(6), 0.02]);
  assert.equal(t.code, 'flat');
  assert.equal(t.pct_change, null);
});

test('classifyTrend: бодит масштаб — 0.06 → 0.12 нь up, нийлбэр 4 орноор', () => {
  // Нэг тайлан ≈ 0.03 (прод хэмжилт); 1 орны дугуйлалт хоёуланг 0 болгож байсан.
  const t = classifyTrend([...zeros(5), 0.0302, 0.0301, ...zeros(4), 0.04, 0.04, 0.0401]);
  assert.equal(t.code, 'up');
  assert.equal(t.prior7, 0.0603);
  assert.equal(t.last7, 0.1201);
  assert.equal(classifyTrend([...zeros(6), 0.12, ...zeros(6), 0.06]).code, 'down');
});

test('classifyTrend: өмнөх 0, сүүлийн ≥ 1 → up, pct null', () => {
  const t = classifyTrend([...zeros(7), 0, 0, 0, 0, 0, 0, 2.5]);
  assert.equal(t.code, 'up');
  assert.equal(t.last7, 2.5);
  assert.equal(t.prior7, 0);
  assert.equal(t.pct_change, null);
});

test('classifyTrend: ±10 % босго — яг 10 % нь flat', () => {
  // prior 10, last 11 → +10 % → flat (босгоос ДЭЭШ л up)
  assert.equal(classifyTrend([...zeros(6), 10, ...zeros(6), 11]).code, 'flat');
  // prior 10, last 11.1 → +11 % → up
  assert.equal(classifyTrend([...zeros(6), 10, ...zeros(6), 11.1]).code, 'up');
  // prior 10, last 9 → −10 % → flat
  assert.equal(classifyTrend([...zeros(6), 10, ...zeros(6), 9]).code, 'flat');
  // prior 10, last 8.9 → −11 % → down
  const d = classifyTrend([...zeros(6), 10, ...zeros(6), 8.9]);
  assert.equal(d.code, 'down');
  assert.equal(d.pct_change, -11);
});

test('classifyTrend: богино цувааг эхэнд 0-оор дүүргэнэ, уртыг сүүлийн 14-өөр авна', () => {
  const short = classifyTrend([5, 5, 5]); // → prior 0, last 15
  assert.equal(short.prior7, 0);
  assert.equal(short.last7, 15);
  const long = classifyTrend([100, 100, ...zeros(6), 10, ...zeros(6), 20]); // эхний 100-ууд орохгүй
  assert.equal(long.prior7, 10);
  assert.equal(long.last7, 20);
  assert.equal(long.code, 'up');
});

test('classifyTrend: батлагдсан чөлөөний залруулга — чөлөөтэй 7 хоног «буурч байна» болохгүй', () => {
  const daily = [0.2, 0.2, 0.2, 0.2, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // сүүлийн 7 хоног бүхэлдээ чөлөө
  assert.equal(classifyTrend(daily).code, 'down', 'хуучин: чөлөө = уналт');
  // ажилласан өдрийн цонх: сүүлийн 7 хоногийг чөлөөний өмнөх 5 ажлын өдөр орлоно
  const t = classifyTrend(daily, { prior7: 0, last7: 1.0 });
  assert.equal(t.code, 'flat');
  assert.equal(t.last7, 1);
  assert.deepEqual(classifyTrend(daily, { prior7: 0, last7: 0 }), classifyTrend(daily), 'залруулга 0 → ижил');
});

test('leastSquaresSlope', () => {
  assert.equal(leastSquaresSlope([0, 1, 2, 3]), 1);
  assert.equal(leastSquaresSlope([3, 2, 1, 0]), -1);
  assert.equal(leastSquaresSlope([2, 2, 2]), 0);
  assert.equal(leastSquaresSlope([7]), 0);
});

test('rankWithTies: [10,10,5] → 1,1,3', () => {
  const rows = [{ id: 'a', s: 10 }, { id: 'b', s: 5 }, { id: 'c', s: 10 }];
  const r = rankWithTies(rows, (x) => x.s);
  assert.equal(r.get(rows[0]!), 1);
  assert.equal(r.get(rows[2]!), 1);
  assert.equal(r.get(rows[1]!), 3);
  assert.equal(rankWithTies([], (x: number) => x).size, 0);
});

test('rankDelta: before − now, null нэвчинэ', () => {
  assert.equal(rankDelta(3, 5), 2);
  assert.equal(rankDelta(5, 3), -2);
  assert.equal(rankDelta(4, 4), 0);
  assert.equal(rankDelta(null, 4), null);
  assert.equal(rankDelta(4, undefined), null);
});

test('pctDelta', () => {
  assert.equal(pctDelta(12, 10), 20);
  assert.equal(pctDelta(9, 10), -10);
  assert.equal(pctDelta(5, 0), null);
  assert.equal(pctDelta(5, null), null);
});
