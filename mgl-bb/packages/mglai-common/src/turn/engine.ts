/**
 * MGL AI · ГҮЙЦЭТГЭЛИЙН ЗОХИОН БАЙГУУЛАГЧ (§1, §9, §12, §15, §21, §22).
 *
 * ⚠️ ЯГ ЮУГ ЗАСАЖ БАЙНА ВЭ.  Хуучин `MglAiPage.send()` нь дараах
 *    бүтэцтэй байв:
 *
 *      await conversations → await messages → хэрэгслүүд ДАРААЛЛААР
 *      → await /context (timeoutMs: 20_000) → await /generate
 *
 *    Үүнээс гурван гажиг гарна:
 *      1. Эхний ~4 алхам ХЭРЭГЛЭГЧИД ХАРАГДАХГҮЙ — зөвхөн анивчсан ▌.
 *      2. `/context`-ийн 20 секундын НЭГ хугацаа нь БҮХ хүнд ажлыг
 *         бүрхэж, worker-ийн хүйтэн эхлэлт (баримтжуулсан 9-20 сек)
 *         дээр УЛААН «Сервер 20 секундэд хариу өгсөнгүй» өгдөг байв.
 *         Хэмжсэн: `/context` дулаан үедээ 17-32 мс.  Өөрөөр хэлбэл тэр
 *         таймер нь ЗӨВХӨН хууль ёсны удаан тохиолдлыг алдаг байсан.
 *      3. Хэрэгслүүд дараалснаас 2 хэрэгсэл = 2 бүтэн RTT.
 *
 * ⚠️ ШИНЭ ЗАГВАР: ҮЕ ШАТ БҮР ӨӨРИЙН ХУГАЦААТАЙ, ГЛОБАЛ ТАЙМЕР БАЙХГҮЙ.
 *    Удаашрал нь `stage.slow` ҮЙЛ ЯВДАЛ болно (төвийг сахисан мөр), АЛДАА
 *    БОЛОХГҮЙ.  Зөвхөн үе шат ҮНЭХЭЭР унасан үед, эсвэл хатуу аюулгүйн
 *    хязгаарт хүрэхэд Л алдаа болно (§9, §11).
 *
 * ⚠️ ЗОХИОН БАЙГУУЛАГЧ НЬ ХӨТӨЧ ДЭЭР, ЗОРИУД.  Worker нь инференс
 *    хийхгүй (§13, CLAUDE.md-ийн эдийн засгийн инвариант), локал runtime
 *    нь эрх шийдэхгүй.  Хоёуланд нь хүрдэг цорын ганц тал нь хөтөч —
 *    тиймээс явцыг харах цорын ганц цэг ч мөн хөтөч.
 */
// ⚠️ ХУВААЛЦСАН ЭЭЛЖИЙН ХӨДӨЛГҮҮР (Session R, Phase 5) — `frontend/.../orchestrator.ts`-ийн
//    механик порт (SHARED_CLIENT_NEUTRAL_TURN_FOUNDATION).  Зорилт: хөтөч · Revit · дуу — нэг зам;
//    ӨНӨӨДӨР Revit энэ замаар, хөтөч паритетын хаалга тэнцтэл өөрийн orchestrator-оор.  Тээвэр (`deps.backend`,
//    `deps.runtime`) ГАДНААС ирнэ: хөтөч дээр apiFetch + fetch(127.0.0.1), ажилтны PC-ийн
//    runtime дотор loopback.  DOM/localStorage/Node API ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ.
import type { TurnDeps } from './transports.ts';
import {
  newRequestId,
  STAGE_LABEL,
  SLOW_NOTICE,
  type AiStage,
  type AiStreamEvent,
  type AiSourceRef,
} from './aiEvents.ts';
import { aiError, classifyError, type AiErrorShape } from './aiErrors.ts';
import { STAGE_BUDGET, HEARTBEAT_GAP_MS, StageTimeoutError } from './aiBudget.ts';
import type { NormAnswer, NormCatalog, ProbeResult } from './runtimeTypes.ts';
import { validateAnswer, cleanOutput, REPAIR_PROMPT_MN } from './validate.ts';
import { applyContract } from './contract.ts';
import {
  enforceContract,
  fallbackAnswer,
  hasHardViolation,
  correctionPrompt,
  dedupeSentences,
  stripPromptEcho,
  echoFallbackText,
  type TrustedContract,
  type ValidationResult,
} from './validator.ts';
import type {
  AiContextResponse,
  AiCitation,
  ConfidenceState,
  AiEvidence,
  AiTurnSummary,
  AiConvState,
} from './types.ts';
import { selectMemories, toWire, type MemoryItem, type MemoryHint } from './memory.ts';
import { extractActionCandidate, type RevitActionCandidate } from './revitAction.ts';
import { detectSevereRepetition } from '../normIntel.ts';

/* ================================================================== */
/*  ҮЕ ШАТНЫ ХУГАЦАА                                                   */
/* ================================================================== */


/* ================================================================== */
/*  ГЭРЭЭ                                                              */
/* ================================================================== */

export interface PlanResponse {
  intent: string;
  intent_reason: string;
  /** Ээлжийн тайлал (сервер) — сэдэв, төрөл, даалгаврууд. */
  turn?: AiTurnSummary;
  /** Локал `/norm`-д өгөх асуулт — олон санаатай мессежийн нормын хэсэг Л. */
  norm_query?: string;
  /** Ил тохиргооны хүсэлт («цаашид богино хариулаарай») — сервер танив. */
  memory_hints?: MemoryHint[];
  response_language: 'mn-Cyrl' | 'en';
  detected_language: string;
  regulatory: boolean;
  evidence_required: boolean;
  needs_retrieval: boolean;
  show_confidence: boolean;
  ask_local_norm: boolean;
  /**
   * МЭДЛЭГИЙН САНГИЙН КАТАЛОГ (2026-09-18) — сервер «чамд ямар норм байгаа вэ» / «БНбД X юуны
   * тухай вэ» гэж таньсан бол `{ code }` (`code=null` = бүх сан).  Хөтөч ажилтны PC-ийн
   * `POST /norm/catalog`-ыг дуудаж үр дүнг `/context`-д `norm_catalog`-оор ХӨНДӨЛГҮЙ өгнө;
   * сервер ариутгаж хэрэгслийн хайрцаг + гэрээ болгоно.  Хайлт БИШ — `ask_local_norm`-оос тусдаа.
   */
  ask_norm_catalog?: { code: string | null } | null;
  tools: { name: string; args: Record<string, unknown> }[];
  /**
   * ОЛОН ШАТЛАЛТ СУДАЛГАА (§13, §16).  `done=false` бол хэрэгслийн үр дүнг
   * `prior_results`-аар буцааж `/plan`-ыг `round+1`-ээр ДАХИН дуудна.
   * Сервер дараагийн алхмыг өмнөх үр дүнгээс шийднэ (deadline → тэр
   * төслийн шинжилгээ).  Хөтөч ГОГЦООГ л ажиллуулна, ШИЙДВЭР гаргахгүй.
   */
  round?: number;
  done?: boolean;
  depth?: 'fast' | 'normal' | 'analysis' | 'deep';
  research_reason?: string;
  max_rounds?: number;
  plan_ms: number;
}

export interface ToolRun {
  tool: string;
  ok: boolean;
  data: unknown;
  durationMs: number;
  /** Дараагийн шатны `/plan`-д буцаана — ижил хэрэгслийг ижил аргументаар давтахгүй. */
  args?: Record<string, unknown>;
}

/**
 * ҮЕ ШАТНЫ КЭШ (§21).
 *
 * ⚠️ ЗОРИЛГО: үүсгэлт унасан үед БҮГДИЙГ дахин ажиллуулахгүй байх.
 *    Хэл, санаа, олдсон эх сурвалж, хэрэгслийн үр дүн бүгд ХҮЧИНТЭЙ
 *    хэвээр — зөвхөн загвар дахин бичих ёстой.  Хуучин код нь бүх
 *    гинжийг дахин гүйлгэдэг байсан тул давтах нь ХОЁР ДАХИН удаан
 *    байв.
 */
/**
 * ЛОКАЛ НОРМЫН ХАЙЛТЫН ҮР ДҮН — «олдсонгүй» ба «хайлт УНАСАН»-ыг сервер ялгахын тулд
 * хариултаас ГАДНА `attempted`/`reason`-ыг `/context`-д дамжуулна (P0-14).
 *   reason: ok | not_asked | runtime_down | not_installed | timeout | offline | error
 */
export interface NormRetrievalOutcome {
  answer: NormAnswer | null;
  attempted: boolean;
  reason: 'ok' | 'not_asked' | 'runtime_down' | 'not_installed' | 'timeout' | 'offline' | 'error';
}

/** Каталогийн үр дүн — `/norm`-той ижил «олдсонгүй ≠ унасан» ялгаатай. */
export interface NormCatalogOutcome {
  catalog: NormCatalog | null;
  attempted: boolean;
  reason: 'ok' | 'not_asked' | 'runtime_down' | 'not_installed' | 'timeout' | 'offline' | 'error';
}

export interface StageCache {
  plan?: PlanResponse;
  tools?: ToolRun[];
  norm?: NormRetrievalOutcome;
  catalog?: NormCatalogOutcome;
  context?: AiContextResponse;
}

