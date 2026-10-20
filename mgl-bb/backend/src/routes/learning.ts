import { Hono } from 'hono';
import type { Env, AppVariables, UserRole } from '../types';
import { requireRole, requireAdmin } from '../middleware/auth';
import {
  authorityIndexFromSetting,
  type AuthorityIndex,
} from '../lib/complianceAuthority';
import {
  ARTIFACT_KINDS,
  DATASET_ELIGIBLE_SQL,
  LEARNING_EVENT_KINDS,
  OP_CLASSES,
  PROVENANCE_VALUES,
  TOUCH_CHANGES,
  TXN_ORIGINS,
  ACTOR_KINDS,
  DEFAULT_ACTOR_OF,
  UIDS_PER_LOOKUP,
  bumpSessionCounters,
  insertArtifact,
  partsForEvent,
  partsForTxn,
  resolveExistingUids,
  upsertBimSession,
  writeBimBatch,
  type ActorKind,
  type ArtifactKind,
  type BimSessionRow,
  type ElementTouchRow,
  type LearningEventKind,
  type LearningEventRow,
  type OpClass,
  type Provenance,
  type RevitTxnRow,
  type TouchChange,
  stampTeam,
  type TeamSourceValue,
  type TxnOrigin,
} from '../lib/bimEvents';
import { resolveTeamContext, isTeamCodeShape, TIER_CONFIDENCE } from '../lib/teamContext';
import { currentTenantId } from '../lib/requestContext';

/**
 * BIM-AI СУРГАЛТЫН ҮЙЛ ЯВДЛЫН ЛЕДЖЕР — HTTP гарц (миграц 0201–0210).
 *
 * ⚠️ ЭНЭ ГАДАРГУУГ `/mcp`-ЭЭР ХЭЗЭЭ Ч БҮҮ ГАРГА.  Ямар ч tool бүртгэхгүй,
 *    `mcp/tools/`-д twin бүү бич.  `/mcp` нь ГУРВАН хаалтыг ЗЭРЭГ тойрдог:
 *
 *    1. `workerScopeGuard` — `index.ts:147` дээр `'/api/*'`-д Л суудаг.
 *       `/mcp` нь OAuth провайдерын `apiHandlers`-т байгаа root зам тул
 *       Hono-д огт хүрдэггүй (`index.ts:276`).
 *    2. `entitlementGuard` — мөн `'/api/*'` (`index.ts:150`).  Тэр файлын
 *       өөрийнх нь толгой (`lib/entitlement.ts:29-33`) үүнийг ил хэлдэг:
 *       модуль унтраасан tenant ч MCP-ээр хандана.
 *    3. Tenant-ийн хил — `tid` тулгалт нь ЗӨВХӨН `middleware/auth.ts:79-88`-д
 *       байна.  `/mcp`-ийн токен шийдвэрлэгч (`index.ts:292-296`,
 *       `resolveExternalToken`) нь `verifyToken`-оос өөр юу ч шалгадаггүй —
 *       `tid` ч, `purpose` ч биш.  Нэмээд `MglMcpAgent` бол Durable Object
 *       (`mcp/MglMcpAgent.ts:44`); tool бүр `this.env`-ийг авдаг бөгөөд тэр нь
 *       `index.ts:341`-ийн `tenantEnv()` үүсгэсэн хүсэлтийн scope-той объект
 *       БИШ байх магадлалтай (гар туршилтаар батлаагүй).
 *
 *    Гурвуулаа НЭГ ЗЭРЭГ.  Ажилтны зан төлөвийн бүртгэлийн хувьд энэ нь
 *    хүлээн зөвшөөрөгдөхгүй.
 *
 * ⚠️ ЗӨВШИЛЦӨЛ.  Эзний 2026-08-27-ны шийдвэр: «мэдэгдэнэ, татгалзах товч
 *    байхгүй».  Тиймээс АЖИЛТАНД ҮЗҮҮЛСЭН МЭДЭГДЭЛ нь цорын ганц хууль зүйн
 *    суурь бөгөөд түүний хувилбар (`app_settings['bim.capture.notice_version']`)
 *    сесс бүрд `bim_sessions.notice_version`-оор тамгалагдана.  Текст
 *    өөрчлөгдвөл ТЭР УТГЫГ ӨӨРЧИЛНӨ.  ⚠️ Мөн 0195-ын «загварын геометр,
 *    файлын агуулга ОГТ ОРОХГҮЙ» амлалт 0201-ээс ЦУЦЛАГДСАН — параметрийн
 *    утга, байрлал, зураг хадгалагдана.  Ажилтны мэдэгдэл, гэрээ ЗААВАЛ
 *    шинэчлэгдсэн байх ЁСТОЙ (deploy-ийн УРЬДЧИЛСАН НӨХЦӨЛ).
 *
 * ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ: элемент түвшний үйл ажиллагаа нь
 *    ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД.  Энэ файлын УНШИХ маршрут бүр (а) өөрийн
 *    мөрөөр (`actor_user_id`/`user_id = user.sub`) хязгаарлагдсан, эсвэл
 *    (б) зөвхөн НЭГТГЭСЭН тоолуур буцаана.  `GET /health` нь админд ч
 *    ЗӨВХӨН нийлбэр өгнө — нэрлэсэн жагсаалт ХЭЗЭЭ Ч биш.
 *
 * ⚠️ БИЧИХ ГАРЦ НЬ `lib/bimEvents.ts` ГАНЦААРАА.  Энэ файл SQL бичихгүй —
 *    `backend/scripts/check-bim-events.mjs` ба `bimEvents.test.ts` хоёул
 *    grep-ээр барина.  (Уншихад SQL бичнэ, тэр нь өөр зүйл.)
 */

/**
 * Эрх: `routes/revit.ts:43,79`-ийн ЯГ ИЖИЛ дөрвөн үүрэг.  `client` ба
 * `worker` энд хүрэхгүй — `lib/workerScope.ts` нь хаалттай-анхдагч цагаан
 * жагсаалт тул `/api/learning` түүнд АВТОМАТААР 403.
 */
const LEARNING_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];

/** Нэг илгээлтэд хүлээж авах гүйлгээ/үйл явдлын дээд тоо (0208-ын дугуй). */
const DEFAULT_BATCH_MAX = 200;
/** Нэг илгээлтэд хүлээж авах элементийн мөрийн дээд тоо. */
const MAX_TOUCH_BATCH = 2000;
/** Нэг үйл явдлын `payload_json`-ийн дээд хэмжээ. */
const MAX_PAYLOAD_BYTES = 16 * 1024;
/** Богино метадата талбарын дээд урт (`revit.ts:50`-ийн `MAX_STR` заншил). */
const MAX_STR = 256;
/** Артефактын дээд хэмжээ — 0208-ын `bim.capture.artifact_max_bytes` дарна. */
const DEFAULT_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
/** `head` маршрутад нэг удаад асуух урсгалын дээд тоо. */
const MAX_HEAD_STREAMS = 20;

const learning = new Hono<{ Bindings: Env; Variables: AppVariables }>();

learning.use('*', requireRole(...LEARNING_ROLES));

/* ================================================================== */
/*  Туслахууд                                                          */
/* ================================================================== */

function str(v: unknown, max = MAX_STR): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > max ? s.slice(0, max) : s;
}

function strOrNull(v: unknown, max = MAX_STR): string | null {
  const s = str(v, max);
  return s.length > 0 ? s : null;
}

function intOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function nonNegInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** ISO-8601 UTC.  Хүчингүй бол `null` — мөр татгалзана. */
function isoOrNull(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : s;
}

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return (list as readonly string[]).includes(String(v)) ? (v as T) : fallback;
}

function oneOfOrNull<T extends string>(list: readonly T[], v: unknown): T | null {
  return (list as readonly string[]).includes(String(v)) ? (v as T) : null;
}

function isSha256(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v.toLowerCase());
}

/**
 * `bim_sessions.perf_json` (0226).
 *
 * ⚠️ NULL vs ХООСОН ОБЪЕКТ нь ӨӨР УТГАТАЙ (0226:29-40-ийн инвариант):
 *   NULL   = ХЭМЖЭЭГҮЙ (телеметр илгээдэггүй хуучин add-in),
 *   объект = ХЭМЖСЭН; дутуу түлхүүр нь «тэр үе шат БОЛООГҮЙ».
 * Тиймээс талбар байхгүй үед ХООСОН ОБЪЕКТ БИШ, ЯГ NULL буцаана.
 */
