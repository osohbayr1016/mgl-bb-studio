/**
 * `fetch`-ЭЭР ХЭРЭГЖСЭН ТЭЭВЭР (Session R, Phase 5) — WinterCG глобал л
 * (`fetch`, `ReadableStream`, `TextDecoder`, `AbortController`): хөтөч · Node 24 ·
 * Worker гурвуулаа.  DOM/localStorage/process ЭНД БАЙХГҮЙ.
 *
 * `createLocalRuntimeTransport` нь хөтчийн `runtime.ts`-ийн `streamGenerate` /
 * `askNorm`-ын ҮГ ҮСГИЙН порт (SSE frame задлалт, 503 = not_installed,
 * timeout ≠ offline).  Ажилтны PC-ийн runtime нь ӨӨРИЙН /generate, /norm руу
 * loopback хийхдээ яг үүнийг хэрэглэнэ — хөтөч ба Revit ИЖИЛ семантик авна.
 *
 * `createBackendTransport` нь `apiFetch`-ийн семантикийн хос: `timeoutMs 0` =
 * хязгааргүй; 2xx биш бол `ApiError { status, body }`; сүлжээний алдаа
 * `ApiNetworkError` (`aiErrors.classifyError` нь ЭДГЭЭР нэрээр л ялгадаг).
 */
import type { BackendFetchOptions, BackendTransport, RuntimeTransport } from './transports.ts';
import type { NormAnswer, NormCatalog, NormCatalogResult, NormResult, StreamCallbacks, StreamTurn } from './runtimeTypes.ts';

/**
 * Хөтчийн `shared/api/client.ts`-ийн `ApiError`-той ТАЛБАР БҮРЭЭР ижил (`status`, `code`,
 * `payload`, `name`) — `aiErrors.classifyError` ба хөтчийн UI хоёулаа ЭДГЭЭР талбарыг уншдаг.
 * Паритетын харнесс (ai/evaluation/parity) хоёр замын `error`-ыг код/төрлөөр тулгадаг.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload: Record<string, unknown>;
  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof payload.code === 'string' ? payload.code : undefined;
    this.payload = payload;
  }
}

/**
 * Хөтчийн `ApiNetworkError`-той ижил: `timedOut` нь `classifyError`-д ЗААВАЛ — үгүй бол
 * `/context`-ийн хугацаа дуусалт `RETRIEVAL_TIMEOUT` биш `BACKEND_OFFLINE` болно (паритетын
 * харнессаар олдсон зөрүү, 2026-09-14).  POST дахин оролддоггүй тул `attempts` үргэлж 1.
 */
export class ApiNetworkError extends Error {
  readonly attempts: number;
  readonly timedOut: boolean;
  readonly original?: unknown;
  constructor(message: string, attempts = 1, timedOut = false, original?: unknown) {
    super(message);
    this.name = 'ApiNetworkError';
    this.attempts = attempts;
    this.timedOut = timedOut;
    this.original = original;
  }
}

export interface BackendTransportOptions {
  /** Жишээ: `https://mgl-progress-api.mglenc-design.workers.dev/api` — `/mgl-ai/...` зам үүн дээр залгагдана. */
  apiBase: string;
  /** Bearer токен — null бол Authorization толгойгүй (401 нь `ApiError`). */
  token: () => Promise<string | null> | string | null;
  /** Өгөгдмөл хугацаа (мс) — `apiFetch`-ийн 12 000; 0 = хязгааргүй. */
  defaultTimeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export function createBackendTransport(o: BackendTransportOptions): BackendTransport {
  const base = o.apiBase.replace(/\/+$/, '');
  return {
    async fetch<T>(path: string, opts: BackendFetchOptions): Promise<T> {
      const timeoutMs = opts.timeoutMs ?? o.defaultTimeoutMs ?? 12_000;
      const guard = new AbortController();
      const onOuter = () => guard.abort();
      opts.signal?.addEventListener('abort', onOuter);
      const timer = timeoutMs > 0 ? setTimeout(() => guard.abort(), timeoutMs) : undefined;
      try {
        const token = await o.token();
        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(o.extraHeaders ?? {}) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        let res: Response;
        try {
          res = await fetch(base + path, {
            method: opts.method,
            headers,
            body: opts.method === 'GET' ? undefined : JSON.stringify(opts.data ?? {}),
            signal: guard.signal,
          });
        } catch (err) {
          if (opts.signal?.aborted) throw err;
          const timedOut = guard.signal.aborted;
          // Мөрүүд apiFetch-тэй ҮГ ҮСГЭЭР ижил — паритетын харнесс error.message-ийг тулгадаг.
          throw new ApiNetworkError(timedOut ? `Сервер ${Math.round(timeoutMs / 1000)} секундэд хариу өгсөнгүй` : 'Сүлжээний алдаа — серверт холбогдож чадсангүй', 1, timedOut, err);
        }
        // apiFetch-тэй ижил: JSON биш хариу → {} (алдаа биш).
        let body: Record<string, unknown> = {};
        try {
          body = ((await res.json()) ?? {}) as Record<string, unknown>;
        } catch {
          body = {};
        }
        if (!res.ok) {
          const msg = (typeof body.error === 'string' && body.error) || 'API Request Failed';
          throw new ApiError(res.status, msg, body);
        }
        return body as unknown as T;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onOuter);
      }
    },
  };
}

type LoopbackFetchInit = RequestInit & { targetAddressSpace?: 'loopback' };