export interface TurnInput {
  question: string;
  /** web | revit | voice — `/conversations`-д бүртгэгдэнэ; өгөгдмөл web. */
  surface?: 'web' | 'revit' | 'voice';
  /** Revit add-in-ийн утсан контекст (`lib/mglai/revitContext.ts`-ийн `RawRevitContext` хэлбэр) — `/context`-д `revit_context`. */
  revitContext?: unknown;
  convUid: string;
  userMsgUid: string;
  aiMsgUid: string;
  seq: number;
  history: { role: 'user' | 'assistant'; content: string }[];
  /**
   * Ярианы бүтэцтэй төлөв — өмнөх `/context`-ийн `conv_state_next`.
   *
   * ⚠️ ХӨНДӨЛГҮЙ дамжуулна.  Сервер үүгээр «яагаад удаад байна?» гэсэн
   *    асуултыг ямар төслийн тухай гэдгийг мэднэ, «В2 галын ачаалал?»
   *    гэсэн шинэ асуултад тэр төслийг ОРУУЛАХГҮЙ.
   */
  convState: AiConvState;
  /**
   * Локал урт хугацааны санамж (§34).  Зохион байгуулагч ХАМААРАЛТАЙГ нь
   * сонгож `/context`-д `local_memory`-оор өгнө; хадгалалт хуудсанд.
   */
  memories?: readonly MemoryItem[];
  runtime: ProbeResult | null;
  /**
   * Сесийн горим — локал `/norm`-ийн `audience`-д дамжина.
   *
   * ⚠️ ЭНЭ НЬ ЭРХИЙН ХААЛГА БИШ (жинхэнэ шийдвэр Worker дээр, §5), гэвч
   *    зөв дамжуулах нь ҮНЭГҮЙ бөгөөд ирээдүйд дотоод гарын авлага
   *    шингээхэд локал тал аль хэдийн зөв шүүнэ.
   */
  mode: 'client' | 'employee' | 'admin' | 'denied';
  signal: AbortSignal;
  emit: (e: AiStreamEvent) => void;
  /** ⚠️ Дахин оролдох үед өмнөх үе шатны үр дүнг ДАМЖУУЛНА (§21). */
  cache?: StageCache;
  /** Зөвхөн үүсгэлтийг дахин ажиллуулах — эх сурвалж дахин хайхгүй. */
  generationOnly?: boolean;
}

export interface ContractDiag {
  mode: TrustedContract['answerMode'];
  risk: TrustedContract['risk'];
  /** Үүсгэлтийн оролдлогын тоо (1 эсвэл 2). */
  attempts: number;
  /** Оролдлого бүрийн ЗАСВАРЫН ӨМНӨХ зөрчлийн кодууд. */
  violations: string[][];
  /** Хэрэглэгчид очсон хариултын эх: загвар / засварласан / дахин үүсгэсэн / детерминист. */
  final: 'model' | 'repaired' | 'regenerated' | 'template';
  /** Өндөр эрсдэлд урсгалыг буферлэсэн эсэх (§36). */
  buffered: boolean;
}

export interface TurnResult {
  answer: string;
  citations: AiCitation[];
  evidence: AiEvidence[];
  confidence: ConfidenceState | null;
  error: AiErrorShape | null;
  firstTokenMs: number | null;
  totalMs: number | null;
  engine: string | null;
  runtimeVariant: string | null;
  cache: StageCache;
  regulatory: boolean;
  verificationStates: string[];
  /**
   * Локал хөдөлгүүрийн зогсох шалтгаан: `stop` | `length` | `aborted` |
   * `repetition` | `timeout`.
   *
   * ⚠️ `repetition` нь ХАРИУЛТ ХҮЧИНГҮЙ гэсэн үг (§7) — түүнийг зөв
   *    хариулт болгон хадгалахгүй, эшлэл шийдүүлэхгүй.
   */
  stopReason: string | null;
  /** Дараагийн ээлжид дамжуулах ярианы төлөв (сервер үүсгэсэн). */
  convStateNext: AiConvState;
  /** Ээлжийн тайлал — мессежийн «сэдэв» шошгод. */
  turn: AiTurnSummary | null;
  /** Энэ ээлжид prompt-д орсон санамжийн id — `lastUsedAt` шинэчлэхэд. */
  usedMemoryIds: string[];
  /**
   * ИТГЭМЖЛЭГДСЭН БАРИМТЫН ГЭРЭЭНИЙ ОНОШИЛГОО (§44) — загвар юу бичсэн,
   * шалгалт тэнцсэн үү, дахилт хэрэг болсон уу, хэрэглэгчид юу очив.
   * ⚠️ Загварын түүхий текст ЭНД БАЙХГҮЙ — зөвхөн шалгалтын код.
   */
  contractDiag: ContractDiag | null;
  /** Сервер таньсан БАЙНГЫН тохиргооны хүсэлт — хуудас хадгална. */
  memoryHints: MemoryHint[];
  /** Ээлжийн детерминист нормын үр дүн (сервер зурсан) — UI нотолгоо, оношилгоо. */
  normResult: import('./types.ts').TrustedNormResult | null;
  /**
   * R4.2 — загварын ИТГЭМЖЛЭГДЭЭГҮЙ Revit үйлдлийн санал (`revitAction.ts`), хариултын төгсгөлийн блокоос
   * САЛГАСАН.  Гүйцэтгэх эрхгүй; Revit клиент детерминист binder → envelope → preview → хэрэглэгчийн баталгаа.
   * Хөтөч харуулж болно, гүйцэтгэхгүй.  null = санал байхгүй.
   */
  revitActionCandidate: RevitActionCandidate | null;
  /** Блок байсан ч схемд тэнцээгүй бол шалтгаан (оношилгоо). */
  revitActionCandidateRejected: string | null;
}

/** Ээлжийн төрөл → хэрэглэгчид харагдах ТӨВИЙГ САХИСАН мөр (§74). */
export function turnNotice(turn: AiTurnSummary): string | undefined {
  const subj = turn.subject && turn.subject.kind === 'project' ? `«${turn.subject.name}»` : null;
  switch (turn.kind) {
    case 'FOLLOW_UP':
    case 'CONTINUATION':
    case 'CLARIFICATION':
      return subj ? `Өмнөх сэдвийг үргэлжлүүлж байна: ${subj}` : 'Өмнөх сэдвийг үргэлжлүүлж байна';
    case 'REFERENCE_TO_PRIOR_RESULT':
      return 'Өмнөх хариултад тулгуурлаж байна';
    case 'CORRECTION':
      return subj ? `Засварыг хүлээж авлаа: ${subj}` : 'Засварыг хүлээж авлаа';
    case 'MULTI_INTENT':
      return `${turn.tasks.length} тусдаа асуулт гэж ойлголоо`;
    default:
      return undefined;
  }
}

/* ================================================================== */
/*  ҮЕ ШАТ ГҮЙЦЭТГЭХ ТУСЛАХ                                            */
/* ================================================================== */

/**
 * Нэг үе шатыг хэмжиж, УДААШРАЛЫГ мэдээлж, ХАТУУ хязгаараар хамгаална.
 *
 * ⚠️ `slow` нь ҮЙЛ ЯВДАЛ, ХАЯГДАЛ БИШ — ажил үргэлжилсээр байна.  Энэ нь
 *    §11-ийн гол шаардлага: түр зуурын удаашрал нь УЛААН алдаа болохгүй.
 */
async function runStage<T>(
  ctx: TurnCtx,
  stage: AiStage,
  opts: { key?: string; label?: string; doneLabel?: string },
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const budget = STAGE_BUDGET[stage] ?? { slowMs: 8_000, hardMs: Number.POSITIVE_INFINITY };
  const at = () => performance.now() - ctx.t0;
  const meta = opts.key ? { key: opts.key } : undefined;

  ctx.emit({
    requestId: ctx.requestId,
    atMs: at(),
    type: 'stage.started',
    stage,
    safeUserMessage: opts.label ?? STAGE_LABEL[stage].running,
    metadata: meta,
  });

  const started = performance.now();
  const inner = new AbortController();
  const onOuter = () => inner.abort();
  ctx.signal.addEventListener('abort', onOuter);

  const slowTimer = setTimeout(() => {
    ctx.emit({
      requestId: ctx.requestId,
      atMs: at(),
      type: 'stage.slow',
      stage,
      safeUserMessage: SLOW_NOTICE[stage],
      metadata: meta,
    });
  }, budget.slowMs);

  // ⚠️ ХАТУУ ХЯЗГААРЫГ ЦУЦЛАЛТААС ЯЛГАНА.  Хоёулаа `AbortSignal`-аар
  //    хэрэгждэг тул тэмдэглэхгүй бол `classifyError` нь хугацаа
  //    дууссаныг «Хэрэглэгч зогсоолоо» гэж УНШИНА — хэрэглэгч юу ч
  //    дараагүй атлаа «Зогсоолоо» гэсэн мессеж авах болно.
  let hardTimedOut = false;
  const hardTimer = Number.isFinite(budget.hardMs)
    ? setTimeout(() => {
        hardTimedOut = true;
        inner.abort();
      }, budget.hardMs)
    : undefined;

  try {
    const out = await fn(inner.signal);
    ctx.emit({
      requestId: ctx.requestId,
      atMs: at(),
      type: 'stage.completed',
      stage,
      safeUserMessage: opts.doneLabel ?? STAGE_LABEL[stage].done,
      durationMs: Math.round(performance.now() - started),
      metadata: meta,
    });
    return out;
  } catch (err) {
    // ⚠️ Хэрэглэгч ЦУЦЛААГҮЙ атлаа хугацаа дууссан бол түүнийг
    //    ХУГАЦААНЫ алдаа болгож дамжуулна — `classifyError` нь дараа нь
    //    үе шатаас хамааруулж ERP_TIMEOUT / RETRIEVAL_TIMEOUT болгоно.
    if (hardTimedOut && !ctx.signal.aborted) throw new StageTimeoutError(stage, budget.hardMs);
    // ⚠️ ҮЕ ШАТЫГ АЛДААНД НААНА (Session C).  Гадна `catch` өмнө нь бүх
    //    хугацааны бус алдааг `'context'` гэж таамаглаж, `/plan`-ы сүлжээний
    //    алдааг «эх сурвалжийн хайлт дууссангүй» болгож байв (хэмжсэн).
    if (err && typeof err === 'object' && !('stage' in err)) {
      try {
        (err as { stage?: AiStage }).stage = stage;
      } catch {
        /* хөлдөөсөн объект — үл тоо */
      }
    }
    throw err;
  } finally {
    clearTimeout(slowTimer);
    if (hardTimer !== undefined) clearTimeout(hardTimer);
    ctx.signal.removeEventListener('abort', onOuter);
  }
}


/** Эх сурвалжийг UI-ийн хэлбэрт — ⚠️ БАЙХГҮЙ хуудсыг ЗОХИОХГҮЙ (§6). */
function sourceFromEvidence(e: AiEvidence): AiSourceRef {
  const local = e.id.startsWith('local:');
  return {
    id: e.id,
    document: e.document_uid,
    clause: e.clause_uid ?? e.section,
    page: e.page,
    title: e.title,
    origin: local ? 'local-norm' : e.kind === 'erp' ? 'erp' : 'company-doc',
  };
}

