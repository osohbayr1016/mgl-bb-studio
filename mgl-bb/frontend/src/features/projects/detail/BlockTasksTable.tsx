/** Flat "all tasks in this block" table inside the block detail dialog.
 *  Extracted verbatim from `ProjectDetailPage.tsx` (`BlockDetailDialog`)
 *  when that file was split into per-component modules — no behavioural
 *  change. */
import { AlertTriangle, ChevronRight as ChevronRightIcon, Target } from 'lucide-react';

import { Progress } from '@/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { formatDate } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';

import { StatusDot } from './atoms';
import { TaskWorkersStack } from './TaskLiveCell';
import { progressColor } from './helpers';
import type { FlatBlockTask } from './types';

export function BlockTasksTable({ flatTasks }: { flatTasks: FlatBlockTask[] }) {
  const { t } = useLanguage();
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
        <Target className="h-3.5 w-3.5" /> {t('projectDetailPage.allTasks')}
      </h3>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-[10px] uppercase tracking-wider">
                {t('projectDetailPage.colTask')}
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider hidden md:table-cell">
                {t('projectDetailPage.location')}
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">
                {t('projectDetailPage.colAssignee')}
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider hidden sm:table-cell">
                {t('projectDetailPage.deadline')}
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider w-[160px]">
                {t('projectDetailPage.execution')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flatTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                  {t('projectDetailPage.noTasksRegistered')}
                </TableCell>
              </TableRow>
            ) : (
              flatTasks.map(({ task, drawing, componentName }) => {
                const overdue =
                  task.due_date &&
                  task.progress < 100 &&
                  new Date(task.due_date).getTime() < Date.now() - 86400000;
                return (
                  <TableRow key={task.id} className="hover:bg-muted/20">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusDot progress={task.progress} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{task.name}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="text-[11px] text-muted-foreground">
                        {drawing.name}{' '}
                        <ChevronRightIcon className="inline h-2.5 w-2.5 opacity-40" />{' '}
                        {componentName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TaskWorkersStack taskId={task.id} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {task.due_date ? (
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            overdue && 'text-amber-500 font-medium',
                          )}
                        >
                          {formatDate(new Date(task.due_date))}
                          {overdue && <AlertTriangle className="inline h-3 w-3 ml-1" />}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={task.progress}
                          className="h-1.5 flex-1"
                          indicatorClassName={progressColor(task.progress)}
                        />
                        <span className="text-xs font-medium w-9 text-right tabular-nums">
                          {task.progress.toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export default BlockTasksTable;
