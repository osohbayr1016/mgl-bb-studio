/**
 * MGL AI · ЛОКАЛ RUNTIME API-ИЙН ГЭРЭЭ (Session D §16).
 *
 * ⚠️ ЭНД БИЧСЭН ТАЛБАР БҮР БОДИТ ХЭРЭГЛЭГЧТЭЙ.  Талбар бүрийн ард ХЭН
 *    уншдагийг тэмдэглэв — тэр хэрэглэгч байхгүй бол талбар энд ОРОХГҮЙ.
 *    Ингэснээр «runtime хариунаас талбар хасахад хэн эвдрэх вэ» гэсэн
 *    асуулт энэ файлыг уншаад л хариулагдана.
 *
 *    Хэрэглэгчид:
 *      FE   frontend/src/features/mgl-ai/lib/runtime.ts         (RuntimeInfo, NormAnswer, streamGenerate)
 *      BE   backend/src/lib/mglai/localNorm.ts                  (parseLocalNorm — /norm-ийн биеийг /context-д)
 *      B    ai/deployment/src/normProviders.ts                  (httpNormProviders — /norm/info, /norm)
 *      C    ai/evaluation/lib/e2e.mjs                           (/info, /warmup, /norm, /generate)
 *      PRE  frontend/src/shared/hooks/useMglAiPrewarm.ts        (probe → pair → warmup)
 *
 * ⚠️ ЭНЭ ФАЙЛ RUNTIME-ИЙГ ИМПОРТЛОДОГГҮЙ.  Гэрээ нь кодоос ТУСДАА
 *    амьдрах ёстой — эс тэгвэл «код өөрчлөгдөхөд гэрээ өөрөө өөрчлөгдөж»
 *    зөрчил хэзээ ч илрэхгүй.  Тест нь бодит серверийг асааж ЭНЭ хэлбэртэй
 *    тулгана (`test/runtime.contract.test.ts`).
 */
import type { Spec } from './shape.ts';

export const RUNTIME_API_CONTRACT_VERSION = 'mgl-ai-runtime-api/1';

/** GET /health — НЭВТРЭЛТГҮЙ.  Зөвхөн «энэ порт дээр байна»; загварын нэр ГАРАХГҮЙ. */
export const HEALTH: Spec = {
  service: { $enum: ['mgl-ai-runtime'] },
  version: 'string', // FE: харуулдаггүй, PRE: probe
  ok: 'boolean',
};

/** GET /info — нэвтрэлттэй.  FE `RuntimeInfo`-ийн ХАТУУ хэсэг. */
export const INFO: Spec = {
  service: { $enum: ['mgl-ai-runtime'] },
  runtime_version: 'string', // FE, C (identity), B (installed runtime version)
  engine: {
    engine: 'string', // FE, C
    runtimeVariant: 'string', // FE → /messages runtime_variant (⚠️ backend RUNTIME_VARIANTS-д байх ЁСТОЙ)
    modelVersion: 'string|null', // FE
    quantization: 'string|null',
    contextTokens: 'number', // FE (context budget)
    loaded: 'boolean', // FE modelStateOf
  },
  engine_reason: 'string',
  engine_health: { ok: 'boolean', loaded: 'boolean', detail: 'string' }, // FE modelStateOf
  hardware: { cpu: 'string', gpu: 'string|null', vramMb: 'number|null', ramMb: 'number' }, // FE (diag)
  active_model: 'object|null', // FE
  installed: ['object'],
  rollback_available: 'boolean',
  disk_bytes: 'number',
  perf: {
    profile: { $enum: ['eco', 'balanced', 'performance'] },
    source: { $enum: ['env', 'user', 'auto'] },
    label: { name: 'string', hint: 'string' },
    options: ['object'],
    plan: 'object|null',
    notices: ['string'],
  },
  adapter: 'object|null', // FE «MGL AI 1.2» шошго
  update: 'object', // FE RuntimeUpdateStatus (доор)
  paired: 'boolean', // PRE: pair() дуудах эсэх
};

/** `update` талбар ба GET /update/status — FE `RuntimeUpdateStatus` twin. */
export const UPDATE_STATUS: Spec = {
  phase: { $enum: ['idle', 'checking', 'downloading', 'installing', 'ready', 'failed'] },
  what: 'string|null',
  percent: 'number|null',
  message: 'string|null',
  lastCheckedAtMs: 'number|null',
  error: 'string|null',
  restartRequired: 'boolean',
};

/** POST /norm → 503 (мэдлэг суулгаагүй).  FE: `not_installed`; B: NORM_NOT_INSTALLED. */
export const NORM_NOT_INSTALLED: Spec = {
  error: 'string',
  expected_path: 'string',
};

