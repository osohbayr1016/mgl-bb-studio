import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireAdmin } from '../middleware/auth';
import { todayInUB, nowInUBIso } from '../lib/time';

import { resolveAiIdentity, type AiIdentity } from '../lib/mglai/identity';
import { getMglAiSettings } from '../lib/mglai/settings';
import {
  MGL_AI_FAMILY,
  MGL_AI_PRODUCT,
  MGL_AI_VERSION,
  MGL_AI_PROMPT_VERSION,
  MGL_AI_TOOL_SCHEMA_VERSION,
  MGL_AI_RETRIEVAL_VERSION,
  DEFAULT_CONTEXT_TOKENS,
  displayName,
  isRuntimeVariant,
  MGL_AI_EMPLOYEE_RUNTIME_VARIANT,
  MGL_AI_CLIENT_RUNTIME_VARIANT,
} from '../lib/mglai/version';
import {
  DEFAULT_PROFILE,
  decideTool,
  profileFromRow,
  profileExpired,
  isRevitLevel,
  type AiPermissionProfile,
} from '../lib/mglai/permissions';
import { filterEvidence, budgetEvidence, type Evidence } from '../lib/mglai/visibility';
import { assembleTurns, type ToolOutcome } from '../lib/mglai/promptFrame';
import {
  scoreConfidence,
  enforceCitationRule,
  extractCitationIds,
  resolveCitations,
} from '../lib/mglai/confidence';
import { canTransition, normalizeReasons, isFeedbackState } from '../lib/mglai/feedback';
import { TOOLS, toolsForMode, validateToolArgs, isKnownTool } from '../lib/mglai/tools/registry';
import { planResearch, MAX_ROUNDS, type PriorToolResult } from '../lib/mglai/researchPlan';
import { describeEntities } from '../lib/mglai/gateway/entities';
import { budgetToolResults } from '../lib/mglai/toolBudget';
import { ERP_EXECUTORS } from '../lib/mglai/tools/erp';
import { resolveViewer } from '../lib/mglai/context';
import { loadPersona } from '../lib/mglai/persona';
import { searchText } from '../lib/mglai/lang';
import { classifyIntent } from '../lib/mglai/intent';
import { normEngineForTurn, normTurnStateFrom, renderTrustedNorm } from '../lib/mglai/norm/turnEngine';
import { namedDocumentAbsentResult } from '../lib/mglai/norm/engine';
import { normRegistry } from '../lib/mglai/norm/registry';
import { signTrustedResult, verifyTrustedResult } from '../lib/mglai/norm/sign';
import { checkDrift, applyDrift } from '../lib/mglai/norm/drift';
import { currentnessNote, legalReviewRequiredFor } from '../lib/mglai/currentness';
import type { TrustedNormResult } from '../lib/mglai/norm/types';
// ⚠️ 2026-09-11: `decideVSubcategory`/`renderNormDecision` (D1-ийн босгын хүснэгт) энэ
//    маршрутаас ХАСАГДСАН — нормын шийдвэр одоо ЗӨВХӨН `norm/engine.ts` (үүсгэсэн
//    бүртгэл + SHA цоож)-оос гардаг.  `NormDecision` нь legacy харагдац (`legacyDecisionView`).
import type { NormDecision } from '../lib/mglai/normDecide';
import { lexicalSearch, clauseVerificationStates } from '../lib/mglai/retrieval';
import {
  chunkDocument,
  chunkStructured,
  estimateTokens,
  type ParsedChunk,
} from '../lib/mglai/chunk';
import { parseRevitContext, summarizeRevit, revitSelectionTool, revitReportTool } from '../lib/mglai/revitContext';
import { parseLocalNorm, localNormEvidence, composeLocalNorm, localNormDeterministic } from '../lib/mglai/localNorm';
import { withExplanation } from '../lib/mglai/normExplain';
import { planTurn, turnSummary, advanceState, isNormOnlyTurn } from '../lib/mglai/turnPlan';
import { buildAnswerContract } from '../lib/mglai/answerContract';
import { buildTrustedContract, numbersInData, type TrustedContract } from '../lib/mglai/trustedFacts';
import { applyGroundingGuard } from '../lib/mglai/groundingGuard';
import { parseNormCatalog, normCatalogTool, normCatalogUnavailableTool, withNormCatalog, withNormCatalogUnavailable } from '../lib/mglai/normCatalog';
import { detectSmallTalk, smallTalkReply } from '../lib/mglai/smallTalk';
import { applyNormIntel, buildNormIntel } from '../lib/mglai/norm/intelligence';
import { isDocumentDiscoveryQuestion, normDocumentsData, normDocumentsTool, renderNormDocuments, normDocumentsTrailer, missingDiscoverySubject, discoverySubjectAbsentText } from '../lib/mglai/normDocuments';
import { withNormReferenceLinks } from '../lib/mglai/normReferenceLinks';
import { detectMemoryHints, sanitizeMemory, memoryResponseLanguage, memoryAnswerLength } from '../lib/mglai/memoryHints';
import { decideDepth } from '../lib/mglai/depth';
import {
  selectHistory,
  subjectLine,
  personaPolicy,
  personaText,
  revitLevelVisible,
} from '../lib/mglai/contextBuilder';

/**
 * MGL AI — ХЯНАЛТЫН ХАВТГАЙ (`/api/mgl-ai`).
 *
 * ⚠️ ЭНЭ WORKER LLM АЖИЛЛУУЛДАГГҮЙ, ЗОРИУД.  §3-ийн эдийн засгийн
 *    шаардлага: токен тутмын төлбөр БАЙХГҮЙ.  Инференс нь ажилтны PC
 *    дээрх `mgl-ai-runtime` (llama.cpp) эсвэл захиалагчийн хөтөч дээр
 *    (WebGPU) явагдана.  Энэ файл нь:
 *      • хэн болохыг шийднэ          (токеноос, биеэс БИШ)
 *      • эрхээр нотолгоог ШҮҮНЭ      (prompt угсрахаас ӨМНӨ)
 *      • prompt-ыг УГСАРНА           (тариалалтаас хамгаалагдсан)
 *      • типтэй ERP хэрэгсэл ГҮЙЦЭТГЭНЭ
 *      • яриа, санал, аудитыг ХАДГАЛНА
 *      • загварын релиз, эрхийн профайлыг ЭЗЭМШИНЭ
 *
 * ⚠️ `lib/revitAgent.ts` (Anthropic API) ба `routes/ai.ts` (Workers AI)
 *    нь ЭНД ХАМААРАЛГҮЙ.  Тэд хоёул төлбөртэй, гуравдагч инференс —
 *    MGL AI-ийн оршин байх шалтгаан нь тэднийг СОЛИХ.  Тэднийг устгаагүй
 *    (ажиллаж байгаа функцийг устгах нь энэ ажлын хамрах хүрээнээс
 *    гадуур), гэвч MGL AI тэднийг ХЭЗЭЭ Ч дуудахгүй.
 *
 * ⚠️ ЭРХИЙН ГЭРЭЭ: `index.ts`-д `/api/*`-ийн хаалтуудын ДАРАА mount
 *    хийгдэнэ, тиймээс `worker` role нь `lib/workerScope.ts`-ээр
 *    автоматаар 403 авна.  `client` нь `lib/clientScope.ts`-ийн цагаан
 *    жагсаалтад ЗОРИУД нэмэгдсэн — эс тэгвэл захиалагчийн горим огт
 *    ажиллахгүй.
 */

const mglAi = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ================================================================== */
/*  Туслахууд                                                          */
/* ================================================================== */

const MAX_QUESTION_CHARS = 4000;
const MAX_HISTORY_TURNS = 20;
/** Нотолгоонд өгөх тэмдэгтийн төсөв — 4K контекстын ~40%. */
const EVIDENCE_CHAR_BUDGET = 6000;
/**
 * Хэрэгслийн үр дүнгийн НИЙТ төсөв (§36).  Хэмжигдсэн: 8 хэрэгсэлтэй гүн
 * судалгаа 9 657 тэмдэгт өгөгдөл → prompt 12k тэмдэгт, 8K контекстын хил.
 * Кирилл ~2.2 тэмдэгт/токен: 6 500 ≈ 3k токен, систем+түүх+max_tokens-той
 * нийлээд 8K-д багтана.
 */
const TOOL_CHAR_BUDGET = 6500;
const MAX_TEXT = 8000;

/**
 * Хөтчөөс ирсэн гэрээний оношилгоог ариутгана (§44).  Зөвхөн мэддэг талбар,
 * хязгаартай урт — дурын объект D1-д орохгүй.
 */
function sanitizeDiag(raw: unknown, trustedNorm: TrustedNormResult | null = null): string | null {
  if ((!raw || typeof raw !== 'object') && trustedNorm === null) return null;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max = 32) => (typeof v === 'string' ? v.slice(0, max) : null);
  const out = {
    mode: s(r.mode),
    risk: s(r.risk),
    attempts: Number.isInteger(r.attempts) ? (r.attempts as number) : null,
    final: s(r.final),
    buffered: r.buffered === true,
    violations: Array.isArray(r.violations)
      ? r.violations.slice(0, 3).map((codes) => (Array.isArray(codes) ? codes.slice(0, 12).map((c) => s(c, 24)) : []))
      : [],
    turn: s(r.turn),
    // NORM-INTEL v3: нотолгооны төлөв (шошгыг үнэнээр тогтооно).
    norm_state: s(r.norm_state, 40),
    // Нормын оношилгоо — ЗӨВХӨН код/төлөв (текст биш).
    norm:
      trustedNorm === null
        ? null
        : {
            kind: trustedNorm.answerKind,
            verification: trustedNorm.verification,
            authoritative: trustedNorm.authoritative,
            document: trustedNorm.documentCode,
            records: trustedNorm.provenance.slice(0, 4).map((p) => p.recordId.slice(0, 64)),
            calculator: trustedNorm.calculation?.calculatorId ?? null,
            followups: trustedNorm.followups.map((f) => f.id),
            warnings: trustedNorm.warnings.slice(0, 3).map((w) => w.slice(0, 48)),
          },
  };
  return JSON.stringify(out).slice(0, 2000);
}

/** Итгэлийн төлөв — ЗӨВХӨН TrustedNormResult-оос (P0-12). */
function confidenceFromTrustedNorm(t: TrustedNormResult): 'verified' | 'supported' | 'uncertain' | 'insufficient' {
  switch (t.verification) {
    case 'verified':
      return t.answerKind === 'insufficient_context' ? 'supported' : 'verified';
    case 'needs_human_review':
    case 'data_version_mismatch':
    case 'retrieval_failed':
    case 'search_in_progress':
    case 'superseded':
    case 'historical':
      return 'uncertain';
    case 'no_verified_source':
    case 'named_document_absent':
      return 'insufficient';
  }
}

/** Хөтчийн `norm_retrieval` — цагаан жагсаалт (tool_results-ийн ижил загвар). */
function parseNormRetrieval(raw: unknown, hasAnswer: boolean): { attempted: boolean; reason: string; failed: boolean } {
  const REASONS = new Set(['ok', 'not_asked', 'runtime_down', 'not_installed', 'timeout', 'offline', 'error']);
  if (!raw || typeof raw !== 'object') {
    return hasAnswer ? { attempted: true, reason: 'ok', failed: false } : { attempted: false, reason: 'not_asked', failed: false };
  }
  const r = raw as Record<string, unknown>;
  const reason = typeof r.reason === 'string' && REASONS.has(r.reason) ? r.reason : hasAnswer ? 'ok' : 'not_asked';
  const attempted = r.attempted === true || hasAnswer;
  return { attempted, reason, failed: attempted && reason !== 'ok' && reason !== 'not_asked' };
}

function foldCode(code: string): string {
  return code.toLowerCase().replace(/[–—]/g, '-').replace(/[\s_]+/g, '').replace(/бнбд/g, 'bnbd').replace(/убб/g, 'ubb').replace(/бд/g, 'bd').replace(/снип/g, 'snip');
}

/** Хуучин `norm_decision` талбарын харагдац — TrustedNormResult-оос (хос UI, e2e харьцуулалт). */
function legacyDecisionView(t: TrustedNormResult): NormDecision {
  const status: NormDecision['status'] =
    t.verification === 'verified' ? (t.answerKind === 'insufficient_context' ? 'missing_input' : 'verified') : t.verification === 'needs_human_review' || t.verification === 'data_version_mismatch' ? 'needs_human_review' : 'no_rule';
  const src = t.provenance[0] ?? null;
  const inputs: Record<string, number> = {};
  for (const [k, v] of Object.entries(t.inputs)) if (typeof v === 'number') inputs[k] = v;
  return {
    status,
    mode: t.answerKind === 'requirement' ? 'lookup' : 'classify',
    decision: t.initialCategory ? { initial_category: t.finalCategory ?? t.initialCategory } : null,
    inputs_used: inputs,
    additional_checks: {
      required: t.followups.some((f) => f.required),
      missing_inputs: t.missingInputs,
      method: t.rule?.method ?? null,
    },
    source: src ? { document: src.documentCode, table: src.table, page: src.page ?? 0 } : null,
    ranges: t.ranges.map((r) => ({ category: r.category, min: r.min, max: r.max, exclusiveMin: r.exclusiveMin })),
    reason: t.reason,
  };
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** Богино текстийн хамгаалалт — 0195-ийн `str()` заншил. */
function str(v: unknown, max = 256): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length === 0 ? null : s.slice(0, max);
}

function identityOf(c: {
  get: (k: 'user') => AppVariables['user'] | undefined;
  req: { header: (n: string) => string | undefined };
}): AiIdentity {
  const user = c.get('user') ?? null;
  return resolveAiIdentity(user, c.req.header('X-MglAi-Anon') ?? null);
}

/**
 * Хэрэгслийн үр дүнгээс ШИНЖИЛГЭЭНИЙ ХЭМЖҮҮРИЙН тодорхойлолтыг олно (§17).
 * `official_kpi === false` + `metric_definition` — зөвхөн тэр хос.
 */
function metricNoteOf(results: readonly ToolOutcome[]): string | null {
  for (const r of results) {
    if (!r.ok || !r.data || typeof r.data !== 'object') continue;
    const d = r.data as Record<string, unknown>;
    if (d.official_kpi === false && typeof d.metric_definition === 'string') {
      const w = d.window as { days?: number } | undefined;
      const days = typeof w?.days === 'number' ? ` Цонх: сүүлийн ${w.days} хоног.` : '';
      return `Хэмжүүр: ${d.metric_definition.slice(0, 400)}${days}`;
    }
  }
  return null;
}

