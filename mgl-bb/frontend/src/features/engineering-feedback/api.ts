/**
 * `/api/engineering-feedback` — Програмын хүсэлт (Revit add-in ба ERP-ээс ирэх алдаа / сайжруулалт / асуулт).
 *
 * Backend: `backend/src/routes/engineeringFeedback.ts`, эрх `lib/engineeringFeedbackAccess.ts`, миграц 0410–0414.
 *   • Илгээгч (дотоод ажилтан): ноорог → хавсралт (XHR явцтай stream PUT / multipart хэсэг) → атом submit → өөрийн баримт.
 *   • Reviewer (ЗӨВХӨН баталгаажсан Software Engineer): `/inbox*`.  Эрхгүй бол сервер 404 — UI-ийн sidebar/route
 *     хаалт нь ИЖИЛ эх сурвалжаас (`GET /capabilities` → `can_review`), хаалт нь UX л, жинхэнэ хил нь сервер.
 * Хавсралтын байт ХУВИЙН bucket-д — `/media/` холбоос хэзээ ч ирэхгүй; урьдчилж харах нь `apiFetchBlob` → `blob:`.
 */
import { ApiError, ApiNetworkError, apiFetch, apiFetchBlob } from '@/shared/api/client';
import { resolveApiHost } from '@/shared/api/apiHost';

export const BASE = '/engineering-feedback';

export type EfSource = 'wall_elevation' | 'revit_tool' | 'erp' | 'other';
export type EfType = 'bug' | 'improvement' | 'question';
export type EfPriority = 'low' | 'normal' | 'high' | 'critical';
export type EfStatus =
  | 'draft'
  | 'received'
  | 'triaged'
  | 'in_progress'
  | 'awaiting_info'
  | 'ready_for_retest'
  | 'resolved'
  | 'duplicate'
  | 'rejected'
  | 'reopened';

export interface EfCapabilities {
  can_submit: boolean;
  can_review: boolean;
  token_kind: 'erp' | 'revit' | null;
  storage_available: boolean;
  limits: {
    max_attachments: number;
    max_total_bytes: number;
    max_ordinary_bytes: number;
    part_bytes: number;
    title_max: number;
    text_max: number;
    extensions: Record<string, { large: boolean; preview: 'image' | 'pdf' | 'text' | null }>;
  };
  sources: EfSource[];
  types: EfType[];
}

export interface EfOwnAttachment {
  id: string;
  client_attachment_id: string;
  name: string;
  kind: string;
  size: number;
  state: string;
  mode: 'single' | 'multipart';
  part_size: number | null;
  part_count: number;
  uploaded_parts: number[];
  expires_at: string;
  server_sha256: string | null;
}

export interface EfOwnRequest {
  id: string;
  number: number | null;
  display_number: string | null;
  client_request_id: string;
  channel: 'revit' | 'erp';
  source: EfSource;
  tool_id: string | null;
  type: EfType;
  title: string;
  description: string;
  expected: string | null;
  actual: string | null;
  steps: string | null;
  suggestion: string | null;
  impact: string | null;
  status: EfStatus;
  status_label: string;
  version: number;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  attachments: EfOwnAttachment[];
}

export interface EfReceipt {
  id: string;
  number: number | null;
  display_number: string | null;
  status: EfStatus;
  status_label: string;
  title: string;
  type: EfType;
  source: EfSource;
  submitted_at: string | null;
  attachments: Array<{ id: string; name: string; size: number }>;
}

export interface EfMineItem {
  id: string;
  number: number | null;
  display_number: string | null;
  title: string;
  type: EfType;
  source: EfSource;
  tool_id: string | null;
  status: EfStatus;
  status_label: string;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  can_retest: boolean;
}

export interface EfSenderEvent {
  id: number;
  kind: string;
  by: 'reviewer' | 'sender' | 'system';
  status: string | null;
  body: string | null;
  fixed_version: string | null;
  revit_year: number | null;
  created_at: string;
}

export interface EfInboxItem {
  id: string;
  number: number;
  display_number: string;
  title: string;
  type: EfType;
  source: EfSource;
  tool_id: string | null;
  channel: 'revit' | 'erp';
  status: EfStatus;
  priority: EfPriority;
  revit_year: number | null;
  revit_build: string | null;
  addin_version: string | null;
  addin_sha256: string | null;
  duplicate_of: string | null;
  submitted_at: string;
  updated_at: string;
  submitter_user_id: number;
  submitter_name: string | null;
  submitter_username: string | null;
  unread: boolean;
  attachment_count: number;
}

export interface EfReviewerAttachment {
  id: string;
  name: string;
  extension: string;
  kind: string;
  size: number;
  preview: 'image' | 'pdf' | 'text' | null;
  integrity:
    | { mode: 'server_sha256'; server_sha256: string | null; client_sha256: string | null }
    | { mode: 'multipart_parts_server_sha256'; client_sha256_reported: string | null };
  completed_at: string | null;
}

