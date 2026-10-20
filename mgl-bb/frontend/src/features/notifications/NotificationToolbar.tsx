import { Search } from 'lucide-react';
import { Input } from '@/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { NotificationCategoryChips } from './NotificationCategoryChips';
import {
  NOTIFICATION_SORTS,
  NOTIFICATION_STATUSES,
  type NotificationSort,
  type NotificationStatus,
} from './notificationFilters';
import type { UiCategory } from './notificationCategories';

const SORT_I18N: Record<NotificationSort, string> = {
  newest: 'notifications.sortNewest',
  oldest: 'notifications.sortOldest',
  unread_first: 'notifications.sortUnreadFirst',
};

type Props = {
  q: string;
  onQChange: (q: string) => void;
  status: NotificationStatus;
  onStatusChange: (s: NotificationStatus) => void;
  sort: NotificationSort;
  onSortChange: (s: NotificationSort) => void;
  category: UiCategory;
  onCategoryChange: (c: UiCategory) => void;
};

export function NotificationToolbar({
  q,
  onQChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  category,
  onCategoryChange,
}: Props) {
  const { t } = useLanguage();

  const statusLabel = (s: NotificationStatus) => {
    if (s === 'unread') return t('notifications.filterUnread');
    if (s === 'read') return t('notifications.filterRead');
    return t('notifications.filterAll');
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => onQChange(e.target.value)}
          placeholder={t('notifications.searchPlaceholder')}
          className="pl-9"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label={t('notifications.statusFilter')}
          className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
        >
          {NOTIFICATION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => onStatusChange(s)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                status === s
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">{t('notifications.sortLabel')}</span>
          <Select value={sort} onValueChange={(v) => onSortChange(v as NotificationSort)}>
            <SelectTrigger size="sm" className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTIFICATION_SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(SORT_I18N[s])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <NotificationCategoryChips value={category} onChange={onCategoryChange} />
    </div>
  );
}
