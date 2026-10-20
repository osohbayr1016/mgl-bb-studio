/**
 * /app/company — read-only company-wide dashboard (Notion-clean redesign).
 *
 * A calm, 30,000-foot view of the whole portfolio: how every project is
 * progressing, who's on which team, the 30-day momentum chart, and the
 * overdue follow-up queue.  Everyone except clients can see it.  It's a status
 * surface, not a control panel — deliberately quiet, monochrome-forward, with a
 * single blueprint-blue accent and semantic status colours only where they
 * carry meaning.  Theme-adaptive (follows the app's dark/light theme).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/shared/api/useApi';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Progress } from '@/ui/progress';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { progressBarClass } from '@/shared/lib/status-colors';
import { formatDate, todayUB } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import { AnimatedNumber } from '@/shared/components/motion';
import {
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_CODES,
  categoryName,
  type ProjectCategory,
} from '@/shared/lib/project-categories';
import {
  Building2,
  FolderKanban,
  Clock,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  Loader2,
  CalendarDays,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Tv,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Cell,
  PieChart,
  Pie,
} from 'recharts';

/** Notion-clean surface: a flat card with a single hairline border, no heavy
 *  shadow. Whitespace does the separating, not chrome. */
const PANEL = 'rounded-xl border border-border bg-card';

interface OverviewResponse {
  generated_at: string;
  totals: {
    projects_total: number;
    projects_active: number;
    projects_completed: number;
    users_active: number;
    users_total: number;
    blocks_total: number;
    drawings_total: number;
    components_total: number;
    tasks_total: number;
    tasks_overdue: number;
  };
  portfolio: Array<{
    id: number;
    name: string;
    status: string | null;
    location: string | null;
    category: string | null;
    progress: number;
    member_count: number;
    task_count: number;
    completed_tasks: number;
    overdue_tasks: number;
    start_date: string | null;
    finish_date: string | null;
    days_left: number | null;
    created_at: string;
    updated_at: string;
    team_progress?: Array<{
      team_id: number;
      team_code: string;
      team_name_mn: string;
      progress: number;
      share_percent?: number;
      task_count: number;
    }>;
  }>;
  people: {
    by_role: Array<{ role: string; count: number }>;
    by_team: Array<{
      team_id: number;
      code: string;
      name_mn: string;
      member_count: number;
      avg_progress: number;
    }>;
    attendance_today: { present: number; total: number; percentage: number };
    active_projects_today: Array<{
      project_id: number;
      project_name: string;
      employee_count: number;
      employees: Array<{
        user_id: number;
        full_name: string;
        profile_image: string | null;
        team_codes: string[];
      }>;
      teams: Array<{ code: string; count: number }>;
    }>;
  };
  trends: {
    daily: Array<{
      date: string;
      entry_count: number;
      contributor_count: number;
      avg_percentage: number;
    }>;
    weekly: Array<{ week_start: string; entries: number }>;
  };
  alerts: {
    overdue_tasks: Array<{
      task_id: number;
      task_name: string;
      due_date: string;
      progress: number;
      drawing_name: string;
      block_name: string;
      project_id: number;
      project_name: string;
      assignee_name: string | null;
      days_overdue: number;
    }>;
    overdue_projects: Array<{
      project_id: number;
      project_name: string;
      due_date: string;
      progress: number;
      days_overdue: number;
    }>;
    stale_chats: Array<{
      thread_id: number;
      team_code: string;
      last_msg_at: string;
      project_id: number;
      project_name: string;
      days_stale: number;
    }>;
  };
}

/** Response shape of GET /api/company/day-snapshot — the date-scoped slice
 *  of /overview that drives the navigable attendance + active-projects cards. */
interface DaySnapshotResponse {
  date: string;
  attendance: OverviewResponse['people']['attendance_today'];
  active_projects: OverviewResponse['people']['active_projects_today'];
}

/** Shift a YYYY-MM-DD string by N days using local-midnight semantics so the
 *  day never slips in negative-offset browsers (mirrors `formatDate`). */
