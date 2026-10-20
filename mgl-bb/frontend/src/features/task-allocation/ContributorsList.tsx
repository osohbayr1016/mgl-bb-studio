/* Таск дээрх ХУВЬ НЭМЭРЧИД — «дугаар · нэр · төлөв · хийсэн/зорилт · цаг» (2026-10-02, эзний шийдвэр).
 *
 *   17.1  Б.Бат   ● ажиллаж байна   2.5/5   12:04.33
 *   17.2  Д.Нар   түр зогссон       0.5/5   1:05 ц      ·  засвар 3 ц
 *
 * Хүн ЗӨВХӨН бодит нотолгоотой л орно: хүчинтэй явц (D > 0) эсвэл тоологдсон албан цаг (түр зогссон ч харагдана).
 * «Миний ажилд нэмэх» bookmark, baseline оруулсан хүн, таск хуваасан хүн нотолгоо БИШ (сервер шийднэ).
 *
 *   • Нэр = `staffName.ts` «Б.Бат»; хоёр хүний нэр давхцвал бүтэн нэр.  Хүний ТАНИЛТ = хэрэглэгчийн id.
 *   • Цаг = албан таймер (цайны цаг хассан).  Засварын цаг ТУСДАА («засвар 3 ц») — хэзээ ч нэмэхгүй.
 *   • Нийлбэр, хүний тоо, bar ХАРУУЛАХГҮЙ — зөвхөн хүн бүрийн мөр. */
import { Check, CircleDashed, Pause, Square } from 'lucide-react';

import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { shortNameLabels } from '@/shared/lib/staffName';
import { formatDisplayName } from '@/shared/lib/formatting';
import StopwatchText from '@/features/task-timer/StopwatchText';
import type { TaskWorker } from '@/features/task-timer/officialTimer';

import { childLabel } from './allocation';
import { buildItems, type ItemState } from './contributors';
import type { ContributorRow } from './types';
import { formatUnits } from './units';

const STATE_KEY: Record<ItemState, string> = {
  running: 'taskAlloc.contrib.running',
  paused: 'taskAlloc.contrib.paused',
  history: 'taskAlloc.contrib.history',
  assigned: 'taskAlloc.contrib.assigned',
};

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
    </span>
  );
}

/** Төлөвийн дүрс: ажиллаж байна = цохилох ногоон цэг · түр зогссон = ⏸ · хийсэн = ✓ · хуваарилагдсан = тасархай тойрог. */
function StateIcon({ state }: { state: ItemState }) {
  if (state === 'running') return <LiveDot />;
  if (state === 'paused') return <Pause className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />;
  if (state === 'history') return <Check className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />;
  return <CircleDashed className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />;
}

export function ContributorsList({
  taskId,
  taskNumber,
  rows,
  running,
  currentUserId,
  onStop,
}: {
  taskId: number;
  /** Таскийн тогтвортой дугаар (17) — хэсгийн дугаар «17.2»-ыг үүсгэнэ. */
  taskNumber: number;
  rows: readonly ContributorRow[];
  /** Одоо ажиллаж буй хүмүүс (албан таймер, ~10 сек) — жагсаалтаас шинэ. */
  running: readonly TaskWorker[];
  currentUserId: number | null;
  /** Зөвхөн админд — бусдын мартсан таймерыг зогсооно. */
  onStop?: (w: TaskWorker) => void;
  /** Хуучин дуудагчдад зориулсан — badge нэг хэмжээтэй болсон тул ашиглагдахгүй. */
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const items = buildItems(rows, running, taskId);
  if (items.length === 0) return null;
  const labels = shortNameLabels(items.map((i) => ({ user_id: i.userId, full_name: i.fullName })));

  return (
    // Хүн бүр НЭГ badge (pill): «● Нэр · төлөв · хувь · цаг» — badge-ууд зүүнээс баруун тийш жагсаж, багтахгүй бол дараагийн мөрөнд шилжинэ.
    <ul className="flex min-w-0 flex-row flex-wrap items-center gap-1.5" data-testid="contributors">
      {items.map((it) => {
        const label = labels.get(it.userId) ?? `#${it.userId}`;
        const mine = it.userId === currentUserId;
        const hasTime = it.closedMs > 0 || it.since !== null;
        return (
          <li
            key={it.userId}
            className={cn(
              'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-2.5 text-xs',
              it.state === 'running' && 'border-success/40 bg-success/10',
              (it.state === 'paused' || it.state === 'history') && 'border-border bg-muted/40',
              it.state === 'assigned' && 'border-dashed border-border bg-transparent',
              mine && 'ring-1 ring-primary/40',
            )}
            title={t(STATE_KEY[it.state] as Parameters<typeof t>[0])}
            data-testid="contributor"
            data-user-id={it.userId}
            data-state={it.state}
          >
            {it.ordinal !== null && (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground" title={t('taskAlloc.contrib.partTitle')}>
                {childLabel(taskNumber, it.ordinal)}
              </span>
            )}
            <StateIcon state={it.state} />
            <span
              className={cn('min-w-0 truncate', mine ? 'font-semibold text-foreground' : 'font-medium text-foreground/90')}
              title={formatDisplayName(it.fullName ?? '') || label}
            >
              {label}
            </span>
            {/* Төлөв бичгээр биш ДҮРСЭЭР (badge богино байж нэг мөрөнд 2 хүн багтана); тайлбар нь tooltip + дэлгэц уншигчид. */}
            <span className="sr-only">{t(STATE_KEY[it.state] as Parameters<typeof t>[0])}</span>
            {it.target !== null && it.done !== null && (
              <span
                className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                title={t('taskAlloc.contrib.shareTitle')}
              >
                {formatUnits(it.done)}/{formatUnits(it.target)}
              </span>
            )}
            {hasTime && (
              <span
                className="shrink-0 border-l border-border/60 pl-1.5 text-[11px] text-foreground/80"
                title={t('taskAlloc.contrib.timeTitle')}
              >
                <StopwatchText
                  baseMs={it.closedMs}
                  since={it.since}
                  className={cn('font-medium', it.state === 'running' && 'text-success')}
                  unitClassName="font-sans"
                />
              </span>
            )}
            {it.repairHours > 0 && (
              <span className="shrink-0 text-[11px] text-muted-foreground" title={t('taskAlloc.contrib.repairTitle')}>
                · {t('taskAlloc.contrib.repair', { hours: Math.round(it.repairHours * 100) / 100 })}
              </span>
            )}
            {onStop && it.runningWorker && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="-mr-1 h-5 w-5 shrink-0 p-0 text-muted-foreground hover:text-destructive has-[>svg]:px-0 pointer-coarse:h-8 pointer-coarse:w-8"
                title={t('taskLive.adminStopFor', { name: formatDisplayName(it.fullName ?? '') || label })}
                aria-label={t('taskLive.adminStopFor', { name: formatDisplayName(it.fullName ?? '') || label })}
                onClick={(e) => {
                  e.stopPropagation();
                  if (it.runningWorker) onStop(it.runningWorker);
                }}
              >
                <Square className="h-3 w-3" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default ContributorsList;
