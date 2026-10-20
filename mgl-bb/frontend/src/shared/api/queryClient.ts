import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';

// Centralised TanStack Query client. Defaults are tuned for an
// internal admin app where:
//   • the data is small and changes infrequently between navigations
//     (so a generous staleTime is a big win for back/forward navigation),
//   • but the user does want fresh-on-focus when they come back from a
//     long break — refetchOnWindowFocus stays on for that reason.
//   • 401s from `apiFetch` mean the session expired; there's no point
//     retrying those, so we short-circuit retry for 4xx ApiErrors.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 2026-09-11 (D1 аудит): 30 → 60 сек.  `refetchOnWindowFocus` нь таб
      // солих БҮРД staleTime-аас хуучирсан бүх идэвхтэй query-г дахин татдаг
      // (dashboard = 4 query, тэдний нэг нь 47 000 D1 мөр).  60 сек нь
      // серверийн edge cache TTL-тэй тааруулсан утга.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
