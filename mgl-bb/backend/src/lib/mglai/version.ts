/**
 * MGL AI · БҮТЭЭГДЭХҮҮНИЙ ТОДОРХОЙЛОЛТ (§36 загварын хувилбарлалт).
 *
 * ⚠️ ЭНЭ ФАЙЛ БОЛ ЦОРЫН ГАНЦ ЭХ СУРВАЛЖ.  Хувилбарын мөрийг репод өөр
 *    хаана ч ГАРААР бүү бич — UI, лог, санал хүсэлт, релизийн бүртгэл
 *    бүгд эндээс уншина.  Хоёр газар бичигдсэн хувилбар нь заавал
 *    зөрөх ба тэр зөрүү нь «аль загвар энэ хариуг өгсөн бэ» гэсэн
 *    асуултыг ХАРИУЛАХГҮЙ болгоно.
 *
 * ⚠️ `runtime_variant` НЬ ХУДАЛ ХЭЛЖ БОЛОХГҮЙ.  Захиалагчийн Lite нь
 *    ажилтны 4B-тэй ИЖИЛ ЖИН БИШ.  UI-д «MGL AI» гэж нэг адил харагдах
 *    нь зүгээр, гэвч метадата нь бодит биетийг нэрлэнэ (§12).
 *
 * ⚠️ СУУРЬ ЗАГВАРЫН БРЭНД UI-д ГАРАХГҮЙ (§1).  `BASE_MODEL_*` нь
 *    зөвхөн дотоод метадата ба `ai/registry/LICENSES.md`-ийн эшлэл.
 */

/** Хэрэглэгчид үзүүлэх бүтээгдэхүүний нэр.  Хэзээ ч суурь загварын нэр биш. */
export const MGL_AI_PRODUCT = 'MGL AI';

/** Загварын гэр бүл — өгөгдлийн санд, лог, санал хүсэлтэд. */
export const MGL_AI_FAMILY = 'mgl-ai';

/** Бүтээгдэхүүний семантик хувилбар.  «MGL AI 1.0» гэдгийн 1.0. */
export const MGL_AI_VERSION = '1.0.0';

/**
 * Систем зааврын хувилбар.  ⚠️ Заавраа ӨӨРЧИЛВӨЛ ЭНЭ ТООГ ЗААВАЛ ӨСГӨ —
 * санал хүсэлтийн мөр бүр үүнийг тамгалдаг тул хуучин зааврын үеийн
 * гомдлыг шинэ зааварт буруугаар тооцох эрсдэлээс энэ л хамгаална.
 */
// ⚠️ 2026-09-08: систем заавар нь асуултыг (A) норм / (B) компанийн
//    өгөгдөл / (C) бусад гэж ангилдаг болов.  Өмнөх нэг хатуу дүрэм нь
//    4B загварыг БҮХ асуултад «эх сурвалж олдсонгүй» гэж хариулуулж
//    байсан — мэндчилгээнд ч.
// ⚠️ 2026-09-10 (sys-6): ХАРИУЛТЫН ГҮН-ий мөр («ГҮН: ТОВЧ/ЭНГИЙН/ДЭЛГЭРЭНГҮЙ»,
//    `depth.ts`) нэмэгдэв — smoke адаптер 0.1 бүх хариултыг 2 өгүүлбэр болгосны
//    засвар: гүнийг сервер шийдэж, загвар ба сургалтын зорилт хоёулаа тушаалыг дагана.
// ⚠️ 2026-09-11 (sys-7): НОРМЫН ШИЙДВЭРИЙН БЛОК ерөнхийлөгдөв — TrustedNormResult
//    (ангилал / тооцоо / шаардлага / хүний хяналт) бүгд «ДЕТЕРМИНИСТ ХАРИУЛТ» мөртэй;
//    В-мужийн гурван мөрийн хатуу загвар ХАСАГДСАН.  «ХУУЧИН БАРИМТ» мөр төвийг
//    сахисан үг болов (Amendment D).  Held-out/E2E суурь энэ хувилбараар дахин.
// ⚠️ 2026-10-03 (sys-8): монгол инженерийн reasoning-ийн гүний тушаал «өгөгдөл/баримт →
//    инженерийн тайлбар/тооцоо → эрсдэл/таамаг → дараагийн шалгалт» болов; латин монгол
//    асуултад эх бичвэрийг хадгалсан чигээр серверийн кирилл хэвийжүүлэлтийг туслах мөрөөр
//    model context-д өгнө.  Training builder яг ижил serving хэлбэрийг ашиглана.
export const MGL_AI_PROMPT_VERSION = 'mglai-sys-8';

/**
 * Хэрэгслийн схемийн хувилбар.  Хэрэгсэл нэмэх/устгах/аргумент өөрчлөх
 * бүрд өснө — сургалтын жишээ нь ямар схемийн эсрэг зөв байсныг л
 * энэ тоо хэлнэ.
 */
