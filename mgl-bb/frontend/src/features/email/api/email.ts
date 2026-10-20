/**
 * Typed wrappers around /api/email.  Pages mostly call these imperatively
 * (the triage flow has its own local state), with TanStack Query used for
 * the list/count reads via useApiQuery in the pages themselves.
 *
 * Email bodies and attachments live behind the authed worker (not the
 * public /media mount), so `openAttachment` / `openBodyHtml` fetch them with
 * the bearer token and hand back an object URL — a plain <a href> can't
 * attach the Authorization header.
 */
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import type {
  AliasListResponse,
  BulkDeletePayload,
  BulkReadPayload,
  ClassifyPayload,
  EmailAccount,
  EmailAttachment,
  EmailMessageDetail,
  MessageListResponse,
  SendPayload,
  SyncResult,
  ThreadDetailResponse,
  ThreadListResponse,
} from '@/features/email/types/email';

/* ----------------------------- Accounts --------------------------- */

export function listAccounts() {
  return apiFetch<{ accounts: EmailAccount[] }>('/email/accounts');
}

export function createAccount(body: { address: string; label?: string }) {
  return apiFetch<{ account: EmailAccount }>('/email/accounts', { method: 'POST', data: body });
}

export function updateAccount(
  id: number,
  body: { label?: string | null; is_active?: boolean; team_ids?: number[] },
) {
  return apiFetch<{ account: EmailAccount }>(`/email/accounts/${id}`, {
    method: 'PATCH',
    data: body,
  });
}

export function deleteAccount(id: number) {
  return apiFetch<{ ok: true }>(`/email/accounts/${id}`, { method: 'DELETE' });
}

export function testAccount(id: number) {
  return apiFetch<{ ok: boolean; emailAddress?: string; historyId?: string; error?: string }>(
    `/email/accounts/${id}/test`,
    { method: 'POST' },
  );
}

/** Plain @gmail connect — returns the Google consent URL to navigate to. */
export function startOAuth(address: string) {
  return apiFetch<{ url: string }>(`/email/oauth/start?address=${encodeURIComponent(address)}`);
}

/* ------------------------------- Sync ----------------------------- */

export function syncNow() {
  return apiFetch<{ results: SyncResult[] }>('/email/sync', { method: 'POST' });
}

/** Deep one-off backfill over a window (days: 30 | 90 | 180 | 365). */
export function backfill(days: number, accountId?: number) {
  return apiFetch<{ results: SyncResult[]; days: number }>('/email/backfill', {
    method: 'POST',
    data: accountId ? { days, account_id: accountId } : { days },
  });
}

export function triageCount() {
  return apiFetch<{ count: number }>('/email/triage-count');
}

/* ----------------------------- Messages --------------------------- */

export function listMessages(params: {
  triaged?: '0' | '1' | 'all';
  account_id?: number;
  q?: string;
  addr?: string;
  page?: number;
}) {
  const sp = new URLSearchParams();
  sp.set('triaged', params.triaged ?? '0');
  if (params.account_id) sp.set('account_id', String(params.account_id));
  if (params.q) sp.set('q', params.q);
  if (params.addr) sp.set('addr', params.addr);
  if (params.page) sp.set('page', String(params.page));
  return apiFetch<MessageListResponse>(`/email/messages?${sp.toString()}`);
}

/* ------------------------------ Threads --------------------------- */

/** Thread list for the Gmail-style inbox (one row per conversation). Same
 *  filters as listMessages, grouped by thread_id. */
export function listThreads(params: {
  triaged?: '0' | '1' | 'all';
  account_id?: number;
  direction?: 'in' | 'out';
  cat?: 'all' | 'convo' | 'promo';
  q?: string;
  addr?: string;
  page?: number;
}) {
  const sp = new URLSearchParams();
  sp.set('triaged', params.triaged ?? '0');
  if (params.account_id) sp.set('account_id', String(params.account_id));
  if (params.direction) sp.set('direction', params.direction);
  if (params.cat && params.cat !== 'all') sp.set('cat', params.cat);
  if (params.q) sp.set('q', params.q);
  if (params.addr) sp.set('addr', params.addr);
  if (params.page) sp.set('page', String(params.page));
  return apiFetch<ThreadListResponse>(`/email/threads?${sp.toString()}`);
}

