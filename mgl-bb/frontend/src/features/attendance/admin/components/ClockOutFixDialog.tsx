import { Timer } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { formatTime } from '@/features/attendance/admin/utils/format';
import type { SessionEditingState } from '@/features/attendance/admin/hooks/useSessionEditing';
import {
  NextDayCheckbox,
  OptionalNoteField,
} from '@/features/attendance/admin/components/DialogFields';

/** Гарах цаг нөхөх dialog. */
export default function ClockOutFixDialog({ editing }: { editing: SessionEditingState }) {
  const { t } = useLanguage();
  const {
    fixingSession,
    setFixingSession,
    fixTime,
    setFixTime,
    fixNextDay,
    setFixNextDay,
    fixNote,
    setFixNote,
    fixSaving,
    fixError,
    setFixError,
    submitClockOutFix,
  } = editing;

  return (
    <Dialog open={!!fixingSession} onOpenChange={(o) => !o && setFixingSession(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-primary" />
            {t('attendanceAdminPage.fixClockOut')}
          </DialogTitle>
        </DialogHeader>
        {fixingSession && (
          <div className="space-y-3 py-2">
            <div className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">
                {formatDisplayName(fixingSession.full_name ?? '')}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {fixingSession.date} · {t('attendanceAdminPage.colActualIn')}:{' '}
                {formatTime(fixingSession.clock_in)}
              </span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('attendanceAdminPage.colActualOut')}</Label>
              <Input
                type="time"
                value={fixTime}
                onChange={(e) => {
                  setFixTime(e.target.value);
                  setFixError(null);
                }}
                className="tabular-nums"
              />
              <NextDayCheckbox
                id="fix-next-day"
                checked={fixNextDay}
                onChange={(v) => {
                  setFixNextDay(v);
                  setFixError(null);
                }}
              />
            </div>
            <OptionalNoteField
              rows={2}
              placeholder={t('attendanceAdminPage.fixNotePlaceholder')}
              value={fixNote}
              onChange={setFixNote}
            />
            {fixError && (
              <p role="alert" className="text-sm text-destructive">
                {fixError}
              </p>
            )}
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => setFixingSession(null)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submitClockOutFix} disabled={fixSaving}>
            {t('attendanceAdminPage.confirmAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