async function loadProfile(env: Env, userId: number | null): Promise<AiPermissionProfile> {
  if (userId === null) return { ...DEFAULT_PROFILE, projectScope: [] };
  const row = await env.DB.prepare(
    `SELECT revit_level, erp_write_enabled, roslyn_enabled, max_tool_iterations,
            project_scope_json, expires_at
       FROM ai_permission_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<Record<string, unknown>>();

  // ⚠️ Хугацаа дууссан профайл нь ӨГӨГДМӨЛ рүү унана — сунгах нь админы
  //    ажил, чимээгүй үргэлжлэх нь эрхийн тогтмолжилт болно.
  if (row && profileExpired(row.expires_at as string | null, nowInUBIso())) {
    return { ...DEFAULT_PROFILE, projectScope: [] };
  }
  return profileFromRow(row);
}

/** Идэвхтэй загварын релиз — тухайн ажиллах үеийн хувилбарт. */
async function activeRelease(env: Env, variant: string) {
  return env.DB.prepare(
    `SELECT release_uid, version, runtime_variant, base_model, quantization, runtime,
            context_tokens, artifact_url, artifact_bytes, artifact_sha256,
            min_vram_mb, min_ram_mb, license_cleared, eval_passed, channel, build_commit
       FROM ai_model_releases
      WHERE runtime_variant = ? AND is_active = 1`,
  )
    .bind(variant)
    .first<Record<string, unknown>>();
}

/**
 * ХААЛГА: MGL AI унтраалттай, эсвэл захиалагчийн горим унтраалттай.
 *
 * ⚠️ 503 ба 403 нь ӨӨР утга: 503 = «түр зогсоосон», 403 = «эрхгүй».
 *    `entitlementGuard`-ийн модулийн 403-аас ч ялгаатай — тэр нь
 *    «худалдаж аваагүй».  Гурвыг холих нь дэмжлэгийн ажлыг гурав дахин
 *    нэмнэ.
 */
mglAi.use('*', async (c, next) => {
  const s = await getMglAiSettings(c.env.DB);
  if (!s.enabled) {
    return c.json({ error: 'MGL AI түр зогсоосон байна.', code: 'mglai_disabled' }, 503);
  }
  const identity = identityOf(c);
  if (identity.mode === 'denied') {
    return c.json({ error: 'Энэ хэсэгт хандах эрхгүй.', code: 'mglai_denied' }, 403);
  }
  if (identity.mode === 'client' && !s.clientMode) {
    return c.json(
      { error: 'Захиалагчийн горим идэвхгүй байна.', code: 'mglai_client_off' },
      503,
    );
  }
  return next();
});

/* ================================================================== */
/*  1. Оношилгоо ба сесс                                               */
/* ================================================================== */

mglAi.get('/health', async (c) => {
  const s = await getMglAiSettings(c.env.DB);
  const identity = identityOf(c);
  return c.json({
    product: MGL_AI_PRODUCT,
    display_name: displayName(),
    family: MGL_AI_FAMILY,
    version: MGL_AI_VERSION,
    system_prompt_version: MGL_AI_PROMPT_VERSION,
    tool_schema_version: MGL_AI_TOOL_SCHEMA_VERSION,
    retrieval_version: MGL_AI_RETRIEVAL_VERSION,
    default_context_tokens: DEFAULT_CONTEXT_TOKENS,
    mode: identity.mode,
    client_mode_enabled: s.clientMode,
    server_time_ub: nowInUBIso(),
  });
});

/**
 * Сессийн бүрэн зураг: хэн, ямар эрхтэй, ямар хэрэгсэлтэй, ямар загвар.
 * Frontend нь энэ нэг дуудлагаас чатыг бүтнээр нь тохируулна.
 */
mglAi.get('/session', async (c) => {
  const identity = identityOf(c);
  const s = await getMglAiSettings(c.env.DB);
  const profile = await loadProfile(c.env, identity.userId);

  const variant =
    identity.mode === 'client' ? MGL_AI_CLIENT_RUNTIME_VARIANT : MGL_AI_EMPLOYEE_RUNTIME_VARIANT;
  const release = await activeRelease(c.env, variant);

  return c.json({
    mode: identity.mode,
    user_id: identity.userId,
    role: identity.role,
    memory_namespace: identity.memoryNamespace,
    permissions: {
      revit_level: profile.revitLevel,
      erp_write_enabled: profile.erpWriteEnabled,
      roslyn_enabled: profile.roslynEnabled,
      max_tool_iterations: Math.min(profile.maxToolIterations, s.maxToolIterations),
      project_scope: profile.projectScope,
    },
    tools: toolsForMode(identity.mode).map((t) => ({
      name: t.name,
      description: t.descriptionMn,
      description_en: t.descriptionEn,
      kind: t.kind,
      params: t.params,
    })),
    model: {
      product: MGL_AI_PRODUCT,
      display_name: displayName(),
      family: MGL_AI_FAMILY,
      version: MGL_AI_VERSION,
      runtime_variant: variant,
      // ⚠️ Релиз БАЙХГҮЙ бол `null` — «суулгаагүй» гэдгийг frontend
      //    ил харуулна, хуурамч бэлэн байдал ҮЗҮҮЛЭХГҮЙ.
      release: release ?? null,
      context_tokens: s.contextTokens,
    },
    settings: {
      evidence_top_k: s.evidenceTopK,
      retention_days: s.retentionDays,
    },
  });
});

/* ================================================================== */
/*  2. Яриа                                                            */
/* ================================================================== */

mglAi.post('/conversations', async (c) => {
  const identity = identityOf(c);
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const convUid = str(body.conv_uid, 64) ?? uid('conv');
  const surfaceRaw = str(body.surface, 16);
  const surface = surfaceRaw === 'revit' || surfaceRaw === 'api' ? surfaceRaw : 'web';
  const title = str(body.title, 200);
  const projectId = Number.isInteger(body.project_id) ? (body.project_id as number) : null;

  // ⚠️ Идемпотент: add-in ба браузер хоёулаа дахин илгээдэг.  `conv_uid`
  //    нь UNIQUE тул `INSERT OR IGNORE` нь давхардлыг чимээгүй залгина.
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO ai_conversations
       (conv_uid, user_id, mode, project_id, surface, title, model_family,
        model_version, system_prompt_version, tool_schema_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(
      convUid,
      identity.userId,
      identity.mode,
      projectId,
      surface,
      title,
      MGL_AI_FAMILY,
      MGL_AI_VERSION,
      MGL_AI_PROMPT_VERSION,
      MGL_AI_TOOL_SCHEMA_VERSION,
    )
    .run();

  return c.json({ conv_uid: convUid, surface, created_at: nowInUBIso() });
});

mglAi.get('/conversations', async (c) => {
  const identity = identityOf(c);
  if (identity.userId === null) return c.json({ conversations: [] });

  const { results } = await c.env.DB.prepare(
    `SELECT conv_uid, title, surface, message_count, last_message_at, created_at
       FROM ai_conversations
      WHERE user_id = ? AND status = 'active'
      ORDER BY COALESCE(last_message_at, created_at) DESC
      LIMIT 50`,
  )
    .bind(identity.userId)
    .all();

  return c.json({ conversations: results ?? [] });
});

/**
 * Ярианы нэрийг солино.
 *
 * ⚠️ ЗӨВХӨН ЭЗЭН.  `ai_conversations`-д админы харах зам ЗОРИУД
 *    БАЙХГҮЙ — ярианы агуулга нь ажилтны хувийн ажлын орчин.  Санал
 *    хүсэлтээр ИЛГЭЭСЭН мөр л админд харагдана (`ai_feedback`), тэр нь
 *    хэрэглэгчийн ил зөвшөөрөл.
 */
mglAi.patch('/conversations/:convUid', async (c) => {
  const identity = identityOf(c);
  if (identity.userId === null) return c.json({ error: 'Нэвтрээгүй.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const title = str(body.title, 200);
  if (!title) return c.json({ error: 'title шаардлагатай.' }, 400);

  const res = await c.env.DB.prepare(
    `UPDATE ai_conversations SET title = ? WHERE conv_uid = ? AND user_id = ?`,
  )
    .bind(title, c.req.param('convUid'), identity.userId)
    .run();

  if (res.meta.changes === 0) return c.json({ error: 'Яриа олдсонгүй.' }, 404);
  return c.json({ ok: true, title });
});

/**
 * Яриаг архивлана.
 *
 * ⚠️ МӨРИЙГ УСТГАХГҮЙ, `status='archived'` болгоно.  Шалтгаан:
 *    `ai_feedback` нь `conv_uid`-аар холбогддог бөгөөд батлагдсан
 *    залруулга нь сургалтын багцын гарал үүсэл юм.  Яриаг устгавал
 *    «энэ жишээ хаанаас ирсэн бэ» гэсэн мөшгилт тасарна (§30).
 *
 * ⚠️ Мессежүүд нь ҮЛДЭНЭ.  Хэрэглэгчийн жагсаалтаас алга болно
 *    (`WHERE status = 'active'`), гэхдээ хадгалалтын бодлого
 *    (`mglai.retention_days`) нь тэднийг цэвэрлэх үүрэгтэй — энэ зам биш.
 */
mglAi.delete('/conversations/:convUid', async (c) => {
  const identity = identityOf(c);
  if (identity.userId === null) return c.json({ error: 'Нэвтрээгүй.' }, 401);

  const res = await c.env.DB.prepare(
    `UPDATE ai_conversations SET status = 'archived' WHERE conv_uid = ? AND user_id = ?`,
  )
    .bind(c.req.param('convUid'), identity.userId)
    .run();

  if (res.meta.changes === 0) return c.json({ error: 'Яриа олдсонгүй.' }, 404);
  return c.json({ ok: true });
});

/** ⚠️ Ярианы мессежийг ЗӨВХӨН эзэн нь уншина — админ ч биш. */
mglAi.get('/conversations/:convUid/messages', async (c) => {
  const identity = identityOf(c);
  const convUid = c.req.param('convUid');

  const conv = await c.env.DB.prepare(
    `SELECT user_id FROM ai_conversations WHERE conv_uid = ?`,
  )
    .bind(convUid)
    .first<{ user_id: number | null }>();

  if (!conv) return c.json({ error: 'Яриа олдсонгүй.' }, 404);
  if (conv.user_id !== identity.userId) {
    return c.json({ error: 'Энэ ярианд хандах эрхгүй.' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT msg_uid, seq, role, content, tool_name, citations_json, confidence,
            evidence_count, model_version, runtime_variant, first_token_ms, total_ms,
            error, created_at
       FROM ai_messages WHERE conv_uid = ? ORDER BY seq ASC, id ASC LIMIT 400`,
  )
    .bind(convUid)
    .all();

  return c.json({ conv_uid: convUid, messages: results ?? [] });
});

/* ================================================================== */
/*  3. КОНТЕКСТ — үндсэн угсралт                                       */
/* ================================================================== */

/**
 * Асуултыг УГСАРСАН prompt болгож буцаана.  Локал runtime үүнийг авч
 * токен үүсгэнэ.
 *
 * ⚠️ НУУЦЛАЛЫН ГЭРЭЭ: `filterEvidence` нь `assembleTurns`-аас ӨМНӨ
 *    дуудагдана.  Энэ дараалал нь энэ файлын ХАМГИЙН чухал мөр — сольвол
 *    нууц текст prompt-д орж, шүүлт нь дараа нь «хожуу» ажиллана.
 */
/* ================================================================== */
/*  3a. ТӨЛӨВЛӨГӨӨ — ХАМГИЙН ХЯМД АЛХАМ                                */
/* ================================================================== */

/**
 * `POST /plan` — асуултыг ХАЙЛТААС ӨМНӨ ангилна.
 *
 * ⚠️ ЯАГААД ТУСДАА ГАРЦ ВЭ.  Хоёр шалтгаан, хоёулаа хэмжигдсэн:
 *
 *   1. ХЭРЭГЛЭГЧ ЮУ БОЛЖ БАЙГААГ ХАРАХ ЁСТОЙ (§2, §17).  Өмнө нь чат нь
 *      `/context` дуустал ЮУ Ч харуулж чаддаггүй байсан — санаа, хэл,
 *      норм эсэх бүгд тэр нэг хариунд оршдог байв.  Энэ гарц нь ~5 мс-д
 *      буцдаг тул «Асуултыг норм дүрмийн асуулт гэж танилаа» гэсэн ПЕРВЫЙ
 *      бодит алхам шууд гарна.
 *
 *   2. ЛОКАЛ НОРМЫГ ЗЭРЭГ ДУУДАХЫН ТУЛД (§15, §17).  Норматив мэдлэг нь
 *      ажилтны PC дээр (CLAUDE.md §11) — Worker тийш хүрч чадахгүй.
 *      Хөтөч түүнийг дуудах ёстой, гэвч «дуудах эсэх» нь СЕРВЕРИЙН
 *      шийдвэр байх ёстой (§35).  Төлөвлөгөө нь тэр шийдвэрийг өгнө,
 *      дараа нь хөтөч норм + ERP хэрэгслийг ЗЭРЭГ гүйцэтгэнэ.
 *
 * ⚠️ ЭНД ХАЙЛТ ХИЙХГҮЙ, D1 РУУ ОРОХГҮЙ.  Ангилагчид бүгд ЦЭВЭР функц.
 *    Хэрэв энэ гарц удаан болвол тэр нь ямар нэг зүйл БУРУУ болсны
 *    шинж — хэмжүүр болгон ашигла.
 *
 * ⚠️ ЭНЭ НЬ `/context`-ЫГ ОРЛОХГҮЙ.  Prompt угсрах нь ХЭВЭЭР `/context`
 *    дээр — «угсралтын ЦОРЫН ГАНЦ газар» инвариант хэвээр.
 */
mglAi.post('/plan', async (c) => {
  const t0 = Date.now();
  const identity = identityOf(c);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const question = str(body.question, MAX_QUESTION_CHARS);
  if (!question) return c.json({ error: 'Асуулт хоосон байна.' }, 400);

  const visibleTools = toolsForMode(identity.mode).map((t) => t.name);

  // ── ЭЭЛЖИЙН ТАЙЛАЛ (ярианы кернел) ───────────────────────────────
  // ⚠️ `/context`-тэй ЯГ ИЖИЛ функц (`planTurn`) — хосын зөрүү үүсэхгүй.
  //    Хөтөч `conv_state`-ийг өмнөх `/context`-оос авч ХӨНДӨЛГҮЙ буцаана;
  //    сервер ариутгана.  Түүх ЭНД хэрэггүй — төлөв нь бүтэцтэй.
  // R3.5: Revit сонголтын тоо — engine `revit_context` байвал л илгээнэ; /context-тэй ижил утга.
  const revitSelection = typeof body.revit_selection === 'number' && body.revit_selection > 0 ? Math.min(Math.floor(body.revit_selection), 10_000) : 0;
  const plan = planTurn({
    question,
    rawState: body.conv_state,
    seq: typeof body.seq === 'number' ? body.seq : 0,
    lastAssistant: str(body.last_assistant, MAX_TEXT),
    visibleTools,
    revitSelection,
    revitReport: body.revit_report === true,
  });
  const { turn, lang, regulatory } = plan;
  const policy = turn.policy;

  // ── ДЕТЕРМИНИСТ НОРМЫН ХӨДӨЛГҮҮР (P0-5, Amendment B/E) — /context-тэй ИЖИЛ функц.
  //    Санаа CALCULATION/GENERAL_HELP байсан ч инженерийн оролт байвал ажиллана;
  //    хөдөлгүүр баримт сонгосон бол локал /norm-ыг тэр баримтад ЦООЖИЛНО.
  const engine = normEngineForTurn({
    question,
    normTaskText: plan.normTask?.text ?? null,
    intent: turn.intent,
    turnKind: turn.kind,
    state: plan.state,
    lang: lang.responseLanguage,
    registry: normRegistry(),
  });
  const askLocalNorm = plan.askLocalNorm || (engine.result !== null && engine.result.verification !== 'named_document_absent');

  // ── ОЛОН ШАТЛАЛТ СУДАЛГАА (§13, §16) ────────────────────────────
  // ⚠️ `round` ба `prior_results` нь хөтчөөс ирнэ.  Өмнөх үр дүн нь ЗӨВХӨН
  //    дараагийн хэрэгслийн аргумент (төслийн id) сонгоход хэрэглэгдэнэ —
  //    тэр id-г `/tool` өөрийн хаалгаар ДАХИН шалгана, тиймээс энд итгэх
  //    шаардлагагүй.  Хэрэгслийн төсөв нь профайлын `max_tool_iterations`.
  const round = Number.isInteger(body.round) ? Math.max(0, Math.min(MAX_ROUNDS - 1, body.round as number)) : 0;
  const prior: PriorToolResult[] = [];
  if (Array.isArray(body.prior_results)) {
    for (const raw of body.prior_results.slice(0, 16)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const name = str(r.tool, 64);
      if (!name || !isKnownTool(name)) continue;
      prior.push({
        tool: name,
        ok: r.ok === true,
        data: r.data ?? null,
        args: r.args && typeof r.args === 'object' ? (r.args as Record<string, unknown>) : undefined,
      });
    }
  }
  const profile = await loadProfile(c.env, identity.userId);
  const s = await getMglAiSettings(c.env.DB);
  const research = planResearch({
    question,
    plan,
    mode: identity.mode,
    visibleTools,
    round,
    prior,
    maxTools: Math.min(profile.maxToolIterations, s.maxToolIterations),
  });

  return c.json({
    request_id: str(body.request_id, 64),
    intent: turn.intent,
    intent_reason: turn.reason,
    /** Ээлжийн төрөл, даалгаврууд — UI-ийн «сэдэв» мөр ба оношилгоо. */
    turn: turnSummary(turn),
    response_language: lang.responseLanguage,
    detected_language: lang.language,
    language_explicit: lang.explicitRequest,
    /** Хариултын гүн (санамжгүй шийдвэр; /context санамжтай дахин шийднэ). */
    answer_depth: plan.depth,
    regulatory,
    evidence_required: policy.evidenceMandatory,
    needs_retrieval: policy.needsRetrieval,
    show_confidence: policy.showConfidenceBadge,
    /**
     * ⚠️ ЛОКАЛ НОРМЫН САНГ АСУУХ ЭСЭХ.  Хөтөч энэ тугийг л дагана —
     *    түлхүүр үгийн дүрмийг клиент дээр ДАВХАРДУУЛАХГҮЙ (хосын
     *    зөрүү нь энэ репогийн хамгийн түгээмэл алдаа).
     * ⚠️ Мэндчилгээ, мета асуултад `false` — тэдэнд норм хайх нь
     *    ХУУРАМЧ явц харуулах болно (§5).
     */
    ask_local_norm: askLocalNorm,
    /**
     * МЭДЛЭГИЙН САНГИЙН КАТАЛОГ (`lib/mglai/normCatalog.ts`, 2026-09-18) — «чамд ямар норм байгаа
     * вэ» / «УББ 12-01-01 юуны тухай вэ».  Хөтөч runtime `POST /norm/catalog`-ыг дуудаж үр дүнг
     * `/context`-д `norm_catalog`-оор өгнө; `/norm` хайлт энэ ээлжид асахгүй (`ask_local_norm` false).
     */
    ask_norm_catalog: plan.normCatalog === null ? null : { code: plan.normCatalog.kind === 'document' ? plan.normCatalog.code : null },
    /**
     * ⚠️ Локал `/norm`-д ЗӨВХӨН нормын даалгаврын текстийг өгнө.  Олон
     *    санаатай мессежийг бүхэлд нь өгвөл ERP-ийн үгс («төсөл»,
     *    «ажилтан») BM25-ыг хамааралгүй заалт руу татна.
     * ⚠️ Хөдөлгүүр баримт сонгосон бол кодоор угтварласан — локал хайлт
     *    тэр баримтад цоожлогдож, нотолгоо ба шийдвэр НЭГ баримтаас гарна.
     */
    norm_query: engine.normQuery,
    /** Хөдөлгүүрийн урьдчилсан төлөв — UI-ийн алхам («баталгаажсан дүрэм олдов»), оношилгоо. */
    norm_engine: engine.result
      ? { applicable: true, document: engine.result.documentCode, kind: engine.result.answerKind, verification: engine.result.verification }
      : { applicable: engine.applicable, document: null, kind: null, verification: null },
    /** ⚠️ Хөтөч эдгээрийг ЗЭРЭГ гүйцэтгэнэ (§15), дараалуулахгүй. */
    tools: research.tools,
    /** Судалгааны шат: `done` = дараагийн `/plan` дуудах хэрэггүй. */
    round,
    done: research.done,
    depth: research.depth,
    research_reason: research.reason,
    entities: research.entities,
    max_rounds: MAX_ROUNDS,
    /**
     * ЛОКАЛ САНАМЖИЙН ДОХИО (§34) — «цаашид богино хариулаарай» гэх мэт ИЛ
     * тохиргооны хүсэлт.  Сервер ТАНИНА, хөтөч ажилтны PC дээр ХАДГАЛНА;
     * Cloudflare руу хадгалагдахгүй.  Ихэнх асуултад хоосон.
     */
    memory_hints: identity.mode === 'client' ? [] : detectMemoryHints(question),
    plan_ms: Date.now() - t0,
    as_of: todayInUB(),
  });
});

