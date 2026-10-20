/* =============================================================
 * «Он.сар.өдөр» — баримтын огнооны нүдний НЭГ дүрэм.
 * -------------------------------------------------------------
 * Эзний хүсэлт 2026-09-25: баримт дээр огноо бүр `2026.09.25`
 * хэлбэрээр (цэгтэй) харагдана, хэрэглэгч ЗӨВХӨН цифр бичнэ —
 * цэгийг систем тавина, зураас/цэгийг гараар нэмэх боломжгүй.
 *
 * Хадгалах хэлбэр ӨӨРЧЛӨГДӨӨГҮЙ: хадгалах замууд `toIsoDate`
 * (`passportSections.ts`)-аар `YYYY-MM-DD` болгодог бөгөөд тэр нь
 * цэгтэй хэлбэрийг аль хэдийн уншдаг.  Энэ файл зөвхөн ДЭЛГЭЦ ба
 * БИЧИХ үеийн хэлбэр.
 * ============================================================= */

import { todayUB } from '@/shared/lib/time';

const FULL_SEP = /^\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s*$/;
/** Маскын өөрийн гаргадаг (бичиж байх үеийн) хэлбэрүүд. */
const MASK_SHAPED = /^(\d{0,4}|\d{4}\.\d{1,2}|\d{4}\.\d{2}\.\d{1,2})$/;

/** Хадгалсан утгыг баримт дээр харуулах хэлбэр.  ISO / `2026/9/5` /
 *  `2026.9.5` → `2026.09.05`; танихгүй чөлөөт текстийг ХЭВЭЭР буцаана
 *  (өгөгдөл алдагдахаас хуучин бичвэр харагдсан нь дээр). */
export function toDottedDate(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  const m = FULL_SEP.exec(s);
  if (!m) return s;
  return `${m[1]}.${m[2]!.padStart(2, '0')}.${m[3]!.padStart(2, '0')}`;
}

/** Бичих үеийн маск: цифрээс бусдыг хаяж, 8 цифр хүртэл `YYYY.MM.DD`
 *  болгож цэг тавина.  Буулгасан бүтэн огноог (`2026-9-5`) шууд зөв
 *  хэлбэрт оруулна; бичиж байгаа дутуу утгыг (`2026.09.2`) ДҮҮРГЭХГҮЙ. */
export function maskDottedDate(raw: string): string {
  if (!MASK_SHAPED.test(raw) && FULL_SEP.test(raw)) return toDottedDate(raw);
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
}

/** Маскласан бичвэр дэх, анхны бичвэрийн `digits` дахь цифрийн ДАРААХ
 *  байрлал — caret-ийг цэг нэмэгдсэн ч зөв цифрийн ард үлдээнэ. */
export function caretAfterDigits(masked: string, digits: number): number {
  if (digits <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i]!) && ++seen === digits) return i + 1;
  }
  return masked.length;
}

/** Өнөөдөр (Улаанбаатар) — `2026.09.25`. */
export function todayDotted(): string {
  return todayUB().replace(/-/g, '.');
}
