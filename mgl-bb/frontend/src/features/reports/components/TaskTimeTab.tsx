import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CalendarRange, ChevronDown, Clock, FolderKanban, Hash, Timer, Users } from 'lucide-react';
import { mediaUrl } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { cn } from '@/shared/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import OfficialTimerDaysCard from '@/features/task-timer/OfficialTimerDaysCard';
import OfficialTimerLiveCard from '@/features/task-timer/OfficialTimerLiveCard';
import StopwatchText from '@/features/task-timer/StopwatchText';
import type { OfficialReportResponse, OfficialReportRow } from '@/features/task-timer/officialTimer';
import type { ReportWindow } from '../types';
import { addDays } from '../lib/windows';
import { fmtInt } from '../lib/format';

/** `GET /task-timer/report`-ийн ажилтны задрал нь энэ хүртэл өдрийг л авна (backend MAX_REPORT_DAYS). */
const DRILL_MAX_DAYS = 62;

const nameOf = (r: OfficialReportRow) => formatDisplayName(r.full_name) || r.username;

/**
 * «Таскийн цаг» таб — АЛБАН ЁСНЫ таскийн цаг (▶/«Эхлүүлэх», migration 0361) нэг газарт:
 *   1. Одоо — хэн аль таск дээр ажиллаж байна (Ирц админаас энд шилжсэн карт).
 *   2. Сонгосон хугацааны нийлбэр — нийт цаг, ажилтан тус бүр, төслөөр.
 *   3. Ажилтныг дарахад өдөр × таск × бүртгэлийн хэсгүүд.
 *
 * ⚠️ Revit-ийн автомат цаг (0360) энд ХЭЗЭЭ Ч харагдахгүй, нэмэгдэхгүй — захирлын
 *    шийдвэр (2026-09-29): албан тоо нь зөвхөн ажилтны өөрөө удирдсан таймер.
 * Хугацаа нь хуудасны толгойн цонх/anchor-ыг дагана; «Одоо» карт дагахгүй.
 */
