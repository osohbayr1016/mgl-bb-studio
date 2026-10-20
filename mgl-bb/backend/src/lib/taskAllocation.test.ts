// Таскийн хуваарилалт — төлөвлөгч, эцсийн зорилтын шалгалт, өөрийн явц, буцаах/шилжүүлэх,
// дугаарын эрэмбэ (2026-10-02).  Дүрэм: `lib/taskAllocation.ts` (цэвэр).
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

const A = await import('./taskAllocation.ts');
const { ROOT_TOTAL_UNITS, UNITS_PER_POINT } = await import('./taskUnits.ts');

const pt = (p: number) => Math.round(p * UNITS_PER_POINT);
const row = (userId: number, done: number, target: number, floor = done) => ({
  userId,
  doneUnits: pt(done),
  floorUnits: pt(floor),
  targetUnits: pt(target),
});
const state = (rows: ReturnType<typeof row>[], B = 0, U = 0) => ({
  unattributedUnits: pt(B),
  unallocatedUnits: pt(U),
  rows,
});
/** Хоосон үндсэн ажил (хэн ч эхлээгүй, бүх 100 хуваарилагдаагүй). */
const empty = () => state([], 0, 100);
const targetsOf = (r: { ok: true; rows: Array<{ userId: number; targetUnits: number }> }) =>
  Object.fromEntries(r.rows.map((x) => [x.userId, x.targetUnits / UNITS_PER_POINT]));

test('checkRootInvariants: эрүүл төлөв', () => {
  assert.deepEqual(A.checkRootInvariants(empty()), []);
  assert.deepEqual(A.checkRootInvariants(state([row(1, 80, 90), row(2, 0, 10)])), []);
  assert.deepEqual(A.checkRootInvariants(state([row(1, 0, 60), row(2, 0, 20)], 0, 20)), []);
  assert.deepEqual(A.checkRootInvariants(state([row(1, 30, 60), row(2, 0, 30)], 10)), []);
});

test('checkRootInvariants: зөрчлүүдийг барина', () => {
  assert.ok(A.checkRootInvariants(state([row(1, 0, 60)])).includes('SUM_NOT_100'));
  assert.ok(A.checkRootInvariants(state([row(1, 70, 60), row(2, 0, 40)])).some((x) => x.startsWith('DONE_OVER_TARGET')));
  assert.ok(A.checkRootInvariants(state([{ ...row(1, 10, 100), floorUnits: pt(20) }])).some((x) => x.startsWith('FLOOR')));
  assert.ok(A.checkRootInvariants(state([row(1, 0, 50), row(1, 0, 50)])).some((x) => x.startsWith('DUPLICATE_USER')));
  assert.ok(A.checkRootInvariants({ unattributedUnits: 1.5, unallocatedUnits: 0, rows: [] }).includes('B_RANGE'));
});

test('rootDoneUnits / allocatedFutureUnits / rootRemainingUnits', () => {
  const s = state([row(1, 80, 90), row(2, 5, 10)], 5);
  assert.equal(A.rootDoneUnits(s), pt(90)); // 80 + 5 + B=5
  assert.equal(A.allocatedFutureUnits(s), pt(15));
  assert.equal(A.rootRemainingUnits(s), pt(10));
});

/* ------------------------------ planAllocation: total ------------------------------ */

