import { CalendarDays, CheckCircle2, Clock, FileText, XCircle } from 'lucide-react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { OutOfOfficeRequest } from '@/shared/types';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { LEAVE_STATUS_META, OOO_CATEGORY_META } from '@/features/attendance/admin/constants';

/** Гадуур ажлын хүсэлтийн нэг мөр. */
export default function OutOfOfficeListItem({
  request: o,
  onReview,
}: {
  request: OutOfOfficeRequest;
  onReview: (req: OutOfOfficeRequest, action: 'approved' | 'rejected') => void;
}) {
  const { t } = useLanguage();
  const cm = OOO_CATEGORY_META[o.category];
  const CI = cm.icon;
  const sm = LEAVE_STATUS_META[o.status];
  const SI = sm.icon;

  return (
    <li className="p-4 flex items-start gap-3 hover:bg-muted/30">
      <Avatar className="h-9 w-9 mt-0.5 shrink-0">
        {o.profile_image && <AvatarImage src={`${MEDIA_BASE_URL}${o.profile_image}`} />}
        <AvatarFallback className="bg-teal-500/20 text-teal-700 text-[10px] font-semibold">
          {(formatDisplayName(o.full_name) || '??').slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{formatDisplayName(o.full_name)}</span>
          {o.team_code && (
            <span
              className={cn(
                'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                teamChipClass(o.team_code),
              )}
            >
              {o.team_code}
            </span>
          )}
          <Badge
            variant="outline"
            className="text-[10px] gap-1 border-teal-300 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
          >
            <CI className="h-3 w-3" /> {t(cm.labelKey)}
          </Badge>
          <Badge variant="outline" className={cn('text-[10px] gap-1', sm.className)}>
            <SI className="h-3 w-3" /> {t(sm.labelKey)}
          </Badge>
          <span className="text-[11px] text-muted-foreground tabular-nums ml-auto font-semibold">
            {t('attendanceAdminPage.hoursLong', { hours: o.hours })}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
          <span>
            <CalendarDays className="h-3 w-3 inline mr-1" />
            {o.work_date}
          </span>
          {(o.start_time || o.end_time) && (
            <span>
              <Clock className="h-3 w-3 inline mr-1" />
              {o.start_time ?? '?'} → {o.end_time ?? '?'}
            </span>
          )}
        </div>
        {o.reason && <p className="text-xs mt-1 text-foreground/80">{o.reason}</p>}
        {o.attachment_url && (
          <a
            href={`${MEDIA_BASE_URL}${o.attachment_url}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-1"
          >
            <FileText className="h-3 w-3" /> {t('attendanceAdminPage.viewAttachment')}
          </a>
        )}
        {o.reviewer_note && (
          <p className="text-[11px] mt-1 px-2 py-1 rounded bg-muted/50 border border-border/50">
            <span className="font-medium">
              {o.reviewer_name ?? t('attendanceAdminPage.management')}:
            </span>{' '}
            {o.reviewer_note}
          </p>
        )}
      </div>
      {o.status === 'pending' && (
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1"
            onClick={() => onReview(o, 'approved')}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('attendanceAdminPage.approve')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onReview(o, 'rejected')}
          >
            <XCircle className="h-3.5 w-3.5" /> {t('attendanceAdminPage.reject')}
          </Button>
        </div>
      )}
    </li>
  );
}
