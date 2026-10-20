import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardList, ExternalLink, Loader2 } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { todayUB } from '@/shared/lib/time';
import { formatProjectShortName } from '@/shared/lib/formatting';
import type { MyProgressEntry } from '@/shared/types';
import type { ProfileTasksResponse, ProfileTaskItem } from '../types';
import { fmtSigned } from '../lib/format';

/**
 * «Даалгаврууд» — ажилтанд ОДОО хуваарилагдсан таск бүр: төсөл › блок › бүрдэл,
 * сүүлийн батлагдсан хувь, төлөв (эхлээгүй / хийгдэж буй / дууссан / хоцорсон),
 * дуусах огноо, энэ цонхонд хэдэн хувь ахиулсан, өнөөдөр бүртгэсэн эсэх.
 *
 * Эх сурвалж нь `GET /api/profiles/:id/tasks` (идэвхтэй төслүүдийн даалгавар,
 * `assigned_to` эсвэл `task_assignees`) — Хэрэглэгчийн профайлтай ижил endpoint,
 * тоо зөрөхгүй.  Цонхны ахиц нь `/profiles/:id/activity`-ийн бичлэгээс.
 *
 * Карт өгөгдмөлөөр ХУРААСАН (эзний хүсэлт, 2026-09-16): толгой хэсэг нь товч —
 * дарахад л шүүлтүүр, хүснэгт дэлгэгдэнэ.  Тоон хураангуй (нийт/дууссан/идэвхтэй,
 * хоцорсон) хураасан үед ч толгойд харагдана, тиймээс query хураасан үед ч ажиллана.
 */
type Filter = 'all' | 'active' | 'not_started' | 'done' | 'overdue';
type TaskStatus = Exclude<Filter, 'all'>;

/** Дууссан (≥100 %) → хоцорсон (due_date өнөөдрөөс өмнө) → хийгдэж буй (>0) → эхлээгүй. */
function statusOf(it: ProfileTaskItem, today: string): TaskStatus {
  if (it.current_progress >= 100) return 'done';
  if (it.due_date && it.due_date < today) return 'overdue';
  if (it.current_progress > 0) return 'active';
  return 'not_started';
}

const STATUS_ORDER: Record<TaskStatus, number> = { overdue: 0, active: 1, not_started: 2, done: 3 };