function fetchLoopback(url: string, init: RequestInit): Promise<Response> {
  const options: LoopbackFetchInit = {
    ...init,
    targetAddressSpace: 'loopback',
  };
  return fetch(url, options);
}

export interface LocalRuntimeTransportOptions {
  /** Жишээ: `http://127.0.0.1:39217` — `localhost` БИШ (.NET/WPAD урхи №6; хөтөч ч ижил). */
  baseUrl: string;
  /** `X-MglAi-Secret` / `X-MglAi-Session` гэх мэт — хөтөч дээр хоосон (Origin = итгэмжлэл), runtime-ийн loopback-д нууц. */
  headers?: () => Record<string, string>;
  /** Нормын хайлтын хязгаар — хөтчийн `NORM_TIMEOUT_MS` = 6000. */
  normTimeoutMs?: number;
}

export function createLocalRuntimeTransport(o: LocalRuntimeTransportOptions): RuntimeTransport {
  const base = o.baseUrl.replace(/\/+$/, '');
  const hdr = () => ({ 'Content-Type': 'application/json', ...(o.headers ? o.headers() : {}) });
  return {
    async askNorm(question, opts) {
      const timeout = opts.timeoutMs ?? o.normTimeoutMs ?? 6000;
      const guard = new AbortController();
      const timer = setTimeout(() => guard.abort(), timeout);
      const onOuter = () => guard.abort();
      opts.signal?.addEventListener('abort', onOuter);
      try {
        const res = await fetchLoopback(`${base}/norm`, {
          method: 'POST',
          headers: hdr(),
          body: JSON.stringify({ query: question, audience: opts.audience ?? 'employee', evidence_limit: 5 }),
          signal: guard.signal,
        });
        // 503 = мэдлэг шингээгээгүй.  Энэ нь «олдсонгүй» ГЭСЭН ҮГ БИШ (§17).
        if (res.status === 503) return { ok: false, reason: 'not_installed' } as NormResult;
        if (!res.ok) return { ok: false, reason: 'error', detail: String(res.status) } as NormResult;
        const answer = (await res.json()) as NormAnswer;
        return { ok: true, answer } as NormResult;
      } catch (err) {
        if (opts.signal?.aborted) return { ok: false, reason: 'error', detail: 'cancelled' } as NormResult;
        // ⚠️ TIMEOUT ба OFFLINE-ыг ЯЛГАНА (§17).
        return { ok: false, reason: guard.signal.aborted ? 'timeout' : 'offline', detail: (err as Error).message } as NormResult;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onOuter);
      }
    },

    // `/norm`-той ИЖИЛ семантик: 503 = сан суулгаагүй (олдсонгүй БИШ), timeout ≠ offline.
    async askNormCatalog(code, opts) {
      const timeout = opts.timeoutMs ?? o.normTimeoutMs ?? 6000;
      const guard = new AbortController();
      const timer = setTimeout(() => guard.abort(), timeout);
      const onOuter = () => guard.abort();
      opts.signal?.addEventListener('abort', onOuter);
      try {
        const res = await fetchLoopback(`${base}/norm/catalog`, {
          method: 'POST',
          headers: hdr(),
          body: JSON.stringify({ code }),
          signal: guard.signal,
        });
        if (res.status === 503) return { ok: false, reason: 'not_installed' } as NormCatalogResult;
        if (!res.ok) return { ok: false, reason: 'error', detail: String(res.status) } as NormCatalogResult;
        const catalog = (await res.json()) as NormCatalog;
        return { ok: true, catalog } as NormCatalogResult;
      } catch (err) {
        if (opts.signal?.aborted) return { ok: false, reason: 'error', detail: 'cancelled' } as NormCatalogResult;
        return { ok: false, reason: guard.signal.aborted ? 'timeout' : 'offline', detail: (err as Error).message } as NormCatalogResult;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onOuter);
      }
    },

    async streamGenerate(turns: StreamTurn[], cb: StreamCallbacks, opts) {
      let res: Response;
      try {
        res = await fetchLoopback(`${base}/generate`, {
          method: 'POST',
          headers: hdr(),
          body: JSON.stringify({
            turns,
            max_tokens: opts.maxTokens ?? 1024,
            response_language: opts.responseLanguage ?? 'mn-Cyrl',
          }),
          signal: opts.signal,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        cb.onRejected?.({ status: 0, code: 'unreachable', message: 'Локал MGL AI-тай холбогдож чадсангүй.' });
        cb.onError('Локал MGL AI-тай холбогдож чадсангүй.');
        return;
      }
      if (!res.ok || !res.body) {
        let code: string | null = null;
        let message = `Локал MGL AI алдаа: ${res.status}`;
        try {
          const j = (await res.json()) as { error?: unknown; code?: unknown };
          if (typeof j.error === 'string' && j.error.length > 0) message = j.error;
          if (typeof j.code === 'string') code = j.code;
        } catch {
          /* JSON биш */
        }
        cb.onRejected?.({ status: res.status, code, message });
        cb.onError(message);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (event === 'token') cb.onToken(String(parsed.text ?? ''));
            else if (event === 'heartbeat') cb.onHeartbeat?.(Number(parsed.elapsed_ms ?? 0));
            else if (event === 'start') cb.onStart?.(String((parsed.engine as { engine?: string })?.engine ?? ''));
            else if (event === 'done') cb.onDone(parsed as never);
            else if (event === 'error') cb.onError(String(parsed.message ?? 'Тодорхойгүй алдаа'));
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') cb.onError((err as Error).message);
      } finally {
        reader.cancel().catch(() => undefined);
      }
    },
  };
}
