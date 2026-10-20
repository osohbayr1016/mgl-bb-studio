import { useState } from 'react';
import {
  Tag,
  Trash2,
  X,
  CornerUpLeft,
  CornerUpRight,
  ReplyAll,
  Mail,
  MoreHorizontal,
  Printer,
  Code2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import type { ComposeDraft, EmailThreadListItem } from '@/features/email/types/email';
import { getRawSource } from '@/features/email/api/email';
import { useThreadMessages } from '../hooks/useThreadMessages';
import { buildReplyDraft, type ReplyMode } from '../lib/replyDraft';
import { ThreadView } from './ThreadView';
import { participantNames } from './senderName';

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

/** Right pane — reads the selected conversation and hosts its actions
 *  (reply / reply-all / forward, classify, print, show source, delete). */
export function ReadingPane({
  item,
  onClassify,
  onCompose,
  onDelete,
  onClose,
}: {
  item: EmailThreadListItem | null;
  onClassify: (messageId: number) => void;
  onCompose: (draft: ComposeDraft) => void;
  onDelete: (item: EmailThreadListItem) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { messages, attachments, isLoading } = useThreadMessages(item);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Mail className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-foreground">{t('mailInbox.emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('mailInbox.emptyDescription')}</p>
        </div>
      </div>
    );
  }

  const names = participantNames(item.participants_raw);
  const latest = messages.length > 0 ? messages[messages.length - 1] : null;

  const doReply = (mode: ReplyMode) => {
    if (!latest) return;
    onCompose(buildReplyDraft(latest, mode, item.account_address));
  };

  /** Print the conversation via a clean popup (synchronous → not blocked). */
  const printThread = () => {
    const win = window.open('', '_blank', 'width=820,height=900');
    if (!win) {
      toast.error(t('mailInbox.popupBlocked'));
      return;
    }
    const parts = messages
      .map(
        (m) => `<section>
        <h2>${esc(m.subject ?? '')}</h2>
        <div class="meta">
          <div><b>From:</b> ${esc(m.from_addr ?? '')}</div>
          <div><b>To:</b> ${esc(m.to_addrs ?? '')}</div>
          ${m.cc_addrs ? `<div><b>Cc:</b> ${esc(m.cc_addrs)}</div>` : ''}
          <div><b>Date:</b> ${esc(m.internal_date ?? '')}</div>
        </div>
        <pre>${esc(m.body_text ?? '')}</pre>
      </section>`,
      )
      .join('<hr>');
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(
        item.latest_subject ?? 'Mail',
      )}</title><style>
        body{font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;color:#111}
        h2{font-size:16px;margin:0 0 8px}
        .meta{font-size:12px;color:#555;margin-bottom:10px}
        pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:0}
        hr{margin:24px 0;border:0;border-top:1px solid #ddd}
      </style></head><body>${parts}</body></html>`,
    );
    win.document.close();
    win.focus();
    win.print();
  };

  const showSource = async () => {
    if (!latest) return;
    setSourceOpen(true);
    setSourceLoading(true);
    setSource(null);
    try {
      setSource(await getRawSource(latest.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('mailInbox.sourceFailed'));
      setSourceOpen(false);
    } finally {
      setSourceLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/60 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">
              {item.latest_subject || t('mailTriagePage.noSubject')}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {names.join(', ') || item.latest_from}
              {item.message_count > 1 &&
                ` · ${t('mailInbox.threadCount', { count: item.message_count })}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={!latest} onClick={() => doReply('reply')}>
            <CornerUpLeft className="h-3.5 w-3.5" /> {t('mailInbox.reply')}
          </Button>
          <Button size="sm" variant="outline" disabled={!latest} onClick={() => doReply('replyAll')}>
            <ReplyAll className="h-3.5 w-3.5" /> {t('mailInbox.replyAll')}
          </Button>
          <Button size="sm" variant="outline" disabled={!latest} onClick={() => doReply('forward')}>
            <CornerUpRight className="h-3.5 w-3.5" /> {t('mailInbox.forward')}
          </Button>
          <Button size="sm" onClick={() => onClassify(item.latest_message_id)}>
            <Tag className="h-3.5 w-3.5" /> {t('mailInbox.classify')}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={t('mailInbox.more')}>
                <MoreHorizontal className="h-4 w-4" /> {t('mailInbox.more')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={printThread} disabled={messages.length === 0}>
                <Printer className="h-4 w-4" /> {t('mailInbox.print')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={showSource} disabled={!latest}>
                <Code2 className="h-4 w-4" /> {t('mailInbox.showSource')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(item)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" /> {t('mailInbox.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Thread body */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <ThreadView
          threadKey={item.thread_key}
          messages={messages}
          attachments={attachments}
          isLoading={isLoading}
        />
      </div>

      {/* Show source */}
      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="h-5 w-5 text-primary" /> {t('mailInbox.showSource')}
            </DialogTitle>
          </DialogHeader>
          {sourceLoading ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            </div>
          ) : (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/60 bg-muted/30 p-3 font-mono text-[11px]">
              {source ?? ''}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