/**
 * ЧАДВАРЫН КАТАЛОГ (§11) — ямар entity, талбар, хэрэгсэл байгааг
 * хэрэглэгчийн ГОРИМООР.  SQL, багана, хамрах хүрээний дүрэм ЭНД ГАРАХГҮЙ.
 */
mglAi.get('/capabilities', async (c) => {
  const identity = identityOf(c);
  return c.json({
    mode: identity.mode,
    entities: describeEntities(identity.mode),
    tools: toolsForMode(identity.mode).map((t) => ({
      name: t.name,
      description_mn: t.descriptionMn,
      kind: t.kind,
      params: t.params.map((p) => ({ name: p.name, type: p.type, required: p.required })),
      reads_live_erp: t.readsLiveErp === true,
    })),
    max_rounds: MAX_ROUNDS,
    as_of: todayInUB(),
  });
});

mglAi.post('/context', async (c) => {
  // ⚠️ ҮЕ ШАТНЫ ХУГАЦАА нь UI-ийн «явцын мөр»-ийг ҮНЭН болгодог (§5, §26).
  //    Хэрэглэгчид харуулах алхам бүр нь БОДИТ үйлдэлтэй таарах ёстой
  //    тул тэр үйлдлийн хугацааг сервер өөрөө хэмжиж буцаана — клиент
  //    таамаглахгүй.
  const tStart = Date.now();
  let tRetrieval = 0;
  let tNorm = 0;
  const identity = identityOf(c);
  const s = await getMglAiSettings(c.env.DB);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const question = str(body.question, MAX_QUESTION_CHARS);
  if (!question) return c.json({ error: 'Асуулт хоосон байна.' }, 400);

  const convUid = str(body.conv_uid, 64);
  const dataFreshness = str(body.data_freshness, 64);

  // ⚠️ REVIT КОНТЕКСТЫГ СЕРВЕР ШАХНА, add-in-д итгэхгүй.  Add-in нь
  //    500 элемент илгээж болно — `parseRevitContext` нь 25-аар таслаж,
  //    НИЙТ тоог үнэнээр хадгална (§22-ийн «context compression layer»).
  //    Хэрэв add-in бэлэн хураангуй илгээвэл түүнийг ч хүлээж авна, гэвч
  //    бүтэцтэй контекст нь давуу — тэр нь урт нь баталгаатай.
  const revitCtx = parseRevitContext(body.revit_context as never);
  const revitSummary = summarizeRevit(revitCtx) ?? str(body.revit_summary, 500);

  // ⚠️ ХЭРЭГСЛИЙН ҮР ДҮН — клиент нь `/tool`-оор ГҮЙЦЭТГЭЭД үр дүнг ЭНД
  //    буцааж өгнө, сервер нь prompt-д ШИГТГЭНЭ.  Клиент өөрөө prompt-д
  //    залгах нь `promptFrame.ts`-ийн «угсралтын ЦОРЫН ГАНЦ газар» гэсэн
  //    инвариантыг зөрчих ба хайрцаглалт, ариутгал алгасагдана
  //    (2026-09-08-нд яг тэр алдаа илэрсэн).
  //
  //    ⚠️ `data` нь СЕРВЕР өөрөө үүсгэсэн `/tool`-ийн гаралт учир найдвартай
  //    боловч дамжин ирсэн тул хэмжээгээр нь хязгаарлаж, `renderToolResults`
  //    дотор ариутгагдана.
  const rawToolResults: ToolOutcome[] = [];
  if (Array.isArray(body.tool_results)) {
    // ⚠️ Олон шатлалт судалгаа ≤ 8 хэрэгсэл + шүүлтгүй давталт → 12-оор тааз.
    for (const raw of body.tool_results.slice(0, 12)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const name = str(r.tool, 64);
      // ⚠️ Бүртгэлд БАЙХГҮЙ нэрийг хүлээж авахгүй — клиент дурын мөр
      //    шигтгэх зам болно.
      if (!name || !isKnownTool(name)) continue;
      rawToolResults.push({
        tool: name,
        ok: r.ok === true,
        data: r.data ?? null,
        error: str(r.error, 300),
      });
    }
  }
  // ⚠️ СОНГОСОН ЭЛЕМЕНТИЙН ХЭМЖЭЭ (R3.5) — СЕРВЕР үүсгэсэн синтетик хэрэгсэл: add-in-ийн
  //    `revit_context.selection[].measures` → `revit_selection` (prompt хайрцаг + revit_model баримт).
  //    Клиент энэ нэрийг `tool_results`-оор илгээж чадахгүй (`isKnownTool` шүүнэ).
  const revitTool = revitSelectionTool(revitCtx);
  if (revitTool) rawToolResults.push(revitTool);
  const revitReport = revitReportTool(revitCtx);
  if (revitReport) rawToolResults.push(revitReport);
  // ── МЭДЛЭГИЙН САНГИЙН КАТАЛОГ (2026-09-18, `lib/mglai/normCatalog.ts`) ────
  // ⚠️ «Чамд ямар норм байгаа вэ» / «X юуны тухай вэ» — сервер `/plan`-д `ask_norm_catalog`
  //    өгсөн, хөтөч ажилтны PC-ийн `POST /norm/catalog`-оос жагсаалт/бүтцийг ЭНД авчирна.
  //    Цагаан жагсаалтаар ариутгаад СИНТЕТИК хэрэгсэл (`revit_selection`-ийн ижил зам) болгоно:
  //    prompt-д хайрцаг, `groundingGuard`-д тоо, гэрээнд детерминист template.  Ирээгүй бол
  //    (runtime унтарсан, сан суулгаагүй) УНАСАН хэрэгсэл — загвар санахуйгаас жагсаалт зохиохгүй.
  const normCatalog = parseNormCatalog(body.norm_catalog);
  const catalogRetrieval = parseNormRetrieval(body.norm_catalog_retrieval, normCatalog !== null);
  // ⚠️ БҮТЭЦТЭЙ ТӨСӨВЛӨЛТ — JSON хагаслахгүй, `_truncated` гэж ИЛ тэмдэглэнэ
  //    (`lib/mglai/toolBudget.ts`).  Тайралтгүй бол ижил объектууд.
  const toolBudget = budgetToolResults(rawToolResults, TOOL_CHAR_BUDGET);
  const toolResults: ToolOutcome[] = toolBudget.results;

  // ── ЛОКАЛ НОРМЫН ХАРИУ (§17) ─────────────────────────────────────
  // ⚠️ Хөтөч ажилтны PC дээрх `POST /norm`-ыг дуудаад үр дүнг ЭНД
  //    авчирна.  Worker нь 127.0.0.1 руу хүрч ЧАДАХГҮЙ тул өөр зам
  //    БАЙХГҮЙ.  Клиент нь ТЭЭВЭР — ариутгал, шийдвэр нь СЕРВЕР дээр
  //    (`lib/mglai/localNorm.ts`-ийн толгойг үз).
  const localNorm = parseLocalNorm(body.norm_answer);
  // ХАЙЛТ АМЖСАН ЭСЭХ (P0-14) — «олдсонгүй» ба «хайлт унасан» хоёр өөр төлөв.
  //    Хөтөч `norm_retrieval: {attempted, reason}` илгээнэ; сервер цагаан жагсаалт.
  const normRetrieval = parseNormRetrieval(body.norm_retrieval, localNorm !== null);

  // ── ЛОКАЛ САНАМЖ (§34–36) ────────────────────────────────────────
  // ⚠️ Хөтөч зөвхөн ХАМААРАЛТАЙ санамжийг сонгож илгээнэ (`lib/memory.ts`);
  //    сервер төрөл, урт, тоог АРИУТГАНА.  Захиалагчийн горимд огт авахгүй.
  const localMemory = identity.mode === 'client' ? [] : sanitizeMemory(body.local_memory);

  const rawHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  if (Array.isArray(body.history)) {
    for (const h of body.history.slice(-MAX_HISTORY_TURNS)) {
      if (!h || typeof h !== 'object') continue;
      const r = (h as Record<string, unknown>).role;
      const content = str((h as Record<string, unknown>).content, MAX_TEXT);
      if ((r === 'user' || r === 'assistant') && content) rawHistory.push({ role: r, content });
    }
  }

  const viewer = await resolveViewer(c.env, identity);
  const profile = await loadProfile(c.env, identity.userId);

  // ── 0. ЭЭЛЖИЙН ТАЙЛАЛ — хэл, санаа, сэдэв, даалгавар (ярианы кернел) ─
  // ⚠️ Хоёуланг нь ЗАГВАРТ ДААЛГАХГҮЙ.  Загвар латин монголыг англи гэж
  //    үзээд англиар хариулдаг, мөн нормын асуултыг «энгийн» гэж
  //    ангилаад шаардлага зохиодог байв.  Хоёулаа хэмжигдсэн алдаа.
  // ⚠️ `/plan`-тай ЯГ ИЖИЛ `planTurn` — ээлжийн төрөл, сэдэв, даалгавар
  //    хоёр газар зөрөхгүй.  Түүх нь ЯРИАНЫ ТҮҮХ, PROMPT-ЫН КОНТЕКСТ БИШ:
  //    доор `selectHistory` нь ээлжийн төрлөөр хэдийг, хэр урт оруулахыг
  //    шийднэ (шинэ сэдэвт ОГТ оруулахгүй).
  const seq = typeof body.seq === 'number' ? body.seq : rawHistory.length;
  const lastAssistant = [...rawHistory].reverse().find((h) => h.role === 'assistant')?.content ?? null;
  const visibleToolNames = toolsForMode(identity.mode).map((t) => t.name);
  const tPlanStart = Date.now();
  const plan = planTurn({
    question,
    rawState: body.conv_state,
    seq,
    lastAssistant,
    visibleTools: visibleToolNames,
    revitSelection: revitCtx.selectionTotal,
    revitReport: revitCtx.report !== null,
  });
  const tRouting = Date.now() - tPlanStart;
  const { turn, regulatory } = plan;
  // ⚠️ НОРМ-ЗӨВХӨН ээлжид Revit-ийн контекст (сонгосон элемент, тайлан, дэлгэц) prompt-д ОРОХГҮЙ — norm answer-т Revit view /
  //    family / parameter холилдохыг бүтцээр хаана.  ERP хэрэгсэл `planTurn`-д аль хэдийн хаалттай.
  const normOnly = isNormOnlyTurn(turn);
  if (normOnly) for (let i = toolResults.length - 1; i >= 0; i--) if (toolResults[i]!.tool.startsWith('revit_')) toolResults.splice(i, 1);
  const revitSummaryUse = normOnly ? null : revitSummary;
  // ⚠️ ХАДГАЛСАН ХЭЛНИЙ ТОХИРГОО (§34–36).  «Цаашид англиар хариулаарай» гэж
  //    ХАДГАЛСАН санамж нь prompt-д зөвхөн мөр болж орж, харин `response_language`
  //    нь асуултын хэлээр л шийдэгддэг байв — тиймээс монгол асуултад загвар
  //    англиар бичсэн ч хэлний засвар түүнийг монгол руу БУЦААДАГ байв (held-out
  //    H35, 2026-09-10).  Асуултын дотор ИЛ хүсэлт («монголоор хариул») байвал
  //    тэр нь санамжаас ДЭЭГҮҮР; эс бөгөөс санамж хэлийг шийднэ.
  const memoryLang = memoryResponseLanguage(localMemory);
  const lang =
    memoryLang !== null && !plan.lang.explicitRequest
      ? { ...plan.lang, responseLanguage: memoryLang }
      : plan.lang;
  // ХАРИУЛТЫН ГҮН — хадгалсан `answer_length` санамжтай (ил хүсэлт санамжаас дээгүүр).
  const depth = decideDepth({
    question,
    intent: turn.intent,
    taskCount: turn.tasks.length,
    regulatory,
    preferredLength: memoryAnswerLength(localMemory),
    catalog: plan.normCatalog?.kind ?? null,
  });
  const intent = turn.intent;
  const policy = turn.policy;
  // Каталогийн хэрэгсэл — хэл шийдэгдсэний ДАРАА (шошго хэлээр).  `plan.normCatalog` нь /plan-тай
  //    ИЖИЛ функцээс; хөтөч асуугаагүй ээлжид ирсэн `norm_catalog`-ыг ХАЯНА (хосын зөрүү = хаягдана).
  const catalogAsked = plan.normCatalog !== null;
  if (catalogAsked && normCatalog !== null) toolResults.push(normCatalogTool(normCatalog, lang.responseLanguage));
  else if (catalogAsked && catalogRetrieval.attempted) toolResults.push(normCatalogUnavailableTool(catalogRetrieval.reason, lang.responseLanguage));

  // ── 1. Хайлт (шүүлтгүй) ──────────────────────────────────────────
  // ⚠️ Санаа нь хайлт шаарддаггүй бол ОГТ хайхгүй — мэндчилгээнд
  //    хайлт хийх нь хэрэггүй саатал (§4).
  // ⚠️ ЛАТИН МОНГОЛЫГ ХЭВИЙЖҮҮЛЖ хайна: «tusul» гэж хайвал юу ч олдохгүй,
  //    «төсөл» гэж хайвал олдоно (§9).
  // ── 2b. ДЕТЕРМИНИСТ НОРМЫН ХӨДӨЛГҮҮР (P0-5…P0-10) ────────────────
  //
  // ⚠️ ЗАГВАР АНГИЛАЛ, ТОО, ЭШЛЭЛ СОНГОХГҮЙ.  `normEngineForTurn` (/plan-тай
  //    ЯГ ИЖИЛ) хөрвүүлсэн бүртгэлээс дүрэм/томьёог сонгож, TrustedNormResult
  //    үүсгэнэ — утга + баримт + бичлэг + хуудас + баталгаажилт НЭГ объектоор.
  //    Ээлж бүрд ЯГ НЭГ: энд үүсгэж гарын үсэг зурна, /messages ТЭР объектыг
  //    л хүлээн авна (Amendment B).  D1-ийн `norm_threshold_rules` (0276) уншилт
  //    ХАСАГДСАН — ижил 4 мөр бүртгэлд байгаа, хоёр эх сурвалж зөрөхгүй.
  const tNormStart = Date.now();
  const engine = normEngineForTurn({
    question,
    normTaskText: plan.normTask?.text ?? null,
    intent: turn.intent,
    turnKind: turn.kind,
    state: plan.state,
    lang: lang.responseLanguage,
    registry: normRegistry(),
  });
  let trustedNorm: TrustedNormResult | null = engine.result;
  // ⚠️ Нэрлэсэн баримт бүртгэлд байхгүй + локал runtime «санд байхгүй» гэж БАТАЛСАН →
  //    детерминист татгалзал (нэрлэсэн баримт санд алга).  Локал санд БАЙВАЛ (БНбД 21-04-05)
  //    хөдөлгүүр дуугүй, нотолгоо тэр баримтаас цоожтой ирнэ; хайлт УНАСАН бол
  //    «амжсангүй» (доорх `norm_unavailable`), «байхгүй» гэж хэлэхгүй.
  if (trustedNorm === null && engine.namedOutsideRegistry !== null && localNorm?.namedDocument?.absent === true) {
    trustedNorm = namedDocumentAbsentResult(localNorm.namedDocument.code ?? engine.namedOutsideRegistry);
  }
  // Локал хайлт УНАСАН ба хөдөлгүүр ч дүрэм олоогүй бол — «олдсонгүй» биш «амжсангүй».
  // Amendment A — хувилбарын зөрүү: нэг баримтын ӨӨР хувилбар бол эрх бүхий БИШ.
  const drift = checkDrift(trustedNorm, localNorm);
  if (trustedNorm !== null) trustedNorm = applyDrift(trustedNorm, drift);
  const normDecision: NormDecision | null = trustedNorm === null ? null : legacyDecisionView(trustedNorm);
  tNorm = Date.now() - tNormStart;
  // Түүх — ээлжийн төрлөөр; детерминист үр дүнтэй ээлжид өмнөх ХАРИУЛТ орохгүй (P0-13).
  const history = selectHistory(rawHistory, turn, { dropAssistant: trustedNorm !== null });

  const tRetrievalStart = Date.now();
  const d1Evidence: Evidence[] = policy.needsRetrieval
    ? await lexicalSearch(c.env, searchText(plan.searchQuestion, lang), {
        limit: Math.max(12, s.evidenceTopK * 4),
        // Захиалагч нь компанийн баримтыг хайхгүй — SQL түвшинд нарийсгах нь
        // гүйцэтгэлийн оновчлол, аюулгүй байдлын шийдвэр БИШ (тэр нь доор).
        sourceKinds: identity.mode === 'client' ? ['regulation'] : undefined,
      })
    : [];
  tRetrieval = Date.now() - tRetrievalStart;

  // ⚠️ ЛОКАЛ ЗААЛТ НЬ D1-ИЙН ӨМНӨ ОРНО.  Хэмжигдсэн (2026-09-09):
  //    `ai_knowledge_chunks` нь БҮХ орчинд 0 мөртэй, харин локал сан нь
  //    172 хэсэг, 155 дүрэмтэй бөгөөд §17-ийн асуултад 16 мс-д зөв
  //    заалт (УББ 12-01-01, 2.5) буцаадаг.  Тиймээс өнөөдөр нормын
  //    нотолгооны ЦОРЫН ГАНЦ бодит эх сурвалж нь энэ хөл.  D1 хөл нь
  //    ҮЛДЭНЭ — компанийн дотоод баримт шингээгдэхэд тэр ажиллана.
  // ⚠️ ДЕТЕРМИНИСТ ШИЙДВЭР ГАРСАН БОЛ ЛОКАЛ ЗААЛТЫГ ОРУУЛАХГҮЙ.
  //
  //    Шалтгаан нь ХЭМЖИГДСЭН (2026-09-09).  Локал хайлт нь RRF-ийн
  //    зэрэглэлээр оноо өгдөг тул ХАМААРАЛГҮЙ асуултад ч ҮРГЭЛЖ дээд
  //    5 заалтаа буцаана — оноо нь (0.0164, 0.0161, …) хамаарлыг
  //    ЯЛГАДАГГҮЙ, зөвхөн эрэмбийг илэрхийлнэ.  Жишээ нь «g=1800 MJ/m²
  //    бол В2 юу» гэсэн галын асуултад «УББ 12-01-01, заалт 1.8
  //    (Нийтлэг үндэслэл)» гэсэн огт хамаарахгүй заалт `supported`
  //    төлөвтэй буцдаг.
  //
  //    Тэр асуултын ҮНЭН хариу нь үүсгэсэн бүртгэлд байгаа бөгөөд
  //    `runNormEngine` (TrustedNormResult) түүнийг АЛЬ ХЭДИЙН шийдсэн байна.  Тиймээс
  //    шийдвэр гарсан үед хамааралгүй заалт нэмэх нь 4B загварыг
  //    төөрүүлэх ЦЭВЭР эрсдэл — ашиг тус нь тэг.
  //
  //    Шийдвэр ГАРААГҮЙ үед (§17-ийн асуулт) локал заалт нь нотолгооны
  //    ЦОРЫН ГАНЦ бодит эх сурвалж хэвээр.
  // ⚠️ TrustedNormResult байвал локал нотолгоог ЗӨВХӨН ТЭР БАРИМТААС (өөр баримтын
  //    текст эрх бүхий үр дүнтэй ХЭЗЭЭ Ч холилдохгүй); хувилбар зөрсөн эсвэл нэрлэсэн
  //    баримт байхгүй бол огт хэрэглэхгүй.  Хүний хяналттай/render-review хэсэг
  //    (транскрипцийн мета-тэмдэглэл) prompt-д энгийн нотолгоо мэт орохгүй.
  // ── L1 БАРИМТ ОЛОХ (2026-09-18, `lib/mglai/normDocuments.ts`) ────────
  // ⚠️ «Цахилгаантай холбоотой өндөр барилгын норм юу вэ?» гэсэн ОЛОХ асуултад загвар санахуйгаас
  //    нэг норм таамагладаг байв.  Runtime `/norm` → `registry.topic_router` (сэдэв → БҮХ хамаарах
  //    баримт, код/нэр/албан холбоос/төлөв) нь одоо СИНТЕТИК хэрэгсэл `norm_documents` болж prompt-д,
  //    детерминист template + баримт болж гэрээнд орно.  Детерминист шийдвэр (trustedNorm) гарсан
  //    эсвэл техникийн утга асуусан ээлжид ХЭЗЭЭ Ч асахгүй — заалтын зам хэвээр.  Олох горимд
  //    заалтын нотолгоо prompt-д ОРОХГҮЙ: энэ давхарга баримт олно, заалт тайлбарлахгүй.
  const discoveryRoute = localNorm?.registry?.topicRouter ?? null;
  const discoveryAsk = discoveryRoute !== null && discoveryRoute.results.length > 0 && isDocumentDiscoveryQuestion(question);
  // ⚠️ ЭРХ БҮХИЙ БИШ хөдөлгүүрийн үр дүн («баталгаажсан заалт олдсонгүй, хамгийн ойр 5.1 …» — GOLD бүртгэлд
  //    байгаа баримтын сэдэв: сургууль/цэцэрлэг/гал) олох асуултад ЖАГСААЛТЫГ дарж байв (хэмжсэн 2026-09-18,
  //    «Сургуулийн барилгад ямар норм дүрэм хамаарах вэ?»).  Эрх бүхий (тооцоо/ангилал/нэрлэсэн баримт алга)
  //    үр дүн л жагсаалтаас дээгүүр; нэрлэсэн кодтой асуулт тоо агуулдаг тул олох асуулт болдоггүй.
  if (discoveryAsk && trustedNorm !== null && !trustedNorm.authoritative && trustedNorm.verification !== 'named_document_absent') trustedNorm = null;
  const normDocuments = trustedNorm === null && discoveryAsk ? normDocumentsData(discoveryRoute, lang.responseLanguage, question) : null;
  if (normDocuments !== null && discoveryRoute !== null) {
    const t = normDocumentsTool(discoveryRoute, lang.responseLanguage);
    if (t) toolResults.push(t);
  }
  const normDocumentsContract = normDocuments === null
    ? null
    : { count: normDocuments.count, template: renderNormDocuments(normDocuments, lang.responseLanguage), trailer: normDocumentsTrailer(normDocuments, lang.responseLanguage) };

  // ⚠️ «УББ 12-01-01-ийн 9.7 заалт?» — баримт санд БАЙГАА ч тийм заалт АЛГА (`clause_not_in_named_document`).
  //    Runtime тэр үед ойролцоо 3–5 хэсэг буцаадаг; тэднийг нотолгоо болговол гэрээ grounded болж, загвар
  //    «9.7 заалт» гэж ӨӨР заалтын агуулгаар хариулдаг байв (хэмжсэн 2026-09-18, прод).  Нотолгоогүй =
  //    татгалзал; тайлбарыг trailer-ээр (доор `withLocalNorm`).
  const clauseAbsent = localNorm !== null && localNorm.noMatchReason === 'clause_not_in_named_document';
  // ⚠️ ОЛОХ АСУУЛТЫН СЭДЭВ САНД АЛГА (2026-09-23, эзний HL08, `missingDiscoverySubject`) — «avto ugaalgiin gazar barih
  //    gej bna. barilgad ni ymar norm shaardlaga bdag ve»: чиглүүлэгч сэдэв олоогүй, харин локал хайлт ерөнхий үгсээр
  //    («барилга», «барих», «газар», «шаардлага») БНбД 31-17-10-ийн 6.1-ийг `supported` гэж буцааж, «хамгийн ойр заалт»
  //    хариулт болж байв.  Асуултын сэдвийн үг нотолгоонд огт байхгүй бол заалтыг ХАРУУЛАХГҮЙ — «санд алга» гэж
  //    шударга хэлнэ (`withSubjectAbsent`, гэрээний ЭЦСИЙН давхарга).  Сэдэвгүй («Барилгад ямар норм байдаг вэ?») эсвэл
  //    сэдэв нь нотолгоонд байгаа асуулт ХӨНДӨГДӨХГҮЙ.
  const subjectMissing =
    // Каталогийн асуулт («хамгийн хэцүү норм», «ямар норм байгаа вэ») — сангийн жагсаалт өөрөө хариулт; «санд алга» биш.
    !catalogAsked && discoveryRoute !== null && discoveryRoute.results.length === 0 && trustedNorm === null && localNorm !== null && !clauseAbsent && isDocumentDiscoveryQuestion(question)
      ? missingDiscoverySubject(question, localNorm.evidence.map((e) => e.textMn))
      : null;
  const localUsable =
    normDocuments === null &&
    localNorm !== null &&
    !clauseAbsent &&
    subjectMissing === null &&
    drift.status !== 'mismatch' &&
    (trustedNorm === null || (trustedNorm.verification !== 'named_document_absent' && trustedNorm.documentCode !== null));
  const localEvidence: Evidence[] = localUsable && localNorm
    ? localNormEvidence(localNorm, { onlyDocument: trustedNorm?.documentCode ?? null, dropReviewFlagged: true, sameDoc: (x, y) => foldCode(x) === foldCode(y) })
    : [];
  const useLocalNorm = localEvidence.length > 0;
  const raw: Evidence[] = normDocuments === null ? [...localEvidence, ...d1Evidence] : [];

  // ── 2. ШҮҮЛТ — prompt угсрахаас ӨМНӨ ─────────────────────────────
  const filtered = filterEvidence(raw, viewer);
  const evidence = budgetEvidence(filtered.kept, EVIDENCE_CHAR_BUDGET).slice(0, s.evidenceTopK);


  // ⚠️ ШИЙДВЭРИЙН БЛОК НЬ ЗӨВХӨН D1-ИЙН БОСГЫН ДҮРМИЙНХ.  Локал заалтыг
  //    энд оруулах оролдлого 2026-09-09-нд ХЭМЖИГДСЭН БАЙДЛААР УНАВ:
  //    `promptFrame`-ийн тэр салаа нь «1) Ангилал 2) Муж 3) Нэмэлт
  //    шалгалт» гэсэн g-утгын загварыг тулгадаг тул үүргийн заалт дээр
  //    гажсан хариу гаргаж байсан.  Локал заалт нь НОТОЛГОО болж орно
  //    (`localNormEvidence` дээр), тэр нь §17-д хангалттай.
  const decisionBlock = trustedNorm === null ? null : renderTrustedNorm(trustedNorm);

  // ── 3. Заалтын баталгаажилт ──────────────────────────────────────
  const clauseUids = evidence.map((e) => e.clauseUid).filter((u): u is string => !!u);
  const verificationStates = await clauseVerificationStates(c.env, clauseUids);

  // ── 4. Угсралт ───────────────────────────────────────────────────
  // ── АЖИЛТНЫГ ТАНИХ (§18) ────────────────────────────────────────
  // ⚠️ ЗӨВХӨН ажилтан/админд.  Захиалагчид нэр, баг, ачаалал ОГТ
  //    хамаагүй бөгөөд түүнийг prompt-д тавих нь дотоод мэдээллийг
  //    гоожуулах шинэ гадаргуу нээнэ.
  // ⚠️ Энэ нь ЭРХИЙН шийдвэрт ОРОЛЦОХГҮЙ — `filterEvidence` нь
  //    `identity`-д тулгуурладаг хэвээр.  Persona нь prompt-ын чимэг.
  // ⚠️ PERSONA ЗӨВХӨН ХЭРЭГТЭЙ ҮЕД (identity гоожилтын засвар).  Өмнө нь
  //    нэр, албан тушаал, баг, Revit эрх асуулт бүрд prompt-д орж, загвар
  //    хариулж чадахгүй үедээ тэдгээрийг ДҮҮРГЭГЧ болгон давтдаг байв.
  //    `personaPolicy` нь «өөрийнхөө тухай асуусан», «мэндчилгээ»,
  //    «get_my_assignments» гэсэн гурван тохиолдолд Л зөвшөөрнө.
  const pPolicy = personaPolicy({
    intent,
    question,
    plannedTools: toolResults.map((t) => t.tool),
  });
  const persona =
    identity.mode === 'client' || identity.userId === null || pPolicy === 'none'
      ? null
      : await loadPersona(c.env, identity.userId);
  const showRevitLevel = revitLevelVisible(intent, revitSummaryUse !== null);

  const turns = assembleTurns({
    system: {
      mode: identity.mode,
      userName: personaText(persona, pPolicy),
      revitSummary: revitSummaryUse,
      dataFreshness,
      revitLevel: identity.mode === 'client' || !showRevitLevel ? null : profile.revitLevel,
      subjectLine: subjectLine(turn),
      normTaskIndex: plan.normTaskIndex,
      userPreferences: localMemory.map((m) => m.text),
      depth: depth.depth,
      // ⚠️ ХЭЛ, САНААГ ЗААВАЛ ДАМЖУУЛНА.  Эдгээргүйгээр prompt нь
      //    өгөгдмөл рүү унаж, латин монгол дахин англи хариу авна.
      responseLanguage: lang.responseLanguage,
      intent,
      evidenceMandatory: policy.evidenceMandatory,
      // Amendment D: зөвхөн ШИЙДВЭРТ НӨЛӨӨЛӨХ төлөвт (солигдсон/түүхэн/хүний хяналт) — «хуучин» гэж дуудахгүй.
      legalReviewRequired:
        useLocalNorm && localNorm !== null && trustedNorm === null && legalReviewRequiredFor(localNorm.currentness),
    },
    history,
    question,
    // Латин монгол асуултын серверээр хэвийжүүлсэн туслах хувилбар —
    // model-д эх асуултын хажууд очно; англи/кирилл асуултад огт нэмэгдэхгүй.
    normalizedQuestion:
      (lang.language === 'mn-Latn' || lang.language === 'mixed') && lang.normalized !== question
        ? lang.normalized
        : null,
    evidence,
    // ⚠️ Ангиллыг СЕРВЕР өгнө — 4B загвар «эвакуацын гарц» гэх мэт
    //    асуултыг «бусад» гэж андуурч, нотолгоогүй атлаа шаардлагыг
    //    зохиож байсан (2026-09-08).
    regulatory,
    toolResults,
    asOf: todayInUB(),
    // ⚠️ ЭРХ БҮХИЙ ШИЙДВЭР — загвар түүнийг ӨӨРЧИЛЖ БОЛОХГҮЙ.
    normDecision: decisionBlock,
    // Олон даалгавар — хэрэглэгчийн ээлж «Асуулт 1/2» болж хуваагдана.
    tasks: turn.kind === 'MULTI_INTENT' ? turn.tasks.map((t) => t.text) : undefined,
  });

  const variant = identity.mode === 'client' ? 'client-lite' : 'employee-4b-q4';

  // Каталогийн гэрээ — guard-ын ДАРАА (guard хайрцгийн тоог зөвшөөрч grounded болгосон байна):
  //    JSON хайрцгийн оронд хүний уншдаг детерминист template, нэг баримтад төлөвийн trailer.
  // Локал нормын ээлжийн ДЕТЕРМИНИСТ template (`localNormTemplate`) — өмнө нь composeTemplate төлөвийн enum
  //    («NEEDS_HUMAN_REVIEW», «CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED») бичиж, загвар унахад тэр нь хариулт
  //    болж гарч байв.  Детерминист хөдөлгүүрийн үр дүн (trustedNorm) байвал ХӨНДӨХГҮЙ — тэр өөрийн template-тэй.
  // ⚠️ НЭГ УДАА угсарна: текст нь гэрээний template, харуулсан заалт нь ДАРААГИЙН ээлжийн зангуу (доор convState).
  const localComposed =
    localNorm !== null && trustedNorm === null && !clauseAbsent && useLocalNorm
      ? composeLocalNorm(localNorm, lang.responseLanguage, question, { followUp: turn.kind === 'FOLLOW_UP' })
      : null;
  const withLocalNorm = (contract: TrustedContract): TrustedContract => {
    if (localNorm === null || trustedNorm !== null) return contract;
    if (clauseAbsent) {
      const code = localNorm.namedDocument?.code ?? localNorm.documentCode ?? null;
      const note =
        lang.responseLanguage === 'en'
          ? `${code ?? 'The named document'} is in the knowledge base, but it has no clause with that number — please check the clause number.`
          : `${code ?? 'Нэрлэсэн баримт'} санд байгаа боловч ийм дугаартай заалт түүнд алга — заалтын дугаараа шалгана уу.`;
      // Тэмдэглэл ЗӨВХӨН template-д — трейлерт ч тавьбал `fallbackAnswer` хоёр удаа хэвлэдэг (хэмжсэн 2026-09-18).
      return { ...contract, template: contract.template ? `${contract.template}\n\n${note}` : note, reason: `${contract.reason} · clause_not_in_named_document` };
    }
    if (!useLocalNorm) return contract;
    const t = localComposed?.text ?? null;
    if (t === null) return contract;
    // Трейлерийг template-д ОРУУЛАХГҮЙ — validator-ын `fallbackAnswer`/`templateOnly` зам өөрөө залгадаг
    //    (хэмжсэн: давхар «Анхаар: …» гарч байв).
    const tail = '';
    // Хүснэгтийн ДЕТЕРМИНИСТ шийдвэр (ГУАТ/ГМДХ verified) — загвар оролцохгүй (`templateOnly`): галын
    //    аюулгүй байдлын «шаардлагатай/шаардлагагүй» гэсэн хоёр үгийг загвар урвуулж болохгүй.  Заалтын
    //    текстийн (supported) хариултад загвар найруулсаар байна — тоо/эшлэлийг гэрээ барина.
    // `uncertain` (дүрэм олдсон ч оролт дутуу / хамаарал сул) — загварт өгвөл хамааралгүй мөрөөс бүтэц
    //    ЗОХИОДОГ (хэмжсэн: «Гишгүүрийн өндөр» → «галын аюулын ангиллаас хамаарна, ГМДХ 28 м…»); тиймээс
    //    «хамгийн ойр заалт + ямар утга дутуу» гэсэн детерминист хариулт л.
    const deterministic = localNormDeterministic(localNorm, question);
    return { ...contract, template: `${t}${tail}`, ...(deterministic ? { templateOnly: true } : {}), reason: `${contract.reason} · local_norm_template${deterministic ? ':only' : ''}` };
  };
  // Олох асуултын сэдэв санд алга (дээрх `subjectMissing`) — ЭЦСИЙН давхарга: L2/локал загвар юу ч бичсэн дарна.
  //    Загвар оролцохгүй (`templateOnly`): «санд алга» гэснийхээ ард шаардлага зохиох нь яг засах гэсэн гажиг.
  const withSubjectAbsent = (contract: TrustedContract): TrustedContract => {
    if (subjectMissing === null) return contract;
    const t = discoverySubjectAbsentText(lang.responseLanguage);
    return {
      ...contract,
      answerMode: 'refusal',
      risk: 'high',
      allowedNumbers: [],
      requiredSentence: t.sentence,
      template: t.text,
      templateOnly: true,
      trailerText: null,
      noMatch: true,
      reason: `${contract.reason} · discovery_subject_absent`,
    };
  };
  // ── L2 НОРМ ОЙЛГОХ ДАВХАРГА (2026-09-18, `lib/mglai/normExplain.ts`, эхлээд зөвхөн БНбД 31-17-10) ──
  // Runtime `/norm.explanation` (заалт олсон хэсгийн L2 бичлэг: эх бичвэр + семантик хүрээ + энгийн тайлбар
  //    + тоо эхийн хэлбэрээр + эх сурвалж) → детерминист загвар (`templateOnly`).  Хэрэглэгдэх нөхцөл: локал
  //    нотолгоо энэ ээлжид ашиглагдсан (эсвэл хэсэг/баримтын тойм), детерминист хөдөлгүүрийн үр дүн (trustedNorm)
  //    ба L1 олох горим байхгүй, нэрлэсэн заалт баримтад бий.  Тооцоо/ангилал асуусан бол загвар СОЛИГДОХГҮЙ —
  //    `withExplanation` зөвхөн «L2 тооцоо хийхгүй» трейлер нэмнэ.
  const l2 = localNorm?.explanation ?? null;
  const l2Applies = l2 !== null && trustedNorm === null && normDocuments === null && !clauseAbsent && drift.status !== 'mismatch' && (useLocalNorm || l2.mode === 'section' || l2.mode === 'document' || l2.mode === 'table' || l2.mode === 'formula' || l2.mode === 'classification');
  const withL2 = (contract: TrustedContract): TrustedContract => (l2Applies && l2 !== null ? withExplanation(contract, l2, lang.responseLanguage, question) : contract);
  // Хөнгөн яриа / мета / нормын ойлголт — детерминист хариулт (`smallTalk.ts`), загвар оролцохгүй.
  //    Олон даалгавартай ээлжид (MULTI_INTENT) хөндөхгүй — тэнд асуултын нэг хэсэг л мэндчилгээ.
  const smallTalkKind = turn.kind === 'MULTI_INTENT' ? null : detectSmallTalk(question);
  const withSmallTalk = (contract: TrustedContract): TrustedContract => {
    if (smallTalkKind === null) return contract;
    const reply = smallTalkReply(smallTalkKind, question, lang.responseLanguage);
    return { ...contract, answerMode: contract.answerMode === 'free' ? 'grounded' : contract.answerMode, template: reply.text, templateOnly: true, trailerText: null, reason: `${contract.reason} · small_talk:${reply.kind}` };
  };
  const withCatalog = (contract: TrustedContract): TrustedContract =>
    !catalogAsked
      ? contract
      : normCatalog !== null
        ? withNormCatalog(contract, normCatalog, lang.responseLanguage, plan.normCatalog)
        : catalogRetrieval.attempted
          ? withNormCatalogUnavailable(contract, catalogRetrieval.reason, lang.responseLanguage)
          : contract;
  // ⚠️ L2-ЫН «ХАМГИЙН ОЙР ЗААЛТ» НЬ ХАЙЛТЫН ТОЛГОЙ БАРИМТЫНХ БАЙХ ЁСТОЙ (2026-09-23, эзний HL05, прод дахин шалгалт).
  //    Runtime нотолгооны АЛЬ Ч байрнаас L2 багцтай (БНбД 31-17-10 / 20-04-17) эхний хэсгийг тайлбарладаг тул «solongos
  //    kompani manai tosliin zurgiig hiij boloh uu?» асуултад толгой нь БНбД 11-03-02 (гадаадын байгууллагын зураг
  //    төсөл) атал 3-р байрны 31-17-10-ийн 3.9 (өндөр барилгын магадлал) хариултыг БҮХЭЛД нь сольж байв.  Заалт
  //    нэрлээгүй (`nearest_clause`) тайлбар толгой баримтаас ӨӨР бол хэрэглэхгүй — локал хариулт, төлөв хэвээр.
  const l2OffHead =
    l2 !== null &&
    l2.mode === 'nearest_clause' &&
    localNorm !== null &&
    foldCode(l2.code) !== foldCode(localNorm.evidence[0]?.code ?? localNorm.documentCode ?? '');
  const l2Effective = l2Applies && !l2OffHead;
  const withL2Scoped = (contract: TrustedContract): TrustedContract => (l2OffHead ? contract : withL2(contract));

  // ── ДАРААГИЙН ЭЭЛЖИЙН ТӨЛӨВ ─────────────────────────────────────
  // ⚠️ Хөтөч үүнийг ХӨНДӨЛГҮЙ хадгалж, дараагийн `/plan` + `/context`-д
  //    буцааж өгнө.  Сэдэв нь хэрэгслийн БОДИТ үр дүнгээс тогтоно
  //    («хамгийн ойр deadline» → эхний төсөл), загварын текстээс БИШ.
  const convStateNext = advanceState({
    state: plan.state,
    turn,
    toolResults: toolResults.map((t) => ({ tool: t.tool, ok: t.ok, data: t.data })),
    seq,
    question,
    // P0-13: нормын оролт/баримт/үр дүнгийн хураангуй — дараагийн follow-up-д.
    norm: engine.applicable ? normTurnStateFrom(engine.entities, trustedNorm, turn.kind === 'NEW_TOPIC' || turn.kind === 'MULTI_INTENT' ? null : plan.state.norm, seq) : undefined,
  });
  // L2 (2026-09-18): тайлбарласан баримт/заалтыг төлөвт — «энэ юу гэсэн үг вэ?», «ямар нөхцөлд?» гэсэн
  //    дараагийн асуулт ИЖИЛ баримт, ИЖИЛ заалт руу (`turnEngine.normQuery` угтварлана).  Хөдөлгүүр хамаарахгүй
  //    (кодгүй асуулт, хайлтаар олдсон заалт) ээлжид ч бичнэ — өмнөх хариултын ТЕКСТ биш, хаяг л.
  if (l2Effective && l2 !== null && l2.clause !== null) {
    const prev = convStateNext.norm;
    convStateNext.norm = {
      inputs: prev?.inputs ?? {},
      medium: prev?.medium ?? [],
      equipmentVolumeUnknown: prev?.equipmentVolumeUnknown ?? false,
      documentCode: l2.code,
      lastKind: prev?.lastKind ?? null,
      lastInitialCategory: prev?.lastInitialCategory ?? null,
      lastFinalCategory: prev?.lastFinalCategory ?? null,
      lastMissingInputs: prev?.lastMissingInputs ?? [],
      setAtSeq: seq,
      lastClause: l2.clause.scope === 'appendix' && l2.clause.appendix ? `${l2.clause.appendix}-р хавсралтын ${l2.clause.clauseId}` : l2.clause.clauseId,
    };
  }

  // ЛОКАЛ НОРМЫН ХАРИУЛТЫН ЗАНГУУ (2026-09-23) — өмнө нь зөвхөн детерминист хөдөлгүүр ба L2 (БНбД 31-17-10) л
  //    нормын төлөв бичдэг байсан тул бусад 14 баримтын хариултын дараа «яагаад заавал 2 удаа?» гэсэн дагалдах
  //    асуулт ямар баримтын тухай болохоо мэдэхгүй, загвар нотолгоогүй зохиож байв (эзний HL02).  Баримт + (ганц
  //    заалт харуулсан бол) заалтыг хадгална — өмнөх хариултын ТЕКСТ биш, хаяг л.
  if (!(l2Effective && l2 !== null && l2.clause !== null) && localComposed !== null && localNorm !== null) {
    const docCode = localNorm.evidence[0]?.code ?? localNorm.documentCode;
    if (docCode) {
      const prev = convStateNext.norm;
      convStateNext.norm = {
        inputs: prev?.inputs ?? {},
        medium: prev?.medium ?? [],
        equipmentVolumeUnknown: prev?.equipmentVolumeUnknown ?? false,
        documentCode: docCode,
        lastKind: prev?.lastKind ?? null,
        lastInitialCategory: prev?.lastInitialCategory ?? null,
        lastFinalCategory: prev?.lastFinalCategory ?? null,
        lastMissingInputs: prev?.lastMissingInputs ?? [],
        setAtSeq: seq,
        lastClause: localComposed.clauses.length === 1 ? localComposed.clauses[0]! : null,
      };
    }
  }

  // ── NORM-INTEL v3 (2026-10-04, `lib/mglai/norm/intelligence.ts`) ─────────────────────────────────
  // Нотолгооны төлөв (AUTHORITATIVE / NO_VERIFIED_MATCH / RETRIEVAL_UNAVAILABLE / CURRENTNESS_UNVERIFIED / …),
  // хэрэглэгдэх байдал, мэдэгдлийн бүртгэл, серверийн эх сурвалжийн блок.  Нотолгоо байхгүй/хайлт унасан/ноорог,
  // солигдсон баримт/ойлголт, засаглалын асуултад ДЕТЕРМИНИСТ, ТУСТАЙ хариулт (`templateOnly`) — загвар тоо, заалт
  // зохиох боломжгүй.  Олон даалгавар, каталог, L1 баримт олох, нэрлэсэн заалт/баримт алга, хувилбарын зөрүү — хөндөгдөхгүй.
  const tIntelStart = Date.now();
  const normIntelBuild = buildNormIntel({
    question: plan.normTask?.text ?? question,
    lang: lang.responseLanguage,
    intent,
    taskCount: turn.tasks.length,
    catalogAsked,
    discoveryActive: normDocuments !== null,
    smallTalk: smallTalkKind !== null,
    trustedNorm,
    localNorm,
    useLocalNorm,
    clauseAbsent,
    subjectMissing: subjectMissing !== null,
    driftMismatch: drift.status === 'mismatch',
    retrievalFailed: normRetrieval.failed,
    convInputs: plan.state.norm?.inputs ?? null,
  });
  // L1 LINK-ONLY fallback: technical norm request, no verified applicable clause,
  // and a TOPIC-MATCHED registry result. Never supersede a trusted calculation,
  // currentness/governance decision, named-clause failure or a document list.
  const normLinksEligible =
    intent === 'NORMATIVE' &&
    turn.tasks.length === 1 &&
    trustedNorm === null &&
    normDocuments === null &&
    !catalogAsked &&
    !clauseAbsent &&
    subjectMissing === null &&
    drift.status !== 'mismatch' &&
    localNorm?.namedDocument?.absent !== true &&
    normIntelBuild?.diag.evidenceState === 'NO_VERIFIED_MATCH';
  const tIntel = Date.now() - tIntelStart;

  // Amendment B — ээлжийн ЦОРЫН ГАНЦ TrustedNormResult, серверийн гарын үсэгтэй.
  const trustedNormSig = trustedNorm === null ? null : await signTrustedResult(trustedNorm, { convUid, seq, question }, c.env.JWT_SECRET);
  const registryDoc = trustedNorm?.documentCode ? normRegistry().byCode(trustedNorm.documentCode) : null;

  return c.json({
    conv_uid: convUid,
    turns,
    tools: toolsForMode(identity.mode).map((t) => ({
      name: t.name,
      description: t.descriptionMn,
      kind: t.kind,
      params: t.params,
    })),
    evidence: evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      document_uid: e.documentUid,
      clause_uid: e.clauseUid,
      page: e.page,
      section: e.section,
      score: e.score,
    })),
    regulatory,
    // ── ХЭЛ + САНАА — UI ба локал runtime-д (§3, §4) ───────────────
    // ⚠️ `response_language` нь `/generate`-д ДАМЖИНА, `intent` нь UI-д
    //    итгэлийн шошгыг харуулах эсэхийг шийднэ.
    // ⚠️ Шийдвэрийг ИЛ буцаана: UI нь эх сурвалжийг харуулах, тест нь
    //    шалгах боломжтой байх ёстой.  Загварын бичсэн текстээс ялгаатай
    //    нь энэ нь МАГАДЛАЛГҮЙ.
    norm_decision: normDecision,
    /**
     * ХАРИУЛТЫН ГЭРЭЭ (§25, §33).  Хөтөч үүсгэлтийн ДАРАА, харуулахаас
     * ӨМНӨ тулгана: татгалзлын өгүүлбэр заавал, шийдвэрийн ангилал заавал,
     * блокт байхгүй тоо хориотой.  Загварын дуулгавартай байдалд
     * найдахгүй — хэмжигдсэн (2026-09-10) тушаал үл хайхарсан тохиолдол.
     */
    answer_contract: buildAnswerContract({
      regulatory,
      evidenceCount: evidence.length,
      normDecision,
      responseLanguage: lang.responseLanguage,
      normTaskIndex: plan.normTaskIndex,
      taskCount: turn.tasks.length,
      localNorm: useLocalNorm && localNorm ? localNorm : null,
      metricNote: metricNoteOf(toolResults),
      trustedNorm,
      normRetrievalFailed: normRetrieval.failed,
      normDocuments: normDocumentsContract,
    }),
    /**
     * ИТГЭМЖЛЭГДСЭН БАРИМТЫН ГЭРЭЭ (tfc-1) — `answer_contract`-ыг ЕРӨНХИЙЛСӨН
     * хувилбар: норм · ERP тоолуур · эрхийн татгалзал бүгд нэг хэлбэрээр.
     * Хөтчийн `lib/validator.ts` үүсгэлтийн ДАРАА тулгаж, зөрчилд дахин
     * үүсгэх/детерминист загвар руу унана.  `answer_contract` нь хуучин
     * хэрэглэгчдэд хэвээр.
     */
    // ⚠️ ҮНДЭСЛЭЛИЙН ХААЛГА (`groundingGuard.ts`, Session C): хэрэгсэлгүй/унасан ERP
    //    асуулт, Revit контекстгүй Revit асуултад `free` гэрээ үлдээхгүй — зохиомол
    //    компанийн тоо validator-оор өнгөрдөг байсан (хэмжсэн 2026-09-11).
    //    Дотор нь Session A-ийн ЭЦСИЙН оролт (trustedNorm, normRetrieval, evidenceNumbers) ХЭВЭЭР
    //    (Session D нэгтгэл 2026-09-14, CONTRACTS §5g).
    trusted_contract: withNormReferenceLinks(applyNormIntel(withSmallTalk(withSubjectAbsent(withL2Scoped(withLocalNorm(withCatalog(applyGroundingGuard(
      buildTrustedContract({
        regulatory,
        evidenceCount: evidence.length,
        normDecision,
        responseLanguage: lang.responseLanguage,
        normTaskIndex: plan.normTaskIndex,
        taskCount: turn.tasks.length,
        localNorm: useLocalNorm && localNorm ? localNorm : null,
        metricNote: metricNoteOf(toolResults),
        toolResults,
        intent,
        trustedNorm,
        normRetrievalFailed: normRetrieval.failed,
        normDocuments: normDocumentsContract,
        normCodeAliases: registryDoc?.codeAliases ?? [],
        // Детерминист шийдвэргүй нормын ээлжид хариултын тоо ЗӨВХӨН нотолгооны текстээс.
        evidenceNumbers: [...numbersInData(evidence.map((e) => `${e.title} ${e.text} ${e.section ?? ''} ${e.page ?? ''}`))],
        // «Олдсонгүй» гэж хэлэхэд хайлт ОРОЛДСОН бөгөөд no-match гэж ИЛ хэлсэн байх ёстой (P0-14).
        retrievalNoMatch:
          evidence.length === 0 && normRetrieval.attempted && !normRetrieval.failed && (localNorm === null || localNorm.status === 'insufficient_evidence'),
      }),
      { intent, toolResults, revitContextPresent: revitSummaryUse !== null, responseLanguage: lang.responseLanguage },
    )))))), normIntelBuild), discoveryRoute, lang.responseLanguage, normLinksEligible),
    /** NORM-INTEL v3 оношилгоо — дэд төрөл, нотолгооны төлөв, хэрэглэгдэх байдал (хариултын текст биш). */
    norm_intel: normIntelBuild === null ? null : { ...normIntelBuild.diag, topics: normIntelBuild.block.topics, sources: normIntelBuild.block.sources.length, claims: normIntelBuild.block.claims.length, deterministic: normIntelBuild.override !== null },
    /**
     * ИТГЭМЖЛЭГДСЭН НОРМЫН ҮР ДҮН (Amendment B) — гарын үсэгтэй.  Хөтөч харуулна,
     * тулгана, `/messages`-д ХӨНДӨЛГҮЙ буцаана; сервер гарын үсгээр танина.
     */
    trusted_norm_result: trustedNorm,
    trusted_norm_sig: trustedNormSig,
    /** Нэгдсэн мөшгөлт (§21) — нууц өгөгдөлгүй; хэмжүүрийн harness үүнийг уншина. */
    norm_trace: {
      applicable: engine.applicable,
      used_prior: engine.usedPrior,
      entities: engine.entities.trace,
      document_codes: engine.entities.documentCodes,
      asks: engine.entities.asks,
      medium: engine.entities.medium,
      selected_document: trustedNorm?.documentCode ?? null,
      selected_records: trustedNorm?.provenance.map((p) => p.recordId) ?? [],
      rule: trustedNorm?.rule ?? null,
      calculation: trustedNorm?.calculation ?? null,
      verification: trustedNorm?.verification ?? null,
      authoritative: trustedNorm?.authoritative ?? null,
      followups: trustedNorm?.followups.map((f) => ({ id: f.id, required: f.required, missing: f.missingInputs })) ?? [],
      drift,
      retrieval: normRetrieval,
      local_norm_status: localNorm?.status ?? null,
      local_no_match_reason: localNorm?.noMatchReason ?? null,
      local_named_document: localNorm?.namedDocument ?? null,
      // L0 бүртгэл (ai/norm-dataset): нэрлэсэн баримт бүртгэлд байгаа ч гүн шингээгээгүй / холбогдох нормын жагсаалт.
      local_registry: localNorm?.registry ?? null,
      // L1 баримт олох горим асаасан эсэх — хэмжүүрийн harness + UI үүнийг уншина.
      norm_documents: normDocuments === null ? null : { count: normDocuments.count, shown: normDocuments.shown, detected_topics: normDocuments.detected_topics, unverified: normDocuments.unverified_count },
      local_evidence_used: localEvidence.length,
      // Мэдлэгийн сангийн каталог (жагсаалт / баримтын бүтэц) — асуусан уу, ирсэн үү.
      norm_catalog: catalogAsked ? { asked: plan.normCatalog, kind: normCatalog?.kind ?? null, retrieval: catalogRetrieval } : null,
      currentness: trustedNorm?.currentness ?? localNorm?.currentness ?? null,
      currentness_note: trustedNorm?.currentness ? currentnessNote(trustedNorm.currentness, lang.responseLanguage) : localNorm ? currentnessNote(localNorm.currentness, lang.responseLanguage) : null,
    },
    /**
     * ⚠️ ЛОКАЛ НОРМЫГ ХЭРЭГЛЭСЭН ЭСЭХ — UI-ийн «эх сурвалж» мөрийг ҮНЭН
     *    болгоно.  Сервер нь клиентээс ирсэн хариуг ХАЯЖ БОЛНО (жишээ нь
     *    `uncertain` төлөвтэй бол шийдвэр болгохгүй) тул клиент өөрөө
     *    «ашиглагдлаа» гэж таамаглах ЁСГҮЙ (§5 — хуурамч явц гаргахгүй).
     */
    local_norm: localNorm === null
      ? null
      : {
          status: localNorm.status,
          used_as_evidence: useLocalNorm,
          /** ⚠️ Хөдөлгүүрийн эрх бүхий үр дүн байвал локал заалт зөвхөн тэр баримтаас (эсвэл хаягдсан). */
          superseded_by_threshold_rule: trustedNorm !== null && localEvidence.length === 0,
          no_match_reason: localNorm.noMatchReason,
          named_document: localNorm.namedDocument,
          dataset_sha256: localNorm.datasetSha256,
          drift: drift.status,
          citation_label: localNorm.citationLabel,
          document_code: localNorm.documentCode,
          clause: localNorm.clause,
          page: localNorm.page,
          evidence_count: localNorm.evidence.length,
          /** CURRENT | SUPERSEDED | HISTORICAL | NEEDS_HUMAN_REVIEW | UNKNOWN (§16–17). */
          currentness: localNorm.currentness,
          effective_status: localNorm.effectiveStatus,
        },
    /** ⚠️ БОДИТ хэмжилт — UI-ийн алхам бүрийн мс энэ талбараас гарна. */
    stage_timings: {
      routing_ms: tRouting,
      retrieval_ms: tRetrieval,
      norm_decision_ms: tNorm,
      norm_intel_ms: tIntel,
      total_ms: Date.now() - tStart,
    },
    /** Хэрэгслийн үр дүн prompt-д багтахын тулд богиносгосон эсэх (оношилгоо). */
    tool_budget: { chars_before: toolBudget.before, chars_after: toolBudget.after, truncated: toolBudget.truncated },
    response_language: lang.responseLanguage,
    detected_language: lang.language,
    language_explicit: lang.explicitRequest,
    answer_depth: depth,
    intent,
    intent_reason: turn.reason,
    turn: turnSummary(turn),
    conv_state_next: convStateNext,
    /** Оношилгоо: prompt-д хэдэн түүхийн мессеж, persona орсон эсэх. */
    context_diag: {
      history_messages: history.length,
      persona: pPolicy,
      revit_level_shown: showRevitLevel,
      tasks: turn.tasks.length,
      memory_lines: localMemory.length,
    },
    evidence_required: policy.evidenceMandatory,
    // ⚠️ §4: шошгыг ЗӨВХӨН хамааралтай үед харуул.  Мэндчилгээн дээр
    //    «Нотолгоо хүрэлцэхгүй» гэж харуулах нь бүтээгдэхүүнийг
    //    эвдэрсэн мэт харуулна.
    show_confidence: policy.showConfidenceBadge,
    verification_states: verificationStates,
    tool_results_used: toolResults.map((t) => ({ tool: t.tool, ok: t.ok })),
    // ⚠️ Оношилгоо: хэдэн мөр ЯАГААД хасагдсаныг админд харуулна.
    //    Захиалагчид ЗӨВХӨН тоо — шалтгаан нь схемийг задруулна.
    filtered_out:
      identity.mode === 'admin' ? filtered.dropped : { count: filtered.dropped.length },
    model: {
      family: MGL_AI_FAMILY,
      version: MGL_AI_VERSION,
      runtime_variant: variant,
      system_prompt_version: MGL_AI_PROMPT_VERSION,
      tool_schema_version: MGL_AI_TOOL_SCHEMA_VERSION,
      context_tokens: s.contextTokens,
    },
    max_tool_iterations: Math.min(profile.maxToolIterations, s.maxToolIterations),
    // ⚠️ ЯГ ЮУГ загвар харсныг буцаана — «Revit-ийн контекст буруу» гэсэн
    //    санал хүсэлтийг мөшгих цорын ганц арга (0269-ийн
    //    `revit_context_ref`).
    revit_context: revitSummaryUse === null ? null : { summary: revitSummaryUse, ...revitCtx },
    as_of: todayInUB(),
  });
});

