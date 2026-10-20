import { Timer } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import type { OpenSessionsState } from '@/features/attendance/admin/hooks/useOpenSessions';
import {
  NextDayCheckbox,
  OptionalNoteField,
} from '@/features/attendance/admin/components/DialogFields';

/** Bulk «хаах» dialog — сонгосон бүх бүртгэлд нэг гарах цаг бичиж хаана. */
export default function BulkCloseDialog({ open }: { open: OpenSessionsState }) {
  const { t } = useLanguage();
  const {
    bulkCloseDialogOpen,
    setBulkCloseDialogOpen,
    bulkCloseTime,
    setBulkCloseTime,
    bulkCloseNextDay,
    setBulkCloseNextDay,
    bulkCloseNote,
    setBulkCloseNote,
    bulkClosing,
    bulkCloseOpenSessions,
    selectedOpen,
  } = open;

  return (
    <Dialog open={bulkCloseDialogOpen} onOpenChange={setBulkCloseDialogOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-primary" />
            {t('attendanceAdminPage.bulkCloseTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">{t('attendanceAdminPage.bulkCloseHint')}</p>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('attendanceAdminPage.colActualOut')}</Label>
            <Input
              type="time"
              value={bulkCloseTime}
              onChange={(e) => setBulkCloseTime(e.target.value)}
              className="tabular-nums"
            />
            <NextDayCheckbox
              id="bulk-close-next-day"
              checked={bulkCloseNextDay}
              onChange={setBulkCloseNextDay}
            />
          </div>
          <OptionalNoteField
            rows={2}
            placeholder={t('attendanceAdminPage.fixNotePlaceholder')}
            value={bulkCloseNote}
            onChange={setBulkCloseNote}
          />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => setBulkCloseDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void bulkCloseOpenSessions()} disabled={bulkClosing}>
            {t('attendanceAdminPage.closeSelected', { count: selectedOpen.size })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
