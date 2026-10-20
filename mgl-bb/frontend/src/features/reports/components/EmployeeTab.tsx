import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ClipboardList, Download, ExternalLink, FileSpreadsheet, FolderKanban, Hammer, Lightbulb, Loader2, Palmtree, UserSearch } from 'lucide-react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { toast } from '@/shared/components/Toast';
import { useApiQuery } from '@/shared/api/useApi';
import { mediaUrl } from '@/shared/api/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDisplayName, formatProjectShortName } from '@/shared/lib/formatting';
import { EmployeePicker } from '@/shared/components/EmployeePicker';
import type { MyProgressEntry, User } from '@/shared/types';
import type { HoursLogResponse } from '@/features/users/hoursLog';
import type { EmployeeDetailResponse, EmployeeLeaveRow, EmployeeSuggestionRow, ReportWindow } from '../types';
import { createGoogleSheet, useEmployeeHr, useEmployeeReport } from '../api';
import { sparkColLabel } from '../lib/windows';
import { leaveLabel, suggestionStatusLabel } from '../lib/labels';
import { RankBadge, Sparkline, TrendChip } from './Badges';
import { KpiTiles } from './KpiTiles';
import { HoursLateChart, PointsChart } from './EmployeeCharts';
import { NonProjectHoursCard } from './NonProjectHoursCard';
import { HrCard } from './HrCard';
import { EmployeeTasksCard } from './EmployeeTasksCard';
import { EmployeeActivityCard } from './EmployeeActivityCard';
import { fmtHours, fmtPts } from '../lib/format';

/**
 * Ажилтан таб — сонгогч → толгой (байр, хандлага, экспорт) → KPI → графикууд →
 * төслүүд + ирц/чөлөө → санал хүсэлт → HR карт.  Ирц, чөлөө, санал хүсэлт
 * БҮГД толгойн цонхыг дагана — `GET /reports/employees/:id` нэг хариунаас.
 */
