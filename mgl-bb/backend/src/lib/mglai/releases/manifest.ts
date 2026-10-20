/**
 * MGL AI · РЕЛИЗИЙН МАНИФЕСТ — СЕРВЕР ТАЛ (Session B §6, §15, §27, §28).
 *
 * Гурван тусдаа бүртгэлээс (`ai_model_releases` · `ai_knowledge_packs` ·
 * `ai_runtime_installers`) НЭГ `mgl-ai-release/1` манифест угсарна, төлөвийн
 * машин (CANDIDATE → APPROVED → CANARY → STABLE) ба төхөөрөмжид ямар
 * манифест очихыг шийднэ.
 *
 * ⚠️ ХОС СХЕМ: `ReleaseManifest` нь `ai/deployment/src/manifest.ts`-ийн
 *    ХУУЛБАР (backend нь `ai/`-г импортолж чадахгүй).  Схемийг өөрчилбөл
 *    ХОЁУЛАНГ; `schema: 'mgl-ai-release/1'` мөр нь хамгаалалт — клиент
 *    мэдэхгүй схемийг ТАТГАЛЗАНА (тэнд тест бий).
 *
 * ⚠️ ЭНД ЮУ Ч ПРОМОУШН ХИЙХГҮЙ, ЮУ Ч ТҮГЭЭХГҮЙ.  Төлөвийн машин цэвэр функц;
 *    D1 бичилт нь route-д, админы товчоор.  Компанийн хэмжээний rollout
 *    энэ шатанд БАЙХГҮЙ (§15) — `manifestForChannel` нь зөвхөн «энэ сувагт
 *    аль манифест ХАМГИЙН СҮҮЛД STABLE/CANARY болсон бэ» гэдгийг сонгоно.
 */

export const MANIFEST_SCHEMA = 'mgl-ai-release/1' as const;
export const COMPONENT_IDS = ['app', 'runtime', 'model', 'knowledge', 'normRegistry', 'revit'] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];
export type Channel = 'admin' | 'canary' | 'stable';

export interface ComponentSpec {
  id?: string;
  version: string;
  sha256: string;
  url: string | null;
  sizeBytes: number | null;
  requires?: { component: ComponentId; min: string }[];
  meta?: Record<string, string | number | boolean | null>;
}

export interface ReleaseManifest {
  schema: typeof MANIFEST_SCHEMA;
  releaseId: string;
  channel: Channel;
  createdAt: string;
  components: Partial<Record<ComponentId, ComponentSpec>>;
  compatibility: { minAppVersion?: string | null; minRuntimeVersion?: string | null };
  notes?: string | null;
}

/* ================================================================== */
/*  ТӨЛӨВИЙН МАШИН                                                     */
/* ================================================================== */

export const MANIFEST_STATUSES = ['CANDIDATE', 'APPROVED', 'CANARY', 'STABLE', 'ROLLED_BACK', 'ARCHIVED'] as const;
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

export function isManifestStatus(v: unknown): v is ManifestStatus {
  return typeof v === 'string' && (MANIFEST_STATUSES as readonly string[]).includes(v);
}

/**
 * ⚠️ CANDIDATE → STABLE гэсэн ШУУД зам ЗОРИУД БАЙХГҮЙ.  Батлагдаагүй,
 *    canary-д ажиллаагүй манифест 40 машин руу очих ёсгүй.  ROLLED_BACK нь
 *    ямар ч идэвхтэй төлвөөс; ARCHIVED нь эцсийн.
 */
