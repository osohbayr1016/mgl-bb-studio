/* «Одоо хийж буй» + «Өөртөө авах» + «Миний ажилд нэмэх» — төслийн хуудасны ганц эх сурвалж
 * (эзэн 2026-10-01).
 *
 *   • Таск дээрх НЭР = албан таймер нь тэр таск дээр ОДОО явж буй хүн
 *     (`GET /api/task-timer/working`, ~10 сек тутам + өөрийн/бусад табын үйлдэлд шууд).
 *     Байнгын «хариуцагч» БАЙХГҮЙ — хүнд оноох, «Буцаах», хуваалцах товч хасагдсан.
 *   • «Өөртөө авах» = таймер эхэлнэ (өөр таск дээрх нь АТОМ зогсоно).  Хуваагдах таск
 *     дээр өөр хүн ажиллаж байвал сервер 409 TASK_OCCUPIED + хуваах өгөгдмөл буцаана →
 *     50/50-аар бэлдсэн «Хувааж авах» цонх (`useTakeTask` — «Миний ажлууд»-тай ижил).
 *   • «Миний ажилд нэмэх» (0370) — таскийг «Миний ажлууд»-даа нэмнэ; ЗӨВХӨН танд харагдана
 *     (таск дээр нэр гарахгүй).  Тэндээсээ шууд цаг эхлүүлнэ.
 *   • Ирцээ «Ирэх» бүртгээгүй бол авахгүй (NOT_CLOCKED_IN — сервер шийднэ).
 *
 * Мөр бүр (`FlatTaskRow`, `GroupedTaskRow`, блокийн цонх) энэ context-оос уншина —
 * олон түвшний prop дамжуулалтгүй. */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { apiFetch, ApiError } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import {
  OFFICIAL_TIMER_LIVE_KEY,
  OFFICIAL_TIMER_STATE_KEY,
  OFFICIAL_TIMER_WORKING_KEY,
  type TaskWorker,
} from '@/features/task-timer/officialTimer';
import { notifyOtherTabs, useOfficialTimer } from '@/features/task-timer/useOfficialTimer';
import { useProjectWorkers } from '@/features/task-timer/useProjectWorkers';
import { MY_TASK_IDS_KEY, invalidateMyList, setInMyList } from '@/features/tasks/myTaskList';
import { AllocationEditorDialog } from '@/features/task-allocation/AllocationEditorDialog';
import { RootSplitDialog } from '@/features/task-allocation/RootSplitDialog';
import { TakeFlowDialogs } from '@/features/task-allocation/TakeFlowDialogs';
import { newRequestId, postRootSplitUndo, toFailure } from '@/features/task-allocation/api';
import { useProjectContributors } from '@/features/task-allocation/hooks';
import { invalidateAfterProgress } from '@/features/task-allocation/ownProgressStore';
import type { RootSplitResult } from '@/features/task-allocation/types';

import { TaskLiveContext, type TaskLiveValue } from './taskLiveContext';
import type { FlatTask } from './types';
import { useTakeTask } from './useTakeTask';

