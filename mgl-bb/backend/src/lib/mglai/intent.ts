/**
 * MGL AI · САНААНЫ АНГИЛАЛ БА НОТОЛГООНЫ БОДЛОГО (§4, §5).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  Өмнө нь БҮХ асуулт НЭГ бодлогоор
 *    явдаг байсан: «нотолгоо байхгүй бол татгалз».  Үр дүнд нь
 *    «Чи юу хийж чадах вэ?» гэсэн асуултад ч «Нотолгоо хүрэлцэхгүй»
 *    гэж хариулдаг байв.  Тэр нь бүтээгдэхүүнийг эвдэрсэн мэт харуулна.
 *
 *    Асуулт бүр өөр НОТОЛГООНЫ ШААРДЛАГАТАЙ:
 *      · «Чи хэн бэ?»            → нотолгоо ОГТ хэрэггүй
 *      · «Хэдэн ажилтан байна?»  → ERP хэрэгсэл ЗААВАЛ
 *      · «Хэдэн гарц хэрэгтэй?»  → баталгаажсан норм ЗААВАЛ
 *
 * ⚠️ АНГИЛАЛЫГ ЗАГВАРТ ДААЛГАХГҮЙ (өмнө нь оролдоод унасан).  4B/8B
 *    загвар нормын асуултыг «энгийн» гэж ангилаад шаардлагыг ЗОХИОДОГ
 *    байв — §15-ын зөрчил.  Сервер шийднэ, тестээр цоожилно.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — D1-гүй, бүрэн тестлэгдэнэ.
 */
import { foldText } from '../textFold';
import { detectLanguage, normalizeLatinMongolian } from './lang';
import { detectNormCatalogAsk } from './normCatalog';
import { detectSmallTalk } from './smallTalk';
import { isRegulatedTopicRequest } from './norm/questionKind';

export const AI_INTENTS = [
  'CASUAL',
  'META',
  'GENERAL_HELP',
  'COMPANY_FACT',
  'ERP_ANALYSIS',
  'REVIT_READ',
  'REVIT_ACTION',
  'NORMATIVE',
  'DOCUMENT_ANALYSIS',
  'CALCULATION',
] as const;

export type AiIntent = (typeof AI_INTENTS)[number];

export interface EvidencePolicy {
  /** Хайлт хийх шаардлагатай эсэх. */
  needsRetrieval: boolean;
  /** Нотолгоогүй бол хариу өгөхийг ХОРИГЛОХ эсэх. */
  evidenceMandatory: boolean;
  /** ERP хэрэгсэл дуудах эсэх. */
  needsErpTools: boolean;
  /** Revit контекст шаардах эсэх. */
  needsRevit: boolean;
  /**
   * Итгэлийн шошгыг UI-д ХАРУУЛАХ эсэх.
   *
   * ⚠️ §4: «The evidence badge/status should be shown only when relevant.»
   *    Мэндчилгээн дээр «Нотолгоо хүрэлцэхгүй» гэж харуулах нь утгагүй.
   */
  showConfidenceBadge: boolean;
}

/* ================================================================== */
/*  Түлхүүр үгс — кирилл БОЛОН латин монгол, англи                     */
/* ================================================================== */

/**
 * ⚠️ ЛАТИН ХУВИЛБАРЫГ ЗААВАЛ ОРУУЛНА.  Хэрэглэгч «ene project yagaad
 *    udaad bna» гэж бичихэд ангилал ажиллах ёстой.  Хэвийжүүлэлт нь
 *    ихэнхийг барина ч бүх хэлбэрийг биш.
 */
const NORMATIVE_HINTS = [
  'бнбд', 'бд ', 'mns', 'мнс', 'норм', 'стандарт', 'дүрэм', 'заалт', 'юу гэж заасан', 'заасан бэ', 'заасан вэ',
  'зөвшөөрөгдөх', 'хэм хэмжээ',
  // ⚠️ «ангилал» ГАНЦААРАА норм БИШ — «төслийн ангилал ZA» нь ERP-ийн ойлголт
  //    (хэмжсэн, Session C).  Нормын ангилал нь тодотголтой ирдэг.
  'галын аюулын ангилал', 'аюулын ангилал', 'ангилалд хамаарах', 'ямар ангилалд', 'аль ангилал', 'ангилал вэ', 'ангилалд орох', 'ali angilal*', 'yamar angilal*', 'angilald*',
  'эвакуац', 'гарц', 'галын', 'гал унтраах', 'галд тэсвэр',
  // ⚠️ БНбД 21-04-05-ын товчлолууд (хэмжсэн 2026-09-18, прод): «Архивт 600 мянган нэгж баримт хадгалдаг
  //    бол ГУАТ уу, ГМДХ уу?» нь «баримт» үгээр DOCUMENT_ANALYSIS болж, загвар «ГМДХ = Гурван Мянган
  //    Дагуул Хадгалагч» гэж ЗОХИОСОН.  Товчлол = норм.
  'гуат', 'гмдх', 'guat', 'gmdh', 'галын дохиолол', 'дохиоллын хэрэгсэл', 'автомат төхөөрөмж', 'спринклер', 'sprinkler', 'fire alarm',
  // ⚠️ Гэрэлтүүлэг/люкс (хэмжсэн 2026-09-18, өөр сесс): «Ажлын байрны гэрэлтүүлэг хэдэн лк байх ёстой вэ?»
  //    GENERAL_HELP → `query_entities` (ERP!) руу явж «…гэсэн төслийг алга» гэж хариулж байв.  Гэрэлтүүлгийн
  //    норм, люкс нь БНбД 31-2x-ийн нутаг дэвсгэр.
  'гэрэлтүүл', 'люкс', 'gereltuul*', 'lyuks*', 'lux', 'illuminance', 'lighting level',
  // «хэдэн хоногийн дотор нээх/мэдэгдэх/хүргэх вэ» — хугацааны ҮҮРЭГ (УББ 12-01-01, 12-204-01); өмнө нь зөвхөн
  //    «батлах/хянах» залгамжтай хэлбэр байсан тул «Барилгын хувийн хэргийг хэдэн хоногийн дотор нээх вэ?»
  //    GENERAL_HELP болж загвар «3 хоног» ЗОХИОСОН (хэмжсэн 2026-09-18; зөв нь 15, 2.21).
  'хоногийн дотор', 'хоногт багтаан', 'honogiin dotor', 'within how many days', 'хувийн хэрэг', 'huviin hereg',
  // Даамлын үлгэрчилсэн дүрэм (УББ 12-204-01) — «Даамал ямар тохиолдолд хариуцлага хүлээх вэ?» free гэрээтэй
  //    үлдэж загвар зохиож байв (хэмжсэн 2026-09-18).
  'даамал', 'даамл', 'daamal', 'daaml*', 'foreman',
  // Геодези/инженер-геологи (БНбД 11-08-23, 11-03-21): «геодезийн үндэслэлийг хэдэн хоногийн өмнө…» free
  //    гэрээтэй үлдэж «хоёр долоо хоног» зохиогдож байв (зөв: 10-аас доошгүй хоног, 4.20).
  'геодез', 'geodez*', 'geodetic', 'инженер-геолог', 'геотехник', 'хоногийн өмнө', 'honogiin omno',
  // Барилгын төлөвлөлтийн норм (БНбД 31-2x): «Цэцэрлэгийн барилга хэдэн давхар байж болох вэ?», «CO₂ IDA2
  //    ангилалд хэд байх вэ?» GENERAL_HELP болж байв.  «хэдэн … байж болох вэ» / «хэд байх вэ» = зөвшөөрөгдөх
  //    хэмжээний асуулт; барилгын төрөл (цэцэрлэг, сургууль, орон сууц) + агаар солилцоо (ppm, IDA) норм.
  //    ⚠️ Барилгын ТӨРЛИЙН нэр («цэцэрлэг», «сургуулийн барилга») ГАНЦААРАА норм БИШ — төслийн нэрэнд байдаг
  //    («MGL-260804 Цэцэрлэг») тул засварын ээлж норм болж татгалзал бичиж байв (SFT угсрагч барьсан).
  'байж болох вэ', 'baij boloh ve', 'baij bolh ve', 'хэд байх вэ', 'hed baih ve', 'хэдэн давхар', 'heden davhar',
  'ppm', 'ida1', 'ida2', 'ida3', 'ida4', 'co2', 'co₂', 'агаар солилц',
  // ⚠️ «ачаалал», «өндөр» ГАНЦААРАА норм БИШ: «хэний ачаалал өндөр вэ» нь
  //    ажилтны ачаалал (ERP).  Нормын утга нь ҮРГЭЛЖ тодотголтой ирдэг —
  //    «галын ачаалал», «ачааллын нягтрал», «зөвшөөрөгдөх өндөр».
  'галын ачаалал', 'ачааллын', 'тооцоот ачаалал', 'даац', 'зузаан',
  'шатны өргөн', 'гарцын өргөн', 'хаалганы өргөн', 'коридорын өргөн', 'замын өргөн',
  'өндрийн хязгаар', 'зөвшөөрөгдөх өндөр',
  // ⚠️ Held-out H16/H17/H30 (2026-09-10): шат/гишгүүр/хашлага нь ҮРГЭЛЖ нормын
  //    асуулт («гишгүүрийн өндөр» — «өндөр» ганцаараа норм биш байсан тул
  //    загвар «12 метр» зохиосон); захиалагчийн эрх/үүрэг/дүрэм ба «зураг
  //    төслийн даалгавар» (design brief) нь УББ 12-01-01-ийн нутаг дэвсгэр —
  //    «даалгавар» ERP-ийн үг тул тэр ганцаараа хангалтгүй.
  // ⚠️ «зураг төслийн даалгавар» / «design brief» ГАНЦААРАА норм БИШ («…гэж юу вэ» нь ойлголтын
  //    асуулт, багц v.4 explain-* үүнийг барьсан) — хугацааны үүрэг хэлбэр («хэдэн хоногийн
  //    дотор батлах») нь норм.
  'гишгүүр', 'шатны', 'хашлага', 'налуу', 'ханын галд', 'захиалагчийн үүрэг', 'захиалагчийн эрх', 'захиалагчийн дүрэм',
  'хоногийн дотор батлах', 'хоногт батлах', 'хоногийн дотор хүргэ', 'хоногийн дотор хянаж', 'хоногт хянаж',
  'gishguur*', 'shatnii*', 'hashlaga*', 'zahialagchiin uureg', 'zahialagchiin erh', 'honogiin dotor batlah', 'honogt batlah', 'stair', 'handrail', 'riser height', 'within how many days must',
  // ⚠️ «шаардлага» ГАНЦААРАА норм БИШ — «төслийн шаардлага юу вэ» нь ERP
  //    (хэмжсэн, Session C).  «шаардлагатай вэ» (хэд хэрэгтэй вэ), «нормын
  //    шаардлага» хэлбэрүүд норм.
  'шаардлагатай вэ', 'нормын шаардлага', 'стандартын шаардлага', 'шаардлагыг ханга', 'ямар шаардлага',
  'regulation', 'standard', 'code requires', 'fire exit', 'evacuation', 'egress',
  'bnbd', 'бnбd', 'norm', 'normative', 'мнс',
  // Латин галиг + материалын шаардлага — `context.ts`-ийн REGULATORY_HINTS-тэй хамт.
  // `*` = галигийн язгуур, угтвараар таарна (`matchNeedle`).
  'бетон', 'марк ', 'standart*', 'duram*', 'zaalt*', 'shaardlag*', 'galiin*', 'galyn*', 'tesverleh*', 'beton*',
  'concrete grade', 'fire rating', 'fire resistance', 'fire load',
];

