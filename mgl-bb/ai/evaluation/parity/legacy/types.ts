/**
 * MGL AI · FRONTEND-ИЙН ТӨРЛҮҮД — `/api/mgl-ai`-ийн хариуны толь.
 *
 * ⚠️ Эдгээр нь `backend/src/routes/mglAi.ts`-ийн ХОСЛОЛ (twin).  Backend-д
 *    талбар нэмэхэд ЭНД ч нэмнэ — репо даяар нэг ч төрлийн гүүр (shared
 *    package) байхгүй тул хосыг ГАРААР барина, `NotificationType`-ийн
 *    заншлаар.
 */

export type AiMode = 'client' | 'employee' | 'admin' | 'denied';

export type ConfidenceState = 'verified' | 'supported' | 'uncertain' | 'insufficient';

export type RevitLevel =
  | 'READ_ONLY'
  | 'SAFE_WRITE'
  | 'CONFIRM_EVERY_WRITE'
  | 'PROJECT_ADMIN'
  | 'FULL_AGENT';

export interface AiToolParam {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean';
  required: boolean;
  description: string;
  enum?: string[];
  min?: number;
  max?: number;
}

export interface AiTool {
  name: string;
  description: string;
  description_en?: string;
  kind: 'read' | 'view' | 'write' | 'admin';
  params: AiToolParam[];
}

export interface AiSession {
  mode: AiMode;
  user_id: number | null;
  role: string | null;
  memory_namespace: 'employee' | 'client';
  permissions: {
    revit_level: RevitLevel;
    erp_write_enabled: boolean;
    roslyn_enabled: boolean;
    max_tool_iterations: number;
    project_scope: number[];
  };
  tools: AiTool[];
  model: {
    product: string;
    display_name: string;
    family: string;
    version: string;
    runtime_variant: string;
    release: Record<string, unknown> | null;
    context_tokens: number;
  };
  settings: { evidence_top_k: number; retention_days: number };
}

export interface AiEvidence {
  id: string;
  kind: 'clause' | 'document' | 'chunk' | 'erp' | 'memory';
  title: string;
  document_uid: string | null;
  clause_uid: string | null;
  page: number | null;
  section: string | null;
  score?: number;
}

/**
 * ЭЭЛЖИЙН ТАЙЛАЛ — сервер (`lib/mglai/turn.ts`) шийднэ.  UI нь ЗӨВХӨН
 * харуулна: «Өмнөх сэдвийг үргэлжлүүлж байна», «Хоёр асуулт».
 */
export interface AiTurnSummary {
  kind:
    | 'NEW_TOPIC'
    | 'CONTINUATION'
    | 'FOLLOW_UP'
    | 'REFERENCE_TO_PRIOR_RESULT'
    | 'CORRECTION'
    | 'CLARIFICATION'
    | 'MULTI_INTENT';
  reason: string;
  subject:
    | { kind: 'project'; id: number; name: string }
    | { kind: 'norm' | 'employee'; label: string }
    | null;
  history_messages: number;
  tasks: { text: string; intent: string; domain: string }[];
}

/**
 * ЯРИАНЫ БҮТЭЦТЭЙ ТӨЛӨВ — сервер үүсгэнэ, хөтөч ХӨНДӨЛГҮЙ буцаана.
 *
 * ⚠️ ХӨТӨЧ ҮҮНИЙГ ОГТ УНШИХГҮЙ, ЗАСАХГҮЙ.  Хэлбэр нь серверийн дотоод
 *    хэрэг (`convState.ts`); энд `unknown` гэж авч явна.  Ингэснээр
 *    серверийн хувилбар өөрчлөгдөхөд хөтөч эвдрэхгүй.
 */
export type AiConvState = unknown;

/**
 * ИТГЭМЖЛЭГДСЭН НОРМЫН ҮР ДҮН (tnr-1, Amendment B) — `backend/src/lib/mglai/norm/types.ts`-ийн
 * ХОС.  Сервер үүсгэж ГАРЫН ҮСЭГ зурна; хөтөч харуулна, `/messages`-д ХӨНДӨЛГҮЙ буцаана.
 * ⚠️ Хөтөч энэ объектыг ХЭЗЭЭ Ч засахгүй — засвал гарын үсэг таарахгүй, сервер хаяна.
 */
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

