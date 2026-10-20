/**
 * MGL AI · НОРМАТИВ ДЭД СИСТЕМИЙН ИНТЕРФЕЙС (Session B §0, §11, §36).
 *
 * ⚠️ SESSION B ЭНД ЮУ Ч ТООЦООЛДОГГҮЙ, ЮУ Ч ХАЙДАГГҮЙ.  Норматив
 *    retrieval, дүрэм сонголт, тооцоолуур, TrustedNormResult, эшлэл,
 *    хүчин төгөлдөр байдал — бүгд SESSION A-ийн эзэмшил бөгөөд тэр
 *    кодыг энэ файл ИМПОРТЛОДОГГҮЙ.  Энд зөвхөн ГУРВАН асуулт:
 *
 *      health()   — дэд систем амьд, сан нээгдсэн, хэдэн баримт/дүрэм
 *      version()  — мэдлэг/бүртгэл/схемийн хувилбар
 *      smoke()    — «нэг мэдэгдэж буй асуултад ХАРИУ ӨГӨВ» (үнэн зөв эсэхийг
 *                   ШАЛГАХГҮЙ — тэр нь Session A-ийн GOLD suite)
 *
 * ⚠️ ХОЁР ХЭРЭГЖҮҮЛЭЛТ: `mockNormProviders` (тест, Session A бэлэн болтол)
 *    ба `httpNormProviders` (runtime-ийн НИЙТИЙН `/norm/info`, `/norm`
 *    гарцаар — дотоод модуль руу орохгүй).  Session A `TrustedNormResult`
 *    гаргамагц `httpNormProviders`-ийн ГАНЦ функцийг сольж холбоно.
 *
 * ⚠️ ТООЦООЛУУРЫН SMOKE ӨНӨӨДӨР «БОЛОМЖГҮЙ» ГЭЖ ИЛ ХЭЛНЭ, «давлаа» гэж
 *    ХУДЛАА ХЭЛЭХГҮЙ.  Session A нийтийн гарц гаргах хүртэл `skipped: true`
 *    + `NORM_CALC_SMOKE_NOT_EXPOSED` код.  Health aggregation нь skipped-ийг
 *    fatal гэж үзэхгүй, харин `DEGRADED` мэдээлэл болгоно.
 */

export interface NormHealth {
  ok: boolean;
  /** Машины уншиж болох код: NORM_OK | NORM_NOT_INSTALLED | NORM_DB_ERROR | NORM_UNREACHABLE … */
  code: string;
  installed: boolean;
  documents: number | null;
  rules: number | null;
  unverifiedRules: number | null;
  detail?: string;
}

export interface NormVersion {
  knowledgeVersion: string | null;
  registryVersion: string | null;
  schemaVersion: string | null;
}

export interface NormSmokeResult {
  ok: boolean;
  code: string;
  skipped: boolean;
  ms: number;
  detail?: string;
}

export interface NormSubsystemHealthProvider {
  health(): Promise<NormHealth>;
}
export interface NormSubsystemVersionProvider {
  version(): Promise<NormVersion>;
}
export interface NormSubsystemSmokeTestProvider {
  /** Мэдэгдэж буй асуулт → ямар нэг бүтэцтэй хариу (`status` талбартай). */
  smokeRetrieval(): Promise<NormSmokeResult>;
  /** Детерминист тооцоолуур — Session A нийтийн гарц гаргах хүртэл skipped. */
  smokeCalculator(): Promise<NormSmokeResult>;
}

export interface NormProviders
  extends NormSubsystemHealthProvider,
    NormSubsystemVersionProvider,
    NormSubsystemSmokeTestProvider {}

/* ================================================================== */
/*  MOCK — тест ба Session A бэлэн болтол                              */
/* ================================================================== */

export function mockNormProviders(over: Partial<NormProviders> & { installed?: boolean } = {}): NormProviders {
  const installed = over.installed ?? true;
  return {
    health:
      over.health ??
      (async () => ({
        ok: installed,
        code: installed ? 'NORM_OK' : 'NORM_NOT_INSTALLED',
        installed,
        documents: installed ? 10 : null,
        rules: installed ? 2500 : null,
        unverifiedRules: installed ? 0 : null,
      })),
    version:
      over.version ??
      (async () => ({
        knowledgeVersion: installed ? 'mock-knowledge' : null,
        registryVersion: installed ? 'mock-registry' : null,
        schemaVersion: installed ? '3' : null,
      })),
    smokeRetrieval:
      over.smokeRetrieval ??
      (async () => ({ ok: installed, code: installed ? 'NORM_SMOKE_OK' : 'NORM_NOT_INSTALLED', skipped: false, ms: 1 })),
    smokeCalculator:
      over.smokeCalculator ??
      (async () => ({ ok: true, code: 'NORM_CALC_SMOKE_NOT_EXPOSED', skipped: true, ms: 0 })),
  };
}

