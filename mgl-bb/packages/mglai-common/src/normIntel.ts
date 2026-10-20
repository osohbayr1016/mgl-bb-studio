/**
 * MGL AI · НОРМЫН УХААН (NORM-INTEL v3, 2026-10-04) — серверийн гэрээний блок + ХӨТЧИЙН хатуу шалгагч.
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА (хэмжсэн 2026-10-04).  `tfc-2` нь тоо, ангилал, баримтын код, нэг
 *    ТООЦООНЫ үр дүнг барьдаг байсан ч НОРМАТИВ МЭДЭГДЛИЙГ барьдаггүй байв:
 *      · «Dead-end corridor-д … 10 м, 2.5 м, 100 кг/м²» гэсэн зохиомол хэмжээ + зохиомол заалт, дараа нь
 *        «Нотолгоо хүрэлцэхгүй» — шошго нь худлаа мэдэгдлийг АЮУЛГҮЙ болгодоггүй;
 *      · «EI = Equivalent Impact» гэсэн техникийн товчлолын зохиомол тайлбар;
 *      · ноорог баримтыг «хүчинтэй», СОЛИГДСОН баримтыг «одоо мөрдөнө» гэж мэдэгдэх;
 *      · нотолгоогүй «шаардлага хангаж байна / аюулгүй».
 *    Энд сервер бичсэн НОРМЫН ГЭРЭЭГ (`NormIntelBlock`: нотолгооны төлөв, хэрэглэгдэх байдал, нормын
 *    мэдэгдлийн БҮРТГЭЛ (ledger), эх сурвалжийн блок, нэр томьёоны хамгаалалт) ХӨТӨЧ үүсгэлтийн ДАРАА
 *    тулгана.  Хатуу зөрчил → загварын хариултыг ХАЯЖ серверийн детерминист хариулт.
 *
 * ⚠️ ЗАГВАР БОЛ ЭХ СУРВАЛЖ БИШ.  Загвар баталгаажсан баримтыг тайлбарлаж, чанарын тайлбар өгч, дутуу оролтыг
 *    асууж БОЛНО; нормын баримт (тоо, заалт, хүснэгт, хуудас, ангилал, хүчин төгөлдөр байдал) ЗОХИОХ БОЛОХГҮЙ.
 *
 * ⚠️ ЦЭВЭР, ИМПОРТГҮЙ — Worker · ажилтны PC · хөтөч гурвуулаа ИЖИЛ файл.  Байгалийн хэлний бүх утгыг шалгах
 *    оролдлого БАЙХГҮЙ: зөвхөн тоо, нэгж, харьцуулалтын тэмдэг, баримт/заалт/хүснэгт/хуудасны ХАЯГ, төлөвийн
 *    мэдэгдэл, нэр томьёоны задлал.
 */

export const NORM_INTEL_VERSION = 'nic-1' as const;

export type NormEvidenceState =
  /** Баталгаажсан, хэрэглэгдэх нотолгоо бий — эрх бүхий хариулт. */
  | 'AUTHORITATIVE'
  /** Ойлголт/засаглалын зарчмын хариулт — нормын тоо, заалт ЗОХИОХГҮЙ. */
  | 'GENERAL_ONLY'
  /** Хайлт дууссан, баталгаажсан холбогдох шаардлага олдсонгүй. */
  | 'NO_VERIFIED_MATCH'
  /** Хайлт/runtime/сан унасан — нотолгоо байгаа эсэхийг БИД МЭДЭХГҮЙ. */
  | 'RETRIEVAL_UNAVAILABLE'
  /** Баримт олдсон боловч хүчин төгөлдөр байдал нь тодорхойгүй/хуучин/ноорог. */
  | 'CURRENTNESS_UNVERIFIED'
  /** Дүрэм олдсон боловч хэрэглэгдэх эсэхийг шийдэх оролт дутуу. */
  | 'MISSING_APPLICABILITY_INPUT'
  /** Эх сурвалж/дүрэм бий боловч эрх бүхий хариултад хангалттай баталгаажаагүй. */
  | 'HUMAN_REVIEW_REQUIRED';

export type ApplicabilityStatus = 'APPLIES' | 'DOES_NOT_APPLY' | 'MISSING_CONTEXT' | 'AMBIGUOUS_SCOPE' | 'CONFLICTING_SOURCES';

export type NormCurrentnessState =
  | 'IN_FORCE_VERIFIED'
  | 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED'
  | 'LISTED_CURRENT_NOT_SOURCE_VERIFIED'
  | 'NEEDS_HUMAN_REVIEW'
  | 'HISTORICAL'
  | 'SUPERSEDED'
  | 'DRAFT'
  | 'UNKNOWN';