test('total: 40 / 60 — нэг хүн 40 бичвэл нөгөө нь 60', () => {
  const r = A.planAllocation({
    mode: 'total',
    state: empty(),
    workers: [{ userId: 1, fixed: pt(40) }, { userId: 2 }],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(targetsOf(r), { 1: 40, 2: 60 });
});

test('total: гурван зөөлөн мөрөнд A=60 → B=C=20', () => {
  const r = A.planAllocation({
    mode: 'total',
    state: empty(),
    workers: [{ userId: 1, fixed: pt(60) }, { userId: 2 }, { userId: 3 }],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(targetsOf(r), { 1: 60, 2: 20, 3: 20 });
});

test('total: бүгд зөөлөн — тэнцүү (333 334 / 333 333 / 333 333 нэгж), нийлбэр ЯГ 100', () => {
  const r = A.planAllocation({ mode: 'total', state: empty(), workers: [{ userId: 1 }, { userId: 2 }, { userId: 3 }] });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(
      r.rows.map((x) => x.targetUnits),
      [333_334, 333_333, 333_333],
    );
    assert.equal(r.rows.reduce((s, x) => s + x.targetUnits, 0), ROOT_TOTAL_UNITS);
  }
});

test('total: 50 / 45 / 5 шууд нийт зорилт', () => {
  const r = A.planAllocation({
    mode: 'total',
    state: empty(),
    workers: [
      { userId: 1, fixed: pt(50) },
      { userId: 2, fixed: pt(45) },
      { userId: 3, fixed: pt(5) },
    ],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(targetsOf(r), { 1: 50, 2: 45, 3: 5 });
});

test('total: бүгд гараар бичигдсэн ба нийлбэр 100 биш → SUM_MISMATCH', () => {
  const r = A.planAllocation({
    mode: 'total',
    state: empty(),
    workers: [
      { userId: 1, fixed: pt(50) },
      { userId: 2, fixed: pt(40) },
    ],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'SUM_MISMATCH');
});

test('total: гараар бичсэн нийлбэр 100-аас хэтэрвэл SUM_MISMATCH', () => {
  const r = A.planAllocation({
    mode: 'total',
    state: empty(),
    workers: [{ userId: 1, fixed: pt(70) }, { userId: 2, fixed: pt(50) }, { userId: 3 }],
  });
  assert.equal(r.ok, false);
});

test('total: A 80 хийсэн, B шинэ — A үргэлжилбэл тэнцүү хуваалт доод хязгаарт тулж A=80, B=20', () => {
  const s = state([row(1, 80, 100)]);
  const r = A.planAllocation({ mode: 'total', state: s, workers: [{ userId: 1 }, { userId: 2 }] });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(targetsOf(r), { 1: 80, 2: 20 }); // A: 80/80 (ирээдүй 0), B: 0/20
    const a = r.rows.find((x) => x.userId === 1)!;
    assert.equal(a.continues, false);
    assert.equal(a.futureUnits, 0);
  }
});

test('total: хийсэн хэмжээнээс бага зорилт бичвэл BELOW_DONE', () => {
  const s = state([row(1, 80, 100)]);
  const r = A.planAllocation({ mode: 'total', state: s, workers: [{ userId: 1, fixed: pt(70) }, { userId: 2 }] });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 'BELOW_DONE');
    assert.equal(r.userId, 1);
  }
});

test('total: A хийсэн нь тэнцүү хуваалтаас бага бол A ч бусад шиг хуваагдана', () => {
  const s = state([row(1, 10, 100)]);
  const r = A.planAllocation({ mode: 'total', state: s, workers: [{ userId: 1 }, { userId: 2 }] });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(targetsOf(r), { 1: 50, 2: 50 });
});

/* ----------------------------- planAllocation: remainder ----------------------------- */

test('remainder: A 80 хийсэн, үлдсэн 20-ийг A=50% B=25% C=25% → зорилт 90 / 5 / 5, хийх 10/5/5', () => {
  const s = state([row(1, 80, 100)]);
  const r = A.planAllocation({
    mode: 'remainder',
    state: s,
    workers: [
      { userId: 1, fixed: 500_000 },
      { userId: 2, fixed: 250_000 },
      { userId: 3, fixed: 250_000 },
    ],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(targetsOf(r), { 1: 90, 2: 5, 3: 5 });
    assert.deepEqual(
      r.rows.map((x) => x.futureUnits),
      [pt(10), pt(5), pt(5)],
    );
    assert.equal(r.remainingUnits, pt(20));
    // Эхлэх харагдац: 80/90, 0/5, 0/5
    assert.equal(r.rows[0]!.doneUnits, pt(80));
    assert.equal(r.rows[1]!.doneUnits, 0);
  }
});

test('remainder: 40 → 60 эхлээд (хийсэн 0): A=40% → B=60%', () => {
  const r = A.planAllocation({
    mode: 'remainder',
    state: empty(),
    workers: [{ userId: 1, fixed: 400_000 }, { userId: 2 }],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(targetsOf(r), { 1: 40, 2: 60 });
});

test('remainder: гурван зөөлөн мөрөнд A=60% → 20/20', () => {
  const r = A.planAllocation({
    mode: 'remainder',
    state: empty(),
    workers: [{ userId: 1, fixed: 600_000 }, { userId: 2 }, { userId: 3 }],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(targetsOf(r), { 1: 60, 2: 20, 3: 20 });
});

test('remainder: A үргэлжлэхгүй (орхигдсон) → 80/80 түүх, үлдсэн 20-ийг B, C хуваана', () => {
  const s = state([row(1, 80, 100)]);
  const r = A.planAllocation({ mode: 'remainder', state: s, workers: [{ userId: 2 }, { userId: 3 }] });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(targetsOf(r), { 1: 80, 2: 10, 3: 10 });
    const a = r.rows.find((x) => x.userId === 1)!;
    assert.equal(a.continues, false);
    assert.equal(a.targetUnits, a.doneUnits); // 80/80 — түүхтэй оролцогч хэвээр
  }
});

test('remainder: хувиудын нийлбэр 100%-аас хэтэрвэл OVER_REMAINDER', () => {
  const r = A.planAllocation({
    mode: 'remainder',
    state: empty(),
    workers: [{ userId: 1, fixed: 700_000 }, { userId: 2, fixed: 400_000 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'OVER_REMAINDER');
});

test('remainder: бүгд гараар, нийлбэр 100% биш → SUM_MISMATCH', () => {
  const r = A.planAllocation({
    mode: 'remainder',
    state: empty(),
    workers: [{ userId: 1, fixed: 400_000 }, { userId: 2, fixed: 400_000 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'SUM_MISMATCH');
});

test('remainder: үлдсэн ажил 0 (дууссан) → NO_FREE_WORK', () => {
  const s = state([row(1, 100, 100)]);
  const r = A.planAllocation({ mode: 'remainder', state: s, workers: [{ userId: 2 }] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'NO_FREE_WORK');
});

test('remainder: B (эзэнгүй хуучин хийсэн) түгжигдсэн — үлдсэн = 100 − B − ΣD', () => {
  const s = state([row(1, 20, 60), row(2, 0, 20)], 20); // B=20, U=0, ΣT=80
  const r = A.planAllocation({ mode: 'remainder', state: s, workers: [{ userId: 1 }, { userId: 2 }] });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.remainingUnits, pt(60)); // 100 − 20 (B) − 20 (D1)
    assert.deepEqual(targetsOf(r), { 1: 50, 2: 30 }); // A: 20 + 30, B: 30
  }
});

/* ----------------------------- planAllocation: нийтлэг хамгаалалт ----------------------------- */

test('давхардсан хүн, хоосон жагсаалт, 20-оос олон, буруу утга', () => {
  const dup = A.planAllocation({ mode: 'total', state: empty(), workers: [{ userId: 1 }, { userId: 1 }] });
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.code, 'DUPLICATE_USER');

  const none = A.planAllocation({ mode: 'total', state: empty(), workers: [] });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.code, 'NO_WORKERS');

  const many = A.planAllocation({
    mode: 'total',
    state: empty(),
    workers: Array.from({ length: 21 }, (_, i) => ({ userId: i + 1 })),
  });
  assert.equal(many.ok, false);
  if (!many.ok) assert.equal(many.code, 'TOO_MANY');

  const bad = A.planAllocation({ mode: 'total', state: empty(), workers: [{ userId: 1, fixed: 1.5 }, { userId: 2 }] });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'BAD_VALUE');

  const badUser = A.planAllocation({ mode: 'total', state: empty(), workers: [{ userId: 0 }] });
  assert.equal(badUser.ok, false);
});

test('20 хүн хүртэл — нийлбэр ЯГ 100, шинэ хүн бүрт эерэг ажил', () => {
  const workers = Array.from({ length: 20 }, (_, i) => ({ userId: i + 1 }));
  const r = A.planAllocation({ mode: 'total', state: empty(), workers });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.rows.reduce((s, x) => s + x.targetUnits, 0), ROOT_TOTAL_UNITS);
    assert.ok(r.rows.every((x) => x.futureUnits > 0));
  }
});

test('нарийвчлал: үлдсэн ажил хүн бүрт хүрэхгүй бол PRECISION (тэг/сөрөг зорилт гаргахгүй)', () => {
  // A 99.9995 хийсэн → үлдсэн 5 нэгж, 10 шинэ хүнд тэнцүү 0.5 нэгж → тэг гарна
  const s = { unattributedUnits: 0, unallocatedUnits: 0, rows: [{ userId: 1, doneUnits: 999_995, floorUnits: 999_995, targetUnits: ROOT_TOTAL_UNITS }] };
  const r = A.planAllocation({
    mode: 'remainder',
    state: s,
    workers: Array.from({ length: 10 }, (_, i) => ({ userId: 100 + i })),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'PRECISION');
});

test('planAllocation: эрүүл биш төлөвийг хүлээж авахгүй', () => {
  const r = A.planAllocation({ mode: 'total', state: state([row(1, 0, 60)]), workers: [{ userId: 1 }] });
  assert.equal(r.ok, false);
});

test('defaultPlan: бүгд зөөлөн тэнцүү', () => {
  const r = A.defaultPlan(empty(), [1, 2]);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(targetsOf(r), { 1: 50, 2: 50 });
});

test('санамсаргүй төлөвлөлт: үр дүн ҮРГЭЛЖ инвариант хангана (2 000 кейс)', () => {
  let seed = 20261002;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  let okCount = 0;
  for (let k = 0; k < 2_000; k++) {
    // Санамсаргүй түүх: 0–3 хүн, нийлбэр хийсэн ≤ 90
    const nHist = rnd() % 4;
    const rows: Array<{ userId: number; doneUnits: number; floorUnits: number; targetUnits: number }> = [];
    let doneLeft = 900_000;
    for (let i = 0; i < nHist; i++) {
      const d = rnd() % (Math.min(doneLeft, 400_000) + 1);
      doneLeft -= d;
      rows.push({ userId: i + 1, doneUnits: d, floorUnits: d, targetUnits: d });
    }
    // Ирээдүйн хуваарилалт: бүх үлдэгдэл U
    const used = rows.reduce((s, r) => s + r.targetUnits, 0);
    const st = { unattributedUnits: 0, unallocatedUnits: ROOT_TOTAL_UNITS - used, rows };
    const nWorkers = 1 + (rnd() % 6);
    const workers = Array.from({ length: nWorkers }, (_, i) => ({
      userId: i + 1 + (rnd() % 2 === 0 ? 0 : 0), // хуучин хүмүүс болон шинэ хүмүүс холилдоно
      fixed: rnd() % 3 === 0 ? rnd() % 300_000 : undefined,
    }));
    const mode = rnd() % 2 === 0 ? 'total' : 'remainder';
    const r = A.planAllocation({ mode, state: st, workers });
    if (!r.ok) continue; // татгалзах нь зөв (нийлбэр таарахгүй г.м.)
    okCount++;
    const sumT = r.rows.reduce((s, x) => s + x.targetUnits, 0);
    assert.equal(sumT, ROOT_TOTAL_UNITS, JSON.stringify({ st, workers, mode }));
    for (const x of r.rows) {
      assert.ok(x.targetUnits >= x.doneUnits);
      assert.ok(Number.isInteger(x.targetUnits));
    }
    assert.deepEqual(
      A.checkRootInvariants({ unattributedUnits: 0, unallocatedUnits: 0, rows: r.rows }),
      [],
    );
  }
  assert.ok(okCount > 300, `хэт цөөн амжилттай кейс: ${okCount}`);
});

/* ----------------------------- applyFinalTargets ----------------------------- */

test('applyFinalTargets: шинэ хуваалт 40/60 — хийсэн 0, түгжих доод хязгаар 0', () => {
  const r = A.applyFinalTargets(empty(), [
    { userId: 1, targetUnits: pt(40) },
    { userId: 2, targetUnits: pt(60) },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.created, [1, 2]);
    assert.equal(r.state.unallocatedUnits, 0);
    assert.deepEqual(A.checkRootInvariants(r.state), []);
  }
});

test('applyFinalTargets: A 80 хийсэн → доод хязгаар L = 80 болж түгжигдэнэ', () => {
  const s = state([row(1, 80, 100, 50)]); // өмнөх L = 50
  const r = A.applyFinalTargets(s, [
    { userId: 1, targetUnits: pt(90) },
    { userId: 2, targetUnits: pt(5) },
    { userId: 3, targetUnits: pt(5) },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    const a = r.state.rows.find((x) => x.userId === 1)!;
    assert.equal(a.floorUnits, pt(80)); // L := D
    assert.equal(a.doneUnits, pt(80));
    assert.equal(a.targetUnits, pt(90));
    assert.deepEqual(r.created, [2, 3]);
  }
});

test('applyFinalTargets: A (80 хийсэн) орхигдвол түүх-only (80/80), хийсэн нь БУСАДАД шилжихгүй', () => {
  const s = state([row(1, 80, 100)]);
  const r = A.applyFinalTargets(s, [{ userId: 2, targetUnits: pt(20) }]);
  assert.equal(r.ok, true);
  if (r.ok) {
    const a = r.state.rows.find((x) => x.userId === 1)!;
    assert.equal(a.targetUnits, pt(80));
    assert.equal(a.doneUnits, pt(80));
    assert.deepEqual(r.released, [1]);
    assert.equal(A.rootDoneUnits(r.state), pt(80)); // root хийсэн хэвээр
  }
});

test('applyFinalTargets: ажиллаагүй мөр (D=0) орхигдвол цуцлагдана (dropped)', () => {
  const s = state([row(1, 0, 60), row(2, 0, 40)]);
  const r = A.applyFinalTargets(s, [{ userId: 1, targetUnits: pt(100) }]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.dropped, [2]);
    assert.equal(r.state.rows.length, 1);
  }
});

test('applyFinalTargets: татгалзах тохиолдлууд', () => {
  const s = state([row(1, 80, 100)]);
  const below = A.applyFinalTargets(s, [{ userId: 1, targetUnits: pt(70) }, { userId: 2, targetUnits: pt(30) }]);
  assert.equal(below.ok, false);
  if (!below.ok) assert.equal(below.code, 'BELOW_DONE');

  const dup = A.applyFinalTargets(empty(), [{ userId: 1, targetUnits: pt(50) }, { userId: 1, targetUnits: pt(50) }]);
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.code, 'DUPLICATE_USER');

  const zeroNew = A.applyFinalTargets(empty(), [{ userId: 1, targetUnits: pt(100) }, { userId: 2, targetUnits: 0 }]);
  assert.equal(zeroNew.ok, false);
  if (!zeroNew.ok) assert.equal(zeroNew.code, 'PRECISION');

  const sum = A.applyFinalTargets(empty(), [{ userId: 1, targetUnits: pt(50) }, { userId: 2, targetUnits: pt(40) }]);
  assert.equal(sum.ok, false);
  if (!sum.ok) assert.equal(sum.code, 'SUM_MISMATCH');

  const frac = A.applyFinalTargets(empty(), [{ userId: 1, targetUnits: 0.5 }]);
  assert.equal(frac.ok, false);
});

test('applyFinalTargets: B-тэй үед Σ T + B = 100', () => {
  const s = state([row(1, 20, 80)], 20);
  const ok = A.applyFinalTargets(s, [{ userId: 1, targetUnits: pt(50) }, { userId: 2, targetUnits: pt(30) }]);
  assert.equal(ok.ok, true);
  const bad = A.applyFinalTargets(s, [{ userId: 1, targetUnits: pt(80) }, { userId: 2, targetUnits: pt(10) }]);
  assert.equal(bad.ok, false);
});

/* ----------------------------- planOwnProgress ----------------------------- */

test('planOwnProgress: ердийн өсөлт', () => {
  const s = state([row(1, 0, 60), row(2, 0, 40)]);
  const r = A.planOwnProgress(s, 1, pt(10));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.kind, 'increase');
    assert.equal(r.deltaUnits, pt(10));
    assert.equal(r.reachesOwnCap, false);
    assert.equal(r.completesRoot, false);
    assert.equal(r.newRootDoneUnits, pt(10));
  }
});

test('planOwnProgress: өөрийн хэсэг зорилтод хүрвэл reachesOwnCap, root 100 болвол completesRoot', () => {
  const s = state([row(1, 0, 60), row(2, 40, 40)]);
  const r = A.planOwnProgress(s, 1, pt(60));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reachesOwnCap, true);
    assert.equal(r.completesRoot, true);
    assert.equal(r.newRootDoneUnits, ROOT_TOTAL_UNITS);
  }
  const s2 = state([row(1, 0, 60), row(2, 0, 40)]);
  const r2 = A.planOwnProgress(s2, 1, pt(60));
  assert.equal(r2.ok, true);
  if (r2.ok) {
    assert.equal(r2.reachesOwnCap, true);
    assert.equal(r2.completesRoot, false); // нөгөө нь хийгээгүй
  }
});

test('planOwnProgress: ижил утга = none (оноо, QA, бичлэг үүсэхгүй)', () => {
  const s = state([row(1, 30, 60), row(2, 0, 40)]);
  const r = A.planOwnProgress(s, 1, pt(30));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.kind, 'none');
    assert.equal(r.deltaUnits, 0);
    assert.equal(r.reachesOwnCap, false);
  }
});

test('planOwnProgress: доод хязгаар, зорилтоос хэтрэх, хуваарилалтгүй, буруу утга', () => {
  const s = state([row(1, 80, 90, 80), row(2, 0, 10)]);
  const below = A.planOwnProgress(s, 1, pt(79));
  assert.equal(below.ok, false);
  if (!below.ok) assert.equal(below.code, 'BELOW_FLOOR');

  const over = A.planOwnProgress(s, 1, pt(91));
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, 'OVER_TARGET');

  const none = A.planOwnProgress(s, 99, pt(1));
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.code, 'NO_ALLOCATION');

  const bad = A.planOwnProgress(s, 1, -1);
  assert.equal(bad.ok, false);
  const frac = A.planOwnProgress(s, 1, 1.5);
  assert.equal(frac.ok, false);
});

