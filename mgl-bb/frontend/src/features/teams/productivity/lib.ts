import type { PeriodKind, ProductivityHistoryPoint, ProductivityPeriod } from './types';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Өдрийн дундаж бүтээмж — «0.056%».  Хэмжсэн (прод 2026-09): хүний өдрийн
 * дундаж 0.0001–0.25%, тиймээс 1 орон хангалтгүй — `features/reports`-ийн
 * `fmtPts`-тэй ижил дүрэм (|v| ≥ 1 → 1 орон, үгүй бол 3 орон хүртэл).
 */
export function fmtAvg(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const r = abs >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000;
  // Маш бага боловч тэг биш утгыг «0%» гэж харуулахгүй — «<0.001%».
  if (r === 0 && v > 0) return '<0.001%';
  return `${r.toLocaleString('en-US', { maximumFractionDigits: abs >= 1 ? 1 : 3 })}%`;
}

/** Зөрүү, ирц гэх мэт энгийн хувь — «25%», «12.5%». */
export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 10) / 10}%`;
}

/** Өмнөх хугацаатай харьцуулсан чиглэл — ±5%-иас бага өөрчлөлт «тогтвортой». */
export type Trend = 'up' | 'down' | 'flat' | 'none';
export function trendOf(cur: number | null | undefined, prev: number | null | undefined): Trend {
  if (cur == null || prev == null) return 'none';
  if (prev === 0) return cur > 0 ? 'up' : 'flat';
  const rel = (cur - prev) / prev;
  if (rel > 0.05) return 'up';
  if (rel < -0.05) return 'down';
  return 'flat';
}

function weekdayKey(date: string): string {
  return `teamProductivity.weekday${new Date(`${date}T00:00:00Z`).getUTCDay()}`;
}

/** Хугацааны гарчиг — өдөр «2026-09-24 · Пүрэв», 7 хоног «2026-09-21 – 09-27», сар «2026 оны 9-р сар». */
export function periodLabel(p: Pick<ProductivityPeriod, 'kind' | 'from' | 'to'>, t: T): string {
  if (p.kind === 'day') return `${p.from} · ${t(weekdayKey(p.from))}`;
  if (p.kind === 'week') return `${p.from} – ${p.to.slice(5)}`;
  return t('teamProductivity.monthLabel', {
    year: p.from.slice(0, 4),
    month: Number(p.from.slice(5, 7)),
    mm: p.from.slice(5, 7),
  });
}

/** Түүхийн графикийн тэнхлэгийн богино шошго. */
export function historyTick(h: Pick<ProductivityHistoryPoint, 'from'>, kind: PeriodKind): string {
  if (kind === 'month') return h.from.slice(0, 7);
  return h.from.slice(5);
}
