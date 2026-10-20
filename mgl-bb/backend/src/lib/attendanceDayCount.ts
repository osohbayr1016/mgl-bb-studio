/**
 * Ирцийн өдрийн мөрүүдээс «ажлын өдөр / ирсэн өдөр / баярт ажилласан өдөр»
 * тоолох ГАНЦ дүрэм.  Импортгүй цэвэр модуль (`node --test` шууд ачаална).
 *
 * ⚠️ Мөр бүр = ажлын өдөр БИШ.  Нийтийн БАЯРЫН өдрийн мөр Дав–Баа дотор байдаг ч
 *    ажиллах ёстой өдрийн тоонд ОРОХГҮЙ — ажилласан бол цаг нь л тоологдоно.
 *    Мөрийг тоолоход хөрвүүлвэл ажлын өдрийн тоо хөөрөгдөнө (2026-10-01-ийн
 *    Батзориг А.: «24 өдөр · 22 ирсэн» → ажлын 2 өдөр тасалсан мэт).
 *
 * Бя/Ням өдрийн мөрийг `buildDailyAttendanceRows` 2026-10-01-аас ҮҮСГЭХГҮЙ (цагт
 * тоологдохгүй — эзний шийдвэр), харин `is_rest_day` мөр хэзээ нэгэн цагт
 * (хуучин API-ийн хариу г.м.) ирвэл энэ дүрэм тэдгээрийг ажиллах өдөрт
 * тоолохгүй хамгаална.
 *
 * Frontend twin: `frontend/src/features/attendance/admin/utils/totals.ts`
 * (`isExpectedWorkDay` / `hasWorkActivity`) — хоёр талыг хамт өөрчилнө.
 */

export type DayCountRow = {
  is_rest_day: boolean;
  is_holiday: boolean;
  actual_in: string | null;
  out_of_office_minutes: number;
  worked_effective_minutes: number;
};

/** Ажиллах ёстой өдөр = амралтын (Бя/Ня) ч, нийтийн баярын ч өдөр БИШ. */
export function isExpectedWorkDay(r: Pick<DayCountRow, 'is_rest_day' | 'is_holiday'>): boolean {
  return !r.is_rest_day && !r.is_holiday;
}

/** Тэр өдөр бодит үйлдэл (ирц / гадуур ажил / тооцсон цаг) байсан эсэх. */
export function hasWorkActivity(
  r: Pick<DayCountRow, 'actual_in' | 'out_of_office_minutes' | 'worked_effective_minutes'>,
): boolean {
  return (
    r.actual_in != null ||
    (r.out_of_office_minutes ?? 0) > 0 ||
    (r.worked_effective_minutes ?? 0) > 0
  );
}

export type DayCounts = {
  /** Ажиллах ёстой өдөр дээр ирсэн өдөр (≤ ажиллах ёстой өдрийн тоо). */
  present_days: number;
  /** Амралтын / баярын өдөр бодитоор ажилласан өдөр (хүлээгдэх тоонд ордоггүй). */
  extra_days: number;
};

export function countAttendanceDays(rows: readonly DayCountRow[]): DayCounts {
  let present_days = 0;
  let extra_days = 0;
  for (const r of rows) {
    if (isExpectedWorkDay(r)) {
      if (r.actual_in != null) present_days += 1;
    } else if (hasWorkActivity(r)) {
      extra_days += 1;
    }
  }
  return { present_days, extra_days };
}
