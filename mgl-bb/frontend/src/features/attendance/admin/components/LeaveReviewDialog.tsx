import { Ban, CheckCircle2, XCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { LEAVE_TYPE_META } from '@/features/attendance/admin/constants';
import { resolveLeavePolicy } from '@/features/attendance/admin/utils/leavePolicyView';
import type { LeaveActionsState } from '@/features/attendance/admin/hooks/useLeaveActions';
import PaidBadge from '@/features/attendance/admin/components/PaidBadge';
import PolicyWarningList from '@/features/attendance/admin/components/PolicyWarningList';

/** Чөлөө зөвшөөрөх / татгалзах / цуцлах шийдвэрийн цонх. */
export default function LeaveReviewDialog({ actions }: { actions: LeaveActionsState }) {
  const { t } = useLanguage();
  const { reviewing, setReviewing, reviewNote, setReviewNote, submitReview } = actions;

  const titleKey =
    reviewing?.action === 'approved'
      ? 'attendanceAdminPage.approveLeave'
      : reviewing?.action === 'cancelled'
        ? 'attendanceAdminPage.cancelLeaveTitle'
        : 'attendanceAdminPage.rejectLeave';

  const notePlaceholderKey =
    reviewing?.action === 'approved'
      ? 'attendanceAdminPage.notePlaceholderApprove'
      : reviewing?.action === 'cancelled'
        ? 'attendanceAdminPage.notePlaceholderCancel'
        : 'attendanceAdminPage.notePlaceholderReject';

  const leave = reviewing?.leave;
  // Татгалзахад шалтгаан заавал — backend `POST /leaves/:id/reject` хоосон
  // note-д 400 өгдөг; ажилтанд очих мэдэгдэл тэр текстийг тээдэг.
  const noteRequired = reviewing?.action === 'rejected';
  const noteMissing = noteRequired && reviewNote.trim() === '';
  const { policy, isPaid } = leave
    ? resolveLeavePolicy(leave)
    : { policy: null, isPaid: null as boolean | null };

  return (
    <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reviewing?.action === 'approved' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : reviewing?.action === 'cancelled' ? (
              <Ban className="h-5 w-5 text-destructive" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            )}
            {t(titleKey)}
          </DialogTitle>
        </DialogHeader>
        {leave && (
          <div className="space-y-3 py-2">
            <div className="text-sm flex flex-wrap items-center gap-2">
              <span className="font-medium">{formatDisplayName(leave.full_name)}</span>
              <span className="text-muted-foreground">
                · {policy?.label ?? t(LEAVE_TYPE_META[leave.leave_type].labelKey)}
              </span>
              <PaidBadge isPaid={isPaid} />
              {policy && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  {policy.rule_id}
                </Badge>
              )}
              {leave.requires_ceo_approval && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-violet-300 text-violet-700 bg-violet-50 dark:bg-violet-900/20"
                >
                  {t('attendanceAdminPage.ceoApprovalRequired')}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {leave.start_date} → {leave.end_date} ·{' '}
              {t('attendanceAdminPage.daysShort', { days: leave.days })}
              {leave.start_time && leave.end_time && (
                <span className="ml-1.5 tabular-nums">
                  · {leave.start_time.slice(0, 5)}–{leave.end_time.slice(0, 5)}
                </span>
              )}
            </div>
            {leave.reason && (
              <p className="text-xs px-3 py-2 rounded bg-muted/50 border border-border/50">
                {leave.reason}
              </p>
            )}
            <PolicyWarningList warnings={leave.policy_warnings} variant="boxed" />
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t('attendanceAdminPage.note')}{' '}
                <span className="text-muted-foreground">
                  ({noteRequired ? t('common.required') : t('common.optional')})
                </span>
              </Label>
              <Textarea
                rows={3}
                placeholder={t(notePlaceholderKey)}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                aria-required={noteRequired}
              />
              {noteRequired && (
                <p className="text-xs text-muted-foreground">
                  {t('attendanceAdminPage.rejectNoteHint')}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => setReviewing(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            className={
              reviewing?.action === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : ''
            }
            variant={
              reviewing?.action === 'rejected' || reviewing?.action === 'cancelled'
                ? 'destructive'
                : 'default'
            }
            onClick={submitReview}
            disabled={noteMissing}
          >
            {t('attendanceAdminPage.confirmAction')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
