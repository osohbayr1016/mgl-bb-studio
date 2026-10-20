/**
 * «Тайлан» — ХАНДЛАГА ба БАЙРЫН математик.  Цэвэр, детерминист, тесттэй.
 *
 * Хандлага («Өсч байна / Буурч байна / Тогтвортой») нь загварын дүгнэлт биш,
 * тайлбарлаж болох нэг дүрэм: сүүлийн 7 хоногийн оноог өмнөх 7 хоногтой
 * харьцуулж ±10 %-ийн босгоор ангилна.  Хоёулаа бараг тэг бол «тогтвортой»
 * (0.01 → 0.02 гэсэн +100 % нь утгагүй дохио).  Slope нь ЗӨВХӨН мэдээллийн —
 * sparkline-ийн тайлбарт; ангилалд оролцохгүй.
 *
 * ⚠️ Онооны МАСШТАБ (хэмжсэн, прод 2026-09-16): нэг тайлан дунджаар 0.03, ажилтны
 * 7 хоногийн нийлбэрийн медиан ~0.1, дээд нь ~2.  Анхны хувилбар «долоо хоногт
 * ≥ 1 оноо» гэж босго тавьж, нийлбэрийг 1 орноор дугуйлж байсан тул ХҮН БҮР
 * «тогтвортой» гарч байв.  Одоо босго 0.05 (= 1-2 жижиг тайлан), нийлбэр 4 орон.
 */

export type TrendCode = 'up' | 'down' | 'flat';

export interface TrendResult {
  code: TrendCode;
  /** Сүүлийн 7 өдрийн нийлбэр. */
  last7: number;
  /** Түрүүчийн 7 өдрийн нийлбэр. */
  prior7: number;
  /** (last7 − prior7) / prior7 × 100; prior7 = 0 бол null. */
  pct_change: number | null;
  /** Хамгийн бага квадратын налуу (оноо/өдөр) — 14 өдрийн цуваанд. */
  slope_per_day: number;
}

/** ±10 % — үүнээс дотогш «тогтвортой». */
export const TREND_THRESHOLD = 0.1;
/** Хоёр цонх хоёулаа үүнээс бага оноотой бол харьцуулалт утгагүй → flat. */
export const TREND_MIN_ACTIVITY = 0.05;

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** Хамгийн бага квадратын шугамын налуу (индекс 0..n-1 → утга). n < 2 бол 0. */
export function leastSquaresSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = sum(ys) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * ((ys[i] ?? 0) - meanY);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

function roundPts(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Өдрийн онооны цуваа (хуучнаас шинэ рүү, сүүлийн 14 өдөр) → хандлага.
 * 14-өөс богино бол эхэнд 0-оор дүүргэнэ; урт бол сүүлийн 14-ийг авна.
 *
 * `leaveAdjust` — батлагдсан чөлөөний залруулга (lib/leaveAvailability.ts
 * `delta`): хоёр 7 хоног тус бүрийг хүний АЖИЛЛАСАН өдрөөр тоолсны зөрүү.
 * Чөлөө авсан долоо хоног «Буурч байна» гэж ангилагдахгүй.  0 → хуучин үр дүн.
 * Slope нь мэдээллийн, бодит өдрийн цуваанаас хэвээр.
 */
export function classifyTrend(
  dailyRaw: number[],
  leaveAdjust: { prior7: number; last7: number } = { prior7: 0, last7: 0 },
): TrendResult {
  const daily =
    dailyRaw.length >= 14
      ? dailyRaw.slice(dailyRaw.length - 14)
      : [...new Array<number>(14 - dailyRaw.length).fill(0), ...dailyRaw];
  const prior7 = roundPts(sum(daily.slice(0, 7)) + leaveAdjust.prior7);
  const last7 = roundPts(sum(daily.slice(7)) + leaveAdjust.last7);
  const slope_per_day = Math.round(leastSquaresSlope(daily) * 1000) / 1000;

  if (last7 < TREND_MIN_ACTIVITY && prior7 < TREND_MIN_ACTIVITY) {
    return { code: 'flat', last7, prior7, pct_change: null, slope_per_day };
  }
  if (prior7 <= 0) {
    return { code: 'up', last7, prior7, pct_change: null, slope_per_day };
  }
  const rel = (last7 - prior7) / prior7;
  const pct_change = Math.round(rel * 1000) / 10;
  const code: TrendCode = rel > TREND_THRESHOLD ? 'up' : rel < -TREND_THRESHOLD ? 'down' : 'flat';
  return { code, last7, prior7, pct_change, slope_per_day };
}

/**
 * RANK() семантик: оноогоор буурахаар эрэмбэлж, тэнцсэн хүмүүс ижил байр авна,
 * дараагийнх нь тэнцсэн тоогоор алгасна ([10,10,5] → 1,1,3).  1-ээс эхэлнэ.
 * Буцаах Map-ийн түлхүүр нь мөрийн объект өөрөө.
 */
export function rankWithTies<T>(rows: T[], score: (r: T) => number): Map<T, number> {
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  const out = new Map<T, number>();
  let rank = 0;
  let prev: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i] as T;
    const s = score(row);
    if (prev === null || s !== prev) {
      rank = i + 1;
      prev = s;
    }
    out.set(row, rank);
  }
  return out;
}

/** Байрын өөрчлөлт: before − now.  Эерэг = дээшилсэн (5 → 3 бол +2). Аль нэг нь null бол null. */
export function rankDelta(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null) return null;
  return before - now;
}

/** Хувийн өөрчлөлт (%, 1 орон): prev = 0 → null (∞-ийг харуулахгүй). */
export function pctDelta(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
