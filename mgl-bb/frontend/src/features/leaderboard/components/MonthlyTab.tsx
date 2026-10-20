import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Percent,
  Search,
  Users as UsersIcon,
} from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { formatPoints } from '@/shared/lib/score';
import { formatDate } from '@/shared/lib/time';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent } from '@/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/ui/table';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/ui/chart';
import type {
  LeaderboardMonthlyEntry,
  LeaderboardMonthlyResponse,
  LeaderboardMonthlyUserResponse,
} from '@/shared/types';

/* ============================================================
 *  «Сарын тайлан» таб
 *
 *  Нэг хуанлийн сард гишүүн бүрийн хийсэн ажил — хэдэн таск
 *  хөндсөн, хэдийг нь дуусгасан, нийт хэдэн хувь бөглөсөн.
 *  Мөрөн дээр дарахад тухайн хүний 12 сарын хандлага + сонгосон
 *  сарын таск бүрийн задаргаа хажуугийн самбарт нээгдэнэ.
 *
 *  «Бөглөсөн хувь» (pct_added) = таск бүр дээр өмнөх батлагдсан
 *  бүртгэлээс хойш нэмэгдсэн хувийн нийлбэр — тухайн хүн бодитоор
 *  хэдэн хувийн ажил хийснийг харуулна («Бүтээмж» нь төслийн
 *  хүндрэлээр жигнэсэн өөр хэмжигдэхүүн).
 * ============================================================ */

const MONTH_CHOICES = 18;

type SortKey =
  | 'pct_added'
  | 'tasks'
  | 'completed'
  | 'reports'
  | 'projects'
  | 'active_days'
  | 'points';

