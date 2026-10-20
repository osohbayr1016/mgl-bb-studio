/**
 * ХУВААЛЦСАН ЭЭЛЖИЙН ХӨДӨЛГҮҮРИЙН ТЭЭВЭР (Session R, Phase 5).
 *
 * `engine.ts` (хөтчийн orchestrator-ийн порт) нь ХОЁР тээврээр л гадаад
 * ертөнцтэй ярина:
 *
 *   backend — MGL AI Worker (`/api/mgl-ai/plan|tool|context|messages|conversations`).
 *             Хөтөч: `apiFetch` (нэвтрэлтийн токен localStorage-оос);
 *             ажилтны PC-ийн runtime: `fetch(controlPlaneUrl)` + Bearer (paired / дуудагчийн).
 *   runtime — локал нормын хайлт (`/norm`) + үүсгэлт (`/generate`, SSE).
 *             Хөтөч: `fetch(127.0.0.1:39217)`; runtime дотор: loopback / in-process.
 *
 * ⚠️ Хоёр тээвэр нь ХӨТЧИЙН `apiFetch` / `runtime.ts`-тэй ЯГ ИЖИЛ семантиктай
 *    байх ёстой (timeoutMs 0 = хязгааргүй; SSE heartbeat/token/done/error; норм 503 =
 *    шингээгээгүй ≠ олдсонгүй).  Семантик зөрвөл хөтөч ба Revit ӨӨР хариулт авна —
 *    энэ бол нэг замын бүх утга.
 *
 * ⚠️ DOM/Node API ЭНД БАЙХГҮЙ.  `AbortSignal`, `performance`, `setTimeout` нь
 *    WinterCG-ийн нийтлэг глобал (хөтөч · Node · Worker гурвуулаа).
 */
import type { NormCatalogResult, NormResult, StreamCallbacks, StreamTurn } from './runtimeTypes.ts';

export interface BackendFetchOptions {
  method: 'POST' | 'GET';
  data?: unknown;
  /** 0 = хязгааргүй (`runStage`-ийн hardMs л барина). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BackendTransport {
  /** `/mgl-ai/...` зам (API-ийн `/api` угтваргүй) — хөтчийн `apiFetch`-тэй ижил. */
  fetch<T = unknown>(path: string, opts: BackendFetchOptions): Promise<T>;
}

export interface RuntimeTransport {
  askNorm(
    question: string,
    opts: { signal?: AbortSignal; timeoutMs?: number; audience?: 'client' | 'employee' },
  ): Promise<NormResult>;
  streamGenerate(
    turns: StreamTurn[],
    cb: StreamCallbacks,
    opts: { maxTokens?: number; signal?: AbortSignal; responseLanguage?: 'mn-Cyrl' | 'en' },
  ): Promise<void>;
  /**
   * Мэдлэгийн сангийн каталог (`POST /norm/catalog`, 2026-09-18) — «чамд ямар норм байгаа вэ» /
   * «БНбД X юуны тухай вэ».  `code=null` = бүх сан.  Сонголттой: хуучин тээвэр/тестийн орлуулагч
   * үүнгүй байж болно — хөдөлгүүр `reason: 'error'` гэж үзнэ (хайлт биш, ээлж үргэлжилнэ).
   */
  askNormCatalog?(
    code: string | null,
    opts: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<NormCatalogResult>;
}

export interface TurnDeps {
  backend: BackendTransport;
  runtime: RuntimeTransport;
}
