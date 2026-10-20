/**
 * ТАСКИЙН ХУВААРИЛАЛТ — query hook-ууд.  Бичилт (`api.ts`) нь `request_id` + CAS-тай, унших нь энгийн query.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { formatDisplayName } from '@/shared/lib/formatting';
import { syncLunch, syncServerClock } from '@/features/task-timer/timerClock';

import {
  ALLOCATION_PREFIX,
  CANDIDATES_KEY,
  CONTRIBUTORS_PREFIX,
  allocationKey,
  contributorsKey,
  fetchAllocation,
  fetchCandidates,
  fetchContributors,
  fetchOwnRecords,
  ownRecordsKey,
} from './api';
import type { ContributorRow, ManagedSummary, ProjectContributors } from './types';

/** Хувь нэмэрчийн жагсаалт шинэчлэгдэх давтамж.  Явж буй цаг клиент талд (`running_since`) өөрөө тоологддог, «одоо хэн
 *  ажиллаж байна» нь тусдаа хөнгөн 10 сек-ийн дуудлага (`useProjectWorkers`) — тиймээс энд 30 сек хангалттай.  Цаг
 *  эхлүүлэх/зогсоох, явц хадгалах бүрд шууд invalidate (`CONTRIBUTORS_PREFIX`).  D1 rows_read хэмнэнэ (асуулга 6). */
export const CONTRIBUTORS_POLL_MS = 30_000;

/** Таскийн хуваарилалтын тойм (засварлагч нээгдэхэд л). */
export function useAllocationOverview(taskId: number | null, enabled = true) {
  const on = enabled && taskId !== null && taskId > 0;
  return useQuery({
    queryKey: allocationKey(taskId ?? 0),
    queryFn: () => fetchAllocation(taskId as number),
    enabled: on,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
}

/** Ирээдүйн ажил эзэлж болох ажилтнууд (засварлагчийн «Хүн нэмэх»). */
export function useCandidates(enabled = true) {
  return useQuery({
    queryKey: CANDIDATES_KEY,
    queryFn: fetchCandidates,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** Өөрийн хүчинтэй хэсгүүд + сэргээж болох залруулгууд. */
export function useOwnRecords(taskId: number | null, enabled = true) {
  const on = enabled && taskId !== null && taskId > 0;
  return useQuery({
    queryKey: ownRecordsKey(taskId ?? 0),
    queryFn: () => fetchOwnRecords(taskId as number),
    enabled: on,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
}

export interface ProjectContributorsApi {
  /** task_id → хувь нэмэрчид. */
  byTask: ReadonlyMap<number, ContributorRow[]>;
  /** task_id → managed root-ийн тойм. */
  managed: ReadonlyMap<number, ManagedSummary>;
  completionQuestions: ProjectContributors['completion_questions'];
  loaded: boolean;
  /** Серверийн цагийн зангуу (`server_now`) хөтчийн тоолуурт синк хийгдсэн. */
  data: ProjectContributors | undefined;
}

/**
 * Төслийн таск бүрийн хувь нэмэрч (нэр + ажилласан цаг) — НЭГ дуудлага (мөр бүрт БИШ).  Серверийн цаг, цайны цонхыг
 * албан таймертай ИЖИЛ модулийн цагт (`timerClock`) синк хийнэ — тиймээс хүн бүрийн тоолуур «Миний таймер»-тай нэг цагтай.
 */
export function useProjectContributors(projectId: number | null, enabled = true): ProjectContributorsApi {
  const on = enabled && projectId !== null && Number.isFinite(projectId) && projectId > 0;
  const query = useQuery({
    queryKey: contributorsKey(projectId ?? 0),
    queryFn: async () => {
      const res = await fetchContributors(projectId as number);
      syncServerClock(res.server_now);
      syncLunch(res.lunch);
      return res;
    },
    enabled: on,
    refetchInterval: CONTRIBUTORS_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: false,
  });
  const data = query.data;
  return useMemo<ProjectContributorsApi>(() => {
    const byTask = new Map<number, ContributorRow[]>();
    const managed = new Map<number, ManagedSummary>();
    if (data) {
      for (const [k, rows] of Object.entries(data.tasks)) byTask.set(Number(k), rows);
      for (const [k, m] of Object.entries(data.managed)) managed.set(Number(k), m);
    }
    return {
      byTask,
      managed,
      completionQuestions: data?.completion_questions ?? [],
      loaded: query.isSuccess,
      data,
    };
  }, [data, query.isSuccess]);
}

/** Хүний id → харуулах нэр («Нэр Овог»): төслийн хувь нэмэрчид ∪ нэр дэвшигчид (түүхтэй идэвхгүй хүн ч нэртэй). */
export function useNameMap(projectId: number | null): ReadonlyMap<number, string> {
  const contributors = useProjectContributors(projectId, projectId !== null);
  const candidates = useCandidates(projectId !== null);
  const byTask = contributors.byTask;
  const people = candidates.data;
  return useMemo(() => {
    const m = new Map<number, string>();
    for (const rows of byTask.values()) {
      for (const r of rows) if (r.full_name) m.set(r.user_id, formatDisplayName(r.full_name));
    }
    for (const u of people ?? []) if (u.full_name) m.set(u.id, formatDisplayName(u.full_name));
    return m;
  }, [byTask, people]);
}

/** Хуваарилалт, хувь нэмэрч, миний ажлуудыг ХАМТ шинэчилнэ (бүтцийн өөрчлөлтийн дараа). */
export function useInvalidateAllocation() {
  const qc = useQueryClient();
  return useMemo(
    () => () => {
      void qc.invalidateQueries({ queryKey: ALLOCATION_PREFIX });
      void qc.invalidateQueries({ queryKey: CONTRIBUTORS_PREFIX });
    },
    [qc],
  );
}
