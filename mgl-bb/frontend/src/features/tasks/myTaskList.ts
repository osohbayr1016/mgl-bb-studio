/* «Миний ажлууд»-ын хувийн жагсаалт (эзэн 2026-10-01, migration 0370) — клиент.
 * Backend: `backend/src/lib/myTaskList.ts`, `routes/progress.ts` (`/my-tasks/:id/list`,
 * `/my-tasks/ids`), `routes/taskTimer.ts` (`/working?mine=1`).
 *
 *   • Төслийн хуудасны таскийн мөр дээрх «Миний ажилд нэмэх» → «Миний ажлууд»-д гарна.
 *     ЗӨВХӨН танд харагдана: таск дээрх нэр хэвээр «одоо цаг нь явж буй хүн».
 *   • «Миний ажлууд» = ажилласан таскууд ∪ нэмсэн таскууд − хассан.  Тэндээсээ шууд цаг
 *     эхлүүлнэ (= «Өөртөө авах», ижил дүрэм); цаг зогсоосон ч таск жагсаалтад үлдэнэ.
 *   • Жагсаалтын таск дээр өөр хүн ажиллаж эхэлбэл «Миний ажлууд» ~10 секундэд харуулна. */
import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/shared/api/client';
import { OFFICIAL_TIMER_WORKING_KEY, type TaskWorker } from '@/features/task-timer/officialTimer';

/** `['/progress/my-tasks/ids', projectId]` — төслийн хуудасны товчны төлөв. */
export const MY_TASK_IDS_KEY = '/progress/my-tasks/ids' as const;
/** `useApiQuery('/progress/my-tasks')`-ийн түлхүүр («Миний ажлууд», самбарын карт). */
export const MY_TASKS_KEY = ['/progress/my-tasks'] as const;

/** «Одоо хэн хийж байна» шинэчлэгдэх давтамж (далд табд react-query өөрөө зогсооно). */
export const LIVE_WORKERS_POLL_MS = 10_000;

/** Энэ төсөл дэх миний жагсаалтын таскууд.  `enabled = false` (таск авдаггүй эрх) бол null. */
export function useMyTaskIds(projectId: number | null, enabled: boolean): ReadonlySet<number> | null {
  const on = enabled && projectId != null && Number.isFinite(projectId) && projectId > 0;
  const query = useQuery({
    queryKey: [MY_TASK_IDS_KEY, projectId],
    queryFn: () =>
      apiFetch<{ task_ids: number[] }>(`/progress/my-tasks/ids?project_id=${projectId}`).then(
        (r) => r.task_ids ?? [],
      ),
    enabled: on,
    staleTime: 10_000,
    retry: false,
  });
  const data = query.data;
  return useMemo(() => (on && data ? new Set(data) : null), [on, data]);
}

/** Нэмэх (`on = true`) / хасах.  Алдаа нь `ApiError` (дуудагч toast гаргана). */
export async function setInMyList(taskId: number, on: boolean): Promise<void> {
  await apiFetch(`/progress/my-tasks/${taskId}/list`, { method: on ? 'POST' : 'DELETE' });
}

/** «Таскийг буцаах» (0386, `POST /progress/my-tasks/:id/retract`): миний хувь + оноо устаж, би таскийн нэр /
 *  хувь нэмэрчээс алга болно; албан таймерын цаг системд хэвээр (харагдахгүй).  Алдаа нь `ApiError`. */
export interface RetractResult {
  removed_entries: number;
  removed_points: number;
  progress_before: number;
  progress_after: number;
  timer_stopped: boolean;
}
export async function retractMyTask(taskId: number): Promise<RetractResult> {
  return apiFetch<RetractResult>(`/progress/my-tasks/${taskId}/retract`, { method: 'POST' });
}

/** Жагсаалт өөрчлөгдсөний дараа — «Миний ажлууд», самбарын карт, төслийн товчнууд. */
export function invalidateMyList(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: MY_TASKS_KEY });
  void qc.invalidateQueries({ queryKey: [MY_TASK_IDS_KEY] });
  void qc.invalidateQueries({ queryKey: [OFFICIAL_TIMER_WORKING_KEY, 'mine'] });
}

/**
 * «Миний ажлууд»-ын таскууд дээр ОДОО ажиллаж буй хүмүүс (`GET /task-timer/working?mine=1`) —
 * нэр л, цаг БИШ.  Түлхүүр `[OFFICIAL_TIMER_WORKING_KEY, 'mine']` тул цаг эхлүүлэх/зогсоох,
 * өөр табын үйлдэл (`notifyOtherTabs`) бүр төслийн хуудасны нэрстэй ХАМТ шинэчилнэ.
 */
export function useMyListWorkers(enabled = true): {
  byTask: ReadonlyMap<number, TaskWorker[]>;
  loaded: boolean;
} {
  const query = useQuery({
    queryKey: [OFFICIAL_TIMER_WORKING_KEY, 'mine'],
    queryFn: () =>
      apiFetch<{ workers: TaskWorker[] }>('/task-timer/working?mine=1').then((r) => r.workers ?? []),
    enabled,
    refetchInterval: LIVE_WORKERS_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 3_000,
    retry: false,
  });
  const data = query.data;
  const byTask = useMemo(() => {
    const map = new Map<number, TaskWorker[]>();
    for (const w of data ?? []) {
      const list = map.get(w.task_id);
      if (list) list.push(w);
      else map.set(w.task_id, [w]);
    }
    return map;
  }, [data]);
  return { byTask, loaded: query.isSuccess };
}
