/**
 * Ганц ажилтны ТОГТМОЛ ээлж — Эрдэнэчимэг Хишигбаяр (user id 69).
 *
 * 09:30–18:30, зун ч үл өөрчлөгдөнө, picker-ээр солигдохгүй.
 * Шинэ ScheduleKey / users CHECK өргөтгөхгүй (path-B rebuild).
 * Ээлжийн цагийг `workSchedule.ts` SHIFTS-д БҮҮ хий — тэнд зөвхөн
 * байгууллагын гурван ээлж сууна.
 */
import {
  SHIFTS,
  effectiveSchedule,
  type ScheduleAssignment,
  type ScheduleKey,
  type Shift,
} from './workSchedule';

export const FIXED_SHIFT_USER_ID = 69;

export const FIXED_SHIFT: Shift = {
  startMinutes: 9 * 60 + 30,
  endMinutes: 18 * 60 + 30,
  label: '09:30–18:30',
};

export function hasFixedShift(userId: number | null | undefined): boolean {
  return userId === FIXED_SHIFT_USER_ID;
}

export const FIXED_SHIFT_LOCKED_ERROR =
  'Энэ ажилтны ажлын цаг тогтмол 09:30–18:30 бөгөөд солих боломжгүй';

/** Тухайн хүний ТУХАЙН ӨДРИЙН бодит ээлж.  69 бол зун/assignment-ийг алгасна. */
export function shiftForUser(
  userId: number,
  stored: ScheduleKey | null | undefined,
  date: string,
  assignments?: readonly ScheduleAssignment[] | null,
): Shift {
  if (hasFixedShift(userId)) return FIXED_SHIFT;
  return SHIFTS[effectiveSchedule(stored, date, assignments)];
}

/** Ирсэн минут − ээлжийн эхлэл − grace.  Эхлэлээс өмнө/яг үед 0. */
export function lateMinutesAgainstShift(
  arriveMinutes: number,
  shift: Shift,
  graceMinutes: number,
): number {
  const raw = Math.max(0, arriveMinutes - shift.startMinutes);
  if (raw <= graceMinutes) return 0;
  return raw - graceMinutes;
}
