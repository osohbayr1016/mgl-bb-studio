/** Drawing toolbar — fused into a single bar. Name + component-sum badge on
 *  the left, action cluster (add-component / split / overflow) on the right.
 *
 *  The drawing's own weight input is intentionally absent — drawings act as
 *  folders in the UI. The weight is still stored (auto-even-split on add) so
 *  the block-progress rollup keeps working under the hood.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { MoreHorizontal, Plus, Scale, Trash2 } from 'lucide-react';

import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';

import { PresetMultiPicker } from './PresetMultiPicker';
import { getPresetsForDrawing } from './presetLookup';
import type { Comp, Drawing } from './types';
import type { SetupApi } from './useProjectSetup';

export function DrawingToolbar({
  dr,
  drawingComps,
  drW,
  drTaskN,
  teamCode,
  usesCompW,
  compRelSum,
  compSumStatus,
  uDraw,
  addComponent,
  addComponentsBulk,
  equalSplitDrawingComponents,
  equalSplitDrawingTasks,
  delDraw,
  t,
}: {
  dr: Drawing;
  drawingComps: Comp[];
  drW: number;
  drTaskN: number;
  teamCode: string | null;
  usesCompW: boolean;
  compRelSum: number;
  compSumStatus: 'ok' | 'over' | 'under' | 'empty';
  uDraw: SetupApi['uDraw'];
  addComponent: SetupApi['addComponent'];
  addComponentsBulk: SetupApi['addComponentsBulk'];
  equalSplitDrawingComponents: SetupApi['equalSplitDrawingComponents'];
  equalSplitDrawingTasks: SetupApi['equalSplitDrawingTasks'];
  delDraw: SetupApi['delDraw'];
  t: SetupApi['t'];
}) {
  const presetInfo = getPresetsForDrawing(dr.name);
  return (
    <div className="flex items-center gap-3 flex-wrap p-2.5 border border-border/50 rounded-lg bg-secondary/20">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {teamCode && (
          <Badge
            variant="secondary"
            className="bg-primary/15 text-primary border-primary/30 text-micro flex-shrink-0 font-bold px-1.5"
          >
            {teamCode}
          </Badge>
        )}
        <Input
          value={dr.name}
          onChange={(e) => uDraw(dr.id, 'name', e.target.value)}
          className="h-8 min-w-[180px] flex-1 max-w-md text-sm"
          placeholder={t('adminProjectSetupPage.drawingNamePlaceholder')}
        />
        {/* Sum-of-components indicator (drawing weight UI is hidden but
            admins still need to verify that the components under this
            drawing total 100%). Only shown when at least one component
            carries weight; pure-folder drawings stay clean. */}
        {usesCompW && drawingComps.length > 0 && (
          <Badge
            variant="outline"
            className={cn(
              'text-micro tabular-nums flex-shrink-0',
              compSumStatus === 'ok'
                ? 'border-success/40 bg-success/10 text-success'
                : compSumStatus === 'over'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : compSumStatus === 'under'
                    ? 'border-warning/40 bg-warning/10 text-warning'
                    : 'border-border/60 bg-muted/30 text-muted-foreground',
            )}
            title={t('adminProjectSetupPage.componentsSumTitle')}
          >
            {t('adminProjectSetupPage.componentsSumBadge', { sum: compRelSum.toFixed(1) })}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {presetInfo ? (
          <PresetMultiPicker
            title={t('adminProjectSetupPage.componentType', { type: presetInfo.type })}
            trigger={
              <Button size="sm" className="h-8 text-xs">
                <Plus className="w-3 h-3 mr-1" /> {t('adminProjectSetupPage.component')}
              </Button>
            }
            presets={presetInfo.presets.map((cName) => ({
              key: cName,
              value: cName,
              label: cName,
            }))}
            onConfirm={(names) => addComponentsBulk(dr.id, names)}
            onAddCustom={() => addComponent(dr.id)}
          />
        ) : (
          <Button size="sm" className="h-8 text-xs" onClick={() => addComponent(dr.id)}>
            <Plus className="w-3 h-3 mr-1" /> {t('adminProjectSetupPage.component')}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title={t('adminProjectSetupPage.moreActions')}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-label text-muted-foreground">
              {t('adminProjectSetupPage.drawingActions')}
            </DropdownMenuLabel>
            {usesCompW && drawingComps.length > 1 && drW > 0 && (
              <DropdownMenuItem onClick={() => equalSplitDrawingComponents(dr.id)}>
                <Scale className="w-4 h-4 mr-2" />{' '}
                {t('adminProjectSetupPage.splitComponentsEqually')}
              </DropdownMenuItem>
            )}
            {!usesCompW && drTaskN > 1 && drW > 0 && (
              <DropdownMenuItem onClick={() => equalSplitDrawingTasks(dr.id)}>
                <Scale className="w-4 h-4 mr-2" /> {t('adminProjectSetupPage.splitTasksEqually')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => delDraw(dr.id)}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4 mr-2" /> {t('adminProjectSetupPage.deleteDrawing')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default DrawingToolbar;