/* ================================================================== */
/*  ГОЛ ГИНЖ                                                           */
/* ================================================================== */

/** `revit_context.selection`-ий урт — сервер /plan-д санаа тайлахад (R3.5). */
function revitSelectionCount(rc: unknown): number {
  const sel = (rc as { selection?: unknown } | null)?.selection;
  return Array.isArray(sel) ? sel.length : 0;
}

/** `revit_context.report` хавсаргасан эсэх — сервер «тайлан гарга»-г Revit-ийн тайлан гэж тайлахад. */
function revitHasReport(rc: unknown): boolean {
  const rep = (rc as { report?: unknown } | null)?.report;
  return !!rep && typeof rep === 'object';
}

/** Ээлжийн контекст — тээврийг дамжуулна. */
export interface TurnCtx {
  emit: (e: AiStreamEvent) => void;
  t0: number;
  requestId: string;
  signal: AbortSignal;
  deps: TurnDeps;
}

export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  const requestId = newRequestId();
  const t0 = performance.now();
  const at = () => performance.now() - t0;
  const { emit, signal } = input;
  const ctx: TurnCtx = { emit, t0, requestId, signal, deps };
  const cache: StageCache = { ...input.cache };

  const result: TurnResult = {
    answer: '',
    citations: [],
    evidence: [],
    confidence: null,
    error: null,
    firstTokenMs: null,
    totalMs: null,
    engine: null,
    runtimeVariant: null,
    cache,
    regulatory: false,
    verificationStates: [],
    stopReason: null,
    convStateNext: input.convState,
    turn: null,
    usedMemoryIds: [],
    memoryHints: [],
    revitActionCandidate: null,
    revitActionCandidateRejected: null,
    contractDiag: null,
    normResult: null,
  };

  const lastAssistant = [...input.history].reverse().find((h) => h.role === 'assistant')?.content ?? null;

  /* ── 0. ХҮЛЭЭН АВЛАА — ЯМАР Ч AWAIT-ААС ӨМНӨ (§2) ─────────────── */
  // ⚠️ ЭНЭ МӨР НЬ ХАМГИЙН ЧУХАЛ.  Хэрэглэгч «Илгээх» дарснаас хойш
  //    <100 мс-д ямар нэг ЖИНХЭНЭ дохио харах ёстой.  Тиймээс энэ
  //    хүртэл ганц ч сүлжээний дуудлага БАЙХГҮЙ.
  emit({
    requestId,
    atMs: at(),
    type: 'request.accepted',
    stage: 'accept',
    safeUserMessage: 'Асуултыг хүлээж авлаа',
    durationMs: Math.round(at()),
  });

  try {
    /* ── 1. ЯРИА ХАДГАЛАХ — ХААЛТГҮЙ (fire-and-forget) ─────────── */
    // ⚠️ Хуучин код эдгээрийг AWAIT хийдэг байсан тул хоёр бүтэн RTT нь
    //    хэрэглэгчийн хүлээлтэд ШУУД нэмэгддэг байв.  Хадгалалт нь
    //    хариултын ЗӨВ БАЙДАЛД нөлөөлдөггүй — унавал зөвхөн түүх дутна.
    if (!input.generationOnly) {
      void ctx.deps.backend.fetch('/mgl-ai/conversations', {
        method: 'POST',
        data: {
          conv_uid: input.convUid,
          surface: input.surface ?? 'web',
          title: input.question.slice(0, 80),
        },
      }).catch(() => undefined);
      void ctx.deps.backend.fetch('/mgl-ai/messages', {
        method: 'POST',
        data: {
          conv_uid: input.convUid,
          msg_uid: input.userMsgUid,
          role: 'user',
          content: input.question,
          seq: input.seq,
        },
      }).catch(() => undefined);
    }

    /* ── 2. ТӨЛӨВЛӨГӨӨ ────────────────────────────────────────── */
    const plan =
      cache.plan ??
      (await runStage(ctx, 'plan', { doneLabel: 'Асуултыг ойлголоо' }, (sig) =>
        ctx.deps.backend.fetch<PlanResponse>('/mgl-ai/plan', {
          method: 'POST',
          data: {
            question: input.question,
            request_id: requestId,
            // ⚠️ Ярианы кернел: бүтэцтэй төлөв + ээлжийн дугаар.  Түүхийн
            //    текст ЭНД ЯВАХГҮЙ — сервер төлөвөөс л тайлна.
            conv_state: input.convState ?? null,
            seq: input.seq,
            last_assistant: lastAssistant,
            // Revit сонголтын тоо (R3.5) — ЗӨВХӨН revit_context байвал (хөтчийн зам байт-ижил хэвээр).
            ...(input.revitContext ? { revit_selection: revitSelectionCount(input.revitContext), ...(revitHasReport(input.revitContext) ? { revit_report: true } : {}) } : {}),
          },
          // ⚠️ 0 = ХЯЗГААРГҮЙ.  Хугацааг `runStage`-ийн `hardMs` барина;
          //    `apiFetch`-ийн өөрийн 12 сек нь ЭНД ХОР ХӨНӨӨЛТЭЙ (хүйтэн
          //    worker-ийг алдана) тул зориуд унтраав.
          timeoutMs: 0,
          signal: sig,
        }),
      ));
    cache.plan = plan;
    result.regulatory = plan.regulatory;

    emit({
      requestId,
      atMs: at(),
      type: 'intent.detected',
      stage: 'plan',
      metadata: { intent: plan.intent, regulatory: plan.regulatory },
      safeUserMessage: plan.regulatory
        ? 'Асуултыг норм дүрмийн асуулт гэж танилаа'
        : undefined,
    });
    emit({
      requestId,
      atMs: at(),
      type: 'language.detected',
      stage: 'plan',
      metadata: { language: plan.detected_language },
    });
    if (plan.memory_hints && plan.memory_hints.length > 0) {
      result.memoryHints = plan.memory_hints;
    }
    // ⚠️ САНАМЖИЙГ ШҮҮНЭ — бүгдийг биш (§35).  Нэр томьёо зөвхөн асуултад
    //    байвал, «намайг X гэж дууд» зөвхөн мэндчилгээнд, хэв маяг ≤3.
    const chosenMemories = selectMemories(input.memories ?? [], { question: input.question, intent: plan.intent });
    result.usedMemoryIds = chosenMemories.map((m) => m.id);
    if (plan.turn) {
      result.turn = plan.turn;
      emit({
        requestId,
        atMs: at(),
        type: 'turn.interpreted',
        stage: 'plan',
        safeUserMessage: turnNotice(plan.turn),
        metadata: {
          kind: plan.turn.kind,
          subject: plan.turn.subject?.kind === 'project' ? plan.turn.subject.name : null,
          tasks: plan.turn.tasks.length,
        },
      });
    }

    /* ── 3. ХЭРЭГСЭЛ + НОРМ — ЗЭРЭГ (§15) ─────────────────────── */
    // ⚠️ ЭДГЭЭР НЬ БИЕЕ ДААСАН.  ERP нь D1-ээс, норм нь ажилтны локал
    //    SQLite-ээс уншина — хоорондоо ямар ч хамааралгүй тул
    //    дараалуулах нь цэвэр алдагдал байв.
    const [tools, normOutcome, catalogOutcome] = await Promise.all([
      cache.tools ?? runResearch(ctx, plan, input),
      cache.norm !== undefined ? Promise.resolve(cache.norm) : runNorm(ctx, plan, input),
      cache.catalog !== undefined ? Promise.resolve(cache.catalog) : runCatalog(ctx, plan, input),
    ]);
    cache.tools = tools;
    cache.norm = normOutcome;
    cache.catalog = catalogOutcome;
    const norm = normOutcome.answer;

    /* ── 4. КОНТЕКСТ — УГСРАЛТЫН ЦОРЫН ГАНЦ ГАЗАР ─────────────── */
    const contextResult =
      cache.context ??
      (await runStage(ctx, 'context', {}, (sig) =>
        ctx.deps.backend.fetch<AiContextResponse>('/mgl-ai/context', {
          method: 'POST',
          data: {
            conv_uid: input.convUid,
            question: input.question,
            history: input.history,
            // ⚠️ `/plan`-тай ЯГ ИЖИЛ төлөв, дугаар — сервер хоёуланд нь
            //    ижил тайлал гаргана (`planTurn`).
            conv_state: input.convState ?? null,
            seq: input.seq,
            request_id: requestId,
            tool_results: tools.map((t) => ({ tool: t.tool, ok: t.ok, data: t.data })),
            // ⚠️ Локал нормын хариуг ЭНД дамжуулна — сервер ариутгаж,
            //    ӨӨРӨӨ шийднэ (`lib/mglai/localNorm.ts`).
            norm_answer: norm,
            // ⚠️ «Олдсонгүй» ≠ «хайлт унасан» (P0-14): оролдсон эсэх, шалтгааныг сервер
            //    цагаан жагсаалтаар уншиж, `retrieval_failed`-ийг `no_match`-аас ялгана.
            norm_retrieval: { attempted: normOutcome.attempted, reason: normOutcome.reason },
            // Мэдлэгийн сангийн каталог (жагсаалт / баримтын бүтэц) — сервер ариутгаж хайрцаглана
            //    (`lib/mglai/normCatalog.ts`); хөтөч тээвэрлэнэ.
            norm_catalog: catalogOutcome.catalog,
            norm_catalog_retrieval: { attempted: catalogOutcome.attempted, reason: catalogOutcome.reason },
            // Локал санамж — зөвхөн ЭНЭ ээлжид хамааралтай нь (§35).
            local_memory: toWire(chosenMemories),
            // Revit-ийн контекст (Session R) — сервер `parseRevitContext`-оор 25-аар таслаж prompt-д шигтгэнэ.
            revit_context: input.revitContext ?? undefined,
          },
          // ⚠️ 20_000 БАЙСАН.  Яг энэ мөр «Сервер 20 секундэд хариу
          //    өгсөнгүй» гэсэн улаан алдааг төрүүлдэг байв.
          timeoutMs: 0,
          signal: sig,
        }),
      ));
    cache.context = contextResult;
    if (contextResult.conv_state_next !== undefined) result.convStateNext = contextResult.conv_state_next;
    if (contextResult.turn) result.turn = contextResult.turn;
    result.evidence = contextResult.evidence;
    result.verificationStates = contextResult.verification_states ?? [];
    result.regulatory = contextResult.regulatory;
    result.normResult = contextResult.trusted_norm_result ?? null;

    // ⚠️ «N эх сурвалж» = СЕРВЕР ХЭРЭГЛЭСЭН нотолгоо Л (P0-16).  Локал хайлтын
    //    урьдчилсан хэсгүүдийг энд ТООЛОХГҮЙ — сервер тэднийг хаяж болно.
    //    Детерминист үр дүнгийн provenance (бүртгэлийн бичлэг) нь эх сурвалж мөн.
    for (const p of result.normResult?.provenance ?? []) {
      emit({
        requestId,
        atMs: at(),
        type: 'source.found',
        stage: 'context',
        source: {
          id: `norm:${p.recordId}`,
          document: p.documentCode,
          clause: p.clause ?? p.section,
          page: p.page,
          title: p.labelMn,
          origin: 'local-norm',
        },
      });
    }
    for (const e of contextResult.evidence) {
      emit({
        requestId,
        atMs: at(),
        type: 'source.found',
        stage: 'context',
        source: sourceFromEvidence(e),
      });
    }
    if (result.normResult) {
      emit({
        requestId,
        atMs: at(),
        type: 'norm.rule.completed',
        stage: 'context',
        safeUserMessage:
          result.normResult.verification === 'verified'
            ? `Баталгаажсан дүрэм: ${result.normResult.documentCode ?? ''}`.trim()
            : result.normResult.verification === 'needs_human_review'
              ? 'Хүний хяналт шаардлагатай бичлэг'
              : result.normResult.verification === 'data_version_mismatch'
                ? 'Нормын сангийн хувилбар зөрсөн'
                : undefined,
        metadata: { verification: result.normResult.verification, kind: result.normResult.answerKind, document: result.normResult.documentCode },
      });
    }

    /* ── 5. ҮҮСГЭЛТ ───────────────────────────────────────────── */
    const canGenerate = input.runtime?.installed === true && input.runtime.authorized === true;
    const templateOnly = contextResult.trusted_contract?.templateOnly === true && typeof contextResult.trusted_contract.template === 'string';
    if (templateOnly) {
      // ⚠️ ДЕТЕРМИНИСТ Л (2026-09-18, L1 баримт олох): жагсаалт = серверийн template ШУУД, загвар
      //    ҮҮСГЭЛТ ХИЙХГҮЙ — бодит чатанд 8B+адаптер холбоос орхиж, `*` алдаж, «шалгагдаагүй»-г
      //    «хүчинтэй» гэж дээшлүүлж 23 с зарцуулж байсан.  Runtime суугаагүй ч ажиллана (хайлтын горим).
      const c = contextResult.trusted_contract!;
      result.answer = fallbackAnswer(c, contextResult.response_language);
      result.stopReason = 'template';
      result.contractDiag = { mode: c.answerMode, risk: c.risk, attempts: 0, violations: [], final: 'template', buffered: false };
      emit({ requestId, atMs: at(), type: 'generation.started', stage: 'generation', safeUserMessage: 'Баталгаажсан хариултыг шууд харуулж байна' });
      emit({ requestId, atMs: at(), type: 'token', stage: 'generation', text: result.answer });
      emit({ requestId, atMs: at(), type: 'stage.completed', stage: 'generation', safeUserMessage: 'Детерминист хариулт (загвар оролцоогүй)', durationMs: 0, metadata: { templateOnly: true, legacy: c.legacyKind } });
    } else if (!canGenerate) {
      // ⚠️ ХАЙЛТЫН ГОРИМ — өгүүлбэр зохиохгүй, олдсоныг ҮНЭНЭЭР үзүүлнэ.
      result.answer = renderRetrievalOnly(contextResult, tools, norm);
      result.engine = 'retrieval-only';
      result.error = aiError('LOCAL_RUNTIME_OFFLINE');
    } else {
      await generate(ctx, contextResult, result);
      // ⚠️ ЦУЦЛАЛТ ҮҮСГЭЛТИЙН ДУНД (Session C, хэмжсэн): `streamGenerate` нь
      //    AbortError-ыг чимээгүй залгидаг тул энд ямар ч алдаа шидэгдэхгүй,
      //    дутуу текст `error: null`-тай «бүрэн» хариулт болж хадгалагдах
      //    байв.  Цуцлагдсан бол ТЭНД Л зогсоно.
      if (signal.aborted) {
        result.stopReason = result.stopReason ?? 'aborted';
        result.error = aiError('CANCELLED');
        emit({ requestId, atMs: at(), type: 'cancelled', safeUserMessage: 'Зогсоолоо' });
        result.totalMs = Math.round(at());
        return result;
      }
    }

    /* ── 6. ХАДГАЛАХ + ЭШЛЭЛ ──────────────────────────────────── */
    /**
     * ⚠️ БҮТЭЛГҮЙТСЭН ХАРИУЛТЫГ АМЖИЛТТАЙ ГЭЖ ХАДГАЛАХГҮЙ (§7).
     *
     *    Давталтад орсон эсвэл хугацаа дууссан текст нь `ai_messages`-д
     *    орвол: (а) яриа сэргээхэд буруу хариулт эргэж гарна, (б) тэр нь
     *    ДАРААГИЙН ээлжийн `history`-д орж загварыг дахин давталт руу
     *    түлхэнэ, (в) сургалтын өгөгдлийн санал хүсэлтэд «зөв» мэт
     *    харагдана.  Гурвуулаа бодит эрсдэл.
     */
    const savable =
      result.answer.length > 0 &&
      result.stopReason !== 'repetition' &&
      result.stopReason !== 'timeout' &&
      // ⚠️ Урсгал дундаа тасарсан ДУТУУ хариулт «бүрэн» мэт хадгалагдаж,
      //    дараагийн ээлжийн түүхэд орж байв (хэмжсэн, Session C).
      result.stopReason !== 'interrupted';
    if (savable) {
      try {
        const saved = await runStage(ctx, 'persist', {}, (sig) =>
          ctx.deps.backend.fetch<{ citations: AiCitation[]; confidence: ConfidenceState | null }>(
            '/mgl-ai/messages',
            {
              method: 'POST',
              data: {
                conv_uid: input.convUid,
                msg_uid: input.aiMsgUid,
                role: 'assistant',
                content: result.answer,
                seq: input.seq + 1,
                evidence: contextResult.evidence,
                regulatory: contextResult.regulatory,
                verification_states: contextResult.verification_states,
                tools_ok: tools.every((t) => t.ok),
                tool_count: tools.filter((t) => t.ok).length,
                runtime_variant: result.runtimeVariant,
                first_token_ms: result.firstTokenMs,
                total_ms: result.totalMs,
                question: input.question,
                show_confidence: contextResult.show_confidence,
                // Гэрээний оношилгоо (§44) — зөвхөн код/тоо, түүхий текст биш.
                contract_diag: result.contractDiag ? { ...result.contractDiag, turn: result.turn?.kind ?? null, legacy: contextResult.trusted_contract?.legacyKind ?? null, norm_state: contextResult.trusted_contract?.normIntel?.evidenceState ?? null } : null,
                // ⚠️ Amendment B — /context-ийн ЦОРЫН ГАНЦ TrustedNormResult, ХӨНДӨЛГҮЙ + гарын үсэг.
                //    Сервер хөдөлгүүрийг ДАХИН ажиллуулахгүй; гарын үсэг таарахгүй бол хаяна.
                trusted_norm_result: contextResult.trusted_norm_result ?? null,
                trusted_norm_sig: contextResult.trusted_norm_sig ?? null,
                trusted_norm_seq: input.seq,
                request_id: requestId,
              },
              timeoutMs: 0,
              signal: sig,
            },
          ),
        );
        result.citations = saved.citations;
        result.confidence = saved.confidence;
        for (const cit of saved.citations) {
          emit({ requestId, atMs: at(), type: 'citation', stage: 'persist', metadata: { id: cit.id } });
        }
      } catch {
        // ⚠️ Хадгалалт унасан ч ХАРИУЛТ дэлгэц дээр ҮЛДЭНЭ.  Энэ нь
        //    хэрэглэгчийн хувьд алдаа БИШ.
      }
    }

    /* ── 7. НОТОЛГООНЫ ШААРДЛАГА (§24, §34) ───────────────────── */
    // ⚠️ Норм дүрмийн асуултад нотолгоо ОГТ олдоогүй бол түүнийг
    //    дэд бүтцийн ГЭМТЭЛ гэж БИШ, «баталгаатай хэлэх боломжгүй» гэж
    //    үзнэ (§20).  Нормын баталгаажилтыг СУЛРУУЛААГҮЙ.
    // ⚠️ P0-14: «хайлт УНАСАН» (timeout / runtime унтарсан) нь «олдсонгүй» БИШ —
    //    өөр код, өөр мөр.  Детерминист үр дүн (verified) байвал нотолгоо дутуу гэж
    //    хэлэхгүй; хүний хяналт/хувилбарын зөрүү нь мөн «олдсонгүй» биш.
    const normVerified = result.normResult !== null && result.normResult.verification === 'verified';
    const normDecided = result.normResult !== null && result.normResult.verification !== 'no_verified_source' && result.normResult.verification !== 'retrieval_failed';
    // L1 баримт олох (norm_documents): жагсаалт нь ӨӨРӨӨ үр дүн — «эх сурвалж олдсонгүй» гэж ХЭЛЭХГҮЙ.
    const documentList = contextResult.trusted_contract?.legacyKind === 'norm_documents';
    // Серверийн детерминист ТАТГАЛЗАЛ (templateOnly + refusal — «санд алга», каталог олдсонгүй) аль хэдийн «олдсонгүй»
    //    гэж хэлсэн: доор дахин «эх сурвалж олдсонгүй» notice нэмбэл хэрэглэгч ИЖИЛ зүйлийг хоёр удаа уншина (эзний
    //    бодит чат, 2026-09-28).
    const refusalTemplate = templateOnly && (contextResult.trusted_contract?.answerMode === 'refusal' || contextResult.trusted_contract?.normIntel != null);
    if (plan.evidence_required && contextResult.evidence.length === 0 && !normVerified && !normDecided && !documentList && !refusalTemplate) {
      if (normOutcome.attempted && (normOutcome.reason === 'timeout' || normOutcome.reason === 'runtime_down' || normOutcome.reason === 'offline' || normOutcome.reason === 'error')) {
        result.error ??= aiError('RETRIEVAL_TIMEOUT');
      } else if (contextResult.norm_decision == null) {
        result.error ??= aiError('NORM_EVIDENCE_MISSING');
      }
    }

    result.totalMs = Math.round(at());
    emit({ requestId, atMs: at(), type: 'completed', durationMs: result.totalMs });
    return result;
  } catch (err) {
    if (signal.aborted) {
      emit({ requestId, atMs: at(), type: 'cancelled', safeUserMessage: 'Зогсоолоо' });
      result.error = aiError('CANCELLED');
      return result;
    }
    // ⚠️ ҮЕ ШАТЫГ АЛДААНААС АВНА, таамаглахгүй — `classifyError` нь
    //    үе шатаар ялгаж «ERP хугацаанд ирсэнгүй» ба «эх сурвалжийн
    //    хайлт дууссангүй»-г салгадаг (§20).
    const failedStage =
      err instanceof StageTimeoutError ? err.stage : ((err as { stage?: AiStage } | null)?.stage ?? 'context');
    const shaped = classifyError(err, failedStage);
    result.error = shaped;
    emit({
      requestId,
      atMs: at(),
      type: 'failed',
      code: shaped.code,
      safeUserMessage: shaped.message,
    } as AiStreamEvent);
    return result;
  }
}