/* ================================================================== */
/*  4. ХЭРЭГСЭЛ ГҮЙЦЭТГЭХ                                              */
/* ================================================================== */

/**
 * ⚠️ ГУРВАН ХААЛГА ДАРААЛЛААР: бүртгэл → эрх → аргумент.  Аль нэгийг нь
 *    алгасах нь загварт өөрийн эрхийг сонгох боломж өгнө.
 *
 * ⚠️ АУДИТ нь ЗААВАЛ — татгалзсан оролдлого ч бичигдэнэ.  «Загвар ямар
 *    эрхгүй хэрэгсэл дуудахыг оролдов» гэдэг нь хэмжигдэх ёстой дохио.
 */
mglAi.post('/tool', async (c) => {
  const identity = identityOf(c);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const name = str(body.name, 64) ?? '';
  const convUid = str(body.conv_uid, 64);
  const msgUid = str(body.msg_uid, 64);
  const actionUid = uid('act');
  const started = Date.now();

  const known = isKnownTool(name);
  const def = known ? TOOLS[name]! : null;
  const profile = await loadProfile(c.env, identity.userId);

  const decision = decideTool({
    mode: identity.mode,
    profile,
    toolKind: def?.kind ?? 'admin',
    known,
    isRoslyn: def?.isRoslyn,
    isErpWrite: def?.isErpWrite,
    projectId: Number.isInteger(body.project_id) ? (body.project_id as number) : null,
  });

  // ⚠️ Горимд харагдахгүй хэрэгслийг «танихгүй» гэж хариулна — бүртгэлд
  //    байгаа ч тухайн горимд ХАРАГДАХГҮЙ хэрэгслийн оршихуйг задруулахгүй.
  const visible = def ? (def.modes as readonly string[]).includes(identity.mode) : false;

  const audit = async (result: string, error: string | null, elementCount = 0) => {
    await c.env.DB.prepare(
      `INSERT INTO ai_action_audits
         (action_uid, conv_uid, msg_uid, user_id, user_mode, surface, tool_name, tool_kind,
          permission_level, decision, args_json, model_version, tool_schema_version,
          element_count, requested_at, completed_at, duration_ms, result, error)
       VALUES (?, ?, ?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?)`,
    )
      .bind(
        actionUid,
        convUid,
        msgUid,
        identity.userId,
        identity.mode === 'denied' ? 'employee' : identity.mode,
        name.slice(0, 64) || 'unknown',
        def?.kind ?? 'admin',
        profile.revitLevel,
        decision.allow ? (decision.requiresConfirmation ? 'confirmed' : 'auto') : 'denied',
        JSON.stringify({}), // ⚠️ Аргументыг аудитад ХАДГАЛАХГҮЙ — нууц утга агуулж болно
        MGL_AI_VERSION,
        MGL_AI_TOOL_SCHEMA_VERSION,
        elementCount,
        Date.now() - started,
        result,
        error,
      )
      .run();
  };

  if (!known || !visible) {
    await audit('failed', 'unknown_tool');
    return c.json({ ok: false, error: `Танихгүй хэрэгсэл: ${name}`, code: 'unknown_tool' }, 400);
  }

  if (!decision.allow) {
    await audit('failed', decision.reason);
    return c.json({ ok: false, error: 'Энэ хэрэгслийг ажиллуулах эрхгүй.', code: decision.reason }, 403);
  }

  const validated = validateToolArgs(name, body.args);
  if (!validated.ok) {
    await audit('failed', 'bad_args');
    return c.json({ ok: false, error: validated.error, code: 'bad_args' }, 400);
  }

  const exec = ERP_EXECUTORS[name];
  if (!exec) {
    // Хайлтын хэрэгслүүд нь энэ маршрутаар БИШ, `/context`-ээр явна.
    await audit('failed', 'not_implemented');
    return c.json(
      { ok: false, error: 'Энэ хэрэгсэл энэ гарцаар ажиллахгүй.', code: 'not_implemented' },
      400,
    );
  }

  const viewer = await resolveViewer(c.env, identity);
  try {
    const out = await exec({ env: c.env, identity, projectIds: viewer.projectIds }, validated.args);
    await audit(out.ok ? 'ok' : 'failed', out.error ?? null);
    return c.json({
      ok: out.ok,
      tool: name,
      data: out.data,
      note: out.note ?? null,
      error: out.error ?? null,
      action_uid: actionUid,
    });
  } catch (err) {
    console.error(`[mglai.tool] ${name} унав:`, err);
    await audit('failed', 'exception');
    return c.json({ ok: false, error: 'Хэрэгсэл ажиллахад алдаа гарлаа.', code: 'exception' }, 500);
  }
});

