/**
 * MGL AI · ЭЭЛЖИЙН ТАЙЛАГЧ (ярианы кернел, 2-р хэсэг).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  Загварт ярианы төлөвийг БҮХЭЛД НЬ
 *    даалгаж, сүүлийн 10 мессежийг prompt-д хийдэг байсан.  Тэр нь
 *    хоёр талын алдаа: (а) ШИНЭ сэдэвт хуучин сэдвийн ажилтан, хугацаа,
 *    заалт орж ХОЛИЛДОНО; (б) түүхийг зүгээр устгавал «яагаад удаад
 *    байна?» гэсэн үргэлжлэл ажиллахаа болино.
 *
 *    Тиймээс ээлж бүрийг ЭХЛЭЭД ангилна:
 *
 *      NEW_TOPIC       — өмнөхтэй хамааралгүй; түүх, сэдэв ОРОХГҮЙ
 *      CONTINUATION    — ижил салбар, шинэ дэд асуулт; сэдэв ҮЛДЭНЭ
 *      FOLLOW_UP       — «яагаад», «тэгвэл», «энэ» — өмнөх сэдэв ЗААВАЛ
 *      REFERENCE       — «эхнийх нь», «дээрх жагсаалт» — өмнөх ХАРИУЛТ хэрэгтэй
 *      CORRECTION      — «үгүй ээ, B-г хэлсэн» — сэдэв СОЛИГДОНО, шинэ нь ялна
 *      CLARIFICATION   — туслах асуусан, хэрэглэгч хариулсан
 *      MULTI_INTENT    — нэг мессежинд хоёр өөр салбарын асуулт
 *
 *    Ангилал нь ЯМАР түүх, ЯМАР төлөв prompt-д орохыг шийднэ
 *    (`contextBuilder.ts`).  Загвар түүнийг таамаглахгүй.
 *
 * ⚠️ ХАМГИЙН ЭНГИЙН НАЙДВАРТАЙ АРГА.  Энд LLM ХЭРЭГЛЭХГҮЙ — латин/кирилл
 *    монголын тэмдэг үг + санааны салбарын зөрүү + өмнөх төлөв.  8B
 *    загвараас ангилал асуух нь (а) нэг RTT нэмнэ, (б) шалгагдашгүй,
 *    (в) яг тэр загварын алдааг засах гэж байгаа.  Тестээр цоожилно.
 *
 * ⚠️ ЭРГЭЛЗЭЭТЭЙ ҮЕД NEW_TOPIC.  Гоожилт нь дутуу үргэлжлэлээс ДОР:
 *    үргэлжлэл алдагдвал хэрэглэгч дахин асууна; гоожилт нь нормын
 *    хариултад төслийн ажилтан орж ирэхэд хүргэнэ.  Гэхдээ ТОДОРХОЙ
 *    үргэлжлэлийг («яагаад», «тэр төсөл») алдахгүй.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — D1-гүй, тестлэгдэнэ (`turn.test.ts`).
 */
import { classifyIntent, hasEngineeringInputNotation, hasRevitWriteHint, policyFor, type AiIntent, type EvidencePolicy } from './intent';
import { normalizeLatinMongolian } from './lang';
import { detectNormCatalogAsk } from './normCatalog';
import {
  subjectExpired,
  type ConvState,
  type ConvSubject,
  type SeenProject,
} from './convState';

export const TURN_KINDS = [
  'NEW_TOPIC',
  'CONTINUATION',
  'FOLLOW_UP',
  'REFERENCE_TO_PRIOR_RESULT',
  'CORRECTION',
  'CLARIFICATION',
  'MULTI_INTENT',
] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

/** Санааны САЛБАР — сэдэв солигдсон эсэхийг ялгах бүдүүн бүлэг. */
export type IntentDomain = 'norm' | 'erp' | 'revit' | 'calc' | 'doc' | 'general';

export function domainOf(intent: AiIntent | null): IntentDomain {
  switch (intent) {
    case 'NORMATIVE':
      return 'norm';
    case 'COMPANY_FACT':
    case 'ERP_ANALYSIS':
      return 'erp';
    case 'REVIT_READ':
    case 'REVIT_ACTION':
      return 'revit';
    case 'CALCULATION':
      return 'calc';
    case 'DOCUMENT_ANALYSIS':
      return 'doc';
    default:
      return 'general';
  }
}

/** Нэг мессежийн нэг ДААЛГАВАР. */
export interface TurnTask {
  /** Даалгаврын текст — хэрэглэгчийн бичсэн хэвээр. */
  text: string;
  intent: AiIntent;
  policy: EvidencePolicy;
  domain: IntentDomain;
  /** Энэ даалгаварт хамаарах сэдэв (үргэлжлэл бол өмнөхөөс, эсвэл нэрлэсэн). */
  subject: ConvSubject | null;
  /** Хайлт/хэрэгсэлд өгөх ТОДОТГОСОН асуулт — сэдвийн нэр залгасан. */
  resolvedText: string;
}

