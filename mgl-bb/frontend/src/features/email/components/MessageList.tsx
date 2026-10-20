import { Search, Loader2, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { EmptyState } from '@/shared/components/EmptyState';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { EmailThreadListItem } from '@/features/email/types/email';
import { MessageListRow } from './MessageListRow';
import { BulkActionBar } from './BulkActionBar';

export function MessageList({
  items,
  isLoading,
  isFetching,
  total,
  page,
  totalPages,
  selectedThreadKey,
  checkedKeys,
  search,
  hasAccounts,
  onSearch,
  onOpen,
  onToggleCheck,
  onToggleRead,
  onDeleteThread,
  onToggleAll,
  onBulkRead,
  onBulkUnread,
  onBulkDelete,
  onClearSelection,
  onPage,
}: {
  items: EmailThreadListItem[];
  isLoading: boolean;
  isFetching: boolean;
  total: number;
  page: number;
  totalPages: number;
  selectedThreadKey: string | null;
  checkedKeys: Set<string>;
  search: string;
  hasAccounts: boolean;
  onSearch: (v: string) => void;
  onOpen: (item: EmailThreadListItem) => void;
  onToggleCheck: (item: EmailThreadListItem) => void;
  onToggleRead: (item: EmailThreadListItem) => void;
  onDeleteThread: (item: EmailThreadListItem) => void;
  onToggleAll: () => void;
  onBulkRead: () => void;
  onBulkUnread: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  onPage: (p: number) => void;
}) {
  const { t } = useLanguage();
  const selectedCount = checkedKeys.size;
  const allChecked = items.length > 0 && items.every((i) => checkedKeys.has(i.thread_key));
  const someChecked = selectedCount > 0 && !allChecked;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Checkbox
          checked={allChecked ? true : someChecked ? 'indeterminate' : false}
          onCheckedChange={onToggleAll}
          aria-label={t('mailInbox.selectAll')}
        />
        {selectedCount > 0 ? (
          <BulkActionBar
            count={selectedCount}
            onMarkRead={onBulkRead}
            onMarkUnread={onBulkUnread}
            onDelete={onBulkDelete}
            onClear={onClearSelection}
          />
        ) : (
          <>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={t('mailTriagePage.searchPlaceholder')}
                className="h-8 pl-8 text-xs"
              />
            </div>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </>
        )}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-px p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-2.5">
                <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t('mailTriagePage.noMail')}
            description={
              hasAccounts ? t('mailTriagePage.syncToSeeHint') : t('mailTriagePage.noAccountsHint')
            }
          />
        ) : (
          items.map((item) => (
            <MessageListRow
              key={item.thread_key}
              item={item}
              active={selectedThreadKey === item.thread_key}
              checked={checkedKeys.has(item.thread_key)}
              selecting={selectedCount > 0}
              onOpen={() => onOpen(item)}
              onToggleCheck={() => onToggleCheck(item)}
              onToggleRead={() => onToggleRead(item)}
              onDelete={() => onDeleteThread(item)}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {total > 0 && totalPages > 1 && (
        <div
          className={cn(
            'flex h-11 shrink-0 items-center justify-between gap-2 border-t border-border/60 px-3',
            'text-xs text-muted-foreground',
          )}
        >
          <span className="tabular-nums">{total}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1 || isFetching}
              onClick={() => onPage(Math.max(1, page - 1))}
              aria-label={t('common.prev')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages || isFetching}
              onClick={() => onPage(Math.min(totalPages, page + 1))}
              aria-label={t('common.next')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
