/**
 * MGL AI · АЛДААНЫ НЭР ДЭВШИГЧ — inbox, чиглүүлэлт, регресс/SFT (Session B §19–§24).
 *
 *   ажилтны 👎 (ai_feedback) → алдааны нэр дэвшигч (NEW) → админ ангилна →
 *   APPROVED_REGRESSION | APPROVED_SFT | RESOLVED | REJECTED
 *
 * ⚠️ ХАТУУ ИНВАРИАНТ (§19): ажилтны яриа ≠ сургалтын өгөгдөл.  Энэ файлд
 *    `NEW → APPROVED_SFT` гэсэн ШУУД шилжилт ЗОРИУД БАЙХГҮЙ; SFT нэр дэвшигч
 *    нь зөвхөн `REDACTED` төлөвтэй, админ баталсан мөрөөс үүснэ
 *    (`sftCandidateFrom` шалгана).  Тест нь энэ хоёрыг барина.
 *
 * ⚠️ ЧИГЛҮҮЛЭЛТ НЬ ЗӨВЛӨМЖ (§22), ШИЙДВЭР БИШ.  `recommendRoute` нь
 *    «хаана засах нь зөв» гэж САНАЛ болгоно; норматив үнэн (эх сурвалж зөв
 *    эсэх, тооцоолуур зөв эсэх) Session A-ийн эзэмшил бөгөөд энд
 *    тодорхойлогдохгүй — зөвхөн `trusted_summary`-д ирсэн ТУГИЙГ уншина.
 *
 * ⚠️ ХУВИЛБАРЫН ТАМГА ЗААВАЛ (§20): ижил асуулт өөр релиз дээр өөр
 *    ажиллана.  `versions_json`-д app/model/knowledge/normRegistry/runtime +
 *    prompt/tool схемийн хувилбар.
 */
import { redact } from '../redaction';

