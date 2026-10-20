/** The component group header row inside a drawing's task table.
 *
 *  Slimmed down: only the first-class controls (name, weight, count badge)
 *  live inline; secondary actions (split, delete, the +Ажил preset entry) are
 *  stashed in an overflow menu so the row breathes on narrow screens.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { COMPONENT_TASK_PRESETS } from './componentTaskPresets';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { GripVertical, MoreHorizontal, Plus, Scale, Trash2 } from 'lucide-react';
import { Input } from '@/ui/input';
import { PresetMultiPicker } from './PresetMultiPicker';
import { SortableCompShell } from './SortableShells';
import { TableCell, TableRow } from '@/ui/table';
import { WeightInput } from './WeightInput';
import { cn } from '@/shared/lib/utils';
import { num } from './weights';
import type { Comp, Task } from './types';
import type { SetupApi } from './useProjectSetup';

type Props = Pick<
  SetupApi,
  | 'addTask'
  | 'addTasksBulk'
  | 'delComp'
  | 'equalSplitTasks'
  | 't'
  | 'uComp'
> & {
  comp: Comp;
  compTasks: Task[];
  compW: number;
  compRel: number;
  taskSumRel: number;
  tone: string;
  drW: number;
  blockW: number;
  blockTeamShare: number;
};

export function ComponentHeaderRow(props: Props) {
  const {
    addTask,
    addTasksBulk,
    delComp,
    equalSplitTasks,
    t,
    uComp,
    comp,
    compTasks,
    compW,
    compRel,
    taskSumRel,
    tone,
    drW,
    blockW,
    blockTeamShare,
  } = props;

  return (
                                                      <SortableCompShell compId={comp.id}>
                                                        {({
                                                          setNodeRef: compRef,
                                                          style: compStyle,
                                                          attributes: compAttrs,
                                                          listeners: compListeners,
                                                        }) => (
                                                      <TableRow
                                                        ref={compRef}
                                                        style={compStyle}
                                                        className="bg-primary/10 hover:bg-primary/15 border-t-2 border-primary/30"
                                                      >
                                                        <TableCell colSpan={5} className="py-2">
                                                          <div className="flex items-center justify-between gap-2 flex-wrap">
                                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                              <button
                                                                type="button"
                                                                className="flex items-center justify-center h-8 w-5 rounded-md cursor-grab active:cursor-grabbing text-muted-subtle hover:text-muted-foreground hover:bg-muted/40 transition-colors flex-shrink-0 touch-none"
                                                                title={t('adminProjectSetupPage.dragToReorder')}
                                                                {...compAttrs}
                                                                {...compListeners}
                                                              >
                                                                <GripVertical className="w-3.5 h-3.5" />
                                                              </button>
                                                              <Input
                                                                value={comp.name}
                                                                onChange={(e) =>
                                                                  uComp(
                                                                    comp.id,
                                                                    'name',
                                                                    e.target.value,
                                                                  )
                                                                }
                                                                className="h-8 text-sm font-semibold min-w-[180px] flex-1 max-w-md"
                                                                placeholder={t('adminProjectSetupPage.componentNamePlaceholder')}
                                                              />
                                                              <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                  'text-micro tabular-nums flex-shrink-0',
                                                                  tone,
                                                                )}
                                                                title={
                                                                  compW > 0
                                                                    ? t('adminProjectSetupPage.componentWeightTitle', {
                                                                        pct: compRel.toFixed(1),
                                                                      })
                                                                    : t('adminProjectSetupPage.componentGroupingOnlyTitle')
                                                                }
                                                              >
                                                                Σ {taskSumRel.toFixed(1)}%
                                                                {compW > 0 &&
                                                                  ` / ${compRel.toFixed(1)}%`}
                                                              </Badge>
                                                              <Badge
                                                                variant="secondary"
                                                                className="text-micro h-4 px-1.5 tabular-nums hidden sm:inline-flex"
                                                              >
                                                                {t('adminProjectSetupPage.tasksCount', {
                                                                  count: compTasks.length,
                                                                })}
                                                              </Badge>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                              <WeightInput
                                                                value={comp.weight_percent}
                                                                onChange={(v) =>
                                                                  uComp(
                                                                    comp.id,
                                                                    'weight_percent',
                                                                    v,
                                                                  )
                                                                }
                                                                // Component weight is stored as "% of block";
                                                                // its "% of project" is team_share × blockW ×
                                                                // compW / 10000 (team_share is "% of project",
                                                                // blockW is "% of team", compW is "% of block").
                                                                abs={
                                                                  (blockTeamShare *
                                                                    blockW *
                                                                    num(comp.weight_percent)) /
                                                                  10000
                                                                }
                                                                label={t('adminProjectSetupPage.weightLabelComponent')}
                                                                denominator={drW}
                                                                compact
                                                              />
                                                              {COMPONENT_TASK_PRESETS[comp.name] ? (
                                                                <PresetMultiPicker
                                                                  title={t('adminProjectSetupPage.taskType', {
                                                                    name: comp.name,
                                                                  })}
                                                                  trigger={
                                                                    <Button
                                                                      size="sm"
                                                                      variant="outline"
                                                                      className="h-7 text-xs"
                                                                    >
                                                                      <Plus className="w-3 h-3 mr-1" />{' '}
                                                                      {t('adminProjectSetupPage.task')}
                                                                    </Button>
                                                                  }
                                                                  presets={COMPONENT_TASK_PRESETS[
                                                                    comp.name
                                                                  ].map((tName) => ({
                                                                    key: tName,
                                                                    value: tName,
                                                                    label: tName,
                                                                  }))}
                                                                  onConfirm={(names) =>
                                                                    addTasksBulk(comp.id, names)
                                                                  }
                                                                  onAddCustom={() =>
                                                                    addTask(comp.id)
                                                                  }
                                                                />
                                                              ) : (
                                                                <Button
                                                                  size="sm"
                                                                  variant="outline"
                                                                  className="h-7 text-xs"
                                                                  onClick={() => addTask(comp.id)}
                                                                >
                                                                  <Plus className="w-3 h-3 mr-1" />{' '}
                                                                  {t('adminProjectSetupPage.task')}
                                                                </Button>
                                                              )}
                                                              <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                  <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-7 w-7"
                                                                    title={t('adminProjectSetupPage.moreActions')}
                                                                  >
                                                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                                                  </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent
                                                                  align="end"
                                                                  className="w-52"
                                                                >
                                                                  {compTasks.length > 1 && (
                                                                    <DropdownMenuItem
                                                                      onClick={() =>
                                                                        equalSplitTasks(comp.id)
                                                                      }
                                                                    >
                                                                      <Scale className="w-4 h-4 mr-2" />{' '}
                                                                      {t('adminProjectSetupPage.splitEqually')}
                                                                    </DropdownMenuItem>
                                                                  )}
                                                                  <DropdownMenuItem
                                                                    onClick={() => addTask(comp.id)}
                                                                  >
                                                                    <Plus className="w-4 h-4 mr-2" />{' '}
                                                                    {t('adminProjectSetupPage.emptyTask')}
                                                                  </DropdownMenuItem>
                                                                  <DropdownMenuSeparator />
                                                                  <DropdownMenuItem
                                                                    onClick={() => delComp(comp.id)}
                                                                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                                  >
                                                                    <Trash2 className="w-4 h-4 mr-2" />{' '}
                                                                    {t('adminProjectSetupPage.deleteComponent')}
                                                                  </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                              </DropdownMenu>
                                                            </div>
                                                          </div>
                                                        </TableCell>
                                                      </TableRow>
                                                        )}
                                                      </SortableCompShell>
  );
}

export default ComponentHeaderRow;
