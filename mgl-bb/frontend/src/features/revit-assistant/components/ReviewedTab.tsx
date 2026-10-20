import { useMemo } from 'react';

import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';

import type { PendingResponse, ReviewStatus } from '../types';
import { LogCard } from './LogCard';

const REVIEW_STATUSES = ['rejected', 'promoted'] as const;

/**
 * ХЯНАСАН ТҮҮХ — «хэн юуг хэзээ, яагаад».
 *
 * ⚠️ Дэд шүүлт нь `useState` БИШ, `useTabParam(..., 'status')`.  Глобал хайлт
 * ба хуваалцсан холбоос хоёулаа URL-ээр ажилладаг тул төлөвийг URL-д барина.
 *
 * ⚠️ ТАТГАЛЗСАН нь АНХДАГЧ.  Дэвшүүлсэн мөрүүд сургалтын багцад аль хэдийн
 * орсон тул тэднийг дахин уншихад бага үнэ цэн байдаг; харин татгалзлын
 * шалтгаанууд бол долоо хоног тутмын хяналтын ЖИНХЭНЭ материал.
 */
export function ReviewedTab() {
  const { t } = useLanguage();
  const [status, setStatus] = useTabParam(REVIEW_STATUSES, 'rejected', 'status');

  const query = useApiQuery<PendingResponse>(
    ['/revit/assistant/reviewed', status],
    `/revit/assistant/pending?status=${status}&limit=200`,
  );
  const rows = useMemo(() => query.data?.pending ?? [], [query.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {REVIEW_STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === status ? 'default' : 'outline'}
            onClick={() => setStatus(s as ReviewStatus)}
          >
            {t(
              s === 'promoted'
                ? 'assistantCuration.statusPromoted'
                : 'assistantCuration.statusRejected',
            )}
          </Button>
        ))}
        <span className="flex-1" />
        <span className="text-body text-muted-foreground">
          {t('assistantCuration.queueCount', { count: rows.length })}
        </span>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <p className="text-body text-destructive">{t('assistantCuration.loadFailed')}</p>
      ) : null}

      {!query.isLoading && !query.isError && rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-body text-muted-foreground">
          {t('assistantCuration.emptyReviewed')}
        </p>
      ) : null}

      <div className="space-y-3">
        {rows.map((row) => (
          <LogCard key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
