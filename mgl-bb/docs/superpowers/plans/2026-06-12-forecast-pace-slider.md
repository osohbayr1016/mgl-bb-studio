# Forecast Pace-Slider (%/day) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project-charts forecast **headcount slider** ("Хүний тоо", N people) with a **daily-pace slider** (%/өдөр) so the scenario forecast is driven directly by "how many % of completion per day" instead of a shaky people→speed conversion.

**Architecture:** Add one pure function `forecastFinishFromGain(input, gainPerDay)` to the existing `forecast.ts` (mirrors `forecastFinish` but takes the daily gain straight). Rename `HeadcountSlider` → `PaceSlider` in `ForecastControls.tsx`. In `ProjectChartsTab.tsx`, swap the `scenarioN` (people) state for `scenarioGain` (%/day, default = current real pace) and re-point the scenario line + readout rows at it. The cyan "current pace" line, candlesticks, draggable cursor and measure cursors are untouched — only the scenario *driver* changes. The draggable cursor already computes `requiredGain` (%/day), so its readout just drops the "people" half.

**Tech Stack:** React 19, TypeScript (strict, `noUncheckedIndexedAccess`), lightweight-charts v5, TanStack Query, Vite. **No test runner in this repo** — verification is `npm run build` (tsc -b) + `npx eslint <file>` + worked `// EXPECT:` comments + a browser check. Do NOT invent `npm test`.

**Spec:** `docs/superpowers/specs/2026-06-12-forecast-pace-slider-design.md`

---

## Verification note (read first)

This repo has **no test suite** (see CLAUDE.md). Wherever a normal plan would say "write a failing test", this plan substitutes:

