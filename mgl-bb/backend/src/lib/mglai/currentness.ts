/**
 * MGL AI · ЭХ СУРВАЛЖИЙН ХҮЧИН ТӨГӨЛДӨР БАЙДЛЫН ТӨЛӨВ (§16–17, Amendment D).
 *
 * ⚠️ ДОЛООН ТӨЛӨВ, ТУС ТУСДАА ҮГТЭЙ.  2026-09-11 хүртэл энэ файл ТАВАН
 *    төлөвтэй байсан ба зөвхөн `in_force` гэсэн ЯГ мөрийг «хүчин төгөлдөр»
 *    гэж үзээд, локал сангийн 10 баримтын 8-д «…шалгагдаагүй (ХУУЧИН)
 *    баримтад тулгуурласан» гэсэн нэг трейлер наадаг байв — тэдний 4 нь
 *    `current_registered_verified` гэх мэт «одоо мөрдөгдөж буй, баталгаажсан»
 *    төлөвтэй, нэг нь (СНиП) «жагсаалтад бүртгэлтэй».  «Хуучин» гэдэг үг
 *    ЗӨВХӨН HISTORICAL / SUPERSEDED төлөвт хамаарна.
 *
 * ⚠️ ГУРВАН ТЭНХЛЭГИЙГ ХОЛИХГҮЙ:
 *      (a) баримтын ХУУЛЬ ЁСНЫ төлөв          — энэ файл
 *      (b) БИЧВЭРИЙН итгэлцэл (mirror / OCR)  — `LISTED_CURRENT_NOT_SOURCE_VERIFIED`
 *      (c) БИЧЛЭГИЙН баталгаажилт (`needs_human_review` мөр) — `norm/state.ts`
 *
 * ⚠️ ТРЕЙЛЕР (хариултын төгсгөлд ЗААВАЛ байх өгүүлбэр) ЗӨВХӨН шийдвэрт
 *    БОДИТООР нөлөөлөх төлөвт: SUPERSEDED, HISTORICAL, NEEDS_HUMAN_REVIEW.
 *    Бусад нь `currentnessNote` — бүтэцтэй мета өгөгдөл / товч тэмдэглэл,
 *    инженерийн хариултыг бохирдуулахгүй.
 *
 * ⚠️ ЭНЭ ФАЙЛ БИЕ ДААСАН (импортгүй) — `ai/norm-compiler` ч энийг уншдаг
 *    тул backend-ийн бусад модулиас хамаарч болохгүй.
 */

export const CURRENTNESS = [
  'IN_FORCE_VERIFIED',
  'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED',
  'LISTED_CURRENT_NOT_SOURCE_VERIFIED',
  'NEEDS_HUMAN_REVIEW',
  'HISTORICAL',
  'SUPERSEDED',
  /** Ноорог / санал болгосон баримт — батлагдаж хүчин төгөлдөр болтол ОДООГИЙН шаардлага БИШ (NORM-INTEL v3). */
  'DRAFT',
  'UNKNOWN',
] as const;
export type Currentness = (typeof CURRENTNESS)[number];

/**
 * Багцын түүхий `effective_status` / `legal_status` / `status` мөрийг ТОГТМОЛ
 * төлөвт буулгана.  Локал сангийн БОДИТ мөрүүд (2026-09-11):
 *   in_force · unknown_requires_legal_verification ·
 *   current_status_not_checked_for_later_amendments(_or_replacement) ·
 *   listed_as_current · current_code_verified_renumbered ·
 *   current_registered_verified · current_amended_verified
 * БД 21-101-12: current_status_not_checked_for_later_amendments.
 */
export function currentnessOf(effectiveStatus: string | null | undefined): Currentness {
  const s = (effectiveStatus ?? '').trim().toLowerCase();
  if (s === '') return 'UNKNOWN';
  if (/superseded|replaced|repealed|withdrawn|хүчингүй|солигдсон|цуцлагдсан/u.test(s)) return 'SUPERSEDED';
  if (/(?:^|[^a-z])draft(?:[^a-z]|$)|ноорог|proposed|successor_draft/u.test(s)) return 'DRAFT';
  if (/historical|archiv|түүхэн|хуучин/u.test(s)) return 'HISTORICAL';
  if (s === 'in_force' || s === 'current' || s === 'current_verified' || s === 'хүчин төгөлдөр') return 'IN_FORCE_VERIFIED';
  // «Одоо мөрдөгдөж буй» гэж БАТАЛГААЖСАН боловч дараагийн нэмэлт өөрчлөлт /
  // legalinfo-ийн одоогийн бичвэртэй байтаар тулгаагүй (CLAUDE.md, 31-2x багцууд).
  if (/^current_(registered|amended|code)_verified/u.test(s) || /current_status_not_checked/u.test(s)) {
    return 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED';
  }
  // Мөрдөгдөж буй жагсаалтад БҮРТГЭЛТЭЙ, эх бичвэр нь mirror (СНиП II-97-76).
  if (/listed_as_current|listed_current/u.test(s)) return 'LISTED_CURRENT_NOT_SOURCE_VERIFIED';
  if (/legal_verification|requires_review|needs_review|unknown|шалгаагүй|тодорхойгүй/u.test(s)) return 'NEEDS_HUMAN_REVIEW';
  return 'UNKNOWN';
}