/* ================================================================== */
/*  5. МЕССЕЖ ХАДГАЛАХ                                                 */
/* ================================================================== */

mglAi.post('/messages', async (c) => {
  const identity = identityOf(c);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const convUid = str(body.conv_uid, 64);
  if (!convUid) return c.json({ error: 'conv_uid шаардлагатай.' }, 400);

  const conv = await c.env.DB.prepare(`SELECT user_id FROM ai_conversations WHERE conv_uid = ?`)
    .bind(convUid)
    .first<{ user_id: number | null }>();
  if (!conv) return c.json({ error: 'Яриа олдсонгүй.' }, 404);
  if (conv.user_id !== identity.userId) return c.json({ error: 'Эрхгүй.' }, 403);

  const roleRaw = str(body.role, 16);
  const role = roleRaw === 'assistant' || roleRaw === 'tool' ? roleRaw : 'user';
  const msgUid = str(body.msg_uid, 64) ?? uid('msg');
  const content = str(body.content, MAX_TEXT) ?? '';
  const seq = Number.isInteger(body.seq) ? (body.seq as number) : 0;

  // ── Эшлэлийг СЕРВЕР ДЭЭР дахин шийднэ (§48 forged citations) ──────
  const evidence: Evidence[] = Array.isArray(body.evidence)
    ? (body.evidence as Record<string, unknown>[])
        .map(
          (e) =>
            ({
              id: String(e.id ?? ''),
              kind: 'chunk',
              title: String(e.title ?? ''),
              text: '',
              classification: 'public',
              visibilityScope: 'public',
              allowedRoles: [],
              documentUid: (e.document_uid as string) ?? null,
              clauseUid: (e.clause_uid as string) ?? null,
              page: (e.page as number) ?? null,
              section: (e.section as string) ?? null,
            }) as Evidence,
        )
        .filter((e) => e.id.length > 0)
    : [];

  // ── Amendment B: /context-ийн ЦОРЫН ГАНЦ TrustedNormResult (гарын үсэгтэй) ──
  // ⚠️ Гарын үсэг нь /context-ийн ЭЭЛЖИЙН дугаараар (хэрэглэгчийн мессежийн seq);
  //    энд `seq` нь туслахын мессежийнх (+1).  Хөтөч `trusted_norm_seq`-ээр тэр
  //    дугаарыг буцаана — гарын үсэгт орсон тул хуурч болохгүй; байхгүй бол seq-1.
  const normSeq = Number.isInteger(body.trusted_norm_seq) ? (body.trusted_norm_seq as number) : seq - 1;
  const trustedNorm = await verifyTrustedResult(
    body.trusted_norm_result,
    body.trusted_norm_sig,
    { convUid, seq: normSeq, question: str(body.question, MAX_QUESTION_CHARS) ?? '' },
    c.env.JWT_SECRET,
  );

  const claimed = extractCitationIds(content, evidence);
  let { citations, dropped } = resolveCitations(claimed, evidence);
  if (trustedNorm !== null && trustedNorm.provenance.length > 0) {
    // Эшлэл = provenance (сервер зохиосон), загварын [n] тэмдэг биш.
    citations = trustedNorm.provenance.map((p) => ({
      id: `norm:${p.recordId}`,
      kind: 'clause' as const,
      title: p.labelMn,
      documentUid: p.documentCode,
      clauseUid: p.clause ?? p.section,
      page: p.page,
      section: p.table !== null ? `Хүснэгт ${p.table}` : p.formula ? `томьёо ${p.formula}` : p.section,
    }));
    dropped = [];
  }

  const regulatory = Boolean(body.regulatory);
  const verificationStates = Array.isArray(body.verification_states)
    ? (body.verification_states as string[]).filter(
        (v): v is 'UNVERIFIED' | 'CLAUSE_CITED' | 'HUMAN_VERIFIED' =>
          v === 'UNVERIFIED' || v === 'CLAUSE_CITED' || v === 'HUMAN_VERIFIED',
      )
    : [];

  // ⚠️ ИТГЭЛИЙН ШОШГЫГ ЗӨВХӨН ХАМААРАЛТАЙ САНААНД тооцно (§4).
  //    Мэндчилгээ, «чи юу хийж чадах вэ?» гэсэн асуултад «Нотолгоо
  //    хүрэлцэхгүй» гэж тэмдэглэх нь утгагүй бөгөөд бүтээгдэхүүнийг
  //    эвдэрсэн мэт харуулдаг байв.  `null` нь «шошго байхгүй» гэсэн
  //    утгатай ба UI түүнийг харуулахгүй.
  // ⚠️ Гарын үсэгтэй TrustedNormResult байвал шошго ҮРГЭЛЖ — «Q=50000, H=6» гэсэн бүхэл
  //    оролтын үргэлжлэлийг төлөвгүй ангилагч GENERAL_HELP гэж үзээд «Баталгаажсан» шошгыг
  //    дардаг байв (хэмжсэн GOLD multi-turn M3).  Үр дүн нь серверийн төлөвтэй ангилал.
  const msgIntent = classifyIntent(str(body.question, 500) ?? '');
  const showBadge = body.show_confidence !== false && (msgIntent.policy.showConfidenceBadge || trustedNorm !== null);

  let confidence: string | null = null;
  if (role === 'assistant' && showBadge) {
    const scored = scoreConfidence({
      evidence,
      verificationStates,
      toolsOk: body.tools_ok !== false,
      // ⚠️ Хэрэгсэл ХЭДЭН удаа амжилттай ажилласан.  Үүнгүйгээр нотолгоо
      //    ч, хэрэгсэл ч байхгүй хариу «Нотолгоотой» гэж тэмдэглэгдэнэ.
      toolCount: Number.isInteger(body.tool_count) ? (body.tool_count as number) : 0,
      regulatory,
      conflicting: Boolean(body.conflicting),
      staleSince: str(body.data_freshness, 64),
    });
    confidence = enforceCitationRule(scored, regulatory, citations.length);
    // ⚠️ ДЕТЕРМИНИСТ НОРМЫН ШИЙДВЭР = БАТАЛГААЖСАН (Session C, 2026-09-11, хэмжсэн).
    //    Хөтчийн гэрээний оношилгоо `mode:'authoritative'` бол хариулт нь
    //    гүйцэтгэх боломжтой баталгаажилттай дүрмээс тооцоологдсон — гэвч
    //    `evidence` (текстэн хэсэг) хоосон тул `scoreConfidence` «Нотолгоо
    //    хүрэлцэхгүй» гэж тэмдэглэж, «В2 ангилал (БД 21-101-12, хүснэгт 4)» гэсэн
    //    зөв хариултын хажууд УЛААН шошго харагдаж байв (локал D1-д хадгалагдсан
    //    бодит мөр: conf=insufficient, ev=0).  Шийдвэрийн эшлэл нь template-д
    //    ордог тул `enforceCitationRule`-ээс хамаарахгүй.
    const diagMode = body.contract_diag && typeof body.contract_diag === 'object' ? (body.contract_diag as { mode?: unknown }).mode : null;
    if (diagMode === 'authoritative') confidence = 'verified';
    // L1 БАРИМТ ОЛОХ (2026-09-18): жагсаалт = бүртгэлийн детерминист өгөгдөл (template), заалтын нотолгоо
    //    зориуд 0 — `scoreConfidence` түүнийг «Нотолгоо хүрэлцэхгүй» гэж тэмдэглэж, зөв жагсаалтын хажууд
    //    улаан шошго харагдаж байв (бодит чат).  Бүртгэлээс олдсон = «Нотолгоотой» (баталгаажсан БИШ —
    //    мөр бүрийн төлөв өөрөө шалгагдаагүй байж болно).
    const diagLegacy = body.contract_diag && typeof body.contract_diag === 'object' ? (body.contract_diag as { legacy?: unknown }).legacy : null;
    if (diagLegacy === 'norm_documents') confidence = 'supported';
  }
  // ⚠️ NORM-INTEL v3 — ШОШГО ҮНЭНИЙГ ХЭЛЭХ ЁСТОЙ.  «Нотолгоотой» нь зөвхөн эцсийн хариултын үндсэн мэдэгдэл
  //    баталгаатай нотолгоон дээр тулсан үед.  Нотолгоо олдоогүй/хайлт унасан хариулт, ерөнхий ойлголтын хариулт,
  //    хүчин төгөлдөр байдал/хэрэглэгдэх байдал тодорхойгүй хариулт ЯМАР Ч тохиолдолд «Нотолгоотой» болохгүй.
  if (role === 'assistant' && showBadge) {
    const ns = body.contract_diag && typeof body.contract_diag === 'object' ? (body.contract_diag as { norm_state?: unknown }).norm_state : null;
    if (ns === 'GENERAL_ONLY') confidence = null;
    else if (ns === 'NO_VERIFIED_MATCH' || ns === 'RETRIEVAL_UNAVAILABLE') confidence = 'insufficient';
    else if (ns === 'MISSING_APPLICABILITY_INPUT' || ns === 'HUMAN_REVIEW_REQUIRED' || ns === 'CURRENTNESS_UNVERIFIED') confidence = confidence === 'verified' || confidence === 'supported' ? 'uncertain' : confidence;
  }
  // ⚠️ Итгэлийн чип = TrustedNormResult (P0-12).  Нотолгооны хэсгийн тоо, [n] тэмдэг,
  //    D1 `rules` хүснэгт — аль нь ч эрх бүхий шийдвэрийг «Нотолгоо хүрэлцэхгүй»
  //    гэж тэмдэглэх эрхгүй (хэмжсэн: зөв В2 шийдвэр insufficient гэж гарч байв).
  if (role === 'assistant' && trustedNorm !== null && showBadge) {
    confidence = confidenceFromTrustedNorm(trustedNorm);
  }

  const variantRaw = str(body.runtime_variant, 32);
  const variant = variantRaw && isRuntimeVariant(variantRaw) ? variantRaw : null;

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO ai_messages
       (conv_uid, msg_uid, seq, role, content, tool_name, tool_args_json, tool_result_json,
        citations_json, confidence, evidence_count, model_version, runtime_variant,
        first_token_ms, total_ms, prompt_tokens, completion_tokens, stop_reason, error, diag_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(
      convUid,
      msgUid,
      seq,
      role,
      content,
      str(body.tool_name, 64),
      str(body.tool_result, 4000),
      JSON.stringify(citations),
      confidence,
      evidence.length,
      MGL_AI_VERSION,
      variant,
      Number.isInteger(body.first_token_ms) ? (body.first_token_ms as number) : null,
      Number.isInteger(body.total_ms) ? (body.total_ms as number) : null,
      Number.isInteger(body.prompt_tokens) ? (body.prompt_tokens as number) : null,
      Number.isInteger(body.completion_tokens) ? (body.completion_tokens as number) : null,
      str(body.stop_reason, 32),
      str(body.error, 500),
      // ⚠️ Гэрээний оношилгоо (0280) — зөвхөн код/тоо, түүхий текст биш.
      //    Хөтчийн бүтцийг итгэхгүй: хэмжээ, төрлийг хязгаарлана.
      sanitizeDiag(body.contract_diag, trustedNorm),
    )
    .run();

  await c.env.DB.prepare(
    `UPDATE ai_conversations
        SET message_count = message_count + 1, last_message_at = datetime('now')
      WHERE conv_uid = ?`,
  )
    .bind(convUid)
    .run();

  return c.json({
    msg_uid: msgUid,
    citations,
    // ⚠️ Загвар эшлэл ЗОХИОСОН эсэх — хэмжигдэх дохио.
    dropped_citations: dropped,
    confidence,
  });
});

/* ================================================================== */
/*  6. САНАЛ ХҮСЭЛТ                                                    */
/* ================================================================== */

mglAi.post('/feedback', async (c) => {
  const identity = identityOf(c);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const convUid = str(body.conv_uid, 64);
  const msgUid = str(body.msg_uid, 64);
  if (!convUid || !msgUid) return c.json({ error: 'conv_uid ба msg_uid шаардлагатай.' }, 400);

  const vote = body.vote === 1 || body.vote === -1 ? (body.vote as number) : null;
  if (vote === null) return c.json({ error: 'vote нь 1 эсвэл -1 байна.' }, 400);

  const reasons = normalizeReasons(body.reason_codes);

  // Мессежийн агуулгыг АГШИНД НЬ хадгална — 90 хоногийн цэвэрлэгээний
  // дараа ч сургалтын жишээ бүрэн үлдэнэ (0269-ийн үл хамаарах зүйл).
  const msg = await c.env.DB.prepare(
    `SELECT content, model_version, runtime_variant, total_ms, first_token_ms,
            prompt_tokens, completion_tokens, citations_json
       FROM ai_messages WHERE conv_uid = ? AND msg_uid = ?`,
  )
    .bind(convUid, msgUid)
    .first<Record<string, unknown>>();

  const prevUser = await c.env.DB.prepare(
    `SELECT content FROM ai_messages
      WHERE conv_uid = ? AND role = 'user' AND seq < COALESCE(
            (SELECT seq FROM ai_messages WHERE conv_uid = ? AND msg_uid = ?), 999999)
      ORDER BY seq DESC LIMIT 1`,
  )
    .bind(convUid, convUid, msgUid)
    .first<{ content: string }>();

  await c.env.DB.prepare(
    `INSERT INTO ai_feedback
       (conv_uid, msg_uid, voter_key, user_id, user_mode, vote, reason_codes_json,
        reason_text, corrected_answer, prompt_snapshot, answer_snapshot,
        model_family, model_version, runtime_variant, system_prompt_version,
        tool_schema_version, context_ref, source_ids_json, latency_ms, first_token_ms,
        prompt_tokens, completion_tokens, review_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
     ON CONFLICT (msg_uid, voter_key) DO UPDATE SET
       vote = excluded.vote,
       reason_codes_json = excluded.reason_codes_json,
       reason_text = excluded.reason_text,
       corrected_answer = excluded.corrected_answer,
       created_at = datetime('now'),
       review_state = 'pending',
       reviewed_by = NULL,
       reviewed_at = NULL`,
  )
    .bind(
      convUid,
      msgUid,
      identity.voterKey,
      identity.userId,
      identity.mode === 'denied' ? 'employee' : identity.mode,
      vote,
      JSON.stringify(reasons),
      str(body.reason_text, 2000),
      str(body.corrected_answer, MAX_TEXT),
      str(prevUser?.content, MAX_TEXT),
      str(msg?.content, MAX_TEXT),
      MGL_AI_FAMILY,
      str(msg?.model_version, 32) ?? MGL_AI_VERSION,
      str(msg?.runtime_variant, 32),
      MGL_AI_PROMPT_VERSION,
      MGL_AI_TOOL_SCHEMA_VERSION,
      msgUid,
      typeof msg?.citations_json === 'string' ? msg.citations_json : '[]',
      Number.isInteger(msg?.total_ms) ? (msg!.total_ms as number) : null,
      Number.isInteger(msg?.first_token_ms) ? (msg!.first_token_ms as number) : null,
      Number.isInteger(msg?.prompt_tokens) ? (msg!.prompt_tokens as number) : null,
      Number.isInteger(msg?.completion_tokens) ? (msg!.completion_tokens as number) : null,
    )
    .run();

  return c.json({ ok: true, vote, reason_codes: reasons, review_state: 'pending' });
});

/* ================================================================== */
/*  7. АДМИН — санал хянах, эрх олгох, релиз                          */
/* ================================================================== */

mglAi.get('/admin/feedback', requireAdmin(), async (c) => {
  const state = str(c.req.query('state'), 32) ?? 'pending';
  if (!isFeedbackState(state)) return c.json({ error: 'Танихгүй төлөв.' }, 400);
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 25)));

  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.conv_uid, f.msg_uid, f.user_id, u.full_name, f.user_mode, f.vote,
            f.reason_codes_json, f.reason_text, f.corrected_answer, f.prompt_snapshot,
            f.answer_snapshot, f.model_version, f.runtime_variant, f.review_state,
            f.dataset_version, f.created_at
       FROM ai_feedback f
       LEFT JOIN users u ON u.id = f.user_id
      WHERE f.review_state = ?
      ORDER BY f.created_at DESC
      LIMIT ?`,
  )
    .bind(state, limit)
    .all();

  const counts = await c.env.DB.prepare(
    `SELECT review_state, COUNT(*) AS n FROM ai_feedback GROUP BY review_state`,
  ).all<{ review_state: string; n: number }>();

  return c.json({ state, items: results ?? [], counts: counts.results ?? [] });
});

mglAi.post('/admin/feedback/:id/state', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id буруу.' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const to = str(body.to, 32);
  if (!to || !isFeedbackState(to)) return c.json({ error: 'Танихгүй төлөв.' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT review_state, vote, corrected_answer FROM ai_feedback WHERE id = ?`,
  )
    .bind(id)
    .first<{ review_state: string; vote: number; corrected_answer: string | null }>();
  if (!row) return c.json({ error: 'Олдсонгүй.' }, 404);
  if (!isFeedbackState(row.review_state)) return c.json({ error: 'Эвдэрсэн төлөв.' }, 500);

  const correction = str(body.corrected_answer, MAX_TEXT) ?? row.corrected_answer;
  const datasetVersion = str(body.dataset_version, 64);

  const verdict = canTransition({
    from: row.review_state,
    to,
    isAdmin: true, // маршрут нь `requireAdmin()`
    hasCorrection: Boolean(correction && correction.trim().length > 0),
    isNegative: row.vote === -1,
    datasetVersion,
  });

  if (!verdict.ok) {
    return c.json({ error: 'Энэ шилжилт зөвшөөрөгдөхгүй.', code: verdict.error }, 409);
  }

  const user = c.get('user');
  const meta = await c.env.DB.prepare(
    `UPDATE ai_feedback
        SET review_state = ?, reviewed_by = ?, reviewed_at = datetime('now'),
            review_note = COALESCE(?, review_note),
            corrected_answer = COALESCE(?, corrected_answer),
            dataset_version = COALESCE(?, dataset_version)
      WHERE id = ? AND review_state = ?`,
  )
    .bind(to, user.sub, str(body.note, 2000), correction, datasetVersion, id, row.review_state)
    .run();

  // ⚠️ Уралдааны хамгаалалт — `assistant`-ийн approve/reject-ийн ижил заль.
  if (meta.meta.changes === 0) {
    return c.json({ error: 'Төлөв өөрчлөгдсөн байна, дахин ачаална уу.' }, 409);
  }

  return c.json({ ok: true, id, review_state: to });
});