const COMPANY_HINTS = [
  // ⚠️ МОРФОЛОГИ: «ажилтны», «ажилтнууд», «төслийн», «даалгаврын» нь нэрлэх
  //    хэлбэрээ АГУУЛДАГГҮЙ (эгшиг гээгдэнэ) — язгуураар («ажилтн», «төсл»,
  //    «даалгавр»).  Хэмжсэн (Session C): «Ажилтны тоо хэд вэ?» GENERAL_HELP
  //    болж хэрэгсэлгүй үлдэж байв.
  'ажилтан', 'ажилтн', 'ажиллаж', 'ажилладаг', 'хүн ажиллаж', 'хэдэн хүн', 'хүнтэй', 'ажилчид', 'хэний', 'хэн юу',
  'төсөл', 'төсл', 'даалгавар', 'даалгавр', 'таск',
  'багийн', 'багууд', 'гишүүд', 'гишүүн',
  'хугацаа', 'дедлайн', 'хоцор', 'явц', 'ачаалал',
  'тайлан', 'манай', 'компани',
  'employee', 'project', 'deadline', 'task', 'workload', 'report', 'headcount', 'staff',
  'ajiltan*', 'ajiltn*', 'tusl*', 'tosl*', 'daalgavr*', 'hotsor*',
];

const REVIT_HINTS = [
  'revit', 'сонгосон', 'сонгогдсон', 'view', 'family', 'параметр',
  'parameter', 'элемент', 'element', 'wall', 'хана', 'ханы', 'ханан', 'sheet',
  // ⚠️ «schedule» ГАНЦААРАА БИШ — «behind schedule» (хоцорсон) ERP-ийн хэллэг
  //    (хэмжсэн, Session C).  Revit-ийн schedule нь тодотголтой.
  'revit schedule', 'schedule view', 'door schedule', 'window schedule', 'room schedule', 'wall schedule',
  'workset', 'загвар дээр', 'model дээр',
];

// R4.2: ИЛ мутацийн үйл үг л — «болго», «зөө», «соли», «өөрчлөх санал».  «Энэ хана ямар байна?» гэх мэт
//    унших асуулт бичих санаа болохгүй (тест: intent.test / turn.test).
const REVIT_WRITE_HINTS = [
  'өөрчил', 'засаж өг', 'үүсгэ', 'устга', 'солиод өг', 'тохируул',
  'болго', 'болгож', 'зөө', 'зөөх', 'соли', 'солих', 'өөрчлөх санал', 'өөрчлөлтийн санал', 'засах санал',
  'change', 'create', 'delete', 'set the', 'rename', 'move ', 'set comments',
];

// ⚠️ «бод» → «бодлого/бодит/бодол», «хувь» → «миний хувьд/хувьцаа» ДАВХЦДАГ
//    (хэмжсэн, Session C).  Үйл үгийн хэлбэр ба «хэдэн хувь» гэсэн хэлбэрээр.
const CALC_HINTS = [
  'тооц', 'бодож', 'бодоод', 'бодох', 'бодоорой', 'бод ', 'бод?', 'бод.', 'хэдэн болох', 'нийт хэд', 'дүнг гарга',
  'талбай', 'эзэлхүүн', 'хэдэн хувь', 'хувь нь', 'хувиар', 'хувийг тооц',
  'calculate', 'compute', 'total', 'sum',
];

const DOC_HINTS = [
  'товчил', 'хураангуйл', 'дүгнэ', 'уншаад', 'энэ текст',
  'энэ тайлан', 'баримт', 'summarize', 'summary', 'rewrite', 'review', 'proofread',
  'ойлгомжтой болго', 'засварла',
];

/**
 * МЕТА — AI өөрийнхөө тухай.
 *
 * ⚠️ Энэ ангилал нь БҮТЭЭГДЭХҮҮНИЙ ЭХНИЙ СЭТГЭГДЭЛ.  Шинэ хэрэглэгчийн
 *    хамгийн эхний асуулт нь бараг үргэлж «чи юу хийж чадах вэ?» байдаг
 *    бөгөөд тэр асуултад «Нотолгоо хүрэлцэхгүй» гэж хариулах нь
 *    бүтээгдэхүүнийг үхсэн мэт харуулна.
 */
const META_HINTS = [
  'чи юу', 'чи хэн', 'юу хийж чад', 'юу мэдэх', 'яаж туслах',
  'чи ямар', 'ямар асуулт', 'юунд тусал', 'чиний чадвар', 'ямар чадвартай', 'чадвартай вэ',
  'монголоор ярьж', 'монгол хэлээр',
  'what can you', 'who are you', 'what do you do', 'how can you help',
  'your capabilities', 'help me with',
];

const CASUAL_HINTS = [
  'сайн уу', 'сайн байна уу', 'баярлалаа', 'баяртай', 'уучлаарай',
  'өглөөний мэнд', 'оройн мэнд', 'юу байна',
  'hello', 'hi', 'thanks', 'thank you', 'good morning', 'bye', 'goodbye',
  'sain uu', 'sain bna uu', 'bayarlalaa',
];

// Кирилл түлхүүр үгсийн ФОЛДОЛСОН хэлбэр — латин монгол асуултад (`foldedHit`).
const NORMATIVE_F = foldNeedles(NORMATIVE_HINTS);
const COMPANY_F = foldNeedles(COMPANY_HINTS);
const REVIT_F = foldNeedles(REVIT_HINTS);
const REVIT_WRITE_F = foldNeedles(REVIT_WRITE_HINTS);
const CALC_F = foldNeedles(CALC_HINTS);
const DOC_F = foldNeedles(DOC_HINTS);
const META_F = foldNeedles(META_HINTS);
const CASUAL_F = foldNeedles(CASUAL_HINTS);

