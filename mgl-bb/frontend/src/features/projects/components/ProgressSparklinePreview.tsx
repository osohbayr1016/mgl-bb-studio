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
    trend === 'up' ? 'text-success' : trend === 'down' ? 'text-danger' : 'text-primary';
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
        <div className="flex items-center gap-1.5 text-label text-muted-foreground">
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
        <span className="flex items-center gap-1.5 text-label text-muted-foreground">
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
            'flex items-center gap-0.5 text-micro font-semibold tabular-nums',
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
            'pointer-events-none absolute right-0 flex -translate-y-1/2 items-center gap-1 rounded-sm border border-border/60 bg-background/85 px-1 py-0.5 text-micro font-semibold tabular-nums',
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
