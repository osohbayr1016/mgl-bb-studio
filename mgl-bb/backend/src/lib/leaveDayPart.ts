/**
 * Өдрийн хэсгээр авах чөлөөний цонх — ЦЭВЭР дүрэм.
 *
 * «ҮДЭЭС ӨМНӨХ чөлөө» (нягтлангийн ангилал): ажилтан ээлжийнхээ эхлэлээс
 * ҮД БОЛТОЛ (12:00) чөлөөтэй, 12:00 цагт ажилдаа ИРСЭН БАЙНА.  12:00-аас
 * хойш ирвэл зөрүү нь ЖИНХЭНЭ ХОЦРОЛТ болж минутаар торгуулна — чөлөө нь
 * түүнийг цуцлахгүй.
 *
 * ⚠️ Дуусах цаг нь ТОГТМОЛ 12:00, ээлжээс ХАМААРАХГҮЙ.  Тиймээс бүртгэгдэх
 *    цаг ээлж тус бүрд өөр: 08:00→4.0ц, 08:30→3.5ц, 09:00→3.0ц.  Энэ нь
 *    ЗӨВ — ажилтан бодитоор яг төдөн цагийн ажлаа тасалсан.  Гурвуулаа
 *    12:00-д ажилдаа ирдэг тул `routes/attendance.ts`-ийн
 *    `lateMin = rawLate − leaveMinutes − waiver` нь ГУРВУУЛАНД 0 гарна.
 *
 * ⚠️ Цайны цаг (2026-09-01-ээс 13:00–14:00) энэ цонхонд ОГТ ОРОХГҮЙ тул
 *    `routes/leaves.ts`-ийн `rangeHours` (цай мэдэхгүй түүхий зөрүү) нь
 *    бодит тасалсан цагтай ЯГ таарна.
 *
 * ⚠️ Тодорхой ОГНОО энд БАЙХГҮЙ — ээлжийн цаг `orgConfig()`-оос амьдаар
 *    ирнэ, тиймээс жил бүрийн нээлт, өөрчлөгдсөн ээлж ижил замаар ажиллана.
 */
import type { LeaveDayPart } from './leavePolicy';

/** Үдээс өмнөх чөлөө ҮРГЭЛЖ ҮД (12:00) цагт дуусна. */
export const DAY_PART_END_MINUTES = 12 * 60;

export interface DayPartWindow {
  startMinutes: number;
  endMinutes: number;
  /** Цонхны бодит урт цагаар (4.0 / 3.5 / 3.0) — ээлжээс хамаарна. */
  hours: number;
}

/** `part` нь одоогоор зөвхөн 'am' — ирээдүйн 'pm' энд харагдахуйц өөрчлөлт болно. */
export function dayPartWindow(shiftStartMinutes: number, part: LeaveDayPart): DayPartWindow {
  void part;
  const endMinutes = DAY_PART_END_MINUTES;
  return {
    startMinutes: shiftStartMinutes,
    endMinutes,
    // 2 оронтой болгож тайрна — `routes/leaves.ts`-ийн `rangeHours`-тай ижил.
    hours: Math.round(((endMinutes - shiftStartMinutes) / 60) * 100) / 100,
  };
}

/** Танихгүй утгыг татгалзана — route-ийн 400-ийн эх сурвалж. */
export function isDayPart(v: unknown): v is LeaveDayPart {
  return v === 'am';
}
