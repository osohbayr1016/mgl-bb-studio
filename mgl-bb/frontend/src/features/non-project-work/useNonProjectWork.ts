import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/shared/api/client';
import { useAuth } from '@/shared/context/AuthContext';
import type { NonProjectEntry, NonProjectFormValues } from './types';

/** «Миний ажлууд»-ын жагсаалтын кэшийн түлхүүр. */
export const NON_PROJECT_MY_KEY = ['/non-project-work/my'] as const;
/** Ирцийн widget/хуудас хоёр хуваалцдаг түлхүүр — өнөөдрийн жагсаалт тэнд. */
const ATTENDANCE_STATUS_KEY = ['/attendance/my-status'] as const;

/**
 * Бүртгэх эрх — сервер тал `NON_PROJECT_WORK_ROLES`-той ижил олонлог
 * (засвар бүртгэх эрхтэй адил).  Frontend-ийн шалгалт нь зөвхөн UX.
 */
export function useCanLogNonProjectWork(): boolean {
  const { user } = useAuth();
  return user?.role === 'engineer' || user?.role === 'architect' || user?.role === 'senior';
}

/**
 * Үүсгэх / засах / устгах.  Амжилт бүрийн дараа ирцийн төлөв ба «Миний
 * ажлууд»-ын жагсаалт ХОЁУЛАА дахин татагдана — ирцийн цонхны «дор хаяж нэг»
 * тоолол ба гарах үеийн тайлбарын шаардлага `my-status`-аас уншигддаг.
 */
export function useNonProjectWorkActions() {
  const qc = useQueryClient();

  const refresh = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ATTENDANCE_STATUS_KEY }),
        qc.invalidateQueries({ queryKey: NON_PROJECT_MY_KEY }),
      ]),
    [qc],
  );

  /**
   * 409 = мөр хуучирсан: админ энэ хооронд баталсан/татгалзсан (`NOT_PENDING`)
   * эсвэл өөр табд давхцах бүртгэл нэмэгдсэн (`OVERLAP`).  Жагсаалтыг
   * шинэчилбэл засах/устгах товч алга болж, шинэ төлөв харагдана — алдааг
   * дуудагч хэвээр харуулна.
   */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        const out = await fn();
        await refresh();
        return out;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) await refresh();
        throw err;
      }
    },
    [refresh],
  );

  const create = useCallback(
    (values: NonProjectFormValues) =>
      run(async () => {
        const res = await apiFetch<{ item: NonProjectEntry | null }>('/non-project-work', {
          method: 'POST',
          data: values,
        });
        return res.item;
      }),
    [run],
  );

  const update = useCallback(
    (id: number, patch: Partial<NonProjectFormValues>) =>
      run(async () => {
        const res = await apiFetch<{ item: NonProjectEntry | null }>(`/non-project-work/${id}`, {
          method: 'PATCH',
          data: patch,
        });
        return res.item;
      }),
    [run],
  );

  const remove = useCallback(
    (id: number) =>
      run(async () => {
        await apiFetch(`/non-project-work/${id}`, { method: 'DELETE' });
      }),
    [run],
  );

  return useMemo(() => ({ create, update, remove }), [create, update, remove]);
}
