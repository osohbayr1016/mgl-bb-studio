/* ---------- FlatTaskRow ----------
 * One row per task in the new flat data-grid view. Renders the full
 * Drawing › Component › Task context inline (no nested heading rows) so
 * admins can scan, sort, and act on a project at a glance.
 *
 * The "showDiscipline" prop toggles the leading discipline pill — we show
 * it on the "Бүгд" tab (where rows from different disciplines mix) and
 * hide it on per-discipline tabs (where it would be redundant).
 *
 * Extracted from `ProjectDetailPage.tsx` when that file was split into
 * per-component modules — no behavioural change.
 */
import { memo } from 'react';

import { Badge } from '@/ui/badge';
import { Progress } from '@/ui/progress';
import { TableCell, TableRow } from '@/ui/table';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { previewProgress, useOwnDraftPreview } from '@/features/task-allocation/ownProgressStore';

import { AiSummaryPopover } from './AiSummaryPopover';
import { StatusDot } from './atoms';
import { progressColor } from './helpers';
import { TaskLiveCell, TaskLiveContent } from './TaskLiveCell';
import { AllocationChildRows } from './AllocationChildRows';
import { TaskDatesEditor } from './TaskDatesEditor';
import { TaskNameEditor } from './TaskNameEditor';
import type { FlatTask, TaskRowProps } from './types';

export const FlatTaskRow = memo(function FlatTaskRow({
  task,
  showDiscipline: _showDiscipline,
  canClaimRole,
  isAdmin,
}: { task: FlatTask; showDiscipline: boolean } & TaskRowProps) {
  const { t } = useLanguage();
  // «Хуваах» — ажилчин ба ахлах/админ (сервер дахин шалгана).
  const canSplit = canClaimRole || isAdmin;
  // Миний хадгалаагүй ноорог (дэд мөрийн −/+) үндсэн ажлын bar-ыг урьдчилан хөдөлгөнө.
  const preview = useOwnDraftPreview(task.id);
  const shown = previewProgress(task.progress, preview);
  const componentLabel = (task.component ?? '').trim();
  const componentRedundant =
    !componentLabel ||
    componentLabel === '—' ||
    componentLabel === '-' ||
    componentLabel.toLowerCase() === task.drawing.trim().toLowerCase();
  /* "Зураг" tooltip — combines drawing + block context in a single
     hover string so the compact pill never drops information. We
     intentionally avoid a JSX <Tooltip> here because the cell is
     rendered for every task and a portal-tooltip per row was costly. */
  const drawingTitle = task.block ? `${task.drawing} • ${task.block}` : task.drawing;

  return (
    <>
    <TableRow className="hover:bg-muted/40 group" data-task-id={task.id}>
      {/* ТОГТВОРТОЙ дугаар (2026-10-02): төслийн бүтцийн дарааллаар — шүүлтүүр, эрэмбэ, багийн pill-ээс хамаарахгүй. */}
      <TableCell
        className="text-center text-[11px] text-muted-foreground tabular-nums"
        data-testid="task-number"
      >
        {task.number}
      </TableCell>

      {/* Drawing — compact discipline pill (BA / BB / HAS / ...).  Full
          drawing + block label is available on hover via `title`. The
          standalone "Багц" column was dropped because it duplicated this
          information. */}
      <TableCell className="text-sm" title={drawingTitle}>
        {task.teamCode ? (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-mono font-semibold border-primary/40 text-primary bg-primary/5"
          >
            {task.teamCode}
          </Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground italic">—</span>
        )}
      </TableCell>

      {/* Component */}
      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
        {componentRedundant ? (
          <span className="italic text-muted-foreground/60">—</span>
        ) : (
          <span className="truncate inline-block max-w-full" title={componentLabel}>
            {componentLabel}
          </span>
        )}
      </TableCell>

      {/* Task name */}
      <TableCell className="overflow-hidden align-top">
        <div className="flex items-start gap-2 min-w-0 pr-2">
          <span className="mt-1.5 flex-shrink-0">
            <StatusDot progress={task.progress} />
          </span>
          <div className="min-w-0 flex-1">
            {/* Нэр засах (✂ хуваах эрхтэй ижил) + админы устгах товч (эзэн 2026-10-12). */}
            <TaskNameEditor task={task} canRename={canClaimRole || isAdmin} canDelete={isAdmin} />
            {/* Огноо.  Таскийн ДЭД ХУГАЦАА (checkpoint, `task_deadlines` 0148) 2026-10-02-нд хасагдсан: түүх үлдсэн,
                шинээр үүсгэх/засах/сануулах зам БАЙХГҮЙ (milestone хэвээр). */}
            <div className="flex flex-wrap items-center gap-x-2">
              <TaskDatesEditor task={task} canEdit={isAdmin} />
            </div>
            {/* «Одоо хийж буй» + «Өөртөө авах» — lg-ээс доош нүд нуугддаг тул энд. */}
            <div className="mt-1 lg:hidden">
              <TaskLiveContent task={task} compact showSplit={canSplit} />
            </div>
          </div>
        </div>
      </TableCell>

      {/* Одоо хийж буй хүн (албан таймер) + «Өөртөө авах» / «Хувааж авах» / «Зогсоох». */}
      <TaskLiveCell task={task} showSplit={canSplit} />

      {/* Нийт % — дотоод жин: ЗӨВХӨН админ/ахлахад (ажилтанд харагдахгүй, 2026-10-02). */}
      {isAdmin && (
        <TableCell
          className="text-center text-xs text-muted-foreground tabular-nums"
          title={t('projectDetailPage.totalShareTitle', {
            block: task.blockWeight,
            leaf: task.leafWeight.toFixed(2),
          })}
        >
          {task.projectShare.toFixed(2)}%
        </TableCell>
      )}

      {/* Progress */}
      <TableCell>
        <div
          className="flex items-center gap-2"
          title={preview ? t('taskAlloc.own.unsavedTitle') : undefined}
          data-preview={preview ? 'true' : undefined}
        >
          <Progress
            value={shown}
            className="h-2 flex-1"
            indicatorClassName={preview ? 'bg-warning transition-all' : progressColor(shown)}
          />
          <span
            className={cn('text-xs font-medium w-10 text-right tabular-nums', preview && 'font-semibold text-warning')}
          >
            {shown.toFixed(0)}%
          </span>
          {task.progress >= 100 && task.ai_completion_summary && (
            <AiSummaryPopover
              summary={task.ai_completion_summary}
              at={task.ai_completion_summary_at}
              taskName={task.name}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
    {/* Хуваарилагдсан бол хүн бүрийн дэд мөр (26.1, 26.2 …) — дараагийн таскийн дугаар хөдлөхгүй. */}
    <AllocationChildRows task={task} variant="flat" isAdmin={isAdmin} />
    </>
  );
});

export default FlatTaskRow;
