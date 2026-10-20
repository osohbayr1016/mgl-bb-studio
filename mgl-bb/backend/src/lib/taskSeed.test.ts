// Хуучин таскийг «managed» болгох seed — нотолгоотой атрибуци (2026-10-02).  Дүрэм: `lib/taskSeed.ts`.
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

const S = await import('./taskSeed.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);

let entryId = 0;
const entry = (userId: number, pct: number, extra: Partial<{ isBaseline: boolean; creditUserId: number | null; source: string | null }> = {}) => ({
  id: ++entryId,
  userId,
  creditUserId: extra.creditUserId ?? null,
  isBaseline: extra.isBaseline ?? false,
  source: extra.source ?? 'web',
  units: pt(pct),
});
let pid = 0;
/** coef = 0.1 → 1 пункт = 0.1 төслийн % ; complexity 100 → оноо = Δ%. */
const credit = (userId: number, rootPoints: number, day = '2026-09-20T09:00:00Z', coef = 0.1) => ({
  pointsId: ++pid,
  userId,
  deltaPct: rootPoints * coef,
  amount: rootPoints * coef,
  awardedAt: day,
  progressEntryId: pid,
});

test('түүхгүй таск: empty, B=0, slack=0', () => {
  const r = S.planSeed({ entries: [], credits: [], coef: 0.1 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'empty');
    assert.equal(r.rootDoneUnits, 0);
    assert.equal(r.unattributedUnits, 0);
    assert.equal(r.slackUnits, 0);
    assert.deepEqual(r.slices, []);
  }
});

test('цэвэр: нэг хүн 0 → 30 → 60 (монотон), оноо 60-тай таарна → D=60, B=0', () => {
  const r = S.planSeed({
    entries: [entry(1, 30), entry(1, 60)],
    credits: [credit(1, 30), credit(1, 30)],
    coef: 0.1,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'clean');
    assert.equal(r.rootDoneUnits, pt(60));
    assert.equal(r.unattributedUnits, 0);
    assert.equal(r.slackUnits, 0);
    assert.equal(r.slices.length, 2);
    assert.equal(r.slices.reduce((s, x) => s + x.units, 0), pt(60));
    assert.ok(r.slices.every((x) => x.userId === 1));
  }
});

test('цэвэр: хоёр хүн дараалан (A 0→30, B 30→60) — хүн бүр өөрийн хэсгийг авна', () => {
  const r = S.planSeed({
    entries: [entry(1, 30), entry(2, 60)],
    credits: [credit(1, 30), credit(2, 30)],
    coef: 0.1,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'clean');
    const byUser = new Map<number, number>();
    for (const s of r.slices) byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + s.units);
    assert.equal(byUser.get(1), pt(30));
    assert.equal(byUser.get(2), pt(30));
  }
});

test('слайс бүр анхны оноо мөр рүү ЛАВЛАНА (анхны өдөр, дүн, points id) — шинэ оноо үүсгэхгүй', () => {
  const c = credit(7, 25, '2026-08-15T05:00:00Z');
  const r = S.planSeed({ entries: [entry(7, 25)], credits: [c], coef: 0.1 });
  assert.equal(r.ok, true);
  if (r.ok) {
    const sl = r.slices[0]!;
    assert.equal(sl.pointsId, c.pointsId);
    assert.equal(sl.awardedAt, '2026-08-15T05:00:00Z');
    assert.equal(sl.amount, c.amount);
    assert.equal(sl.deltaPct, c.deltaPct);
  }
});

test('оноо цөөн: нэг хэсэг оноогүй (baseline-д хүн байхгүй) → B = үлдсэн, шууд хүнд ноогдохгүй', () => {
  // Хүчинтэй 60, оноотой нь зөвхөн 40 (20 нь baseline, оноо авагчгүй)
  const r = S.planSeed({
    entries: [entry(9, 20, { isBaseline: true, creditUserId: null }), entry(1, 60)],
    credits: [credit(1, 40)],
    coef: 0.1,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'clean');
    assert.equal(r.rootDoneUnits, pt(60));
    assert.equal(r.slices.reduce((s, x) => s + x.units, 0), pt(40));
    assert.equal(r.unattributedUnits, pt(20)); // хэнд ч ноогдоогүй
    assert.ok(r.reasons.includes('UNATTRIBUTED_REMAINDER'));
    assert.ok(r.reasons.includes('BASELINE_WITHOUT_CREDIT_USER'));
  }
});

