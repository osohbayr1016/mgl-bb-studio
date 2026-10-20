/**
 * Хугацааны жагсаалт — «Хугацаа» таб ба Dashboard-ийн карт хоёулаа
 * үүнийг л ашиглана.  Сервер тал аль хэдийн эрсдэлээр эрэмбэлж өгсөн тул
 * энд ДАХИН эрэмбэлэхгүй (хоёр талын эрэмбэ зөрөх эрсдэлгүй).
 *
 * Шүүлт нь ЗӨВХӨН харагдац: «Дууссаныг харуулах» тугийг унтраахад
 * биелсэн мөрүүд нуугдана, өгөгдөл өөрчлөгдөхгүй.
 */
import { useMemo, useState } from 'react';
import { CalendarCheck2 } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { ATTENTION_STATES } from '@/features/timeline/lib/riskDisplay';

import { DeadlineRow } from './DeadlineRow';
import type { DeadlineItem } from './types';

export type DeadlineFilter = 'attention' | 'open' | 'all';

export function DeadlineList({
  items,
  loading = false,
  showProject = false,
  /** Мөр бүрд нэмэлт удирдлага (дэд хугацааны засах/устгах товч). */
  renderTrailing,
  emptyLabel,
  className,
  /** Хамгийн ихдээ хэдэн мөр — Dashboard-ийн карт богино байх ёстой. */
  limit,
}: {
  items: DeadlineItem[];
  loading?: boolean;
  showProject?: boolean;
  renderTrailing?: (item: DeadlineItem) => React.ReactNode;
  emptyLabel?: string;
  className?: string;
  limit?: number;
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<DeadlineFilter>('open');

  const filtered = useMemo(() => {
    const base =
      filter === 'all'
        ? items
        : filter === 'open'
          ? items.filter((i) => !i.done)
          : items.filter((i) => !i.done && ATTENTION_STATES.includes(i.risk_state));
    return typeof limit === 'number' ? base.slice(0, limit) : base;
  }, [items, filter, limit]);

  const counts = useMemo(
    () => ({
      attention: items.filter(
        (i) => !i.done && ATTENTION_STATES.includes(i.risk_state),
      ).length,
      open: items.filter((i) => !i.done).length,
      all: items.length,
    }),
    [items],
  );

  if (loading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Шүүлтийн таб — тоо нь шүүлт бүрийн ард. */}
      <div className="flex flex-wrap items-center gap-1">
        {(['attention', 'open', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border/40 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted/60',
              filter === f && 'border-primary/30 bg-primary/10 text-primary',
            )}
          >
            {t(`deadlines.filter_${f}`)}
            <span
              className={cn(
                'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums',
                filter === f ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 px-4 py-8 text-center">
          <CalendarCheck2 className="h-7 w-7 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            {emptyLabel ?? t('deadlines.emptyList')}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {filtered.map((item) => (
            <DeadlineRow
              key={item.key}
              item={item}
              showProject={showProject}
              trailing={renderTrailing?.(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default DeadlineList;
