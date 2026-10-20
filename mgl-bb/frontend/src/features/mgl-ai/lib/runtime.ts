/**
 * MGL AI · ЛОКАЛ RUNTIME-ТАЙ ХАРИЛЦАХ КЛИЕНТ.
 *
 * ⚠️ ХОЁР СЕРВЕР, ХОЁР ҮҮРЭГ.  Хөтөч нь:
 *      • Cloudflare Worker руу — хэн болох, эрх, нотолгоо, хэрэгсэл,
 *        яриа хадгалах  (`apiFetch`, JWT-тэй)
 *      • 127.0.0.1:39217 руу — ТОКЕН ҮҮСГЭХ  (энэ файл, суулгацын нууцтай)
 *    Worker нь ХЭЗЭЭ Ч инференс хийхгүй; локал runtime нь ХЭЗЭЭ Ч эрх
 *    шийдэхгүй.  Хоёрыг холих нь эсвэл нууцлалын шүүлтийг ажилтны PC
 *    дээр давхардуулна, эсвэл токен тутмын төлбөр авчирна.
 *
 * ⚠️ ЛОКАЛ RUNTIME БАЙХГҮЙ БАЙХ НЬ ХЭВИЙН.  Ажилтан хараахан суулгаагүй
 *    байж болно.  Тэр үед `probe()` нь `installed: false` буцааж, UI нь
 *    «хайлт + хэрэгслийн үр дүн» горимд ажиллана — алдаа заахгүй.
 */

const DEFAULT_PORT = 39217;
const PROBE_TIMEOUT_MS = 1200;

// ⚠️ ТӨРӨЛ БҮР БАГЦААС (Session R, R3): RuntimeInfo · RuntimeUpdateStatus · ProbeResult · StreamTurn ·
//    StreamCallbacks · NormCitation · NormEvidenceChunk · NormAnswer · NormResult — хөтөч, ажилтны runtime,
//    Revit гурвуулаа `@mgl/mglai-common/turn`-ийн НЭГ тодорхойлолтыг хэрэглэнэ.  `streamGenerate`/`askNorm`
//    ЭНД БАЙХГҮЙ БОЛСОН — `createLocalRuntimeTransport` (fetchTransports.ts) нь тэдний үг үсгийн порт,
//    `lib/browserTurn.ts` түүнийг `runtimeBaseUrl()`-тэй холбоно.  Энэ файлд ЗӨВХӨН хөтчийн runtime-
//    удирдлага үлдэнэ: probe · pair · warmup · profile · update · metrics · загварын төлөв.
import type { RuntimeInfo, RuntimeUpdateStatus, ProbeResult } from '@mgl/mglai-common/turn';

export type {
  RuntimeInfo,
  RuntimeUpdateStatus,
  ProbeResult,
  StreamTurn,
  StreamCallbacks,
  NormCitation,
  NormEvidenceChunk,
  NormAnswer,
  NormResult,
} from '@mgl/mglai-common/turn';

/** Локал runtime-ийн хаяг — порт `mglai.port` тохиргооноос (өгөгдмөл 39217).  `browserTurn.ts` ч үүнийг хэрэглэнэ. */
export function runtimeBaseUrl(): string {
  const port = Number(localStorage.getItem('mglai.port') ?? DEFAULT_PORT);
  return `http://127.0.0.1:${Number.isFinite(port) ? port : DEFAULT_PORT}`;
}

/**
 * Chrome 142+ gates public-site -> loopback requests behind the granular
 * `loopback-network` ("Apps on device") permission.  Querying first keeps
 * background probes/prewarm from throwing a permission prompt on page load;
 * the explicit Connect button calls `probe({ requestPermission: true })`
 * from a user gesture and lets Chrome show the prompt.
 *
 * Older browsers do not know this permission name.  In that case we preserve
 * the previous behavior and simply try the loopback request.
 */
export type LoopbackPermissionState = PermissionState | 'unsupported';

export async function loopbackPermissionState(): Promise<LoopbackPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unsupported';
  try {
    const status = await navigator.permissions.query({
      name: 'loopback-network' as PermissionName,
    });
    return status.state;
  } catch {
    return 'unsupported';
  }
}

type LoopbackRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

function loopbackFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const options: LoopbackRequestInit = {
    ...init,
    targetAddressSpace: 'loopback',
  };
  return fetch(url, options);
}

