/**
 * MGL AI · ГҮЙЦЭТГЭЛИЙН ПРОФАЙЛ — «КОМПЬЮТЕРЫГ БҮҮ ХӨШИЛГӨ» (§7–§13).
 *
 * ⚠️ ЭНЭ ФАЙЛ ХЭМЖИЛТЭЭС ТӨРСӨН, ТААМАГЛАЛААС БИШ.
 *
 *    2026-09-09-нд лавлагааны машин дээр (i7-12700KF · 20 логик урсгал ·
 *    RTX 3070 8 GB · Qwen3-8B-Q4_K_M · llama.cpp b10850) хуучин
 *    тохиргоог хэмжсэн (`npm run ai:bench:responsiveness`):
 *
 *      · llama-server-ийн CPU ашиглалт   1.05 / 20 цөм
 *      · GPU ашиглалт                     68.6% дунджаар
 *      · VRAM оргил                       7505 / 8192 MiB  ← ЭНЭ НЬ ГЭМ
 *      · Node-ийн хуваарилалтын хоцрогдол ×1.41 (50 мс+ гацалт 0)
 *
 *    Өөрөөр хэлбэл «компьютер хөшиж байна» гэсэн гомдлын шалтгаан нь CPU
 *    БИШ.  Бүх давхарга GPU дээр байхад llama.cpp нэг цөм ч ашиглахгүй.
 *    Шалтгаан нь VRAM: 8 GB картан дээр 687 MB Л үлдэж байсан.  Windows-
 *    ийн WDDM нь VRAM дүүрэхэд GPU-ийн санах ойг систем RAM руу
 *    ЗӨӨЖ эхэлдэг (eviction).  Хөтчийн композитор, DWM, видео
 *    декодчилол, Revit бүгд VRAM шаарддаг тул тэдгээр нь тасралтгүй
 *    зөөгдөж — яг тэр нь «бүх компьютер удаашрав» гэж мэдрэгддэг.
 *
 * ⚠️ ТИЙМЭЭС ГОЛ ХӨШҮҮРЭГ НЬ VRAM-ЫН НӨӨЦ, thread-ийн тоо БИШ.  Гэхдээ
 *    thread-ийн хязгаар нь CPU-д унасан машинд (GPU-гүй, эсвэл
 *    хэсэгчилсэн буулгалт) ЯГ ТЭР ХЭМЖЭЭНД чухал — тэнд llama.cpp нь
 *    БҮХ цөмийг эзэлнэ.  Хоёулаа энэ файлд.
 *
 * ⚠️ ЗӨВХӨН БОДИТ ДЭМЖИГДСЭН ТУГ (§12).  Доорх туг бүр `llama-server
 *    --help` (b10850) дээр БАЙГАА гэдгийг шалгасан:
 *      -t/--threads · -tb/--threads-batch · --prio · --poll ·
 *      -b/--batch-size · -ub/--ubatch-size · -ctk/-ctv · -fa ·
 *      -c/--ctx-size · -ngl · --cache-reuse · --parallel · --metrics ·
 *      --no-webui · --lora
 *    Шинэ туг нэмэхийн ӨМНӨ `--help`-ээс шалга; байхгүй туг нь
 *    llama-server-ийг ЧИМЭЭГҮЙ унагаана.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЦЭВЭР — сүлжээ, файл, процесс энд БАЙХГҮЙ.  Тиймээс
 *    `test/perfProfile.test.ts` нь бүх төхөөрөмжийн хувилбарыг GPU-гүй
 *    ажиллуулж шалгана.
 */
import type { HardwareProfile } from './hardware.ts';

/* ================================================================== */
/*  ПРОФАЙЛ                                                            */
/* ================================================================== */

/**
 * ⚠️ ГУРВАН ПРОФАЙЛ, ӨГӨГДМӨЛ НЬ `balanced` (§13).
 *
 *    `balanced` нь ХАМГИЙН ХУРДАН БИШ — ЗОРИУД.  Бүтээгдэхүүний шийдвэр:
 *    «20 токен/сек + гөлгөр компьютер» нь «30 токен/сек + хөшсөн
 *    компьютер»-оос ДЭЭР (§12).  Хэрэглэгч хамгийн ихийг хүсвэл
 *    `performance`-ыг ӨӨРӨӨ сонгоно.
 */
export type PerfProfile = 'eco' | 'balanced' | 'performance';

export const PERF_PROFILES: readonly PerfProfile[] = ['eco', 'balanced', 'performance'];

export function isPerfProfile(v: unknown): v is PerfProfile {
  return typeof v === 'string' && (PERF_PROFILES as readonly string[]).includes(v);
}

export const PROFILE_LABEL_MN: Record<PerfProfile, { name: string; hint: string }> = {
  eco: {
    name: 'Хэмнэлттэй',
    hint: 'Хамгийн бага ачаалал. Зөөврийн компьютер, батерей, Revit нээлттэй үед.',
  },
  balanced: {
    name: 'Тэнцвэртэй',
    hint: 'Өгөгдмөл. Компьютер гөлгөр ажиллахыг хурдаас ДЭЭГҮҮР тавина.',
  },
  performance: {
    name: 'Хурдан',
    hint: 'Хамгийн их хурд. Үүсгэлт явж байхад компьютер удааширч болно.',
  },
};

/* ================================================================== */
/*  ЗАГВАРЫН САНАХ ОЙН ТООЦОО                                          */
/* ================================================================== */

/**
 * KV кэшийн нэг токенд ногдох байт.
 *
 * ⚠️ ЭНЭ НЬ ОЙРОЛЦОО ТООЦОО, ЗАГВАРЫН МЕТАДАТА БИШ.  GGUF-ийн толгойг
 *    уншиж яг тоог гаргах нь зөв боловч тэр нь файл нээхийг шаардана —
 *    энэ файл ЦЭВЭР байх ёстой (тестлэгдэнэ).  Тиймээс жингийн
 *    хэмжээнээс параметрийн тоог ТААМАГЛАЖ, тэндээс KV-г гаргана.
 *
 * ⚠️ ДУТУУ ТООЦВОЛ VRAM ДҮҮРНЭ — тиймээс ӨГӨӨМӨР тал руу алдана.
 *    Хэт өгөөмөр тооцвол контекст жижгэрнэ (эвдрэхгүй); хэт багаар
 *    тооцвол WDDM зөөлт эхэлж БҮХ КОМПЬЮТЕР хөших ба тэр нь яг тэр
 *    гажиг юм.
 */
