// Таскийн хуваарилалт — онооны цэвэр тооцоо: шинэ хийсэн хэсгийн оноо, slack (хуучин HWM-ийн
// үлдэгдэл), LIFO буцаалт, сэргээлт (2026-10-02).  Дүрэм: `lib/taskCredit.ts`.
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

const C = await import('./taskCredit.ts');
const { UNITS_PER_POINT } = await import('./taskUnits.ts');
const pt = (p: number) => Math.round(p * UNITS_PER_POINT);
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('taskProjectCoef: calcProjectProgress SQL-тэй ижил (task.w × block.w × share)', () => {
  near(C.taskProjectCoef({ taskWeight: 10, drawingWeight: 100, blockWeight: 100, teamShare: 100 }), 0.1);
  near(C.taskProjectCoef({ taskWeight: 20, drawingWeight: 50, blockWeight: 50, teamShare: 40 }), 0.2 * 0.5 * 0.4);
  near(C.taskProjectCoef({ taskWeight: 100, drawingWeight: 100, blockWeight: 100, teamShare: 100 }), 1);
});

test('taskProjectCoef: зургийн/блокийн/багийн жин 0, таскийн жин 0 → 0 (SQL CASE d.weight_percent > 0)', () => {
  assert.equal(C.taskProjectCoef({ taskWeight: 10, drawingWeight: 0, blockWeight: 100, teamShare: 100 }), 0);
  assert.equal(C.taskProjectCoef({ taskWeight: 10, drawingWeight: 100, blockWeight: 0, teamShare: 100 }), 0);
  assert.equal(C.taskProjectCoef({ taskWeight: 10, drawingWeight: 100, blockWeight: 100, teamShare: 0 }), 0);
  assert.equal(C.taskProjectCoef({ taskWeight: 10, drawingWeight: 100, blockWeight: 100, teamShare: null }), 0);
  assert.equal(C.taskProjectCoef({ taskWeight: 0, drawingWeight: 100, blockWeight: 100, teamShare: 100 }), 0);
});

test('creditOf: төслийн Δ% = coef × пункт; оноо = complexity × Δ% / 100', () => {
  const r = C.creditOf(pt(50), { coef: 0.1, complexityPct: 100 });
  near(r.deltaPct, 5); // 10 жинтэй таскийн 50% = төслийн 5%
  near(r.amount, 5); // complexity 100 → оноо = Δ%
  const r2 = C.creditOf(pt(50), { coef: 0.1, complexityPct: 40 });
  near(r2.amount, 2);
  const neg = C.creditOf(-pt(10), { coef: 0.1, complexityPct: 100 });
  near(neg.deltaPct, -1);
  assert.equal(C.creditOf(pt(10), { coef: 0.1, complexityPct: 0 }).amount, 0);
  assert.equal(C.creditOf(pt(10), { coef: 0, complexityPct: 100 }).amount, 0);
});

test('planWorkCredit: slack байхгүй — бүх Δ оноо авна', () => {
  const p = C.planWorkCredit(0, pt(30), { coef: 0.1, complexityPct: 100 });
  assert.equal(p.freeUnits, 0);
  assert.equal(p.paidUnits, pt(30));
  near(p.amount, 3);
  assert.equal(p.newSlackUnits, 0);
});

test('planWorkCredit: хуучин 77 → 8 → 77 — slack 69 нь давхар төлөхгүй', () => {
  // seed: хүчинтэй 8, төлөгдсөн 77 → slack = 69
  const ctx = { coef: 1, complexityPct: 100 };
  const up = C.planWorkCredit(pt(69), pt(69), ctx);
  assert.equal(up.freeUnits, pt(69));
  assert.equal(up.paidUnits, 0);
  assert.equal(up.amount, 0);
  assert.equal(up.newSlackUnits, 0);
  // Slack-аас илүү нэмбэл илүүд нь л оноо
  const over = C.planWorkCredit(pt(69), pt(70), ctx);
  assert.equal(over.freeUnits, pt(69));
  assert.equal(over.paidUnits, pt(1));
  near(over.amount, 1);
});