/**
 * ⚠️ НУУЦ ГАРААР ОРУУЛАХ ШААРДЛАГА ХАСАГДСАН (2026-09-09, эзний заавар).
 *
 * Өмнө нь хэрэглэгч `%LOCALAPPDATA%\MglAi\secret.txt`-ийг хуулж энд
 * оруулах ёстой байсан.  Тэр нь ERP-д АЛЬ ХЭДИЙН нэвтэрсэн хүнээс дахин
 * «нууц» асуудаг байсан бөгөөд аюулгүй байдалд бараг юу ч нэмдэггүй:
 * тэр файл нь ажилтны ӨӨРИЙНХ нь профайлд байдаг тул тухайн машин дээр
 * ажиллаж буй хортой процесс түүнийг зүгээр уншина.
 *
 * Локал үйлчилгээ одоо ЗӨВШӨӨРӨГДСӨН ГАРАЛ ҮҮСЛИЙГ өөрийг нь итгэмжлэл
 * болгон хүлээж авна (`ai/runtime/src/auth.ts` → `isTrustedBrowserOrigin`).
 * Хамгаалалт ХЭВЭЭР: 127.0.0.1 бинд + Origin цагаан жагсаалт.  Хортой
 * хуудас өөрийн Origin-оороо баригдана — JS түүнийг хуурч чадахгүй.
 */

/** Локал runtime ажиллаж байгаа эсэх + эрхтэй эсэх. */
export async function probe(
  options: { requestPermission?: boolean } = {},
): Promise<ProbeResult> {
  // Chrome 142+ дээр background probe нь permission prompt үүсгэх ЁСГҮЙ.
  // Хэрэглэгч "MGL AI-тай холбох" дарсан үед л loopback fetch хийж
  // browser-ийн "Apps on device" зөвшөөрлийг хүснэ.
  if (!options.requestPermission) {
    const permission = await loopbackPermissionState();
    if (permission === 'denied') return { installed: false, reason: 'loopback_denied' };
    if (permission === 'prompt') return { installed: false, reason: 'loopback_permission' };
  }

  // 1. Нэвтрэлтгүй health — «порт дээр байна уу».
  try {
    const res = await loopbackFetch(`${runtimeBaseUrl()}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { installed: false, reason: 'not_running' };
  } catch {
    // Хэрэв fetch-ийг Chrome LNA хаасан бол "суулгаагүй" гэж худал
    // хэлэхгүй — зөвшөөрлийн бодит төлөвийг буцаана.
    const permission = await loopbackPermissionState();
    if (permission === 'denied') return { installed: false, reason: 'loopback_denied' };
    if (permission === 'prompt') return { installed: false, reason: 'loopback_permission' };
    return { installed: false, reason: 'not_running' };
  }

  try {
    // ⚠️ ИТГЭМЖЛЭЛИЙН ТОЛГОЙ ХЭРЭГГҮЙ.  Хөтөч `Origin`-ыг өөрөө тавьдаг
    //    бөгөөд локал үйлчилгээ түүгээр итгэмжилнэ.
    const res = await loopbackFetch(`${runtimeBaseUrl()}/info`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 3),
    });
    // 401/403 = энэ гарал үүсэл цагаан жагсаалтад алга.
    if (!res.ok) return { installed: true, authorized: false, reason: 'blocked' };
    const info = (await res.json()) as RuntimeInfo;
    return { installed: true, authorized: true, info };
  } catch {
    return { installed: true, authorized: false, reason: 'blocked' };
  }
}

/* ================================================================== */
/*  АВТОМАТ ХОСОЛТ (§4) — ХЭРЭГЛЭГЧ ЮУ Ч ОРУУЛАХГҮЙ                     */
/* ================================================================== */

/**
 * ⚠️ ХУУДАС ӨӨРИЙН ERP ТОКЕНОО ЛОКАЛ ҮЙЛЧИЛГЭЭНД ӨГНӨ.
 *
 *    Ажилтан ERP-д АЛЬ ХЭДИЙН нэвтэрсэн.  Локал runtime-д шинэчлэлт
 *    (манифест, адаптер, норм) татах эрх хэрэгтэй — тэр эрхийг ЭНД
 *    дамжуулна.  Ажилтан ямар ч түлхүүр ХАРААГҮЙ, ХУУЛААГҮЙ.
 *
 * ⚠️ ХУУДАС НЭЭГДЭХ БҮРД ДУУДНА.  ERP-ийн сесс 24 цаг амьддаг тул
 *    runtime-д хадгалагдсан токен хуучирна; өдөр бүр шинэчилснээр
 *    хойд дэвсгэрийн шинэчлэлт ажилласаар байна.  УРТ НАСЛАЛТ токен
 *    минтлэх нь ажилтны машин дээр жилийн турш хүчинтэй итгэмжлэл
 *    үлдээх ба тэр нь §40-ийн эсрэг.
 *
 * ⚠️ БҮТЭЛГҮЙТЭЛ НЬ ЧИМЭЭГҮЙ.  Хосолт нь ЧАТАД ХЭРЭГГҮЙ — тэр нь
 *    зөвхөн шинэчлэлтэд.  Алдаа заах нь хэрэглэгчийг айлгах ба тэр
 *    юу ч хийж чадахгүй.
 */
export async function pair(token: string): Promise<boolean> {
  try {
    const res = await loopbackFetch(`${runtimeBaseUrl()}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 3),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * ЗАГВАРЫГ УРЬДЧИЛАН АЧААЛНА (§6).
 *
 * ⚠️ ЯАГААД ХУУДАС НЭЭГДЭХЭД ДУУДДАГ ВЭ.  Локал runtime нь процесс
 *    асахдаа загварыг ОГТ АЧААЛДАГГҮЙ — тэгвэл ажилтан AI-г нээхгүй
 *    өдөр ч 5-6 GB VRAM өдөржин баригдана (Revit-д шууд хохирол).
 *    Харин хуудас нээгдэх нь «ашиглах гэж байна» гэсэн БОДИТ дохио:
 *    ажилтан асуултаа бичих 5-10 секундэд загвар ачаалагдаж дуусна.
 *
 * ⚠️ ХАРИУГ ХҮЛЭЭХГҮЙ.  Ачаалалт 10-20 секунд үргэлжилж болно;
 *    хуудас түүнийг хүлээх ёсгүй.
 */
export async function warmup(): Promise<void> {
  try {
    await loopbackFetch(`${runtimeBaseUrl()}/warmup`, {
      method: 'POST',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 3),
    });
  } catch {
    // Локал runtime байхгүй — хэвийн, `probe()` түүнийг аль хэдийн хэлсэн.
  }
}

/** Гүйцэтгэлийн профайл солино (§13).  ⚠️ Загвар ДАХИН АЧААЛАГДАНА. */
export async function setPerfProfile(
  profile: 'eco' | 'balanced' | 'performance',
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await loopbackFetch(`${runtimeBaseUrl()}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Шинэчлэлт шалгуулна (§20).  ⚠️ Хариуг хүлээхгүй — явц нь `/info`-д. */
export async function checkUpdates(): Promise<void> {
  try {
    await loopbackFetch(`${runtimeBaseUrl()}/update/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 3),
    });
  } catch {
    // хэвийн
  }
}

