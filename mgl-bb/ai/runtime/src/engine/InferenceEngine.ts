/**
 * MGL AI · ИНФЕРЕНСИЙН ХӨДӨЛГҮҮРИЙН ИНТЕРФЕЙС (§6, §63).
 *
 * ⚠️ ЭНЭ ФАЙЛ БОЛ ХАМГИЙН ЧУХАЛ ХИЙСВЭРЛЭЛ.  Бизнес логик — ERP хэрэгсэл,
 *    Revit интеграц, нууцлалын шүүлт, санал хүсэлтийн хоолой — llama.cpp-г
 *    ХЭЗЭЭ Ч ШУУД дуудахгүй.  Тэгснээр tokenizer, runtime, embedding
 *    загвар, reranker, суурь загвар, сургалтын хэрэгжүүлэлт зургаулаа
 *    ERP/Revit-ийн интеграцыг ДАХИН БИЧИХГҮЙГЭЭР солигдоно (§3).
 *
 * ⚠️ ОДООГИЙН ХЭРЭГЖҮҮЛЭЛТҮҮД:
 *      LlamaCppEngine — llama.cpp-ийн `llama-server`-ийг дэд процессоор
 *                       асааж, локал HTTP-ээр ярина.  ПРОДАКШН.
 *      EchoEngine     — ЗАГВАРГҮЙ детерминист хөдөлгүүр.  Тест, CI, мөн
 *                       загвар татаж дуусаагүй ПЕРВЫЙ АЖИЛЛУУЛАЛТ.
 *
 * ⚠️ EchoEngine НЬ «ХУУРАМЧ AI ENDPOINT» БИШ.  Даалгавар нь «Do not create
 *    fake placeholder AI endpoints» гэж хэлдэг — тэр нь бодит хариу өгч
 *    байгаа МЭТ дүр эсгэхийг хориглосон.  EchoEngine нь эсрэгээр: хариу
 *    бүр нь өөрийгөө `engine: 'echo'` гэж ЗАРЛАЖ, «загвар суулгаагүй
 *    байна» гэдгийг ил хэлнэ.  Ил зарласан орлуулагч нь хуурамч биш.
 */

/** Нэг ээлжийн мессеж — `promptFrame.ts`-ийн `ChatTurn`-тэй ижил хэлбэр. */
export interface EngineTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  turns: EngineTurn[];
  /** Дээд токен.  Хөдөлгүүр нь өөрийн таазаараа дахин хязгаарлаж болно. */
  maxTokens?: number;
  /**
   * ⚠️ ЭДГЭЭР ТАЛБАРУУД БАЙХГҮЙ БАЙСАН НЬ ГАЖГИЙН ШАЛТГААНЫ НЭГ ХЭСЭГ.
   *
   *    2026-09-09 хүртэл энд зөвхөн `temperature` ба `topP` байсан тул
   *    `top_k`, `min_p`, `presence_penalty`-г ХҮССЭН Ч хөдөлгүүрт
   *    хүргэх ЗАМ БАЙГААГҮЙ.  Үр дүнд нь llama.cpp-ийн өгөгдмөл
   *    (top_k=40, min_p=0.05, presence_penalty=0) чимээгүй хүчинтэй
   *    болж, Qwen3-ийн албан ёсны зөвлөмжөөс зөрж байв.
   *
   *    ⚠️ `undefined` нь «загварын албан ёсны өгөгдмөлийг хэрэглэ»
   *       гэсэн утгатай (`samplingPreset.ts`), «0» ГЭСЭН УТГАГҮЙ.
   */
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  presencePenalty?: number;
  /** Зогсоох мөрүүд. */
  stop?: string[];
  /** Цуцлах — хэрэглэгч «Зогсоох» дарахад. */
  signal?: AbortSignal;
}

