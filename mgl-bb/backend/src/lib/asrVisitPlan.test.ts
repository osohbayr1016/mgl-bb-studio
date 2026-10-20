/**
 * `lib/asrVisitPlan.ts` — оролтын шалгалт, монгол огноо, мэдэгдлийн бичвэр,
 * гишүүдийн зөрүү.  D1-гүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssignedNotice,
  buildCancelledNotice,
  buildChangedNotice,
  diffPlan,
  formatVisitDateMn,
  MAX_PLAN_MEMBERS,
  validatePlanInput,
  type AsrVisitPlanInput,
  type VisitNoticeContext,
} from './asrVisitPlan.ts';

const TODAY = '2026-09-21';

/* ------------------------------------------------------------------ */
/*  validatePlanInput                                                  */
/* ------------------------------------------------------------------ */

test('validatePlanInput: бүрэн биет — давхардсан id арилж, эрэмбэ хадгалагдана', () => {
  const r = validatePlanInput({
    project_id: 30,
    visit_date: '2026-09-25',
    visit_time: '10:00',
    note: '  Каск авч ирнэ  ',
    user_ids: [5, 7, 5, '9'],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value, {
    project_id: 30,
    visit_date: '2026-09-25',
    visit_time: '10:00',
    note: 'Каск авч ирнэ',
    user_ids: [5, 7, 9],
  });
});

test('validatePlanInput: хоосон цаг → null, хоосон тэмдэглэл → null', () => {
  const r = validatePlanInput({ project_id: 1, visit_date: '2026-10-01', visit_time: '', note: '   ', user_ids: [1] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.visit_time, null);
  assert.equal(r.value.note, null);
});

test('validatePlanInput: алдаанууд', () => {
  const bad = (body: unknown, needle: string) => {
    const r = validatePlanInput(body);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, new RegExp(needle));
  };
  bad({ visit_date: '2026-09-25', user_ids: [1] }, 'Төсөл');
  bad({ project_id: 1, visit_date: '2026-02-30', user_ids: [1] }, 'Огноо');
  bad({ project_id: 1, visit_date: '25.09.2026', user_ids: [1] }, 'Огноо');
  bad({ project_id: 1, visit_date: '2026-09-25', visit_time: '25:00', user_ids: [1] }, 'Цаг');
  bad({ project_id: 1, visit_date: '2026-09-25', visit_time: '9:00', user_ids: [1] }, 'Цаг');
  bad({ project_id: 1, visit_date: '2026-09-25', user_ids: [] }, 'нэг хүн');
  bad({ project_id: 1, visit_date: '2026-09-25' }, 'хүмүүс');
  bad({ project_id: 1, visit_date: '2026-09-25', user_ids: [0] }, 'id');
  bad(
    { project_id: 1, visit_date: '2026-09-25', user_ids: Array.from({ length: MAX_PLAN_MEMBERS + 1 }, (_, i) => i + 1) },
    'олон хүн',
  );
  bad({ project_id: 1, visit_date: '2026-09-25', user_ids: [1], note: 'x'.repeat(1001) }, 'Тэмдэглэл');
});

test('validatePlanInput: PATCH — өгөгдөөгүй талбар суурь утгаа хадгална', () => {
  const base: AsrVisitPlanInput = {
    project_id: 30,
    visit_date: '2026-09-25',
    visit_time: '10:00',
    note: 'a',
    user_ids: [1, 2],
  };
  const r = validatePlanInput({ visit_time: null }, base);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value, { ...base, visit_time: null });

  const r2 = validatePlanInput({ user_ids: [2, 3] }, base);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.deepEqual(r2.value.user_ids, [2, 3]);
  assert.equal(r2.value.visit_date, '2026-09-25');
});

/* ------------------------------------------------------------------ */
/*  formatVisitDateMn                                                  */
/* ------------------------------------------------------------------ */

test('formatVisitDateMn: ижил онд оныг бичихгүй, гараг зөв', () => {
  assert.equal(formatVisitDateMn('2026-09-25', TODAY), '9-р сарын 25-нд (Баасан)');
  assert.equal(formatVisitDateMn('2026-09-21', TODAY), '9-р сарын 21-нд (Даваа)');
  assert.equal(formatVisitDateMn('2026-09-27', TODAY), '9-р сарын 27-нд (Ням)');
});

test('formatVisitDateMn: өөр онд оныг бичнэ', () => {
  assert.equal(formatVisitDateMn('2027-01-05', TODAY), '2027 оны 1-р сарын 5-нд (Мягмар)');
});

/* ------------------------------------------------------------------ */
/*  Мэдэгдлийн бичвэр                                                  */
/* ------------------------------------------------------------------ */