/** Сургалтын багц руу экспорт — батлагдсан мөрүүд Л. */
mglAi.get('/admin/dataset/export', requireAdmin(), async (c) => {
  const version = str(c.req.query('dataset_version'), 64);
  const { results } = await c.env.DB.prepare(
    `SELECT id, prompt_snapshot, answer_snapshot, corrected_answer, vote,
            reason_codes_json, model_version, runtime_variant, system_prompt_version,
            tool_schema_version, user_mode, created_at
       FROM ai_feedback
      WHERE review_state IN ('approved','included_in_dataset')
      ORDER BY id ASC
      LIMIT 5000`,
  ).all<Record<string, unknown>>();

  const rows = (results ?? []).map((r) => ({
    id: r.id,
    // ⚠️ 👎 дээр ЗАЛРУУЛСАН хариу нь зорилтот гаралт.  👍 дээр анхны хариу.
    messages: [
      { role: 'user', content: r.prompt_snapshot ?? '' },
      { role: 'assistant', content: (r.corrected_answer ?? r.answer_snapshot) ?? '' },
    ],
    meta: {
      vote: r.vote,
      reasons: r.reason_codes_json,
      model_version: r.model_version,
      runtime_variant: r.runtime_variant,
      system_prompt_version: r.system_prompt_version,
      tool_schema_version: r.tool_schema_version,
      user_mode: r.user_mode,
      created_at: r.created_at,
    },
  }));

  return c.json({
    dataset_version: version,
    family: MGL_AI_FAMILY,
    exported_at: nowInUBIso(),
    count: rows.length,
    rows,
  });
});

