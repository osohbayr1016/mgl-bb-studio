/**
 * `revitProgress.ts`-ийн тест — цэвэр функц, D1 хүрэхгүй.
 *
 * Хамгийн чухал инвариант: машины тооноос (санал, checklist, хуудас) 100% хэзээ
 * ч гарахгүй.  100 нь зөвхөн ил «хаах» үйлдлээр — `completion_qa`-тай
 * (эзний 2026-09-29-ний шийдвэр; доорх «ХААХ» тестүүд).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CEILING,
  deriveSuggestedPercent,
  verifySubmittedPercent,
} from './revitProgress.ts';

const base = { checklistDone: 0, checklistTotal: 0, currentPercent: 0 };

test('checklist: done/total → хувь, гаралтын тайлбартай', () => {
  const r = deriveSuggestedPercent({ ...base, checklistDone: 8, checklistTotal: 13 });
  assert.equal(r.basis, 'checklist');
  assert.equal(r.derived, 62); // round(8/13*100) = 62
  assert.equal(r.suggested, 62);
  assert.equal(r.detail, 'Checklist 8/13 → 62%');
});

test('ТӨВ ИНВАРИАНТ: бүх нүд тэмдэглэгдсэн ч 99-ээс хэтрэхгүй', () => {
  const r = deriveSuggestedPercent({ ...base, checklistDone: 13, checklistTotal: 13 });
  assert.equal(r.derived, 99, '13/13 нь 100 биш 99 байх ёстой');
  assert.equal(r.ceiling, CEILING);
  assert.equal(CEILING, 99);
});

test('ТӨВ ИНВАРИАНТ: 100 илгээхийг сервер ҮРГЭЛЖ татгалзана', () => {
  for (const input of [
    { ...base, checklistDone: 13, checklistTotal: 13 }, // checklist дүүрэн
    { ...base, sheetsReady: 5, sheetsPlanned: 5 },      // хуудас дүүрэн
    { ...base },                                         // гаралтгүй
  ]) {
    const d = deriveSuggestedPercent(input);
    const v = verifySubmittedPercent(100, d, 0);
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.code, 'above_ceiling');
  }
});

test('sheets: checklist байхгүй үед хоёр дахь шатлал', () => {
  const r = deriveSuggestedPercent({ ...base, sheetsReady: 3, sheetsPlanned: 4 });
  assert.equal(r.basis, 'sheets');
  assert.equal(r.derived, 75);
  assert.equal(r.detail, 'Хуудас 3/4 → 75%');
});

test("шийдвэр ①: гаралтгүй бол ЗОХИОХГҮЙ — basis='none', derived=null", () => {
  const r = deriveSuggestedPercent(base);
  assert.equal(r.basis, 'none');
  assert.equal(r.derived, null);
  assert.equal(r.suggested, null);
  assert.equal(r.detail, '');
  assert.equal(r.ceiling, 99, 'гаралтгүй ч таг хэвээр');
});

test("basis='none' үед хүн бичсэн тоо 99 хүртэл зөвшөөрөгдөж 'manual' болно", () => {
  const d = deriveSuggestedPercent(base);
  const v = verifySubmittedPercent(45, d, 0);
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.basis, 'manual');
});

test('таг нь checklist БИШ, CEILING — хүн гаралтаас дээш гараар өргөж болно', () => {
  // Санаатай шийдвэр (шүүмжийн BLOCKER #2-ын зөрчлийг эцэслэв):
  // `derived` бол САНАЛ, таталцах хязгаар БИШ.  Инженер checklist-ээс дээш
  // бичиж болно — деталчлал, зохицуулалт зэрэг checklist-д тусдаггүй ажил
  // бодит байдалд бий.  Зөрүү нь `revit_submissions.suggested_percentage` vs
  // `percentage` болж аудитад ХАРАГДАНА, шүүгч шүүж чадна.
  // Хатуу хязгаар нь ГАНЦ: CEILING = 99.
  const d = deriveSuggestedPercent({ ...base, checklistDone: 2, checklistTotal: 10 }); // 20
  assert.equal(d.derived, 20);
  assert.equal(verifySubmittedPercent(20, d, 0).ok, true, 'гаралттайгаа тэнцүү');
  assert.equal(verifySubmittedPercent(85, d, 0).ok, true, 'гаралтаас дээш — зөвшөөрнө');
  assert.equal(verifySubmittedPercent(99, d, 0).ok, true, 'яг таг дээр');
  assert.equal(verifySubmittedPercent(100, d, 0).ok, false, 'тагаас дээш — хэзээ ч үгүй');
});

test('ухралт: одоогийн хувиас доош илгээхийг татгалзана', () => {
  const d = deriveSuggestedPercent({ ...base, checklistDone: 5, checklistTotal: 10, currentPercent: 70 });
  assert.equal(d.derived, 50, 'гаралт нь шударгаар 50 хэвээр');
  assert.equal(d.suggested, 70, 'санал нь ухралт санал болгохгүй');
  const v = verifySubmittedPercent(50, d, 70);
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, 'below_current');
});

test('тоо биш утгыг татгалзана — add-in string илгээвэл', () => {
  const d = deriveSuggestedPercent({ ...base, checklistDone: 1, checklistTotal: 2 });
  for (const bad of ['62', null, undefined, NaN, Infinity, {}]) {
    const v = verifySubmittedPercent(bad, d, 0);
    assert.equal(v.ok, false, `${String(bad)} зөвшөөрөгдөж болохгүй`);
    assert.equal(v.ok === false && v.code, 'not_a_number');
  }
});

test('гажуудсан оролт: сөрөг, бутархай, total-оос их done', () => {
  assert.equal(deriveSuggestedPercent({ ...base, checklistDone: -3, checklistTotal: 10 }).derived, 0);
  assert.equal(deriveSuggestedPercent({ ...base, checklistDone: 99, checklistTotal: 10 }).derived, 99);
  assert.equal(deriveSuggestedPercent({ ...base, checklistDone: 2.7, checklistTotal: 10 }).derived, 20);
  assert.equal(deriveSuggestedPercent({ ...base, checklistTotal: -5 }).basis, 'none');
});

test('БОДИТ АЛДААНЫ РЕГРЕСС: одоогийн хувь 100 байхад санал таг давахгүй', () => {
  // 2026-08-24-нд бодит өгөгдөл дээр илэрсэн: ажил аль хэдийн 100% байхад
  // suggested=100 гарч, сервер above_ceiling гэж татгалзаж, панель гацсан.
  const d = deriveSuggestedPercent({
    checklistDone: 1,
    checklistTotal: 1,
    currentPercent: 100,
  });
  assert.equal(d.derived, 99);
  assert.equal(d.suggested, 99, 'санал ХЭЗЭЭ Ч тагаас хэтрэхгүй');
  assert.ok(d.suggested !== null && d.suggested <= d.ceiling);
});

test("аль хэдийн тагт хүрсэн ажил — ойлгомжтой ТУСГАЙ код", () => {
  const d = deriveSuggestedPercent({ checklistDone: 1, checklistTotal: 1, currentPercent: 100 });
  for (const v of [100, 99, 50]) {
    const r = verifySubmittedPercent(v, d, 100);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, 'already_at_ceiling', `${v}% дээр`);
  }
});

/* ------------------------------------------------------------------ */
/*  2026-09-29 — ЭЗНИЙ ШИЙДВЭР: Revit-ээс 100% = ил «хаах» (completion_qa)  */
/* ------------------------------------------------------------------ */

