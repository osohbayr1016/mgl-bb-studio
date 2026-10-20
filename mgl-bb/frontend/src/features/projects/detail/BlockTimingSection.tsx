/** Timing tiles + elapsed/remaining bar inside the block detail dialog.
 *  Extracted verbatim from `ProjectDetailPage.tsx` (`BlockDetailDialog`)
 *  when that file was split into per-component modules — no behavioural
 *  change. */
import { AlertTriangle, Calendar as CalendarIcon, Clock, Hourglass } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';

import { TimingTile } from './atoms';
import { computeBlockTiming } from './blockHelpers';
import { fmtDate } from './helpers';

export function BlockTimingSection({
  timing,
}: {
  timing: ReturnType<typeof computeBlockTiming>;
}) {
  const { t } = useLanguage();
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" /> {t('projectDetailPage.timingInfo')}
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <TimingTile
          icon={<CalendarIcon className="h-3.5 w-3.5" />}
          label={t('projectDetailPage.startDate')}
          value={fmtDate(timing.start)}
          sub={
            timing.start ? t('projectDetailPage.earliestDate') : t('projectDetailPage.dateUnknown')
          }
        />
        <TimingTile
          icon={<CalendarIcon className="h-3.5 w-3.5" />}
          label={t('projectDetailPage.dueDate')}
          value={fmtDate(timing.end)}
          sub={timing.end ? t('projectDetailPage.latestDate') : t('projectDetailPage.dateUnknown')}
        />
        <TimingTile
          icon={<Hourglass className="h-3.5 w-3.5" />}
          label={t('projectDetailPage.totalDuration')}
          value={
            timing.totalDays != null
              ? t('projectDetailPage.daysCount', { count: timing.totalDays })
              : '—'
          }
          sub={
            timing.elapsedDays != null
              ? t('projectDetailPage.daysElapsed', { count: timing.elapsedDays })
              : undefined
          }
          tone="primary"
        />
        {timing.overdueDays > 0 ? (
          <TimingTile
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label={t('projectDetailPage.overdue')}
            value={t('projectDetailPage.daysCount', { count: timing.overdueDays })}
            sub={t('projectDetailPage.timeExceeded')}
            tone="destructive"
          />
        ) : (
          <TimingTile
            icon={<Hourglass className="h-3.5 w-3.5" />}
            label={t('projectDetailPage.remaining')}
            value={
              timing.remainingDays != null
                ? t('projectDetailPage.daysCount', { count: timing.remainingDays })
                : '—'
            }
            sub={timing.remainingDays === 0 ? t('projectDetailPage.endsToday') : undefined}
            tone={
              timing.remainingDays != null && timing.remainingDays <= 7 ? 'warning' : 'default'
            }
          />
        )}
      </div>

      {/* Elapsed vs remaining bar */}
      {timing.totalDays != null && timing.elapsedDays != null && (
        <div className="pt-1">
          <div className="flex items-center gap-1 h-2.5 rounded-full overflow-hidden bg-muted/60">
            <div
              className="h-full bg-primary/70 transition-[width]"
              style={{ width: `${(timing.elapsedDays / timing.totalDays) * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
            <span>{fmtDate(timing.start)}</span>
            <span className="tabular-nums">
              {t('projectDetailPage.elapsedOfTotal', {
                elapsed: timing.elapsedDays,
                total: timing.totalDays,
              })}
            </span>
            <span>{fmtDate(timing.end)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export default BlockTimingSection;
