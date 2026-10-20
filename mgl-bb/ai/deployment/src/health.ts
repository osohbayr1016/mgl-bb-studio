/**
 * MGL AI · ЭРҮҮЛ МЭНДИЙН ЗАГВАР (Session B §11, §29).
 *
 * ⚠️ НЭГ БИТ БИШ, ТАЛ ТУС БҮРД ТӨЛӨВ.  `/health` = «амьд» гэсэн нэг бит
 *    нь «интернэт тасарсан» ба «загвар эвдэрсэн» хоёрыг ялгадаггүй — эхнийх
 *    нь локал AI ХЭВИЙН, хоёр дахь нь засвар шаардана.  Тиймээс:
 *
 *      LOCAL_AI         runtime + загвар + үүсгэлт
 *      KNOWLEDGE        knowledge.sqlite + манифест
 *      NORM             норматив дэд систем (Session A-ийн provider-оор)
 *      COMPANY_BACKEND  ERP Worker хүрэх эсэх
 *      REVIT            локал гүүр (суулгасан бол)
 *
 *    Нийт төлөв:  fatal унасан → REPAIR_REQUIRED;  шинэчлэлт явж байна →
 *    UPDATING;  degraded/skipped байна → DEGRADED;  бусад → READY.
 *    ⚠️ COMPANY_BACKEND OFFLINE нь fatal БИШ — «LOCAL_AI READY +
 *    COMPANY_BACKEND OFFLINE» бол зөв, хүлээгдэж буй төлөв (§29).
 *
 * ⚠️ ШАЛГАЛТ БҮР ШАЛТГААНЫ КОДТОЙ.  «unhealthy» гэсэн үг флотын хүснэгтэд
 *    юу ч хэлэхгүй; `MODEL_SHA_MISMATCH` нь админд «дахин тат» гэж хэлнэ.
 *
 * ⚠️ ШАЛГАЛТУУД НЬ ТАРИЛГААР ИРНЭ (`HealthProbes`).  Энэ файл файлын систем,
 *    сүлжээ, llama-server-ийг мэдэхгүй — тест нь бүх 14 шалгалтыг хэдхэн
 *    мс-д ажиллуулна, бодит runtime нь `probes.ts`-ээр бүрдүүлнэ.
 */
import type { NormProviders } from './normProviders.ts';

export const HEALTH_STATUSES = ['READY', 'DEGRADED', 'REPAIR_REQUIRED', 'UPDATING'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const FACETS = ['LOCAL_AI', 'KNOWLEDGE', 'NORM', 'COMPANY_BACKEND', 'REVIT'] as const;
export type Facet = (typeof FACETS)[number];

export type FacetStatus = 'READY' | 'DEGRADED' | 'OFFLINE' | 'MISSING' | 'REPAIR_REQUIRED' | 'UNKNOWN';

export type Severity = 'fatal' | 'degraded' | 'info';

export interface CheckOutcome {
  ok: boolean;
  /** Машины код.  ok=true үед ч бичнэ (`MODEL_SHA_OK`) — флотод «юу шалгасан» харагдана. */
  code: string;
  detail?: string;
  /** Шалгалт хийгдээгүй (бүрэлдэхүүн суулгаагүй, provider гараагүй) — унасан гэж үзэхгүй. */
  skipped?: boolean;
}

export interface CheckResult extends CheckOutcome {
  id: string;
  facet: Facet;
  severity: Severity;
  ms: number;
}

export interface HealthReport {
  status: HealthStatus;
  facets: Record<Facet, { status: FacetStatus; reasons: string[] }>;
  checks: CheckResult[];
  /** Унасан + skipped шалгалтын кодууд — флотын хүснэгтийн «шалтгаан» багана. */
  reasonCodes: string[];
  updating: boolean;
  measuredAt: string;
  totalMs: number;
}

/** §11-ийн 14 шалгалт — тус бүр тарилгаар. */
export interface HealthProbes {
  filesValid(): Promise<CheckOutcome>;
  modelExists(): Promise<CheckOutcome>;
  modelShaMatches(): Promise<CheckOutcome>;
  runtimeStarts(): Promise<CheckOutcome>;
  healthReachable(): Promise<CheckOutcome>;
  /**
   * P0-6: ХҮССЭН (заагч/installed.json) ≟ АЖИЛЛАЖ БУЙ (процессын /info.deployment.running).
   * Заагч 1.2 · процесс 1.1 → VERSION_MISMATCH → DEGRADED, READY БИШ.
   */
  versionsMatch(): Promise<CheckOutcome>;
  modelLoads(): Promise<CheckOutcome>;
  knowledgeOpens(): Promise<CheckOutcome>;
  knowledgeManifestValid(): Promise<CheckOutcome>;
  generationSmoke(): Promise<CheckOutcome>;
  backendReachable(): Promise<CheckOutcome>;
  revitBridge(): Promise<CheckOutcome>;
}

interface CheckSpec {
  id: string;
  facet: Facet;
  severity: Severity;
  run: () => Promise<CheckOutcome>;
}

async function timed(spec: CheckSpec): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const out = await spec.run();
    return { id: spec.id, facet: spec.facet, severity: spec.severity, ms: Date.now() - t0, ...out };
  } catch (err) {
    return {
      id: spec.id,
      facet: spec.facet,
      severity: spec.severity,
      ms: Date.now() - t0,
      ok: false,
      code: `${spec.id.toUpperCase()}_THREW`,
      detail: (err as Error).message,
    };
  }
}