/* ── Төгсгөлийн ЗААВАЛ өгүүлбэр — зөвхөн шийдвэрт нөлөөлөх төлөвт ─────── */

export const LEGAL_REVIEW_TRAILER_MN =
  'Анхаар: энэ хариулт нь хүчин төгөлдөр байдал нь хүний хяналтаар баталгаажаагүй эх сурвалжид тулгуурласан. ' +
  'Одоо мөрдөж буй эрх бүхий байгууллага, журмыг албан ёсны эх сурвалжаас баталгаажуулах шаардлагатай — хүний хяналт хэрэгтэй.';
export const LEGAL_REVIEW_TRAILER_EN =
  'Note: this answer relies on a source whose current legal status has not been verified by human review. ' +
  'The competent authority and procedure in force today must be confirmed against an official source — human review required.';

export const SUPERSEDED_TRAILER_MN =
  'Анхаар: энэ хариулт нь СОЛИГДСОН (хүчингүй болсон) баримтад тулгуурласан. ' +
  'Одоо мөрдөж буй хувилбарын заалтыг албан ёсны эх сурвалжаас баталгаажуулах шаардлагатай.';
export const SUPERSEDED_TRAILER_EN =
  'Note: this answer relies on a SUPERSEDED (no longer in force) document. ' +
  'The clause in the currently applicable edition must be confirmed against an official source.';

export const DRAFT_TRAILER_MN =
  'Анхаар: энэ нь НООРОГ (батлагдаагүй) баримт — хүчин төгөлдөр болтол одоогийн шаардлага биш. ' +
  'Одоо мөрдөж буй батлагдсан баримтыг албан ёсны эх сурвалжаас баталгаажуулах шаардлагатай.';
export const DRAFT_TRAILER_EN =
  'Note: this is a DRAFT (not yet approved) document — it is not a current requirement until it enters into force. ' +
  'The approved document in force today must be confirmed against an official source.';

export const HISTORICAL_TRAILER_MN =
  'Анхаар: энэ нь ТҮҮХЭН баримт — тухайн үеийн шаардлагыг харуулна, одоогийн шаардлага биш. ' +
  'Одоо мөрдөж буй норм, журмыг албан ёсны эх сурвалжаас баталгаажуулах шаардлагатай.';
export const HISTORICAL_TRAILER_EN =
  'Note: this is a HISTORICAL document — it shows the requirement of its time, not the current one. ' +
  'The norm in force today must be confirmed against an official source.';

/** Хариултын ТӨГСГӨЛД заавал орох өгүүлбэр — эсвэл `null` (ихэнх төлөвт). */
export function currentnessTrailer(c: Currentness, lang: 'mn-Cyrl' | 'en'): string | null {
  switch (c) {
    case 'SUPERSEDED':
      return lang === 'en' ? SUPERSEDED_TRAILER_EN : SUPERSEDED_TRAILER_MN;
    case 'HISTORICAL':
      return lang === 'en' ? HISTORICAL_TRAILER_EN : HISTORICAL_TRAILER_MN;
    case 'DRAFT':
      return lang === 'en' ? DRAFT_TRAILER_EN : DRAFT_TRAILER_MN;
    case 'NEEDS_HUMAN_REVIEW':
    // ТӨЛӨВ ОГТ БАЙХГҮЙ (UNKNOWN) = аюулгүй тал: хууль ёсны хяналт шаардана.  Харин
    // «мөрдөгдөж буй, нэмэлт өөрчлөлт шалгаагүй» гэсэн ТОДОРХОЙ төлөв нь трейлер БИШ.
    case 'UNKNOWN':
      return lang === 'en' ? LEGAL_REVIEW_TRAILER_EN : LEGAL_REVIEW_TRAILER_MN;
    case 'IN_FORCE_VERIFIED':
    case 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED':
    case 'LISTED_CURRENT_NOT_SOURCE_VERIFIED':
      return null;
  }
}

