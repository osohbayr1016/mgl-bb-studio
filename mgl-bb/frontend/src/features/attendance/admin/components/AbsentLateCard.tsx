import { Plus, XCircle } from 'lucide-react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceStats } from '@/shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import TodayOnLeaveList from '@/features/attendance/admin/components/TodayOnLeaveList';
import TodayLateList from '@/features/attendance/admin/components/TodayLateList';

/** Ирээгүй + чөлөөтэй + хоцорсон гурван жагсаалт нэг картад. */
export default function AbsentLateCard({
  stats,
  cancellingLeaveId,
  onBackfill,
  onCancelLeave,
}: {
  stats: AttendanceStats | null;
  cancellingLeaveId: number | null;
  onBackfill: (userId?: number) => void;
  onCancelLeave: (leaveId: number, name: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <Card
      id="sec-att-admin-absent"
      className="lg:col-span-2 border-border bg-card/60 backdrop-blur scroll-mt-24"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <XCircle className="h-4 w-4 text-destructive" />
          {t('attendanceAdminPage.absentTitle', { count: stats?.absent_today.length ?? 0 })}
          {/* Ирц нөхөж бүртгэх — огт ирц бүртгээгүй хүнд ирсэн/гарсан
              цагийг гараар бичих (server: POST /sessions/manual). */}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 gap-1.5 text-xs font-normal"
            onClick={() => onBackfill()}
          >
            <Plus className="h-3 w-3" />
            {t('attendanceAdminPage.backfillSession')}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats?.absent_today.length === 0 ? (
          <p className="text-center py-4 text-sm text-muted-foreground">
            {t('attendanceAdminPage.allPresent')}
          </p>
        ) : (
          /* Capped at ~10 rows tall (each row ≈ 40px); rest scroll inside.
             Saves a huge amount of vertical real estate on companies with
             many absentees. */
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 -mr-1">
            {stats?.absent_today.map((u) => (
              <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg">
                <Avatar className="h-7 w-7 flex-shrink-0">
                  {u.profile_image && <AvatarImage src={`${MEDIA_BASE_URL}${u.profile_image}`} />}
                  <AvatarFallback className="bg-destructive/10 text-destructive text-[9px] font-semibold">
                    {formatDisplayName(u.full_name).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-foreground truncate">
                  {formatDisplayName(u.full_name)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                  title={t('attendanceAdminPage.backfillSession')}
                  onClick={() => onBackfill(u.id)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {stats?.on_leave_today && stats.on_leave_today.length > 0 && (
          <TodayOnLeaveList
            rows={stats.on_leave_today}
            cancellingLeaveId={cancellingLeaveId}
            onBackfill={onBackfill}
            onCancelLeave={onCancelLeave}
          />
        )}

        {stats?.late_today && stats.late_today.length > 0 && (
          <TodayLateList rows={stats.late_today} totals={stats.late_totals_today} />
        )}
      </CardContent>
    </Card>
  );
}