test('planOwnProgress: доод хязгаараас дээш бууруулах = decrease (хадгалагдсан ердийн «−»)', () => {
  const s = state([row(1, 89, 90, 80), row(2, 0, 10)]);
  const r = A.planOwnProgress(s, 1, pt(85));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.kind, 'decrease');
    assert.equal(r.deltaUnits, -pt(4));
    assert.equal(r.newRootDoneUnits, pt(85));
  }
});

test('planOwnProgress: дууссан root-оос бууруулбал reopensRoot', () => {
  const s = state([row(1, 60, 60, 0), row(2, 40, 40, 40)]);
  const r = A.planOwnProgress(s, 1, pt(50));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.reopensRoot, true);
});

test('planOwnProgress: зорилт 0 (цуцлагдсан) мөр дээр ажиллахгүй — 0/0 дууссан гэж тооцогдохгүй', () => {
  const s = state([row(1, 0, 0), row(2, 0, 100)]);
  const r = A.planOwnProgress(s, 1, 0);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'NO_ALLOCATION');
});

/* ----------------------------- planRelease / planRetake ----------------------------- */

test('planRelease: үлдсэн ажил U-д орно, хийсэн нь хэвээр түүх', () => {
  const s = state([row(1, 30, 60), row(2, 0, 40)]);
  const r = A.planRelease(s, 1);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.releasedUnits, pt(30));
    const a = r.state.rows.find((x) => x.userId === 1)!;
    assert.equal(a.targetUnits, pt(30));
    assert.equal(a.doneUnits, pt(30));
    assert.equal(r.state.unallocatedUnits, pt(30));
    assert.deepEqual(A.checkRootInvariants(r.state), []);
    assert.equal(A.rootDoneUnits(r.state), A.rootDoneUnits(s)); // хийсэн хэвээр
  }
});

