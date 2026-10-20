/**
 * Loads the messages of the selected conversation.  Real Gmail threads come
 * from /email/threads/:id; NULL-thread singletons fall back to
 * /email/messages/:id.  Centralised here so the reading pane can both render
 * the stack and build reply/forward drafts from the latest message.
 */
import { useApiQuery } from '@/shared/api/useApi';
import type {
  EmailAttachment,
  EmailMessageDetail,
  EmailThreadListItem,
  ThreadDetailResponse,
} from '../types/email';

export function useThreadMessages(item: EmailThreadListItem | null) {
  const isThread = !!item?.thread_id;

  // NOTE: key is '/email/thread' (singular) on purpose — it must NOT share a
  // prefix with the thread LIST key ('/email/threads', …), or setQueriesData
  // patches on the list would also hit this differently-shaped detail payload.
  const threadQ = useApiQuery<ThreadDetailResponse>(
    ['/email/thread', item?.thread_id],
    `/email/threads/${encodeURIComponent(item?.thread_id ?? '')}`,
    { enabled: !!item && isThread },
  );
  const msgQ = useApiQuery<{ message: EmailMessageDetail; attachments: EmailAttachment[] }>(
    ['/email/messages', item?.latest_message_id],
    `/email/messages/${item?.latest_message_id ?? 0}`,
    { enabled: !!item && !isThread },
  );

  const messages: EmailMessageDetail[] = isThread
    ? (threadQ.data?.messages ?? [])
    : msgQ.data
      ? [msgQ.data.message]
      : [];
  const attachments: Record<number, EmailAttachment[]> = isThread
    ? (threadQ.data?.attachments ?? {})
    : msgQ.data
      ? { [msgQ.data.message.id]: msgQ.data.attachments }
      : {};
  const isLoading = !item ? false : isThread ? threadQ.isLoading : msgQ.isLoading;

  return { messages, attachments, isLoading };
}
