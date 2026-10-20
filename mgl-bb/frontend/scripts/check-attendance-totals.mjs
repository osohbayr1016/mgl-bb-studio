/**
 * Ирц · «Дүн (N өдөр · M ирсэн)» тооллогын дүрмийн шалгалт.
 *
 *   node scripts/check-attendance-totals.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/attendance/admin/utils/totals.ts` — админ grid, XLSX, «Миний
 * сарын ирц» гурвуулаа нэг хуримтлуулагчийг ашигладаг.  Анхны гэмтэл (2026-10-01):
 * Бямба/Ням (нөхөж ажилласан) нэмэлт мөрийг «ажлын өдөр» болгон тоолж, 22
 * ажлын өдөртэй сард «24 өдөр · 22 ирсэн» гарч, ажлын 2 өдөр тасалсан мэт
 * харагддаг байв.  Backend twin: `backend/src/lib/attendanceDayCount.test.ts`.
 */
import assert from 'node:assert/strict';

const { accumulateTotals, emptyTotals, isExpectedWorkDay, hasWorkActivity } = await import(
  '../src/features/attendance/admin/utils/totals.ts'
);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

/** Дав–Баа өдөр, бүтэн ирсэн (8ц). */
const weekday = (over = {}) => ({
  actual_in: '08:00',
  is_rest_day: false,
  is_holiday: false,
  is_on_leave: false,
  is_absent: false,
  leave_minutes: 0,
  out_of_office_minutes: 0,
  late_minutes: 0,
  late_penalty: 0,
  work_minutes: 480,
  credited_minutes: 480,
  worked_effective_minutes: 480,
  total_minutes: 480,
  ...over,
});
/** Бямба/Ням — зөвхөн гадуур ажил 2.00 ц (Батзориг А., 2026-09-26/27). */
const weekendOoo = (over = {}) =>
  weekday({
    actual_in: null,
    is_rest_day: true,
    out_of_office_minutes: 120,
    work_minutes: null,
    credited_minutes: null,
    worked_effective_minutes: 120,
    total_minutes: null,
    ...over,
  });

const totalsOf = (rows) => {
  const t = emptyTotals();
  for (const r of rows) accumulateTotals(t, r);
  return t;
};

console.log('predicates');
ok('Бя/Ня ба баярын өдөр ажиллах ёстой өдөр БИШ', () => {
  assert.equal(isExpectedWorkDay(weekday()), true);
  assert.equal(isExpectedWorkDay(weekday({ is_rest_day: true })), false);
  assert.equal(isExpectedWorkDay(weekday({ is_holiday: true })), false);
  // Хуучин API `is_rest_day` өгөхгүй (undefined) бол ердийн ажлын өдөр.
  assert.equal(isExpectedWorkDay({ is_holiday: undefined }), true);
});
ok('hasWorkActivity: ирц / гадуур ажил / тооцсон цаг', () => {
  assert.equal(hasWorkActivity({ actual_in: null, out_of_office_minutes: 0, worked_effective_minutes: 0 }), false);
  assert.equal(hasWorkActivity({ actual_in: '09:00', out_of_office_minutes: 0, worked_effective_minutes: 0 }), true);
  assert.equal(hasWorkActivity({ actual_in: null, out_of_office_minutes: 60, worked_effective_minutes: 0 }), true);
  assert.equal(hasWorkActivity({ actual_in: null, out_of_office_minutes: 0, worked_effective_minutes: 15 }), true);
});

console.log('accumulateTotals');
ok('Батзориг А. 2026-09: 22 ажлын өдөр + Бя/Ня гадуур ажил → 22 өдөр · 22 ирсэн · 2 нэмэлт', () => {
  const rows = [...Array.from({ length: 22 }, () => weekday()), weekendOoo(), weekendOoo()];
  assert.equal(rows.length, 24);
  const t = totalsOf(rows);
  assert.equal(t.workingDays, 22);
  assert.equal(t.presentDays, 22);
  assert.equal(t.extraDays, 2);
  assert.equal(t.absentDays, 0);
});
ok('амралтаар ажилласан ЦАГ нийт дүнд ЯГ тоологдсоор (зөвхөн өдрийн тоо өөрчлөгдсөн)', () => {
  const t = totalsOf([weekday(), weekendOoo(), weekendOoo()]);
  assert.equal(t.workedEffectiveMinutes, 480 + 120 + 120);
  assert.equal(t.outOfOfficeMinutes, 240);
});
ok('Бямбад ирц бүртгүүлсэн нь ажлын өдрийн тасалдлыг далдлахгүй', () => {
  const rows = [
    ...Array.from({ length: 21 }, () => weekday()),
    weekday({ actual_in: null, is_absent: true, worked_effective_minutes: 0, work_minutes: null }),
    weekday({ is_rest_day: true }),
  ];
  const t = totalsOf(rows);
  assert.equal(t.workingDays, 22);
  assert.equal(t.presentDays, 21); // 22/22 биш — нэг ажлын өдөр тасалсан хэвээр
  assert.equal(t.extraDays, 1);
  assert.equal(t.absentDays, 1);
});
ok('баярын өдөр хүлээгдэх өдөрт ордоггүй; ажилласан бол нэмэлт', () => {
  const t = totalsOf([
    weekday(),
    weekday({ is_holiday: true, actual_in: null, worked_effective_minutes: 0, work_minutes: null }),
    weekday({ is_holiday: true }),
  ]);
  assert.equal(t.workingDays, 1);
  assert.equal(t.presentDays, 1);
  assert.equal(t.extraDays, 1);
});
ok('чөлөөтэй ажлын өдөр хүлээгдэх өдрөөс ХАСАГДАХГҮЙ (сервер summary-тэй ижил)', () => {
  const t = totalsOf([weekday(), weekday({ is_on_leave: true, actual_in: null, leave_minutes: 480 })]);
  assert.equal(t.workingDays, 2);
  assert.equal(t.presentDays, 1);
  assert.equal(t.leaveDays, 1);
});
ok('хуучин API (is_rest_day байхгүй) → хуучин үр дүнтэй нийцнэ', () => {
  const legacy = [weekday({ is_rest_day: undefined }), weekday({ is_rest_day: undefined })];
  const t = totalsOf(legacy);
  assert.equal(t.workingDays, 2);
  assert.equal(t.presentDays, 2);
  assert.equal(t.extraDays, 0);
});

console.log(`\n${n} шалгалт ногоон`);