export interface ModelShape {
  /** GGUF файлын хэмжээ, байт. */
  bytesOnDisk: number;
  /** KV кэшийн нэг токенд ногдох байт (f16).  Тодорхойгүй бол `null`. */
  kvBytesPerTokenF16: number | null;
}

/**
 * Мэдэгдэж буй загваруудын KV хэмжээ, нэг токен, f16.
 *
 * ⚠️ ТООЦОО: layers × kv_heads × head_dim × 2 (K ба V) × 2 байт.
 *      Qwen3-8B : 36 × 8 × 128 × 2 × 2 = 147 456 B = 144 KiB
 *      Qwen3-4B : 36 × 8 × 128 × 2 × 2 = 147 456 B  (ижил GQA бүтэц)
 *    Хоёулаа ижил гарч байгаа нь санамсаргүй биш — Qwen3 гэр бүл нь
 *    ижил GQA хэлбэртэй.  Танихгүй загварт `null` буцаана ба тэр үед
 *    жингийн хэмжээнээс ойролцоолно.
 */
const KNOWN_KV_BYTES_PER_TOKEN: { match: RegExp; bytes: number }[] = [
  /**
   * ⚠️ ЭНЭ ТОО НЬ ХЭМЖИГДСЭН, ТООЦООЛОГДООГҮЙ — ХЭМЖИЛТ ОНОЛООС ДЭЭР.
   *
   *    Онолын тооцоо (36 давхарга × 8 KV толгой × 128 хэмжээст × 2 × 2 B)
   *    нь 147 456 B/токен гэж гардаг.  ХЭМЖСЭН (2026-09-09, RTX 3070,
   *    llama.cpp b10850, Qwen3-8B-Q4_K_M, 8192 контекст):
   *
   *      f16  KV → llama-server-ийн VRAM 5 691 MiB
   *      q8_0 KV → llama-server-ийн VRAM 5 298 MiB
   *      зөрүү 393 MiB = f16-ийн 47%  ⇒  f16 KV ≈ 836 MiB / 8192 токен
   *                                   ⇒  ≈ 107 000 B/токен
   *
   *    Онолоос 27% бага.  Шалтгаан нь flash attention + llama.cpp-ийн
   *    кэшийн хуваарилалт; яг механизм нь бидний шийдвэрт хамааралгүй.
   *    ХЭМЖСЭН тоог ашиглана — 27% хэтрүүлж тооцох нь контекстыг
   *    ШААРДЛАГАГҮЙ багасгана.
   */
  { match: /qwen3[-_]?(0\.6|1\.7|4|8)b/i, bytes: 107_000 },
  // ⚠️ 14B нь ХЭМЖИГДЭЭГҮЙ — онолын тоог 0.73 коэффициентээр залруулав.
  //    Хэмжих хүртэл ЭНЭ ТООНД БҮҮ ИТГЭ.
  { match: /qwen3[-_]?14b/i, bytes: 179_000 },
];

export function kvBytesPerToken(artifactName: string | null): number | null {
  if (!artifactName) return null;
  for (const k of KNOWN_KV_BYTES_PER_TOKEN) {
    if (k.match.test(artifactName)) return k.bytes;
  }
  return null;
}

/**
 * KV кэшийн төрлийн санах ойн харьцаа.
 *
 * ⚠️ `q8_0` нь f16-ийн ойролцоогоор ТАЛ — 8 бит + блок тутмын масштаб.
 *    Чанарын алдагдал нь хэмжигдэхүйц бага (llama.cpp-ийн олон
 *    хэмжилтээр perplexity-ийн зөрүү <0.1%) харин 8 GB картан дээр
 *    500-700 MB чөлөөлнө — тэр нь энэ бүтээгдэхүүнд ХАМААРАЛТАЙ ялгаа.
 *
 * ⚠️ q4_0 руу ОРОХГҮЙ.  Тэр нь урт контекст дээр анзаарагдахуйц
 *    доройтол өгдөг ба бид эшлэл, тоо, заалтын дугаар ЗӨВ байхыг
 *    шаарддаг.
 */
export type KvCacheType = 'f16' | 'q8_0';
const KV_RATIO: Record<KvCacheType, number> = { f16: 1, q8_0: 0.53 };

/* ================================================================== */
/*  ХӨӨРӨГДӨХ ТӨЛӨВЛӨГӨӨ                                               */
/* ================================================================== */

