/**
 * Сарын эхний «ирцээ батал» сануулгын хуваалцсан хэсэг (2026-10-01).
 *
 * Ирц бүртгэдэг ГУРВАН газар (Ирц хуудас, хяналтын самбарын виджет, admin-tier
 * шууд бүртгэл — эхний хоёрт л код байна) ирсэн бүртгэл амжилттай болмогц
 * `announceClockIn()`-ыг дуудна; `MonthConfirmPrompt` (LayoutShell-д ГАНЦ
 * удаа суурилдаг) үүнийг сонсож цонхоо нээнэ.  Тусдаа жижиг файл — ирцийн
 * хуудас цонхны компонентыг өөрийн chunk руу чирэхгүйн тулд.
 */

/** `window` дээрх үйл явдлын нэр. */
export const CLOCKED_IN_EVENT = 'mgl:attendance-clocked-in';

/** `GET /attendance-confirmations/due`-ийн query түлхүүр — карт батлахад
 *  энэ түлхүүрийг invalidate хийснээр сануулга шууд алга болно. */
export const MONTH_CONFIRM_DUE_KEY = ['/attendance-confirmations/due'] as const;

/**
 * «Миний сарын ирц» карт руу үсрэх хаяг (`useSectionAnchor`).  Карт өгөгдмөлөөр
 * ОДООГИЙН сарыг харуулдаг тул батлах ёстой сарыг `?month=`-ээр заана.
 */
export function monthlySectionHref(month: string): string {
  return `/app/attendance?section=sec-attendance-monthly&month=${encodeURIComponent(month)}`;
}

export interface MonthConfirmDue {
  /** `reason: 'changed'` (0403) — хариулсны дараа ирц засагдсан тул дахин батлах.  Хуучин worker-т байхгүй = 'unanswered'. */
  due: { month: string; reason?: 'unanswered' | 'changed' } | null;
}

/** Ирсэн бүртгэл амжилттай болсныг мэдэгдэнэ. */
export function announceClockIn(): void {
  window.dispatchEvent(new Event(CLOCKED_IN_EVENT));
}

/**
 * 'YYYY-MM' → дэлгэцийн сарын нэр.  Монголоор зөвхөн дугаар («9» →
 * «9-р сарын …» гэж i18n мөр нь залгана), англиар «September 2026».
 */
export function monthLabel(month: string, lang: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (lang === 'en') {
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  return String(m);
}