export function EmployeeTab({
  userId,
  onPick,
  window,
  anchor,
}: {
  userId: number | null;
  onPick: (id: number) => void;
  window: ReportWindow;
  anchor: string;
}) {
  const { t } = useLanguage();
  const usersQuery = useApiQuery<{ users: User[] }>(['/users'], '/users');
  const staff = useMemo(
    () => (usersQuery.data?.users ?? []).filter((u) => u.role !== 'client' && u.role !== 'worker'),
    [usersQuery.data],
  );
  const { data, isLoading, isError } = useEmployeeReport(userId, window, anchor);
  // Цонхны явцын бичлэгүүд — Явцын бичлэгүүд карт, доор нь хураасан Даалгаврууд (цонхны ахиц).
  const actFrom = data?.window.from;
  const actTo = data?.window.to;
  const activityQuery = useApiQuery<{ entries: MyProgressEntry[] }>(
    ['/profiles/activity', userId, actFrom, actTo],
    `/profiles/${userId}/activity?from=${actFrom}&to=${actTo}&limit=1000`,
    { enabled: userId != null && !!actFrom && !!actTo, placeholderData: (prev) => prev },
  );
  const activity = activityQuery.data?.entries ?? [];
  // Засварын бүртгэл (цаг) — ижил цонхоор, «Явцын бичлэгүүд»-д өдрөөрөө нийлнэ.
  // Клиент талд ч цонхоор шүүнэ: `from`/`to`-г мэдэхгүй хуучин worker сүүлийн мөрүүдийг буцаадаг.
  const hoursQuery = useApiQuery<HoursLogResponse>(
    ['/profiles/hours-log', userId, actFrom, actTo],
    `/profiles/${userId}/hours-log?from=${actFrom}&to=${actTo}&limit=1000`,
    { enabled: userId != null && !!actFrom && !!actTo, placeholderData: (prev) => prev, retry: false },
  );
  const repairs = useMemo(
    () => (hoursQuery.data?.repairs ?? []).filter((r) => !!actFrom && !!actTo && r.date >= actFrom && r.date <= actTo),
    [hoursQuery.data, actFrom, actTo],
  );
  // Экспортод HR-ийн гэрээний хураангуй (нууц үг ХЭЗЭЭ Ч орохгүй) — HrCard-тай кэш хуваалцана.
  const hrQuery = useEmployeeHr(userId);
  const [exporting, setExporting] = useState<'xlsx' | 'gsheet' | null>(null);

  const runExport = async (target: 'xlsx' | 'gsheet') => {
    if (!data || userId == null) return;
    setExporting(target);
    try {
      const { buildEmployeeReportWorkbook, reportFileStem } = await import('../lib/exportEmployeeReport');
      const wb = await buildEmployeeReportWorkbook({ detail: data, hr: hrQuery.data ?? null, activity, t });
      const stem = reportFileStem(data);
      if (target === 'xlsx') {
        const { downloadWorkbook } = await import('@/features/attendance/admin/lib/excel');
        await downloadWorkbook(wb, `${stem}.xlsx`);
      } else {
        const bytes = await wb.xlsx.writeBuffer();
        const res = await createGoogleSheet(userId, bytes as ArrayBuffer, stem);
        // `window` нь энд ReportWindow prop тул глобалыг globalThis-ээр.
        const w = globalThis.open(res.url, '_blank', 'noopener');
        toast.success(t('reportsPage.exportGsheetDone'), w ? undefined : res.url);
      }
    } catch (err) {
      toast.error(t(target === 'xlsx' ? 'reportsPage.exportXlsx' : 'reportsPage.exportGsheet'), err instanceof Error ? err.message : undefined);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <EmployeePicker users={staff} value={userId} onChange={onPick} className="w-full sm:w-96" autoFocus={userId == null} />
        {data && userId != null && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={exporting != null} className="ml-auto">
                {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                {exporting ? t('reportsPage.exporting') : t('reportsPage.export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void runExport('gsheet')}>
                <FileSpreadsheet className="mr-2 h-4 w-4 text-success" />
                {t('reportsPage.exportGsheet')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void runExport('xlsx')}>
                <Download className="mr-2 h-4 w-4" />
                {t('reportsPage.exportXlsx')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {userId == null ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <UserSearch className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{t('reportsPage.pickEmployee')}</p>
          <p className="max-w-md text-xs text-muted-foreground">{t('reportsPage.pickEmployeeHint')}</p>
        </div>
      ) : isLoading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : isError || !data ? (
        <div className="py-16 text-center text-sm text-danger">{t('reportsPage.loadError')}</div>
      ) : (
        <>
          {/* ── Толгой ── */}
          <div id="sec-reports-employee" className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4 scroll-mt-24">
            <Avatar className="h-14 w-14">
              {data.user.profile_image && <AvatarImage src={mediaUrl(data.user.profile_image)} alt="" />}
              <AvatarFallback className="bg-primary/15 text-base font-semibold text-primary">
                {data.user.full_name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold leading-tight">{formatDisplayName(data.user.full_name)}</h2>
                {data.user.teams.map((tm) => (
                  <Badge key={tm.id} variant="outline" className={cn('font-mono text-[10px]', teamChipClass(tm.code), !tm.is_primary && 'opacity-70')}>
                    {tm.code}
                  </Badge>
                ))}
                {data.user.status !== 'active' && <Badge variant="outline">{t('reportsPage.inactive')}</Badge>}
                <Link to={`/app/users/${data.user.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  {data.user.username}
                </Link>
              </div>
              <div className="text-xs text-muted-foreground">
                {[data.user.employee_id, data.user.position, data.user.seniority].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-center">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportsPage.rank')}</div>
                {data.user.is_leaderboard_member ? (
                  <RankBadge rank={data.rank.now} pool={data.rank.pool_size} delta={data.rank.delta} source={data.rank.source} size="lg" />
                ) : (
                  <span className="text-xs text-muted-foreground">{t('reportsPage.notMember')}</span>
                )}
              </div>
              <div className="text-center">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportsPage.colTrend')}</div>
                <TrendChip trend={data.trend} />
              </div>
              <div className="text-center">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {sparkColLabel(t, data.sparkline.days)}
                </div>
                <Sparkline values={data.spark} width={120} height={36} />
              </div>
            </div>
          </div>

          {/* ── KPI: Бүтээмж + Засвар (хоцролт, чөлөө зөвхөн доорх Ирц картад) ── */}
          <KpiTiles metrics={data.metrics} period={data.window} />

          <AttendanceLeaveCard data={data} />

          {/* Жин 0 гинжин дээрх тайлан — оноо яагаад хөдлөөгүйг админ шууд харна (2026-09-16). */}
          {data.metrics.unweighted_entries > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{t('reportsPage.unweightedHint', { n: data.metrics.unweighted_entries })}</span>
            </div>
          )}

          {/* ── Явцын бичлэгүүд: цонхонд юу дээр ажилласан ── */}
          <EmployeeActivityCard
            entries={activity}
            repairs={repairs}
            isLoading={(activityQuery.isLoading && !activityQuery.data) || (hoursQuery.isLoading && !hoursQuery.data)}
            windowFrom={data.window.from}
            windowTo={data.window.to}
          />

          {/* ── Даалгаврууд: юу хуваарилагдсан, хэдэн хувь, төлөв (хураасан, доор нь) ── */}
          <EmployeeTasksCard userId={data.user.id} activity={activity} windowFrom={data.window.from} windowTo={data.window.to} />

          {/* ── Графикууд ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t('reportsPage.pointsChart')}</CardTitle>
                <CardDescription className="text-xs">
                  {t(`reportsPage.seriesGranularity.${data.series.granularity}`)} · {t('reportsPage.pointsChartHint')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PointsChart data={data} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t('reportsPage.hoursChart')}</CardTitle>
                <CardDescription className="text-xs">
                  {t('reportsPage.kpiHours')}: {fmtHours(data.metrics.hours_worked)} · {t('reportsPage.kpiLate')}:{' '}
                  {data.metrics.late_minutes}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HoursLateChart data={data} />
              </CardContent>
            </Card>
          </div>

          {/* ── Төслүүд ── */}
          <div className="grid gap-4">
            <Card id="sec-reports-projects" className="scroll-mt-24">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FolderKanban className="h-4 w-4 text-primary" />
                  {t('reportsPage.projects')}
                </CardTitle>
                <CardDescription className="text-xs">{t('reportsPage.projectsHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                {data.projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('reportsPage.noProjects')}</p>
                ) : (
                  <ProjectsList projects={data.projects} />
                )}
              </CardContent>
            </Card>
          </div>

          <NonProjectHoursCard work={data.non_project_work} windowFrom={data.window.from} windowTo={data.window.to} />

          {/* ── Санал хүсэлт (цонхонд илгээсэн, нэрээ нууцлаагүй) ── */}
          <SuggestionsCard rows={data.suggestions} windowFrom={data.window.from} windowTo={data.window.to} />

          {/* ── HR ── */}
          <HrCard key={data.user.id} userId={data.user.id} />
        </>
      )}
    </div>
  );
}

const LEAVE_STATUSES = ['approved', 'pending', 'rejected', 'cancelled'] as const;

/** Ирц (цонх) + чөлөөний хүсэлтүүд (цонхтой давхцсан, бүх төлөв). */
function AttendanceLeaveCard({ data }: { data: EmployeeDetailResponse }) {
  const { t } = useLanguage();
  const m = data.metrics;
  const leaveTotal = data.leaves.rows.length;
  return (
    <Card id="sec-reports-attendance" className="scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t('reportsPage.attendanceCard')}</CardTitle>
        <CardDescription className="text-xs">
          {t('reportsPage.periodRange', { from: data.window.from, to: data.window.to })} · {t('reportsPage.attendanceHint')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t('reportsPage.kpiHours')}</dt>
            <dd className="tabular-nums font-semibold">{fmtHours(m.hours_worked)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('reportsPage.kpiLate')}</dt>
            <dd className={cn('tabular-nums font-semibold', m.late_minutes > 0 && 'text-danger')}>{m.late_minutes}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('reportsPage.kpiLeave')}</dt>
            <dd className="tabular-nums font-semibold">{fmtHours(m.leave_hours)}</dd>
          </div>
          <div className="flex items-end">
            <Link to="/app/attendance/admin?tab=reports" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="h-3 w-3" />
              {t('reportsPage.attendanceLink')}
            </Link>
          </div>
        </dl>

        <div className="border-t border-border pt-3">
          <h4 className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Palmtree className="h-3 w-3" />
            {t('reportsPage.leavesInWindow', { n: leaveTotal })}
          </h4>
          {leaveTotal === 0 ? (
            <p className="text-xs text-muted-foreground">{t('reportsPage.leavesNone')}</p>
          ) : (
            <>
              <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums">
                {LEAVE_STATUSES.map((s) => {
                  const v = data.leaves.by_status[s];
                  if (!v) return null;
                  return (
                    <li key={s} className="flex gap-1.5 whitespace-nowrap">
                      <span className="text-muted-foreground">{t(`reportsPage.leaveStatus.${s}`)}:</span>
                      <span>
                        {t('reportsPage.days', { n: v.days })} · {v.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                {data.leaves.rows.map((l) => (
                  <LeaveRowItem key={l.id} row={l} />
                ))}
              </ul>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Чөлөөний хүсэлтийн нэг мөр — журмын нэр, огноо, төлөв. */
function LeaveRowItem({ row: l }: { row: EmployeeLeaveRow }) {
  const { t } = useLanguage();
  const range = l.start_date === l.end_date ? l.start_date : `${l.start_date} – ${l.end_date}`;
  const time = l.start_time && l.end_time ? ` ${l.start_time}–${l.end_time}` : '';
  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-border px-2 py-1">
      <span className="min-w-0">
        <span className="font-medium">{leaveLabel(l)}</span>
        <span className="text-muted-foreground">
          {' '}
          · {range}
          {time}
        </span>
        {l.reason && <div className="truncate text-[11px] text-muted-foreground">{l.reason}</div>}
      </span>
      <span className="flex shrink-0 flex-col items-end tabular-nums">
        <span>{t('reportsPage.days', { n: l.days })}</span>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px]',
            l.status === 'approved' && 'border-success/40 text-success',
            l.status === 'rejected' && 'border-danger/40 text-danger',
            l.status === 'pending' && 'border-warning/50 text-warning',
            l.status === 'cancelled' && 'text-muted-foreground',
          )}
        >
          {t(`reportsPage.leaveStatus.${l.status}`)}
        </Badge>
      </span>
    </li>
  );
}

/** Санал хүсэлт — цонхонд илгээсэн, зөвхөн нэрээ нууцлаагүй (нууцласан нь тайланд ХЭЗЭЭ Ч орохгүй). */
function SuggestionsCard({ rows, windowFrom, windowTo }: { rows: EmployeeSuggestionRow[]; windowFrom: string; windowTo: string }) {
  const { t } = useLanguage();
  return (
    <Card id="sec-reports-suggestions" className="scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightbulb className="h-4 w-4 text-warning" />
          {t('reportsPage.suggestions')}
          <span className="text-xs font-normal text-muted-foreground">· {rows.length}</span>
        </CardTitle>
        <CardDescription className="text-xs">
          {t('reportsPage.periodRange', { from: windowFrom, to: windowTo })} · {t('reportsPage.suggestionsHint')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reportsPage.suggestionsNone')}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((s) => (
              <li key={s.id} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{s.title}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {s.created_at.slice(0, 10)}
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        s.status === 'resolved' && s.resolution === 'approved' && 'border-success/40 text-success',
                        s.status === 'resolved' && s.resolution === 'rejected' && 'border-danger/40 text-danger',
                        s.status === 'discussing' && 'border-warning/50 text-warning',
                      )}
                    >
                      {suggestionStatusLabel(s, t)}
                    </Badge>
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{s.description}</p>
                {s.reviewer_note && (
                  <p className="mt-1 text-[11px]">
                    <span className="text-muted-foreground">{t('reportsPage.reviewNote')}: </span>
                    {s.reviewer_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectsList({ projects }: { projects: import('../types').EmployeeProjectRow[] }) {
  const { t } = useLanguage();
  const max = Math.max(...projects.map((p) => p.points), 0.0001);
  return (
    <ul className="space-y-1.5">
      {projects.map((p) => (
        <li key={`${p.project_id ?? 'r'}-${p.repair_project_id ?? 'p'}`} className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              {p.is_repair_project && <Hammer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              {p.is_non_project && <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              {p.project_id ? (
                <Link to={`/app/projects/${p.project_id}`} className="truncate hover:underline">
                  {formatProjectShortName(p.name)}
                </Link>
              ) : p.is_non_project ? (
                // Батлагдсан төслийн бус ажлын оноо (0343) — төсөлгүй, нэргүй НЭГ бүлэг.
                <span className="truncate">{t('nonProjectWork.title')}</span>
              ) : (
                <span className="truncate">
                  {p.name ?? '—'} <span className="text-xs text-muted-foreground">· {t('reportsPage.repairProject')}</span>
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold">{fmtPts(p.points)}</span>
              <span className="ml-1 text-[11px] text-muted-foreground">×{p.award_count}</span>
            </span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (p.points / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