const ctx: VisitNoticeContext = {
  projectName: 'MGL-251006 EVERGREEN',
  location: 'ХУД, 15-р хороо',
  shifr: 'MGL-251006',
  visitDate: '2026-09-25',
  visitTime: '10:00',
  note: 'Каск авч ирнэ',
  companions: ['Б.Болд', 'Д.Сараа'],
  actorName: 'А.Ананд',
  today: TODAY,
};

test('buildAssignedNotice: төсөл, огноо, цаг, байршил, шифр, хамт явах, тэмдэглэл бүгд орно', () => {
  const n = buildAssignedNotice(ctx);
  assert.equal(n.title, 'Зохиогчийн хяналтаар явна');
  assert.equal(
    n.body,
    '9-р сарын 25-нд (Баасан) 10:00 цагт «MGL-251006 EVERGREEN» төсөл дээр зохиогчийн хяналтаар явна.' +
      ' · Байршил: ХУД, 15-р хороо · Шифр: MGL-251006 · Хамт явах: Б.Болд, Д.Сараа' +
      ' · Тэмдэглэл: Каск авч ирнэ · Томилсон: А.Ананд',
  );
  // Нэг мөр — bell-ийн line-clamp дор шинэ мөр тэмдэгт харагдахгүй.
  assert.equal(n.body.includes('\n'), false);
});

test('buildAssignedNotice: цаг, байршил, шифр, хамт явах, тэмдэглэл байхгүй бол тэр мөрүүд орохгүй', () => {
  const n = buildAssignedNotice({
    ...ctx,
    visitTime: null,
    location: null,
    shifr: '  ',
    companions: [],
    note: null,
    actorName: null,
  });
  assert.equal(n.body, '9-р сарын 25-нд (Баасан) «MGL-251006 EVERGREEN» төсөл дээр зохиогчийн хяналтаар явна.');
});

test('buildChangedNotice: «Шинэ хуваарь» гэж эхэлнэ', () => {
  const n = buildChangedNotice(ctx);
  assert.equal(n.title, 'Зохиогчийн хяналтын хуваарь өөрчлөгдлөө');
  assert.match(n.body, /^Шинэ хуваарь: 9-р сарын 25-нд \(Баасан\) 10:00 цагт «MGL-251006 EVERGREEN» төсөл дээр/);
  assert.match(n.body, /Байршил: ХУД/);
});

test('buildCancelledNotice: цуцлалт ба хасалт өөр өгүүлбэртэй', () => {
  const base = { projectName: 'X', visitDate: '2026-09-25', visitTime: null, actorName: 'А.Ананд', today: TODAY };
  const c1 = buildCancelledNotice(base, 'cancelled');
  assert.equal(c1.title, 'Зохиогчийн хяналтын хуваарь цуцлагдлаа');
  assert.equal(c1.body, '9-р сарын 25-нд (Баасан) «X» төсөл дээрх зохиогчийн хяналтын хуваарь цуцлагдлаа. · Хийсэн: А.Ананд');
  const c2 = buildCancelledNotice({ ...base, visitTime: '14:30', actorName: null }, 'removed');
  assert.equal(c2.title, 'Зохиогчийн хяналтын хуваариас хасагдлаа');
  assert.equal(c2.body, '9-р сарын 25-нд (Баасан) 14:30 цагт «X» төсөл дээрх зохиогчийн хяналтын хуваариас таныг хаслаа.');
});

/* ------------------------------------------------------------------ */
/*  diffPlan                                                           */
/* ------------------------------------------------------------------ */

test('diffPlan: нэмэгдсэн/хасагдсан/үлдсэн + өөрчлөлтийн туг', () => {
  const before: AsrVisitPlanInput = { project_id: 1, visit_date: '2026-09-25', visit_time: '10:00', note: null, user_ids: [1, 2, 3] };
  const same = diffPlan(before, { ...before, user_ids: [3, 2, 1] });
  assert.deepEqual(same, { added: [], removed: [], kept: [3, 2, 1], changed: false });

  const d = diffPlan(before, { ...before, visit_time: '11:00', user_ids: [2, 4] });
  assert.deepEqual(d.added, [4]);
  assert.deepEqual(d.removed, [1, 3]);
  assert.deepEqual(d.kept, [2]);
  assert.equal(d.changed, true);

  // Тэмдэглэл null ↔ null нь өөрчлөлт биш; null → текст нь өөрчлөлт.
  assert.equal(diffPlan(before, { ...before, note: null }).changed, false);
  assert.equal(diffPlan(before, { ...before, note: 'x' }).changed, true);
  assert.equal(diffPlan(before, { ...before, project_id: 2 }).changed, true);
});