/** Эрх бүхий (одоогийн шаардлага болгон ашиглаж болох) төлөвүүд. */
export const USABLE_CURRENTNESS: ReadonlySet<string> = new Set(['IN_FORCE_VERIFIED', 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED', 'LISTED_CURRENT_NOT_SOURCE_VERIFIED']);

export type ClaimOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'range';
export type ClaimType = 'numeric' | 'minimum' | 'maximum' | 'range' | 'count' | 'classification' | 'mandatory' | 'prohibited' | 'currentness' | 'rating' | 'formula_result';

export interface NormClaim {
  id: string;
  type: ClaimType;
  /** Юуны тухай — «шатны өргөн». */
  subject: string | null;
  operator: ClaimOperator | null;
  value: number | string | boolean | null;
  valueMax: number | null;
  /** ХЭВИЙЖСЭН нэгж (`normalizeClaimUnit`). */
  unit: string | null;
  /** `verified` = баталгаажсан нотолгооноос; `candidate` = задлалтаар (comparator-д л ашиглана, эрх бүхий БИШ). */
  authority: 'verified' | 'candidate';
  /** `NormIntelBlock.sources` дахь индекс. */
  sourceIndex: number | null;
  applicability: ApplicabilityStatus;
}

export interface NormSource {
  code: string | null;
  titleMn: string | null;
  clause: string | null;
  table: number | string | null;
  appendix: string | null;
  page: number | null;
  currentness: NormCurrentnessState;
  statusLabelMn: string | null;
  url: string | null;
  verification: string | null;
}

export interface NormTerminologyEntry {
  /** Товчлол — «EI». */
  abbr: string;
  /** Зөвшөөрөгдсөн тайлбарын түлхүүр үгс (ФОЛДСОН угтвар) — хоосон = ТАНИГДААГҮЙ товчлол: ямар ч задлал хориотой. */
  keys: string[];
  /** Хүн уншдаг батлагдсан тайлбар (детерминист хариултад) — эсвэл `null`. */
  definitionMn: string | null;
}

export interface NormIntelBlock {
  version: typeof NORM_INTEL_VERSION;
  subtype: string;
  topics: string[];
  evidenceState: NormEvidenceState;
  /** Ерөнхий тайлбар горим: НОРМЫН ТОО, ЗААЛТ, «заавал/доод/дээд» мэдэгдэл ХОРИОТОЙ. */
  generalOnly: boolean;
  /**
   * Хариулт баталгаатай НОТОЛГООНЫ мөр дээр суурилсан (AUTHORITATIVE, эсвэл хүчин төгөлдөр байдлыг ил тэмдэглэсэн
   * нотолгоотой хариулт) — тоо/заалт ЗӨВХӨН нотолгооноос.  `false` = нормын тоо, баттай мэдэгдэл ХОРИОТОЙ.
   */
  evidenceBacked: boolean;
  applicability: { status: ApplicabilityStatus; considered: string[]; missing: string[] };
  claims: NormClaim[];
  sources: NormSource[];
  /** СЕРВЕРИЙН эх сурвалжийн блок — хариултын төгсгөлд детерминистээр нэмэгдэнэ. */
  sourceBlock: string | null;
  /** Хэрэглэгч ӨӨРӨӨ бичсэн баримтын код/заалт/хуудас — татгалзлын өгүүлбэрт дурдаж БОЛНО (баталгаажуулсан мэт биш). */
  userQuoted: string[];
  /** Хэрэглэгч ӨӨРӨӨ бичсэн тоонууд — эхийг нь давтаж болно (баталгаажуулалтгүйгээр). */
  userNumbers: number[];
  terminology: NormTerminologyEntry[];
  /** «Шаардлага хангаж байна / аюулгүй / зөвшөөрөгдөнө» гэх нийцлийн гэрчилгээ хориотой. */
  forbidCompliance: boolean;
  /** Төлөвийн канон өгүүлбэр — эсвэл `null`. */
  stateSentence: string | null;
  /** Төлөвийн мета: ноорог/солигдсон гэх мэт хэлээр дурдах ёстой эсэх. */
  mustDiscloseCurrentness: boolean;
}

export type NormIntelViolationCode =
  | 'GENERAL_NUMBER'
  | 'UNSUPPORTED_NORM_NUMBER'
  | 'UNSUPPORTED_MODAL'
  | 'INVENTED_CLAUSE'
  | 'INVENTED_DOCUMENT'
  | 'COMPARATOR_CHANGED'
  | 'CLAIM_UNIT_MISMATCH'
  | 'CURRENTNESS_PROMOTED'
  | 'COMPLIANCE_CERTIFICATION'
  | 'APPLICABILITY_ASSUMED'
  | 'TERMINOLOGY_INVENTED';

export interface NormIntelViolation {
  code: NormIntelViolationCode;
  detail: string;
  sentence: string;
}

/* ================================================================== */
/*  Текстийн туслахууд                                                 */
/* ================================================================== */

function fold(s: string): string {
  return s.toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
}

export function splitNormSentences(text: string): string[] {
  return text
    .split(/(?<=[^\d][.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Тоо-биш тоонууд (огноо, цаг, баримтын код, заалт, хүснэгт, хуудас, жагсаалтын шошго). */
const NOT_A_NUMBER: readonly RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}:\d{2}\b/g,
  /\b\d{2}-\d{2,3}-\d{2}(?:-\d{2})?\b/g,
  /\b\d+(?:\.\d+){2,}\b/g,
  /(?:заалт|п\.|§|clause|хэсэг|хүснэгт|table|хуудас|х\.|p\.|page|appendix|хавсралт)\s*№?\s*[A-Za-zА-Яа-я]?-?\d+(?:\.\d+)*/giu,
  /\b\d+\)\s/g,
  /(?:^|\n)\s*\d+\.\s/g,
];

const NUMBER_RE = /(?<![\p{L}\d])(\d{1,3}(?:[  ]\d{3})+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?![\d])/gu;

function parseNum(raw: string): number {
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) return Number(raw.replace(/,/g, ''));
  return Number(raw.replace(/[  ]/g, '').replace(',', '.'));
}

function mask(s: string): string {
  let c = s;
  for (const re of NOT_A_NUMBER) c = c.replace(re, ' ');
  return c;
}

export function normNumbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of mask(text).matchAll(NUMBER_RE)) {
    const v = parseNum(m[1]!);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function numberEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9 || Math.abs(Math.round(a * 10) / 10 - b) < 1e-9 || Math.abs(Math.round(a) - b) < 1e-9;
}

/** Нэгжийн хэвийжүүлэлт — серверийн `normalizeUnit`-тэй ижил үр дүн (харьцуулалтад л). */
export function normalizeClaimUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/кпа/g, 'kpa')
    .replace(/па(?![\p{L}])/gu, 'pa')
    .replace(/кв\.?м/g, 'm2')
    .replace(/куб\.?м/g, 'm3')
    .replace(/мм/g, 'mm')
    .replace(/см/g, 'cm')
    .replace(/кг/g, 'kg')
    .replace(/°c|°с|градус|град/g, 'c')
    .replace(/хоног|өдөр|days?/g, 'd')
    .replace(/хувь|percent/g, '%')
    .replace(/минут|мин(?![\p{L}])|minutes?/gu, 'min')
    .replace(/секунд|сек(?![\p{L}])|seconds?/gu, 's')
    .replace(/давхар|floors?|storeys?/g, 'floor')
    .replace(/м/g, 'm');
  const table: Record<string, string> = { m2: 'm2', m3: 'm3', m: 'm', mm: 'mm', cm: 'cm', kpa: 'kPa', pa: 'Pa', kg: 'kg', c: 'C', '%': '%', d: 'd', min: 'min', s: 's', floor: 'floor', 'kg/m2': 'kg/m2', kn: 'kN' };
  return table[u] ?? u;
}

