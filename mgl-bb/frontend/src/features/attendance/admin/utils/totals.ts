import type { DailyAttendanceRow } from '@/shared/types';

/** Ажиллах ёстой өдөр = амралтын (Бя/Ня) ч, нийтийн баярын ч өдөр БИШ.
 *
 *  ⚠️ Grid-ийн мөр бүр ажлын өдөр БИШ: нийтийн баярын өдрийн мөр Дав–Баа дотор
 *  байдаг ч хүлээгдэх өдөрт ордоггүй.  Мөр тоолж «ажлын өдөр» гаргавал тоо
 *  хөөрөгдөнө (2026-10-01: «24 өдөр · 22 ирсэн» → ажлын 2 өдөр тасалсан мэт).
 *  Бя/Ням өдрийн мөрийг сервер 2026-10-01-аас үүсгэхгүй (цагт тоологдохгүй —
 *  эзний шийдвэр); `is_rest_day` мөр ирвэл (хуучин API) энд ч тоологдохгүй.
 *  Backend twin: `backend/src/lib/attendanceDayCount.ts` — хамт өөрчилнө. */
export function isExpectedWorkDay(
  r: Pick<DailyAttendanceRow, 'is_rest_day' | 'is_holiday'>,
): boolean {
  return !r.is_rest_day && !r.is_holiday;
}

/** Тэр өдөр бодит үйлдэл (ирц / гадуур ажил / тооцсон цаг) байсан эсэх. */
export function hasWorkActivity(
  r: Pick<DailyAttendanceRow, 'actual_in' | 'out_of_office_minutes' | 'worked_effective_minutes'>,
): boolean {
  return (
    r.actual_in != null ||
    (r.out_of_office_minutes ?? 0) > 0 ||
    (r.worked_effective_minutes ?? 0) > 0
  );
}

/** Нэг ажилтны блок (эсвэл нийт хугацааны) дүнгүүд — daily grid болон
 *  XLSX экспорт хоёул ижил хуримтлуулагчийг хэрэглэнэ. */
export type GroupTotals = {
  /** Ажиллах ёстой өдөр (амралт/баяраас бусад).  Мөрийн тоо БИШ. */
  workingDays: number;
  /** Ажиллах ёстой өдөр дээр ирсэн өдөр — `workingDays`-ээс хэтрэхгүй. */
  presentDays: number;
  /** Амралт/баярын өдөр бодитоор ажилласан өдөр (`workingDays`-д ордоггүй). */
  extraDays: number;
  leaveDays: number;
  leaveMinutes: number;
  outOfOfficeMinutes: number;
  absentDays: number;
  lateMinutes: number;
  latePenalty: number;
  workMinutes: number;
  creditedMinutes: number;
  workedEffectiveMinutes: number;
  totalMinutes: number;
};

export function emptyTotals(): GroupTotals {
  return {
    workingDays: 0,
    presentDays: 0,
    extraDays: 0,
    leaveDays: 0,
    leaveMinutes: 0,
    outOfOfficeMinutes: 0,
    absentDays: 0,
    lateMinutes: 0,
    latePenalty: 0,
    workMinutes: 0,
    creditedMinutes: 0,
    workedEffectiveMinutes: 0,
    totalMinutes: 0,
  };
}

export function accumulateTotals(into: GroupTotals, row: DailyAttendanceRow) {
  if (isExpectedWorkDay(row)) {
    into.workingDays += 1;
    if (row.actual_in) into.presentDays += 1;
  } else if (hasWorkActivity(row)) {
    into.extraDays += 1;
  }
  if (row.is_on_leave) into.leaveDays += 1;
  if (row.is_absent) into.absentDays += 1;
  // Цагийн багануудад амралтаар ажилласан цаг ЯГ тоологдсоор — зөвхөн өдрийн
  // тоо л өөрчлөгдсөн.
  into.leaveMinutes += row.leave_minutes ?? 0;
  into.outOfOfficeMinutes += row.out_of_office_minutes ?? 0;
  into.lateMinutes += row.late_minutes ?? 0;
  into.latePenalty += row.late_penalty ?? 0;
  into.workMinutes += row.work_minutes ?? 0;
  into.creditedMinutes += row.credited_minutes ?? 0;
  into.workedEffectiveMinutes += row.worked_effective_minutes ?? 0;
  into.totalMinutes += row.total_minutes ?? 0;
}
