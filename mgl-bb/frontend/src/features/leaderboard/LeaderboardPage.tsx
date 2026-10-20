import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy,
  Medal,
  Search,
  Users as UsersIcon,
  TrendingUp,
  Calendar,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/api/useApi';
import { MEDIA_BASE_URL, apiFetch } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import { isAdminTier } from '@/shared/lib/score';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatPoints } from '@/shared/lib/score';
import { LeaveAdjustedMark } from '@/shared/components/LeaveAdjustedMark';
import { formatDate } from '@/shared/lib/time';
import { formatDisplayName } from '@/shared/lib/formatting';
import { LEADERBOARD_TIER_TONE } from '@/shared/lib/status-colors';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/ui/table';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Switch } from '@/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { cn } from '@/shared/lib/utils';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { useLanguage } from '@/shared/i18n';
import { m } from 'motion/react';
import { popIn } from '@/shared/lib/motion';
import MonthlyTab from './components/MonthlyTab';
import LeaderboardChartsTab from './components/LeaderboardChartsTab';
import type { LeaderboardAveragesEntry, LeaderboardAveragesResponse } from '@/shared/types';

/* ============================================================
 *  Бүтээмжийн самбар (Productivity Leaderboard)
 *
 *  Admin-only ranked view of every leaderboard-eligible
 *  (engineer / architect / senior) member's бүтээмж (%).
 *
 *  Гурван таб:
 *    • Жагсаалт    — сонгосон цонхны нийт + өдрийн дундаж
 *    • Сарын тайлан — хуанлийн сар тус бүрийн хийсэн таск / бөглөсөн хувь
 *    • Хандлага     — нэг хүний бүтээмж / хоцролт / цагийн график
 * ============================================================ */

type Period = 7 | 30 | 90;

const PERIOD_OPTIONS: { value: Period; labelKey: string }[] = [
  { value: 7, labelKey: 'leaderboardPage.days7' },
  { value: 30, labelKey: 'leaderboardPage.days30' },
  { value: 90, labelKey: 'leaderboardPage.days90' },
];

type SortKey = 'rank' | 'total' | 'daily';

/** Табны утгууд нь глобал хайлтын гүн холбоосын бай (`?tab=…`) — эдгээрийг
 *  `frontend/src/shared/lib/search/sections.ts` давхар тусгасан тул нэрийг
 *  солих бол хоёуланг нь зэрэг солино. */
const LEADERBOARD_TABS = ['list', 'monthly', 'trend'] as const;
type LeaderboardTab = (typeof LEADERBOARD_TABS)[number];

/** «Сарын тайлан» таб өөрийн сар сонгогчтой тул толгойн 7/30/90 хоногийн
 *  сэлгүүр түүн дээр утгагүй — зөвхөн эдгээр табд харагдана. */
const PERIOD_TABS = new Set<LeaderboardTab>(['list', 'trend']);

const ROLE_LABEL_KEY: Record<string, string> = {
  engineer: 'leaderboardPage.roleEngineer',
  architect: 'leaderboardPage.roleArchitect',
  senior: 'leaderboardPage.roleSenior',
  // CEO (hardcode admin id 2) бүтээмжийн самбарт орж ирэхэд түүхий "admin"
  // биш «Гүйцэтгэх захирал» гэж харагдана.
  admin: 'leaderboardPage.roleCeo',
};

function rankAccent(rank: number): string {
  if (rank === 1) return 'bg-warning/15 text-warning border-warning/40';
  if (rank === 2) return 'bg-slate-300/20 text-slate-700 dark:text-slate-200 border-slate-400/40';
  if (rank === 3)
    return 'bg-warning/15 text-warning border-warning/40';
  return 'bg-muted text-muted-foreground border-transparent';
}

/** Гишүүдийг бүтээмжийн зэргээр гурван ангид хуваана:
 *   - top  (эхний 10)            → ногоон
 *   - low  (сүүлийн 10)          → улаан
 *   - mid  (дунд бусад нь)       → цэнхэр
 * Эхний 10-г ногоон, сүүлийн 10-г улаан, хооронд нь бүгдийг цэнхэр.
 * Жагсаалт богино (≤20) үед ногоон зэрэг давамгайлж, давхцахаас сэргийлнэ. */