test('planWorkCredit: сөрөг/хэлбэргүй оролтод аюулгүй', () => {
  const p = C.planWorkCredit(-5, -10, { coef: 1, complexityPct: 100 });
  assert.equal(p.freeUnits, 0);
  assert.equal(p.paidUnits, 0);
  assert.equal(p.amount, 0);
});

const slice = (id: number, unitsOpen: number, freeOpen: number, amount: number, day: string, pointsId: number | null = id) => ({
  id,
  userId: 1,
  unitsOpen,
  freeOpen,
  creditOpenAmount: amount,
  creditOpenDeltaPct: amount, // complexity 100 → ижил
  awardedAt: day,
  pointsId,
});

test('planReversal: хамгийн ШИНЭ хэсгээс эхэлж, анхны өдөрт нь буцаана', () => {
  // 3 хэсэг: өчигдөр 10, өнөөдөр 20, дөнгөж одоо 5 (units) — шинэ нь эхэнд
  const newestFirst = [
    slice(3, pt(5), 0, 0.5, '2026-10-02T10:00:00Z'),
    slice(2, pt(20), 0, 2, '2026-10-02T09:00:00Z'),
    slice(1, pt(10), 0, 1, '2026-10-01T09:00:00Z'),
  ];
  const r = C.planReversal(newestFirst, pt(7));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.parts.length, 2);
    assert.equal(r.parts[0]!.sliceId, 3);
    assert.equal(r.parts[0]!.closes, true);
    near(r.parts[0]!.amount, 0.5); // бүтнээр нь — үлдсэн оноог ЯГ
    assert.equal(r.parts[1]!.sliceId, 2);
    assert.equal(r.parts[1]!.closes, false);
    assert.equal(r.parts[1]!.units, pt(2));
    near(r.parts[1]!.amount, 0.2); // 2/20 × 2
    assert.equal(r.parts[1]!.awardedAt, '2026-10-02T09:00:00Z'); // анхны өдөр, өнөөдөр БИШ
    assert.equal(r.slackDelta, 0);
    const s = C.sumReversal(r.parts);
    assert.equal(s.units, pt(7));
    near(s.amount, 0.7);
  }
});

test('planReversal: бүх хэсгийг буцаахад нийлбэр оноо ЯГ анхных (нийт 0)', () => {
  const newestFirst = [
    slice(2, pt(33.3333), 0, 3.33333, 'd2'),
    slice(1, pt(66.6667), 0, 6.66667, 'd1'),
  ];
  const r = C.planReversal(newestFirst, pt(100));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.parts.every((p) => p.closes));
    const s = C.sumReversal(r.parts);
    near(s.amount, 3.33333 + 6.66667, 1e-12);
  }
});

test('planReversal: хэсэгчилсэн дараалсан буцаалт — нийлбэр анхных руу ЯГ хүрнэ (дрифтгүй)', () => {
  // нэг хэсэг 3 удаа хэсэгчлэн буцаагдаад дараа нь бүтнээр
  let s = slice(1, pt(30), 0, 3, 'd1');
  let totalAmount = 0;
  for (const take of [pt(7), pt(11), pt(5)]) {
    const r = C.planReversal([s], take);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const part = r.parts[0]!;
    totalAmount += part.amount;
    s = {
      ...s,
      unitsOpen: s.unitsOpen - part.units,
      freeOpen: s.freeOpen - part.freeUnits,
      creditOpenAmount: s.creditOpenAmount - part.amount,
      creditOpenDeltaPct: s.creditOpenDeltaPct - part.deltaPct,
    };
  }
  const last = C.planReversal([s], s.unitsOpen);
  assert.equal(last.ok, true);
  if (last.ok) {
    assert.equal(last.parts[0]!.closes, true);
    totalAmount += last.parts[0]!.amount;
  }
  near(totalAmount, 3, 1e-12); // олгосон 3 ЯГ буцсан
});

