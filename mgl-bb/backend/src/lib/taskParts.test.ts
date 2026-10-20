// Хүнгүй хэсэг (0394) — цэвэр дүрэм.
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

const { MAX_TASK_PARTS, mergedLabel, planParts, reservedUnitsOf } = await import('./taskParts.ts');

const pt = (p: number) => Math.round(p * 10_000);

test('planParts: шинэ хэсгүүд дараагийн дугаараас, нийлбэр ≤ чөлөөт', () => {
  const r = planParts([], [{ label: ' суурь  ', units: pt(40) }, { label: 'тоноглол', units: pt(35) }, { label: 'шугам', units: pt(25) }], pt(100), 1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.parts.map((p) => [p.id, p.ordinal, p.label, p.units]), [
    [null, 1, 'суурь', pt(40)],
    [null, 2, 'тоноглол', pt(35)],
    [null, 3, 'шугам', pt(25)],
  ]);
  assert.equal(r.nextOrdinal, 4);
  assert.deepEqual(r.removed, []);
  assert.equal(reservedUnitsOf(r.parts), pt(100));
});

test('planParts: одоо байгааг засна (дугаар хэвээр), орхигдсоныг устгана, шинэ нь шинэ дугаар', () => {
  const existing = [
    { id: 7, ordinal: 3, label: 'а', units: pt(20) },
    { id: 8, ordinal: 4, label: 'б', units: pt(20) },
  ];
  const r = planParts(existing, [{ id: 8, label: 'б2', units: pt(10) }, { label: 'в', units: pt(15) }], pt(40), 6);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.parts.map((p) => [p.id, p.ordinal, p.label]), [[8, 4, 'б2'], [null, 6, 'в']]);
  assert.deepEqual(r.removed, [7]);
  assert.equal(r.nextOrdinal, 7);
});

test('planParts: алдаанууд — хоосон нэр, 0 хувь, хэт олон, мэдэгдэхгүй id, давхар id, чөлөөтөөс их', () => {
  const ex = [{ id: 1, ordinal: 1, label: 'а', units: pt(10) }];
  assert.equal((planParts(ex, [{ label: '  ', units: pt(5) }], pt(50), 2) as { code: string }).code, 'BAD_LABEL');
  assert.equal((planParts(ex, [{ label: 'x'.repeat(121), units: pt(5) }], pt(50), 2) as { code: string }).code, 'BAD_LABEL');
  assert.equal((planParts(ex, [{ label: 'а', units: 0 }], pt(50), 2) as { code: string }).code, 'BAD_VALUE');
  assert.equal((planParts(ex, [{ label: 'а', units: 1.5 }], pt(50), 2) as { code: string }).code, 'BAD_VALUE');
  const many = Array.from({ length: MAX_TASK_PARTS + 1 }, (_, i) => ({ label: `х${i}`, units: 1 }));
  assert.equal((planParts([], many, pt(100), 1) as { code: string }).code, 'TOO_MANY');
  assert.equal((planParts(ex, [{ id: 99, label: 'а', units: 1 }], pt(50), 2) as { code: string }).code, 'UNKNOWN_PART');
  assert.equal((planParts(ex, [{ id: 1, label: 'а', units: 1 }, { id: 1, label: 'б', units: 1 }], pt(50), 2) as { code: string }).code, 'UNKNOWN_PART');
  assert.equal((planParts(ex, [{ label: 'а', units: pt(51) }], pt(50), 2) as { code: string }).code, 'OVER_FREE');
});

test('planParts: хоосон жагсаалт = бүх хэсгийг устгах; нийлбэр чөлөөтөөс бага байж болно', () => {
  const r = planParts([{ id: 1, ordinal: 1, label: 'а', units: pt(10) }], [], pt(50), 2);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.removed, [1]);
  assert.equal(planParts([], [{ label: 'а', units: pt(10) }], pt(50), 1).ok, true);
});

test('mergedLabel: хуваарилалтгүй/цуцлагдсан бол хэсгийн нэр; ажилтай бол хоёр нэрийг холбоно', () => {
  assert.equal(mergedLabel(null, 'Үндсэн', 'суурь'), 'суурь');
  assert.equal(mergedLabel({ label: null, doneUnits: 0, targetUnits: 0 }, 'Үндсэн', 'суурь'), 'суурь');
  assert.equal(mergedLabel({ label: null, doneUnits: pt(5), targetUnits: pt(5) }, 'Үндсэн', 'суурь'), 'Үндсэн · суурь');
  assert.equal(mergedLabel({ label: 'шугам', doneUnits: 0, targetUnits: pt(5) }, 'Үндсэн', 'суурь'), 'шугам · суурь');
  assert.equal(mergedLabel({ label: 'суурь', doneUnits: 0, targetUnits: pt(5) }, 'Үндсэн', 'суурь'), 'суурь');
  assert.ok(mergedLabel({ label: 'я'.repeat(119), doneUnits: 0, targetUnits: 1 }, 'Ү', 'суурь').length <= 120);
});