export interface LaunchPlan {
  profile: PerfProfile;
  /** `-c` — контекстын цонх. */
  contextTokens: number;
  /**
   * `-ngl` — GPU руу буулгах давхарга.  -1 = бүгд · 0 = зөвхөн CPU ·
   * `'auto'` = llama.cpp ӨӨРӨӨ тааруулна.
   *
   * ⚠️ `'auto'` НЬ ТААМАГЛАЛААС ДЭЭР.  Эхний хувилбар нь хэсэгчилсэн
   *    буулгалтад «32 давхарга» гэж ТААМАГЛАДАГ байсан — загварын
   *    бодит давхаргын тоог мэдэхгүй байж (Qwen3-8B нь 36, 4B нь мөн
   *    36, өөр загвар өөр).  Буруу таамаг нь эсвэл VRAM хэтрүүлнэ
   *    (яг тэр хөшилт), эсвэл GPU-г дутуу ашиглана.
   *
   *    llama.cpp b10850 нь `--fit` (өгөгдмөл асаалттай) + `--fit-target
   *    <MiB>` -ээр ТОХИРУУЛААГҮЙ аргументуудыг төхөөрөмжийн санах ойд
   *    багтаана.  Бид контекстыг ӨӨРСДӨӨ тогтоож, давхаргыг ТҮҮНД
   *    даатгана — тэр нь загварын бодит бүтцийг мэддэг цорын ганц тал.
   */
  gpuLayers: number | 'auto';
  /**
   * `--fit-target` — төхөөрөмж тутамд ҮЛДЭЭХ нөөц, MiB.  `null` = GPU-гүй.
   *
   * ⚠️ ЭНЭ НЬ VRAM-ЫН НӨӨЦИЙГ llama.cpp-ИЙН ӨӨРИЙНХ НЬ НЯГТЛАН БОДОХ
   *    БҮРТГЭЛД ХҮРГЭХ ЗАМ.  Бидний тооцоо ойролцоо; llama.cpp-ийнх
   *    нарийн.  Хоёулаа ижил зорилготой: ажлын талбар, хөтөч, Revit-д
   *    гигабайтууд ҮЛДЭЭХ.
   */
  fitTargetMb: number | null;
  /** `-t` — үүсгэлтийн CPU урсгал. */
  threads: number;
  /** `-tb` — prompt боловсруулалтын CPU урсгал. */
  threadsBatch: number;
  /** `-b` — логик багцын хэмжээ. */
  batchSize: number;
  /** `-ub` — физик (микро) багцын хэмжээ.  GPU-ийн цөмийн урт. */
  ubatchSize: number;
  /** `-ctk` / `-ctv`. */
  kvCacheType: KvCacheType;
  /** `-fa` — flash attention.  `q8_0` KV-д ЗААВАЛ хэрэгтэй. */
  flashAttention: boolean;
  /** `--prio` — llama.cpp-ийн дотоод thread priority. */
  llamaPriority: -1 | 0 | 1 | 2;
  /** `--poll` — 0 = эргэлдэхгүй хүлээнэ (CPU хэмнэнэ). */
  poll: number;
  /**
   * Windows процессын priority (`os.setPriority`).
   * ⚠️ `--prio` нь llama.cpp-ийн ДОТООД thread-ийн зэрэглэл; энэ нь
   *    ПРОЦЕССЫН зэрэглэл.  Хоёр өөр давхарга, хоёулаа хэрэгтэй.
   */
  processPriority: 'below_normal' | 'normal';
  /** Тооцоолсон VRAM оргил, MiB.  `null` = GPU мэдэгдэхгүй. */
  estimatedVramPeakMb: number | null;
  /** Ажиллуулсны дараа үлдэх нөөц VRAM, MiB. */
  vramHeadroomMb: number | null;
  /** Хүн уншиж болох тайлбар — `/info`-д гарна. */
  reason: string;
  /** Энэ загвар энэ машин дээр ажиллах уу. */
  viable: boolean;
  /** ⚠️ Хэрэглэгчид ХЭЛЭХ ёстой буулт (жишээ нь контекст багассан). */
  notices: string[];
}

/* ================================================================== */

/**
 * ⚠️ VRAM-ЫН НӨӨЦ — ЭНЭ БҮТЭЭГДЭХҮҮНИЙ ХАМГИЙН ЧУХАЛ ТОГТМОЛ.
 *
 *    Windows дээр GPU-г ГАНЦААРАА эзэмшдэггүй: DWM (ажлын талбарын
 *    композитор), хөтчийн GPU процесс, видео декодчилол, Revit-ийн
 *    харагдац бүгд нэг картан дээр.  Хэмжсэн: Chrome нь хэдэн таб,
 *    нэг видеотойгоо ~700-900 MB, Revit нь дунд зэргийн загвар дээр
 *    1-2 GB эзэлнэ.
 *
 *    Тиймээс нөөц нь «жаахан» биш, ГИГАБАЙТУУДААР байх ёстой.  Хэрэв
 *    нөөц хүрэхгүй бол WDDM зөөлт эхэлнэ — тэр нь удаашрал БИШ,
 *    ХӨШИЛТ (гацалт секундээр хэмжигдэнэ).
 */
const VRAM_RESERVE_MB: Record<PerfProfile, number> = {
  // Revit + хөтөч зэрэг нээлттэй байхыг таамаглана.
  eco: 2600,
  // Хөтөч + видео + ажлын талбар.  Хэмжсэн хэрэгцээнээс ~2× нөөц.
  balanced: 1800,
  // Зөвхөн ажлын талбар + хөтөч.  Доод хязгаар — үүнээс бага нөөц нь
  // WDDM зөөлтийг БАТАЛГААТАЙ эхлүүлнэ.
  performance: 1100,
};

/**
 * CUDA-гийн контекст + тооцооллын буфер, MiB.
 *
 * ⚠️ ЭНЭ ТООЦООГ ЗАЛРУУЛСАН (2026-09-09).  Анхны хувилбар нь «6541 →
 *    7505 MiB болж өссөн» гэсэн ажиглалтад тулгуурлан тооцооллын
 *    буферыг ~960 MiB гэж үзсэн.  ХЯНАЖ ХЭМЖИХЭД тэр өсөлт нь
 *    llama-server-ийнх БИШ байсан: `loaded` ба `peak` хоёрын зөрүү нь
 *    ХОЁР ЛА MiB (5 298 → 5 300).  Өсөлт нь тэр хугацаанд асаалттай
 *    байсан ажлын талбарын програмуудынх байв.
 *
 *    Өөрөөр хэлбэл llama-server нь БҮХ VRAM-аа АЧААЛАХ ҮЕДЭЭ авдаг —
 *    үүсгэлт нь нэмэлт санах ой БАРАГ авахгүй.  Энэ нь төлөвлөлтөд
 *    сайн мэдээ: оргилыг урьдчилан МЭДЭЖ болно.
 *
 * ⚠️ ЭНЭ ТООЦОО НЬ ЗОРИУД ~5% ЦААШ АЛДДАГ (хэтрүүлж тооцно).  Дутуу
 *    тооцвол VRAM хэтэрч WDDM зөөлт эхэлнэ — тэр нь яг тэр хөшилт.
 *    Хэтрүүлж тооцвол контекст бага зэрэг жижгэрнэ — тэвчигдэнэ.
 */
function computeBufferMb(ubatch: number, contextTokens: number): number {
  const ubPart = (ubatch / 512) * 180;
  const ctxPart = (contextTokens / 8192) * 60;
  // 120 MiB — CUDA контекст, ggml-ийн graph, завсрын буфер.
  return Math.round(ubPart + ctxPart + 120);
}

