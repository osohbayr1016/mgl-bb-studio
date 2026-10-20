/**
 * MGL AI · ГҮЙЦЭТГЭЛИЙН ҮЙЛ ЯВДЛЫН ПРОТОКОЛ (§3, §36).
 *
 * ⚠️ ЭНЭ НЬ ГҮЙЦЭТГЭЛИЙН МӨШГӨЛТ, ЗАГВАРЫН БОДОЛ БИШ.  Хатуу хил:
 *    энд зөвхөн БОДИТ, АЮУЛГҮЙ үйлдэл орно — «D1-ээс уншлаа», «заалт
 *    оллоо», «ERP-ээс 57 мөр авлаа».  Загварын нуугдмал сэтгэлгээ,
 *    систем заавар, prompt-ын агуулга ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ (§36).
 *    `safeUserMessage` нь ХЭРЭГЛЭГЧИД харагдах цорын ганц текст бөгөөд
 *    түүнийг БИД бичнэ, загвар БИШ.
 *
 * ⚠️ ХУУРАМЧ ЯВЦ ГАРГАХГҮЙ (§5).  Үйл явдал бүр нь БОДИТ дуудлагатай
 *    нэг-нэгээр таарна: `stage.started` нь тэр ажил ҮНЭХЭЭР эхэлсэн
 *    үед, `source.found` нь мөр ҮНЭХЭЭР ирсэн үед.  «Гүнзгий бодож
 *    байна» гэх мэт чимэглэл нэмэх нь энэ файлын зорилгыг устгана.
 *
 * ⚠️ ЯАГААД ХӨТӨЧ ДЭЭР ВЭ.  MGL AI-ийн зохион байгуулагч нь хөтөч
 *    өөрөө: Worker нь эрх/нотолгоо, локал runtime нь инференс хийдэг
 *    бөгөөд ХОЁУЛАА хөтчөөр дамжина (CLAUDE.md-ийн «хоёр сервер, хоёр
 *    үүрэг»).  Тиймээс явцыг харах ЦОРЫН ГАНЦ цэг нь хөтөч.  Worker
 *    дээр SSE нэмэх нь зөвхөн Worker-ийн ӨӨРИЙН алхмыг харуулах бөгөөд
 *    локал загварын урсгалыг ХЭЗЭЭ Ч харж чадахгүй — тиймээс тэр нь
 *    илүү нарийн атлаа ДУТУУ шийдэл болно.
 */

/** Гүйцэтгэлийн үе шат — UI-ийн бүлэглэлт ба хугацааны хэмжүүр. */
export const AI_STAGES = [
  'accept',
  'plan',
  'tools',
  'norm_retrieval',
  'context',
  'generation',
  /** Гэрээний шалгалт — БОДИТ алхам (`enforceTrusted`), хуурамч биш (§38). */
  'validate',
  'persist',
] as const;
export type AiStage = (typeof AI_STAGES)[number];

export type AiEventType =
  | 'request.accepted'
  | 'language.detected'
  | 'intent.detected'
  /**
   * Ээлжийн тайлал — шинэ сэдэв үү, үргэлжлэл үү, олон асуулт уу.
   * `metadata.kind`, `metadata.subject` (нэр л).  Шошго нь БИДНИЙХ.
   */
  | 'turn.interpreted'
  | 'stage.started'
  | 'stage.completed'
  | 'stage.slow'
  | 'source.search.started'
  | 'source.found'
  | 'source.opened'
  | 'tool.started'
  | 'tool.completed'
  | 'norm.rule.completed'
  | 'generation.started'
  /**
   * ⚠️ ХУРИМТЛАГДСАН ХАРИУЛТЫГ ЦЭВЭРЛЭ.
   *
   *    Хэлний засварын зам нь загвараар хариултыг БҮХЭЛД НЬ ДАХИН
   *    бичүүлдэг.  Тэр үед шинэ токенууд нь ХУУЧИН хариултын ард
   *    наалдвал хэрэглэгч ижил агуулгыг ХОЁР УДАА хардаг — яг «AI нь
   *    өөрийгөө давтаж байна» гэсэн гомдол.  Энэ нь загварын гажиг
   *    БИШ, програмын хуримтлуулагчийн алдаа байсан.
   */
  | 'answer.reset'
  | 'token'
  | 'citation'
  | 'heartbeat'
  | 'warning'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** UI-д харагдах эх сурвалжийн ААН — эмбеддинг, оноо ЭНД ОРОХГҮЙ (§18). */
export interface AiSourceRef {
  /** Тогтвортой id — давхардлыг таних. */
  id: string;
  /** «УББ 12-01-01» гэх мэт баримтын код. */
  document: string | null;
  /** «2.5» гэх мэт заалтын дугаар. */
  clause: string | null;
  /**
   * ⚠️ ЗӨВХӨН БОДИТ хуудас.  Байхгүй бол `null` — «х.1» гэж ТААМАГЛАХ
   *    нь баримтыг хуурамчаар иш татахтай адил (§6).
   */
  page: number | null;
  title: string;
  /** `local` = ажилтны PC дээрх нормын сан, `erp` = D1. */
  origin: 'local-norm' | 'erp' | 'company-doc';
}