export interface EfReviewerEvent {
  id: number;
  request_id: string;
  actor_user_id: number | null;
  actor_role: 'sender' | 'reviewer' | 'system';
  kind: string;
  visibility: 'private' | 'sender';
  from_value: string | null;
  to_value: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface EfFix {
  id: number;
  revit_year: number | null;
  fixed_version: string | null;
  commit_sha: string | null;
  pr_url: string | null;
  note: string | null;
  linked_by: number;
  linked_at: string;
}

export interface EfRelated {
  id: string;
  number: number;
  display_number: string;
  title: string;
  status: EfStatus;
  revit_year?: number | null;
  revit_build?: string | null;
  addin_version?: string | null;
}

/** Reviewer-ийн дэлгэрэнгүйн хүсэлт = DB мөр (nonce/hash/түүхий diagnostics_json-гүй) + задалсан diagnostics. */
export interface EfInboxRequest {
  id: string;
  number: number;
  display_number: string;
  client_request_id: string;
  submitter_user_id: number;
  recipient_user_id: number | null;
  channel: 'revit' | 'erp';
  source: EfSource;
  tool_id: string | null;
  source_context: string | null;
  type: EfType;
  title: string;
  description: string;
  expected: string | null;
  actual: string | null;
  steps: string | null;
  suggestion: string | null;
  impact: string | null;
  diagnostics_schema: string | null;
  diagnostics: Record<string, unknown> | null;
  revit_year: number | null;
  revit_build: string | null;
  addin_version: string | null;
  addin_sha256: string | null;
  status: EfStatus;
  priority: EfPriority;
  duplicate_of: string | null;
  reviewer_read_at: string | null;
  last_sender_activity_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  resolved_at: string | null;
  unread: boolean;
  next_statuses: EfStatus[];
}

export interface EfInboxDetail {
  request: EfInboxRequest;
  submitter: { id: number; full_name: string | null; username: string; role: string; employee_id: string | null } | null;
  attachments: EfReviewerAttachment[];
  events: EfReviewerEvent[];
  fixes: EfFix[];
  duplicates: EfRelated[];
  duplicate_of: EfRelated | null;
  related: EfRelated[];
}

export interface EfInboxFilter {
  status?: string;
  type?: string;
  source?: string;
  priority?: string;
  revit_year?: string;
  revit_build?: string;
  addin_version?: string;
  addin_sha256?: string;
  tool_id?: string;
  from?: string;
  to?: string;
  unread?: '1';
  q?: string;
  page?: number;
  page_size?: number;
}

export const efKeys = {
  capabilities: ['engineering-feedback', 'capabilities'] as const,
  inbox: (f: EfInboxFilter) => ['engineering-feedback', 'inbox', f] as const,
  inboxAll: ['engineering-feedback', 'inbox'] as const,
  count: ['engineering-feedback', 'count'] as const,
  detail: (id: string) => ['engineering-feedback', 'detail', id] as const,
  mine: ['engineering-feedback', 'mine'] as const,
  mineDetail: (id: string) => ['engineering-feedback', 'mine', id] as const,
};

export function inboxQuery(f: EfInboxFilter): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const fetchCapabilities = () => apiFetch<EfCapabilities>(`${BASE}/capabilities`, { timeoutMs: 10_000 });
export const fetchInbox = (f: EfInboxFilter) =>
  apiFetch<{ items: EfInboxItem[]; total: number; page: number; page_size: number }>(`${BASE}/inbox${inboxQuery(f)}`);
export const fetchInboxCount = () => apiFetch<{ unread: number; open: number }>(`${BASE}/inbox/count`);
export const fetchInboxDetail = (id: string) => apiFetch<EfInboxDetail>(`${BASE}/inbox/${encodeURIComponent(id)}`);
export const markRead = (id: string) => apiFetch<{ ok: true }>(`${BASE}/inbox/${encodeURIComponent(id)}/read`, { method: 'POST', data: {} });

export interface TriageBody {
  version: number;
  status?: EfStatus;
  priority?: EfPriority;
  duplicate_of?: string;
  note?: string;
  reply?: string;
}

export const triage = (id: string, body: TriageBody) =>
  apiFetch<{ ok: true; version: number; status: EfStatus; priority: EfPriority; duplicate_of: string | null }>(
    `${BASE}/inbox/${encodeURIComponent(id)}`,
    { method: 'PATCH', data: body },
  );

export const addEvent = (id: string, kind: 'note' | 'reply', body: string) =>
  apiFetch<{ ok: true }>(`${BASE}/inbox/${encodeURIComponent(id)}/events`, { method: 'POST', data: { kind, body } });

export const addFix = (
  id: string,
  body: { revit_year?: number | null; fixed_version?: string; commit_sha?: string; pr_url?: string; note?: string },
) => apiFetch<{ ok: true }>(`${BASE}/inbox/${encodeURIComponent(id)}/fixes`, { method: 'POST', data: body });

export const removeFix = (id: string, fixId: number) =>
  apiFetch<{ ok: true }>(`${BASE}/inbox/${encodeURIComponent(id)}/fixes/${fixId}`, { method: 'DELETE' });

/** Хувийн хавсралтын байт (reviewer) — урьдчилж харах нь `inline=1` (зөвхөн зураг/PDF/бичвэр). */
export const fetchAttachmentBlob = (id: string, aid: string, inline: boolean, onProgress?: (loaded: number, total: number | null) => void) =>
  apiFetchBlob(`${BASE}/inbox/${encodeURIComponent(id)}/attachments/${encodeURIComponent(aid)}${inline ? '?inline=1' : ''}`, { onProgress });

export async function downloadInboxCsv(f: EfInboxFilter): Promise<Blob> {
  // Экспорт нь хуудаслалтгүй (сервер ≤ 5000 мөр) — page/page_size-ыг хасна.
  const rest: EfInboxFilter = { ...f, page: undefined, page_size: undefined };
  return apiFetchBlob(`${BASE}/inbox/export${inboxQuery(rest)}`);
}

/* ---- Илгээгч ---- */

export const fetchMine = () => apiFetch<{ items: EfMineItem[] }>(`${BASE}/mine`);
export const fetchMineDetail = (id: string) =>
  apiFetch<{ request: EfOwnRequest; events: EfSenderEvent[]; can_retest: boolean; can_reply: boolean }>(
    `${BASE}/mine/${encodeURIComponent(id)}`,
  );
export const retest = (id: string, action: 'still_broken' | 'works' | 'info', note: string, clientEventId: string) =>
  apiFetch<{ status: EfStatus; status_label: string; reused?: boolean }>(`${BASE}/mine/${encodeURIComponent(id)}/retest`, {
    method: 'POST',
    data: { action, note: note || undefined, client_event_id: clientEventId },
  });

export interface DraftBody {
  client_request_id: string;
  source: EfSource;
  tool_id?: string;
  type: EfType;
  title: string;
  description: string;
  expected?: string;
  actual?: string;
  steps?: string;
  suggestion?: string;
  impact?: string;
  diagnostics?: Record<string, unknown>;
}

export const createDraft = (body: DraftBody) =>
  apiFetch<{ request: EfOwnRequest; reused: boolean }>(`${BASE}/drafts`, { method: 'POST', data: body });

export const reserveAttachment = (
  draftId: string,
  body: { client_attachment_id: string; name: string; size: number; sha256?: string | null; kind?: 'file' | 'screenshot' | 'diagnostics' },
) =>
  apiFetch<{ attachment: EfOwnAttachment; reused?: boolean }>(`${BASE}/drafts/${encodeURIComponent(draftId)}/attachments`, {
    method: 'POST',
    data: body,
  });

export const completeAttachment = (aid: string) =>
  apiFetch<{ attachment: EfOwnAttachment }>(`${BASE}/attachments/${encodeURIComponent(aid)}/complete`, { method: 'POST', data: {} });

export const deleteAttachment = (aid: string) =>
  apiFetch<{ ok: true }>(`${BASE}/attachments/${encodeURIComponent(aid)}`, { method: 'DELETE' });

export const submitDraft = (draftId: string, body: DraftBody & { attachment_ids: string[] }) =>
  apiFetch<{ receipt: EfReceipt; already_submitted: boolean }>(`${BASE}/drafts/${encodeURIComponent(draftId)}/submit`, {
    method: 'POST',
    data: body,
    timeoutMs: 30_000,
  });

/**
 * Нэг хэсгийг (эсвэл бүтэн энгийн файлыг) XHR-ээр — `fetch` upload явцыг өгдөггүй (Drive upload-тай ижил шалтгаан).
 * `sha256` — хэсгийн SHA-256 (сервер өөрийнхөөрөө бодож тулгана).
 */
export function putBytes(
  path: string,
  body: Blob,
  opts: { onProgress?: (loaded: number) => void; signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${resolveApiHost()}/api${BASE}${path}`);
    xhr.withCredentials = true;
    const token = localStorage.getItem('auth_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded);
    };
    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onload = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        /* JSON биш — статусаар */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new ApiError(xhr.status, typeof payload.error === 'string' ? payload.error : `HTTP ${xhr.status}`, payload));
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new ApiNetworkError('Network error during upload', 1, false));
    };
    xhr.onabort = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('aborted', 'AbortError'));
    };
    xhr.send(body);
  });
}