const UNIT_AFTER = /^\s*(кг\s*\/\s*м[²2]|kg\s*\/\s*m[²2]|кН|kN|кПа|kPa|Па|Pa|мм|mm|см|cm|м[²2]|m[²2]|м[³3]|m[³3]|°\s*[CС]|%|хувь|градус|минут|мин(?![\p{L}])|секунд|сек(?![\p{L}])|давхар|хоног|м(?![\p{L}])|m(?![\p{L}]))/iu;

function unitAfter(text: string, idx: number): string | null {
  const m = UNIT_AFTER.exec(text.slice(idx));
  return m ? normalizeClaimUnit(m[1]!) : null;
}

/* ================================================================== */
/*  Хэллэгийн ангилал                                                  */
/* ================================================================== */

/** Нормын баттай мэдэгдэл: «байх ёстой», «заавал», «хориглоно», доод/дээд хязгаар, нийцлийн мэдэгдэл. */
const MODAL_ASSERT = /(?:байх\s+ёстой|ёстой\s+(?:бөгөөд|юм|байна)|заавал|хориглоно|хориглосон|хориотой|зөвшөөрөгдөхгүй|зөвшөөрөгдөнө|шаардлагатай\s+(?:юм|байна)|шаардлагагүй\s+(?:юм|байна)|-?(?:аас|ээс)\s+(?:багагүй|доошгүй|ихгүй|хэтрэхгүй)|доод\s+тал\s+нь|дээд\s+тал\s+нь|дор\s+хаяж|хамгийн\s+(?:бага|их)\s+нь|\bmust\b|\bshall\b|required\s+to|minimum\s+of|maximum\s+of|at\s+least|no\s+more\s+than)/iu;

