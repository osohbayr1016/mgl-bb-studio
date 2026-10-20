# Project Forecast Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a management-grade "will it finish on time?" forecast overlay to the project charts tab — keep the candlestick base, add client-side forecast lines (current pace + a slider-driven scenario), a draggable scenario cursor, and a headcount slider with a readout.

**Architecture:** All forecast math is pure functions in a new `forecast.ts` (no DOM/React). The existing `LwProgressChart` in `ProjectChartsTab.tsx` gains: an actual-progress line, future-extending whitespace on the candle series, forecast LineSeries into that future, and custom lightweight-charts **series primitives** for vertical markers + a draggable cursor. A new `ForecastControls` React component holds the slider + readout. No backend change — every input comes from the existing `ProjectChartsTimeseries` payload.

**Tech Stack:** React 19, TypeScript (strict, `noUncheckedIndexedAccess`), lightweight-charts v5.2.0, TanStack Query, Vite. No test runner in this repo — **verification is `npm run build` (tsc -b) + `npx eslint <file>` + a `/code-review`-style adversarial review + manual browser check.** Do NOT invent `npm test`.

**Spec:** `docs/superpowers/specs/2026-06-11-project-forecast-chart-design.md`

---

## Verification note (read first)

This repo has **no test suite** (see CLAUDE.md). Wherever a normal plan would say "write a failing test", this plan substitutes:

1. **Type/build gate:** `cd frontend && npm run build` — `tsc -b` is the type checker; it must pass.
2. **Lint gate:** `cd frontend && npx eslint <changed files>` — must pass.
3. **Math gate (forecast.ts only):** worked numeric examples are embedded as `// EXPECT:` comments; the engineer sanity-checks them by eye, and the Phase-A adversarial review re-verifies.
4. **Visual gate:** the user deploys `frontend/dist/` to Cloudflare Pages and confirms in the browser (frontend-only feature).

Commit after each task. Frontend-only: **no backend deploy, no migration.**

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/features/projects/lib/forecast.ts` | **New.** Pure forecast math: working-day helpers, `forecastFinish(N)`, `requiredResource(targetDate)`, input builders. No imports from React/lightweight-charts. |
| `frontend/src/features/projects/components/chart/VertLinePrimitive.ts` | **New.** Static vertical-line series primitive (today / deadline / forecast markers). |
| `frontend/src/features/projects/components/chart/DraggableCursorPrimitive.ts` | **New.** Draggable vertical cursor primitive (Phase C). |
| `frontend/src/features/projects/components/ForecastControls.tsx` | **New.** Headcount slider + scenario toggles + readout card. |
| `frontend/src/features/projects/components/ProjectChartsTab.tsx` | **Modify.** Wire forecast lines, whitespace future extension, primitives, and `ForecastControls` into `LwProgressChart` / `OverallProgressCard`. |
| `frontend/src/shared/i18n/mn.json`, `en.json` | **Modify.** New `projectChartsTab.fc*` keys in both. |

---

# PHASE A — Forecast overlay

## Task A1: Forecast working-day helpers

**Files:**
- Create: `frontend/src/features/projects/lib/forecast.ts`

- [ ] **Step 1: Create the file with date/working-day helpers**

```ts
// Pure project-forecast math. NO React / lightweight-charts / DOM imports —
// everything here is deterministic and reasoned about in isolation.
// All dates are UB calendar dates as 'YYYY-MM-DD' strings; we treat them as
// UTC midnight so weekday math is timezone-stable (matches the chart's
// `new Date(`${date}T00:00:00Z`)` convention).

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
```

- [ ] **Step 2: Build gate**

Run: `cd frontend && npm run build`
Expected: PASS (no type errors). The file is unused so far — that's fine.

- [ ] **Step 3: Lint gate**

Run: `cd frontend && npx eslint src/features/projects/lib/forecast.ts`
Expected: PASS (clean).

- [ ] **Step 4: Eyeball the EXPECT comments**

Confirm by hand that the three `// EXPECT:` lines hold (2026-06-13 is a Saturday). If any is wrong, fix the helper before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/projects/lib/forecast.ts
git commit -m "feat(forecast): working-day date helpers"
```

---

## Task A2: Forecast core math

**Files:**
- Modify: `frontend/src/features/projects/lib/forecast.ts`

- [ ] **Step 1: Append the input/output types + builders + forecast functions**

```ts
import type { ProgressTimeseriesPoint, ProjectHeadcountPoint } from '@/shared/types';

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
// EXPECT: with progress=50, avgGain=2, currentPeople=2, today='2026-06-11', deadline=null
//   forecastFinish(input, 2) → remaining 50 / (perPerson 1 * 2 =2) = 25 working days → finishDate 25 wd after 2026-06-11; done=false
//   forecastFinish(input, 4) → 50 / (1*4=4) = 13 working days (ceil) → earlier finishDate
//   requiredResource(input, <10 wd ahead>) → requiredGain = 50/10 = 5 %/day; requiredPeople = ceil(5/1)=5
```

- [ ] **Step 2: Build gate**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 3: Lint gate**

Run: `cd frontend && npx eslint src/features/projects/lib/forecast.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/projects/lib/forecast.ts
git commit -m "feat(forecast): scenario + required-resource math"
```

---

## Task A3: i18n keys (both dictionaries)

**Files:**
- Modify: `frontend/src/shared/i18n/mn.json`
- Modify: `frontend/src/shared/i18n/en.json`

- [ ] **Step 1: Add keys to mn.json**

Find the line `"projectChartsTab.indPlanned": "Төлөвлөгөө",` and add immediately after it:

```json
  "projectChartsTab.fcActual": "Бодит явц",
  "projectChartsTab.fcCurrentPace": "Одоогийн хурд",
  "projectChartsTab.fcScenario": "Хувилбар",
  "projectChartsTab.fcCursor": "Заагч",
  "projectChartsTab.fcPeople": "{count} хүн",
  "projectChartsTab.fcPeopleLabel": "Хүний тоо",
  "projectChartsTab.fcForecastFinish": "Таамаг дуусах",
  "projectChartsTab.fcDeadline": "Эцсийн хугацаа",
  "projectChartsTab.fcToday": "Өнөөдөр",
  "projectChartsTab.fcVarianceLate": "{days} хоног хоцорно",
  "projectChartsTab.fcVarianceEarly": "{days} хоног эрт",
  "projectChartsTab.fcVarianceOnTime": "Яг хугацаандаа",
  "projectChartsTab.fcRequired": "{date}-д дуусгахад: {people} хүн ({gain}%/өдөр)",
  "projectChartsTab.fcApprox": "ойролцоо",
  "projectChartsTab.fcNoForecast": "Тооцох боломжгүй (явц зогссон)",
  "projectChartsTab.fcDone": "Дууссан",