export interface RunHealthOptions {
  probes: HealthProbes;
  norm: NormProviders;
  /** Шинэчлэлт явж байна — нийт төлөв UPDATING (шалгалтууд хэвээр ажиллана). */
  updating?: boolean;
  /** `true` бол хүнд шалгалтыг (загвар ачаалах, үүсгэлт) алгасна — эхлэлтийн хөнгөн горим. */
  light?: boolean;
  now?: () => string;
}

/**
 * ⚠️ ДАРААЛАЛ ЧУХАЛ: файл → загвар → runtime → ачаалалт → мэдлэг → норм →
 *    үүсгэлт → backend → Revit.  Урд нь fatal унасан бол хойд хүнд
 *    шалгалтуудыг (загвар ачаалах, үүсгэлт) АЛГАСНА — эвдэрсэн GGUF-ийг
 *    ачаалах гэж 20 секунд хүлээх нь дэмий ба VRAM-ыг дэмий эзэлнэ.
 */
export async function runHealthChecks(opts: RunHealthOptions): Promise<HealthReport> {
  const { probes, norm } = opts;
  const t0 = Date.now();
  const checks: CheckResult[] = [];
  let localFatal = false;

  const push = async (spec: CheckSpec, heavy = false): Promise<void> => {
    if (heavy && (localFatal || opts.light)) {
      checks.push({
        id: spec.id,
        facet: spec.facet,
        severity: spec.severity,
        ms: 0,
        ok: true,
        skipped: true,
        code: localFatal ? `${spec.id.toUpperCase()}_SKIPPED_AFTER_FATAL` : `${spec.id.toUpperCase()}_SKIPPED_LIGHT`,
      });
      return;
    }
    const r = await timed(spec);
    checks.push(r);
    if (!r.ok && !r.skipped && r.severity === 'fatal' && r.facet === 'LOCAL_AI') localFatal = true;
  };

  await push({ id: 'files_valid', facet: 'LOCAL_AI', severity: 'fatal', run: probes.filesValid });
  await push({ id: 'model_exists', facet: 'LOCAL_AI', severity: 'fatal', run: probes.modelExists });
  await push({ id: 'model_sha', facet: 'LOCAL_AI', severity: 'fatal', run: probes.modelShaMatches });
  await push({ id: 'runtime_starts', facet: 'LOCAL_AI', severity: 'fatal', run: probes.runtimeStarts });
  await push({ id: 'health_reachable', facet: 'LOCAL_AI', severity: 'fatal', run: probes.healthReachable });
  await push({ id: 'version_match', facet: 'LOCAL_AI', severity: 'degraded', run: probes.versionsMatch });
  await push({ id: 'model_loads', facet: 'LOCAL_AI', severity: 'fatal', run: probes.modelLoads }, true);

  await push({ id: 'knowledge_opens', facet: 'KNOWLEDGE', severity: 'fatal', run: probes.knowledgeOpens });
  await push({
    id: 'knowledge_manifest',
    facet: 'KNOWLEDGE',
    severity: 'degraded',
    run: probes.knowledgeManifestValid,
  });

  await push({
    id: 'norm_health',
    facet: 'NORM',
    severity: 'fatal',
    run: async () => {
      const h = await norm.health();
      return { ok: h.ok, code: h.code, ...(h.detail ? { detail: h.detail } : {}) };
    },
  });
  await push({
    id: 'norm_retrieval_smoke',
    facet: 'NORM',
    severity: 'degraded',
    run: async () => {
      const s = await norm.smokeRetrieval();
      return { ok: s.ok, code: s.code, skipped: s.skipped, ...(s.detail ? { detail: s.detail } : {}) };
    },
  });
  await push({
    id: 'norm_calculator_smoke',
    facet: 'NORM',
    severity: 'degraded',
    run: async () => {
      const s = await norm.smokeCalculator();
      return { ok: s.ok, code: s.code, skipped: s.skipped, ...(s.detail ? { detail: s.detail } : {}) };
    },
  });

  await push({ id: 'generation_smoke', facet: 'LOCAL_AI', severity: 'fatal', run: probes.generationSmoke }, true);

  // ⚠️ Backend offline нь fatal БИШ (§29) — degraded.
  await push({ id: 'backend_reachable', facet: 'COMPANY_BACKEND', severity: 'degraded', run: probes.backendReachable });
  await push({ id: 'revit_bridge', facet: 'REVIT', severity: 'info', run: probes.revitBridge });

  return aggregate(checks, opts.updating === true, opts.now?.() ?? new Date().toISOString(), Date.now() - t0);
}