export type GenerateChunk =
  | { type: 'token'; text: string }
  | { type: 'done'; stopReason: string; usage: TokenUsage }
  | { type: 'error'; message: string };

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface EngineInfo {
  /**
   * Хөдөлгүүр ажиллаж байгаа ч ХҮЛЭЭГДСЭНЭЭС ДООГУУР хурдтай байх
   * шалтгаан (жишээ нь GPU-д буулгаж чадаагүй).
   *
   * ⚠️ `null` нь «бүх зүйл хэвийн» гэсэн үг.  Энэ талбар нь АЛДАА биш —
   *    хөдөлгүүр ажиллаж БАЙНА — харин ажилтан «MGL AI удаан» гэж
   *    дүгнэхээс өмнө шалтгааныг мэдэх ёстой.
   */
  degradedReason?: string | null;
  /** Хөдөлгүүрийн танигч — `llama.cpp` | `echo` | ирээдүйн бусад. */
  engine: string;
  /** MGL AI-ийн ажиллах үеийн хувилбар (`version.ts`-ийн олонлог). */
  runtimeVariant: string;
  /** Ачаалагдсан загварын хувилбар, эсвэл `null`. */
  modelVersion: string | null;
  /** Артефактын нэр — оношилгоонд.  UI-д ХАРАГДАХГҮЙ (§1). */
  artifact: string | null;
  quantization: string | null;
  contextTokens: number;
  loaded: boolean;
  /**
   * ⚠️ ГҮЙЦЭТГЭЛИЙН ТӨЛӨВЛӨГӨӨНИЙ ХУРААНГУЙ (§13, §28).
   *
   *    Эдгээр нь ЗӨВХӨН ОНОШИЛГООНД.  Хэвийн хэрэглэгчийн UI-д
   *    ХАРАГДАХГҮЙ (§5-ийн «порт, түлхүүр, техникийн алдаа
   *    үзүүлэхгүй») — зөвхөн хөгжүүлэгчийн самбарт.
   *
   * ⚠️ ЭНД ЭНГИЙН ТӨРӨЛ БАЙГАА НЬ ЗОРИУД: `LaunchPlan`-ыг импортлох нь
   *    энэ файлыг `perfProfile.ts` → `hardware.ts` руу холбоно.  Тэр
   *    хийсвэрлэл нь хөдөлгүүрийн интерфейс — тодорхой хэрэгжүүлэлтийн
   *    төлөвлөгчөөс ХАМААРАХ ЁСГҮЙ.
   */
  perfProfile?: string | null;
  /** `-1` бүгд · `0` зөвхөн CPU · `'auto'` llama.cpp өөрөө тааруулсан. */
  gpuLayers?: number | 'auto' | null;
  estimatedVramPeakMb?: number | null;
  /**
   * ⚠️ ЗАГВАР АЧААЛАГДСАН МӨЧИД ХЭМЖСЭН GPU-ИЙН НИЙТ ЭЗЭЛХҮҮН (MiB).
   *
   *    ЭНЭ НЬ MGL AI-ИЙН ӨӨРИЙНХ НЬ ХЭМЖЭЭ БИШ — ажлын талбар, хөтөч,
   *    Revit бүгд орсон НИЙТ тоо.  nvidia-smi нь Windows-ийн WDDM дээр
   *    процесс тутмын хуваарилалтыг өгдөггүй ([N/A]), тиймээс энэ нь
   *    хэмжиж болох цорын ганц бодит тоо.
   *
   *    Нэрийг нь `measuredVramMb` гэж бичих нь «MGL AI ийм их эзэлж
   *    байна» гэж УНШИГДАНА — тиймээс `GpuTotal`.  `null` = хэмжиж
   *    чадсангүй.  Төлөвлөлт нь таамгаар, тайлан нь хэмжилтээр (§42).
   */
  measuredGpuTotalMb?: number | null;
  /** Идэвхтэй LoRA адаптерын хувилбар, эсвэл `null` (цэвэр суурь загвар). */
  adapterVersion?: string | null;
  /** Сүүлд ашигласнаас хойших мс — сул зогсолтын шийдвэрт (§6). */
  idleMs?: number | null;
}

export interface EngineHealth {
  ok: boolean;
  loaded: boolean;
  detail: string;
  /** Загвар ачаалсанаас хойшхи хугацаа, мс. */
  uptimeMs: number | null;
}

/**
 * ⚠️ ХЭРЭГЖҮҮЛЭЛТ БҮР ДАРААХ ГЭРЭЭГ ДАГАНА:
 *
 *   1. `load()` нь ИДЕМПОТЕНТ — хоёр удаа дуудахад хоёр процесс АСААХГҮЙ.
 *   2. `generate()` нь ЗААВАЛ `done` эсвэл `error`-оор дуусна.  Дуусаагүй
 *      урсгал нь frontend-ийн spinner-ийг мөнхөд эргүүлнэ.
 *   3. `signal` цуцлагдвал урсгал ТАСАРНА — процесс ҮЛДЭХГҮЙ.
 *   4. `info()` нь загвар ачаалагдаагүй ч ажиллана (`loaded: false`).
 *   5. ХЭЗЭЭ Ч гуравдагч ТӨЛБӨРТЭЙ API руу залгахгүй.  Энэ гэрээг
 *      `ai/runtime/test/engine.test.ts` нь эх кодыг grep-дэж барина.
 */
export interface InferenceEngine {
  load(): Promise<void>;
  unload(): Promise<void>;
  generate(req: GenerateRequest): AsyncIterable<GenerateChunk>;
  info(): EngineInfo;
  health(): Promise<EngineHealth>;
}

/** Ээлжүүдийг чат маягаар нэг мөр болгоно — форматгүй хөдөлгүүрт. */
export function flattenTurns(turns: readonly EngineTurn[]): string {
  const parts: string[] = [];
  for (const t of turns) {
    const tag = t.role === 'system' ? 'СИСТЕМ' : t.role === 'user' ? 'ХЭРЭГЛЭГЧ' : 'ТУСЛАХ';
    parts.push(`${tag}: ${t.content}`);
  }
  parts.push('ТУСЛАХ:');
  return parts.join('\n\n');
}

/**
 * Тэмдэгтээс токены ОЙРОЛЦОО тоо.
 *
 * ⚠️ ЭНЭ БОЛ ТААМАГ, ХЭМЖИЛТ БИШ — нэр нь тэрийг хэлж байна.  Кирилл нь
 *    ASCII-аас ХОЁР дахин их токен иддэг (BPE нь латинд оновчлогдсон), тул
 *    3.0 биш 2.2 хуваана.  Жинхэнэ тоо нь `usage`-аас ирнэ; энэ нь зөвхөн
 *    урьдчилсан төсөвт.
 */
export function estimateTokens(text: string): number {
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const rest = text.length - cyrillic;
  return Math.ceil(cyrillic / 2.2 + rest / 4);
}