/** `YYYY-MM` дээр сар нэмэх/хасах (backend-ийн `monthAdd`-тай ижил). */
function monthAdd(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const zeroBased = year * 12 + (mon - 1) + delta;
  const y = Math.floor(zeroBased / 12);
  const m = zeroBased - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** UB-ийн одоогийн сар.  Сервер `todayInUB()`-ээр таслах тул клиент тал нь
 *  мөн Улаанбаатарын цагаар тооцно — өөр цагийн бүсээс нэвтэрсэн ч ижил
 *  сар нээгдэнэ. */
function currentMonthInUB(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

function monthLabel(month: string, lang: string): string {
  const year = month.slice(0, 4);
  const mon = Number(month.slice(5, 7));
  if (lang === 'en') {
    const d = new Date(Date.UTC(Number(year), mon - 1, 1));
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(d);
  }
  return `${year} оны ${mon}-р сар`;
}

/** График тэнхлэгт багтах богино хэлбэр — «8/26». */
function monthShort(month: string): string {
  return `${Number(month.slice(5, 7))}/${month.slice(2, 4)}`;
}

export default function MonthlyTab() {
  const { t, lang } = useLanguage();
  const [month, setMonth] = useState<string>(() => currentMonthInUB());
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('pct_added');
  const [openUserId, setOpenUserId] = useState<number | null>(null);

  const { data, isLoading, error } = useApiQuery<LeaderboardMonthlyResponse>(
    ['leaderboard-monthly', month],
    `/leaderboard/monthly?month=${month}`,
    { placeholderData: (prev) => prev },
  );

  // Сонгож болох саруудыг клиент талд үүсгэнэ (одоогийн сараас ухрааж).
  const thisMonth = currentMonthInUB();
  const monthOptions = useMemo(
    () => Array.from({ length: MONTH_CHOICES }, (_, i) => monthAdd(thisMonth, -i)),
    [thisMonth],
  );

  const entries = data?.entries ?? [];

  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, e) => ({
          reports: acc.reports + e.reports,
          tasks: acc.tasks + e.tasks,
          completed: acc.completed + e.completed,
          pct_added: acc.pct_added + e.pct_added,
          points: acc.points + e.points,
          active: acc.active + (e.reports > 0 ? 1 : 0),
        }),
        { reports: 0, tasks: 0, completed: 0, pct_added: 0, points: 0, active: 0 },
      ),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        (e.team_code ?? '').toLowerCase().includes(q) ||
        (e.team_name ?? '').toLowerCase().includes(q),
    );
  }, [entries, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => b[sortKey] - a[sortKey] || a.full_name.localeCompare(b.full_name));
    return arr;
  }, [filtered, sortKey]);

  // Чансаа нь эрэмбэлэлт/хайлтаас хамаарахгүй — үргэлж бөглөсөн хувиар.
  const rankByUserId = useMemo(() => {
    const map = new Map<number, number>();
    [...entries]
      .sort((a, b) => b.pct_added - a.pct_added)
      .forEach((e, i) => map.set(e.user_id, i + 1));
    return map;
  }, [entries]);

  const canPrev = monthOptions.includes(monthAdd(month, -1));
  const canNext = month < thisMonth;

  return (
    <div className="space-y-4">
      {/* Сар сонгогч */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          disabled={!canPrev}
          onClick={() => setMonth(monthAdd(month, -1))}
          aria-label={t('leaderboardMonthlyTab.prevMonth')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-9 w-[200px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {monthOptions.map((m) => (
              <SelectItem key={m} value={m} className="text-sm">
                {monthLabel(m, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          disabled={!canNext}
          onClick={() => setMonth(monthAdd(month, 1))}
          aria-label={t('leaderboardMonthlyTab.nextMonth')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Бүх хүний нийлбэр */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={<Percent className="h-3.5 w-3.5" />}
          label={t('leaderboardMonthlyTab.totalPctAdded')}
          value={formatPoints(totals.pct_added)}
          hint={t('leaderboardMonthlyTab.totalPctAddedHint')}
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label={t('leaderboardMonthlyTab.totalCompleted')}
          value={`${totals.completed}`}
          hint={t('leaderboardMonthlyTab.totalTasksHint', { count: totals.tasks })}
        />
        <SummaryCard
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label={t('leaderboardMonthlyTab.totalReports')}
          value={`${totals.reports}`}
          hint={t('leaderboardMonthlyTab.totalPointsHint', {
            points: formatPoints(totals.points),
          })}
        />
        <SummaryCard
          icon={<UsersIcon className="h-3.5 w-3.5" />}
          label={t('leaderboardMonthlyTab.activePeople')}
          value={`${totals.active}`}
          hint={t('leaderboardMonthlyTab.ofMembers', { count: entries.length })}
        />
      </div>

      {/* Хайлт */}
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          aria-label={t('common.search')}
          placeholder={t('leaderboardPage.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && !data ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('leaderboardPage.loading')}
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-destructive">
              {t('leaderboardPage.errorPrefix', { message: error.message })}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('leaderboardMonthlyTab.empty')}
            </div>
          ) : (
            <>
              {/* Гар утас — хөзрөөр */}
              <div className="flex flex-col gap-2 p-3 md:hidden">
                {sorted.map((e) => (
                  <button
                    key={e.user_id}
                    type="button"
                    onClick={() => setOpenUserId(e.user_id)}
                    className="rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                        {rankByUserId.get(e.user_id) ?? '—'}
                      </span>
                      <PersonAvatar entry={e} className="h-9 w-9" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {formatDisplayName(e.full_name)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {e.team_code ?? '—'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold tabular-nums">
                          {formatPoints(e.pct_added)}
                        </div>
                        <div className="text-label text-muted-foreground">
                          {t('leaderboardMonthlyTab.colPctAdded')}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-2 text-center text-xs">
                      <MiniStat value={e.tasks} label={t('leaderboardMonthlyTab.colTasks')} />
                      <MiniStat
                        value={e.completed}
                        label={t('leaderboardMonthlyTab.colCompleted')}
                      />
                      <MiniStat value={e.reports} label={t('leaderboardMonthlyTab.colReports')} />
                      <MiniStat
                        value={e.active_days}
                        label={t('leaderboardMonthlyTab.colActiveDays')}
                      />
                    </div>
                  </button>
                ))}
              </div>

              {/* Дэлгэц — хүснэгтээр */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{t('leaderboardPage.colMember')}</TableHead>
                      <TableHead>{t('leaderboardPage.colTeam')}</TableHead>
                      <SortableHead
                        label={t('leaderboardMonthlyTab.colPctAdded')}
                        col="pct_added"
                        active={sortKey}
                        onSort={setSortKey}
                      />
                      <SortableHead
                        label={t('leaderboardMonthlyTab.colTasks')}
                        col="tasks"
                        active={sortKey}
                        onSort={setSortKey}
                      />
                      <SortableHead
                        label={t('leaderboardMonthlyTab.colCompleted')}
                        col="completed"
                        active={sortKey}
                        onSort={setSortKey}
                      />
                      <SortableHead
                        label={t('leaderboardMonthlyTab.colReports')}
                        col="reports"
                        active={sortKey}
                        onSort={setSortKey}
                      />
                      <SortableHead
                        label={t('leaderboardPage.projectShort')}
                        col="projects"
                        active={sortKey}
                        onSort={setSortKey}
                      />
                      <SortableHead
                        label={t('leaderboardMonthlyTab.colActiveDays')}
                        col="active_days"
                        active={sortKey}
                        onSort={setSortKey}
                      />
                      <SortableHead
                        label={t('leaderboardPage.productivity')}
                        col="points"
                        active={sortKey}
                        onSort={setSortKey}
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((e) => (
                      <TableRow
                        key={e.user_id}
                        className="cursor-pointer"
                        onClick={() => setOpenUserId(e.user_id)}
                      >
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {rankByUserId.get(e.user_id) ?? '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <PersonAvatar entry={e} className="h-8 w-8" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {formatDisplayName(e.full_name)}
                              </div>
                              {e.position && (
                                <div className="truncate text-xs text-muted-foreground">
                                  {e.position}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {e.team_code ? (
                            <Badge variant="secondary" className="font-mono text-micro">
                              {e.team_code}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatPoints(e.pct_added)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{e.tasks}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {e.completed}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {e.reports}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {e.projects}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {e.active_days}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatPoints(e.points)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-micro text-muted-foreground">{t('leaderboardMonthlyTab.footnote')}</p>

      <PersonMonthSheet
        userId={openUserId}
        month={month}
        onClose={() => setOpenUserId(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Нэг хүний сарын задаргаа — хажуугийн самбар
// ─────────────────────────────────────────────────────────────────────

function PersonMonthSheet({
  userId,
  month,
  onClose,
}: {
  userId: number | null;
  month: string;
  onClose: () => void;
}) {
  const { t, lang } = useLanguage();
  const { data, isLoading } = useApiQuery<LeaderboardMonthlyUserResponse>(
    ['leaderboard-monthly-user', userId, month],
    `/leaderboard/monthly/${userId}?month=${month}&months=12`,
    { enabled: userId != null },
  );

  const chartConfig = {
    pct_added: {
      label: t('leaderboardMonthlyTab.colPctAdded'),
      color: 'var(--color-chart-2)',
    },
  } satisfies ChartConfig;

  const chartData = useMemo(
    () =>
      (data?.series ?? []).map((s) => ({
        label: monthShort(s.month),
        full: monthLabel(s.month, lang),
        pct_added: s.pct_added,
      })),
    [data, lang],
  );

  const selected = data?.series.find((s) => s.month === month);

  return (
    <Sheet open={userId != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="text-base">
            {data ? formatDisplayName(data.full_name) : t('leaderboardPage.loading')}
          </SheetTitle>
          <SheetDescription>
            {monthLabel(month, lang)}
            {data?.team_code ? ` · ${data.team_code}` : ''}
            {data?.position ? ` · ${data.position}` : ''}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="space-y-3 p-4">
            <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
            <div className="h-48 animate-pulse rounded-lg bg-muted/40" />
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {/* Сонгосон сарын дүн */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard
                icon={<Percent className="h-3.5 w-3.5" />}
                label={t('leaderboardMonthlyTab.colPctAdded')}
                value={formatPoints(selected?.pct_added ?? 0)}
              />
              <SummaryCard
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                label={t('leaderboardMonthlyTab.colCompleted')}
                value={`${selected?.completed ?? 0}`}
              />
              <SummaryCard
                icon={<ClipboardList className="h-3.5 w-3.5" />}
                label={t('leaderboardMonthlyTab.colReports')}
                value={`${selected?.reports ?? 0}`}
              />
              <SummaryCard
                icon={<CalendarDays className="h-3.5 w-3.5" />}
                label={t('leaderboardPage.productivity')}
                value={formatPoints(data.month_points)}
              />
            </div>

            {/* 12 сарын хандлага — нэг үзүүлэлт тул тайлбар хайрцаг хэрэггүй,
                гарчиг нь өөрөө нэрлэж байна. */}
            <div>
              <div className="mb-1 text-sm font-semibold">
                {t('leaderboardMonthlyTab.trendTitle')}
              </div>
              <ChartContainer config={chartConfig} className="aspect-auto h-48 w-full">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid vertical={false} strokeOpacity={0.35} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={6}
                    minTickGap={8}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10 }} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        indicator="dot"
                        labelFormatter={(_label, payload) =>
                          (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? ''
                        }
                      />
                    }
                  />
                  <Bar dataKey="pct_added" fill="var(--color-pct_added)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </div>

            {/* Тухайн сарын таскууд */}
            <div>
              <div className="mb-1 text-sm font-semibold">
                {t('leaderboardMonthlyTab.tasksTitle', { count: data.tasks.length })}
              </div>
              {data.tasks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                  {t('leaderboardMonthlyTab.noTasks')}
                </div>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {data.tasks.map((task) => (
                    <li key={task.task_id} className="flex items-start gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{task.task_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {task.project_name}
                          {task.block_name ? ` · ${task.block_name}` : ''}
                          {task.drawing_name ? ` · ${task.drawing_name}` : ''}
                        </div>
                        <div className="mt-0.5 text-micro text-muted-foreground">
                          {t('leaderboardMonthlyTab.taskMeta', {
                            reports: task.reports,
                            date: formatDate(task.last_date),
                          })}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-bold tabular-nums">
                          +{formatPoints(task.pct_added)}
                        </div>
                        <Badge
                          variant={task.end_pct >= 100 ? 'default' : 'secondary'}
                          className="mt-0.5 text-micro tabular-nums"
                        >
                          {formatPoints(task.end_pct)}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Жижиг тусламжийн бүрдлүүд
// ─────────────────────────────────────────────────────────────────────

function PersonAvatar({
  entry,
  className,
}: {
  entry: LeaderboardMonthlyEntry;
  className?: string;
}) {
  const name = formatDisplayName(entry.full_name);
  return (
    <Avatar className={cn('flex-shrink-0', className)}>
      {entry.profile_image && (
        <AvatarImage src={`${MEDIA_BASE_URL}${entry.profile_image}`} alt={name} />
      )}
      <AvatarFallback className="bg-primary/20 text-xs font-semibold text-primary">
        {name.substring(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-label text-muted-foreground">
          {icon} {label}
        </div>
        <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
        {hint && <div className="mt-0.5 text-micro text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function MiniStat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="text-micro text-muted-foreground">{label}</div>
    </div>
  );
}

function SortableHead({
  label,
  col,
  active,
  onSort,
}: {
  label: string;
  col: SortKey;
  active: SortKey;
  onSort: (k: SortKey) => void;
}) {
  return (
    <TableHead className="text-right">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSort(col)}
        className={cn(
          '-mx-1.5 h-7 px-1.5 text-xs font-medium',
          active === col ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </Button>
    </TableHead>
  );
}