test('planRelease: шилжүүлэх — хийсэн нь БУСАДАД шилжихгүй, ирээдүй хүлээн авагчид', () => {
  const s = state([row(1, 30, 60), row(2, 5, 40)]);
  const r = A.planRelease(s, 1, 2);
  assert.equal(r.ok, true);
  if (r.ok) {
    const b = r.state.rows.find((x) => x.userId === 2)!;
    assert.equal(b.targetUnits, pt(70)); // 40 + 30
    assert.equal(b.doneUnits, pt(5)); // өөрчлөгдөөгүй
    assert.equal(r.state.unallocatedUnits, 0);
    assert.deepEqual(A.checkRootInvariants(r.state), []);
  }
});

test('planRelease: татгалзах — хуваарилалтгүй, буцаах ажилгүй, өөрт, оролцогч биш хүнд', () => {
  const s = state([row(1, 60, 60), row(2, 0, 40)]);
  const nothing = A.planRelease(s, 1);
  assert.equal(nothing.ok, false);
  if (!nothing.ok) assert.equal(nothing.code, 'NOTHING_TO_RELEASE');
  const noAlloc = A.planRelease(s, 9);
  assert.equal(noAlloc.ok, false);
  if (!noAlloc.ok) assert.equal(noAlloc.code, 'NO_ALLOCATION');
  const self = A.planRelease(s, 2, 2);
  assert.equal(self.ok, false);
  const notPart = A.planRelease(s, 2, 9);
  assert.equal(notPart.ok, false);
  if (!notPart.ok) assert.equal(notPart.code, 'TARGET_NOT_PARTICIPANT');
});

