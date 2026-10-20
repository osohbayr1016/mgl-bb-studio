import { CheckCircle2, Timer, Trash2 } from 'lucide-react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceSession } from '@/shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { formatHours, formatTime } from '@/features/attendance/admin/utils/format';

/** Өнөөдөр ирсэн ажилтнуудын жагсаалт (гарах цаг нөхөх / нөхөж үүсгэсэн
 *  бүртгэлийг устгах товчнуудтай). */
export default function PresentTodayCard({
  todaySessions,
  onFixClockOut,
  onDeleteManual,
}: {
  todaySessions: AttendanceSession[];
  onFixClockOut: (s: AttendanceSession) => void;
  onDeleteManual: (s: AttendanceSession) => void;
}) {
  const { t } = useLanguage();
  return (
    <Card
      id="sec-att-admin-present"
      className="lg:col-span-3 border-border bg-card/60 backdrop-blur scroll-mt-24"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          {t('attendanceAdminPage.presentTodayTitle', { count: todaySessions.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {todaySessions.length === 0 ? (
          <p className="text-center py-8 text-sm text-muted-foreground">
            {t('attendanceAdminPage.noOnePresentYet')}
          </p>
        ) : (
          /* Capped at ~10 rows tall (each row ≈ 64px) so big teams don't
             stretch the dashboard into a wall of names — admins scroll
             inside the card to see the rest. */
          <div className="space-y-2 max-h-[640px] overflow-y-auto overflow-x-hidden pr-1 -mr-1">
            {todaySessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors"
              >
                <Avatar className="h-8 w-8 flex-shrink-0">
                  {s.profile_image && <AvatarImage src={`${MEDIA_BASE_URL}${s.profile_image}`} />}
                  <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-semibold">
                    {(formatDisplayName(s.full_name) || '??').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {formatDisplayName(s.full_name)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(s.clock_in)}
                    {s.clock_out ? ` → ${formatTime(s.clock_out)}` : ''}
                    {s.edited_at && (
                      <span
                        className="ml-1.5 text-[9px] px-1 py-0.5 rounded border border-border bg-muted text-muted-foreground"
                        title={s.edit_note ?? undefined}
                      >
                        {t('attendanceAdminPage.adminAdjusted')}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  {s.clock_out ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs"
                    >
                      {formatHours(s.hours_worked)}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-primary/10 text-primary border-primary/20 text-xs animate-pulse"
                    >
                      {t('attendanceAdminPage.working')}
                    </Badge>
                  )}
                </div>
                {/* Зөвхөн нээлттэй (цагаа хаагаагүй) эсвэл өмнө нь админ
                    нөхсөн мөрөнд — ажилтны өөрөө бүртгэсэн гарах цагийг
                    server тал ч засахыг хориглодог. */}
                {(!s.clock_out || s.edited_at) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                    title={t('attendanceAdminPage.fixClockOut')}
                    onClick={() => onFixClockOut(s)}
                  >
                    <Timer className="h-3.5 w-3.5" />
                  </Button>
                )}
                {/* Админ гараар нөхөж үүсгэсэн ирцийг устгах — organic
                    бичлэгт server тал 409 буцаадаг тул товч нь огт харагдахгүй. */}
                {s.created_by && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                    title={t('attendanceAdminPage.deleteManualSession')}
                    onClick={() => onDeleteManual(s)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
