/**
 * Төслийн дуусах хугацааны СУНГАЛТ + ТҮҮХ карт (migration 0337).
 *
 * Хоёр газар нэг компонент: төслийн «Хугацаа» таб (`ProjectDeadlinesTab`) ба
 * Timeline-ийн дэлгэрэнгүй самбар (`ProjectDetailPanel`, `compact`).
 * Харуулах зүйл: одоогийн / анхны хугацаа, сунгалтын тоо + нийт хоног, дараа
 * нь өөрчлөлт бүр — «1-р сунгалт · 2026-07-09 → 2026-09-30 (+83 хоног) ·
 * Захиалагч: Б.Бат · шалтгаан · бүртгэсэн хүн, огноо».  `correction` мөр
 * (Хуваарь / паспортоор зассан) тусдаа өнгөөр, сунгалтын тоонд орохгүй.
 *
 * ⚠️ ЭРХ: «Сунгах» = сервер талын `can_manage` (admin + senior), «Буцаах» =
 *    `can_revert` (admin, зөвхөн хамгийн сүүлийн мөр).  Хуудас дүр шалгахгүй.
 */
import { useState } from 'react';
import { CalendarPlus, History, Undo2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Skeleton } from '@/ui/skeleton';

import { revertExtension, useDeadlineHistory } from './api';
import { ExtensionDialog } from './ExtensionDialog';
import type { DeadlineChange } from './types';

function DaysChip({ days }: { days: number | null }) {
  const { t } = useLanguage();
  if (days == null || days === 0) return null;
  return (
    <span
      className={cn(
        'rounded border px-1 py-px text-micro tabular-nums',
        days > 0
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-success/40 bg-success/10 text-success',
      )}
    >
      {days > 0 ? t('deadlineExt.daysPlus', { n: days }) : t('deadlineExt.daysMinus', { n: -days })}
    </span>
  );
}

function ChangeRow({
  item,
  canRevert,
  onRevert,
  reverting,
}: {
  item: DeadlineChange;
  canRevert: boolean;
  onRevert: () => void;
  reverting: boolean;
}) {
  const { t } = useLanguage();
  const isExt = item.kind === 'extension';
  const label = isExt
    ? t('deadlineExt.nth', { n: item.seq ?? 0 })
    : item.from_date == null
      ? t('deadlineExt.initial')
      : item.to_date == null
        ? t('deadlineExt.cleared')
        : t('deadlineExt.correction');
  return (
    <li className="rounded-lg border border-border/60 bg-card/50 p-2.5 text-body">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            'text-micro py-0',
            isExt ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground',
          )}
        >
          {label}
        </Badge>
        <span className="tabular-nums">
          {item.from_date ?? '—'} → {item.to_date ?? '—'}
        </span>
        <DaysChip days={item.days} />
        {canRevert && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 px-2 text-micro"
            disabled={reverting}
            onClick={onRevert}
          >
            <Undo2 aria-hidden className="size-3.5" />
            {t('deadlineExt.revert')}
          </Button>
        )}
      </div>
      {isExt && (
        <div className="mt-1 space-y-0.5 text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{t('deadlineExt.approvedBy')}:</span>{' '}
            {t(`deadlineExt.kind_${item.approved_by_kind ?? 'other'}`)}
            {item.approved_by_name ? ` — ${item.approved_by_name}` : ''}
            {item.approved_on ? ` · ${item.approved_on}` : ''}
            {item.reference_no ? ` · ${item.reference_no}` : ''}
          </div>
          {item.reason && (
            <div>
              <span className="font-medium text-foreground">{t('deadlineExt.reason')}:</span> {item.reason}
            </div>
          )}
        </div>
      )}
      {item.note && <div className="mt-1 text-muted-foreground">{item.note}</div>}
      <div className="mt-1 text-micro text-muted-foreground">
        {t('deadlineExt.recordedBy')}: {item.created_by_name ?? '—'} · {formatDateTime(item.created_at)}
      </div>
    </li>
  );
}