/* ================================================================== */
/*  ДЭД ГИНЖҮҮД                                                        */
/* ================================================================== */

/**
 * СУДАЛГААНЫ ГОГЦОО — шат бүрд сервер дараагийн хэрэгслийг шийднэ (§13).
 *
 * ⚠️ ХӨТӨЧ ШИЙДВЭР ГАРГАХГҮЙ.  «Deadline-ийн эхний төслийг шинжил» гэсэн
 *    дүрэм СЕРВЕРТ (`researchPlan.ts`); энд зөвхөн: үр дүнг буцаана, `done`
 *    хүртэл давтана, шат бүрийг ҮЙЛ ЯВДЛААР харуулна.  Дээд хязгаар нь
 *    серверийн `max_rounds` (3) — гогцоо зогсолтгүй болохгүй.
 *
 * ⚠️ ШАТ ≥1 нь БОДИТ дуудлагатай таарна («Нэмэлт мэдээлэл шалгаж байна»
 *    гэсэн мөр нь `/plan`+`/tool` ажиллаж байгаа үед Л гарна) — хуурамч
 *    явц ХОРИОТОЙ (§27).
 */
async function runResearch(
  ctx: TurnCtx,
  plan: PlanResponse,
  input: TurnInput,
): Promise<ToolRun[]> {
  const at = () => performance.now() - ctx.t0;
  const all: ToolRun[] = await runTools(ctx, plan, input);
  const maxRounds = Math.max(1, Math.min(plan.max_rounds ?? 3, 3));
  let step: PlanResponse = plan;
  for (let round = 1; round < maxRounds && step.done === false; round++) {
    if (ctx.signal.aborted) break;
    const next = await runStage(
      ctx,
      'plan',
      { key: `round-${round}`, label: 'Олдсон мэдээллээс дараагийн алхмыг шийдэж байна', doneLabel: 'Дараагийн алхмыг шийдлээ' },
      (sig) =>
        ctx.deps.backend.fetch<PlanResponse>('/mgl-ai/plan', {
          method: 'POST',
          data: {
            question: input.question,
            request_id: ctx.requestId,
            conv_state: input.convState ?? null,
            seq: input.seq,
            round,
            prior_results: all.map((t) => ({ tool: t.tool, ok: t.ok, data: t.data, args: t.args ?? {} })),
          },
          timeoutMs: 0,
          signal: sig,
        }),
    );
    step = next;
    if (next.tools.length === 0) break;
    ctx.emit({
      requestId: ctx.requestId,
      atMs: at(),
      type: 'stage.started',
      stage: 'tools',
      safeUserMessage: `Нэмэлт мэдээлэл шалгаж байна (${round + 1}-р шат)`,
      metadata: { key: `round-${round}`, round, reason: next.research_reason ?? null },
    });
    const more = await runTools(ctx, next, input, { key: `round-${round}` });
    all.push(...more);
  }
  return all;
}

