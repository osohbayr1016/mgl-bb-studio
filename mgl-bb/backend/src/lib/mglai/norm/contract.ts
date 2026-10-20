/**
 * TrustedNormResult → ХАРИУЛТЫН ГЭРЭЭ (P0-11).  Хөтчийн `validator.ts` үүсгэлтийн
 * ДАРАА тулгана.  ГУРВАН ХАТУУ ИНВАРИАНТ (Amendment «gold property»):
 *
 *   provenance.documentCode == эцсийн эшлэлийн баримт      → FOREIGN_CITATION
 *   calculation.result      == харуулсан үр дүн              → RESULT_MISSING / NUMBER_CHANGED
 *   finalCategory/value     == харуулсан ангилал             → CATEGORY_CHANGED
 *
 * Зөрчвөл засахгүй, таамаглахгүй — ДЕТЕРМИНИСТ TEMPLATE (`textMn`).
 *
 * ⚠️ ГЭРЭЭГ ХӨТӨЧ ЗОХИОДОГГҮЙ — энд л бичигдэнэ (хос тогтмол байхгүй).
 */
import type { TrustedNormResult } from './types';
import { canon } from './state';
import { currentnessNote, currentnessTrailer } from '../currentness';
import { fold } from './text';

export type Lang = 'mn-Cyrl' | 'en';

/** Гэрээний нормын блок — `TrustedContract.norm` (frontend `validator.ts`-ийн хос). */
export interface NormContractBlock {
  verification: TrustedNormResult['verification'];
  authoritative: boolean;
  answerKind: TrustedNormResult['answerKind'];
  document: string | null;
  /** Fold-той харьцуулах хувилбарууд — «BD 21-101-12», «21-101-12». */
  documentAliases: string[];
  resultValue: number | boolean | string | null;
  resultUnit: string | null;
  initialCategory: string | null;
  finalCategory: string | null;
  /** Хариултад ЗААВАЛ байх follow-up өгүүлбэр (алга бол НЭМНЭ). */
  requiredFollowups: { key: string; sentence: string }[];
  /** Тооны шалгалтаас ХАСАХ хаяг («4.20», «Хүснэгт 4», «томьёо 7»). */
  maskTokens: string[];
  /** Хүнд харагдах эшлэлийн мөрүүд — provenance-оос, загварын текстээс биш. */
  citationLabels: string[];
  /** Хүчин төгөлдөр байдлын ТОВЧ тэмдэглэл — мета (хариултын бие биш). */
  currentnessNote: string | null;
  template: string;
}

export interface NormContractPieces {
  answerMode: 'authoritative' | 'grounded' | 'refusal';
  risk: 'high';
  requiredSentence: string | null;
  trailerText: string | null;
  allowedNumbers: number[];
  allowedCategories: string[];
  requiredCitations: string[];
  noMatch: boolean;
  template: string;
  norm: NormContractBlock;
  /**
   * Хүний хяналт/татгалзлын ээлжид ЗАГВАРЫН баттай мэдэгдэл ХОРИОТОЙ («шаардлага хангаж байна»,
   * PASS/FAIL).  Хөтчийн validator үгүйсгэлтэй өгүүлбэрийг («…гэж хэлж болохгүй») ба серверийн
   * канон өгүүлбэрийг алгасаж, зөвхөн баттай мэдэгдлийг хасна (GOLD B10, 2026-09-14 хэмжсэн:
   * загвар «Үгүй…» гэж эхлээд төгсгөлд нь «зөвхөн «шаардлага хангаж байна» гэсэн баттай хариулт
   * үлдэнэ» гэж зөрчилдөж байв).
   */
  forbiddenPhrases: string[];
  /** Хуучин гэрээний kind — UI/оношилгоо. */
  legacyKind: 'norm_trusted' | 'norm_review' | 'norm_refusal' | 'norm_unavailable';
  reason: string;
}

/** Хүний хяналтын ээлжид ЗАГВАРЫН баттай нийцлийн мэдэгдэл — хориотой хэллэг (fold-оор тулгана). */
export const PASS_FAIL_ASSERTIONS: readonly string[] = ['шаардлага хангаж байна', 'шаардлагыг хангаж байна', 'шаардлага хангана', 'шаардлагыг хангана', 'PASS', 'FAIL'];

function aliasesOf(code: string | null, extra: readonly string[] = []): string[] {
  if (code === null) return [];
  const out = new Set<string>([code]);
  for (const a of extra) out.add(a);
  const digits = /(\d{2}-\d{2,3}-\d{2})/.exec(code)?.[1];
  if (digits) out.add(digits);
  return [...out];
}

function maskTokens(r: TrustedNormResult): string[] {
  const out = new Set<string>();
  for (const p of r.provenance) {
    if (p.clause) out.add(p.clause);
    if (p.section && /^\d/.test(p.section)) out.add(p.section);
    if (p.table !== null) out.add(`Хүснэгт ${p.table}`);
    if (p.formula && /^\d+$/.test(p.formula)) out.add(`томьёо ${p.formula}`);
    if (p.page !== null) out.add(`х.${p.page}`);
  }
  return [...out];
}

