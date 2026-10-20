import { AlertTriangle, Hammer } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { LeaveAdjustedMark } from '@/shared/components/LeaveAdjustedMark';
import { Badge } from '@/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { mediaUrl } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { EmployeeReportRow } from '../types';
import { RankBadge, Sparkline, TrendChip } from './Badges';
import { fmtDeltaPts, fmtHours, fmtInt, fmtPts } from '../lib/format';
import { sparkColLabel } from '../lib/windows';

/**
 * Ажилтнуудын тайлангийн хүснэгт — Ажилтнууд таб ба Багууд табын гишүүдийн
 * жагсаалт хоёулаа үүнийг хэрэглэнэ.  Мөр дарахад ажилтны дэлгэрэнгүй.
 */
export function EmployeeTable({
  rows,
  sparkDays,
  onPick,
  className,
}: {
  rows: EmployeeReportRow[];
  /**`sparkline.days` — sparkline баганын гарчиг («7 хоног» / «14 хоног» / …). */
  sparkDays: number | null;
  onPick: (userId: number) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-border bg-card', className)}>
      <Table>
        <TableHeader>
          <TableRow className="text-xs">
            <TableHead className="w-8 text-right">#</TableHead>
            <TableHead>{t('reportsPage.colEmployee')}</TableHead>
            <TableHead>{t('reportsPage.colRank')}</TableHead>
            <TableHead className="text-right">{t('reportsPage.colPoints')}</TableHead>
            <TableHead>{t('reportsPage.colTrend')}</TableHead>
            <TableHead className="hidden md:table-cell">{sparkColLabel(t, sparkDays)}</TableHead>
            <TableHead className="text-right">{t('reportsPage.colEntries')}</TableHead>
            <TableHead className="hidden text-right lg:table-cell">{t('reportsPage.colHours')}</TableHead>
            <TableHead className="text-right">{t('reportsPage.colLate')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow
              key={r.user_id}
              className={cn('cursor-pointer text-sm', r.status !== 'active' && 'opacity-60')}
              onClick={() => onPick(r.user_id)}
            >
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8 shrink-0">
                    {r.profile_image && <AvatarImage src={mediaUrl(r.profile_image)} alt="" />}
                    <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                      {r.full_name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{formatDisplayName(r.full_name)}</span>
                      {r.team_code && (
                        <Badge variant="outline" className={cn('font-mono text-[10px]', teamChipClass(r.team_code))}>
                          {r.team_code}
                        </Badge>
                      )}
                      {r.status !== 'active' && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {t('reportsPage.inactive')}
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[r.employee_id, r.position].filter(Boolean).join(' · ') || r.username}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <RankBadge rank={r.rank_now} pool={r.pool_size} delta={r.rank_delta} source={r.rank_7d_source} />
              </TableCell>
              <TableCell className="text-right">
                <div className="font-semibold tabular-nums">
                  {fmtPts(r.points)}
                  <LeaveAdjustedMark days={r.leave_days} actual={fmtPts(r.points_actual)} />
                </div>
                {r.repair_points > 0 && (
                  <div
                    className="flex items-center justify-end gap-1 text-[11px] tabular-nums text-muted-foreground"
                    title={t('reportsPage.repairPointsHint', { n: r.repair_entries })}
                  >
                    <Hammer className="h-3 w-3" />
                    {fmtPts(r.repair_points)}
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
              <TableCell>
                <TrendChip trend={r.trend} className="text-[11px]" />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Sparkline values={r.spark} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(r.entries_count)}
                {r.tasks_completed > 0 && <span className="ml-1 text-[11px] text-success">✓{r.tasks_completed}</span>}
                {r.repair_entries > 0 && (
                  <span className="ml-1 text-[11px] text-muted-foreground" title={t('reportsPage.repairEntries', { n: r.repair_entries })}>
                    +{r.repair_entries}
                  </span>
                )}
                {r.unweighted_entries > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-warning" onClick={(e) => e.stopPropagation()}>
                        <AlertTriangle className="h-3 w-3" />
                        {r.unweighted_entries}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      {t('reportsPage.unweightedHint', { n: r.unweighted_entries })}
                    </TooltipContent>
                  </Tooltip>
                )}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums lg:table-cell">{fmtHours(r.hours_worked)}</TableCell>
              <TableCell className={cn('text-right tabular-nums', r.late_minutes > 0 ? 'text-danger' : 'text-muted-foreground')}>
                {fmtInt(r.late_minutes)}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={9}className="py-10 text-center text-sm text-muted-foreground">
                {t('reportsPage.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
