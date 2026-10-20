/**
 * MGL AI · ХУВИЛБАРЫН НИЙЦЛИЙН МАТРИЦ (Session D §7, §14, §15).
 *
 * «App 1.4 + Runtime 0.9 + Model 0.5 + Knowledge 12 + Registry 18 + Revit 0.11
 * хамт ажиллах уу?» гэсэн асуултад ИЛ ЗАРЛАСАН хязгаарлалтаар хариулна.
 * Далд нийцэл БАЙХГҮЙ: энд бичигдээгүй хамаарал нь «шалгагдаагүй», «зөв» БИШ.
 *
 * ⚠️ ХОЁР ТҮВШИН, ХОЁР ЭЗЭН.
 *   • Session B `ai/deployment/src/manifest.ts checkCompatibility` — РЕЛИЗИЙН
 *     манифест доторх `requires[]`-ийг суулгасан хувилбартай тулгана (ажилтны
 *     PC дээр, идэвхжүүлэхээс өмнө).  Энэ файл түүнийг ОРЛОХГҮЙ, дахин
 *     бичихгүй.
 *   • ЭНЭ файл — кодын ГЭРЭЭНИЙ хувилбарууд (runtime API, /norm схем,
 *     knowledge SQLite схем, dataset identity, tfc, prompt/tool схем) хооронд
 *     ямар холбоо байх ёстойг зарлаж, RELEASE GATE-д (CI, deploy-ээс ӨМНӨ)
 *     шалгана.  B-ийн манифестад `meta.<key>` болгон ЭДГЭЭР утгыг тавихыг
 *     зөвлөнө — тэгвэл хоёр түвшин нэг үгээр ярина.
 *
 * ⚠️ `compareVersions` нь runtime-ийнх (`updater.ts`) — B ч түүнийг л
 *    хэрэглэдэг.  Гурав дахь хэрэгжүүлэлт БИЧИХГҮЙ.
 */
import { compareVersions } from '../../../runtime/src/updater.ts';

/** Хувилбарын ТҮЛХҮҮРҮҮД — B-ийн `ComponentId` (app/runtime/model/knowledge/normRegistry/revit) + гэрээний хувилбарууд. */
export const VERSION_KEYS = [
  // B-ийн бүрэлдэхүүн (релизийн манифестын түвшин)
  'app',
  'runtime',
  'model',
  'knowledge',
  'normRegistry',
  'revit',
  // Гэрээний хувилбарууд (кодын түвшин)
  'runtimeApi', // ai/integration/src/contracts/runtimeApi.ts RUNTIME_API_CONTRACT_VERSION
  'knowledgeSchema', // ai/retrieval/src/db.ts SCHEMA_VERSION  (SQLite user schema)
  'datasetIdentity', // ai/retrieval/src/datasetIdentity.ts DATASET_IDENTITY_VERSION
  'registryManifest', // backend norm/generated/manifest.generated.ts .version
  'trustedContract', // backend trustedFacts.ts TRUSTED_CONTRACT_VERSION ↔ frontend validator.ts
  'promptVersion', // backend version.ts MGL_AI_PROMPT_VERSION
  'toolSchema', // backend version.ts MGL_AI_TOOL_SCHEMA_VERSION
  'retrievalVersion', // backend version.ts MGL_AI_RETRIEVAL_VERSION
] as const;
export type VersionKey = (typeof VERSION_KEYS)[number];

export type Versions = Partial<Record<VersionKey, string | null>>;

export type ConstraintKind =
  /** `subject.key >= min` */
  | 'min'
  /** `subject.key == other.key` — хос хувилбар ЯГ таарах ёстой */
  | 'equal'
  /** `subject.key` заавал байх (null = зөрчил) */
  | 'present';

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  subject: VersionKey;
  /** `min`: доод хувилбар; `equal`: харьцуулах нөгөө түлхүүр. */
  target?: string | VersionKey;
  /** Зөрчил нь релизийг ХААНА (blocking) уу, анхааруулна уу. */
  severity: 'blocking' | 'warning';
  /** ЯАГААД — кодын байршлаар.  Тайлбаргүй хязгаарлалт нь хэн ч хасахаас айдаг «ид шид» болно. */
  reason: string;
  owner: 'A' | 'B' | 'C' | 'D' | 'backend';
}

