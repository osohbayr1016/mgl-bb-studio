import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Inbox, ArrowRight } from 'lucide-react';
import type { AppNotification } from '@/shared/types';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatTimeAgo } from '@/shared/lib/formatting';
import { iconFor } from '@/features/notifications/notificationIcons';
import {
  useUnreadCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/shared/api/notifications';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t, lang } = useLanguage();

  const { data: unreadData } = useUnreadCount();
  // Жагсаалтыг зөвхөн popover нээгдэх үед татна (badge нь тусдаа poll-тэй).
  const { data: listData } = useNotifications(20, open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = unreadData?.count ?? 0;
  const items = listData?.notifications ?? [];

  const handleClick = (n: AppNotification) => {
    setOpen(false);
    if (!n.read) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'relative h-8 w-8 flex items-center justify-center rounded-lg',
            'text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
          )}
          aria-label={
            unread > 0 ? t('notifications.titleWithCount', { count: unread }) : t('notifications.title')
          }
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1
              bg-destructive text-destructive-foreground text-[10px] font-semibold
              rounded-full flex items-center justify-center border-2 border-chrome"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* 380px тогтмол өргөн нь 360px дэлгэцээс халина — доод хязгаарыг viewport-оос авна. */}
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[calc(100vw-2rem)] sm:w-[380px] p-0"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="font-semibold text-sm">{t('notifications.title')}</div>
            <div className="text-[11px] text-muted-foreground">
              {unread === 0
                ? t('notifications.allCaughtUp')
                : t('notifications.unreadCount', { count: unread })}
            </div>
          </div>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t('notifications.markAllRead')}
            </Button>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto overflow-x-hidden">
          {items.length === 0 ? (
            <div className="py-10 px-4 text-center text-muted-foreground">
              <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <div className="text-sm">{t('notifications.empty')}</div>
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  'w-full text-left flex items-start gap-3 px-4 py-3 border-b border-border/60',
                  'hover:bg-accent/40 transition-colors',
                  !n.read && 'bg-primary/5',
                )}
              >
                <div className="mt-0.5">{iconFor(n.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <div className="font-medium text-sm flex-1 min-w-0 break-words">{n.title}</div>
                    {!n.read && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                    )}
                  </div>
                  {n.body && (
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {n.body}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground/80 uppercase tracking-wider mt-1">
                    {formatTimeAgo(n.created_at, lang)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <button
          onClick={() => {
            setOpen(false);
            navigate('/app/notifications');
          }}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border-t border-border"
        >
          {t('notifications.viewAll')}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </PopoverContent>
    </Popover>
  );
}