export function aggregate(checks: CheckResult[], updating: boolean, measuredAt: string, totalMs: number): HealthReport {
  const facets = Object.fromEntries(
    FACETS.map((f) => [f, { status: 'UNKNOWN' as FacetStatus, reasons: [] as string[] }]),
  ) as HealthReport['facets'];
  const reasonCodes: string[] = [];

  for (const f of FACETS) {
    const mine = checks.filter((c) => c.facet === f);
    if (mine.length === 0) continue;
    const failed = mine.filter((c) => !c.ok && !c.skipped);
    const skipped = mine.filter((c) => c.skipped);
    const fatal = failed.filter((c) => c.severity === 'fatal');
    const reasons = [...failed.map((c) => c.code), ...skipped.map((c) => c.code)];
    reasonCodes.push(...failed.map((c) => c.code));

    let status: FacetStatus;
    if (f === 'COMPANY_BACKEND') {
      status = failed.length > 0 ? 'OFFLINE' : 'READY';
    } else if (f === 'REVIT') {
      // Revit гүүр суулгаагүй бол MISSING — алдаа биш, мэдээлэл.
      status = failed.length > 0 ? 'OFFLINE' : skipped.length === mine.length ? 'MISSING' : 'READY';
    } else if (fatal.length > 0) {
      // Бүх уналт «суулгаагүй» гэсэн код бол MISSING (repair = суулгах), бусад нь REPAIR_REQUIRED.
      const allNotInstalled = failed.every((c) => /NOT_INSTALLED|MISSING/.test(c.code));
      status = allNotInstalled && f !== 'LOCAL_AI' ? 'MISSING' : 'REPAIR_REQUIRED';
    } else if (failed.length > 0 || skipped.some((c) => c.severity !== 'info')) {
      status = 'DEGRADED';
    } else {
      status = 'READY';
    }
    facets[f] = { status, reasons };
  }

  let status: HealthStatus;
  const repair = FACETS.some((f) => facets[f].status === 'REPAIR_REQUIRED' || (f !== 'REVIT' && facets[f].status === 'MISSING'));
  if (updating) status = 'UPDATING';
  else if (repair) status = 'REPAIR_REQUIRED';
  else if (FACETS.some((f) => facets[f].status === 'DEGRADED' || facets[f].status === 'OFFLINE')) status = 'DEGRADED';
  else status = 'READY';

  return { status, facets, checks, reasonCodes, updating, measuredAt, totalMs };
}

/** Флот руу явах ХУРААНГУЙ — шалгалтын `detail` (файлын зам г.м.) ОРОХГҮЙ. */
export function healthSummary(r: HealthReport): {
  status: HealthStatus;
  facets: Record<Facet, FacetStatus>;
  reasonCodes: string[];
  measuredAt: string;
} {
  return {
    status: r.status,
    facets: Object.fromEntries(FACETS.map((f) => [f, r.facets[f].status])) as Record<Facet, FacetStatus>,
    reasonCodes: r.reasonCodes.slice(0, 32),
    measuredAt: r.measuredAt,
  };
}
