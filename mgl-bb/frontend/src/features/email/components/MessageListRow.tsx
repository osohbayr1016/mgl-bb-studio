import { Paperclip, Trash2, Mail, MailOpen, Tag } from 'lucide-react';
import { Checkbox } from '@/ui/checkbox';
import { cn } from '@/shared/lib/utils';
import { formatDate } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import type { EmailThreadListItem } from '@/features/email/types/email';
import { SenderAvatar } from './SenderAvatar';
import { participantNames } from './senderName';

/** One conversation row in the middle list pane (Gmail-style). */
export function MessageListRow({
  item,
  active,
  checked,
  selecting,
  onOpen,
  onToggleCheck,
  onToggleRead,
  onDelete,
}: {
  item: EmailThreadListItem;
  active: boolean;
  checked: boolean;
  /** Any row selected → keep every checkbox visible. */
  selecting: boolean;
  onOpen: () => void;
  onToggleCheck: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const unread = item.unread_count > 0;
  const names = participantNames(item.participants_raw);
  const primary = names[0] || item.latest_from || item.account_address;
  const label =
    names.length > 1 ? `${primary} +${names.length - 1}` : primary;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group relative flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2.5 transition-colors',
        active ? 'bg-primary/10' : unread ? 'bg-card hover:bg-muted/50' : 'hover:bg-muted/40',
      )}
    >
      {/* unread rail */}
      <span
        className={cn(
          'absolute left-0 top-0 h-full w-0.5',
          unread ? 'bg-primary' : 'bg-transparent',
        )}
        aria-hidden="true"
      />

      {/* checkbox (hover / when selecting) overlapping the avatar */}
      <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
        <div
          className={cn(
            'transition-opacity',
            checked || selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <Checkbox
            checked={checked}
            onCheckedChange={onToggleCheck}
            aria-label={t('mailInbox.selectRow')}
          />
        </div>
        {!checked && !selecting && (
          <div className="absolute inset-0 opacity-100 group-hover:opacity-0 pointer-events-none">
            <SenderAvatar name={primary} size="sm" />
          </div>
        )}
      </div>

      {/* middle: sender + subject + snippet */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'truncate text-sm',
              unread ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
          {item.message_count > 1 && (
            <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
              {item.message_count}
            </span>
          )}
          {item.all_triaged === 1 && (
            <Tag className="h-3 w-3 shrink-0 text-success" aria-label={t('mailTriagePage.triaged')} />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-xs',
              unread ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {item.latest_subject || t('mailTriagePage.noSubject')}
          </span>
          {item.latest_snippet && (
            <span className="truncate text-xs text-muted-foreground">
              — {item.latest_snippet}
            </span>
          )}
        </div>
      </div>

      {/* right: attachment + date, replaced by hover actions */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-col items-end gap-1 text-micro text-muted-foreground group-hover:invisible">
          <span className="tabular-nums">
            {item.latest_date ? formatDate(new Date(item.latest_date)) : ''}
          </span>
          <div className="flex items-center gap-1.5">
            {item.account_count > 1 && (
              <span className="rounded bg-muted px-1 text-micro">{item.account_count}📮</span>
            )}
            {item.has_attachments === 1 && <Paperclip className="h-3 w-3" />}
          </div>
        </div>

        {/* hover quick-actions */}
        <div
          className="absolute right-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onToggleRead}
            title={unread ? t('mailInbox.markRead') : t('mailInbox.markUnread')}
            aria-label={unread ? t('mailInbox.markRead') : t('mailInbox.markUnread')}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            title={t('mailTriagePage.deleteAppOnlyTitle')}
            aria-label={t('mailTriagePage.deleteMessageAria')}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