export const MGL_AI_TOOL_SCHEMA_VERSION = 'mglai-tools-1';

/** Хайлтын давхаргын хувилбар (chunking + embedding гэрээ). */
export const MGL_AI_RETRIEVAL_VERSION = 'mglai-rag-1';

/**
 * Ажиллах үеийн хувилбарууд — ЭНЭ НЬ ХААЛТТАЙ ОЛОНЛОГ.
 *
 * `employee-8b-q4`  ажилтны PC, llama.cpp, Qwen3-8B GGUF Q4_K_M (serving суурь, 2026-09-10-аас)
 * `employee-8b-q5`  ижил, илүү нарийвчлалтай quantization
 * `employee-4b-q4`  4B — түүхэн лавлах (registry/models.json)
 * `employee-4b-q5`  ижил, илүү нарийвчлалтай quantization
 * `client-lite`     захиалагчийн хөтөч, WebGPU, жижиг загвар
 * `echo`            ЗАГВАРГҮЙ детерминист хөдөлгүүр — тест ба анхны
 *                   ажиллуулалт.  Энэ нь «хиймэл AI endpoint» БИШ:
 *                   хариу бүр нь ӨӨРИЙГӨӨ echo гэж зарлана.
 */
// ⚠️ 2026-09-11 (Session D, drift): serving суурь нь Qwen3-8B болсноос хойш
//    runtime нь `employee-8b-q4` гэж мэдээлдэг (`server.ts variantFromName`)
//    боловч энэ олонлогт БАЙГААГҮЙ тул `/messages`-ийн `isRuntimeVariant`
//    унаж, 8B-ийн ХАРИУЛТ БҮР `ai_messages.runtime_variant = NULL` гэж
//    хадгалагдаж байв — «аль загвар хариулсан бэ» гэдэгт хариулах аргагүй.
//    `ai/integration/test/drift.test.ts` нь `registry/models.json`-ы variant
//    бүр энд байгааг барина.  Runtime нь нэрийг ФАЙЛЫН НЭРЭЭС гаргадаг
//    (нээлттэй), энэ нь ХААЛТТАЙ — шинэ хэмжээ/quant гарахад ЭНД нэм.
export const RUNTIME_VARIANTS = [
  'employee-8b-q4',
  'employee-8b-q5',
  'employee-4b-q4',
  'employee-4b-q5',
  'client-lite',
  'echo',
] as const;
export type RuntimeVariant = (typeof RUNTIME_VARIANTS)[number];

/** Үйлдвэрлэлийн өгөгдмөл variant — session/runtime metadata нэг эх сурвалжтай. */
export const MGL_AI_EMPLOYEE_RUNTIME_VARIANT: RuntimeVariant = 'employee-8b-q4';
export const MGL_AI_CLIENT_RUNTIME_VARIANT: RuntimeVariant = 'client-lite';

export function isRuntimeVariant(v: unknown): v is RuntimeVariant {
  return typeof v === 'string' && (RUNTIME_VARIANTS as readonly string[]).includes(v);
}

/**
 * Суурь загвар — ⚠️ ЛИЦЕНЗ ШАЛГАГДТАЛ ЭНЭ УТГА ЗӨВХӨН НЭР.
 * `ai_model_releases.license_cleared = 0` байхад ModelManager татахаас
 * татгалзана (0270).  Энэ тогтмолыг өөрчлөх нь лицензийг шалгасан гэсэн
 * үг БИШ.
 */
export const BASE_MODEL_CANDIDATE = 'Qwen3.5-4B-Instruct';
export const BASE_MODEL_FORMAT = 'gguf';
export const BASE_MODEL_DEFAULT_QUANT = 'Q4_K_M';

/** §41 — том контекст нь ХУРД, VRAM-ыг иддэг.  4K-аас эхэлнэ. */
export const DEFAULT_CONTEXT_TOKENS = 4096;

export interface ModelIdentity {
  product: string;
  family: string;
  version: string;
  runtime_variant: RuntimeVariant;
  system_prompt_version: string;
  tool_schema_version: string;
  retrieval_version: string;
}

/** Мессеж, санал хүсэлт, аудитын мөрөнд тамгалагдах бүрэн таних тэмдэг. */
export function modelIdentity(variant: RuntimeVariant): ModelIdentity {
  return {
    product: MGL_AI_PRODUCT,
    family: MGL_AI_FAMILY,
    version: MGL_AI_VERSION,
    runtime_variant: variant,
    system_prompt_version: MGL_AI_PROMPT_VERSION,
    tool_schema_version: MGL_AI_TOOL_SCHEMA_VERSION,
    retrieval_version: MGL_AI_RETRIEVAL_VERSION,
  };
}

/** UI-д харуулах шошго — «MGL AI 1.0».  Суурь загварын нэр ОРОХГҮЙ. */
export function displayName(): string {
  const [major, minor] = MGL_AI_VERSION.split('.');
  return `${MGL_AI_PRODUCT} ${major}.${minor}`;
}
