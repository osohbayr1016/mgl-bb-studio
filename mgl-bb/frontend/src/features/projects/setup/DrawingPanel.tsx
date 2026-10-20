/** One drawing's editor panel: the drawing toolbar plus its component →
 *  task table, rendered inside the block's keep-alive tab set.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { ComponentsTable } from './ComponentsTable';
import { DrawingToolbar } from './DrawingToolbar';
import { KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { drawingTaskCount, drawingUsesComponentWeights, num, weightStatusVsTarget } from './weights';
import { drawingTeamCode } from './teamMeta';
import type { Drawing } from './types';
import type { SetupApi } from './useProjectSetup';

type Props = Pick<
  SetupApi,
  | 'addComponent'
  | 'addComponentsBulk'
  | 'addTask'
  | 'addTasksBulk'
  | 'components'
  | 'delComp'
  | 'delDraw'
  | 'dndSensors'
  | 'equalSplitDrawingComponents'
  | 'equalSplitDrawingTasks'
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
  | 'uDraw'
> & {
  dr: Drawing;
  blockW: number;
  blockTeamShare: number;
};

export function DrawingPanel(props: Props) {
  const {
    addComponent,
    addComponentsBulk,
    addTask,
    addTasksBulk,
    components,
    delComp,
    delDraw,
    dndSensors,
    equalSplitDrawingComponents,
    equalSplitDrawingTasks,
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
    uDraw,
    dr,
    blockW,
    blockTeamShare,
  } = props;

                                    const drawingComps = components.filter(
                                    (c) => c.drawing_id === dr.id,
                                  );
                                  const drW = num(dr.weight_percent);
                                  const drTaskN = drawingTaskCount(dr.id, components, tasks);
                                  const teamCode = drawingTeamCode(dr.name);
                                  const usesCompW = drawingUsesComponentWeights(dr.id, components);
                                  // Sum of component weights (stored as "% of block")
                                  // normalized to the drawing's own weight, so the
                                  // displayed % matches what each component shows in
                                  // its WeightInput. Only meaningful when at least
                                  // one component carries weight; otherwise the row
                                  // is just folders and there's nothing to balance.
                                  const compStoredSum = drawingComps.reduce(
                                    (s, c) => s + num(c.weight_percent),
                                    0,
                                  );
                                  const compRelSum =
                                    drW > 0 ? +((compStoredSum * 100) / drW).toFixed(1) : 0;
                                  const compSumStatus =
                                    usesCompW && drawingComps.length > 0
                                      ? weightStatusVsTarget(
                                          compStoredSum,
                                          drW,
                                          drawingComps.length,
                                        )
                                      : 'empty';
                                  return (
                                    <KeepAliveTabsPanel
                                      key={dr.id}
                                      value={String(dr.id)}
                                      className="mt-3 space-y-3"
                                    >
                                      <DrawingToolbar
                                        dr={dr}
                                        drawingComps={drawingComps}
                                        drW={drW}
                                        drTaskN={drTaskN}
                                        teamCode={teamCode}
                                        usesCompW={usesCompW}
                                        compRelSum={compRelSum}
                                        compSumStatus={compSumStatus}
                                        uDraw={uDraw}
                                        addComponent={addComponent}
                                        addComponentsBulk={addComponentsBulk}
                                        equalSplitDrawingComponents={equalSplitDrawingComponents}
                                        equalSplitDrawingTasks={equalSplitDrawingTasks}
                                        delDraw={delDraw}
                                        t={t}
                                      />

                                      {/* Tasks table — mirrors the project overview
                                  layout: component group rows act as section
                                  headers, tasks render as numbered rows
                                  beneath them.  Always-expanded so the admin
                                  doesn't lose context while reviewing weights. */}
                                      <ComponentsTable
                                        addTask={addTask}
                                        addTasksBulk={addTasksBulk}
                                        delComp={delComp}
                                        dndSensors={dndSensors}
                                        equalSplitTasks={equalSplitTasks}
                                        handleComponentDragEnd={handleComponentDragEnd}
                                        handleTaskDragEnd={handleTaskDragEnd}
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
                                        drawingComps={drawingComps}
                                      />
                                    </KeepAliveTabsPanel>
  );
}

export default DrawingPanel;
