// Pure project-forecast math. NO React / lightweight-charts / DOM imports —
// everything here is deterministic and reasoned about in isolation.
// All dates are UB calendar dates as 'YYYY-MM-DD' strings; we treat them as
// UTC midnight so weekday math is timezone-stable (matches the chart's
// `new Date(`${date}T00:00:00Z`)` convention).

import type { ProgressTimeseriesPoint, ProjectHeadcountPoint } from '@/shared/types';

const DAY_MS = 86_400_000;

function toUTC(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Sat/Sun = non-working (holidays are ignored here — the forecast is a
 *  coarse estimate; weekend exclusion is enough to match the chart's pace). */
function isWeekend(ms: number): boolean {
  const dow = new Date(ms).getUTCDay();
  return dow === 0 || dow === 6;
}

/** `start` + `n` working days (Mon–Fri), skipping weekends. n<=0 → start. */
export function addWorkingDays(start: string, n: number): string {
  let ms = toUTC(start);
  let left = Math.max(0, Math.ceil(n));
  while (left > 0) {
    ms += DAY_MS;
    if (!isWeekend(ms)) left -= 1;
  }
  return isoOf(ms);
}

/** Signed count of working days in (a, b]: positive if b is after a,
 *  negative if before. Same date → 0. */
export function workingDaysBetween(a: string, b: string): number {
  let from = toUTC(a);
  const to = toUTC(b);
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  let count = 0;
  while (from !== to) {
    from += sign * DAY_MS;
    if (!isWeekend(from)) count += sign;
  }
  return count;
}
// EXPECT: addWorkingDays('2026-06-11', 3) === '2026-06-16'  (Thu→Fri→Mon→Tue; skips Sat 13, Sun 14)
// EXPECT: workingDaysBetween('2026-06-11','2026-06-16') === 3
// EXPECT: workingDaysBetween('2026-06-16','2026-06-11') === -3

export interface ForecastInput {
  progress: number; // current overall % (0–100)
  avgGain: number; // working-day average daily gain (%/day) over the window
  currentPeople: number; // recent average daily headcount (>=1 enforced)
  today: string; // 'YYYY-MM-DD' (payload `to`)
  deadline: string | null; // schedule.finish_date
}

export interface ScenarioForecast {
  finishDate: string | null; // null = cannot forecast (stalled / no pace)
  daysToFinish: number | null; // working days from today
  varianceDays: number | null; // vs deadline: + late, − early; null if no deadline
  done: boolean; // already at/over 100%
}

export interface RequiredResource {
  requiredPeople: number | null;
  requiredGain: number; // %/working-day needed to hit the target date
}

/** Recent average daily headcount over the last `days` calendar days that
 *  actually had people (zero days excluded so weekends/gaps don't deflate it).
 *  Falls back to 1 so per-person math never divides by zero. */
export function recentAvgHeadcount(
  headcount: ProjectHeadcountPoint[],
  days = 14,
): number {
  if (headcount.length === 0) return 1;
  const recent = headcount.slice(-days).filter((h) => h.count > 0);
  if (recent.length === 0) return 1;
  const sum = recent.reduce((s, h) => s + h.count, 0);
  return Math.max(1, sum / recent.length);
}

/** Progress gained per person per working day, implied by the current pace. */
export function perPersonGain(avgGain: number, currentPeople: number): number {
  return avgGain / Math.max(1, currentPeople);
}

/** Forecast the finish date if `n` people work at the current per-person pace. */
export function forecastFinish(input: ForecastInput, n: number): ScenarioForecast {
  const { progress, avgGain, currentPeople, today, deadline } = input;
  if (progress >= 100) {
    return { finishDate: today, daysToFinish: 0, varianceDays: 0, done: true };
  }
  const gainN = perPersonGain(avgGain, currentPeople) * Math.max(0, n);
  if (gainN <= 0) {
    return { finishDate: null, daysToFinish: null, varianceDays: null, done: false };
  }
  const remaining = 100 - progress;
  const days = Math.ceil(remaining / gainN);
  const finishDate = addWorkingDays(today, days);
  const varianceDays = deadline ? workingDaysBetween(deadline, finishDate) : null;
  return { finishDate, daysToFinish: days, varianceDays, done: false };
}

/** Inverse: to finish by `targetDate`, how many people / what daily pace is
 *  needed? Returns null if the target is today-or-past or work is done. */
export function requiredResource(
  input: ForecastInput,
  targetDate: string,
): RequiredResource | null {
  const { progress, avgGain, currentPeople, today } = input;
  const remaining = 100 - progress;
  if (remaining <= 0) return null;
  const daysAvail = workingDaysBetween(today, targetDate);
  if (daysAvail <= 0) return null;
  const requiredGain = remaining / daysAvail;
  const ppg = perPersonGain(avgGain, currentPeople);
  const requiredPeople = ppg > 0 ? Math.ceil(requiredGain / ppg) : null;
  return { requiredPeople, requiredGain };
}

/** Assemble a ForecastInput from chart data. `avgGain` comes from the chart's
 *  existing working-day average (buildCandles); `series` supplies the latest
 *  progress and `today`. */
export function buildForecastInput(args: {
  series: ProgressTimeseriesPoint[];
  headcount: ProjectHeadcountPoint[];
  avgGain: number;
  today: string;
  deadline: string | null;
}): ForecastInput | null {
  const { series, headcount, avgGain, today, deadline } = args;
  if (series.length === 0) return null;
  return {
    progress: series[series.length - 1]!.progress,
    avgGain,
    currentPeople: recentAvgHeadcount(headcount),
    today,
    deadline,
  };
}

/** Forecast the finish date at a directly-specified daily gain (%/working-day).
 *  Mirror of `forecastFinish` but takes the daily pace straight instead of
 *  deriving it from a headcount — this is what the %/өдөр scenario slider drives. */
export function forecastFinishFromGain(
  input: ForecastInput,
  gainPerDay: number,
): ScenarioForecast {
  const { progress, today, deadline } = input;
  if (progress >= 100) {
    return { finishDate: today, daysToFinish: 0, varianceDays: 0, done: true };
  }
  if (gainPerDay <= 0) {
    return { finishDate: null, daysToFinish: null, varianceDays: null, done: false };
  }
  const remaining = 100 - progress;
  const days = Math.ceil(remaining / gainPerDay);
  const finishDate = addWorkingDays(today, days);
  const varianceDays = deadline ? workingDaysBetween(deadline, finishDate) : null;
  return { finishDate, daysToFinish: days, varianceDays, done: false };
}
// EXPECT: progress=50, today='2026-06-11', deadline=null, gainPerDay=2
//   → remaining 50 / 2 = 25 working days → finishDate = addWorkingDays('2026-06-11', 25); done=false
// EXPECT: gainPerDay=0 → { finishDate: null, daysToFinish: null, ... } (cannot forecast)
// EXPECT: progress=100 → { done: true, finishDate: today, daysToFinish: 0 }
