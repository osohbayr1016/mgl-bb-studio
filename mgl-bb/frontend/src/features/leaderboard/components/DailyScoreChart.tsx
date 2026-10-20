import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import type { MyDailySeries } from '@/shared/types';
import { formatPoints } from '@/shared/lib/score';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

/**
 * DailyScoreChart — Bitcoin-style personal earnings chart on the
 * dashboard.  Shows the caller's per-day score as a filled area with
 * gradient fill (shadcn interactive area chart pattern), with a
 * 7 / 30 / 90-day range toggle.
 *
 *   • Today's data point gets a highlighted dot via Recharts' activeDot.
 *   • Tooltip uses shadcn ChartTooltipContent — auto-themed and matches
 *     the rest of the design system.
 *   • Headline shows today's earned + range total + half-vs-half trend
 *     so the user gets the trajectory without parsing the chart.
 *   • Empty state: italic "Сүүлийн N хоногт оноо алга" instead of a
 *     misleading flat line.
 */
type Range = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };
const RANGE_LABEL_KEY: Record<Range, string> = {
  '7d': 'dailyScoreChart.last7',
  '30d': 'dailyScoreChart.last30',
  '90d': 'dailyScoreChart.last90',
};

export default function DailyScoreChart() {
  const { t } = useLanguage();
  const chartConfig = {
    points: {
      label: t('dailyScoreChart.earnedPct'),
      color: 'var(--color-chart-1)',
    },
  } satisfies ChartConfig;
  const [range, setRange] = useState<Range>('30d');
  const [data, setData] = useState<MyDailySeries | null>(null);
  // Track the in-flight range so an out-of-order response from a slow
  // 90d request can't clobber a fresh 7d view.
  const reqIdRef = useRef(0);

  const fetchSeries = useCallback((forRange: Range, { silent = false } = {}) => {
    const myId = ++reqIdRef.current;
    if (!silent) setData(null);
    apiFetch<MyDailySeries>(`/leaderboard/me/series?days=${RANGE_DAYS[forRange]}`)
      .then((r) => {
        if (myId === reqIdRef.current) setData(r);
      })
      .catch(() => {
        if (myId === reqIdRef.current)
          setData({
            days: RANGE_DAYS[forRange],
            series: [],
            total_points: 0,
          });
      });
  }, []);

  useEffect(() => {
    fetchSeries(range);
  }, [range, fetchSeries]);

  // Live refresh: any time a progress entry is submitted/approved
  // anywhere in the app (MyTasks, Approvals, …) we refetch silently
  // so the dashboard chart always reflects the latest awarded points
  // without needing a page reload.  Also refetches when the tab
  // regains focus, in case the user submitted from another tab.
  useEffect(() => {
    const onProgress = () => fetchSeries(range, { silent: true });
    const onFocus = () => fetchSeries(range, { silent: true });
    window.addEventListener('progress:submitted', onProgress);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('progress:submitted', onProgress);
      window.removeEventListener('focus', onFocus);
    };
  }, [range, fetchSeries]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.series.map((p) => ({
      date: p.date,
      points: p.points,
      cum: p.cum_points,
    }));
  }, [data]);

  const totalPoints = data?.total_points ?? 0;
  const todayPoints = chartData.find((p) => p.date === todayIso)?.points ?? 0;

  // Half-vs-half trend — quick "earning more or less than I was?" cue.
  const trend = useMemo(() => {
    if (!chartData.length) return { dir: 'flat' as const, delta: 0 };
    const mid = Math.floor(chartData.length / 2);
    const first = chartData.slice(0, mid).reduce((s, p) => s + p.points, 0);
    const last = chartData.slice(mid).reduce((s, p) => s + p.points, 0);
    const delta = last - first;
    return {
      dir: delta > 0 ? ('up' as const) : delta < 0 ? ('down' as const) : ('flat' as const),
      delta,
    };
  }, [chartData]);
  const TrendIcon = trend.dir === 'up' ? TrendingUp : trend.dir === 'down' ? TrendingDown : Minus;
  const trendColor =
    trend.dir === 'up'
      ? 'text-success'
      : trend.dir === 'down'
        ? 'text-danger'
        : 'text-muted-foreground';

  const allZero = chartData.every((p) => p.points === 0);

  return (
    <Card className="h-full pt-0 gap-0 overflow-hidden">
      <CardHeader className="flex items-start gap-2 space-y-0 border-b py-4 sm:flex-row sm:items-center">
        <div className="grid flex-1 gap-1">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-primary" />
            {t('dailyScoreChart.title')}
          </CardTitle>
          <CardDescription className="text-micro">{t(RANGE_LABEL_KEY[range])}</CardDescription>
        </div>
        <CardAction className="self-start sm:self-center">
          {/* shadcn-style Select dropdown — matches the
              interactive-area-chart template. */}
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger
              className="h-8 w-[120px] rounded-lg text-xs"
              aria-label={t('dailyScoreChart.selectRange')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="7d" className="text-xs">
                {t('dailyScoreChart.last7Short')}
              </SelectItem>
              <SelectItem value="30d" className="text-xs">
                {t('dailyScoreChart.last30Short')}
              </SelectItem>
              <SelectItem value="90d" className="text-xs">
                {t('dailyScoreChart.last90Short')}
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      <CardContent className="flex-1 px-3 pt-3 sm:px-4 sm:pt-4 flex flex-col gap-3">
        {/* Headline numbers — today's earn + cumulative + trend.
            Sits above the chart so the eye reads "I made X today" first. */}
        <div className="flex items-end justify-between gap-2 px-1">
          <div>
            <div className="text-3xl font-bold tabular-nums leading-none">
              {formatPoints(todayPoints)}
            </div>
            <div className="text-label text-muted-foreground font-medium mt-0.5">
              {t('dailyScoreChart.todayProductivity')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {formatPoints(totalPoints)}
              <span className="text-micro text-muted-foreground ml-1">
                {t('dailyScoreChart.total')}
              </span>
            </div>
            <div
              className={cn(
                'inline-flex items-center gap-0.5 text-micro font-semibold tabular-nums',
                trendColor,
              )}
            >
              <TrendIcon className="w-3 h-3" />
              {trend.dir === 'flat'
                ? t('dailyScoreChart.stableProductivity')
                : (trend.delta > 0 ? '+' : '') + formatPoints(trend.delta)}
            </div>
          </div>
        </div>

        {/* Chart — flexes to take any leftover height in the card. */}
        <div className="flex-1 min-h-[180px]">
          {!data ? (
            <div className="h-full rounded bg-muted/40 animate-pulse" />
          ) : allZero ? (
            <div className="h-full flex items-center justify-center text-micro text-muted-foreground italic text-center px-2">
              {t('dailyScoreChart.emptyForRange', { range: t(RANGE_LABEL_KEY[range]) })}
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="fillPoints" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-points)" stopOpacity={0.85} />
                    <stop offset="95%" stopColor="var(--color-points)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeOpacity={0.35} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  minTickGap={range === '7d' ? 8 : 32}
                  tickFormatter={(value: string) => {
                    const d = new Date(value);
                    if (range === '7d') {
                      return d.toLocaleDateString('mn-MN', { weekday: 'short' }).slice(0, 2);
                    }
                    return d.toLocaleDateString('mn-MN', { month: 'short', day: 'numeric' });
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fontSize: 10 }}
                  domain={[0, 'dataMax + 1']}
                  tickFormatter={(value) => `${value}%`}
                />
                <ChartTooltip
                  cursor={{ stroke: 'var(--color-points)', strokeOpacity: 0.4, strokeWidth: 1 }}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      labelFormatter={(value) =>
                        new Date(value as string).toLocaleDateString('mn-MN', {
                          month: 'short',
                          day: 'numeric',
                          weekday: 'short',
                        })
                      }
                      formatter={(value) => [`${formatPoints(Number(value))} `, t('dailyScoreChart.earned')]}
                    />
                  }
                />
                <Area
                  dataKey="points"
                  type="monotone"
                  fill="url(#fillPoints)"
                  stroke="var(--color-points)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--color-points)' }}
                  isAnimationActive
                />
              </AreaChart>
            </ChartContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
