/** The block → drawing → component → task editor tree for the active
 *  team tab, including all four drag-to-reorder surfaces.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx`'s render when that
 *  ~5 700-line module was split up — no behavioural change. Props are a
 *  `Pick` of the `useProjectSetup()` API so the page can spread it straight in. */
import { Button } from '@/ui/button';
import { ChevronDown, Layers3, Plus } from 'lucide-react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { BlockCard } from './BlockCard';
import { SectionHeader } from './SectionHeader';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { UNGROUPED_TAB } from './useSetupStore';
import type { SetupApi } from './useProjectSetup';

type Props = Pick<
  SetupApi,
  | 'activeDrawingByBlock'
  | 'activeTeamId'
  | 'addBlock'
  | 'addComponent'
  | 'addComponentsBulk'
  | 'addDrawing'
  | 'addDrawingsBulk'
  | 'addTask'
  | 'addTasksBulk'
  | 'allTeams'
  | 'blocks'
  | 'components'
  | 'delBlock'
  | 'delComp'
  | 'delDraw'
  | 'dndSensors'
  | 'drawings'
  | 'dupBlock'
  | 'renameBlock'
  | 'equalSplitBlocks'
  | 'equalSplitDrawingComponents'
  | 'equalSplitDrawingTasks'
  | 'equalSplitTasks'
  | 'expBlocks'
  | 'handleBlockDragEnd'
  | 'handleComponentDragEnd'
  | 'handleDrawingDragEnd'
  | 'handleTaskDragEnd'
  | 'isOrphanedBlock'
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
>;

export function BlockList(props: Props) {
  const {
    activeDrawingByBlock,
    activeTeamId,
    addBlock,
    addComponent,
    addComponentsBulk,
    addDrawing,
    addDrawingsBulk,
    addTask,
    addTasksBulk,
    allTeams,
    blocks,
    components,
    delBlock,
    delComp,
    delDraw,
    dndSensors,
    drawings,
    dupBlock,
    renameBlock,
    equalSplitBlocks,
    equalSplitDrawingComponents,
    equalSplitDrawingTasks,
    equalSplitTasks,
    expBlocks,
    handleBlockDragEnd,
    handleComponentDragEnd,
    handleDrawingDragEnd,
    handleTaskDragEnd,
    isOrphanedBlock,
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

          const visibleBlocks =
            activeTeamId === UNGROUPED_TAB
              ? blocks.filter(isOrphanedBlock)
              : blocks.filter((b) => b.team_id === activeTeamId);
          const activeTeamCode =
            activeTeamId === UNGROUPED_TAB
              ? t('adminProjectSetupPage.other')
              : (teamShares.find((ts) => ts.team_id === activeTeamId)?.team_code ?? '');
          const sectionTitle =
            activeTeamId != null
              ? t('adminProjectSetupPage.blocksWithTeam', { code: activeTeamCode })
              : t('adminProjectSetupPage.blocks');
          const addDisabled = activeTeamId == null || activeTeamId === UNGROUPED_TAB;
          // Block weight is "% within team" → the sum-to-100 meter is
          // scoped to the active team's blocks only.
          const visibleBlockSum = visibleBlocks.reduce(
            (s, b) => s + Number(b.weight_percent || 0),
            0,
          );
          return (
            <>
              <SectionHeader
                icon={<Layers3 className="h-4 w-4" />}
                title={sectionTitle}
                sum={visibleBlockSum}
                itemCount={visibleBlocks.length}
                onEqualSplit={equalSplitBlocks}
                action={
                  <div className="flex items-center gap-2">
                    {blocks.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const allOpen = expBlocks.size === blocks.length;
                          if (allOpen) {
                            setExpBlocks(new Set());
                          } else {
                            setExpBlocks(new Set(blocks.map((b) => b.id)));
                            setLastOpenedBlock(blocks[blocks.length - 1].id);
                          }
                        }}
                        title={
                          expBlocks.size === blocks.length
                            ? t('adminProjectSetupPage.collapseAll')
                            : t('adminProjectSetupPage.expandAllBlocks')
                        }
                      >
                        {expBlocks.size === blocks.length ? (
                          <>
                            <ChevronDown className="w-4 h-4 mr-1 rotate-180" />{' '}
                            {t('adminProjectSetupPage.collapse')}
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-4 h-4 mr-1" />{' '}
                            {t('adminProjectSetupPage.expandAll')}
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() =>
                        addBlock(typeof activeTeamId === 'number' ? activeTeamId : null)
                      }
                      disabled={addDisabled}
                      title={
                        activeTeamId === UNGROUPED_TAB
                          ? t('adminProjectSetupPage.cannotAddBlockToUngrouped')
                          : undefined
                      }
                    >
                      <Plus className="w-4 h-4 mr-1" /> {t('adminProjectSetupPage.block')}
                    </Button>
                  </div>
                }
              />

              <DndContext
                sensors={dndSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleBlockDragEnd}
              >
                <SortableContext
                  items={visibleBlocks.map((b) => `block-${b.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {visibleBlocks.map((block) => (
                    <BlockCard
                      key={block.id}
                      block={block}
                      activeDrawingByBlock={activeDrawingByBlock}
                      addComponent={addComponent}
                      addComponentsBulk={addComponentsBulk}
                      addDrawing={addDrawing}
                      addDrawingsBulk={addDrawingsBulk}
                      addTask={addTask}
                      addTasksBulk={addTasksBulk}
                      allTeams={allTeams}
                      components={components}
                      delBlock={delBlock}
                      delComp={delComp}
                      delDraw={delDraw}
                      dndSensors={dndSensors}
                      drawings={drawings}
                      dupBlock={dupBlock}
                      renameBlock={renameBlock}
                      equalSplitDrawingComponents={equalSplitDrawingComponents}
                      equalSplitDrawingTasks={equalSplitDrawingTasks}
                      equalSplitTasks={equalSplitTasks}
                      expBlocks={expBlocks}
                      handleComponentDragEnd={handleComponentDragEnd}
                      handleDrawingDragEnd={handleDrawingDragEnd}
                      handleTaskDragEnd={handleTaskDragEnd}
                      saving={saving}
                      scaffoldBlockTeams={scaffoldBlockTeams}
                      scaffoldingBlock={scaffoldingBlock}
                      setActiveDrawingByBlock={setActiveDrawingByBlock}
                      setExpBlocks={setExpBlocks}
                      setLastOpenedBlock={setLastOpenedBlock}
                      stableAddTask={stableAddTask}
                      stableDelTask={stableDelTask}
                      stableSetTaskBaseline={stableSetTaskBaseline}
                      stableUTask={stableUTask}
                      t={t}
                      tasks={tasks}
                      teamShares={teamShares}
                      uBlock={uBlock}
                      uComp={uComp}
                      uDraw={uDraw}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </>
          );
}