1. **Type/build gate:** `cd frontend && npm run build` — `tsc -b` is the type checker; it must pass (only count errors in files this plan touches; the tree may hold other agents' unrelated WIP — see CLAUDE.md).
2. **Lint gate:** `cd frontend && npx eslint <changed files>` — must pass.
3. **Math gate (`forecast.ts` only):** worked numeric examples are embedded as `// EXPECT:` comments; sanity-check them by eye.
4. **Visual gate:** the user builds `frontend/dist/` and confirms in the browser (frontend-only feature).

Commit after each task. **Frontend-only: no backend deploy, no migration.** When staging, add only the exact files each task lists — the working tree currently holds another agent's staged migration rename and unstaged `backend/src/routes/attendance.ts`; do **not** sweep them in (`git add <exact paths>`, never `git add .`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `frontend/src/features/projects/lib/forecast.ts` | Pure forecast math | **Add** `forecastFinishFromGain`. Everything else unchanged. |
| `frontend/src/shared/i18n/mn.json`, `en.json` | i18n dictionaries | **Add** `fcPaceLabel`/`fcPaceValue`; **edit** `fcRequired`; **remove** `fcPeopleLabel`. |
| `frontend/src/features/projects/components/ForecastControls.tsx` | Slider + readout widgets | **Replace** `HeadcountSlider` with `PaceSlider`. |
| `frontend/src/features/projects/components/ProjectChartsTab.tsx` | Charts tab wiring | Swap `scenarioN`→`scenarioGain`; re-point scenario line + readout rows; render `PaceSlider`. |

---

## Task 1: Add `forecastFinishFromGain` to forecast.ts

**Files:**
- Modify: `frontend/src/features/projects/lib/forecast.ts`

- [ ] **Step 1: Append the new pure function**

Add at the END of `frontend/src/features/projects/lib/forecast.ts` (after `buildForecastInput`, the file's last function):

```ts
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
```

> Note: `forecastFinish`, `perPersonGain`, `recentAvgHeadcount`, `requiredResource` and the `ForecastInput`/`ScenarioForecast`/`RequiredResource` interfaces stay exactly as they are — the cyan "current pace" line and the cursor still use them.

- [ ] **Step 2: Build gate** — `cd frontend && npm run build` → PASS (no new type errors). The function is unused so far — fine.

- [ ] **Step 3: Lint gate** — `cd frontend && npx eslint src/features/projects/lib/forecast.ts` → PASS (clean).

- [ ] **Step 4: Eyeball the EXPECT comments** — confirm by hand the three `// EXPECT:` lines hold. If any is wrong, fix the function before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/projects/lib/forecast.ts
git commit -m "feat(forecast): forecastFinishFromGain — daily-pace scenario math"
```

---

## Task 2: i18n keys (mn + en, both dictionaries)

**Files:**
- Modify: `frontend/src/shared/i18n/mn.json`
- Modify: `frontend/src/shared/i18n/en.json`

- [ ] **Step 1: Edit mn.json**

In `frontend/src/shared/i18n/mn.json`:

1. **Remove** this line (the old slider label, now unused):
```json
  "projectChartsTab.fcPeopleLabel": "Хүний тоо",
```

2. **Replace** the `fcRequired` line:
```json
  "projectChartsTab.fcRequired": "{date}-д дуусгахад: {people} хүн ({gain}%/өдөр)",
```
with:
```json
  "projectChartsTab.fcRequired": "{date}-д дуусгахад: {gain}%/өдөр",
```

3. **Add** these two keys immediately after the `"projectChartsTab.fcPeople": "{count} хүн",` line:
```json
  "projectChartsTab.fcPaceLabel": "Өдрийн хурд",
  "projectChartsTab.fcPaceValue": "{gain}%/өдөр",
```

> Keep `"projectChartsTab.fcPeople": "{count} хүн",` — it is still used by the "Өнөөдөр N хүн" headcount readout (`hcToday`), unrelated to the slider.

- [ ] **Step 2: Edit en.json (the SAME structural changes)**

In `frontend/src/shared/i18n/en.json`:

1. **Remove**:
```json
  "projectChartsTab.fcPeopleLabel": "People",
```

2. **Replace** the `fcRequired` line:
```json
  "projectChartsTab.fcRequired": "To finish by {date}: {people} people ({gain}%/day)",
```
with:
```json
  "projectChartsTab.fcRequired": "To finish by {date}: {gain}%/day",
```

3. **Add** after `"projectChartsTab.fcPeople": "{count} people",`:
```json
  "projectChartsTab.fcPaceLabel": "Daily pace",
  "projectChartsTab.fcPaceValue": "{gain}%/day",
```

- [ ] **Step 3: Build gate** — `cd frontend && npm run build` → PASS (JSON must stay valid; a trailing-comma or dup-key slip fails the build).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/i18n/mn.json frontend/src/shared/i18n/en.json
git commit -m "i18n(forecast): pace-slider keys; drop fcPeopleLabel (mn + en)"
```

---

## Task 3: Replace HeadcountSlider with PaceSlider

**Files:**
- Modify: `frontend/src/features/projects/components/ForecastControls.tsx`

- [ ] **Step 1: Replace the `HeadcountSlider` export**

In `frontend/src/features/projects/components/ForecastControls.tsx`, replace the entire `HeadcountSlider` function (currently lines ~65–91) with:

```tsx
export function PaceSlider({
  value,
  onChange,
  max = 5,
}: {
  value: number;
  onChange: (gainPerDay: number) => void;
  max?: number;
}) {
  const { t } = useLanguage();
  return (
    <label className="pointer-events-auto flex items-center gap-2 text-[11px] text-slate-300">
      <span className="shrink-0">{t('projectChartsTab.fcPaceLabel')}</span>
      <input
        type="range"
        min={0.05}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-40 cursor-pointer accent-fuchsia-400"
      />
      <span className="w-16 shrink-0 tabular-nums text-slate-100">
        {t('projectChartsTab.fcPaceValue', { gain: value.toFixed(2) })}
      </span>
    </label>
  );
}
```

> `ForecastReadout` and `VarianceTag` above it are unchanged. The fuchsia accent stays so the slider colour still matches the fuchsia scenario line.

- [ ] **Step 2: Build gate** — `cd frontend && npm run build` → will report an error in `ProjectChartsTab.tsx` because it still imports `HeadcountSlider`. That import is fixed in Task 4. Confirm the **only** errors are the `HeadcountSlider` import/usage in `ProjectChartsTab.tsx` (this file itself compiles clean). If so, proceed.

- [ ] **Step 3: Lint gate** — `cd frontend && npx eslint src/features/projects/components/ForecastControls.tsx` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/projects/components/ForecastControls.tsx
git commit -m "feat(forecast): PaceSlider (%/day) replaces HeadcountSlider"
```

---

## Task 4: Wire `scenarioGain` into ProjectChartsTab

**Files:**
- Modify: `frontend/src/features/projects/components/ProjectChartsTab.tsx`

- [ ] **Step 1: Update the two imports**

Change the forecast import line (currently):
```ts
import { buildForecastInput, forecastFinish, requiredResource, workingDaysBetween, recentAvgHeadcount, addWorkingDays } from '@/features/projects/lib/forecast';
```
to add `forecastFinishFromGain`:
```ts
import { buildForecastInput, forecastFinish, forecastFinishFromGain, requiredResource, workingDaysBetween, recentAvgHeadcount, addWorkingDays } from '@/features/projects/lib/forecast';
```

Change the controls import line (currently):
```ts
import { ForecastReadout, HeadcountSlider } from '@/features/projects/components/ForecastControls';
```
to:
```ts
import { ForecastReadout, PaceSlider } from '@/features/projects/components/ForecastControls';
```

- [ ] **Step 2: Swap the scenario state + finish memo**

Replace this block (currently lines ~763–771):
```ts
  const [scenarioN, setScenarioN] = useState<number>(0); // 0 = uninitialised
  useEffect(() => {
    if (scenarioN === 0 && forecastInput) setScenarioN(Math.max(1, Math.round(forecastInput.currentPeople)));
  }, [forecastInput, scenarioN]);

  const scenarioFinish = useMemo(
    () => (forecastInput && scenarioN > 0 ? forecastFinish(forecastInput, scenarioN) : null),
    [forecastInput, scenarioN],
  );
```
with:
```ts
  const [scenarioGain, setScenarioGain] = useState<number>(0); // 0 = uninitialised
  useEffect(() => {
    if (scenarioGain === 0 && forecastInput) {
      // Default the slider to the current real pace (avgGain), snapped to the
      // 0.05 step and clamped to the slider's [0.05, 5] range.
      const snapped = Math.round(forecastInput.avgGain / 0.05) * 0.05;
      setScenarioGain(Math.min(5, Math.max(0.05, snapped)));
    }
  }, [forecastInput, scenarioGain]);

  const scenarioFinish = useMemo(
    () => (forecastInput && scenarioGain > 0 ? forecastFinishFromGain(forecastInput, scenarioGain) : null),
    [forecastInput, scenarioGain],
  );
```

> `forecastFinish` stays imported and used by `currentPaceFinish` just above this block — do not remove it.

- [ ] **Step 3: Render `PaceSlider` instead of `HeadcountSlider`**

Replace (currently line ~1271):
```tsx
          <HeadcountSlider value={Math.max(1, scenarioN)} onChange={setScenarioN} />
```
with:
```tsx
          <PaceSlider value={scenarioGain} onChange={setScenarioGain} />
```

- [ ] **Step 4: Update the scenario readout row to show %/day**

In the scenario row (currently lines ~1272–1278), replace the `fcPeople` interpolation. Change this line:
```tsx
              {t('projectChartsTab.fcScenario')}: {t('projectChartsTab.fcPeople', { count: scenarioN })} →{' '}
```
to:
```tsx
              {t('projectChartsTab.fcScenario')}: {t('projectChartsTab.fcPaceValue', { gain: scenarioGain.toFixed(2) })} →{' '}
```
(The surrounding `{scenarioFinish?.finishDate && (...)}` wrapper and the date `<span>` are unchanged.)

- [ ] **Step 5: Drop "people" from the cursor readout row**

In the cursor row (currently lines ~1279–1288), remove the `people` field from the `fcRequired` interpolation. Change:
```tsx
              {t('projectChartsTab.fcRequired', {
                date: new Date(`${cursorTime}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { month: 'short', day: 'numeric' }),
                people: cursorReq.requiredPeople ?? '—',
                gain: cursorReq.requiredGain.toFixed(2),
              })}
```
to:
```tsx
              {t('projectChartsTab.fcRequired', {
                date: new Date(`${cursorTime}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { month: 'short', day: 'numeric' }),
                gain: cursorReq.requiredGain.toFixed(2),
              })}
```

> `cursorReq` (from `requiredResource`) still computes `requiredPeople` internally — we simply stop rendering it. No change to `forecast.ts`.

- [ ] **Step 6: Build gate** — `cd frontend && npm run build` → PASS. If `tsc` reports errors only in files this plan never touched, that's another agent's WIP (CLAUDE.md) — confirm none are in `ProjectChartsTab.tsx`/`ForecastControls.tsx`/`forecast.ts`/the i18n JSON, then proceed.

- [ ] **Step 7: Lint gate** — `cd frontend && npx eslint src/features/projects/components/ProjectChartsTab.tsx` → PASS. (If it flags `scenarioN`/`HeadcountSlider` as undefined, a replacement above was missed — fix it. No forecast import should go unused: `forecastFinish` powers `currentPaceFinish`, `recentAvgHeadcount` powers the headcount readout.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/projects/components/ProjectChartsTab.tsx
git commit -m "feat(forecast): scenario driven by %/day pace instead of headcount"
```

---

## Task 5: Verification

- [ ] **Step 1: Full build** — `cd frontend && npm run build` → PASS (errors only in unrelated, untouched files are acceptable per CLAUDE.md; none in the four files above).

- [ ] **Step 2: Lint all changed files** —
```bash
cd frontend && npx eslint src/features/projects/lib/forecast.ts src/features/projects/components/ForecastControls.tsx src/features/projects/components/ProjectChartsTab.tsx
```
→ PASS.

- [ ] **Step 3: Adversarial review** — run a `/code-review`-style review over the diff. Focus: the default-pace snap/clamp math (`avgGain=0` → 0.05; large `avgGain` → capped at 5), the `gainPerDay <= 0` branch hiding the scenario line/row cleanly, i18n parity (`fcPaceLabel`/`fcPaceValue`/`fcRequired` present and consistent in both mn + en, no leftover `{people}` placeholder, `fcPeopleLabel` removed from both), and that no leftover `scenarioN`/`HeadcountSlider`/`fcPeople`-as-slider references remain. Fix confirmed findings.

- [ ] **Step 4: Visual check (user)** — build `frontend/dist/`, open a project's «Графикууд» tab and confirm:
  - The slider now reads **"Өдрийн хурд … X.XX%/өдөр"** (no more "Хүний тоо / N хүн").
  - Default slider position equals the project's current pace; the fuchsia scenario line initially overlaps the cyan current-pace line, and dragging faster/slower moves the scenario finish date.
  - Scenario row reads "Хувилбар: X.XX%/өдөр → <date>".
  - Dragging the amber cursor shows "<date>-д дуусгахад: Y.YY%/өдөр" (no people).
  - On a stalled project (`avgGain ≈ 0`) the slider sits at 0.05 and the cyan "current pace" line still shows "Тооцох боломжгүй".

---

## Final deploy

- [ ] Frontend-only: user builds `frontend/dist/` and deploys to Cloudflare Pages. **No backend deploy, no migration.**
