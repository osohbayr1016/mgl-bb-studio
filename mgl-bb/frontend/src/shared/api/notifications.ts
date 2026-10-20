import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import type { AppNotification } from '@/shared/types';

/**
 * Мэдэгдлийн нэгдсэн query давхарга.
 *
 * Урьд нь `NotificationBell` өөрөө `setInterval` + `apiFetch`-аар татдаг
 * байсан тул толгойн bell ба доод navbar-ын badge хоёр өөр эх сурвалжтай
 * болох байсан.  Одоо хоёулаа энэ hook-оос уншина.
 *
 * TanStack-ийн `refetchIntervalInBackground` өгөгдмөл нь `false` тул нуугдсан
 * таб дээр 60 секундын poll автоматаар зогсоно — утсан дээр батарей хэмнэнэ
 * (өмнөх `setInterval` нь зогсдоггүй байсан).
 */
export const NOTIF_UNREAD_KEY = ['/notifications/unread-count'] as const;
export const NOTIF_LIST_KEY = ['/notifications'] as const;

const POLL_MS = 60_000;

export function useUnreadCount() {
  const { user } = useAuth();
  return useApiQuery<{ count: number }>(NOTIF_UNREAD_KEY, '/notifications/unread-count', {
    enabled: !!user,
    refetchInterval: POLL_MS,
    staleTime: 30_000,
  });
}

/** `limit` серверт 100-аар таслагддаг (routes/notifications.ts). */
export function useNotifications(limit = 30, enabled = true) {
  const { user } = useAuth();
  return useApiQuery<{ notifications: AppNotification[] }>(
    [...NOTIF_LIST_KEY, limit],
    `/notifications?limit=${limit}`,
    { enabled: enabled && !!user },
  );
}

/** Bell + хуудас хоёулангийнх нь кэшийг зэрэг шинэчилнэ. */
export function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: NOTIF_UNREAD_KEY });
    void qc.invalidateQueries({ queryKey: NOTIF_LIST_KEY });
  };
}

function patchCaches(
  qc: ReturnType<typeof useQueryClient>,
  update: (n: AppNotification) => AppNotification,
  unread: (prev: number) => number,
) {
  qc.setQueriesData<{ notifications: AppNotification[] }>(
    { queryKey: NOTIF_LIST_KEY },
    (old) => (old ? { ...old, notifications: old.notifications.map(update) } : old),
  );
  qc.setQueryData<{ count: number }>(NOTIF_UNREAD_KEY, (old) =>
    old ? { count: Math.max(0, unread(old.count)) } : old,
  );
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useApiMutation<{ success?: boolean }, number>(
    (id) => `/notifications/${id}/read`,
    { method: 'POST' },
    {
      onMutate: (id) => {
        patchCaches(
          qc,
          (n) => (n.id === id ? { ...n, read: 1 } : n),
          (c) => c - 1,
        );
      },
      onSettled: () => {
        void qc.invalidateQueries({ queryKey: NOTIF_UNREAD_KEY });
        void qc.invalidateQueries({ queryKey: NOTIF_LIST_KEY });
      },
    },
  );
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useApiMutation<{ success?: boolean }, void>(
    '/notifications/read-all',
    { method: 'POST' },
    {
      onMutate: () => {
        patchCaches(
          qc,
          (n) => ({ ...n, read: 1 }),
          () => 0,
        );
      },
      onSettled: () => {
        void qc.invalidateQueries({ queryKey: NOTIF_UNREAD_KEY });
        void qc.invalidateQueries({ queryKey: NOTIF_LIST_KEY });
      },
    },
  );
}