function perfJson(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  try {
    return JSON.stringify(v as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Объект → баталгаатай хүчинтэй JSON мөр (DB-ийн `json_valid` CHECK). */
function jsonObject(v: unknown): { text: string; obj: Record<string, unknown> } {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    try {
      return { text: JSON.stringify(obj), obj };
    } catch {
      /* дугуй холбоос — доорх хоосон утга руу уна */
    }
  }
  return { text: '{}', obj: {} };
}

/* ------------------------------------------------------------------ */
/*  Бүртгэлийн тохиргоо (0208) — deploy-гүйгээр эзэн сольж чадна        */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ `key IN (...)` — `LIKE 'bim.%'` БИШ.  Алсын D1 нь том TEXT баганад
 *    LIKE хэв маягийг татгалздаг тохиолдол бүртгэгдсэн; тодорхой түлхүүрийн
 *    жагсаалт нь тэр урхийг бүрэн тойрно ба индексийн ЯГ хайлт болно.
 */
const CAPTURE_KEYS = [
  'bim.events.logging',
  'bim.capture.mode',
  'bim.capture.elements_per_txn',
  'bim.capture.elements_per_session',
  'bim.capture.element_sample_n',
  'bim.capture.txn_batch_max',
  'bim.capture.artifact_max_bytes',
  'bim.capture.notice_version',
] as const;

interface CaptureConfig {
  logging: 'on' | 'off';
  /** full | salient | meta | off.  `meta` = элементийн мөр бичихгүй. */
  mode: string;
  elementsPerTxn: number;
  elementsPerSession: number;
  elementSampleN: number;
  txnBatchMax: number;
  artifactMaxBytes: number;
  noticeVersion: string;
}

async function loadCaptureConfig(db: D1Database): Promise<CaptureConfig> {
  const rows = await db
    .prepare(
      `SELECT key, value FROM app_settings
        WHERE key IN (${CAPTURE_KEYS.map(() => '?').join(', ')})`,
    )
    .bind(...CAPTURE_KEYS)
    .all<{ key: string; value: string }>()
    .catch(() => null);

  const map = new Map<string, string>();
  for (const r of rows?.results ?? []) map.set(r.key, r.value);

  const num = (key: string, fallback: number): number => {
    const n = Number(map.get(key));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };

  return {
    logging: (map.get('bim.events.logging') ?? 'on').toLowerCase() === 'off' ? 'off' : 'on',
    mode: (map.get('bim.capture.mode') ?? 'full').toLowerCase(),
    elementsPerTxn: num('bim.capture.elements_per_txn', 24),
    elementsPerSession: num('bim.capture.elements_per_session', 4000),
    elementSampleN: num('bim.capture.element_sample_n', 8),
    txnBatchMax: num('bim.capture.txn_batch_max', DEFAULT_BATCH_MAX),
    artifactMaxBytes: num('bim.capture.artifact_max_bytes', DEFAULT_ARTIFACT_MAX_BYTES),
    noticeVersion: map.get('bim.capture.notice_version') ?? '',
  };
}

/* ------------------------------------------------------------------ */
/*  Compliance-ийн дугуйнууд (0228 + 0230) — АРВАН ТҮЛХҮҮР, АРВАН УНШИЛТ */
/* ------------------------------------------------------------------ */

/**
 * v2 §53/§75/§76/§80/§82 — бодит хугацааны хөдөлгүүрийн дугуйнууд.
 *
 * ⚠️ `loadCaptureConfig`-ыг ХӨНДӨХГҮЙ.  Тэр нь `bim.capture.*`-ыг эзэмшинэ,
 *    энэ нь `bim.compliance.*`-ыг.  Хоёр багц ТУСДАА асуулгатай — нэг нь
 *    ingest-ийн халуун замд (`POST /events`), нөгөө нь ЗӨВХӨН handshake-д
 *    (`GET /settings`) уншигдана.
 */
export interface ComplianceConfig {
  mode: 'off' | 'observe' | 'explain' | 'recommend';
  /** v2 §80.  '0'..'5' тэмдэгт мөрөөс.  0230.  ⚠️ NULL ⇒ 0 (OBSERVE). */
  authorityLevel: AuthorityIndex;
  /** 0-100.  `machine_hash` % 100 < rollout_pct бол ЖИНХЭНЭ багц.  0230. */
  rolloutPct: number;
  settleMs: number;
  maxDeferMs: number;
  maxElementsPerSet: number;
  rawRingMax: number;
  emitBatchMax: number;
  minSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  snoozeHours: number;
}

/**
 * ⚠️ `key IN (...)` — `LIKE 'bim.compliance.%'` БИШ.  Алсын D1 нь том TEXT
 *    баганад LIKE хэв маягийг татгалздаг тохиолдол бүртгэгдсэн
 *    (`CAPTURE_KEYS`-ийн толгойн тайлбартай ижил шалтгаан).
 */
const COMPLIANCE_KEYS = [
  'bim.compliance.mode',
  'bim.compliance.settle_ms',
  'bim.compliance.max_defer_ms',
  'bim.compliance.max_elements_per_set',
  'bim.compliance.raw_ring_max',
  'bim.compliance.emit_batch_max',
  'bim.compliance.min_severity',
  'bim.compliance.snooze_hours',
  'bim.compliance.authority_level',
  'bim.compliance.rollout_pct',
] as const;

const COMPLIANCE_MODES = ['off', 'observe', 'explain', 'recommend'] as const;
const COMPLIANCE_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

/**
 * `app_settings`-ийн мөрүүдийг тохиргоо болгож буулгах ЦЭВЭР функц.
 *
 * ⚠️ ХОГ УТГА БҮР АНХДАГЧ РУУ УНАНА, ХЭЗЭЭ Ч ШИДЭХГҮЙ.  Эзэн D1 дээр
 *    гараар 'HIGHH' гэж бичсэн нь add-in-ы handshake-ыг 500 болгож
 *    БҮХ машиныг офлайн болгох ЁСГҮЙ.
 * ⚠️ `rolloutPct` нь ТЭГ БАЙЖ БОЛНО (анхдагч утга нь '0') тул түүнийг
 *    `num()`-ийн `> 0` шалгуураар БҮҮ уншуул — тэр нь 0-ийг «утга алга»
 *    гэж үзээд анхдагч руу унагаана.  Энд ТУСДАА `pct()` байна.
 */
export function parseComplianceConfig(map: Map<string, string>): ComplianceConfig {
  const num = (key: string, fallback: number): number => {
    const n = Number(map.get(key));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const pct = (key: string, fallback: number): number => {
    const n = Number(map.get(key));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(100, Math.max(0, Math.floor(n)));
  };
  const mode = (map.get('bim.compliance.mode') ?? '').trim().toLowerCase();
  const severity = (map.get('bim.compliance.min_severity') ?? '').trim().toUpperCase();

  return {
    mode: (COMPLIANCE_MODES as readonly string[]).includes(mode)
      ? (mode as ComplianceConfig['mode'])
      : 'observe',
    authorityLevel: authorityIndexFromSetting(map.get('bim.compliance.authority_level')),
    rolloutPct: pct('bim.compliance.rollout_pct', 0),
    settleMs: num('bim.compliance.settle_ms', 1200),
    maxDeferMs: num('bim.compliance.max_defer_ms', 15000),
    maxElementsPerSet: num('bim.compliance.max_elements_per_set', 2000),
    rawRingMax: num('bim.compliance.raw_ring_max', 4000),
    emitBatchMax: num('bim.compliance.emit_batch_max', 100),
    minSeverity: (COMPLIANCE_SEVERITIES as readonly string[]).includes(severity)
      ? (severity as ComplianceConfig['minSeverity'])
      : 'HIGH',
    snoozeHours: num('bim.compliance.snooze_hours', 24),
  };
}

/**
 * ⚠️ АРВАН ТҮЛХҮҮР, АРВАН УНШИЛТ.  0228-ийн толгойд бичсэн дүрэм:
 *    уншигчгүй дугуй нь дугуй байхгүйгээс ДОР (`assistant.min_confidence`,
 *    0195:152-155 — мөр байгаа, уншигч нь ХЭЗЭЭ Ч бичигдээгүй, эзэн утгыг
 *    сольж «унтраалаа» гэж боддог).  Түлхүүр нэмбэл `COMPLIANCE_KEYS`
 *    массивт, `parseComplianceConfig`-ийн буцаалтад БА `GET /settings`-ийн
 *    `compliance` объектод ГУРВУУЛАНД нэм.
 * ⚠️ `authority_level` ба `rollout_pct` (0230) нь ЗААВАЛ ЭНД байна — тэднийг
 *    `2-5` (самбарын горим), `2-0` (релизийн төлөвлөгөө) ба `2-8`
 *    (`addin_installs.authority_level`) ГУРВУУЛАА хэрэглэнэ, гэвч add-in
 *    руу хүрэх ЦОРЫН ГАНЦ суваг нь энэ уншигч ба доорх `compliance` объект.
 */
export async function loadComplianceConfig(db: D1Database): Promise<ComplianceConfig> {
  const rows = await db
    .prepare(
      `SELECT key, value FROM app_settings
        WHERE key IN (${COMPLIANCE_KEYS.map(() => '?').join(', ')})`,
    )
    .bind(...COMPLIANCE_KEYS)
    .all<{ key: string; value: string }>()
    .catch(() => null);

  const map = new Map<string, string>();
  for (const r of rows?.results ?? []) map.set(r.key, r.value);

  return parseComplianceConfig(map);
}

/* ================================================================== */
/*  GET /api/learning/settings — add-in-ий handshake                   */
/* ================================================================== */

/**
 * Add-in эдгээрийг асах үедээ татаж локалдаа кэшлэнэ (0203-ын 1C гэрээ).
 *
 * ⚠️ УНШИГЧГҮЙ ДУГУЙ БҮҮ ҮЛДЭЭ.  `assistant.min_confidence` (0195) нь
 *    ӨНӨӨДӨР ХЭН Ч УНШДАГГҮЙ түлхүүр — `grep -rn "assistant.min_confidence"
 *    backend/src/` тэг үр дүн буцаадаг.  Тохиргооны мөр байгаад уншигдахгүй
 *    байх нь эзнийг «би унтраасан» гэж бодуулна.  Энэ маршрут нь 0208-ын
 *    найман түлхүүрийг УНШИГДДАГ болгож байгаа хэсэг нь.
 */
learning.get('/settings', async (c) => {
  // ⚠️ ХОЁР АСУУЛГА, ЗЭРЭГ.  Тус бүр нь `key IN (...)` — индексийн ЯГ хайлт.
  const [cfg, cc] = await Promise.all([
    loadCaptureConfig(c.env.DB),
    loadComplianceConfig(c.env.DB),
  ]);
  return c.json({
    logging: cfg.logging,
    mode: cfg.mode,
    elements_per_txn: cfg.elementsPerTxn,
    elements_per_session: cfg.elementsPerSession,
    element_sample_n: cfg.elementSampleN,
    txn_batch_max: cfg.txnBatchMax,
    artifact_max_bytes: cfg.artifactMaxBytes,
    notice_version: cfg.noticeVersion,
    payload_max_bytes: MAX_PAYLOAD_BYTES,
    touch_batch_max: MAX_TOUCH_BATCH,
    // ⚠️ 0228-ийн 8 + 0230-ийн 2 = АРВАН талбар.  Энэ объект нь дугуйнууд
    //    add-in руу хүрэх ЦОРЫН ГАНЦ суваг — талбар хасах нь тухайн дугуйг
    //    `assistant.min_confidence`-ийн байдалд (уншигчгүй мөр) буцаана.
    // ⚠️ КЭШ БАЙХГҮЙ.  `withEdgeCache` энд ХЭРЭГЛЭГДЭХГҮЙ: эзэн `mode`-ыг
    //    'off' болгосны ДАРААХ дуудлага ШУУД 'off' буцаах ёстой, 60 секунд
    //    хүлээх ЁСГҮЙ (§75-ын унтраах товч).
    compliance: {
      mode: cc.mode,
      authority_level: cc.authorityLevel,
      rollout_pct: cc.rolloutPct,
      settle_ms: cc.settleMs,
      max_defer_ms: cc.maxDeferMs,
      max_elements_per_set: cc.maxElementsPerSet,
      raw_ring_max: cc.rawRingMax,
      emit_batch_max: cc.emitBatchMax,
      min_severity: cc.minSeverity,
      snooze_hours: cc.snoozeHours,
    },
  });
});

/* ================================================================== */
/*  POST /api/learning/events — БАГЦАЛСАН INGEST                       */
/* ================================================================== */

interface RawSession {
  session_uid?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  client_now?: unknown;
  project_id?: unknown;
  revit_document_id?: unknown;
  doc_uid?: unknown;
  doc_title?: unknown;
  is_link?: unknown;
  central_path_hash?: unknown;
  machine_hash?: unknown;
  worksharing?: unknown;
  revit_version?: unknown;
  revit_build?: unknown;
  addin_version?: unknown;
  addin_channel?: unknown;
  model_version?: unknown;
  prompt_version?: unknown;
  ruleset_version?: unknown;
  capture_schema?: unknown;
  client_tz_offset_min?: unknown;
  dropped_count?: unknown;
  /**
   * 2-4-ийн сессийн гүйцэтгэлийн хураангуй (0226).
   * ⚠️ NULL = ХЭМЖЭЭГҮЙ.  ХООСОН ОБЪЕКТ нь «хэмжсэн, бүх үе шат болоогүй»
   *    гэсэн ӨӨР утгатай тул тэр хоёрыг холихгүй (0226:29-40).
   */
  perf?: unknown;
}

learning.post('/events', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const body = await c.req
    .json<{
      session?: RawSession;
      transactions?: unknown;
      touches?: unknown;
      events?: unknown;
    }>()
    .catch(() => null);
  if (!body || typeof body !== 'object') {
    // ⚠️ `accounted: false` + `retryable: false` = «энэ багц алдагдсан, ижил
    //    хэлбэрээр дахин илгээх нь ХЭЗЭЭ Ч амжилтгүй».  Add-in-д АЛБАДАН
    //    ШИНЭЧЛЭХ механизм БАЙХГҮЙ тул давтагдах алдаа нь мөнхийн гогцоо
    //    болох ёсгүй (0203-ын толгойн сэрэмжлүүлэг).
    return c.json(
      { ok: false, error: 'invalid_body', accounted: false, retryable: false },
      400,
    );
  }

  const rawTxns = Array.isArray(body.transactions) ? body.transactions : [];
  const rawTouches = Array.isArray(body.touches) ? body.touches : [];
  const rawEvents = Array.isArray(body.events) ? body.events : [];

  const cfg = await loadCaptureConfig(db);

  // ── Унтраах товч.  `revit.ts:1670-1677`-ийн хэв маяг: чимээгүй хүлээж
  //    авсан мэт хариулна, add-in дахин дахин оролдох ЁСГҮЙ. ───────────
  if (cfg.logging === 'off' || cfg.mode === 'off') {
    // ⚠️ ЭЗНИЙ ШИЙДВЭРЭЭР хаясан тул `accounted: true` — клиент мөрүүдээ
    //    устгаж болно.  Энэ бол ЦОРЫН ГАНЦ зөвшөөрөгдсөн чимээгүй хаялт.
    return c.json({ ok: true, ingest: 'off', accepted: null, accounted: true, retryable: false });
  }

  // ⚠️ 413 — ЮУ Ч бичигдээгүй, ЮУ Ч тоологдоогүй.  `retryable: true` нь
  //    «ИЖИЛ багцыг биш, ЖИЖИГ хэсгүүдээр дахин илгээ» гэсэн утгатай:
  //    мөрүүд нь бодит байдалд байсан тул клиент тэднийг ХАДГАЛНА.
  if (rawTxns.length > cfg.txnBatchMax || rawEvents.length > cfg.txnBatchMax) {
    return c.json(
      {
        ok: false,
        error: 'batch_too_large',
        max: cfg.txnBatchMax,
        accounted: false,
        retryable: true,
      },
      413,
    );
  }
  if (rawTouches.length > MAX_TOUCH_BATCH) {
    return c.json(
      {
        ok: false,
        error: 'touch_batch_too_large',
        max: MAX_TOUCH_BATCH,
        accounted: false,
        retryable: true,
      },
      413,
    );
  }

  const rejected = { txns: 0, touches: 0, events: 0 };

  /* ---------------------------------------------------------------- */
  /*  1) Сесс — БИЧИХ ДАРААЛЛЫН 2-Р АЛХАМ                              */
  /* ---------------------------------------------------------------- */

  const rawSession = (body.session ?? {}) as RawSession;
  const sessionUid = str(rawSession.session_uid, 64);
  let sessionId: number | null = null;
  let sessionStarted = false;

  /* ---------------------------------------------------------------- */
  /*  1а) БАГИЙН КОНТЕКСТ — §48-ын шат, СЕРВЕР ДЭЭР                    */
  /* ---------------------------------------------------------------- */

  /**
   * ⚠️ КЛИЕНТ БАГ ЗАРЛАЖ ЧАДАХГҮЙ.  `lib/jwt.ts` нь гарын үсэг + `exp`-ийг
   * л шалгадаг тул add-in дурын `team_code` илгээж чадна; `user_id`-тай
   * ижил дүрмээр (`learning.ts:338-340`) баг нь ЭНД, DB-ээс шийдэгдэнэ.
   *
   * ⚠️ БАРИМТЫГ `doc_uid`-ЭЭР ШИЙДНЭ, клиентийн `revit_document_id`-ээр
   * БИШ: сүүлийнх нь дурын бүхэл тоо байж болох ба тухайн баримтын
   * `team_code`-ыг (1b шат) гоожуулна.
   *
   * ⚠️ ЗАРДАЛ: нэг хөнгөн SELECT + нэг `db.batch()` + нэг `rules` асуулга,
   * ХҮСЭЛТ БҮРТ НЭГ УДАА (мөр тутам БИШ).  Үүнгүйгээр 0217/0219 нь
   * чимээгүй хоосон үлдэнэ — §72 «мөр бүр багаар шошголсон» зөрчигдөнө.
   */
  const teamCtx: {
    team_code: string | null;
    team_source: TeamSourceValue;
    team_confidence: number;
    attribution_id: number | null;
  } = { team_code: null, team_source: 'uncertain', team_confidence: 0, attribution_id: null };

  if (sessionUid || rawEvents.length > 0) {
    const docUid = strOrNull(rawSession.doc_uid, 128);
    const docRow = docUid
      ? await db
          .prepare(
            `SELECT id, project_id FROM revit_documents
              WHERE doc_uid = ? ORDER BY last_seen_at DESC LIMIT 1`,
          )
          .bind(docUid)
          .first<{ id: number; project_id: number }>()
      : null;

    const resolved = await resolveTeamContext(db, {
      userId: user.sub,
      projectId: docRow?.project_id ?? intOrNull(rawSession.project_id),
      revitDocumentId: docRow?.id ?? null,
    });
    teamCtx.team_code = resolved.decision.team_code;
    teamCtx.team_source = resolved.decision.team_source as TeamSourceValue;
    teamCtx.team_confidence = resolved.decision.team_confidence;

    // §73 — ХҮНИЙ залруулга ҮРГЭЛЖ ЯЛНА, мөн ХӨЛДӨӨГДӨНӨ.  Эс бөгөөс
    // засварласан баг нь сургалтын корпуст ХЭЗЭЭ Ч хүрэхгүй.
    const live = await db
      .prepare(
        `SELECT id, verified_team_code
           FROM team_attributions
          WHERE user_id = ?
            AND superseded_at IS NULL
            AND verified_team_code IS NOT NULL
            AND COALESCE(revit_document_id, -1) IN (-1, COALESCE(?, -1))
          ORDER BY id DESC
          LIMIT 1`,
      )
      .bind(user.sub, docRow?.id ?? null)
      .first<{ id: number; verified_team_code: string }>();
    if (live && isTeamCodeShape(live.verified_team_code)) {
      teamCtx.team_code = live.verified_team_code;
      teamCtx.team_source = 'manual';
      teamCtx.team_confidence = TIER_CONFIDENCE.manual;
      teamCtx.attribution_id = live.id;
    }
  }

  /**
   * `bim_sessions`-ийн ОДООГИЙН төлөв.  ⚠️ Гараар баталгаажсан мөрийг
   * `upsertBimSession`-ийн `ON CONFLICT` салаа хамгаална (`team_source =
   * 'manual'` бол дарж бичихгүй).
   */
  const teamStamp = {
    team_code: teamCtx.team_code,
    team_confidence: teamCtx.team_confidence,
    team_source: teamCtx.team_source,
    team_last_verified: teamCtx.team_source === 'manual' ? new Date().toISOString() : null,
  };

  if (sessionUid) {
    const startedAt = isoOrNull(rawSession.started_at);
    if (!startedAt) {
      // Сесс үүсгэж чадахгүй ⇒ энэ багцын алдагдлыг бүртгэх газар БАЙХГҮЙ.
      // Дахин илгээх нь утгагүй (ижил буруу огноо) тул `retryable: false`,
      // харин `accounted: false` нь алдагдлыг ИЛ хэвээр үлдээнэ.
      return c.json(
        {
          ok: false,
          error: 'session.started_at_invalid',
          accounted: false,
          retryable: false,
        },
        400,
      );
    }

    // ⚠️ Цагийн зөрүү = СЕРВЕРИЙН цаг − КЛИЕНТИЙН цаг, ЭХНИЙ холбоо дээр.
    //    Клиентийн `client_now` байхгүй бол `started_at` руу унана (сесс
    //    нээгдсэн даруйдаа handshake хийдэг тул ойролцоо).  Буруу
    //    тохируулагдсан машиныг илрүүлэх ЦОРЫН ГАНЦ дохио.
    const clientNow = isoOrNull(rawSession.client_now) ?? startedAt;
    const skew = Math.round((Date.now() - Date.parse(clientNow)) / 1000);

    const row: BimSessionRow = {
      session_uid: sessionUid,
      // ⚠️ Токеноос, клиентээс БИШ.  Ажилтан өөр хүний нэрээр бүртгүүлж
      //    чадах ёсгүй.
      user_id: user.sub,
      project_id: intOrNull(rawSession.project_id),
      revit_document_id: intOrNull(rawSession.revit_document_id),
      doc_uid: strOrNull(rawSession.doc_uid, 128),
      doc_title: str(rawSession.doc_title, 200),
      is_link: rawSession.is_link === true || rawSession.is_link === 1 ? 1 : 0,
      central_path_hash: isSha256(rawSession.central_path_hash)
        ? String(rawSession.central_path_hash).toLowerCase()
        : null,
      machine_hash: isSha256(rawSession.machine_hash)
        ? String(rawSession.machine_hash).toLowerCase()
        : null,
      worksharing: strOrNull(rawSession.worksharing, 16),
      revit_version: str(rawSession.revit_version, 16),
      revit_build: strOrNull(rawSession.revit_build, 32),
      addin_version: str(rawSession.addin_version, 32),
      addin_channel: str(rawSession.addin_channel, 16) || 'prod',
      model_version: strOrNull(rawSession.model_version, 64),
      prompt_version: strOrNull(rawSession.prompt_version, 64),
      ruleset_version: strOrNull(rawSession.ruleset_version, 64),
      capture_schema: nonNegInt(rawSession.capture_schema, 1),
      capture_policy: cfg.mode,
      // ⚠️ СЕРВЕРЭЭС, клиентээс БИШ: мэдэгдлийн хувилбар нь хууль зүйн
      //    баримт бөгөөд хуучин add-in худал тамгалах боломжгүй байх ёстой.
      notice_version: cfg.noticeVersion,
      started_at: startedAt,
      ended_at: isoOrNull(rawSession.ended_at),
      client_tz_offset_min: intOrNull(rawSession.client_tz_offset_min),
      clock_skew_sec: skew,
      txn_count: 0,
      event_count: 0,
      // ⚠️ 0243: клиентийн зарласан алдагдал нь ХУРИМТЛАГДСАН ХЭМЖИГЧ тул
      //    ӨӨРИЙН баганадаа (`client_dropped_count`) MAX-аар нэгтгэгдэнэ.
      //    Серверийн татгалзал нь `server_dropped_count` руу НЭМЭГДЭНЭ.
      //    Хоёрыг нэг багана үүрэх нь чимээгүй алдагдал үүсгэж байсан.
      client_dropped_count: nonNegInt(rawSession.dropped_count, 0),
      // ⚠️ §72-ын компанийн хэмжээс — СЕРВЭРЭЭС (host / tid), клиентээс БИШ.
      //    Нэг-tenant суулгацад `DEFAULT_TENANT_ID` ('default') болно.
      company_id: currentTenantId(),
      // 0226 — ХООСОН ОБЪЕКТ нь NULL-тэй ижил утгатай БИШ.
      perf_json: perfJson(rawSession.perf),
      ...teamStamp,
    };

    const upserted = await upsertBimSession(db, row);
    sessionId = upserted.id;
    sessionStarted = upserted.created;
  }

  /* ---------------------------------------------------------------- */
  /*  2) Төслийн id-г шалгах — байхгүйг NULL болгоно                    */
  /* ---------------------------------------------------------------- */

  const claimedProjects = new Set<number>();
  const collectProject = (v: unknown): void => {
    const n = intOrNull(v);
    if (n !== null && n > 0) claimedProjects.add(n);
  };
  collectProject(rawSession.project_id);
  for (const t of rawTxns) collectProject((t as Record<string, unknown>)?.project_id);
  for (const e of rawEvents) collectProject((e as Record<string, unknown>)?.project_id);
  const knownProjects = await filterExistingProjects(db, [...claimedProjects]);
  const projectOf = (v: unknown, fallback: number | null): number | null => {
    const n = intOrNull(v);
    if (n === null) return fallback;
    return knownProjects.has(n) ? n : null;
  };
  const sessionProject = projectOf(rawSession.project_id, null);

  /* ---------------------------------------------------------------- */
  /*  3) Артефактын sha256 → id                                        */
  /* ---------------------------------------------------------------- */

  const artifactHashes = new Set<string>();
  const claimHash = (v: unknown): string | null => {
    if (!isSha256(v)) return null;
    const h = String(v).toLowerCase();
    artifactHashes.add(h);
    return h;
  };
  const txnArtifactClaim = rawTxns.map((t) =>
    claimHash((t as Record<string, unknown>)?.element_artifact_sha256),
  );
  const touchArtifactClaim = rawTouches.map((t) =>
    claimHash((t as Record<string, unknown>)?.params_artifact_sha256),
  );
  const eventArtifactClaim = rawEvents.map((e) =>
    claimHash((e as Record<string, unknown>)?.artifact_sha256),
  );
  const artifactIds = await resolveArtifactIds(db, [...artifactHashes]);

  /* ---------------------------------------------------------------- */
  /*  4) Гүйлгээ                                                       */
  /* ---------------------------------------------------------------- */

  // Ижил flush доторх гүйлгээ — дэд асуулга ӨМНӨХ statement-ээс олно.
  const txnUidsInBatch = new Set<string>();
  for (const t of rawTxns) {
    const uid = str((t as Record<string, unknown>)?.txn_uid, 64);
    if (uid) txnUidsInBatch.add(uid);
  }

  // Гадаад иш татлагууд — DB-д АЛЬ ХЭДИЙН байгаа эсэх.
  const causeUids: string[] = [];
  const parentTxnUids: string[] = [];
  for (const t of rawTxns) {
    const o = t as Record<string, unknown>;
    const cause = str(o?.cause_event_uid, 64);
    if (cause) causeUids.push(cause);
    const parent = str(o?.parent_txn_uid, 64);
    if (parent && !txnUidsInBatch.has(parent)) parentTxnUids.push(parent);
  }
  const eventTxnRefs: string[] = [];
  const eventParentRefs: string[] = [];
  const eventUidsInBatch = new Set<string>();
  for (const e of rawEvents) {
    const o = e as Record<string, unknown>;
    const uid = str(o?.event_uid, 64);
    if (uid) eventUidsInBatch.add(uid);
  }
  for (const e of rawEvents) {
    const o = e as Record<string, unknown>;
    const ref = str(o?.txn_uid, 64);
    if (ref && !txnUidsInBatch.has(ref)) eventTxnRefs.push(ref);
    for (const key of ['parent_event_uid', 'causal_event_uid'] as const) {
      const p = str(o?.[key], 64);
      if (p && !eventUidsInBatch.has(p)) eventParentRefs.push(p);
    }
  }

  const existingTxnUids = await resolveExistingUids(db, 'revit_transactions', 'txn_uid', [
    ...parentTxnUids,
    ...eventTxnRefs,
  ]);
  const existingEventUids = await resolveExistingUids(db, 'learning_events', 'event_uid', [
    ...causeUids,
    ...eventParentRefs,
  ]);

  // ── Элементийн мөрүүдийг гүйлгээгээр нь бүлэглэх ────────────────────
  const touchesByTxn = new Map<string, Array<Record<string, unknown>>>();
  for (const raw of rawTouches) {
    const o = raw as Record<string, unknown>;
    const uid = str(o?.txn_uid, 64);
    if (!uid) {
      rejected.touches += 1;
      continue;
    }
    const list = touchesByTxn.get(uid);
    if (list) list.push(o);
    else touchesByTxn.set(uid, [o]);
  }

  // ── Сессийн элементийн төсөв (0204-ийн гурван хаалтын гуравдугаарх) ──
  // ⚠️ Энэ нэг асуулга нь сессийн одоогийн элементийн мөрийн тоог өгнө.
  //    `SUM(touch_rows)` нь `idx_revit_txn_seq`-ээр session-ийн мөрүүдийг
  //    л уншина (нэг сесст хэдэн зуун гүйлгээ), бүтэн хүснэгтийн скан БИШ.
  let sessionTouchBudget = Number.POSITIVE_INFINITY;
  if (sessionId !== null && touchesByTxn.size > 0) {
    const used = await db
      .prepare(
        'SELECT COALESCE(SUM(touch_rows), 0) AS n FROM revit_transactions WHERE session_id = ?',
      )
      .bind(sessionId)
      .first<{ n: number }>()
      .catch(() => null);
    sessionTouchBudget = Math.max(0, cfg.elementsPerSession - Number(used?.n ?? 0));
  }

  const txnRows: RevitTxnRow[] = [];
  const touchRows: ElementTouchRow[] = [];
  const acceptedTxnUids = new Set<string>();
  /**
   * ⚠️ Элементийн мөрүүдийг ЭЗЭМШИГЧ нь дараах давталтын явцад Л уншигдана.
   *    Тухайн `txn_uid` нь энэ багцад ОГТ БАЙХГҮЙ (өөр POST-д хуваагдсан),
   *    эсвэл ЭЦЭГ НЬ ХЭЛБЭРИЙН алдаагаар татгалзсан бол түүний нэхэмжилсэн
   *    мөрүүд ХЭН Ч уншихгүй, тоологдохгүй — ЧИМЭЭГҮЙ АЛДАГДАНА.  Тэр нь
   *    `bim_sessions.dropped_count`-ийн «бодит байдалд байсан, энэ хүснэгтэд
   *    байхгүй» гэсэн утгыг зөрчинө: тоолуур бүрэн бус болж, ~20 машины
   *    цуглуулгын алдагдлыг хэмжих ЦОРЫН ГАНЦ дохио худал болно.
   *    ⇒ Хэн уншсаныг тэмдэглээд, давталтын ДАРАА уншигдаагүйг нь тоолно.
   */
  const consumedTouchOwners = new Set<string>();

  for (let i = 0; i < rawTxns.length; i++) {
    const o = rawTxns[i] as Record<string, unknown>;
    const txnUid = str(o?.txn_uid, 64);
    const seq = intOrNull(o?.seq);
    const occurredAt = isoOrNull(o?.occurred_at);
    if (!txnUid || seq === null || seq < 0 || !occurredAt || sessionId === null) {
      rejected.txns += 1;
      continue;
    }

    const added = nonNegInt(o?.added_count, 0);
    const deleted = nonNegInt(o?.deleted_count, 0);
    const modified = nonNegInt(o?.modified_count, 0);

    // ── Элементийн мөрүүд: `meta` горимд ОГТ бичихгүй, бусад горимд
    //    гүйлгээ тутмын ба сессийн төсвөөр таслана. ───────────────────
    const claimed = touchesByTxn.get(txnUid) ?? [];
    consumedTouchOwners.add(txnUid);
    let allowed = cfg.mode === 'meta' ? 0 : Math.min(claimed.length, cfg.elementsPerTxn);
    allowed = Math.min(allowed, Math.max(0, sessionTouchBudget));
    const truncated = allowed < claimed.length;
    sessionTouchBudget -= allowed;
    rejected.touches += claimed.length - allowed;

    let attrsComplete = allowed > 0;
    for (let k = 0; k < allowed; k++) {
      const t = claimed[k];
      if (!t) continue;
      const elementId = intOrNull(t.element_id);
      const change = oneOfOrNull(TOUCH_CHANGES, t.change) as TouchChange | null;
      if (elementId === null || change === null) {
        rejected.touches += 1;
        continue;
      }
      const category = str(t.category, 64);
      if (!category) attrsComplete = false;
      touchRows.push({
        txn_uid: txnUid,
        session_id: sessionId,
        user_id: user.sub,
        project_id: projectOf(o?.project_id, sessionProject),
        element_id: elementId,
        element_uid: strOrNull(t.element_uid, 64),
        change,
        category,
        type_name: str(t.type_name, 128),
        level_name: str(t.level_name, 64),
        workset: str(t.workset, 64),
        host_uid: strOrNull(t.host_uid, 64),
        placement_json: jsonObject(t.placement).text,
        params_artifact_id: artifactIdOf(
          artifactIds,
          touchArtifactClaim[rawTouches.indexOf(t)] ?? null,
        ),
        hits: Math.max(1, nonNegInt(t.hits, 1)),
        depth: Math.max(0, nonNegInt(t.depth, 1)),
        occurred_at: isoOrNull(t.occurred_at) ?? occurredAt,
      });
    }

    const declaredArtifact = txnArtifactClaim[i] ?? null;
    const artifactId = artifactIdOf(artifactIds, declaredArtifact);
    const causeUid = str(o?.cause_event_uid, 64) || null;
    const parentUid = str(o?.parent_txn_uid, 64) || null;

    const { expected, present } = partsForTxn({
      elementTotal: added + deleted + modified,
      touchRowsSent: allowed,
      touchesHaveAttrs: attrsComplete,
      touchesTruncated: truncated,
      elementArtifact:
        declaredArtifact === null ? 'none' : artifactId === null ? 'declared' : 'resolved',
      // ⚠️ Ижил flush доторх `learning_events` мөр нь гүйлгээнээс ХОЙШ
      //    бичигдэнэ (0205-ын бичих дараалал) тул дэд асуулга түүнийг
      //    ОЛОХГҮЙ.  Тиймээс «зарласан ч шийдэгдээгүй» болж AI_CAUSE бит
      //    унтарна — `parts_missing` (0207) түүнийг илрүүлнэ.  1C-ийн
      //    гэрээ: гүйлгээг үүсгэсэн `AI_ACTION`-ыг тэр гүйлгээнээс ӨМНӨХ
      //    flush-д илгээнэ.
      cause: causeUid === null ? 'none' : existingEventUids.has(causeUid) ? 'resolved' : 'declared',
    });

    txnRows.push({
      session_id: sessionId,
      txn_uid: txnUid,
      seq,
      user_id: user.sub,
      project_id: projectOf(o?.project_id, sessionProject),
      op_name: str(o?.op_name, 128),
      op_class: oneOf(OP_CLASSES, o?.op_class, 'edit') as OpClass,
      added_count: added,
      deleted_count: deleted,
      modified_count: modified,
      category_json: jsonObject(o?.categories).text,
      view_uid: strOrNull(o?.view_uid, 64),
      sheet_uid: strOrNull(o?.sheet_uid, 64),
      origin: oneOf(TXN_ORIGINS, o?.origin, 'human') as TxnOrigin,
      cause_event_uid: causeUid !== null && existingEventUids.has(causeUid) ? causeUid : null,
      parent_txn_uid:
        parentUid !== null && (existingTxnUids.has(parentUid) || txnUidsInBatch.has(parentUid))
          ? parentUid
          : null,
      parts_expected: expected,
      parts_present: present,
      element_artifact_id: artifactId,
      touch_rows: allowed,
      occurred_at: occurredAt,
    });
    acceptedTxnUids.add(txnUid);
  }

  // ⚠️ ЭЗЭНГҮЙ ҮЛДСЭН ЭЛЕМЕНТИЙН МӨРҮҮД.  Дээрх давталт нь ЗӨВХӨН энэ
  //    багцын гүйлгээнүүдийн мөрүүдийг уншина; уншигдаагүй нэхэмжлэл нь
  //    (эцэг нь өөр POST-д, эсвэл эцэг нь татгалзсан) хаягдана.  Хаях нь
  //    ЗӨВ — 0204-ийн ЧАНГА БҮТЭЛГҮЙТЭЛ, эцэггүй мөр корпусыг бохирдуулна.
  //    ЧИМЭЭГҮЙ хаях нь БУРУУ: тоолуургүй алдагдал нь оношлогдохгүй.
  for (const [ownerUid, list] of touchesByTxn) {
    if (!consumedTouchOwners.has(ownerUid)) rejected.touches += list.length;
  }

  // Эцэггүй элементийн мөр — 0204-ийн ЧАНГА БҮТЭЛГҮЙТЭЛ.  Багц унахаас
  // өмнө энд шүүнэ: эцэг нь энэ багцад ч, DB-д ч байхгүй бол мөр утгагүй.
  const keptTouches = touchRows.filter(
    (t) => acceptedTxnUids.has(t.txn_uid) || existingTxnUids.has(t.txn_uid),
  );
  rejected.touches += touchRows.length - keptTouches.length;

  /* ---------------------------------------------------------------- */
  /*  5) Үйл явдал                                                     */
  /* ---------------------------------------------------------------- */

  const todayStream = `web:${user.sub}:${new Date().toISOString().slice(0, 10)}`;
  const eventRows: LearningEventRow[] = [];

  for (let i = 0; i < rawEvents.length; i++) {
    const o = rawEvents[i] as Record<string, unknown>;
    const eventUid = str(o?.event_uid, 64);
    const seq = intOrNull(o?.seq);
    const occurredAt = isoOrNull(o?.occurred_at);
    const kind = oneOfOrNull(LEARNING_EVENT_KINDS, o?.kind) as LearningEventKind | null;
    if (!eventUid || seq === null || seq < 0 || !occurredAt || kind === null) {
      rejected.events += 1;
      continue;
    }

    // ⚠️ БАГЫГ БИЧИХ МӨЧИД ХӨЛДӨӨНӨ, JOIN-ААР ШИЙДЭХГҮЙ (0219-ийн толгой).
    //    `learning_events` нь 0206-ын триггерээр ХӨДӨЛШГҮЙ тул дараа нь
    //    засах БОЛОМЖГҮЙ; `bim_sessions`-руу JOIN хийвэл §73-ын нэг
    //    залруулга хэдэн зуун мөрийн утгыг ЧИМЭЭГҮЙ дахин шошголно.
    //    ⚠️ Клиентийн зарласан `team_*` түлхүүр ЭНД ДАРАГДАНА — `stampTeam`
    //    нь тарааж бичдэг тул серверийн утга ҮРГЭЛЖ сүүлд бичигдэнэ.
    const payload = jsonObject(stampTeam(jsonObject(o?.payload).obj, teamCtx));
    // ⚠️ Payload-ыг ХЭЗЭЭ Ч чимээгүй бүү тас — мөрийг БҮТНЭЭР татгалзана.
    //    Тасалсан payload нь хүчинтэй харагдах ч утгаа алдсан сургалтын
    //    жишээ болно; татгалзсан мөр нь `rejected` тоолуурт ил гарна.
    if (new TextEncoder().encode(payload.text).byteLength > MAX_PAYLOAD_BYTES) {
      rejected.events += 1;
      continue;
    }

    const declaredArtifact = eventArtifactClaim[i] ?? null;
    const artifactId = artifactIdOf(artifactIds, declaredArtifact);
    const txnRef = str(o?.txn_uid, 64) || null;
    const parentRef = str(o?.parent_event_uid, 64) || null;
    const causalRef = str(o?.causal_event_uid, 64) || null;

    const txnResolvable =
      txnRef !== null && (acceptedTxnUids.has(txnRef) || existingTxnUids.has(txnRef));
    const parentResolvable =
      parentRef !== null && (eventUidsInBatch.has(parentRef) || existingEventUids.has(parentRef));

    const { expected, present } = partsForEvent({
      kind,
      artifactResolved: artifactId !== null,
      txn: txnRef === null ? 'none' : txnResolvable ? 'resolved' : 'declared',
      parent: parentRef === null ? 'none' : parentResolvable ? 'resolved' : 'declared',
      payload: payload.obj,
    });

    eventRows.push({
      session_id: sessionId,
      // 0205: add-in-д = `session_uid`; вэб талд = `web:<user_id>:<YYYY-MM-DD>`.
      stream_id: str(o?.stream_id, 64) || sessionUid || todayStream,
      seq,
      event_uid: eventUid,
      kind,
      actor_kind: oneOf(ACTOR_KINDS, o?.actor_kind, DEFAULT_ACTOR_OF[kind]) as ActorKind,
      // ⚠️ ҮРГЭЛЖ токеноос.  `actor_kind` нь ХЭН үйлдснийг (хүн/AI/дүрэм)
      //    хэлнэ; `actor_user_id` нь мөр ХЭНИЙ эзэмшилд байгааг хэлнэ —
      //    хоёр өөр асуулт.  Өөрийгөө харах шүүлт нь ҮРГЭЛЖ энэ баганаар
      //    явна, тиймээс NULL үлдээх нь мөрийг эзэнгүй болгоно.
      actor_user_id: user.sub,
      project_id: projectOf(o?.project_id, sessionProject),
      task_id: intOrNull(o?.task_id),
      doc_uid: strOrNull(o?.doc_uid, 128),
      txn_uid: txnResolvable ? txnRef : null,
      element_id: intOrNull(o?.element_id),
      parent_event_uid: parentResolvable ? parentRef : null,
      causal_event_uid:
        causalRef !== null &&
        (eventUidsInBatch.has(causalRef) || existingEventUids.has(causalRef))
          ? causalRef
          : null,
      artifact_id: artifactId,
      payload_json: payload.text,
      parts_expected: expected,
      parts_present: present,
      // ⚠️ Ingest нь ГАРАЛ ҮҮСЛИЙГ ХЭЗЭЭ Ч дээшлүүлэхгүй.  Хамгийн өндөр нь
      //    `MACHINE_GENERATED`; `HUMAN_VERIFIED` / `RULE_VERIFIED` /
      //    `HUMAN_CORRECTED` нь ЗӨВХӨН курацийн UI-аас (1B-6) ирнэ.  Add-in
      //    өөрийгөө «баталгаажсан» гэж зарлаж чадах ёсгүй.
      provenance: ingestProvenance(o?.provenance),
      model_version: strOrNull(o?.model_version, 64),
      ruleset_version: strOrNull(o?.ruleset_version, 64),
      occurred_at: occurredAt,
    });
  }

  /* ---------------------------------------------------------------- */
  /*  6) БИЧИХ — 3-Р АЛХАМ (нэг batch), дараа нь 4-Р АЛХАМ (тоолуур)   */
  /* ---------------------------------------------------------------- */

  const result = await writeBimBatch(db, {
    txns: txnRows,
    touches: keptTouches,
    events: eventRows,
  });

  // Серверийн хаясан бүх мөр — «бодит байдалд байсан, энэ хүснэгтэд
  // байхгүй».  `rejected` (хэлбэрийн алдаа, төсвийн таслалт) ба `dropped`
  // (мөр тус бүрийн fallback-д ч орж чадаагүй) хоёулаа тэр утгатай.
  const serverDropped = tableSum(rejected) + tableSum(result.dropped);

  if (sessionId !== null) {
    await bumpSessionCounters(db, sessionId, {
      txns: result.accepted.txns,
      events: result.accepted.events,
      dropped: serverDropped,
      endedAt: isoOrNull(rawSession.ended_at),
    });
  }

  if (result.degraded) {
    console.warn('[learning] багц унаж мөр тус бүрийн fallback ажиллав', {
      user: user.sub,
      session: sessionUid,
      failures: result.failures.slice(0, 5),
    });
  }

  /* ---------------------------------------------------------------- */
  /*  7) ХАРИУ — БАГЦ ТУТМЫН ҮНЭН ТООЦОО                               */
  /* ---------------------------------------------------------------- */

  /**
   * ⚠️ КЛИЕНТ ЯМАР Ч 2xx-ыг БҮРЭН ХҮЛЭЭН АВСАН гэж үздэг (`BimEmitter.cs`
   *    нь `sent = take.Count` гээд мөрүүдээ устгаж, курсороо ахиулдаг).
   *    Тэр нь ӨНӨӨДӨР ЗӨВХӨН сервер өөрийн татгалзлаа тоолдог учраас Л
   *    аюулгүй — өөрөөр хэлбэл найдвартай байдал нь дээрх
   *    `bumpSessionCounters` дуудлагаас БҮРЭН хамаарна.  Тиймээс хариу нь
   *    багц тутмын тоог ҮНЭНЭЭР хэлэх ЁСТОЙ:
   *
   *      `accounted`  — ЭНЭ Л ТАЛБАР нь «мөрүүдээ устгаж болно» гэсэн эрх
   *                     олгоно.  true = илгээсэн мөр БҮР эсвэл бичигдсэн,
   *                     эсвэл сессийн `server_dropped_count`-д ТООЛОГДСОН.
   *                     false = ХААНА Ч бүртгэгдээгүй → клиент мөрүүдээ
   *                     ХАДГАЛАХ ёстой.  ⚠️ HTTP статусаар БҮҮ шийд.
   *      `retryable`  — ижил багцыг дахин илгээх нь утгатай юу.
   *
   * ⚠️ ДАЛД БҮРЭН АЛДАГДЛЫН ЗАМ, ХААГДСАН: `sessionId` NULL байхад
   *    `bumpSessionCounters` АЖИЛЛАХГҮЙ (дээрх хамгаалалт), тэгэхээр
   *    татгалзсан мөрүүд ХААНА Ч тоологдохгүй.  Өмнө нь энэ тохиолдолд ч
   *    200 буцдаг байсан — клиент мөрүүдээ устгаж, ЧИМЭЭГҮЙ БҮРЭН АЛДАГДАЛ
   *    үүснэ.  Одоо 409 + `accounted: false` буцна.
   */
  const sentCounts = {
    txns: rawTxns.length,
    touches: rawTouches.length,
    events: rawEvents.length,
  };
  const totals = {
    sent: tableSum(sentCounts),
    accepted: tableSum(result.accepted),
    duplicates: tableSum(result.duplicates),
    rejected: tableSum(rejected),
    dropped: tableSum(result.dropped),
    // Сесс БАЙГАА бол сессийн `server_dropped_count`-д ЯГ энэ тоо
    // нэмэгдсэн.  Сессгүй үед энэ нь БҮРТГЭГДЭЭГҮЙ алдагдал (`accounted`
    // false болж, 409 буцна).
    lost: serverDropped,
  };

  const outcome = ingestOutcome({
    hasSession: sessionId !== null,
    sent: totals.sent,
    accepted: totals.accepted,
    duplicates: totals.duplicates,
    lost: totals.lost,
  });

  const resBody = {
    session_id: sessionId,
    session_created: sessionStarted,
    sent: sentCounts,
    accepted: result.accepted,
    duplicates: result.duplicates,
    rejected,
    dropped: result.dropped,
    totals,
    accounted: outcome.accounted,
    degraded: result.degraded,
    // ⚠️ Оношлогоонд Л.  Хэвийн ажиллагаанд хоосон.
    failures: result.failures,
  };

  return c.json(
    {
      ...resBody,
      ok: outcome.ok,
      retryable: outcome.retryable,
      ...(outcome.error ? { error: outcome.error } : {}),
    },
    outcome.status,
  );
});

/** Гурван хүснэгтийн тоолуурын нийлбэр. */
function tableSum(c: { txns: number; touches: number; events: number }): number {
  return c.txns + c.touches + c.events;
}

/**
 * Багцын ҮР ДҮНГИЙН ШИЙДВЭР — ЦЭВЭР функц, тиймээс тесттэй
 * (`learning.ingestAccounting.test.ts`).
 *
 * ⚠️ `accounted` НЬ ГЭРЭЭНИЙ ЦӨМ.  Клиент мөрүүдээ устгах эрхийг ЗӨВХӨН
 *    ЭНЭ талбараас авна, HTTP статусаас БИШ:
 *      • true  — илгээсэн мөр БҮР эсвэл бичигдсэн, эсвэл сессийн
 *                `server_dropped_count`-д тоологдсон ⇒ устгаж болно.
 *      • false — ХААНА Ч бүртгэгдээгүй ⇒ клиент мөрүүдээ ХАДГАЛНА.
 *
 * ⚠️ ДАВХАРДАЛ НЬ ТАТГАЛЗАЛ БИШ.  Дахин илгээлт (accepted бүгд 0,
 *    duplicates > 0) нь ХЭВИЙН ⇒ 200.  Эс бөгөөс сүлжээ тасарсны дараах
 *    дахин илгээлт бүр 422 болж, клиент мөнхөд гацна.
 */
export interface IngestOutcome {
  status: 200 | 409 | 422;
  ok: boolean;
  accounted: boolean;
  retryable: boolean;
  error: 'loss_unaccounted' | 'batch_rejected' | null;
}

export function ingestOutcome(input: {
  /** Алдагдлыг бүртгэх `bim_sessions` мөр БАЙГАА эсэх. */
  hasSession: boolean;
  sent: number;
  accepted: number;
  duplicates: number;
  /** `server_dropped_count`-д нэмэгдэх ёстой байсан мөрийн тоо. */
  lost: number;
}): IngestOutcome {
  // Алдагдал БАЙСАН ч түүнийг бүртгэх сесс БАЙХГҮЙ — ЭНЭ БОЛ ДАЛД БҮРЭН
  // АЛДАГДЛЫН ЗАМ.  Клиент мөрүүдээ ХАДГАЛЖ, сесстэйгээр дахин илгээнэ
  // (аль хэдийн бичигдсэн мөр нь uid-ээр давхардаж, хор хөнөөлгүй).
  if (input.lost > 0 && !input.hasSession) {
    return {
      status: 409,
      ok: false,
      accounted: false,
      retryable: true,
      error: 'loss_unaccounted',
    };
  }
  // Багцыг БҮХЭЛД НЬ татгалзсан.  Алдагдал нь бүртгэгдсэн тул клиент
  // мөрүүдээ устгаж болно — гэхдээ ЭНЭ НЬ ХООСОН 200 БАЙХ ЁСГҮЙ.
  if (input.sent > 0 && input.accepted === 0 && input.duplicates === 0) {
    return {
      status: 422,
      ok: false,
      accounted: true,
      retryable: false,
      error: 'batch_rejected',
    };
  }
  return { status: 200, ok: true, accounted: true, retryable: false, error: null };
}

/**
 * Ingest-ийн зөвшөөрөх гарал үүсэл.  Клиент ЗӨВХӨН эдгээрийн аль нэгийг
 * зарлаж чадна; бусад нь курацийн (1B-6) шийдвэр.
 */
function ingestProvenance(v: unknown): Provenance {
  const s = String(v);
  if (s === 'MACHINE_GENERATED') return 'MACHINE_GENERATED';
  return 'UNVERIFIED';
}

function artifactIdOf(map: Map<string, number>, sha: string | null): number | null {
  if (!sha) return null;
  return map.get(sha) ?? null;
}

/** `sha256` → `bim_artifacts.id`.  Артефакт нь ӨМНӨХ хүсэлтэд орсон байна. */
async function resolveArtifactIds(
  db: D1Database,
  hashes: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < hashes.length; i += UIDS_PER_LOOKUP) {
    const chunk = hashes.slice(i, i + UIDS_PER_LOOKUP);
    const rows = await db
      .prepare(
        `SELECT id, sha256 FROM bim_artifacts
          WHERE sha256 IN (${chunk.map(() => '?').join(', ')})`,
      )
      .bind(...chunk)
      .all<{ id: number; sha256: string }>();
    for (const r of rows.results ?? []) out.set(r.sha256, r.id);
  }
  return out;
}

/** Байгаа `projects.id`-ууд.  Танихгүй id нь NULL болно (аудит гажуудахгүй). */
async function filterExistingProjects(
  db: D1Database,
  ids: readonly number[],
): Promise<Set<number>> {
  const out = new Set<number>();
  for (let i = 0; i < ids.length; i += UIDS_PER_LOOKUP) {
    const chunk = ids.slice(i, i + UIDS_PER_LOOKUP);
    const rows = await db
      .prepare(`SELECT id FROM projects WHERE id IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .all<{ id: number }>();
    for (const r of rows.results ?? []) out.add(r.id);
  }
  return out;
}

/* ================================================================== */
/*  GET /api/learning/events/head — RESUME ГАРЦ                        */
/* ================================================================== */

/**
 * Revit нь 1.2 GB `.rvt` дээр унах нь тэр өдрүүдийн ХЭВИЙН төгсгөл.  Add-in
 * дахин асахдаа хаанаас үргэлжлүүлэхээ мэдэх ёстой.
 *
 * ⚠️ ЗӨВХӨН ӨӨРИЙН урсгалыг уншина (`actor_user_id` / `user_id = user.sub`).
 *    Өөр хүний сессийн толгойг уншуулах нь зан төлөвийн мэдээлэл алдагдах
 *    цоорхой — үл хөдлөх дүрмийн (а) салаа.
 *
 * ⚠️ `MAX(seq)` нь «сүүлд хүлээн авсан» гэсэн үг, «завсаргүй» гэсэн үг БИШ.
 *    Add-in нь `last_seq + 1`-ээс үргэлжлүүлж, локал дараалалдаа
 *    `> last_seq` бүхнийг ДАХИН илгээнэ; `event_uid` / `txn_uid` дээрх
 *    `ON CONFLICT … DO NOTHING` нь давхардлыг барина.
 */
learning.get('/events/head', async (c) => {
  const user = c.get('user');
  const raw = c.req.query('stream_ids') ?? c.req.query('stream_id') ?? '';
  const streams = [...new Set(raw.split(',').map((s) => str(s, 64)).filter(Boolean))].slice(
    0,
    MAX_HEAD_STREAMS,
  );
  if (streams.length === 0) return c.json({ streams: {}, sessions: {} });

  const marks = streams.map(() => '?').join(', ');

  // 1 (user) + 20 (stream) = 21 bind ≤ 100 ✔
  const events = await c.env.DB.prepare(
    `SELECT stream_id,
            MAX(seq)          AS last_seq,
            COUNT(*)          AS count,
            MAX(received_at)  AS last_received_at
       FROM learning_events
      WHERE actor_user_id = ? AND stream_id IN (${marks})
      GROUP BY stream_id`,
  )
    .bind(user.sub, ...streams)
    .all<{ stream_id: string; last_seq: number; count: number; last_received_at: string }>();

  // Гүйлгээний толгой — `stream_id` нь add-in талд `session_uid`-тэй ижил.
  const txns = await c.env.DB.prepare(
    `SELECT s.session_uid       AS session_uid,
            MAX(t.seq)          AS last_seq,
            COUNT(*)            AS count,
            MAX(t.received_at)  AS last_received_at
       FROM revit_transactions t
       JOIN bim_sessions s ON s.id = t.session_id
      WHERE t.user_id = ? AND s.session_uid IN (${marks})
      GROUP BY s.session_uid`,
  )
    .bind(user.sub, ...streams)
    .all<{ session_uid: string; last_seq: number; count: number; last_received_at: string }>();

  const streamsOut: Record<string, unknown> = {};
  for (const r of events.results ?? []) {
    streamsOut[r.stream_id] = {
      last_seq: r.last_seq,
      count: r.count,
      last_received_at: r.last_received_at,
    };
  }
  const sessionsOut: Record<string, unknown> = {};
  for (const r of txns.results ?? []) {
    sessionsOut[r.session_uid] = {
      last_txn_seq: r.last_seq,
      txn_count: r.count,
      last_received_at: r.last_received_at,
    };
  }

  // ⚠️ Мэдэгдэхгүй урсгалыг хариунаас ОРХИНО (`null` биш).  Add-in нь
  //    «байхгүй = 0-оос эхэл» гэж уншина.
  return c.json({ streams: streamsOut, sessions: sessionsOut });
});

/* ================================================================== */
/*  GET /api/learning/health — ЗӨВХӨН НЭГТГЭСЭН, admin                 */
/* ================================================================== */

/**
 * Дагалдах хэсэг ДУТУУ мөрийн тоо — «маск» механизмын эрүүл мэндийн хэмжүүр.
 *
 * ⚠️ ЗӨВХӨН НИЙЛБЭР.  Нэрлэсэн жагсаалт, хэрэглэгчээр задалсан тоо энд
 *    ХЭЗЭЭ Ч гарахгүй (үл хөдлөх дүрмийн (б) салаа).
 * ⚠️ `parts_missing <> 0` нь 0209/0207-ын GENERATED багана дээрх ХЭСЭГЧИЛСЭН
 *    индекстэй (`idx_le_missing`, `idx_revit_txn_missing`) тул хямд.
 *
 * ⚠️ АЛДАГДЛЫГ ГУРВАН ТООГООР ГАРГАНА (0243).  «~20 машин дээр цуглуулга
 *    ЗӨВ явж байна уу» гэсэн асуултын хариулт нь ЯГ ЭНЭ ГУРАВ:
 *      • `declared_dropped` — КЛИЕНТ өөрөө хаясан (буфер халив, Revit унав)
 *      • `server_dropped`   — СЕРВЕР татгалзсан (хэлбэрийн алдаа, төсөв,
 *                             бичиж чадаагүй мөр)
 *      • `dropped_total`    — хоёрын НИЙЛБЭР, гаргаж авсан.
 *    Хоёр эх сурвалжийг НЭГ тоо болгож нийлүүлэх нь тэдгээрийн аль нэгийг
 *    нөгөөгөөр нь дарж, алдагдлыг ЧИМЭЭГҮЙ УСТГАДАГ байсан (0243-ын толгой).
 */
learning.get('/health', requireAdmin(), async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM learning_events)                        AS events_total,
       (SELECT COUNT(*) FROM learning_events WHERE parts_missing <> 0) AS events_unsatisfied,
       (SELECT COUNT(*) FROM learning_events
          WHERE parts_missing <> 0 AND received_at < datetime('now', '-1 hour'))
                                                                     AS events_unsatisfied_stale,
       (SELECT MAX(received_at) FROM learning_events)                AS last_event_at,
       (SELECT COUNT(*) FROM revit_transactions)                     AS txns_total,
       (SELECT COUNT(*) FROM revit_transactions WHERE parts_missing <> 0) AS txns_unsatisfied,
       (SELECT COUNT(*) FROM revit_element_touches)                  AS touches_total,
       (SELECT COUNT(*) FROM bim_artifacts)                          AS artifacts_total,
       (SELECT COUNT(*) FROM bim_sessions)                           AS sessions_total,
       (SELECT COUNT(*) FROM bim_sessions WHERE ended_at IS NULL)    AS sessions_open,
       (SELECT COALESCE(SUM(client_dropped_count), 0) FROM bim_sessions) AS declared_dropped,
       (SELECT COALESCE(SUM(server_dropped_count), 0) FROM bim_sessions) AS server_dropped,
       (SELECT COALESCE(SUM(dropped_count), 0) FROM bim_sessions)    AS dropped_total`,
  ).first<Record<string, number | string | null>>();

  return c.json({
    ...(row ?? {}),
    // 1B-4-ийн dataset үүсгэгч ЭНЭ шүүлтийг ЗААВАЛ дуудна — өөрийн SQL
    // бичихийг хориглоно.
    dataset_eligible_sql: DATASET_ELIGIBLE_SQL,
  });
});

/* ================================================================== */
/*  АРТЕФАКТ — БИЧИХ ДАРААЛЛЫН 1-Р АЛХАМ                               */
/* ================================================================== */

/**
 * `POST /api/learning/artifacts?sha256=…&kind=…&schema_tag=…&encoding=…`
 * Их бие нь ТҮҮХИЙ БАЙТ.
 *
 * ⚠️ СЕРВЕР sha256-Г ӨӨРӨӨ БОДНО.  Клиентийн зарласан утга бол ЗӨВХӨН
 *    нэхэмжлэл; таарахгүй бол 422 ба R2-д ЮУ Ч бичигдэхгүй.
 * ⚠️ BUCKET нь `MEETING_BUCKET` (ХУВИЙН).  `MEDIA_BUCKET` ХЭЗЭЭ Ч ҮГҮЙ —
 *    `index.ts:193` нь `/media`-г root дээр, auth-гүйгээр mount хийдэг ба
 *    `routes/media.ts:55` нь түлхүүрээ мэдэх хэн бүхэнд нээлттэй.
 * ⚠️ ТҮЛХҮҮР НЬ ЗУРААСГҮЙ (`bim_<sha256>`) — 0201-ийн шийдвэр.  Репогийн
 *    хувийн-объектын маршрутууд нэг л замын хэсэгтэй таардаг тул
 *    `bim/ab/<hash>` хэлбэрийн түлхүүр тэднээр ХЭЗЭЭ Ч татагдахгүй.
 */
learning.post('/artifacts', async (c) => {
  const user = c.get('user');
  const cfg = await loadCaptureConfig(c.env.DB);
  if (cfg.logging === 'off' || cfg.mode === 'off') {
    return c.json({ artifact_id: null, ingest: 'off' });
  }

  const declared = (c.req.query('sha256') ?? '').toLowerCase();
  if (!isSha256(declared)) return c.json({ error: 'bad_sha256' }, 400);

  const kind = oneOfOrNull(ARTIFACT_KINDS, c.req.query('kind')) as ArtifactKind | null;
  if (kind === null) return c.json({ error: 'bad_kind', allowed: ARTIFACT_KINDS }, 400);

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: 'empty_body' }, 400);
  if (bytes.byteLength > cfg.artifactMaxBytes) {
    return c.json({ error: 'too_large', max: cfg.artifactMaxBytes }, 413);
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== declared) {
    return c.json({ error: 'sha256_mismatch', declared, actual }, 422);
  }

  const mediaType = str(c.req.header('content-type'), 128) || 'application/octet-stream';
  const r2Key = `bim_${actual}`;

  await c.env.MEETING_BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: mediaType },
    customMetadata: { uploadedBy: String(user.sub), kind },
  });

  const { id, duplicate } = await insertArtifact(c.env.DB, {
    sha256: actual,
    r2_key: r2Key,
    media_type: mediaType,
    kind,
    schema_tag: str(c.req.query('schema_tag'), 64),
    encoding: str(c.req.query('encoding'), 16) || 'identity',
    byte_size: bytes.byteLength,
    item_count: nonNegInt(c.req.query('item_count'), 0),
    session_id: null,
    project_id: intOrNull(c.req.query('project_id')),
    uploaded_by: user.sub,
  });

  return c.json({ artifact_id: id, sha256: actual, byte_size: bytes.byteLength, duplicate });
});

