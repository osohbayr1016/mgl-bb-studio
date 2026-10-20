/** Query + local-mirror state + privacy scope for the project detail page.
 *  Extracted from `ProjectDetailPage.tsx` when that file was split into
 *  per-component modules — no behavioural change. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import type { ProjectDetailResponse } from '@/shared/types';

export function useProjectDetail(id: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Stable across renders (keyed only on the route id) so the effect below
  // and the memoized reload()/mutation callbacks don't get a fresh array
  // reference every render — which would defeat the memo() task rows.
  const projectKey = useMemo(() => ['/projects', id] as const, [id]);
  const projectQuery = useApiQuery<ProjectDetailResponse>(projectKey, `/projects/${id}`, {
    enabled: !!id,
  });
  // `data`/`setData` keep the existing call-sites working (some
  // mutations call `setData(refreshed)` after a write). We mirror the
  // query response into local state and write back into the cache on
  // mutations so both stay in sync.
  const [data, setData] = useState<ProjectDetailResponse | null>(null);
  useEffect(() => {
    if (projectQuery.data) setData(projectQuery.data);
  }, [projectQuery.data]);
  const loading = projectQuery.isLoading && !data;
  // Хуудас нь `data` байхгүй үед ЯАГААД байхгүйг харуулах ёстой: 403
  // («Access denied» — токен өөр хүнийх / role хуучирсан) ба 404 нь хоёр
  // өөр асуудал, хоёуланг «Төсөл олдсонгүй» гэж нуувал хэрэглэгч буруу
  // дүгнэлт хийнэ.
  const error = data ? null : projectQuery.error;

  /* Re-fetch whenever someone, somewhere submits or admin-overrides a
     progress %. Today the emitters are `MyTasksPage`, `ApprovalsPage`,
     and the admin baseline editor on `AdminProjectSetupPage` — without
     this listener the overview shows the stale "0 %" until the user
     hard-refreshes. Window focus is handled by TanStack Query
     (`refetchOnWindowFocus: true`) so we no longer wire that up here. */
  useEffect(() => {
    const onProgress = () => {
      queryClient.invalidateQueries({ queryKey: projectKey });
    };
    window.addEventListener('progress:submitted', onProgress);
    return () => {
      window.removeEventListener('progress:submitted', onProgress);
    };
  }, [queryClient, projectKey]);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch<ProjectDetailResponse>(`/projects/${id}`);
      setData(res);
      queryClient.setQueryData(projectKey, res);
    } catch (err) {
      console.error(err);
    }
  }, [id, queryClient, projectKey]);

  // Privacy scope: engineers/architects/seniors only see their own team's
  // discipline. Admins and clients keep the all-project view.
  //
  // Prefer auth/me's denormalized `team_code`, but fall back to the joined
  // project member row. This covers older sessions where the auth payload was
  // cached before team_code was added to /auth/me; without the fallback those
  // users looked unscoped and saw every BA/BB/HAS/... tab.
  const scopeTeamCode = useMemo<string | null>(() => {
    if (!user) return null;
    const adminRoles = ['admin'];
    if (adminRoles.includes(user.role) || user.role === 'client') return null;
    if (user.team_code) return user.team_code;
    const member = data?.members?.find((m) => m.id === user.id);
    return member?.team_code ?? null;
  }, [user, data?.members]);

  // Multi-team scope: all team codes the user belongs to. For admins/clients
  // this is null (no scope). Falls back to single team_code for legacy.
  //
  // 2026-09-17 — ЭЗНИЙ ШИЙДВЭР: ажилтан төслийн БҮХ ажлыг харна.  Багийн
  // угтвараар шүүдэг «privacy scope» нь ажилтныг өөрийн ажлаа олохгүй байх,
  // бусад багийн ажил «заримдаа алга болох» гэсэн хоёр гомдол төрүүлж
  // байсан тул унтраав: `scopeTeamCodes` үргэлж null → `isScopedUser` false →
  // бүх таб, бүх блок, «Бүгд» таб хүн бүрд.  `scopeTeamCode` (дээр) ХЭВЭЭР —
  // зөвхөн анхны таб/pill-ийг өөрийн баг руу чиглүүлэхэд хэрэглэгдэнэ.
  // Буцаах бол git түүхээс энэ memo-гийн хуучин биеийг сэргээнэ.
  const scopeTeamCodes = useMemo<Set<string> | null>(() => null, []);

  const isScopedUser = scopeTeamCodes !== null;

  return {
    user,
    queryClient,
    projectKey,
    data,
    setData,
    loading,
    error,
    refetch: projectQuery.refetch,
    reload,
    scopeTeamCode,
    scopeTeamCodes,
    isScopedUser,
  };
}
