/**
 * Мэйл бичихэд ашиглах ҮНДСЭН фонтын тохиргоо — Arial · 11 · налуу (italic).
 *
 * Нэг эх сурвалж, хоёр хэрэглэгч:
 *  1. `RichTextEditor`-ийн бичих гадаргуу (юу харагдана — яг тэр нь илгээгдэнэ),
 *  2. илгээхийн өмнө биетийг ороодог `<div style="…">`.
 *
 * Хүлээн авагчийн клиент бидний CSS-ийг мэдэхгүй тул хэлбэржүүлэлт нь ЗААВАЛ
 * inline байх ёстой.  `sanitizeHtml` нь `<style>` ЭЛЕМЕНТ-ийг устгадаг ч
 * `style` АТРИБУТ-ыг хөнддөггүй — тиймээс энэ зам аюулгүй.
 */
import type { CSSProperties } from 'react';

export const MAIL_FONT_STACK = 'Arial, Helvetica, sans-serif';
export const MAIL_FONT_SIZE_PT = 11;
export const MAIL_FONT_STYLE = 'italic';

/** Илгээх HTML-д ордог inline CSS мөр. */
export const MAIL_BODY_CSS =
  `font-family:${MAIL_FONT_STACK};` +
  `font-size:${MAIL_FONT_SIZE_PT}pt;` +
  `font-style:${MAIL_FONT_STYLE};`;

/** Дээрхтэй ЯГ ижил утгууд, React inline-style хэлбэрээр (editor гадаргууд). */
export const MAIL_BODY_STYLE: CSSProperties = {
  fontFamily: MAIL_FONT_STACK,
  fontSize: `${MAIL_FONT_SIZE_PT}pt`,
  fontStyle: MAIL_FONT_STYLE,
};

/**
 * Editor-ийн HTML-ийг үндсэн фонтын нэг давхарга дотор ороож илгээнэ.
 * Дотор нь тодорхой заасан `<span style="…">`-ууд үүнийг дарж бичдэг тул
 * хэрэглэгчийн гараар өөрчилсөн хэсэг хэвээрээ үлдэнэ.
 */
export function wrapMailBody(html: string): string {
  const inner = html.trim();
  if (!inner) return '';
  return `<div style="${MAIL_BODY_CSS}">${inner}</div>`;
}

export const MAIL_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Arial', value: MAIL_FONT_STACK },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Calibri', value: 'Calibri, Candara, Segoe, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", Tahoma, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
];

export const MAIL_FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36];

/**
 * `getComputedStyle(...).fontFamily` нь хөтөч болгонд өөр хэлбэрээр (хашилттай,
 * хашилтгүй, өөр зайтай) буцдаг тул зөвхөн ЭХНИЙ гэр бүлийн нэрээр жишнэ.
 */
export function primaryFontName(fontFamily: string): string {
  const first = (fontFamily.split(',')[0] ?? '').trim();
  return first.replace(/^["']|["']$/g, '').toLowerCase();
}