/**
 * ДИАГНОСТИК (§28) — ХЭВИЙН ХЭРЭГЛЭГЧИД ХАРАГДАХГҮЙ.
 *
 * ⚠️ Энэ хариу нь техникийн тоо (CPU, VRAM, төлөвлөгөө) агуулна.
 *    Түүнийг үндсэн чатын дэлгэцэд ХЭЗЭЭ Ч гаргахгүй — §5-ийн
 *    «Do not show port numbers, localhost URLs, keys, technical errors».
 */
export interface RuntimeMetrics {
  runtime_version: string;
  engine: RuntimeInfo['engine'] & {
    perfProfile?: string | null;
    measuredGpuTotalMb?: number | null;
    idleMs?: number | null;
  };
  engine_health: { ok: boolean; loaded: boolean; detail: string; uptimeMs: number | null };
  busy: boolean;
  idle_ms: number | null;
  idle_unload_ms: number;
  plan: RuntimeInfo['perf'] extends undefined ? unknown : unknown;
  profile: string;
  hardware: RuntimeInfo['hardware'] & {
    cpuCores?: number;
    cpuPhysicalCores?: number;
    isLaptop?: boolean | null;
    onBattery?: boolean | null;
  };
  /** ⚠️ `null` = ХЭМЖИЖ ЧАДСАНГҮЙ, 0 ГЭСЭН ҮГ БИШ. */
  gpu: { utilPct: number | null; vramUsedMb: number | null; vramFreeMb: number | null } | null;
  runtime_process: { rss_mb: number; heap_mb: number; uptime_s: number };
  update: RuntimeUpdateStatus;
  knowledge_installed: boolean;
  measured_at: string;
}

