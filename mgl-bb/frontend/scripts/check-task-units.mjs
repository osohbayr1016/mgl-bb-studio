/**
 * ТАСКИЙН ХУВААРИЛАЛТЫН ЦЭВЭР ДҮРМИЙН ШАЛГАГЧ (2026-10-02).
 *
 *   node scripts/check-task-units.mjs        (frontend/ хавтаснаас; `npm run verify`-д орсон)
 *
 * Шалгадаг зүйл:
 *   A. ТВИН: `backend/src/lib/taskUnits.ts` ↔ `features/task-allocation/units.ts`, `taskAllocation.ts` ↔
 *      `allocation.ts` — комментгүй JS нь ТЭРЭЭРЭЭ ижил (нэг нь нөгөөгүйгээр өөрчлөгдвөл `verify` унана).
 *   B. Эзний арифметикийн жишээнүүд: алхам 10% / 1% (5 → 0.5 / 0.05; 45 → 4.5 / 0.45; 90 → 9), «Үлдсэн ажлаа
 *      дуусгах» (0/5 → +5; 80/90 → +10), хатуу тоо унших (2.5 → 2.5/5), автомат тэнцвэржүүлэлт (40 → 60;
 *      гурван хүнд 60 → 20/20; үлдсэн ажлын хувь 50/25/25 → нийт зорилт 90/5/5).
 *   C. Өөрийн явцын ноорог (цэвэр загвар): алхам, хязгаар, QA хэрэгцээ, буцаах, серверийн төлөвт дахин суух.
 *   D. Засварлагчийн загвар, хувь нэмэрчийн жагсаалт, богино нэр «Б.Бат», дугаар «17.10 ≻ 17.2».
 *   E. i18n: кодод хэрэглэсэн `taskAlloc.*` түлхүүр бүр mn БА en-д бий, placeholder-ууд ижил.
 *
 * ⚠️ Node-ийн ESM loader өргөтгөлгүй импортыг шийддэггүй — `check-quote-notes.mjs`-ийн жишгээр resolve hook.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const ALLOC = join(SRC, 'features', 'task-allocation');
const BACKEND_LIB = join(HERE, '..', '..', 'backend', 'src', 'lib');

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Зөвхөн `formatDisplayName`-д хэрэгтэй — brand-ийн тохиргоо энд хамаагүй.
    if (specifier === '@/shared/config/brand') {
      return { url: 'data:text/javascript,export const brand = {};', shortCircuit: true, format: 'module' };
    }
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : ALLOC;
      if (existsSync(join(base, `${specifier}.ts`))) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const load = (...parts) => import(pathToFileURL(join(...parts)).href);
const U = await load(ALLOC, 'units.ts');
const A = await load(ALLOC, 'allocation.ts');
const O = await load(ALLOC, 'ownProgress.ts');
const E = await load(ALLOC, 'allocationEditor.ts');
const C = await load(ALLOC, 'contributors.ts');
const N = await load(SRC, 'shared', 'lib', 'staffName.ts');

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message.split('\n').join('\n  ')}`);
  }
}

/* ------------------------------------------------------------------ */
/*  A. Твин                                                             */
/* ------------------------------------------------------------------ */

const emit = (text) =>
  ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true },
  }).outputText;

ok('твин: units.ts ≡ backend taskUnits.ts (комментгүй код ТЭРЭЭРЭЭ ижил)', () => {
  const be = emit(readFileSync(join(BACKEND_LIB, 'taskUnits.ts'), 'utf8'));
  const fe = emit(readFileSync(join(ALLOC, 'units.ts'), 'utf8'));
  assert.equal(fe, be, 'units.ts нь backend taskUnits.ts-ээс зөрсөн — хоёуланг хамт өөрчилнө');
});
ok('твин: allocation.ts ≡ backend taskAllocation.ts', () => {
  const be = emit(readFileSync(join(BACKEND_LIB, 'taskAllocation.ts'), 'utf8').replace("'./taskUnits'", "'./units'"));
  const fe = emit(readFileSync(join(ALLOC, 'allocation.ts'), 'utf8'));
  assert.equal(fe, be, 'allocation.ts нь backend taskAllocation.ts-ээс зөрсөн — хоёуланг хамт өөрчилнө');
});

/* ------------------------------------------------------------------ */
/*  B. Нэгж, алхам, тоо унших                                           */
/* ------------------------------------------------------------------ */

const pts = (n) => Math.round(n * 10_000);
const fmt = (u) => U.formatUnits(u);

