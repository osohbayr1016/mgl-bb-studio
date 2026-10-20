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

export interface RuntimeInfo {
  service: string;
  runtime_version: string;
  engine: {
    engine: string;
    runtimeVariant: string;
    modelVersion: string | null;
    quantization: string | null;
    contextTokens: number;
    loaded: boolean;
  };
  engine_reason: string;
  engine_health: { ok: boolean; loaded: boolean; detail: string };
  hardware: {
    cpu: string;
    gpu: string | null;
    vramMb: number | null;
    ramMb: number;
  };
  active_model: { version: string; runtimeVariant: string } | null;
  /** Гүйцэтгэлийн профайл ба төлөвлөгөө (§13).  Хуучин runtime дээр БАЙХГҮЙ. */
  perf?: {
    profile: 'eco' | 'balanced' | 'performance';
    source: 'env' | 'user' | 'auto';
    label: { name: string; hint: string };
    options: { key: 'eco' | 'balanced' | 'performance'; name: string; hint: string }[];
    plan: {
      contextTokens: number;
      gpuLayers: number | 'auto';
      threads: number;
      estimatedVramPeakMb: number | null;
      vramHeadroomMb: number | null;
      reason: string;
    } | null;
    notices: string[];
  };
  /** Идэвхтэй LoRA адаптер — «MGL AI 1.2» гэсэн шошго эндээс (§17). */
  adapter?: { version: string; releaseUid: string } | null;
  /** Чимээгүй шинэчлэлтийн явц (§20). */
  update?: RuntimeUpdateStatus;
  /**
   * ⚠️ ХОСОЛСОН ЭСЭХ — ТОКЕН ӨӨРӨӨ ХЭЗЭЭ Ч БУЦААГДАХГҮЙ.  Хуудас
   *    зөвхөн «дахин хосло» гэдгийг шийдэхэд ашиглана (§4).
   */
  paired?: boolean;
  /**
   * Session B — суулгацын таних тэмдэг + бүрэлдэхүүн тус бүрийн хувилбар
   * (`ai/deployment`).  Хуучин runtime дээр БАЙХГҮЙ; санал хүсэлтийн тамгад.
   */
  deployment?: { installation_id: string; channel: string; versions: Record<string, string>; release: string | null } | null;
}

/** ⚠️ `ai/runtime/src/updater.ts`-ийн `UpdateStatus`-ийн ХОСЛОЛ (twin). */
export interface RuntimeUpdateStatus {
  phase: 'idle' | 'checking' | 'downloading' | 'installing' | 'ready' | 'failed';
  what: string | null;
  percent: number | null;
  message: string | null;
  lastCheckedAtMs: number | null;
  error: string | null;
  restartRequired: boolean;
}

export type ProbeResult =
  | { installed: false; reason: 'not_running' }
  | { installed: true; authorized: false; reason: 'blocked' }
  | { installed: true; authorized: true; info: RuntimeInfo };