export async function metrics(): Promise<RuntimeMetrics | null> {
  try {
    const res = await loopbackFetch(`${runtimeBaseUrl()}/metrics`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 3),
    });
    if (!res.ok) return null;
    return (await res.json()) as RuntimeMetrics;
  } catch {
    return null;
  }
}

/* ================================================================== */
/*  ЗАГВАРЫН ТӨЛӨВ (§14)                                               */
/* ================================================================== */

/**
 * ЛОКАЛ RUNTIME-ИЙН ТӨЛӨВ (§5).
 *
 * ⚠️ ЭНЭ ДОЛООН ТӨЛӨВ НЬ ДААЛГАВРААС ШУУД ГАРСАН.  Тэдгээрийг
 *    `boolean`-оор орлуулах гэсэн оролдлого нь UI-г буруу болгоно:
 *    «суулгаагүй» ба «суулгасан ч ажиллахгүй байгаа» хоёр нь
 *    ХЭРЭГЛЭГЧИД ТААРАХ ҮЙЛДЭЛ нь ӨӨР (татах товч vs дахин
 *    холбогдох).
 */
export type ModelState =
  /** Суулгаагүй — ганц цэвэрхэн «Татах» товч (§5). */
  | 'NOT_INSTALLED'
  /** Процесс амьд, гэвч загвар хараахан ачаалагдаагүй. */
  | 'STARTING'
  /** Загвар VRAM руу ачаалагдаж байна. */
  | 'MODEL_LOADING'
  | 'READY'
  /** Яг одоо хариулт үүсгэж байна. */
  | 'BUSY'
  /** Шинэчлэлт татаж/суулгаж байна (§20). */
  | 'UPDATING'
  | 'ERROR';

/**
 * `probe()`-ийн үр дүнгээс төлөвийг гаргана.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — сүлжээ дуудахгүй.  UI нь «Загварыг бэлдэж байна»
 *    гэдгийг ЗӨВХӨН бодит `engine_health` дээр тулгуурлан хэлнэ, цагийн
 *    таамгаар БИШ (§5).
 *
 * ⚠️ ШИНЭЧЛЭЛТ НЬ БУСДААС ТЭРГҮҮН ЭЭЛЖИНД.  Татаж байхад «бэлэн» гэж
 *    хэлэх нь хэрэглэгчийг төөрөгдүүлнэ — тэр үед хариулт удаан байж
 *    болно (§20).
 */
export function modelStateOf(p: ProbeResult | null): ModelState {
  if (p === null) return 'STARTING';
  if (!p.installed) return 'NOT_INSTALLED';
  if (!p.authorized) return 'ERROR';

  const u = p.info.update;
  if (u && (u.phase === 'downloading' || u.phase === 'installing')) return 'UPDATING';

  const h = p.info.engine_health;
  if (h.ok && h.loaded) return 'READY';
  // ⚠️ `loaded: true` + `ok: false` = процесс байгаа ч хариу өгөхгүй —
  //    ихэвчлэн үүсгэлт явж байна.
  if (h.loaded && !h.ok) return 'BUSY';
  return 'MODEL_LOADING';
}

/**
 * ⚠️ ХЭРЭГЛЭГЧИД ХАРАГДАХ МӨР — ПОРТ, ЗАМ, ТҮЛХҮҮР ЭНД ОРОХГҮЙ (§5).
 *    Техникийн дэлгэрэнгүй нь ЗӨВХӨН диагностикийн самбарт.
 */
export const MODEL_STATE_LABEL: Record<ModelState, string> = {
  NOT_INSTALLED: 'MGL AI энэ компьютерт суугаагүй байна',
  STARTING: 'MGL AI-г эхлүүлж байна…',
  MODEL_LOADING: 'MGL AI-г бэлдэж байна…',
  READY: 'MGL AI бэлэн',
  BUSY: 'MGL AI ажиллаж байна',
  UPDATING: 'MGL AI шинэчлэгдэж байна…',
  ERROR: 'MGL AI-тай холбогдож чадсангүй',
};

