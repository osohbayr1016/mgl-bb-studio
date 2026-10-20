# Project header ЯВЦ mini-chart — TradingView equal-pair resize — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resize and restyle the project-header "ЯВЦ" mini progress chart so it reads as an equal-width, equal-height TradingView-style partner of the "БАГУУДЫН ЯВЦ" team card, keeping click-to-enlarge into the full charts dashboard.

**Architecture:** Two frontend files. `ProgressSparklinePreview.tsx` is redesigned from a fixed-78px SVG sparkline into a full-height SVG area chart (gradient, gridlines, trend colour, window-change chip, right-edge last-value tag) — still a cheap SVG, no `lightweight-charts`. `ProjectDetailPage.tsx` wraps the chart card and the team card in an `items-stretch` flex group so they become an equal-width, equal-height pair on `xl`, and `TeamProgressPreview` gets `h-full` to fill the stretched height.

**Tech Stack:** React 19, TypeScript (strict), Tailwind, lucide-react, TanStack Query (existing `useApiQuery`). No new deps.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-project-header-mini-chart-tradingview-resize-design.md` (committed `6c7255b`).
- `lightweight-charts` MUST stay lazy — it may NOT be imported by `ProgressSparklinePreview.tsx` (header is always rendered; importing it is a first-paint regression).
- No new i18n strings — reuse `projectDetailPage.progressMiniTitle`, `projectDetailPage.enlargeChart`, `projectDetailPage.progressMiniEmpty`.
- No backend changes; no change to chart math; the data query key stays byte-identical so the cache stays shared with `ProjectChartsTab` (`['/projects', projectId, 'charts', '30d']`, `/projects/:id/charts/timeseries?days=30`).
- TypeScript strict (`noUncheckedIndexedAccess` on in backend; frontend strict). No `any`.
- **Concurrency:** the working tree holds other agents' uncommitted WIP. `ProjectDetailPage.tsx` already has ONE unrelated change at ~line 3811 (`ActivityTab`) — far from the header (lines ~1133-1145, ~1848). Do NOT touch or commit that change. `ProgressSparklinePreview.tsx` is currently unmodified (clean). Verify builds by confirming errors (if any) do NOT reference the two touched files (`npx tsc -b --force` compiles the whole app and may surface unrelated WIP errors that are not ours).

---

### Task 1: Redesign `ProgressSparklinePreview.tsx` into a height-filling TradingView mini

**Files:**
- Modify (full rewrite): `frontend/src/features/projects/components/ProgressSparklinePreview.tsx`

**Interfaces:**
- Consumes: `useApiQuery`, `useLanguage`, `cn` (`@/shared/lib/utils`), `ProjectChartsTimeseries` type, lucide `Maximize2 / TrendingUp / TrendingDown / Minus`.
- Produces: default export `ProgressSparklinePreview({ projectId: number; onEnlarge: () => void })` — UNCHANGED public signature (so `ProjectDetailPage` keeps calling it the same way). Internal helper `buildSpark(series: { progress: number }[]): { line: string; area: string; lastY: number } | null` (renamed from `buildSparkPath`; now also returns `lastY` = the final point's y as a 0–100 viewBox-% so the HTML tag pins to the path's endpoint).

- [ ] **Step 1: Replace the whole file with the new implementation**

Overwrite `frontend/src/features/projects/components/ProgressSparklinePreview.tsx` with:

```tsx
import { useMemo } from 'react';
import { Maximize2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { ProjectChartsTimeseries } from '@/shared/types';

/**
 * ProgressSparklinePreview — a compact, dependency-light header widget that
 * shows the project's overall-progress trend at a glance and enlarges into the
 * full "Графикууд" dashboard on click.
 *
 * It deliberately renders a cheap hand-rolled SVG area chart rather than
 * mounting `lightweight-charts` (the real chart, ~57KB gz) so the
 * always-rendered project header stays light — the heavy chart only loads when
 * the user enlarges. The data reuses the SAME cached query key as
 * ProjectChartsTab's 30-day window, so this adds at most one shared request and
 * pre-warms the Графикууд tab.
 *
 * Sized to fill its column so it reads as an equal partner of the team-progress
 * card next to it (both stretch to the same height in the header). TradingView
 * touches: gradient area, faint gridlines, a trend-coloured line, a
 * window-change figure and a right-edge last-value tag.
 */
export default function ProgressSparklinePreview({
  projectId,
  onEnlarge,
}: {
  projectId: number;
  onEnlarge: () => void;
}) {
  const { t } = useLanguage();
  // Mirror ProjectChartsTab's default 30-day query EXACTLY so the cache entry
  // is shared between this preview and the tab.
  const { data, isError } = useApiQuery<ProjectChartsTimeseries>(
    ['/projects', projectId, 'charts', '30d'],
    `/projects/${projectId}/charts/timeseries?days=30`,
  );

  const series = data?.overall ?? [];
  const latest = series.length ? series[series.length - 1]!.progress : 0;
  const first = series.length ? series[0]!.progress : 0;
  const delta = latest - first;
  const spark = useMemo(() => buildSpark(series), [series]);

  // Trend over the visible window drives the chart colour (line + area + dot)
  // and the change chip — green up / red down / brand-primary flat, matching
  // ProjectChartsTab's trend palette.
  const trend = delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat';
  const trendColor =
    trend === 'up' ? 'text-emerald-500' : trend === 'down' ? 'text-red-500' : 'text-primary';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  // Loading — full-height skeleton that matches the loaded card's footprint.
  if (!data && !isError) {
    return (
      <div className="h-full min-h-[150px] w-full animate-pulse rounded-lg border border-border/60 bg-card/40" />
    );
  }

  // Nothing to chart yet → muted placeholder, no enlarge affordance.
  if (series.length < 2 || !spark) {
    return (
      <div className="flex h-full min-h-[150px] w-full flex-col justify-center rounded-lg border border-border/60 bg-card/40 px-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-3 w-3" /> {t('projectDetailPage.progressMiniTitle')}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t('projectDetailPage.progressMiniEmpty')}
        </div>
      </div>
    );
  }

  // Unique gradient id per project so multiple charts on a page never collide.
  const gradientId = `spark-grad-${projectId}`;

  return (
    <button
      type="button"
      onClick={onEnlarge}
      title={t('projectDetailPage.enlargeChart')}
      aria-label={t('projectDetailPage.enlargeChart')}
      className={cn(
        'group relative flex h-full min-h-[150px] w-full flex-col rounded-lg border border-border/60 bg-card/70 p-3 text-left backdrop-blur transition-colors hover:border-primary/40 hover:bg-card/80',
        trendColor,
      )}
    >
      {/* Header strip: title + enlarge affordance */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-3 w-3" /> {t('projectDetailPage.progressMiniTitle')}
        </span>
        <Maximize2 className="h-3.5 w-3.5 text-muted-foreground opacity-60 transition group-hover:text-primary group-hover:opacity-100" />
      </div>

      {/* Headline % + window-change chip */}
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold leading-none tabular-nums text-foreground">
          {latest.toFixed(1)}%
        </span>
        <span
          className={cn(
            'flex items-center gap-0.5 text-[11px] font-semibold tabular-nums',
            trendColor,
          )}
        >
          <TrendIcon className="h-3 w-3" />
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}
        </span>
      </div>

      {/* Chart area — fills the rest of the stretched card */}
      <div className="relative mt-2 min-h-0 flex-1">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {/* Faint gridlines — neutral border colour, NOT trend-tinted. */}
          {[25, 50, 75].map((gy) => (
            <line
              key={gy}
              x1="0"
              y1={gy}
              x2="100"
              y2={gy}
              style={{ stroke: 'hsl(var(--border))', strokeOpacity: 0.4 }}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={spark.area} fill={`url(#${gradientId})`} />
          <path
            d={spark.line}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Right-edge last-value tag (TradingView price label) pinned at the
            line's endpoint height. The leading dot inherits the trend colour. */}
        <div
          className={cn(
            'pointer-events-none absolute right-0 flex -translate-y-1/2 items-center gap-1 rounded-sm border border-border/60 bg-background/85 px-1 py-0.5 text-[9px] font-semibold tabular-nums',
            trendColor,
          )}
          style={{ top: `${spark.lastY}%` }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'currentColor' }} />
          <span className="text-foreground">{latest.toFixed(1)}%</span>
        </div>
      </div>
    </button>
  );
}

/**
 * Build the sparkline `line` (open polyline) + `area` (filled to the baseline)
 * SVG path strings in a 100×100 viewBox, plus `lastY` — the final point's y as
 * a percentage of the viewBox height (0 = top, 100 = bottom) so the HTML
 * last-value tag can be pinned to the exact height the path ends at. The y-axis
 * is scaled to the window's own min/max (with padding) so a small late-stage
 * gain still reads as a visible slope rather than a flat line near the middle.
 */
function buildSpark(
  series: { progress: number }[],
): { line: string; area: string; lastY: number } | null {
  const n = series.length;
  if (n < 2) return null;
  const W = 100;
  const H = 100;
  const PAD = 8; // top/bottom breathing room inside the viewBox
  let min = Infinity;
  let max = -Infinity;
  for (const p of series) {
    if (p.progress < min) min = p.progress;
    if (p.progress > max) max = p.progress;
  }
  const span = max - min || 1; // flat series → centre the line
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  let line = '';
  for (let i = 0; i < n; i++) {
    line += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(series[i]!.progress).toFixed(2)}`;
  }
  const area = `${line}L${W},${H}L0,${H}Z`;
  const lastY = y(series[n - 1]!.progress);
  return { line, area, lastY };
}
```

- [ ] **Step 2: Typecheck the touched file is clean**

Run (from `frontend/`): `npx tsc -b --force 2>&1 | grep -E "ProgressSparklinePreview"`
Expected: **empty output** (no type errors referencing this file). Unrelated WIP errors in other files are NOT ours — ignore them (see Global Constraints).

- [ ] **Step 3: Commit (isolated, clean file — normal add is safe)**

This file had no prior WIP, so a plain add stages only our change.

```bash
git add -- frontend/src/features/projects/components/ProgressSparklinePreview.tsx
git commit -m "feat(projects): TradingView-style height-filling YAVTS mini chart" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- frontend/src/features/projects/components/ProgressSparklinePreview.tsx
```

Verify only that file is in the commit: `git show --stat --oneline HEAD | head -5` → 1 file changed.

---

### Task 2: Header equal-pair wrapper + `TeamProgressPreview` `h-full`

**Files:**
- Modify: `frontend/src/features/projects/ProjectDetailPage.tsx` (header columns ~1133-1145; `TeamProgressPreview` root ~1848)

**Interfaces:**
- Consumes: `ProgressSparklinePreview` (Task 1, unchanged signature), `TeamProgressPreview` (same file).
- Produces: nothing new — layout-only change.

> **Commit safety:** `ProjectDetailPage.tsx` holds another agent's unrelated 1-line WIP at ~line 3811. We stash that file's WIP, make our edits on the clean (HEAD) version, commit only our edits, then pop the WIP back. Steps 1 & 7 handle this.

- [ ] **Step 1: Stash the file's existing (other-agent) WIP so our commit stays clean**

```bash
git stash push -m "wip-not-ours-ProjectDetailPage" -- frontend/src/features/projects/ProjectDetailPage.tsx
git status --short -- frontend/src/features/projects/ProjectDetailPage.tsx
```
Expected: the file no longer appears as modified (reverted to HEAD; the WIP is safely stashed). The header region (lines ~1133-1145) is identical in HEAD and the prior working tree, so our edits below still match.

- [ ] **Step 2: Replace the two sibling columns with an equal-pair stretch wrapper**

In `frontend/src/features/projects/ProjectDetailPage.tsx`, find:

```tsx
            {/* Mini overall-progress preview — fills the otherwise-empty gap
                between the title block and the team bars on wide screens.
                Click enlarges into the full Графикууд dashboard overlay. */}
            <div className="hidden xl:block w-[210px] shrink-0">
              <ProgressSparklinePreview
                projectId={Number(id)}
                onEnlarge={() => setChartsOverlayOpen(true)}
              />
            </div>

            <div className="w-full lg:w-[320px] xl:w-[360px] shrink-0">
              <TeamProgressPreview teams={teamProgress} projectProgress={data.project.progress} />
            </div>
```

Replace with:

```tsx
            {/* Overall-progress mini chart + team progress as an equal-width,
                equal-height pair on wide screens. `items-stretch` makes both
                cards match the taller one's height; the chart fills its column.
                Below xl the chart hides so the header never crowds. Clicking the
                chart enlarges into the full Графикууд dashboard overlay. */}
            <div className="flex w-full items-stretch gap-3 lg:w-auto lg:shrink-0">
              <div className="hidden xl:block xl:w-[300px] 2xl:w-[340px]">
                <ProgressSparklinePreview
                  projectId={Number(id)}
                  onEnlarge={() => setChartsOverlayOpen(true)}
                />
              </div>
              <div className="w-full lg:w-[300px] 2xl:w-[340px]">
                <TeamProgressPreview teams={teamProgress} projectProgress={data.project.progress} />
              </div>
            </div>
```

- [ ] **Step 3: Give `TeamProgressPreview` `h-full` so it fills the stretched column**

In the same file, find the `TeamProgressPreview` root div:

```tsx
    <div className="min-h-[112px] rounded-lg border border-border/60 bg-card/70 backdrop-blur px-3 py-2 overflow-hidden">
```

Replace with (add `h-full` at the front):

```tsx
    <div className="h-full min-h-[112px] rounded-lg border border-border/60 bg-card/70 backdrop-blur px-3 py-2 overflow-hidden">
```

- [ ] **Step 4: Typecheck the touched file is clean**

Run (from `frontend/`): `npx tsc -b --force 2>&1 | grep -E "ProjectDetailPage"`
Expected: **empty output** (no type errors referencing this file). Unrelated WIP errors elsewhere are not ours.

- [ ] **Step 5: Full frontend build sanity (optional, may surface unrelated WIP errors)**

Run (from `frontend/`): `npx vite build` (skips typecheck) — expected to succeed; confirms the JSX/Tailwind change is valid. If `npm run build` is run instead and fails, confirm the failure references only unrelated WIP files, not our two.

- [ ] **Step 6: Commit only our edits (WIP is stashed, so a plain add is clean)**

```bash
git add -- frontend/src/features/projects/ProjectDetailPage.tsx
git commit -m "feat(projects): equal-pair header layout for YAVTS chart + team card" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- frontend/src/features/projects/ProjectDetailPage.tsx
```

Verify: `git show --oneline -U0 HEAD -- frontend/src/features/projects/ProjectDetailPage.tsx` shows ONLY the header + `TeamProgressPreview` hunks — NO line-3811 change.

- [ ] **Step 7: Restore the other agent's WIP**

```bash
git stash pop
git status --short -- frontend/src/features/projects/ProjectDetailPage.tsx
```
Expected: pop applies cleanly (our edits and the 3811 WIP don't overlap); the file shows as modified again, now carrying ONLY the other agent's 1-line WIP on top of our committed version. If `git stash pop` reports a conflict, STOP and surface to the user — do not force-resolve another agent's change.

---

## Verification (manual — no automated test suite)

1. `git log --oneline -3` shows the two feature commits (chart redesign, header layout) above the spec commit.
2. `git status` shows the other agent's `ProjectDetailPage.tsx` 1-line WIP restored and untouched.
3. Build the frontend (`npm run build` from `frontend/`); confirm any failure is unrelated WIP, not our files. Produce `dist/` for the user's manual Pages deploy (per the user's deploy preference — frontend dist deploy is manual).
4. On a wide (`xl` ≥1280px) project-detail page: the ЯВЦ chart and БАГУУДЫН ЯВЦ render as equal-width, equal-height cards; the chart shows gradient area, faint gridlines, trend colour (green/red/primary), a headline `%` + signed window-change chip, and a right-edge last-value tag at the line's end.
5. Click the chart → full-viewport TradingView dashboard opens; Network shows `lightweight-charts` loads only on this click, not on initial page load.
6. `lg`/mobile width → chart hidden, only the team card shows; header not crowded.
7. Light + dark theme both read correctly.