export interface TrustedNormProvenance {
  documentId: string;
  documentCode: string;
  recordId: string;
  section: string | null;
  clause: string | null;
  table: number | null;
  formula: string | null;
  page: number | null;
  verificationStatus: string;
  verificationState: NormVerificationState;
  sourceHash: string;
  labelMn: string;
}

export interface TrustedNormFollowup {
  id: string;
  required: boolean;
  missingInputs: string[];
  textMn: string;
  textEn: string;
}

export interface TrustedNormResult {
  version: 'tnr-1';
  intent: 'NORMATIVE' | 'CALCULATION';
  answerKind: 'classification' | 'calculation' | 'requirement' | 'procedure' | 'insufficient_context' | 'unverified' | 'no_match';
  verification: NormVerificationState;
  authoritative: boolean;
  documentId: string | null;
  documentCode: string | null;
  datasetSha256: string | null;
  currentness: string | null;
  requestedDocument: string | null;
  value: number | string | boolean | null;
  unit: string | null;
  initialCategory: string | null;
  finalCategory: string | null;
  ranges: { category: string; min: number | null; max: number | null; exclusiveMin: boolean; exclusiveMax: boolean }[];
  rule: { ruleId: string; family: string; method: string | null } | null;
  calculation: { calculatorId: string; formulaId: string | null; inputs: Record<string, number>; result: number | boolean; unit: string | null; steps: string[] } | null;
  followups: TrustedNormFollowup[];
  missingInputs: string[];
  provenance: TrustedNormProvenance[];
  inputs: Record<string, number | string | boolean>;
  assumptions: string[];
  warnings: string[];
  reason: string;
  textMn: string;
  textEn: string;
  allowedNumbers: number[];
  allowedCategories: string[];
}

export interface AiContextResponse {
  conv_uid: string | null;
  /** Ээлжийн тайлал — UI-ийн сэдвийн мөр. */
  turn?: AiTurnSummary;
  /** Дараагийн ээлжид `conv_state`-ээр буцаах төлөв. */
  conv_state_next?: AiConvState;
  /** Оношилгоо: prompt-д хэдэн түүхийн мессеж, persona орсон эсэх. */
  context_diag?: {
    history_messages: number;
    persona: 'none' | 'name_only' | 'full';
    revit_level_shown: boolean;
    tasks: number;
  };
  turns: { role: 'system' | 'user' | 'assistant'; content: string }[];
  tools: AiTool[];
  evidence: AiEvidence[];
  regulatory: boolean;
  /**
   * СЕРВЕР шийдсэн хариултын хэл (§3).
   *
   * ⚠️ Локал `/generate` руу ДАМЖУУЛНА.  Загварт хэл сонгуулах нь
   *    латин монголыг англи болгодог байсан.
   */
  response_language: 'mn-Cyrl' | 'en';
  detected_language: 'mn-Cyrl' | 'mn-Latn' | 'en' | 'mixed';
  language_explicit: boolean;
  /** Асуултын санаа (`classifyIntent`). */
  intent: string;
  intent_reason: string;
  evidence_required: boolean;
  /**
   * Итгэлийн шошгыг ХАРУУЛАХ эсэх (§4).
   *
   * ⚠️ Мэндчилгээ, мета асуулт дээр `false` — «Нотолгоо хүрэлцэхгүй»
   *    гэж харуулах нь бүтээгдэхүүнийг эвдэрсэн мэт харуулна.
   */
  show_confidence: boolean;
  verification_states: string[];
  filtered_out: { count: number } | { id: string; reason: string }[];
  model: {
    family: string;
    version: string;
    runtime_variant: string;
    system_prompt_version: string;
    tool_schema_version: string;
    context_tokens: number;
  };
  max_tool_iterations: number;
  as_of: string;
  /**
   * D1-ийн БОСГЫН хүснэгтээс гарсан детерминист шийдвэр (жишээ нь
   * g=1800 → В2).  ⚠️ Загвар үүнийг ӨӨРЧИЛЖ БОЛОХГҮЙ (§35).
   */
  norm_decision?: unknown;
  /**
   * Локал нормын санг ХЭРЭГЛЭСЭН эсэх (§17, §18).
   *
   * ⚠️ Клиент нь `/norm`-ыг дуудсан ч сервер түүнийг ХАЯЖ БОЛНО
   *    (`uncertain` төлөв нь шийдвэр болохгүй).  Тиймээс UI нь
   *    «ашиглагдлаа» гэж ӨӨРӨӨ таамаглах ЁСГҮЙ — энэ талбарыг уншина.
   */
  local_norm?: {
    status: string;
    used_as_evidence: boolean;
    /** Хөдөлгүүрийн эрх бүхий үр дүн байвал локал заалт ХАЯГДСАН эсэх. */
    superseded_by_threshold_rule?: boolean;
    /** «Олдсонгүй»-н шалтгаан — `named_document_absent`, `no_content_overlap`… (хайлт унасантай ХОЛИХГҮЙ). */
    no_match_reason?: string | null;
    named_document?: { code: string; absent: boolean; relation: string | null } | null;
    dataset_sha256?: string | null;
    /** Amendment A: бүртгэл ба локал сангийн хувилбар — match | mismatch | unknown | … */
    drift?: string | null;
    citation_label: string | null;
    document_code: string | null;
    clause: string | null;
    page: number | null;
    evidence_count: number;
    currentness?: string | null;
  } | null;
  /**
   * ЭЭЛЖИЙН ЦОРЫН ГАНЦ TrustedNormResult (Amendment B) + серверийн гарын үсэг.
   * Хөтөч харуулна, `/messages`-д хоёуланг нь ХӨНДӨЛГҮЙ буцаана.
   */
  trusted_norm_result?: TrustedNormResult | null;
  trusted_norm_sig?: string | null;
  /** Нэгдсэн мөшгөлт (§21) — оношилгоо, E2E harness; UI логикт ашиглахгүй. */
  norm_trace?: Record<string, unknown>;
  /**
   * ХАРИУЛТЫН ГЭРЭЭ — сервер бичнэ, `lib/contract.ts` үүсгэлтийн дараа
   * тулгана (татгалзал заавал, шийдвэрийн тоо л зөвшөөрнө).
   */
  answer_contract?: import('./contract').AnswerContract;
  /**
   * ИТГЭМЖЛЭГДСЭН БАРИМТЫН ГЭРЭЭ (tfc-1) — `answer_contract`-ыг ерөнхийлсөн.
   * Байвал `lib/validator.ts` үүнийг ашиглана, хуучин гэрээг биш.
   */
  trusted_contract?: import('./validator').TrustedContract;
  /** ⚠️ СЕРВЕР ХЭМЖСЭН хугацаа — UI-ийн алхмын мс энэ талбараас (§26). */
  stage_timings?: {
    retrieval_ms: number;
    norm_decision_ms: number;
    total_ms: number;
  };
}

