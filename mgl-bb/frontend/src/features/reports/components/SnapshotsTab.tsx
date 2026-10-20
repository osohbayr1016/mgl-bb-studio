import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarClock, Database, Loader2, Minus, Play } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { todayUB } from '@/shared/lib/time';
import { toast } from '@/shared/components/Toast';
import { EmployeePicker } from '@/shared/components/EmployeePicker';
import type { User } from '@/shared/types';
import { runBackfill, runSnapshotNow, useEmployeeSnapshots, useSnapshotStatus } from '../api';
import { addDays, chunkRange, isIsoDate } from '../lib/windows';
import { fmtHours, fmtPts } from '../lib/format';

/**
 * Өдрийн автомат тайлан — нэг хүний snapshot timeline + системийн төлөв
 * (сүүлийн өдөр, дутуу өдрүүд, «Түүх нөхөх», «Өчигдрийг одоо бичих»).
 */
export function SnapshotsTab({ userId, onPick }: { userId: number | null; onPick: (id: number) => void }) {
  const { t } = useLanguage();
  const today = todayUB();
  const usersQuery = useApiQuery<{ users: User[] }>(['/users'], '/users');
  const staff = useMemo(
    () => (usersQuery.data?.users ?? []).filter((u) => u.role !== 'client' && u.role !== 'worker'),
    [usersQuery.data],
  );
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, -1));
  const snaps = useEmployeeSnapshots(userId, from, to);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <EmployeePicker users={staff} value={userId} onChange={onPick} className="w-full sm:w-80" />
          <span className="text-xs text-muted-foreground">{t('reportsPage.snapRange')}</span>
          <Input
            type="date"
            value={from}
            max={to}
            className="h-9 w-[9.5rem]"
            onChange={(e) => isIsoDate(e.target.value) && setFrom(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={to}
            min={from}
            max={addDays(today, -1)}
            className="h-9 w-[9.5rem]"
            onChange={(e) => isIsoDate(e.target.value) && setTo(e.target.value)}
          />
        </div>

        {userId == null ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            {t('reportsPage.pickEmployee')}
          </div>
        ) : snaps.isLoading && !snaps.data ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (snaps.data?.rows.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            {t('reportsPage.noSnapshots')}
          </div>
        ) : (
          <SnapshotTable rows={snaps.data!.rows} />
        )}
      </div>

      <StatusCard />
    </div>
  );
}