mglAi.get('/admin/permissions/:userId', requireAdmin(), async (c) => {
  const userId = Number(c.req.param('userId'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'userId буруу.' }, 400);
  const profile = await loadProfile(c.env, userId);
  return c.json({ user_id: userId, ...profile });
});

/**
 * ⚠️ ЭРХ ОЛГОХ.  `requireAdmin()` + 0273-ийн `granted_by <> user_id`
 *    CHECK хоёул хамт: админ ӨӨРТӨӨ FULL_AGENT олгож ЧАДАХГҮЙ.
 */
mglAi.put('/admin/permissions/:userId', requireAdmin(), async (c) => {
  const userId = Number(c.req.param('userId'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'userId буруу.' }, 400);

  const user = c.get('user');
  if (user.sub === userId) {
    return c.json(
      { error: 'Өөртөө AI эрх олгох боломжгүй — өөр админ хийнэ.', code: 'self_grant' },
      403,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const level = str(body.revit_level, 32);
  if (!level || !isRevitLevel(level)) return c.json({ error: 'revit_level буруу.' }, 400);

  const scope = Array.isArray(body.project_scope)
    ? (body.project_scope as unknown[]).filter(
        (n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0,
      )
    : [];

  await c.env.DB.prepare(
    `INSERT INTO ai_permission_profiles
       (user_id, revit_level, erp_write_enabled, roslyn_enabled, max_tool_iterations,
        project_scope_json, note, granted_by, granted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT (user_id) DO UPDATE SET
       revit_level = excluded.revit_level,
       erp_write_enabled = excluded.erp_write_enabled,
       roslyn_enabled = excluded.roslyn_enabled,
       max_tool_iterations = excluded.max_tool_iterations,
       project_scope_json = excluded.project_scope_json,
       note = excluded.note,
       granted_by = excluded.granted_by,
       granted_at = datetime('now'),
       expires_at = excluded.expires_at`,
  )
    .bind(
      userId,
      level,
      body.erp_write_enabled === true ? 1 : 0,
      body.roslyn_enabled === true ? 1 : 0,
      Number.isInteger(body.max_tool_iterations) ? (body.max_tool_iterations as number) : 8,
      JSON.stringify(scope),
      str(body.note, 500),
      user.sub,
      str(body.expires_at, 32),
    )
    .run();

  return c.json({ ok: true, user_id: userId, revit_level: level });
});

/* ================================================================== */
/*  8. ЗАГВАРЫН РЕЛИЗ ба ЛОКАЛ RUNTIME                                */
/* ================================================================== */

/**
 * ⚠️ ЗӨВШӨӨРӨГДСӨН МАНИФЕСТ (§37).  ModelManager нь ЗӨВХӨН эндээс
 *    татна — дурын URL руу заах нь хорлогдсон артефактын зам.
 *    `license_cleared = 0` мөр нь манифестад ОГТ ГАРАХГҮЙ.
 */
mglAi.get('/runtime/manifest', async (c) => {
  const identity = identityOf(c);
  const isClient = identity.mode === 'client';

  /**
   * ⚠️ ХУВИЛБАРЫГ ХАТУУ БИЧИХЭЭ БОЛИВ (2026-09-09).
   *
   *    Өмнө нь энд `'employee-4b-q4'` гэж ХАТУУ бичигдсэн байсан тул
   *    8B загварын релиз (`employee-8b-q4`) манифестад ОГТ ГАРАХГҮЙ
   *    байв — өөрөөр хэлбэл админ 8B релиз нийтэлсэн ч ажилтан руу
   *    ХЭЗЭЭ Ч хүрэхгүй.  Мөн адаптерын хувилбарууд (§17) нь өөр
   *    variant-тай тул тэд ч гарахгүй байх байсан.
   *
   * ⚠️ ХИЛ НЬ ХЭВЭЭР: захиалагч нь `client-*` хувилбарыг Л, ажилтан нь
   *    БУСДЫГ авна.  Хоёрын хооронд задрал ГАРАХГҮЙ.
   */
  const { results } = await c.env.DB.prepare(
    `SELECT release_uid, version, runtime_variant, base_model, quantization, runtime,
            context_tokens, artifact_url, artifact_bytes, artifact_sha256,
            min_vram_mb, min_ram_mb, channel, build_commit, build_date,
            kind, base_release_uid, minimum_runtime_version
       FROM ai_model_releases
      WHERE is_active = 1 AND license_cleared = 1 AND eval_passed = 1
        AND (CASE WHEN ?1 = 1 THEN runtime_variant LIKE 'client-%'
                  ELSE runtime_variant NOT LIKE 'client-%' END)`,
  )
    .bind(isClient ? 1 : 0)
    .all();

  return c.json({
    product: MGL_AI_PRODUCT,
    family: MGL_AI_FAMILY,
    audience: isClient ? 'client' : 'employee',
    // ⚠️ ХООСОН нь АЛДАА БИШ: релиз хараахан нийтлээгүй, эсвэл лиценз
    //    шалгагдаагүй байна.  ModelManager үүнийг «суулгах юм алга»
    //    гэж уншиж, ЮУ Ч ТАТАХГҮЙ.
    releases: results ?? [],
    checked_at: nowInUBIso(),
  });
});

/**
 * НОРМАТИВ МЭДЛЭГИЙН МАНИФЕСТ (§16).
 *
 * ⚠️ ЯАГААД ЗАГВАРЫН МАНИФЕСТЭЭС ТУСДАА ВЭ.  Мэдлэг нь ЖИНД ОРДОГГҮЙ
 *    (CLAUDE.md: «норм нь жинд ОРООГҮЙ, retrieval_first»), шинэчлэлтийн
 *    давтамж нь загварынхаас 100 дахин их, лицензийн хаалга нь өөр.
 *    Хоёрыг нэг гарцад нийлүүлбэл «шинэ норм ирэхэд загвар дахин
 *    татагдах» эрсдэл байнга оршино — тэр нь §19-ийн шууд зөрчил.
 *
 * ⚠️ ХООСОН нь АЛДАА БИШ.  Локал runtime үүнийг «шинэчлэх юм алга» гэж
 *    уншина; аль хэдийн шингээсэн мэдлэг нь ХЭВЭЭР ажиллана.
 */
mglAi.get('/runtime/knowledge-manifest', async (c) => {
  const identity = identityOf(c);
  const audience = identity.mode === 'client' ? 'client' : 'employee';

  const { results } = await c.env.DB.prepare(
    `SELECT pack_id, version, title_mn, url, sha256, bytes
       FROM ai_knowledge_packs
      WHERE is_active = 1 AND (audience = ?1 OR audience = 'all')
      ORDER BY pack_id`,
  )
    .bind(audience)
    .all();

  return c.json({ packs: results ?? [], checked_at: nowInUBIso() });
});

/**
 * СУУЛГАГЧИЙН БАЙРШИЛ (§3, §36) — «MGL AI татах» товчийг тэжээнэ.
 *
 * ⚠️ ХАТУУ БИЧСЭН URL БАЙХГҮЙ.  Шинэ суулгагч гаргах нь нэг мөр
 *    INSERT — frontend deploy ШААРДАХГҮЙ.  Тэр нь чухал: суулгагч нь
 *    загвар, runtime-ээс ТУСДАА хэмнэлээр шинэчлэгдэнэ.
 *
 * ⚠️ ХООСОН БАЙВАЛ 404 БИШ, `available: false`.  Хуудас түүнийг
 *    «админ хараахан нийтлээгүй» гэж ойлгомжтой хэлэх ёстой —
 *    техникийн алдаа үзүүлэхгүй (§39).
 */
mglAi.get('/runtime/installer', async (c) => {
  const platform = c.req.query('platform') ?? 'win-x64';
  const row = await c.env.DB.prepare(
    `SELECT version, platform, url, sha256, bytes, release_note, created_at
       FROM ai_runtime_installers
      WHERE is_active = 1 AND component = 'installer' AND platform = ?1
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(platform)
    .first<{
      version: string;
      platform: string;
      url: string;
      sha256: string;
      bytes: number | null;
      release_note: string | null;
      created_at: string;
    }>();

  if (!row) {
    return c.json({
      available: false,
      // ⚠️ ХЭРЭГЛЭГЧИД ХАРАГДАХ МОНГОЛ МӨР.  «404», «no rows» гэх мэт
      //    техникийн үг ЭНД ОРОХГҮЙ (§39).
      message: 'MGL AI суулгагч хараахан нийтлэгдээгүй байна. Админаас асууна уу.',
    });
  }

  // ⚠️ `url` (R2-ийн түлхүүр) БУЦААГДАХГҮЙ.  Хувилбар, хэмжээ, checksum
  //    нь хэрэглэгчид хэрэгтэй; bucket-ийн бүтэц нь ХЭРЭГГҮЙ бөгөөд
  //    задруулах нь дэмий гадаргуу.
  const { url: _key, ...meta } = row;
  return c.json({ available: true, ...meta });
});

/**
 * СУУЛГАГЧИЙН ФАЙЛ — ХУВИЙН BUCKET-ААС УРСГАНА.
 *
 * ⚠️ `MEDIA_BUCKET`-Д ТАВИХГҮЙ.  `GET /media/:key` нь НЭВТРЭЛТГҮЙ
 *    нийтийн зам (репогийн аюулгүй байдлын мэдэгдэж буй #2) — компанийн
 *    суулгагч тэнд байх ёсгүй.  `MEETING_BUCKET` нь хувийн бөгөөд
 *    зөвхөн энэ маршрутаар уншигдана.
 *
 * ⚠️ `ai_runtime_installers.url` НЬ R2-ИЙН ТҮЛХҮҮР, ГАДААД ХАЯГ БИШ.
 *    Гадаад URL руу чиглүүлэх нь дурын хостоос хоёртын файл татуулах
 *    зам нээх ба тэр нь яг «хорлогдсон артефакт»-ын загвар.
 */
mglAi.get('/runtime/installer/file', async (c) => {
  const platform = c.req.query('platform') ?? 'win-x64';
  const row = await c.env.DB.prepare(
    `SELECT version, url FROM ai_runtime_installers
      WHERE is_active = 1 AND component = 'installer' AND platform = ?1
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(platform)
    .first<{ version: string; url: string }>();

  if (!row) return c.json({ error: 'Суулгагч нийтлэгдээгүй байна.' }, 404);

  const obj = await c.env.MEETING_BUCKET.get(row.url);
  // ⚠️ БҮРТГЭЛД БАЙГАА ЧЕ ФАЙЛ БАЙХГҮЙ БАЙЖ БОЛНО (гараар устгасан).
  //    Тэр нь 500 БИШ — админд ойлгомжтой 404.
  if (!obj) return c.json({ error: 'Суулгагчийн файл олдсонгүй.' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="MGL-AI-Setup-${row.version}.exe"`,
      'Content-Length': String(obj.size),
      // ⚠️ Кэшлэхгүй — идэвхтэй суулгагч солигдох боломжтой.
      'Cache-Control': 'no-store',
    },
  });
});

mglAi.post('/runtime/heartbeat', async (c) => {
  const identity = identityOf(c);
  if (identity.userId === null) return c.json({ error: 'Нэвтрэх шаардлагатай.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const installUid = str(body.install_uid, 64);
  if (!installUid) return c.json({ error: 'install_uid шаардлагатай.' }, 400);

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

  await c.env.DB.prepare(
    `INSERT INTO ai_runtime_installs
       (install_uid, user_id, hostname, os, cpu, ram_mb, gpu, vram_mb, cuda,
        runtime_version, model_version, runtime_variant, engine, last_seen_at,
        last_bench_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
     ON CONFLICT (install_uid) DO UPDATE SET
       user_id = excluded.user_id, hostname = excluded.hostname, os = excluded.os,
       cpu = excluded.cpu, ram_mb = excluded.ram_mb, gpu = excluded.gpu,
       vram_mb = excluded.vram_mb, cuda = excluded.cuda,
       runtime_version = excluded.runtime_version, model_version = excluded.model_version,
       runtime_variant = excluded.runtime_variant, engine = excluded.engine,
       last_seen_at = datetime('now'),
       last_bench_json = COALESCE(excluded.last_bench_json, ai_runtime_installs.last_bench_json)`,
  )
    .bind(
      installUid,
      identity.userId,
      str(body.hostname, 128),
      str(body.os, 128),
      str(body.cpu, 128),
      num(body.ram_mb),
      str(body.gpu, 128),
      num(body.vram_mb),
      str(body.cuda, 32),
      str(body.runtime_version, 32),
      str(body.model_version, 32),
      str(body.runtime_variant, 32),
      str(body.engine, 32),
      body.bench ? JSON.stringify(body.bench).slice(0, 4000) : null,
    )
    .run();

  return c.json({ ok: true, install_uid: installUid, server_time: nowInUBIso() });
});

/* ================================================================== */
/*  8b. МЭДЛЭГ ШИНГЭЭХ (§16) — админ                                   */
/* ================================================================== */

/**
 * Норм, стандарт, компанийн баримтыг оруулна.
 *
 * ⚠️ ЭНЭ БОЛ MGL AI-Д «МЭДДЭГ БОЛГОХ» ЦОРЫН ГАНЦ ЗАМ.  Загварыг дахин
 *    сургах нь БИШ — §14-ийн хуваарилалт: норм нь ХАЙЛТААР, зан төлөв нь
 *    жингээр.  Шинэ БНбД ирэхэд ЭНД оруулна, загвар хөндөгдөхгүй.
 *
 * ⚠️ `clause_uid` нь `rule_clauses` (0220) руу заана.  Түүнийг бөглөвөл
 *    эшлэл нь `verification_state`-ээр дамжин ИТГЭЛИЙН ТӨЛӨВИЙГ хавчина.
 *    Хоосон орхивол хэсэг нь хайлтад олдоно ч «Баталгаажсан» болж
 *    ЧАДАХГҮЙ — тэр нь зөв, учир нь эшлэх заалт нь тодорхойгүй.
 *
 * ⚠️ ДАХИН ОРУУЛАХАД ХУУЧИН ХЭСГҮҮД УСТАНА.  Баримтыг засаад дахин
 *    оруулахад хуучин, шинэ хоёр зэрэг олдвол загвар зөрчилтэй хоёр
 *    хувилбарыг хамт уншина.  `doc_uid` нь идемпотентын түлхүүр.
 */
mglAi.post('/admin/knowledge', requireAdmin(), async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const docUid = str(body.doc_uid, 64);
  const title = str(body.title, 300);
  if (!docUid || !title) return c.json({ error: 'doc_uid ба title шаардлагатай.' }, 400);

  const sourceKind = str(body.source_kind, 32) ?? 'regulation';
  const SOURCE_KINDS = ['regulation', 'company_doc', 'project_doc', 'handbook', 'upload', 'web'];
  if (!SOURCE_KINDS.includes(sourceKind)) {
    return c.json({ error: 'source_kind буруу.', allowed: SOURCE_KINDS }, 400);
  }

  const CLASSES = ['public', 'internal', 'confidential', 'restricted'];
  const SCOPES = ['public', 'company', 'project', 'org', 'owner'];
  // ⚠️ ӨГӨГДМӨЛ нь `internal` + `company` — хамгийн хаалттай БОДИТ утга.
  //    Норм нийтийн байх ёстой бол дуудагч ИЛ зарлана.
  const classification = str(body.classification, 24) ?? 'internal';
  const visibility = str(body.visibility_scope, 24) ?? 'company';
  if (!CLASSES.includes(classification) || !SCOPES.includes(visibility)) {
    return c.json({ error: 'classification / visibility_scope буруу.' }, 400);
  }

  // ── Хэсэглэх ────────────────────────────────────────────────────
  let chunks: ParsedChunk[];
  if (Array.isArray(body.rows)) {
    chunks = chunkStructured(body.rows as never);
  } else {
    const text = typeof body.text === 'string' ? body.text : '';
    if (text.trim().length === 0) {
      return c.json({ error: 'text эсвэл rows шаардлагатай.' }, 400);
    }
    chunks = chunkDocument({
      text,
      maxChars: Number.isInteger(body.max_chars) ? (body.max_chars as number) : undefined,
    });
  }

  if (chunks.length === 0) {
    return c.json({ error: 'Хэсэг үүсээгүй — текст хэт богино байна.' }, 400);
  }
  // ⚠️ D1-ийн нэг хүсэлтийн бодит хязгаар.  Том баримтыг клиент ХЭСЭГЧЛЭН
  //    илгээнэ (`ai/scripts/ingest.mjs` тэрийг автоматаар хийдэг).
  if (chunks.length > 400) {
    return c.json(
      { error: 'Хэт олон хэсэг — баримтыг хэсэгчлэн илгээнэ үү.', chunks: chunks.length },
      413,
    );
  }

  const user = c.get('user');
  const projectId = Number.isInteger(body.project_id) ? (body.project_id as number) : null;
  const orgId = Number.isInteger(body.org_id) ? (body.org_id as number) : null;
  const allowedRoles = Array.isArray(body.allowed_roles)
    ? JSON.stringify((body.allowed_roles as unknown[]).filter((r) => typeof r === 'string'))
    : '[]';
  const append = body.append === true;
  const lang = str(body.lang, 8) ?? 'mn';

  await c.env.DB.prepare(
    `INSERT INTO ai_knowledge_documents
       (doc_uid, source_kind, title, title_en, lang, document_uid, project_id, org_id,
        classification, visibility_scope, allowed_roles_json, version, effective_from,
        page_count, chunk_count, ingest_state, ingested_by, ingested_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'extracting', ?, datetime('now'), datetime('now'))
     ON CONFLICT (doc_uid) DO UPDATE SET
       source_kind = excluded.source_kind, title = excluded.title,
       title_en = excluded.title_en, lang = excluded.lang,
       document_uid = excluded.document_uid, project_id = excluded.project_id,
       org_id = excluded.org_id, classification = excluded.classification,
       visibility_scope = excluded.visibility_scope,
       allowed_roles_json = excluded.allowed_roles_json,
       version = excluded.version, effective_from = excluded.effective_from,
       ingest_state = 'extracting', ingested_by = excluded.ingested_by,
       ingested_at = datetime('now')`,
  )
    .bind(
      docUid,
      sourceKind,
      title,
      str(body.title_en, 300),
      lang,
      str(body.document_uid, 64),
      projectId,
      orgId,
      classification,
      visibility,
      allowedRoles,
      str(body.version, 64),
      str(body.effective_from, 32),
      user.sub,
    )
    .run();

  // ⚠️ Дахин оруулахад хуучин хэсгүүд УСТАНА (append биш бол).
  if (!append) {
    await c.env.DB.prepare('DELETE FROM ai_knowledge_chunks WHERE doc_uid = ?').bind(docUid).run();
  }

  const prev = append
    ? await c.env.DB.prepare(
        'SELECT COALESCE(MAX(seq), -1) AS m FROM ai_knowledge_chunks WHERE doc_uid = ?',
      )
        .bind(docUid)
        .first<{ m: number }>()
    : null;
  const seqBase = (prev?.m ?? -1) + 1;

  const stmt = c.env.DB.prepare(
    `INSERT OR REPLACE INTO ai_knowledge_chunks
       (chunk_uid, doc_uid, seq, page_no, section, heading, clause_uid, text, text_folded,
        char_count, token_estimate, lang, classification, visibility_scope,
        allowed_roles_json, project_id, org_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );

  const clausePrefix = str(body.clause_uid_prefix, 64) ?? str(body.document_uid, 64) ?? docUid;

  const batch = chunks.map((ch) => {
    const seq = seqBase + ch.seq;
    // ⚠️ Заалтын дугаартай хэсэг нь «<баримт>#<заалт>» болно — 0220-ийн
    //    `rule_clauses.clause_uid`-ийн заншилтай тааруулсан.
    const clauseUid = ch.clauseNo ? `${clausePrefix}#${ch.clauseNo}` : null;
    return stmt.bind(
      `${docUid}::${seq}`,
      docUid,
      seq,
      ch.pageNo,
      ch.clauseNo,
      ch.heading,
      clauseUid,
      ch.text,
      ch.textFolded,
      ch.charCount,
      estimateTokens(ch.text),
      lang,
      classification,
      visibility,
      allowedRoles,
      projectId,
      orgId,
    );
  });

  // ⚠️ 40-өөр хэсэглэнэ — D1 нь нэг batch-д хэт олон statement авахад
  //    унадаг (`qto.ts`-ийн хэсэглэлтийн сургамж).
  for (let i = 0; i < batch.length; i += 40) {
    await c.env.DB.batch(batch.slice(i, i + 40));
  }

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(MAX(page_no), 0) AS p FROM ai_knowledge_chunks WHERE doc_uid = ?',
  )
    .bind(docUid)
    .first<{ n: number; p: number }>();

  await c.env.DB.prepare(
    `UPDATE ai_knowledge_documents
        SET chunk_count = ?, page_count = ?, ingest_state = 'indexed', ingest_error = NULL
      WHERE doc_uid = ?`,
  )
    .bind(total?.n ?? chunks.length, total?.p ?? 0, docUid)
    .run();

  const withClause = chunks.filter((ch) => ch.clauseNo !== null).length;
  return c.json({
    ok: true,
    doc_uid: docUid,
    chunks_added: chunks.length,
    chunks_total: total?.n ?? chunks.length,
    with_clause_no: withClause,
    // ⚠️ Заалтын дугааргүй хэсэг ЭШЛЭГДЭЖ ЧАДАХГҮЙ — админд ИЛ хэлнэ.
    without_clause_no: chunks.length - withClause,
    pages_seen: total?.p ?? 0,
    classification,
    visibility_scope: visibility,
  });
});

/** Шингээсэн баримтуудын жагсаалт. */
mglAi.get('/admin/knowledge', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT doc_uid, source_kind, title, lang, classification, visibility_scope,
            version, effective_from, page_count, chunk_count, ingest_state, ingested_at
       FROM ai_knowledge_documents
      ORDER BY id DESC
      LIMIT 200`,
  ).all();
  const totals = await c.env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM ai_knowledge_documents) AS docs, (SELECT COUNT(*) FROM ai_knowledge_chunks) AS chunks',
  ).first<{ docs: number; chunks: number }>();
  return c.json({ documents: results ?? [], totals });
});

/** Баримтыг бүрэн устгана (хэсгүүдтэй нь хамт). */
mglAi.delete('/admin/knowledge/:docUid', requireAdmin(), async (c) => {
  const docUid = c.req.param('docUid');
  // ⚠️ D1 нь ажиллах үедээ FK-г албаддаггүй тул хүүхдийг ГАРААР устгана
  //    (репогийн заншил: email.ts, calendar.ts, pgp.ts, repair.ts).
  await c.env.DB.prepare('DELETE FROM ai_knowledge_chunks WHERE doc_uid = ?').bind(docUid).run();
  const meta = await c.env.DB.prepare('DELETE FROM ai_knowledge_documents WHERE doc_uid = ?')
    .bind(docUid)
    .run();
  return c.json({ ok: true, deleted: meta.meta.changes });
});

/**
 * ХАЙЛТЫГ ШУУД ТУРШИХ — оруулсан баримт бодитоор олдож байгаа эсэх.
 *
 * ⚠️ Загвараас ХАМААРАЛГҮЙ тул «AI мэдэхгүй байна» гэсэн гомдол ирэхэд
 *    эхлээд ЭНД шалгана: хайлт олохгүй бол загварын буруу БИШ.
 */
mglAi.get('/admin/knowledge/search', requireAdmin(), async (c) => {
  const q = str(c.req.query('q'), 500);
  if (!q) return c.json({ error: 'q шаардлагатай.' }, 400);
  const hits = await lexicalSearch(c.env, q, { limit: 12 });
  return c.json({
    query: q,
    count: hits.length,
    hits: hits.map((h) => ({
      id: h.id,
      title: h.title,
      document_uid: h.documentUid,
      clause_uid: h.clauseUid,
      page: h.page,
      section: h.section,
      score: h.score,
      classification: h.classification,
      visibility_scope: h.visibilityScope,
      preview: h.text.slice(0, 200),
    })),
  });
});

mglAi.get('/admin/releases', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM ai_model_releases ORDER BY created_at DESC LIMIT 100`,
  ).all();
  return c.json({ releases: results ?? [] });
});

mglAi.get('/admin/installs', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.install_uid, i.user_id, u.full_name, i.hostname, i.os, i.cpu, i.ram_mb,
            i.gpu, i.vram_mb, i.cuda, i.runtime_version, i.model_version,
            i.runtime_variant, i.engine, i.last_seen_at
       FROM ai_runtime_installs i
       LEFT JOIN users u ON u.id = i.user_id
      ORDER BY i.last_seen_at DESC LIMIT 100`,
  ).all();
  return c.json({ installs: results ?? [] });
});

export default mglAi;
