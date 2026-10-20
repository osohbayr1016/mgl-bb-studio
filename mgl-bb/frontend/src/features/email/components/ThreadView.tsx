import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { EmailAttachment, EmailMessageDetail } from '@/features/email/types/email';
import { useLanguage } from '@/shared/i18n';
import { ThreadMessage } from './ThreadMessage';

/** The stacked conversation in the reading pane.  Presentational — the parent
 *  (ReadingPane) owns the data via useThreadMessages so it can also build
 *  reply/forward drafts and print. */
export function ThreadView({
  threadKey,
  messages,
  attachments,
  isLoading,
}: {
  /** Changes when a different conversation is opened → re-computes what's expanded. */
  threadKey: string;
  messages: EmailMessageDetail[];
  attachments: Record<number, EmailAttachment[]>;
  isLoading: boolean;
}) {
  const { t } = useLanguage();

  // Expand the latest message + any unread ones (once per opened thread).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const keyRef = useRef<string | null>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    if (keyRef.current === threadKey) return;
    keyRef.current = threadKey;
    const next = new Set<number>();
    const last = messages[messages.length - 1];
    if (last) next.add(last.id);
    for (const m of messages) if (m.is_read === 0) next.add(m.id);
    setExpanded(next);
  }, [threadKey, messages]);

  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isLoading) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {t('mailInbox.noMessages')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <ThreadMessage
          key={m.id}
          message={m}
          attachments={attachments[m.id] ?? []}
          expanded={expanded.has(m.id)}
          onToggle={() => toggle(m.id)}
        />
      ))}
    </div>
  );
}