ok('нэгж: 1 пункт = 10 000, бүтэн ажил = 1 000 000', () => {
  assert.equal(U.UNITS_PER_POINT, 10_000);
  assert.equal(U.ROOT_TOTAL_UNITS, 1_000_000);
});
ok('алхам (10% / 1% ЯГ): зорилт 5 → 0.5 / 0.05; 45 → 4.5 / 0.45; 90 → 9 / 0.9', () => {
  assert.equal(fmt(U.stepUnits(pts(5), 10)), '0.5');
  assert.equal(fmt(U.stepUnits(pts(5), 1)), '0.05');
  assert.equal(fmt(U.stepUnits(pts(45), 10)), '4.5');
  assert.equal(fmt(U.stepUnits(pts(45), 1)), '0.45');
  assert.equal(fmt(U.stepUnits(pts(90), 10)), '9');
  assert.equal(fmt(U.stepUnits(pts(90), 1)), '0.9');
  assert.equal(U.stepUnits(0, 10), 0);
});
ok('алхам: хамгийн багадаа 1 нэгж (гацаахгүй)', () => {
  assert.equal(U.stepUnits(10, 1), 1);
  assert.equal(U.stepUnits(1, 10), 1);
});
ok('+ : 0/5 → 0.5 → 1.0 …; зорилтоос хэтрэхгүй (4.8 → 5, delta 0.2)', () => {
  let d = 0;
  d = U.stepUp(d, pts(5), 10).next;
  assert.equal(fmt(d), '0.5');
  d = U.stepUp(d, pts(5), 10).next;
  assert.equal(fmt(d), '1');
  const r = U.stepUp(pts(4.8), pts(5), 10);
  assert.equal(fmt(r.next), '5');
  assert.equal(fmt(r.delta), '0.2');
});
ok('1% алхам 45-д: гурван дарахад 1.35 (бутархайн хуримтлагдсан алдаагүй)', () => {
  let d = 0;
  for (let i = 0; i < 3; i += 1) d = U.stepUp(d, pts(45), 1).next;
  assert.equal(d, 13500);
  assert.equal(fmt(d), '1.35');
});
ok('− : доод хязгаар (түгжигдсэн хийсэн)-аас доош орохгүй', () => {
  const r = U.stepDown(pts(4.2), pts(4), pts(5), 10); // 4.2 − 0.5 → 4 (floor)
  assert.equal(fmt(r.next), '4');
  assert.equal(fmt(r.delta), '-0.2');
  assert.equal(U.stepDown(pts(4), pts(4), pts(5), 10).next, pts(4));
});
ok('«Үлдсэн ажлаа дуусгах»: 0/5 → +5; 80/90 → +10 (энгийн алхамаас ӨӨР)', () => {
  const a = U.finishRemaining(0, pts(5));
  assert.equal(fmt(a.next), '5');
  assert.equal(fmt(a.delta), '5');
  const b = U.finishRemaining(pts(80), pts(90));
  assert.equal(fmt(b.next), '90');
  assert.equal(fmt(b.delta), '10');
  assert.equal(fmt(U.remainingUnits(pts(80), pts(90))), '10');
});
ok('тоо унших: 2.5 / 5 → 25000; таслал; «.5», «5.»', () => {
  assert.deepEqual(U.parseUnits('2.5'), { ok: true, units: 25000 });
  assert.deepEqual(U.parseUnits('2,5'), { ok: true, units: 25000 });
  assert.deepEqual(U.parseUnits('.5'), { ok: true, units: 5000 });
  assert.deepEqual(U.parseUnits('5.'), { ok: true, units: 50000 });
  assert.deepEqual(U.parseUnits('0.0001'), { ok: true, units: 1 });
  assert.deepEqual(U.parseUnits(' 90 '), { ok: true, units: 900000 });
});
ok('тоо унших ХАТУУ: хоосон, үсэг, e-бичиглэл, сөрөг, 5 орон, хэт том', () => {
  assert.equal(U.parseUnits('').code, 'EMPTY');
  assert.equal(U.parseUnits('   ').code, 'EMPTY');
  assert.equal(U.parseUnits('5junk').code, 'FORMAT');
  assert.equal(U.parseUnits('1e3').code, 'FORMAT');
  assert.equal(U.parseUnits('.').code, 'FORMAT');
  assert.equal(U.parseUnits('1.2.3').code, 'FORMAT');
  assert.equal(U.parseUnits('-1').code, 'NEGATIVE');
  assert.equal(U.parseUnits('1.23456').code, 'PRECISION');
  assert.equal(U.parseUnits('100.0001').code, 'RANGE');
  assert.equal(U.parseUnits('5.0001', pts(5)).code, 'RANGE');
  assert.deepEqual(U.parseUnits('5', pts(5)), { ok: true, units: 50000 });
});
ok('формат: ардын тэг, хэрэггүй цэггүй; parse(format(x)) = x', () => {
  for (const u of [0, 1, 500, 5000, 25000, 45000, 900000, 1_000_000, 123456]) {
    const p = U.parseUnits(fmt(u));
    assert.equal(p.ok && p.units, u);
  }
  assert.equal(fmt(500), '0.05');
  assert.equal(fmt(1), '0.0001');
  assert.equal(fmt(900000), '90');
});
ok('equalUnits / largestRemainder: нийлбэр ЯГ total', () => {
  for (const [total, n] of [[1_000_000, 3], [999_999, 7], [10, 3], [0, 4]]) {
    const parts = U.equalUnits(total, n);
    assert.equal(parts.reduce((s, x) => s + x, 0), total);
    assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
  }
  const lr = U.largestRemainder(200_000, [500_000, 250_000, 250_000]);
  assert.deepEqual(lr, [100_000, 50_000, 50_000]);
  assert.equal(U.largestRemainder(1_000_000, [1, 1, 1]).reduce((s, x) => s + x, 0), 1_000_000);
});