type RankTier = 'top' | 'mid' | 'low';
function rankTier(rank: number, total: number): RankTier {
  if (rank <= 10) return 'top';
  if (rank > total - 10) return 'low';
  return 'mid';
}

/** Шинэ ажилтны өдрийн дундаж цөөн АЖИЛЛАСАН өдрөөр бодогдсоныг ил харуулна
 *  (backend lib/dailyAverage.ts: ажилд орсноос хойшхи өдрөөрөө, 21-д биш).
 *  Бүтэн цонхтой хүнд юу ч харуулахгүй. */
function NewHireAvgMark({ days, target }: { days: number; target: number }) {
  const { t } = useLanguage();
  if (!(target > 0) || days >= target) return null;
  const label = days > 0 ? t('leaderboardPage.avgNewHire', { count: days }) : t('leaderboardPage.avgNoDays');
  return (
    <span title={label} aria-label={label} className="ml-1 text-micro font-normal text-muted-foreground">
      {days > 0 ? t('leaderboardPage.avgNewHireShort', { count: days }) : '—'}
    </span>
  );
}

export default function LeaderboardPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [days, setDays] = useState<Period>(30);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [tab, setTab] = useTabParam(LEADERBOARD_TABS, 'list', 'tab');

  const isAdmin = isAdminTier(user?.role);

  const { data, isLoading, error } = useApiQuery<LeaderboardAveragesResponse>(
    ['leaderboard-averages', days],
    `/leaderboard/averages?days=${days}`,
    { enabled: isAdmin, placeholderData: (prev) => prev },
  );

  // CEO-г бүтээмжийн самбарт харуулах эсэх admin toggle.
  const queryClient = useQueryClient();
  const { data: ceoSettings } = useApiQuery<{ ceo_on_leaderboard: boolean }>(
    ['leaderboard-settings'],
    '/leaderboard/settings',
    { enabled: isAdmin },
  );
  const ceoOnBoard = ceoSettings?.ceo_on_leaderboard ?? true;
  const [ceoSaving, setCeoSaving] = useState(false);
  const toggleCeoOnBoard = async () => {
    if (ceoSaving) return;
    setCeoSaving(true);
    try {
      await apiFetch('/leaderboard/settings', {
        method: 'PUT',
        data: { ceo_on_leaderboard: !ceoOnBoard },
      });
      await queryClient.invalidateQueries({ queryKey: ['leaderboard-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['leaderboard-averages'] });
    } finally {
      setCeoSaving(false);
    }
  };

  const entries = data?.entries ?? [];
  // Бүх эрхтэй гишүүний нийт тоо — өнгөний ангиллыг (top/mid/low) глобал
  // зэрэгт тулгуурлан тооцоход ашиглана (хайлт/эрэмбээс хамаарахгүй).
  const total = entries.length;

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
    const cmp = (a: LeaderboardAveragesEntry, b: LeaderboardAveragesEntry) => {
      switch (sortKey) {
        case 'daily':
          return b.avg_daily - a.avg_daily;
        case 'rank':
        case 'total':
        default:
          return b.total_points - a.total_points;
      }
    };
    return arr.sort(cmp);
  }, [filtered, sortKey]);

  // Rank is always derived from the raw (unsorted) total ordering — it
  // doesn't shuffle around when the user changes the column sort.
  const rankByUserId = useMemo(() => {
    const map = new Map<number, number>();
    [...entries]
      .sort((a, b) => b.total_points - a.total_points)
      .forEach((e, i) => map.set(e.user_id, i + 1));
    return map;
  }, [entries]);

  const stats = useMemo(() => {
    if (entries.length === 0) {
      return { top: null as LeaderboardAveragesEntry | null, count: 0, avgPct: 0 };
    }
    const top = [...entries].sort((a, b) => b.total_points - a.total_points)[0] ?? null;
    const sum = entries.reduce((s, e) => s + e.total_points, 0);
    return {
      top,
      count: entries.length,
      avgPct: entries.length > 0 ? sum / entries.length : 0,
    };
  }, [entries]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold">{t('leaderboardPage.adminOnlyTitle')}</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {t('leaderboardPage.adminOnlyDesc')}
        </p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('leaderboardPage.title')}
        description={t('leaderboardPage.description')}
        actions={
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:self-end">
            {/* CEO-г бүтээмжийн самбарт харуулах эсэх toggle (admin). */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('leaderboardPage.showCeoToggle')}</span>
              <Switch
                checked={ceoOnBoard}
                onCheckedChange={toggleCeoOnBoard}
                disabled={ceoSaving}
                aria-label={t('leaderboardPage.showCeoToggle')}
              />
            </div>
            {PERIOD_TABS.has(tab) && (
              <div className="flex gap-1 self-start rounded-lg bg-muted p-1 sm:self-end">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDays(opt.value)}
                    className={cn(
                      'h-8 rounded-md px-3 text-xs font-medium transition-colors',
                      days === opt.value
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as LeaderboardTab)} className="mt-4">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-[orientation=horizontal]/tabs:h-auto">
          <TabsTrigger value="list" className="h-auto flex-none gap-2 py-1.5">
            {t('leaderboardPage.tabList')}
          </TabsTrigger>
          <TabsTrigger value="monthly" className="h-auto flex-none gap-2 py-1.5">
            {t('leaderboardPage.tabMonthly')}
          </TabsTrigger>
          <TabsTrigger value="trend" className="h-auto flex-none gap-2 py-1.5">
            {t('leaderboardPage.tabTrend')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          {/* Summary cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card id="sec-leaderboard-top" className="scroll-mt-24">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <Medal className="h-3.5 w-3.5" />
                  {t('leaderboardPage.topPerformer')}
                </CardDescription>
                <CardTitle className="text-base truncate">
                  {formatDisplayName(stats.top?.full_name) || '—'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">
                  {formatPoints(stats.top?.total_points ?? 0)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {stats.top?.team_code ?? ''}
                </div>
              </CardContent>
            </Card>

            <Card id="sec-leaderboard-active" className="scroll-mt-24">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <UsersIcon className="h-3.5 w-3.5" />
                  {t('leaderboardPage.activeMembers')}
                </CardDescription>
                <CardTitle className="text-base">{t('leaderboardPage.totalLabel')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.count}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('leaderboardPage.lastNDays', { days })}
                </div>
              </CardContent>
            </Card>

            <Card id="sec-leaderboard-team-avg" className="scroll-mt-24">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {t('leaderboardPage.teamAverage')}
                </CardDescription>
                <CardTitle className="text-base">{t('leaderboardPage.perPerson')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatPoints(stats.avgPct)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('leaderboardPage.sumPerMember', { days })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              aria-label={t('common.search')}
              placeholder={t('leaderboardPage.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Table */}
          <Card id="sec-leaderboard-table" className="scroll-mt-24">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {t('leaderboardPage.loading')}
                </div>
              ) : error ? (
                <div className="py-12 text-center text-sm text-destructive">
                  {t('leaderboardPage.errorPrefix', { message: (error as Error).message })}
                </div>
              ) : sorted.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {t('leaderboardPage.emptyMembers')}
                </div>
              ) : (
                <>
                  {/* Mobile card list */}
                  <div className="md:hidden flex flex-col gap-2 p-3">
                    {sorted.map((e) => {
                      const rank = rankByUserId.get(e.user_id) ?? 0;
                      return (
                        <div
                          key={e.user_id}
                          role="button"
                          tabIndex={0}
                          onClick={() => navigate(`/app/users/${e.user_id}`)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                              ev.preventDefault();
                              navigate(`/app/users/${e.user_id}`);
                            }
                          }}
                          className={cn(
                            'rounded-lg border border-border bg-card p-3 shadow-sm transition-colors cursor-pointer',
                            LEADERBOARD_TIER_TONE[rankTier(rank, total)],
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <m.span
                              className={cn(
                                'inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold border flex-shrink-0',
                                rankAccent(rank),
                              )}
                              {...(rank <= 3
                                ? { variants: popIn, initial: 'hidden', animate: 'show' }
                                : {})}
                            >
                              {rank}
                            </m.span>
                            <Avatar className="h-9 w-9 flex-shrink-0">
                              {e.profile_image && (
                                <AvatarImage
                                  src={`${MEDIA_BASE_URL}${e.profile_image}`}
                                  alt={formatDisplayName(e.full_name)}
                                />
                              )}
                              <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                                {formatDisplayName(e.full_name).substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">
                                {formatDisplayName(e.full_name)}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {ROLE_LABEL_KEY[e.role] ? t(ROLE_LABEL_KEY[e.role]) : e.role}
                                {e.team_code ? ` · ${e.team_code}` : ''}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-base font-bold text-foreground">
                                {formatPoints(e.total_points)}
                                <LeaveAdjustedMark days={e.leave_days} actual={formatPoints(e.total_points_actual)} />
                              </div>
                              <div className="text-label text-muted-foreground ">
                                {t('leaderboardPage.productivity')}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border pt-2 text-xs">
                            <span className="text-micro text-muted-foreground">
                              {t('leaderboardPage.colDailyAvg')}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {formatPoints(e.avg_daily)}
                              <NewHireAvgMark days={e.avg_days} target={e.avg_target} />
                            </span>
                          </div>
                          {e.last_awarded_at && (
                            <div className="mt-2 flex items-center gap-1 text-micro text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {t('leaderboardPage.lastAt', { date: formatDate(e.last_awarded_at) })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortableHead
                            label="#"
                            col="rank"
                            active={sortKey}
                            onSort={setSortKey}
                            className="w-12"
                          />
                          <TableHead>{t('leaderboardPage.colMember')}</TableHead>
                          <TableHead>{t('leaderboardPage.colTeam')}</TableHead>
                          <SortableHead
                            label={t('leaderboardPage.productivity')}
                            col="total"
                            active={sortKey}
                            onSort={setSortKey}
                            align="right"
                          />
                          <SortableHead
                            label={t('leaderboardPage.colDailyAvg')}
                            col="daily"
                            active={sortKey}
                            onSort={setSortKey}
                            align="right"
                          />
                          <TableHead className="text-right">{t('leaderboardPage.colLast')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sorted.map((e) => {
                          const rank = rankByUserId.get(e.user_id) ?? 0;
                          return (
                            <TableRow
                              key={e.user_id}
                              className={cn(
                                'cursor-pointer',
                                LEADERBOARD_TIER_TONE[rankTier(rank, total)],
                              )}
                              onClick={() => navigate(`/app/users/${e.user_id}`)}
                            >
                              <TableCell>
                                <m.span
                                  className={cn(
                                    'inline-flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold border',
                                    rankAccent(rank),
                                  )}
                                  {...(rank <= 3
                                    ? { variants: popIn, initial: 'hidden', animate: 'show' }
                                    : {})}
                                >
                                  {rank}
                                </m.span>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <Avatar className="h-8 w-8 flex-shrink-0">
                                    {e.profile_image && (
                                      <AvatarImage
                                        src={`${MEDIA_BASE_URL}${e.profile_image}`}
                                        alt={formatDisplayName(e.full_name)}
                                      />
                                    )}
                                    <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                                      {formatDisplayName(e.full_name).substring(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">
                                      {formatDisplayName(e.full_name)}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {ROLE_LABEL_KEY[e.role] ? t(ROLE_LABEL_KEY[e.role]) : e.role}
                                      {e.position ? ` · ${e.position}` : ''}
                                    </div>
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
                              <TableCell className="text-right font-semibold">
                                {formatPoints(e.total_points)}
                                <LeaveAdjustedMark days={e.leave_days} actual={formatPoints(e.total_points_actual)} />
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                {formatPoints(e.avg_daily)}
                                <NewHireAvgMark days={e.avg_days} target={e.avg_target} />
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {e.last_awarded_at ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {formatDate(e.last_awarded_at)}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly">
          <MonthlyTab />
        </TabsContent>

        <TabsContent value="trend">
          <LeaderboardChartsTab days={days} people={entries} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function SortableHead({
  label,
  col,
  active,
  onSort,
  align = 'left',
  className,
}: {
  label: string;
  col: SortKey;
  active: SortKey;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const isActive = active === col;
  return (
    <TableHead className={cn(align === 'right' && 'text-right', className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSort(col)}
        className={cn(
          'h-7 px-1.5 -mx-1.5 text-xs font-medium',
          isActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </Button>
    </TableHead>
  );
}