```

- [ ] **Step 2: Add the SAME keys to en.json**

Find `"projectChartsTab.indPlanned": "Planned",` and add after it:

```json
  "projectChartsTab.fcActual": "Actual progress",
  "projectChartsTab.fcCurrentPace": "Current pace",
  "projectChartsTab.fcScenario": "Scenario",
  "projectChartsTab.fcCursor": "Cursor",
  "projectChartsTab.fcPeople": "{count} people",
  "projectChartsTab.fcPeopleLabel": "People",
  "projectChartsTab.fcForecastFinish": "Forecast finish",
  "projectChartsTab.fcDeadline": "Deadline",
  "projectChartsTab.fcToday": "Today",
  "projectChartsTab.fcVarianceLate": "{days} days late",
  "projectChartsTab.fcVarianceEarly": "{days} days early",
  "projectChartsTab.fcVarianceOnTime": "On time",
  "projectChartsTab.fcRequired": "To finish by {date}: {people} people ({gain}%/day)",
  "projectChartsTab.fcApprox": "approx.",
  "projectChartsTab.fcNoForecast": "Cannot forecast (progress stalled)",
  "projectChartsTab.fcDone": "Done",
```

- [ ] **Step 3: Build gate** — `cd frontend && npm run build` → PASS (JSON must stay valid).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/i18n/mn.json frontend/src/shared/i18n/en.json
git commit -m "i18n(forecast): forecast chart keys (mn + en)"
```

---

## Task A4: Static vertical-line primitive

**Files:**
- Create: `frontend/src/features/projects/components/chart/VertLinePrimitive.ts`

This adapts the official lightweight-charts "VertLine" plugin example to v5's `ISeriesPrimitive` API.

- [ ] **Step 1: Create the primitive**

