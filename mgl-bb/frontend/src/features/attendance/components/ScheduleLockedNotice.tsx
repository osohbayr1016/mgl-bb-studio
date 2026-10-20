import { CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

interface ScheduleLockedNoticeProps {
  scheduleLabel?: string;
  /** Widget-д нягт хувилбар. */
  compact?: boolean;
  className?: string;
}

/** Ажилтан өөрөө ээлж солих UI хаагдсан үед одоогийн цаг + менежментийн мэдэгдэл. */
export function ScheduleLockedNotice({
  scheduleLabel,
  compact = false,
  className,
}: ScheduleLockedNoticeProps) {
  const { t } = useLanguage();

  if (compact) {
    return (
      <div className={cn('space-y-1.5', className)}>
        <div className="flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-md border border-primary/60 bg-primary/15 text-micro font-medium text-primary">
          <Clock className="h-3 w-3 shrink-0" />
          <span className="tabular-nums">{scheduleLabel}</span>
          <CheckCircle2 className="h-3 w-3 shrink-0" />
        </div>
        <p className="text-micro text-muted-foreground leading-relaxed">
          {t('attendanceShift.managementOnly')}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-start gap-3 p-3 rounded-lg border-2 border-primary bg-primary/5 text-left">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-primary text-primary-foreground">
          <Clock className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold tabular-nums">{scheduleLabel}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {t('attendanceShift.currentSchedule')}
          </div>
        </div>
        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed bg-muted/40 border border-border rounded-lg px-3 py-2.5">
        {t('attendanceShift.managementOnly')}
      </p>
    </div>
  );
}
