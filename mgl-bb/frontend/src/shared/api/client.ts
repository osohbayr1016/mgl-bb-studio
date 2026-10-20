import { getDeviceId } from '../lib/device';
import { resolveApiHost } from './apiHost';
import { TASK_ALLOC_CONTRACT, TASK_ALLOC_CONTRACT_HEADER, needsAllocContractHeader, observeGateBlock, observeGateHeaders } from './taskAllocContract';

function apiHost(): string {
  return resolveApiHost();
}

function baseUrl(): string {
  return `${apiHost()}/api`;
}

export function getMediaBaseUrl(): string {
  return apiHost();
}

/** Template-literal friendly — resolves the Worker origin on each use. */
export const MEDIA_BASE_URL = {
  toString: () => getMediaBaseUrl(),
  valueOf: () => getMediaBaseUrl(),
} as unknown as string;

/**
 * Resolve an R2 media reference (the `/media/<key>` path returned by the
 * upload helpers, or a profile_image/file_url column) to an absolute URL on
 * the Worker origin.
 *
 * Why this matters: media is served by the Worker's `/media/*` mount, NOT by
 * Cloudflare Pages. A bare relative `/media/...` href resolves against the
 * Pages origin, where the SPA fallback (`/* /index.html 200`) rewrites it to
 * index.html — so a "download" silently opens the app instead of the file.
 * Always route media through here (or the `${getMediaBaseUrl()}${path}` pattern).
 * Already-absolute (http/blob/data) values are returned untouched.
 */
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${getMediaBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
}

interface FetchOptions extends RequestInit {
  data?: unknown;
  /**
   * Хүсэлт бүрийн (нэг оролдлогын) хугацааны хязгаар, мс.  Өгөгдмөл
   * `DEFAULT_TIMEOUT_MS`.  PDF үүсгэх, AI дуудлага зэрэг удаан гарцад
   * гараар өсгө.  `0` бол хязгааргүй.
   */
  timeoutMs?: number;
  /**
   * Сүлжээний алдаа/timeout дээр давтах нийт оролдлогын тоо.  Зөвхөн
   * ИДЕМПОТЕНТ (GET/HEAD) хүсэлтэд өгөгдмөлөөр үйлчилнэ — POST/PUT/PATCH/
   * DELETE-ийг ХЭЗЭЭ Ч автоматаар давтахгүй (сервер дээр аль хэдийн
   * биелчихсэн байж болзошгүй).
   */
  attempts?: number;
  /**
   * Зөвхөн `apiFetchBlob`: биетийг урсгалаар уншиж явцыг мэдэгдэнэ
   * (`loaded` байт, `total` = `Content-Length` эсвэл null).  Том файлын
   * урьдчилан харагдац (Drive-ын 100 MB-ийн .docx) эргэлдэгч биш
   * хувь харуулахад.  Өгөөгүй бол хуучин `res.blob()` зам.
   */
  onProgress?: (loaded: number, total: number | null) => void;
}

/* =====================================================================
 * Timeout + давталт — ЗАГВАРЫН ШАЛТГААН (2026-08-24)
 * ---------------------------------------------------------------------
 * Өмнө нь энэ файл нүцгэн `fetch()` дуудаж байсан: timeout ч үгүй,
 * AbortSignal ч үгүй, давталт ч үгүй.  Тиймээс API worker-ийн ганц
 * хүсэлт хариугүй үлдэхэд `AuthProvider.checkAuth()` мөнхөд `await`
 * дээр зогсож, `loading` үүрд `true` хэвээр үлдэж, `ProtectedRoute` нь
 * `BrandLoader`-ийг («Уншиж байна…» барилгын зураг) хязгааргүй үзүүлдэг
 * байв.  Хэрэглэгчид энэ нь «сайт нээгдэхгүй байна» гэж мэдрэгддэг.
 *
 * Бодит хэмжилт (2026-08-24, ULN colo): worker-ийн 6.5 МБ bundle-ийн
 * улмаас хүйтэн машин дээрх эхний хүсэлт 9-20 секунд хариугүй байж,
 * шинэ холболтын ~40% нь ингэж өлгөгдөж байв (backend талын засварыг
 * `backend/wrangler.toml`-ийн `minify` тайлбараас үз).
 *
 * Backend-ийг хэдий чинээ хурдан болгосон ч frontend нь СҮЛЖЭЭНД
 * НАЙДАЖ БОЛОХГҮЙ: timeout нь мөнхийн гацаанаас хамгаалах сүүлчийн
 * хана.  Энэ хоёр тогтмолыг бүү устга.
 * ===================================================================== */

