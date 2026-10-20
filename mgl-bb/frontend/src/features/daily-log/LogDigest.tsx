import { useMemo } from 'react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { groupDigest, weekdayOf, type DigestLog } from './lib';

/**
 * «Нэгтгэл» — тухайн хугацаанд НИЙТ юу хийсэн: өдрөөр, сараар бүлэглэсэн бүх
 * ажил (шинээс хуучин руу).  Профайлын өөрийн тайлан ба «Тайлан → Менежментийн
 * багийн тайлан»-ын гишүүн бүрийн нэгтгэл ЭНЭ компонентыг хуваалцана.
 *
 * `dayIdPrefix` өгвөл өдөр бүр `id="<prefix><date>"`-тэй (heatmap-аас гүйлгэх).
 */
export default function LogDigest({
  logs,
  from,
  to,
  onPickDay,
  dayIdPrefix,
  emptyText,
  compact = false,
}: {
  logs: readonly DigestLog[];
  from: string;
  to: string;
  onPickDay?: (date: string) => void;
  dayIdPrefix?: string;
  emptyText?: string;
  /** Багийн нэгтгэлд: сарын толгой, дүнгийн мөргүй. */
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const g = useMemo(() => groupDigest(logs, from, to), [logs, from, to]);

  if (g.days === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {emptyText ?? t('dailyLog.digestEmpty')}
      </p>
    );
  }

  const showMonths = !compact && g.months.length > 1;

  return (
    <div className="space-y-3">
      {!compact && (
        <p className="text-sm text-muted-foreground">
          {t('dailyLog.digestSummary', { days: g.days, items: g.items })}
        </p>
      )}
      {g.months.map((m) => (
        <section key={m.month} className="space-y-2">
          {showMonths && (
            <h4 className="sticky top-0 z-[1] flex items-baseline justify-between gap-2 border-b border-border bg-card/95 py-1 text-sm font-semibold backdrop-blur">
              <span>
                {t('dailyLog.monthLabel', {
                  y: m.month.slice(0, 4),
                  m: Number(m.month.slice(5, 7)),
                })}
              </span>
              <span className="text-micro font-normal text-muted-foreground">
                {t('dailyLog.digestSummary', { days: m.logs.length, items: m.items })}
              </span>
            </h4>
          )}
          <ol className={cn('space-y-2', compact && 'space-y-1.5')}>
            {m.logs.map((l) => (
              <li
                key={l.log_date}
                id={dayIdPrefix ? `${dayIdPrefix}${l.log_date}` : undefined}
                className={cn(
                  'scroll-mt-24 rounded-lg border border-border/60 bg-background/40 px-3 py-2',
                  compact && 'border-0 bg-transparent px-0 py-0',
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {onPickDay ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0 py-0 text-sm font-semibold tabular-nums pointer-coarse:h-auto has-[>svg]:px-0"
                      onClick={() => onPickDay(l.log_date)}
                    >
                      {l.log_date}
                    </Button>
                  ) : (
                    <span className="text-sm font-semibold tabular-nums">{l.log_date}</span>
                  )}
                  <span className="text-micro text-muted-foreground">
                    {t(`dailyLog.weekday${weekdayOf(l.log_date)}`)}
                  </span>
                  <span className="text-micro text-muted-foreground">
                    · {t('dailyLog.itemCount', { count: l.items.length })}
                  </span>
                  {(l.edit_count ?? 0) > 0 && (
                    <Badge variant="outline">
                      {t('dailyLog.editedTimes', { count: l.edit_count ?? 0 })}
                    </Badge>
                  )}
                </div>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm marker:text-muted-foreground">
                  {l.items.map((it, i) => (
                    <li key={i} className="whitespace-pre-wrap break-words">
                      {it}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
