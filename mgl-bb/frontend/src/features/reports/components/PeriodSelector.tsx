import { CalendarDays } from 'lucide-react';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { todayUB } from '@/shared/lib/time';
import { REPORT_WINDOWS, type ReportWindow } from '../types';
import { WINDOW_LABEL_KEY, isIsoDate } from '../lib/windows';

/**
 * Цонх (өдөр / 7 / 14 / сар / бүх) + anchor огноо.  Anchor нь цонхны СҮҮЛИЙН
 * өдөр: «8-р сарын 20-ны 7 хоног» = 08-14…08-20.  Өнөөдрөөс хойш сонгож болохгүй.
 */
export function PeriodSelector({
  window,
  anchor,
  onWindow,
  onAnchor,
  className,
}: {
  window: ReportWindow;
  anchor: string;
  onWindow: (w: ReportWindow) => void;
  onAnchor: (d: string) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const today = todayUB();
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex gap-0.5 rounded-lg bg-muted p-0.5" role="tablist" aria-label={t('reportsPage.anchor')}>
        {REPORT_WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            role="tab"
            aria-selected={w === window}
            onClick={() => onWindow(w)}
            className={cn(
              'h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
              w === window ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(WINDOW_LABEL_KEY[w])}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          type="date"
          value={anchor}
          max={today}
          onChange={(e) => {
            const v = e.target.value;
            if (isIsoDate(v) && v <= today) onAnchor(v);
          }}
          className="h-7 w-[9.5rem] px-2 text-xs"
          aria-label={t('reportsPage.anchor')}
        />
        {anchor !== today && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onAnchor(today)}>
            {t('reportsPage.today')}
          </Button>
        )}
      </div>
    </div>
  );
}
