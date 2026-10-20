import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/shared/api/client';
import { OFFICIAL_TIMER_WORKING_KEY, type TaskWorker } from './officialTimer';

/** Нэрс шинэчлэгдэх давтамж (2026-10-01: 20 → 10 сек — «Миний ажлууд»-аас эхлүүлсэн цаг
 *  төслийн хуудсанд бусдад бараг шууд харагдах ёстой).  Өөрийн үйлдэл ба нэг хөтчийн бусад
 *  таб нь шууд invalidate хийнэ; далд табд react-query өөрөө зогсооно. */
const POLL_MS = 10_000;

/**
 * Төслийн таскууд дээр ОДОО ажиллаж буй хүмүүс (албан таймер явж буй) — таск
 * тус бүрд.  Эзэн 2026-10-01: таск дээрх НЭР = одоо хийж буй хүн; зарцуулсан цаг
 * зөвхөн тухайн хүнд + админд тул энд цаг ирэхгүй (`GET /api/task-timer/working`).
 */
export function useProjectWorkers(projectId: number | null): {
  byTask: ReadonlyMap<number, TaskWorker[]>;
  loaded: boolean;
} {
  const enabled = projectId != null && Number.isFinite(projectId) && projectId > 0;
  const query = useQuery({
    queryKey: [OFFICIAL_TIMER_WORKING_KEY, projectId],
    queryFn: () =>
      apiFetch<{ workers: TaskWorker[] }>(`/task-timer/working?project_id=${projectId}`).then(
        (r) => r.workers ?? [],
      ),
    enabled,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
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