```ts
import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
} from 'lightweight-charts';

export interface VertLineOptions {
  color: string;
  width: number;
  labelText?: string;
  labelColor?: string;
  dashed?: boolean;
}

class VertLineRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private x: number | null,
    private options: VertLineOptions,
  ) {}
  draw(target: { useBitmapCoordinateSpace: (cb: (scope: { context: CanvasRenderingContext2D; bitmapSize: { height: number }; horizontalPixelRatio: number }) => void) => void }): void {
    if (this.x === null) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const px = Math.round(this.x! * scope.horizontalPixelRatio);
      ctx.save();
      ctx.strokeStyle = this.options.color;
      ctx.lineWidth = this.options.width * scope.horizontalPixelRatio;
      if (this.options.dashed) ctx.setLineDash([4 * scope.horizontalPixelRatio, 4 * scope.horizontalPixelRatio]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, scope.bitmapSize.height);
      ctx.stroke();
      if (this.options.labelText) {
        ctx.setLineDash([]);
        ctx.fillStyle = this.options.labelColor ?? this.options.color;
        ctx.font = `${10 * scope.horizontalPixelRatio}px sans-serif`;
        ctx.fillText(this.options.labelText, px + 3 * scope.horizontalPixelRatio, 12 * scope.horizontalPixelRatio);
      }
      ctx.restore();
    });
  }
}

class VertLinePaneView implements ISeriesPrimitivePaneView {
  private x: number | null = null;
  constructor(
    private chart: IChartApi,
    private getTime: () => Time | null,
    private options: VertLineOptions,
  ) {}
  update(): void {
    const t = this.getTime();
    this.x = t === null ? null : this.chart.timeScale().timeToCoordinate(t);
  }
  renderer(): ISeriesPrimitivePaneRenderer {
    return new VertLineRenderer(this.x, this.options);
  }
}

/** A draggable-free vertical line pinned to a `Time`. `getTime` is read on
 *  every frame so the caller can move it by changing the returned value. */
export class VertLine implements ISeriesPrimitive<Time> {
  private paneView: VertLinePaneView;
  constructor(chart: IChartApi, getTime: () => Time | null, options: VertLineOptions) {
    this.paneView = new VertLinePaneView(chart, getTime, options);
  }
  updateAllViews(): void {
    this.paneView.update();
  }
  paneViews(): ISeriesPrimitivePaneView[] {
    return [this.paneView];
  }
}

export type AttachableSeries = ISeriesApi<SeriesType>;
```

> NOTE: If a type name from lightweight-charts v5 differs (the package occasionally renames primitive interfaces between minors), run `npm run build`, read the exact exported name from the error, and adjust the import — do not invent names.

- [ ] **Step 2: Build gate** — `cd frontend && npm run build` → PASS. If a primitive interface name mismatches, fix per the NOTE above.

- [ ] **Step 3: Lint gate** — `cd frontend && npx eslint src/features/projects/components/chart/VertLinePrimitive.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/projects/components/chart/VertLinePrimitive.ts
git commit -m "feat(forecast): static vertical-line chart primitive"
```

---

## Task A5: Actual line + forecast line + future whitespace

**Files:**
- Modify: `frontend/src/features/projects/components/ProjectChartsTab.tsx`

Context: `LwProgressChart` already creates the chart once, sets candle data in an effect, and has refs for candle/trend/etc. We add (a) an actual-progress LineSeries, (b) a current-pace forecast LineSeries, and (c) future whitespace appended to the candle data so the forecast has x-space.

- [ ] **Step 1: Import forecast helpers + add props**

At the top imports of `ProjectChartsTab.tsx` add:

```ts
import { buildForecastInput, forecastFinish, type ForecastInput, type ScenarioForecast } from '@/features/projects/lib/forecast';
import type { Time } from 'lightweight-charts';
```
(`Time` may already be imported — if so, skip it.)

In the `LwProgressChart` props type add ONLY (if not already present):
```ts
  schedule: { start_date: string | null; finish_date: string | null };
```
Destructure `schedule` in the params. (`forecastInput`/`currentPaceFinish` are computed INTERNALLY in Step 2 — `avgGain` already lives in this component via `buildCandles`, so we keep one source of truth and avoid prop churn. The `ForecastInput`/`ScenarioForecast` type imports from Step 1 are used by these internal memos.)

- [ ] **Step 2: Add refs + internal forecast input + memoised series data**

Next to the existing `trendRef`/`maRef` refs add:
```ts
  const actualRef = useRef<ISeriesApi<'Line'> | null>(null);
  const fcCurrentRef = useRef<ISeriesApi<'Line'> | null>(null);
```

