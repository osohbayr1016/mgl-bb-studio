/**
 * Багцын түүхий хууль ёсны төлөв → ТОГТМОЛ төлөв — хөрвүүлэгчийн хувилбар.
 *
 * ⚠️ backend/src/lib/mglai/currentness.ts `currentnessOf`-ын ХОС.  Хоёр
 *    багц (ai нь ESM, backend нь CommonJS-тэй Worker) нэг файл хуваалцаж
 *    чадахгүй тул ЛОГИК давхардсан; зөрүүг `backend/src/lib/mglai/norm/
 *    registry.test.ts` барина — бүртгэлийн баримт бүрд
 *    `doc.currentness === currentnessOf(doc.legalStatusRaw)` гэж тулгана.
 *    Нэгийг өөрчилбөл нөгөөг ч өөрчил.
 */
import type { CurrentnessState } from './model.ts';

export function currentnessOfRaw(effectiveStatus: string | null | undefined): CurrentnessState {
  const s = (effectiveStatus ?? '').trim().toLowerCase();
  if (s === '') return 'UNKNOWN';
  if (/superseded|replaced|repealed|withdrawn|хүчингүй|солигдсон|цуцлагдсан/u.test(s)) return 'SUPERSEDED';
  if (/(?:^|[^a-z])draft(?:[^a-z]|$)|ноорог|proposed|successor_draft/u.test(s)) return 'DRAFT';
  if (/historical|archiv|түүхэн|хуучин/u.test(s)) return 'HISTORICAL';
  if (s === 'in_force' || s === 'current' || s === 'current_verified' || s === 'хүчин төгөлдөр') return 'IN_FORCE_VERIFIED';
  if (/^current_(registered|amended|code)_verified/u.test(s) || /current_status_not_checked/u.test(s)) {
    return 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED';
  }
  if (/listed_as_current|listed_current/u.test(s)) return 'LISTED_CURRENT_NOT_SOURCE_VERIFIED';
  if (/legal_verification|requires_review|needs_review|unknown|шалгаагүй|тодорхойгүй/u.test(s)) return 'NEEDS_HUMAN_REVIEW';
  return 'UNKNOWN';
}