export const FAILURE_REASONS = [
  'WRONG_ANSWER',
  'WRONG_SOURCE',
  'WRONG_CALCULATION',
  'MISUNDERSTOOD',
  'INCOMPLETE',
  'BAD_MONGOLIAN',
  'TOO_SLOW',
  'UNSAFE_ACTION',
  'OTHER',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export function isFailureReason(v: unknown): v is FailureReason {
  return typeof v === 'string' && (FAILURE_REASONS as readonly string[]).includes(v);
}

export const FAILURE_STATUSES = [
  'NEW',
  'TRIAGED',
  'DATA_ISSUE',
  'RETRIEVAL_ISSUE',
  'CALCULATION_ISSUE',
  'MODEL_BEHAVIOR',
  'CITATION_ISSUE',
  'UI_ISSUE',
  'APPROVED_REGRESSION',
  'APPROVED_SFT',
  'RESOLVED',
  'REJECTED',
] as const;
export type FailureStatus = (typeof FAILURE_STATUSES)[number];

export function isFailureStatus(v: unknown): v is FailureStatus {
  return typeof v === 'string' && (FAILURE_STATUSES as readonly string[]).includes(v);
}

const CLASSIFIED: readonly FailureStatus[] = [
  'DATA_ISSUE',
  'RETRIEVAL_ISSUE',
  'CALCULATION_ISSUE',
  'MODEL_BEHAVIOR',
  'CITATION_ISSUE',
  'UI_ISSUE',
];

/**
 * Зөвшөөрөгдсөн шилжилт.
 * ⚠️ `NEW`/`TRIAGED` → `APPROVED_SFT` БАЙХГҮЙ: эхлээд АНГИЛНА, дараа нь батална.
 */
const TRANSITIONS: Record<FailureStatus, readonly FailureStatus[]> = {
  NEW: ['TRIAGED', 'REJECTED', ...CLASSIFIED],
  TRIAGED: [...CLASSIFIED, 'REJECTED', 'RESOLVED'],
  DATA_ISSUE: ['APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  RETRIEVAL_ISSUE: ['APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  CALCULATION_ISSUE: ['APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  CITATION_ISSUE: ['APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  MODEL_BEHAVIOR: ['APPROVED_SFT', 'APPROVED_REGRESSION', 'RESOLVED', 'REJECTED', 'TRIAGED'],
  UI_ISSUE: ['RESOLVED', 'REJECTED', 'TRIAGED'],
  APPROVED_REGRESSION: ['RESOLVED', 'APPROVED_SFT'],
  APPROVED_SFT: ['RESOLVED'],
  RESOLVED: [],
  REJECTED: ['NEW'],
};

export function canTransitionFailure(from: FailureStatus, to: FailureStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/* ================================================================== */
/*  FEEDBACK → НЭР ДЭВШИГЧ                                             */
/* ================================================================== */

/** 0269-ийн 12 шалтгаан → §20-ийн 9 (хамгийн хүчтэйг сонгоно). */
const REASON_MAP: Record<string, FailureReason> = {
  wrong_regulation: 'WRONG_SOURCE',
  hallucinated: 'WRONG_ANSWER',
  incorrect: 'WRONG_ANSWER',
  outdated: 'WRONG_SOURCE',
  wrong_company_context: 'WRONG_ANSWER',
  wrong_revit_context: 'WRONG_ANSWER',
  misunderstood: 'MISUNDERSTOOD',
  too_short: 'INCOMPLETE',
  too_long: 'BAD_MONGOLIAN',
  slow: 'TOO_SLOW',
  unsafe_action: 'UNSAFE_ACTION',
  other: 'OTHER',
};
const REASON_PRIORITY: readonly FailureReason[] = [
  'UNSAFE_ACTION',
  'WRONG_CALCULATION',
  'WRONG_SOURCE',
  'WRONG_ANSWER',
  'MISUNDERSTOOD',
  'INCOMPLETE',
  'BAD_MONGOLIAN',
  'TOO_SLOW',
  'OTHER',
];

export function mapFeedbackReasons(codes: readonly string[], extra: readonly string[] = []): FailureReason {
  const set = new Set<FailureReason>();
  for (const c of codes) {
    const m = REASON_MAP[c];
    if (m) set.add(m);
  }
  for (const e of extra) if (isFailureReason(e)) set.add(e);
  for (const p of REASON_PRIORITY) if (set.has(p)) return p;
  return 'OTHER';
}

export interface FeedbackRowLike {
  id: number;
  conv_uid: string;
  msg_uid: string;
  user_id: number | null;
  vote: number;
  reason_codes_json: string;
  reason_text: string | null;
  corrected_answer: string | null;
  prompt_snapshot: string | null;
  answer_snapshot: string | null;
  model_version: string | null;
  runtime_variant: string | null;
  system_prompt_version: string | null;
  tool_schema_version: string | null;
  context_ref: string | null;
}

export interface FailureCandidateInsert {
  failure_uid: string;
  feedback_id: number;
  request_id: string | null;
  conv_uid: string;
  msg_uid: string;
  user_id: number | null;
  reason_code: FailureReason;
  question_text: string | null;
  answer_text: string | null;
  corrected_answer: string | null;
  redaction_status: 'RAW';
  versions_json: string;
  status: 'NEW';
  recommended_route: string | null;
}

/**
 * 👎 → NEW нэр дэвшигч.  ⚠️ Зөвхөн `vote = -1`; 👍 нь алдаа биш.
 * Текст нь RAW — экспорт хийхээс ӨМНӨ ариутгана (`redactCandidateText`).
 */
export function candidateFromFeedback(
  fb: FeedbackRowLike,
  extra: { failureUid: string; requestId?: string | null; knowledgeVersion?: string | null; normRegistryVersion?: string | null; appVersion?: string | null; runtimeVersion?: string | null },
): FailureCandidateInsert | null {
  if (fb.vote !== -1) return null;
  let codes: string[] = [];
  try {
    const parsed = JSON.parse(fb.reason_codes_json) as unknown;
    codes = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    codes = [];
  }
  const reason = mapFeedbackReasons(codes);
  const versions = {
    model: fb.model_version,
    runtime_variant: fb.runtime_variant,
    system_prompt: fb.system_prompt_version,
    tool_schema: fb.tool_schema_version,
    knowledge: extra.knowledgeVersion ?? null,
    normRegistry: extra.normRegistryVersion ?? null,
    app: extra.appVersion ?? null,
    runtime: extra.runtimeVersion ?? null,
  };
  return {
    failure_uid: extra.failureUid,
    feedback_id: fb.id,
    request_id: extra.requestId ?? fb.context_ref,
    conv_uid: fb.conv_uid,
    msg_uid: fb.msg_uid,
    user_id: fb.user_id,
    reason_code: reason,
    question_text: fb.prompt_snapshot,
    answer_text: fb.answer_snapshot,
    corrected_answer: fb.corrected_answer,
    redaction_status: 'RAW',
    versions_json: JSON.stringify(versions),
    status: 'NEW',
    recommended_route: recommendRoute({ reason, validator: null, trusted: null }).status,
  };
}

/* ================================================================== */
/*  ЧИГЛҮҮЛЭЛТ (§22) — зөвлөмж                                          */
/* ================================================================== */

export type RegressionTarget = 'NORM' | 'COMPANY' | 'CONVERSATION' | 'MODEL_BEHAVIOR' | 'UI';

export interface RouteRecommendation {
  status: FailureStatus;
  target: RegressionTarget;
  /** Хүнд харагдах монгол шалтгаан. */
  why: string;
}

export interface TrustedSummaryLike {
  /** Trusted result зөв байсан ч загвар өөрчилсөн (validator барьсан). */
  contract_violations?: string[];
  /** Хайлт юу ч олоогүй. */
  no_match?: boolean;
  /** Эшлэл зохиомол/буруу. */
  citation_issue?: boolean;
  /** Тооцоолуур ажилласан. */
  calculation_used?: boolean;
}

export function recommendRoute(input: { reason: FailureReason; validator: { failures?: string[] } | null; trusted: TrustedSummaryLike | null }): RouteRecommendation {
  const v = input.validator?.failures ?? [];
  const t = input.trusted;

  if (input.reason === 'UNSAFE_ACTION') return { status: 'MODEL_BEHAVIOR', target: 'MODEL_BEHAVIOR', why: 'Аюултай үйлдлийн санал — зан төлөвийн регресс + SFT.' };
  if (input.reason === 'TOO_SLOW') return { status: 'UI_ISSUE', target: 'UI', why: 'Хурдны гомдол — гүйцэтгэлийн мөшгөлт, загварын алдаа биш.' };
  if (input.reason === 'BAD_MONGOLIAN') return { status: 'MODEL_BEHAVIOR', target: 'MODEL_BEHAVIOR', why: 'Монгол хэлний хэв маяг — SFT нэр дэвшигч.' };
  if (input.reason === 'WRONG_CALCULATION' || t?.calculation_used === true && input.reason === 'WRONG_ANSWER') {
    return { status: 'CALCULATION_ISSUE', target: 'NORM', why: 'Тооцоолуурын дүн — детерминист тооцоолуурын регресс (Session A suite).' };
  }
  if (t?.citation_issue === true) {
    return { status: 'CITATION_ISSUE', target: 'NORM', why: 'Эшлэл/провенанс буруу — эх сурвалжийн холболтын регресс.' };
  }
  if (input.reason === 'WRONG_SOURCE' || t?.no_match === true) {
    return { status: 'RETRIEVAL_ISSUE', target: 'NORM', why: 'Хайлт буруу/хоосон заалт олсон — retrieval регресс.' };
  }
  if (v.length > 0 || (t?.contract_violations?.length ?? 0) > 0) {
    return { status: 'MODEL_BEHAVIOR', target: 'MODEL_BEHAVIOR', why: 'Итгэмжлэгдсэн дүн зөв байсан ч загвар өөрчилсөн — SFT/зан төлөв.' };
  }
  if (input.reason === 'MISUNDERSTOOD') return { status: 'MODEL_BEHAVIOR', target: 'CONVERSATION', why: 'Санаа/ээлжийн ангилал — ярианы кернелийн регресс.' };
  if (input.reason === 'INCOMPLETE') return { status: 'MODEL_BEHAVIOR', target: 'MODEL_BEHAVIOR', why: 'Дутуу хариулт — гүн/бүрэн байдлын SFT.' };
  return { status: 'TRIAGED', target: 'COMPANY', why: 'Тодорхой дохиогүй — админ ангилна (өгөгдөл буруу бол DATA_ISSUE).' };
}

/* ================================================================== */
/*  АРИУТГАЛ (§21, §24)                                                */
/* ================================================================== */

/**
 * Ариутгал = КАНОН нууц/PII маск (`packages/mglai-common` — Session D, GAP-027: имэйл, утас,
 * JWT/Bearer, API түлхүүр, нууц үг) + B-ийн ГАНЦ бодлогын давхарга: «Овог.Нэр» хэлбэрийн
 * хүний нэр (secret биш, санал хүсэлтийн PII бодлого).  ⚠️ Нууцын regex ЭНД БАЙХГҮЙ —
 * backend/ai/хөтөч гурвуулаа ижил канон функц.  ЭНЭ НЬ ХАНГАЛТТАЙ БИШ — admin ЗААВАЛ
 * гараар харна; функц нь зөвхөн `REDACTED` тэмдэглэхээс ӨМНӨХ туслах.
 */
export function redactCandidateText(text: string): string {
  // ⚠️ ASCII `\b` кириллд үүсдэггүй (CLAUDE.md-ийн урхи) — `\p{L}` хилээр.
  return redact(text).replace(/(?<!\p{L})[А-ЯЁӨҮ]\.[А-ЯЁӨҮ][а-яёөү]+(?!\p{L})/gu, '[NAME]');
}

/* ================================================================== */
/*  РЕГРЕСС / SFT НЭР ДЭВШИГЧ (§23, §24)                               */
/* ================================================================== */

export interface RegressionCandidate {
  candidate_uid: string;
  failure_id: number | null;
  target: RegressionTarget;
  question: string;
  /** Suite-ийн өөрийн хэлбэр — энд тайлагдахгүй. */
  expected: Record<string, unknown>;
  failure_class: string | null;
  versions: Record<string, string | null>;
  approval_state: 'DRAFT' | 'APPROVED' | 'EXPORTED' | 'REJECTED';
}

/**
 * Батлагдсан нэр дэвшигчийг suite-ийн хэлбэрт хөрвүүлэх ГЭРЭЭ.
 * ⚠️ NORM зорилтын хэрэгжүүлэлт Session A-ийнх (`ai/evaluation/norm-golden.mjs`-ийн
 *    кейсийн хэлбэр) — энд зөвхөн интерфейс; `exportRecord` нь түүхий,
 *    ерөнхий JSON.
 */
export interface RegressionCandidateExporter {
  target: RegressionTarget;
  export(candidate: RegressionCandidate): { file: string; record: Record<string, unknown> };
}

export function exportRecord(c: RegressionCandidate): Record<string, unknown> {
  return {
    id: c.candidate_uid,
    target: c.target,
    question: c.question,
    expected: c.expected,
    failure_class: c.failure_class,
    versions: c.versions,
    source: c.failure_id !== null ? `failure:${c.failure_id}` : null,
  };
}

export interface SftCandidate {
  candidate_uid: string;
  failure_id: number | null;
  input_text: string;
  target_text: string;
  language: 'mn' | 'en' | 'mixed';
  category: string;
  redaction_status: 'RAW' | 'REDACTED' | 'NOT_NEEDED';
  review_state: 'DRAFT';
}

/**
 * ⚠️ SFT нэр дэвшигч ЗӨВХӨН: (1) төлөв APPROVED_SFT эсвэл MODEL_BEHAVIOR,
 *    (2) redaction REDACTED/NOT_NEEDED, (3) залруулга БИЙ.  Гурвын аль нэг
 *    дутвал `null` — «ажилтны яриа → SFT» гэсэн богино зам байхгүй (§19).
 */
export function sftCandidateFrom(
  f: { id: number; status: string; redaction_status: string; question_text: string | null; corrected_answer: string | null; reason_code: string },
  uid: string,
): SftCandidate | null {
  if (f.status !== 'APPROVED_SFT' && f.status !== 'MODEL_BEHAVIOR') return null;
  if (f.redaction_status === 'RAW') return null;
  if (!f.question_text || !f.corrected_answer) return null;
  const cyr = (f.question_text.match(/[А-Яа-яЁёӨөҮү]/g) ?? []).length;
  const lat = (f.question_text.match(/[A-Za-z]/g) ?? []).length;
  const language: SftCandidate['language'] = cyr > 0 && lat > cyr ? 'mixed' : cyr > 0 ? 'mn' : 'en';
  return {
    candidate_uid: uid,
    failure_id: f.id,
    input_text: f.question_text,
    target_text: f.corrected_answer,
    language,
    category: f.reason_code === 'BAD_MONGOLIAN' ? 'style' : 'behavior',
    redaction_status: f.redaction_status as SftCandidate['redaction_status'],
    review_state: 'DRAFT',
  };
}
