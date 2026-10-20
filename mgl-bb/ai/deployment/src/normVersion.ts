/**
 * MGL AI · НОРМЫН ХУВИЛБАР ↔ БҮРТГЭЛИЙН ТУЛГАЛТ — B-ийн `NormProviders`-ийн БҮРХҮҮЛ (Session D §8/§14).
 *
 * ⚠️ ШИНЭ ХУВИЛБАРЫН ЭХ СУРВАЛЖ БИШ.  Хоёр тал хоёулаа Session A-ийнх:
 *      PC     runtime `GET /norm/info` → `knowledge_version` (kf1), `schema_version`,
 *             `documents[].dataset_sha256` (ingest-ийн `dataset_identity`)
 *      Worker `GET /api/mgl-ai/norm-registry` → `registry_version` (rf1), `documents[].dataset_sha256`
 *             (`manifest.generated.ts`, ИЖИЛ `datasetIdentity()` функц)
 *    Харьцуулалт нь `packages/mglai-common normIdentity.compareDatasetIdentity` — Worker-ийн ээлж бүрийн
 *    `norm/drift.ts`-тэй ИЖИЛ семантик (документ бүрийн sha ↔ sha).
 *
 * Гаралт:
 *    version()  → { knowledgeVersion: kf1, registryVersion: rf1 | null, schemaVersion }
 *    health()   → B-ийн суурь health, ГЭХДЭЭ sha зөрвөл `ok:false, code:'NORM_DATA_VERSION_MISMATCH'`
 *                 (norm_health нь `fatal` тул NORM facet REPAIR_REQUIRED — READY БИШ);
 *                 бүртгэл хүрэхгүй (backend offline) → `NORM_REGISTRY_UNREACHABLE` детайл, ok ХЭВЭЭР
 *                 (backend offline нь COMPANY_BACKEND facet-ийн ажил, нормын сан локалдаа ажиллана);
 *                 схем зөрвөл (`schema_version` ≠ `runtime_schema_version`) → `NORM_SCHEMA_MISMATCH` (fatal).
 */
import { compareDatasetIdentity, fromWire, type DatasetComparison, type NormIdentityWire } from '@mgl/mglai-common/normIdentity';
import type { NormHealth, NormProviders, NormVersion } from './normProviders.ts';

export interface NormVersionDeps {
  /** runtime `http://127.0.0.1:39217` + нууц/сессийн толгой. */
  runtimeUrl: string;
  runtimeHeaders: Record<string, string>;
  /** Worker `https://…workers.dev` — `null` бол бүртгэл тулгагдахгүй (unknown). */
  controlPlane: string | null;
  /** ERP JWT (хосолсон) — `null` бол бүртгэл татахгүй. */
  token: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface NormInfoWire {
  installed?: boolean;
  knowledge_version?: string | null;
  registry_version?: string | null;
  schema_version?: number | string | null;
  runtime_schema_version?: number | string | null;
  documents?: NormIdentityWire[];
}

interface RegistryWire {
  registry_version?: string;
  documents?: NormIdentityWire[];
}

export interface NormCompatibility {
  status: DatasetComparison['status'] | 'registry_unreachable' | 'knowledge_not_installed';
  comparison: DatasetComparison | null;
  knowledgeVersion: string | null;
  registryVersion: string | null;
  schemaVersion: string | null;
  runtimeSchemaVersion: string | null;
}

async function getJson<T>(f: typeof fetch, url: string, headers: Record<string, string>, ms: number): Promise<T | null> {
  try {
    const res = await f(url, { headers, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Хоёр талыг татаж тулгана — цэвэр үр дүн, шийдвэр биш. */
export async function normCompatibility(deps: NormVersionDeps): Promise<NormCompatibility> {
  const f = deps.fetchImpl ?? fetch;
  const ms = deps.timeoutMs ?? 8000;
  const info = await getJson<NormInfoWire>(f, `${deps.runtimeUrl}/norm/info`, deps.runtimeHeaders, ms);
  const base: NormCompatibility = {
    status: 'knowledge_not_installed',
    comparison: null,
    knowledgeVersion: typeof info?.knowledge_version === 'string' ? info.knowledge_version : null,
    registryVersion: null,
    schemaVersion: info?.schema_version !== undefined && info.schema_version !== null ? String(info.schema_version) : null,
    runtimeSchemaVersion: info?.runtime_schema_version !== undefined && info.runtime_schema_version !== null ? String(info.runtime_schema_version) : null,
  };
  if (!info || info.installed !== true) return base;

  const token = deps.controlPlane ? await deps.token() : null;
  const reg = deps.controlPlane && token ? await getJson<RegistryWire>(f, `${deps.controlPlane}/api/mgl-ai/norm-registry`, { Authorization: `Bearer ${token}` }, ms) : null;
  if (!reg || !Array.isArray(reg.documents)) return { ...base, status: 'registry_unreachable' };

  const comparison = compareDatasetIdentity(fromWire(reg.documents), fromWire(info.documents ?? []));
  return { ...base, status: comparison.status, comparison, registryVersion: typeof reg.registry_version === 'string' ? reg.registry_version : null };
}

/**
 * B-ийн `httpNormProviders`-ийг ороосон provider — `version()` ба `health()` л өөрчлөгдөнө,
 * smoke-ууд суурь руугаа дамжина.
 */
export function withRegistryVersion(base: NormProviders, deps: NormVersionDeps): NormProviders {
  return {
    ...base,
    async version(): Promise<NormVersion> {
      const c = await normCompatibility(deps);
      return { knowledgeVersion: c.knowledgeVersion, registryVersion: c.registryVersion, schemaVersion: c.schemaVersion };
    },
    async health(): Promise<NormHealth> {
      const h = await base.health();
      if (!h.ok) return h;
      const c = await normCompatibility(deps);
      if (c.schemaVersion !== null && c.runtimeSchemaVersion !== null && c.schemaVersion !== c.runtimeSchemaVersion) {
        // §15 — санг ЗӨВХӨН УНШИНА гэсэн A-ийн хамгаалалт /norm-ыг 503 болгодог; health ч мөн fail-closed.
        return { ...h, ok: false, code: 'NORM_SCHEMA_MISMATCH', detail: `knowledge schema ${c.schemaVersion} ≠ runtime ${c.runtimeSchemaVersion}` };
      }
      if (c.status === 'mismatch') {
        const ids = c.comparison!.mismatched.map((m) => m.documentId).join(', ');
        return { ...h, ok: false, code: 'NORM_DATA_VERSION_MISMATCH', detail: `бүртгэл ↔ мэдлэгийн sha зөрөв: ${ids}` };
      }
      if (c.status === 'registry_unreachable') {
        return { ...h, detail: 'NORM_REGISTRY_UNREACHABLE: Worker-ийн бүртгэлтэй тулгаж чадсангүй (offline) — локал сан ажиллана' };
      }
      if (c.status === 'unknown') {
        return { ...h, detail: `NORM_DATA_VERSION_UNKNOWN: sha-гүй баримт ${c.comparison!.shaMissing.join(', ')} (дахин шингээх)` };
      }
      return h;
    },
  };
}