/**
 * ERP хэрэгслүүд — ⚠️ ЗЭРЭГ, дараалуулахгүй (§15).
 *
 * ⚠️ НЭГ ХЭРЭГСЭЛ УНАСАН НЬ ЭЭЛЖИЙГ УНАГААХГҮЙ.  `Promise.all` нь эхний
 *    алдаа дээр бүгдийг хаядаг тул тус бүрийг өөрийнх нь `catch`-аар
 *    боож, `ok: false` болгоно — загвар «энэ өгөгдөл алга» гэдгийг
 *    хариултдаа хэлж чадна.
 */
async function runTools(
  ctx: TurnCtx,
  plan: PlanResponse,
  input: TurnInput,
  opts: { key?: string } = {},
): Promise<ToolRun[]> {
  if (plan.tools.length === 0) return [];
  const at = () => performance.now() - ctx.t0;

  return runStage(
    ctx,
    'tools',
    { key: opts.key, doneLabel: `Компанийн мэдээллийг авлаа (${plan.tools.length})` },
    async (sig) =>
      Promise.all(
        plan.tools.map(async (t) => {
          const started = performance.now();
          ctx.emit({
            requestId: ctx.requestId,
            atMs: at(),
            type: 'tool.started',
            stage: 'tools',
            metadata: { tool: t.name },
          });
          try {
            const res = await ctx.deps.backend.fetch<{ ok: boolean; data: unknown }>('/mgl-ai/tool', {
              method: 'POST',
              data: {
                conv_uid: input.convUid,
                name: t.name,
                args: t.args,
                request_id: ctx.requestId,
              },
              timeoutMs: 0,
              signal: sig,
            });
            const durationMs = Math.round(performance.now() - started);
            ctx.emit({
              requestId: ctx.requestId,
              atMs: at(),
              type: 'tool.completed',
              stage: 'tools',
              durationMs,
              metadata: { tool: t.name, ok: res.ok },
            });
            return { tool: t.name, ok: res.ok, data: res.data, durationMs, args: t.args };
          } catch {
            const durationMs = Math.round(performance.now() - started);
            ctx.emit({
              requestId: ctx.requestId,
              atMs: at(),
              type: 'tool.completed',
              stage: 'tools',
              durationMs,
              metadata: { tool: t.name, ok: false },
            });
            return { tool: t.name, ok: false, data: null, durationMs, args: t.args };
          }
        }),
      ),
  );
}

/**
 * Локал нормын сан (§17).
 *
 * ⚠️ ГАНЦ ХАМГИЙН ЧУХАЛ ЗАСВАР ЭНД.  Энэ дуудлага ӨМНӨ НЬ ОГТ
 *    БАЙГААГҮЙ — чат нь D1-ийн `ai_knowledge_chunks`-аас хайдаг байсан
 *    бөгөөд тэр хүснэгт нь БҮХ орчинд 0 мөртэй (хэмжсэн 2026-09-09).
 *    Тиймээс §17-ийн асуулт нь timeout БИШ, харин нотолгоо огт хайгддаггүй
 *    учраас «эх сурвалж олдсонгүй» болдог байв.
 *
 * ⚠️ «ОЛДСОНГҮЙ» ба «ХАЙЛТ УНАСАН»-Г ЯЛГАНА (§17).  Timeout нь заалт
 *    байхгүй гэсэн үг БИШ — тэднийг нэгтгэвэл хэрэглэгч буруу дүгнэлт
 *    хийнэ.
 */
async function runNorm(
  ctx: TurnCtx,
  plan: PlanResponse,
  input: TurnInput,
): Promise<NormRetrievalOutcome> {
  // ⚠️ СЕРВЕР ШИЙДНЭ.  Клиент дээр түлхүүр үгээр дахин ангилах нь хосын
  //    зөрүү үүсгэнэ — энэ репогийн хамгийн түгээмэл алдаа.
  if (!plan.ask_local_norm) return { answer: null, attempted: false, reason: 'not_asked' };
  if (input.runtime?.installed !== true) return { answer: null, attempted: true, reason: 'runtime_down' };

  const at = () => performance.now() - ctx.t0;

  return runStage(ctx, 'norm_retrieval', {}, async (sig): Promise<NormRetrievalOutcome> => {
    ctx.emit({
      requestId: ctx.requestId,
      atMs: at(),
      type: 'source.search.started',
      stage: 'norm_retrieval',
    });
    // ⚠️ Нормын ДААЛГАВРЫН текст Л — «Хэдэн төсөл? Бас В2 ачаалал?» гэсэн
    //    мессежийг бүхэлд нь өгвөл ERP-ийн үгс BM25-ыг хамааралгүй заалт
    //    руу татна.  Сервер `/plan`-д хуваасан.
    const res = await ctx.deps.runtime.askNorm(plan.norm_query ?? input.question, {
      signal: sig,
      audience: input.mode === 'client' ? 'client' : 'employee',
    });

    if (!res.ok) {
      // ⚠️ ЭНЭ НЬ АЛДАА БИШ — сан суулгаагүй эсвэл удаан.  Ээлж
      //    үргэлжилнэ; UI нь ялгаатай мөр харуулна.
      ctx.emit({
        requestId: ctx.requestId,
        atMs: at(),
        type: 'warning',
        stage: 'norm_retrieval',
        safeUserMessage:
          res.reason === 'not_installed'
            ? 'Нормын сан энэ компьютерт суулгаагүй байна'
            : res.reason === 'timeout'
              ? 'Нормын хайлт хугацаанд дууссангүй'
              : 'Нормын санд холбогдож чадсангүй',
        metadata: { reason: res.reason },
      });
      const reason: NormRetrievalOutcome['reason'] =
        res.reason === 'not_installed' ? 'not_installed' : res.reason === 'timeout' ? 'timeout' : res.reason === 'offline' ? 'offline' : 'error';
      return { answer: null, attempted: true, reason };
    }

    // ⚠️ Хайлтын урьдчилсан хэсгүүдийг `source.found` гэж ТООЛОХГҮЙ (P0-16) — сервер
    //    `/context`-д аль нь ХЭРЭГЛЭГДСЭНийг шийднэ; тэнд л эх сурвалж болно.
    ctx.emit({
      requestId: ctx.requestId,
      atMs: at(),
      type: 'norm.rule.completed',
      stage: 'norm_retrieval',
      metadata: { status: res.answer.status, rule_id: res.answer.rule_id, candidates: res.answer.evidence.length },
    });
    return { answer: res.answer, attempted: true, reason: 'ok' };
  }).catch((err: unknown): NormRetrievalOutcome => ({ answer: null, attempted: true, reason: err instanceof StageTimeoutError ? 'timeout' : 'error' }));
}

