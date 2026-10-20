import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { PERIOD_KINDS, type PeriodKind, type ProductivityPeriod } from './types';
import { periodLabel } from './lib';

/**
 * Өдөр / 7 хоног / Сар + ◀ ▶ — өнгөрсөн хугацааг «сүүлд харж шалгах»
 * (эзний хүсэлт).  7 хоног = Даваа–Ням, сар = хуанлийн сар; ▶ нь ирээдүй рүү
 * хаалттай (серверийн `next_date` null).
 */
export function PeriodBar({
  kind,
  period,
  fetching,
  onKind,
  onDate,
  onToday,
}: {
  kind: PeriodKind;
  period: ProductivityPeriod | null;
  fetching: boolean;
  onKind: (k: PeriodKind) => void;
  onDate: (date: string) => void;
  onToday: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex gap-0.5 rounded-lg border border-border bg-card p-0.5" role="tablist">
        {PERIOD_KINDS.map((k) => (
          <Button
            key={k}
            type="button"
            role="tab"
            size="sm"
            variant={kind === k ? 'default' : 'ghost'}
            aria-selected={kind === k}
            onClick={() => onKind(k)}
            className={cn('h-7 px-3 text-xs', kind !== k && 'text-muted-foreground')}
            data-testid={`tp-kind-${k}`}
          >
            {t(`teamProductivity.kind_${k}`)}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!period}
          onClick={() => period && onDate(period.prev_date)}
          aria-label={t('teamProductivity.prevPeriod')}
          title={t('teamProductivity.prevPeriod')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span
          className="min-w-[10.5rem] text-center text-sm font-semibold tabular-nums"
          data-testid="tp-period-label"
        >
          {period ? periodLabel(period, t) : '…'}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!period?.next_date}
          onClick={() => period?.next_date && onDate(period.next_date)}
          aria-label={t('teamProductivity.nextPeriod')}
          title={t('teamProductivity.nextPeriod')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {period && !period.current && (
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onToday}>
          {t(`teamProductivity.backToCurrent_${kind}`)}
        </Button>
      )}
      {period?.current && (
        <span className="rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-label font-normal normal-case tracking-normal text-info">
          {t('teamProductivity.inProgress', { until: period.until })}
        </span>
      )}
      {fetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
    </div>
  );
}
