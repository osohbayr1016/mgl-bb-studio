/**
 * Нийтийн амралтын өдрүүд (`holidays` хүснэгт, migration 0103) — ирцийн
 * тооцоонд "амарсан өдөр" гэж үзэхэд хэрэглэх туслахууд.  Амралтын өдрийг
 * Бямба/Ням шиг ажиллах өдрөөс хасна (expected = 0, эзгүйд тооцохгүй).
 */

/** [from, to] (хоёул багтсан) мужид багтах амралтын огноонуудын Set. */
export async function getHolidaySet(
  db: D1Database,
  from: string,
  to: string,
): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT date FROM holidays WHERE date >= ? AND date <= ?`)
    .bind(from, to)
    .all<{ date: string }>();
  return new Set((results ?? []).map((r) => r.date));
}

/** Тухайн нэг өдөр нийтийн амралт мөн эсэх. */
export async function isHoliday(db: D1Database, date: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS x FROM holidays WHERE date = ? LIMIT 1`)
    .bind(date)
    .first<{ x: number }>();
  return !!row;
}
