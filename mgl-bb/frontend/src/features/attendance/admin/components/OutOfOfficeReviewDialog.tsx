import { CheckCircle2, XCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { OOO_CATEGORY_META } from '@/features/attendance/admin/constants';
import type { OutOfOfficeState } from '@/features/attendance/admin/hooks/useOutOfOfficeAdmin';
import { OptionalNoteField } from '@/features/attendance/admin/components/DialogFields';

/** Гадуур ажлыг зөвшөөрөх / татгалзах шийдвэрийн цонх. */
export default function OutOfOfficeReviewDialog({ state }: { state: OutOfOfficeState }) {
  const { t } = useLanguage();
  const { reviewingOoo, setReviewingOoo, reviewOooNote, setReviewOooNote, submitOooReview } = state;

  return (
    <Dialog open={!!reviewingOoo} onOpenChange={(o) => !o && setReviewingOoo(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reviewingOoo?.action === 'approved' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            )}
            {reviewingOoo?.action === 'approved'
              ? t('attendanceAdminPage.approveOutOfOffice')
              : t('attendanceAdminPage.rejectOutOfOffice')}
          </DialogTitle>
        </DialogHeader>
        {reviewingOoo && (
          <div className="space-y-3 py-2">
            <div className="text-sm">
              <span className="font-medium">{formatDisplayName(reviewingOoo.req.full_name)}</span>
              {' · '}
              <span className="text-muted-foreground">
                {t(OOO_CATEGORY_META[reviewingOoo.req.category].labelKey)} ·{' '}
                {t('attendanceAdminPage.hoursLong', { hours: reviewingOoo.req.hours })}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {reviewingOoo.req.work_date}
              {reviewingOoo.req.start_time &&
                ` · ${reviewingOoo.req.start_time} → ${reviewingOoo.req.end_time ?? '?'}`}
            </div>
            {reviewingOoo.req.reason && (
              <p className="text-xs px-3 py-2 rounded bg-muted/50 border border-border/50">
                {reviewingOoo.req.reason}
              </p>
            )}
            <OptionalNoteField rows={3} value={reviewOooNote} onChange={setReviewOooNote} />
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => setReviewingOoo(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            className={
              reviewingOoo?.action === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : ''
            }
            variant={reviewingOoo?.action === 'rejected' ? 'destructive' : 'default'}
            onClick={submitOooReview}
          >
            {t('attendanceAdminPage.confirmAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