/* ------------------------------------------------------------------ */
/*  C. Төлөвлөгч (allocation.ts)                                        */
/* ------------------------------------------------------------------ */

const state = (rows, B = 0, Uu = 0) => ({
  unattributedUnits: B,
  unallocatedUnits: Uu,
  rows: rows.map(([userId, d, t, f]) => ({ userId, doneUnits: pts(d), targetUnits: pts(t), floorUnits: pts(f ?? d) })),
});
const empty = () => ({ unattributedUnits: 0, unallocatedUnits: U.ROOT_TOTAL_UNITS, rows: [] });
const targetsOf = (plan) => Object.fromEntries(plan.rows.map((r) => [r.userId, Number(fmt(r.targetUnits))]));

ok('төлөвлөгч: 2 зөөлөн мөр → 50 / 50; 3 → 33.3334 / 33.3333 / 33.3333 (нийлбэр 100)', () => {
  const p2 = A.planAllocation({ mode: 'total', state: empty(), workers: [{ userId: 1 }, { userId: 2 }] });
  assert.ok(p2.ok);
  assert.deepEqual(targetsOf(p2), { 1: 50, 2: 50 });
  const p3 = A.planAllocation({ mode: 'total', state: empty(), workers: [{ userId: 1 }, { userId: 2 }, { userId: 3 }] });
  assert.ok(p3.ok);
  assert.equal(p3.rows.reduce((s, r) => s + r.targetUnits, 0), 1_000_000);
});
ok('төлөвлөгч: хийсэн 80-тай А үргэлжилбэл 80 / 90 (үлдсэн 20-аас 10)', () => {
  const st = state([[1, 80, 80]], 0, pts(20));
  const p = A.planAllocation({
    mode: 'remainder',
    state: st,
    workers: [{ userId: 1, fixed: 500_000 }, { userId: 2 }],
  });
  assert.ok(p.ok);
  assert.equal(p.remainingUnits, pts(20));
  assert.deepEqual(targetsOf(p), { 1: 90, 2: 10 });
});
ok('төлөвлөгч: үлдсэн ажлын хувь A=50%, B=25%, C=25% → нийт зорилт 90 / 5 / 5', () => {
  const st = state([[1, 80, 80]], 0, pts(20));
  const p = A.planAllocation({
    mode: 'remainder',
    state: st,
    workers: [{ userId: 1, fixed: 500_000 }, { userId: 2 }, { userId: 3 }],
  });
  assert.ok(p.ok);
  assert.deepEqual(targetsOf(p), { 1: 90, 2: 5, 3: 5 });
});
ok('төлөвлөгч: хийсэн хэсэг буурахгүй — D нь тэнцүү хувиас их бол мөр D дээр тулна', () => {
  const st = state([[1, 30, 30]], 0, pts(70));
  const p = A.planAllocation({
    mode: 'total',
    state: st,
    workers: [{ userId: 1 }, { userId: 2, fixed: pts(90) }],
  });
  assert.equal(p.ok, false);
  assert.equal(p.code, 'SUM_MISMATCH');
  const q = A.planAllocation({ mode: 'total', state: st, workers: [{ userId: 1 }, { userId: 2, fixed: pts(40) }] });
  assert.ok(q.ok);
  assert.deepEqual(targetsOf(q), { 1: 60, 2: 40 });
  const w = A.planAllocation({ mode: 'total', state: st, workers: [{ userId: 1, fixed: pts(20) }, { userId: 2 }] });
  assert.equal(w.ok, false);
  assert.equal(w.code, 'BELOW_DONE');
});
ok('applyFinalTargets: Σ T + B = 100, T ≥ D, шинэ хүнд T > 0, түүхтэй хүн түүх болно', () => {
  const st = state([[1, 80, 90], [2, 0, 10]], 0, 0);
  const r = A.applyFinalTargets(st, [
    { userId: 1, targetUnits: pts(95) },
    { userId: 3, targetUnits: pts(5) },
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.created, [3]);
  assert.deepEqual(r.dropped, [2]); // D = 0 → цуцлагдсан
  assert.equal(r.state.rows.find((x) => x.userId === 1).floorUnits, pts(80)); // L := D
  const bad = A.applyFinalTargets(st, [{ userId: 1, targetUnits: pts(70) }, { userId: 3, targetUnits: pts(30) }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'BELOW_DONE');
  const sum = A.applyFinalTargets(st, [{ userId: 1, targetUnits: pts(90) }]);
  assert.equal(sum.ok, false);
  assert.equal(sum.code, 'SUM_MISMATCH');
});
ok('planOwnProgress: BELOW_FLOOR, OVER_TARGET, QA хүрээ (own cap / root 100)', () => {
  const st = state([[1, 2, 5, 1], [2, 93, 95]], 0, 0); // root = 95 → миний 5-д хүрвэл 98
  assert.equal(A.planOwnProgress(st, 1, pts(0.5)).code, 'BELOW_FLOOR');
  assert.equal(A.planOwnProgress(st, 1, pts(5.1)).code, 'OVER_TARGET');
  const r = A.planOwnProgress(st, 1, pts(5));
  assert.ok(r.ok && r.reachesOwnCap && !r.completesRoot);
  const st2 = state([[1, 2, 5, 1], [2, 95, 95]], 0, 0); // root = 97 → +3 = 100
  const c = A.planOwnProgress(st2, 1, pts(5));
  assert.ok(c.ok && c.reachesOwnCap && c.completesRoot);
});
ok('planRelease / planRetake: D бусдад шилжихгүй, дахин авбал D хэвээр', () => {
  const st = state([[1, 30, 50], [2, 10, 40]], 0, pts(10));
  const rel = A.planRelease(st, 1, null);
  assert.ok(rel.ok);
  assert.equal(rel.state.unallocatedUnits, pts(30)); // 10 + (50 − 30)
  assert.equal(rel.state.rows.find((x) => x.userId === 1).targetUnits, pts(30));
  assert.equal(rel.state.rows.find((x) => x.userId === 2).doneUnits, pts(10));
  const re = A.planRetake(rel.state, 1, null);
  assert.ok(re.ok);
  assert.equal(re.state.rows.find((x) => x.userId === 1).doneUnits, pts(30)); // 0-ээс эхлэхгүй
  assert.equal(re.takenUnits, pts(30));
});
ok('дугаар: 17 → 17.1 … 17.10 нь 17.2-оос ХОЙШ', () => {
  const labels = ['17.10', '17.2', '17', '17.1', '9', '17.3'];
  assert.deepEqual([...labels].sort(A.compareLabels), ['9', '17', '17.1', '17.2', '17.3', '17.10']);
  assert.equal(A.childLabel(17, 3), '17.3');
});
ok('инвариант: checkRootInvariants эрүүл төлөвт хоосон, зөрчилд код буцаана', () => {
  assert.deepEqual(A.checkRootInvariants(state([[1, 10, 60], [2, 0, 40]])), []);
  assert.ok(A.checkRootInvariants(state([[1, 10, 60], [2, 0, 41]])).includes('SUM_NOT_100'));
  assert.ok(A.checkRootInvariants(state([[1, 70, 60], [2, 0, 40]])).some((x) => x.startsWith('DONE_OVER_TARGET')));
});

/* ------------------------------------------------------------------ */
/*  D. Өөрийн явцын ноорог (ownProgress.ts)                             */
/* ------------------------------------------------------------------ */

const base = (over = {}) => ({
  taskId: 1,
  userId: 7,
  revision: 3,
  rootDone: 0,
  done: 0,
  floor: 0,
  target: pts(5),
  ...over,
});

ok('ноорог: + дарахад ЮУ Ч бичигдэхгүй, ноорог л (dirty — «Хадгалах» хүлээнэ)', () => {
  let d = O.newDraft(base());
  d = O.applyStep(d, 'up', 10);
  assert.equal(d.desired, pts(0.5));
  assert.equal(d.phase, 'dirty');
  assert.equal(d.base.done, 0); // сервер хэвээр
  assert.equal('dueAt' in d, false); // автомат хадгалалтын цаг байхгүй (2026-10-06)
  d = O.applyStep(d, 'up', 10);
  assert.equal(d.desired, pts(1));
});
ok('ноорог: − нь доод хязгаараас доош орохгүй, 1%-ийн алхам', () => {
  let d = O.newDraft(base({ done: pts(2), floor: pts(1.5), rootDone: pts(2) }));
  d = O.applyStep(d, 'down', 10); // 2 − 0.5 = 1.5
  assert.equal(d.desired, pts(1.5));
  const same = O.applyStep(d, 'down', 10);
  assert.equal(same.desired, pts(1.5)); // floor
  d = O.applyStep(O.newDraft(base()), 'up', 1);
  assert.equal(d.desired, pts(0.05));
});
ok('ноорог: серверийн утга руу буцвал clean (бичилт хэрэггүй); «Өөрчлөлт буцаах»', () => {
  let d = O.applyStep(O.newDraft(base()), 'up', 10);
  d = O.applyStep(d, 'down', 10);
  assert.equal(d.phase, 'clean');
  d = O.applyStep(O.newDraft(base()), 'up', 10);
  d = O.revert(d);
  assert.equal(d.desired, 0);
  assert.equal(d.phase, 'clean');
});
ok('ноорог: тоо бичих — 2.5 / 5; хэт олон орон, зорилтоос их, доод хязгаараас бага бол өөрчлөгдөхгүй', () => {
  const d = O.newDraft(base({ done: pts(1), floor: pts(1), rootDone: pts(1) }));
  const good = O.applyTyped(d, '2.5');
  assert.ok(good.ok);
  assert.equal(good.draft.desired, pts(2.5));
  assert.deepEqual(O.applyTyped(d, '2.55555'), { ok: false, code: 'PRECISION' });
  assert.deepEqual(O.applyTyped(d, '5.5'), { ok: false, code: 'RANGE' });
  assert.deepEqual(O.applyTyped(d, '0.5'), { ok: false, code: 'BELOW_FLOOR' });
  assert.deepEqual(O.applyTyped(d, 'abc'), { ok: false, code: 'FORMAT' });
});
ok('«Үлдсэн ажлаа дуусгах»: 0/5 → 5; 80/90 → 90 (+10); зорилтод хүрэх нь QA шаардана', () => {
  let d = O.applyStep(O.newDraft(base()), 'finish', 10);
  assert.equal(d.desired, pts(5));
  assert.ok(d.qaNeed);
  assert.deepEqual(d.qaNeed.scopes, { own: true, root: false });
  const b = base({ done: pts(80), floor: pts(80), target: pts(90), rootDone: pts(80) });
  d = O.applyStep(O.newDraft(b), 'finish', 10);
  assert.equal(d.desired, pts(90));
  assert.equal(O.viewOf(O.newDraft(b)).remaining, pts(10));
});
ok('QA: өөрийн хэсэг + үндсэн ажил 100% хоёулаа НЭГ цонхонд (хоёр хүрээ)', () => {
  const b = base({ done: 0, floor: 0, target: pts(5), rootDone: pts(95) });
  const d = O.applyStep(O.newDraft(b), 'finish', 10);
  assert.deepEqual(d.qaNeed.scopes, { own: true, root: true });
  const only = O.needsCompletionQa(base({ target: pts(5), rootDone: pts(50) }), pts(2));
  assert.equal(only, null); // зорилтод ч, 100%-д ч хүрэхгүй
});
ok('QA: «Болих» нь зорилтод хүргэсэн өөрчлөлтийг л буцаана (өмнөх ноорог хэвээр)', () => {
  let d = O.applyStep(O.newDraft(base()), 'up', 10); // 0.5
  d = O.applyTyped(d, '4.5').draft;
  d = O.applyStep(d, 'up', 10); // 5.0 → QA
  assert.ok(d.qaNeed);
  d = O.cancelQa(d);
  assert.equal(d.desired, pts(4.5));
  assert.equal(d.qaNeed, null);
  const ans = O.attachQa(O.applyStep(O.newDraft(base()), 'finish', 10), { q1: 'x' });
  assert.equal(ans.qaNeed, null);
  assert.deepEqual(ans.qa, { q1: 'x' });
});
ok('хадгалалт явж байхад ноорог өөрчлөгдөхгүй', () => {
  const d = { ...O.applyStep(O.newDraft(base()), 'up', 10), phase: 'saving' };
  assert.equal(O.applyStep(d, 'up', 10).desired, d.desired);
  assert.equal(O.revert(d).phase, 'saving');
});
ok('серверийн шинэ төлөвт дахин суух: ноорог хэвээр, шинэ хүрээнд хавчигдана, хуучин revision үл тооно', () => {
  const d0 = O.applyStep(O.applyStep(O.newDraft(base()), 'up', 10), 'up', 10); // 1.0
  const same = O.rebase(d0, base({ revision: 4, rootDone: pts(3) }));
  assert.equal(same.desired, pts(1));
  assert.equal(same.phase, 'dirty');
  assert.equal(same.base.revision, 4);
  const clamped = O.rebase(d0, base({ revision: 4, target: pts(0.5) }));
  assert.equal(clamped.desired, pts(0.5));
  const old = O.rebase(d0, base({ revision: 2 }));
  assert.equal(old, d0);
  const gone = O.rebase(d0, base({ revision: 4, done: pts(1) }));
  assert.equal(gone.phase, 'clean'); // сервер аль хэдийн 1.0 — бичилт хэрэггүй
});
ok('baseFromRoot: хариунаас миний мөр; хуваарилалтгүй бол null', () => {
  const root = {
    task_id: 9,
    revision: 5,
    root_done_units: pts(40),
    participants: [{ user_id: 7, target_units: pts(50), done_units: pts(30), floor_units: pts(20) }],
  };
  assert.deepEqual(O.baseFromRoot(root, 7), {
    taskId: 9, userId: 7, revision: 5, rootDone: pts(40), done: pts(30), floor: pts(20), target: pts(50),
  });
  assert.equal(O.baseFromRoot(root, 8), null);
});

/* ------------------------------------------------------------------ */
/*  E. Засварлагчийн загвар (allocationEditor.ts)                       */
/* ------------------------------------------------------------------ */

const shown = (m) => {
  const p = E.planOf(m);
  assert.ok(p.ok, p.message);
  return Object.fromEntries(p.rows.map((r) => [r.userId, Number(fmt(r.targetUnits))]));
};
const managed2 = () => state([[1, 0, 50], [2, 0, 50]]);

ok('засварлагч: нээхэд одоогийн хуваарилалт ХЭВЭЭР (pristine, өөрчлөлтгүй)', () => {
  const m = E.initEditor({ base: managed2(), mode: 'total', workers: [1, 2] });
  assert.equal(m.pristine, true);
  assert.deepEqual(shown(m), { 1: 50, 2: 50 });
  assert.equal(E.isChanged(m), false);
});
ok('засварлагч: 50/50 → А=40 бол Б=60', () => {
  let m = E.initEditor({ base: managed2(), mode: 'total', workers: [1, 2] });
  m = E.setRowValue(m, 1, pts(40));
  assert.deepEqual(shown(m), { 1: 40, 2: 60 });
  assert.equal(E.isChanged(m), true);
});
ok('засварлагч: гурван хүнд А=60 бол Б=В=20; дараа нь Б=10 бол В=30 (А хэвээр)', () => {
  const st = state([[1, 0, 34], [2, 0, 33], [3, 0, 33]]);
  let m = E.initEditor({ base: st, mode: 'total', workers: [1, 2, 3] });
  m = E.setRowValue(m, 1, pts(60));
  assert.deepEqual(shown(m), { 1: 60, 2: 20, 3: 20 });
  m = E.setRowValue(m, 2, pts(10));
  assert.deepEqual(shown(m), { 1: 60, 2: 10, 3: 30 });
});
ok('засварлагч: бүх мөр гараар засагдвал хамгийн эртний нь чөлөөлөгдөнө (нийлбэр 100)', () => {
  const st = state([[1, 0, 34], [2, 0, 33], [3, 0, 33]]);
  let m = E.initEditor({ base: st, mode: 'total', workers: [1, 2, 3] });
  m = E.setRowValue(m, 1, pts(50));
  m = E.setRowValue(m, 2, pts(30));
  m = E.setRowValue(m, 3, pts(20)); // бүгд гараар → А (эртний) чөлөөлөгдөнө
  assert.deepEqual(shown(m), { 1: 50, 2: 30, 3: 20 });
  assert.equal(m.fixed[1], undefined);
});
ok('засварлагч: хийсэн 80-тай таскт «үлдсэн ажлын хувь» A=50% → 90/5/5; горим солиход утга цэвэрлэгдэнэ', () => {
  const st = state([[1, 80, 80]], 0, pts(20));
  let m = E.initEditor({ base: st, mode: 'remainder', workers: [1, 2, 3] });
  m = E.setRowValue(m, 1, 500_000);
  assert.deepEqual(shown(m), { 1: 90, 2: 5, 3: 5 });
  const p = E.planOf(m);
  assert.deepEqual(p.rows.map((r) => r.remainderShareUnits), [500_000, 250_000, 250_000]);
  assert.deepEqual(E.toTargets(p), [
    { user_id: 1, target_units: pts(90) },
    { user_id: 2, target_units: pts(5) },
    { user_id: 3, target_units: pts(5) },
  ]);
  m = E.setMode(m, 'total');
  assert.deepEqual(m.fixed, {});
});
ok('засварлагч: хүн хасахад хийсэн хэсэг түүхэнд үлдэнэ, D=0 бол алга болно; нэмэхэд дахин тэнцүүлнэ', () => {
  const st = state([[1, 20, 50], [2, 0, 50]]);
  let m = E.initEditor({ base: st, mode: 'total', workers: [1, 2] });
  m = E.removeWorker(m, 1);
  const p = E.planOf(m);
  assert.ok(p.ok);
  const hist = p.rows.find((r) => r.userId === 1);
  assert.equal(hist.continues, false);
  assert.equal(hist.targetUnits, pts(20)); // түүх: T = D
  assert.equal(p.rows.find((r) => r.userId === 2).targetUnits, pts(80));
  m = E.addWorker(E.initEditor({ base: managed2(), mode: 'total', workers: [1, 2] }), 3);
  assert.equal(m.pristine, false);
  assert.equal(E.planOf(m).rows.reduce((s, r) => s + r.targetUnits, 0), 1_000_000);
});
ok('засварлагч: нэг хүн л үлдвэл бүх үлдсэнийг авна', () => {
  let m = E.initEditor({ base: managed2(), mode: 'total', workers: [1, 2] });
  m = E.removeWorker(m, 2);
  assert.deepEqual(shown(m), { 1: 100 });
});
ok('засварлагч: нийлбэрийн мөр; өөрчлөлтгүй бол isChanged=false', () => {
  const m = E.initEditor({ base: managed2(), mode: 'total', workers: [1, 2] });
  const p = E.planOf(m);
  assert.deepEqual(E.sumLine(p, m.base, 'total'), { sum: 1_000_000, total: 1_000_000 });
  const eq = E.resetEqual(m);
  assert.equal(E.isChanged(eq), false); // 50/50 → 50/50
});

/* ------------------------------------------------------------------ */
/*  F. Хувь нэмэрч, нэр                                                 */
/* ------------------------------------------------------------------ */

const row = (over) => ({
  user_id: 1,
  full_name: 'Бат-Өлзий Билгүүн',
  profile_image: null,
  official_closed_ms: 0,
  running_since: null,
  repair_hours: 0,
  done_units: null,
  target_units: null,
  floor_units: null,
  ordinal: null,
  allocation_status: null,
  contributor: true,
  evidence: [],
  ...over,
});
ok('хувь нэмэрч: ажиллаж буй / түр зогссон / хийсэн / хуваарилагдсан төлөв', () => {
  const rows = [
    row({ user_id: 1, official_closed_ms: 5000, running_since: '2026-10-02T01:00:00.000Z', ordinal: 1, done_units: 10, target_units: 50, allocation_status: 'active' }),
    row({ user_id: 2, official_closed_ms: 7000, ordinal: 2, done_units: 5, target_units: 50, allocation_status: 'active' }),
    row({ user_id: 3, ordinal: 3, done_units: 30, target_units: 30, allocation_status: 'history' }),
    row({ user_id: 4, ordinal: 4, done_units: 0, target_units: 40, allocation_status: 'active', contributor: false }),
  ];
  const items = C.buildItems(rows, [], 9);
  assert.deepEqual(items.map((i) => i.state), ['running', 'paused', 'history', 'assigned']);
  assert.equal(items[0].runningWorker.task_id, 9); // админ зогсоох товчонд
  assert.ok(items[0].since > 0);
  assert.equal(items[1].since, null);
});
ok('хувь нэмэрч: дөнгөж эхэлсэн хүн (жагсаалтад хараахан алга) «ажиллаж байна»-аар нэмэгдэнэ', () => {
  const items = C.buildItems([row({ user_id: 1, official_closed_ms: 1000 })], [{ task_id: 9, user_id: 2, full_name: 'Нар Д', profile_image: null }], 9);
  assert.equal(items.length, 2);
  assert.equal(items[1].state, 'running');
});
ok('нэр: «Овог Нэр» → «О.Нэр»; нэг үгтэй хэвээр; DB нэр өөрчлөгдөхгүй', () => {
  assert.equal(N.formatStaffShortName('Бат-Өлзий Билгүүн'), 'Б.Билгүүн');
  assert.equal(N.formatStaffShortName('  Дорж   Нар  Эрдэнэ '), 'Д.Нар Эрдэнэ');
  assert.equal(N.formatStaffShortName('Ганбат'), 'Ганбат');
  assert.equal(N.formatStaffShortName(null), '');
  assert.equal(N.formatStaffShortName('david smith'), 'D.smith');
});
ok('нэр: давхцсан богино нэр бүтэн нэрээр; ижил id нэг л хүн', () => {
  const labels = N.shortNameLabels([
    { user_id: 1, full_name: 'Бат Болд' },
    { user_id: 2, full_name: 'Батаа Болд' },
    { user_id: 3, full_name: 'Дорж Нар' },
  ]);
  assert.equal(labels.get(3), 'Д.Нар');
  assert.equal(labels.get(1), 'Болд Бат');
  assert.equal(labels.get(2), 'Болд Батаа');
  const same = N.shortNameLabels([
    { user_id: 1, full_name: 'Бат Болд' },
    { user_id: 1, full_name: 'Бат Болд' },
  ]);
  assert.equal(same.get(1), 'Б.Болд');
});

/* ------------------------------------------------------------------ */
/*  G. i18n                                                             */
/* ------------------------------------------------------------------ */

const readJson = (name) => JSON.parse(readFileSync(join(SRC, 'shared', 'i18n', name), 'utf8').replace(/^﻿/, ''));
const mn = readJson('mn.json');
const en = readJson('en.json');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const KEY_RE = /'((?:taskAlloc\.[A-Za-z0-9_.]+)|(?:taskTimer\.(?:errNotAllocated|errManagedRoot|noteAllocRelease|noteAllocComplete|noteVoid))|(?:projectDetailPage\.drawingMetaNoWeight))'/g;
const used = new Set();
for (const file of [
  ...walk(ALLOC),
  join(SRC, 'features', 'projects', 'detail', 'TaskLiveCell.tsx'),
  join(SRC, 'features', 'projects', 'detail', 'DrawingRow.tsx'),
  join(SRC, 'features', 'tasks', 'MyTasksPage.tsx'),
  join(SRC, 'features', 'task-timer', 'officialTimer.ts'),
]) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(KEY_RE)) used.add(m[1]);
}