function SnapshotTable({ rows }: { rows: import('../types').SnapshotRow[] }) {
  const { t } = useLanguage();
  // rows нь date DESC — «өмнөх өдөр» нь массивын дараагийн элемент.
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="text-xs">
            <TableHead>{t('reportsPage.colDate')}</TableHead>
            <TableHead className="text-right">{t('reportsPage.colRank30')}</TableHead>
            <TableHead className="hidden text-right md:table-cell">{t('reportsPage.colRank7')}</TableHead>
            <TableHead className="text-right">{t('reportsPage.colPointsDay')}</TableHead>
            <TableHead className="hidden text-right md:table-cell">{t('reportsPage.colPoints30')}</TableHead>
            <TableHead className="text-right">{t('reportsPage.colEntries')}</TableHead>
            <TableHead className="hidden text-right md:table-cell">{t('reportsPage.colDone')}</TableHead>
            <TableHead>{t('reportsPage.colAttendance')}</TableHead>
            <TableHead className="hidden text-right lg:table-cell">{t('reportsPage.colHours')}</TableHead>
            <TableHead className="text-right">{t('reportsPage.colLate')}</TableHead>
            <TableHead className="hidden text-right lg:table-cell">{t('reportsPage.colRepair')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const prev = rows[i + 1];
            const d = r.rank_30d != null && prev?.rank_30d != null ? prev.rank_30d - r.rank_30d : null;
            return (
              <TableRow key={r.date} className={cn('text-sm', r.is_free_day ? 'text-muted-foreground' : undefined)}>
                <TableCell className="tabular-nums">
                  {r.date}
                  {r.source === 'backfill' && <span className="ml-1 text-[10px] text-muted-foreground">↺</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.rank_30d != null ? (
                    <span className="inline-flex items-center gap-1">
                      #{r.rank_30d}
                      <span className="text-[11px] text-muted-foreground">/{r.pool_size}</span>
                      {d != null &&
                        (d > 0 ? (
                          <ArrowUp className="h-3 w-3 text-success" />
                        ) : d < 0 ? (
                          <ArrowDown className="h-3 w-3 text-danger" />
                        ) : (
                          <Minus className="h-3 w-3 text-muted-foreground" />
                        ))}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{r.rank_7d != null ? `#${r.rank_7d}` : '—'}</TableCell>
                <TableCell className={cn('text-right font-semibold tabular-nums', r.points_day === 0 && 'font-normal text-muted-foreground')}>
                  {fmtPts(r.points_day)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtPts(r.points_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.entries_count || '·'}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{r.tasks_completed || '·'}</TableCell>
                <TableCell>
                  {r.is_free_day ? (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {t('reportsPage.freeDay')}
                    </Badge>
                  ) : r.on_leave ? (
                    <Badge variant="outline" className="border-warning/50 text-[10px] text-warning">
                      {t('reportsPage.onLeave')}
                    </Badge>
                  ) : r.present ? (
                    <Badge variant="outline" className="border-success/40 text-[10px] text-success">
                      {t('reportsPage.present')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-danger/40 text-[10px] text-danger">
                      {t('reportsPage.absent')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{r.hours_worked ? fmtHours(r.hours_worked) : '·'}</TableCell>
                <TableCell className={cn('text-right tabular-nums', r.late_minutes > 0 ? 'text-danger' : 'text-muted-foreground')}>
                  {r.late_minutes || '·'}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{r.repair_hours || '·'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusCard() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const status = useSnapshotStatus();
  const today = todayUB();
  const [bfFrom, setBfFrom] = useState(addDays(today, -45));
  const [bfTo, setBfTo] = useState(addDays(today, -1));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);

  const invalidateAll = async () => {
    await qc.invalidateQueries({ queryKey: ['/reports/snapshots/status'] });
    await qc.invalidateQueries({ queryKey: ['/reports/employees'] });
    await qc.invalidateQueries({ queryKey: ['/reports/overview'] });
    await qc.invalidateQueries({ queryKey: ['/reports/teams'] });
  };

  const backfill = async () => {
    if (!isIsoDate(bfFrom) || !isIsoDate(bfTo) || bfFrom > bfTo) return;
    const chunks = chunkRange(bfFrom, bfTo, 45);
    const total = chunks.reduce((s, [a, b]) => s + Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000) + 1, 0);
    setProgress({ done: 0, total });
    try {
      let done = 0;
      for (const [a, b] of chunks) {
        const r = await runBackfill(a, b);
        done += r.days;
        setProgress({ done, total });
      }
      toast.success(t('reportsPage.backfillDone', { n: done }));
      await invalidateAll();
    } catch (err) {
      toast.error(t('reportsPage.backfill'), err instanceof Error ? err.message : undefined);
    } finally {
      setProgress(null);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await runSnapshotNow();
      toast.success(t('reportsPage.runDone', { date: r.date, n: r.users }));
      await invalidateAll();
    } catch (err) {
      toast.error(t('reportsPage.runNow'), err instanceof Error ? err.message : undefined);
    } finally {
      setRunning(false);
    }
  };

  const s = status.data;
  return (
    <Card id="sec-reports-snapshots" className="h-fit scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-primary" />
          {t('reportsPage.snapshotStatus')}
        </CardTitle>
        <CardDescription className="text-xs">{t('reportsPage.snapshotsHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {s && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('reportsPage.snapshotLastDate')}</dt>
            <dd className="tabular-nums">{s.last_date ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('reportsPage.snapshotFirst')}</dt>
            <dd className="tabular-nums">{s.first_date ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('reportsPage.snapshotTotal')}</dt>
            <dd className="tabular-nums">{s.total_rows.toLocaleString('mn-MN')}</dd>
            <dt className="text-muted-foreground">{t('reportsPage.snapshotMissing')}</dt>
            <dd>
              {s.missing_days_30.length === 0 ? (
                <span className="text-success">{t('reportsPage.snapshotNoMissing')}</span>
              ) : (
                <span className="text-warning">
                  {s.missing_days_30.length} · {s.missing_days_30[0]}
                  {s.missing_days_30.length > 1 && ` … ${s.missing_days_30[s.missing_days_30.length - 1]}`}
                </span>
              )}
            </dd>
          </dl>
        )}

        <div className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-1 text-xs font-medium">
            <CalendarClock className="h-3.5 w-3.5" />
            {t('reportsPage.backfill')}
          </div>
          <p className="text-[11px] text-muted-foreground">{t('reportsPage.backfillHint')}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Input type="date" value={bfFrom} max={bfTo} className="h-8 w-[9rem] text-xs" onChange={(e) => setBfFrom(e.target.value)} />
            <span className="text-xs">–</span>
            <Input
              type="date"
              value={bfTo}
              min={bfFrom}
              max={addDays(today, -1)}
              className="h-8 w-[9rem] text-xs"
              onChange={(e) => setBfTo(e.target.value)}
            />
            <Button size="sm" className="h-8" onClick={backfill} disabled={!!progress}>
              {progress ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              {progress ? t('reportsPage.backfillRunning', progress) : t('reportsPage.backfillRun')}
            </Button>
          </div>
          {progress && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
          )}
        </div>

        <Button size="sm" variant="outline" className="h-8 w-full" onClick={runNow} disabled={running}>
          {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
          {t('reportsPage.runNow')}
        </Button>
      </CardContent>
    </Card>
  );
}