/**
 * ТҮЛХҮҮР ҮГИЙН ТААРАЛТ — ҮГИЙН ЭХНЭЭС (Session C, 2026-09-11, хэмжсэн).
 *
 * ⚠️ Өмнө нь ЭНГИЙН дэд мөр (`includes`) байсан бөгөөд 29 held-out асуултын
 *    17 нь буруу ангилагдаж байв: «бод» → «бодлого», «хувь» → «миний хувьд»
 *    (CALCULATION); «view» → «review», «wall» → «wallet» (REVIT); «norm» →
 *    «normal», «stair» → «upstairs» (NORMATIVE); «hi » → «this » (CASUAL).
 *
 *    Одоо:
 *      · кирилл / олон үгтэй түлхүүр = ҮГИЙН ЭХНЭЭС угтвараар («төсл» →
 *        «төслийн», «төслүүд» — монгол хэл залгавартай тул угтвар ЗӨВ);
 *      · латин ГАНЦ үг = БҮТЭН үг (+s/es), учир нь англи үгс угтвараар
 *        давхцдаг («norm/normal»);
 *      · латин үгийн төгсгөлд `*` = латин МОНГОЛ галигийн язгуур, угтвараар
 *        («shaardlag*» → «shaardlagatai»).
 */
const LATIN_WORD = /^[a-z]+$/;

function matchNeedle(haystack: string, needle: string): boolean {
  if (needle.endsWith('*')) return wordStartIncludes(haystack, needle.slice(0, -1));
  if (LATIN_WORD.test(needle)) {
    return new RegExp(`(?<![a-z])${needle}(?:s|es)?(?![a-z])`, 'u').test(haystack);
  }
  return wordStartIncludes(haystack, needle);
}

function wordStartIncludes(haystack: string, needle: string): boolean {
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    if (idx === 0 || !/\p{L}/u.test(haystack[idx - 1]!)) return true;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return false;
}

function hit(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => matchNeedle(haystack, n));
}

function wordCount(text: string): number {
  return text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).length;
}

/**
 * НОРМЫН ТЭМДЭГЛЭГЭЭ — түлхүүр үггүй ч норм гэдэг нь тодорхой.
 *
 * ⚠️ ЯАГААД ТУСДАА REGEX ХЭРЭГТЭЙ ВЭ.  «g=1800 MJ/m2 bol V2 yu V3 yu»
 *    гэсэн асуултад «норм», «стандарт» гэсэн ҮГ ОГТ БАЙХГҮЙ — гэвч энэ
 *    нь БД 21-101-12-ын галын ачааллын ангиллын асуулт бөгөөд буруу
 *    хариулбал аюулгүй байдлын шийдвэрт нөлөөлнө.  Түлхүүр үгэнд
 *    тулгуурласан ангилал үүнийг АЛДДАГ байсан (тестээр баригдсан).
 *
 * ⚠️ Кирилл ба латин ХОЁУЛАНГ нь барина: «В2» (кирилл В) ба «V2» (латин).
 *    Хэрэглэгч гараа сольж бичдэггүй тул хоёулаа бодит хэрэглээ.
 */
