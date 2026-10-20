/* «Авах» (▶) амжилтгүй болсон үед нээгдэх цонхнууд — төслийн хуудас, «Миний ажлууд» ХОЁУЛАА хуваалцана (2026-10-02).
 *
 *   TASK_OCCUPIED  — өөр хүн ажиллаж буй таск: ХУВААРИЛАЛТЫН засварлагч («авч эхлэх» урсгал).  Хадгалсны дараа таны
 *                    цаг шууд эхэлнэ.  (Хуучин «таск хуваах» шинэ таск үүсгэдэг байсан — одоо НЭГ таск, олон хуваарилалт.)
 *   NOT_ALLOCATED  — хуваарилагдсан таск дээр танд ирээдүйн ажил алга: хүнгүй хэсгээс авах (0394), чөлөөт ажлаас авах
 *                    эсвэл хуваарилалт засах. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import type { OfficialTimerApi } from '@/features/task-timer/useOfficialTimer';
import type { TakeFlow, TakeTarget } from '@/features/projects/detail/useTakeTask';

import { AllocationEditorDialog } from './AllocationEditorDialog';
import { newRequestId, postRetake, toFailure } from './api';
import { useAllocationOverview } from './hooks';
import { invalidateAfterProgress } from './ownProgressStore';
import { formatUnits } from './units';

export function TakeFlowDialogs({
  flow,
  timer,
  onClose,
  onDone,
}: {
  flow: TakeFlow | null;
  timer: OfficialTimerApi;
  onClose: () => void;
  /** Бүтэц/хуваарилалт өөрчлөгдөж, цаг эхэлсний дараа (жагсаалт, төслийн мод дахин уншина). */
  onDone?: () => void;
}) {
  const { t } = useLanguage();
  // «Хуваарилалт засах» дарсан — НЭГ цонх нөгөөгөөр солигдоно.
  const [editFor, setEditFor] = useState<TakeTarget | null>(null);
  if (!flow) return null;

  // Хуваарилалт хадгалагдсан (таск одоо managed, миний хэсэг бий) → цаг эхлэх нь амжилттай болно.  Тиймээс OPTIMISTIC `start`:
  // ▶ товч ШУУД ⏸ болж, дараа нь зогсоож болно (эзэн 2026-10-06).  Алдаа гарвал `useOfficialTimer` өөрөө toast + төлөвийг сэргээнэ.
  const startTimer = async (task: TakeTarget) => {
    timer.start(task.id, task.name);
    toast.success(t('taskAlloc.take.started', { name: task.name }));
    onDone?.();
  };

  const close = () => {
    setEditFor(null);
    onClose();
  };

  if (editFor) {
    return (
      <AllocationEditorDialog
        task={{ id: editFor.id, name: editFor.name }}
        take
        onSaved={() => startTimer(editFor)}
        onClose={close}
      />
    );
  }

  if (flow.kind === 'occupied') {
    return (
      <AllocationEditorDialog
        task={{ id: flow.task.id, name: flow.task.name }}
        take
        takeReason={flow.occupied.reason ?? 'working'}
        initialWorkerIds={flow.occupied.workers.map((w) => w.user_id)}
        onSaved={() => startTimer(flow.task)}
        onClose={close}
      />
    );
  }

  return (
    <NotAllocatedDialog
      task={flow.task}
      info={flow.allocation}
      onStart={startTimer}
      onEdit={() => setEditFor(flow.task)}
      onClose={close}
    />
  );
}

function NotAllocatedDialog({
  task,
  info,
  onStart,
  onEdit,
  onClose,
}: {
  task: TakeTarget;
  info: { available_units: number; my_done_units: number; released_units: number; has_row: boolean };
  onStart: (task: TakeTarget) => Promise<void>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const overview = useAllocationOverview(task.id);
  const [busy, setBusy] = useState(false);
  const revision = overview.data?.root?.revision ?? null;
  const canRetake = info.available_units > 0 && revision !== null && overview.data?.allowed.retake === true;
  const parts = overview.data?.root?.parts ?? [];

  const retake = async () => {
    if (revision === null) return;
    setBusy(true);
    try {
      await postRetake(task.id, { requestId: newRequestId(), expectedRevision: revision }, null);
      invalidateAfterProgress();
      await onStart(task);
      onClose();
    } catch (err) {
      const f = toFailure(err);
      toast.error(t('taskTimer.errTitle'), f.message || t('taskAlloc.err.generic'));
      void overview.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('taskAlloc.notAllocated.title')}</DialogTitle>
          <DialogDescription>{task.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm" data-testid="not-allocated">
          <p>{t('taskAlloc.notAllocated.body')}</p>
          {info.my_done_units > 0 && (
            <p className="text-muted-foreground">
              {t('taskAlloc.notAllocated.myDone', { x: formatUnits(info.my_done_units) })}
            </p>
          )}
          {info.released_units > 0 && (
            <p className="text-muted-foreground">
              {t('taskAlloc.notAllocated.released', { x: formatUnits(info.released_units) })}
            </p>
          )}
          {parts.length > 0 ? (
            <div className="space-y-1.5 pt-1" data-testid="not-allocated-parts">
              <p className="text-muted-foreground">{t('taskAlloc.rootSplit.partsHint')}</p>
              {parts.map((p) => (
                <div key={p.part_id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatUnits(p.units)}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={info.available_units > 0 ? 'text-foreground' : 'text-muted-foreground'}>
              {info.available_units > 0
                ? t('taskAlloc.notAllocated.free', { x: formatUnits(info.available_units) })
                : t('taskAlloc.notAllocated.noFree')}
            </p>
          )}
          {parts.length > 0 && info.available_units > 0 && (
            <p className="text-foreground">{t('taskAlloc.notAllocated.free', { x: formatUnits(info.available_units) })}</p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.close')}
          </Button>
          <Button variant="outline" onClick={onEdit} disabled={busy} data-testid="not-allocated-edit">
            {t('taskAlloc.notAllocated.edit')}
          </Button>
          {info.available_units > 0 && (
            <Button onClick={() => void retake()} disabled={busy || !canRetake} data-testid="not-allocated-retake">
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('taskAlloc.notAllocated.retake', { x: formatUnits(info.available_units) })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TakeFlowDialogs;
