import { daysInclusive, describeRange, weekdayOf, type AsrRange } from '../lib/asrRange';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Хугацаа / огнооны ХҮН УНШИХ бичвэр.  Сар, гарагийн нэрийг толь бичгээс
 * (`asr.plans.monthNames` / `weekdayInitials`) авна — Chrome-ийн `mn` локал
 * олон машинд суугаагүй тул `Intl` нь чимээгүй англи руу унадаг
 * (`AsrPlansSection.DateBox`-ийн тайлбар).
 */

export function monthName(month: number, t: T): string {
  return t('asr.plans.monthNames').split(',')[month - 1] ?? String(month);
}

export function monthLabel(year: number, month: number, t: T): string {
  return t('asr.board.labelMonth', { year, month: monthName(month, t) });
}

export function weekdayShort(date: string, t: T): string {
  return t('asr.plans.weekdayInitials').split(',')[weekdayOf(date)] ?? '';
}

/** «2026 оны 9-р сар», «2026 он», «2026 оны 7-р сар – 9-р сар», «2026-09-02 – 2026-09-20». */
export function rangeTitle(range: AsrRange, t: T): string {
  const d = describeRange(range);
  switch (d.kind) {
    case 'all':
      return t('asr.board.preset.all');
    case 'month':
      return monthLabel(d.year, d.month, t);
    case 'year':
      return t('asr.board.labelYear', { year: d.year });
    case 'months': {
      const fy = Number(d.from.slice(0, 4));
      const ty = Number(d.to.slice(0, 4));
      const fm = Number(d.from.slice(5, 7));
      const tm = Number(d.to.slice(5, 7));
      if (fy === ty) {
        return t('asr.board.labelMonthsSameYear', {
          year: fy,
          from: monthName(fm, t),
          to: monthName(tm, t),
        });
      }
      return `${monthLabel(fy, fm, t)} – ${monthLabel(ty, tm, t)}`;
    }
    case 'days':
      return `${d.from} – ${d.to}`;
    case 'fromOnly':
      return t('asr.board.labelFromOnly', { from: d.from });
    case 'toOnly':
      return t('asr.board.labelToOnly', { to: d.to });
  }
}

/** Хязгаартай мужийн тайлбар мөр: «2026-09-01 – 2026-09-30 · 30 хоног». */
export function rangeSubtitle(range: AsrRange, t: T): string | null {
  if (!range.from || !range.to) return null;
  return `${range.from} – ${range.to} · ${t('asr.board.days', { n: daysInclusive(range.from, range.to) })}`;
}

/** «Өнөөдөр» / «Өчигдөр» / «5 хоногийн өмнө» / «3 хоногийн дараа». */
export function relativeDay(date: string, today: string, t: T): string {
  const diff = daysInclusive(date, today) - 1;
  if (diff === 0) return t('asr.board.today');
  if (diff === 1) return t('asr.board.yesterday');
  if (diff < 0) return t('asr.board.inDays', { n: -diff });
  return t('asr.board.daysAgo', { n: diff });
}