/** Баттай биш, шалгах/баталгаажуулах зааварчилгаа, татгалзал — мэдэгдэл биш. */
const HEDGE = /(?:шалга|баталгаажуул|лавл|эх\s+сурвалж|хүчинтэй\s+норм|нормын\s+(?:эх\s+)?бичвэр|тодорхойл|тогтоо|чадахгүй|боломжгүй|зохиохгүй|зохиож\s+болохгүй|ерөнхий|зарчмын\s+хувьд|ихэвчлэн|хамаарна|хамаарч|хамаарах|шалтгаална|нөхцөлөөс|verify|confirm|cannot|can't|not\s+verified|general|depends|баталгаагүй|олдсонгүй|мэдэхгүй|хэлж\s+болохгүй|хэлэх\s+боломжгүй|заавал\s+(?:биш|гэж\s+үзэхгүй|ижил\s+биш)|заавал[^.]{0,25}(?:биш|үгүй)|(?:биш|үгүй)[^.]{0,15}заавал|«заавал»)/iu;

const AUTHORITY_CLAIM = /(?:нормд\s+заасан|нормоор\s+тогтоосон|заалтад\s+заасан|заалтын\s+дагуу|стандартад\s+заасан|нормын\s+дагуу|нормд\s+тусгасан|according\s+to\s+the\s+(?:code|norm|standard)|the\s+(?:code|norm)\s+(?:requires|states))/iu;

const COMPLIANCE_CERT = /(?:шаардлаг(?:а|ыг)?\s+хангаж\s+байна|нийцэж\s+байна|нийцсэн|баталгаатай\s+аюулгүй|аюулгүй\s+(?:байна|юм)|зөвшөөрөгдсөн|тэнцсэн|\bcomplies\b|\bcompliant\b|\bapproved\b|safe\s+to\s+(?:use|occupy))/iu;
const COMPLIANCE_NEG = /(?:эсэх|боломжгүй|чадахгүй|гаргахгүй|өгөхгүй|бичихгүй|баталгаажуул|шалга|биш|гэж\s+хэлж|гэж\s+үзэж|хэлэх\s+боломж|cannot|whether|does\s+not|not\s+(?:be\s+)?(?:able|confirm))/iu;

const CURRENT_POSITIVE = /(?:хүчин\s+төгөлдөр|хүчинтэй|мөрдөгдөж\s+(?:байгаа|буй)|мөрдөж\s+(?:байгаа|буй|болно)|одоо\s+мөрд|одоогийн\s+(?:хүчинтэй|норм)|мөрдөнө|мөрдөх\s+ёстой|\bin\s+force\b|currently\s+(?:valid|in\s+force|applicable)|\bactive\b|\bvalid\b)/iu;
const CURRENT_NEGATED = /(?:биш|хүчингүй|хүчин\s+төгөлдөр\s+биш|мөрдөгдөхгүй|мөрдөхгүй|үзэж\s+болохгүй|үзэхгүй|болохгүй|баталгаажаагүй|баталгаажуул|шалгаагүй|шалга|тодорхойгүй|эсэх|боломжгүй|not\s+(?:yet\s+)?(?:in\s+force|valid|active)|unverified|cannot|whether|until|хүртэл|болтол|байж\s+болно|нэмэлт\s+(?:өөрчлөлт|шалгалт))/iu;
const DRAFT_WORD = /(?:\bdraft\b|ноорог|төслийн\s+баримт)/iu;
const SUPERSEDED_WORD = /(?:солигдсон|орлосон|хүчингүй\s+болсон|түүхэн|хуучирсан|superseded|obsolete|historical)/iu;

const DISCLAIM = /(?:баталгаажуул|олдсонгүй|чадахгүй|боломжгүй|мэдэхгүй|зохиохгүй|шалга|эх\s+бичвэр|лавл|гэж\s+хэлсэн|гэж\s+сонссон|гэж\s+байна|гэсэн\s+байна|cannot|not\s+verified|unable|verify|confirm)/iu;

const DOC_CODE_RE = /(?:БНбД|БД|MNS|МНС|УББ|BNbD|BD|UBB|СНиП|SNiP)\s*[-\s]?\s*\d{2}[-\s]\d{2,3}[-\s]\d{2}(?:[-\s]\d{2})?/giu;
const CLAUSE_RE = /(?:заалт|clause|§|п\.)\s*№?\s*(\d+(?:\.\d+)+)|(?<![\d.])(\d+\.\d+\.\d+(?:\.\d+)?)(?![\d.])/giu;
const TABLE_RE = /(?:хүснэгт|table)\s*№?\s*(\d+(?:\.\d+)?)/giu;
const PAGE_RE = /(?:хуудас|х\.|p\.|page)\s*(\d+)/giu;
const APPENDIX_RE = /(?:хавсралт|appendix)\s*([A-Za-zА-Яа-я](?:-?\d+)?|\d+)(?![\p{L}])/giu;

function foldCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[\s_]+/g, '')
    .replace(/бнбд/g, 'bnbd')
    .replace(/убб/g, 'ubb')
    .replace(/мнс/g, 'mns')
    .replace(/бд/g, 'bd')
    .replace(/снип/g, 'snip');
}
function codeDigits(code: string): string | null {
  return /(\d{2}-\d{2,3}-\d{2}(?:-\d{2})?)/.exec(code.replace(/[–—]/g, '-').replace(/\s/g, '-'))?.[1] ?? null;
}
function codeEq(a: string, b: string): boolean {
  if (foldCode(a) === foldCode(b)) return true;
  const da = codeDigits(a);
  const db = codeDigits(b);
  return da !== null && db !== null && da === db;
}

/* ================================================================== */
/*  ХАРЬЦУУЛАЛТЫН ТЭМДЭГ (comparator) — «≥» ↔ «>» зөрүүг барина       */
/* ================================================================== */

type CmpClass = 'gte' | 'gt' | 'lte' | 'lt';
const CMP_PHRASES: readonly { cls: CmpClass; re: RegExp }[] = [
  { cls: 'gte', re: /(?:-?(?:аас|ээс)\s+(?:багагүй|доошгүй)|доод\s+тал\s+нь|дор\s+хаяж|хамгийн\s+багадаа|минимум|\bat\s+least\b|\bminimum\b|\bnot\s+less\s+than\b|≥|>=)/iu },
  { cls: 'lte', re: /(?:-?(?:аас|ээс)\s+(?:ихгүй|хэтрэхгүй)|дээд\s+тал\s+нь|хамгийн\s+ихдээ|максимум|\bat\s+most\b|\bmaximum\b|\bnot\s+more\s+than\b|\bno\s+more\s+than\b|≤|<=)/iu },
  { cls: 'gt', re: /(?:-?(?:аас|ээс)\s+(?:их|давсан|хэтэрсэн)(?![\p{L}])|\bmore\s+than\b|\bgreater\s+than\b|\bexceeds?\b|(?<![<>=])>(?!=))/iu },
  { cls: 'lt', re: /(?:-?(?:аас|ээс)\s+(?:бага|богино|доош\s+байх|багаар)(?![\p{L}])|\bless\s+than\b|\bbelow\b|\bunder\b|(?<![<>=])<(?!=))/iu },
];

