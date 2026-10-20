/** The expanded body of a block card: the drawings toolbar (scaffold +
 *  add-drawing) and the keep-alive tab set of per-drawing panels.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { DRAWING_TYPES } from './componentPresets';
import { DrawingPanel } from './DrawingPanel';
import { DrawingTabStrip } from './DrawingTabStrip';
import { FileText, Inbox, Loader2, Plus, Sparkles } from 'lucide-react';
import { KeepAliveTabs } from '@/ui/keep-alive-tabs';
import { PresetMultiPicker } from './PresetMultiPicker';
import { SectionHeader } from './SectionHeader';
import { sumW } from './weights';
import type { Block, Drawing } from './types';
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
  | 'delComp'
  | 'delDraw'
  | 'dndSensors'
  | 'equalSplitDrawingComponents'
  | 'equalSplitDrawingTasks'
  | 'equalSplitTasks'
  | 'handleComponentDragEnd'
  | 'handleDrawingDragEnd'
  | 'handleTaskDragEnd'
  | 'scaffoldBlockTeams'
  | 'scaffoldingBlock'
  | 'setActiveDrawingByBlock'
  | 'stableAddTask'
  | 'stableDelTask'
  | 'stableSetTaskBaseline'
  | 'stableUTask'
  | 't'
  | 'tasks'
  | 'uComp'
  | 'uDraw'
> & {
  block: Block;
  blockDrawings: Drawing[];
  blockW: number;
  blockTeamShare: number;
};

export function BlockDrawingsSection(props: Props) {
  const {
    activeDrawingByBlock,
    addComponent,
    addComponentsBulk,
    addDrawing,
    addDrawingsBulk,
    addTask,
    addTasksBulk,
    allTeams,
    components,
    delComp,
    delDraw,
    dndSensors,
    equalSplitDrawingComponents,
    equalSplitDrawingTasks,
    equalSplitTasks,
    handleComponentDragEnd,
    handleDrawingDragEnd,
    handleTaskDragEnd,
    scaffoldBlockTeams,
    scaffoldingBlock,
    setActiveDrawingByBlock,
    stableAddTask,
    stableDelTask,
    stableSetTaskBaseline,
    stableUTask,
    t,
    tasks,
    uComp,
    uDraw,
    block,
    blockDrawings,
    blockW,
    blockTeamShare,
  } = props;

  return (
    <>
                        <SectionHeader
                          compact
                          icon={<FileText className="h-3.5 w-3.5" />}
                          title={t('adminProjectSetupPage.drawings')}
                          sum={sumW(blockDrawings)}
                          itemCount={blockDrawings.length}
                          // Drawings are "folders" in the UI — their weights
                          // are kept in the data (auto-even-split on add) so
                          // the block-progress rollup still works, but the
                          // section sum-meter and the manual "Тэнцүү хуваах"
                          // action are hidden so admins don't worry about
                          // them. The block-level meter on the team tab is
                          // the only sum gauge that matters here.
                          hideMeter
                          action={(() => {
                            // Each block belongs to exactly one team via
                            // block.team_id. The scaffolder runs against that
                            // team and the drawing-type picker is filtered to
                            // that team's discipline only — admins shouldn't
                            // be able to add e.g. a BB drawing inside a BA
                            // block. Legacy untagged blocks (team_id == null,
                            // under the "Бусад" pseudo-tab) keep the scaffold
                            // disabled and fall back to the full DRAWING_TYPES
                            // list so the admin can still attach something
                            // until they retag the block.
                            const teamCode = allTeams.find((t) => t.id === block.team_id)?.code;
                            const drawingTypes = teamCode
                              ? DRAWING_TYPES.filter((dt) => dt.code === teamCode)
                              : DRAWING_TYPES;
                            return (
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={scaffoldingBlock != null || !teamCode}
                                  onClick={() =>
                                    teamCode && scaffoldBlockTeams(block.id, new Set([teamCode]))
                                  }
                                  title={
                                    teamCode
                                      ? t('adminProjectSetupPage.scaffoldTitle', { code: teamCode })
                                      : t('adminProjectSetupPage.noTeamOnBlock')
                                  }
                                >
                                  {scaffoldingBlock === block.id ? (
                                    <>
                                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />{' '}
                                      {t('adminProjectSetupPage.creating')}
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles className="w-3 h-3 mr-1" />{' '}
                                      {t('adminProjectSetupPage.fullStructure')}
                                    </>
                                  )}
                                </Button>
                                <PresetMultiPicker
                                  title={t('adminProjectSetupPage.drawingType')}
                                  trigger={
                                    <Button size="sm" variant="outline">
                                      <Plus className="w-3 h-3 mr-1" />{' '}
                                      {t('adminProjectSetupPage.drawing')}
                                    </Button>
                                  }
                                  presets={drawingTypes.map((dt) => ({
                                    key: dt.code,
                                    value: `${dt.code} - ${dt.name}`,
                                    label: (
                                      <span className="flex items-center gap-2 min-w-0">
                                        <Badge
                                          variant="secondary"
                                          className="text-micro flex-shrink-0"
                                        >
                                          {dt.code}
                                        </Badge>
                                        <span className="truncate">{dt.name}</span>
                                      </span>
                                    ),
                                  }))}
                                  onConfirm={(names) => addDrawingsBulk(block.id, names)}
                                  onAddCustom={() => addDrawing(block.id)}
                                />
                              </div>
                            );
                          })()}
                        />

                        {blockDrawings.length === 0 ? (
                          <div className="text-center text-sm text-muted-foreground py-10 border border-dashed border-border/60 rounded-lg flex flex-col items-center gap-2">
                            <Inbox className="h-6 w-6 text-muted-subtle" />
                            <>
                              {t('adminProjectSetupPage.noDrawingsPrefix')}{' '}
                              <strong className="text-foreground">
                                + {t('adminProjectSetupPage.drawing')}
                              </strong>{' '}
                              {t('adminProjectSetupPage.addWithButtonSuffix')}
                            </>
                          </div>
                        ) : (
                          (() => {
                            // Resolve the active drawing tab for this block. We default
                            // to the first drawing if the admin hasn't picked one yet,
                            // and silently fall back to the first if the previously
                            // chosen drawing was deleted.
                            const stored = activeDrawingByBlock[block.id];
                            const validStored =
                              stored && blockDrawings.some((d) => String(d.id) === stored);
                            const activeId = validStored ? stored : String(blockDrawings[0].id);
                            return (
                              <KeepAliveTabs
                                value={activeId}
                                onValueChange={(v) =>
                                  setActiveDrawingByBlock((prev) => ({ ...prev, [block.id]: v }))
                                }
                              >
                                <DrawingTabStrip
                                  blockId={block.id}
                                  blockDrawings={blockDrawings}
                                  components={components}
                                  tasks={tasks}
                                  activeId={activeId}
                                  onPick={(v) =>
                                    setActiveDrawingByBlock((prev) => ({ ...prev, [block.id]: v }))
                                  }
                                  dndSensors={dndSensors}
                                  handleDrawingDragEnd={handleDrawingDragEnd}
                                  t={t}
                                />

                                {blockDrawings.map((dr) => (
                                  <DrawingPanel
                                    key={dr.id}
                                    dr={dr}
                                    addComponent={addComponent}
                                    addComponentsBulk={addComponentsBulk}
                                    addTask={addTask}
                                    addTasksBulk={addTasksBulk}
                                    components={components}
                                    delComp={delComp}
                                    delDraw={delDraw}
                                    dndSensors={dndSensors}
                                    equalSplitDrawingComponents={equalSplitDrawingComponents}
                                    equalSplitDrawingTasks={equalSplitDrawingTasks}
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
                                    uDraw={uDraw}
                                    blockW={blockW}
                                    blockTeamShare={blockTeamShare}
                                  />
                                ))}
                              </KeepAliveTabs>
                            );
                          })()
                        )}
    </>
  );
}

export default BlockDrawingsSection;
