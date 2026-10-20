/**
 * MGL AI · НОРМЫН АСУУЛТЫН ДЭД ТӨРӨЛ + ЗОХИЦУУЛАГДСАН СЭДВИЙН ТАНИЛТ (NORM-INTEL v3, 2026-10-04).
 *
 * ⚠️ ЯАГААД.  Түлхүүр үгийн жагсаалт («эвакуац», «гарц», «галын»…) нь инженерийн ҮНДСЭН сэдвийн
 *    нэр томьёог бүрэн барьж чаддаггүй: «Dead-end corridor-д ямар хязгаарлалт байдаг вэ?»,
 *    «Firefighter lift-д ямар шаардлагууд тавигддаг вэ?», «Handrail-ийн өндөр хэд байх ёстой вэ?»
 *    нь GENERAL_HELP болж нормын хайлтгүй, нотолгоогүй загварт очдог байв (хэмжсэн 2026-10-04,
 *    NORM-40: 40-ийн 10 нь зөв замд ороогүй) — загвар «10 м», «2.5 м», «100 кг/м²» зохиож, дараа нь
 *    «Нотолгоо хүрэлцэхгүй» гэж шошголдог байв.
 *
 * ⚠️ ЭНЭ БОЛ ҮНДСЭН ЗАРЧИМ, БЕНЧМАРК ДАХЬ АСУУЛТЫН ЖАГСААЛТ БИШ.  Дүрэм нь:
 *      зохицуулагдсан инженерийн СЭДЭВ  +  ШААРДЛАГЫН/ойлголтын/хүчин төгөлдөрийн ХЭЛБЭР
 *    хоёулаа байвал норм.  Сэдэв ганцаараа норм БИШ («core», «шат» ганцаараа архитектурын зөвлөгөө);
 *    хэлбэр ганцаараа ч норм БИШ.  ERP-ийн тодорхой дохио байвал (хугацаа, ажилтан, явц) норм биш.
 *
 * ⚠️ СЭДВИЙН НЭР ТОМЬЁО = ЧИГЛҮҮЛЭЛТИЙН ҮГСАН (routing vocabulary), ХЭЗЭЭ Ч ЗОХИЦУУЛАЛТЫН БАРИМТ БИШ.
 *    Энд ямар ч тоо, заалт, шаардлага БАЙХГҮЙ.
 *
 * ЦЭВЭР ФУНКЦ — D1-гүй, тестлэгдэнэ (`questionKind.test.ts`).
 */
import { foldText } from '../../textFold';

export const NORM_QUESTION_SUBTYPES = [
  'REQUIREMENT_LOOKUP',
  'APPLICABILITY',
  'CURRENTNESS',
  'CONFLICT_RESOLUTION',
  'DOCUMENT_DISCOVERY',
  'GENERAL_NORM_CONCEPT',
] as const;
export type NormQuestionSubtype = (typeof NORM_QUESTION_SUBTYPES)[number];

/** Хүчин төгөлдөр/зөрчлийн ЗАРЧМЫН асуулт — нэг баримтын заалтаас БИШ, MGL AI-ийн нормын засаглалаас хариулна. */
export type GovernanceKind =
  | 'newer_date_not_in_force'
  | 'draft_vs_active'
  | 'how_to_verify_status'
  | 'superseded_citation'
  | 'amendment_check'
  | 'conflict_general_vs_special'
  | 'conflict_two_valid'
  | 'conflict_generic'
  | 'approximate_number'
  | 'code_known_clause_missing'
  /** «Өмнөх төсөл дээр батлагдсан тул энэ төсөл ч нийцнэ» — прецедент нь нормын нийцлийн нотолгоо БИШ. */
  | 'precedent_approved'
  /** «Хуучин СНиП/ГОСТ дугаарыг хүчинтэй эсэхийг шалгалгүй шууд ашиглая». */
  | 'historical_code_use'
  /** «Нормд нийцсэн гэсэн баталгаа бичиж өг» — AI нийцлийн гэрчилгээ гаргахгүй. */
  | 'compliance_certificate';

export interface NormTopic {
  id: string;
  labelMn: string;
  /** Чиглүүлэлтийн үгс — кирилл / латин галиг / англи.  Хэвийжүүлсэн (fold) угтвараар таарна. */
  terms: string[];
}