function claimOperatorClass(op: ClaimOperator | null): CmpClass | null {
  return op === 'gte' || op === 'gt' || op === 'lte' || op === 'lt' ? op : null;
}

function comparatorsIn(sentence: string): Set<CmpClass> {
  const out = new Set<CmpClass>();
  for (const p of CMP_PHRASES) if (p.re.test(sentence)) out.add(p.cls);
  return out;
}

/* ================================================================== */
/*  НЭР ТОМЬЁОНЫ ЗАДЛАЛ                                                */
/* ================================================================== */

const EXPANSION_CUE = /(?:\s*(?:=|—|–|-|:)\s*|\s+гэдэг\s+нь\s+|\s+гэсэн\s+үг(?:ийн)?\s+(?:товчлол|товчилсон)?\s*|\s+гэж\s+орчуулагд\p{L}*\s*|\s+нь\s+|\s+буюу\s+|\s*\(\s*|\s+stands\s+for\s+|\s+means\s+)/iu;

function expansionTail(sentence: string, abbrIdx: number, abbrLen: number): string | null {
  const rest = sentence.slice(abbrIdx + abbrLen);
  const m = new RegExp(`^${EXPANSION_CUE.source}`, 'iu').exec(rest);
  if (!m) return null;
  const tail = rest.slice(m[0].length);
  // Эхний 6 үг (хаалт/цэг хүртэл)
  return tail.split(/[.!?;)\n]/u)[0]!.split(/\s+/u).slice(0, 7).join(' ').trim() || null;
}

/** Латин ЭСВЭЛ олон кирилл үгтэй «задлал» мэт харагдах уу (товчлолын тайлбар). */
function looksLikeExpansion(tail: string): boolean {
  const words = tail.split(/\s+/u).filter((w) => /\p{L}/u.test(w));
  if (words.length < 2) return false;
  const latinCaps = words.filter((w) => /^[A-Z][a-z]+$/.test(w)).length;
  return latinCaps >= 2 || /^[A-Za-z]/.test(tail) || /(?:нөлөө|нөлөөлөл|удирдлага|хамгаалалт|эсэргүүцэл|тусгаарлалт|бүрэн\s+бүтэн|системийн|шинж\s+чанар|тэнцүү)/iu.test(tail);
}

/* ================================================================== */
/*  ГОЛ ШАЛГАГЧ                                                        */
/* ================================================================== */

export interface NormIntelCheckContext {
  /** Хариултад байж болох тоонууд (`TrustedContract.allowedNumbers`) — `null` = хязгааргүй. */
  allowedNumbers: readonly number[] | null;
}

function sourceMatchesClause(block: NormIntelBlock, clause: string): boolean {
  return block.sources.some((s) => s.clause !== null && (s.clause === clause || s.clause.replace(/^\D+/, '') === clause));
}

function userQuoted(block: NormIntelBlock, token: string): boolean {
  const t = fold(token);
  return block.userQuoted.some((q) => fold(q).includes(t) || t.includes(fold(q)));
}

