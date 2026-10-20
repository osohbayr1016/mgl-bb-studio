/** One block's card: the sortable shell, its header, and — when expanded —
 *  the drawings section (tab strip + per-drawing panel).
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { BlockCardHeader } from './BlockCardHeader';
import { Card, CardContent } from '@/ui/card';
import { BlockDrawingsSection } from './BlockDrawingsSection';
import { SortableBlockShell } from './SortableShells';
import { num } from './weights';
import type { Block } from './types';
import type { SetupApi } from './useProjectSetup';

type Props = Pick<
  SetupApi,
  | 'activeDrawingByBlock'
  | 'addComponent'
  | 'addComponentsBulk'
  | 'addDrawing'
  | 'addDrawingsBulk'
  | 'addTask'
  | 'addTasksBulk'
  | 'allTeams'
  | 'components'
  | 'delBlock'
  | 'delComp'
  | 'delDraw'
  | 'dndSensors'
  | 'drawings'
  | 'dupBlock'
  | 'renameBlock'
  | 'equalSplitDrawingComponents'
  | 'equalSplitDrawingTasks'
  | 'equalSplitTasks'
  | 'expBlocks'
  | 'handleComponentDragEnd'
  | 'handleDrawingDragEnd'
  | 'handleTaskDragEnd'
  | 'saving'
  | 'scaffoldBlockTeams'
  | 'scaffoldingBlock'
  | 'setActiveDrawingByBlock'
  | 'setExpBlocks'
  | 'setLastOpenedBlock'
  | 'stableAddTask'
  | 'stableDelTask'
  | 'stableSetTaskBaseline'
  | 'stableUTask'
  | 't'
  | 'tasks'
  | 'teamShares'
  | 'uBlock'
  | 'uComp'
  | 'uDraw'
> & {
  block: Block;
};

export function BlockCard(props: Props) {
  const {
    block,
    activeDrawingByBlock,
    addComponent,
    addComponentsBulk,
    addDrawing,
    addDrawingsBulk,
    addTask,
    addTasksBulk,
    allTeams,
    components,
    delBlock,
    delComp,
    delDraw,
    dndSensors,
    drawings,
    dupBlock,
    renameBlock,
    equalSplitDrawingComponents,
    equalSplitDrawingTasks,
    equalSplitTasks,
    expBlocks,
    handleComponentDragEnd,
    handleDrawingDragEnd,
    handleTaskDragEnd,
    saving,
    scaffoldBlockTeams,
    scaffoldingBlock,
    setActiveDrawingByBlock,
    setExpBlocks,
    setLastOpenedBlock,
    stableAddTask,
    stableDelTask,
    stableSetTaskBaseline,
    stableUTask,
    t,
    tasks,
    teamShares,
    uBlock,
    uComp,
    uDraw,
  } = props;

                    const blockDrawings = drawings.filter((d) => d.block_id === block.id);
                    const blockW = num(block.weight_percent);
                // Team's share of the project — used by the "% of project"
                // tooltip math on per-row weight inputs further down. Zero
                // when the block has no team_id (legacy "Бусад" tab) or the
                // team isn't yet in project_team_shares; the tooltip then
                // collapses to "0% төслийн" which is the truth.
                const blockTeamShare =
                  block.team_id != null
                    ? num(teamShares.find((ts) => ts.team_id === block.team_id)?.share_percent ?? 0)
                    : 0;
                const isOpen = expBlocks.has(block.id);
                return (
                  <SortableBlockShell key={block.id} blockId={block.id}>
                    {(dragHandle) => (
                  <Card
                    data-block-id={block.id}
                    className="border-border bg-card/60 backdrop-blur overflow-hidden scroll-mt-24"
                  >
                    {/* CardHeader is a passive container now.  Only the left
                  "[chevron] [Блок] [name input]" zone toggles the block
                  open/closed; the right side (weight/copy/delete) no
                  longer needs stopPropagation hacks because clicks
                  outside the toggle button never fold the card. */}
                    <BlockCardHeader
                      isOpen={isOpen}
                      delBlock={delBlock}
                      dupBlock={dupBlock}
                      renameBlock={renameBlock}
                      saving={saving}
                      setExpBlocks={setExpBlocks}
                      setLastOpenedBlock={setLastOpenedBlock}
                      t={t}
                      uBlock={uBlock}
                      block={block}
                      dragHandle={dragHandle}
                    />

                    {isOpen && (
                      <CardContent className="pt-0 pl-6 md:pl-12 space-y-3 border-t border-border/40 pb-5">
                        <BlockDrawingsSection
                          activeDrawingByBlock={activeDrawingByBlock}
                          addComponent={addComponent}
                          addComponentsBulk={addComponentsBulk}
                          addDrawing={addDrawing}
                          addDrawingsBulk={addDrawingsBulk}
                          addTask={addTask}
                          addTasksBulk={addTasksBulk}
                          allTeams={allTeams}
                          components={components}
                          delComp={delComp}
                          delDraw={delDraw}
                          dndSensors={dndSensors}
                          equalSplitDrawingComponents={equalSplitDrawingComponents}
                          equalSplitDrawingTasks={equalSplitDrawingTasks}
                          equalSplitTasks={equalSplitTasks}
                          handleComponentDragEnd={handleComponentDragEnd}
                          handleDrawingDragEnd={handleDrawingDragEnd}
                          handleTaskDragEnd={handleTaskDragEnd}
                          scaffoldBlockTeams={scaffoldBlockTeams}
                          scaffoldingBlock={scaffoldingBlock}
                          setActiveDrawingByBlock={setActiveDrawingByBlock}
                          stableAddTask={stableAddTask}
                          stableDelTask={stableDelTask}
                          stableSetTaskBaseline={stableSetTaskBaseline}
                          stableUTask={stableUTask}
                          t={t}
                          tasks={tasks}
                          uComp={uComp}
                          uDraw={uDraw}
                          block={block}
                          blockDrawings={blockDrawings}
                          blockW={blockW}
                          blockTeamShare={blockTeamShare}
                        />
                      </CardContent>
                    )}
                  </Card>
                    )}
                  </SortableBlockShell>
                );
}

export default BlockCard;
