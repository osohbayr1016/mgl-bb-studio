/* «Өөртөө авах» = албан цаг эхлүүлэх (эзэн 2026-10-01) — төслийн хуудас (`taskLive.tsx`) ба
 * «Миний ажлууд» (`MyTasksPage.tsx`) ХУВААЛЦАНА, давтагдсан дүрэм байхгүй.
 *
 *   • Сервер шийднэ (`POST /task-timer/start`): ирцгүй → NOT_CLOCKED_IN, дууссан/архив → алдаа,
 *   • Хуваагдах таск дээр ӨӨР хүн ажиллаж байвал → 409 TASK_OCCUPIED → дуудагч `flow`-оор ХУВААРИЛАЛТЫН
 *     засварлагч (`AllocationEditorDialog`, «авч эхлэх» урсгал) нээнэ — хуучин «таск хуваах»-ыг (шинэ таск
 *     үүсгэдэг) СОЛЬСОН (2026-10-02).
 *   • Хуваарилагдсан (managed) таск дээр ирээдүйн ажил танд байхгүй → 409 NOT_ALLOCATED → `flow` (чөлөөт ажил авах,
 *     эсвэл хуваарилалт засах).
 *   • optimistic БИШ — эзлэгдсэн таск дээр тоолуур хуурамчаар эхлэхгүй (`timer.take`).
 *
 * Цонхыг дуудагч рендерлэнэ (энэ файл `.ts` — react-refresh зөвхөн компонент экспорт):
 *   `<TakeFlowDialogs flow={flow} timer={timer} onClose={closeFlow} onDone={…} />` */
import { useCallback, useState } from 'react';

import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { timerErrorKey, type NotAllocatedInfo, type TakeOccupied } from '@/features/task-timer/officialTimer';
import type { OfficialTimerApi } from '@/features/task-timer/useOfficialTimer';

import type { FlatTask } from './types';

/** Хуваарилах/авах цонхонд хэрэгтэй таскийн хэсэг (`FlatTask`-ийн дэд олонлог). */
export type TakeTarget = Pick<FlatTask, 'id' | 'name' | 'weight_percent' | 'progress'>;

/** Авах оролдлого амжилтгүй болоход дуудагч нээх цонх. */
export type TakeFlow =
  | { kind: 'occupied'; task: TakeTarget; occupied: TakeOccupied }
  | { kind: 'notAllocated'; task: TakeTarget; allocation: NotAllocatedInfo };

export function useTakeTask({
  timer,
  onTaken,
}: {
  timer: OfficialTimerApi;
  /** Цаг амжилттай эхэлсний дараа (жишээ нь «Миний ажлууд»-ыг дахин уншина). */
  onTaken?: (taskId: number) => void;
}): {
  take: (task: TakeTarget) => void;
  takingId: number | null;
  flow: TakeFlow | null;
  closeFlow: () => void;
} {
  const { t } = useLanguage();
  const [takingId, setTakingId] = useState<number | null>(null);
  const [flow, setFlow] = useState<TakeFlow | null>(null);

  const take = useCallback(
    (task: TakeTarget) => {
      if (takingId !== null) return;
      setTakingId(task.id);
      void timer
        .take(task.id)
        .then((r) => {
          if (r.ok) {
            const title =
              r.outcome === 'switched'
                ? t('taskLive.tookSwitched', { name: task.name })
                : r.outcome === 'already_running'
                  ? t('taskLive.alreadyRunning', { name: task.name })
                  : t('taskLive.took', { name: task.name });
            toast.success(
              title,
              r.progress > 0 && r.outcome !== 'already_running'
                ? t('taskLive.continueFrom', { pct: Math.round(r.progress * 100) / 100 })
                : undefined,
            );
            onTaken?.(task.id);
            return;
          }
          if (r.code === 'TASK_OCCUPIED' && r.occupied) {
            setFlow({ kind: 'occupied', task, occupied: r.occupied });
            return;
          }
          if (r.code === 'NOT_ALLOCATED' && r.allocation) {
            setFlow({ kind: 'notAllocated', task, allocation: r.allocation });
            return;
          }
          toast.error(t('taskTimer.errTitle'), r.message ?? t(timerErrorKey(r.code)));
        })
        .finally(() => setTakingId(null));
    },
    [takingId, timer, t, onTaken],
  );

  const closeFlow = useCallback(() => setFlow(null), []);

  return { take, takingId, flow, closeFlow };
}