export function buildNormContract(r: TrustedNormResult, lang: Lang, codeAliases: readonly string[] = []): NormContractPieces {
  const text = lang === 'en' && r.textEn ? r.textEn : r.textMn;
  const base: Omit<NormContractBlock, 'template'> = {
    verification: r.verification,
    authoritative: r.authoritative,
    answerKind: r.answerKind,
    document: r.documentCode,
    documentAliases: aliasesOf(r.documentCode, codeAliases),
    resultValue: r.answerKind === 'calculation' ? (r.value as number | boolean | string | null) : null,
    resultUnit: r.answerKind === 'calculation' ? r.unit : null,
    initialCategory: r.initialCategory,
    finalCategory: r.finalCategory,
    requiredFollowups: r.followups
      .filter((f) => f.required)
      .map((f) => ({ key: f.id === 'requires_4_20_upgrade_check' ? '4.20' : f.id === 'requires_spacing_check' ? 'зай' : 'хүний хяналт', sentence: lang === 'en' ? f.textEn : f.textMn })),
    maskTokens: maskTokens(r),
    citationLabels: r.provenance.map((p) => p.labelMn),
    currentnessNote: r.currentness ? currentnessNote(r.currentness, lang) : null,
  };
  const trailer = r.currentness ? currentnessTrailer(r.currentness, lang) : null;

  // ── Эрх бүхий (verified) ───────────────────────────────────────────
  if (r.verification === 'verified' && (r.answerKind === 'classification' || r.answerKind === 'calculation' || r.answerKind === 'requirement')) {
    return {
      answerMode: 'authoritative',
      risk: 'high',
      requiredSentence: null,
      trailerText: trailer,
      allowedNumbers: r.allowedNumbers,
      allowedCategories: r.allowedCategories,
      requiredCitations: r.documentCode ? [r.documentCode] : [],
      noMatch: false,
      forbiddenPhrases: [],
      template: text,
      norm: { ...base, template: text },
      legacyKind: 'norm_trusted',
      reason: `эрх бүхий ${r.answerKind} — ${r.reason}`,
    };
  }

  // ── Оролт дутуу (verified дүрэм, гэвч тооцоолж чадахгүй) ──────────
  if (r.verification === 'verified' && r.answerKind === 'insufficient_context') {
    return {
      answerMode: 'authoritative',
      risk: 'high',
      requiredSentence: null,
      trailerText: trailer,
      allowedNumbers: r.allowedNumbers,
      allowedCategories: r.allowedCategories,
      requiredCitations: r.documentCode ? [r.documentCode] : [],
      noMatch: false,
      forbiddenPhrases: [],
      template: text,
      norm: { ...base, template: text },
      legacyKind: 'norm_trusted',
      reason: `оролт дутуу — ${r.missingInputs.join(', ')}`,
    };
  }

  // ── Хүний хяналт / хилийн зөрчил / хувилбарын зөрүү ───────────────
  if (r.verification === 'needs_human_review' || r.verification === 'data_version_mismatch' || r.answerKind === 'unverified') {
    const key = r.verification === 'data_version_mismatch' ? 'data_version_mismatch' : r.warnings.includes('source_boundary_conflict') ? 'source_boundary_conflict' : r.answerKind === 'procedure' ? 'policy_needs_human_review' : 'needs_human_review';
    const sentence = canon(key, lang);
    return {
      answerMode: 'refusal',
      risk: 'high',
      requiredSentence: sentence,
      trailerText: trailer,
      allowedNumbers: r.allowedNumbers,
      allowedCategories: [],
      // Хилийн зөрчил/хүний хяналттай БИЧЛЭГИЙН баримтыг хариултад нэрлэнэ — хэрэглэгч аль
      // эх сурвалжийг хүн шалгахыг мэдэх ёстой (provenance байвал; бодлогын мета асуултад алга).
      requiredCitations: r.documentCode && r.provenance.length > 0 ? [r.documentCode] : [],
      noMatch: false,
      template: text.includes(sentence) ? text : `${sentence}\n\n${text}`,
      norm: { ...base, finalCategory: null, template: text.includes(sentence) ? text : `${sentence}\n\n${text}` },
      forbiddenPhrases: [...PASS_FAIL_ASSERTIONS],
      legacyKind: 'norm_review',
      reason: `${r.verification} — PASS/FAIL хориотой`,
    };
  }

  // ── Нэрлэсэн баримт байхгүй / эх сурвалж алга / хайлт унасан ─────
  const key = r.verification === 'named_document_absent' ? 'named_document_absent' : r.verification === 'retrieval_failed' ? 'retrieval_failed' : 'no_verified_source';
  const sentence = canon(key, lang);
  return {
    answerMode: 'refusal',
    risk: 'high',
    requiredSentence: sentence,
    trailerText: null,
    allowedNumbers: [],
    allowedCategories: [],
    // Татгалзалд ч баттай нийцлийн мэдэгдэл хориотой (эх сурвалжгүй атлаа «хангана» гэхгүй).
    forbiddenPhrases: [...PASS_FAIL_ASSERTIONS],
    requiredCitations: [],
    noMatch: r.verification !== 'retrieval_failed',
    template: text.includes(sentence) ? text : sentence,
    norm: { ...base, template: text.includes(sentence) ? text : sentence },
    legacyKind: r.verification === 'retrieval_failed' ? 'norm_unavailable' : 'norm_refusal',
    reason: r.verification,
  };
}

/** Эцсийн хариултын баримтын код provenance-д байгаа эсэх — сервер талын хос шалгалт. */
export function citationBelongsToProvenance(code: string, norm: NormContractBlock): boolean {
  const f = fold(code);
  return norm.documentAliases.some((a) => fold(a) === f) || (norm.document !== null && fold(norm.document) === f);
}
