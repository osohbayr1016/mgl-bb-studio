import { useMemo } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/ui/chart';
import { useLanguage } from '@/shared/i18n';
import type { PeriodKind, ProductivityHistoryPoint } from './types';
import { historyTick } from './lib';

/**
 * «Сүүлд харж шалгах» — сүүлийн хугацаануудын багийн өдрийн дундаж (шугам),
 * дээд / доод хүн (тасархай), зөрүү % (баганa, баруун тэнхлэг) + босгын
 * зураас.  Өдрөөр харахад амралтын өдрүүд цэггүй.
 */
export function HistoryChart({
  history,
  kind,
  threshold,
}: {
  history: ProductivityHistoryPoint[];
  kind: PeriodKind;
  threshold: number;
}) {
  const { t } = useLanguage();
  const config = {
    team_avg: { label: t('teamProductivity.chartTeamAvg'), color: 'var(--color-primary)' },
    top_avg: { label: t('teamProductivity.chartTop'), color: 'var(--color-success)' },
    bottom_avg: { label: t('teamProductivity.chartBottom'), color: 'var(--color-danger)' },
    gap_pct: { label: t('teamProductivity.chartGap'), color: 'var(--color-muted-foreground)' },
  } satisfies ChartConfig;

  const rows = useMemo(
    () =>
      history
        .filter((h) => h.working)
        .map((h) => ({
          label: historyTick(h, kind),
          team_avg: h.team_avg,
          top_avg: h.top_avg,
          bottom_avg: h.bottom_avg,
          gap_pct: h.gap_pct,
          exceeded: h.exceeded,
        })),
    [history, kind],
  );

  if (rows.length < 2) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{t('teamProductivity.chartEmpty')}</p>;
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" data-testid="tp-history-chart">
      <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -4 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} minTickGap={16} tick={{ fontSize: 10 }} />
        <YAxis yAxisId="avg" tickLine={false} axisLine={false} width={40} tick={{ fontSize: 10 }} />
        <YAxis
          yAxisId="gap"
          orientation="right"
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          width={30}
          tick={{ fontSize: 10 }}
          tickFormatter={(v: number) => `${v}%`}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Bar yAxisId="gap" dataKey="gap_pct" radius={[3, 3, 0, 0]} maxBarSize={16} fillOpacity={0.35}>
          {rows.map((r) => (
            <Cell key={r.label} fill={r.exceeded ? 'var(--color-danger)' : 'var(--color-success)'} />
          ))}
        </Bar>
        <ReferenceLine yAxisId="gap" y={threshold} stroke="var(--color-danger)" strokeDasharray="4 3" strokeOpacity={0.7} />
        <Line yAxisId="avg" type="monotone" dataKey="top_avg" stroke="var(--color-top_avg)" strokeDasharray="4 3" dot={false} strokeWidth={1.5} connectNulls />
        <Line yAxisId="avg" type="monotone" dataKey="bottom_avg" stroke="var(--color-bottom_avg)" strokeDasharray="4 3" dot={false} strokeWidth={1.5} connectNulls />
        <Line yAxisId="avg" type="monotone" dataKey="team_avg" stroke="var(--color-team_avg)" dot={{ r: 2.5 }} strokeWidth={2} connectNulls />
      </ComposedChart>
    </ChartContainer>
  );
}
