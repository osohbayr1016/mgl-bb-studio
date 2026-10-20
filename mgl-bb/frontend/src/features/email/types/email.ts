/**
 * Types for the Gmail integration UI (/api/email).  Mirrors the backend
 * row shapes in backend/src/types.ts and the route responses.
 */

export type EmailAuthType = 'workspace' | 'oauth';
export type EmailDirection = 'in' | 'out';

/** Construction-correspondence classification (mirrors backend DocType). */
export type DocType = 'rfi' | 'cr' | 'official' | 'mr';

export const DOC_TYPES: DocType[] = ['rfi', 'cr', 'official', 'mr'];

/** Long labels for pickers / detail. */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  rfi: 'RFI — Мэдээлэл хүсэлт',
  cr: 'CR — Өөрчлөлтийн хүсэлт',
  official: 'OL — Албан бичиг',
  mr: 'MR — Уулзалтын тэмдэглэл',
};

/** Short chips for tables / badges. */
export const DOC_TYPE_SHORT: Record<DocType, string> = {
  rfi: 'RFI',
  cr: 'CR',
  official: 'OL',
  mr: 'MR',
};

export interface EmailAccount {
  id: number;
  address: string;
  label: string | null;
  auth_type: EmailAuthType;
  history_id: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  watch_expiration: string | null;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
  /** Empty = all teams may send from this mailbox. */
  team_ids?: number[];
}

export interface EmailMessageListItem {
  id: number;
  account_id: number;
  account_address: string;
  direction: EmailDirection;
  from_addr: string | null;
  to_addrs: string | null;
  cc_addrs: string | null;
  subject: string | null;
  snippet: string | null;
  internal_date: string | null;
  is_read: 0 | 1;
  triaged: 0 | 1;
  correspondence_id: number | null;
  attachment_count: number;
}

export interface EmailMessageDetail {
  id: number;
  account_id: number;
  account_address: string;
  gmail_message_id: string;
  thread_id: string | null;
  rfc_message_id: string | null;
  direction: EmailDirection;
  from_addr: string | null;
  to_addrs: string | null;
  cc_addrs: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html_r2_key: string | null;
  internal_date: string | null;
  label_ids: string | null;
  is_read: 0 | 1;
  triaged: 0 | 1;
  correspondence_id: number | null;
}

export interface EmailAttachment {
  id: number;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  r2_key: string | null;
}

export interface MessageListResponse {
  messages: EmailMessageListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** Distinct in-domain aliases derived from synced mail — alias filter source. */
export interface AliasListResponse {
  aliases: string[];
}

export interface SyncResult {
  account: string;
  fetched: number;
  stored: number;
  error?: string;
  /** Deep backfill hit the per-run message cap; older mail in the window remains. */
  truncated?: boolean;
}

export interface ClassifyPayload {
  project_id: number;
  doc_type: DocType;
  direction?: 'sent' | 'received';
  log_date?: string;
  ref_no?: string;
  mark_read?: boolean;
}

export interface SendAttachment {
  r2_key: string;
  filename: string;
  mime_type: string;
}

export interface SendPayload {
  account_id: number;
  /** Optional alias to send from — must be within the mailbox's domain. */
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body_html?: string;
  body_text?: string;
  /** Reply/forward threading — keeps the sent mail in the Gmail conversation. */
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
  project_id?: number;
  doc_type?: DocType;
  log_date?: string;
  attachments?: SendAttachment[];
}

/** Prefill for the compose window (reply / reply-all / forward). */
export interface ComposeDraft {
  account_id?: number;
  to?: string;
  cc?: string;
  subject?: string;
  bodyHtml?: string;
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
}

/* --------------------------- Threads (Gmail inbox) ------------------------ */

/** One row per Gmail conversation in the threaded inbox (GET /email/threads).
 *  `thread_key` is the real `thread_id`, or `m:<id>` for a NULL-thread
 *  singleton (for those, `thread_id` is null → open via getMessage). */
export interface EmailThreadListItem {
  thread_key: string;
  thread_id: string | null;
  latest_message_id: number;
  account_id: number;
  account_address: string;
  /** >1 when a thread touches more than one monitored mailbox. */
  account_count: number;
  direction: EmailDirection;
  latest_from: string | null;
  latest_subject: string | null;
  latest_snippet: string | null;
  latest_date: string | null;
  message_count: number;
  unread_count: number;
  /** triaged rollup: any/all messages in the thread classified. */
  any_triaged: 0 | 1;
  all_triaged: 0 | 1;
  has_attachments: 0 | 1;
  /** Comma-joined distinct `from_addr` header strings (raw `Name <addr>`). */
  participants_raw: string | null;
}

export interface ThreadListResponse {
  threads: EmailThreadListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ThreadDetailResponse {
  thread_id: string | null;
  messages: EmailMessageDetail[];
  /** Attachments keyed by message_id. */
  attachments: Record<number, EmailAttachment[]>;
}

export interface BulkReadPayload {
  ids?: number[];
  thread_id?: string;
  thread_ids?: string[];
  read: boolean;
}

export interface BulkDeletePayload {
  ids?: number[];
  thread_ids?: string[];
}