test('planRetake: өмнөх хийсэн нь хэвээр, чөлөөт ажлаас үргэлжилнэ', () => {
  // A 30 хийж үлдсэнийг буцаасан (30/30), U=30
  const s = state([row(1, 30, 30), row(2, 0, 40)], 0, 30);
  assert.deepEqual(A.checkRootInvariants(s), []);
  const r = A.planRetake(s, 1);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reactivated, true);
    assert.equal(r.takenUnits, pt(30));
    const a = r.state.rows.find((x) => x.userId === 1)!;
    assert.equal(a.doneUnits, pt(30)); // тэгээс эхлэхгүй
    assert.equal(a.targetUnits, pt(60));
    assert.equal(r.state.unallocatedUnits, 0);
  }
});

test('planRetake: чөлөөтэй хэмжээнээс их хүсвэл татгалзаж боломжит хэмжээг мэдэгдэнэ (бусдынхыг хулгайлахгүй)', () => {
  const s = state([row(1, 30, 30), row(2, 0, 60)], 0, 10);
  const r = A.planRetake(s, 1, pt(30));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 'BAD_VALUE');
    assert.equal(r.availableUnits, pt(10));
  }
  const part = A.planRetake(s, 1, pt(4));
  assert.equal(part.ok, true);
  if (part.ok) assert.equal(part.state.unallocatedUnits, pt(6));
});