const TRANSITIONS: Record<ManifestStatus, readonly ManifestStatus[]> = {
  CANDIDATE: ['APPROVED', 'ARCHIVED'],
  APPROVED: ['CANARY', 'ROLLED_BACK', 'ARCHIVED'],
  CANARY: ['STABLE', 'ROLLED_BACK'],
  STABLE: ['ROLLED_BACK', 'ARCHIVED'],
  ROLLED_BACK: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionManifest(from: ManifestStatus, to: ManifestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Төлөв → манифестын `channel` талбар (клиент харна). */
export function channelForStatus(status: ManifestStatus): Channel {
  if (status === 'STABLE') return 'stable';
  if (status === 'CANARY') return 'canary';
  return 'admin';
}

/**
 * Тухайн сувагт очих манифест.  Мөрүүд `created_at DESC`.
 *   stable → хамгийн сүүлийн STABLE
 *   canary → хамгийн сүүлийн CANARY, байхгүй бол STABLE
 *   admin  → хамгийн сүүлийн APPROVED | CANARY | STABLE
 */
export function manifestForChannel<T extends { status: string; created_at: string }>(rows: readonly T[], channel: Channel): T | null {
  const allowed: readonly string[] =
    channel === 'stable' ? ['STABLE'] : channel === 'canary' ? ['CANARY', 'STABLE'] : ['APPROVED', 'CANARY', 'STABLE'];
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const pref of allowed) {
    const hit = sorted.find((r) => r.status === pref);
    if (hit) return hit;
  }
  return null;
}

/* ================================================================== */
/*  УГСРАЛТ — бүртгэлийн мөрүүдээс                                    */
/* ================================================================== */

export interface ModelReleaseRow {
  release_uid: string;
  version: string;
  artifact_url: string | null;
  artifact_bytes: number | null;
  artifact_sha256: string | null;
  quantization: string | null;
  min_vram_mb: number | null;
  minimum_runtime_version: string | null;
  kind: string | null;
  base_release_uid: string | null;
}

export interface KnowledgePackRow {
  pack_id: string;
  version: string;
  url: string;
  sha256: string;
  bytes: number | null;
}

export interface InstallerRow {
  component: string;
  version: string;
  url: string;
  sha256: string;
  bytes: number | null;
}

export interface AssembleInput {
  releaseId: string;
  createdAt: string;
  model: ModelReleaseRow | null;
  adapter: ModelReleaseRow | null;
  knowledge: KnowledgePackRow | null;
  /** `runtime-code` мөр — `ai_runtime_installers`. */
  runtimeCode: InstallerRow | null;
  normRegistryVersion: string | null;
  revit: { version: string; sha256: string; url: string; bytes: number | null } | null;
  minRuntimeVersion?: string | null;
  notes?: string | null;
}

export type AssembleResult = { ok: true; manifest: ReleaseManifest } | { ok: false; errors: string[] };

/**
 * ⚠️ SHA-ГҮЙ МӨР МАНИФЕСТАД ОРОХГҮЙ — алдаа.  `ai_model_releases.artifact_sha256`
 *    NULL байж болдог (хуучин мөр); ModelManager тэрийг татгалздаг, энд ч
 *    манифест угсрахаас татгалзана — «дараа нэмнэ» гэсэн зам байхгүй.
 */
export function assembleManifest(input: AssembleInput): AssembleResult {
  const errors: string[] = [];
  const components: ReleaseManifest['components'] = {};
  const minRt = input.minRuntimeVersion ?? null;

  if (input.runtimeCode) {
    if (!/^[0-9a-f]{64}$/i.test(input.runtimeCode.sha256)) errors.push('RUNTIME_SHA_INVALID');
    components.runtime = {
      version: input.runtimeCode.version,
      sha256: input.runtimeCode.sha256.toLowerCase(),
      url: input.runtimeCode.url,
      sizeBytes: input.runtimeCode.bytes,
      meta: { format: 'zip' },
    };
  }

  if (input.model) {
    const m = input.model;
    if (!m.artifact_sha256 || !/^[0-9a-f]{64}$/i.test(m.artifact_sha256)) errors.push('MODEL_SHA_MISSING');
    if (!m.artifact_url) errors.push('MODEL_URL_MISSING');
    const meta: ComponentSpec['meta'] = { releaseUid: m.release_uid, quantization: m.quantization, kind: m.kind ?? 'base' };
    if (m.min_vram_mb !== null) {
      meta.minHardwareClass = m.min_vram_mb >= 11000 ? 'HIGH_GPU' : m.min_vram_mb >= 7500 ? 'STANDARD_8GB_GPU' : m.min_vram_mb >= 3500 ? 'LOW_GPU' : 'CPU_FALLBACK';
    }
    if (input.adapter) {
      const a = input.adapter;
      if (!a.artifact_sha256 || !a.artifact_url) errors.push('ADAPTER_SHA_OR_URL_MISSING');
      meta.adapterReleaseUid = a.release_uid;
      meta.adapterVersion = a.version;
      meta.adapterUrl = a.artifact_url;
      meta.adapterSha256 = a.artifact_sha256?.toLowerCase() ?? null;
      meta.adapterBytes = a.artifact_bytes;
      if (a.base_release_uid && a.base_release_uid !== m.release_uid) errors.push('ADAPTER_BASE_MISMATCH');
    }
    const requires: ComponentSpec['requires'] = [];
    const rtMin = m.minimum_runtime_version ?? input.adapter?.minimum_runtime_version ?? null;
    if (rtMin) requires.push({ component: 'runtime', min: rtMin });
    components.model = {
      id: m.release_uid,
      version: input.adapter ? `${m.version}+${input.adapter.version}` : m.version,
      sha256: (m.artifact_sha256 ?? '').toLowerCase(),
      url: m.artifact_url,
      sizeBytes: m.artifact_bytes,
      ...(requires.length > 0 ? { requires } : {}),
      meta,
    };
  }

  if (input.knowledge) {
    const k = input.knowledge;
    if (!/^[0-9a-f]{64}$/i.test(k.sha256)) errors.push('KNOWLEDGE_SHA_INVALID');
    components.knowledge = {
      id: k.pack_id,
      version: k.version,
      sha256: k.sha256.toLowerCase(),
      url: k.url,
      sizeBytes: k.bytes,
      meta: { fileName: 'knowledge.sqlite' },
    };
    if (input.normRegistryVersion) {
      // Бүртгэл нь мэдлэгийн багц ДОТОР ирдэг — зөвхөн хувилбарын тэмдэг, татагдахгүй.
      components.normRegistry = { version: input.normRegistryVersion, sha256: k.sha256.toLowerCase(), url: null, sizeBytes: null };
    }
  } else if (input.normRegistryVersion) {
    errors.push('NORM_REGISTRY_WITHOUT_KNOWLEDGE');
  }

  if (input.revit) {
    if (!/^[0-9a-f]{64}$/i.test(input.revit.sha256)) errors.push('REVIT_SHA_INVALID');
    components.revit = { version: input.revit.version, sha256: input.revit.sha256.toLowerCase(), url: input.revit.url, sizeBytes: input.revit.bytes };
  }

  if (Object.keys(components).length === 0) errors.push('NO_COMPONENTS');
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      schema: MANIFEST_SCHEMA,
      releaseId: input.releaseId,
      channel: 'admin',
      createdAt: input.createdAt,
      components,
      compatibility: minRt ? { minRuntimeVersion: minRt } : {},
      notes: input.notes ?? null,
    },
  };
}

/** Манифестын ялгаа — админ «энэ релиз юуг өөрчилж байна» гэдгийг харна. */
export function diffManifests(prev: ReleaseManifest | null, next: ReleaseManifest): { component: ComponentId; from: string | null; to: string }[] {
  const out: { component: ComponentId; from: string | null; to: string }[] = [];
  for (const c of COMPONENT_IDS) {
    const a = prev?.components[c] ?? null;
    const b = next.components[c] ?? null;
    if (!b) continue;
    if (!a || a.version !== b.version || a.sha256 !== b.sha256) out.push({ component: c, from: a?.version ?? null, to: b.version });
  }
  return out;
}
