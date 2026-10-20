/**
 * BrowserTurnAdapter — хөтөч ↔ ХУВААЛЦСАН ЭЭЛЖИЙН ХӨДӨЛГҮҮР (`@mgl/mglai-common/turn`).
 *
 *   MglAiPage (React төлөв, рендер, гүйлгэлт, цуцлалт)
 *       ↓
 *   BrowserTurnAdapter (ЭНЭ ФАЙЛ) — зөвхөн ХӨТЧИЙН УТАС:
 *       ├─ BackendTransport  = `apiFetch` (токен, API host, ApiError/ApiNetworkError семантик — shared/api/client.ts)
 *       ├─ RuntimeTransport  = `createLocalRuntimeTransport(127.0.0.1:<порт>)` (порт `mglai.port`-оос)
 *       └─ MemoryStorage     = localStorage (lib/memory.ts)
 *       ↓
 *   @mgl/mglai-common/turn  — оркестраци · validator · гэрээ · давталт · засвар · нормын семантик · төлөвийн машин
 *
 * ⚠️ ЭНД ХОЁР ДАХЬ ХЭРЭГЖҮҮЛЭЛТ БАЙХГҮЙ, ЗОРИУД: validator, гэрээний хүчээр биелүүлэлт, давталтын
 *    хамгаалалт, засвар, нормын семантик, төлөвийн машин — бүгд багцад.  Хөтөч, ажилтны runtime
 *    (`POST /turn`), Revit add-in гурвуулаа ЯГ нэг `runTurn`-ыг дуудна.
 *    `ai/evaluation/parity/no-second-engine.test.mjs` энэ инвариантыг барина.
 *
 * Паритет: `ai/evaluation/parity/turn-parity.test.mjs` нь коммит 24694e7-ийн хуучин orchestrator-ыг
 * оракул болгон ЭНЭ adapter-тай ижил хуурамч сүлжээгээр тулгадаг (15 кейс).
 */
import { runTurn as engineRunTurn, createLocalRuntimeTransport, type TurnInput, type TurnResult, type TurnDeps, type BackendTransport } from '@mgl/mglai-common/turn';
import { apiFetch } from '@/shared/api/client';
import { runtimeBaseUrl } from './runtime';

/** `apiFetch`-ийг тээвэр болгоно — `timeoutMs 0` = хязгааргүй, POST давтагдахгүй (client.ts). */
const backend: BackendTransport = {
  fetch: <T>(path: string, opts: { method: 'GET' | 'POST'; data?: unknown; timeoutMs?: number; signal?: AbortSignal }) =>
    apiFetch<T>(path, { method: opts.method, data: opts.data, timeoutMs: opts.timeoutMs, signal: opts.signal }),
};

function deps(): TurnDeps {
  // Порт нь тохиргооноос (localStorage `mglai.port`) — ээлж бүрд шинээр уншина.
  return { backend, runtime: createLocalRuntimeTransport({ baseUrl: runtimeBaseUrl() }) };
}

/** Хөтчийн `runTurn` — гарын үсэг хуучин orchestrator-тойгоо ижил (`surface` өгөгдмөл 'web'). */
export function runTurn(input: TurnInput): Promise<TurnResult> {
  return engineRunTurn(input, deps());
}

export type { TurnInput, TurnResult, StageCache } from '@mgl/mglai-common/turn';
