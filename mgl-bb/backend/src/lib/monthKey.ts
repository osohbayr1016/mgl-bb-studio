/**
 * Сарын түлхүүр ('YYYY-MM') болон түүний огнооны муж — цэвэр туслахууд.
 *
 * `lib/time.ts` нь зөвхөн ӨДРИЙН түвшний UB хөрвүүлэлттэй (`todayInUB`,
 * `nowInUBIso`, `isSummerSchedule`) бөгөөд сарын арифметик агуулдаггүй тул
 * энд төвлөрүүлэв.
 *
 * Энэ модуль ЯМАР Ч import-гүй, цаг хугацаанаас хамааралгүй байх ёстой —
 * ингэснээр `node --test`-ийн type-stripping шууд ажиллаж, `monthKey.test.ts`
 * бүх ирмэг тохиолдлыг шалгаж чадна.  UB-ийн «одоо» хэрэгтэй бол дуудагч тал
 * `monthKeyOf(todayInUB())` гэж хослуулна.
 */

/** 'YYYY-MM' хүчинтэй эсэх (сар 01–12).  Эс бөгөөс `null`. */
export function parseMonthKey(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null;
  const mm = Number(value.slice(5, 7));
  return mm >= 1 && mm <= 12 ? value : null;
}

/**
 * 'YYYY-MM-DD' огнооны сарын түлхүүр.  Одоогийн UB сарыг авахдаа
 * `monthKeyOf(todayInUB())` гэж дуудна (Worker runtime = UTC тул `todayInUB`
 * заавал — `new Date()`-ээс шууд огноо авбал UB-ийн 00:00–08:00-д өмнөх сар
 * гарч ирнэ).
 */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Сарын ХАГАС НЭЭЛТТЭЙ огнооны муж: `from <= date < to`.
 *
 * `substr(date,1,7) = ?`-ийн оронд ЭНЭ хэлбэрийг ашиглана: эхнийх нь
 * `idx_progress_date`-ийг ашиглаж чадахгүй (бүтэн covering scan болно),
 * харин муж нь index seek хийнэ — `EXPLAIN QUERY PLAN`-аар шалгасан.
 * 12-р сар дараа жилийн 01 болж эргэнэ.
 *
 * @param month  `parseMonthKey`-ээр баталгаажсан 'YYYY-MM'.
 */
export function monthRange(month: string): { from: string; to: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const yy = String(nextY).padStart(4, '0');
  const mm = String(nextM).padStart(2, '0');
  return { from: `${month}-01`, to: `${yy}-${mm}-01` };
}
