import type { AppNotification } from '@/shared/types';
import { useLanguage } from '@/shared/i18n';
import { NotificationRow } from './NotificationRow';

type Props = {
  items: AppNotification[];
  grouped?: { today: AppNotification[]; earlier: AppNotification[] };
  onItemClick: (item: AppNotification) => void;
};

export function NotificationList({ items, grouped, onItemClick }: Props) {
  const { t } = useLanguage();

  if (grouped) {
    return (
      <div className="space-y-5">
        {grouped.today.length > 0 && (
          <section className="space-y-1.5">
            <h2 className="px-1 text-label font-medium text-muted-foreground">{t('notifications.today')}</h2>
            {grouped.today.map((n) => (
              <NotificationRow key={n.id} item={n} onClick={onItemClick} />
            ))}
          </section>
        )}
        {grouped.earlier.length > 0 && (
          <section className="space-y-1.5">
            <h2 className="px-1 text-label font-medium text-muted-foreground">{t('notifications.earlier')}</h2>
            {grouped.earlier.map((n) => (
              <NotificationRow key={n.id} item={n} onClick={onItemClick} />
            ))}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((n) => (
        <NotificationRow key={n.id} item={n} onClick={onItemClick} />
      ))}
    </div>
  );
}