export interface TurnInterpretation {
  kind: TurnKind;
  /** Даалгаврууд — MULTI_INTENT бол ≥2, бусад нь яг 1. */
  tasks: TurnTask[];
  /** Ээлжийн НИЙТ санаа — нэг даалгавар бол түүнийх, олон бол хамгийн хатуу нь. */
  intent: AiIntent;
  policy: EvidencePolicy;
  /** Ээлжийн дараах ИДЭВХТЭЙ сэдэв (хэрэгсэл ажиллахаас ӨМНӨХ таамаг). */
  subject: ConvSubject | null;
  /** Өмнөх түүхээс хэдэн мессеж prompt-д орох вэ (0 = огт орохгүй). */
  historyMessages: number;
  /** Оношилгоо — яагаад ийм ангилал гарав. */
  reason: string;
}

/* ================================================================== */
/*  Тэмдэг үгс — кирилл + латин монгол + англи                        */
/* ================================================================== */

/**
 * ⚠️ ЗӨВХӨН ХАМААРАЛ ЗААДАГ үгс.  «энэ» гэдэг нь «энэ төсөл» (үргэлжлэл)
 *    ч, «энэ норм» (шинэ) ч байж болно — тиймээс энэ жагсаалт нь ганцаараа
 *    шийддэггүй, салбарын зөрүү, урттай хамт жинлэгдэнэ.
 */
const ANAPHORA = [
  'энэ', 'тэр', 'түүний', 'түүнийг', 'түүнд', 'тэдгээр', 'эдгээр',
  'тэгвэл', 'тэгээд', 'дараа нь', 'мөн адил', 'бас яг',
  'дэлгэрэнгүй', 'дэлгэрүүл', 'илүү тодорхой', 'жишээ нь',
  'ene', 'ter', 'tuunii', 'tegvel', 'tegeed', 'daraa n', 'delgerengui',
  'that one', 'this one', 'about it', 'about that', 'more detail', 'elaborate', 'tell me more',
  // ⚠️ Англи заах төлөөний үг ЗАЙТАЙ: «this project», «is it late».  Монгол
  //    «энэ» нь дээр байсан ч англи «this» байгаагүй тул «Why is this project
  //    behind?» нь CONTINUATION болж, «Энэ төсөл яагаад хоцорч байна вэ?»-ээс
  //    ӨӨР зан төлөвтэй байв (SFT угсрагчийн warning-аар баригдсан).
  ' this ', ' these ', ' it ', ' its ',
];

/** Өмнөх ҮР ДҮНГ залгах холбогчид — сэдэвгүй ERP үргэлжлэлд (6b). */
/** L2 заалтын тайлбарын follow-up — кирилл + латин галиг (ASCII `` кириллд үүсдэггүй, `(?<![\p{L}])`). */
const EXPLAIN_FOLLOWUP = /(?<![\p{L}])(?:юу гэсэн үг|гэдэг нь юу|энгийнээр|тайлбарла|тайлбар өг|ямар утгатай|ямар нөхцөлд|нөхцөл нь|онцгой нөхцөл|хэнд хамаар|юунд хамаар|холбогдох заалт|хориглосон|зөвшөөрсөн|эх сурвалж нь|хэддүгээр хуудас|яагаад|яагад|яг юу|хамаарах уу|хамаарна уу|хамаатай юу|мөн үү|орох уу|exception|бий юу|байгаа юу|yu gesen ug|engiineer|tailbarla|yamar nuhtsuld|ontsgoi nuhtsul|holbogdoh zaalt|yagaad|hamaarah uu|what does (?:it|this) mean|explain|plain language|why|does it apply)/iu;
/** Өгүүлбэрийн ЭХЭНД байвал өмнөх ээлжийг заадаг үг — «Яагаад …», «Тэгвэл …», «Энэ …». */
const LEADING_FOLLOWUP = /^\s*(?:яагаад|яагад|yagaad|yagad|why|тэгвэл|tegvel|тэгэхээр|tegeheer|тэгээд|tegeed|энэ|ene|тэр|ter)(?![\p{L}])/iu;

/**
 * Асуулт ӨМНӨХ ээлж рүү заасан эсэх — заах төлөөний үг («энэ», «тэр»), тайлбарын үргэлжлэл («яагаад»,
 * «юу гэсэн үг»), эсвэл ЭХЭНДЭЭ холбогчтой.  `turnEngine` үүгээр нормын ҮРГЭЛЖЛЭЛ (CONTINUATION) дээр өмнөх
 * баримтад цоожлох эсэхээ шийднэ: ижил салбарын ШИНЭ асуулт («авто угаалгын газрын норм») цоожлогдохгүй.
 */
const BACK_REFERENCE = /(?<![\p{L}])(?:энэ|тэр|түүний|түүнийг|түүнд|тэдгээр|эдгээр|үүнд|үүнийг|тэгвэл|тэгээд|ene|ter|tuunii|tuund|uund|tegvel|tegeed)(?![\p{L}])/iu;
/**
 * ⚠️ Дунд нь орсон заах үг / тайлбарын үг нь УРТ асуултад өмнөх ЭЭЛЖ рүү заадаггүй (2026-09-23, прод дахин шалгалт):
 *    «solongos kompani … hiij boloh uu? tegvel yu anhaarah …» дахь «tegvel» нь ИЖИЛ мессежийн эхний өгүүлбэр рүү,
 *    «GUAT bolon GMDH … oilgomjtoi tailbarlaach» дахь «tailbarla» нь хариултын ХЭЛБЭР рүү заана — хоёулаа өмнөх
 *    ээлжийн УББ 12-204-01-д цоожлогдож даамлын эрхээр хариулагдав (цоожгүйгээр БНбД 11-03-02 / 21-04-05 олддог).
 *    Өөрийн сэдэвтэй урт асуулт цоожлогдохгүй: эхэндээ холбогчтой эсвэл богино (6c-ийн ижил 8 үг) асуулт л.
 */
