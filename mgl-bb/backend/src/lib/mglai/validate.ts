/**
 * MGL AI · ХАРИУЛТЫН ШАЛГАЛТ БА ЦЭВЭРЛЭГЭЭ (§12, §13).
 *
 * ⚠️ ЗАГВАР ЗААВРЫГ ЗӨРЧВӨЛ ХЭРЭГЛЭГЧ ТҮҮНИЙГ ХАРАХ ЁСГҮЙ.  8B загвар
 *    монголоор бичихийг тушаасан ч заримдаа англиар хариулдаг.  Тэр
 *    тохиолдолд НЭГ УДАА засварын prompt-оор дахин үүсгэнэ — ӨӨР
 *    (төлбөртэй) загвар руу ХЭЗЭЭ Ч залгахгүй (§12).
 *
 * ⚠️ ЦЭВЭРЛЭГЭЭ НЬ ЗӨВХӨН ТЭЭВРИЙН АЛДААНД.  `&#x20;`, `\*\*`
 *    зэрэг нь загварын биш, дамжуулалт/рендерийн гажиг.  Монгол ҮГИЙГ
 *    засах гэж оролдохгүй — тэр нь утгыг эвдэнэ (§13).
 *
 * ⚠️ ЦЭВЭР ФУНКЦУУД — тестээр бүрэн хамрагдана.
 */

export type ValidationIssue =
  | 'wrong_language'
  | 'unnatural_mongolian'
  | 'html_entities'
  | 'escaped_markdown'
  | 'repetition'
  | 'empty';

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Цэвэрлэсэн текст — асуудалгүй ч гэсэн үргэлж энэ хувилбарыг үзүүл. */
  cleaned: string;
  /** Дахин үүсгэх шаардлагатай эсэх (зөвхөн хэл буруу үед). */
  needsRepair: boolean;
}

/* ================================================================== */
/*  1. Тээврийн гажгийг цэвэрлэх (§13)                                 */
/* ================================================================== */

// ⚠️ 2026-09-11: `ICON_LEAK_RE` (/\b(?:svg|img|icon)(?=[А-ЯӨҮЁ])/) ХАСАГДСАН.  Тэр нь
//    «svgНотолгоо хүрэлцэхгүй» гэсэн ганц хуулбарын гажгийг ТЕКСТ ЗАСАЖ нөхөх гэсэн
//    аюултай band-aid байв — «logo.svgФайл» гэх мэт зөв текстийг ч эвддэг, харин
//    эх шалтгаан (дүрс ба шошго DOM-д наалдсан) нь `ConfidenceChip`-ийн `aria-hidden`
//    дүрс + ил зайгаар аль хэдийн засагдсан.  Аппын ямар ч текст/clipboard-д түүхий
//    SVG тэмдэг гарахгүйг `frontend/scripts/check-ai-ui-leak.mjs` рендерээр барина;
//    анхны «svgsvg» гомдол нь NOT_REPRODUCIBLE_IN_APP (2026-09-11).

/** HTML entity — зөвхөн АЮУЛГҮЙ, харагдац эвддэгийг нь. */
const SAFE_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['&#x20;', ' '],
  ['&#32;', ' '],
  ['&nbsp;', ' '],
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&apos;', "'"],
]);

/**
 * Тээврийн гажгийг арилгана.
 *
 * ⚠️ МОНГОЛ ҮГИЙГ ХӨНДӨХГҮЙ.  Зөвхөн (а) HTML entity, (б) markdown-ийн
 *    илүү escape, (в) дүрсний шошгын наалдац.  «Түрэмгий» цэвэрлэгээ нь
 *    жинхэнэ агуулгыг устгах эрсдэлтэй (§13).
 */