After the existing `trendData` memo add (note: `avgGain` comes from the existing `buildCandles` memo in this component):
```ts
  // Forecast-ийн оролт — энэ компонент дотор тооцно (avgGain энд бий).
  const forecastInput = useMemo(
    () =>
      buildForecastInput({
        series,
        headcount,
        avgGain,
        today: series[series.length - 1]?.date ?? '',
        deadline: schedule.finish_date,
      }),
    [series, headcount, avgGain, schedule.finish_date],
  );
  const currentPaceFinish = useMemo(
    () => (forecastInput ? forecastFinish(forecastInput, forecastInput.currentPeople) : null),
    [forecastInput],
  );

  // Бодит явцын шугам — overall-ийн цэвэр LineSeries.
  const actualData = useMemo(
    () => series.map((p) => ({ time: p.date as Time, value: p.progress })),
    [series],
  );

  // Forecast төгсгөлийн огноо (одоогийн хурд) — null бол forecast зурахгүй.
  const currentFinishDate = currentPaceFinish?.finishDate ?? null;

  // Ирээдүйн whitespace — өнөөдрөөс forecast-дуусах хүртэл (хамгийн ихдээ
  // төлөвлөсөн хугацааны 2 дахин cap). Тэнхлэгийг ирээдүй рүү нээнэ.
  const futureWhitespace = useMemo(() => {
    if (!currentFinishDate || series.length === 0) return [];
    const today = series[series.length - 1]!.date;
    const out: { time: Time }[] = [];
    let ms = new Date(`${today}T00:00:00Z`).getTime();
    const endMs = new Date(`${currentFinishDate}T00:00:00Z`).getTime();
    let guard = 0;
    while (ms < endMs && guard < 800) {
      ms += 86_400_000;
      out.push({ time: new Date(ms).toISOString().slice(0, 10) as Time });
      guard += 1;
    }
    return out;
  }, [currentFinishDate, series]);

  // Forecast шугам (одоогийн хурд): (өнөөдөр, явц) → (дуусах, 100).
  const fcCurrentData = useMemo(() => {
    if (!forecastInput || !currentFinishDate) return [];
    return [
      { time: forecastInput.today as Time, value: forecastInput.progress },
      { time: currentFinishDate as Time, value: 100 },
    ];
  }, [forecastInput, currentFinishDate]);
```

- [ ] **Step 3: Create the two line series in the create-once effect**

Right after `plannedRef.current = planned;` (the existing planned series creation) add:
```ts
    const actual = chart.addSeries(LineSeries, {
      color: '#e2e8f0',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      pointMarkersVisible: false,
      autoscaleInfoProvider: () => null,
    });
    actualRef.current = actual;

    const fcCurrent = chart.addSeries(LineSeries, {
      color: '#22d3ee', // cyan — current-pace forecast
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      pointMarkersVisible: false,
      autoscaleInfoProvider: () => null,
    });
    fcCurrentRef.current = fcCurrent;
```

In the cleanup `return () => { ... }` add:
```ts
      actualRef.current = null;
      fcCurrentRef.current = null;
```

- [ ] **Step 4: Relax fixRightEdge so the future is visible**

In the `createChart({ ... timeScale: { ... } })` options, change:
```ts
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
```
to:
```ts
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: false },
```

- [ ] **Step 5: Push candle data WITH whitespace, and the new line data**

Replace the existing candle-data effect body:
```ts
  useEffect(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    if (!candle || !chart) return;
    candle.setData([...candles, ...futureWhitespace]);
    chart.timeScale().fitContent();
  }, [candles, futureWhitespace]);
```

After the existing trend-data effect add:
```ts
  useEffect(() => {
    actualRef.current?.setData(actualData);
  }, [actualData]);

  useEffect(() => {
    fcCurrentRef.current?.setData(fcCurrentData);
  }, [fcCurrentData]);
```

- [ ] **Step 6: Build + lint gates**

Run: `cd frontend && npm run build` → PASS
Run: `cd frontend && npx eslint src/features/projects/components/ProjectChartsTab.tsx` → PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/projects/components/ProjectChartsTab.tsx
git commit -m "feat(forecast): actual line + current-pace forecast line + future axis"
```

---

## Task A6: Attach vertical markers (today / deadline / forecast)

**Files:**
- Modify: `frontend/src/features/projects/components/ProjectChartsTab.tsx`

- [ ] **Step 1: Import the primitive + the language hook label**

Add import:
```ts
import { VertLine } from '@/features/projects/components/chart/VertLinePrimitive';
```

- [ ] **Step 2: Add refs for the three vertical lines**

```ts
  const vToday = useRef<VertLine | null>(null);
  const vDeadline = useRef<VertLine | null>(null);
  const vForecast = useRef<VertLine | null>(null);
```

- [ ] **Step 3: Hold the latest marker times in refs (read by the primitives each frame)**

```ts
  const todayTimeRef = useRef<Time | null>(null);
  const deadlineTimeRef = useRef<Time | null>(null);
  const forecastTimeRef = useRef<Time | null>(null);
  todayTimeRef.current = (forecastInput?.today ?? null) as Time | null;
  deadlineTimeRef.current = (schedule.finish_date ?? null) as Time | null;
  forecastTimeRef.current = currentFinishDate as Time | null;