/** All messages (oldest→newest) in a Gmail thread + attachments by message_id. */
export function getThread(threadId: string) {
  return apiFetch<ThreadDetailResponse>(`/email/threads/${encodeURIComponent(threadId)}`);
}

/** Mark one message read/unread. read=false is app-only (Gmail stays read). */
export function markMessageRead(id: number, read: boolean) {
  return apiFetch<{ ok: true; updated: number }>(`/email/messages/${id}/read`, {
    method: 'POST',
    data: { read },
  });
}

/** Bulk mark read/unread by ids or thread_id (app-only for unread). */
export function bulkMarkRead(body: BulkReadPayload) {
  return apiFetch<{ ok: true; updated: number }>('/email/messages/read', {
    method: 'POST',
    data: body,
  });
}

/** Bulk soft-delete (app-only — does NOT delete from Gmail). Accepts explicit
 *  message ids and/or whole thread_ids. */
export function bulkDeleteMessages(payload: BulkDeletePayload) {
  return apiFetch<{ ok: true; deleted: number }>('/email/messages/delete', {
    method: 'POST',
    data: payload,
  });
}

/** Distinct in-domain aliases (recipient/sender) for the alias filter dropdown. */
export function listAliases(accountId?: number) {
  const qs = accountId ? `?account_id=${accountId}` : '';
  return apiFetch<AliasListResponse>(`/email/aliases${qs}`);
}

export function getMessage(id: number) {
  return apiFetch<{ message: EmailMessageDetail; attachments: EmailAttachment[] }>(
    `/email/messages/${id}`,
  );
}

export function classifyMessage(id: number, body: ClassifyPayload) {
  return apiFetch<{ ok: true; correspondence_id: number }>(`/email/messages/${id}/classify`, {
    method: 'POST',
    data: body,
  });
}

/** Remove a message from our app only (does NOT delete it from Gmail). */
export function deleteMessage(id: number) {
  return apiFetch<{ ok: true }>(`/email/messages/${id}`, { method: 'DELETE' });
}

export function sendEmail(body: SendPayload) {
  return apiFetch<{ ok: true; message_id: number; correspondence_id: number | null }>(
    '/email/send',
    { method: 'POST', data: body },
  );
}

/* --------------------- Authed content fetchers --------------------- */

async function authedFetch(path: string): Promise<Response> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${MEDIA_BASE_URL}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Татаж чадсангүй (${res.status})`);
  return res;
}

/** Raw HTML body text. Rendered by the caller inside a sandboxed <iframe>
 *  rather than a new tab — opening a blob: URL is blocked/blank under the
 *  Pages site's COOP/COEP headers and trips popup blockers after `await`. */
export async function getBodyHtml(messageId: number): Promise<string> {
  const res = await authedFetch(`/email/messages/${messageId}/body.html`);
  return res.text();
}

/** Raw RFC822 source (headers + body) — the "show source" view. Fetched live
 *  from Gmail by the worker; we don't store it. */
export async function getRawSource(messageId: number): Promise<string> {
  const res = await authedFetch(`/email/messages/${messageId}/raw`);
  return res.text();
}

/** Хавсралтыг `blob:` object URL болгож буцаана — `<img>`/`<iframe>`-д
 *  шууд өгөх цорын ганц зам (endpoint нь Authorization толгой шаарддаг).
 *  `mimeType` өгвөл blob-ын төрлийг албадан тохируулна: DB-д `mime_type`
 *  null бол сервер `application/octet-stream` буцаадаг ба тэр үед PDF нь
 *  iframe дотор нээгдэхгүй.  Дэлгэрэнгүйг `components/AttachmentPreviews.tsx`. */
export async function fetchAttachmentObjectUrl(
  attachmentId: number,
  mimeType?: string | null,
): Promise<string> {
  const res = await authedFetch(`/email/attachments/${attachmentId}`);
  const blob = await res.blob();
  const typed = mimeType && blob.type !== mimeType ? blob.slice(0, blob.size, mimeType) : blob;
  return URL.createObjectURL(typed);
}

/** Download an attachment via a programmatic anchor click — reliable across
 *  popup blockers and the COEP-restricted Pages origin (unlike window.open). */
export async function openAttachment(attachmentId: number, filename?: string): Promise<void> {
  const res = await authedFetch(`/email/attachments/${attachmentId}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
