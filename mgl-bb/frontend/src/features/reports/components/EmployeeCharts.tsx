import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/ui/chart';
import { useLanguage } from '@/shared/i18n';
import type { EmployeeDetailResponse } from '../types';
import { seriesLabel } from '../lib/windows';

/**
 * Өдрийн (7 хоног / сарын) бүтээмж — тууз.  Самбарын байрын шугам ЗОРИУД
 * байхгүй (эзний хүсэлт 2026-09-16): байр нь харьцангуй хэмжигдэхүүн бөгөөд
 * толгойн `RankBadge` дээр аль хэдийн харагддаг тул график зөвхөн оноог зурна.
 * Урт цонхонд сервер цувааг 7 хоног/сараар нэгтгэдэг (`series.granularity`).
 */
export function PointsChart({ data }: { data: EmployeeDetailResponse }) {
  const { t } = useLanguage();
  const config = {
    points: { label: t('reportsPage.kpiPoints'), color: 'var(--color-primary)' },
  } satisfies ChartConfig;

  const rows = useMemo(
    () =>
      data.series.dates.map((d, i) => ({
        date: d,
        label: seriesLabel(d, data.series.granularity),
        points: data.series.points[i] ?? 0,
      })),
    [data],
  );

  return (
    <ChartContainer config={config} className="aspect-auto h-60 w-full">
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} minTickGap={24} tick={{ fontSize: 10 }} />
        <YAxis tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Bar dataKey="points" fill="var(--color-points)" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </ComposedChart>
    </ChartContainer>
  );
}

/** Ажилласан цаг (тууз) + хоцролт минут (шугам) — цонхны цуваа, урт цонхонд нэгтгэсэн. */
export function HoursLateChart({ data }: { data: EmployeeDetailResponse }) {
  const { t } = useLanguage();
  const config = {
    hours: { label: t('reportsPage.kpiHours'), color: '#0ea5e9' },
    late: { label: t('reportsPage.kpiLate'), color: '#f43f5e' },
  } satisfies ChartConfig;
  const rows = useMemo(
    () =>
      data.series.dates.map((d, i) => ({
        label: seriesLabel(d, data.series.granularity),
        hours: data.series.hours[i] ?? 0,
        late: data.series.late_minutes[i] ?? 0,
      })),
    [data],
  );
  return (
    <ChartContainer config={config} className="aspect-auto h-60 w-full">
      <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -4 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} minTickGap={24} tick={{ fontSize: 10 }} />
        <YAxis yAxisId="h" tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10 }} />
        <YAxis yAxisId="l" orientation="right" tickLine={false} axisLine={false} width={32} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Bar yAxisId="h" dataKey="hours" fill="#0ea5e9" radius={[3, 3, 0, 0]} maxBarSize={18} />
        <Line yAxisId="l" dataKey="late" type="monotone" stroke="#f43f5e" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ChartContainer>
  );
}

/**
 * Ирц (ирсэн өдөр / ажлын өдөр) — цонхны цуваа.  Өдрийн цуваанд 0/1 тул
 * зөвхөн 7 хоног/сарын нэгтгэлд утга учиртай; дуудагч тэр үед л харуулна.
 */
export function AttendanceChart({ data }: { data: EmployeeDetailResponse }) {
  const { t } = useLanguage();
  const config = {
    present: { label: t('reportsPage.kpiPresent'), color: '#10b981' },
    expected: { label: t('reportsPage.expectedDays'), color: 'var(--color-muted-foreground)' },
  } satisfies ChartConfig;
  const rows = useMemo(
    () =>
      data.series.dates.map((d, i) => ({
        label: seriesLabel(d, data.series.granularity),
        present: data.series.present[i] ?? 0,
        expected: data.series.expected[i] ?? 0,
      })),
    [data],
  );
  return (
    <ChartContainer config={config} className="aspect-auto h-60 w-full">
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} minTickGap={24} tick={{ fontSize: 10 }} />
        <YAxis tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10 }} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Bar dataKey="expected" fill="var(--color-expected)" fillOpacity={0.25} radius={[3, 3, 0, 0]} maxBarSize={18} />
        <Bar dataKey="present" fill="var(--color-present)" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </ComposedChart>
    </ChartContainer>
  );
}
