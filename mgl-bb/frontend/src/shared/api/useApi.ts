import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
} from '@tanstack/react-query';
import { apiFetch, type ApiError } from '@/shared/api/client';

/**
 * Thin wrapper around `useQuery` + `apiFetch` that keeps existing call
 * sites trivial to migrate.  The endpoint string doubles as the default
 * cache key, which gives request-level dedup, focus refetch, and
 * stale-while-revalidate without anyone needing to learn TanStack Query.
 *
 * For list filters that should bust the cache, callers can pass an
 * extra `key` array; otherwise just pass the endpoint and we use it.
 *
 *   const { data } = useApiQuery<{ projects: Project[] }>('/projects');
 *   const { data } = useApiQuery(['/dashboard', date], `/dashboard?date=${date}`);
 */
export function useApiQuery<T>(
  endpoint: string,
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>,
): ReturnType<typeof useQuery<T, ApiError>>;
export function useApiQuery<T>(
  key: QueryKey,
  endpoint: string,
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>,
): ReturnType<typeof useQuery<T, ApiError>>;
export function useApiQuery<T>(
  keyOrEndpoint: QueryKey | string,
  endpointOrOptions?: string | Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>,
  maybeOptions?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>,
) {
  let queryKey: QueryKey;
  let endpoint: string;
  let options: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'> | undefined;

  if (typeof keyOrEndpoint === 'string') {
    endpoint = keyOrEndpoint;
    queryKey = [endpoint];
    options = endpointOrOptions as typeof options;
  } else {
    queryKey = keyOrEndpoint;
    endpoint = endpointOrOptions as string;
    options = maybeOptions;
  }

  return useQuery<T, ApiError>({
    queryKey,
    queryFn: () => apiFetch<T>(endpoint),
    ...options,
  });
}

/**
 * Wrapper for mutations.  Supply the endpoint + method; the mutation
 * variables become the JSON body.  Use `onSuccess` from
 * `useMutationOptions` to invalidate query keys after the write.
 */
export function useApiMutation<TData, TVariables = void>(
  endpoint: string | ((vars: TVariables) => string),
  init?: { method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' },
  options?: Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'>,
) {
  const method = init?.method ?? 'POST';
  return useMutation<TData, ApiError, TVariables>({
    mutationFn: (vars) => {
      const path = typeof endpoint === 'function' ? endpoint(vars) : endpoint;
      const hasBody = vars !== undefined && method !== 'DELETE';
      return apiFetch<TData>(path, {
        method,
        ...(hasBody ? { data: vars } : {}),
      });
    },
    ...options,
  });
}