const SHORT_REFERENCE_WORDS = 8;
export function refersBack(question: string): boolean {
  if (LEADING_FOLLOWUP.test(question)) return true;
  const words = question.trim().split(/\s+/u).filter(Boolean).length;
  return words <= SHORT_REFERENCE_WORDS && (BACK_REFERENCE.test(question) || EXPLAIN_FOLLOWUP.test(question));
}

const RESULT_CONNECTORS = [
  'тэгвэл', 'тэгээд', 'дараа нь', 'тэдгээрээс', 'тэднээс', 'үүнээс',
  'tegvel', 'tegeed', 'daraa n', 'tednees',
  'then', 'and of those', 'of those', 'out of those',
];

/** Өмнөх ээлж ШУУД өмнө нь байсан эсэх (seq зэргэлдээ). */
function seqAdjacent(lastSeq: number, seq: number): boolean {
  return lastSeq >= 0 && seq - lastSeq <= 2;
}

/** Ганцаараа асуулт болдог, СЭДЭВГҮЙ асуултын үгс. */
const BARE_INTERROGATIVES = [
  'яагаад', 'яаж', 'хэзээ', 'хэн', 'хэд', 'хэдэн', 'хаана', 'юугаараа', 'ямар учиртай',
  'yagaad', 'yagad', 'yaj', 'yaaj', 'hezee', 'hen', 'hed', 'heden', 'haana',
  'why', 'how come', 'when', 'who', 'how many', 'how much',
];

const REFERENCE_MARKERS = [
  'эхнийх', 'эхний', 'хоёр дахь', 'гурав дахь', 'сүүлийнх', 'сүүлийн',
  'дээрх', 'дээр дурдсан', 'тэр жагсаалт', 'жагсаалтын', 'тэр тоо',
  'өмнөх хариулт', 'саяын', 'саяны',
  'ehniih', 'ehnii', 'hoyor dahi', 'suuliinh', 'deerh', 'jagsaalt',
  'the first', 'the second', 'the last one', 'that list', 'previous answer', 'above',
];

const CORRECTION_MARKERS = [
  'үгүй ээ', 'үгүй,', 'үгүй.', 'биш ээ', 'биш,', 'биш.', 'гэж хэлсэн', 'гэсэн юм',
  'хэлсэн юм', 'буруу ойлго', 'буруу ойлголоо', 'би хэлсэн', 'тийм биш', 'тэр биш',
  '-г хэлсэн', '-ийг хэлсэн', '-ыг хэлсэн', '-ийг хэлж', '-ыг хэлж', 'гэж хэлж',
  'ugui ee', 'ugui,', 'bish ee', 'gej helsen', 'gesen yum', 'helsen yum', 'buruu oilgo',
  'no,', 'no i meant', 'i meant', 'not that', 'i said', 'wrong one',
];

const EXPLICIT_NEW_TOPIC = [
  'өөр асуулт', 'шинэ асуулт', 'өөр сэдэв', 'бас нэг асуулт', 'дараагийн асуулт',
  'ondoo asuult', 'shine asuult', 'oor asuult',
  'another question', 'new question', 'different question', 'unrelated',
];

/** Олон санааг холбогч — өгүүлбэрийн эхэнд байвал шинэ даалгавар. */
const MULTI_CONNECTORS = [
  'бас ', 'мөн ', 'бас нэг ', 'тэгээд ', 'нэмээд ', 'дээр нь ',
  'bas ', 'mun ', 'bas neg ', 'tegeed ',
  'also ', 'and also ', 'additionally ', 'plus ',
];

/** Хэрэглэгч ӨӨРИЙНХӨӨ тухай асууж байгаа эсэх — persona-д хэрэгтэй. */
const SELF_REFERENCE = [
  'миний', 'надад', 'намайг', 'би ', 'би?', 'өөрийн', 'миний баг', 'миний төсөл', 'миний даалгавар',
  'minii', 'nadad', 'namaig', 'bi ', 'oorii',
  ' my ', 'my ', ' me ', ' me?', ' i ', 'mine',
];

function fold(text: string): string {
  const lower = text.toLowerCase();
  return `${lower} ${normalizeLatinMongolian(lower)}`;
}

function hitAny(hay: string, needles: readonly string[]): string | null {
  for (const n of needles) if (hay.includes(n)) return n;
  return null;
}

function wordCount(text: string): number {
  return text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).length;
}

export function isSelfReference(question: string): boolean {
  const hay = ` ${fold(question)} `;
  return hitAny(hay, SELF_REFERENCE) !== null;
}

