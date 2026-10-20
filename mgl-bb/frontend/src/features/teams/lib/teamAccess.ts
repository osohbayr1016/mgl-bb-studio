import { useApiQuery } from '@/shared/api/useApi';
import type { UserTeam } from '@/shared/types';

/**
 * Багууд хэсгийн харагдацын эрх (2026-09-30).  admin, senior бүх багийг харна;
 * бусад (engineer, architect …) зөвхөн ӨӨРИЙН багийн хуудсыг.
 *
 * ⚠️ ТВИН: `backend/src/lib/teamAccess.ts` → `seesAllTeams`.  Энэ нь зөвхөн UX —
 * жинхэнэ хаалт сервер талд (`/api/teams/:id*` 403, `/allocation` requireManager).
 */
export function seesAllTeams(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'senior';
}

/**
 * Дуудагчийн өөрийн багууд (үндсэн нь эхэнд) — `GET /api/teams/mine`.
 *
 * `useAuth().user.teams` биш ЗОРИУДААР: `/auth/login` нь `teams`-гүй мөр буцаадаг
 * тул нэвтэрсэн даруйд хоосон байдаг.  Энэ нь сервер хаалтын эх сурвалжтай
 * (`user_teams`) яг ижил.
 */
export function useOwnTeams(enabled: boolean) {
  return useApiQuery<{ teams: UserTeam[] }>('/teams/mine', { enabled, staleTime: 60_000 });
}
