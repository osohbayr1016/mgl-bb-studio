/**
 * MGL AI · ИТГЭМЖЛЭГДСЭН НОРМЫН ҮР ДҮН — `TrustedNormResult` (§8, Amendment B).
 *
 * УТГА + БАРИМТ + ДҮРЭМ/ТОМЬЁО + ХУУДАС + БАТАЛГААЖИЛТ нэг объектоор явна.
 * Эшлэл, гэрээ, итгэлийн чип, template — бүгд ЭНЭ объектоос гарна; загвар
 * зөвхөн монголоор тайлбарлана.  Ээлж бүрд ЯГ НЭГ (`/context` үүсгэж гарын
 * үсэг зурна, `/messages` ТЭР объектыг л хүлээн авна — `sign.ts`).
 */
import type { Currentness } from '../currentness';

export type NormVerificationState =
  | 'verified'
  | 'needs_human_review'
  | 'superseded'
  | 'historical'
  | 'no_verified_source'
  | 'named_document_absent'
  | 'data_version_mismatch'
  | 'retrieval_failed'
  | 'search_in_progress';

export type NormAnswerKind =
  | 'classification'
  | 'calculation'
  | 'requirement'
  | 'procedure'
  | 'insufficient_context'
  | 'unverified'
  | 'no_match';

export interface NormProvenance {
  documentId: string;
  documentCode: string;
  recordId: string;
  section: string | null;
  clause: string | null;
  table: number | null;
  formula: string | null;
  page: number | null;
  verificationState: NormVerificationState;
  /** Багцын SHA-256 (Amendment A) — эшлэл аль хувилбараас гарсныг хэлнэ. */
  sourceHash: string | null;
  /** Хүнд харагдах эшлэлийн мөр — «БД 21-101-12, Хүснэгт 4, х.13». */
  labelMn: string;
}

export interface NormCalculationTrace {
  calculatorId: string;
  formulaId: string;
  inputs: Record<string, number>;
  normalizedInputs: Record<string, number>;
  steps: string[];
  result: number | boolean;
  unit: string | null;
}

export interface NormFollowup {
  id: 'requires_4_20_upgrade_check' | 'requires_spacing_check' | 'requires_human_review';
  required: boolean;
  missingInputs: string[];
  textMn: string;
  textEn: string;
}

export interface NormRange {
  category: string;
  min: number | null;
  max: number | null;
  exclusiveMin: boolean;
  exclusiveMax: boolean;
}

export interface TrustedNormResult {
  version: 'tnr-1';
  intent: 'NORMATIVE' | 'CALCULATION';
  answerKind: NormAnswerKind;
  verification: NormVerificationState;
  authoritative: boolean;
  documentId: string | null;
  documentCode: string | null;
  datasetSha256: string | null;
  currentness: Currentness | null;
  /** Явцуу нэрлэсэн баримт (байхгүй бол `null`). */
  requestedDocument: string | null;
  value: number | string | boolean | null;
  unit: string | null;
  initialCategory: string | null;
  finalCategory: string | null;
  /** Баталгаажсан мужууд (prompt-д — загвар хөршийн заагийг зохиохгүй). */
  ranges: NormRange[];
  rule: { ruleId: string; family: string; method: string | null } | null;
  calculation: NormCalculationTrace | null;
  followups: NormFollowup[];
  missingInputs: string[];
  provenance: NormProvenance[];
  inputs: Record<string, number | string | boolean>;
  assumptions: string[];
  warnings: string[];
  reason: string;
  /** Детерминист текст — template fallback + prompt-ын шийдвэрийн блок. */
  textMn: string;
  textEn: string;
  /** Гэрээнд — хариултад байж болох тоо (оролт · тогтмол · завсрын · үр дүн · хаяг). */
  allowedNumbers: number[];
  allowedCategories: string[];
}
