import { Mail, MailOpen, Trash2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';

/** Toolbar shown in the list header when one or more conversations are selected. */
export function BulkActionBar({
  count,
  onMarkRead,
  onMarkUnread,
  onDelete,
  onClear,
}: {
  count: number;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-xs font-medium tabular-nums text-muted-foreground">
        {t('mailInbox.selectedCount', { count })}
      </span>
      <Button size="sm" variant="ghost" className="h-8" onClick={onMarkRead}>
        <MailOpen className="h-4 w-4" /> {t('mailInbox.markRead')}
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onMarkUnread}>
        <Mail className="h-4 w-4" /> {t('mailInbox.markUnread')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" /> {t('mailInbox.delete')}
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onClear} aria-label={t('mailInbox.clear')}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