/**
 * МЭДЛЭГИЙН САНГИЙН КАТАЛОГ (2026-09-18) — «чамд ямар норм байгаа вэ» / «БНбД X юуны тухай вэ».
 *
 * ⚠️ Хайлт БИШ, `ai_documents`-ийн жагсаалт — тиймээс `norm_retrieval` шатанд явна
 *    (ижил шошго «нормын сангаас»), гэвч `askNorm`-оос ТУСДАА дуудлага.  Сервер
 *    `ask_norm_catalog`-оор шийднэ; хөтөч түлхүүр үгээр ДАВХАРДУУЛАХГҮЙ.
 * ⚠️ Тээвэрт `askNormCatalog` байхгүй (хуучин орлуулагч) бол `error` — ээлж үргэлжилнэ,
 *    сервер «каталог ирсэнгүй» гэж хэлнэ; хэзээ ч зохиохгүй.
 */
async function runCatalog(ctx: TurnCtx, plan: PlanResponse, input: TurnInput): Promise<NormCatalogOutcome> {
  const ask = plan.ask_norm_catalog ?? null;
  if (ask === null) return { catalog: null, attempted: false, reason: 'not_asked' };
  if (input.runtime?.installed !== true) return { catalog: null, attempted: true, reason: 'runtime_down' };
  const fn = ctx.deps.runtime.askNormCatalog;
  if (typeof fn !== 'function') return { catalog: null, attempted: true, reason: 'error' };
  const at = () => performance.now() - ctx.t0;
  return runStage(ctx, 'norm_retrieval', {}, async (sig): Promise<NormCatalogOutcome> => {
    ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'source.search.started', stage: 'norm_retrieval', safeUserMessage: ask.code ? `${ask.code} баримтын бүтцийг уншиж байна` : 'Нормын сангийн жагсаалтыг уншиж байна' });
    const res = await fn.call(ctx.deps.runtime, ask.code, { signal: sig });
    if (!res.ok) {
      ctx.emit({
        requestId: ctx.requestId,
        atMs: at(),
        type: 'warning',
        stage: 'norm_retrieval',
        safeUserMessage: res.reason === 'not_installed' ? 'Нормын сан энэ компьютерт суулгаагүй байна' : res.reason === 'timeout' ? 'Нормын сангийн жагсаалт хугацаанд ирсэнгүй' : 'Нормын санд холбогдож чадсангүй',
        metadata: { reason: res.reason },
      });
      const reason: NormCatalogOutcome['reason'] = res.reason === 'not_installed' ? 'not_installed' : res.reason === 'timeout' ? 'timeout' : res.reason === 'offline' ? 'offline' : 'error';
      return { catalog: null, attempted: true, reason };
    }
    const c = res.catalog;
    ctx.emit({
      requestId: ctx.requestId,
      atMs: at(),
      type: 'norm.rule.completed',
      stage: 'norm_retrieval',
      metadata: { kind: c.kind, documents: c.kind === 'inventory' ? c.documents.length : c.kind === 'document' ? 1 : 0 },
    });
    return { catalog: c, attempted: true, reason: 'ok' };
  }).catch((err: unknown): NormCatalogOutcome => ({ catalog: null, attempted: true, reason: err instanceof StageTimeoutError ? 'timeout' : 'error' }));
}

