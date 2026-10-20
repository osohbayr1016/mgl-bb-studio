import { useMemo, useState } from 'react';
import { Download, Loader2, Search, Users } from 'lucide-react';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { useLanguage } from '@/shared/i18n';
import { rankUsers } from '@/shared/lib/search/rankUsers';
import { toast } from '@/shared/components/Toast';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { EmployeeReportRow, OverviewResponse, ReportWindow } from '../types';
import { useReportsOverview } from '../api';
import { EmployeeTable } from './EmployeeTable';
import { WINDOW_LABEL_KEY, TREND_LABEL_KEY } from '../lib/windows';

/**
 * Ажилтнууд таб — бүх ажилтан нэг хүснэгтэд, хайлт (кирилл↔латин, нэр/баг/
 * албан тушаал), багийн шүүлт, Excel.  Мөр дарахад «Ажилтан» таб руу.
 */
export function OverviewTab({
  window,
  anchor,
  onPick,
}: {
  window: ReportWindow;
  anchor: string;
  onPick: (userId: number) => void;
}) {
  const { t } = useLanguage();
  const { data, isLoading, isError } = useReportsOverview(window, anchor);
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState<string>('all');
  const [exporting, setExporting] = useState(false);

  const teams = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.rows ?? []) if (r.team_code) m.set(r.team_code, r.team_name ?? r.team_code);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    if (team !== 'all') list = list.filter((r) => r.team_code === team);
    if (query.trim()) {
      const ranked = rankUsers(
        list.map((r) => ({ id: r.user_id, row: r, full_name: r.full_name, username: r.username, employee_id: r.employee_id, position: r.position, team_code: r.team_code, team_name_mn: r.team_name })),
        query,
        Number.POSITIVE_INFINITY,
      );
      list = ranked.map((x) => x.row);
    }
    return list;
  }, [data, team, query]);

  const exportXlsx = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await exportOverviewXlsx(data, rows, t);
    } catch (err) {
      toast.error(t('reportsPage.exportXlsx'), err instanceof Error ? err.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('reportsPage.searchEmployee')}
            className="h-9 pl-8"
          />
        </div>
        <Select value={team} onValueChange={setTeam}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('reportsPage.teamFilterAll')}</SelectItem>
            {teams.map(([code, name]) => (
              <SelectItem key={code} value={code}>
                {code} · {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {t('reportsPage.showing', { n: rows.length })}
          {data && data.previous && (
            <span className="hidden sm:inline">
              {' · '}
              {t('reportsPage.previousWindow', { from: data.previous.from, to: data.previous.to })}
            </span>
          )}
        </span>
        <Button variant="outline" size="sm" className="h-9" onClick={exportXlsx} disabled={!data || exporting}>
          {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
          {t('reportsPage.exportXlsx')}
        </Button>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : isError && !data ? (
        <div className="py-16 text-center text-sm text-danger">{t('reportsPage.loadError')}</div>
      ) : (
        <EmployeeTable
          rows={rows}
          sparkDays={data?.sparkline.days ?? null}
          onPick={onPick}
        />
      )}
      <p className="text-[11px] text-muted-foreground">{t('reportsPage.ledgerNote')}</p>
    </div>
  );
}

async function exportOverviewXlsx(
  data: OverviewResponse,
  rows: EmployeeReportRow[],
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const { loadExcelJS, styleHeaderRow, downloadWorkbook } = await import('@/features/attendance/admin/lib/excel');
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t('reportsPage.title'));
  ws.columns = [
    { header: '#', key: 'n', width: 5 },
    { header: t('reportsPage.colEmployee'), key: 'name', width: 28 },
    { header: t('reportsPage.colTeam'), key: 'team', width: 8 },
    { header: t('reportsPage.position'), key: 'position', width: 20 },
    { header: t('reportsPage.colRank'), key: 'rank', width: 8 },
    { header: `${t('reportsPage.colRank')} −7`, key: 'rank7', width: 10 },
    { header: 'Δ', key: 'rankDelta', width: 6 },
    { header: t('reportsPage.colPoints'), key: 'points', width: 10 },
    { header: t('reportsPage.previousWindow', { from: '', to: '' }).replace(/:.*$/, ''), key: 'prev', width: 10 },
    { header: 'Δ', key: 'deltaPts', width: 8 },
    { header: t('reportsPage.kpiRepairPoints'), key: 'repairPts', width: 12 },
    { header: t('reportsPage.colTrend'), key: 'trend', width: 14 },
    { header: t('reportsPage.kpiEntries'), key: 'entries', width: 10 },
    { header: t('reportsPage.colUnweighted'), key: 'unweighted', width: 12 },
    { header: t('reportsPage.colRepairEntries'), key: 'repairEntries', width: 12 },
    { header: t('reportsPage.kpiTasksCompleted'), key: 'done', width: 10 },
    { header: t('reportsPage.kpiPresent'), key: 'present', width: 10 },
    { header: t('reportsPage.kpiHours'), key: 'hours', width: 10 },
    { header: t('reportsPage.kpiLate'), key: 'late', width: 10 },
    { header: t('reportsPage.kpiRepair'), key: 'repair', width: 10 },
    { header: t('reportsPage.kpiLeave'), key: 'leave', width: 10 },
  ];
  rows.forEach((r, i) => {
    ws.addRow({
      n: i + 1,
      name: formatDisplayName(r.full_name),
      team: r.team_code ?? '',
      position: r.position ?? '',
      rank: r.rank_now ?? '',
      rank7: r.rank_7d_ago ?? '',
      rankDelta: r.rank_delta ?? '',
      points: r.points,
      prev: r.points_prev ?? '',
      deltaPts: r.points_prev == null ? '' : Math.round((r.points - r.points_prev) * 10000) / 10000,
      repairPts: r.repair_points,
      trend: t(TREND_LABEL_KEY[r.trend.code]),
      entries: r.entries_count,
      unweighted: r.unweighted_entries,
      repairEntries: r.repair_entries,
      done: r.tasks_completed,
      present: r.present_days,
      hours: r.hours_worked,
      late: r.late_minutes,
      repair: r.repair_hours,
      leave: r.leave_hours,
    });
  });
  styleHeaderRow(ws);
  const label = t(WINDOW_LABEL_KEY[data.window.code]);
  await downloadWorkbook(wb, `tailan_${label}_${data.window.from}_${data.window.to}.xlsx`);
}