const NORMATIVE_NOTATION: readonly RegExp[] = [
  // Галын ачааллын нягтрал: 1800 MJ/m2, 1800 МДж/м², «2 200 мджм2» (зураасгүй — GAP-022)
  /\d+\s*(mj|мдж)\s*\/?\s*(m2|м2|м²)/i,
  // «g = 1800», «g нь 2200», «g ni 2200», «g: 1800» — энэ системд `g` нь ЗӨВХӨН хувийн галын
  //    ачаалал (БД 21-101-12); ганц утга ч нормын асуулт.  Q/H/S нь төлөвтэй л (turn.ts 5b).
  /(?:^|[\s,;(])g\s*(?:=|:|нь|ni)\s*\d/iu,
  // Галын аюулын ангилал: В1–В4 (кирилл В ба латин V).  ⚠️ Зөвхөн В-д
  //    дэд ангилал байдаг; «д1 хуудас», «а1 формат» гэх мэт норм БИШ
  //    (хэмжсэн, Session C).
  /(?:^|[\s=(])[вv][1-4](?:[\s,)?]|$)/i,
  // Заалтын дугаар: «4.2.1-д», «Хүснэгт 4»
  // ⚠️ ASCII `\b` кирилл үсгийн хажууд ҮҮСДЭГГҮЙ — «Хүснэгт 4» хэзээ ч
  //    таардаггүй байсан (тестээр баригдав).  Үгийн хилийг `(?<!\p{L})`-ээр.
  /(?<!\p{L})хүснэгт\s*\d+/iu,
  /(?<!\p{L})table\s*\d+/iu,
  // Норматив баримтын дугаарлалт: 21-101-12 (2-3-2 бол ганцаараа хангалттай),
  //    2-2-2 (11-03-21) бол утасны дугаар/огноотой (99-11-22, 11-09-26) давхцдаг
  //    тул угтвар (БНбД/БД/УББ/СНиП/MNS) эсвэл залгавар («-д», «-ийн», «-т»)
  //    шаардана (хэмжсэн, Session C).
  /\b\d{2}-\d{3}-\d{2}\b/,
  /(?:бнбд|бд|убб|снип|mns|мнс|bnbd|ubb|snip|норм|norm)\s*-?\s*(?:ii-)?\d{2}-\d{2}-\d{2}\b/iu,
  /\b\d{2}-\d{2}-\d{2}-(?:д|т|ийн|ын|ийг|ыг|аар|ээр)(?!\p{L})/u,
  // Кодын угтваргүй currentness асуулт: «31-17-10 ба 31-17-23 хоёрын аль нь мөрдөгдөх вэ?».
  // Огноо/утаснаас ялгахын тулд кодын дараа ЗААВАЛ currentness үг шаардана.
  /(?:^|[^\d])\d{2}-\d{2,3}-\d{2}(?:\s*(?:ба|эсвэл|vs\.?|\/|,)?\s*\d{2}-\d{2,3}-\d{2})?[^\n]{0,80}(?:хүчинтэй|хүчин төгөлдөр|мөрд\p{L}*|аль нь|солигд\p{L}*|батлагд\p{L}*|төсөл|draft)/iu,
  // Захиалагчийн (үндсэн) үүрэг/эрх/хариуцлага/дүрэм — УББ 12-01-01 (хооронд 0–2 үг).
  /захиалагч[\p{L}]*(?:\s+[\p{L}]+){0,2}\s+(?:үүрэг|эрх|хариуцлага|дүрэм)/iu,
  /zahialagch[a-z]*(?:\s+[a-z]+){0,2}\s+(?:uureg|erh|hariutslaga|duram)/iu,
  // «хэдэн лк байх ёстой вэ», «хэд мм байх ёстой» — ХЭМЖИГДЭХҮҮНИЙ хэмжээг «байх ёстой» гэж асуусан =
  //    шаардлагын асуулт (норм).  «хэн хийх ёстой вэ» (ERP) энд орохгүй — нэгжийн үг заавал.
  /хэд(?:эн)?\s+(?:лк|люкс|мм|см|м|м2|м²|м3|м³|кпа|кв|квт|дб|°c|градус|хувь|%|хоног|цаг)(?!\p{L})[^\p{L}]*(?:\S+\s+){0,3}байх\s+ёстой/iu,
  /hed(?:en)?\s+(?:lk|lux|mm|sm|m|m2|m3|kpa|kv|kvt|db|huvi|%|honog|tsag)\s+(?:\S+\s+){0,3}baih\s+(?:yostoi|estoi)/iu,
];

function hitNotation(text: string): boolean {
  return NORMATIVE_NOTATION.some((re) => re.test(text));
}

/* ================================================================== */
/*  Латин монгол ↔ кирилл түлхүүр үг — ФОЛДООР (2026-09-23)            */
/* ================================================================== */

/**
 * ⚠️ ЯАГААД.  `normalizeLatinMongolian` нь ЖИЖИГ ТОЛЬ БИЧИГ (танихгүй үгийг латинаар нь үлдээнэ):
 *    «chi yg yu hiij chaddag yum be» → «чи yg юу hiij chaddag yum be» — «юу хийж чад» таарахгүй тул
 *    кирилл хувилбар нь META, латин нь GENERAL_HELP болж загвар «Хэн ч зөв хариулж чадахгүй…» гэж
 *    зохиосон (эзний HL09, 2026-09-23).  Хайлтын систем үүнийг `foldText` (кирилл ба латинаас НЭГ
 *    дуудлагын түлхүүр: «юу хийж чад» → `iu hij chad`, «yu hiij chaddag» → `iu hij chadag`)-оор
 *    аль хэдийн шийдсэн.  Энд КИРИЛЛ түлхүүр үгсийг фолдолж, ЗӨВХӨН латин монгол / холимог асуултад
 *    ҮГИЙН ЭХНЭЭС тулгана (кирилл асуулт хэвийн замаар, англи асуултад «norm» ↔ «normal» мэт давхцлаас
 *    сэргийлж огт хэрэглэхгүй).
 * ⚠️ Төгсгөлдөө зай/цэгтэй түлхүүр («бод », «марк ») нь БҮТЭН үг — фолд нь зайг хасдаг тул тусад нь тэмдэглэнэ.
 */
interface FoldedNeedle {
  f: string;
  whole: boolean;
}

/**
 * ⚠️ Фолд давхар эгшгийг ХУРААДАГ тул зарим түлхүүр нийтлэг асуултын үгтэй НЭГ түлхүүр болно: «хана» (Revit-ийн
 *    хана) ↔ «хаана» (хаана вэ) хоёулаа `hana` — «Spreadsheet-ээ хаана хадгалах вэ?», «upstairs office хаана байна»
 *    REVIT_READ болж байв (production-readiness intent-routing, 2026-09-23).  Ийм түлхүүрийг фолдын замд АЛГАСНА;
 *    кирилл асуултын энгийн зам хөндөгдөхгүй.
 */
function foldNeedles(list: readonly string[]): FoldedNeedle[] {
  // ⚠️ Функц дотор — `*_F` тогтмолууд модулийн ЭХЭНД (энэ мөрөөс өмнө) үүсдэг тул модулийн түвшний const TDZ-д унана.
  const collisions = ['хаана', 'хаанаас', 'хаашаа', 'хэзээ', 'яаж', 'яагаад', 'байна', 'байгаа', 'байдаг', 'болно', 'гэсэн', 'гэдэг'].map((w) => foldText(w));
  const out: FoldedNeedle[] = [];
  for (const n of list) {
    if (!/\p{Script=Cyrillic}/u.test(n)) continue;
    const f = foldText(n);
    if (f.length < 4) continue;
    const whole = /[\s?.!,]$/u.test(n);
    if (collisions.some((w) => (whole ? w === f.trim() : w.startsWith(f)))) continue;
    out.push({ f, whole });
  }
  return out;
}

function foldedHit(hayFolded: string, needles: readonly FoldedNeedle[]): boolean {
  if (needles.length === 0 || hayFolded.length === 0) return false;
  const hay = ` ${hayFolded} `;
  return needles.some(({ f, whole }) => (whole ? hay.includes(` ${f} `) : hay.includes(` ${f}`)));
}

/** Латин монгол эсвэл холимог асуулт уу — фолдын замыг ЗӨВХӨН эдгээрт асаана. */
function isLatinMongolian(question: string): boolean {
  const lang = detectLanguage(question).language;
  return lang === 'mn-Latn' || lang === 'mixed';
}

/* ================================================================== */
/*  Хүний ярианы хэлбэртэй нормын асуулт — БҮТЦЭЭР (2026-09-23)        */
/* ================================================================== */

/**
 * ⚠️ ЯАГААД.  Түлхүүр үгийн жагсаалт нь НОРМЫН ХЭЛЛЭГИЙГ хүлээдэг («захиалагчийн үүрэг»), харин хүн
 *    ӨӨРИЙН НӨХЦӨЛӨӨС эхэлж асуудаг.  Эзний тест (2026-09-23, прод, адаптер 0.4):
 *      · «bi zahialagch, udahgui barilga barih gej bna. minii hamgiin gol uureg yu ve» → GENERAL_HELP
 *        («захиалагч» ба «үүрэг» 7 үгээр зайтай, өгүүлбэр хооронд) → загвар ERP-ийн төслийн тоо ярьсан;
 *      · «solongos kompani manai tosliin zurgiig hiij boloh uu» → COMPANY_FACT («компани», «манай») →
 *        «Үгүй — …голомжтой…» гэсэн утгагүй хариу «Нотолгоотой» шошготой;
 *      · «tsetserlegiin togloomiin talbai deer nar heden tsag tusah yostoi ve» → GENERAL_HELP (кирилл
 *        хувилбар нь «талбай»-гаар CALCULATION) → загвар норм, эшлэл ЗОХИОСОН.
 *    Бүх дүрмийг ФОЛДОЛСОН асуулт дээр (кирилл ба латин НЭГ хэлбэрээр) шалгана.
 */
/** Барилгын оролцогч — эрх/үүрэг/хариуцлагатай хамт л норм («төслийн захиалагч хэн бэ» ERP). */
const ROLE_F = /(?:^| )(?:zahialagch|guicetgegch|zohiogch|damal|daml|bariulagch|bariulgch)/;
const ROLE_DUTY_F = /(?:^| )(?:ureg|urg|erh(?:tei|ig|in|ud)?(?: |$)|hariuclag|hariucah)/;
/** Гадаадын тал + байгууллага + зураг төсөл/барилга — БНбД 11-03-02. */
const FOREIGN_F = /(?:^| )(?:gadad|gadn|solongos|hiatad|iapon|turk|amerik|german|frans|itali|kazah|foreign)/;
const ORG_F = /(?:^| )(?:kompan|baigulag|firm|company)/;
const DESIGN_BUILD_F = /(?:^| )(?:zurag|zurg|tosol|tosl|tusul|tusl|barilg|design)/;
/** Барилга, өрөө, орон зай + ШААРДЛАГЫН модаль — ERP-ийн үггүй үед норм. */
// ⚠️ «өрөө» (→ «oro»: «орох», «оролт»), «анги» («ангилал»), ганц «шат» («шатах», «шатлал») угтвараар ОРОХГҮЙ.
const SPACE_F = /(?:^| )(?:cecerleg|surgul|barilg|baishin|oron suc|toglom|shat(?:ni|and|in)?(?: |$)|garc|hongil|lift|zogsol|emneleg|aguulah)/;
const MODAL_F = /(?:^| )(?:iostoi|estoi|zaval|shardlagatai|zovshorogd|horigl)/;
/** Хэмжигдэхүүний хэмжээ + «…ёстой» — «хэдэн цаг тусах ёстой», «хэдэн м2 байх ёстой». */
const QTY_MODAL_F = /(?:^| )hed(?:en)? (?:lk|luks|mm|sm|m|m2|m3|kpa|kv|kvt|db|grad|gradus|huvi|honog|cag|sar|jil|davhar|hun)(?: [a-z0-9]+){0,4} (?:iostoi|estoi)(?: |$)/;
/** ERP-ийн тодорхой дохио — эдгээр байвал «ёстой» нь төслийн хугацаа/ажил (норм биш). */
const ERP_SPECIFIC_F = /(?:^| )(?:iavc|hugaca|dedlain|deadline|hezee|dusah|ajiltn|ajiltan|tailan|dalgavr|tosl|tusl|tosol|tusul)/;
/** Явц/хугацааны дохио — «Солонгос компанитай хийсэн төслийн явц» ERP хэвээр. */
const ERP_PROGRESS_F = /(?:^| )(?:iavc|hugaca|dedlain|deadline|hezee|dusah|tailan|hocor)/;
/**
 * Concept/design reasoning is not automatically a legal requirement merely because the
 * employee says «… яагаад эрт шийдэх ёстой вэ?».  Keep this deliberately narrow:
 * core/concept + why/how + design-decision verbs, with no explicit norm/code/quantity.
 */
function isAecAdvisoryStructure(question: string, folded?: string): boolean {
  const raw = String(question ?? '').toLowerCase();
  const normalized = normalizeLatinMongolian(raw).toLowerCase();
  const q = `${raw} ${normalized} ${folded ?? ''}`;

  // Narrowly identify design-decision advice.  Do not depend on transliteration
  // details from foldText: employees mix Cyrillic, Latin and English terms.
  const subject = /(?:^|[^\p{L}])(?:core|concept|концепц|цөм)(?:[^\p{L}]|$)/iu.test(q);
  const ask = /(?:яагаад|яаж|хэрхэн|ямар\s+асууд|юуг\s+хамт|yagaad|yaj|yaaj|herhen|yamar\s+asuud)/iu.test(q);
  const decision = /(?:шийд\p{L}*|төлөвл\p{L}*|байрлуул\p{L}*|сонго\p{L}*|бод\p{L}*|shiid\p{L}*|shii?deh|tuluvl\p{L}*|bairluul\p{L}*|song\p{L}*|bod\p{L}*)/iu.test(q);
  if (!subject || !ask || !decision) return false;

  // Explicit legal/numeric language always wins over the advisory guard.
  return !/(?:бнбд|бд|mns|мнс|норм|стандарт|заалт|\b\d{2}-\d{2,3}-\d{2}\b|\d+\s*(?:мм|см|м|м²|m2|kpa|кпа)|хэдэн\s+(?:мм|см|м|давхар|гарц|шат))/iu.test(q);
}

/**
 * A material or site-work noun alone is not a request for a clause. Employees
 * often ask for a diagnosis or a safe next step in Latin Mongolian. Routing
 * those questions to NORMATIVE makes a missing citation turn useful advice
 * into a refusal; the model still must not invent a code or numeric limit.
 */
function isQualitativeAecAdvice(question: string): boolean {
  const raw = String(question ?? '').toLowerCase();
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
  const f = ` ${foldText(question ?? '')} `;
  // «Энэ хана ямар байна/ямар асуудал байна?» refers to a live model element.
  // Let the Revit route read actual context instead of answering generically.
  const liveElementState = /(?:энэ|ene|this)\s+(?:хана|wall|duct|дам\s*нуруу|beam|багана|column)[^?\n]{0,50}(?:ямар\s+байна|ямар\s+асууд|what(?:'s|\s+is)|issue|problem)/iu.test(q);
  if (liveElementState) return false;
  // Explicit requirements, quantities and company-record questions keep their
  // normal evidence route. A general "what should we check?" is different.
  if (/(?:бнбд|mns|мнс|норм|norm|стандарт|standard|заалт|zaalt|дүрм|durem|ёстой|yostoi|iostoi|шаардлага|shaardlaga|хэдэн|heden|хэд вэ|hed ve|\b\d+\s*(?:мм|см|м²|mm|cm|m2)\b)/iu.test(q)) return false;
  if (/(?:манай|manai)\s+(?:төсөл|төсл|tosol|tusul|баг|bag|компани|kompani|ажилтан|ajiltan)/iu.test(q)) return false;
  const domain = /(?:барилг|barilg|бетон|beton|арматур|armatur|суур|suur|даац|daats|хана|hana|шатн|shatn|талбай|talbai|зураг|zurag|plan|план|өрөө|oroo|хөдөлгөөн|hudulguun|урсгал|ursgal|явах\s+зам|yavah\s+zam|архитект|architect|инженер|engineer|бүтээц|structure|багана|bagana|column|дам\s*нуруу|dam\s*nuruu|beam|хавтан|havtan|slab|core|цөм|duct|hvac|sprinkler|насос|pump|фасад|fasad|facade|lobby|лифт|lift|агааржуул|agaarjuul|сувг|suvg|далд ажил|dald ajil|газар дээр ажил|gazar deer ajil)/iu.test(q);
  if (!domain) return false;
  const openAdvice = /(?:яагаад|yagaad|юунаас|yuunaas|шалтгаан|shaltgaan|яаж|yaj|яах|yah|yahiin|яавал|yaval|ямар\s+дарааллаар|yamar\s+darallaar|ямар\s+асууд|yamar\s+asuud|ямар эрсдэл|yamar ersdel|юу анхаар|yu\d*\s+anhaar|юу бэлдэ|yu belde|юу гэж бод|yu gej bod|юуг хэл|yuug hel|альийг нь дага|aliig ni dag|аль\s+систем|ali\s+sistem|баримтжуул|barimtuul|юуг шалга|yuug shalga|юу\s+шалгах|yu\s+shalgah|алдаа|aldaa|буруу|buruu|шууд[^?\n]{0,50}(?:зөв|болох)|coordination|clash)/iu.test(q);
  const structuralYesNo = /(?:бетон|beton|арматур|armatur|суур|suur|даац|daats)/iu.test(q) &&
    /(?:болох уу|boloh uu|зүгээр үү|zugeer uu)/iu.test(q);
  return openAdvice || structuralYesNo;
}

/** «Standard бланк» / «стандарт маягт» = office template, not construction standard. */
function isOfficeStandardTemplate(question: string): boolean {
  const raw = String(question ?? '').toLowerCase();
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
  return /(?:^|[^\p{L}])(?:standard|стандарт)(?:ын)?\s+(?:бланк|маягт|form|template)(?:[^\p{L}]|$)/iu.test(q);
}

function isAecCoordinationAdvice(question: string): boolean {
  const raw = String(question ?? '').toLowerCase();
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
  if (hitNotation(raw) || /(?:бнбд|бд\s+\d|mns\s*\d|заалт\s*\d|clause\s*\d)/iu.test(q)) return false;
  const collision = /(?:clash|мөргөлд|давхц|зөрчилд|intersect|collision)/iu.test(q);
  const components = /(?:sprinkler|duct|pipe|хоолой|дам\s*нуруу|beam|багана|column|хана|wall|tray|shaft|ceiling)/iu.test(q);
  const decision = /(?:аль|ali|яаж|yaj|priority|түрүүлж|turuund|зам\s+тав|zamaa?\s+tav|шийд|shiid)/iu.test(q);
  return collision && components && decision;
}

function isComplianceProcessAdvice(question: string): boolean {
  const raw = String(question ?? '').toLowerCase();
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
  // Keep exact clauses/codes/quantities on the authoritative norm path.
  if (hitNotation(raw) || /(?:бнбд|бд\s+\d|mns\s*\d|заалт\s*\d|clause\s*\d|\d+\s*(?:мм|см|м²|m2|kpa|кпа))/iu.test(q)) return false;
  const compliance = /(?:норм|стандарт|шаардлаг|compliance|code\s+compliance)/iu.test(q);
  const uncertain = /(?:мэдэгдэхгүй|мэдэхгүй|тодорхойгүй|эргэлз|баталгаажаагүй|uncertain|not\s+sure|unknown)/iu.test(q);
  const process = /(?:батлуул|approve|approval|deadline|хугацаа|гарын\s+үсэг|sign\s*off)/iu.test(q);
  const advice = /(?:яах|yaj|yah|юу\s+гэж\s+хэл|зөв\s+үү|болох\s+уу|what\s+should)/iu.test(q);
  return compliance && uncertain && process && advice;
}

/**
 * True when a GENERAL_HELP turn is AEC reasoning/advice rather than a request
 * for live company records. Research planning uses this to prevent ERP catalog
 * contamination while keeping generic company catalog discovery available.
 */
export function isGeneralAecAdvice(question: string): boolean {
  const raw = String(question ?? '').toLowerCase();
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
  const folded = foldText(question ?? '');
  if (isAecCoordinationAdvice(question) || isComplianceProcessAdvice(question)) return true;
  if (isAecAdvisoryStructure(question, folded) || isQualitativeAecAdvice(question)) return true;
  const designDefinition = /(?:зураг\s*төсл|зураг\s*төсөл|zurag\s*(?:tosol|tusul)|design)[^?\n]{0,80}(?:юуг\s+хэл|гэж\s+юу|сайн|алдаа|алдаан|problem|quality)/iu.test(q);
  const precedentAdvice = /(?:инженер|engineer)[^?\n]{0,100}(?:өмнөх\s+төсөл|previous\s+project|umnuh\s+(?:tosol|tusul))[^?\n]{0,120}(?:болох\s+уу|адил|same|reuse|ашиглаж)/iu.test(q);

  // Serving-policy gate: once classification says GENERAL_HELP, these AEC
  // question shapes must remain model/reasoning-only and must not discover
  // company catalog entities merely because words overlap with ERP metadata.
  const aecDomain = /(?:архитектор|architect|барилг|barilg|багана|bagana|column|дам\s*нуруу|dam\s*nuruu|beam|хавтан|havtan|slab|core|цөм|lobby|фасад|fasad|facade|duct|hvac|sprinkler|насос|pump|суур|suur|шат|stair|хана|wall|өрөө|oroo|plan|план)/iu.test(q);
  const adviceCue = /(?:юу\s+асуух|yu\s+asuuh|юу\d*\s+дээр|yu\d*\s+deer|анхаар|anhaar|хэдээр\s+авах|hed(?:eer)?\s+avah|хангалттай|hangalttai|болох\s+уу|boloh\s+uu|boloh\s+ym|яах|yahiin|яаж|yaj|ямар\s+асууд|problem|issue|what\s+should|how\s+should)/iu.test(q);
  return designDefinition || precedentAdvice || (aecDomain && adviceCue);
}

export function hitNormativeStructure(question: string): boolean {
  const f = ` ${foldText(question ?? '')} `;
  if (f.trim().length === 0) return false;
  // Applicability of high-rise requirements is itself a normative scope question.
  if (/(?:өндөр\s+барилг|undur\s+barilg|high[- ]?rise)[^?\n]{0,40}(?:шаардлаг|requirement)[^?\n]{0,50}(?:үйлчил|хамаар|apply|automatic)/iu.test(question)) return true;
  if (isAecAdvisoryStructure(question, f)) return false;
  // A door/egress width obligation remains normative even without the word "norm".
  if (/(?:^| )(?:halga|haalga|garc|shat|koridor|hongil)(?: |[a-z]*)/.test(f) &&
      /(?:^| )(?:heden|hedn|hed) (?:[a-z]+ ){0,4}(?:metr|meter|mm|m|urgun|hemje|undur)/.test(f) &&
      /(?:^| )(?:iostoi|estoi|shaardlagatai)(?: |$)/.test(f)) return true;
  if (ROLE_F.test(f) && ROLE_DUTY_F.test(f)) return true;
  if (FOREIGN_F.test(f) && ORG_F.test(f) && DESIGN_BUILD_F.test(f) && !ERP_PROGRESS_F.test(f)) return true;
  if (QTY_MODAL_F.test(f) && !ERP_SPECIFIC_F.test(f)) return true;
  if (SPACE_F.test(f) && MODAL_F.test(f) && !ERP_SPECIFIC_F.test(f)) return true;
  return false;
}

/**
 * ИНЖЕНЕРИЙН ОРОЛТЫН ТЭМДЭГЛЭГЭЭ — ганцаараа норм гэж хэлэхэд ХАНГАЛТГҮЙ,
 * харин ӨМНӨХ ЭЭЛЖИД НОРМЫН ТӨЛӨВ (`ConvState.norm`) тогтсон бол энэ мессеж
 * нь тэр тооцооны ҮРГЭЛЖЛЭЛ («Q=50000 МДж, H=6 м», «ΔP=5 кПа бол?»).
 *
 * ⚠️ `classifyIntent` (цэвэр, төлөвгүй) ҮҮНИЙГ ХЭРЭГЛЭХГҮЙ — «5000 м³» гэсэн
 *    ганц мөр норм биш байж болно.  Төлөвтэй шийдвэр `turn.ts`-д (P0-13).
 */
const ENGINEERING_INPUT_NOTATION: readonly RegExp[] = [
  // Q=50000, H=6, S=120, g=1800 — томьёоны тэмдэгт = тоо
  /(?:^|[\s,;(])[qhsg]\s*=\s*[\d][\d\s.,]*/iu,
  // ΔP / delta P / илүүдэл даралт — кПа
  /(?:δ|delta|дельта)\s*p/iu,
  /\d\s*(?:кпа|kpa)(?!\p{L})/iu,
  // Эзлэхүүн м³, галын ачаалал МДж (м²-гүй), авалцан асах хэм °C
  /\d\s*(?:м3|м³|m3)(?!\p{L})/iu,
  /\d\s*(?:мдж|mj)(?!\s*\/)(?!\p{L})/iu,
  /\d\s*°\s*c(?!\p{L})/iu,
  /\d\s*(?:градус|grad)/iu,
];

export function hasEngineeringInputNotation(text: string): boolean {
  const raw = (text ?? '').toLowerCase();
  return ENGINEERING_INPUT_NOTATION.some((re) => re.test(raw));
}

/**
 * Асуулт НОРМ/СТАНДАРТЫН тухай эсэх — ЦОРЫН ГАНЦ тодорхойлолт.
 *
 * ⚠️ `context.ts`-ийн `looksRegulatory` ЭНД дамжуулна.  Өмнө нь хоёр файл
 *    ХОЁР ӨӨР түлхүүр үгийн жагсаалттай байсан («мнс», «egress» нэгэнд,
 *    «ангилал», «даац» нөгөөд) бөгөөд `looksRegulatory` латин галигийг
 *    хэвийжүүлдэггүй байв — «guurnii tulguuriin betonii mark» нь санаагаар
 *    норм, гэрээгээр норм БИШ гэсэн хос зөрүү гарч байсан (SFT угсрагч
 *    барьсан).  Түлхүүр үг + тэмдэглэгээ + латин хэвийжүүлэлт нэг дор.
 */
export function isNormativeQuestion(question: string): boolean {
  // ⚠️ САНГИЙН ЖАГСААЛТ / БАРИМТЫН ТОЙМ («чамд ямар норм байгаа вэ», «УББ 12-01-01 юуны тухай вэ»)
  //    нь норм ОРСОН ч заалтын асуулт БИШ — `normCatalog.ts`.  Энд `true` буцаавал
  //    `turnPlan.looksRegulatory` хатуу горим асааж, нотолгоогүй татгалзал бичнэ (хэмжсэн 2026-09-18).
  if (detectNormCatalogAsk(question) !== null) return false;
  // «Барилгын норм дүрэм гэж юу вэ» — ойлголтын асуулт, заалтын хайлт биш (`smallTalk.ts`).
  if (detectSmallTalk(question) === 'norm_concept') return false;
  const raw = (question ?? '').toLowerCase();
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
  const latin = isLatinMongolian(question);
  const folded = latin ? foldText(question) : '';
  const aecAdvisory = isAecAdvisoryStructure(question, folded);
  const officeTemplate = isOfficeStandardTemplate(question);
  // Explicit notation/code beats the conversational guards.
  if (hitNotation(raw)) return true;
  // NORM-INTEL v3: зохицуулагдсан инженерийн СЭДЭВ + шаардлагын хэлбэр (`norm/questionKind.ts`).
  if (!aecAdvisory && !officeTemplate && !isAecCoordinationAdvice(question) && !isComplianceProcessAdvice(question) && isRegulatedTopicRequest(question)) return true;
  if (isQualitativeAecAdvice(question)) return false;
  if (!aecAdvisory && !officeTemplate && hit(q, NORMATIVE_HINTS)) return true;
  if (hitNormativeStructure(question)) return true;
  return !aecAdvisory && !officeTemplate && latin && foldedHit(folded, NORMATIVE_F);
}

/* ================================================================== */

export interface IntentResult {
  intent: AiIntent;
  policy: EvidencePolicy;
  /** Оношилгоонд — яагаад ийм ангилал гарсан. */
  reason: string;
}

export const POLICIES: Record<AiIntent, EvidencePolicy> = {
  // ⚠️ Нотолгоо ОГТ хэрэггүй — шошго ч харуулахгүй.
  CASUAL: {
    needsRetrieval: false,
    evidenceMandatory: false,
    needsErpTools: false,
    needsRevit: false,
    showConfidenceBadge: false,
  },
  META: {
    needsRetrieval: false,
    evidenceMandatory: false,
    needsErpTools: false,
    needsRevit: false,
    showConfidenceBadge: false,
  },
  // ⚠️ Ерөнхий тусламж: хайлт ХИЙНЭ (хэрэг болвол), ГЭХДЭЭ шаардахгүй.
  //    §4: «GENERAL_HELP also usually does not require database evidence».
  GENERAL_HELP: {
    needsRetrieval: true,
    evidenceMandatory: false,
    needsErpTools: false,
    needsRevit: false,
    showConfidenceBadge: false,
  },
  COMPANY_FACT: {
    needsRetrieval: true,
    evidenceMandatory: false,
    needsErpTools: true,
    needsRevit: false,
    showConfidenceBadge: true,
  },
  ERP_ANALYSIS: {
    needsRetrieval: true,
    evidenceMandatory: false,
    needsErpTools: true,
    needsRevit: false,
    showConfidenceBadge: true,
  },
  REVIT_READ: {
    needsRetrieval: false,
    evidenceMandatory: false,
    needsErpTools: false,
    needsRevit: true,
    showConfidenceBadge: true,
  },
  REVIT_ACTION: {
    needsRetrieval: false,
    evidenceMandatory: false,
    needsErpTools: false,
    needsRevit: true,
    showConfidenceBadge: true,
  },
  // ⚠️ ЦОРЫН ГАНЦ ЗААВАЛ НОТОЛГООТОЙ АНГИЛАЛ (§15).
  NORMATIVE: {
    needsRetrieval: true,
    evidenceMandatory: true,
    needsErpTools: false,
    needsRevit: false,
    showConfidenceBadge: true,
  },
  DOCUMENT_ANALYSIS: {
    needsRetrieval: true,
    evidenceMandatory: false,
    needsErpTools: false,
    needsRevit: false,
    showConfidenceBadge: true,
  },
  CALCULATION: {
    needsRetrieval: false,
    evidenceMandatory: false,
    needsErpTools: false,
    needsRevit: false,
    showConfidenceBadge: true,
  },
};

/**
 * ⚠️ ГОЛ ФУНКЦ.  Асуултын САНААГ ангилна.
 *
 * ДАРААЛАЛ ЧУХАЛ.  Норм нь хамгийн ХАТУУ шаардлагатай тул ЭХЭНД
 * шалгагдана: «эвакуацын гарц» гэсэн асуулт нь «төсөл» гэсэн үг ч
 * агуулж байвал НОРМ хэвээр байх ёстой.
 *
 * ⚠️ META нь нормын ДАРАА — «чи ямар норм мэдэх вэ?» гэдэг нь мета,
 *    харин «хэдэн гарц хэрэгтэй вэ?» нь норм.
 */
/** R4.2: ИЛ мутацийн үйл үг байгаа эсэх — сонголттой ээлжид `interpretTurn` REVIT_ACTION болгоход (Revit үг байхгүй ч). */
export function hasRevitWriteHint(question: string): boolean {
  const raw = (question ?? '').toLowerCase();
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
  // «duct-ийг зөөхөд юуг шалгах вэ?» = coordination/advice, NOT permission to mutate Revit.
  // Only suppress clearly hypothetical/analysis grammar; imperatives «зөө», «солино уу» remain actions.
  if (/(?:зөөхөд|зөөвөл|солиход|соливол|өөрчлөхөд|өөрчилбөл|болгоход|move(?:d|ing)?\s+.*(?:what|check)|after\s+(?:moving|changing))/iu.test(q)) return false;
  // Policy/what-if wording may quote an imperative without asking us to execute it.
  if (/(?:гэж\s+(?:би\s+)?хэлбэл|gej\s+(?:bi\s+)?helbel|шууд[^?\n]{0,60}өөрчлөх\s*үү|эхлээд\s+юу\s+шалгах|if\s+i\s+(?:say|tell)[^?\n]{0,80}(?:move|change))/iu.test(q)) return false;
  return hit(q, REVIT_WRITE_HINTS);
}

function isCompanyDataQuestion(question: string): boolean {
  const raw = String(question ?? '').toLowerCase();
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;

  // High-confidence live-company phrasings. Keep these explicit so Latin
  // employee speech does not depend on transliteration dictionary coverage.
  if (/(?:манай|manai)[^?\n]{0,60}(?:төсөл|төсл|project|tosol|tusul|tosl|tusl)[^?\n]{0,100}(?:хэзээ|hezee|дуус|duus|deadline|хугацаа|hugatsaa|явц|yavts|progress|хоцор|hotsor|удаад|udaad)/iu.test(q)) return true;
  if (/(?:project|tosol|tusul|tosl|tusl)[^?\n]{0,80}(?:yagaad|why)[^?\n]{0,80}(?:udaad|udaj|hotsor|slow|delay)/iu.test(q)) return true;
  if (/(?:how\s+many)\s+(?:active\s+)?projects?/iu.test(q)) return true;
  if (/(?:heden|hedn)\s+(?:tosol|tusul|tosl|tusl)(?:\s|$)/iu.test(q)) return true;
  if (/(?:энэ|ene|this)[^?\n]{0,20}(?:төсөл|төсл|project|tosol|tusul|tosl|tusl)[^?\n]{0,60}(?:захиалагч|zahialagch|client|owner|хариуцагч|hariutsagch|manager)(?!\p{L})/iu.test(q)) return true;

  // Stable live-company request families. These intentionally require an ERP
  // operation/fact word so generic AEC uses of «зураг төсөл» stay qualitative.
  if (/(?:төсөл|төсл|project|tosol|tusul|tosl|tusl)[^?\n]{0,80}(?:нэрс|жагсаа|list|явц|yavts|yvts|progress|идэвхтэй|active|хэд|hed)/iu.test(q)) return true;
  if (/(?:нэрс|жагсаа|list|явц|yavts|yvts|progress|идэвхтэй|active|хэд|hed)[^?\n]{0,80}(?:төсөл|төсл|project|tosol|tusul|tosl|tusl)/iu.test(q)) return true;
  if (/(?:даалгавар|даалгавр|таск|task)/iu.test(q)) return true;
  if (/(?:дуусах\s+хугацаа|due\s+date|finish\s+date|deadline)/iu.test(q)) return true;
  if (/(?:хэн\s+хэн\s+ажиллаж|хэн\s+ажиллаж|who\s+(?:is|are)\s+working|team\s+members?)/iu.test(q)) return true;
  if (/(?:манай\s+компани|our\s+company|company)[^?\n]{0,100}\d+[^?\n]{0,80}(?:төсөл|project)|(?:манай\s+компани|our\s+company|company)[^?\n]{0,80}(?:төсөл|project)[^?\n]{0,80}\d+/iu.test(q)) return true;
  if (/(?:compare|харьцуул|haritsuul)[^?\n]{0,100}(?:project|төсөл|төсл|tosol|tusul|tosl|tusl)/iu.test(q)) return true;

  // "зураг төсөл" is the design discipline/document, not an ERP project.
  const designProject = /(?:зураг\s*төсл|зураг\s*төсөл|zurag\s*(?:tosol|tusul)|design\s+(?:project|brief))/iu.test(q);
  const systemInventory = /(?:манай|manai|company|компани)[^?\n]{0,30}(?:систем|system)[^?\n]{0,30}(?:хуудас|page|боломж|feature|юу\s+бай)/iu.test(q);
  if (systemInventory) return true;

  const people = /(?:ажилтан|ажилтн|ajiltan|ajiltn|employee|staff|headcount|хэдэн\s+хүн|heden\s+hun|hedn\s+hun|хэний\s+ачаалал|henii\s+achaalal|хэн\s+юу\s+хийж|hen\s+yu\s+hiij|багийн\s+ачаалал|bag(?:iin)?\s+achaalal|team\s+workload)/iu.test(q);
  if (people) return true;

  const task = /(?:даалгавар|даалгавр|таск|task|миний\s+ажил|my\s+assignment)/iu.test(q);
  const operational = /(?:deadline|дедлайн|хугацаа|hugatsaa|хэзээ|hezee|дуус\p{L}*|duus\p{L}*|due\s+date|finish\s+date|хоцор|hotsor|overdue|явц|yavts|yvts|progress|status|идэвхтэй|idevhtei|active|удаад|удаж|udaad|udaj|slow|behind\s+schedule|ажлын\s+ачаалал|ajliin\s+achaalal|workload)/iu.test(q);
  const project = /(?:төсөл|төсл|project|tosol|tusul|tosl|tusl|MGL-\d{4,})/iu.test(q);
  const projectCount = /(?:(?:хэдэн|heden|hedn)\s+(?:төсөл|төсл|project|tosol|tusul|tosl|tusl)|how\s+many\s+(?:active\s+)?projects?)/iu.test(q);

  if (task && !designProject) return true;
  if (projectCount) return true;
  if (project && operational && !designProject) return true;

  // "манай компани/төсөл" alone is insufficient: employees routinely say
  // "манай зураг төсөл..." while asking general AEC advice.
  return false;
}

export function classifyIntent(question: string): IntentResult {
  const raw = (question ?? '').toLowerCase();
  // Латин монголыг кирилл болгож ангилна — «tusul» → «төсөл».
  const q = `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;

  const mk = (intent: AiIntent, reason: string): IntentResult => ({
    intent,
    policy: POLICIES[intent],
    reason,
  });

  // 0. МЭДЛЭГИЙН САНГИЙН КАТАЛОГ — «чамд ямар норм байгаа вэ», «БНбД X юуны тухай вэ».
  //    «норм» үгтэй ч ЗААЛТЫН асуулт биш: хариу нь `ai_documents`-ийн жагсаалт/бүтэц
  //    (`normCatalog.ts`).  META = нотолгоо шаардахгүй; жагсаалт нь синтетик хэрэгслээр
  //    орж `groundingGuard` grounded болгоно.  Сэдвийн үгтэй асуулт («сургуулийн барилгад
  //    ямар норм байна») ЭНД ОРОХГҮЙ — тэр нь доорх норм/чиглүүлэгчийн зам.
  const catalogAsk = detectNormCatalogAsk(question);
  if (catalogAsk !== null) return mk('META', catalogAsk.kind === 'inventory' ? 'нормын сангийн жагсаалт' : 'нэг баримтын бүтцийн тойм');
  // 0b. ХӨНГӨН ЯРИА / «ойлгож байна уу» / «норм дүрэм гэж юу вэ» — детерминист хариулттай (`smallTalk.ts`).
  //     «amidral her baina daa» GENERAL_HELP болж, «norm durem gej yu ve» NORMATIVE болж загвар/заалт руу
  //     явж байв (эзний тест 2026-09-18).  Мэндчилгээ = CASUAL, бусад нь META (нотолгоо, хэрэгсэл хэрэггүй).
  const small = detectSmallTalk(question);
  if (small === 'greeting' || small === 'how_are_you' || small === 'thanks' || small === 'bye') return mk('CASUAL', `хөнгөн яриа (${small})`);
  if (small !== null) return mk('META', `мета/ойлголт (${small})`);

  const companyData = isCompanyDataQuestion(question);
  // Strong live-company facts/analysis win over ambiguous generic wording, but
  // explicit norm/code language remains authoritative and is handled below.
  const explicitNormLanguage =
    hitNotation(raw) ||
    hit(q, NORMATIVE_HINTS) ||
    hitNormativeStructure(question) ||
    isRegulatedTopicRequest(question) ||
    /(?:бнбд|\bбд\s*\d|mns|мнс|норм|norm|стандарт|standard|заалт|clause)/iu.test(q);
  if (companyData && !explicitNormLanguage) {
    const analytical = /яагаад|yagaad|учир|шалтгаан|shaltgaan|харьцуул|haritsuul|дүгнэ|why|compare|analy|удаад|удаж|udaad|udaj|slow|behind/.test(q);
    return analytical
      ? mk('ERP_ANALYSIS', 'компанийн өгөгдлийн шинжилгээ')
      : mk('COMPANY_FACT', 'компанийн баримт');
  }

  // Латин монгол асуултад кирилл түлхүүр үгсийг ФОЛДООР тулгана (`foldedHit`, дээрх тайлбар).
  const latin = isLatinMongolian(question);
  const qf = latin ? foldText(question) : '';
  const has = (list: readonly string[], folded: readonly FoldedNeedle[]): boolean => hit(q, list) || (latin && foldedHit(qf, folded));

  // 1. НОРМ — хамгийн хатуу, эхэнд.  Тэмдэглэгээ/код нь design-advice guard-аас ДЭЭГҮҮР.
  // «core-оо яагаад эрт шийдэх ёстой вэ?» зэрэг concept reasoning нь ердийн инженерийн
  // зөвлөгөө; «ёстой» гэдэг ганц модаль үгээр норматив болгож болохгүй.
  const aecAdvisory = isAecAdvisoryStructure(question, qf);
  // Office/document wording: «Standard бланк», «стандарт маягт» refers to a
  // template/file, not a construction standard. Explicit norm codes still win.
  const officeTemplate = isOfficeStandardTemplate(question);
  if (hitNotation(raw)) return mk('NORMATIVE', 'нормын тэмдэглэгээ (нэгж, ангилал, заалт)');
  if (isAecCoordinationAdvice(question)) return mk('GENERAL_HELP', 'AEC clash/priority coordination зөвлөгөө');
  if (isComplianceProcessAdvice(question)) return mk('GENERAL_HELP', 'compliance тодорхойгүй үеийн инженерийн process зөвлөгөө');
  if (aecAdvisory) return mk('GENERAL_HELP', 'AEC concept/design reasoning зөвлөгөө');
  // NORM-INTEL v3: «Dead-end corridor-д ямар хязгаарлалт байдаг вэ?», «Firefighter lift-д ямар шаардлага тавигддаг вэ?»
  //   — зохицуулагдсан сэдэв + шаардлагын хэлбэр.  Өмнө нь GENERAL_HELP болж хайлтгүй, нотолгоогүй загварт очиж
  //   «10 м», «100 кг/м²» зохиодог байв (хэмжсэн 2026-10-04).  Qualitative-advice guard-аас ӨМНӨ.
  if (!officeTemplate && isRegulatedTopicRequest(question)) return mk('NORMATIVE', 'зохицуулагдсан инженерийн сэдэв + шаардлагын асуулт');
  if (isQualitativeAecAdvice(question)) return mk('GENERAL_HELP', 'ерөнхий инженерийн оношилгоо/зөвлөгөө');
  if (!aecAdvisory && !officeTemplate && hit(q, NORMATIVE_HINTS)) return mk('NORMATIVE', 'норм/стандартын түлхүүр үг');
  if (hitNormativeStructure(question)) return mk('NORMATIVE', 'нормын асуулт (оролцогч+үүрэг / гадаад байгууллага / шаардлагын модаль)');
  if (!aecAdvisory && !officeTemplate && latin && foldedHit(qf, NORMATIVE_F)) return mk('NORMATIVE', 'норм/стандартын түлхүүр үг (латин, фолд)');

  // 2. Revit — бичих үйлдэл нь уншихаас тусдаа.
  if (has(REVIT_HINTS, REVIT_F)) {
    const write = hasRevitWriteHint(question);
    // Revit нэр дурдсан ч «зөөхөд юуг шалгах вэ?» шиг ерөнхий coordination
    // асуулт нь active document шаардахгүй; ердийн инженерийн зөвлөгөө.
    const hypotheticalAdvice =
      !write &&
      /(?:зөөхөд|зөөвөл|солиход|соливол|өөрчлөхөд|өөрчилбөл|юуг шалгах|ямар.*шалгах|эхлээд\s+юу\s+шалгах|шууд[^?\n]{0,60}өөрчлөх\s*үү|what.*check|after\s+(?:moving|changing)|if\s+i\s+(?:say|tell)[^?\n]{0,80}(?:move|change))/iu.test(q);
    if (hypotheticalAdvice) return mk('GENERAL_HELP', 'Revit-ийн ерөнхий coordination/what-if зөвлөгөө');
    return write
      ? mk('REVIT_ACTION', 'Revit + өөрчлөх үйлдэл')
      : mk('REVIT_READ', 'Revit контекстын асуулт');
  }

  // 3. Мета — AI өөрийнхөө тухай.
  if (has(META_HINTS, META_F)) return mk('META', 'AI-ийн чадварын тухай асуулт');

  // 4. Мэндчилгээ — ЗӨВХӨН ЦЭВЭР мэндчилгээ.  «Сайн уу. Хэдэн төсөл
  //    байна?» нь мэндчилгээ БИШ, асуулт: салбарын түлхүүр үг байвал
  //    мэндчилгээг алгасаж, доорх дүрэм рүү явуулна.
  const hasDomainHint = companyData || has(CALC_HINTS, CALC_F) || has(DOC_HINTS, DOC_F);
  if (has(CASUAL_HINTS, CASUAL_F) && (!hasDomainHint || wordCount(raw) <= 3)) {
    return mk('CASUAL', 'мэндчилгээ/энгийн яриа');
  }

  // 5. Баримт бичиг боловсруулах.
  if (has(DOC_HINTS, DOC_F)) return mk('DOCUMENT_ANALYSIS', 'баримт боловсруулах хүсэлт');

  // 6. Тооцоо.
  if (has(CALC_HINTS, CALC_F)) return mk('CALCULATION', 'тооцооллын хүсэлт');

  // 7. Компанийн өгөгдөл — «яагаад», «хэрхэн» бол шинжилгээ.
  if (companyData) {
    const analytical = /яагаад|yagaad|учир|шалтгаан|shaltgaan|харьцуул|haritsuul|дүгнэ|why|compare|analy|удаад|удаж|udaad|udaj|slow|behind/.test(q);
    return analytical
      ? mk('ERP_ANALYSIS', 'компанийн өгөгдлийн шинжилгээ')
      : mk('COMPANY_FACT', 'компанийн баримт');
  }

  // 8. ⚠️ ӨГӨГДМӨЛ нь GENERAL_HELP, ТАТГАЛЗАЛ БИШ (§5).
  //    «MGL AI is a normal conversational company assistant.»  Танихгүй
  //    асуултыг хориглох нь хамгийн түгээмэл гомдол байсан.
  return mk('GENERAL_HELP', 'өгөгдмөл — ердийн тусламж');
}

/**
 * Итгэлийн шошгыг харуулах эсэх.
 *
 * ⚠️ Тусдаа функц болгосон нь UI-д хялбар дамжуулахын тулд.  §4:
 *    шошго нь ЗӨВХӨН хамааралтай үед харагдана.
 */
/** Санаа → нотолгооны бодлого — `turn.ts` санааг солиход ашиглана. */
export function policyFor(intent: AiIntent): EvidencePolicy {
  return POLICIES[intent];
}

export function shouldShowConfidence(intent: AiIntent): boolean {
  return POLICIES[intent].showConfidenceBadge;
}