/** Нэг оролдлогын өгөгдмөл хязгаар.  Хүйтэн эхлэлтийг барих хэмжээтэй. */
const DEFAULT_TIMEOUT_MS = 12_000;
/** GET/HEAD-ийн өгөгдмөл нийт оролдлого (анхны + 2 давталт). */
const DEFAULT_ATTEMPTS = 3;
/** Давталт хоорондын саатал: 250 мс, 500 мс, … (экспоненциал). */
const RETRY_BASE_DELAY_MS = 250;

/**
 * Сервер хүртэл ХҮРЭЭГҮЙ (эсвэл хариу нь ирээгүй) хүсэлтийн алдаа.
 *
 * `ApiError`-оос ЗОРИУДААР тусдаа: `ApiError` нь сервер хариулсан гэсэн
 * үг (401 → нэвтрэх), харин энэ нь «сүлжээ/сервер дуугарсангүй» гэсэн үг
 * (→ дахин оролд).  `AuthContext` энэ хоёрыг ялгаж, сүлжээний алдаанд
 * хэрэглэгчийг нэвтрэх хуудас руу ШИДЭХГҮЙ.
 */
export class ApiNetworkError extends Error {
  /** Хэдэн оролдлого хийсэн. */
  attempts: number;
  /** timeout-оос болсон эсэх (эсвэл сүлжээ тасарсан). */
  timedOut: boolean;
  /** Хамгийн сүүлийн доод түвшний алдаа. */
  original?: unknown;
  constructor(message: string, attempts: number, timedOut: boolean, original?: unknown) {
    super(message);
    this.name = 'ApiNetworkError';
    this.attempts = attempts;
    this.timedOut = timedOut;
    this.original = original;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Дуудагчийн `signal` (байвал) болон timeout-ыг НЭГТГЭНЭ.
 *
 * `AbortSignal.any()` ашиглаагүй нь санаатай: tsconfig-ийн lib нь ES2020
 * бөгөөд тэр API нь харьцангуй шинэ (Chrome 116+).  Доорх 10 мөр нь бүх
 * браузарт ажиллана.  Буцаах `dispose()`-ыг заавал дууд — эс тэгвээс
 * timer болон listener алдагдана.
 */
function withTimeout(
  outer: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort);
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onOuterAbort);
    },
  };
}

/**
 * Rich error thrown by `apiFetch` for non-2xx responses.  Callers that
 * need to react to specific failure modes (e.g. the 422 NO_QUOTE block
 * on approve, or 403 on the leaderboard endpoints) should `instanceof`
 * check this — the plain message remains usable for generic UIs.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  payload: Record<string, unknown>;
  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = typeof payload.code === 'string' ? payload.code : undefined;
    this.payload = payload;
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { data, headers, timeoutMs, attempts, signal: outerSignal, ...customConfig } = options;

  const token = localStorage.getItem('auth_token');

  const config: RequestInit = {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      // Ирцийн төхөөрөмж холболтод server тал энэ id-г уншина.
      'X-Device-Id': getDeviceId(),
      // Таскийн хуваарилалтын гэрээ — managed мутаци бүрийг сервер ЭНЭ толгойгоор шалгана (426).  ЗӨВХӨН тэдгээр мутацид явуулна
      // (cross-origin preflight үүсгэдэг тул бүх хүсэлтэд явуулбал хуучин Worker-тэй үед апп бүхэлдээ унана — api/taskAllocContract.ts).
      ...(needsAllocContractHeader(endpoint, customConfig.method ?? (data ? 'POST' : 'GET')) ? { [TASK_ALLOC_CONTRACT_HEADER]: String(TASK_ALLOC_CONTRACT) } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    credentials: 'omit', // We change this to 'include' later, wait, Hono API requires cookies for auth. Yes, include.
    ...customConfig,
  };
  config.credentials = 'include';

  if (data) {
    config.body = JSON.stringify(data);
  }

  const perAttemptTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = (config.method ?? 'GET').toUpperCase();
  // ⚠️ Зөвхөн идемпотент үйлдлийг давтана.  POST/PUT/PATCH/DELETE нь
  // timeout болсон ч сервер дээр биелчихсэн байж болзошгүй тул давтвал
  // давхар бичилт үүсгэнэ (жишээ нь хоёр ирцийн бүртгэл).
  const maxAttempts = attempts ?? (method === 'GET' || method === 'HEAD' ? DEFAULT_ATTEMPTS : 1);

  let lastError: unknown;
  let lastTimedOut = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const guard = withTimeout(outerSignal, perAttemptTimeout);
    let response: Response;
    try {
      response = await fetch(`${baseUrl()}${endpoint}`, { ...config, signal: guard.signal });
    } catch (err) {
      lastError = err;
      lastTimedOut = guard.timedOut();
      guard.dispose();
      // Дуудагч өөрөө цуцалсан бол давтахгүй — тэр нь алдаа биш, шийдвэр.
      if (outerSignal?.aborted) throw err;
      if (attempt < maxAttempts) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new ApiNetworkError(
        lastTimedOut
          ? `Сервер ${Math.round(perAttemptTimeout / 1000)} секундэд хариу өгсөнгүй`
          : 'Сүлжээний алдаа — серверт холбогдож чадсангүй',
        maxAttempts,
        lastTimedOut,
        lastError,
      );
    }
    guard.dispose();

    // Хариу ИРСЭН — статус ямар ч байсан давтахгүй.  4xx/5xx нь серверийн
    // шийдвэр тул `ApiError` болж дуудагч рүү очно.
    const result = await response.json().catch(() => ({}));

    // Таскийн хуваарилалтын төлөв (толгой хаана ч ирж болно) + 426/423 блок → баннер.
    observeGateHeaders(response.headers);

    if (response.ok) {
      return result as T;
    }
    observeGateBlock(response.status, result);

    throw new ApiError(
      response.status,
      (result as { error?: string }).error || 'API Request Failed',
      result as Record<string, unknown>,
    );
  }

  /* Дээрх давталт нь заавал `return` эсвэл `throw` хийдэг тул энд хүрэхгүй —
     TypeScript-ийн урсгалын шинжилгээг хангах хамгаалалт. */
  throw new ApiNetworkError('Сүлжээний алдаа', maxAttempts, lastTimedOut, lastError);
}