/**
 * POST /norm → 200.  ⚠️ `status` ЦАГААН ЖАГСААЛТ — BE `localNorm.ts STATUSES`
 * яг эдгээр 4 мөрийг л хүлээж авна; шинэ утга нэмбэл BE чимээгүй `null`
 * буцааж, чат «нотолгоо алга» гэж хариулна.  Нэмэх бол ГУРВАН газар зэрэг:
 * A `pipeline.ts` · BE `localNorm.ts` · FE `runtime.ts NormAnswer`.
 */
export const NORM_STATUSES = ['verified', 'supported', 'uncertain', 'insufficient_evidence'] as const;

export const NORM_ANSWER: Spec = {
  status: { $enum: [...NORM_STATUSES] }, // FE, BE, B (smoke: string)
  rule_id: 'string|null', // BE ruleId
  rule_object_mn: 'string|null', // BE — чат руу хүрдэг ЦОРЫН ГАНЦ дүрмийн текст
  citation: 'object|null', // BE citationLabel/documentCode/clause/page/legal_review_required/effective_status
  evidence: ['object'], // BE (≤4), FE
  note_mn: 'string|null', // BE
  missing_context: ['string'], // BE (≤6)
  elapsed_ms: 'number', // FE (stage timing)
  // ⚠️ Доорх талбарууд runtime ГАРГАДАГ ч BE/FE ХЭН Ч уншдаггүй (CLAUDE.md-д
  //    баримтжсан цоорхой): decisions, inputs_used, no_match_reason, legs,
  //    rule_kind, rule_actor, diagnostics.  Тэднийг гэрээнд ОРУУЛААГҮЙ —
  //    хэрэглэгч гарч ирэхэд л нэмнэ.
};

/** `citation` объектын BE-д уншигддаг хэсэг (`parseLocalNorm`). */
export const NORM_CITATION: Spec = {
  document: 'string|null',
  clause: 'string|null',
  page: 'number|null',
  label_mn: 'string|null',
  legal_review_required: 'boolean?',
  effective_status: 'string?',
  /** A final (2026-09-14): багцын SHA — backend `norm/drift.ts` бүртгэлтэй тулгана (NORM_DATA_VERSION_MISMATCH). */
  dataset_sha256: 'string|null?',
  source_url: 'string|null?',
};

/** `evidence[i]` — BE `parseLocalNorm`: text_mn + chunk_id ЗААВАЛ, бусад нь нэмэлт. */
export const NORM_EVIDENCE_ITEM: Spec = {
  chunk_id: 'string',
  text_mn: 'string',
  kind: 'string?',
  page: 'number|null',
  clause_no: 'string|null',
  score: 'number',
};

/**
 * GET /norm/info — B `httpNormProviders` уншина.
 *
 * ⚠️ B нь `knowledge_version` / `registry_version` / `schema_version`-ыг
 *    НЭМЭЛТ гэж хүлээж байна (байхгүй бол null).  Session A эдгээрийг
 *    гаргамагц энд `'string'` болгож ХАТУУ шаардана — тэр өдрөөс хойш
 *    хувилбаргүй /norm/info нь гэрээний зөрчил.
 */
export const NORM_INFO_INSTALLED: Spec = {
  installed: { $enum: [true] },
  path: 'string',
  // Session D §8 (2026-09-14): баримт бүр A-ийн dataset таних тэмдэгтэй (ingest `dataset_identity`) —
  //    B `normVersion.ts` ↔ Worker `/api/mgl-ai/norm-registry` тулгалтын оролт.  Хуучин шингээлт → null.
  documents: [{ doc_id: 'string', code: 'string', document_id: 'string', dataset_id: 'string|null', dataset_version: 'string|null', dataset_sha256: 'string|null' }],
  counts: { chunks: 'number', rules: 'number', unverified_rules: 'number', aliases: 'number' },
  vector_index: 'string',
  knowledge_version: 'string', // kf1:<16 hex> — B version().knowledgeVersion
  registry_version: 'string|null', // PC мэдэхгүй → null; B-ийн бүрхүүл Worker-оос авна
  schema_version: 'number|null', // ai_schema_meta.version (A) — §15 тулгалт
  runtime_schema_version: 'number', // retrieval/src/db.ts SCHEMA_VERSION
};
export const NORM_INFO_NOT_INSTALLED: Spec = { installed: { $enum: [false] }, expected_path: 'string' };

/**
 * POST /generate — SSE.  Фрэйм бүр `event:` + `data:` JSON.
 * FE `streamGenerate` ЯГ эдгээр 5 event-ийг таньдаг; бусад нь чимээгүй хаягдана.
 */
export const GENERATE_EVENTS = ['start', 'token', 'heartbeat', 'done', 'error'] as const;
export const GENERATE_STOP_REASONS = ['stop', 'length', 'aborted', 'repetition', 'timeout'] as const;