/**
 * ⚠️ ЖИНГИЙН ЗАМ ДЭЭРХ НЭМЭЛТ 2% — GGUF-ийн файлын хэмжээ нь VRAM-д
 *    эзлэх хэмжээтэй ЯГ тэнцүү биш (тэгшитгэл, метадата).  Хэмжсэнээр
 *    зөрүү нь бага боловч эерэг тал руу алдах нь зөв.
 */
const WEIGHTS_OVERHEAD = 1.02;

/* ================================================================== */
/*  CPU УРСГАЛЫН ТӨЛӨВЛӨЛТ (§10)                                       */
/* ================================================================== */

/**
 * ⚠️ БҮХ ЦӨМИЙГ ХЭЗЭЭ Ч АВАХГҮЙ.  llama.cpp-ийн өгөгдмөл (`-t -1`) нь
 *    бүх боломжит урсгалыг авдаг.  20 урсгалтай машин дээр 20 урсгалыг
 *    100% ачаалах нь Windows-ийн хуваарилагчид хөтчийн input thread,
 *    DWM-д өгөх цаг үлдээхгүй — гар, хулгана хожимдоно.
 *
 * ⚠️ ФИЗИК ЦӨМӨӨР тооцно, ЛОГИКООР БИШ.  Hyper-threading нь ижил
 *    гүйцэтгэх нэгжийг хуваалцдаг тул llama.cpp-ийн матрицын үржвэрт
 *    HT-ийн хос урсгал нь ХУРДЫГ НЭМДЭГГҮЙ, харин ХОЛИМОГ ачааллыг
 *    (хөтөч зэрэг) шахна.
 *
 * ⚠️ ЭНД ГАНЦ ТОО ХАТУУ БИЧИХГҮЙ (§10-ийн шаардлага).  Хувь + доод/дээд
 *    хязгаараар тооцоод машин бүрд өөр гарна.
 *
 * ⚠️ GPU ДЭЭР БҮРЭН АЖИЛЛАЖ БАЙГАА ҮЕД ЭНЭ ТОО БАРАГ ХАМААГҮЙ (хэмжсэн:
 *    1.05 цөм).  Гэхдээ хэсэгчилсэн буулгалт, CPU fallback дээр ЭНЭ НЬ
 *    ЯГ ТЭР ХӨШИЛТИЙГ ШИЙДНЭ — тиймээс үргэлж тавина.
 */
export function planThreads(
  physicalCores: number,
  logicalCores: number,
  profile: PerfProfile,
  gpuFullyOffloaded: boolean,
): { threads: number; threadsBatch: number } {
  const cores = physicalCores > 0 ? physicalCores : Math.max(1, Math.round(logicalCores / 2));

  /**
   * ⚠️ GPU ДЭЭР БҮРЭН БАЙХАД CPU УРСГАЛ БАРАГ ХЭРЭГГҮЙ.  Тэр үед
   *    урсгалууд нь зөвхөн түүвэрлэлт, токенчлол хийдэг — 2 урсгал
   *    хангалттай, илүү нь зөвхөн хуваарилагчийг шахна.
   */
  if (gpuFullyOffloaded) {
    const t = profile === 'performance' ? 4 : 2;
    return { threads: Math.min(t, cores), threadsBatch: Math.min(t + 2, cores) };
  }

  // CPU дээр ажиллаж байгаа (эсвэл хэсэгчилсэн) — энд хувь чухал.
  const share: Record<PerfProfile, number> = {
    eco: 0.4,
    balanced: 0.6,
    performance: 0.85,
  };
  // ⚠️ ДООД ТАЛ НЬ 2, ДЭЭД ТАЛ НЬ «цөм − 2» — үйлдлийн систем ба
  //    интерактив програмд ҮРГЭЛЖ дор хаяж хоёр цөм үлдэнэ (§10).
  const raw = Math.round(cores * share[profile]);
  const threads = Math.max(2, Math.min(raw, Math.max(2, cores - 2)));
  return { threads, threadsBatch: threads };
}

/* ================================================================== */
/*  БАГЦЫН ХЭМЖЭЭ (§12)                                                */
/* ================================================================== */

/**
 * ⚠️ МИКРО БАГЦ НЬ GPU-ИЙН ЦӨМИЙН УРТЫГ ТОДОРХОЙЛНО.
 *
 *    llama.cpp-ийн өгөгдмөл `-ub 512` нь prompt-ыг том хэсгээр
 *    боловсруулна: нэг CUDA цөм удаан ажиллана.  Windows дээр GPU нь
 *    урьдчилан хуваарилагддаггүй (pre-emption нь ХЯЗГААРЛАГДМАЛ) тул
 *    урт цөмийн турш DWM нь кадраа гаргаж чадахгүй — тэр нь «хулгана
 *    үсэрч байна», «гүйлгэхэд таталдаж байна» гэж мэдрэгдэнэ.
 *
 *    Микро багцыг багасгах нь prefill-ийг УДААШРУУЛНА (илүү олон
 *    дуудлага) харин цөм бүр богино болж ажлын талбар амьсгаа авна.
 *    Энэ нь §12-ийн яг тэр буулт: «20 tok/s + гөлгөр» > «30 tok/s +
 *    хөшсөн».
 *
 * ⚠️ ХЭТ ЖИЖИГ БОЛГОХГҮЙ.  32-оос доош байвал дуудлагын нэмэлт зардал
 *    давамгайлж, prefill нь хэдэн ДАХИН удааширна — тэр нь эхний
 *    токены хугацааг мэдэгдэхүйц муутгана.
 */
function planBatch(profile: PerfProfile, gpuFullyOffloaded: boolean): {
  batchSize: number;
  ubatchSize: number;
} {
  if (!gpuFullyOffloaded) {
    // CPU дээр микро багц нь VRAM-д нөлөөлөхгүй; RAM-ыг хэмнэхийн тулд
    // дунд зэрэг барина.
    return profile === 'performance'
      ? { batchSize: 1024, ubatchSize: 256 }
      : { batchSize: 512, ubatchSize: 128 };
  }
  switch (profile) {
    case 'eco':
      return { batchSize: 256, ubatchSize: 64 };
    case 'balanced':
      return { batchSize: 512, ubatchSize: 128 };
    case 'performance':
      return { batchSize: 2048, ubatchSize: 512 };
  }
}