/* ── ТОВЧ ТЭМДЭГЛЭЛ — мета өгөгдөл, хариултын бие БИШ ───────────────── */

export function currentnessNote(c: Currentness, lang: 'mn-Cyrl' | 'en'): string | null {
  const mn: Record<Currentness, string | null> = {
    IN_FORCE_VERIFIED: null,
    CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED:
      'Энэ эх сурвалжийн дараагийн нэмэлт, өөрчлөлтийн хүчин төгөлдөр байдлыг одоогийн багцад бүрэн баталгаажуулаагүй.',
    LISTED_CURRENT_NOT_SOURCE_VERIFIED:
      'Энэ баримт мөрдөгдөж буй нормын жагсаалтад бүртгэлтэй боловч эх бичвэрийг албан ёсны хувьтай байтаар тулгаж баталгаажуулаагүй.',
    NEEDS_HUMAN_REVIEW: 'Энэ эх сурвалжийн хүчин төгөлдөр байдлыг хүн шалгаж баталгаажуулах шаардлагатай.',
    HISTORICAL: 'Түүхэн баримт — тухайн үеийн шаардлагыг харуулна.',
    SUPERSEDED: 'Солигдсон (хүчингүй болсон) баримт.',
    DRAFT: 'Ноорог (батлагдаагүй) баримт — одоогийн шаардлага биш.',
    UNKNOWN: 'Эх сурвалжийн хүчин төгөлдөр байдлын төлөв тодорхойгүй — албан ёсны эх сурвалжаас баталгаажуулна уу.',
  };
  const en: Record<Currentness, string | null> = {
    IN_FORCE_VERIFIED: null,
    CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED:
      'Whether later amendments to this source are in force has not been fully verified in the current package.',
    LISTED_CURRENT_NOT_SOURCE_VERIFIED:
      'This document is listed as current, but its text has not been verified byte-for-byte against the official copy.',
    NEEDS_HUMAN_REVIEW: 'The current legal status of this source requires human verification.',
    HISTORICAL: 'Historical document — shows the requirement of its time.',
    SUPERSEDED: 'Superseded (no longer in force) document.',
    DRAFT: 'Draft (not approved) document — not a current requirement.',
    UNKNOWN: 'The legal status of this source is unknown — confirm against an official source.',
  };
  return (lang === 'en' ? en : mn)[c];
}

export function currentnessLabel(c: Currentness, lang: 'mn-Cyrl' | 'en'): string {
  const mn: Record<Currentness, string> = {
    IN_FORCE_VERIFIED: 'Хүчин төгөлдөр (баталгаажсан)',
    CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED: 'Мөрдөгдөж буй — нэмэлт өөрчлөлт шалгаагүй',
    LISTED_CURRENT_NOT_SOURCE_VERIFIED: 'Жагсаалтад бүртгэлтэй — эх бичвэр тулгаагүй',
    NEEDS_HUMAN_REVIEW: 'Хүний хяналт хэрэгтэй',
    HISTORICAL: 'Түүхэн',
    SUPERSEDED: 'Солигдсон',
    DRAFT: 'Ноорог (батлагдаагүй)',
    UNKNOWN: 'Статус тодорхойгүй',
  };
  const en: Record<Currentness, string> = {
    IN_FORCE_VERIFIED: 'In force (verified)',
    CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED: 'Current — later amendments not verified',
    LISTED_CURRENT_NOT_SOURCE_VERIFIED: 'Listed current — source not verified',
    NEEDS_HUMAN_REVIEW: 'Needs human review',
    HISTORICAL: 'Historical',
    SUPERSEDED: 'Superseded',
    DRAFT: 'Draft (not approved)',
    UNKNOWN: 'Status unknown',
  };
  return (lang === 'en' ? en : mn)[c];
}

/**
 * Хууль ёсны хяналт ЗААВАЛ шаардлагатай юу — зөвхөн шийдвэрт нөлөөлөх
 * гурван төлөвт.  Өмнө нь runtime-ийн `effective_status !== 'in_force'` гэсэн
 * мөрийн харьцуулалт энэ үүргийг гүйцэтгэж, 10-ын 8 баримтыг тугалж байв.
 */
export function legalReviewRequiredFor(c: Currentness): boolean {
  return c === 'SUPERSEDED' || c === 'HISTORICAL' || c === 'DRAFT' || c === 'NEEDS_HUMAN_REVIEW' || c === 'UNKNOWN';
}
