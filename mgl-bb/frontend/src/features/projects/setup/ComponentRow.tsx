/** One component group inside a drawing: the header row (name, weight,
 *  task-count badge, overflow menu) followed by its task rows.
 *
 *  `startIndex` is the number of tasks in the preceding components of the same
 *  drawing, so the "#" column keeps counting across the whole drawing exactly
 *  as the original inline `runningIndex` counter did.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { Fragment } from 'react';
import { ComponentHeaderRow } from './ComponentHeaderRow';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TableCell, TableRow } from '@/ui/table';
import { TaskRow } from './TaskRow';
import { num, weightStatusVsTarget } from './weights';
import type { Comp } from './types';
import type { SetupApi } from './useProjectSetup';

type Props = Pick<
  SetupApi,
  | 'addTask'
  | 'addTasksBulk'
  | 'delComp'
  | 'equalSplitTasks'
  | 'stableAddTask'
  | 'stableDelTask'
  | 'stableSetTaskBaseline'
  | 'stableUTask'
  | 't'
  | 'tasks'
  | 'uComp'
> & {
  comp: Comp;
  startIndex: number;
  blockW: number;
  blockTeamShare: number;
  drW: number;
};

export function ComponentRow(props: Props) {
  const {
    comp,
    startIndex,
    addTask,
    addTasksBulk,
    delComp,
    equalSplitTasks,
    stableAddTask,
    stableDelTask,
    stableSetTaskBaseline,
    stableUTask,
    t,
    tasks,
    uComp,
    blockW,
    blockTeamShare,
    drW,
  } = props;

                                                  const compTasks = tasks.filter(
                                                    (t) => t.component_id === comp.id,
                                                  );
                                                  const compTaskSum = compTasks.reduce(
                                                    (s, t) => s + num(t.weight_percent),
                                                    0,
                                                  );
                                                  const compW = num(comp.weight_percent);
                                                  const status =
                                                    compW > 0
                                                      ? weightStatusVsTarget(
                                                          compTaskSum,
                                                          compW,
                                                          compTasks.length,
                                                        )
                                                      : 'empty';
                                                  const tone =
                                                    status === 'ok'
                                                      ? 'border-success/40 bg-success/10 text-success'
                                                      : status === 'over'
                                                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                                        : status === 'under'
                                                          ? 'border-warning/40 bg-warning/10 text-warning'
                                                          : 'border-border/60 bg-muted/30 text-muted-foreground';
                                                  const taskSumRel =
                                                    drW > 0
                                                      ? +((compTaskSum * 100) / drW).toFixed(2)
                                                      : 0;
                                                  const compRel =
                                                    drW > 0 ? +((compW * 100) / drW).toFixed(2) : 0;

                                                  return (
                                                    <Fragment key={comp.id}>
                                                      {/* Component group header row.
                                                Slimmed down: only the
                                                first-class controls (name,
                                                weight, count badge) live
                                                inline; secondary actions
                                                (split, delete, +Ажил extra
                                                preset entry) are stashed in
                                                an overflow menu so the row
                                                breathes on narrow screens. */}
                                                      <ComponentHeaderRow
                                                        addTask={addTask}
                                                        addTasksBulk={addTasksBulk}
                                                        delComp={delComp}
                                                        equalSplitTasks={equalSplitTasks}
                                                        t={t}
                                                        uComp={uComp}
                                                        comp={comp}
                                                        compTasks={compTasks}
                                                        compW={compW}
                                                        compRel={compRel}
                                                        taskSumRel={taskSumRel}
                                                        tone={tone}
                                                        drW={drW}
                                                        blockW={blockW}
                                                        blockTeamShare={blockTeamShare}
                                                      />

                                                      {/* Task rows under this component */}
                                                      {compTasks.length === 0 ? (
                                                        <TableRow>
                                                          <TableCell
                                                            colSpan={5}
                                                            className="text-center text-xs text-muted-foreground italic py-3"
                                                          >
                                                            {t('adminProjectSetupPage.noTasksPrefix')}{' '}
                                                            <strong>
                                                              + {t('adminProjectSetupPage.task')}
                                                            </strong>{' '}
                                                            {t('adminProjectSetupPage.addWithButtonSuffixNoPeriod')}
                                                          </TableCell>
                                                        </TableRow>
                                                      ) : (
                                                        <SortableContext
                                                          items={compTasks.map((t) => String(t.id))}
                                                          strategy={verticalListSortingStrategy}
                                                        >
                                                          {compTasks.map((task, taskIdx) => {
                                                            const tW = num(task.weight_percent);
                                                            // Task weight is stored as "% of block"; task's
                                                            // "% of project" = team_share × blockW × tW / 10000.
                                                            const taskAbs =
                                                              (blockTeamShare * blockW * tW) /
                                                              10000;
                                                            return (
                                                              <TaskRow
                                                                key={task.id}
                                                                index={startIndex + taskIdx + 1}
                                                                task={task}
                                                                taskAbs={taskAbs}
                                                                drW={drW}
                                                                compId={comp.id}
                                                                uTask={stableUTask}
                                                                delTask={stableDelTask}
                                                                addTask={stableAddTask}
                                                                setTaskBaseline={
                                                                  stableSetTaskBaseline
                                                                }
                                                              />
                                                            );
                                                          })}
                                                        </SortableContext>
                                                      )}
                                                    </Fragment>
                                                  );
}

export default ComponentRow;
