/**
 * MGL AI · ИТГЭМЖЛЭГДСЭН ДҮНГИЙН САНАЛ ХҮСЭЛТИЙН ХУРААНГУЙ — АДАПТЕР (Session B P0-4).
 *
 * ⚠️ ЭНЭ НЬ TrustedNormResult БИШ, ТҮҮНИЙ ХОЁР ДАХЬ ХУВИЛБАР Ч БИШ.  Норматив
 *    хөдөлгүүр, тооцоолуур, эшлэл, хүчин төгөлдөр байдал — Session A-ийн эзэмшил.
 *    Энд зөвхөн санал хүсэлтийн inbox-д хэрэгтэй НАРИЙН, АРИУТГАСАН хураангуй:
 *    «ямар төрлийн дүн байв, эрх мэдэлтэй байсан уу, аль баримт/дүрэм, баталгаажилтын
 *    төлөв, дүнгийн хурууны хээ, validator юу гэсэн».  Prompt, заалтын бүтэн текст,
 *    компанийн өгөгдөл ОРОХГҮЙ.
 *
 * ⚠️ ХОЛБОЛТ = SESSION D-ИЙН ХАМААРАЛ.  `TrustedResultSummaryProvider`-ийн бодит
 *    хэрэгжүүлэлт нь Session A-ийн эцсийн гэрээ (`trustedFacts.ts` / `TrustedNormResult`,
 *    `ai_messages.diag_json`) тогтсоны ДАРАА `routes/mglAi.ts` эсвэл `/messages`-ийн
 *    diag-аас уншина.  Өнөөдөр `NULL_PROVIDER` — inbox нь `trusted_summary_json = NULL`
 *    хадгалж, чиглүүлэлт нь reason-оор л явна (recommendRoute-ийн fallback).
 *
 * ⚠️ `schemaVersion` нь ЭНЭ хураангуйн схем — Session A-ийн дотоод хувилбартай
 *    холбоогүй.  Талбар нэмэхэд өснө; `sanitizeTrustedSummary` мэдэхгүй хувилбарыг
 *    ХАЯНА (хуучин мөр хэвээр уншигдана, шинэ талбар алгасагдана).
 */

export const TRUSTED_SUMMARY_SCHEMA_VERSION = 1;

export const TRUSTED_SUMMARY_KINDS = ['norm_decision', 'norm_lookup', 'norm_refusal', 'calculation', 'company_data', 'free', 'unknown'] as const;
export type TrustedSummaryKind = (typeof TRUSTED_SUMMARY_KINDS)[number];

export const VALIDATOR_OUTCOMES = ['pass', 'repaired', 'regenerated', 'template', 'failed', 'skipped'] as const;
export type ValidatorOutcome = (typeof VALIDATOR_OUTCOMES)[number];

export interface TrustedResultFeedbackSummary {
  schemaVersion: number;
  kind: TrustedSummaryKind;
  /** Дүн нь эрх мэдэлтэй (детерминист блок/тооцоолуур) байсан уу. */
  authoritative?: boolean;
  /** Эх баримтын код (`БНбД 21-04-05`) — текст биш, код л. */
  sourceDocumentCode?: string;
  /** Дүрэм/томьёоны id (`…:clause:3.9:numeric`). */
  ruleOrFormulaId?: string;
  /** Session A-ийн баталгаажилтын төлөвийн мөр — тайлагдахгүй, дамжина. */
  verificationState?: string;
  /** Дүнгийн хурууны хээ (Session A-ийн resultFingerprint эсвэл sha256 эхний 16). */
  resultFingerprint?: string;
  validatorOutcome?: ValidatorOutcome;
  /** Validator-ийн зөрчлийн кодууд (A–I) — текст биш. */
  validatorViolations?: string[];
  /** Хайлт юу ч олоогүй (RETRIEVAL_NO_MATCH). */
  noMatch?: boolean;
  /** Эшлэл хаягдсан/зохиомол байсан. */
  citationIssue?: boolean;
}

const KEY_LIMIT = 128;
function str(v: unknown, max = KEY_LIMIT): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Дурын оролтыг ЦАГААН ЖАГСААЛТААР хураангуй болгоно.  Мэдэгдэхгүй түлхүүр,
 * урт текст, объект утга — ХАЯГДАНА.  Хувилбар таарахгүй бол `null`.
 */
export function sanitizeTrustedSummary(raw: unknown): TrustedResultFeedbackSummary | null {
  if (!isRecord(raw)) return null;
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null;
  if (v === null || v > TRUSTED_SUMMARY_SCHEMA_VERSION || v < 1) return null;
  const kind = (TRUSTED_SUMMARY_KINDS as readonly string[]).includes(raw.kind as string) ? (raw.kind as TrustedSummaryKind) : 'unknown';
  const out: TrustedResultFeedbackSummary = { schemaVersion: TRUSTED_SUMMARY_SCHEMA_VERSION, kind };
  if (typeof raw.authoritative === 'boolean') out.authoritative = raw.authoritative;
  const doc = str(raw.sourceDocumentCode, 64);
  if (doc) out.sourceDocumentCode = doc;
  const rule = str(raw.ruleOrFormulaId, KEY_LIMIT);
  if (rule) out.ruleOrFormulaId = rule;
  const vs = str(raw.verificationState, 64);
  if (vs) out.verificationState = vs;
  const fp = str(raw.resultFingerprint, 64);
  if (fp) out.resultFingerprint = fp;
  if ((VALIDATOR_OUTCOMES as readonly string[]).includes(raw.validatorOutcome as string)) out.validatorOutcome = raw.validatorOutcome as ValidatorOutcome;
  if (Array.isArray(raw.validatorViolations)) {
    const codes = raw.validatorViolations.filter((x): x is string => typeof x === 'string' && /^[A-Z_]{2,40}$/.test(x)).slice(0, 16);
    if (codes.length > 0) out.validatorViolations = codes;
  }
  if (typeof raw.noMatch === 'boolean') out.noMatch = raw.noMatch;
  if (typeof raw.citationIssue === 'boolean') out.citationIssue = raw.citationIssue;
  return out;
}

/**
 * Хураангуйг хаанаас авах — SESSION D холбоно.
 * Өнөөдөр `NULL_PROVIDER`; Session A-ийн `diag_json`/TrustedNormResult гэрээ тогтмогц
 * `msgUid` → summary хэрэгжүүлэлт `routes/mglAi.ts`-ийн ГАДНА (энэ модульд) бичигдэнэ.
 */
export interface TrustedResultSummaryProvider {
  summaryForMessage(convUid: string, msgUid: string): Promise<TrustedResultFeedbackSummary | null>;
}

export const NULL_TRUSTED_SUMMARY_PROVIDER: TrustedResultSummaryProvider = {
  async summaryForMessage() {
    return null;
  },
};

/** `recommendRoute`-ийн `TrustedSummaryLike` руу хөрвүүлнэ — чиглүүлэлт хураангуйгаас. */
export function toRoutingSignals(s: TrustedResultFeedbackSummary | null): {
  contract_violations?: string[];
  no_match?: boolean;
  citation_issue?: boolean;
  calculation_used?: boolean;
} | null {
  if (!s) return null;
  return {
    contract_violations: s.validatorViolations ?? (s.validatorOutcome && s.validatorOutcome !== 'pass' && s.validatorOutcome !== 'skipped' ? [s.validatorOutcome.toUpperCase()] : undefined),
    no_match: s.noMatch,
    citation_issue: s.citationIssue,
    calculation_used: s.kind === 'calculation' || (s.kind === 'norm_decision' && s.authoritative === true),
  };
}
