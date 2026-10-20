import { LogIn } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { LeaveRequest } from '@/shared/types';

/**
 * «Ирсэн цагаар богиносгосон» тэмдэглэл (0364).  Батлагдсан чөлөөтэй ажилтан
 * ажилдаа ирэхэд сервер чөлөөг ирсэн цаг хүртэл автоматаар богиносгодог
 * (`backend/src/lib/leaveArrivalCut.ts`).  Мөрийн цаг/hours нь аль хэдийн
 * үр дүн тул энд зөвхөн АНХНЫ утга ба ирсэн цагийг тайлбарлана — эс тэгвэл
 * ажилтан «4 цаг хүссэн чинь яагаад 1 цаг болсон бэ» гэж гайхна.
 */
export default function LeaveArrivalCutNote({
  leave,
  className,
}: {
  leave: LeaveRequest;
  className?: string;
}) {
  const { t } = useLanguage();
  const cuts = leave.arrival_cuts ?? [];
  if (leave.arrival_orig_days == null || cuts.length === 0) return null;

  const duration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return t('leaveArrivalCut.minutes', { m });
    return m === 0 ? t('leaveArrivalCut.hours', { h }) : t('leaveArrivalCut.hoursMinutes', { h, m });
  };
  const usedLabel = (c: (typeof cuts)[number]) =>
    c.used_minutes === 0
      ? t('leaveArrivalCut.unused')
      : `${c.start_time}–${c.end_time} (${duration(c.used_minutes)})`;
  const multiDay = leave.end_date > leave.start_date;
  const first = cuts[0]!;
  const origRange =
    leave.arrival_orig_start_time && leave.arrival_orig_end_time
      ? `${leave.arrival_orig_start_time.slice(0, 5)}–${leave.arrival_orig_end_time.slice(0, 5)}`
      : t('leaveArrivalCut.fullDay');

  return (
    <div
      className={cn(
        'mt-1 rounded-md border border-info/30 bg-info/10 px-2 py-1 text-micro text-info',
        className,
      )}
    >
      <div className="flex items-center gap-1 font-medium">
        <LogIn className="h-3 w-3 shrink-0" />
        {t('leaveArrivalCut.badge')}
      </div>
      {multiDay ? (
        <ul className="mt-0.5 space-y-0.5 tabular-nums">
          {cuts.map((c) => (
            <li key={c.date}>
              {t('leaveArrivalCut.dayLine', { date: c.date, arrival: c.arrival, used: usedLabel(c) })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 tabular-nums">
          {t('leaveArrivalCut.single', {
            range: origRange,
            full: duration(first.full_minutes),
            arrival: first.arrival,
            used: usedLabel(first),
          })}
        </p>
      )}
    </div>
  );
}
