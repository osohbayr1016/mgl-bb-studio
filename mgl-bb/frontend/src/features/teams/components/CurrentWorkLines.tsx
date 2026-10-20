import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { categoryLabel, formatDuration } from '@/features/non-project-work/lib';
import { NonProjectTag, NowBadge, RepairTag } from './AllocationBits';
import { shortProjectLabel } from '../lib/allocation';
import { hasDayWork, hoursToMinutes, type PersonDayWork } from '../lib/currentWork';

/**
 * Нэг хүний «одоогийн ажил»-ын нэмэлт мөрүүд (2026-09-24) — ирцийн төслийн
 * сонголтоос ГАДНАХ хоёр төрөл, `lib/currentWork.ts`:
 *   • Төслийн бус ажил — [Төслийн бус] ангилал («Бусад» бол тайлбар) · цагийн
 *     муж · «одоо» (муж нь одоог хамарвал);
 *   • Засварын цаг — [Засвар] төсөл / засварын төсөл › таск · хугацаа.
 * Хоёр газар нэг хэлбэрээр: Багууд хуудасны нэрсийн мөр (`RosterList`) ба
 * багийн хуудасны гишүүний карт (`TeamDetailPage`).
 */
export function CurrentWorkLines({
  work,
  className,
}: {
  work: PersonDayWork | undefined;
  className?: string;
}) {
  const { t } = useLanguage();
  if (!hasDayWork(work)) return null;
  return (
    <ul className={cn('space-y-0.5 text-[10px] leading-snug text-muted-foreground', className)}>
      {work.nonProject.map((e) => {
        const label = categoryLabel(e.category, e.category_label, t);
        const what = e.note ? `${label}: ${e.note}` : label;
        // Цаггүй (ирцэд сонгосон) бүртгэл — муж биш, хугацааг нь.
        const range =
          e.start_time && e.end_time ? `${e.start_time}–${e.end_time}` : formatDuration(e.minutes, t);
        return (
          <li
            key={`np-${e.id}`}
            className="flex min-w-0 items-center gap-1"
            title={`${what} · ${range} · ${formatDuration(e.minutes, t)}`}
          >
            <NonProjectTag />
            <span className="min-w-0 truncate font-medium text-foreground/80">{what}</span>
            <span className="shrink-0 tabular-nums">{range}</span>
            {e.now && <NowBadge />}
          </li>
        );
      })}
      {work.repairHours.map((r) => {
        const target = r.target_name ? shortProjectLabel(r.target_name) : `#${r.target_id}`;
        const what = r.task_name ? `${target} › ${r.task_name}` : target;
        const duration = formatDuration(hoursToMinutes(r.hours), t);
        return (
          <li
            key={`rh-${r.id}`}
            className="flex min-w-0 items-center gap-1"
            title={`${t('teams.repairHoursHint')}: ${what} · ${duration}`}
          >
            <RepairTag title={t('teams.repairHoursHint')} />
            <span className="min-w-0 truncate font-medium text-foreground/80">{what}</span>
            <span className="shrink-0 tabular-nums">{duration}</span>
          </li>
        );
      })}
    </ul>
  );
}