export function TaskLiveProvider({
  projectId,
  currentUserId,
  canTake,
  isManager,
  canAdminStop,
  hoursMode,
  myTaskIds,
  onStructureChanged,
  children,
}: {
  projectId: number | null;
  currentUserId: number | null;
  canTake: boolean;
  isManager: boolean;
  canAdminStop: boolean;
  hoursMode: boolean;
  /** Энэ төсөл дэх «Миний ажлууд»-ын таскууд (`useMyTaskIds`); ачаалж буй / эрхгүй бол null. */
  myTaskIds: ReadonlySet<number> | null;
  /** Хувааж авсны дараа төслийн мод шинэчлэгдэнэ. */
  onStructureChanged: () => void;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const timer = useOfficialTimer(canTake);
  const { byTask } = useProjectWorkers(projectId);
  // Хувь нэмэрчид (нэр + албан цаг + хуваарилалт) — төсөл бүрт НЭГ дуудлага.  Хөлийн цагаар бус (hoursMode) төсөлд хэрэггүй.
  const contributors = useProjectContributors(projectId, !hoursMode);
  // Цаг эхэлсэн таск «Миний ажлууд»-д орно (сервер) — товчны төлөв шинэчлэгдэнэ.
  const onTaken = useCallback(() => {
    invalidateMyList(qc);
    void qc.invalidateQueries({ queryKey: ['/tasks/contributors'] });
  }, [qc]);
  const { take, takingId, flow, closeFlow } = useTakeTask({ timer, onTaken });
  // «Хуваарилах» товчоор нээгдэх засварлагч (авах урсгалаас тусдаа).
  const [editTask, setEditTask] = useState<FlatTask | null>(null);
  const openAllocation = useCallback((task: FlatTask) => setEditTask(task), []);
  // ✂ «Хуваах» — таскийг үндсэн таскууд болгох цонх (0395).
  const [rootSplitTask, setRootSplitTask] = useState<FlatTask | null>(null);
  const openRootSplit = useCallback((task: FlatTask) => setRootSplitTask(task), []);
  // Хуваасны дараах «Буцаах» (toast-ын товч) — шинэ таскууд дээр ажил эхлээгүй бол бүгд анхны байдалд.
  const onRootSplitSaved = useCallback(
    (task: FlatTask, res: RootSplitResult) => {
      onStructureChanged();
      invalidateAfterProgress();
      void qc.invalidateQueries({ queryKey: ['/tasks/contributors'] });
      toast.successWithAction(
        t('taskAlloc.rootSplit.saved', { name: task.name, n: res.parts.length }),
        {
          label: t('taskAlloc.rootSplit.undo'),
          onClick: () => {
            void (async () => {
              try {
                await postRootSplitUndo(res.split_id, newRequestId());
                toast.success(t('taskAlloc.rootSplit.undone', { name: task.name }));
              } catch (err) {
                toast.error(t('taskAlloc.rootSplit.undoFailed'), toFailure(err).message || undefined);
              } finally {
                onStructureChanged();
                invalidateAfterProgress();
                void qc.invalidateQueries({ queryKey: ['/tasks/contributors'] });
                void qc.invalidateQueries({ queryKey: ['/tasks/root-split'] });
              }
            })();
          },
        },
        res.done ? t('taskAlloc.rootSplit.savedDone', { name: res.done.name }) : undefined,
      );
    },
    [onStructureChanged, qc, t],
  );

  /** Нэмэх/хасах хүсэлт явж буй таскууд — товчны төлөв шууд солигдоно (optimistic).  Таск
   *  ТУС БҮРД: хэд хэдэн таскийг дараалан хурдан нэмэхэд нэг нь нөгөөгөө түгжихгүй. */
  const [pendingList, setPendingList] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const inMyList = useCallback(
    (taskId: number) => pendingList.get(taskId) ?? myTaskIds?.has(taskId) ?? false,
    [pendingList, myTaskIds],
  );
  const isListBusy = useCallback((taskId: number) => pendingList.has(taskId), [pendingList]);
  const toggleMyList = useCallback(
    (task: FlatTask) => {
      if (pendingList.has(task.id)) return;
      const on = !inMyList(task.id);
      setPendingList((m) => new Map(m).set(task.id, on));
      void (async () => {
        try {
          await setInMyList(task.id, on);
          toast.success(
            on ? t('myTaskList.added', { name: task.name }) : t('myTaskList.removed', { name: task.name }),
            on ? t('myTaskList.addedHint') : undefined,
          );
          invalidateMyList(qc);
          await qc.invalidateQueries({ queryKey: [MY_TASK_IDS_KEY, projectId] });
        } catch (e) {
          const payload = e instanceof ApiError ? e.payload : {};
          const message =
            typeof payload.message === 'string' ? payload.message : e instanceof Error ? e.message : undefined;
          toast.error(t('myTaskList.errTitle'), message);
        } finally {
          setPendingList((m) => {
            const next = new Map(m);
            next.delete(task.id);
            return next;
          });
        }
      })();
    },
    [pendingList, inMyList, qc, projectId, t],
  );

  const adminStop = useCallback(
    (task: FlatTask, worker: TaskWorker) => {
      void (async () => {
        const name = formatDisplayName(worker.full_name ?? '') || `#${worker.user_id}`;
        const ok = await confirmDialog({
          title: t('taskLive.adminStopTitle'),
          description: t('taskLive.adminStopConfirm', { name, task: task.name }),
          confirmText: t('taskLive.adminStop'),
          variant: 'destructive',
        });
        if (!ok) return;
        try {
          await apiFetch(`/task-timer/users/${worker.user_id}/stop`, { method: 'POST', data: {} });
          notifyOtherTabs();
          void qc.invalidateQueries({ queryKey: [OFFICIAL_TIMER_WORKING_KEY] });
          void qc.invalidateQueries({ queryKey: OFFICIAL_TIMER_LIVE_KEY });
          void qc.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
          toast.success(t('taskLive.adminStopped', { name }));
        } catch (e) {
          toast.error(t('common.error'), e instanceof Error ? e.message : undefined);
        }
      })();
    },
    [qc, t],
  );

  const value = useMemo<TaskLiveValue>(
    () => ({
      workersByTask: byTask,
      contributorsByTask: contributors.byTask,
      managedByTask: contributors.managed,
      completionQuestions: contributors.completionQuestions,
      openAllocation,
      openRootSplit,
      timer,
      currentUserId,
      canTake,
      isManager,
      canAdminStop,
      hoursMode,
      takingId,
      take,
      adminStop,
      canUseMyList: canTake && myTaskIds !== null,
      inMyList,
      toggleMyList,
      isListBusy,
    }),
    [
      byTask,
      contributors.byTask,
      contributors.managed,
      contributors.completionQuestions,
      openAllocation,
      openRootSplit,
      timer,
      currentUserId,
      canTake,
      isManager,
      canAdminStop,
      hoursMode,
      takingId,
      take,
      adminStop,
      myTaskIds,
      inMyList,
      toggleMyList,
      isListBusy,
    ],
  );

  return (
    <TaskLiveContext.Provider value={value}>
      {children}
      {/* «Авах» (▶) амжилтгүй: өөр хүн ажиллаж буй таск → хуваарилах; ирээдүйн ажилгүй → чөлөөт ажил авах. */}
      <TakeFlowDialogs flow={flow} timer={timer} onClose={closeFlow} onDone={onStructureChanged} />
      {rootSplitTask && (
        <RootSplitDialog
          task={{ id: rootSplitTask.id, name: rootSplitTask.name }}
          onSaved={(res) => onRootSplitSaved(rootSplitTask, res)}
          onUndone={() => {
            setRootSplitTask(null);
            onStructureChanged();
            invalidateAfterProgress();
          }}
          onClose={() => setRootSplitTask(null)}
        />
      )}
      {editTask && (
        <AllocationEditorDialog
          task={{ id: editTask.id, name: editTask.name }}
          initialWorkerIds={(byTask.get(editTask.id) ?? []).map((w) => w.user_id)}
          onClose={() => {
            setEditTask(null);
            onStructureChanged();
          }}
        />
      )}
    </TaskLiveContext.Provider>
  );
}