/* ================================================================== */
/*  HTTP АДАПТЕР — runtime-ийн НИЙТИЙН гарцаар                         */
/* ================================================================== */

export interface HttpNormDeps {
  /** `http://127.0.0.1:39217` */
  baseUrl: string;
  /** `x-mglai-secret` эсвэл session толгой — runtime-ийн auth.ts-ийн дүрэм. */
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Smoke асуулт — ЯМАР Ч эх сурвалжтай асуулт; үнэн зөвийг шалгахгүй. */
  smokeQuery?: string;
}

interface NormInfoBody {
  installed?: boolean;
  documents?: { doc_id?: string; code?: string }[];
  counts?: { chunks?: number; rules?: number; unverified_rules?: number; aliases?: number };
  /** Session A нэмэх боломжтой талбарууд — байхгүй бол null. */
  knowledge_version?: string;
  registry_version?: string;
  schema_version?: string | number;
}

export function httpNormProviders(deps: HttpNormDeps): NormProviders {
  const f = deps.fetchImpl ?? fetch;
  const timeout = deps.timeoutMs ?? 8000;

  async function info(): Promise<NormInfoBody | null> {
    try {
      const res = await f(`${deps.baseUrl}/norm/info`, {
        headers: deps.headers,
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return null;
      return (await res.json()) as NormInfoBody;
    } catch {
      return null;
    }
  }

  return {
    async health() {
      const body = await info();
      if (body === null) {
        return { ok: false, code: 'NORM_UNREACHABLE', installed: false, documents: null, rules: null, unverifiedRules: null };
      }
      if (body.installed !== true) {
        return { ok: false, code: 'NORM_NOT_INSTALLED', installed: false, documents: null, rules: null, unverifiedRules: null };
      }
      return {
        ok: true,
        code: 'NORM_OK',
        installed: true,
        documents: Array.isArray(body.documents) ? body.documents.length : null,
        rules: typeof body.counts?.rules === 'number' ? body.counts.rules : null,
        unverifiedRules: typeof body.counts?.unverified_rules === 'number' ? body.counts.unverified_rules : null,
      };
    },
    async version() {
      const body = await info();
      return {
        knowledgeVersion: typeof body?.knowledge_version === 'string' ? body.knowledge_version : null,
        registryVersion: typeof body?.registry_version === 'string' ? body.registry_version : null,
        schemaVersion: body?.schema_version !== undefined ? String(body.schema_version) : null,
      };
    },
    async smokeRetrieval() {
      const t0 = Date.now();
      try {
        const res = await f(`${deps.baseUrl}/norm`, {
          method: 'POST',
          headers: { ...deps.headers, 'content-type': 'application/json' },
          body: JSON.stringify({ query: deps.smokeQuery ?? 'Барилгын захиалагчийн үүрэг', audience: 'employee' }),
          signal: AbortSignal.timeout(timeout),
        });
        const ms = Date.now() - t0;
        if (res.status === 503) return { ok: false, code: 'NORM_NOT_INSTALLED', skipped: false, ms };
        if (!res.ok) return { ok: false, code: `NORM_HTTP_${res.status}`, skipped: false, ms };
        const body = (await res.json()) as { status?: unknown };
        // ⚠️ Зөвхөн «бүтэцтэй хариу ирэв» — `status` ямар ч утгатай байж болно.
        return typeof body.status === 'string'
          ? { ok: true, code: 'NORM_SMOKE_OK', skipped: false, ms }
          : { ok: false, code: 'NORM_SMOKE_MALFORMED', skipped: false, ms };
      } catch (err) {
        return { ok: false, code: 'NORM_SMOKE_ERROR', skipped: false, ms: Date.now() - t0, detail: (err as Error).message };
      }
    },
    async smokeCalculator() {
      // Session A нийтийн тооцоолуурын гарц гаргах хүртэл — ИЛ skipped.
      return { ok: true, code: 'NORM_CALC_SMOKE_NOT_EXPOSED', skipped: true, ms: 0 };
    },
  };
}
