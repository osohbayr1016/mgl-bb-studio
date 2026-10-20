/** Collapsible drawing row used inside the block detail dialog.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { memo, useState } from 'react';
import { Boxes, ChevronRight as ChevronRightIcon } from 'lucide-react';

import type { DrawingProgress } from '@/shared/types';
import { Progress } from '@/ui/progress';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { StatusDot } from './atoms';
import { TaskWorkersStack } from './TaskLiveCell';
import { progressColor } from './helpers';
import { useProjectPermissions } from './useProjectPermissions';

export const DrawingRow = memo(function DrawingRow({ drawing }: { drawing: DrawingProgress }) {
  const { t } = useLanguage();
  // Дотоод жин — ЗӨВХӨН админ/ахлахад (2026-10-02).
  const { canManageProjectWork } = useProjectPermissions();
  const [expanded, setExpanded] = useState(false);
  const taskCount = drawing.components.reduce((s, c) => s + c.tasks.length, 0);
  return (
    <div className="border border-border/60 rounded-lg bg-card/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors text-left"
      >
        <ChevronRightIcon
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{drawing.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {canManageProjectWork
              ? t('projectDetailPage.drawingMeta', {
                  components: drawing.components.length,
                  tasks: taskCount,
                  weight: drawing.weight_percent,
                })
              : t('projectDetailPage.drawingMetaNoWeight', {
                  components: drawing.components.length,
                  tasks: taskCount,
                })}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Progress
            value={drawing.progress}
            className="h-1.5 w-24"
            indicatorClassName={progressColor(drawing.progress)}
          />
          <span className="text-xs font-semibold tabular-nums w-9 text-right">
            {drawing.progress.toFixed(0)}%
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border/60 px-3 py-2 space-y-1 bg-background/40">
          {drawing.components.map((comp) => (
            <div key={comp.id} className="space-y-1">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-1">
                <Boxes className="h-2.5 w-2.5" />
                <span className="font-medium">{comp.name}</span>
                <span className="ml-auto tabular-nums">{comp.progress.toFixed(0)}%</span>
              </div>
              {comp.tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 pl-5 pr-1 py-1 text-xs">
                  <StatusDot progress={t.progress} />
                  <span className="truncate flex-1">{t.name}</span>
                  <TaskWorkersStack taskId={t.id} compact />
                  <Progress
                    value={t.progress}
                    className="h-1 w-16"
                    indicatorClassName={progressColor(t.progress)}
                  />
                  <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">
                    {t.progress.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default DrawingRow;
