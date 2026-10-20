import { ChevronLeft, ChevronRight, CalendarDays, RotateCcw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatDate } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';

/** Add `n` calendar days to a `YYYY-MM-DD` string and return the same format.
 *  Parses at local midnight so the day never slips in negative-offset zones. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Day stepper for the command-centre.  Moves the daily snapshot one day at a
 * time and never lets the user walk into the future (`›` disabled on today).
 * When viewing a past day a "back to today" shortcut appears.
 */
export function DateNavigator({
  date,
  today,
  onChange,
  stepDays = 1,
  from,
}: {
  date: string;
  today: string;
  onChange: (next: string) => void;
  /** Мужаар харахад сум нэг мужаар алхана (7 хоног → 7 өдөр). */
  stepDays?: number;
  /** Мужийн эхлэл — байвал «from → date» гэж харуулна. */
  from?: string;
}) {
  const { t } = useLanguage();
  const isToday = date >= today;
  const ranged = from != null && from !== date;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-primary/35 bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => onChange(addDays(date, -stepDays))}
          className="px-2.5 py-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          aria-label={t('teams.prevDay')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold tabular-nums border-x border-border/60">
          <CalendarDays className="h-3.5 w-3.5 text-primary" />
          {ranged && <span className="text-muted-foreground">{formatDate(from)} →</span>}
          {formatDate(date)}
          {isToday && (
            <span className="ml-1 text-primary font-medium">· {t('teams.todayLabel')}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            const next = addDays(date, stepDays);
            onChange(next > today ? today : next);
          }}
          disabled={isToday}
          className={cn(
            'px-2.5 py-2 transition-colors',
            isToday
              ? 'text-muted-subtle cursor-not-allowed'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
          aria-label={t('teams.nextDay')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('teams.backToToday')}
        </button>
      )}
    </div>
  );
}
