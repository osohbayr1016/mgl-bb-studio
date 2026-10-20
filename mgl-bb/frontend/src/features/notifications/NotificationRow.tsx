import type { AppNotification } from '@/shared/types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatTimeAgo } from '@/shared/lib/formatting';
import { iconFor } from '@/features/notifications/notificationIcons';

type Props = {
  item: AppNotification;
  onClick: (item: AppNotification) => void;
};

export function NotificationRow({ item, onClick }: Props) {
  const { lang } = useLanguage();

  return (
    <button
      onClick={() => onClick(item)}
      className={cn(
        'w-full text-left flex items-start gap-3 px-4 py-3.5 min-h-16 rounded-lg border transition-colors',
        'active:bg-accent/60 hover:bg-accent/40',
        item.read ? 'border-transparent' : 'border-primary/20 bg-primary/5',
      )}
    >
      <div className="mt-0.5 shrink-0">{iconFor(item.type)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <div className="font-medium text-sm flex-1 min-w-0">{item.title}</div>
          {!item.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
        </div>
        {item.body && <div className="text-xs text-muted-foreground mt-1">{item.body}</div>}
        <div className="text-label text-muted-foreground mt-1.5">
          {formatTimeAgo(item.created_at, lang)}
        </div>
      </div>
    </button>
  );
}
