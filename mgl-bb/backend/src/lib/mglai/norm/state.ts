/**
 * Баталгаажилтын ТӨЛӨВИЙН машин (§17, P0-9) — төлөв бүрд ӨӨР канон өгүүлбэр.
 *
 *   verified                — баталгаажсан бичлэг + гүйцэтгэгдсэн → эрх бүхий
 *   needs_human_review      — бичлэг байгаа ч хүн шалгаагүй / хилийн зөрчил → PASS/FAIL ХОРИОТОЙ
 *   superseded / historical — баримтын хууль ёсны төлөв
 *   no_verified_source      — баталгаажсан локал эх сурвалж олдсонгүй («норм ийм зүйл заадаггүй» гэж ХЭЛЭХГҮЙ)
 *   named_document_absent   — нэрлэсэн баримт санд байхгүй
 *   data_version_mismatch   — локал сан ба бүртгэлийн багцын хувилбар зөрөв (Amendment A)
 *   retrieval_failed        — хайлт АМЖСАНГҮЙ (offline/timeout/алдаа) — «олдсонгүй»-тэй ХОЛИХГҮЙ
 *   search_in_progress      — явц
 */
import type { NormVerificationState } from './types';
import type { Currentness } from '../currentness';

export const CANON = {
  needs_human_review: {
    mn: 'Энэ эх сурвалжийн тухайн бичлэг хүний хяналт шаардлагатай тул «шаардлага хангаж байна/хангахгүй байна» гэсэн баттай норматив шийдвэр гаргах боломжгүй. Баталгаажсан эх сурвалж эсвэл хүний хяналт шаардлагатай.',
    en: 'This source record requires human review, so a confident normative pass/fail decision cannot be made from it. A verified source or human review is required.',
  },
  source_boundary_conflict: {
    mn: 'Яг энэ хилийн утгыг одоогийн жигдэрсэн багцаас баттай ангилах боломжгүй: гүйцэтгэх бичлэг ба эх сурвалжийн бичвэр энэ утга дээр санал нийлэхгүй байна. Эрх бүхий эх хуудсыг хүн шалгах шаардлагатай.',
    en: 'This exact boundary value cannot be classified confidently from the current normalized dataset: the executable record and the source text disagree at this value. The authoritative page must be reviewed by a person.',
  },
  no_verified_source: {
    mn: 'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй.',
    en: 'No verified source was found for this requirement.',
  },
  named_document_absent: {
    mn: 'Нэрлэсэн баримт энэ системийн баталгаажсан нормын санд одоогоор байхгүй тул өөр баримтаас хариулсангүй.',
    en: 'The named document is not in the verified local knowledge base, so no other document was used to answer.',
  },
  data_version_mismatch: {
    mn: 'Локал нормын сан ба серверийн бүртгэл энэ баримтын ӨӨР хувилбарыг агуулж байгаа тул эрх бүхий хариу өгөх боломжгүй. Локал санг шинэчилнэ үү (npm run ai:ingest:norm).',
    en: 'The local knowledge base and the server registry hold DIFFERENT versions of this document, so an authoritative answer cannot be given. Update the local knowledge base (npm run ai:ingest:norm).',
  },
  retrieval_failed: {
    mn: 'Нормын хайлт амжилтгүй болсон (локал хөдөлгүүр хүрэхгүй эсвэл хугацаа хэтэрсэн) тул эх сурвалж байгаа эсэхийг хэлэх боломжгүй.',
    en: 'The normative search failed (local engine unreachable or timed out), so it cannot be said whether a source exists.',
  },
  policy_needs_human_review: {
    mn: 'Үгүй. needs_human_review гэж тэмдэглэгдсэн бичлэг хайлтад харагдаж, эх сурвалжийн лавлагаа болж болно, гэвч хүний эсвэл эрх бүхий баталгаажуулалт хийгдтэл түүнд үндэслэн «шаардлага хангаж байна» гэсэн баттай норматив шийдвэр гаргаж болохгүй.',
    en: 'No. A record marked needs_human_review may be shown and searchable, but it cannot independently support a confident "compliant" normative decision until human or authoritative verification.',
  },
} as const;

export function canon(key: keyof typeof CANON, lang: 'mn-Cyrl' | 'en'): string {
  return lang === 'en' ? CANON[key].en : CANON[key].mn;
}

/** Баримтын хууль ёсны төлөв → баталгаажилтын төлөвийн ХАЛХАВЧ (солигдсон/түүхэн бол эрх бүхий БИШ). */
export function currentnessGate(c: Currentness | null): NormVerificationState | null {
  if (c === 'SUPERSEDED') return 'superseded';
  if (c === 'HISTORICAL') return 'historical';
  return null;
}

export function isAuthoritative(v: NormVerificationState): boolean {
  return v === 'verified';
}