/**
 * ⚠️ ЭНЭ ЖАГСААЛТ БОЛ МАТРИЦ.  Мөр нэмэхдээ `reason`-д кодын байршлыг заа.
 */
export const CONSTRAINTS: readonly Constraint[] = [
  {
    id: 'knowledge-schema-matches-runtime',
    kind: 'equal',
    subject: 'knowledge',
    target: 'knowledgeSchema',
    severity: 'blocking',
    owner: 'A',
    reason:
      'ai/retrieval/src/db.ts openKnowledgeDb: ai_schema_meta.version ≠ SCHEMA_VERSION бол DERIVED_TABLES ' +
      '(ai_documents, ai_chunks, ai_rules … БҮГД) DROP хийгдэнэ.  Runtime-ийн SCHEMA_VERSION өссөн релиз ' +
      'нь knowledge багцгүйгээр тарвал ажилтны PC-ийн мэдлэг ЧИМЭЭГҮЙ УСТАНА (§15-ийн шууд зөрчил).  ' +
      'Мэдлэгийн багц нь өөрийн схемийн хувилбарыг манифестад (`meta.schemaVersion`) тээж, runtime-тэй ЯГ таарах ёстой.',
  },
  {
    id: 'registry-dataset-sha-matches-knowledge',
    kind: 'present',
    subject: 'normRegistry',
    severity: 'blocking',
    owner: 'A',
    reason:
      'backend norm/generated/manifest.generated.ts datasetSha256 ↔ ажилтны knowledge.sqlite ai_documents.meta_json.dataset_identity.sha256.  ' +
      'Зөрвөл A хувилбарын тооцоо B хувилбарын эшлэлтэй хамт гарна (NORM_DATA_VERSION_MISMATCH).  ' +
      'Кодын түвшинд: манифестад бүртгэл БАЙХ ёстой; өгөгдлийн түвшний тулгалт нь /norm/info-гийн ' +
      'dataset_sha256 (A гаргах) ↔ registry — `checkDataDrift()` доор.',
  },
  {
    id: 'trusted-contract-twin',
    kind: 'present',
    subject: 'trustedContract',
    severity: 'blocking',
    owner: 'backend',
    reason:
      'backend trustedFacts.ts TRUSTED_CONTRACT_VERSION (tfc-1) ↔ frontend validator.ts `version: \'tfc-1\'`.  ' +
      'Хос зөрвөл validator гэрээг ТАНИХГҮЙ → high-risk хариулт шалгагдалгүй гарна.',
  },
  {
    id: 'app-requires-runtime-api',
    kind: 'min',
    subject: 'runtimeApi',
    target: '1',
    severity: 'blocking',
    owner: 'D',
    reason:
      'frontend runtime.ts (RuntimeInfo, NormAnswer, streamGenerate) нь mgl-ai-runtime-api/1 хэлбэрийг уншина; ' +
      'runtime.contract.test.ts бодит серверийг энэ хувилбартай тулгана.',
  },
  {
    id: 'model-requires-runtime-min',
    kind: 'present',
    subject: 'runtime',
    severity: 'blocking',
    owner: 'B',
    reason:
      'D1 ai_model_releases.minimum_runtime_version → updater.ts runtimeSupports().  Загварын релиз бүр доод ' +
      'runtime хувилбараа зарлана; runtime байхгүй суулгацад загвар идэвхжихгүй (B manifest.ts REQUIRES_MISSING).',
  },
  {
    id: 'dataset-identity-v1',
    kind: 'equal',
    subject: 'datasetIdentity',
    target: 'registryManifest',
    severity: 'warning',
    owner: 'A',
    reason:
      'datasetIdentity.ts DATASET_IDENTITY_VERSION (ingest тал) ба manifest.generated.ts .version (compiler тал) — ' +
      'хэш тооцох алгоритм хоёр талд ижил хувилбар байх ёстой; зөрвөл ижил багц хоёр өөр sha өгнө.',
  },
  {
    id: 'prompt-version-present',
    kind: 'present',
    subject: 'promptVersion',
    severity: 'warning',
    owner: 'backend',
    reason: 'ai_feedback.system_prompt_version тамга — санал хүсэлтийг зааврын хувилбараар бүлэглэхэд заавал.',
  },
];

