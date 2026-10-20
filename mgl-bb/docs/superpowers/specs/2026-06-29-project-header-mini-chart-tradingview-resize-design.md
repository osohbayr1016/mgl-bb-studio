# Project header mini progress-chart — TradingView resize to equal-pair — design

**Date:** 2026-06-29
**Status:** Approved (design), pending implementation plan

## Context

The project-detail hero header (`ProjectDetailPage.tsx`) renders, on wide screens, a row of:
`[key image 260px] [flex-1 title + badges] [ProgressSparklinePreview 210px] [TeamProgressPreview 320–360px] [kebab]`.

The `ProgressSparklinePreview` ("ЯВЦ") is a small (~78px tall) cheap SVG sparkline that, on click,
enlarges into the existing full-viewport **TradingView dashboard** (`ProjectChartsTab embeddedFullscreen`,
real `lightweight-charts`). The `TeamProgressPreview` ("БАГУУДЫН ЯВЦ") next to it is much taller —
it grows one row per active team (~160px+ with 7 teams) and wider (360px).

The user wants the ЯВЦ chart to read as an **equal partner** of the team card — **same width and
same height**, a balanced pair — and to look more like a TradingView panel, while keeping the
click-to-enlarge into the full chart ("томрод ороод хардаг").

Two product decisions were made up front:
1. **Render approach:** keep the cheap SVG (enhanced) — NOT a real `lightweight-charts` mini in the
   header. Rationale: mounting `lightweight-charts` (~57 KB gz) in the always-rendered header is a
   first-paint regression the prior design (`2026-06-26-project-header-mini-chart-design.md`)
   deliberately avoided. The SVG gets a TradingView look at near-zero cost.
2. **Layout:** an **equal pair** — both cards the same width and height side by side.

Goal: surface the progress trend as a prominent, TradingView-styled card matched in size to the team
card, **without regressing first paint** (`lightweight-charts` stays lazy, loaded only on enlarge).

## Requirements

1. On wide (`xl`) screens, the ЯВЦ chart card and the БАГУУДЫН ЯВЦ card render as a balanced pair:
   **equal width** and **equal height** (height driven by whichever card's content is taller — the
   chart fills the stretched height).
2. The chart card is redesigned to fill its (now taller) height with a TradingView-style area chart:
   gradient area fill, faint horizontal gridlines, trend-colored line/area (up = green, down = red,
   flat = primary), a last-point dot + a right-edge current-% tag, and a signed window-change figure
   (`latest − first`, e.g. `▲ +2.3`) next to the headline %.
3. Click-to-enlarge into the full `ProjectChartsTab` dashboard is **unchanged**.
4. Responsive: below `xl`, the chart card stays hidden (current behavior) so the header never crowds;
   the team card alone shows on `lg`/mobile.
5. No new backend endpoint; no change to chart math; `lightweight-charts` stays lazy.
6. No new user-facing strings required — reuse existing keys
   (`projectDetailPage.progressMiniTitle`, `projectDetailPage.enlargeChart`,
   `projectDetailPage.progressMiniEmpty`). The window-change is a colored arrow + number, no words.

Non-goals: no redesign of the team card's contents; no redesign of the full charts tab; no change to
the key-image slot; no real interactive chart in the header.

## Architecture

Three small, well-bounded changes:

### 1. `ProgressSparklinePreview.tsx` — redesign to a height-filling TradingView mini

- **Shape:** the root `<button>` becomes a full-height flex column (`flex h-full w-full flex-col`)
  with a min-height floor (`min-h-[150px]`) so it always reads as a chart even when the team card is
  short. Card styling aligned to the team card (`bg-card/70 backdrop-blur border-border/60 rounded-lg`).
- **Header strip:** `▴ ЯВЦ` label (uppercase, muted) + `Maximize2` enlarge affordance (top-right).
- **Headline:** big latest `%` (`latest.toFixed(1)%`) + a small **window-change chip** showing the
  signed delta `latest − first` as a number with an up/down arrow (e.g. `▲ +2.3`), colored
  emerald/red/muted — no unit word (the arrow + color carry the meaning; avoids an ambiguous "pp"
  label and any new i18n string). Reuses the trend-color palette used by `ProjectChartsTab`
  (`text-emerald-500 / text-red-500 / text-muted-foreground`) for cross-component consistency.
- **Chart area (`relative flex-1 min-h-0`):**
  - An `<svg absolute inset-0 preserveAspectRatio="none" viewBox="0 0 100 100">` that stretches to
    fill. Because `preserveAspectRatio="none"`, viewBox fractions map to container fractions, so
    overlays and gridlines align at any pixel height. Strokes use `vectorEffect="non-scaling-stroke"`.
  - `<defs><linearGradient>` top→bottom fade of `currentColor`; the area path is filled with it.
  - Faint horizontal gridlines at y = 25/50/75 (viewBox units) using the border token color.
  - Line + area paths from the existing `buildSparkPath` (unchanged math: min/max-scaled to the
    window so small late-stage gains still slope).
  - A last-point dot (small circle at the final point) — drawn in SVG using the same y-mapping.
  - **Trend color:** the whole chart's `currentColor` is set on the root by a class derived from
    `latest − first`: up → emerald, down → red, flat → primary (so line, area-gradient, and dot all
    inherit it).
  - **Right-edge current-% tag:** an absolutely-positioned HTML pill at
    `top: <yFraction of latest>%`, `right: 0`, showing `latest.toFixed(1)%` — the TradingView
    last-price label. `yFraction` is computed with the SAME min/max mapping `buildSparkPath` uses,
    factored into a tiny shared helper so the tag and the SVG never drift.
