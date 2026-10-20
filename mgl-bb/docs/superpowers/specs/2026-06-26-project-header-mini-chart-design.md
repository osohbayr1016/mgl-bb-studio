# Project header mini progress-chart + fullscreen enlarge — design

**Date:** 2026-06-26
**Status:** Approved (design), pending implementation plan

## Context

The project-detail hero header (`ProjectDetailPage.tsx`) has a row of three columns on wide
screens: `[key image 260px] [flex-1 title + badges] [TeamProgressPreview 320–360px] [kebab]`.
Because the title/badges rarely fill the `flex-1` column, a sizeable empty gap sits between the
title block and the team-progress bars (the user circled it in red). The user wants that gap to
show a **mini version of the project's progress graphic** — the single overall-progress chart that
currently lives only on the "Графикууд" (`ProjectChartsTab`) tab — with an **enlarge button** that
opens the chart's existing **fullscreen dashboard** (big chart + side panels).

Goal: surface the project's progress trend at a glance in the header, with one click to the full
analytical view, **without regressing first-paint performance** (we just removed heavy chunks from
the critical path — `lightweight-charts` must stay lazy).

## Requirements

1. A compact progress preview in the header's empty middle area, visible on wide screens, that
   hides/stacks on narrow screens so the header never crowds.
2. The preview shows the project's overall progress trend (a small sparkline) + the current `%`.
3. An enlarge ("томруулах") control on the preview.
4. Enlarge opens the **fullscreen charts dashboard** — the same layout `ProjectChartsTab` already
   renders in its fullscreen branch (overall chart + PaceSummary / Measure / Stats / Health /
   TeamWatchlist side panels), with a close control.
5. New user-facing strings exist in **both** `en.json` and `mn.json`.

Non-goals: no new backend endpoint; no changes to the chart's math; no redesign of the charts tab
itself; no change to the existing key-image slot.

## Architecture

Three units, each with one clear job:

### 1. `ProgressSparklinePreview` (new component)

- **What:** A cheap, dependency-light header widget. Renders an **SVG area sparkline** of the
  overall-progress series + the latest `%` + a `Maximize2` enlarge button. No `lightweight-charts`.
- **Data:** Reuses the existing charts timeseries query so it shares cache with the tab:
  `useApiQuery(['/projects', projectId, 'charts', '30d'], '/projects/:id/charts/timeseries?days=30')`.
  Reads only `data.overall` (`{ date, progress }[]`) for the sparkline; ignores the rest. While
  loading, renders a small skeleton; with <2 points or on error, renders a muted empty/placeholder
  state (no enlarge).
- **Props:** `{ projectId: number; onEnlarge: () => void }`.
- **Depends on:** `useApiQuery`, `useLanguage`, `ProjectChartsTimeseries` type, `Button`.
- **Why a sparkline, not the real chart:** mounting `LwProgressChart` in the always-rendered header
  would pull `lightweight-charts` (~57 KB gz) onto every project-detail load — a perf regression.
  The SVG sparkline is a faithful mini at near-zero cost.

### 2. `ProjectChartsTab` — reuse its fullscreen layout (small refactor)

- Add two optional props: `embeddedFullscreen?: boolean` and `onExitFullscreen?: () => void`.
- When `embeddedFullscreen` is true: render the **fullscreen dashboard branch unconditionally**
  (treat as `isFullscreen`), and make the top-right toggle button call `onExitFullscreen` (close the
  overlay) instead of the browser Fullscreen API. The tab's own browser-fullscreen button is
  unchanged for the in-tab case.
- This **reuses** the existing side-panel dashboard rather than duplicating it. ~a few lines:
  `const showDashboard = isFullscreen || embeddedFullscreen;` drives the layout branch; the button's
  onClick / icon switch on `embeddedFullscreen`.

### 3. `ProjectDetailPage` header — wire it together

- Render `<ProgressSparklinePreview projectId={id} onEnlarge={() => setChartsOverlayOpen(true)} />`
  as a fixed-width column (`~w-[200px] xl:w-[220px]`) between the `flex-1` title block and the
  `TeamProgressPreview`. Responsive: `hidden xl:flex` (or wrap) so narrow layouts are unaffected.
- Add `const [chartsOverlayOpen, setChartsOverlayOpen] = useState(false)`.
- When open, render a **full-viewport in-app overlay** (`fixed inset-0 z-50 bg-background overflow-auto`)
  containing a **lazily-imported** `ProjectChartsTab` with `embeddedFullscreen` and
  `onExitFullscreen={() => setChartsOverlayOpen(false)}`, plus an Esc-to-close handler. The lazy
  import keeps `lightweight-charts` out of the page until the user enlarges.

## Data flow

```
ProjectDetailPage (header)
  └─ ProgressSparklinePreview ──(useApiQuery, shared cache key)──> GET /projects/:id/charts/timeseries?days=30
        renders SVG sparkline from data.overall; click → onEnlarge()
  └─ chartsOverlayOpen && <Overlay>
        └─ <Suspense> lazy ProjectChartsTab embeddedFullscreen onExitFullscreen=close
              (lightweight-charts loads here, on demand)
```

## Error / edge handling

- Timeseries query error or <2 points → preview shows a muted placeholder, enlarge hidden (nothing
  to enlarge). Overlay still openable only when there is data.
- Overlay: close on button **and** Esc; restore scroll. Lazy-load fallback = small spinner.
- Visibility follows the charts tab (all project-visible roles); no extra gating.

## Performance

- Header stays light: only a cheap SVG + one **cached, shared** 30-day timeseries request (also
  pre-warms the Графикууд tab). `lightweight-charts` remains lazy — loaded only on enlarge.

## Testing / verification (no automated test suite in this repo)

1. `npm run build` (frontend) succeeds; `tsc -b` clean for the touched files.
2. Open a project detail page on a wide screen → mini sparkline + current % render in the header gap;
   network shows the `charts/timeseries?days=30` request is the cached/shared one.
3. Confirm `lightweight-charts` chunk is **not** loaded until enlarge (Network tab / `dist` modulepreload).
4. Click enlarge → full-viewport dashboard with side panels; close via button and via Esc.
5. Open the Графикууд tab separately → its own browser-fullscreen button still works unchanged.
6. Narrow/mobile width → preview hidden/stacked, header not crowded.
7. en + mn both show correct strings.

## Files

- `frontend/src/features/projects/components/ProgressSparklinePreview.tsx` (new)
- `frontend/src/features/projects/ProjectDetailPage.tsx` (header column + overlay state)
- `frontend/src/features/projects/components/ProjectChartsTab.tsx` (`embeddedFullscreen` props)
- `frontend/src/shared/i18n/en.json`, `frontend/src/shared/i18n/mn.json` (new keys)
