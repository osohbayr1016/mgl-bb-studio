/**
 * MGL AI · ИТГЭМЖЛЭГДСЭН ДҮНГИЙН ХУРААНГУЙ — `ai_messages.diag_json`-оос (Session D адаптер, §4/§5).
 *
 * ⚠️ ХОЁР ЭЗНИЙ ХООРОНДЫН ГҮҮР, ШИНЭ ҮНЭН БИШ.
 *    Producer: Session A — `/messages` нь гарын үсэгтэй `TrustedNormResult`-ийн КОД/ТӨЛӨВ хэсгийг
 *              `sanitizeDiag()`-аар `diag_json.norm` болгон хадгалдаг (`routes/mglAi.ts`):
 *              `{kind, verification, authoritative, document, records[], calculator, followups[], warnings[]}`
 *              + гэрээний оношилгоо `{mode, risk, attempts, final, buffered, violations[][], turn}` (0280).
 *    Consumer: Session B — `improvement/trustedSummary.ts TrustedResultSummaryProvider` (алдааны inbox,
 *              `ai_failure_candidates.trusted_summary_json`, `recommendRoute`).
 *    Энэ файл A-ийн diag-ийг B-ийн хураангуй руу ХӨРВҮҮЛНЭ — норматив хөдөлгүүр, validator-ийг ДАХИН
 *    ажиллуулахгүй (Amendment B: ээлжид ЯГ НЭГ үр дүн), TrustedNormResult-ийг дахин тодорхойлохгүй.
 *
 * ⚠️ B-ийн `sanitizeTrustedSummary` нь энэ гаралтыг цагаан жагсаалтаар ДАХИН ариутгана — тиймээс энд
 *    B-ийн төрлийг импортлохгүй (бүтцийн `TrustedSummaryShape`); нэмэлт талбар хаягдана, дутуу нь `undefined`.
 *
 * ⚠️ `diag_json` нь ТЕКСТ АГУУЛДАГГҮЙ (prompt, заалт, хариулт) — хураангуй ч агуулахгүй.
 */

/** B-ийн `TrustedResultFeedbackSummary`-ийн бүтцийн хос (schemaVersion 1). */
export interface TrustedSummaryShape {
  schemaVersion: 1;
  kind: 'norm_decision' | 'norm_lookup' | 'norm_refusal' | 'calculation' | 'company_data' | 'free' | 'unknown';
  authoritative?: boolean;
  sourceDocumentCode?: string;
  ruleOrFormulaId?: string;
  verificationState?: string;
  resultFingerprint?: string;
  validatorOutcome?: 'pass' | 'repaired' | 'regenerated' | 'template' | 'failed' | 'skipped';
  validatorViolations?: string[];
  noMatch?: boolean;
  citationIssue?: boolean;
}

/** A-ийн `sanitizeDiag()` гаралт — уншдаг хэсэг нь л. */
interface DiagShape {
  mode?: string | null;
  final?: string | null;
  violations?: unknown;
  norm?: {
    kind?: string | null;
    verification?: string | null;
    authoritative?: boolean;
    document?: string | null;
    records?: unknown;
    calculator?: string | null;
  } | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A-ийн validator `final` ('model' | 'repaired' | 'regenerated' | 'template') → B-ийн `validatorOutcome`. */
function outcomeOf(final: string | null | undefined, violations: string[]): TrustedSummaryShape['validatorOutcome'] | undefined {
  switch (final) {
    case 'model':
      return violations.length === 0 ? 'pass' : 'repaired';
    case 'repaired':
    case 'regenerated':
    case 'template':
      return final;
    default:
      return undefined;
  }
}

/** Гэрээний зөрчлийн кодууд — `violations` нь `string[][]` (оролдлого тус бүр). */
function flattenViolations(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const attempt of v) {
    if (!Array.isArray(attempt)) continue;
    for (const c of attempt) if (typeof c === 'string' && /^[A-Z_]{2,40}$/.test(c)) out.add(c);
  }
  return [...out].slice(0, 16);
}

