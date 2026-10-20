/* Slimmer version of FlatTaskRow used inside GroupedTasksTable.
 * Drops the Discipline / Drawing / Component cells (those are encoded
 * in the section headers above the row) and keeps the actionable bits:
 * status dot, task name, assignees + share/claim, weights, progress.
 *
 * Extracted from `ProjectDetailPage.tsx` when that file was split into
 * per-component modules — no behavioural change. */
import { memo } from 'react';

import { Progress } from '@/ui/progress';
import { TableCell, TableRow } from '@/ui/table';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { AiSummaryPopover } from './AiSummaryPopover';
import { StatusDot } from './atoms';
import { TaskLiveCell, TaskLiveContent } from './TaskLiveCell';
import { AllocationChildRows } from './AllocationChildRows';
import { previewProgress, useOwnDraftPreview } from '@/features/task-allocation/ownProgressStore';
import { TaskDatesEditor } from './TaskDatesEditor';
import { TaskNameEditor } from './TaskNameEditor';
import { TaskHoursInline } from './RepairHours';
import type { FlatTask, TaskRowProps } from './types';

export const GroupedTaskRow = memo(function GroupedTaskRow({
  task,
  canClaimRole,
  isAdmin,
  hoursMode = false,
  taskHours,
}: { task: FlatTask } & TaskRowProps) {
  const { t } = useLanguage();
  // «Хуваах» — ажилчин ба ахлах/админ; цагаар бодогддог төсөлд утгагүй.
  const canSplit = (canClaimRole || isAdmin) && !hoursMode;
  // Миний хадгалаагүй ноорог (дэд мөрийн −/+) үндсэн ажлын bar-ыг урьдчилан хөдөлгөнө — хадгалтал DB-д юу ч бичигдэхгүй.
  const preview = useOwnDraftPreview(task.id);
  const shown = previewProgress(task.progress, preview);
  return (
    <>
    <TableRow className="hover:bg-muted/30 group" data-task-id={task.id}>
      {/* ТОГТВОРТОЙ дугаар (2026-10-02): төслийн бүтцийн дарааллаар — шүүлтүүр, эрэмбэ, багийн pill-ээс хамаарахгүй. */}
      <TableCell
        className="text-center text-[11px] text-muted-foreground tabular-nums"
        data-testid="task-number"
      >
        {task.number}
      </TableCell>
      <TableCell className="overflow-hidden align-top">
        <div className="flex items-start gap-2 min-w-0 pl-2 pr-2">
          <span className="mt-1.5 flex-shrink-0">
            <StatusDot progress={task.progress} />
          </span>
          <div className="min-w-0 flex-1">
            {/* Нэр засах (✂ хуваах эрхтэй ижил) + админы устгах товч (эзэн 2026-10-12). */}
            <TaskNameEditor task={task} canRename={canClaimRole || isAdmin} canDelete={isAdmin} />
            {/* FlatTaskRow-тэй ижил: огноо.  Таскийн ДЭД ХУГАЦАА (checkpoint) 2026-10-02-нд хасагдсан — түүх үлдсэн,
                шинээр үүсгэх/засах/сануулах зам БАЙХГҮЙ.  Хоёр мөрийн бүрэлдэхүүн ижил байх ёстой. */}
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
      <TaskLiveCell task={task} showSplit={canSplit} />
      {hoursMode ? (
        /* Цагаар бодогддог засварын төсөл (2026-09-24): Зураг % / Төсөл % /
           Явц-ын оронд АЖИЛЛАСАН ЦАГ — «8 цаг · Энхзул 3 цаг · Намуунзул 5 цаг». */
        <TableCell colSpan={3} className="px-1 overflow-hidden">
          <TaskHoursInline info={taskHours?.get(task.id)} />
        </TableCell>
      ) : (
        <>
          {isAdmin && (<>
          {/* Зураг % — share within the parent drawing (matches the editor
          on Project Setup, where weights are typed as "% of drawing").
          Muted/secondary on purpose: most users only care about the
          project-level number to the right, but admins balancing
          weights need this column. Override default `p-2` with `px-1`
          so the body padding matches the header — otherwise the three
          right-side percent columns look gapped apart on data rows. */}
          <TableCell
            className="px-0.5 text-center text-[11px] tabular-nums text-muted-foreground"
            title={t('projectDetailPage.drawingShareTitle', {
              share: task.drawingShare.toFixed(2),
              weight: task.drawingWeight.toFixed(0),
            })}
          >
            {task.drawingShare.toFixed(2)}%
          </TableCell>
          {/* Төсөл % — primary value.  Bumped to bold + primary tint so the
          eye lands here when scanning the table top-to-bottom. */}
          <TableCell
            className="px-0.5 text-center text-xs tabular-nums font-semibold text-primary/85"
            title={t('projectDetailPage.projectShareTitle', {
              block: task.blockWeight,
              leaf: task.leafWeight.toFixed(2),
            })}
          >
            {task.projectShare.toFixed(2)}%
          </TableCell>
          </>)}
          <TableCell className="px-0.5" colSpan={isAdmin ? 1 : 3}>
            <div
              className="flex items-center gap-1"
              title={preview ? t('taskAlloc.own.unsavedTitle') : undefined}
              data-preview={preview ? 'true' : undefined}
            >
              <Progress
                value={shown}
                className="flex-1 h-2"
                indicatorClassName={preview ? 'bg-warning transition-all' : 'transition-all'}
              />
              <span
                className={cn(
                  'text-xs tabular-nums w-8 text-right font-medium',
                  preview
                    ? 'font-semibold text-warning'
                    : shown >= 100
                      ? 'text-emerald-500'
                      : shown > 0
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                )}
              >
                {shown.toFixed(0)}%
              </span>
              {/* Same AI completion summary indicator the flat view renders:
              when a task has been closed at 100% and the AI summarizer has
              cached a review, surface a small sparkle button so admins
              can read it inline without leaving the page. */}
              {task.progress >= 100 && task.ai_completion_summary && (
                <AiSummaryPopover
                  summary={task.ai_completion_summary}
                  at={task.ai_completion_summary_at}
                  taskName={task.name}
                />
              )}
            </div>
          </TableCell>
        </>
      )}
    </TableRow>
    {/* Хуваарилагдсан бол хүн бүрийн дэд мөр (26.1, 26.2 …) — дараагийн таскийн дугаар хөдлөхгүй. */}
    <AllocationChildRows task={task} variant="grouped" isAdmin={isAdmin} />
    </>
  );
});

export default GroupedTaskRow;