/**
 * `GET /api/learning/artifacts/:sha256` — ХААЛТТАЙ татах.
 *
 * ⚠️ `routes/revitAddin.ts:29-51`-ийн загвар: `/api` доторх маршрут R2-оос
 *    уншиж `Cache-Control: private, no-store`-той stream хийнэ.  ШИНЭ
 *    ГАРЫН ҮСЭГТЭЙ ТОКЕН АНГИЛАЛ ҮҮСГЭХГҮЙ — `JWT_SECRET` аль хэдийн
 *    таван ангиллын токен гарын үсэг зурдаг ба түүнийг эргүүлэх нь бүх
 *    сесс, суулгасан add-in бүр, нислэг дэх хэвлэлтийн ажил бүрийг НЭГ
 *    ЗЭРЭГ унагаана.  (0201-ийн толгой `meetingAudio.ts`-ийн загварыг
 *    санал болгосон; тэр загвар нь `<audio>` шошго bearer толгой илгээж
 *    чаддаггүйгээс үүдэлтэй бөгөөд энд тийм хязгаарлалт БАЙХГҮЙ.)
 *
 * ⚠️ Эрх: артефакт нь загварын агуулга агуулж болзошгүй тул ЗӨВХӨН
 *    БАЙРШУУЛСАН ХҮН эсвэл `admin`.  Ахлагч ч өөр хүний артефактыг
 *    уншихгүй — үл хөдлөх дүрмийн (а) салаа.
 */
learning.get('/artifacts/:sha256', async (c) => {
  const user = c.get('user');
  const sha = (c.req.param('sha256') ?? '').toLowerCase();
  if (!isSha256(sha)) return c.json({ error: 'bad_sha256' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT r2_key, media_type, uploaded_by, redacted_at FROM bim_artifacts WHERE sha256 = ?',
  )
    .bind(sha)
    .first<{
      r2_key: string;
      media_type: string;
      uploaded_by: number | null;
      redacted_at: string | null;
    }>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  if (user.role !== 'admin' && row.uploaded_by !== user.sub) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  // Redaction: мөр үлдэнэ, байт нь алга.  «Энд ямар нэг зүйл байсан» гэдэг
  // нь өөрөө баримт (0201).
  if (row.redacted_at) return c.json({ error: 'redacted', redacted_at: row.redacted_at }, 410);

  const object = await c.env.MEETING_BUCKET.get(row.r2_key);
  if (!object) return c.json({ error: 'bytes_missing' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', row.media_type || 'application/octet-stream');
  // `writeHttpMetadata` нь Content-Length тавьдаггүй.
  headers.set('Content-Length', object.size.toString());
  headers.set('Cache-Control', 'private, no-store');
  return new Response(object.body, { headers });
});

export default learning;