test('ХААХ: completing=true үед ЯГ 100 зөвшөөрөгдөнө (basis хадгалагдана)', () => {
  const d = deriveSuggestedPercent({ ...base, checklistDone: 13, checklistTotal: 13 });
  const v = verifySubmittedPercent(100, d, 60, { completing: true });
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.basis, 'checklist');
  const manual = verifySubmittedPercent(100, deriveSuggestedPercent(base), 0, { completing: true });
  assert.equal(manual.ok === true && manual.basis, 'manual');
});

test('ХААХ: completion_qa-гүй 100 нь хэвээр above_ceiling (машины тоо 100 болохгүй)', () => {
  const d = deriveSuggestedPercent({ ...base, checklistDone: 5, checklistTotal: 5 });
  for (const opts of [undefined, {}, { completing: false }]) {
    const v = verifySubmittedPercent(100, d, 0, opts);
    assert.equal(v.ok === false && v.code, 'above_ceiling');
  }
});

test('ХААХ: 100-гаас их, 99–100 хоорондох бутархай нь хэзээ ч хүчинтэй биш', () => {
  const d = deriveSuggestedPercent(base);
  for (const bad of [100.5, 101, 1000]) {
    const v = verifySubmittedPercent(bad, d, 0, { completing: true });
    assert.equal(v.ok === false && v.code, 'above_ceiling', `${bad}`);
  }
  const frac = verifySubmittedPercent(99.5, d, 0, { completing: true });
  assert.equal(frac.ok === false && frac.code, 'above_ceiling', '99.5 нь хаах ч биш, тэмдэглэл ч биш');
});

test('99% дээрх ажил: 99-өөр тэмдэглэл ЭСВЭЛ 100-гаар хаах — хоёулаа боломжтой', () => {
  const d = deriveSuggestedPercent({ ...base, currentPercent: 99 });
  assert.equal(verifySubmittedPercent(99, d, 99).ok, true, 'ижил хувиар өдрийн тэмдэглэл');
  assert.equal(verifySubmittedPercent(100, d, 99, { completing: true }).ok, true, 'хаах');
  const back = verifySubmittedPercent(98, d, 99);
  assert.equal(back.ok === false && back.code, 'below_current');
});

test('аль хэдийн 100% (дууссан) ажил — хаах оролдлого ч already_at_ceiling', () => {
  const d = deriveSuggestedPercent({ ...base, currentPercent: 100 });
  const v = verifySubmittedPercent(100, d, 100, { completing: true });
  assert.equal(v.ok === false && v.code, 'already_at_ceiling');
});

test('санал нь бүх шатлалд тагаас хэтрэхгүй (инвариант)', () => {
  for (const cur of [0, 50, 98, 99, 100]) {
    for (const [done, total] of [[0, 0], [1, 2], [13, 13], [5, 5]]) {
      const d = deriveSuggestedPercent({ checklistDone: done!, checklistTotal: total!, currentPercent: cur });
      if (d.suggested !== null) {
        assert.ok(d.suggested <= d.ceiling, `cur=${cur} ${done}/${total} -> ${d.suggested}`);
      }
    }
  }
});