```

- [ ] **Step 4: Attach primitives once, after the candle series exists**

In the create-once effect, after `candleRef.current = candle;`:
```ts
    const today = new VertLine(chart, () => todayTimeRef.current, {
      color: TV.flat, width: 1, labelText: t('projectChartsTab.fcToday'), labelColor: TV.textDim,
    });
    const deadline = new VertLine(chart, () => deadlineTimeRef.current, {
      color: TV.down, width: 1, dashed: true, labelText: t('projectChartsTab.fcDeadline'), labelColor: TV.down,
    });
    const forecast = new VertLine(chart, () => forecastTimeRef.current, {
      color: '#22d3ee', width: 1, dashed: true, labelText: t('projectChartsTab.fcForecastFinish'), labelColor: '#22d3ee',
    });
    candle.attachPrimitive(today);
    candle.attachPrimitive(deadline);
    candle.attachPrimitive(forecast);
    vToday.current = today;
    vDeadline.current = deadline;
    vForecast.current = forecast;
```
In cleanup add:
```ts
      vToday.current = null;
      vDeadline.current = null;
      vForecast.current = null;
```
> The `t(...)` label is captured at creation; the markers are re-positioned by the time refs every frame, so language changes only affect labels after a remount — acceptable (the chart remounts on range change anyway).

- [ ] **Step 5: Build + lint gates** → PASS (both).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/projects/components/ProjectChartsTab.tsx
git commit -m "feat(forecast): today/deadline/forecast vertical markers"
```

---

## Task A7: ForecastControls readout + wire into OverallProgressCard

**Files:**
- Create: `frontend/src/features/projects/components/ForecastControls.tsx`
- Modify: `frontend/src/features/projects/components/ProjectChartsTab.tsx`

- [ ] **Step 1: Create the readout component (no slider yet — Phase B adds it)**

```tsx
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { ScenarioForecast } from '@/features/projects/lib/forecast';

function fmtDate(d: string | null, locale: string): string {
  if (!d) return '—';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(locale === 'mn' ? 'mn-MN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function VarianceTag({ f }: { f: ScenarioForecast | null }) {
  const { t } = useLanguage();
  if (!f || f.varianceDays === null) return null;
  if (f.varianceDays === 0)
    return <span className="text-emerald-400">{t('projectChartsTab.fcVarianceOnTime')}</span>;
  const late = f.varianceDays > 0;
  return (
    <span className={late ? 'text-red-400' : 'text-emerald-400'}>
      {late
        ? t('projectChartsTab.fcVarianceLate', { days: f.varianceDays })
        : t('projectChartsTab.fcVarianceEarly', { days: -f.varianceDays })}
    </span>
  );
}

export function ForecastReadout({
  progress,
  deadline,
  currentPace,
  locale,
}: {
  progress: number;
  deadline: string | null;
  currentPace: ScenarioForecast | null;
  locale: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="rounded-lg border border-white/10 bg-[#131722] p-3 text-[11px] tabular-nums text-slate-300">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-slate-100 font-semibold">{progress.toFixed(1)}%</span>
        <span>
          {t('projectChartsTab.fcDeadline')}: <span className="text-slate-200">{fmtDate(deadline, locale)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#22d3ee' }} />
          {t('projectChartsTab.fcCurrentPace')}:{' '}
          {currentPace?.done ? (
            <span className="text-emerald-400">{t('projectChartsTab.fcDone')}</span>
          ) : currentPace?.finishDate ? (
            <>
              <span className="text-slate-200">{fmtDate(currentPace.finishDate, locale)}</span> · <VarianceTag f={currentPace} />
            </>
          ) : (
            <span className="text-amber-400">{t('projectChartsTab.fcNoForecast')}</span>
          )}
        </span>
        <span className={cn('text-[10px] italic text-slate-500')}>({t('projectChartsTab.fcApprox')})</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render the readout inside LwProgressChart**

`forecastInput` and `currentPaceFinish` are already computed inside `LwProgressChart` (Task A5 Step 2). Just render the readout. Import at the top of `ProjectChartsTab.tsx`:
```ts
import { ForecastReadout } from '@/features/projects/components/ForecastControls';
```
`LwProgressChart` already calls `useLanguage()` — change it to also pull `lang`:
```ts
  const { t, lang } = useLanguage();
```
The outer wrapper `div` is already `className="relative h-full w-full overflow-hidden rounded-lg"`. Render the forecast controls as a **bottom overlay** inside it (consistent with the existing `OhlcLegend`/`CandleTooltip` overlays). After the chart container `<div ref={containerRef} className="h-full w-full" />` add this single overlay container — **Phases B and C append more rows into this same container**:
```tsx
      {forecastInput && (
        <div className="absolute bottom-1 left-1 right-1 z-10 space-y-1 rounded-md bg-[#131722]/85 p-1.5 backdrop-blur-sm">
          <ForecastReadout
            progress={forecastInput.progress}
            deadline={schedule.finish_date}
            currentPace={currentPaceFinish}
            locale={lang}
          />
        </div>
      )}