/**
 * ⚠️ Зөвхөн ЗОХИЦУУЛАГДСАН (норм, стандартаар хэмжээ/шаардлага тогтоогддог) инженерийн сэдэв.
 *    «core», «хана», «багана» ганцаараа энд ОРОХГҮЙ — тэр нь архитектурын зөвлөгөө.
 */
export const NORM_TOPICS: readonly NormTopic[] = [
  { id: 'high_rise', labelMn: 'өндөр барилга', terms: ['өндөр барилга', 'өндөр барилгын', 'өндөр барилгад', 'undur barilg', 'high rise', 'high-rise', 'highrise', 'tall building', 'хэдэн давхар', 'өндөр байшин'] },
  { id: 'evacuation', labelMn: 'эвакуаци, гарц', terms: ['эвакуац', 'evakuac', 'evacuat', 'egress', 'emergency exit', 'fire exit', 'гарах зам', 'аюулгүй гарц', 'гарцын', 'гарцыг', 'гарцууд', 'эвакуацын гарц'] },
  { id: 'stairs', labelMn: 'шат, шатны хонгил', terms: ['шатны', '=шат', 'stair', 'stairwell', 'staircase', 'гишгүүр', 'gishguur', 'shatnii', 'шатны хонгил'] },
  { id: 'smoke', labelMn: 'утаа хамгаалалт', terms: ['smoke', 'утаа', 'утааны', 'utaa', 'pressuriz', 'pressurisation', 'агаар шахах', 'утаа сор', 'smoke control', 'smoke exhaust', 'smoke protection', 'утаанаас'] },
  { id: 'firefighter_lift', labelMn: 'гал түймэртэй тэмцэгчийн лифт', terms: ['firefighter', 'fire fighter', 'fireman', 'firemen', 'гал түймэртэй тэмцэгч', 'галын лифт', 'fire lift', 'гал унтраагчийн лифт', 'аврагчийн лифт'] },
  { id: 'fire_lift_use', labelMn: 'галын үеийн лифт', terms: ['галын үед лифт', 'галын үед ... лифт', 'fire elevator', 'evacuation lift', 'evacuation elevator'] },
  { id: 'refuge', labelMn: 'аюулгүй бүс, хоргодох талбай', terms: ['refuge', 'fire safe', 'fire-safe', 'аюулгүй бүс', 'хоргодох', 'аюулгүй талбай', 'area of refuge', 'safe area'] },
  { id: 'compartment', labelMn: 'галын тасалгаа', terms: ['compartment', 'галын тасалгаа', 'fire compartment', 'тасалгааны хэмжээ', 'galin tasalgaa'] },
  { id: 'fire_resistance', labelMn: 'галын эсэргүүцэл', terms: ['fire resistance', 'fire rating', 'галын эсэргүү', 'галд тэсвэр', 'fire protection rating', 'galin esergui', 'галын зэрэг', 'тэсвэрлэх зэрэг'] },
  { id: 'fire_door', labelMn: 'галын хаалга', terms: ['галын хаалга', 'fire door', 'fire-door', 'galin halga', 'галын хаалганы'] },
  { id: 'fire_rating_class', labelMn: 'EI/REI ангилал', terms: ['ei ангилал', 'ei класс', 'rei', 'ei60', 'ei30', 'ei90', 'ei120', 'ei зэрэг', 'ei ангил', 'ei '] },
  { id: 'dead_end', labelMn: 'мухар коридор', terms: ['dead end', 'dead-end', 'deadend', 'мухар коридор', 'мухар', 'гарцгүй коридор', 'нэг чиглэлтэй коридор'] },
  { id: 'corridor', labelMn: 'коридор', terms: ['коридор', 'koridor', 'corridor'] },
  { id: 'handrail', labelMn: 'хашлага, бариул', terms: ['handrail', 'hand rail', 'guardrail', 'railing', 'хашлага', 'бариул', 'hashlaga', 'хөшиг ханын хашлага'] },
  { id: 'ramp', labelMn: 'налуу зам', terms: ['ramp', 'налуу зам', 'налуу ', 'ramp-ийн', 'rampiin'] },
  { id: 'accessibility', labelMn: 'хүртээмжтэй орчин', terms: ['barrier free', 'barrier-free', 'barierfree', 'хүртээмжтэй', 'хүртээмж', 'wheelchair', 'тэргэнцэр', 'хөгжлийн бэрхшээлтэй', 'accessible', 'accessibility', 'disabled', 'disability', 'ХБИ', 'universal design'] },
  { id: 'accessible_parking', labelMn: 'ХБИ-ийн зогсоол', terms: ['parking', 'зогсоол', 'zogsol', 'car park'] },
  { id: 'room_dims', labelMn: 'өрөөний хэмжээс', terms: ['унтлагын өр', 'унтлагын', 'bedroom', 'гал тогоо', 'gal togoo', 'kitchen', 'зочны өрөө', 'living room', 'өрөөний талбай', 'өрөөний хэмжээ', 'орон сууцны өрөө', 'өрөөний доод', 'өрөөний хамгийн', 'бие засах өрөө', 'угаалгын өрөө', 'toilet', 'жорлон'] },
  { id: 'clear_width', labelMn: 'цэвэр өргөн', terms: ['clear width', 'цэвэр өргөн', 'clear opening', 'door width', 'хаалганы өргөн', 'хаалганы цэвэр'] },
  { id: 'door_swing', labelMn: 'хаалганы нээгдэх чиглэл', terms: ['онгойх', 'нээгдэх', 'door swing', 'door opens', 'хаалга аль чиглэл', 'нээгдэх чиглэл'] },
  { id: 'core_requirements', labelMn: 'core шаардлага', terms: ['core төлөвл', 'core-ийн шаардлага', 'цөмийн шаардлага', 'core planning'] },
];

