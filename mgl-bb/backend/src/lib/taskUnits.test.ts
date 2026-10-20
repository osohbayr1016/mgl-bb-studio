// Таскийн хуваарилалт — тогтмол цэгийн нэгж, тоо унших/харуулах, алхам (2026-10-02).
// Дүрэм: `lib/taskUnits.ts` (цэвэр).  Эзний тоон жишээнүүд (0/5, 80/90, 0/45) бүгд энд.
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

const U = await import('./taskUnits.ts');
const { UNITS_PER_POINT, ROOT_TOTAL_UNITS } = U;

/** Пунктийг нэгж болгоно — тестийн уншигдахуйц байдлын тулд. */
const pt = (p: number) => Math.round(p * UNITS_PER_POINT);

test('нэгжийн хуваарь: 1 пункт = 10 000, бүтэн ажил = 1 000 000', () => {
  assert.equal(UNITS_PER_POINT, 10_000);
  assert.equal(ROOT_TOTAL_UNITS, 1_000_000);
  assert.equal(U.MAX_DECIMALS, 4);
});

test('parseUnits: хүчинтэй бичиглэл', () => {
  const ok = (s: string, units: number) => assert.deepEqual(U.parseUnits(s), { ok: true, units }, s);
  ok('5', 50_000);
  ok('5.5', 55_000);
  ok('0.0001', 1);
  ok('0.05', 500);
  ok('0,5', 5_000); // таслал = аравтын цэг
  ok(' 7 ', 70_000);
  ok('.5', 5_000);
  ok('5.', 50_000);
  ok('100', ROOT_TOTAL_UNITS);
  ok('0', 0);
  ok('2.5', 25_000);
});

test('parseUnits: буруу бичиглэлийг ХАТУУ татгалзана (parseFloat шиг хайхрамжгүй биш)', () => {
  const bad = (s: string, code: string) => {
    const r = U.parseUnits(s);
    assert.equal(r.ok, false, s);
    if (!r.ok) assert.equal(r.code, code, s);
  };
  bad('', 'EMPTY');
  bad('   ', 'EMPTY');
  bad('5junk', 'FORMAT');
  bad('abc', 'FORMAT');
  bad('1e3', 'FORMAT');
  bad('1.2.3', 'FORMAT');
  bad('1,2,3', 'FORMAT');
  bad('+5', 'FORMAT');
  bad('Infinity', 'FORMAT');
  bad('NaN', 'FORMAT');
  bad('.', 'FORMAT');
  bad('-1', 'NEGATIVE');
  bad('-0.5', 'NEGATIVE');
  bad('1.23456', 'PRECISION'); // 4-өөс олон орон
  bad('100.0001', 'RANGE'); // 100%-иас их
  bad('9999', 'RANGE');
});

test('parseUnits: max өгвөл түүнээс их утга RANGE', () => {
  assert.deepEqual(U.parseUnits('5', pt(5)), { ok: true, units: pt(5) });
  const r = U.parseUnits('5.0001', pt(5));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'RANGE');
});

test('formatUnits: ардаа тэг, хэрэггүй цэггүй; нууц үлдэгдэл үгүй', () => {
  assert.equal(U.formatUnits(0), '0');
  assert.equal(U.formatUnits(ROOT_TOTAL_UNITS), '100');
  assert.equal(U.formatUnits(45_000), '4.5');
  assert.equal(U.formatUnits(4_500), '0.45');
  assert.equal(U.formatUnits(500), '0.05');
  assert.equal(U.formatUnits(1), '0.0001');
  assert.equal(U.formatUnits(890_000), '89');
  assert.equal(U.formatUnits(-5_000), '-0.5');
  assert.equal(U.formatUnits(Number.NaN), '0');
});

test('parse ↔ format: бүх 4 оронтой утгад бүрэн буцна (санамсаргүй 20 000)', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let i = 0; i < 20_000; i++) {
    const units = rnd() % (ROOT_TOTAL_UNITS + 1);
    const text = U.formatUnits(units);
    const back = U.parseUnits(text);
    assert.deepEqual(back, { ok: true, units }, text);
  }
});