/* ================================================================== */
/*  ГОЛ ТӨЛӨВЛӨГЧ                                                      */
/* ================================================================== */

export interface PlanInput {
  hardware: HardwareProfile;
  profile: PerfProfile;
  model: ModelShape & { artifactName: string | null };
  /** Загварын хүссэн контекст (релизийн метадата).  Дээд хязгаар. */
  desiredContextTokens: number;
}

/**
 * Төхөөрөмж + профайл → llama-server-ийн бүрэн эхлүүлэх төлөвлөгөө.
 *
 * ⚠️ ДАРААЛАЛ ЧУХАЛ (§11-ийн буулгах дараалал).  VRAM хүрэхгүй бол:
 *      1. KV кэшийг q8_0 болгоно      (чанарт бараг нөлөөгүй)
 *      2. контекстыг багасгана        (8K → 6K → 4K → 3K → 2K)
 *      3. микро багцыг багасгана      (тооцооллын буфер)
 *      4. давхаргыг CPU руу буулгана  (ХАМГИЙН СҮҮЛД — энэ нь хурдыг
 *                                      хамгийн их унагаана)
 *    «Загварыг мэдэгдэхүйц муу загвараар солих» нь ЭНД БАЙХГҮЙ (§11) —
 *    тэр шийдвэр нь `hardware.planVariant`-ийнх, мөн зөвхөн загвар
 *    ОГТ багтахгүй үед.
 */