/** Локал загвараар үүсгэх + НЭГ УДААГИЙН хэлний засвар. */
async function generate(
  ctx: TurnCtx,
  contextResult: AiContextResponse,
  result: TurnResult,
): Promise<void> {
  const at = () => performance.now() - ctx.t0;
  const turns = contextResult.turns;
  let streamError: string | null = null;
  /** Runtime `done` фрейм ИЛГЭЭСЭН эсэх — ирээгүй бол урсгал ТАСАРСАН. */
  let doneReceived = false;
  /** Runtime урсгал эхлэхээс өмнө татгалзсан (413/503 …). */
  let rejected: { status: number; code: string | null; message: string } | null = null;

  /**
   * ХОЛБОЛТЫН ХАРУУЛ (§10, §23).
   *
   * ⚠️ ЛОКАЛ RUNTIME 2 СЕКУНД ТУТАМ ЦОХИЛТ ИЛГЭЭНЭ, токен нь өөрөө ч
   *    цохилтын үүрэг гүйцэтгэнэ.  Тэднээс аль нь ч 12 секунд ирэхгүй
   *    бол сувгийг «тасарсан» гэж үзнэ — гэхдээ мессежийг УСТГАХГҮЙ,
   *    ХҮСЭЛТИЙГ Ч ЦУЦЛАХГҮЙ.  Дараагийн цохилт ирмэгц өөрөө сэргэнэ.
   */
  let lastSignalMs = performance.now();
  const watchdog = setInterval(() => {
    if (performance.now() - lastSignalMs < HEARTBEAT_GAP_MS) return;
    ctx.emit({
      requestId: ctx.requestId,
      atMs: at(),
      type: 'warning',
      stage: 'generation',
      safeUserMessage: 'Холболтыг сэргээж байна…',
      metadata: { connection: 'lost' },
    });
  }, 2_000);

  await runStage(ctx, 'generation', {}, async (sig) => {
    ctx.emit({
      requestId: ctx.requestId,
      atMs: at(),
      type: 'generation.started',
      stage: 'generation',
      safeUserMessage: 'Хариулт боловсруулж байна',
    });

    /**
     * ⚠️ ӨНДӨР ЭРСДЭЛТЭЙ ХАРИУЛТЫГ БАТЛАГДТАЛ ХАРУУЛАХГҮЙ (§36).  Норм,
     *    тооцоо, Revit-ийн бичилт — эдгээрт зохиомол тоо дэлгэц дээр
     *    «анивчаад алга болох» нь хүлээн зөвшөөрөгдөхгүй.  Токенийг
     *    хуримтлуулж, цохилтоор амьд байгааг л мэдэгдэнэ; шалгалт тэнцмэгц
     *    НЭГ дор харуулна.  Дунд/бага эрсдэлд урсгал хэвээр.
     */
    const contract: TrustedContract | null = contextResult.trusted_contract ?? null;
    const gated = contract !== null && contract.risk === 'high';

    await ctx.deps.runtime.streamGenerate(
      turns,
      {
        onToken: (text) => {
          lastSignalMs = performance.now();
          result.answer += text;
          if (gated) {
            ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'heartbeat', stage: 'generation', metadata: { buffered: result.answer.length } });
          } else {
            ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text });
          }
        },
        onHeartbeat: (elapsedMs) => {
          lastSignalMs = performance.now();
          ctx.emit({
            requestId: ctx.requestId,
            atMs: at(),
            type: 'heartbeat',
            stage: 'generation',
            metadata: { elapsed_ms: elapsedMs },
          });
        },
        onDone: (meta) => {
          doneReceived = true;
          result.firstTokenMs = meta.first_token_ms;
          result.totalMs = meta.total_ms;
          result.engine = meta.engine;
          result.runtimeVariant = meta.runtime_variant;
          result.stopReason = meta.stop_reason;
        },
        onError: (msg) => {
          streamError = msg;
        },
        onRejected: (info) => {
          rejected = info;
        },
      },
      { signal: sig, maxTokens: 900, responseLanguage: contextResult.response_language },
    );

    /* ── УРСГАЛ ТАСАРСАН УУ (Session C, §17) ───────────────────── */
    // ⚠️ `done` ирээгүй = хариулт ДУТУУ: runtime унасан, холболт тасарсан,
    //    эсвэл `error` фрейм ирсэн.  Өмнө нь `stopReason=null` үлдэж, дутуу
    //    текст бүрэн мэт харагдаж, хадгалагдаж байв (хэмжсэн 3 хувилбар).
    if (!doneReceived && !sig.aborted && rejected === null && result.answer.length > 0) {
      result.stopReason = 'interrupted';
    }

    /* ── ХЭЛНИЙ ЗАСВАР — §34-ийн хамгаалалт хэвээр ─────────────── */
    // ⚠️ ЗӨВХӨН ХЭЛ буруу үед.  Тээврийн гажгийг цэвэрлэдэг тул дахин
    //    үүсгэх шаардлагагүй — дахилт бүр хариуг ХОЁР ДАХИН удаашруулна.
    // ⚠️ ДАВТАЛТАД ОРСОН ХАРИУЛТЫГ ЗАСВАРЛАХГҮЙ.  Хэлний засвар нь
    //    «англиар бичсэн» гэсэн асуудлыг засдаг; давтагдсан хариултыг
    //    оролт болгон өгвөл загвар давталтаа ҮРГЭЛЖЛҮҮЛНЭ (§7:
    //    «Do not append a retry to the broken answer or include the
    //    broken answer in its prompt»).
    /* ── R4.2: ИТГЭМЖЛЭГДЭЭГҮЙ үйлдлийн саналын блок — ХЭЛНИЙ ЗАСВАР, ДАВХАРДАЛ, ГЭРЭЭНИЙ ӨМНӨ салгана ── */
    // ⚠️ JSON-ы латин үсэг/тоо нь монгол хэлний хувь, allowedNumbers, өгүүлбэрийн давхардалд ХЭЗЭЭ Ч орохгүй.
    //    Блок байхгүй бол текст өөрчлөгдөхгүй (хөтчийн зам байт-ижил).
    if (result.stopReason !== 'repetition' && result.stopReason !== 'interrupted' && !sig.aborted) {
      const ex = extractActionCandidate(result.answer);
      if (ex.found) {
        result.answer = ex.text;
        result.revitActionCandidate = ex.candidate;
        result.revitActionCandidateRejected = ex.rejected;
        if (!(contextResult.trusted_contract?.risk === 'high')) {
          ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'answer.reset', stage: 'generation' });
          ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text: result.answer });
        }
        ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'warning', stage: 'generation', safeUserMessage: ex.candidate ? 'Загвар өөрчлөлтийн САНАЛ гаргалаа — preview + таны баталгаагүйгээр бичихгүй' : 'Загварын үйлдлийн санал схемд тэнцсэнгүй — хаягдав', metadata: { candidate: ex.candidate ? ex.candidate.action_type : null, rejected: ex.rejected } });
      }
    }

    const check =
      result.stopReason === 'repetition'
        ? { needsRepair: false }
        : validateAnswer(result.answer, contextResult.response_language);
    if (check.needsRepair && !sig.aborted) {
      ctx.emit({
        requestId: ctx.requestId,
        atMs: at(),
        type: 'warning',
        stage: 'generation',
        safeUserMessage: 'Хариулт монгол хэл рүү дахин бичигдэж байна',
      });
      let repaired = '';
      const before = result.answer;
      result.answer = '';
      // ⚠️ REDUCER-ИЙН ХУРИМТЛУУЛАГЧИЙГ Ч ЦЭВЭРЛЭНЭ.  Үүнгүйгээр
      //    засварын токенууд нь ХУУЧИН хариултын ард наалдаж, хэрэглэгч
      //    ижил агуулгыг ХОЁР УДАА хардаг байв — «AI өөрийгөө давтаж
      //    байна» гэсэн гомдлын програм талын эх үүсвэр.
      ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'answer.reset', stage: 'generation' });
      await ctx.deps.runtime.streamGenerate(
        [
          ...turns,
          { role: 'assistant', content: before },
          { role: 'user', content: REPAIR_PROMPT_MN },
        ],
        {
          onToken: (text) => {
            repaired += text;
            result.answer = repaired;
            if (!gated) {
              ctx.emit({
                requestId: ctx.requestId,
                atMs: at(),
                type: 'token',
                stage: 'generation',
                text,
              });
            }
          },
          onDone: () => undefined,
          onError: () => undefined,
        },
        { signal: sig, maxTokens: 900, responseLanguage: contextResult.response_language },
      );
      const after = validateAnswer(repaired, contextResult.response_language);
      // ⚠️ Засвар нь ДЭЭР байвал Л авна — буруу хэлтэй хариу нь ХООСОН
      //    хариунаас дээр.
      result.answer = repaired.trim().length > 0 && !after.needsRepair ? repaired : before;
    }

    result.answer = cleanOutput(result.answer);

    /* ── ЯГ ИЖИЛ ӨГҮҮЛБЭРИЙН ДАВХАРДАЛ (§20) — бүх горимд ────────── */
    // ⚠️ Хэмжигдсэн: урт тайлбарт 33% давхардсан өгүүлбэр (runtime-ийн
    //    мөчлөгийн хамгаалагч ЗЭРЭГЦЭЭ давталтыг л барьдаг).  Зөвхөн яг
    //    ижил, ≥4 үгтэй өгүүлбэр; ил мэдэгдэнэ.
    if (result.stopReason !== 'repetition' && result.stopReason !== 'interrupted' && !sig.aborted) {
      const dd = dedupeSentences(result.answer);
      if (dd.removed > 0) {
        result.answer = dd.text;
        if (!(contextResult.trusted_contract?.risk === 'high')) {
          ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'answer.reset', stage: 'generation' });
          ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text: result.answer });
        }
        ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'warning', stage: 'generation', safeUserMessage: `Давхардсан ${dd.removed} өгүүлбэрийг хаслаа` });
      }
    }

    /* ── ХҮНД ДАВТАЛТ — ХАРУУЛАХААС ӨМНӨ (NORM-INTEL v3, 2026-10-04) ─────────────── */
    // ⚠️ Runtime-ийн мөчлөгийн хамгаалагч зөвхөн ЗЭРЭГЦЭЭ мөчлөгийг урсгалын үеэр барьдаг.  «төсөл, ашиглалтын нөхцөл, төрөл,
    //    төлөв, төсөл, …» гэх жагсаалтын гогцоо, олон давтагдсан догол, үгийн олон янз байдлын доройтол нь бүтэн хариултад л
    //    харагддаг.  Хүнд давталттай хариулт ХЭЗЭЭ Ч харагдахгүй: гэрээний детерминист хариулт (доор), эс бөгөөс хоосон + алдаа.
    if (result.stopReason !== 'repetition' && result.stopReason !== 'interrupted' && result.stopReason !== 'template' && !sig.aborted) {
      const rep = detectSevereRepetition(result.answer);
      if (rep.severe) {
        result.stopReason = 'repetition';
        const c = contextResult.trusted_contract;
        if (!(c != null && c.answerMode !== 'free' && c.template != null)) result.answer = '';
        if (!gated) ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'answer.reset', stage: 'generation' });
        ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'warning', stage: 'generation', safeUserMessage: 'Хариулт давталтад орсон тул харуулсангүй', metadata: { repetition: rep.kind, detail: rep.detail } });
      }
    }

    /* ── SYSTEM PROMPT-ЫН ЦУУРАЙ (2026-09-28) — бүх горимд ──────────── */
    // ⚠️ Хэмжсэн (бодит чат, адаптер 0.4): гомдолд загвар хэлний тушаалаа үгчлэн буцаасан.  Дотоод заавар
    //    хэрэглэгчид ХЭЗЭЭ Ч харагдахгүй; хариулт бүхэлдээ цуурай бол гэрээний template, байхгүй бол шударга
    //    «хариулт гаргаж чадсангүй».
    if (result.stopReason !== 'repetition' && result.stopReason !== 'interrupted' && !sig.aborted) {
      const systemText = turns.find((t) => t.role === 'system')?.content ?? '';
      const echo = stripPromptEcho(result.answer, systemText, [contract?.requiredSentence, contract?.template, contract?.trailerText]);
      if (echo.removed > 0) {
        result.answer = echo.dominated
          ? contract !== null && contract.answerMode !== 'free' && contract.template !== null
            ? fallbackAnswer(contract, contextResult.response_language)
            : echoFallbackText(contextResult.response_language)
          : echo.text;
        if (!gated) {
          ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'answer.reset', stage: 'generation' });
          ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text: result.answer });
        }
        ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'warning', stage: 'generation', safeUserMessage: `Дотоод зааврыг давтсан ${echo.removed} өгүүлбэрийг хаслаа`, metadata: { promptEcho: echo.removed, dominated: echo.dominated } });
      }
    }

    /* ── ДЕТЕРМИНИСТ ҮР ДҮНТЭЙ ЭЭЛЖИД ЗАГВАР УНАВАЛ — СЕРВЕРИЙН ХАРИУЛТ (§13 safe fallback) ── */
    // ⚠️ Хэмжсэн (бодит хөтөч, 2026-09-11, GPU-г өөр процесс эзэлсэн үед): үүсгэлт 300 с-д
    //    дуусаагүй → «Хариулт үүсгэх хугацаа дууслаа» + тасарсан текст, харин серверийн
    //    TrustedNormResult (В2, Хүснэгт 4, х.13) БЭЛЭН байсан.  Давталт/хугацаа/загварын
    //    алдаа нь нормын ээлжид ХАРИУЛТГҮЙ үлдэх шалтгаан БИШ — детерминист template-ийг
    //    харуулж, хадгална (гарын үсэгтэй үр дүн /messages-д очно, шошго «Баталгаажсан»).
    const generationFailed = result.stopReason === 'repetition' || result.stopReason === 'timeout' || (streamError !== null && result.answer.trim().length === 0);
    if (contract !== null && contract.answerMode !== 'free' && contract.template !== null && generationFailed && !sig.aborted) {
      const why = result.stopReason === 'repetition' ? 'давталтад орсон' : result.stopReason === 'timeout' ? 'хугацаандаа амжаагүй' : 'алдаа гаргасан';
      result.answer = fallbackAnswer(contract, contextResult.response_language);
      result.stopReason = 'template';
      streamError = null;
      result.contractDiag = { mode: contract.answerMode, risk: contract.risk, attempts: 1, violations: [], final: 'template', buffered: gated };
      ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'answer.reset', stage: 'generation' });
      ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text: result.answer });
      ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'warning', stage: 'validate', safeUserMessage: `Загвар ${why} тул баталгаажсан хариултыг шууд харуулав`, metadata: { contract: contract.answerMode, fallback: 'template' } });
    }

    /* ── ИТГЭМЖЛЭГДСЭН БАРИМТЫН ГЭРЭЭ (tfc-1) — үнэн > загвар (§5–§8) ── */
    // ⚠️ Давталт/хугацааны алдаатай хариултыг засахгүй — тэр нь хүчингүй.
    if (contract !== null && contract.answerMode !== 'free' && result.stopReason !== 'repetition' && result.stopReason !== 'timeout' && result.stopReason !== 'template' && result.stopReason !== 'interrupted' && !sig.aborted) {
      await enforceTrusted(ctx, contract, contextResult, turns, result, sig, gated);
    } else if (gated && result.answer.length > 0 && result.stopReason !== 'template') {
      ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text: result.answer });
    }

    /* ── ХУУЧИН ГЭРЭЭ — зөвхөн шинэ гэрээгүй сервертэй үед ─────────── */
    if (contract === null && result.stopReason !== 'repetition' && result.stopReason !== 'timeout' && result.stopReason !== 'interrupted' && !sig.aborted) {
      const outcome = applyContract(result.answer, contextResult.answer_contract);
      if (outcome.answer !== result.answer) {
        result.answer = outcome.answer;
        // Урсгалаар харагдсан текст солигдсон тул хуримтлуулагчийг цэвэрлэж,
        // засварласан хариултыг НЭГ токеноор дахин тавина.
        ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'answer.reset', stage: 'generation' });
        ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text: outcome.answer });
      }
      for (const n of outcome.notices) {
        ctx.emit({
          requestId: ctx.requestId,
          atMs: at(),
          type: 'warning',
          stage: 'generation',
          safeUserMessage: n,
          metadata: { contract: contextResult.answer_contract?.kind ?? 'none' },
        });
      }
    }
  }).finally(() => clearInterval(watchdog));

  if (rejected !== null) {
    // Runtime урсгал эхлэхээс ӨМНӨ татгалзсан — кодоор нь ялгана.
    const r = rejected as { status: number; code: string | null; message: string };
    result.error =
      r.status === 0
        ? aiError('LOCAL_RUNTIME_OFFLINE')
        : r.code === 'context_overflow'
          ? aiError('CONTEXT_OVERFLOW')
          : r.status === 503
            ? aiError('MODEL_NOT_READY', { message: r.message })
            : aiError('MODEL_ERROR', { message: r.message });
  } else if (streamError !== null && result.answer.length === 0) {
    result.error = aiError('MODEL_ERROR', { message: streamError });
  } else if (result.stopReason === 'interrupted') {
    result.error = aiError('GENERATION_INTERRUPTED', streamError ? { hint: `${aiError('GENERATION_INTERRUPTED').hint} (${streamError})` } : undefined);
  }

  /**
   * ⚠️ ДАВТАЛТ = БҮТЭЛГҮЙТЭЛ, АМЖИЛТ БИШ (§7).
   *
   *    Локал runtime үүсгэлтийг аль хэдийн ЗОГСООСОН.  Энд хийх зүйл нь
   *    түүнийг ЗӨВ хариулт болгон бүртгэхгүй байх: `error` тавигдсанаар
   *    `runTurn` нь хадгалах алхмыг алгасаж, UI нь «бүрэн бус» гэж
   *    тэмдэглээд НЭГ удаа дахин бичих боломж өгнө.
   */
  if (result.stopReason === 'repetition') {
    result.error = aiError('GENERATION_REPETITION');
  } else if (result.stopReason === 'timeout') {
    result.error = aiError('GENERATION_TIMEOUT');
  }
}

