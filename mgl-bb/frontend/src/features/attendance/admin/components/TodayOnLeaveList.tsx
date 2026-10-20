import { Ban, CalendarRange, Plus } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceStats } from '@/shared/types';
import { Button } from '@/ui/button';
import { LEAVE_TYPE_META } from '@/features/attendance/admin/constants';

type OnLeaveRow = NonNullable<AttendanceStats['on_leave_today']>[number];

/** «Чөлөөтэй» хэсэг — ирц нөхөх + чөлөө шууд цуцлах товчнуудтай. */
export default function TodayOnLeaveList({
  rows,
  cancellingLeaveId,
  onBackfill,
  onCancelLeave,
}: {
  rows: OnLeaveRow[];
  cancellingLeaveId: number | null;
  onBackfill: (userId: number) => void;
  onCancelLeave: (leaveId: number, name: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <div className="h-px bg-border" />
      <div>
        <p className="text-sm font-medium text-sky-600 mb-2 flex items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.onLeaveTitle', { count: rows.length })}
        </p>
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 -mr-1">
          {rows.map((u) => {
            const m = LEAVE_TYPE_META[u.leave_type];
            const Icon = m.icon;
            return (
              <div key={u.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground truncate flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-muted-foreground" />
                  {formatDisplayName(u.full_name)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">{t(m.labelKey)}</span>
                  {/* Чөлөөтэй ч ажилласан хүний ирцийг нөхөх. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                    title={t('attendanceAdminPage.backfillSession')}
                    onClick={() => onBackfill(u.id)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  {/* Чөлөөтэй мөртлөө ажилдаа ирсэн бол чөлөөг нь цуцлах. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                    title={t('attendanceAdminPage.cancelLeaveTitle')}
                    disabled={cancellingLeaveId === u.leave_id}
                    onClick={() => onCancelLeave(u.leave_id, formatDisplayName(u.full_name))}
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