export interface AiCitation {
  id: string;
  kind: string;
  title: string;
  documentUid: string | null;
  clauseUid: string | null;
  page: number | null;
  section: string | null;
}

/** UI-д амьдардаг нэг мессеж. */
export interface ChatMessage {
  msgUid: string;
  role: 'user' | 'assistant';
  content: string;
  /** Урсгал явж байгаа эсэх. */
  streaming?: boolean;
  citations?: AiCitation[];
  evidence?: AiEvidence[];
  confidence?: ConfidenceState | null;
  error?: string | null;
  firstTokenMs?: number | null;
  totalMs?: number | null;
  engine?: string | null;
  runtimeVariant?: string | null;
  /** Хэрэглэгчийн санал — 1 / -1 / null. */
  vote?: 1 | -1 | null;
  regulatory?: boolean;
  verificationStates?: string[];
  /**
   * Гүйцэтгэлийн мөшгөлт (§6, §28).  ⚠️ ЗӨВХӨН аюулгүй үйлдлийн бүртгэл —
   * загварын нуугдмал сэтгэлгээ ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ (§36).
   */
  run?: import('./aiMachine').AiRun;
  /** ⚠️ §24 — үүсгэлт дундуур тасарсан хариулт. */
  incomplete?: boolean;
  /** Типтэй алдаа — өнгө, үйлдэл нь `severity`-ээс гарна (§20). */
  errorShape?: import('./aiErrors').AiErrorShape | null;
  /**
   * Ээлжийн детерминист нормын үр дүн (P0-16) — UI-ийн «баталгаажсан дүрэм /
   * тооцоо / хүний хяналт» нотолгоо ЭНДЭЭС, загварын текстээс биш.
   */
  normResult?: TrustedNormResult | null;
}

export const FEEDBACK_REASONS = [
  'incorrect',
  'misunderstood',
  'wrong_company_context',
  'wrong_revit_context',
  'wrong_regulation',
  'outdated',
  'hallucinated',
  'too_long',
  'too_short',
  'slow',
  'unsafe_action',
  'other',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
