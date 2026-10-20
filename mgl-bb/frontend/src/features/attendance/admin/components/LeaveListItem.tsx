import { Ban, CalendarDays, CheckCircle2, Clock, FileText, Trash2, XCircle } from 'lucide-react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { LeaveRequest } from '@/shared/types';
import { Button } from '@/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { formatDateTime } from '@/features/attendance/admin/utils/format';
import LeaveItemBadges from '@/features/attendance/admin/components/LeaveItemBadges';
import PolicyWarningList from '@/features/attendance/admin/components/PolicyWarningList';
import LeaveArrivalCutNote from '@/features/attendance/components/LeaveArrivalCutNote';

type ReviewAction = 'approved' | 'rejected' | 'cancelled';

/** Чөлөөний хүсэлтийн нэг мөр (шийдвэрлэх товчнуудтай). */
export default function LeaveListItem({
  leave: l,
  onReview,
  onDelete,
  deleting,
}: {
  leave: LeaveRequest;
  onReview: (leave: LeaveRequest, action: ReviewAction) => void;
  onDelete: (leave: LeaveRequest) => void;
  deleting: boolean;
}) {
  const { t } = useLanguage();

  return (
    <li className="p-4 flex items-start gap-3 hover:bg-muted/30">
      <Avatar className="h-9 w-9 mt-0.5 shrink-0">
        {l.profile_image && <AvatarImage src={`${MEDIA_BASE_URL}${l.profile_image}`} />}
        <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-semibold">
          {(formatDisplayName(l.full_name) || '??').slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <LeaveItemBadges leave={l} />
        <div className="text-xs text-muted-foreground mt-1">
          <CalendarDays className="h-3 w-3 inline mr-1" />
          {l.start_date} → {l.end_date}
        </div>
        {l.start_time && l.end_time && (
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-sm font-semibold text-foreground tabular-nums">
            <Clock className="h-4 w-4 text-foreground/70" />
            {l.start_time.slice(0, 5)}–{l.end_time.slice(0, 5)}
          </div>
        )}
        <LeaveArrivalCutNote leave={l} className="w-fit max-w-full" />
        <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
          <Clock className="h-3 w-3 inline mr-1" />
          {t('attendanceAdminPage.submitted')}: {formatDateTime(l.created_at)}
        </div>
        {l.reason && <p className="text-xs mt-1 text-foreground/80">{l.reason}</p>}
        {l.attachment_url && (
          <a
            href={`${MEDIA_BASE_URL}${l.attachment_url}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-1"
          >
            <FileText className="h-3 w-3" /> {t('attendanceAdminPage.viewAttachment')}
          </a>
        )}
        {l.reviewer_note && (
          <p className="text-[11px] mt-1 px-2 py-1 rounded bg-muted/50 border border-border/50">
            <span className="font-medium">
              {l.reviewer_name ?? t('attendanceAdminPage.management')}:
            </span>{' '}
            {l.reviewer_note}
          </p>
        )}
        {l.status === 'cancelled' && (l.cancel_note || l.canceller_name) && (
          <p className="text-[11px] mt-1 px-2 py-1 rounded bg-muted/50 border border-border/50">
            <span className="font-medium">
              {t('attendanceAdminPage.cancelledByLabel', {
                name: l.canceller_name ?? t('attendanceAdminPage.management'),
              })}
            </span>
            {l.cancel_note ? ` ${l.cancel_note}` : ''}
          </p>
        )}
        <PolicyWarningList warnings={l.policy_warnings} variant="inline" />
      </div>
      {l.status === 'pending' && (
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1"
            onClick={() => onReview(l, 'approved')}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('attendanceAdminPage.approve')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onReview(l, 'rejected')}
          >
            <XCircle className="h-3.5 w-3.5" /> {t('attendanceAdminPage.reject')}
          </Button>
          {/* Шийдвэрлэлгүй шууд устгах — давхар/буруу илгээсэн хүсэлт. */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            disabled={deleting}
            onClick={() => onDelete(l)}
          >
            <Trash2 className="h-3.5 w-3.5" /> {t('attendanceAdminPage.deleteLeave')}
          </Button>
        </div>
      )}
      {l.status === 'approved' && (
        /* Зөвшөөрөгдсөн чөлөөг цуцлах — ажилтан чөлөөгөө хэрэглэлгүй
           ажилдаа гарсан тохиолдолд. */
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onReview(l, 'cancelled')}
          >
            <Ban className="h-3.5 w-3.5" /> {t('attendanceAdminPage.cancelLeave')}
          </Button>
        </div>
      )}
    </li>
  );
}