```
> All forecast computation stays inside `LwProgressChart` where `avgGain` lives; `OverallProgressCard` only passes `schedule` (Step 3). No props were added/removed in this task. Controls overlay the bottom ~strip of the chart (the forecast curves climb to the top-right, so the bottom strip is safe to cover).

- [ ] **Step 3: Ensure `schedule` is passed from OverallProgressCard to LwProgressChart**

It already is (added when the planned indicator shipped). Confirm the `<LwProgressChart ... schedule={schedule} />` call exists; if not, add `schedule={data?.schedule ?? { start_date: null, finish_date: null }}`.

- [ ] **Step 4: Build + lint gates** → PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/projects/components/ForecastControls.tsx frontend/src/features/projects/components/ProjectChartsTab.tsx
git commit -m "feat(forecast): readout card with current-pace finish + variance"
```

---

## Task A8: Phase-A verification

- [ ] **Step 1: Full build** — `cd frontend && npm run build` → PASS.
- [ ] **Step 2: Lint changed files** — `npx eslint src/features/projects/lib/forecast.ts src/features/projects/components/chart/VertLinePrimitive.ts src/features/projects/components/ForecastControls.tsx src/features/projects/components/ProjectChartsTab.tsx` → PASS.
- [ ] **Step 3: Adversarial review** — run a review workflow (same shape used for the prior chart work) over the Phase-A diff: forecast math edge cases, the whitespace/future-axis behaviour, primitive lifecycle/cleanup, i18n parity. Fix any confirmed findings.
- [ ] **Step 4: Visual check** — user builds `frontend/dist/` and confirms in the browser: actual line, cyan dashed forecast line into the future, today/deadline/forecast vertical lines, readout with finish date + variance. On a stalled project, "Cannot forecast" shows.

---

# PHASE B — Headcount slider (live scenario)

## Task B1: Slider state + scenario forecast in LwProgressChart

**Files:**
- Modify: `frontend/src/features/projects/components/ForecastControls.tsx`
- Modify: `frontend/src/features/projects/components/ProjectChartsTab.tsx`

- [ ] **Step 1: Add a slider control to ForecastControls.tsx**

Append this exported component:
```tsx
export function HeadcountSlider({
  value,
  onChange,
  max = 50,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
}) {
  const { t } = useLanguage();
  return (
    <label className="flex items-center gap-2 text-[11px] text-slate-300">
      <span className="shrink-0">{t('projectChartsTab.fcPeopleLabel')}</span>
      <input
        type="range"
        min={1}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-40 cursor-pointer accent-fuchsia-400"
      />
      <span className="w-16 shrink-0 tabular-nums text-slate-100">
        {t('projectChartsTab.fcPeople', { count: value })}
      </span>
    </label>
  );
}
```

- [ ] **Step 2: Add scenario state + line in LwProgressChart**

Near the other forecast memos in `LwProgressChart`:
```tsx
  const [scenarioN, setScenarioN] = useState<number>(0); // 0 = "uninitialised"
  // Default the slider to the current headcount once we know it.
  useEffect(() => {
    if (scenarioN === 0 && forecastInput) setScenarioN(Math.max(1, Math.round(forecastInput.currentPeople)));
  }, [forecastInput, scenarioN]);

  const scenarioFinish = useMemo(
    () => (forecastInput && scenarioN > 0 ? forecastFinish(forecastInput, scenarioN) : null),
    [forecastInput, scenarioN],
  );
  const fcScenarioData = useMemo(() => {
    if (!forecastInput || !scenarioFinish?.finishDate) return [];
    return [
      { time: forecastInput.today as Time, value: forecastInput.progress },
      { time: scenarioFinish.finishDate as Time, value: 100 },
    ];
  }, [forecastInput, scenarioFinish]);
```

- [ ] **Step 3: Add the scenario LineSeries + ref**

Add ref `const fcScenarioRef = useRef<ISeriesApi<'Line'> | null>(null);` and create in the once-effect (after `fcCurrentRef.current = fcCurrent;`):
```ts
    const fcScenario = chart.addSeries(LineSeries, {
      color: '#e879f9', // fuchsia — scenario forecast
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      pointMarkersVisible: false,
      autoscaleInfoProvider: () => null,
    });
    fcScenarioRef.current = fcScenario;
```
Cleanup: `fcScenarioRef.current = null;`. Data effect:
```ts
  useEffect(() => {
    fcScenarioRef.current?.setData(fcScenarioData);
  }, [fcScenarioData]);
```

- [ ] **Step 4: Extend the whitespace to cover the LATER of current/scenario finish**