/** `=` угтвартай нэр томьёо = ҮГИЙГ БҮТНЭЭР таарна («=шат» нь «шатлал», «шатах»-д таарахгүй). */
const TOPIC_FOLDED: { id: string; terms: { t: string; whole: boolean }[] }[] = NORM_TOPICS.map((t) => ({
  id: t.id,
  terms: t.terms
    .map((x) => ({ t: foldText(x.replace(/^=/, '')), whole: x.startsWith('=') || foldText(x.replace(/^=/, '')).length <= 3 }))
    .filter((x) => x.t.length >= 2),
}));

/** Фолдсон текстэд үгийн ЭХНЭЭС (угтвар) эсвэл БҮТЭН үг таарах эсэх. */
function foldedHasTerm(hay: string, term: string, whole: boolean): boolean {
  if (term.length === 0) return false;
  const h = ` ${hay} `;
  return whole ? h.includes(` ${term} `) : h.includes(` ${term}`);
}

/**
 * ⚠️ «ШАТ» ХОЁР УТГАТАЙ: шат (stair) ба ШАТ (design stage / үе шат).  «Эскизийн шат», «ажлын зургийн шат», «concept шатанд»,
 *    «хоёр үе шат» нь ТӨЛӨВЛӨЛТИЙН ШАТ — шатны норм БИШ (хэмжсэн 2026-10-04: «Эскизийн шат гэж юу вэ?» нормын асуулт болж байв).
 */
const DESIGN_STAGE = matcherPhrases(['зургийн шат', 'зурагны шат', 'эскизийн шат', 'эскиз шат', 'ажлын зургийн шат', 'зураг төслийн шат', 'төслийн шат', 'төлөвлөлтийн шат', 'концепц шат', 'concept шат', 'схемийн шат', 'үе шат', 'шатанд', 'шатаар', 'шатлал']);

