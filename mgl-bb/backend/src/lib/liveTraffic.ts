/**
 * LIVE TRAFFIC — System Workbench-ийн «ямар хүсэлт систем дундуур яаж урсаж
 * байна» гэсэн амьд харагдацын эх үүсвэр (`/app/admin/system-workbench`).
 *
 * Зардлын загвар (энэ файлын оршин байх шалтгаан):
 *
 *   • D1/KV/R2 рүү ЮУ Ч БИЧИХГҮЙ.  Үйл явдал isolate-ийн санах ойд л цугларна.
 *   • Хэн ч хуудсыг ҮЗЭЭГҮЙ үед («зэвсэглээгүй») isolate бүр хамгийн ихдээ
 *     `PROBE_MS` тутам НЭГ жижиг «probe»-оор DO-оос «үзэж байгаа хүн байна уу?»
 *     гэж асууна — хүсэлтгүй isolate юу ч илгээхгүй.  Бусад үйл явдал хаягдана.
 *   • Үзэгч байвал (DO хариундаа `watchers > 0`) isolate `ARMED_MS` хугацаанд
 *     зэвсэглэж, үйл явдлаа `FLUSH_MS` тутам НЭГ багцаар DO руу түлхэнэ.
 *     Хүсэлт бүрд DO дуудлага ХЭЗЭЭ Ч хийхгүй.
 *   • WebSocket-ийн гар барилтыг хүлээн авсан isolate шууд зэвсэглэнэ
 *     (`armLiveTraffic`) — хуудас нээгдмэгц тэр isolate-ийн урсгал харагдана,
 *     бусад isolate дараагийн probe дээрээ (≤ `PROBE_MS`) нэгдэнэ.
 *
 * ⚠️ Олон-tenant горимд (`hasTenantContext()`) ЮУ Ч БҮРТГЭХГҮЙ — DO нэг тул
 *    компаниудын урсгал холилдоно.
 * ⚠️ Query string ХЭЗЭЭ Ч дамжуулахгүй (`?t=<jwt>` г.м. токен байдаг), замын
 *    id/түлхүүрийг `:id`/`:key` болгоно (`normalizeLivePath`).
 * ⚠️ Модулийн түвшний Promise-ийг өөр хүсэлт ХҮЛЭЭХГҮЙ (cross-request promise
 *    нь Worker-ийг гацаадаг) — `flushScheduled` нь зөвхөн boolean туг; таймер
 *    нь түүнийг үүсгэсэн хүсэлтийн `waitUntil`-д л амьдарна.
 */

export type LiveKind = 'http' | 'cron' | 'mcp';

/** Нэг хүсэлт / cron ажил.  Түлхүүр богино — багц ~120 мөр WebSocket-ээр явна. */
export interface LiveEvent {
  /** Дууссан агшин, ms epoch. */
  t: number;
  k: LiveKind;
  /** HTTP method, cron-д `CRON`. */
  m: string;
  /** Хэвийжүүлсэн зам, cron-д ажлын нэр. */
  p: string;
  /** HTTP статус (cron: 200 амжилттай / 500 алдаа). */
  s: number;
  /** Нийт хугацаа, ms. */
  ms: number;
  /** D1 query тоо / уншсан мөр / бичсэн мөр. */
  q: number;
  r: number;
  w: number;
  /** Хэрэглэгчийн id ба role (нэвтрээгүй бол null). */
  u: number | null;
  role: string | null;
  /** Cloudflare colo (ж: `HKG`). */
  c: string | null;
  /** Edge кэш (`MEM` | `HIT` | `MISS`) — `withEdgeCache`-ийн толгой. */
  ch: string | null;
  /** Хүсэлтийн эх үүсвэр: `'revit'` = Revit add-in (`liveSource`), null = хөтөч / бусад. */
  src?: LiveSource;
}

export type LiveSource = 'revit' | null;

export const LIVE_WS_PATH = '/api/mgl-ai/workbench-live';

const PROBE_MS = 10_000;
const FLUSH_MS = 1_000;
const ARMED_MS = 20_000;
const MAX_BUFFER = 150;
const MAX_PATH = 100;

/* ------------------------------------------------------------------ */
/*  Цэвэр туслахууд (тесттэй)                                          */
/* ------------------------------------------------------------------ */

const NUMERIC = /^\d+$/;
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const HEXISH = /^[0-9a-f]{16,}$/i;

/** Замын сегмент нь id/түлхүүр мэт харагдвал `:id` / `:key` болгоно. */
function normalizeSegment(seg: string): string {
  if (!seg) return seg;
  if (NUMERIC.test(seg)) return ':id';
  if (UUIDISH.test(seg) || HEXISH.test(seg)) return ':key';
  // Drive id (33 тэмдэгт), upload түлхүүр (`12-1759…-ab12.png`), токен г.м. —
  // урт, тоо агуулсан, зай/цэггүй сегмент.
  if (seg.length >= 20 && /\d/.test(seg)) return ':key';
  if (seg.includes('.') && /\d{6,}/.test(seg)) return ':key';
  return seg;
}

/**
 * `/api/projects/41/tasks?x=1` → `/api/projects/:id/tasks`.
 * `/media/<түлхүүр>` → `/media/:key`.  Query, fragment хасагдана.
 */
