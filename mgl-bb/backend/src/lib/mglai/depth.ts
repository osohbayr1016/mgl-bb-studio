/**
 * MGL AI · ХАРИУЛТЫН ГҮН (answer depth) — ДЕТЕРМИНИСТ, LLM-ГҮЙ.
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА (2026-09-10, smoke адаптер 0.1).  Сургалтын
 *    багц 326 мөрийн assistant зорилт дунджаар 48 токен байсан тул адаптер
 *    «MGL AI үргэлж богино хариулна» гэсэн товчлол сурч, «захиалагчийн
 *    порталын боломжуудыг ДЭЛГЭРЭНГҮЙ тайлбарла» гэхэд ч 2 өгүүлбэр болж
 *    (H26/H27) унасан.  Гүнийг загварт ДААЛГАХГҮЙ — сервер асуулт, санаа,
 *    даалгаврын тоо, ил хүсэлт, хадгалсан тохиргооноос шийдэж, систем
 *    зааварт НЭГ мөр тушаал болгож өгнө; сургалтын зорилт ч ТЭР мөрөнд
 *    захирагдана (нөхцөлт товч байдал).
 *
 *      short    — 1–3 өгүүлбэр, гарчиг/жагсаалтгүй (баримт, тоо, мэндчилгээ)
 *      normal   — эхэнд шууд хариулт, хэрэгтэй бол 1–2 догол мөр тайлбар
 *      detailed — бүтэцтэй, хэсэгчилсэн тайлбар (ялгаа, шалтгаан, дараалал, шинжилгээ)
 *
 * ⚠️ ДАРААЛАЛ: ил хүсэлт (энэ ээлж) > хадгалсан тохиргоо > санаа/бүтэц.
 *    «Товчхон хэл» гэсэн хүн дэлгэрэнгүй авахгүй; «дэлгэрэнгүй тайлбарла»
 *    гэсэн хүн 2 өгүүлбэр авахгүй.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — `depth.test.ts`.  ASCII `\b` кириллд үүсдэггүй тул
 *    үгийн хилийг `(?<!\p{L})`/`(?![\p{L}])`-ээр.
 */
import type { AiIntent } from './intent';
import { normalizeLatinMongolian } from './lang';

export const ANSWER_DEPTHS = ['short', 'normal', 'detailed'] as const;
export type AnswerDepth = (typeof ANSWER_DEPTHS)[number];

export interface DepthDecision {
  depth: AnswerDepth;
  /** Ил хүсэлт (энэ ээлж) байсан эсэх — санамжаас ДЭЭГҮҮР. */
  explicit: boolean;
  reason: string;
}

export interface DepthInput {
  question: string;
  intent: AiIntent | string;
  /** Олон санаатай ээлжийн даалгаврын тоо. */
  taskCount?: number;
  /** Норм/стандартын асуулт эсэх. */
  regulatory?: boolean;
  /** Хадгалсан тохиргоо (`answer_length` санамж): `short` | `long` | null. */
  preferredLength?: 'short' | 'long' | null;
  /**
   * Мэдлэгийн сангийн каталог (`normCatalog.ts`) — жагсаалт/бүтэц асуусан.  META-гийн «1–3
   * өгүүлбэр, жагсаалтгүй» гүн энд ЯГ БУРУУ: 11 баримтыг 2 болгож тайрдаг (хэмжсэн 2026-09-18).
   */
  catalog?: 'inventory' | 'document' | null;
}

const W = (alts: string) => new RegExp(`(?<![\\p{L}])(?:${alts})`, 'iu');

/** «Товчхон», «нэг үгээр», «briefly» — энэ ээлжийн ил хүсэлт. */
const EXPLICIT_SHORT = W('товчхон|товч хэл|товч хариул|богино хариул|богиноор|нэг үгээр|нэг өгүүлбэрээр|хураангуйл|tovchhon|tovch hel|bogino hariul|neg ugeer|briefly|in short|short answer|one sentence|tl;?dr');
/** «Дэлгэрэнгүй», «алхам алхмаар», «explain in detail». */
const EXPLICIT_DETAILED = W('дэлгэрэнгүй|нарийвчилж|нарийвчилсан|дэлгэрүүл|бүрэн тайлбарла|алхам алхмаар|бүх шат|delgerengui|nariivchil|alham alhmaar|in detail|step by step|elaborate|thoroughly|comprehensive');
/** Шинжилгээ/харьцуулалт/шалтгаан — бүтэцтэй тайлбар шаардана. */
const ANALYTIC = W('ялга|харьцуул|яагаад|шалтгаан|эрсдэл|нөлөө|дараалал|шинжил|дүн шинжилгээ|үе шат|шатууд|аль нь .*яагаад|yalga|hartsuul|yagaad|shaltgaan|ersdel|noloo|daraalal|shinjil|difference|compare|why|because|risk|impact|order of|stages|analy[sz]|breakdown');
/** Ойлголт тайлбарлах — энгийн гүн. */
const CONCEPT = W('гэж юу вэ|гэдэг нь юу|тайлбарла|тайлбарлаад|ойлголт|хэрхэн ажилладаг|яаж ажилладаг|юу гэсэн үг|gej yu ve|tailbarla|what is|what does|how does|how do|explain');
/** Тоолох/баримтын асуулт — товч. */
const FACTUAL = W('хэдэн|хэдн|хэд вэ|хэд байна|хэд бн|хэзээ|аль вэ|аль нь вэ|хэн бэ|юу байна|биз дээ|hed ve|heden|hedn|hed bna|hed bn|hezee|ali ve|yu bna|biz dee|how many|how much|when|which|who');