function matcherPhrases(phrases: readonly string[]): RegExp {
  const parts = phrases.map((p) => foldText(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter((p) => p.length > 0);
  return new RegExp(`(?:^| )(?:${parts.join('|')})(?= |$)`, 'g');
}

export function detectNormTopics(question: string): string[] {
  const f = foldText(question ?? '').replace(DESIGN_STAGE, ' ').replace(/\s+/g, ' ').trim();
  if (f.length === 0) return [];
  const out: string[] = [];
  for (const t of TOPIC_FOLDED) {
    if (t.terms.some((term) => foldedHasTerm(f, term.t, term.whole))) out.push(t.id);
  }
  return out;
}

/* ================================================================== */
/*  Асуултын ХЭЛБЭР                                                    */
/* ================================================================== */

/**
 * ⚠️ `foldText` давхар ҮСГИЙГ хураадаг («тогтоодог» → `togtodog`) тул фолдсон regex-ийг ГАРААР бичиж
 *    БОЛОХГҮЙ — үгсийг түүхийгээр нь жагсааж, ТЭДГЭЭРИЙГ нь ижил `foldText`-ээр фолдож таарна.
 */
function matcher(terms: readonly string[]): (folded: string) => boolean {
  const f = terms.map((t) => ({ term: foldText(t), whole: foldText(t).length <= 3 })).filter((x) => x.term.length > 0);
  return (hay: string): boolean => {
    const h = ` ${hay} `;
    return f.some((x) => (x.whole ? h.includes(` ${x.term} `) : h.includes(` ${x.term}`)));
  };
}

/** Шаардлагын / хэмжээний / нөхцөлийн асуулт. */
const hasRequirementShape = matcher([
  'хэд', 'хэдэн', 'hed', 'heden', 'ямар шаардлага', 'шаардлага', 'shaardlag', 'хязгаарлалт', 'hiazgarlalt',
  'байх ёстой', 'ёстой', 'yostoi', 'iostoi', 'заавал', 'zaval', 'minimum', 'maximum', 'min', 'max', 'хамгийн бага', 'хамгийн их', 'доод', 'дээд',
  'тавигддаг', 'байдаг уу', 'байдаг вэ', 'хамаарах', 'хамаарч', 'үйлчил', 'мөн эсэх', 'ямар төрөл', 'төрлүүд', 'ангилдаг', 'ангилна',
  'тогтоо', 'сонгодог', 'сонгох', 'онгойх', 'нээгдэх', 'чиглэл', 'ямар нөхцөл', 'ямар үед', 'юунаас хамаар', 'юугаар',
  'ямар өрөө', 'ямар зориулалт', 'тусад нь', 'тавигдах', 'шаардлагатай', 'заасан', 'хүчинтэй', 'эх сурвалж', 'монголын норм', 'нормд', 'нормоор', 'хэмжүүр',
]);
const hasConceptShape = matcher(['гэж юу вэ', 'гэж юу юм', 'гэж юуг хэлдэг', 'гэж юу хэлдэг', 'гэж юуг хэлэх', 'гэдэг нь юу', 'юу гэсэн үг', 'what is', 'gej yu ve', 'gej iu ve']);
/** Хүчин төгөлдөр / хувилбарын ЗАРЧМЫН хэлбэр. */
const hasCurrentShape = matcher([
  'draft', 'ноорог', 'хүчингүй', 'хүчинтэй', 'хүчин төгөлдөр', 'мөрд', 'орлосон', 'орлох', 'солигд', 'солих', 'amendment', 'нэмэлт өөрчлөлт', 'шинэ огноо',
  'огноотой', 'currentness', 'in force', 'superseded', 'replaced', 'huuchin', 'хуучин норм', 'huchintei', 'huchingui',
]);
const hasConflictShape = matcher(['зөрвөл', 'зөрчил', 'зөрчилд', 'зөрүү', 'давуу', 'аль нь', 'алийг', 'conflict', 'contradict', 'хэрхэн шийд', 'шууд сонго', 'ямар дарааллаар']);
const hasNormish = matcher(['норм', 'бнбд', 'mns', 'мнс', 'убб', 'стандарт', 'снип', 'гост', 'snip', 'норматив', 'нийц', 'баримт', 'document', 'draft', 'amendment', 'заалт', 'clause', 'шаардлага', 'norm', 'bnbd']);
/** ERP-ийн ТОДОРХОЙ дохио — норм биш гэсэн хамгаалалт. */
const hasErpSignal = matcher(['явц', 'deadline', 'дедлайн', 'дуусах', 'хэдэн ажилтан', 'ажилтны тоо', 'ажиллаж', 'ажилладаг', 'тайлан', 'даалгавар', 'хоцор', 'idevhtei tusul', 'идэвхтэй төсөл', 'хэдэн төсөл']);
const hasExplicitNorm = matcher(['норм', 'бнбд', 'mns', 'мнс', 'убб', 'снип', 'заалт', 'clause', 'шаардлага', 'стандарт', 'norm', 'bnbd', 'standard']);
/** «Яагаад …?» = шалтгаан/үндэслэлийн асуулт — ИЛ норм үггүй бол заалтын хайлт БИШ. */
const hasWhyShape = matcher(['яагаад', 'yagaad', 'why', 'учир нь юу', 'шалтгаан']);
const isAiPolicyAsk = matcher(['mgl ai', 'mglai']);
const hasApproxShape = matcher(['ойролцоогоор', 'ойролцоо', 'approximately', 'best guess']);

export interface NormQuestionClass {
  subtype: NormQuestionSubtype;
  topics: string[];
  /** Хэрэглэгч ТОДОРХОЙ тоон утга/хэмжээ асууж байна. */
  wantsExactValue: boolean;
  /** «Эх сурвалжтай хэл», «хүчинтэй заалтаар» — эрх бүхий хариулт ИЛ шаардсан. */
  asksAuthoritative: boolean;
  governance: GovernanceKind | null;
  /** MGL AI-ийн ЗАН ТӨЛӨВИЙН асуулт («ойролцоогоор тоо хэлж болох уу», «заалт олдохгүй бол ямар хариулт өгөх вэ»). */
  aiPolicy: boolean;
}

/**
 * ⚠️ ЗОХИЦУУЛАГДСАН СЭДЭВ + ШААРДЛАГЫН ХЭЛБЭР — `intent.ts`-д норм гэж чиглүүлэх ЦОРЫН ГАНЦ нөхцөл.
 *    Хоёр тал хоёулаа байх ёстой; ERP-ийн тодорхой дохиотой, норм үггүй асуулт хасагдана.
 */
export function isRegulatedTopicRequest(question: string): boolean {
  const topics = detectNormTopics(question);
  if (topics.length === 0) return false;
  const f = foldText(question ?? '');
  if (hasErpSignal(f) && !hasExplicitNorm(f)) return false;
  // «яагаад …» үндэслэл/зохион бүтээлтийн асуулт — ИЛ норм/заалт нэрлээгүй бол инженерийн зөвлөгөө.
  if (hasWhyShape(f) && !hasExplicitNorm(f)) return false;
  return hasRequirementShape(f) || hasConceptShape(f) || hasCurrentShape(f);
}

function governanceOf(f: string, raw: string): GovernanceKind | null {
  if (!hasNormish(f)) return null;
  const cur = hasCurrentShape(f);
  const conflict = hasConflictShape(f);
  const draft = /(?:^|[^\p{L}])(?:draft|ноорог)(?![\p{L}])/iu.test(raw);
  if (hasApproxShape(f) || /(?:best guess|таамаглаад|таамгаар|яаралтай[^?]{0,30}(?:хэлчих|хэлээч|тоо))/iu.test(raw)) return 'approximate_number';
  if (/(?:өмнөх|урьд|ижил)\s+(?:төсөл|барилга|зураг)[^?]{0,70}(?:батлагд|зөвшөөр|нийц|ашигл|зурсан)/iu.test(raw) && /(?:одоо|энэ|тэгэхээр|тиймээс|биз дээ|нийц|зөв)/iu.test(raw)) return 'precedent_approved';
  if (/(?:баталгаа|гэрчилгээ|дүгнэлт|certificate)[^?]{0,40}(?:бич|гарга|өг)/iu.test(raw) && /(?:нийц|хангал|аюулгүй|шаардлага)/iu.test(raw)) return 'compliance_certificate';
  if (/(?:снип|snip|гост|gost)\s*\d/iu.test(raw) && /(?:ашигла|мөрд|хэрэглэ|зурчих|шууд)/iu.test(raw)) return 'historical_code_use';
  if (/(?:код|code)[^?]{0,80}(?:мэдэгдэж|мэдэгдэх)[^?]{0,100}(?:clause|заалт|page|хуудас)/iu.test(raw)) return 'code_known_clause_missing';
  if (/(?:clause|заалт|page|хуудас)[^?]{0,40}олдохгүй/iu.test(raw) && /(?:код|code)/iu.test(raw)) return 'code_known_clause_missing';
  if (conflict) {
    if (/(?:ерөнхий)/iu.test(raw) && /(?:тусгай|зориулалтын)/iu.test(raw)) return 'conflict_general_vs_special';
    if (/(?:хоёр\s+хүчинтэй)/iu.test(raw)) return 'conflict_two_valid';
    if (draft) return 'draft_vs_active';
    if (/(?:mns|мнс|стандарт)/iu.test(raw) && /(?:бнбд|норм)/iu.test(raw)) return 'conflict_generic';
    if (/(?:норм|баримт|шаардлага)/iu.test(raw)) return 'conflict_generic';
    return null;
  }
  if (cur) {
    if (draft) return 'draft_vs_active';
    if (/(?:amendment|нэмэлт өөрчлөлт)/iu.test(raw)) return 'amendment_check';
    if (/(?:орлосон|солигдсон|орлох)/iu.test(raw)) return 'superseded_citation';
    if (/(?:шинэ огноо|огноотой)/iu.test(raw)) return 'newer_date_not_in_force';
    if (/(?:ямар эх сурвалж|аль эх сурвалж|ямар бүртгэл|хаанаас шалг|шалгах ёстой|хүчингүй болсон эсэх)/iu.test(raw)) return 'how_to_verify_status';
    return null;
  }
  return null;
}

export function classifyNormQuestion(question: string): NormQuestionClass {
  const raw = String(question ?? '');
  const f = foldText(raw);
  const topics = detectNormTopics(raw);
  const governance = governanceOf(f, raw);
  const aiPolicy = isAiPolicyAsk(f) && (governance === 'approximate_number' || governance === 'code_known_clause_missing' || /(?:яг заалт|заалт олж|ямар хариулт өгөх|clause\/page)/iu.test(raw));
  const asksAuthoritative = /(?:эх сурвалжтай|хүчинтэй\s+(?:заалт|монгол|эх)|албан ёсны|эх сурвалжаар|заалтаар хариул)/iu.test(raw);
  const asksNumber = /(?:^|[^\p{L}])(?:хэд|хэдэн)(?![\p{L}])|minimum|maximum|(?:^|[^\p{L}])(?:min|max)(?![\p{L}])|хамгийн (?:бага|их)|доод тал|дээд тал/iu.test(raw);
  const conceptForm = hasConceptShape(f);

  let subtype: NormQuestionSubtype;
  if (governance === 'conflict_general_vs_special' || governance === 'conflict_two_valid' || governance === 'conflict_generic') subtype = 'CONFLICT_RESOLUTION';
  else if (governance === 'draft_vs_active') subtype = hasConflictShape(f) ? 'CONFLICT_RESOLUTION' : 'CURRENTNESS';
  else if (aiPolicy) subtype = 'GENERAL_NORM_CONCEPT';
  else if (governance === 'approximate_number' || governance === 'precedent_approved' || governance === 'compliance_certificate') subtype = 'APPLICABILITY';
  else if (governance === 'historical_code_use') subtype = 'CURRENTNESS';
  else if (governance !== null && governance !== 'code_known_clause_missing') subtype = 'CURRENTNESS';
  else if (aiPolicy) subtype = 'GENERAL_NORM_CONCEPT';
  else if (/(?:ямар норм|ямар дүрэм|нормууд хамаар|ямар норматив)/iu.test(raw) && !asksNumber && topics.length === 0) subtype = 'DOCUMENT_DISCOVERY';
  else if (conceptForm) subtype = 'GENERAL_NORM_CONCEPT';
  else if (/(?:ямар үед|ямар нөхцөлөөр|хэзээ|хамаарах уу|хамаарч|үйлчил|заавал хэрэгтэй|шаардлагатай юу|шаардлагатай вэ|ашиглаж болох уу|болох уу|мөн эсэх|тогтоож болох|сонгох вэ|хэрхэн сонго|сонгодог|ямар өрөө|ямар зориулалт|ямар коридор)/iu.test(raw)) subtype = 'APPLICABILITY';
  else subtype = 'REQUIREMENT_LOOKUP';

  return { subtype, topics, wantsExactValue: asksNumber && subtype !== 'GENERAL_NORM_CONCEPT', asksAuthoritative, governance, aiPolicy };
}