export interface CompatIssue {
  id: string;
  severity: Constraint['severity'];
  owner: Constraint['owner'];
  detail: string;
  reason: string;
}

export interface CompatReport {
  ok: boolean;
  blocking: CompatIssue[];
  warnings: CompatIssue[];
  checked: number;
  versions: Versions;
}

export function evaluateCompatibility(versions: Versions, constraints: readonly Constraint[] = CONSTRAINTS): CompatReport {
  const blocking: CompatIssue[] = [];
  const warnings: CompatIssue[] = [];
  const push = (c: Constraint, detail: string) => {
    const issue: CompatIssue = { id: c.id, severity: c.severity, owner: c.owner, detail, reason: c.reason };
    (c.severity === 'blocking' ? blocking : warnings).push(issue);
  };

  for (const c of constraints) {
    const have = versions[c.subject] ?? null;
    if (c.kind === 'present') {
      if (have === null) push(c, `${c.subject} хувилбар алга`);
      continue;
    }
    if (c.kind === 'min') {
      if (have === null) push(c, `${c.subject} хувилбар алга (шаардлага ≥ ${c.target})`);
      else if (compareVersions(have, String(c.target)) < 0) push(c, `${c.subject}=${have} < ${c.target}`);
      continue;
    }
    // equal
    const other = versions[c.target as VersionKey] ?? null;
    if (have === null || other === null) {
      push(c, `${c.subject}=${have ?? '∅'} ↔ ${String(c.target)}=${other ?? '∅'} (нэг нь алга)`);
    } else if (String(have) !== String(other)) {
      push(c, `${c.subject}=${have} ≠ ${String(c.target)}=${other}`);
    }
  }
  return { ok: blocking.length === 0, blocking, warnings, checked: constraints.length, versions };
}

/* ================================================================== */
/*  ӨГӨГДЛИЙН ТҮВШНИЙ DRIFT (§14) — knowledge ↔ registry                */
/* ================================================================== */

export interface DatasetIdentityRow {
  documentId: string;
  datasetSha256: string | null;
}

export interface DataDriftIssue {
  documentId: string;
  registrySha: string | null;
  knowledgeSha: string | null;
  code: 'NORM_DATA_VERSION_MISMATCH' | 'REGISTRY_ONLY' | 'KNOWLEDGE_SHA_MISSING';
}

/**
 * Worker-ийн хөрвүүлсэн бүртгэл (A `manifest.generated.ts`) ↔ ажилтны
 * knowledge.sqlite-ийн баримт бүрийн dataset sha.
 *
 * ⚠️ `KNOWLEDGE_ONLY` (санд байгаа ч бүртгэлд байхгүй) нь ЗӨРЧИЛ БИШ — бүртгэл
 *    нь зөвхөн тооцоолуурын дүрэмтэй баримтуудыг агуулна (өнөөдөр 1/10).
 *    `REGISTRY_ONLY` нь зөрчил: Worker тооцоо гаргаж чадах ч ажилтны PC эшлэл
 *    өгч чадахгүй.
 */
export function checkDataDrift(registry: readonly DatasetIdentityRow[], knowledge: readonly DatasetIdentityRow[]): DataDriftIssue[] {
  const out: DataDriftIssue[] = [];
  const k = new Map(knowledge.map((r) => [r.documentId, r.datasetSha256]));
  for (const r of registry) {
    if (!k.has(r.documentId)) {
      out.push({ documentId: r.documentId, registrySha: r.datasetSha256, knowledgeSha: null, code: 'REGISTRY_ONLY' });
      continue;
    }
    const ks = k.get(r.documentId) ?? null;
    if (ks === null) {
      out.push({ documentId: r.documentId, registrySha: r.datasetSha256, knowledgeSha: null, code: 'KNOWLEDGE_SHA_MISSING' });
    } else if (ks !== r.datasetSha256) {
      out.push({ documentId: r.documentId, registrySha: r.datasetSha256, knowledgeSha: ks, code: 'NORM_DATA_VERSION_MISMATCH' });
    }
  }
  return out;
}