/**
 * Download an authenticated PDF (or any attachment) from the API and
 * trigger a browser save dialog.
 *
 * Must NOT be a plain `window.location = '/api/…'`: the API lives on a
 * different origin (the Worker), so a relative path hits the SPA on the
 * Pages origin and React Router throws "No routes matched". And a
 * top-level navigation can't attach the `Authorization` header. So we
 * fetch the blob with the bearer token, then save it via an object URL.
 *
 * `endpoint` is relative to the API base (e.g. `/projects/1/…/pdf`).
 * The filename comes from the Content-Disposition header when present,
 * else `fallbackName`.
 */
export async function downloadPdf(endpoint: string, fallbackName: string): Promise<void> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${baseUrl()}${endpoint}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) {
    let msg = `PDF татахад алдаа (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename="?([^";]+)"?/i);
  const filename = m?.[1] ?? fallbackName;
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

/**
 * Fetch a response body as a Blob with the bearer token attached.  Used when
 * the API returns binary (e.g. a PDF) rather than JSON — `apiFetch` assumes a
 * JSON body and would choke.  Pass `data` as a `FormData` for multipart POSTs
 * (the browser sets the boundary) or a plain object for JSON.
 */
export async function apiFetchBlob(endpoint: string, options: FetchOptions = {}): Promise<Blob> {
  const { data, headers, onProgress, ...rest } = options;
  const token = localStorage.getItem('auth_token');

  const baseHeaders: Record<string, string> = {
    'X-Device-Id': getDeviceId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(headers as Record<string, string> | undefined),
  };

  const config: RequestInit = {
    method: data ? 'POST' : 'GET',
    credentials: 'include',
    ...rest,
  };

  if (data instanceof FormData) {
    config.body = data; // do NOT set Content-Type — the boundary is auto-added
  } else if (data !== undefined) {
    baseHeaders['Content-Type'] = 'application/json';
    config.body = JSON.stringify(data);
  }
  config.headers = baseHeaders;

  const res = await fetch(`${baseUrl()}${endpoint}`, config);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let payload: Record<string, unknown> = {};
    try {
      payload = (await res.json()) as Record<string, unknown>;
      if (typeof payload.error === 'string') msg = payload.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg, payload);
  }
  if (!onProgress || !res.body) return res.blob();
  // Урсгалаар уншиж явцыг мэдэгдэнэ.  `Content-Length` нь CORS-ын
  // safelisted толгой тул `Expose-Headers` шаардахгүй; серверийн streamed
  // (chunked) хариунд байхгүй байж болно → total null.
  const lenHeader = res.headers.get('content-length');
  const total = lenHeader && /^\d+$/.test(lenHeader) ? Number(lenHeader) : null;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks, { type: res.headers.get('content-type') ?? '' });
}

// Files at/above this size are routed through the multipart endpoints
// automatically — the single-request /api/upload buffers the whole file in
// Worker memory and is capped by the ~100 MB request-body limit.
const MULTIPART_THRESHOLD = 50 * 1024 * 1024; // 50 MiB
// R2 requires every part except the last to be ≥ 5 MiB and uniform in size.
const DEFAULT_PART_SIZE = 25 * 1024 * 1024; // 25 MiB
const DEFAULT_UPLOAD_CONCURRENCY = 3;

export async function uploadFile(file: File): Promise<string> {
  // Large files can't go through the single-request endpoint (Worker memory +
  // request-body limit) — transparently route them through multipart.
  if (file.size >= MULTIPART_THRESHOLD) {
    return uploadLargeFile(file);
  }

  const token = localStorage.getItem('auth_token');
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${baseUrl()}/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: formData,
  });

  const result = (await response.json()) as { url?: string; error?: string };
  if (!response.ok) throw new Error(result.error || 'Upload failed');
  return result.url!;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  pct: number; // 0..100
}

interface UploadLargeOptions {
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  partSize?: number;
  concurrency?: number;
  /** Target R2 bucket. Defaults to the public media bucket; 'meeting' routes the
   *  upload into the PRIVATE meeting-audio bucket and the result is a key (no
   *  public /media URL). See backend routes/upload.ts. */
  bucket?: 'media' | 'meeting' | 'client';
}

function uploadAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Upload a (potentially very large) file to R2 via the Worker's multipart
 * endpoints. The file is split into uniform chunks, each streamed through the
 * Worker straight into R2, so nothing buffers the whole file and we're not
 * bound by the single-request body limit. Returns the `/media/<key>` URL.
 *
 * Reports byte-accurate aggregate progress, supports cancellation via
 * `signal`, retries a blipped chunk a couple of times, and aborts the R2
 * multipart upload on failure so we don't leave orphaned parts (R2 also
 * auto-expires uncompleted uploads after 7 days).
 */
export async function uploadLargeFile(file: File, opts: UploadLargeOptions = {}): Promise<string> {
  // Clamp to [5 MiB, 90 MiB]: R2 requires every non-final part ≥ 5 MiB and
  // uniform; the upper bound keeps each part body under the ~100 MB Worker
  // request-body limit so a tuned `partSize` can't silently fail every chunk.
  const partSize = Math.min(
    Math.max(opts.partSize ?? DEFAULT_PART_SIZE, 5 * 1024 * 1024),
    90 * 1024 * 1024,
  );
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY);
  const total = file.size;
  const partCount = Math.max(1, Math.ceil(total / partSize));

  // 1) Create the multipart upload.
  const createRes = await fetch(`${baseUrl()}/upload/multipart/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...uploadAuthHeaders() },
    credentials: 'include',
    body: JSON.stringify({ filename: file.name, contentType: file.type, bucket: opts.bucket }),
    signal: opts.signal,
  });
  const created = (await createRes.json().catch(() => ({}))) as {
    key?: string;
    uploadId?: string;
    error?: string;
  };
  if (!createRes.ok || !created.key || !created.uploadId) {
    throw new Error(created.error || 'Failed to start upload');
  }
  const { key, uploadId } = created;

  // Per-part uploaded-byte counters → aggregate progress.
  const loaded = new Array<number>(partCount).fill(0);
  const emit = () => {
    if (!opts.onProgress) return;
    const sum = loaded.reduce((a, b) => a + b, 0);
    opts.onProgress({
      loaded: sum,
      total,
      pct: total > 0 ? Math.min(100, (sum / total) * 100) : 100,
    });
  };

  const abortUpload = () => {
    // Best-effort cleanup; ignore failures. keepalive lets it survive an
    // in-progress navigation/unmount.
    void fetch(`${baseUrl()}/upload/multipart/abort`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...uploadAuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({ key, uploadId, bucket: opts.bucket }),
      keepalive: true,
    }).catch(() => {});
  };

  const parts: ({ partNumber: number; etag: string } | undefined)[] = new Array(partCount);

  // Upload one part via XHR — XHR exposes upload progress; fetch does not.
  const uploadPart = (index: number) =>
    new Promise<void>((resolve, reject) => {
      const start = index * partSize;
      const end = Math.min(start + partSize, total);
      const blob = file.slice(start, end);
      const partNumber = index + 1;

      const xhr = new XMLHttpRequest();
      xhr.open(
        'PUT',
        `${baseUrl()}/upload/multipart/part?key=${encodeURIComponent(key)}` +
          `&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}` +
          (opts.bucket ? `&bucket=${opts.bucket}` : ''),
      );
      xhr.withCredentials = true;
      const token = localStorage.getItem('auth_token');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      const onAbort = () => xhr.abort();

      xhr.upload.onprogress = (e) => {
        loaded[index] = e.loaded;
        emit();
      };
      xhr.onload = () => {
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const r = JSON.parse(xhr.responseText) as { etag: string };
            parts[index] = { partNumber, etag: r.etag };
            loaded[index] = end - start; // pin to exact part size on success
            emit();
            resolve();
          } catch {
            reject(new Error('Bad part response'));
          }
        } else {
          let msg = `Part ${partNumber} failed (HTTP ${xhr.status})`;
          try {
            const e = JSON.parse(xhr.responseText) as { error?: string };
            if (e.error) msg = e.error;
          } catch {
            /* non-JSON error body — keep generic message */
          }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => {
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        reject(new Error(`Part ${partNumber} network error`));
      };
      xhr.onabort = () => {
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        reject(new DOMException('Upload cancelled', 'AbortError'));
      };

      if (opts.signal) {
        if (opts.signal.aborted) {
          reject(new DOMException('Upload cancelled', 'AbortError'));
          return;
        }
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      xhr.send(blob);
    });

  // 2) Upload parts with bounded concurrency + per-part retry.
  try {
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= partCount) return;
        let attempt = 0;
        for (;;) {
          try {
            await uploadPart(i);
            break;
          } catch (e) {
            // Don't retry a deliberate cancel.
            if (opts.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
              throw e;
            }
            if (++attempt > 2) throw e;
            loaded[i] = 0;
            emit();
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, partCount) }, worker));
  } catch (err) {
    abortUpload();
    throw err;
  }

  // 3) Complete.
  const completeRes = await fetch(`${baseUrl()}/upload/multipart/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...uploadAuthHeaders() },
    credentials: 'include',
    body: JSON.stringify({ key, uploadId, parts, bucket: opts.bucket }),
  });
  const completed = (await completeRes.json().catch(() => ({}))) as {
    url?: string;
    key?: string;
    error?: string;
  };
  // Public bucket → `url` (/media/<key>); private bucket → `key` only.
  const handle = completed.url ?? completed.key;
  if (!completeRes.ok || !handle) {
    abortUpload();
    throw new Error(completed.error || 'Failed to finalize upload');
  }
  return handle;
}

/**
 * Upload a meeting voice recording to the PRIVATE meeting-audio bucket and
 * return its R2 key (NOT a public URL — meeting audio is streamed only via the
 * signed /meeting-audio route).  Large files transparently use multipart.
 */
/**
 * Захиалагчийн порталын файлыг ХУВИЙН bucket руу байршуулна ба R2 ТҮЛХҮҮРийг
 * буцаана (нийтийн `/media` URL БИШ).
 *
 * Яагаад: `/media/<key>` нь нэвтрэлтгүй, түлхүүр мэдсэн хэн ч уншиж чадах зам.
 * Захиалагчийн гэрээ, геологийн тайлан, бидний гаргасан зургийн багц тэнд
 * байж болохгүй.  Уншилт нь зөвхөн `/api/client-files/*`-ийн эрх шалгасан
 * stream-ээр (backend routes/clientFiles.ts).
 *
 * Том файл (DWG/RVT) автоматаар multipart замаар явна — `uploadMeetingAudio`-
 * тай ижил бүтэц.
 */
export async function uploadClientFile(
  file: File,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<string> {
  if (file.size >= MULTIPART_THRESHOLD) {
    return uploadLargeFile(file, { ...opts, bucket: 'client' });
  }
  const token = localStorage.getItem('auth_token');
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${baseUrl()}/upload?bucket=client`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: formData,
  });
  const result = (await response.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!response.ok || !result.key) throw new Error(result.error || 'Upload failed');
  return result.key;
}

export async function uploadMeetingAudio(
  file: File,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<string> {
  if (file.size >= MULTIPART_THRESHOLD) {
    return uploadLargeFile(file, { ...opts, bucket: 'meeting' });
  }
  const token = localStorage.getItem('auth_token');
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${baseUrl()}/upload?bucket=meeting`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: formData,
  });
  const result = (await response.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!response.ok || !result.key) throw new Error(result.error || 'Upload failed');
  return result.key;
}
