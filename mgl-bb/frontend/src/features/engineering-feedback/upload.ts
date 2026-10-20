/**
 * Хавсралтыг ХУВИЙН bucket руу үе шаттай илгээх (ERP хөтөч).
 *
 *   нөөцлөх (POST /drafts/:id/attachments) → энгийн файл: нэг stream PUT (`/content`)
 *                                          → том RVT/RFA/ZIP: 8 MiB хэсэг бүрийг `?sha256=`-тэй PUT → `complete`
 *
 * • Энгийн (≤ 25 MiB) файлын бүтэн SHA-256-г нөөцлөхөд өгнө → сервер өөрөө бодож тулгана.
 * • Multipart-д бүтэн файлыг санах ойд хэзээ ч уншихгүй — хэсэг тус бүрийн хэшийг л (сервер мөн тулгана).
 * • Сүлжээ / 5xx / 429 → ухралттай дахин (хэсэг бүр бие даан); 4xx (хэмжээ, хэш, эрх) → шууд алдаа.
 * • Давтан нөөцлөлт нь ижил `client_attachment_id`-аар idempotent — сервер аль хэдийн хүлээн авсан хэсгүүдийг
 *   (`uploaded_parts`) буцаадаг тул тэдгээрийг алгасна.
 */
import { ApiError, ApiNetworkError } from '@/shared/api/client';
import { completeAttachment, putBytes, reserveAttachment, type EfOwnAttachment } from './api';

export type UploadPhase = 'queued' | 'hashing' | 'reserving' | 'uploading' | 'completing' | 'ready' | 'failed' | 'cancelled';

export interface UploadState {
  phase: UploadPhase;
  loaded: number;
  total: number;
  attachmentId?: string;
  error?: string;
}

const RETRIES = 3;

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiNetworkError) return true;
  if (err instanceof ApiError) return err.status >= 500 || err.status === 429 || err.status === 408;
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let i = 0; i < RETRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (signal?.aborted || !isRetryable(err) || i === RETRIES - 1) throw err;
      const base = 600 * 2 ** i;
      await sleep(base + Math.floor(Math.random() * base), signal);
    }
  }
  throw last;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function errorText(err: unknown, fallback: string): string {
  if (err instanceof DOMException && err.name === 'AbortError') return fallback;
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof ApiNetworkError) return fallback;
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Нэг файлыг бүрэн (ready болтол) илгээнэ.  `onState` нь явцын бүх шилжилтийг дамжуулна.
 * Буцаах утга — серверийн `ready` хавсралт.
 */
export async function uploadAttachment(
  draftId: string,
  file: File,
  clientAttachmentId: string,
  opts: { ordinaryMax: number; signal?: AbortSignal; onState: (s: UploadState) => void },
): Promise<EfOwnAttachment> {
  const { signal, onState } = opts;
  const total = file.size;
  let wholeSha: string | null = null;
  if (total <= opts.ordinaryMax) {
    onState({ phase: 'hashing', loaded: 0, total });
    wholeSha = await sha256Hex(file);
  }
  onState({ phase: 'reserving', loaded: 0, total });
  const reserved = await withRetry(
    () => reserveAttachment(draftId, { client_attachment_id: clientAttachmentId, name: file.name, size: total, sha256: wholeSha }),
    signal,
  );
  let att = reserved.attachment;
  if (att.state === 'ready') {
    onState({ phase: 'ready', loaded: total, total, attachmentId: att.id });
    return att;
  }

  if (att.mode === 'single') {
    onState({ phase: 'uploading', loaded: 0, total, attachmentId: att.id });
    const res = await withRetry(
      () =>
        putBytes(`/attachments/${encodeURIComponent(att.id)}/content`, file, {
          signal,
          onProgress: (loaded) => onState({ phase: 'uploading', loaded, total, attachmentId: att.id }),
        }),
      signal,
    );
    att = (res.attachment as EfOwnAttachment | undefined) ?? att;
    onState({ phase: 'ready', loaded: total, total, attachmentId: att.id });
    return att;
  }

  const partSize = att.part_size ?? 8 * 1024 * 1024;
  const done = new Set(att.uploaded_parts);
  let confirmed = [...done].reduce((s, n) => s + Math.min(partSize, total - partSize * (n - 1)), 0);
  onState({ phase: 'uploading', loaded: confirmed, total, attachmentId: att.id });
  for (let n = 1; n <= att.part_count; n++) {
    if (done.has(n)) continue;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const slice = file.slice(partSize * (n - 1), Math.min(total, partSize * n));
    const partSha = await sha256Hex(slice);
    await withRetry(
      () =>
        putBytes(`/attachments/${encodeURIComponent(att.id)}/parts/${n}?sha256=${partSha}`, slice, {
          signal,
          onProgress: (loaded) => onState({ phase: 'uploading', loaded: confirmed + loaded, total, attachmentId: att.id }),
        }),
      signal,
    );
    confirmed += slice.size;
    onState({ phase: 'uploading', loaded: confirmed, total, attachmentId: att.id });
  }
  onState({ phase: 'completing', loaded: total, total, attachmentId: att.id });
  const completed = await withRetry(() => completeAttachment(att.id), signal);
  att = completed.attachment;
  onState({ phase: 'ready', loaded: total, total, attachmentId: att.id });
  return att;
}
