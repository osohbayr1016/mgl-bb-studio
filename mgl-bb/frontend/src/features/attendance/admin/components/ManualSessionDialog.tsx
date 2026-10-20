import { Plus } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { todayStr } from '@/features/attendance/admin/utils/dates';
import type { SessionEditingState } from '@/features/attendance/admin/hooks/useSessionEditing';
import type { StaffOption } from '@/features/attendance/admin/hooks/useStaffOptions';
import EmployeeSelect from '@/features/attendance/admin/components/EmployeeSelect';
import {
  NextDayCheckbox,
  OptionalNoteField,
} from '@/features/attendance/admin/components/DialogFields';

/** Ирц нөхөж бүртгэх (manual session) dialog. */
export default function ManualSessionDialog({
  editing,
  staffOptions,
}: {
  editing: SessionEditingState;
  staffOptions: StaffOption[];
}) {
  const { t } = useLanguage();
  const {
    manualOpen,
    setManualOpen,
    manualUserId,
    setManualUserId,
    manualDate,
    setManualDate,
    manualIn,
    setManualIn,
    manualOut,
    setManualOut,
    manualNextDay,
    setManualNextDay,
    manualNote,
    setManualNote,
    manualSaving,
    submitManualSession,
  } = editing;

  return (
    <Dialog open={manualOpen} onOpenChange={setManualOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            {t('attendanceAdminPage.backfillSession')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <EmployeeSelect value={manualUserId} onChange={setManualUserId} options={staffOptions} />
          <div className="space-y-1.5">
            <Label className="text-xs">{t('attendanceAdminPage.colDate')}</Label>
            <Input
              type="date"
              value={manualDate}
              max={todayStr()}
              onChange={(e) => setManualDate(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('attendanceAdminPage.colActualIn')}</Label>
              <Input
                type="time"
                value={manualIn}
                onChange={(e) => setManualIn(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t('attendanceAdminPage.colActualOut')}{' '}
                <span className="text-muted-foreground">({t('common.optional')})</span>
              </Label>
              <Input
                type="time"
                value={manualOut}
                onChange={(e) => setManualOut(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>
          {manualOut && (
            <NextDayCheckbox
              id="manual-next-day"
              checked={manualNextDay}
              onChange={setManualNextDay}
            />
          )}
          <OptionalNoteField
            rows={2}
            placeholder={t('attendanceAdminPage.manualNotePlaceholder')}
            value={manualNote}
            onChange={setManualNote}
          />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => setManualOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submitManualSession} disabled={manualSaving}>
            {t('attendanceAdminPage.confirmAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