test('planReversal: slack-аар хаагдсан (оноогүй) нэгжийг буцаахад slack нэмэгдэнэ', () => {
  // хэсэг: 30 нэгжийн 30 нь slack-аар хаагдсан (оноо 0)
  const r = C.planReversal([slice(1, pt(30), pt(30), 0, 'd1', null)], pt(10));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.parts[0]!.freeUnits, pt(10));
    assert.equal(r.parts[0]!.paidUnits, 0);
    assert.equal(r.parts[0]!.amount, 0);
    assert.equal(r.slackDelta, pt(10));
  }
});

test('planReversal: холимог (төлөгдсөн + slack) хэсгийг пропорциональ хуваана', () => {
  // 40 нэгж: 10 нь slack, 30 нь төлөгдсөн (оноо 3). 20 буцаавал free=5 (10×20/40), paid=15 → оноо 1.5
  const r = C.planReversal([slice(1, pt(40), pt(10), 3, 'd1')], pt(20));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.parts[0]!.freeUnits, pt(5));
    assert.equal(r.parts[0]!.paidUnits, pt(15));
    near(r.parts[0]!.amount, 1.5);
    assert.equal(r.slackDelta, pt(5));
  }
});

test('planReversal: хүчинтэй хэмжээ хүрэлцэхгүй, буруу хэмжээ', () => {
  const small = C.planReversal([slice(1, pt(5), 0, 0.5, 'd1')], pt(6));
  assert.equal(small.ok, false);
  if (!small.ok) assert.equal(small.code, 'NOT_ENOUGH_OPEN');
  for (const bad of [0, -1, 1.5]) {
    const r = C.planReversal([slice(1, pt(5), 0, 0.5, 'd1')], bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'BAD_VALUE');
  }
});

test('planReversal: хаагдсан (units_open=0) хэсгийг алгасна', () => {
  const r = C.planReversal([slice(2, 0, 0, 0, 'd2'), slice(1, pt(10), 0, 1, 'd1')], pt(4));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.parts[0]!.sliceId, 1);
});

test('санамсаргүй LIFO буцаалт: нийлбэр нэгж/оноо тодорхойлолтоор таарна (2 000 кейс)', () => {
  let seed = 31415926;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let k = 0; k < 2_000; k++) {
    const n = 1 + (rnd() % 6);
    const slices = Array.from({ length: n }, (_, i) => {
      const units = 1 + (rnd() % 400_000);
      const free = rnd() % 3 === 0 ? rnd() % (units + 1) : 0;
      const paid = units - free;
      return slice(n - i, units, free, paid / UNITS_PER_POINT / 10, `d${i}`); // 10 нэгжийн оноо ≈ 1
    });
    const total = slices.reduce((s, x) => s + x.unitsOpen, 0);
    const want = 1 + (rnd() % total);
    const r = C.planReversal(slices, want);
    assert.equal(r.ok, true);
    if (!r.ok) continue;
    const sum = C.sumReversal(r.parts);
    assert.equal(sum.units, want);
    assert.ok(r.parts.every((p) => p.units > 0 && p.freeUnits >= 0 && p.paidUnits >= 0));
    assert.ok(r.parts.every((p) => p.freeUnits + p.paidUnits === p.units));
    assert.equal(
      r.slackDelta,
      r.parts.reduce((s, p) => s + p.freeUnits, 0),
    );
    // Бүх зүйлийг буцаасан үед оноо нийлбэр = нийт олгосон
    if (want === total) {
      const credit = slices.reduce((s, x) => s + x.creditOpenAmount, 0);
      near(sum.amount, credit, 1e-9);
    }
  }
});

test('checkRestore: slack хүрэлцвэл сэргээнэ, үгүй бол давхар төлөхгүйн тулд татгалзана', () => {
  const parts = [{ freeUnits: pt(5) }, { freeUnits: pt(3) }];
  assert.deepEqual(C.checkRestore(pt(8), parts), { ok: true, slackNeeded: pt(8) });
  const bad = C.checkRestore(pt(7), parts);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'SLACK_CONSUMED');
  assert.deepEqual(C.checkRestore(0, [{ freeUnits: 0 }]), { ok: true, slackNeeded: 0 });
});
