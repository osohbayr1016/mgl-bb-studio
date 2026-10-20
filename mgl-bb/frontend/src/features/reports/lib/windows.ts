import type { TParams, TranslationKey } from '@/shared/i18n';
import type { ReportWindow, SeriesGranularity, TrendCode } from '../types';

export const WINDOW_LABEL_KEY: Record<ReportWindow, string> = {
  day: 'reportsPage.windowDay',
  '7d': 'reportsPage.window7d',
  '14d': 'reportsPage.window14d',
  month: 'reportsPage.windowMonth',
  all: 'reportsPage.windowAll',
};

/**
 * Sparkline баганын гарчиг — серверийн `sparkline.days`-ээс («7 хоног»,
 * «14 хоног», «30 хоног»); хариу ирээгүй байхад цонхны нэрээр.
 */
export function sparkColLabel(
  t: (key: TranslationKey, params?: TParams) => string,
  days: number | null,
): string {
  return days == null ? t('reportsPage.colSpark') : t('reportsPage.colSparkDays', { days });
}

export const TREND_LABEL_KEY: Record<TrendCode, string> = {
  up: 'reportsPage.trendUp',
  down: 'reportsPage.trendDown',
  flat: 'reportsPage.trendFlat',
};

/** YYYY-MM-DD дээр өдөр нэмэх — UTC anchor тул цагийн бүсээр гулсахгүй. */
export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function isIsoDate(v: string | null | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`).getTime();
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Гэрээ дуусахад хэдэн хоног үлдсэн (сөрөг = дууссан). */
export function daysUntil(date: string, today: string): number {
  return Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

/** Хуанлийн мужийг 45 хоногийн (backend-ийн дээд хязгаар) хэсгүүдэд хуваана. */
export function chunkRange(from: string, to: string, size = 45): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cur = from;
  while (cur <= to) {
    const end = addDays(cur, size - 1);
    out.push([cur, end > to ? to : end]);
    cur = addDays(end, 1);
  }
  return out;
}

/**
 * Цувааны X тэнхлэгийн шошго — өдрөөр «MM-DD», 7 хоногоор «MM-DD»-ийн ЭХНИЙ
 * өдөр (Даваа), сараар «YYYY-MM».  Серверийн `series.granularity`-тай хос.
 */
export function seriesLabel(date: string, granularity: SeriesGranularity): string {
  if (granularity === 'month') return date.slice(0, 7);
  return date.slice(5);
}
