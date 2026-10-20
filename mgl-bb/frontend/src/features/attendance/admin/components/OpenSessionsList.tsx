import { Timer } from 'lucide-react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceSession } from '@/shared/types';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { formatTime } from '@/features/attendance/admin/utils/format';
import type { OpenSessionsState } from '@/features/attendance/admin/hooks/useOpenSessions';
import OpenSessionsPager from '@/features/attendance/admin/components/OpenSessionsPager';

/** Хаагдаагүй бүртгэлийн хуудаслагдсан жагсаалт. */
export default function OpenSessionsList({
  open,
  onFixClockOut,
}: {
  open: OpenSessionsState;
  onFixClockOut: (s: AttendanceSession) => void;
}) {
  const { t } = useLanguage();
  const { pagedOpenSessions, selectedOpen, toggleOpenSelected } = open;

  return (
    <>
      <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1 -mr-1">
        {pagedOpenSessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card/60"
          >
            <Checkbox
              className="flex-shrink-0"
              checked={selectedOpen.has(s.id)}
              onCheckedChange={() => toggleOpenSelected(s.id)}
            />
            <Avatar className="h-8 w-8 flex-shrink-0">
              {s.profile_image && <AvatarImage src={`${MEDIA_BASE_URL}${s.profile_image}`} />}
              <AvatarFallback className="bg-warning/20 text-warning text-[10px] font-semibold">
                {(formatDisplayName(s.full_name ?? '') || '??').slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span className="truncate">{formatDisplayName(s.full_name ?? '')}</span>
                {s.team_code && (
                  <span
                    title={s.team_name ?? undefined}
                    className={cn(
                      'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                      teamChipClass(s.team_code),
                    )}
                  >
                    {s.team_code}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {s.date} · {formatTime(s.clock_in)} → ?
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 shrink-0"
              onClick={() => onFixClockOut(s)}
            >
              <Timer className="h-3.5 w-3.5" />
              {t('attendanceAdminPage.fixClockOut')}
            </Button>
          </div>
        ))}
      </div>
      <OpenSessionsPager open={open} />
    </>
  );
}
