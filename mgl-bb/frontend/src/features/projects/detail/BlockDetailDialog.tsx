/* ---------- Block detail dialog ----------
 * Full-screen breakdown of a single block: timing, task counts, per-team
 * performance and the drawing → task tree.
 *
 * NOTE: this dialog is currently detached from the page — it carried a
 * `@ts-expect-error kept for future use` marker in the original file so
 * `noUnusedLocals` stayed quiet. Now that it lives in its own module the
 * export keeps it compiling without the suppression; nothing renders it
 * yet. Extracted verbatim from `ProjectDetailPage.tsx` when that file was
 * split into per-component modules — no behavioural change. */
import { useMemo } from 'react';
import {
  Activity,
  CheckCircle2,
  CircleDashed,
  FileText,
  Layers3,
  Target,
  TrendingUp,
} from 'lucide-react';

import type { BlockProgress, ProjectDetailResponse } from '@/shared/types';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { Progress } from '@/ui/progress';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { BlockRing, StatTile } from './atoms';
import { BlockTasksTable } from './BlockTasksTable';
import { BlockTeamsSection } from './BlockTeamsSection';
import { BlockTimingSection } from './BlockTimingSection';
import { DrawingRow } from './DrawingRow';
import { computeBlockTiming, flattenBlockTasks, groupAssigneesByTeam } from './blockHelpers';
import { progressColor } from './helpers';
import { useProjectPermissions } from './useProjectPermissions';

export function BlockDetailDialog({
  block,
  project,
  onClose,
}: {
  block: BlockProgress | null;
  project: ProjectDetailResponse['project'];
  onClose: () => void;
}) {
  const { t } = useLanguage();
  // Дотоод жин — ЗӨВХӨН админ/ахлахад (2026-10-02).
  const { canManageProjectWork } = useProjectPermissions();
  const open = block !== null;

  const flatTasks = useMemo(() => (block ? flattenBlockTasks(block) : []), [block]);
  const teams = useMemo(() => (block ? groupAssigneesByTeam(block) : []), [block]);
  const timing = useMemo(() => (block ? computeBlockTiming(block) : null), [block]);

  const completedTasks = flatTasks.filter((ft) => ft.task.progress >= 100).length;
  const inProgressTasks = flatTasks.filter(
    (ft) => ft.task.progress > 0 && ft.task.progress < 100,
  ).length;
  const notStartedTasks = flatTasks.length - completedTasks - inProgressTasks;

  const paceDelta =
    timing && timing.expectedProgress != null && block
      ? block.progress - timing.expectedProgress
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        {block && timing && (
          <>
            {/* Sticky header */}
            <div className="px-6 pt-6 pb-4 border-b border-border/60 bg-gradient-to-br from-card to-primary/5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-11 w-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                    <Layers3 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {project.name} · {t('projectDetailPage.block')}
                    </div>
                    <DialogTitle className="text-xl font-bold leading-tight">
                      {block.name}
                    </DialogTitle>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      {canManageProjectWork && (
                        <>
                          <span>
                            {t('projectDetailPage.weight')}{' '}
                            <span className="text-foreground font-medium">{block.weight_percent}%</span>
                          </span>
                          <span>·</span>
                        </>
                      )}
                      <span>
                        {t('projectDetailPage.drawingsTasksCount', {
                          drawings: block.drawings.length,
                          tasks: flatTasks.length,
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <BlockRing value={block.progress} />
              </div>

              {/* Progress bar w/ pace delta */}
              <div className="mt-3 space-y-1.5">
                <Progress
                  value={block.progress}
                  className="h-2"
                  indicatorClassName={progressColor(block.progress)}
                />
                {paceDelta != null && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">
                      {t('projectDetailPage.scheduleExpectedPrefix')}{' '}
                      <span className="text-foreground font-medium tabular-nums">
                        {timing.expectedProgress!.toFixed(0)}%
                      </span>{' '}
                      {t('projectDetailPage.scheduleExpectedSuffix')}
                    </span>
                    <span
                      className={cn(
                        'font-semibold tabular-nums',
                        paceDelta >= 0 ? 'text-emerald-500' : 'text-amber-500',
                      )}
                    >
                      {paceDelta >= 0
                        ? t('projectDetailPage.paceAhead', { pct: paceDelta.toFixed(1) })
                        : t('projectDetailPage.paceBehind', { pct: paceDelta.toFixed(1) })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <BlockTimingSection timing={timing} />

              {/* Stats row */}
              <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile
                  icon={<Target className="h-4 w-4" />}
                  label={t('projectDetailPage.totalTasks')}
                  value={flatTasks.length}
                  tone="default"
                />
                <StatTile
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label={t('projectDetailPage.completed')}
                  value={completedTasks}
                  tone="success"
                />
                <StatTile
                  icon={<Activity className="h-4 w-4" />}
                  label={t('projectDetailPage.inProgress')}
                  value={inProgressTasks}
                  tone="info"
                />
                <StatTile
                  icon={<CircleDashed className="h-4 w-4" />}
                  label={t('projectDetailPage.notStarted')}
                  value={notStartedTasks}
                  tone="muted"
                />
              </section>

              <BlockTeamsSection teams={teams} />

              {/* Drawings → tasks breakdown */}
              <section className="space-y-2">
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> {t('projectDetailPage.drawingsDetail')}
                </h3>
                <div className="space-y-2">
                  {block.drawings.map((d) => (
                    <DrawingRow key={d.id} drawing={d} />
                  ))}
                </div>
              </section>

              <BlockTasksTable flatTasks={flatTasks} />

              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 justify-center pb-2">
                <TrendingUp className="h-3 w-3" />
                {t('projectDetailPage.blockProgressNote')}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default BlockDetailDialog;
