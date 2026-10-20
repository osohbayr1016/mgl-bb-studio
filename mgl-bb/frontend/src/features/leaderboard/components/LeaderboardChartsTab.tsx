import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import type { LeaderboardAveragesEntry, LeaderboardUserSeriesResponse } from '@/shared/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/ui/chart';
import { formatPoints } from '@/shared/lib/score';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import { Activity, Clock, CalendarCheck, TrendingUp } from 'lucide-react';

/* ============================================================
 *  «Хандлага» таб — нэг хүнийг сонгоод түүний цаг хугацааны
 *  бүтээмж / хоцролт / ажилласан цаг / ирцийн графикийг харуулна.
 *  Дизайн нь project charts (ProjectChartsTab)-аас санаа авсан.
 * ============================================================ */

type Gran = 'day' | 'week' | 'month';
const GRAN_DAYS: Record<Gran, number> = { day: 1, week: 7, month: 30 };
const GRAN_OPTIONS: { key: Gran; labelKey: string }[] = [
  { key: 'day', labelKey: 'leaderboardChartsTab.granDay' },
  { key: 'week', labelKey: 'leaderboardChartsTab.granWeek' },
  { key: 'month', labelKey: 'leaderboardChartsTab.granMonth' },
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function fmtMonthDay(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('mn-MN', {
    month: 'numeric',
    day: 'numeric',
  });
}

type Bucket = { label: string; points: number; late_minutes: number; hours: number };

/** Өдрийн зэрэгцээ массивуудыг `size`-өдрийн цонхоор (сүүлээс эхлэн, хамгийн
 *  сүүлийн цонх бүтэн) нийлбэрлэж график мөр болгоно. */
function bucketize(
  dates: string[],
  points: number[],
  late: number[],
  hours: number[],
  size: number,
): Bucket[] {
  const rows: Bucket[] = [];
  const n = dates.length;
  for (let end = n; end > 0; end -= size) {
    const start = Math.max(0, end - size);
    let p = 0;
    let l = 0;
    let h = 0;
    for (let i = start; i < end; i++) {
      p += points[i] ?? 0;
      l += late[i] ?? 0;
      h += hours[i] ?? 0;
    }
    const label =
      size === 1
        ? fmtMonthDay(dates[start]!)
        : `${fmtMonthDay(dates[start]!)}–${fmtMonthDay(dates[end - 1]!)}`;
    rows.unshift({ label, points: round3(p), late_minutes: Math.round(l), hours: round1(h) });
  }
  return rows;
}

export default function LeaderboardChartsTab({
  days,
  people,
}: {
  days: number;
  people: LeaderboardAveragesEntry[];
}) {
  const { t } = useLanguage();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [gran, setGran] = useState<Gran>('week');

  const PROD_CONFIG = {
    points: { label: t('leaderboardChartsTab.productivity'), color: '#10b981' },
  } satisfies ChartConfig;
  const LATE_CONFIG = {
    late_minutes: { label: t('leaderboardChartsTab.lateMinutes'), color: '#f43f5e' },
  } satisfies ChartConfig;
  const HOURS_CONFIG = {
    hours: { label: t('leaderboardChartsTab.hours'), color: '#0ea5e9' },
  } satisfies ChartConfig;

  // Сонгосон хүн жагсаалтад байхгүй (эсвэл хараахан сонгоогүй) бол эхнийх рүү
  // унана — effect ашиглахгүйгээр render дотор тооцоолно (setState-in-effect
  // зайлсхийнэ).
  const effectiveUserId =
    selectedUserId != null && people.some((p) => p.user_id === selectedUserId)
      ? selectedUserId
      : (people[0]?.user_id ?? null);

  const { data, isLoading } = useApiQuery<LeaderboardUserSeriesResponse>(
    ['leaderboard-user-series', effectiveUserId, days],
    `/leaderboard/user/${effectiveUserId}/series?days=${days}`,
    { enabled: effectiveUserId != null },
  );

  const chartData = useMemo(
    () =>
      data
        ? bucketize(data.dates, data.points, data.late_minutes, data.hours, GRAN_DAYS[gran])
        : [],
    [data, gran],
  );

  const totals = useMemo(() => {
    if (!data) return { points: 0, late: 0, hours: 0, present: 0 };
    return {
      points: round3(data.points.reduce((s, v) => s + v, 0)),
      late: data.late_minutes.reduce((s, v) => s + v, 0),
      hours: round1(data.hours.reduce((s, v) => s + v, 0)),
      present: data.present_days,
    };
  }, [data]);

  if (people.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        {t('leaderboardChartsTab.noMembers')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Хүн сонгогч + granularity toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          value={effectiveUserId != null ? String(effectiveUserId) : ''}
          onValueChange={(v) => setSelectedUserId(Number(v))}
        >
          <SelectTrigger className="h-9 w-[260px] text-sm">
            <SelectValue placeholder={t('leaderboardChartsTab.selectMember')} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {people.map((p) => (
              <SelectItem key={p.user_id} value={String(p.user_id)} className="text-sm">
                {formatDisplayName(p.full_name)}
                {p.team_code ? ` · ${p.team_code}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {GRAN_OPTIONS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGran(g.key)}
              className={cn(
                'h-7 rounded-md px-3 text-xs font-medium transition-colors',
                gran === g.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(g.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Толгой үзүүлэлтүүд */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label={t('leaderboardChartsTab.totalProductivity')}
          value={formatPoints(totals.points)}
          tone="emerald"
        />
        <StatCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label={t('leaderboardChartsTab.totalLate')}
          value={t('leaderboardChartsTab.minutesValue', { count: totals.late })}
          tone="rose"
        />
        <StatCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label={t('leaderboardChartsTab.workedHours')}
          value={t('leaderboardChartsTab.hoursValue', { count: totals.hours })}
          tone="sky"
        />
        <StatCard
          icon={<CalendarCheck className="h-3.5 w-3.5" />}
          label={t('leaderboardChartsTab.presentDays')}
          value={`${totals.present}`}
          tone="muted"
        />
      </div>

      {isLoading || !data ? (
        <div className="h-72 rounded-lg bg-muted/40 animate-pulse" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title={t('leaderboardChartsTab.productivityTrend')}
            description={t('leaderboardChartsTab.productivityTrendDesc')}
            icon={<TrendingUp className="h-4 w-4 text-success" />}
          >
            <ChartContainer config={PROD_CONFIG} className="aspect-auto h-64 w-full">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="fillProd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-points)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--color-points)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeOpacity={0.35} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  minTickGap={24}
                  tick={{ fontSize: 10 }}
                />
                <YAxis tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                <Area
                  dataKey="points"
                  type="monotone"
                  fill="url(#fillProd)"
                  stroke="var(--color-points)"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ChartContainer>
          </ChartCard>

          <ChartCard
            title={t('leaderboardChartsTab.lateTitle')}
            description={t('leaderboardChartsTab.lateDesc')}
            icon={<Clock className="h-4 w-4 text-danger" />}
          >
            <ChartContainer config={LATE_CONFIG} className="aspect-auto h-64 w-full">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.35} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  minTickGap={24}
                  tick={{ fontSize: 10 }}
                />
                <YAxis tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                <Bar
                  dataKey="late_minutes"
                  fill="var(--color-late_minutes)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </ChartCard>

          <ChartCard
            title={t('leaderboardChartsTab.workedHours')}
            description={t('leaderboardChartsTab.workedHoursDesc')}
            icon={<Activity className="h-4 w-4 text-info" />}
          >
            <ChartContainer config={HOURS_CONFIG} className="aspect-auto h-64 w-full">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="fillHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-hours)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--color-hours)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeOpacity={0.35} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  minTickGap={24}
                  tick={{ fontSize: 10 }}
                />
                <YAxis tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                <Area
                  dataKey="hours"
                  type="monotone"
                  fill="url(#fillHours)"
                  stroke="var(--color-hours)"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ChartContainer>
          </ChartCard>
        </div>
      )}

      <p className="text-micro text-muted-foreground">
        {t('leaderboardChartsTab.footnote')}
      </p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'sky' | 'muted';
}) {
  const tones: Record<typeof tone, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
    sky: 'text-sky-600 dark:text-sky-400',
    muted: 'text-foreground',
  };
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-label text-muted-foreground">
          {icon} {label}
        </div>
        <div className={cn('mt-1 text-xl font-bold tabular-nums', tones[tone])}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="pt-0 gap-0 overflow-hidden">
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          {icon} {title}
        </CardTitle>
        <CardDescription className="text-micro">{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-3">{children}</CardContent>
    </Card>
  );
}
