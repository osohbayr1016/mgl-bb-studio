/**
 * `POST /turn` — ХУВААЛЦСАН ЭЭЛЖИЙН ХӨДӨЛГҮҮРИЙГ ажилтны PC дээр хостлоно
 * (Session R, Phase 5).
 *
 *   SHARED_CLIENT_NEUTRAL_TURN_FOUNDATION — хөтөч паритет батлагдтал ӨӨРИЙН orchestrator-оор.
 *   Revit add-in ─┐
 *   хөтөч (ирээдүйд) ┼─→ POST 127.0.0.1:39217/turn ─→ @mgl/mglai-common/turn (packages/mglai-common)
 *   дуу (ирээдүйд) ─┘        (SSE: ai-үйл явдал … result)
 *                                 ├─ backend: Worker /api/mgl-ai/{plan,tool,context,messages} (Bearer)
 *                                 └─ runtime: loopback /norm, /generate (энэ процесс өөрөө)
 *
 * ⚠️ Оркестраци ЭНД ДАВХАРДДАГГҮЙ — хөтчийн `orchestrator.ts`-ийн порт болох
 *    `engine.ts`-ийг л дуудна.  Validator, гэрээ, давталтын хамгаалалт бүгд
 *    тэр нэг замд.  Ямар ч дуудагч `/generate`-ийг норм/инженерийн асуултад
 *    шууд хэрэглэх шаардлагагүй болно.
 *
 * ⚠️ ERP токен: дуудагч `erp_token` өгвөл түүнийг (Revit add-in өөрийн
 *    урт токентой), үгүй бол `/pair`-ээр хадгалсан итгэмжлэлийг хэрэглэнэ.
 *    Токен ХЭЗЭЭ Ч логд/хариуд орохгүй.
 *
 * ⚠️ Нэвтрэлт нь `/generate`-тэй ИЖИЛ (auth.ts-ийн дөрвөн давхарга) —
 *    энэ модуль өөрөө шалгадаггүй, server.ts-ийн `auth` хаалганы ард л дуудагдана.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  runTurn,
  createBackendTransport,
  createLocalRuntimeTransport,
  type TurnInput,
  type TurnResult,
  type AiStreamEvent,
  type ProbeResult,
} from '@mgl/mglai-common/turn';

export interface TurnHostDeps {
  controlPlaneUrl: string;
  /** Loopback-ийн хаяг — `http://127.0.0.1:<port>`. */
  selfUrl: string;
  /** Loopback-д өөрийн нууцаа өгнө (auth.ts-ийн `via: 'secret'`). */
  secret: string;
  /** `/pair`-ээр хадгалсан ERP токен (null = байхгүй). */
  pairedToken: () => Promise<string | null>;
  /** `/info`-гийн хураангуй — engine-д «runtime байгаа» гэж хэлэхэд. */
  runtimeInfo: () => Promise<unknown>;
}

export interface TurnRequestBody {
  question: string;
  conv_uid: string;
  seq?: number;
  user_msg_uid?: string;
  ai_msg_uid?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  conv_state?: unknown;
  surface?: 'web' | 'revit' | 'voice';
  revit_context?: unknown;
  mode?: 'client' | 'employee' | 'admin' | 'denied';
  erp_token?: string;
  /** false = зөвхөн үүсгэлт (хадгалахгүй) — тестэд. */
  persist?: boolean;
}

const MAX_QUESTION = 4000;
const MAX_HISTORY = 20;