export function EmployeeTasksCard({
  userId,
  activity,
  windowFrom,
  windowTo,
}: {
  userId: number;
  activity: MyProgressEntry[];
  windowFrom: string;
  windowTo: string;
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useApiQuery<ProfileTasksResponse>(['/profiles/tasks', userId], `/profiles/${userId}/tasks`);
  const today = todayUB();

  // Цонхонд таск бүрд хэдэн хувь ахиулсан, сүүлд хэзээ бүртгэсэн.
  const inWindow = useMemo(() => {
    const m = new Map<number, { delta: number; last: string; entries: number }>();
    for (const e of activity) {
      if (e.task_id == null || e.status === 'rejected') continue;
      const cur = m.get(e.task_id) ?? { delta: 0, last: '', entries: 0 };
      cur.delta += e.delta_pct ?? 0;
      cur.entries += 1;
      if (e.date > cur.last) cur.last = e.date;
      m.set(e.task_id, cur);
    }
    return m;
  }, [activity]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = { active: 0, not_started: 0, done: 0, overdue: 0 };
    for (const it of items) c[statusOf(it, today)] += 1;
    return c;
  }, [items, today]);
  const shown = useMemo(() => {
    const list = filter === 'all' ? items : items.filter((it) => statusOf(it, today) === filter);
    // Хоцорсон эхэнд, дараа нь хийгдэж буй (хувиар), эхлээгүй, дууссан сүүлд.
    return [...list].sort(
      (a, b) => STATUS_ORDER[statusOf(a, today)] - STATUS_ORDER[statusOf(b, today)] || b.current_progress - a.current_progress,
    );
  }, [items, filter, today]);

  const FILTERS: Array<{ key: Filter; labelKey: string; n: number }> = [
    { key: 'all', labelKey: 'reportsPage.tasksAll', n: items.length },
    { key: 'active', labelKey: 'reportsPage.tasksActive', n: counts.active },
    { key: 'overdue', labelKey: 'reportsPage.tasksOverdue', n: counts.overdue },
    { key: 'not_started', labelKey: 'reportsPage.tasksNotStarted', n: counts.not_started },
    { key: 'done', labelKey: 'reportsPage.tasksDone', n: counts.done },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card id="sec-reports-tasks" className="scroll-mt-24">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-expanded={open}
            className="w-full rounded-t-xl text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CardHeader className={cn('pb-2', !open && 'pb-4')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    <ClipboardList className="h-4 w-4 text-primary" />
                    {t('reportsPage.tasksTitle')}
                    {data && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {t('reportsPage.tasksSummary', { total: data.summary.total, done: data.summary.completed, active: data.summary.in_progress })}
                      </span>
                    )}
                    {!open && counts.overdue > 0 && (
                      <Badge variant="outline" className="gap-1 border-danger/40 text-[10px] text-danger">
                        <AlertTriangle className="h-3 w-3" />
                        {t('reportsPage.tasksOverdue')} {counts.overdue}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">{t('reportsPage.tasksHint')}</CardDescription>
                </div>
                <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
              </div>
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'h-7 rounded-md px-2 text-xs font-medium transition-colors',
                filter === f.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                f.key === 'overdue' && f.n > 0 && filter !== f.key && 'text-danger',
              )}
            >
              {t(f.labelKey)} <span className="tabular-nums opacity-70">{f.n}</span>
            </button>
          ))}
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-danger">{t('reportsPage.loadError')}</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {items.length === 0 ? t('reportsPage.tasksNone') : t('reportsPage.noResults')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>{t('reportsPage.colTask')}</TableHead>
                  <TableHead className="w-[220px]">{t('reportsPage.colProgress')}</TableHead>
                  <TableHead>{t('reportsPage.colStatus')}</TableHead>
                  <TableHead className="text-right">{t('reportsPage.colWindowDelta')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('reportsPage.colLastEntry')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('reportsPage.colDue')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((it) => {
                  const st = statusOf(it, today);
                  const w = inWindow.get(it.id);
                  const pct = Math.round(it.current_progress * 10) / 10;
                  return (
                    <TableRow key={it.id} className="text-sm">
                      <TableCell>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{it.name}</span>
                            {it.reported_today && (
                              <Badge variant="outline" className="shrink-0 border-primary/40 text-[10px] text-primary">
                                {it.reported_today_rest ? t('reportsPage.reportedRest') : t('reportsPage.reportedToday')}
                              </Badge>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            <Link to={`/app/projects/${it.project_id}`} className="hover:underline">
                              {formatProjectShortName(it.project_name)}
                            </Link>
                            {' › '}
                            {it.block_name}
                            {' › '}
                            {it.component_name}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                st === 'done' ? 'bg-success' : st === 'overdue' ? 'bg-danger' : 'bg-primary',
                              )}
                              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                            />
                          </div>
                          <span className="w-12 text-right text-sm font-semibold tabular-nums">{pct}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={st} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {w && w.delta !== 0 ? (
                          <span className={cn('font-medium', w.delta > 0 ? 'text-success' : 'text-danger')}>{fmtSigned(w.delta, '%')}</span>
                        ) : (
                          <span className="text-muted-foreground">·</span>
                        )}
                        {w && <span className="ml-1 text-[11px] text-muted-foreground">×{w.entries}</span>}
                      </TableCell>
                      <TableCell className="hidden text-xs tabular-nums text-muted-foreground md:table-cell">{w?.last ?? '—'}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {it.due_date ? (
                          <span className={cn('text-xs tabular-nums', st === 'overdue' && 'font-medium text-danger')}>{it.due_date}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {data && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t('reportsPage.tasksFootnote', { from: windowFrom, to: windowTo })}
            {' · '}
            <Link to={`/app/users/${userId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="h-3 w-3" />
              {t('reportsPage.openProfile')}
            </Link>
          </p>
        )}
      </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useLanguage();
  if (status === 'done')
    return (
      <Badge variant="outline" className="gap-1 border-success/40 text-[11px] text-success">
        <CheckCircle2 className="h-3 w-3" />
        {t('reportsPage.tasksDone')}
      </Badge>
    );
  if (status === 'overdue')
    return (
      <Badge variant="outline" className="gap-1 border-danger/40 text-[11px] text-danger">
        <AlertTriangle className="h-3 w-3" />
        {t('reportsPage.tasksOverdue')}
      </Badge>
    );
  if (status === 'active')
    return (
      <Badge variant="outline" className="border-primary/40 text-[11px] text-primary">
        {t('reportsPage.tasksActive')}
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[11px] text-muted-foreground">
      {t('reportsPage.tasksNotStarted')}
    </Badge>
  );
}
