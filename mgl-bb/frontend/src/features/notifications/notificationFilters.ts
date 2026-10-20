import type { AppNotification } from '@/shared/types';
import { matchesCategory, type UiCategory } from './notificationCategories';

export type NotificationStatus = 'all' | 'unread' | 'read';
export type NotificationSort = 'newest' | 'oldest' | 'unread_first';

export const NOTIFICATION_STATUSES = ['all', 'unread', 'read'] as const;
export const NOTIFICATION_SORTS = ['newest', 'oldest', 'unread_first'] as const;

export function parseCreatedAt(iso: string): Date {
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

export function isToday(iso: string): boolean {
  const d = parseCreatedAt(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function matchesSearch(n: AppNotification, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = `${n.title} ${n.body ?? ''}`.toLowerCase();
  return hay.includes(needle);
}

function matchesStatus(n: AppNotification, status: NotificationStatus): boolean {
  if (status === 'unread') return !n.read;
  if (status === 'read') return !!n.read;
  return true;
}

function sortItems(items: AppNotification[], sort: NotificationSort): AppNotification[] {
  const copy = [...items];
  if (sort === 'oldest') {
    copy.sort((a, b) => parseCreatedAt(a.created_at).getTime() - parseCreatedAt(b.created_at).getTime());
  } else if (sort === 'unread_first') {
    copy.sort((a, b) => {
      if (a.read !== b.read) return a.read - b.read;
      return parseCreatedAt(b.created_at).getTime() - parseCreatedAt(a.created_at).getTime();
    });
  } else {
    copy.sort((a, b) => parseCreatedAt(b.created_at).getTime() - parseCreatedAt(a.created_at).getTime());
  }
  return copy;
}

export function applyNotificationFilters(
  items: AppNotification[],
  opts: { q: string; status: NotificationStatus; category: UiCategory; sort: NotificationSort },
): AppNotification[] {
  const out = items.filter(
    (n) => matchesSearch(n, opts.q) && matchesStatus(n, opts.status) && matchesCategory(n.type, opts.category),
  );
  return sortItems(out, opts.sort);
}

export function groupByDay(items: AppNotification[]): { today: AppNotification[]; earlier: AppNotification[] } {
  const today: AppNotification[] = [];
  const earlier: AppNotification[] = [];
  for (const n of items) (isToday(n.created_at) ? today : earlier).push(n);
  return { today, earlier };
}