export function planLaunch(input: PlanInput): LaunchPlan {
  const { hardware: hw, profile, model } = input;
  const notices: string[] = [];

  const weightsMb = Math.round(model.bytesOnDisk / (1024 * 1024));
  const kvPerTok =
    model.kvBytesPerTokenF16 ??
    kvBytesPerToken(model.artifactName) ??
    // ⚠️ ТАНИХГҮЙ ЗАГВАР — жингээс ойролцоолно.  4-5 GB жинтэй загвар нь
    //    ерөнхийдөө ~144 KiB/токен KV-тэй; өгөөмөр тал руу алдана.
    (Math.round((model.bytesOnDisk / 5_000_000_000) * 147_456) || 147_456);

  /* ── RAM-ын хаалга ──────────────────────────────────────────── */
  // ⚠️ Загварыг CPU дээр ажиллуулахад жин нь RAM-д БАГТАХ ёстой.
  const minRamMb = weightsMb + 2000;
  if (hw.ramMb < minRamMb && (hw.vramMb === null || hw.vramMb < weightsMb)) {
    return {
      profile,
      contextTokens: 2048,
      gpuLayers: 0,
      fitTargetMb: null,
      threads: 2,
      threadsBatch: 2,
      batchSize: 256,
      ubatchSize: 64,
      kvCacheType: 'q8_0',
      flashAttention: true,
      llamaPriority: -1,
      poll: 0,
      processPriority: 'below_normal',
      estimatedVramPeakMb: null,
      vramHeadroomMb: null,
      reason: `RAM ${hw.ramMb} MB — ${weightsMb} MB жинтэй загварт хүрэлцэхгүй.`,
      viable: false,
      notices: ['Энэ компьютерын санах ой энэ загварт хүрэлцэхгүй байна.'],
    };
  }

  /* ── Apple Silicon → Metal (нэгдсэн санах ой) ───────────────── */
  // NVIDIA байхгүй ч M-цувралын чип нь GPU-тэй (macOS-ийн llama.cpp build нь Metal).
  // CPU-ийн 2 урсгалаар 8B загвар ~4 токен/сек (1100 токены prompt ≈ 4 минут) —
  // хэрэглэх боломжгүй.  Бүх давхаргыг GPU руу буулгаж, CPU урсгалыг цөөн үлдээнэ.
  // Metal-д нэг процессын ажиллах багтаамж ≈ RAM-ын 2/3 (8 GB Mac → ~5.3 GB).  Жин + KV +
  // тооцооллын буфер (~1.2 GB) үүнд багтахгүй бол GPU дээр `Insufficient Memory` гэж унадаг
  // (8B Q4_K_M ≈ 4.7 GB нь 8 GB Mac-д багтахгүй — хэмжсэн), тиймээс CPU зам руу үлдэнэ.
  if (
    hw.vramMb === null &&
    hw.os.startsWith('darwin') &&
    hw.arch === 'arm64' &&
    weightsMb + 1200 <= hw.ramMb * 0.66
  ) {
    const { threads, threadsBatch } = planThreads(hw.cpuPhysicalCores, hw.cpuCores, profile, true);
    const { batchSize, ubatchSize } = planBatch(profile, true);
    notices.push('Apple Silicon илэрлээ — Metal GPU дээр ажиллана.');
    return {
      profile,
      // 8 GB машинд жин (~4.7 GB) нэгдсэн санах ойн дийлэнхийг эзэлнэ — контекстийг барина.
      contextTokens: Math.min(input.desiredContextTokens, hw.ramMb >= 12_000 ? 8192 : 4096),
      gpuLayers: -1,
      fitTargetMb: null,
      threads,
      threadsBatch,
      batchSize,
      ubatchSize,
      kvCacheType: 'q8_0',
      flashAttention: true,
      llamaPriority: 0,
      poll: 0,
      processPriority: 'normal',
      estimatedVramPeakMb: null,
      vramHeadroomMb: null,
      reason: `Apple Silicon (${hw.cpu}) — Metal GPU, бүх давхарга GPU дээр.`,
      viable: true,
      notices,
    };
  }

  /* ── GPU байхгүй / мэдэгдэхгүй → CPU зам ────────────────────── */
  if (hw.vramMb === null) {
    const { threads, threadsBatch } = planThreads(hw.cpuPhysicalCores, hw.cpuCores, profile, false);
    const { batchSize, ubatchSize } = planBatch(profile, false);
    notices.push(
      'NVIDIA GPU илрээгүй тул CPU дээр ажиллана — хариулт удаан боловч ажиллана.',
    );
    return {
      profile,
      contextTokens: Math.min(input.desiredContextTokens, 4096),
      gpuLayers: 0,
      fitTargetMb: null,
      threads,
      threadsBatch,
      batchSize,
      ubatchSize,
      kvCacheType: 'q8_0',
      flashAttention: true,
      llamaPriority: profile === 'performance' ? 0 : -1,
      poll: 0,
      processPriority: profile === 'performance' ? 'normal' : 'below_normal',
      estimatedVramPeakMb: null,
      vramHeadroomMb: null,
      reason: `GPU илрээгүй — CPU дээр ${threads} урсгалаар (${hw.cpuPhysicalCores} физик цөмөөс).`,
      viable: true,
      notices,
    };
  }

  /* ── GPU зам: VRAM-ын төсөв ─────────────────────────────────── */
  const reserve = VRAM_RESERVE_MB[profile];
  const budgetMb = hw.vramMb - reserve;

  /**
   * ⚠️ КОНТЕКСТЫГ 4096-ААС ДООШ БУУЛГАХГҮЙ — ОРОНД НЬ ДАВХАРГА БУУЛГАНА.
   *
   *    Энэ бол ЖИНХЭНЭ БҮТЭЭГДЭХҮҮНИЙ ШИЙДВЭР, техникийн нарийн ширийн
   *    зүйл БИШ.  MGL AI-ийн хариулт нь НОРМЫН ЗААЛТУУД + компанийн
   *    мэдээлэл + асуулт + түүхээс бүрдэнэ; 2048 токен нь тэдгээрийг
   *    багтаахгүй ба `/generate` нь `413 context_overflow` буцаана.
   *    Өөрөөр хэлбэл «хурдан ажилладаг ч хариулж чадахгүй» MGL AI.
   *
   *    Тиймээс VRAM хүрэлцэхгүй үед эхлээд ЖИНГИЙН нэг хэсгийг CPU руу
   *    буулгана (удаашрана, гэхдээ ажиллана), контекстыг золиослохгүй.
   */
  const MIN_USABLE_CONTEXT = 4096;

  /**
   * ⚠️ `eco` НЬ КОНТЕКСТЫГ ЗОРИУД 4096-Д БАРИНА.
   *
   *    `eco` нь «Revit нээлттэй, зөөврийн компьютер, батерей» гэсэн
   *    нөхцөлд зориулагдсан — тэнд VRAM-ын нөөц нь урт контекстээс
   *    ЧУХАЛ.  ХЭМЖСЭН: 8192 → 4096 нь q8_0 KV дээр ~220 MiB чөлөөлнө.
   *
   *    4096 нь дур зоргоор сонгосон тоо БИШ: нормын 5 заалт + асуулт +
   *    сүүлийн хэдэн ээлж нь тэнд багтдаг (`/generate`-ийн
   *    `context_overflow` шалгалтаар хэмжигдсэн).  Түүнээс доош бол
   *    нотолгоо хасагдана.
   */
  const desiredCtx =
    profile === 'eco'
      ? Math.min(input.desiredContextTokens, MIN_USABLE_CONTEXT)
      : input.desiredContextTokens;
  const minKvMb = Math.round(
    (Math.min(input.desiredContextTokens, MIN_USABLE_CONTEXT) * kvPerTok * KV_RATIO.q8_0) /
      (1024 * 1024),
  );
  const minComputeMb = computeBufferMb(64, MIN_USABLE_CONTEXT);

  /**
   * ⚠️ ЖИН НЬ ТӨСӨВТ БАГТАХГҮЙ БОЛ — БҮХ ДАВХАРГЫГ GPU РУУ ОРУУЛАХГҮЙ.
   *    Хүчээр оруулах нь яг тэр WDDM зөөлтийг эхлүүлнэ.  Оронд нь
   *    хэсэгчилсэн буулгалт: удаан ч КОМПЬЮТЕР АЖИЛЛАНА.
   */
  if (budgetMb < weightsMb + minKvMb + minComputeMb) {
    const { threads, threadsBatch } = planThreads(hw.cpuPhysicalCores, hw.cpuCores, profile, false);
    const { batchSize, ubatchSize } = planBatch(profile, false);

    // Хэдэн давхаргыг оруулж болох вэ — ойролцоогоор жингийн хувиар.
    const partialCtx = Math.min(input.desiredContextTokens, MIN_USABLE_CONTEXT);

    /**
     * ⚠️ ДАВХАРГЫН ТООГ ТААМАГЛАХГҮЙ — llama.cpp-Д ДААТГАНА.
     *
     *    Өмнөх хувилбар нь `Math.floor(fraction * 32)` гэж бодож
     *    байсан: 32 гэсэн тоо нь ТААМАГ (Qwen3-8B нь 36 давхаргатай,
     *    өөр загвар өөр).  Хэт өндөр таамаглавал VRAM хэтэрч ЯГ ТЭР
     *    ХӨШИЛТИЙГ үүсгэнэ; хэт бага таамаглавал GPU дэмий сул зогсоно.
     *
     *    `-ngl auto` + `--fit-target <нөөц>` нь llama.cpp-ийн ӨӨРИЙН
     *    санах ойн нягтлан бодох бүртгэлийг ашиглана — тэр нь загварын
     *    бодит бүтцийг мэддэг цорын ганц тал.
     */
    notices.push(
      `VRAM ${hw.vramMb} MB — загварыг бүхэлд нь GPU-д багтаахгүй. ` +
        `Багтах хэсгийг GPU-д, үлдсэнийг CPU дээр ажиллуулна. Хариулт удаан байна.`,
    );
    // ⚠️ КОНТЕКСТ БАГАССАНЫГ ЧИМЭЭГҮЙ ӨНГӨРӨӨХГҮЙ.  Тэр нь хариултын
    //    ЧАНАРТ шууд нөлөөлнө (цөөн заалт, богино түүх) — хэрэглэгч
    //    «AI дутуу хариулж байна» гэж бодохоос өмнө шалтгааныг мэдэх ёстой.
    if (partialCtx < input.desiredContextTokens) {
      notices.push(
        `VRAM-ын нөөц хадгалахын тулд контекстыг ${input.desiredContextTokens} → ${partialCtx} токен болгов.`,
      );
    }
    return {
      profile,
      contextTokens: partialCtx,
      gpuLayers: 'auto',
      fitTargetMb: reserve,
      threads,
      threadsBatch,
      batchSize,
      ubatchSize,
      kvCacheType: 'q8_0',
      flashAttention: true,
      llamaPriority: profile === 'performance' ? 0 : -1,
      poll: 0,
      processPriority: profile === 'performance' ? 'normal' : 'below_normal',
      estimatedVramPeakMb: hw.vramMb - reserve,
      vramHeadroomMb: reserve,
      reason:
        `VRAM ${hw.vramMb} MB, нөөцөд ${reserve} MB үлдээв — давхаргын ` +
        `хуваарилалтыг llama.cpp өөрөө тааруулна (-ngl auto), контекст ${partialCtx}.`,
      viable: true,
      notices,
    };
  }

  /* ── Бүрэн GPU: контекст + KV + багцыг төсөвт тааруулна ─────── */
  const { threads, threadsBatch } = planThreads(hw.cpuPhysicalCores, hw.cpuCores, profile, true);
  let { batchSize, ubatchSize } = planBatch(profile, true);

  /**
   * ⚠️ KV КЭШИЙН ТӨРӨЛ — 8 GB картан дээр ҮРГЭЛЖ `q8_0`.
   *
   *    Хэмжсэн: Qwen3-8B, 8K контекст, f16 KV = 1152 MiB.  `q8_0` нь
   *    түүнийг ~610 MiB болгоно — 540 MiB чөлөөлнө, өөрөөр хэлбэл
   *    хөтчийн композиторт хэрэгтэй яг тэр хэмжээ.  Чанарын алдагдал нь
   *    хэмжигдэхүйц бага.
   *
   * ⚠️ 12 GB-аас дээш картан дээр f16 үлдээнэ — тэнд нөөц хангалттай
   *    бөгөөд шаардлагагүй буулт хийх хэрэггүй.
   */
  const kvCacheType: KvCacheType = hw.vramMb >= 11_000 && profile === 'performance' ? 'f16' : 'q8_0';

  const kvMbPerToken = (kvPerTok * KV_RATIO[kvCacheType]) / (1024 * 1024);

  // Контекстыг ХАМГИЙН ТОМООС эхэлж багасгана.
  // ⚠️ ШАТЛАЛ НЬ 4096-Д ЗОГСОНО.  Түүнээс доош буух нь дээрх
  //    хэсэгчилсэн буулгалтын салааны ажил — тэнд контекст хадгалагдана.
  const ladder = [desiredCtx, 8192, 6144, MIN_USABLE_CONTEXT]
    .filter((c) => c > 0 && c <= desiredCtx)
    .sort((a, b) => b - a);
  if (ladder.length === 0) ladder.push(Math.min(desiredCtx, MIN_USABLE_CONTEXT));

  let contextTokens = ladder[ladder.length - 1]!;
  let peak = Number.POSITIVE_INFINITY;

  outer: for (const ctx of ladder) {
    // Микро багцыг ч мөн буулгах шатлалтай — эхлээд профайлын утга.
    const ubLadder = [ubatchSize, 128, 64].filter((u, i, a) => u > 0 && a.indexOf(u) === i);
    for (const ub of ubLadder) {
      const kvMb = Math.round(ctx * kvMbPerToken);
      const compMb = computeBufferMb(ub, ctx);
      const total = Math.round(weightsMb * WEIGHTS_OVERHEAD) + kvMb + compMb;
      if (total <= hw.vramMb - reserve) {
        contextTokens = ctx;
        ubatchSize = ub;
        batchSize = Math.max(ub, Math.min(batchSize, ub * 4));
        peak = total;
        break outer;
      }
    }
  }

  if (!Number.isFinite(peak)) {
    /**
     * ⚠️ ЭНД ХҮРЭХ ЁСГҮЙ — дээрх хаалга нь энэ тохиолдлыг хэсэгчилсэн
     *    буулгалт руу шилжүүлсэн байх ёстой.  Гэвч тооцооны ойролцоолол
     *    (KV-ийн таамаг) зөрж болох тул хамгаалалт үлдээв: контекстыг
     *    ХАДГАЛАЖ, микро багцыг хамгийн бага болгоно.
     */
    contextTokens = Math.min(input.desiredContextTokens, MIN_USABLE_CONTEXT);
    ubatchSize = 64;
    batchSize = 256;
    peak =
      Math.round(weightsMb * WEIGHTS_OVERHEAD) +
      Math.round(contextTokens * kvMbPerToken) +
      computeBufferMb(64, contextTokens);
    notices.push('VRAM хязгаартай тул хамгийн хэмнэлттэй тохиргоогоор ажиллана.');
  }

  if (contextTokens < input.desiredContextTokens) {
    notices.push(
      `VRAM-ын нөөц хадгалахын тулд контекстыг ${input.desiredContextTokens} → ${contextTokens} токен болгов.`,
    );
  }
  if (kvCacheType === 'q8_0') {
    notices.push('KV кэшийг q8_0 болгож ~500 MB VRAM чөлөөлөв (чанарт нөлөө бага).');
  }

  const headroom = hw.vramMb - Math.round(peak);

  return {
    profile,
    contextTokens,
    gpuLayers: -1,
    fitTargetMb: reserve,
    threads,
    threadsBatch,
    batchSize,
    ubatchSize,
    kvCacheType,
    // ⚠️ `q8_0` KV нь flash attention ШААРДАНА — үгүй бол llama.cpp
    //    зарим backend дээр татгалзана.  `auto` нь ихэвчлэн зөв
    //    сонгодог ч бид ИЛ зааж, гэнэтийн байдлаас сэргийлнэ.
    flashAttention: true,
    /**
     * ⚠️ THREAD PRIORITY.  `balanced`/`eco` дээр БАГА — үүсгэлт нь
     *    ХОЙД ДЭВСГЭРИЙН ажил, хэрэглэгчийн бичилт, гүйлгэлт нь
     *    ТЭРГҮҮН ЭЭЛЖИНД (§9).  Бүрэн GPU дээр энэ нь хурдад бараг
     *    нөлөөгүй (CPU 1.05 цөм) харин холимог ачаалалд ялгаа гаргана.
     */
    llamaPriority: profile === 'performance' ? 0 : -1,
    /**
     * ⚠️ `--poll 0` — эргэлдэж хүлээхгүй.  Өгөгдмөл 50 нь урсгалуудыг
     *    ажил хүлээж байхад ЭРГЭЛДҮҮЛНЭ (busy-wait) — GPU дээр бүрэн
     *    ажиллаж байхад тэр нь ЦЭВЭР АЛДАГДАЛ: CPU шатааж, зөвхөн
     *    бусад програмыг шахна.
     */
    poll: 0,
    processPriority: profile === 'performance' ? 'normal' : 'below_normal',
    estimatedVramPeakMb: Math.round(peak),
    vramHeadroomMb: headroom,
    reason:
      `VRAM ${hw.vramMb} MB · загвар ~${Math.round(peak)} MB · нөөц ~${headroom} MB · ` +
      `контекст ${contextTokens} · -ub ${ubatchSize} · KV ${kvCacheType} · ` +
      `${threads} CPU урсгал · профайл «${PROFILE_LABEL_MN[profile].name}»`,
    viable: true,
    notices,
  };
}