/* ================================================================== */
/*  ИТГЭМЖЛЭГДСЭН БАРИМТЫН ГЭРЭЭ — ШАЛГАХ, ЗАСАХ, ДАХИН ҮҮСГЭХ, УНАХ    */
/* ================================================================== */

/** Гэрээний оношилгоог хүнд харуулах мөр — сэтгэлгээ БИШ, шалгалтын код. */
function violationSummary(v: ValidationResult): string {
  return [...new Set(v.violations.map((x: { code: string }) => x.code))].join(', ');
}

/**
 * ⚠️ ХЯЗГААРЛАГДСАН СЭРГЭЭЛТ (§7):
 *    1-р оролдлого → шалгах → тэнцвэл харуулна (засвар хэрэгтэй бол ил хэлнэ)
 *    тэнцэхгүй → ЯГ НЭГ дахилт (зөрчлийг нэрлэсэн засварын тушаалтай)
 *    тэнцэхгүй → серверийн ДЕТЕРМИНИСТ хариулт (§39).
 *    Гогцоо ҮГҮЙ, дээд тал нь 2 үүсгэлт.
 *
 * ⚠️ ҮҮСГЭЛТ ДУУСТАЛ ХЭРЭГЛЭГЧ ЮУ Ч ХАРААГҮЙ (gated) бол эцсийн текстийг
 *    НЭГ токеноор; харагдсан бол `answer.reset` + нэг токен.
 */
async function enforceTrusted(
  ctx: TurnCtx,
  contract: TrustedContract,
  contextResult: AiContextResponse,
  turns: AiContextResponse['turns'],
  result: TurnResult,
  sig: AbortSignal,
  gated: boolean,
): Promise<void> {
  const at = () => performance.now() - ctx.t0;
  const lang = contextResult.response_language;
  const streamed = result.answer;
  const diag: ContractDiag = { mode: contract.answerMode, risk: contract.risk, attempts: 1, violations: [], final: 'model', buffered: gated };

  ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'stage.started', stage: 'validate', safeUserMessage: 'Хариултыг баталгаажсан баримттай тулгаж байна' });
  const t0 = performance.now();

  const out = enforceContract(result.answer, contract, lang);
  diag.violations.push(out.before.violations.map((v: { code: string }) => v.code));
  let final = out.answer;
  let notices = out.notices;
  if (hasHardViolation(out.before)) {
    /* ── tfc-2 ХАТУУ ИНВАРИАНТ: загварын хариулт ХАЯГДСАН, дахилт ҮГҮЙ (§13) ── */
    // `enforceContract` аль хэдийн серверийн детерминист хариултыг буцаасан.
    diag.final = 'template';
    ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'warning', stage: 'validate', safeUserMessage: `Загварын хариулт баталгаажсан үр дүнтэй зөрсөн (${violationSummary(out.before)}) — баталгаажсан хариултыг шууд харуулна` });
  } else if (out.validation.ok) {
    diag.final = out.outcome;
  } else {
    /* ── 2-р оролдлого: зөрчлийг нэрлэсэн дахилт ─────────────────── */
    diag.attempts = 2;
    ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'warning', stage: 'validate', safeUserMessage: `Хариулт баталгаажсан баримттай зөрсөн (${violationSummary(out.before)}) — дахин бичүүлж байна` });
    let regen = '';
    await ctx.deps.runtime.streamGenerate(
      [...turns, { role: 'assistant', content: result.answer }, { role: 'user', content: correctionPrompt(contract, out.before, lang) }],
      { onToken: (t) => { regen += t; }, onDone: () => undefined, onError: () => undefined },
      { signal: sig, maxTokens: 700, responseLanguage: lang },
    );
    const second = enforceContract(cleanOutput(regen), contract, lang);
    diag.violations.push(second.before.violations.map((v: { code: string }) => v.code));
    if (second.validation.ok && regen.trim().length > 0) {
      final = second.answer;
      notices = second.notices;
      diag.final = second.outcome === 'model' ? 'regenerated' : 'repaired';
    } else {
      /* ── Детерминист хариулт — зөв атлаа хатуу монгол (§39) ──── */
      final = fallbackAnswer(contract, lang);
      notices = ['Загварын хариулт баталгаажсан баримттай хоёр удаа зөрсөн тул баталгаажсан хариултыг шууд харуулав.'];
      diag.final = 'template';
    }
  }

  ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'stage.completed', stage: 'validate', safeUserMessage: out.validation.ok && out.outcome === 'model' ? 'Хариулт баталгаажсан баримттай нийцэж байна' : 'Хариултыг баталгаажсан баримтаар зассан', durationMs: Math.round(performance.now() - t0), metadata: { final: diag.final, attempts: diag.attempts } });

  result.answer = final;
  result.contractDiag = diag;
  if (gated) {
    ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text: final });
  } else if (final !== streamed) {
    ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'answer.reset', stage: 'generation' });
    ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'token', stage: 'generation', text: final });
  }
  for (const n of notices) {
    ctx.emit({ requestId: ctx.requestId, atMs: at(), type: 'warning', stage: 'validate', safeUserMessage: n, metadata: { contract: contract.answerMode } });
  }
}

/* ================================================================== */
/*  ЛОКАЛ ХӨДӨЛГҮҮРГҮЙ ҮЕИЙН ХАРИУ                                     */
/* ================================================================== */

/**
 * ⚠️ ЭНЭ НЬ ХУУРАМЧ ХАРИУ БИШ.  Загвар зохиохгүй — олдсон заалт,
 *    хэрэгслийн бодит үр дүнг эшлэлтэй нь ЖАГСААНА.
 */
export function renderRetrievalOnly(
  ctx: AiContextResponse,
  tools: readonly ToolRun[],
  norm: NormAnswer | null,
): string {
  const lines: string[] = [
    'Локал MGL AI хөдөлгүүр ажиллахгүй байгаа тул өгүүлбэр үүсгэхгүй. Олдсон баримтыг шууд харуулж байна.',
    '',
  ];

  // ⚠️ ДЕТЕРМИНИСТ НОРМЫН ҮР ДҮН загваргүйгээр ч БҮРЭН хариулт (сервер тооцоолсон) —
  //    түүнийг эхэнд, provenance-той нь.  Хайлтын түүхий заалтуудыг давхардуулахгүй.
  const tnr = ctx.trusted_norm_result ?? null;
  if (tnr !== null) {
    const text = ctx.trusted_contract?.template ?? (ctx.response_language === 'en' && tnr.textEn ? tnr.textEn : tnr.textMn);
    lines.push(text);
    for (const f of tnr.followups) if (f.required && !text.includes(f.textMn)) lines.push(ctx.response_language === 'en' ? f.textEn : f.textMn);
    if (tnr.provenance.length > 0) {
      lines.push('');
      lines.push('Эх сурвалж:');
      for (const p of tnr.provenance) lines.push(`  · ${p.labelMn}`);
    }
    if (ctx.trusted_contract?.trailerText) {
      lines.push('');
      lines.push(ctx.trusted_contract.trailerText);
    }
    lines.push('');
  }

  if (tools.length > 0) {
    lines.push('ERP-ийн амьд өгөгдөл:');
    for (const t of tools) {
      // ⚠️ Офлайн горимд 8 хэрэгслийн бүрэн JSON нь дэлгэц дүүргэнэ — товчилно.
      const raw = t.ok ? JSON.stringify(t.data) : 'татаж чадсангүй';
      lines.push(`  · ${t.tool}: ${raw.length > 1500 ? `${raw.slice(0, 1500)}… [товчилсон]` : raw}`);
    }
    lines.push('');
  }

  if (tnr === null && norm?.citation?.label_mn) {
    lines.push(`Нормын лавлагаа: ${norm.citation.label_mn}`);
    if (norm.rule_object_mn) lines.push(`  ${norm.rule_object_mn}`);
    lines.push('');
  }

  if (tnr === null && ctx.evidence.length > 0) {
    lines.push('Холбогдох эх сурвалж:');
    ctx.evidence.forEach((e, i) => {
      const bits = [
        e.document_uid,
        e.section ? `§${e.section}` : null,
        e.page != null ? `х.${e.page}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      lines.push(`  [${i + 1}] ${e.title}${bits ? ` — ${bits}` : ''}`);
    });
    lines.push('');
    lines.push(`Эшлэл: ${ctx.evidence.map((_, i) => `[${i + 1}]`).join(' ')}`);
  } else if (tnr === null && tools.length === 0 && norm === null) {
    lines.push('Энэ асуултад тохирох баталгаажсан эх сурвалж олдсонгүй.');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export { STAGE_BUDGET, HEARTBEAT_GAP_MS, StageTimeoutError };
