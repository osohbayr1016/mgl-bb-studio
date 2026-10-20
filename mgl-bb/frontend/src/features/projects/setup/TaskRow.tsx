/* ==========================================================================
   TaskRow — one line per task, with mobile-expandable secondary fields.
   ==========================================================================

   Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
   module was split up; the baseline-% editor moved into `TaskBaselineInput`
   (it was duplicated between the desktop cell and the mobile row).

   2026-10-01 (эзэн): «Хариуцагч» сонгогч ХАСАГДСАН — таскийг хүнд оноохгүй,
   ажилтан төслийн хуудаснаас өөрөө «Өөртөө авах»-аар авна (таймер эхэлнэ).
   2026-10-15: хоосон үлдсэн `workers` / `teamCode` / `toggleTaskAssignee`
   props-ыг эцэг компонентуудын гинжтэй хамт хасав.
*/
import { memo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical, Trash2 } from 'lucide-react';

import { Button } from '@/ui/button';
import { TableCell, TableRow } from '@/ui/table';
import { Textarea } from '@/ui/textarea';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { TaskBaselineInput } from './TaskBaselineInput';
import { TaskRowMobileDetails } from './TaskRowMobileDetails';
import type { Task } from './types';
import { useTaskBaseline } from './useTaskBaseline';
import { WeightInput } from './WeightInput';

export const TaskRow = memo(function TaskRow({
  index,
  task,
  taskAbs,
  drW,
  compId,
  uTask,
  delTask,
  addTask,
  setTaskBaseline,
}: {
  index: number;
  task: Task;
  taskAbs: number;
  drW: number;
  /** Parent component id — used to append a sibling task (Enter on the name). */
  compId: number;
  /** Stable parent handlers (see the latest-ref wrappers in the parent). The
   *  per-row closures below are rebuilt on each TaskRow render but never become
   *  props, so memo() still skips unchanged rows. */
  uTask: <K extends keyof Task>(tid: number, field: K, v: Task[K]) => void;
  delTask: (tid: number) => void;
  addTask: (compId: number) => void;
  setTaskBaseline: (tid: number, pct: number) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const onName = (v: string) => uTask(task.id, 'name', v);
  const onWeight = (v: string) => uTask(task.id, 'weight_percent', v);
  const onDelete = () => delTask(task.id);
  const onAddSibling = () => addTask(compId);
  const baseline = useTaskBaseline(task.progress, (pct) => setTaskBaseline(task.id, pct));
  // On screens narrower than `md` we collapse baseline + delete into a
  // per-row expansion.  The row stays compact (#, name, weight, chevron) and
  // the admin taps to reveal the rest when needed.
  const [mobileExpanded, setMobileExpanded] = useState(false);
  // Drag-to-reorder within the parent component. The grip lives in the
  // index cell; the row itself is the sortable node.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(task.id),
  });
  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <>
      <TableRow ref={setNodeRef} style={sortableStyle} className="group hover:bg-muted/20 align-top">
        <TableCell
          className="text-center text-xs text-muted-foreground tabular-nums pt-3 cursor-grab active:cursor-grabbing touch-none"
          title={t('adminProjectSetupPage.dragToReorder')}
          {...attributes}
          {...listeners}
        >
          <div className="flex flex-col items-center gap-0.5">
            <GripVertical className="h-3 w-3 text-muted-subtle group-hover:text-muted-foreground transition-colors" />
            {index}
          </div>
        </TableCell>
        <TableCell className="py-2">
          <Textarea
            autoGrow
            value={task.name}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onAddSibling?.();
              } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Backspace' || e.key === 'Delete')) {
                e.preventDefault();
                onDelete();
              }
            }}
            className="text-sm min-h-[34px] py-1.5"
            placeholder={t('adminProjectSetupPage.taskNamePlaceholder')}
          />
        </TableCell>
        <TableCell className="hidden md:table-cell text-center py-2">
          <TaskBaselineInput state={baseline} variant="desktop" />
        </TableCell>
        <TableCell className="text-center py-2">
          <WeightInput
            value={task.weight_percent}
            onChange={onWeight}
            abs={taskAbs}
            label={t('adminProjectSetupPage.weightLabelDrawing')}
            denominator={drW}
            compact
          />
        </TableCell>
        <TableCell className="text-center py-2">
          <div className="flex items-center justify-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 md:hidden"
              onClick={() => setMobileExpanded((v) => !v)}
              title={
                mobileExpanded
                  ? t('adminProjectSetupPage.collapse')
                  : t('adminProjectSetupPage.details')
              }
            >
              <ChevronDown
                className={cn('w-3.5 h-3.5 transition-transform', mobileExpanded && 'rotate-180')}
              />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive hidden md:inline-flex"
              onClick={onDelete}
              title={t('adminProjectSetupPage.deleteTask')}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {mobileExpanded && (
        <TaskRowMobileDetails baseline={baseline} onDelete={onDelete} />
      )}
    </>
  );
});

export default TaskRow;