/* ================================================================== */
/*  АВТОМАТ СОНГОЛТ (§13, §29)                                         */
/* ================================================================== */

/**
 * Анхны профайлыг АВТОМАТААР сонгоно — суулгах үед хэрэглэгчээс
 * АСУУХГҮЙ (§13-ийн хатуу шаардлага).
 *
 * ⚠️ ЗӨӨВРИЙН КОМПЬЮТЕР → `eco` (§29).  Батерейн горим, дулааны
 *    хязгаарлалт, сул хөргөлт — бүгд адилхан дүгнэлт рүү хөтөлнө.
 *    Тэр нь хурдыг золиослох боловч зөөврийн машин дээр «сэнс нь
 *    хашгирч, гар нь халж, юу ч хийж чадахгүй» гэсэн туршлагаас
 *    ХАМААГҮЙ дээр.
 *
 * ⚠️ ЭНЭ ФУНКЦ ЦЭВЭР — батерейн төлөвийг ДУУДАГЧ хэмжинэ.
 */
export function autoProfile(hw: HardwareProfile): PerfProfile {
  if (hw.onBattery === true) return 'eco';
  if (hw.isLaptop === true) return 'eco';
  // ⚠️ Бага VRAM нь `performance` рүү явахыг ХОРИГЛОНО — тэнд нөөц
  //    үлдээх нь илүү чухал.
  if (hw.vramMb !== null && hw.vramMb < 6000) return 'eco';
  return 'balanced';
}