- **Loading / empty states:** keep the existing logic, only swap the fixed `h-[78px]` for `h-full`
  (+ the `min-h-[150px]` floor) so they fill the stretched card. Empty/error still hides the enlarge
  affordance (nothing to enlarge), unchanged.
- **Props unchanged:** `{ projectId: number; onEnlarge: () => void }`. Data query unchanged (shared
  cache key with the charts tab).

`buildSparkPath` is refactored slightly to also expose the per-point y-mapping (or a sibling helper
`sparkYFraction(value, min, max)`) so the last-value tag's vertical position is derived from the same
min/max/padding as the path — single source of truth for the geometry.

### 2. `ProjectDetailPage.tsx` — header equal-pair wrapper

Replace the two separate sibling columns:

```
<div class="hidden xl:block w-[210px] shrink-0"> <ProgressSparklinePreview …/> </div>
<div class="w-full lg:w-[320px] xl:w-[360px] shrink-0"> <TeamProgressPreview …/> </div>
```

with a single stretch group:

```
<div class="w-full lg:w-auto flex items-stretch gap-3 lg:shrink-0">
  <div class="hidden xl:block xl:w-[300px] 2xl:w-[340px]">
    <ProgressSparklinePreview projectId={Number(id)} onEnlarge={() => setChartsOverlayOpen(true)} />
  </div>
  <div class="w-full lg:w-[300px] 2xl:w-[340px]">
    <TeamProgressPreview teams={teamProgress} projectProgress={data.project.progress} />
  </div>
</div>
```

- `items-stretch` makes the two inner cards equal height to each other (taller content wins).
- Equal widths (`xl:w-[300px] 2xl:w-[340px]`) → balanced pair on xl; comfortable on ≥1440px.
- Below `xl`, the chart column is `hidden` so only the team card shows (current behavior preserved).
- The parent row stays `items-start lg:items-center`; this wrapper is one flex item, its internal
  `items-stretch` equalizes its own two children regardless of the parent's cross-axis alignment.

### 3. `TeamProgressPreview` (same file) — fill stretched height

Add `h-full` to its root div (currently `min-h-[112px] rounded-lg border …`). Contents unchanged; it
simply fills the stretched column so the pair lines up flush. When the team card is the taller of the
two, this is a no-op; when the chart is taller (few teams), the team card grows to match.

## Data flow

```
ProjectDetailPage (header)
  └─ <div items-stretch>  ← equalizes the pair's height
       ├─ ProgressSparklinePreview ──(useApiQuery, shared cache key)──> GET /projects/:id/charts/timeseries?days=30
       │     renders height-filling SVG area chart from data.overall; click → onEnlarge()
       └─ TeamProgressPreview (h-full)
  └─ chartsOverlayOpen && <Overlay> → <Suspense> lazy ProjectChartsTab embeddedFullscreen (lightweight-charts loads here)
```

## Error / edge handling

- Timeseries error or <2 points → chart card shows a muted, height-filling placeholder; enlarge
  hidden. Team card still renders; pair still equal-height via stretch.
- Few teams (short team card) → chart's `min-h-[150px]` floor defines the pair height; team card
  stretches to match (acceptable small empty area below its rows).
- `preserveAspectRatio="none"` distorts vertical stroke scaling → mitigated by
  `vectorEffect="non-scaling-stroke"` on line/grid strokes; gridlines and tag use fraction mapping so
  they stay aligned at any height.

## Performance

- Header stays light: still only a cheap SVG + the one **shared, cached** 30-day timeseries request
  (also pre-warms the Графикууд tab). `lightweight-charts` remains lazy — loaded only on enlarge.

## Testing / verification (no automated test suite in this repo)

1. `npx tsc -b --force` clean for the touched files; `npm run build` (frontend) succeeds.
2. Wide (`xl`) project detail → ЯВЦ chart and БАГУУДЫН ЯВЦ render as equal-width, equal-height cards;
   chart shows gradient area, faint grid, trend color, last-point dot + right-edge % tag, headline
   `%` + window-change arrow.
3. Click chart → full-viewport TradingView dashboard; `lightweight-charts` chunk loads only here
   (Network / modulepreload), NOT on initial project-detail load.
4. `lg` / mobile width → chart hidden, only team card shows; header not crowded.
5. Project with <2 timeseries points → muted placeholder fills the card, no enlarge; team card fine.
6. Light + dark theme → gradient, grid, and surface read correctly in both.

## Files

- `frontend/src/features/projects/components/ProgressSparklinePreview.tsx` (redesign)
- `frontend/src/features/projects/ProjectDetailPage.tsx` (header equal-pair wrapper + TeamProgressPreview `h-full`)