/**
 * A-ийн diag → B-ийн хураангуй.  `null` = diag алга / танигдахгүй.
 *
 * `kind` дүрэм (A-ийн `answerKind` × `verification`):
 *   calculation                       → 'calculation'
 *   classification·requirement·procedure, authoritative → 'norm_decision'
 *   ижил боловч authoritative=false   → 'norm_lookup'
 *   no_match · unverified · insufficient_context, эсвэл verification ∈ {no_verified_source,
 *   named_document_absent, retrieval_failed}                                  → 'norm_refusal'
 *   norm=null: mode 'free' → 'free'; 'grounded'|'authoritative' → 'company_data'; бусад → 'unknown'
 */
export function summaryFromDiag(diagJson: string | null | undefined): TrustedSummaryShape | null {
  if (!diagJson) return null;
  let d: unknown;
  try {
    d = JSON.parse(diagJson);
  } catch {
    return null;
  }
  if (!isRecord(d)) return null;
  const diag = d as DiagShape;
  const violations = flattenViolations(diag.violations);
  const out: TrustedSummaryShape = { schemaVersion: 1, kind: 'unknown' };

  const norm = isRecord(diag.norm) ? (diag.norm as NonNullable<DiagShape['norm']>) : null;
  if (norm) {
    const kind = typeof norm.kind === 'string' ? norm.kind : '';
    const verification = typeof norm.verification === 'string' ? norm.verification : '';
    const refusalByVerification = ['no_verified_source', 'named_document_absent', 'retrieval_failed'].includes(verification);
    if (kind === 'calculation') out.kind = 'calculation';
    else if (['no_match', 'unverified', 'insufficient_context'].includes(kind) || refusalByVerification) out.kind = 'norm_refusal';
    else if (['classification', 'requirement', 'procedure'].includes(kind)) out.kind = norm.authoritative === true ? 'norm_decision' : 'norm_lookup';
    if (typeof norm.authoritative === 'boolean') out.authoritative = norm.authoritative;
    if (typeof norm.document === 'string' && norm.document.trim()) out.sourceDocumentCode = norm.document.trim().slice(0, 64);
    const record = Array.isArray(norm.records) ? norm.records.find((r): r is string => typeof r === 'string' && r.length > 0) : undefined;
    const ruleId = (typeof norm.calculator === 'string' && norm.calculator) || record;
    if (ruleId) out.ruleOrFormulaId = ruleId.slice(0, 128);
    if (verification) out.verificationState = verification.slice(0, 64);
    // «Олдсонгүй» = A-ийн ИЛ no-match төлөв л (retrieval_failed нь «хайлт унасан» — §18-ийн ялгаа хадгалагдана).
    out.noMatch = kind === 'no_match' || verification === 'no_verified_source' || verification === 'named_document_absent';
  } else {
    const mode = typeof diag.mode === 'string' ? diag.mode : '';
    out.kind = mode === 'free' ? 'free' : mode === 'grounded' || mode === 'authoritative' ? 'company_data' : mode === 'refusal' ? 'norm_refusal' : 'unknown';
    if (mode === 'refusal') out.noMatch = true;
  }

  const outcome = outcomeOf(diag.final, violations);
  if (outcome) out.validatorOutcome = outcome;
  if (violations.length > 0) out.validatorViolations = violations;
  if (violations.some((c) => c === 'FAKE_CITATION' || c === 'CITATION_MISSING')) out.citationIssue = true;
  return out;
}

/** D1-ийн хамгийн нарийн хэлбэр — `c.env.DB` энд таарна; тест нь хуурамч объект өгнө. */
export interface DiagStore {
  prepare(sql: string): { bind(...args: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null> } };
}

/**
 * B-ийн `TrustedResultSummaryProvider`-ийн бодит хэрэгжүүлэлт — `ai_messages.diag_json`-оос.
 * Дуудагч (B `routes/mglAiFleet.ts` failures sync) `sanitizeTrustedSummary()`-оор ариутгана.
 */
export function diagTrustedSummaryProvider(db: DiagStore): {
  summaryForMessage(convUid: string, msgUid: string): Promise<TrustedSummaryShape | null>;
} {
  return {
    async summaryForMessage(convUid, msgUid) {
      const row = await db
        .prepare('SELECT diag_json FROM ai_messages WHERE conv_uid = ? AND msg_uid = ? LIMIT 1')
        .bind(convUid, msgUid)
        .first<{ diag_json: string | null }>();
      return summaryFromDiag(row?.diag_json ?? null);
    },
  };
}