/* ================================================================== */
/*  Сэдэв таних                                                        */
/* ================================================================== */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Латин/кирилл ялгаагүй, зайг нэгтгэсэн харьцуулах хэлбэр. */
function nameKey(s: string): string {
  return normalizeLatinMongolian(s.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Асуултад ярианд харагдсан төслийн нэр байгаа эсэх.
 *
 * ⚠️ ХАМГИЙН УРТ тааралтыг авна — «Төв» гэсэн нэр «Төв аймгийн сургууль»
 *    дотор таарч буруу төсөл сонгогдохоос сэргийлнэ.
 * ⚠️ Нэрийн УРТ ≥ 3 тэмдэгт — «A», «12» гэх мэт нэр нь юу ч таарна.
 */
export function findProjectMention(
  question: string,
  seen: readonly SeenProject[],
): SeenProject | null {
  const hay = ` ${nameKey(question)} `;
  let best: SeenProject | null = null;
  let bestLen = 0;
  for (const p of seen) {
    const key = nameKey(p.name);
    // ⚠️ ≥ 4 тэмдэгт — «Төв», «Зам» гэх мэт нэр нь энгийн үгтэй давхцаж
    //    ямар ч асуултад «таарна».  Тийм төслийг зөвхөн #id-аар нэрлэнэ.
    if (key.length < 4) continue;
    // ⚠️ Дэд мөрөөр таарах нь зөвхөн ҮГИЙН ЭХНЭЭС, залгавартай нэрэнд
    //    («Хан-Уул сургуулийн», «Project A-гийн» → «project a giin»).  Нэрийн
    //    сүүлийн үг латин үсгээр ҮРГЭЛЖЛЭХ бол өөр үг: «Project B» нь
    //    «project behind» дотор ТААРЧ «Why is this project behind?»-ийг
    //    Project B-ийн засвар гэж уншуулж байсан.
    const suffixed = key.length >= 6 && new RegExp(` ${escapeRe(key)}(?![a-z0-9])`, 'u').test(hay);
    if (hay.includes(` ${key} `) || suffixed) {
      if (key.length > bestLen) {
        best = p;
        bestLen = key.length;
      }
    }
  }
  // «төсөл #12», «project 12», «12-р төсөл»
  if (best === null) {
    const m = /(?:төсөл|project|tusul|tosol)\s*#?\s*(\d{1,6})\b|#(\d{1,6})\b/u.exec(fold(question));
    const id = m ? Number(m[1] ?? m[2]) : NaN;
    if (Number.isInteger(id)) {
      const p = seen.find((x) => x.id === id);
      if (p) return p;
    }
  }
  return best;
}

/* ================================================================== */
/*  Олон санаа хуваах                                                  */
/* ================================================================== */

/**
 * Мессежийг даалгавруудад хуваана.
 *
 * ⚠️ ХУВААЛТ НЬ ЗӨВХӨН САЛБАР ЗӨРӨХ ҮЕД.  «Хэдэн төсөл байна? Хэд нь
 *    хоцорч байна?» гэсэн хоёр ERP асуулт нь НЭГ даалгавар — нэг
 *    хэрэгслийн багц, нэг хариулт.  Харин «Хэдэн төсөл байна? В2-ийн
 *    галын ачаалал хэд вэ?» нь ХОЁР: ERP + норм, тус тусдаа эх сурвалж.
 *
 * ⚠️ Хэсэг бүр ≥ 2 үгтэй, нийт ≤ 3 даалгавар.  Түүнээс олон бол
 *    эхний гурвыг авч, үлдсэнийг сүүлийнхэд залгана — асуулт алдагдахгүй.
 */
export function splitTasks(question: string): string[] {
  const text = question.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return [];

  // 1. Асуултын тэмдэг, цэг, шинэ мөрөөр хуваана — тэмдгийг ХАДГАЛНА.
  const pieces: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (ch === '?' || ch === '\n' || ch === ';') {
      pieces.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim().length > 0) pieces.push(buf.trim());

  // 2. Холбогчоор эхэлсэн хэсгийг тусдаа даалгавар гэж үзнэ; бусдыг
  //    өмнөхтэй нь НЭГТГЭНЭ («Сайн уу. Хэдэн төсөл байна?» = нэг).
  const segments: string[] = [];
  for (const piece of pieces) {
    const lower = ` ${fold(piece)}`;
    const startsWithConnector = MULTI_CONNECTORS.some((c) => lower.startsWith(` ${c}`));
    const isQuestion = piece.endsWith('?');
    if (segments.length > 0 && !startsWithConnector && !isQuestion) {
      segments[segments.length - 1] = `${segments[segments.length - 1]} ${piece}`;
      continue;
    }
    if (wordCount(piece) < 2 && segments.length > 0) {
      segments[segments.length - 1] = `${segments[segments.length - 1]} ${piece}`;
      continue;
    }
    segments.push(piece);
  }

  // 3. Салбараар нэгтгэнэ — ижил салбарын дараалсан хэсгүүд нэг даалгавар.
  const merged: { text: string; domain: IntentDomain }[] = [];
  for (const seg of segments) {
    const d = domainOf(classifyIntent(seg).intent);
    const last = merged[merged.length - 1];
    if (last && (last.domain === d || d === 'general')) {
      last.text = `${last.text} ${seg}`;
      continue;
    }
    if (last && last.domain === 'general') {
      // Өмнөх нь ерөнхий («Сайн уу») — шинэ салбарын асуулт түүнийг залгина.
      last.text = `${last.text} ${seg}`;
      last.domain = d;
      continue;
    }
    merged.push({ text: seg, domain: d });
  }

  const out = merged.map((m) => m.text.trim()).filter((t) => t.length > 0);
  if (out.length <= 3) return out;
  return [...out.slice(0, 2), out.slice(2).join(' ')];
}

/* ================================================================== */
/*  ГОЛ ФУНКЦ                                                          */
/* ================================================================== */

export interface InterpretInput {
  question: string;
  state: ConvState;
  /** Энэ ээлжийн дугаар — сэдвийн хугацаа тоолоход. */
  seq: number;
  /** Туслахын хамгийн сүүлийн хариулт — тодруулга таниход. */
  lastAssistant?: string | null;
  /**
   * Revit-д СОНГОСОН элементийн тоо (R3.5, 2026-09-15).  «Энэ юу вэ?» гэх мэт ЗААХ үгтэй ерөнхий
   * асуулт нь сонголттой үед REVIT_READ — эс тэгвэл GENERAL_HELP-ийн ERP few-shot загварыг татаж
   * «deadline» гэж хариулдаг байсан (бодит Qwen smoke-д хэмжсэн).  /plan ба /context ИЖИЛ утга өгнө.
   */
  revitSelection?: number;
  /** Add-in детерминист тайлан хавсаргасан — «тайлан гарга» нь ERP биш, Revit-ийн тайлан (R3.5, Q3). */
  revitReport?: boolean;
}

const REVIT_REPORT_WORDS = /(тайлан|тайлаг|report)/u;
const REVIT_DEICTIC = /(^|\s)(энэ|энийг|үүн|үүнийг|энд|this|it)(\s|$)/u;

/** Revit сонголттой + заах үгтэй + ерөнхий/энгийн санаа → REVIT_READ; бусад санаа ХӨНДӨГДӨХГҮЙ. */
function revitDeictic(input: InterpretInput, cls: ReturnType<typeof classifyIntent>): ReturnType<typeof classifyIntent> {
  // Тайлангийн нотолгоо хавсаргасан + «тайлан» үгтэй → REVIT_READ (ERP тайлан/query_entities БИШ).
  if (input.revitReport && REVIT_REPORT_WORDS.test(fold(input.question)) && cls.intent !== 'NORMATIVE' && cls.intent !== 'REVIT_ACTION') {
    return { ...cls, intent: 'REVIT_READ', policy: policyFor('REVIT_READ'), reason: 'Revit тайлангийн нотолгоо + «тайлан»' };
  }
  if (!input.revitSelection || input.revitSelection <= 0) return cls;
  // R4.2: сонголттой + ИЛ мутацийн үйл үг («зөө», «болго», «соли») → REVIT_ACTION (Revit үг байхгүй ч: «Энэ ханыг … зөө»).
  //    Унших/ерөнхий санааг л дээшлүүлнэ; NORMATIVE/ERP хөндөгдөхгүй.
  if ((cls.intent === 'GENERAL_HELP' || cls.intent === 'CASUAL' || cls.intent === 'REVIT_READ') && hasRevitWriteHint(input.question) && REVIT_DEICTIC.test(` ${fold(input.question)} `)) {
    return { ...cls, intent: 'REVIT_ACTION', policy: policyFor('REVIT_ACTION'), reason: 'Revit сонголт + мутацийн үйл үг' };
  }
  if (cls.intent !== 'GENERAL_HELP' && cls.intent !== 'CASUAL') return cls;
  if (!REVIT_DEICTIC.test(` ${fold(input.question)} `)) return cls;
  return { ...cls, intent: 'REVIT_READ', policy: policyFor('REVIT_READ'), reason: 'Revit сонголт + заах үг' };
}

/** Сэдвийн нэрийг асуултад залгана — хайлт, хэрэгслийн төлөвлөгөөнд. */
function resolveText(text: string, subject: ConvSubject | null): string {
  if (subject === null) return text;
  if (subject.kind === 'project') return `${text} (төсөл: ${subject.name})`;
  return `${text} (${subject.kind === 'norm' ? 'норм' : 'ажилтан'}: ${subject.label})`;
}

const STRICTNESS: Record<IntentDomain, number> = {
  norm: 5,
  revit: 4,
  erp: 3,
  calc: 2,
  doc: 1,
  general: 0,
};

/**
 * ⚠️ ГОЛ ФУНКЦ.  Ээлжийг тайлна.
 */
export function interpretTurn(input: InterpretInput): TurnInterpretation {
  const question = input.question.trim();
  const hay = ` ${fold(question)} `;
  const state = input.state;
  const words = wordCount(question);

  const liveSubject = subjectExpired(state, input.seq) ? null : state.subject;
  const lastDomain = domainOf(state.lastIntent);
  const hasHistory = state.lastSeq >= 0;

  const mentioned = findProjectMention(question, state.projectsSeen);

  const mk = (
    kind: TurnKind,
    tasks: TurnTask[],
    subject: ConvSubject | null,
    historyMessages: number,
    reason: string,
  ): TurnInterpretation => {
    const strictest = tasks.reduce(
      (acc, t) => (STRICTNESS[t.domain] > STRICTNESS[acc.domain] ? t : acc),
      tasks[0]!,
    );
    return {
      kind,
      tasks,
      intent: strictest.intent,
      policy: mergePolicy(tasks.map((t) => t.policy)),
      subject,
      historyMessages,
      reason,
    };
  };

  const task = (text: string, subject: ConvSubject | null, intentOverride?: AiIntent): TurnTask => {
    const cls = revitDeictic(input, classifyIntent(text));
    const intent = intentOverride ?? cls.intent;
    return {
      text,
      intent,
      policy: intentOverride ? policyFor(intentOverride) : cls.policy,
      domain: domainOf(intent),
      subject,
      resolvedText: resolveText(text, subject),
    };
  };

  /* ── 1. ОЛОН САНАА ─────────────────────────────────────────────── */
  const parts = splitTasks(question);
  if (parts.length >= 2) {
    const tasks = parts.map((p) => {
      const pm = findProjectMention(p, state.projectsSeen);
      const subj: ConvSubject | null = pm ? { kind: 'project', id: pm.id, name: pm.name } : null;
      return task(p, subj);
    });
    // Хамгийн сүүлийн даалгаврын сэдэв нь дараагийн ээлжийн сэдэв.
    const lastSubj = [...tasks].reverse().find((t) => t.subject !== null)?.subject ?? null;
    return mk('MULTI_INTENT', tasks, lastSubj, 0, `олон санаа: ${tasks.map((t) => t.domain).join('+')}`);
  }

  const own = revitDeictic(input, classifyIntent(question));
  const ownDomain = domainOf(own.intent);

  /* ── 2. ИЛ ШИНЭ СЭДЭВ ──────────────────────────────────────────── */
  if (hitAny(hay, EXPLICIT_NEW_TOPIC)) {
    const subj: ConvSubject | null = mentioned ? { kind: 'project', id: mentioned.id, name: mentioned.name } : null;
    return mk('NEW_TOPIC', [task(question, subj)], subj, 0, 'ил «өөр асуулт»');
  }

  /* ── 2b. НОРМЫН САНГИЙН КАТАЛОГ — бие даасан асуулт ─────────────── */
  // ⚠️ E2E (2026-09-28, эзний бодит чат): «hamgiin hetsuu norm durmiin jagsaaltiig beltge» нь нормын жагсаалтын
  //    ээлжийн ДАРАА «jagsaalt» үгээр REFERENCE_TO_PRIOR_RESULT болж NORMATIVE-ийг өвлөөд, L2 давхарга БНбД 31-17-10-ийн
  //    14.1 заалтыг хариулт болгосон.  Каталогийн асуулт (`detectNormCatalogAsk`) сэдвийн үггүй — өмнөх ээлжээс юу ч
  //    өвлөхгүй, шинэ META ээлж.
  if (own.intent === 'META' && detectNormCatalogAsk(question) !== null) {
    return mk('NEW_TOPIC', [task(question, null)], null, 0, 'нормын сангийн каталог');
  }

  /* ── 3. ЗАСВАР — «үгүй ээ, B-г хэлсэн» ─────────────────────────── */
  const corr = hitAny(hay, CORRECTION_MARKERS);
  if (corr !== null && hasHistory) {
    if (mentioned !== null) {
      const subj: ConvSubject = { kind: 'project', id: mentioned.id, name: mentioned.name };
      // ⚠️ Засварын санаа нь ӨМНӨХ ээлжийнх — «үгүй ээ, B-г хэлсэн» нь
      //    өмнөх асуултыг B дээр ДАХИН асууж байна гэсэн үг.
      const intent = state.lastIntent ?? own.intent;
      const text = state.lastQuestion.length > 0 ? `${state.lastQuestion} (${question})` : question;
      return mk('CORRECTION', [task(text, subj, intent)], subj, 2, `засвар «${corr}» + төсөл нэрлэсэн`);
    }
    // Нэр таарсангүй ч засварын тэмдэгтэй — өмнөх хариултыг харуулж, шинэ
    // сэдвийг задлах хүртэл сэдвийг ХАСНА.
    return mk('CORRECTION', [task(question, null)], null, 2, `засвар «${corr}», сэдэв тодорхойгүй`);
  }

  /* ── 4. ӨМНӨХ ҮР ДҮНД ХАНДАЛТ ──────────────────────────────────── */
  const ref = hitAny(hay, REFERENCE_MARKERS);
  if (ref !== null && hasHistory) {
    const subj = mentioned
      ? ({ kind: 'project', id: mentioned.id, name: mentioned.name } as ConvSubject)
      : liveSubject;
    const intent = ownDomain === 'general' ? (state.lastIntent ?? own.intent) : own.intent;
    return mk('REFERENCE_TO_PRIOR_RESULT', [task(question, subj, intent)], subj, 2, `лавлагаа «${ref}»`);
  }

  /* ── 5. ТОДРУУЛГА — туслах асуусан, хэрэглэгч хариулж байна ────── */
  const assistantAsked = (input.lastAssistant ?? '').trim().endsWith('?');
  if (assistantAsked && hasHistory && words <= 6 && ownDomain === 'general') {
    const subj = mentioned
      ? ({ kind: 'project', id: mentioned.id, name: mentioned.name } as ConvSubject)
      : liveSubject;
    const intent = state.lastIntent ?? own.intent;
    return mk('CLARIFICATION', [task(question, subj, intent)], subj, 2, 'туслахын асуултад хариулав');
  }

  /* ── 5b. НОРМЫН ОРОЛТЫН ҮРГЭЛЖЛЭЛ — «Q=50000 МДж, H=6 м» ────────── */
  // ⚠️ Өмнөх ээлжид нормын төлөв (`state.norm`: оролт, баримт, ангилал) тогтсон
  //    бөгөөд энэ мессеж нь зөвхөн инженерийн ОРОЛТ/тэмдэглэгээ (Q=, H=, кПа,
  //    м³, °C) байвал — тэр тооцооны үргэлжлэл, «ерөнхий тусламж» БИШ.  Хэмжсэн
  //    (GOLD multi-turn, 2026-09-11): «Q=50000 МДж, H=6 м» GENERAL_HELP/NEW_TOPIC
  //    болж, хөдөлгүүр В1 гаргасан ч итгэлийн шошго, нормын хайлт унтарч байв.
  //    Хөдөлгүүр нь оролтыг өмнөх төлөвтэй НЭГТГЭДЭГ (`turnEngine`), энд зөвхөн
  //    санаа/салбарыг зөв тавина.
  if (hasHistory && state.norm !== null && (ownDomain === 'general' || ownDomain === 'calc') && hasEngineeringInputNotation(question)) {
    return mk('FOLLOW_UP', [task(question, null, 'NORMATIVE')], null, 2, 'нормын оролтын үргэлжлэл (state.norm)');
  }

  /* ── 6. ҮРГЭЛЖЛЭЛ — «яагаад», «энэ», богино сэдэвгүй асуулт ────── */
  const anaphora = hitAny(hay, ANAPHORA);
  const bare = hitAny(hay, BARE_INTERROGATIVES);
  const shortAndVague = words <= 5 && ownDomain === 'general';
  // «Яагаад» нь салбарын үгтэй хамт ирсэн ч («why is the project behind»)
  // амьд сэдэвтэй, өөр төсөл нэрлээгүй бол ТЭР сэдвийн шинжилгээ.  «Хэдэн
  // төсөл байна» гэх мэт тоолох асуултыг энд ОРУУЛАХГҮЙ — тэр нь сэдэвгүй
  // шинэ дэд асуулт (доорх 7-р алхам), сэдвийг нь наавал `list_projects`
  // хасагдана.
  const whyWord = bare !== null && /яагаад|yagaad|yagad|why/.test(hay);
  // ⚠️ МЭНДЧИЛГЭЭ / МЕТА ХЭЗЭЭ Ч ҮРГЭЛЖЛЭЛ БИШ (Session C, хэмжсэн): «Чи ямар
  //    model ашигладаг вэ?» нь ≤5 үгтэй «general» тул төслийн сэдэв + өмнөх
  //    COMPANY_FACT санааг ӨВЛӨЖ, «ИДЭВХТЭЙ СЭДЭВ: төсөл …» мөр мета асуултын
  //    prompt-д орж байв.  `researchPlan` хэрэгслийг л хаадаг байсан; санаа,
  //    сэдэв нь гоожсоор байв.
  const socialOwn = own.intent === 'CASUAL' || own.intent === 'META';
  if (hasHistory && liveSubject !== null && mentioned === null && !socialOwn) {
    if (anaphora !== null || (bare !== null && ownDomain === 'general') || (whyWord && ownDomain === lastDomain) || shortAndVague) {
      // ⚠️ Салбар ИЛ ӨӨР бол үргэлжлэл БИШ: «энэ нормын дагуу хэд вэ?»
      //    гэдэг нь төслийн үргэлжлэл биш.  Зөвхөн «general» (сэдэвгүй)
      //    эсвэл өмнөхтэй ижил салбарт л сэдэв өвлөгдөнө.
      if (ownDomain === 'general' || ownDomain === lastDomain) {
        const intent = ownDomain === 'general' ? (state.lastIntent ?? own.intent) : own.intent;
        // Ерөнхий үргэлжлэл дээр ERP-ийн «яагаад» нь ШИНЖИЛГЭЭ.
        const eff: AiIntent =
          intent === 'COMPANY_FACT' && bare !== null && /яагаад|yagaad|why/.test(hay)
            ? 'ERP_ANALYSIS'
            : intent;
        return mk(
          'FOLLOW_UP',
          [task(question, liveSubject, eff)],
          liveSubject,
          2,
          `үргэлжлэл «${anaphora ?? bare ?? 'богино'}» → ${liveSubject.kind}`,
        );
      }
    }
  }

  /* ── 6b. СЭДЭВГҮЙ ERP ҮРГЭЛЖЛЭЛ — «тэгвэл идэвхтэй нь хэд вэ?» ──── */
  // ⚠️ (Session C, хэмжсэн) «Хэдэн төсөл байна?» → «Тэгвэл идэвхтэй нь хэд
  //    вэ?» дараалалд сэдэв (ганц төсөл) байдаггүй тул 6-р дүрэм ажиллахгүй,
  //    NEW_TOPIC болж түүх ч, хэрэгсэл ч орохгүй — загвар санахуйгаас
  //    хариулах зам.  `turnPlan`-ы «өмнөх хэрэгслийг дахин ажиллуул» зам нь
  //    яг энэ төрөлд зориулагдсан атлаа хүрдэггүй байв.
  //    ЗӨВХӨН үр дүнг залгах холбогч («тэгвэл», «тэгээд», «дараа нь») ба ШУУД
  //    өмнөх ээлж дээр — «яагаад» гэх мэт нүцгэн асуултын үг хуучирсан
  //    сэдвийг амилуулахгүй (TTL-ийн тест хамгаална).
  const resultConnector = hitAny(hay, RESULT_CONNECTORS);
  if (hasHistory && seqAdjacent(state.lastSeq, input.seq) && liveSubject === null && mentioned === null && !socialOwn && ownDomain === 'general' && lastDomain === 'erp' && resultConnector !== null) {
    const intent = state.lastIntent ?? own.intent;
    return mk('FOLLOW_UP', [task(question, null, intent)], null, 2, `сэдэвгүй ERP үргэлжлэл «${resultConnector}»`);
  }

  /* ── 6c. СЭДЭВГҮЙ НОРМЫН ҮРГЭЛЖЛЭЛ — «Архивт 200 мянган нэгж бол?» ── */
  // ⚠️ (хэмжсэн 2026-09-18, прод) «…600 мянган нэгж бол ГУАТ уу?» → «Архивт 200 мянган нэгж бол?»
  //    гэсэн хоёр дахь асуултад нормын түлхүүр үг байхгүй тул GENERAL_HELP/NEW_TOPIC болж, загвар
  //    ERP-ийн төслийн тухай утгагүй хариулж байв.  ШУУД өмнөх ээлж норм + богино нөхцөлт/тоотой
  //    асуулт («… бол?», «тэгвэл …», тоо агуулсан) = тэр нормын асуултын ХУВИЛБАР.  Мэндчилгээ/мета,
  //    ERP/Revit үгтэй асуулт энд ОРОХГҮЙ (ownDomain 'general' л).
  const conditionalTail = /(?:^|\s)(?:бол|bol|гэвэл|gevel|үед|ued)\s*\??\s*$/iu.test(question);
  // L2 (2026-09-18): «энэ юу гэсэн үг вэ?», «энгийнээр тайлбарла», «ямар нөхцөлд хамаарах вэ?», «онцгой нөхцөл
  //    байгаа юу?», «холбогдох заалт нь?» — шууд өмнөх нормын ээлжийн ЗААЛТЫН тайлбарын үргэлжлэл (turnEngine
  //    хаягаар угтварлана).  Богино, сэдэвгүй, ERP/Revit үггүй л.
  const explainAsk = EXPLAIN_FOLLOWUP.test(question);
  // ⚠️ «Яагаад …» / «Тэгвэл …» гэж ЭХЭЛСЭН асуулт урт байсан ч өмнөх заалтын үргэлжлэл (2026-09-23, эзний HL02:
  //    «yagaad zaaval 2 udaa sanal tavisan baih yostoi gej? neg udaa helehed bolohgui yum uu» — 14 үг тул
  //    8 үгийн хязгаарт унаж NEW_TOPIC болж, загвар нотолгоогүйгээр «Танд хоёр удаа санал тавьсан байна…» гэж
  //    зохиосон).  Эхний үг нь заах/асуух үг байх нь «сэдвийг өөрчилсөн» биш «өмнөхөө асууж байна» гэсэн дохио.
  const leadsWithCue = LEADING_FOLLOWUP.test(question);
  if (hasHistory && seqAdjacent(state.lastSeq, input.seq) && mentioned === null && !socialOwn && ownDomain === 'general' && lastDomain === 'norm' && (words <= 8 || (leadsWithCue && explainAsk)) && (resultConnector !== null || conditionalTail || /\d/.test(question) || explainAsk)) {
    return mk('FOLLOW_UP', [task(question, null, 'NORMATIVE')], null, 2, `сэдэвгүй нормын үргэлжлэл «${resultConnector ?? (conditionalTail ? 'бол' : explainAsk ? 'тайлбар' : 'тоо')}»`);
  }

  /* ── 7. ИЖИЛ САЛБАР, ШИНЭ ДЭД АСУУЛТ ───────────────────────────── */
  if (hasHistory && ownDomain !== 'general' && ownDomain === lastDomain) {
    const subj: ConvSubject | null = mentioned
      ? { kind: 'project', id: mentioned.id, name: mentioned.name }
      : ownDomain === 'erp' || ownDomain === 'revit'
        ? liveSubject
        : null;
    // ⚠️ Нормын үргэлжлэлд өмнөх ХАРИУЛТ хэрэгтэй («тэгвэл В3?»), гэвч
    //    сэдэв нь тэмдэглэгээгээрээ өөрөө танигддаг тул шинэ асуултын
    //    хайлт нь ЦЭВЭР явна.
    return mk('CONTINUATION', [task(question, subj)], subj, 2, `ижил салбар (${ownDomain})`);
  }

  /* ── 8. ШИНЭ СЭДЭВ — өгөгдмөл ──────────────────────────────────── */
  const subj: ConvSubject | null = mentioned
    ? { kind: 'project', id: mentioned.id, name: mentioned.name }
    : null;
  const why = !hasHistory
    ? 'ярианы эхлэл'
    : ownDomain !== lastDomain
      ? `салбар солигдов ${lastDomain}→${ownDomain}`
      : 'сэдэвгүй шинэ асуулт';
  return mk('NEW_TOPIC', [task(question, subj)], subj, 0, why);
}

/* ================================================================== */

/** Олон даалгаврын бодлогыг нэгтгэнэ — ХАМГИЙН ХАТУУ нь ялна. */
export function mergePolicy(policies: readonly EvidencePolicy[]): EvidencePolicy {
  return {
    needsRetrieval: policies.some((p) => p.needsRetrieval),
    evidenceMandatory: policies.some((p) => p.evidenceMandatory),
    needsErpTools: policies.some((p) => p.needsErpTools),
    needsRevit: policies.some((p) => p.needsRevit),
    showConfidenceBadge: policies.some((p) => p.showConfidenceBadge),
  };
}
