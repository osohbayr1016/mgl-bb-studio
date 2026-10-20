/**
 * Зохиогчийн хяналтын статистикийн ЦЭВЭР тусламж — `routes/authorSupervisionStats.ts`
 * эндээс огноо/цонхны тооцоо, сарын цувааны нөхөлтийг авна.
 *
 * Импортгүй, DB-гүй: `node --test`-ээр шууд шалгагдана (`asrStats.test.ts`).
 *
 * «Тоологдох тайлан» = `status IN ('submitted','approved')` — `GET /projects/:id/visits`
 * болон `/project-summaries`-ийн ЯГ ижил тодорхойлолт (ноорог тоологдохгүй,
 * хаягдсан ноорог хийгээгүй очилт үүсгэхгүй).  Энд тэр дүрмийг SQL болгож
 * НЭГ газар барина.
 *
 * ⚠️ 0362-оос «ОЧИЛТ» = тоологдох тайлан + ТАЛБАЙН ХЯНАЛТ
 *    (`lib/asrReportType.ts` `ASR_SITE_SQL`-ийг хамт хэрэглэ).  Энэ тогтмол нь
 *    бүх төрлийг тоолно (цахим/оффис уулзалт, зургийн өөрчлөлт ч орно).
 */

export const ASR_COUNTED_SQL = `r.status IN ('submitted','approved')`;

/** `YYYY-MM-DD` → `YYYY-MM`. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** `YYYY-MM`-ээс `delta` сар нүүсэн `YYYY-MM`. */
export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** `YYYY-MM-DD`-ээс `delta` хоног нүүсэн огноо (UTC арифметик — өдрийн мөр л). */
export function shiftDays(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Хоёр `YYYY-MM-DD` огнооны зөрүү (хоног, `b − a`). */
export function daysBetween(a: string, b: string): number {
  const ms =
    Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10))) -
    Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  return Math.round(ms / 86_400_000);
}

/**
 * Өнөөдрөөс хамаарсан цонхнууд.  Бүгд `report_date` (УБ өдөр) дээр
 * `>=`/`<`-ээр шүүгдэнэ — цагийн бүсийн хөрвүүлэлт хэрэггүй.
 *
 *   thisMonth  — [сарын 1, дараа сарын 1)
 *   prevMonth  — [өмнөх сарын 1, сарын 1)
 *   last30     — [today − 29, today]  (30 хоног, өнөөдрийг ОРУУЛААД)
 *   prev30     — [today − 59, today − 30]
 */
export function statsWindows(today: string) {
  const thisMonth = monthOf(today);
  const nextMonth = shiftMonth(thisMonth, 1);
  const prevMonth = shiftMonth(thisMonth, -1);
  return {
    thisMonth,
    prevMonth,
    thisMonthFrom: `${thisMonth}-01`,
    thisMonthTo: `${nextMonth}-01`,
    prevMonthFrom: `${prevMonth}-01`,
    last30From: shiftDays(today, -29),
    prev30From: shiftDays(today, -59),
    prev30To: shiftDays(today, -30),
  };
}

export interface MonthBucket {
  month: string;
  visits: number;
  approved: number;
}

/**
 * DB-ээс ирсэн (зөвхөн тайлантай) саруудыг сүүлийн `count` сарын тасралтгүй
 * цуваа болгож, хоосон сарыг 0-оор нөхнө.  График дээр «7-р сар байхгүй»
 * биш «7-р сар = 0» гэж харагдах ёстой.
 */
export function fillMonthSeries(
  rows: readonly MonthBucket[],
  today: string,
  count: number,
): MonthBucket[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const last = monthOf(today);
  const out: MonthBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(last, -i);
    const hit = byMonth.get(month);
    out.push({ month, visits: hit?.visits ?? 0, approved: hit?.approved ?? 0 });
  }
  return out;
}
