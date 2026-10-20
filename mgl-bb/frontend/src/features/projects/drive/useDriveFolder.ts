/**
 * Нэг хавтасны агуулга — хуудаслалттай (Drive-ын `nextPageToken`).
 *
 * `staleTime` 30 сек: хавтас солиод буцаж ирэхэд дахин татахгүй (§11 —
 * давхар хүсэлт үгүй), харин таб дахин нээгдэх / «Шинэчлэх» товч нь
 * `refresh=1`-ээр серверийн кэшийг ч тойрч Drive-аас шинээр авна (§8).
 * Drive-ын үнэн энд хэзээ ч «хуучирсан» гэж дарагдахгүй — кэш нь зөвхөн
 * унших давхардлыг багасгана.
 */
import { useCallback, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import {
  driveFolderKey,
  driveStatusKey,
  fetchDriveFolder,
  fetchDriveStatus,
} from './api';
import type { DriveFolderPage, DriveItem, DriveScope, DriveStatus } from './types';

const STALE_MS = 30_000;

export function useDriveStatus(scope: DriveScope, id: number, enabled = true) {
  return useQuery<DriveStatus, ApiError>({
    queryKey: driveStatusKey(scope, id),
    queryFn: () => fetchDriveStatus(scope, id),
    enabled,
    staleTime: STALE_MS,
    retry: false,
  });
}

/** Тохиргооны алдаа (холбогдоогүй, эрхгүй, буруу id) давтаад ялгаагүй. */
function shouldRetry(count: number, err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 429 ? count < 2 : false;
  }
  return count < 2;
}

export function useDriveFolder(scope: DriveScope, id: number, folderId: string, enabled = true) {
  const key = driveFolderKey(scope, id, folderId);
  // «Шинэчлэх» дарсан үед л `refresh=1` явуулна — энгийн refetch (фокус,
  // staleTime) нь серверийн 30 сек кэшийг ашиглана.
  const bypassRef = useRef(false);

  const query = useInfiniteQuery<DriveFolderPage, ApiError, { pages: DriveFolderPage[] }, typeof key, string | null>({
    queryKey: key,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      fetchDriveFolder(scope, id, folderId, { pageToken: pageParam, refresh: bypassRef.current }),
    getNextPageParam: (last) => last.next_page_token,
    enabled,
    staleTime: STALE_MS,
    retry: shouldRetry,
  });

  /** «Шинэчлэх»: серверийн кэшийг тойрч Drive-аас ШИНЭЭР.  Infinite query-ийн
   *  `refetch` нь ачаалсан хуудсуудаа ЭХНЭЭС нь дарааллаар дахин уншдаг тул
   *  2-р хуудасны токен нь шинэ 1-р хуудаснаас гарна — хуучин токен хэзээ ч
   *  дахин ашиглагдахгүй. */
  const { refetch } = query;
  const refresh = useCallback(async () => {
    bypassRef.current = true;
    try {
      await refetch();
    } finally {
      bypassRef.current = false;
    }
  }, [refetch]);

  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const items: DriveItem[] = pages.flatMap((p) => p.items);

  return {
    query,
    first,
    items,
    refresh,
    isRefreshing: query.isRefetching && !query.isFetchingNextPage,
  };
}