function fold(q: string): string {
  const lower = q.toLowerCase();
  return `${lower} ${normalizeLatinMongolian(lower).toLowerCase()}`;
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Гүнийг шийднэ.
 */
export function decideDepth(input: DepthInput): DepthDecision {
  const q = fold(input.question ?? '');
  const intent = String(input.intent ?? '');
  const tasks = input.taskCount ?? 1;

  // 1. Энэ ээлжийн ИЛ хүсэлт — бүх зүйлээс дээгүүр.
  if (EXPLICIT_SHORT.test(q)) return { depth: 'short', explicit: true, reason: 'ил «товчхон»' };
  if (EXPLICIT_DETAILED.test(q)) return { depth: 'detailed', explicit: true, reason: 'ил «дэлгэрэнгүй»' };

  // 2. Хадгалсан тохиргоо.
  if (input.preferredLength === 'short') return { depth: 'short', explicit: false, reason: 'санамж: богино' };
  if (input.preferredLength === 'long') return { depth: 'detailed', explicit: false, reason: 'санамж: дэлгэрэнгүй' };

  // 3. Санаа / бүтэц.
  // Жагсаалт = ДЭЛГЭРЭНГҮЙ (мөр бүр баримт); нэг баримтын тойм = ЭНГИЙН.  Богино адаптер (0.4)
  //    «11 баримт байна» гэсэн нэг өгүүлбэрээр өнгөрдөг (хэмжсэн) — жагсаах тушаал ил байх ёстой.
  if (input.catalog === 'inventory') return { depth: 'detailed', explicit: false, reason: 'нормын сангийн жагсаалт' };
  if (input.catalog === 'document') return { depth: 'normal', explicit: false, reason: 'баримтын бүтцийн тойм' };
  if (intent === 'CASUAL' || intent === 'META') return { depth: 'short', explicit: false, reason: `санаа ${intent}` };
  if (intent === 'ERP_ANALYSIS') return { depth: 'detailed', explicit: false, reason: 'ERP шинжилгээ' };
  if (ANALYTIC.test(q)) return { depth: 'detailed', explicit: false, reason: 'ялгаа/шалтгаан/дараалал/шинжилгээ' };
  if (tasks >= 2) return { depth: 'normal', explicit: false, reason: `${tasks} даалгавар` };
  if (intent === 'CALCULATION') return { depth: 'normal', explicit: false, reason: 'тооцоо' };
  if (intent === 'COMPANY_FACT' && FACTUAL.test(q)) return { depth: 'short', explicit: false, reason: 'ERP баримт (хэд/хэзээ/аль)' };
  if (input.regulatory || intent === 'NORMATIVE') {
    // Нормын лавлагаа/ангилал → ангилал + муж + эх сурвалж = энгийн гүн.
    return { depth: 'normal', explicit: false, reason: 'норм: ангилал+муж+эх сурвалж' };
  }
  if (intent === 'REVIT_READ' || intent === 'REVIT_ACTION') return { depth: 'short', explicit: false, reason: 'Revit төлөв/санал' };
  if (CONCEPT.test(q)) return { depth: 'normal', explicit: false, reason: 'ойлголт тайлбарлах' };
  if (FACTUAL.test(q)) return { depth: 'short', explicit: false, reason: 'баримтын асуулт' };
  return { depth: 'normal', explicit: false, reason: 'өгөгдмөл' };
}

/** Систем зааварт орох НЭГ мөр — загварт гүнийг тушаана. */
export function depthInstruction(depth: AnswerDepth, lang: 'mn-Cyrl' | 'en'): string {
  if (lang === 'en') {
    return {
      short: 'DEPTH: SHORT — 1–3 sentences, no headings or lists; state the requested fact directly.',
      normal: 'DEPTH: NORMAL — direct answer first, then 1–2 short paragraphs of explanation only if useful; a list only for genuinely multiple items.',
      detailed: 'DEPTH: DETAILED — first sentence gives the core answer, then a structured explanation (sections or bullets), a source for every factual claim, no conclusion unless it adds something, never repeat an idea.',
    }[depth];
  }
  return {
    short: 'ГҮН: ТОВЧ — 1–3 өгүүлбэр, гарчиг/жагсаалтгүй. Асуусан баримтыг шууд хэл.',
    normal: 'ГҮН: ЭНГИЙН — эхэнд шууд хариулт, дараа нь хэрэгтэй бол 1–2 богино догол мөр тайлбар. Техникийн асуултад өгөгдсөн нөхцөл ба дүгнэлтийг ялга; хэмжээс, материал, ачаалал, ашиглалтын нөхцөл дутуу бол таамаглахгүй. Жагсаалт зөвхөн жинхэнэ олон зүйлд.',
    detailed: 'ГҮН: ДЭЛГЭРЭНГҮЙ — эхний өгүүлбэрт гол хариулт. Дараа нь «өгөгдөл/баримт → инженерийн тайлбар эсвэл тооцоо → эрсдэл/таамаг → дараагийн шалгалт» гэсэн логик дарааллаар бүтэцтэй тайлбарла. Таамгийг баримт мэт бүү бич; дутуу оролтыг нэрлэ. Баталгаатай баримт бүрд эх сурвалж өг; нэг санааг давтахгүй.',
  }[depth];
}
