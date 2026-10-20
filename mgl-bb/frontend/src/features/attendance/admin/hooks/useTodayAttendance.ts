import { useCallback, useEffect } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import type { AttendanceSession, AttendanceStats } from '@/shared/types';
import type { AttendanceAdminTab } from '@/features/attendance/admin/constants';
import { todayStr } from '@/features/attendance/admin/utils/dates';

/**
 * Өнөөдрийн ирц — `today` таб дээр 60 секунд тутам өөрөө сэргэнэ.
 *
 * `today` нь eager ачаалагддаг: `/attendance/stats`-ийн тоолуурууд таб нээхээс
 * өмнө ч толгойд хэрэгтэй болдог.
 */
export function useTodayAttendance(tab: AttendanceAdminTab) {
  const todayDate = todayStr();

  const todaySessionsQuery = useApiQuery<{ sessions: AttendanceSession[] }>(
    ['/attendance/sessions', todayDate],
    `/attendance/sessions?date=${todayDate}`,
  );
  const todayStatsQuery = useApiQuery<AttendanceStats>(['/attendance/stats'], '/attendance/stats');

  const todaySessions: AttendanceSession[] = todaySessionsQuery.data?.sessions ?? [];
  const stats: AttendanceStats | null = todayStatsQuery.data ?? null;

  // Thin shim so the existing onClick handlers keep working — simply
  // refetch the appropriate queries rather than re-doing an imperative load.
  const loadToday = useCallback(() => {
    todaySessionsQuery.refetch();
    todayStatsQuery.refetch();
  }, [todaySessionsQuery, todayStatsQuery]);

  // Auto-refresh today every 60s
  useEffect(() => {
    if (tab !== 'today') return;
    const timer = setInterval(loadToday, 60_000);
    return () => clearInterval(timer);
  }, [tab, loadToday]);

  return {
    todaySessions,
    stats,
    loadToday,
    isLoading: todaySessionsQuery.isLoading || todayStatsQuery.isLoading,
  };
}

export type TodayAttendance = ReturnType<typeof useTodayAttendance>;
