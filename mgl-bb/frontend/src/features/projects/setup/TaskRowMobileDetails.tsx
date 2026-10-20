/** Mobile expansion row for a task — only visible on small screens when the
 *  chevron is open. Holds the fields that don't fit in the single-line task
 *  row layout. Extracted verbatim from `AdminProjectSetupPage.tsx`'s
 *  `TaskRow` when that module was split up — no behavioural change. */
import { Trash2 } from 'lucide-react';

import { Button } from '@/ui/button';
import { TableCell, TableRow } from '@/ui/table';
import { useLanguage } from '@/shared/i18n';

import { TaskBaselineInput } from './TaskBaselineInput';
import type { TaskBaselineState } from './useTaskBaseline';

/** 2026-10-01: «Хариуцагч» сонгогч ХАСАГДСАН (таскийг ажилтан өөрөө авна). */
export function TaskRowMobileDetails({
  baseline,
  onDelete,
}: {
  baseline: TaskBaselineState;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  return (
    <TableRow className="md:hidden bg-muted/20 hover:bg-muted/20">
      <TableCell colSpan={4} className="py-3 space-y-3">
        <div className="space-y-1">
          <div className="text-label text-muted-foreground font-medium">
            {t('adminProjectSetupPage.baselineMobileLabel')}
          </div>
          <TaskBaselineInput state={baseline} variant="mobile" />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/30 hover:bg-destructive/10 w-full h-8 text-xs"
          onClick={onDelete}
        >
          <Trash2 className="w-3 h-3 mr-1.5" /> {t('adminProjectSetupPage.deleteTask')}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default TaskRowMobileDetails;
