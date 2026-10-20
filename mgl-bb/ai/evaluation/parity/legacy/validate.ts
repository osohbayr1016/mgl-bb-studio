/**
 * MGL AI · ХАРИУЛТЫН ШАЛГАЛТ — ХӨТЧИЙН ТАЛ (§12, §13).
 *
 * ⚠️ ЭНЭ НЬ `backend/src/lib/mglai/validate.ts`-ИЙН ХОС ФАЙЛ.
 *    Хоёуланг нь ХАМТ өөрчил.  Репогийн бусад хос файлууд шиг (leavePolicy,
 *    teamReportStatusQuestions, officeKind…) энэ нь типээр ХАМГААЛАГДААГҮЙ.
 *
 *    ЯАГААД ХУУЛБАРЛАВ.  §12: «After model generation, validate the output
 *    BEFORE displaying.»  Хариу нь ЛОКАЛ runtime-аас урсгалаар ирдэг тул
 *    Worker түүнийг харахаас өмнө шалгах ёстой.  Worker руу илгээгээд
 *    буцааж асуух нь: (а) нэмэлт round-trip, (б) хэрэглэгч буруу хэл дээрх
 *    хариуг аль хэдийн харчихсан байна.
 *
 * ⚠️ ЗАСВАРЫГ ЗӨВХӨН НЭГ УДАА, ЗӨВХӨН ИЖИЛ ЛОКАЛ ЗАГВАРААР (§12).
 *    Төлбөртэй загвар руу залгах нь §3-ийн эдийн засгийн шаардлагыг
 *    зөрчинө.  Хоёр удаа дахин үүсгэх нь хариуг гурав дахин удаашруулна.
 */

export type ValidationIssue =
  | 'wrong_language'
  | 'html_entities'
  | 'escaped_markdown'
  | 'repetition'
  | 'empty';

// ⚠️ 2026-09-11: `ICON_LEAK_RE` (/\b(?:svg|img|icon)(?=[А-ЯӨҮЁ])/) ХАСАГДСАН.  Тэр нь
//    «svgНотолгоо хүрэлцэхгүй» гэсэн ганц хуулбарын гажгийг ТЕКСТ ЗАСАЖ нөхөх гэсэн
//    аюултай band-aid байв — «logo.svgФайл» гэх мэт зөв текстийг ч эвддэг, харин
//    эх шалтгаан (дүрс ба шошго DOM-д наалдсан) нь `ConfidenceChip`-ийн `aria-hidden`
//    дүрс + ил зайгаар аль хэдийн засагдсан.  Аппын ямар ч текст/clipboard-д түүхий
//    SVG тэмдэг гарахгүйг `frontend/scripts/check-ai-ui-leak.mjs` рендерээр барина;
//    анхны «svgsvg» гомдол нь NOT_REPRODUCIBLE_IN_APP (2026-09-11).

const SAFE_ENTITIES: ReadonlyArray<readonly [string, string]> = [
  ['&#x20;', ' '],
  ['&#32;', ' '],
  ['&nbsp;', ' '],
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&apos;', "'"],
];

const TECH_WORD_RE =
  /\b(?:revit|view|family|type|parameter|deadline|task|project|erp|server|api|model|ai|gpu|sheet|schedule|warning|workset|wall|door|window|floor|level|room|area|volume|element|category|bim|cad|pdf|dwg|ifc|excel|mj|m2|m3)\b/gi;

/**
 * Тээврийн гажгийг арилгана — МОНГОЛ ҮГИЙГ ХӨНДӨХГҮЙ (§13).
 *
 * ⚠️ Хэрэглэгчийн дэлгэц дээр гарсан БОДИТ алдаанууд: `&#x20;`,
 *    `\*\*`, `svgНотолгоо хүрэлцэхгүй`.  Эдгээр нь загварын биш,
 *    дамжуулалт/рендерийн гажиг.
 */
export function cleanOutput(raw: string): string {
  if (!raw) return '';
  let out = raw;
  for (const [ent, ch] of SAFE_ENTITIES) out = out.split(ent).join(ch);
  out = out.replace(/\\([*_`~[\]()#+\-.!])/g, '$1');
  out = out.replace(/\n{4,}/g, '\n\n\n');
  return out.trim();
}

/**
 * Кирилл харьцаа — НЭР ТОМЬЁОГ ХАССАНЫ дараа.
 *
 * ⚠️ «Одоогийн Revit view дээр 17 wall сонгогдсон байна» гэсэн БҮРЭН ЗӨВ
 *    монгол өгүүлбэрт латин үг гурав байна.  Тэднийг тоовол зөв хариулт
 *    «англи» гэж тэмдэглэгдээд дэмий дахин үүсгэгдэнэ.
 */
export function mongolianRatio(text: string): number {
  const stripped = text.replace(TECH_WORD_RE, ' ').replace(/https?:\/\/\S+/g, ' ');
  const letters = stripped.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1;
  const cyr = letters.filter((c) => /[Ѐ-ӿ]/.test(c)).length;
  return cyr / letters.length;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  cleaned: string;
  needsRepair: boolean;
}

export function validateAnswer(raw: string, expected: 'mn-Cyrl' | 'en'): ValidationResult {
  const cleaned = cleanOutput(raw);
  const issues: ValidationIssue[] = [];

  if (cleaned.length === 0) {
    return { ok: false, issues: ['empty'], cleaned, needsRepair: false };
  }
  if (/&#x?[0-9a-f]+;|&(?:nbsp|amp|lt|gt|quot|apos);/i.test(raw)) issues.push('html_entities');
  if (/\\[*_`~[\]]/.test(raw)) issues.push('escaped_markdown');

  let needsRepair = false;
  if (expected === 'mn-Cyrl' && mongolianRatio(cleaned) < 0.5) {
    issues.push('wrong_language');
    needsRepair = true;
  }
  return { ok: issues.length === 0, issues, cleaned, needsRepair };
}

/** ⚠️ ХОС: backend `REPAIR_PROMPT_MN`. */
export const REPAIR_PROMPT_MN =
  'Өмнөх хариултын УТГА, БАРИМТЫГ өөрчлөхгүйгээр ЖИНХЭНЭ, БАЙГАЛИЙН МОНГОЛ КИРИЛЛЭЭР дахин найруул. ' +
  'Англи хэлнээс үгчлэн орчуулсан мэт, утгагүй эсвэл албан бичгийн хэт хиймэл хэллэгийг энгийн мэргэжлийн монгол хэлээр солино. ' +
  'Бүх тоо, огноо, хувь, нормын код, нэгж, эшлэл, proper name болон хэрэгслийн үр дүнг ЯГ ХЭВЭЭР нь үлдээ. ' +
  'ШИНЭ мэдээлэл, шинэ тоо, шинэ эх сурвалж, шинэ дүгнэлт НЭМЭХГҮЙ. ' +
  'Засварлаж байгаагаа битгий тайлбарла — зөвхөн эцсийн хариултаа бич.';