test('planRetake: чөлөөт ажил алга бол NOTHING_FREE; шинэ хүн мөр үүсгэнэ', () => {
  const none = A.planRetake(state([row(1, 0, 100)]), 2);
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.code, 'NOTHING_FREE');
  const fresh = A.planRetake(state([row(1, 30, 30)], 0, 70), 7);
  assert.equal(fresh.ok, true);
  if (fresh.ok) {
    assert.equal(fresh.reactivated, false);
    assert.equal(fresh.state.rows.find((x) => x.userId === 7)!.targetUnits, pt(70));
    assert.deepEqual(A.checkRootInvariants(fresh.state), []);
  }
});

/* ----------------------------- дугаар ----------------------------- */

test('childLabel / compareLabels: 17.10 нь 17.2-оос хойш (тэмдэгт мөрөөр биш)', () => {
  assert.equal(A.childLabel(17, 3), '17.3');
  assert.equal(A.childLabel('17', 10), '17.10');
  const sorted = ['17.10', '17.2', '17', '17.1', '18', '2.15', '2.3', '9'].sort(A.compareLabels);
  assert.deepEqual(sorted, ['2.3', '2.15', '9', '17', '17.1', '17.2', '17.10', '18']);
  assert.equal(A.compareLabels('17', '17.1') < 0, true);
  assert.equal(A.compareLabels('17.1', '17') > 0, true);
  assert.equal(A.compareLabels('17.2', '17.2'), 0);
});
