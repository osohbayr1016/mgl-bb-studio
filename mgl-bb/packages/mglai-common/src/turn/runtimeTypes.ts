// ⚠️ ТӨРӨЛ Л — `frontend/src/features/mgl-ai/lib/runtime.ts`-ийн экспортын хос (Session R, Phase 5).
//    Хөтчийн `fetch`-тэй хэрэгжүүлэлт нь тэнд хэвээр; ажилтны PC-ийн runtime loopback-аар ижил
//    хэлбэрийг хэрэгжүүлнэ (`ai/runtime/src/turn.ts`).  Хоёр талыг ХАМТ өөрчил.

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
  | {
      installed: false;
      reason: 'not_running' | 'loopback_permission' | 'loopback_denied';
    }
  | { installed: true; authorized: false; reason: 'blocked' }
  | { installed: true; authorized: true; info: RuntimeInfo };


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

/**
 * МЭДЛЭГИЙН САНГИЙН КАТАЛОГ (runtime `POST /norm/catalog`, 2026-09-18) — «чамд ямар норм байгаа
 * вэ» / «БНбД X юуны тухай вэ».  ⚠️ `ai/retrieval/src/catalog.ts`-ийн ТӨРЛИЙН ХОС — хамт өөрчил.
 * Заалтын агуулга ЭНД ХЭЗЭЭ Ч байхгүй: код · нэр · төлөв · тоо · бүлгийн гарчиг л.
 */
export interface NormCatalogDocumentEntry {
  doc_id: string;
  code: string;
  title_mn: string;
  title_en: string | null;
  effective_status: string;
  pages: number;
  authority: string | null;
  order_date: string | null;
  order_number: string | null;
  effective_from: string | null;
  source_url: string | null;
  chunks: number;
  clauses: number;
  table_rows: number;
  rules: number;
  ingested_at: string;
}

export interface NormCatalogSection {
  path: string;
  n: number;
  clause_from: string | null;
  clause_to: string | null;
  kind: 'clauses' | 'tables' | 'mixed' | 'other';
}

export type NormCatalog =
  | {
      version: string;
      kind: 'inventory';
      documents: NormCatalogDocumentEntry[];
      counts: { documents: number; chunks: number; rules: number; aliases: number };
      registry: { norms: number; active: number; candidate: number; draft: number } | null;
    }
  | {
      version: string;
      kind: 'document';
      document: NormCatalogDocumentEntry;
      sections: NormCatalogSection[];
      sections_total: number;
      appendices: string[];
      tables: string[];
    }
  | {
      version: string;
      kind: 'not_found';
      code: string;
      registry: { code: string; title_mn: string; status: string; source_url: string | null } | null;
    };

export type NormCatalogResult =
  | { ok: true; catalog: NormCatalog }
  | { ok: false; reason: 'not_installed' | 'offline' | 'timeout' | 'error'; detail?: string };

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