export const GENERATE_START: Spec = { engine: { engine: 'string' }, at: 'number' };
export const GENERATE_TOKEN: Spec = { text: 'string' };
export const GENERATE_HEARTBEAT: Spec = { stage: 'string', elapsed_ms: 'number' };
export const GENERATE_DONE: Spec = {
  stop_reason: { $enum: [...GENERATE_STOP_REASONS] }, // FE: repetition/timeout = АМЖИЛТГҮЙ
  repetition: 'object|null',
  usage: { promptTokens: 'number|null', completionTokens: 'number|null' },
  first_token_ms: 'number|null',
  total_ms: 'number',
  engine: 'string',
  runtime_variant: 'string', // → /messages runtime_variant
};
export const GENERATE_ERROR: Spec = { message: 'string' };

/** POST /generate → 413 (контекст хэтэрсэн) — FE `aiErrors` тусгай код. */
export const GENERATE_OVERFLOW: Spec = {
  error: 'string',
  code: { $enum: ['context_overflow'] },
  context_tokens: 'number',
  estimated_prompt_tokens: 'number',
};

/** Нэвтрэлт унасан — FE `probe()`: `authorized:false`. */
export const UNAUTHORIZED: Spec = { error: 'string', code: 'string' };

/** GET /metrics — ЗӨВХӨН диагностик; FE `RuntimeMetrics`. */
export const METRICS: Spec = {
  runtime_version: 'string',
  engine: 'object',
  engine_health: 'object',
  busy: 'boolean',
  /**
   * ⚠️ ХЭМЖСЭН ЗӨРҮҮ (2026-09-11): FE `RuntimeMetrics.idle_ms: number | null` гэж
   *    зарласан ч echo хөдөлгүүр `idleMs`-гүй тул JSON-д түлхүүр ОГТ ГАРДАГГҮЙ
   *    (`undefined` → хасагдана).  Диагностикийн талбар тул гэрээнд «байж болно»
   *    гэж тэмдэглэв; runtime `?? null` гэж бичвэл хатуу болгоно.
   */
  idle_ms: 'number|null?',
  idle_unload_ms: 'number',
  profile: 'string',
  hardware: 'object',
  gpu: 'object|null', // ⚠️ null = хэмжиж чадсангүй, 0 БИШ
  runtime_process: { rss_mb: 'number', heap_mb: 'number', uptime_s: 'number' },
  update: UPDATE_STATUS,
  knowledge_installed: 'boolean',
  measured_at: 'string',
};

/* ================================================================== */
/*  SESSION B — /deploy/* (merge хийгдсэний дараа хүчинтэй)             */
/* ================================================================== */

/**
 * GET /deploy/health — B `health.ts HealthReport`.  Хэрэглэгч: флот heartbeat
 * (`healthSummary`), FE `RuntimeStatus` (ирээдүйд), D release gate.
 * ⚠️ B merge хийгдээгүй бол 404 — тест `skip`.
 */
export const DEPLOY_HEALTH_STATUSES = ['READY', 'DEGRADED', 'REPAIR_REQUIRED', 'UPDATING'] as const;
export const DEPLOY_FACETS = ['LOCAL_AI', 'KNOWLEDGE', 'NORM', 'COMPANY_BACKEND', 'REVIT'] as const;
export const DEPLOY_FACET_STATUSES = ['READY', 'DEGRADED', 'OFFLINE', 'MISSING', 'REPAIR_REQUIRED', 'UNKNOWN'] as const;

export const DEPLOY_HEALTH: Spec = {
  status: { $enum: [...DEPLOY_HEALTH_STATUSES] },
  facets: Object.fromEntries(DEPLOY_FACETS.map((f) => [f, { status: { $enum: [...DEPLOY_FACET_STATUSES] }, reasons: ['string'] }])),
  checks: [{ id: 'string', facet: { $enum: [...DEPLOY_FACETS] }, severity: { $enum: ['fatal', 'degraded', 'info'] }, ok: 'boolean', code: 'string', ms: 'number' }],
  reasonCodes: ['string'],
  updating: 'boolean',
  measuredAt: 'string',
  totalMs: 'number',
};

/** GET /deploy/state — B `installedState.ts` `mgl-ai-installed/1`. */
export const DEPLOY_STATE: Spec = {
  installed: {
    schema: { $enum: ['mgl-ai-installed/1'] },
    installationId: 'string',
    channel: { $enum: ['admin', 'canary', 'stable'] },
    components: 'object',
    previous: 'object',
    currentRelease: 'string|null',
    previousRelease: 'string|null',
    lastKnownGoodRelease: 'string|null',
  },
  telemetry_level: 'string',
};