function hasPlaceholderLeak(s: string): boolean {
  return /\{\{|\}\}|<<<|>>>/.test(s);
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Хариултыг НОРМЫН блоктой тулгана — зөвхөн ХАТУУ зөрчлүүд (дахин үүсгэлт, өгүүлбэр хасалт БИШ).
 */
export function validateNormIntel(answer: string, block: NormIntelBlock | null | undefined, ctx: NormIntelCheckContext): NormIntelViolation[] {
  if (!block) return [];
  const v: NormIntelViolation[] = [];
  const push = (code: NormIntelViolationCode, detail: string, sentence: string): void => {
    if (!v.some((x) => x.code === code && x.sentence === sentence)) v.push({ code, detail, sentence });
  };
  const sentences = splitNormSentences(answer);
  const authoritative = block.evidenceBacked;
  const stateSentence = block.stateSentence;
  const isStateSentence = (s: string): boolean => stateSentence !== null && (s.includes(stateSentence) || stateSentence.includes(s));
  const userNums = block.userNumbers;
  const allowedNums = ctx.allowedNumbers;
  const claimNums = block.claims.filter((c) => typeof c.value === 'number').map((c) => c.value as number);

  for (const s of sentences) {
    if (isStateSentence(s) || hasPlaceholderLeak(s)) {
      if (hasPlaceholderLeak(s)) push('UNSUPPORTED_MODAL', 'Дотоод тэмдэглэгээ задарсан', s);
      continue;
    }
    const hedged = HEDGE.test(s);

    /* ── 1. ТОО ──────────────────────────────────────────────────── */
    const nums = normNumbersIn(s).filter((n) => !userNums.some((u) => numberEq(n, u)));
    if (nums.length > 0) {
      if (!authoritative) {
        // Ерөнхий / нотолгоогүй горимд ЯМАР Ч нормын тоо хориотой.
        push('GENERAL_NUMBER', `Нотолгоогүй хариултад тоо: ${nums.slice(0, 3).join(', ')}`, s);
      } else {
        const bad = nums.filter((n) => !(allowedNums !== null ? allowedNums.some((a) => numberEq(n, a)) : claimNums.some((a) => numberEq(n, a))));
        if (bad.length > 0) push('UNSUPPORTED_NORM_NUMBER', `Баталгаагүй тоо: ${bad.slice(0, 3).join(', ')}`, s);
      }
    }

    /* ── 2. БАТТАЙ МЭДЭГДЭЛ (нотолгоогүй горимд) ─────────────────── */
    if (!authoritative && MODAL_ASSERT.test(s) && !hedged) push('UNSUPPORTED_MODAL', 'Нотолгоогүй «заавал/доод/дээд/хориглоно» мэдэгдэл', s);
    if (!authoritative && block.sources.length === 0 && AUTHORITY_CLAIM.test(s) && !hedged) push('UNSUPPORTED_MODAL', 'Эх сурвалжгүй атлаа нормд заасан гэж мэдэгдсэн', s);

    /* ── 3. ЭШЛЭЛ: баримтын код, заалт, хүснэгт, хуудас ──────────── */
    for (const code of s.match(DOC_CODE_RE) ?? []) {
      const known = block.sources.some((src) => src.code !== null && codeEq(src.code, code));
      const quoted = userQuoted(block, code) && DISCLAIM.test(s);
      if (!known && !quoted) push('INVENTED_DOCUMENT', `Эх сурвалжид байхгүй баримт: ${code}`, s);
    }
    for (const m of s.matchAll(CLAUSE_RE)) {
      const clause = (m[1] ?? m[2])!;
      if (!sourceMatchesClause(block, clause) && !(userQuoted(block, clause) && DISCLAIM.test(s))) push('INVENTED_CLAUSE', `Эх сурвалжид байхгүй заалт: ${clause}`, s);
    }
    for (const m of s.matchAll(TABLE_RE)) {
      const t = m[1]!;
      const known = block.sources.some((src) => src.table !== null && String(src.table) === t);
      if (!known && !(userQuoted(block, t) && DISCLAIM.test(s))) push('INVENTED_CLAUSE', `Эх сурвалжид байхгүй хүснэгт: ${t}`, s);
    }
    for (const m of s.matchAll(PAGE_RE)) {
      const pg = Number(m[1]);
      const known = block.sources.some((src) => src.page !== null && src.page === pg);
      if (!known && !(userQuoted(block, String(pg)) && DISCLAIM.test(s))) push('INVENTED_CLAUSE', `Эх сурвалжид байхгүй хуудас: ${pg}`, s);
    }
    for (const m of s.matchAll(APPENDIX_RE)) {
      const a = m[1]!;
      const known = block.sources.some((src) => src.appendix !== null && fold(src.appendix) === fold(a));
      if (!known && !(userQuoted(block, a) && DISCLAIM.test(s))) push('INVENTED_CLAUSE', `Эх сурвалжид байхгүй хавсралт: ${a}`, s);
    }

    /* ── 4. ХҮЧИН ТӨГӨЛДӨР БАЙДАЛ ХУУРАМЧЛАХ ───────────────────────
     *    «;»-ээр тусгаарлагдсан хэсэг бүрийг ТУСДАА шалгана: «хүчин төгөлдөр баримтыг мөрдөнө; ноорогийг зөвхөн лавлагаа
     *    болгоно» нь ноорогийг хүчинтэй гэсэн мэдэгдэл БИШ. */
    for (const part of s.split(/;/u)) {
      if (!CURRENT_POSITIVE.test(part) || CURRENT_NEGATED.test(part)) continue;
      if (DRAFT_WORD.test(part)) push('CURRENTNESS_PROMOTED', 'Ноорог баримтыг хүчинтэй гэж мэдэгдсэн', s);
      else if (SUPERSEDED_WORD.test(part)) push('CURRENTNESS_PROMOTED', 'Солигдсон/түүхэн баримтыг хүчинтэй гэж мэдэгдсэн', s);
      else {
        for (const src of block.sources) {
          if (USABLE_CURRENTNESS.has(src.currentness) || src.code === null) continue;
          const mentions = (part.match(DOC_CODE_RE) ?? []).some((c) => codeEq(c, src.code!)) || fold(part).includes(fold(src.code));
          if (mentions) push('CURRENTNESS_PROMOTED', `${src.code}: төлөв ${src.currentness} атлаа хүчинтэй гэж мэдэгдсэн`, s);
        }
      }
    }

    /* ── 5. НИЙЦЛИЙН ГЭРЧИЛГЭЭ ───────────────────────────────────── */
    if (block.forbidCompliance && COMPLIANCE_CERT.test(s) && !COMPLIANCE_NEG.test(s)) push('COMPLIANCE_CERTIFICATION', 'Нотолгоогүй нийцлийн/аюулгүй байдлын гэрчилгээ', s);

    /* ── 6. ХЭРЭГЛЭГДЭХ БАЙДАЛ (оролт дутуу) ─────────────────────── */
    if (block.applicability.status !== 'APPLIES' && authoritative) {
      const definitive = MODAL_ASSERT.test(s) || normNumbersIn(s).some((n) => claimNums.some((c) => numberEq(n, c)));
      const conditional = /(?:хэрэв|\bбол\b|нөхцөл|хамаарна|шалтгаална|тодорхой\s+болох|дутуу|өгвөл|шаардлагатай\s+мэдээлэл|missing|depends|\bif\b)/iu.test(s) || block.applicability.missing.some((m) => fold(s).includes(fold(m).slice(0, 12)));
      if (definitive && !conditional) push('APPLICABILITY_ASSUMED', 'Хэрэглэгдэх эсэх тодорхойгүй атлаа шаардлагыг баттай хэлсэн', s);
    }

    /* ── 7. ХАРЬЦУУЛАЛТ + НЭГЖ (мэдэгдлийн бүртгэл) ──────────────── */
    if (block.claims.length > 0) {
      const cmps = comparatorsIn(s);
      for (const claim of block.claims) {
        if (typeof claim.value !== 'number') continue;
        const sites: { value: number; end: number }[] = [];
        for (const m of mask(s).matchAll(NUMBER_RE)) {
          const val = parseNum(m[1]!);
          if (Number.isFinite(val) && numberEq(val, claim.value)) sites.push({ value: val, end: (m.index ?? 0) + m[1]!.length });
        }
        if (sites.length === 0) continue;
        // Нэгж
        if (claim.unit) {
          const masked = mask(s);
          for (const site of sites) {
            const u = unitAfter(masked, site.end);
            if (u !== null && u !== claim.unit) {
              push('CLAIM_UNIT_MISMATCH', `${claim.value}: ${u} ≠ ${claim.unit}`, s);
              break;
            }
          }
        }
        // Харьцуулалтын тэмдэг — claim нь тодорхой comparator-тай үед л
        const want = claimOperatorClass(claim.operator);
        if (want !== null && cmps.size > 0 && !cmps.has(want)) {
          // «-аас дээш» нь gt/gte аль алинд (монгол хэлний хоёрдмол утга) — хатуу зөрчил БИШ
          const ambiguousAbove = /-?(?:аас|ээс)\s+дээш|-?(?:аас|ээс)\s+доош/iu.test(s);
          if (!ambiguousAbove) push('COMPARATOR_CHANGED', `Харьцуулалт зөрсөн: нормд «${want}», хариултад «${[...cmps].join('/')}»`, s);
        }
      }
    }

    /* ── 8. ТЕХНИКИЙН ТОВЧЛОЛЫН ЗОХИОМОЛ ТАЙЛБАР ─────────────────── */
    for (const t of block.terminology) {
      const re = new RegExp(`(?<![\\p{L}\\d])${t.abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}]|\\d)`, 'gu');
      for (const m of s.matchAll(re)) {
        const tail = expansionTail(s, m.index ?? 0, t.abbr.length);
        if (tail === null || !looksLikeExpansion(tail)) continue;
        const f = fold(tail);
        const ok = t.keys.length > 0 && t.keys.some((k) => f.includes(k));
        if (!ok) push('TERMINOLOGY_INVENTED', `«${t.abbr}» товчлолын тайлбар баталгаагүй: «${tail}»`, s);
      }
    }
  }

  return v;
}

/* ================================================================== */
/*  Эх сурвалжийн блок — СЕРВЕРИЙН                                    */
/* ================================================================== */

export function sourceLabel(src: NormSource, lang: 'mn-Cyrl' | 'en' = 'mn-Cyrl'): string {
  const bits: string[] = [];
  if (src.code) bits.push(src.code);
  if (src.titleMn && !(src.code && src.titleMn.includes(src.code))) bits.push(src.titleMn);
  if (src.appendix) bits.push(`${lang === 'en' ? 'Appendix' : 'Хавсралт'} ${src.appendix}`);
  if (src.clause) bits.push(`${lang === 'en' ? 'clause' : 'заалт'} ${src.clause}`);
  if (src.table !== null) bits.push(`${lang === 'en' ? 'Table' : 'Хүснэгт'} ${src.table}`);
  if (src.page !== null) bits.push(`${lang === 'en' ? 'p.' : 'х.'}${src.page}`);
  return bits.join(', ');
}

/** Зөвхөн БОДИТ мэдэгдэж буй талбаруудыг; хуурамч оронд тавилт БАЙХГҮЙ. */
export function renderSourceBlock(sources: readonly NormSource[], lang: 'mn-Cyrl' | 'en' = 'mn-Cyrl'): string | null {
  const lines: string[] = [];
  for (const s of sources) {
    const label = sourceLabel(s, lang);
    if (label.length === 0) continue;
    const parts = [label];
    if (s.statusLabelMn) parts.push(`${lang === 'en' ? 'status' : 'төлөв'}: ${s.statusLabelMn}`);
    if (s.url) parts.push(s.url);
    lines.push(`• ${parts.join(' — ')}`);
  }
  if (lines.length === 0) return null;
  return `${lang === 'en' ? 'Source' : 'Эх сурвалж'}:\n${lines.join('\n')}`;
}

/**
 * Сервер эх сурвалжийн блокийг ДЕТЕРМИНИСТ нэмнэ.  Хариултад бүх эх сурвалжийн код аль хэдийн бий бол (загвар/template
 * зөв эшилсэн) давхардуулахгүй; эс бөгөөс төгсгөлд.
 */
export function ensureSourceBlock(answer: string, block: NormIntelBlock | null | undefined): string {
  if (!block || block.sourceBlock === null || block.evidenceState !== 'AUTHORITATIVE') return answer;
  if (answer.includes(block.sourceBlock)) return answer;
  const f = fold(answer);
  const codes = block.sources.map((s) => s.code).filter((c): c is string => c !== null);
  if (codes.length > 0 && codes.every((c) => f.includes(fold(c)))) {
    // кодууд байгаа ч заалт/хуудсын хаяг байхгүй бол блок нэмнэ
    const allLabeled = block.sources.every((s) => (s.clause === null || f.includes(fold(s.clause))) && (s.page === null || f.includes(`${s.page}`)));
    if (allLabeled) return answer;
  }
  return `${answer.trim()}\n\n${block.sourceBlock}`;
}

/* ================================================================== */
/*  ДАВТАЛТЫН ХАМГААЛАЛТ — харуулахаас ӨМНӨ (serving path)             */
/* ================================================================== */

export interface RepetitionFinding {
  severe: boolean;
  kind: 'none' | 'unit-loop' | 'sentence-block' | 'list-loop' | 'low-diversity';
  detail: string;
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
}

/**
 * ХҮНД ДАВТАЛТЫГ илрүүлнэ (runtime-ийн зэрэгцээ мөчлөгийн хамгаалагчаас ХОЁР ТАЛААР нэмэлт): урсгалын дараа ирсэн
 * бүтэн хариултад — «төсөл, ашиглалтын нөхцөл, төрөл, төлөв, төсөл, …» гэх мэт жагсаалтын гогцоо, ижил өгүүлбэрийн
 * блок, 1–4 үгийн мөчлөг, үгийн олон янз байдал доройтох.
 *
 * ⚠️ Зөвхөн ХҮНД тохиолдол — монгол чангатгал («маш маш их»), 2 удаагийн давталт, тоотой жагсаалт ХЭЗЭЭ Ч баригдахгүй.
 */
export function detectSevereRepetition(text: string): RepetitionFinding {
  const none: RepetitionFinding = { severe: false, kind: 'none', detail: '' };
  const w = wordsOf(text);
  if (w.length < 10) return none;

  // 1. 1–4 үгийн нэгж ≥6 удаа дараалан (богино) / 3–4 үгийн нэгж ≥4 удаа
  for (let n = 1; n <= 4; n++) {
    const need = n <= 2 ? 6 : 4;
    for (let i = 0; i + n * need <= w.length; i++) {
      const unit = w.slice(i, i + n).join(' ');
      let reps = 1;
      let j = i + n;
      while (j + n <= w.length && w.slice(j, j + n).join(' ') === unit) {
        reps += 1;
        j += n;
      }
      if (reps >= need) return { severe: true, kind: 'unit-loop', detail: `«${unit}» ×${reps}` };
    }
  }

  // 2. ИЖИЛ ӨГҮҮЛБЭР ≥3 удаа (≥4 үгтэй)
  const sents = splitNormSentences(text).map((s) => wordsOf(s).join(' ')).filter((s) => s.split(' ').length >= 4);
  const counts = new Map<string, number>();
  for (const s of sents) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [s, c] of counts) if (c >= 3) return { severe: true, kind: 'sentence-block', detail: `«${s.slice(0, 40)}…» ×${c}` };

  // 3. ЖАГСААЛТЫН ГОГЦОО: таслалаар тусгаарлагдсан ≥10 зүйлийн ≥3 нь давтагдсан
  for (const line of text.split('\n')) {
    const items = line.split(/[,;、]/u).map((x) => wordsOf(x).join(' ')).filter((x) => x.length > 0 && x.split(' ').length <= 5);
    if (items.length >= 10) {
      const ic = new Map<string, number>();
      for (const it of items) ic.set(it, (ic.get(it) ?? 0) + 1);
      const repeated = [...ic.values()].filter((c) => c >= 3).length;
      if (repeated >= 1 && [...ic.values()].reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0) >= 5) return { severe: true, kind: 'list-loop', detail: `${items.length} зүйлийн жагсаалтад давталт` };
    }
  }

  // 4. Үгийн олон янз байдал: ≥40 үгтэй хариултад 3-граммын ≥55% нь давтагдсан
  if (w.length >= 40) {
    const g = new Map<string, number>();
    for (let i = 0; i + 3 <= w.length; i++) {
      const k = w.slice(i, i + 3).join(' ');
      g.set(k, (g.get(k) ?? 0) + 1);
    }
    const total = w.length - 2;
    const unique = g.size;
    if (unique / total < 0.45) return { severe: true, kind: 'low-diversity', detail: `3-грамын олон янз байдал ${(unique / total).toFixed(2)}` };
  }
  return none;
}