export interface AiEventBase {
  requestId: string;
  /** `performance.now()`-оос — хүсэлт эхэлснээс хойших мс. */
  atMs: number;
  type: AiEventType;
  stage?: AiStage;
  /** ⚠️ ХЭРЭГЛЭГЧИД харагдах монгол мөр.  Загвараас ХЭЗЭЭ Ч ирэхгүй. */
  safeUserMessage?: string;
  durationMs?: number;
  /** ⚠️ Нууц, prompt, дотоод сэтгэлгээ ЭНД ОРОХГҮЙ (§3). */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AiSourceEvent extends AiEventBase {
  type: 'source.found' | 'source.opened';
  source: AiSourceRef;
}

export interface AiTokenEvent extends AiEventBase {
  type: 'token';
  text: string;
}

export interface AiFailedEvent extends AiEventBase {
  type: 'failed';
  code: string;
}

export type AiStreamEvent = AiEventBase | AiSourceEvent | AiTokenEvent | AiFailedEvent;

export function isSourceEvent(e: AiStreamEvent): e is AiSourceEvent {
  return e.type === 'source.found' || e.type === 'source.opened';
}
export function isTokenEvent(e: AiStreamEvent): e is AiTokenEvent {
  return e.type === 'token';
}

/* ================================================================== */
/*  МОНГОЛ ХЭЛНИЙ ШОШГО (§30)                                          */
/* ================================================================== */

/**
 * Үе шатны ЯВЖ БУЙ болон ДУУССАН шошго.
 *
 * ⚠️ ХОЁР ХЭЛБЭР ЗААВАЛ: «хайж байна» → «хайлаа».  Дууссан алхмыг
 *    үргэлжилсэн хэлбэрээр үлдээх нь ажил зогссон мэт харагдуулна.
 * ⚠️ Орчуулгын үнэртэй мөр БИЧИХГҮЙ (§30) — «Мэдээллийг боловсруулж
 *    байна» гэх мэт нь юу ч хэлэхгүй.
 */
export const STAGE_LABEL: Record<AiStage, { running: string; done: string }> = {
  accept: { running: 'Асуултыг хүлээж авлаа', done: 'Асуултыг хүлээж авлаа' },
  plan: { running: 'Асуултыг ойлгож байна', done: 'Асуултыг ойлголоо' },
  tools: { running: 'Компанийн мэдээллийг шалгаж байна', done: 'Компанийн мэдээллийг авлаа' },
  norm_retrieval: {
    running: 'Барилгын нормын сангаас хайж байна',
    done: 'Нормын сангаас хайлаа',
  },
  context: { running: 'Холбогдох эх сурвалжийг шалгаж байна', done: 'Эх сурвалжийг шалгалаа' },
  generation: { running: 'Хариулт боловсруулж байна', done: 'Хариулт бэлэн боллоо' },
  validate: { running: 'Хариултыг шалгаж байна', done: 'Хариултыг шалгалаа' },
  persist: { running: 'Эшлэлийг баталгаажуулж байна', done: 'Эшлэлийг баталгаажууллаа' },
};

/** ⚠️ УДААШРАЛ НЬ АЛДАА БИШ (§11) — өнгө нь ТӨВИЙГ САХИСАН. */
export const SLOW_NOTICE: Record<AiStage, string> = {
  accept: 'Сервер хариулахад бага зэрэг удаж байна. Үргэлжлүүлж байна…',
  plan: 'Сервер хариулахад бага зэрэг удаж байна. Үргэлжлүүлж байна…',
  tools: 'Компанийн мэдээлэл татах нь ердийнхөөс удаж байна. Үргэлжлүүлж байна…',
  norm_retrieval: 'Эх сурвалж хайх ажиллагаа удаж байна. Үргэлжлүүлж байна…',
  context: 'Эх сурвалж шалгах нь ердийнхөөс удаж байна. Үргэлжлүүлж байна…',
  generation: 'Хариулт боловсруулах нь ердийнхөөс удаж байна. Үргэлжлүүлж байна…',
  validate: 'Шалгалт удаж байна. Үргэлжлүүлж байна…',
  persist: 'Хадгалах нь удаж байна. Үргэлжлүүлж байна…',
};

/** Хүний уншиж болох үргэлжлэх хугацаа. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} мс`;
  return `${(ms / 1000).toFixed(1)} сек`;
}

let seq = 0;
/** Хүсэлт бүрийн id — бүх үйл явдал, хэрэгслийн хэмжүүр үүгээр холбогдоно. */
export function newRequestId(): string {
  seq += 1;
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `req_${Date.now().toString(36)}_${seq.toString(36)}_${rnd}`;
}