export function normalizeLivePath(rawPath: string): string {
  const path = rawPath.split(/[?#]/, 1)[0] ?? '';
  if (path.startsWith('/media/')) return '/media/:key';
  const out = path
    .split('/')
    .map((seg) => {
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        /* эвдэрсэн %-кодчилол — түүхийгээр нь */
      }
      return normalizeSegment(decoded);
    })
    .join('/');
  return out.length > MAX_PATH ? `${out.slice(0, MAX_PATH - 1)}…` : out;
}

/**
 * Хүсэлт Revit add-in-ээс ирсэн эсэх.  Add-in-ий бүх HTTP клиент (`ApiClient`,
 * `AiHttp`) `MglRevitAddin/<хувилбар>` User-Agent илгээдэг (Cloudflare UA-гүй
 * хүсэлтийг 1010-оор хаадаг тул ХЭЗЭЭ Ч орхигдохгүй); 1.10+ session токен
 * `purpose:'revit'`.  UA-ийн бичвэр ӨӨРӨӨ үйл явдалд ХЭЗЭЭ Ч орохгүй — ангилал л.
 */
export function liveSource(userAgent: string | null | undefined, purpose?: string | null): LiveSource {
  if (purpose === 'revit' || purpose === 'revit-refresh') return 'revit';
  if (userAgent && userAgent.startsWith('MglRevitAddin')) return 'revit';
  return null;
}

/** Энэ хүсэлтийг бүртгэх үү?  Preflight ба live сувгийн өөрийн гар барилт — үгүй. */
export function shouldRecord(method: string, path: string): boolean {
  if (method === 'OPTIONS') return false;
  if (path === LIVE_WS_PATH) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Isolate-ийн төлөв                                                  */
/* ------------------------------------------------------------------ */

interface LiveEnv {
  WORKBENCH_LIVE?: DurableObjectNamespace;
}

interface WaitCtx {
  waitUntil(promise: Promise<unknown>): void;
}

const state = {
  isolate: '',
  buffer: [] as LiveEvent[],
  armedUntil: 0,
  lastFlush: 0,
  flushScheduled: false,
};

function isolateId(): string {
  // ⚠️ `crypto.randomUUID()`-ийг global scope-д дуудаж болохгүй (Workers хориглодог) —
  //    анхны үйл явдал дээр залхуугаар.
  if (!state.isolate) state.isolate = crypto.randomUUID().slice(0, 6);
  return state.isolate;
}

/** WebSocket-ийн гар барилт хүлээн авсан isolate-ийг шууд зэвсэглэнэ. */
export function armLiveTraffic(now = Date.now()): void {
  state.armedUntil = Math.max(state.armedUntil, now + ARMED_MS);
}

function stub(env: LiveEnv): DurableObjectStub | null {
  const ns = env.WORKBENCH_LIVE;
  if (!ns) return null;
  return ns.get(ns.idFromName('workbench:live'));
}

async function flush(env: LiveEnv, events: LiveEvent[]): Promise<void> {
  const target = stub(env);
  if (!target || events.length === 0) return;
  try {
    const res = await target.fetch('https://workbench-live/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iso: isolateId(), events }),
    });
    const body = (await res.json().catch(() => null)) as { watchers?: number } | null;
    const watchers = typeof body?.watchers === 'number' ? body.watchers : 0;
    state.armedUntil = watchers > 0 ? Date.now() + ARMED_MS : 0;
  } catch {
    // DO түр унасан — зэвсэглэлээ тайлж, дараагийн probe дээр дахин оролдоно.
    state.armedUntil = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Нэг үйл явдлыг бүртгэнэ.  Ямар ч алдаа хүсэлтийг ХЭЗЭЭ Ч унагахгүй.
 * `ctx` байхгүй (тест г.м.) бол юу ч хийхгүй.
 */
export function recordLive(env: LiveEnv, ctx: WaitCtx | null, event: LiveEvent): void {
  if (!env.WORKBENCH_LIVE || !ctx) return;
  try {
    const now = Date.now();
    if (now >= state.armedUntil) {
      // Үзэгчгүй: зөвхөн PROBE_MS тутам нэг probe (энэ үйл явдлыг тээнэ).
      state.buffer.length = 0;
      if (now - state.lastFlush < PROBE_MS) return;
      state.lastFlush = now;
      ctx.waitUntil(flush(env, [event]));
      return;
    }
    state.buffer.push(event);
    if (state.buffer.length > MAX_BUFFER) state.buffer.splice(0, state.buffer.length - MAX_BUFFER);
    if (state.flushScheduled) return;
    state.flushScheduled = true;
    const wait = Math.max(0, FLUSH_MS - (now - state.lastFlush));
    ctx.waitUntil(
      sleep(wait).then(() => {
        state.flushScheduled = false;
        state.lastFlush = Date.now();
        const batch = state.buffer.splice(0, state.buffer.length);
        return flush(env, batch);
      }),
    );
  } catch {
    /* бүртгэл бол нэмэлт — хэзээ ч хүсэлтэд нөлөөлөхгүй */
  }
}

/** Тестэд: isolate-ийн төлөвийг цэвэрлэнэ. */
export function __resetLiveTrafficForTest(): void {
  state.buffer.length = 0;
  state.armedUntil = 0;
  state.lastFlush = 0;
  state.flushScheduled = false;
}
