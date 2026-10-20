import { keepPreviousData } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/api/useApi';
import { apiFetch } from '@/shared/api/client';
import type { PeriodKind, SendWarningResponse, TeamProductivityResponse } from './types';

/** Query түлхүүрийн угтвар — анхааруулга/босго хадгалсны дараа бүгдийг хүчингүй болгоно. */
export const PRODUCTIVITY_KEY = '/teams/productivity';

export function useTeamProductivity(teamId: number, kind: PeriodKind, date: string, enabled = true) {
  return useApiQuery<TeamProductivityResponse>(
    [PRODUCTIVITY_KEY, teamId, kind, date],
    `/teams/${teamId}/productivity?period=${kind}&date=${date}`,
    {
      enabled,
      retry: false,
      // Хугацаа солиход хуудас хоосорч анивчихгүй — шинэ тоо иртэл хуучин харагдана.
      placeholderData: keepPreviousData,
    },
  );
}

export function sendGapWarning(
  teamId: number,
  body: { period: PeriodKind; date: string; recipient_ids: number[]; note: string },
) {
  return apiFetch<SendWarningResponse>(`/teams/${teamId}/productivity/warnings`, { method: 'POST', data: body });
}

export function saveGapThreshold(thresholdPct: number) {
  return apiFetch<{ threshold_pct: number }>('/teams/productivity/settings', {
    method: 'PUT',
    data: { threshold_pct: thresholdPct },
  });
}