function newUid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Бие задлалт + хязгаар — 400 буцаах шалтгааныг мөрөөр өгнө. */
export function parseTurnBody(raw: unknown): { ok: true; body: TurnRequestBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'JSON объект хүлээж байна.' };
  const b = raw as Record<string, unknown>;
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (question.length === 0) return { ok: false, error: 'question хоосон байна.' };
  if (question.length > MAX_QUESTION) return { ok: false, error: `question ${MAX_QUESTION} тэмдэгтээс урт.` };
  const convUid = typeof b.conv_uid === 'string' && b.conv_uid.trim().length > 0 ? b.conv_uid.trim() : newUid('conv');
  const surface = b.surface === 'revit' || b.surface === 'voice' ? b.surface : 'web';
  const history = Array.isArray(b.history)
    ? (b.history as unknown[])
        .filter((h): h is { role: 'user' | 'assistant'; content: string } =>
          !!h && typeof h === 'object' && ((h as { role?: unknown }).role === 'user' || (h as { role?: unknown }).role === 'assistant') && typeof (h as { content?: unknown }).content === 'string')
        .slice(-MAX_HISTORY)
    : [];
  const mode = b.mode === 'client' || b.mode === 'admin' || b.mode === 'denied' ? b.mode : 'employee';
  return {
    ok: true,
    body: {
      question,
      conv_uid: convUid,
      seq: typeof b.seq === 'number' && Number.isFinite(b.seq) ? Math.max(0, Math.floor(b.seq)) : 0,
      user_msg_uid: typeof b.user_msg_uid === 'string' ? b.user_msg_uid : newUid('u'),
      ai_msg_uid: typeof b.ai_msg_uid === 'string' ? b.ai_msg_uid : newUid('a'),
      history,
      conv_state: b.conv_state ?? null,
      surface,
      revit_context: b.revit_context ?? undefined,
      mode,
      erp_token: typeof b.erp_token === 'string' && b.erp_token.length >= 20 ? b.erp_token : undefined,
      persist: b.persist !== false,
    },
  };
}

/** SSE frame бичигч — хөтчийн `runtime.ts`-ийн задлагчтай ижил хэлбэр (`event:` + `data:` + хоосон мөр). */
function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** `TurnResult`-оос дуудагчид явах хэсэг — `cache` (prompt, нотолгооны бүтэн текст) ЯВАХГҮЙ. */
export function publicResult(r: TurnResult): Omit<TurnResult, 'cache'> {
  const { cache: _cache, ...rest } = r;
  return rest;
}

export async function handleTurn(req: IncomingMessage, res: ServerResponse, rawBody: unknown, deps: TurnHostDeps): Promise<void> {
  const parsed = parseTurnBody(rawBody);
  if (!parsed.ok) {
    const payload = JSON.stringify({ error: parsed.error, code: 'bad_request' });
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
    return;
  }
  const b = parsed.body;
  const token = b.erp_token ?? (await deps.pairedToken());
  if (!token) {
    const payload = JSON.stringify({ error: 'ERP нэвтрэлт алга — /pair хийгээгүй, erp_token ч ирээгүй.', code: 'auth_required' });
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const abort = new AbortController();
  req.on('close', () => abort.abort());

  const backend = createBackendTransport({
    apiBase: deps.controlPlaneUrl.replace(/\/+$/, '') + '/api',
    token: () => token,
  });
  const runtime = createLocalRuntimeTransport({
    baseUrl: deps.selfUrl,
    headers: () => ({ 'X-MglAi-Secret': deps.secret }),
  });

  let info: unknown = null;
  try {
    info = await deps.runtimeInfo();
  } catch {
    info = null;
  }
  const probe: ProbeResult = info
    ? ({ installed: true, authorized: true, info } as ProbeResult)
    : ({ installed: false, reason: 'not_running' } as ProbeResult);

  const input: TurnInput = {
    question: b.question,
    convUid: b.conv_uid,
    userMsgUid: b.user_msg_uid!,
    aiMsgUid: b.ai_msg_uid!,
    seq: b.seq ?? 0,
    history: b.history ?? [],
    convState: (b.conv_state ?? null) as never,
    runtime: probe,
    mode: b.mode ?? 'employee',
    surface: b.surface,
    revitContext: b.revit_context,
    signal: abort.signal,
    emit: (e: AiStreamEvent) => {
      if (!res.writableEnded) sse(res, 'ai', e);
    },
    generationOnly: b.persist === false,
  } as TurnInput;

  try {
    const result = await runTurn(input, { backend, runtime });
    if (!res.writableEnded) sse(res, 'result', publicResult(result));
  } catch (err) {
    if (!res.writableEnded) sse(res, 'error', { message: (err as Error).message, name: (err as Error).name });
  } finally {
    if (!res.writableEnded) res.end();
  }
}