test('хуучин 77 → 8 (буурсан): эргэлзээтэй — бүх хүчинтэй хийсэн нь эзэнгүй, 69 нь slack', () => {
  const r = S.planSeed({
    entries: [entry(1, 77), entry(2, 8)],
    credits: [credit(1, 77)],
    coef: 0.1,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'uncertain');
    assert.equal(r.rootDoneUnits, pt(8));
    assert.equal(r.unattributedUnits, pt(8));
    assert.deepEqual(r.slices, []); // хэнд ч ноогдуулаагүй
    assert.equal(r.slackUnits, pt(69)); // 77 төлөгдсөн − 8 хүчинтэй
    assert.ok(r.reasons.includes('NOT_MONOTONE'));
  }
});

test('хүчинтэйгээс ИЛҮҮ оноо (монотон боловч оноо > хувь): эргэлзээтэй', () => {
  const r = S.planSeed({
    entries: [entry(1, 50)],
    credits: [credit(1, 80)],
    coef: 0.1,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'uncertain');
    assert.equal(r.unattributedUnits, pt(50));
    assert.equal(r.slackUnits, pt(30));
    assert.ok(r.reasons.includes('CREDIT_EXCEEDS_VALID'));
  }
});

test('дугуйлалтын жижиг зөрүү: оноо хүчинтэйгээс ≤ хүлцэл давбал сүүлийн хэсгээс тайрч ЯГ таарна', () => {
  // coef 0.3 → 33.3333 пункт × 0.3 = 9.99999; units хөрвүүлэлтэд ±1
  const r = S.planSeed({
    entries: [entry(1, 33.3333)],
    credits: [credit(1, 33.3334, '2026-09-01T00:00:00Z', 0.3)],
    coef: 0.3,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'clean');
    assert.equal(r.rootDoneUnits, pt(33.3333));
    assert.equal(r.slices.reduce((s, x) => s + x.units, 0) + r.unattributedUnits, pt(33.3333));
    assert.equal(r.slackUnits, 0);
  }
});

test('хуучин хуваалтын «хийгдсэн хэсэг» (source=split) — татгалзана', () => {
  const r = S.planSeed({ entries: [entry(1, 40), entry(1, 100, { source: 'split' })], credits: [], coef: 0.1 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'SPLIT_DONE_PART');
});

test('сүүлийн хувь 0 (бууруулаад 0 болсон) — empty, гэхдээ төлөгдсөн оноо slack болж давхар төлөхгүй', () => {
  const r = S.planSeed({
    entries: [entry(1, 40), entry(1, 0)],
    credits: [credit(1, 40)],
    coef: 0.1,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'empty');
    assert.equal(r.rootDoneUnits, 0);
    assert.equal(r.slackUnits, pt(40));
  }
});

test('coef = 0 (зургийн жин 0) — оноо авах боломжгүй, хүчинтэй хийсэн нь эзэнгүй', () => {
  const r = S.planSeed({ entries: [entry(1, 30)], credits: [], coef: 0 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'uncertain');
    assert.equal(r.unattributedUnits, pt(30));
    assert.equal(r.slackUnits, 0);
  }
});

test('буруу оролт: coef сөрөг, хувь хүрээнээс гадуур', () => {
  assert.equal(S.planSeed({ entries: [], credits: [], coef: -1 }).ok, false);
  const bad = S.planSeed({ entries: [{ id: 1, userId: 1, creditUserId: null, isBaseline: false, source: 'web', units: -1 }], credits: [], coef: 1 });
  assert.equal(bad.ok, false);
});

test('seed ХЭЗЭЭ Ч шинэ оноо бүтээхгүй: слайсуудын нийлбэр оноо = оролтын оноо (цэвэр үед)', () => {
  const credits = [credit(1, 10), credit(2, 20), credit(1, 15)];
  const r = S.planSeed({ entries: [entry(1, 10), entry(2, 30), entry(1, 45)], credits, coef: 0.1 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.attribution, 'clean');
    const sumAmount = r.slices.reduce((s, x) => s + x.amount, 0);
    assert.ok(Math.abs(sumAmount - credits.reduce((s, c) => s + c.amount, 0)) < 1e-12);
  }
});