In the `futureWhitespace` memo, replace `currentFinishDate` end with the later of the two:
```ts
  const futureEnd = useMemo(() => {
    const a = currentFinishDate;
    const b = scenarioFinish?.finishDate ?? null;
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }, [currentFinishDate, scenarioFinish]);
```
and use `futureEnd` in `futureWhitespace` (rename the dep). Update the `endMs` line to use `futureEnd`.

- [ ] **Step 5: Render slider + scenario row INSIDE the existing bottom overlay**

Inside the bottom-overlay container created in Task A7 Step 2 (the `<div className="absolute bottom-1 ... space-y-1 ...">`), **after** the `<ForecastReadout .../>`, add these two rows:
```tsx
          <HeadcountSlider value={Math.max(1, scenarioN)} onChange={setScenarioN} />
          {scenarioFinish?.finishDate && (
            <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-slate-300">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#e879f9' }} />
              {t('projectChartsTab.fcScenario')}: {t('projectChartsTab.fcPeople', { count: scenarioN })} →{' '}
              <span className="text-slate-200">{new Date(`${scenarioFinish.finishDate}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
          )}
```
Import `HeadcountSlider` from `ForecastControls`. Ensure `useState` is imported (it is). (The `space-y-1` on the overlay container handles row spacing — no `mt-2` needed.)

- [ ] **Step 6: Build + lint gates** → PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/projects/components/ForecastControls.tsx frontend/src/features/projects/components/ProjectChartsTab.tsx
git commit -m "feat(forecast): headcount slider drives live scenario forecast"
```

---

# PHASE C — Draggable scenario cursor

## Task C1: Draggable cursor primitive

**Files:**
- Create: `frontend/src/features/projects/components/chart/DraggableCursorPrimitive.ts`

This extends the vertical-line idea with pointer hit-testing + drag. It reports the dragged `Time` via a callback so React recomputes `requiredResource`.

- [ ] **Step 1: Create the primitive**

```ts
import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  IChartApi,
  Time,
} from 'lightweight-charts';

export interface DraggableCursorCallbacks {
  getTime: () => Time | null;
  setTime: (t: Time) => void;
  color: string;
}

class Renderer implements ISeriesPrimitivePaneRenderer {
  constructor(private x: number | null, private color: string) {}
  draw(target: { useBitmapCoordinateSpace: (cb: (s: { context: CanvasRenderingContext2D; bitmapSize: { height: number }; horizontalPixelRatio: number }) => void) => void }): void {
    if (this.x === null) return;
    target.useBitmapCoordinateSpace((s) => {
      const ctx = s.context;
      const px = Math.round(this.x! * s.horizontalPixelRatio);
      ctx.save();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2 * s.horizontalPixelRatio;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, s.bitmapSize.height);
      ctx.stroke();
      // grip handle
      ctx.fillStyle = this.color;
      ctx.fillRect(px - 3 * s.horizontalPixelRatio, 4 * s.horizontalPixelRatio, 6 * s.horizontalPixelRatio, 14 * s.horizontalPixelRatio);
      ctx.restore();
    });
  }
}

class PaneView implements ISeriesPrimitivePaneView {
  private x: number | null = null;
  constructor(private chart: IChartApi, private cb: DraggableCursorCallbacks) {}
  update(): void {
    const t = this.cb.getTime();
    this.x = t === null ? null : this.chart.timeScale().timeToCoordinate(t);
  }
  renderer(): ISeriesPrimitivePaneRenderer {
    return new Renderer(this.x, this.cb.color);
  }
}

export class DraggableCursor implements ISeriesPrimitive<Time> {
  private paneView: PaneView;
  private dragging = false;
  private container: HTMLElement | null = null;
  private onDown = (e: PointerEvent) => this.handleDown(e);
  private onMove = (e: PointerEvent) => this.handleMove(e);
  private onUp = () => this.handleUp();

  constructor(private chart: IChartApi, private cb: DraggableCursorCallbacks, container: HTMLElement) {
    this.paneView = new PaneView(chart, cb);
    this.container = container;
    container.addEventListener('pointerdown', this.onDown);
    container.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  private handleDown(e: PointerEvent): void {
    const t = this.cb.getTime();
    if (t === null) return;
    const x = this.chart.timeScale().timeToCoordinate(t);
    if (x === null) return;
    const rect = this.container!.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    if (Math.abs(localX - x) <= 6) {
      this.dragging = true;
      this.chart.applyOptions({ handleScroll: false, handleScale: false });
    }
  }
  private handleMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const rect = this.container!.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const t = this.chart.timeScale().coordinateToTime(localX);
    if (t !== null) this.cb.setTime(t);
  }
  private handleUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.chart.applyOptions({ handleScroll: true, handleScale: true });
  }

  destroy(): void {
    this.container?.removeEventListener('pointerdown', this.onDown);
    this.container?.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.container = null;
  }
  updateAllViews(): void {
    this.paneView.update();
  }
  paneViews(): ISeriesPrimitivePaneView[] {
    return [this.paneView];
  }
}
```