export function cleanOutput(raw: string): string {
  if (!raw) return '';
  let out = raw;

  // (а) HTML entity → бодит тэмдэгт.
  for (const [ent, ch] of SAFE_ENTITIES) out = out.split(ent).join(ch);

  // (б) Илүү escape: `\*\*` → `**`, `\_` → `_`.  Загвар markdown-ыг
  //     давхар escape хийхэд хэрэглэгч түүхий тэмдэгт хардаг.
  out = out.replace(/\\([*_`~[\]()#+\-.!])/g, '$1');

  // (в) Дүрсний шошго наалдсаныг салгана.

  // (г) Хэт олон хоосон мөр — рендерийн гажиг.
  out = out.replace(/\n{4,}/g, '\n\n\n');

  return out.trim();
}

/* ================================================================== */
/*  2. Хэлний шалгалт                                                  */
/* ================================================================== */

/** Латин нэр томьёог тоолохгүй — монгол өгүүлбэрт байх нь ХЭВИЙН (§8). */
const TECH_WORD_RE =
  /\b(?:revit|view|family|type|parameter|deadline|task|project|erp|server|api|model|ai|gpu|sheet|schedule|warning|workset|wall|door|window|floor|level|room|area|volume|element|category|bim|cad|pdf|dwg|ifc|excel|mj|m2|m3)\b/gi;

/**
 * БОДИТ Qwen3/LoRA гаралтаас тогтмол давтагдсан, кирилл боловч монгол хэлний
 * хувьд эвдэрсэн хэллэгүүд.  Эдгээр нь «стилийн таалагдал» БИШ — утга гажуудуулдаг
 * хүчтэй дохио.  Нэг нь таарвал НЭГ удаагийн засварын үүсгэлт зөвшөөрнө.
 *
 * ⚠️ Энд ердийн «энэхүү/тухайн» зэрэг ганц үгийг хориглохгүй.  Тийм өргөн regex
 * нь зөв техникийн хариуг дахин үүсгэж, latency нэмнэ.  Зөөлөн дохио хоёр ба
 * түүнээс олон давхцсан үед л засварлана.
 */
const STRONG_MN_STYLE_FAILURES: readonly RegExp[] = [
  /үнэн зөв (?:хөдөлж|хэрэгжүүл|хөгжил|болон)/iu,
  /\d+(?:[.,]\d+)?\s*%\s*үнэлгээтэй/iu,
  /Хөдөлгөөн:\s*\d/u,
  /Завсрын үе/u,
  /хамгийн ихээс/iu,
  /Хугацаа хэрэгжихээс/iu,
  /хамгийн их үлдсэн|хамгийн баруун/iu,
  /шалтгаануудын хүчин зүйлс/iu,
  /үндэслэл дээр байна/iu,
  /тэгшүүр|тэгшитгэл нь|тэгшлэг/iu,
  /ангилалд оролцох/iu,
  /Идвэхтэй/iu,
  /ажилтнад/iu,
  /өгөөгөө/iu,
];

const SOFT_MN_STYLE_FAILURES: readonly RegExp[] = [
  /энэ асуултын хувьд/iu,
  /таны асуултын дагуу/iu,
  /дараах мэдээллийг өгч болно/iu,
  /гэсэн тоотой (?:байгаа(?: болно)?|тэнцүү)/iu,
  /маш чухал асуулт/iu,
  /баяртайгаар хариул/iu,
  /санамсаргүйгээр нь үзье/iu,
];

/**
 * Кирилл байгаа эсэхээс ӨӨР чанарын хаалга.  Тоо/эшлэл/кодыг өөрчлөхгүй,
 * зөвхөн дараагийн локал засварын prompt-ыг асаах эсэхийг шийднэ.
 */
export function hasUnnaturalMongolian(text: string): boolean {
  if (!text) return false;
  if (STRONG_MN_STYLE_FAILURES.some((re) => re.test(text))) return true;
  let soft = 0;
  for (const re of SOFT_MN_STYLE_FAILURES) {
    if (re.test(text)) soft += 1;
    if (soft >= 2) return true;
  }
  return false;
}

/**
 * Текстийн кирилл харьцаа — нэр томьёог хассаны ДАРАА.
 *
 * ⚠️ НЭР ТОМЬЁОГ ХАСАХ НЬ ЗААВАЛ.  «Одоогийн Revit view дээр 17 wall
 *    сонгогдсон байна» гэсэн БҮРЭН ЗӨВ монгол өгүүлбэрт латин үг 3
 *    байна.  Тэднийг тоовол зөв хариултыг «англи» гэж буруу тэмдэглэнэ.
 */
export function mongolianRatio(text: string): number {
  const stripped = text.replace(TECH_WORD_RE, ' ').replace(/https?:\/\/\S+/g, ' ');
  const letters = stripped.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1; // үсэггүй (зөвхөн тоо) — асуудалгүй
  const cyr = letters.filter((c) => /[Ѐ-ӿ]/.test(c)).length;
  return cyr / letters.length;
}

/** Ижил өгүүлбэр давтагдсан эсэх — жижиг загварын түгээмэл гажиг. */
function hasRepetition(text: string): boolean {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 25);
  if (sentences.length < 3) return false;
  const seen = new Set<string>();
  let dup = 0;
  for (const s of sentences) {
    if (seen.has(s)) dup += 1;
    seen.add(s);
  }
  // ⚠️ Нэг давталт нь санамсаргүй байж болно; ХОЁР нь загварын гацаа.
  return dup >= 2;
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Хариултыг шалгаж, цэвэрлэнэ.
 *
 * @param expected  Хүлээгдэж буй хэл (`detectLanguage` шийдсэн).
 */
export function validateAnswer(raw: string, expected: 'mn-Cyrl' | 'en'): ValidationResult {
  const cleaned = cleanOutput(raw);
  const issues: ValidationIssue[] = [];

  if (cleaned.length === 0) {
    return { ok: false, issues: ['empty'], cleaned, needsRepair: false };
  }

  // Тээврийн гажиг ТҮҮХИЙ текстэд байсан эсэх — цэвэрлэсэн ч бүртгэнэ,
  // ингэснээр давтагдвал үндсэн шалтгааныг олох боломжтой.
  if (/&#x?[0-9a-f]+;|&(?:nbsp|amp|lt|gt|quot|apos);/i.test(raw)) issues.push('html_entities');
  if (/\\[*_`~[\]]/.test(raw)) issues.push('escaped_markdown');
  if (hasRepetition(cleaned)) issues.push('repetition');

  let needsRepair = false;
  if (expected === 'mn-Cyrl') {
    const ratio = mongolianRatio(cleaned);
    // ⚠️ 0.5 БОСГО.  Монгол хариултад англи нэр томьёо, тоо байх нь
    //    хэвийн; гэвч ХАГАСААС бага кирилл гэдэг нь загвар англи руу
    //    шилжсэн гэсэн үг.  Хэт өндөр босго нь зөв холимог хариултыг
    //    дэмий дахин үүсгүүлнэ (нэг удаагийн дахилт = хоёр дахин удаан).
    if (ratio < 0.5) {
      issues.push('wrong_language');
      needsRepair = true;
    } else if (hasUnnaturalMongolian(cleaned)) {
      // ⚠️ Кирилл ≠ байгалийн монгол.  Бодит Qwen3 гажиг («явц 53%» →
      // «53% үнэлгээтэй», «хамгийн баруун deadline») ratio=1 байсан тул
      // хуучин хаалгаар шууд хэрэглэгчид хүрдэг байв.
      issues.push('unnatural_mongolian');
      needsRepair = true;
    }
  }

  return { ok: issues.length === 0, issues, cleaned, needsRepair };
}

/* ================================================================== */
/*  3. Засварын prompt (§12)                                           */
/* ================================================================== */

/**
 * Хэл буруу гарсан хариултыг дахин бичүүлэх заавар.
 *
 * ⚠️ ШИНЭ МЭДЭЭЛЭЛ НЭМЭХГҮЙ.  Засвар нь ЗӨВХӨН хэлийг өөрчилнө: тоо,
 *    эшлэл, хэрэгслийн үр дүн ХЭВЭЭР үлдэх ёстой.  Эс тэгвэл засвар нь
 *    шинэ худал үүсгэх зам болно.
 *
 * ⚠️ «Орчуулж байна» гэж ТАЙЛБАРЛУУЛАХГҮЙ — хэрэглэгч дотоод механикийг
 *    харах ёсгүй (§14).
 */
export const REPAIR_PROMPT_MN =
  'Өмнөх хариултын УТГА, БАРИМТЫГ өөрчлөхгүйгээр ЖИНХЭНЭ, БАЙГАЛИЙН МОНГОЛ КИРИЛЛЭЭР дахин найруул. ' +
  'Англи хэлнээс үгчлэн орчуулсан мэт, утгагүй эсвэл албан бичгийн хэт хиймэл хэллэгийг энгийн мэргэжлийн монгол хэлээр солино. ' +
  'Бүх тоо, огноо, хувь, нормын код, нэгж, эшлэл, proper name болон хэрэгслийн үр дүнг ЯГ ХЭВЭЭР нь үлдээ. ' +
  'ШИНЭ мэдээлэл, шинэ тоо, шинэ эх сурвалж, шинэ дүгнэлт НЭМЭХГҮЙ. ' +
  'Засварлаж байгаагаа битгий тайлбарла — зөвхөн эцсийн хариултаа бич.';