test('stepUnits: зорилтын 10% / 1% — эзний жишээнүүд', () => {
  assert.equal(U.stepUnits(pt(45), 10), pt(4.5));
  assert.equal(U.stepUnits(pt(45), 1), pt(0.45));
  assert.equal(U.stepUnits(pt(5), 10), pt(0.5));
  assert.equal(U.stepUnits(pt(5), 1), pt(0.05));
  assert.equal(U.stepUnits(pt(90), 10), pt(9));
  assert.equal(U.stepUnits(pt(90), 1), pt(0.9));
  assert.equal(U.stepUnits(ROOT_TOTAL_UNITS, 10), pt(10));
});

test('stepUnits: тэг/хоосон зорилтод алхам 0; эерэг зорилтод хамгийн багадаа 1 нэгж', () => {
  assert.equal(U.stepUnits(0, 10), 0);
  assert.equal(U.stepUnits(-5, 10), 0);
  assert.equal(U.stepUnits(1, 10), 1);
  assert.equal(U.stepUnits(1, 1), 1);
  assert.equal(U.stepUnits(7, 1), 1);
});

test('stepUnits: .5 дугуйлалт дээш, бүхэл тоон арифметик', () => {
  // 15 нэгж × 10% = 1.5 → 2;  25 × 10% = 2.5 → 3
  assert.equal(U.stepUnits(15, 10), 2);
  assert.equal(U.stepUnits(25, 10), 3);
  assert.equal(U.stepUnits(14, 10), 1);
});

test('эзний хүснэгт: 0/5 дээр 10% алхам ×5 → 2.5/5; 1% алхам → 0.05', () => {
  const T = pt(5);
  let draft = 0;
  for (let i = 0; i < 5; i++) draft = U.stepUp(draft, T, 10).next;
  assert.equal(draft, pt(2.5));
  assert.equal(U.stepUp(0, T, 1).next, pt(0.05));
  assert.equal(U.stepUp(0, T, 10).delta, pt(0.5));
});

test('эзний хүснэгт: 0/45 дээр нэг "+" → 4.5 (10%), 0.45 (1%)', () => {
  const T = pt(45);
  assert.equal(U.stepUp(0, T, 10).next, pt(4.5));
  assert.equal(U.stepUp(0, T, 1).next, pt(0.45));
});

test('эзний хүснэгт: 80/90 дээр "+" → 89/90, дахин "+" → 90/90 (сүүлийн алхам богино: +1)', () => {
  const T = pt(90);
  const a = U.stepUp(pt(80), T, 10);
  assert.equal(a.next, pt(89));
  assert.equal(a.delta, pt(9));
  const b = U.stepUp(a.next, T, 10);
  assert.equal(b.next, pt(90));
  assert.equal(b.delta, pt(1)); // бодит өсөлт — алхамаас (9) бага
  const c = U.stepUp(b.next, T, 10);
  assert.equal(c.delta, 0); // зорилтоос ЛУУ гарахгүй
});

test('"Үлдсэн ажлаа дуусгах" — 0/5 үед +5, 80/90 үед +10 (энгийн алхмаас ТУСДАА)', () => {
  const a = U.finishRemaining(0, pt(5));
  assert.equal(a.next, pt(5));
  assert.equal(a.delta, pt(5));
  assert.equal(U.remainingUnits(0, pt(5)), pt(5));
  const b = U.finishRemaining(pt(80), pt(90));
  assert.equal(b.next, pt(90));
  assert.equal(b.delta, pt(10));
  assert.equal(U.remainingUnits(pt(80), pt(90)), pt(10));
  // Энгийн алхам нь +10 биш, +9 (хуурамч +10 сонголт зорилтыг давахгүй)
  assert.equal(U.stepUp(pt(80), pt(90), 10).delta, pt(9));
  // Аль хэдийн дууссан бол өөрчлөлт 0
  assert.equal(U.finishRemaining(pt(5), pt(5)).delta, 0);
});