- [ ] **Step 2: Build + lint gates** → PASS. Fix any v5 primitive type-name mismatch per the NOTE in Task A4.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/projects/components/chart/DraggableCursorPrimitive.ts
git commit -m "feat(forecast): draggable cursor chart primitive"
```

---

## Task C2: Wire the cursor + inverse readout

**Files:**
- Modify: `frontend/src/features/projects/components/ProjectChartsTab.tsx`

- [ ] **Step 1: Import + state**

```ts
import { DraggableCursor } from '@/features/projects/components/chart/DraggableCursorPrimitive';
import { requiredResource } from '@/features/projects/lib/forecast';
```
In `LwProgressChart`:
```ts
  const [cursorTime, setCursorTime] = useState<string | null>(null);
  const cursorTimeRef = useRef<string | null>(null);
  cursorTimeRef.current = cursorTime;
  const cursorRef = useRef<DraggableCursor | null>(null);
  // Default the cursor to the deadline (or current forecast) once known.
  useEffect(() => {
    if (cursorTime === null) setCursorTime(schedule.finish_date ?? currentFinishDate);
  }, [schedule.finish_date, currentFinishDate, cursorTime]);
```

- [ ] **Step 2: Attach the cursor in the once-effect (needs the container el)**

After the `VertLine` attaches:
```ts
    const cursor = new DraggableCursor(
      chart,
      {
        getTime: () => (cursorTimeRef.current as Time | null),
        setTime: (tm) => setCursorTime(String(tm)),
        color: '#fbbf24', // amber cursor
      },
      el, // the container element from `containerRef.current` at effect start
    );
    candle.attachPrimitive(cursor);
    cursorRef.current = cursor;
```
In cleanup, BEFORE `chart.remove()`:
```ts
      cursorRef.current?.destroy();
      cursorRef.current = null;
```

- [ ] **Step 3: Compute inverse + render readout row**

Near the other memos:
```ts
  const cursorReq = useMemo(
    () => (forecastInput && cursorTime ? requiredResource(forecastInput, cursorTime) : null),
    [forecastInput, cursorTime],
  );
```
Inside the same bottom-overlay container (Task A7 Step 2), after the scenario row, add:
```tsx
          {cursorTime && cursorReq && (
            <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-amber-300">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#fbbf24' }} />
              {t('projectChartsTab.fcRequired', {
                date: new Date(`${cursorTime}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { month: 'short', day: 'numeric' }),
                people: cursorReq.requiredPeople ?? '—',
                gain: cursorReq.requiredGain.toFixed(2),
              })}
            </div>
          )}
```
(`cursorReq` is already guarded by `forecastInput` in its memo; the row sits inside the `{forecastInput && (...)}` overlay.)

- [ ] **Step 4: Build + lint gates** → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/projects/components/ProjectChartsTab.tsx
git commit -m "feat(forecast): draggable cursor with inverse resource readout"
```

---

## Task C3: Phase-C verification

- [ ] **Step 1: Full build** — `cd frontend && npm run build` → PASS.
- [ ] **Step 2: Lint** all changed files → PASS.
- [ ] **Step 3: Adversarial review** over Phases B+C: slider/scenario reactivity, whitespace covering the later finish, cursor drag not fighting chart pan, pointer-listener cleanup (no leak across remounts), inverse math edge cases (cursor in the past). Fix confirmed findings.
- [ ] **Step 4: Visual check** — user confirms in browser: slider moves the fuchsia scenario line + updates its date; dragging the amber cursor updates "to finish by DATE → N people (X%/day)"; cursor in the past shows no row; chart pan still works when not grabbing the cursor.

---

## Deferred (out of scope for this plan)

- **Forecast-layer toggle chips** (spec §9 — show/hide Бодит явц · Одоогийн хурд · Scenario · Cursor). The bottom-overlay readout already labels and colour-codes each layer, and the existing indicator chips (trend/ma/channel/planned) cover the trading-style layers. Toggling the forecast lines is low-value polish; defer until requested. When added, reuse the existing `IndicatorChip` + `applyOptions({ visible })` visibility-effect pattern already in `ProjectChartsTab.tsx`.

---

## Final commit / deploy

- [ ] Frontend-only: user builds `frontend/dist/` and deploys to Cloudflare Pages. **No backend deploy, no migration.**
