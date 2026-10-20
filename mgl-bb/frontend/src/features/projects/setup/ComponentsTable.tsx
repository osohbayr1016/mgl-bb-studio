/** The component → task editor table for one drawing.
 *
 *  Component group rows act as section headers and tasks render as numbered
 *  rows beneath them — always expanded so the admin doesn't lose context
 *  while reviewing weights. A single DndContext serves both levels; drags are
 *  routed on the active-id prefix.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { DndContext, closestCenter } from '@dnd-kit/core';
import { Inbox } from 'lucide-react';
import { ComponentRow } from './ComponentRow';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/ui/table';
import type { Comp } from './types';
import type { SetupApi } from './useProjectSetup';

type Props = Pick<
  SetupApi,
  | 'addTask'
  | 'addTasksBulk'
  | 'delComp'
  | 'dndSensors'
  | 'equalSplitTasks'
  | 'handleComponentDragEnd'
  | 'handleTaskDragEnd'
  | 'stableAddTask'
  | 'stableDelTask'
  | 'stableSetTaskBaseline'
  | 'stableUTask'
  | 't'
  | 'tasks'
  | 'uComp'
> & {
  blockW: number;
  blockTeamShare: number;
  drW: number;
  drawingComps: Comp[];
};

export function ComponentsTable(props: Props) {
  const {
    blockW,
    blockTeamShare,
    addTask,
    addTasksBulk,
    delComp,
    dndSensors,
    equalSplitTasks,
    handleComponentDragEnd,
    handleTaskDragEnd,
    stableAddTask,
    stableDelTask,
    stableSetTaskBaseline,
    stableUTask,
    t,
    tasks,
    uComp,
    drW,
    drawingComps,
  } = props;

  // Per-drawing running task number shown in the "#" column: each component
  // starts where the previous one left off.
  const taskStartIndex: number[] = [];
  {
    let acc = 0;
    for (const c of drawingComps) {
      taskStartIndex.push(acc);
      acc += tasks.filter((task) => task.component_id === c.id).length;
    }
  }

  return (
    <>
                                      {drawingComps.length === 0 ? (
                                        <div className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border/60 rounded-lg flex flex-col items-center gap-2">
                                          <Inbox className="h-5 w-5 text-muted-subtle" />
                                          {t('adminProjectSetupPage.noComponentsPrefix')}{' '}
                                          <strong className="text-foreground">
                                            + {t('adminProjectSetupPage.component')}
                                          </strong>{' '}
                                          {t('adminProjectSetupPage.addWithButtonSuffix')}
                                        </div>
                                      ) : (
                                        <DndContext
                                          sensors={dndSensors}
                                          collisionDetection={closestCenter}
                                          onDragEnd={(evt) => {
                                            // One DndContext serves both
                                            // component-header drags (comp-X
                                            // ids, from the outer SortableContext
                                            // wrapping the TableBody) and task
                                            // row drags (raw numeric ids, from
                                            // the per-component SortableContext
                                            // inside each Fragment). We route on
                                            // the active-id prefix so each level
                                            // updates the right state.
                                            const aid = String(evt.active.id);
                                            if (aid.startsWith('comp-')) {
                                              handleComponentDragEnd(evt);
                                            } else {
                                              handleTaskDragEnd(evt);
                                            }
                                          }}
                                        >
                                          <div className="rounded-lg border border-border/60 overflow-hidden">
                                            <Table>
                                              <TableHeader>
                                                <TableRow className="bg-muted/40 hover:bg-muted/40">
                                                  <TableHead className="w-10 text-center text-label ">
                                                    #
                                                  </TableHead>
                                                  <TableHead className="text-label ">
                                                    {t('adminProjectSetupPage.task')}
                                                  </TableHead>
                                                  <TableHead
                                                    className="hidden md:table-cell w-[110px] text-center text-label "
                                                    title={t('adminProjectSetupPage.baselineTitle')}
                                                  >
                                                    {t('adminProjectSetupPage.baseline')}
                                                  </TableHead>
                                                  <TableHead
                                                    className="w-[150px] text-center text-label "
                                                    title={t('adminProjectSetupPage.weightInDrawingTitle')}
                                                  >
                                                    {t('adminProjectSetupPage.weight')}
                                                  </TableHead>
                                                  <TableHead className="w-10" />
                                                </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                <SortableContext
                                                  items={drawingComps.map(
                                                    (c) => `comp-${c.id}`,
                                                  )}
                                                  strategy={verticalListSortingStrategy}
                                                >
                                                {drawingComps.map((comp, compIdx) => (
                                                  <ComponentRow
                                                    key={comp.id}
                                                    comp={comp}
                                                    startIndex={taskStartIndex[compIdx] ?? 0}
                                                    addTask={addTask}
                                                    addTasksBulk={addTasksBulk}
                                                    delComp={delComp}
                                                    equalSplitTasks={equalSplitTasks}
                                                    stableAddTask={stableAddTask}
                                                    stableDelTask={stableDelTask}
                                                    stableSetTaskBaseline={stableSetTaskBaseline}
                                                    stableUTask={stableUTask}
                                                    t={t}
                                                    tasks={tasks}
                                                    uComp={uComp}
                                                    blockW={blockW}
                                                    blockTeamShare={blockTeamShare}
                                                    drW={drW}
                                                  />
                                                ))}
                                                </SortableContext>
                                              </TableBody>
                                            </Table>
                                          </div>
                                        </DndContext>
                                      )}
    </>
  );
}

export default ComponentsTable;