export interface DeadlineHistoryCardProps {
  projectId: number;
  projectTitle: string;
  /** Timeline самбарт: жагсаалтыг богиносгож, гарчгийг жижигсгэнэ. */
  compact?: boolean;
  /** Сунгалт/буцаалтын дараа дуудагчийн өөрийн кэшийг шинэчлэх. */
  onChanged?: () => void;
  /** Самбар хаалттай үед татахгүй (`useProjectDeadlines`-тэй ижил). */
  enabled?: boolean;
}

export function DeadlineHistoryCard({
  projectId,
  projectTitle,
  compact = false,
  onChanged,
  enabled = true,
}: DeadlineHistoryCardProps) {
  const { t } = useLanguage();
  const query = useDeadlineHistory(projectId, enabled);
  const [extendOpen, setExtendOpen] = useState(false);
  const [reverting, setReverting] = useState(false);

  const data = query.data;
  const items = data?.items ?? [];
  const lastId = items[items.length - 1]?.id ?? null;

  const revert = async (item: DeadlineChange) => {
    const ok = await confirmDialog({
      description: t('deadlineExt.revertConfirm', { date: item.from_date ?? '—' }),
      variant: 'destructive',
    });
    if (!ok) return;
    setReverting(true);
    try {
      await revertExtension(projectId, item.id);
      toast.success(t('deadlineExt.reverted'));
      onChanged?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setReverting(false);
    }
  };

  const body = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          {t('deadlineExt.title')}
        </div>
        {data && data.extension_count > 0 && (
          <Badge variant="outline" className="text-micro border-warning/40 bg-warning/10 py-0 text-warning">
            {t('deadlineExt.countBadge', { n: data.extension_count })}
            {data.total_extended_days > 0 && ` · ${t('deadlineExt.totalDays', { n: data.total_extended_days })}`}
          </Badge>
        )}
        {data?.can_manage && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={() => setExtendOpen(true)}
            disabled={!data.current_finish_date}
            title={!data.current_finish_date ? t('deadlineExt.noCurrent') : undefined}
          >
            <CalendarPlus aria-hidden className="size-4" />
            {t('deadlineExt.extend')}
          </Button>
        )}
      </div>

      {query.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : query.isError ? (
        <p className="text-body text-danger">{query.error.message}</p>
      ) : data ? (
        <>
          <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'sm:grid-cols-3')}>
            <div className="rounded-lg border border-border/60 bg-card/50 px-2.5 py-2">
              <div className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                {t('deadlineExt.current')}
              </div>
              <div className="text-label mt-0.5 tabular-nums text-foreground">
                {data.current_finish_date ?? data.raw_finish_date ?? t('deadlines.noDate')}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/50 px-2.5 py-2">
              <div className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                {t('deadlineExt.original')}
              </div>
              <div className="text-label mt-0.5 tabular-nums text-foreground">
                {data.original_finish_date ?? t('deadlines.noDate')}
              </div>
            </div>
            {!compact && (
              <div className="rounded-lg border border-border/60 bg-card/50 px-2.5 py-2">
                <div className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('deadlineExt.count')}
                </div>
                <div className="text-label mt-0.5 tabular-nums text-foreground">
                  {data.extension_count > 0
                    ? `${data.extension_count} · ${t('deadlineExt.totalDays', { n: data.total_extended_days })}`
                    : t('deadlineExt.notExtended')}
                </div>
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-body text-muted-foreground">{t('deadlineExt.historyEmpty')}</p>
          ) : (
            <ul className="space-y-1.5">
              {/* Сүүлийнх нь дээрээ — «сүүлд юу болсон» гэдгийг эхэлж харна. */}
              {[...items].reverse().map((item) => (
                <ChangeRow
                  key={item.id}
                  item={item}
                  canRevert={data.can_revert && item.kind === 'extension' && item.id === lastId}
                  reverting={reverting}
                  onRevert={() => void revert(item)}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}

      <ExtensionDialog
        open={extendOpen}
        onOpenChange={setExtendOpen}
        projectId={projectId}
        projectTitle={projectTitle}
        currentFinishDate={data?.current_finish_date ?? null}
        extensionCount={data?.extension_count ?? 0}
        onSaved={() => onChanged?.()}
      />
    </div>
  );

  if (compact) return body;
  return (
    <Card>
      <CardContent className="p-4">{body}</CardContent>
    </Card>
  );
}

export default DeadlineHistoryCard;
