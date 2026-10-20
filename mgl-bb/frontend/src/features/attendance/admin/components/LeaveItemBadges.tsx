import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { LeaveRequest } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { LEAVE_STATUS_META, LEAVE_TYPE_META } from '@/features/attendance/admin/constants';
import { resolveLeavePolicy } from '@/features/attendance/admin/utils/leavePolicyView';
import PaidBadge from '@/features/attendance/admin/components/PaidBadge';

/** Чөлөөний мөрийн эхний эгнээ — нэр, баг, төрөл, төлөв, үргэлжлэх хугацаа. */
export default function LeaveItemBadges({ leave: l }: { leave: LeaveRequest }) {
  const { t } = useLanguage();
  const m = LEAVE_TYPE_META[l.leave_type];
  const Icon = m.icon;
  const sm = LEAVE_STATUS_META[l.status];
  const SI = sm.icon;
  const { policy, isPaid } = resolveLeavePolicy(l);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-medium text-sm">{formatDisplayName(l.full_name)}</span>
      {l.team_code && (
        <span
          className={cn(
            'text-[10px] font-mono px-1.5 py-0.5 rounded border',
            teamChipClass(l.team_code),
          )}
        >
          {l.team_code}
        </span>
      )}
      <Badge variant="outline" className={cn('text-[10px] gap-1', m.tone)}>
        <Icon className="h-3 w-3" /> {policy?.label ?? t(m.labelKey)}
      </Badge>
      <PaidBadge isPaid={isPaid} />
      {policy && (
        <Badge variant="outline" className="text-[10px] font-mono">
          {policy.rule_id}
        </Badge>
      )}
      {l.requires_ceo_approval && (
        <Badge
          variant="outline"
          className="text-[10px] border-violet-300 text-violet-700 bg-violet-50 dark:bg-violet-900/20"
          title={t('attendanceAdminPage.ceoApprovalTooltip')}
        >
          {t('attendanceAdminPage.ceoApproval')}
        </Badge>
      )}
      <Badge variant="outline" className={cn('text-[10px] gap-1', sm.className)}>
        <SI className="h-3 w-3" /> {t(sm.labelKey)}
      </Badge>
      {l.created_by && (
        <Badge
          variant="outline"
          className="text-[10px] bg-info/10 text-info border-info/30"
          title={l.creator_name ?? undefined}
        >
          {t('attendanceAdminPage.adminGranted')}
        </Badge>
      )}
      <span className="text-[11px] text-muted-foreground tabular-nums ml-auto font-medium">
        {l.hours != null && l.hours < 8
          ? t('attendanceAdminPage.hoursShort', { hours: l.hours })
          : `${t('attendanceAdminPage.daysShort', { days: l.days })}${
              l.hours != null ? ` (${t('attendanceAdminPage.hoursShort', { hours: l.hours })})` : ''
            }`}
      </span>
    </div>
  );
}