/**
 * llama-server-ийн ТУШААЛЫН МӨРИЙГ угсарна.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — тестээр туг бүрийг шалгана.  Хэрэв энд байхгүй туг
 *    нэмвэл `llama-server` эхлэхгүй УНАХ ба «MGL AI ажиллахгүй байна»
 *    гэсэн оношлоход хэцүү байдал үүснэ.
 */
export function buildLlamaArgs(opts: {
  modelPath: string;
  port: number;
  plan: LaunchPlan;
  /** LoRA адаптерын зам — `null` бол суурь загвар цэвэрээрээ. */
  loraPath?: string | null;
  /** Диагностикийн `/metrics` гарцыг асаах эсэх. */
  metrics?: boolean;
}): string[] {
  const { plan } = opts;
  const args = [
    '--model', opts.modelPath,
    // ⚠️ ЗӨВХӨН loopback — хэлэлцэхгүй (auth.ts-ийн 1-р давхарга).
    '--host', '127.0.0.1',
    '--port', String(opts.port),
    '--ctx-size', String(plan.contextTokens),
    '--n-gpu-layers', String(plan.gpuLayers),
    /**
     * ⚠️ `--fit-target` НЬ ХАМГИЙН ЧУХАЛ ГАНЦ ТУГ.
     *
     *    Энэ нь llama.cpp-д «төхөөрөмж дээр ЭНЭ ХЭМЖЭЭНИЙ санах ой
     *    ҮЛДЭЭ» гэж хэлнэ.  ХЭМЖИГДСЭН: үүнгүйгээр 8 GB картан дээр
     *    оргил 7505 MiB болж, ажлын талбар, хөтөч, Revit-д 687 MiB Л
     *    үлдсэн — Windows-ийн WDDM зөөлт эхэлж БҮХ КОМПЬЮТЕР хөшсөн.
     */
  ];
  if (plan.fitTargetMb !== null) {
    args.push('--fit-target', String(plan.fitTargetMb));
  }
  args.push(...[
    // ⚠️ Нэг ажилтан = нэг зэрэгцээ хүсэлт.  Илүү нь KV кэшийг хуваана.
    '--parallel', '1',
    // Ярианы дараагийн ээлж системийн зааврыг ДАХИН тооцохгүй.
    '--cache-reuse', '256',
    '--threads', String(plan.threads),
    '--threads-batch', String(plan.threadsBatch),
    '--batch-size', String(plan.batchSize),
    '--ubatch-size', String(plan.ubatchSize),
    '--cache-type-k', plan.kvCacheType,
    '--cache-type-v', plan.kvCacheType,
    '--flash-attn', plan.flashAttention ? 'on' : 'off',
    '--prio', String(plan.llamaPriority),
    '--poll', String(plan.poll),
    '--no-webui',
  ]);

  /**
   * ⚠️ АДАПТЕР НЬ СУУРЬ ЗАГВАРААС ТУСДАА ФАЙЛ (§15, §17, §19).
   *    `--lora` нь llama.cpp b10850 дээр байгааг `--help`-ээс шалгасан.
   *    Ингэснээр MGL AI 1.1 → 1.2 шинэчлэлт нь 4-5 GB БИШ, хэдэн зуун
   *    MB болно.
   */
  if (opts.loraPath) args.push('--lora', opts.loraPath);
  if (opts.metrics) args.push('--metrics');

  return args;
}