function baseUrl(): string {
  const port = Number(localStorage.getItem('mglai.port') ?? DEFAULT_PORT);
  return `http://127.0.0.1:${Number.isFinite(port) ? port : DEFAULT_PORT}`;
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
export async function probe(): Promise<ProbeResult> {
  // 1. Нэвтрэлтгүй health — «порт дээр байна уу».
  try {
    const res = await fetch(`${baseUrl()}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { installed: false, reason: 'not_running' };
  } catch {
    return { installed: false, reason: 'not_running' };
  }

  try {
    // ⚠️ ИТГЭМЖЛЭЛИЙН ТОЛГОЙ ХЭРЭГГҮЙ.  Хөтөч `Origin`-ыг өөрөө тавьдаг
    //    бөгөөд локал үйлчилгээ түүгээр итгэмжилнэ.
    const res = await fetch(`${baseUrl()}/info`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 3),
    });
    // 403 = энэ гарал үүсэл цагаан жагсаалтад алга (жишээ нь ERP-ийг
    // танихгүй домэйнээс нээсэн).  Хэрэглэгчээс засах юм байхгүй.
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
    const res = await fetch(`${baseUrl()}/pair`, {
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
    await fetch(`${baseUrl()}/warmup`, {
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
    const res = await fetch(`${baseUrl()}/profile`, {
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
    await fetch(`${baseUrl()}/update/check`, {
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
    const res = await fetch(`${baseUrl()}/metrics`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 3),
    });
    if (!res.ok) return null;
    return (await res.json()) as RuntimeMetrics;
  } catch {
    return null;
  }
}

export interface StreamTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onStart?: (engine: string) => void;
  onToken: (text: string) => void;
  /**
   * ⚠️ ЦОХИЛТ (§10).  Prefill удаан үед локал runtime 2 секунд тутам
   *    илгээнэ.  UI-д ШИНЭ МӨР НЭМЭХГҮЙ — зөвхөн «амьд» гэдгийг
   *    баталгаажуулна, ингэснээр удаашралыг тасалдлаас ялгана.
   */
  onHeartbeat?: (elapsedMs: number) => void;
  /**
   * Урсгал ЭХЛЭХЭЭС ӨМНӨ runtime татгалзсан (4xx/5xx JSON).  `code` нь
   * runtime-ийн `code` талбар (`context_overflow` гэх мэт), `status` нь HTTP.
   * (Session C: өмнө нь «Локал MGL AI алдаа: 413» гэсэн утгагүй мөр л байв.)
   */
  onRejected?: (info: { status: number; code: string | null; message: string }) => void;
  onDone: (meta: {
    /**
     * ⚠️ `stop` | `length` | `aborted` | `repetition` | `timeout`.
     *
     *    `repetition` нь локал runtime ДАВТАЛТ илрүүлж үүсгэлтийг
     *    ЗОГСООСОН гэсэн үг (`ai/runtime/src/repetition.ts`).  Тэр
     *    хариултыг ЗӨВ гэж үзэж ХАДГАЛАХГҮЙ (§7).
     */
    stop_reason: string;
    repetition?: { cycle_words: number; repeats: number } | null;
    first_token_ms: number | null;
    total_ms: number;
    engine: string;
    runtime_variant: string;
    usage: { promptTokens: number | null; completionTokens: number | null };
  }) => void;
  onError: (message: string) => void;
}

/**
 * SSE урсгалыг уншина.
 *
 * ⚠️ `EventSource` АШИГЛААГҮЙ, ЗОРИУД: тэр нь POST хийж чаддаггүй,
 *    толгой нэмж чаддаггүй.  `fetch` + гараар задлах нь энэ хоёрыг
 *    хоёуланг нь өгнө, мөн `AbortSignal`-аар «Зогсоох» товч ажиллана.
 */
export async function streamGenerate(
  turns: StreamTurn[],
  cb: StreamCallbacks,
  opts: {
    maxTokens?: number;
    signal?: AbortSignal;
    /**
     * СЕРВЕР шийдсэн хариултын хэл (§3).
     *
     * ⚠️ Локал runtime руу ДАМЖУУЛНА — оношилгоо, ирээдүйн загварын
     *    сонголтод хэрэгтэй.  Хэлний ТУШААЛ өөрөө систем зааварт аль
     *    хэдийн орсон (`promptFrame.ts`).
     */
    responseLanguage?: 'mn-Cyrl' | 'en';
  } = {},
): Promise<void> {
  let res: Response;
  try {
    // ⚠️ Итгэмжлэлийн толгойгүй — `Origin` нь итгэмжлэл (auth.ts).
    res = await fetch(`${baseUrl()}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turns,
        max_tokens: opts.maxTokens ?? 1024,
        response_language: opts.responseLanguage ?? 'mn-Cyrl',
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    // status 0 = runtime-д ОГТ хүрсэнгүй (унтарсан/порт хаалттай).
    cb.onRejected?.({ status: 0, code: 'unreachable', message: 'Локал MGL AI-тай холбогдож чадсангүй.' });
    cb.onError('Локал MGL AI-тай холбогдож чадсангүй.');
    return;
  }

  if (!res.ok || !res.body) {
    // ⚠️ Runtime-ийн JSON тайлбарыг ХАЯХГҮЙ — 413 `context_overflow`, 503
    //    «загвар суулгаагүй» нь хэрэглэгчид өөр өөр зөвлөгөө шаарддаг.
    let code: string | null = null;
    let message = `Локал MGL AI алдаа: ${res.status}`;
    try {
      const j = (await res.json()) as { error?: unknown; code?: unknown };
      if (typeof j.error === 'string' && j.error.length > 0) message = j.error;
      if (typeof j.code === 'string') code = j.code;
    } catch {
      /* JSON биш — статусын мөр хэвээр */
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
        else if (event === 'heartbeat')
          cb.onHeartbeat?.(Number(parsed.elapsed_ms ?? 0));
        else if (event === 'start') cb.onStart?.(String((parsed.engine as { engine?: string })?.engine ?? ''));
        else if (event === 'done') cb.onDone(parsed as never);
        else if (event === 'error') cb.onError(String(parsed.message ?? 'Тодорхойгүй алдаа'));
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      cb.onError((err as Error).message);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/* ================================================================== */
/*  НОРМЫН ЛОКАЛ САН (§17)                                             */
/* ================================================================== */

/**
 * ⚠️ ЯАГААД ХӨТӨЧ ДУУДАХ ЁСТОЙ ВЭ.  Норматив мэдлэг нь ажилтны PC дээрх
 *    SQLite-д (эзний §11 — CLAUDE.md).  Cloudflare Worker нь ажилтны
 *    127.0.0.1 руу хүрч ЧАДАХГҮЙ, тиймээс энэ дуудлагыг хийх ЦОРЫН ГАНЦ
 *    газар нь хөтөч.  Үр дүн нь `/context` рүү явж, СЕРВЕР дээр
 *    prompt-д угсарна — «угсралтын ЦОРЫН ГАНЦ газар» инвариант хэвээр.
 *
 * ⚠️ ХЭМЖИГДСЭН (2026-09-09): §17-ийн асуулт 16 мс-д зөв заалт буцаана
 *    (УББ 12-01-01, заалт 2.5, х.6).  Тиймээс энэ хөл нь УДААН БИШ —
 *    хэрэв удаавал тэр нь ямар нэг зүйл буруу болсны шинж.
 */
export interface NormCitation {
  document: string | null;
  doc_id: string | null;
  clause: string | null;
  page: number | null;
  label_mn: string | null;
  table: number | null;
  row: string | null;
  legal_review_required?: boolean;
  effective_status?: string;
}

export interface NormEvidenceChunk {
  chunk_id: string;
  kind: string;
  text_mn: string;
  page: number | null;
  clause_no: string | null;
  score: number;
}

export interface NormAnswer {
  status: 'verified' | 'supported' | 'uncertain' | 'insufficient_evidence';
  rule_id: string | null;
  rule_object_mn: string | null;
  citation: NormCitation | null;
  evidence: NormEvidenceChunk[];
  note_mn: string | null;
  missing_context: string[];
  elapsed_ms: number;
}

export type NormResult =
  | { ok: true; answer: NormAnswer }
  /** ⚠️ Сан суулгаагүй нь АЛДАА БИШ — ажилтан хараахан шингээгээгүй байж болно. */
  | { ok: false; reason: 'not_installed' | 'offline' | 'timeout' | 'error'; detail?: string };

/**
 * Локал нормын сангаас асууна.
 *
 * ⚠️ ЭНД ЗАГВАР ДУУДАГДАХГҮЙ — `/norm` нь детерминист хайлт + дүрмийн
 *    хөдөлгүүр (§35).  Тиймээс энэ дуудлага нь МАГАДЛАЛГҮЙ: ижил
 *    асуултад ижил заалт буцаана.
 */
export async function askNorm(
  question: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; audience?: 'client' | 'employee' } = {},
): Promise<NormResult> {
  const timeout = opts.timeoutMs ?? NORM_TIMEOUT_MS;
  const guard = new AbortController();
  const timer = setTimeout(() => guard.abort(), timeout);
  const onOuter = () => guard.abort();
  opts.signal?.addEventListener('abort', onOuter);

  try {
    const res = await fetch(`${baseUrl()}/norm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: question,
        audience: opts.audience ?? 'employee',
        evidence_limit: 5,
      }),
      signal: guard.signal,
    });
    // 503 = мэдлэг шингээгээгүй.  Энэ нь «олдсонгүй» ГЭСЭН ҮГ БИШ (§17).
    if (res.status === 503) return { ok: false, reason: 'not_installed' };
    if (!res.ok) return { ok: false, reason: 'error', detail: String(res.status) };
    const answer = (await res.json()) as NormAnswer;
    return { ok: true, answer };
  } catch (err) {
    if (opts.signal?.aborted) return { ok: false, reason: 'error', detail: 'cancelled' };
    // ⚠️ TIMEOUT ба OFFLINE-ыг ЯЛГАНА (§17-ийн хатуу шаардлага): нэг нь
    //    «удаан», нөгөө нь «байхгүй».  Хоёуланг нь «эх сурвалж
    //    олдсонгүй» гэж нэгтгэвэл хэрэглэгч санд байхгүй гэж БУРУУ
    //    дүгнэнэ.
    return { ok: false, reason: guard.signal.aborted ? 'timeout' : 'offline', detail: (err as Error).message };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuter);
  }
}

/** Нормын хайлтын хязгаар.  Хэмжсэн дундаж нь 8-18 мс тул 6 сек нь өгөөмөр. */
const NORM_TIMEOUT_MS = 6000;

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

