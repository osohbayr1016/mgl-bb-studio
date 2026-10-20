import { useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { MEDIA_BASE_URL, apiFetch } from '@/shared/api/client';
import { SignatureCapture } from '@/shared/components/SignatureCapture';
import { useLanguage } from '@/shared/i18n';
import { PageContainer } from '@/shared/components/PageContainer';
import { formatDisplayName } from '@/shared/lib/formatting';
import { useAuth } from '@/shared/context/AuthContext';
import type { UserProfile, MyProgressEntry } from '@/shared/types';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { Separator } from '@/ui/separator';
import { Input } from '@/ui/input';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import {
  ArrowLeft,
  Shield,
  Loader2,
  Users as UsersIcon,
  IdCard,
  Briefcase,
  TrendingUp,
  Activity,
  CheckCircle2,
  CalendarDays,
  FolderKanban,
  ListCheck,
  ExternalLink,
  Clock,
  AlertCircle,
  Lock,
  Image as ImageIcon,
  Coffee,
  Search,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { roleBadgeTone } from '@/shared/lib/status-colors';
import { roleLabelKey } from '@/shared/lib/roles';
import { UserPgpPanel } from '@/features/pgp';
import { brand } from '@/shared/config/brand';
import { fmtHours } from '@/features/reports/lib/format';
import { NonProjectLogRow, RepairLogRow } from './HoursLogRows';
import OfficialTimerDaysCard from '@/features/task-timer/OfficialTimerDaysCard';
import {
  fmtRate,
  npwCredited,
  npwHours,
  type HoursLogResponse,
  type NonProjectLogItem,
  type RepairLogItem,
} from './hoursLog';

import { formatDate } from '@/shared/lib/time';
interface TaskItem {
  id: number;
  name: string;
  /** Always 'task' since the subtask layer was dropped — kept for callers
   *  that haven't been refactored yet. */
  item_type: 'task';
  task_id: number | null;
  task_name: string | null;
  block_name: string;
  component_name: string;
  project_id: number;
  project_name: string;
  due_date: string | null;
  start_date: string | null;
  current_progress: number;
  reported_today: boolean;
  reported_today_rest: boolean;
  reported_today_status: 'pending' | 'approved' | 'rejected' | null;
}

interface ProjectGroup {
  project_id: number;
  project_name: string;
  items: TaskItem[];
  avg_progress: number;
}

interface TasksResponse {
  items: TaskItem[];
  projects: ProjectGroup[];
  summary: {
    total: number;
    completed: number;
    in_progress: number;
    not_started: number;
    today: string;
    reported_today: number;
    pending_today: number;
  };
}

export default function UserProfileViewPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: viewer } = useAuth();
  const { t } = useLanguage();
  const targetId = parseInt(id ?? '0', 10);
  const isAdmin = !!viewer && ['admin'].includes(viewer.role);
  // Admin + senior (багийн ахлагч) — ажилтны PGP-г харж санал өгнө.
  const isPrivileged = !!viewer && ['admin', 'senior'].includes(viewer.role);

  // If someone lands on their own /app/users/:id, send them to the editable /app/profile.
  useEffect(() => {
    if (viewer && targetId === viewer.id) {
      navigate('/app/profile', { replace: true });
    }
  }, [viewer, targetId, navigate]);

  const profileQuery = useApiQuery<{ user: UserProfile }>(
    ['/profiles', targetId],
    `/profiles/${targetId}`,
    { enabled: !!targetId, retry: false },
  );
  const profile: UserProfile | null = profileQuery.data?.user ?? null;
  const loadingProfile = profileQuery.isLoading;
  const notFound = !!profileQuery.error;

  const tasksQuery = useApiQuery<TasksResponse>(
    ['/profiles/tasks', targetId],
    `/profiles/${targetId}/tasks`,
    { enabled: !!targetId, retry: false },
  );
  const tasksData: TasksResponse | null = tasksQuery.data ?? null;
  const loadingTasks = tasksQuery.isLoading;

  const activityQuery = useApiQuery<{ entries: MyProgressEntry[] }>(
    ['/profiles/activity', targetId],
    `/profiles/${targetId}/activity?limit=150`,
    { enabled: !!targetId, retry: false },
  );
  const activity: MyProgressEntry[] = activityQuery.data?.entries ?? [];
  const loadingActivity = activityQuery.isLoading;
  const activityForbidden = useMemo(() => {
    const err = activityQuery.error;
    if (!err) return false;
    const msg = err instanceof Error ? err.message : '';
    return msg.toLowerCase().includes('forbid');
  }, [activityQuery.error]);

  // Засвар + төслийн бус ажил — цаг, өдрийн дундаж хувь (`/:id/hours-log`).
  // Эрх нь activity-тэй ижил; 403 бол activity-ийн «Хандах эрхгүй» харагдана.
  const hoursQuery = useApiQuery<HoursLogResponse>(
    ['/profiles/hours-log', targetId],
    `/profiles/${targetId}/hours-log?limit=150`,
    { enabled: !!targetId, retry: false },
  );
  const hoursLog = hoursQuery.data;
  const hasHoursLog = (hoursLog?.repairs.length ?? 0) > 0 || (hoursLog?.non_project.length ?? 0) > 0;

  // Явцын түүхийн шүүлт (текст + огноо) ба өдрөөр бүлэглэл.
  const [activitySearch, setActivitySearch] = useState('');
  const [activityDate, setActivityDate] = useState('');
  const activityByDay = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    const keep = (date: string, hay: string) =>
      (!activityDate || date === activityDate) && (!q || hay.toLowerCase().includes(q));

    type DayGroup = {
      date: string;
      entries: MyProgressEntry[];
      repairs: RepairLogItem[];
      nonProject: NonProjectLogItem[];
      totalDelta: number;
      /** Засвар + төслийн бус ажлын цаг (татгалзсан ажил орохгүй). */
      hours: number;
      /** Тэдгээрээс бүтээмжид олгосон хувь (өдрийн дундаж × цаг / 8). */
      creditedPct: number;
    };
    const byDate = new Map<string, DayGroup>();
    const groupOf = (date: string) => {
      let g = byDate.get(date);
      if (!g) {
        g = { date, entries: [], repairs: [], nonProject: [], totalDelta: 0, hours: 0, creditedPct: 0 };
        byDate.set(date, g);
      }
      return g;
    };

    for (const e of activityQuery.data?.entries ?? []) {
      // Зөвхөн хувь нь өөрчлөгдсөн (delta ≠ 0) бичлэгийг харуулна —
      // өөрчлөлтгүй/давтсан тайлан (мөн амарсан өдөр) харагдахгүй.
      if ((e.delta_pct ?? 0) === 0) continue;
      if (
        !keep(
          e.date,
          `${e.task_name ?? ''} ${e.project_name ?? ''} ${e.block_name ?? ''} ${e.component_name ?? ''} ${e.notes ?? ''}`,
        )
      )
        continue;
      const g = groupOf(e.date);
      g.entries.push(e);
      g.totalDelta += Math.max(0, e.delta_pct ?? 0);
    }
    for (const r of hoursLog?.repairs ?? []) {
      if (!keep(r.date, `${r.task_name ?? ''} ${r.project_name ?? ''} ${r.description ?? ''}`)) continue;
      const g = groupOf(r.date);
      g.repairs.push(r);
      g.hours += r.hours;
      g.creditedPct += r.computed_pct ?? 0;
    }
    for (const n of hoursLog?.non_project ?? []) {
      if (!keep(n.date, `${n.category_label} ${n.note ?? ''} ${n.report ?? ''}`)) continue;
      const g = groupOf(n.date);
      g.nonProject.push(n);
      g.hours += npwHours(n);
      g.creditedPct += npwCredited(n);
    }
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [activityQuery.data, hoursLog, activitySearch, activityDate]);

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-semibold">{t('userProfileViewPage.userNotFound')}</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t('userProfileViewPage.back')}
        </Button>
      </div>
    );
  }

  if (loadingProfile || !profile) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    );
  }

  const displayName = formatDisplayName(profile.full_name);
  const initials = displayName ? displayName.substring(0, 2).toUpperCase() : '??';
  const avatarSrc = profile.profile_image ? `${MEDIA_BASE_URL}${profile.profile_image}` : undefined;
  const coverSrc = profile.cover_image ? `${MEDIA_BASE_URL}${profile.cover_image}` : undefined;
  const teamName = profile.team_name_mn || profile.team_name_en;
  const teamCode = profile.team_code;
  const position = profile.position;

  const sum = tasksData?.summary;
  const projects = tasksData?.projects ?? [];

  return (
    <PageContainer>
      {/* Back button */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t('userProfileViewPage.back')}
        </Button>
      </div>

      {/* Admin: manage this employee's saved signature */}
      {isAdmin && (
        <Card className="border-border bg-card/60 backdrop-blur">
          <CardContent className="p-5 space-y-3">
            <h3 className="text-sm font-semibold">{t('signature.adminTitle')}</h3>
            <SignatureCapture
              value={(profile as { signature_url?: string | null }).signature_url ?? null}
              onChange={async (url) => {
                try {
                  await apiFetch(`/users/${targetId}`, {
                    method: 'PUT',
                    data: { signature_url: url },
                  });
                  await profileQuery.refetch();
                } catch (err) {
                  console.error('signature save failed', err);
                }
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Hero card */}
      <Card className="border-border bg-card/60 backdrop-blur overflow-hidden">
        <div className="relative h-36">
          {coverSrc ? (
            <img src={coverSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/30 via-primary/10 to-transparent" />
          )}
        </div>
        <CardContent className="relative px-6 pb-6">
          <div className="flex items-end gap-4 -mt-12">
            <Avatar className="h-24 w-24 border-4 border-background shadow-xl flex-shrink-0">
              {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
              <AvatarFallback className="bg-primary/20 text-primary text-2xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="pb-1 min-w-0">
              <h2 className="text-xl font-bold text-foreground truncate">{displayName}</h2>
              <p className="text-sm text-muted-foreground">@{profile.username}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-5">
            <InfoCell
              label={t('userProfileViewPage.employeeId')}
              value={profile.employee_id ?? `#${profile.id.toString().padStart(4, '0')}`}
              mono
            />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('userProfileViewPage.role')}</p>
              <Badge
                variant="outline"
                className={cn('capitalize font-medium', roleBadgeTone(profile.role))}
              >
                <Shield className="h-3 w-3 mr-1" />
                {t(roleLabelKey(profile.role))}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('userProfileViewPage.team')}</p>
              {profile.teams?.length ? (
                <div className="flex flex-wrap gap-1">
                  {profile.teams
                    .slice()
                    .sort((a, b) => b.is_primary - a.is_primary)
                    .map((t) => (
                      <Badge
                        key={t.id}
                        variant="outline"
                        className={cn(
                          'font-medium',
                          t.is_primary
                            ? 'bg-primary/10 text-primary border-primary/30'
                            : 'bg-muted text-muted-foreground border-border',
                        )}
                      >
                        <code className="font-mono text-micro mr-1 opacity-70">{t.code}</code>
                        <span className="truncate max-w-[100px]">{t.name_mn}</span>
                      </Badge>
                    ))}
                </div>
              ) : teamName ? (
                <Badge
                  variant="outline"
                  className="bg-primary/10 text-primary border-primary/30 font-medium"
                >
                  {teamCode && (
                    <code className="font-mono text-micro mr-1 opacity-70">{teamCode}</code>
                  )}
                  <span className="truncate max-w-[140px]">{teamName}</span>
                </Badge>
              ) : (
                <span className="text-xs italic text-muted-foreground">
                  {t('userProfileViewPage.unassigned')}
                </span>
              )}
            </div>
            <InfoCell label={t('userProfileViewPage.position')} value={position ?? '—'} />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('userProfileViewPage.status')}</p>
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    profile.status === 'active' ? 'bg-success' : 'bg-destructive',
                  )}
                />
                <span className="text-sm font-medium">
                  {profile.status === 'active'
                    ? t('userProfileViewPage.statusActive')
                    : t('userProfileViewPage.statusInactive')}
                </span>
              </div>
            </div>
            <InfoCell
              label={t('userProfileViewPage.memberSince')}
              value={formatDate(new Date(profile.created_at))}
            />
          </div>

          {profile.bio && (
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{profile.bio}</p>
          )}
          {profile.description && (
            <p className="mt-2 text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
              {profile.description}
            </p>
          )}

        </CardContent>
      </Card>

      {/* Body: side panel + tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
        {/* ---- Side panel ---- */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          {/* Team card */}
          <Card className="border-border bg-card/60 backdrop-blur overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 bg-gradient-to-r from-primary/10 to-transparent flex items-center gap-2">
              <UsersIcon className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                {(profile.teams?.length ?? 0) > 1
                  ? t('userProfileViewPage.teams')
                  : t('userProfileViewPage.teamSingular')}
              </h3>
            </div>
            <CardContent className="pt-5 space-y-4">
              {profile.teams?.length ? (
                <>
                  <div className="space-y-3">
                    {profile.teams
                      .slice()
                      .sort((a, b) => b.is_primary - a.is_primary)
                      .map((team) => (
                        <div key={team.id} className="flex items-center gap-3">
                          <div
                            className={cn(
                              'h-12 w-12 rounded-xl flex items-center justify-center shadow-md shrink-0',
                              team.is_primary
                                ? 'bg-gradient-to-br from-primary to-primary/60 shadow-primary/20'
                                : 'bg-gradient-to-br from-muted-foreground/40 to-muted-foreground/20 shadow-muted-foreground/10',
                            )}
                          >
                            <span className="font-mono text-xs font-bold text-primary-foreground">
                              {team.code}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="font-semibold text-foreground truncate">{team.name_mn}</p>
                              {team.is_primary === 1 && (
                                <Badge
                                  variant="outline"
                                  className="text-micro px-1 py-0 h-4 bg-primary/10 text-primary border-primary/30 shrink-0"
                                >
                                  {t('userProfileViewPage.primary')}
                                </Badge>
                              )}
                            </div>
                            {team.name_en && (
                              <p className="text-xs text-muted-foreground truncate">{team.name_en}</p>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                  <Separator />
                  <div className="space-y-2 text-xs">
                    <InfoRow
                      icon={IdCard}
                      label={t('userProfileViewPage.employeeId')}
                      value={profile.employee_id ?? '—'}
                      mono
                    />
                    <InfoRow
                      icon={Briefcase}
                      label={t('userProfileViewPage.position')}
                      value={position ?? '—'}
                    />
                    <InfoRow
                      icon={Shield}
                      label={t('userProfileViewPage.role')}
                      value={t(roleLabelKey(profile.role))}
                    />
                  </div>
                </>
              ) : teamName ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-md shadow-primary/20 shrink-0">
                      <span className="font-mono text-xs font-bold text-primary-foreground">
                        {teamCode ?? brand().nameShort}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{teamName}</p>
                      {position && (
                        <p className="text-xs text-muted-foreground truncate">{position}</p>
                      )}
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2 text-xs">
                    <InfoRow
                      icon={IdCard}
                      label={t('userProfileViewPage.employeeId')}
                      value={profile.employee_id ?? '—'}
                      mono
                    />
                    <InfoRow
                      icon={Briefcase}
                      label={t('userProfileViewPage.position')}
                      value={position ?? '—'}
                    />
                    <InfoRow
                      icon={Shield}
                      label={t('userProfileViewPage.role')}
                      value={t(roleLabelKey(profile.role))}
                    />
                  </div>
                </>
              ) : (
                <div className="text-center py-6">
                  <UsersIcon className="h-8 w-8 mx-auto mb-2 text-muted-subtle" />
                  <p className="text-sm font-medium">{t('userProfileViewPage.noTeamAssigned')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Work summary */}
          <Card className="border-border bg-card/60 backdrop-blur">
            <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                {t('userProfileViewPage.workSummary')}
              </h3>
            </div>
            <CardContent className="p-0 divide-y divide-border/50">
              <StatRow
                icon={ListCheck}
                color="text-primary"
                bg="bg-primary/10"
                label={t('userProfileViewPage.totalTasks')}
                value={loadingTasks ? '…' : (sum?.total ?? 0)}
              />
              <StatRow
                icon={TrendingUp}
                color="text-warning"
                bg="bg-warning/10"
                label={t('userProfileViewPage.inProgress')}
                value={loadingTasks ? '…' : (sum?.in_progress ?? 0)}
              />
              <StatRow
                icon={CheckCircle2}
                color="text-success"
                bg="bg-success/10"
                label={t('userProfileViewPage.done')}
                value={loadingTasks ? '…' : (sum?.completed ?? 0)}
              />
              <StatRow
                icon={Clock}
                color="text-muted-foreground"
                bg="bg-muted"
                label={t('userProfileViewPage.todayReport')}
                value={loadingTasks ? '…' : `${sum?.reported_today ?? 0}/${sum?.total ?? 0}`}
              />
            </CardContent>
          </Card>

        </aside>

        {/* ---- Right: Tabs ---- */}
        <KeepAliveTabs defaultValue={isPrivileged && searchParams.get('tab') === 'pgp' ? 'pgp' : 'tasks'}>
          <TabsList className="w-full">
            <TabsTrigger value="tasks" className="flex-1 gap-2">
              <FolderKanban className="h-4 w-4" />
              {t('userProfileViewPage.tabCurrentWork')}
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex-1 gap-2">
              <Activity className="h-4 w-4" />
              {t('userProfileViewPage.tabDailyReport')}
            </TabsTrigger>
            {isPrivileged && (
              <TabsTrigger value="pgp" className="flex-1 gap-2">
                <Sparkles className="h-4 w-4" />
                {t('pgp.tabTitle')}
              </TabsTrigger>
            )}
          </TabsList>

          {/* ---------------- Tasks tab ---------------- */}
          <KeepAliveTabsPanel value="tasks" className="mt-4 space-y-4">
            {loadingTasks ? (
              <SkeletonCard />
            ) : projects.length === 0 ? (
              <EmptyCard
                icon={FolderKanban}
                title={t('userProfileViewPage.noTasksTitle')}
                subtitle={t('userProfileViewPage.noTasksSubtitle')}
              />
            ) : (
              projects.map((pg) => (
                <Card key={pg.project_id} className="border-border bg-card/60 backdrop-blur">
                  <div className="px-5 py-3 border-b border-border/60 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderKanban className="h-4 w-4 text-primary shrink-0" />
                      <Link
                        to={`/app/projects/${pg.project_id}`}
                        className="font-semibold text-foreground hover:text-primary transition-colors truncate"
                      >
                        {pg.project_name}
                      </Link>
                      <Badge variant="outline" className="text-micro ml-1">
                        {t('userProfileViewPage.taskCount', { count: pg.items.length })}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {t('userProfileViewPage.average')}
                      </span>
                      <ProgressPill value={pg.avg_progress} />
                      <Link
                        to={`/app/projects/${pg.project_id}`}
                        className="text-muted-foreground hover:text-foreground"
                        title={t('userProfileViewPage.viewProject')}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                  <div className="divide-y divide-border/40">
                    {pg.items.map((it) => (
                      <div
                        key={`${it.item_type}-${it.id}`}
                        className="px-5 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                      >
                        <ProgressPill value={it.current_progress} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground truncate">
                              {/* task_name is the parent grouping breadcrumb when shown */}
                              {it.name}
                            </p>
                            {it.reported_today && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-label px-1 py-0 shrink-0',
                                  it.reported_today_rest
                                    ? 'bg-info/10 text-info border-info/30'
                                    : it.reported_today_status === 'pending'
                                      ? 'bg-warning/10 text-warning border-warning/30'
                                      : 'bg-success/10 text-success border-success/30',
                                )}
                              >
                                {it.reported_today_rest
                                  ? t('userProfileViewPage.restDay')
                                  : t('userProfileViewPage.todayDone')}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {it.block_name} · {it.component_name}
                            {it.due_date && (
                              <span> · {t('userProfileViewPage.dueLabel', { date: it.due_date })}</span>
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))
            )}
          </KeepAliveTabsPanel>

          {/* ---------------- Activity (daily reports) tab ---------------- */}
          <KeepAliveTabsPanel value="activity" className="mt-4">
            {/* Албан ёсны таскийн цаг (▶/⏸, 0361) — өөрөө эсвэл admin; бусдад 403 → нуугдана. */}
            <OfficialTimerDaysCard userId={targetId} />
            <Card className="border-border bg-card/60 backdrop-blur">
              <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  {t('userProfileViewPage.dailyReportTitle')}
                </h3>
              </div>
              {activityForbidden ? (
                <CardContent className="py-10 text-center">
                  <Lock className="h-8 w-8 mx-auto mb-3 text-muted-subtle" />
                  <p className="text-sm font-medium text-foreground">
                    {t('userProfileViewPage.noAccess')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('userProfileViewPage.noAccessHint')}
                  </p>
                </CardContent>
              ) : loadingActivity || hoursQuery.isLoading ? (
                <CardContent>
                  <SkeletonList />
                </CardContent>
              ) : activity.length === 0 && !hasHoursLog ? (
                <CardContent>
                  <EmptyInline
                    icon={TrendingUp}
                    title={t('userProfileViewPage.noReportsTitle')}
                    subtitle={t('userProfileViewPage.noReportsSubtitle')}
                  />
                </CardContent>
              ) : (
                <>
                  {/* Шүүлтүүр: чөлөөт текст (task/project) + огноо */}
                  <div className="px-5 py-3 border-b border-border/40 flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[150px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={activitySearch}
                        onChange={(e) => setActivitySearch(e.target.value)}
                        placeholder={t('userProfileViewPage.searchPlaceholder')}
                        className="h-8 pl-8 text-sm"
                      />
                    </div>
                    <Input
                      type="date"
                      value={activityDate}
                      onChange={(e) => setActivityDate(e.target.value)}
                      className="h-8 w-auto text-sm"
                    />
                    {(activitySearch || activityDate) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setActivitySearch('');
                          setActivityDate('');
                        }}
                      >
                        {t('userProfileViewPage.clearFilter')}
                      </Button>
                    )}
                  </div>
                  {activityByDay.length === 0 ? (
                    <CardContent>
                      <EmptyInline
                        icon={Search}
                        title={t('userProfileViewPage.noMatchTitle')}
                        subtitle={t('userProfileViewPage.noMatchSubtitle')}
                      />
                    </CardContent>
                  ) : (
                    activityByDay.map((day) => (
                      <div key={day.date}>
                        <div className="sticky top-0 z-[1] bg-card/95 backdrop-blur px-5 py-2 border-b border-border/40 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <CalendarDays className="h-3.5 w-3.5 text-primary" />
                            {formatDate(new Date(day.date))}
                          </span>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {day.totalDelta > 0 && (
                              <Badge
                                variant="outline"
                                className="text-micro bg-success/10 text-success border-success/30"
                              >
                                +{Math.round(day.totalDelta)}%
                              </Badge>
                            )}
                            {day.hours > 0 && (
                              <Badge
                                variant="outline"
                                className="text-micro bg-primary/10 text-primary border-primary/30 tabular-nums gap-1"
                                title={t('userProfileViewPage.dayHoursTitle')}
                                data-testid="day-hours"
                              >
                                <Clock className="h-3 w-3" />
                                {fmtHours(day.hours)}
                              </Badge>
                            )}
                            {day.creditedPct > 0 && (
                              <Badge
                                variant="outline"
                                className="text-micro bg-info/10 text-info border-info/30 tabular-nums"
                                title={t('userProfileViewPage.dayCreditedTitle')}
                                data-testid="day-credited"
                              >
                                +{fmtRate(day.creditedPct)}
                              </Badge>
                            )}
                            <span className="text-micro text-muted-foreground">
                              {t('userProfileViewPage.entryCount', {
                                count: day.entries.length + day.repairs.length + day.nonProject.length,
                              })}
                            </span>
                          </div>
                        </div>
                        <div className="divide-y divide-border/40">
                          {day.entries.map((entry) => (
                            <ActivityRow key={entry.id} entry={entry} />
                          ))}
                          {day.repairs.map((r) => (
                            <RepairLogRow key={`r-${r.kind}-${r.id}`} item={r} />
                          ))}
                          {day.nonProject.map((n) => (
                            <NonProjectLogRow key={`n-${n.id}`} item={n} />
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </Card>
          </KeepAliveTabsPanel>

          {/* ---------------- PGP tab (admin + senior) ---------------- */}
          {isPrivileged && (
            <KeepAliveTabsPanel value="pgp" className="mt-4">
              <UserPgpPanel
                userId={targetId}
                userName={profile.full_name}
                teamCode={profile.team_code ?? null}
                teamName={profile.team_name_mn ?? null}
              />
            </KeepAliveTabsPanel>
          )}
        </KeepAliveTabs>
      </div>
    </PageContainer>
  );
}

/* ===================== Sub-components ===================== */

function InfoCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-medium text-foreground truncate', mono && 'font-mono')}>
        {value}
      </p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span
        className={cn(
          'font-medium text-foreground truncate max-w-[60%] text-right',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function StatRow({
  icon: Icon,
  color,
  bg,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0', bg)}>
        <Icon className={cn('h-4 w-4', color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
      </div>
    </div>
  );
}

function ProgressPill({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const tone =
    value >= 100
      ? 'bg-success/15 text-success border-success/30'
      : value > 0
        ? 'bg-warning/15 text-warning border-warning/30'
        : 'bg-muted text-muted-foreground border-border';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded border font-semibold tabular-nums shrink-0',
        tone,
        size === 'sm' ? 'h-7 w-10 text-micro' : 'h-7 px-2 text-xs',
      )}
    >
      {Number.isFinite(value) ? `${Math.round(value)}%` : '—'}
    </span>
  );
}

function SkeletonCard() {
  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardContent className="p-5 space-y-3 animate-pulse">
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="h-3 w-full bg-muted rounded" />
        <div className="h-3 w-3/4 bg-muted rounded" />
      </CardContent>
    </Card>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3 py-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 animate-pulse">
          <div className="h-8 w-8 rounded-full bg-muted flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyCard({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardContent className="py-12 text-center">
        <Icon className="h-10 w-10 mx-auto mb-3 text-muted-subtle" />
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function EmptyInline({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="py-10 text-center">
      <Icon className="h-10 w-10 mx-auto mb-3 text-muted-subtle" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function ActivityRow({ entry }: { entry: MyProgressEntry }) {
  const { t } = useLanguage();
  const isRest = entry.is_rest_day === 1;
  const statusTone =
    entry.status === 'approved'
      ? 'bg-success/10 text-success border-success/30'
      : entry.status === 'pending'
        ? 'bg-warning/10 text-warning border-warning/30'
        : 'bg-destructive/10 text-destructive border-destructive/30';
  const statusLabel =
    entry.status === 'approved'
      ? t('userProfileViewPage.statusApproved')
      : entry.status === 'pending'
        ? t('userProfileViewPage.statusPending')
        : t('userProfileViewPage.statusRejected');

  return (
    <div className="px-5 py-3 flex items-start gap-3 hover:bg-muted/30 transition-colors">
      <div
        className={cn(
          'h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold',
          isRest
            ? 'bg-info/20 text-info'
            : entry.percentage >= 100
              ? 'bg-success/20 text-success'
              : entry.percentage > 0
                ? 'bg-warning/20 text-warning'
                : 'bg-muted text-muted-foreground',
        )}
      >
        {isRest ? <Coffee className="h-3.5 w-3.5" /> : entry.percentage}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
            {entry.task_name || t('userProfileViewPage.unnamedItem')}
          </p>
          {!isRest && (entry.delta_pct ?? 0) > 0 && (
            <Badge
              variant="outline"
              className="text-micro bg-success/10 text-success border-success/30 shrink-0"
              title={t('userProfileViewPage.increasedBy')}
            >
              +{Math.round(entry.delta_pct ?? 0)}%
            </Badge>
          )}
          {isRest && (
            <Badge
              variant="outline"
              className="text-label bg-info/10 text-info border-info/30 "
            >
              {t('userProfileViewPage.restDay')}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn('text-label ', statusTone)}
          >
            {statusLabel}
          </Badge>
        </div>
        {(entry.project_name || entry.block_name || entry.component_name) && (
          <p className="text-micro text-muted-foreground truncate mt-0.5">
            {[entry.project_name, entry.block_name, entry.component_name]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {entry.notes && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.notes}</p>
        )}
        {entry.status === 'rejected' && entry.review_note && (
          <p className="text-xs text-destructive/90 mt-0.5">
            {t('userProfileViewPage.reviewerNote', { note: entry.review_note })}
          </p>
        )}
        {entry.image_url && (
          <a
            href={`${MEDIA_BASE_URL}${entry.image_url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-1.5 rounded overflow-hidden border border-border hover:ring-2 hover:ring-primary transition"
          >
            <img
              src={`${MEDIA_BASE_URL}${entry.image_url}`}
              alt="attachment"
              className="h-14 w-20 object-cover"
            />
          </a>
        )}
        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
          <CalendarDays className="h-3 w-3" />
          {formatDate(new Date(entry.date))}
          {entry.image_url && (
            <span className="inline-flex items-center gap-0.5 ml-2 text-micro text-info">
              <ImageIcon className="h-3 w-3" /> {t('userProfileViewPage.image')}
            </span>
          )}
        </div>
      </div>
      <div
        className={cn(
          'text-xs font-semibold px-2 py-1 rounded flex-shrink-0',
          isRest
            ? 'bg-info/10 text-info'
            : entry.percentage >= 100
              ? 'bg-success/10 text-success'
              : entry.percentage > 0
                ? 'bg-warning/10 text-warning'
                : 'bg-muted text-muted-foreground',
        )}
      >
        {isRest ? '— ' : `${entry.percentage}%`}
      </div>
    </div>
  );
}