export function TaskTimeTab({ window, anchor }: { window: ReportWindow; anchor: string }) {
  const { t } = useLanguage();
  const q = useApiQuery<OfficialReportResponse>(
    ['/task-timer/report', window, anchor],
    `/task-timer/report?window=${window}&anchor=${anchor}`,
    { placeholderData: (prev) => prev, refetchInterval: 60_000 },
  );
  const data = q.data;
  const [openUser, setOpenUser] = useState<number | null>(null);

  const { active, idle } = useMemo(() => {
    const rows = [...(data?.rows ?? [])].sort(
      (a, b) => b.official_ms - a.official_ms || nameOf(a).localeCompare(nameOf(b)),
    );
    return { active: rows.filter((r) => r.official_ms > 0), idle: rows.filter((r) => r.official_ms === 0) };
  }, [data]);
  const [showIdle, setShowIdle] = useState(false);

  const range = data ? (data.from === data.to ? data.to : t('reportsPage.periodRange', { from: data.from, to: data.to })) : '';
  const totals = data?.totals;
  const avgPerPerson = totals && totals.active_people > 0 ? totals.official_ms / totals.active_people : 0;
  // Ажилтны задрал 62 өдрөөс урт муж (Бүх цаг г.м.) авахгүй — сүүлийн 62 өдрийг харуулна.
  const drillTo = data?.to ?? anchor;
  const drillFloor = addDays(drillTo, -(DRILL_MAX_DAYS - 1));
  const drillFrom = data && data.from > drillFloor ? data.from : drillFloor;
  const drillClamped = !!data && data.from < drillFloor;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t('reportsPage.ttHint')}</p>

      <OfficialTimerLiveCard />

      <section id="sec-reports-tasktime-period" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Timer className="h-3.5 w-3.5" aria-hidden />
            </span>
            {t('reportsPage.ttPeriodTitle')}
          </h3>
          {range && (
            <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden />
              {range}
            </span>
          )}
        </div>

        {q.isLoading && !data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : q.isError && !data ? (
          <p className="py-10 text-center text-sm text-destructive">{t('taskTimer.liveError')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Tile icon={Clock} label={t('reportsPage.ttKpiTotal')} hero>
                <StopwatchText baseMs={totals?.official_ms ?? 0} since={null} className="text-metric font-semibold" />
              </Tile>
              <Tile icon={Users} label={t('reportsPage.ttKpiPeople')}>
                <span className="text-metric font-semibold tabular-nums">
                  {fmtInt(totals?.active_people ?? 0)}
                  <span className="text-sm font-normal text-muted-foreground"> / {fmtInt(totals?.people ?? 0)}</span>
                </span>
              </Tile>
              <Tile icon={Timer} label={t('reportsPage.ttKpiAvg')} hint={t('reportsPage.ttKpiAvgHint')}>
                <StopwatchText baseMs={avgPerPerson} since={null} className="text-metric font-semibold" />
              </Tile>
              <Tile icon={Hash} label={t('reportsPage.ttKpiSessions')}>
                <span className="text-metric font-semibold tabular-nums">{fmtInt(totals?.sessions ?? 0)}</span>
              </Tile>
            </div>

            {active.length === 0 ? (
              <p className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
                {t('reportsPage.ttEmpty')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead className="w-8 text-right">#</TableHead>
                      <TableHead>{t('reportsPage.colEmployee')}</TableHead>
                      <TableHead className="text-right">{t('reportsPage.ttColTotal')}</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">{t('reportsPage.ttColDays')}</TableHead>
                      <TableHead className="hidden text-right md:table-cell">{t('reportsPage.ttColAvgDay')}</TableHead>
                      <TableHead className="hidden text-right md:table-cell">{t('reportsPage.ttColTasks')}</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">{t('reportsPage.ttColSessions')}</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {active.map((r, i) => {
                      const expanded = openUser === r.user_id;
                      return (
                        <Fragment key={r.user_id}>
                          <TableRow
                            className="cursor-pointer text-sm"
                            onClick={() => setOpenUser(expanded ? null : r.user_id)}
                            aria-expanded={expanded}
                            data-testid="tasktime-row"
                          >
                            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <Avatar className="h-8 w-8 shrink-0">
                                  {r.profile_image && <AvatarImage src={mediaUrl(r.profile_image)} alt="" />}
                                  <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                                    {nameOf(r).slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="truncate font-medium">{nameOf(r)}</span>
                                {r.running && (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-label normal-case tracking-normal text-success">
                                    <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                                    {t('taskTimer.statusWorking')}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              <StopwatchText baseMs={r.official_ms} since={null} />
                            </TableCell>
                            <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.active_days}</TableCell>
                            <TableCell className="hidden text-right md:table-cell">
                              <StopwatchText
                                baseMs={r.active_days > 0 ? r.official_ms / r.active_days : 0}
                                since={null}
                                className="text-muted-foreground"
                              />
                            </TableCell>
                            <TableCell className="hidden text-right tabular-nums md:table-cell">{r.tasks}</TableCell>
                            <TableCell className="hidden text-right tabular-nums lg:table-cell">{r.sessions}</TableCell>
                            <TableCell className="text-muted-foreground">
                              <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
                            </TableCell>
                          </TableRow>
                          {expanded && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={8} className="bg-muted/20 px-4 py-2">
                                <OfficialTimerDaysCard userId={r.user_id} from={drillFrom} to={drillTo} embedded />
                                {drillClamped && (
                                  <p className="mt-1 text-micro text-muted-foreground">
                                    {t('reportsPage.ttDrillClamped', { days: DRILL_MAX_DAYS })}
                                  </p>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {idle.length > 0 && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowIdle((v) => !v)}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  aria-expanded={showIdle}
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showIdle && 'rotate-180')} />
                  {t('reportsPage.ttNoTime', { count: idle.length })}
                </Button>
                {showIdle && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {idle.map((r) => nameOf(r)).join(' · ')}
                  </p>
                )}
              </div>
            )}

            {(data?.projects.length ?? 0) > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <FolderKanban className="h-4 w-4 text-primary" aria-hidden />
                  {t('reportsPage.ttProjects')}
                </h4>
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>{t('reportsPage.ttColProject')}</TableHead>
                        <TableHead className="text-right">{t('reportsPage.ttColTotal')}</TableHead>
                        <TableHead className="text-right">{t('reportsPage.ttColPeople')}</TableHead>
                        <TableHead className="text-right">{t('reportsPage.ttColTasks')}</TableHead>
                        <TableHead className="hidden w-40 sm:table-cell" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data!.projects.map((p) => {
                        const share = totals && totals.official_ms > 0 ? (p.official_ms / totals.official_ms) * 100 : 0;
                        return (
                          <TableRow key={p.project_id ?? 'none'} className="text-sm">
                            <TableCell className="max-w-[24rem] truncate font-medium">
                              {p.project_name ?? t('reportsPage.ttNoProject')}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              <StopwatchText baseMs={p.official_ms} since={null} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{p.people}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.tasks}</TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary"
                                    style={{ width: `${share > 0 ? Math.max(2, share) : 0}%` }}
                                  />
                                </div>
                                <span className="w-9 text-right text-micro tabular-nums text-muted-foreground">
                                  {share > 0 && share < 1 ? '<1' : Math.round(share)}%
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  hint,
  hero,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  hero?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('rounded-lg p-3', hero ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : 'bg-muted/40')} title={hint}>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <div className={cn('mt-2 leading-none', hero && 'text-primary')}>{children}</div>
    </div>
  );
}
