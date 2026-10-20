import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import type { AppNotification } from '@/shared/types';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { usePushSubscription } from '@/shared/hooks/usePushSubscription';
import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/shared/api/notifications';
import { NOTIFICATION_UI_CATEGORIES } from './notificationCategories';
import {
  NOTIFICATION_SORTS,
  NOTIFICATION_STATUSES,
  applyNotificationFilters,
  groupByDay,
} from './notificationFilters';
import { NotificationToolbar } from './NotificationToolbar';
import { NotificationList } from './NotificationList';

const PAGE_LIMIT = 100;

/** Push асаах компакт мөр — зөвхөн `default` төлөвт харагдана. */
function PushEnableRow() {
  const { t } = useLanguage();
  const { state, busy, subscribe } = usePushSubscription();
  if (state !== 'default') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{t('notifications.pushEnableTitle')}</div>
        <div className="text-xs text-muted-foreground">{t('notifications.pushEnableBody')}</div>
      </div>
      <Button size="sm" disabled={busy} onClick={() => void subscribe()}>
        {t('notifications.pushEnableAction')}
      </Button>
    </div>
  );
}

export default function NotificationsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [status, setStatus] = useTabParam(NOTIFICATION_STATUSES, 'all', 'status');
  const [category, setCategory] = useTabParam(NOTIFICATION_UI_CATEGORIES, 'all', 'category');
  const [sort, setSort] = useTabParam(NOTIFICATION_SORTS, 'newest', 'sort');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q), 200);
    return () => window.clearTimeout(id);
  }, [q]);

  const { data, isLoading } = useNotifications(PAGE_LIMIT);
  const { data: unreadData } = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = unreadData?.count ?? 0;
  const all = useMemo(() => data?.notifications ?? [], [data]);
  const items = useMemo(
    () => applyNotificationFilters(all, { q: debouncedQ, status, category, sort }),
    [all, debouncedQ, status, category, sort],
  );
  const grouped = useMemo(
    () => (sort === 'newest' ? groupByDay(items) : null),
    [items, sort],
  );

  const hasActiveFilter =
    status !== 'all' || category !== 'all' || sort !== 'newest' || debouncedQ.trim().length > 0;

  const emptyTitle = (() => {
    if (debouncedQ.trim()) return t('notifications.emptySearch', { q: debouncedQ.trim() });
    if (hasActiveFilter) return t('notifications.emptyFilter');
    return t('notifications.empty');
  })();

  const handleClick = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('notifications.title')}
        icon={Bell}
        description={
          unread === 0 ? t('notifications.allCaughtUp') : t('notifications.unreadCount', { count: unread })
        }
        actions={
          unread > 0 ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => markAll.mutate()}>
              <CheckCheck className="h-4 w-4" />
              {t('notifications.markAllRead')}
            </Button>
          ) : undefined
        }
      />

      <PushEnableRow />

      <NotificationToolbar
        q={q}
        onQChange={setQ}
        status={status}
        onStatusChange={setStatus}
        sort={sort}
        onSortChange={setSort}
        category={category}
        onCategoryChange={setCategory}
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title={emptyTitle} />
      ) : (
        <NotificationList items={items} grouped={grouped ?? undefined} onItemClick={handleClick} />
      )}
    </div>
  );
}