function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CompanyDashboardPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const overviewQuery = useApiQuery<OverviewResponse>('/company/overview');
  const data = overviewQuery.data ?? null;
  const loading = overviewQuery.isPending;
  const refreshing = overviewQuery.isFetching && !overviewQuery.isPending;
  const error = overviewQuery.error?.message ?? null;
  const load = async () => {
    await queryClient.invalidateQueries({ queryKey: ['/company/overview'] });
  };

  // Date scrubber for the attendance + active-projects pair.  Today piggybacks
  // on /overview; past dates fetch /day-snapshot.
  const today = todayUB();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const isToday = selectedDate === today;

  // Category filter for the portfolio list — mirrors ProjectsPage.
  const [categoryFilter, setCategoryFilter] = useState<ProjectCategory | 'all'>('all');
  const snapshotQuery = useApiQuery<DaySnapshotResponse>(
    ['/company/day-snapshot', selectedDate],
    `/company/day-snapshot?date=${selectedDate}`,
    { enabled: !isToday },
  );

  if (loading) {
    return (
      <div className="flex-1 w-full flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> {t('common.loading')}
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex-1 w-full flex items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-xl border border-danger/30 bg-danger/5 p-6 text-sm text-danger">
          {error ?? t('companyDashboardPage.overviewLoadFailed')}
        </div>
      </div>
    );
  }

  const { totals, portfolio, people, trends, alerts } = data;
  const overdueCount = alerts.overdue_tasks.length + alerts.overdue_projects.length;
  const activeProjectsForDate = isToday
    ? people.active_projects_today
    : (snapshotQuery.data?.active_projects ?? null);
  const attendanceForDate = isToday
    ? people.attendance_today
    : (snapshotQuery.data?.attendance ?? null);
  const peopleOnSite = people.active_projects_today.reduce((s, p) => s + p.employee_count, 0);

  const categoryCounts: Record<ProjectCategory, number> = { AZ: 0, ZA: 0, ET: 0, EZ: 0, IZ: 0 };
  for (const p of portfolio) {
    if (p.category && p.category in categoryCounts) {
      categoryCounts[p.category as ProjectCategory] += 1;
    }
  }
  const filteredPortfolio =
    categoryFilter === 'all' ? portfolio : portfolio.filter((p) => p.category === categoryFilter);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full bg-background">
      {/* Sticky header — page icon + title, date scrubber, TV/refresh. */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-8 py-4 flex items-center gap-4 flex-wrap">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight truncate">
              {t('companyDashboardPage.title')}
            </h1>
            <p className="text-xs text-muted-foreground truncate">
              {t('companyDashboardPage.subtitle')} ·{' '}
              {new Date(data.generated_at).toLocaleString('mn-MN', {
                hour: '2-digit',
                minute: '2-digit',
                day: '2-digit',
                month: '2-digit',
              })}
            </p>
          </div>
          <DateNavigator selectedDate={selectedDate} onSelectDate={setSelectedDate} today={today} />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            title={t('companyDashboardPage.tvModeTitle')}
            onClick={async () => {
              try {
                await document.documentElement.requestFullscreen();
              } catch {
                /* refused/unsupported — open the board anyway */
              }
              navigate('/app/tv');
            }}
          >
            <Tv className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">{t('companyDashboardPage.tvMode')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => load()}
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-4 w-4 sm:mr-1.5', refreshing && 'animate-spin')} />
            <span className="hidden sm:inline">{t('companyDashboardPage.refresh')}</span>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 sm:px-8 py-6 space-y-6 animate-in fade-in duration-500">
        {/* `sec-company-*` id-нууд нь глобал хайлтын гүн холбоосын бай
            (`?section=<id>`) — `shared/lib/search/sections.ts`-тэй ижил байлгана.
            KPI зурвасын id нь `KpiRollup`-ийн үндсэн `<section>` дээр сууна. */}
        {/* Signature: inline "rollup" KPI strip — one flat surface, hairline
            dividers via the gap-px + bg-border technique (robust across the
            2×2 mobile / 1×4 desktop grid). */}
        <KpiRollup
          items={[
            {
              icon: FolderKanban,
              label: t('companyDashboardPage.kpiActiveProjects'),
              value: totals.projects_active,
              sub: t('companyDashboardPage.kpiTotalSuffix', { count: totals.projects_total }),
            },
            {
              icon: Users,
              label: t('companyDashboardPage.kpiOnSiteToday'),
              value: peopleOnSite,
              sub: t('companyDashboardPage.kpiProjectsSuffix', {
                count: people.active_projects_today.length,
              }),
            },
            {
              icon: Clock,
              label: t('companyDashboardPage.kpiTodayAttendance'),
              value: people.attendance_today.percentage,
              suffix: '%',
              sub: `${people.attendance_today.present}/${people.attendance_today.total}`,
            },
            {
              icon: AlertTriangle,
              label: t('companyDashboardPage.kpiOverdue'),
              value: totals.tasks_overdue,
              sub: t('companyDashboardPage.tasksUnit'),
              danger: true,
            },
          ]}
        />

        {/* Portfolio (wide) + the day's live status (attendance + crews). */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section
            id="sec-company-projects"
            className={cn(PANEL, 'lg:col-span-2 overflow-hidden scroll-mt-24')}
          >
            <SectionHead
              icon={FolderKanban}
              title={t('companyDashboardPage.projectList')}
              count={
                categoryFilter === 'all'
                  ? filteredPortfolio.length
                  : `${filteredPortfolio.length}/${portfolio.length}`
              }
              action={
                <Link
                  to="/app/projects"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  {t('common.all')} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            {/* Category segmented control — quiet Notion-style tabs. */}
            <div className="flex flex-wrap gap-1 px-4 sm:px-5 pb-3">
              <CategoryChip
                active={categoryFilter === 'all'}
                label={t('common.all')}
                count={portfolio.length}
                onClick={() => setCategoryFilter('all')}
              />
              {PROJECT_CATEGORY_CODES.map((code) => (
                <CategoryChip
                  key={code}
                  active={categoryFilter === code}
                  label={PROJECT_CATEGORIES[code].code}
                  title={PROJECT_CATEGORIES[code].name_mn}
                  count={categoryCounts[code]}
                  onClick={() => setCategoryFilter(code)}
                />
              ))}
            </div>
            <PortfolioTable rows={filteredPortfolio} />
          </section>

          <div className="space-y-6">
            <section id="sec-company-attendance" className={cn(PANEL, 'scroll-mt-24')}>
              <SectionHead
                icon={Clock}
                title={
                  isToday
                    ? t('companyDashboardPage.todayAttendance')
                    : t('companyDashboardPage.attendance')
                }
              />
              <div className="px-4 sm:px-5 pb-5">
                {attendanceForDate ? (
                  <AttendanceGauge stats={attendanceForDate} />
                ) : (
                  <SnapshotPlaceholder
                    loading={!isToday && snapshotQuery.isFetching}
                    error={!isToday ? (snapshotQuery.error?.message ?? null) : null}
                  />
                )}
              </div>
            </section>

            <section id="sec-company-active" className={cn(PANEL, 'scroll-mt-24')}>
              <SectionHead
                icon={FolderKanban}
                title={
                  isToday
                    ? t('companyDashboardPage.todayActiveProjects')
                    : t('companyDashboardPage.activeProjects')
                }
                count={activeProjectsForDate?.length}
              />
              <div className="px-4 sm:px-5 pb-5">
                {activeProjectsForDate ? (
                  <ActiveProjectsList projects={activeProjectsForDate} />
                ) : (
                  <SnapshotPlaceholder
                    loading={!isToday && snapshotQuery.isFetching}
                    error={!isToday ? (snapshotQuery.error?.message ?? null) : null}
                  />
                )}
              </div>
            </section>
          </div>
        </div>

        {/* 30-day momentum. */}
        <section id="sec-company-activity" className={cn(PANEL, 'scroll-mt-24')}>
          <SectionHead
            icon={TrendingUp}
            title={t('companyDashboardPage.activity30Days')}
            count={t('companyDashboardPage.entriesCount', {
              count: trends.daily.reduce((s, d) => s + d.entry_count, 0),
            })}
          />
          <div className="px-2 sm:px-4 pb-4">
            <TrendChart data={trends.daily} />
          </div>
        </section>

        {/* Overdue queue. */}
        <section id="sec-company-overdue" className={cn(PANEL, 'overflow-hidden scroll-mt-24')}>
          <SectionHead
            icon={AlertTriangle}
            iconClassName={overdueCount > 0 ? 'text-warning' : 'text-muted-foreground'}
            title={t('companyDashboardPage.overdue')}
            count={overdueCount}
          />
          <OverdueList tasks={alerts.overdue_tasks} projects={alerts.overdue_projects} />
        </section>
      </div>
    </div>
  );
}

/* =====================  building blocks  ===================== */

/** Quiet section header: small muted icon + title + optional count/action.
 *  No divider — whitespace separates it from the content (Notion feel). */
function SectionHead({
  icon: Icon,
  iconClassName,
  title,
  count,
  action,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  title: string;
  count?: number | string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className={cn('h-4 w-4 shrink-0 text-muted-foreground', iconClassName)} />}
        <h2 className="text-sm font-semibold truncate">{title}</h2>
        {count != null && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}

function CategoryChip({
  active,
  label,
  count,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-muted text-foreground ring-1 ring-border'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {label}
      <span className="text-micro tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

/* =====================  KPI rollup  ===================== */

function KpiRollup({
  items,
}: {
  items: Array<{
    icon: LucideIcon;
    label: string;
    value: number;
    suffix?: string;
    sub?: string;
    danger?: boolean;
  }>;
}) {
  return (
    <section
      id="sec-company-kpi"
      className="overflow-hidden rounded-xl border border-border bg-border scroll-mt-24"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border">
        {items.map((it) => {
          const decimals = Number.isInteger(it.value) ? 0 : 1;
          const danger = it.danger && it.value > 0;
          return (
            <div key={it.label} className="bg-card p-4 sm:p-5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <it.icon className={cn('h-3.5 w-3.5', danger && 'text-danger')} />
                <span className="truncate">{it.label}</span>
              </div>
              <div className="mt-2.5 flex items-baseline gap-1">
                <AnimatedNumber
                  value={it.value}
                  decimals={decimals}
                  className={cn(
                    'text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight',
                    danger ? 'text-danger' : 'text-foreground',
                  )}
                />
                {it.suffix && (
                  <span className="text-lg font-medium text-muted-foreground">{it.suffix}</span>
                )}
              </div>
              {it.sub && <div className="mt-1 text-xs text-muted-foreground truncate">{it.sub}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* =====================  date navigator  ===================== */

/** YYYY-MM-DD → compact "YY/MM/DD" so the visible label ignores the browser's
 *  US locale on the native date input. */
function navDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[1]!.slice(2)}/${m[2]}/${m[3]}` : iso;
}

function DateNavigator({
  selectedDate,
  onSelectDate,
  today,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  today: string;
}) {
  const { t } = useLanguage();
  const isToday = selectedDate === today;
  const stepDay = (delta: number) => {
    const next = addDays(selectedDate, delta);
    if (next > today) return;
    onSelectDate(next);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2.5 text-xs hidden md:inline-flex text-muted-foreground"
        onClick={() => onSelectDate(today)}
        disabled={isToday}
      >
        {t('companyDashboardPage.todayButton')}
      </Button>
      <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background">
        <button
          type="button"
          onClick={() => stepDay(-1)}
          className="h-8 w-8 inline-flex items-center justify-center rounded-l-md text-muted-foreground hover:bg-muted"
          aria-label={t('companyDashboardPage.prevDay')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <label className="relative inline-flex items-center gap-1.5 h-8 px-2 text-xs tabular-nums cursor-pointer text-foreground">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{navDateLabel(selectedDate)}</span>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => {
              const v = e.target.value;
              if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) onSelectDate(v);
            }}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <button
          type="button"
          onClick={() => stepDay(1)}
          disabled={isToday}
          className="h-8 w-8 inline-flex items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label={t('companyDashboardPage.nextDay')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SnapshotPlaceholder({ loading, error }: { loading: boolean; error: string | null }) {
  const { t } = useLanguage();
  if (error) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-danger px-3 text-center">
        {error}
      </div>
    );
  }
  return (
    <div className="h-40 flex items-center justify-center text-muted-foreground">
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <span className="text-sm">{t('companyDashboardPage.noData')}</span>
      )}
    </div>
  );
}

/* =====================  charts  ===================== */

function TrendChart({ data }: { data: OverviewResponse['trends']['daily'] }) {
  const { t } = useLanguage();
  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date).getDate().toString().padStart(2, '0'),
  }));
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="0" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={32}
          />
          <RechartsTooltip
            cursor={{ stroke: 'hsl(var(--primary))', strokeOpacity: 0.25 }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const p = payload[0]!.payload as (typeof formatted)[number];
              return (
                <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-lg text-xs">
                  <div className="font-semibold">{formatDate(new Date(p.date))}</div>
                  <div className="text-muted-foreground mt-1">
                    {t('companyDashboardPage.entriesLabel')}{' '}
                    <span className="text-foreground tabular-nums">{p.entry_count}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {t('companyDashboardPage.contributorsLabel')}{' '}
                    <span className="text-foreground tabular-nums">{p.contributor_count}</span>{' '}
                    {t('common.person')}
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="entry_count"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#trendGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function AttendanceGauge({ stats }: { stats: OverviewResponse['people']['attendance_today'] }) {
  const { t } = useLanguage();
  const pct = Math.max(0, Math.min(100, stats.percentage));
  const data = [
    { name: 'present', value: pct, fill: 'hsl(var(--primary))' },
    { name: 'rest', value: 100 - pct, fill: 'hsl(var(--muted))' },
  ];
  return (
    <div className="flex items-center gap-5">
      <div className="h-32 w-32 relative shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius="68%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-2xl font-semibold tabular-nums">{pct}%</div>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-3xl font-semibold tabular-nums">
          {stats.present}
          <span className="text-lg text-muted-foreground"> / {stats.total}</span>
        </div>
        <div className="text-sm text-muted-foreground mt-0.5">
          {t('companyDashboardPage.attendanceCaption')}
        </div>
        <Link
          to="/app/attendance/admin"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
        >
          {t('companyDashboardPage.details')} <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function ActiveProjectsList({
  projects,
}: {
  projects: OverviewResponse['people']['active_projects_today'];
}) {
  const { t } = useLanguage();
  if (projects.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground italic">
        {t('companyDashboardPage.noActiveProjects')}
      </div>
    );
  }
  const sorted = [...projects].sort((a, b) => b.employee_count - a.employee_count);
  const maxCount = sorted[0]?.employee_count ?? 1;
  const totalEmployees = projects.reduce((s, p) => s + p.employee_count, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>{t('companyDashboardPage.projectsActiveCount', { count: projects.length })}</span>
        <span className="tabular-nums">
          <span className="font-semibold text-foreground">{totalEmployees}</span>{' '}
          {t('companyDashboardPage.employeesUnit')}
        </span>
      </div>
      <div className="space-y-2.5">
        {sorted.map((p) => {
          const widthPct = maxCount > 0 ? (p.employee_count / maxCount) * 100 : 0;
          return (
            <div key={p.project_id} className="space-y-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-xs">
                <span className="truncate font-medium">{p.project_name}</span>
                <span className="tabular-nums font-semibold text-muted-foreground shrink-0">
                  {p.employee_count}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              {p.teams.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {p.teams.map((team) => (
                    <span
                      key={team.code}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-micro tabular-nums text-muted-foreground"
                      title={t('companyDashboardPage.teamWithCount', {
                        code: team.code,
                        count: team.count,
                      })}
                    >
                      <span className="font-semibold text-foreground">{team.code}</span>
                      {team.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =====================  portfolio table  ===================== */

function PortfolioTable({ rows }: { rows: OverviewResponse['portfolio'] }) {
  const { t } = useLanguage();
  if (rows.length === 0) {
    return (
      <div className="px-6 py-14 text-center text-sm text-muted-foreground italic">
        {t('companyDashboardPage.noProjectsRegistered')}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-border text-left text-xs text-muted-foreground">
            <th className="px-4 sm:px-5 py-2.5 font-medium">
              {t('companyDashboardPage.colProject')}
            </th>
            <th className="px-3 py-2.5 font-medium w-48">
              {t('companyDashboardPage.colProgress')}
            </th>
            <th className="px-3 py-2.5 font-medium w-32">
              {t('companyDashboardPage.colDeadline')}
            </th>
            <th className="px-3 py-2.5 w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr
              key={p.id}
              className="border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors"
            >
              <td className="px-4 sm:px-5 py-3 min-w-[260px]">
                <Link
                  to={`/app/projects/${p.id}`}
                  className="font-medium hover:text-primary block truncate"
                >
                  {p.name}
                </Link>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {p.status && (
                    <Badge variant="secondary" className="text-micro px-1.5 py-0 capitalize">
                      {p.status}
                    </Badge>
                  )}
                  {p.category && (
                    <Badge
                      variant="outline"
                      className="text-micro px-1.5 py-0 tabular-nums"
                      title={categoryName(p.category as ProjectCategory)}
                    >
                      {p.category}
                    </Badge>
                  )}
                  <ProjectTeamChips teams={p.team_progress ?? []} />
                </div>
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2.5">
                  <Progress
                    value={p.progress}
                    className="h-1.5 flex-1"
                    indicatorClassName={progressBarClass(p.progress)}
                  />
                  <span className="text-sm font-semibold tabular-nums w-12 text-right">
                    {formatPct(p.progress)}
                  </span>
                </div>
              </td>
              <td className="px-3 py-3">
                {p.finish_date ? (
                  <div className="text-xs">
                    <div className="inline-flex items-center gap-1 text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatDate(new Date(p.finish_date))}
                    </div>
                    {p.days_left != null && (
                      <div
                        className={cn(
                          'mt-0.5 text-micro',
                          p.days_left < 0
                            ? 'text-danger font-semibold'
                            : p.days_left < 14
                              ? 'text-warning font-medium'
                              : 'text-muted-foreground',
                        )}
                      >
                        {p.days_left < 0
                          ? t('companyDashboardPage.daysOverdue', { count: Math.abs(p.days_left) })
                          : p.days_left === 0
                            ? t('companyDashboardPage.today')
                            : t('companyDashboardPage.daysLeft', { count: p.days_left })}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground italic text-xs">
                    {t('companyDashboardPage.notSet')}
                  </span>
                )}
              </td>
              <td className="px-3 py-3">
                <Link
                  to={`/app/projects/${p.id}`}
                  className="text-muted-foreground hover:text-primary inline-flex"
                >
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectTeamChips({
  teams,
}: {
  teams: NonNullable<OverviewResponse['portfolio'][number]['team_progress']>;
}) {
  const { t } = useLanguage();
  if (!teams || teams.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {teams.map((team) => {
        const share = Math.max(0, Math.min(100, Number(team.share_percent ?? 0)));
        const progress = Math.max(0, Math.min(100, Number(team.progress ?? 0)));
        return (
          <Badge
            key={team.team_id}
            variant="outline"
            className={cn(
              'h-4 px-1.5 text-micro font-semibold gap-1 leading-none',
              teamChipClass(team.team_code),
            )}
            title={t('companyDashboardPage.teamChipTitle', {
              name: team.team_name_mn ?? team.team_code,
              share: formatPct(share),
              progress: formatPct(progress),
              count: team.task_count,
            })}
          >
            <span>{team.team_code}</span>
            <span className="tabular-nums opacity-90">{formatPct(progress)}</span>
          </Badge>
        );
      })}
    </div>
  );
}

/* =====================  overdue queue  ===================== */

type OverdueTaskItem = OverviewResponse['alerts']['overdue_tasks'][number] & { type: 'task' };
type OverdueProjectItem = OverviewResponse['alerts']['overdue_projects'][number] & {
  type: 'project';
};
type OverdueItem = OverdueTaskItem | OverdueProjectItem;

function OverdueList({
  tasks,
  projects,
}: {
  tasks: OverviewResponse['alerts']['overdue_tasks'];
  projects: OverviewResponse['alerts']['overdue_projects'];
}) {
  const { t } = useLanguage();
  const items: OverdueItem[] = [
    ...projects.map((p): OverdueProjectItem => ({ ...p, type: 'project' })),
    ...tasks.map((tk): OverdueTaskItem => ({ ...tk, type: 'task' })),
  ].sort((a, b) => {
    if (b.days_overdue !== a.days_overdue) return b.days_overdue - a.days_overdue;
    return a.due_date.localeCompare(b.due_date);
  });

  if (items.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-muted-foreground">
        <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2 opacity-70" />
        {t('companyDashboardPage.noOverdue')}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-border text-left text-xs text-muted-foreground">
            <th className="px-4 sm:px-5 py-2.5 font-medium">{t('common.name')}</th>
            <th className="px-3 py-2.5 font-medium">
              {t('companyDashboardPage.colProjectDrawing')}
            </th>
            <th className="px-3 py-2.5 font-medium w-40">
              {t('companyDashboardPage.colAssignee')}
            </th>
            <th className="px-3 py-2.5 font-medium w-32">{t('companyDashboardPage.colOverdue')}</th>
            <th className="px-3 py-2.5 font-medium w-20 text-right">
              {t('companyDashboardPage.colProgress')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const severe = item.days_overdue > 30;
            return (
              <tr
                key={`${item.type}-${item.type === 'task' ? item.task_id : item.project_id}`}
                className="border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors"
              >
                <td className="px-4 sm:px-5 py-3 min-w-[200px]">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full mt-1.5 shrink-0',
                        severe ? 'bg-danger' : 'bg-warning',
                      )}
                    />
                    <div className="min-w-0 space-y-1">
                      <span className="font-medium truncate block">
                        {item.type === 'task' ? item.task_name : item.project_name}
                      </span>
                      <Badge variant={item.type === 'project' ? 'secondary' : 'outline'} className="text-micro px-1.5 py-0">
                        {item.type === 'project'
                          ? t('companyDashboardPage.badgeProject')
                          : t('companyDashboardPage.badgeTask')}
                      </Badge>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 min-w-[220px]">
                  <Link
                    to={`/app/projects/${item.project_id}`}
                    className="text-xs text-muted-foreground hover:text-primary block"
                  >
                    {item.type === 'project' ? (
                      <>
                        <span className="font-medium text-foreground">{item.project_name}</span>
                        <span> · {t('companyDashboardPage.projectDeadlineSuffix')}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">{item.project_name}</span>
                        <span>
                          {' '}
                          · {item.block_name} · {item.drawing_name}
                        </span>
                      </>
                    )}
                  </Link>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-micro text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    {formatDate(new Date(item.due_date))}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground truncate">
                  {item.type === 'task' ? (
                    (item.assignee_name ?? (
                      <span className="italic">{t('companyDashboardPage.noAssignee')}</span>
                    ))
                  ) : (
                    <span className="italic">{t('companyDashboardPage.projectDeadline')}</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-0.5 text-micro font-medium tabular-nums',
                      severe
                        ? 'text-danger bg-danger/10 border-danger/30'
                        : 'text-warning bg-warning/10 border-warning/30',
                    )}
                  >
                    {t('companyDashboardPage.daysUnit', { count: item.days_overdue })}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-right tabular-nums text-muted-foreground">
                  {item.progress.toFixed(0)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatPct(value: number | null | undefined): string {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (v > 0 && v < 1) return `${v.toFixed(2)}%`;
  if (v > 0 && v < 10) return `${v.toFixed(1).replace(/\.0$/, '')}%`;
  return `${v.toFixed(0)}%`;
}