ok(`i18n: кодод хэрэглэсэн ${used.size} түлхүүр бүр mn БА en-д бий`, () => {
  const missing = [...used].filter((k) => !(k in mn) || !(k in en));
  assert.deepEqual(missing, []);
});
ok('i18n: taskAlloc.* түлхүүрийн олонлог mn ≡ en', () => {
  const a = Object.keys(mn).filter((k) => k.startsWith('taskAlloc.')).sort();
  const b = Object.keys(en).filter((k) => k.startsWith('taskAlloc.')).sort();
  assert.deepEqual(a, b);
  assert.ok(a.length > 100);
});
ok('i18n: placeholder-ууд mn ≡ en (түлхүүр бүрд)', () => {
  const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = [];
  for (const k of Object.keys(mn)) {
    if (!k.startsWith('taskAlloc.') && !used.has(k)) continue;
    if (holders(mn[k]) !== holders(en[k] ?? '')) bad.push(`${k}: ${holders(mn[k])} ≠ ${holders(en[k] ?? '')}`);
  }
  assert.deepEqual(bad, []);
});
ok('i18n: монгол текстэд англи placeholder/түр үг үлдээгүй', () => {
  const bad = Object.entries(mn)
    .filter(([k]) => k.startsWith('taskAlloc.'))
    .filter(([, v]) => /\b(TODO|FIXME|lorem)\b/i.test(v) || v.trim() === '')
    .map(([k]) => k);
  assert.deepEqual(bad, []);
});

console.log(`task-units: ${passed} шалгалт ногоон${failed ? `, ${failed} УНАЛАА` : ''} (i18n түлхүүр ${used.size})`);
if (failed > 0) process.exit(1);
