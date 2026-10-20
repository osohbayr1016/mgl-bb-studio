import { ArrowLeft, Loader2 } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { teamChipClass } from '@/shared/lib/team-colors';
import type { ReportWindow } from '../types';
import { useTeamReport, useTeamReports } from '../api';
import { Sparkline, TrendChip } from './Badges';
import { EmployeeTable } from './EmployeeTable';
import { fmtDeltaPts, fmtHours, fmtInt, fmtPts } from '../lib/format';
import { sparkColLabel } from '../lib/windows';

/**
 * Багууд таб — багийн хүснэгт (байр = гишүүн тутамд ногдох оноо); мөр дарахад
 * тэр багийн гишүүд (ижил EmployeeTable).
 */
export function TeamsTab({
  window,
  anchor,
  teamId,
  onTeam,
  onPick,
}: {
  window: ReportWindow;
  anchor: string;
  teamId: number | null;
  onTeam: (id: number | null) => void;
  onPick: (userId: number) => void;
}) {
  const { t } = useLanguage();
  const list = useTeamReports(window, anchor);
  const detail = useTeamReport(teamId, window, anchor);

  if (teamId != null) {
    const d = detail.data;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onTeam(null)}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            {t('reportsPage.backToTeams')}
          </Button>
          {d?.team && (
            <>
              <Badge variant="outline" className={cn('font-mono', teamChipClass(d.team.code))}>
                {d.team.code}
              </Badge>
              <span className="text-sm font-semibold">{t('reportsPage.teamMembers', { team: d.team.name_mn })}</span>
              <TrendChip trend={d.team.trend} />
              <span className="ml-auto text-xs text-muted-foreground">
                {t('reportsPage.colPoints')}: <b className="text-foreground">{fmtPts(d.team.points)}</b>
                {d.team.points_prev != null && ` (${fmtDeltaPts(d.team.points, d.team.points_prev)}, ${t('reportsPage.vsPrev', { v: fmtPts(d.team.points_prev) })})`}
                {d.team.repair_points > 0 && ` · ${t('reportsPage.kpiRepairPoints')}: ${fmtPts(d.team.repair_points)}`}
                {' · '}
                {t('reportsPage.colAvgPerMember')}: <b className="text-foreground">{fmtPts(d.team.avg_points_per_member)}</b>
              </span>
            </>
          )}
        </div>
        {detail.isLoading && !d ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !d ? (
          <div className="py-16 text-center text-sm text-danger">{t('reportsPage.loadError')}</div>
        ) : (
          <>
            {d.series.dates.length > 1 && (
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-1 text-xs text-muted-foreground">{t('reportsPage.pointsChart')}</div>
                <Sparkline values={d.series.points} width={640} height={56} className="w-full" stroke="var(--color-primary)" />
              </div>
            )}
            <EmployeeTable
              rows={d.rows}
              sparkDays={d.sparkline.days}
              onPick={onPick}
            />
          </>
        )}
      </div>
    );
  }

  const rows = list.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t('reportsPage.teamsHint')}</p>
      {list.isLoading && !list.data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : list.isError && !list.data ? (
        <div className="py-16 text-center text-sm text-danger">{t('reportsPage.loadError')}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-10 text-right">{t('reportsPage.colRank')}</TableHead>
                <TableHead>{t('reportsPage.colTeam')}</TableHead>
                <TableHead className="text-right">{t('reportsPage.colMembers')}</TableHead>
                <TableHead className="text-right">{t('reportsPage.colPoints')}</TableHead>
                <TableHead className="text-right">{t('reportsPage.colAvgPerMember')}</TableHead>
                <TableHead>{t('reportsPage.colTrend')}</TableHead>
                <TableHead className="hidden md:table-cell">{sparkColLabel(t, list.data?.sparkline.days ?? null)}</TableHead>
                <TableHead className="text-right">{t('reportsPage.colPresentRate')}</TableHead>
                <TableHead className="hidden text-right lg:table-cell">{t('reportsPage.colHours')}</TableHead>
                <TableHead className="text-right">{t('reportsPage.colLate')}</TableHead>
                <TableHead className="text-right">{t('reportsPage.colEntries')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.team_id} className="cursor-pointer text-sm" onClick={() => onTeam(r.team_id)}>
                  <TableCell className="text-right font-semibold tabular-nums">{r.rank != null ? `#${r.rank}` : '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn('font-mono text-[10px]', teamChipClass(r.code))}>
                        {r.code}
                      </Badge>
                      <span className="font-medium">{r.name_mn}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.members}
                    {r.leaderboard_members !== r.members && (
                      <span className="text-[11px] text-muted-foreground"> ({r.leaderboard_members})</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="font-semibold tabular-nums">{fmtPts(r.points)}</div>
                    {r.repair_points > 0 && (
                      <div className="text-[11px] tabular-nums text-muted-foreground" title={t('reportsPage.kpiRepairPoints')}>
                        🔨 {fmtPts(r.repair_points)}
                      </div>
                    )}
                    {r.points_prev != null && (
                      <div
                        className={cn(
                          'text-[11px] tabular-nums',
                          r.points > r.points_prev ? 'text-success' : r.points < r.points_prev ? 'text-danger' : 'text-muted-foreground',
                        )}
                        title={t('reportsPage.vsPrev', { v: fmtPts(r.points_prev) })}
                      >
                        {fmtDeltaPts(r.points, r.points_prev)}
                        <span className="ml-1 text-muted-foreground">({fmtPts(r.points_prev)})</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPts(r.avg_points_per_member)}</TableCell>
                  <TableCell>
                    <TrendChip trend={r.trend} className="text-[11px]" />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Sparkline values={r.spark} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.present_rate != null ? `${r.present_rate}%` : '—'}</TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">{fmtHours(r.hours_worked)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', r.late_minutes > 0 ? 'text-danger' : 'text-muted-foreground')}>
                    {fmtInt(r.late_minutes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtInt(r.entries_count)}
                    {r.tasks_completed > 0 && <span className="ml-1 text-[11px] text-success">✓{r.tasks_completed}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
