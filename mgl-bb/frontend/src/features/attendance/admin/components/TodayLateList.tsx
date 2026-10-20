import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceStats } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { formatMnt, formatTime } from '@/features/attendance/admin/utils/format';

/** «Хоцорсон» хэсэг — минут + торгуулийн нийлбэртэй. */
export default function TodayLateList({
  rows,
  totals,
}: {
  rows: AttendanceStats['late_today'];
  totals: AttendanceStats['late_totals_today'];
}) {
  const { t } = useLanguage();
  return (
    <>
      <div className="h-px bg-border" />
      <div>
        <p className="text-sm font-medium text-yellow-600 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('attendanceAdminPage.lateTitle', { count: rows.length })}
          </span>
          {totals && totals.minutes > 0 && (
            <span className="text-[11px] font-semibold text-yellow-700">
              {t('attendanceAdminPage.minutesShort', { minutes: totals.minutes })} ·{' '}
              {formatMnt(totals.penalty)}
            </span>
          )}
        </p>
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 -mr-1">
          {rows.map((u, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-foreground truncate">{formatDisplayName(u.full_name)}</span>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{formatTime(u.clock_in)}</span>
                <Badge
                  variant="outline"
                  className="bg-yellow-500/10 text-yellow-700 border-yellow-300 text-[10px]"
                >
                  {t('attendanceAdminPage.minutesShortTight', { minutes: u.late_minutes })} ·{' '}
                  {formatMnt(u.late_penalty)}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
