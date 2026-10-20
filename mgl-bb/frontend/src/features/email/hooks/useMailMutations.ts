/**
 * Mutations for the Gmail-style inbox — mark read/unread and (soft) delete,
 * operating on whole threads.  Each optimistically patches every cached
 * `/email/threads` list (via setQueriesData, robust to the dynamic filter
 * keys) and reconciles on settle by invalidating.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { bulkMarkRead, bulkDeleteMessages } from '@/features/email/api/email';
import type { EmailThreadListItem, ThreadListResponse } from '@/features/email/types/email';
import { toast } from '@/shared/components/Toast';

/** Split selected threads into real thread_ids + singleton message ids. */
function splitThreads(items: EmailThreadListItem[]): { ids: number[]; thread_ids: string[] } {
  const ids: number[] = [];
  const thread_ids: string[] = [];
  for (const it of items) {
    if (it.thread_id) thread_ids.push(it.thread_id);
    else ids.push(it.latest_message_id);
  }
  return { ids, thread_ids };
}

export function useMailMutations() {
  const qc = useQueryClient();

  const patchThreads = (fn: (t: EmailThreadListItem) => EmailThreadListItem | null) => {
    qc.setQueriesData<ThreadListResponse>({ queryKey: ['/email/threads'] }, (old) => {
      // Prefix matching can catch any query whose key starts with
      // '/email/threads' — only patch payloads that really are a thread LIST.
      if (!old || !Array.isArray(old.threads)) return old;
      const threads: EmailThreadListItem[] = [];
      for (const th of old.threads) {
        const r = fn(th);
        if (r) threads.push(r);
      }
      return { ...old, threads };
    });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/email/threads'] });
    qc.invalidateQueries({ queryKey: ['/email/triage-count'] });
  };

  const setRead = useMutation({
    mutationFn: (v: { items: EmailThreadListItem[]; read: boolean }) => {
      const { ids, thread_ids } = splitThreads(v.items);
      return bulkMarkRead({ ids, thread_ids, read: v.read });
    },
    onMutate: (v) => {
      const keys = new Set(v.items.map((i) => i.thread_key));
      patchThreads((t) =>
        keys.has(t.thread_key)
          ? { ...t, unread_count: v.read ? 0 : Math.max(1, t.message_count) }
          : t,
      );
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (items: EmailThreadListItem[]) => {
      const { ids, thread_ids } = splitThreads(items);
      return bulkDeleteMessages({ ids, thread_ids });
    },
    onMutate: (items) => {
      const keys = new Set(items.map((i) => i.thread_key));
      patchThreads((t) => (keys.has(t.thread_key) ? null : t));
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: invalidate,
  });

  return { setRead, remove };
}
