/**
 * Шинэ төслийн нэрийг угсарна — «MGL-260925-ABC-AZ».
 *
 * Эзний шийдвэр (2026-09-25): үүсгэж буй хүн ЗӨВХӨН суурь нэрийг («ABC»)
 * бичнэ.  Код (`<угтвар>-<yymmdd>`, огноо = үүсгэсэн өдөр, Улаанбаатарын
 * цагаар) нь автоматаар урдаа, сонгосон ангилал («AZ», «ZA» …) нь ардаа
 * залгагдана.
 *
 * Хэрэглэгч хуучин бүтэн нэр («MGL-251006_EVERGREEN_ZA») буулгасан ч код,
 * ангиллын залгавар ДАВХАРДАХГҮЙ — хоёуланг нь суурь нэрээс хасна.
 */
import { brand } from '@/shared/config/brand';
import { PROJECT_CATEGORY_CODES, type ProjectCategory } from '@/shared/lib/project-categories';
import { todayUB } from '@/shared/lib/time';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** «MGL-260925» (угтвар хоосон тохиргоотой компанид зөвхөн «260925»). */
export function projectDateCode(isoDate: string = todayUB()): string {
  const yymmdd = isoDate.replace(/-/g, '').slice(2, 8);
  const prefix = brand().projectCodePrefix;
  return prefix ? `${prefix}-${yymmdd}` : yymmdd;
}

/** Суурь нэрээс буулгасан код ба ангиллын залгаврыг хасаж, захын
 *  тусгаарлагчийг цэвэрлэнэ. */
export function cleanProjectBaseName(raw: string): string {
  let s = raw.trim();
  const prefix = brand().projectCodePrefix;
  if (prefix) s = s.replace(new RegExp(`^${escapeRe(prefix)}[-_\\s]*\\d{6}(?=[-_\\s]|$)`, 'i'), '');
  s = s.replace(new RegExp(`[-_\\s](${PROJECT_CATEGORY_CODES.join('|')})$`, 'i'), '');
  return s.replace(/^[\s\-_–—]+|[\s\-_–—]+$/g, '');
}

/** Хэрэглэгчийн засаж болох кодын захын зай, тусгаарлагчийг хасна
 *  («MGL-251006-» → «MGL-251006») — эс бөгөөс нэрэнд «--» давхардана. */
export function cleanProjectCode(raw: string): string {
  return raw.trim().replace(/^[\s\-_–—]+|[\s\-_–—]+$/g, '');
}

/** Бүтэн нэр: `<код>-<суурь нэр>-<ангилал>`.  Суурь нэр хоосон бол ''.
 *
 *  Код нь өгөгдмөлөөр өнөөдрийн огноо, гэхдээ үүсгэж буй хүн засаж болно
 *  (эзний хүсэлт 2026-09-28) — ж: өмнөх ажлын ЗА төслийг анхны ажлынх нь
 *  «MGL-251006» кодоор нэрлэх. */
export function composeProjectName(
  base: string,
  category: ProjectCategory | null,
  code: string = projectDateCode(),
): string {
  const clean = cleanProjectBaseName(base);
  if (!clean) return '';
  return [cleanProjectCode(code), clean, category].filter(Boolean).join('-');
}