test('stepDown: түгжигдсэн доод хязгаараас доош орохгүй', () => {
  const T = pt(90);
  const r = U.stepDown(pt(80), pt(80), T, 10);
  assert.equal(r.next, pt(80));
  assert.equal(r.delta, 0);
  const r2 = U.stepDown(pt(89), pt(80), T, 10);
  assert.equal(r2.next, pt(80));
  assert.equal(r2.delta, -pt(9));
  const r3 = U.stepDown(pt(85), pt(80), T, 10); // 85 - 9 = 76 < 80 → 80, бодит -5
  assert.equal(r3.next, pt(80));
  assert.equal(r3.delta, -pt(5));
  // Доод хязгаар 0 бол 0-оос доош үгүй
  assert.equal(U.stepDown(pt(2), 0, pt(5), 10).next, pt(1.5));
  assert.equal(U.stepDown(pt(0.2), 0, pt(5), 10).next, 0);
});

test('equalUnits: нийлбэр ЯГ total, үлдэгдэл эхний хэсгүүдэд', () => {
  assert.deepEqual(U.equalUnits(10, 3), [4, 3, 3]);
  assert.deepEqual(U.equalUnits(ROOT_TOTAL_UNITS, 3), [333_334, 333_333, 333_333]);
  assert.deepEqual(U.equalUnits(9, 3), [3, 3, 3]);
  assert.deepEqual(U.equalUnits(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(U.equalUnits(5, 0), []);
  assert.deepEqual(U.equalUnits(-1, 2), []);
});

test('largestRemainder: нийлбэр ЯГ total, тэнцүү үлдэгдэлд эхний индекс түрүүлнэ', () => {
  assert.deepEqual(U.largestRemainder(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(U.largestRemainder(10, [50, 25, 25]), [5, 3, 2]); // 5, 2.5, 2.5 → 5,3,2 (эхний индекс)
  assert.deepEqual(U.largestRemainder(0, [1, 2]), [0, 0]);
  assert.deepEqual(U.largestRemainder(7, [0, 0]), []);
  assert.deepEqual(U.largestRemainder(7, []), []);
});

test('largestRemainder: 5 000 санамсаргүй хуваалтад нийлбэр ЯГ total, сөрөг хэсэггүй', () => {
  let seed = 987654321;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed;
  };
  for (let k = 0; k < 5_000; k++) {
    const total = rnd() % (ROOT_TOTAL_UNITS + 1);
    const n = 1 + (rnd() % 20);
    const weights = Array.from({ length: n }, () => 1 + (rnd() % 1_000_000));
    const out = U.largestRemainder(total, weights);
    assert.equal(out.length, n);
    assert.equal(
      out.reduce((a, b) => a + b, 0),
      total,
    );
    assert.ok(out.every((x) => Number.isInteger(x) && x >= 0));
  }
});

test('equalUnits: 5 000 санамсаргүй хуваалтад нийлбэр ЯГ total', () => {
  let seed = 424242;
  const rnd = () => {
    seed = (seed * 22695477 + 1) & 0x7fffffff;
    return seed;
  };
  for (let k = 0; k < 5_000; k++) {
    const total = rnd() % (ROOT_TOTAL_UNITS + 1);
    const n = 1 + (rnd() % 20);
    const out = U.equalUnits(total, n);
    assert.equal(out.reduce((a, b) => a + b, 0), total);
    assert.ok(Math.max(...out) - Math.min(...out) <= 1);
  }
});

test('isUnits / isRootUnits: бүхэл, аюулгүй, хүрээтэй', () => {
  assert.equal(U.isUnits(5), true);
  assert.equal(U.isUnits(5.5), false);
  assert.equal(U.isUnits(Number.NaN), false);
  assert.equal(U.isUnits(Infinity), false);
  assert.equal(U.isUnits('5' as unknown as number), false);
  assert.equal(U.isRootUnits(0), true);
  assert.equal(U.isRootUnits(ROOT_TOTAL_UNITS), true);
  assert.equal(U.isRootUnits(ROOT_TOTAL_UNITS + 1), false);
  assert.equal(U.isRootUnits(-1), false);
});
