/**
 * MGL AI · ХУВИЛБАРУУДЫГ ЦУГЛУУЛАХ (Session D §20).
 *
 * Хоёр эх сурвалж:
 *   • `collectFromSources()` — репогийн эх код (CI, deploy-ээс өмнө).
 *   • `collectFromRuntime(base, headers)` — амьд локал runtime (/info, /norm/info)
 *     — ажилтны PC дээрх БОДИТ суулгац.
 *
 * ⚠️ Олдоогүй утга `null` — ХЭЗЭЭ Ч таамаглахгүй.  `null` нь матрицад
 *    «алга» зөрчил болж гарна; тэр нь зөв: хувилбараа хэлж чадахгүй
 *    бүрэлдэхүүн релизэд орох ёсгүй (§23).
 */
import { readFileSync } from 'node:fs';

import type { Versions } from './matrix.ts';
import type { DatasetIdentityRow } from './matrix.ts';
import { P, readSource, constString } from '../contracts/sources.ts';
import { RUNTIME_API_CONTRACT_VERSION } from '../contracts/runtimeApi.ts';

function numConst(src: string | null, name: string): string | null {
  const m = src?.match(new RegExp(`export const ${name} = (\\d+)`));
  return m ? m[1]! : null;
}

export function collectFromSources(): Versions {
  const beVersion = readSource(P.beVersion);
  const runtimeConfig = readSource(P.runtimeConfig);
  const dbTs = readSource(P.retrievalPipeline.replace('pipeline.ts', 'db.ts'));
  const identity = readSource(P.datasetIdentity);
  const manifest = readSource(P.beRegistryManifest);
  const trusted = readSource(P.beTrustedFacts);
  const feValidator = readSource(P.feValidator);
  const aiPkg = JSON.parse(readFileSync(P.aiPackage, 'utf8')) as { version?: string };

  const tfcBackend = trusted ? constString(trusted, 'TRUSTED_CONTRACT_VERSION') : null;
  // Frontend `version: 'tfc-1' | 'tfc-2'` — union байж болно (A final: tfc-2 нэмсэн, tfc-1 хэвээр
  // хүлээн авна).  Backend-ийн хувилбар frontend-ийн ХҮЛЭЭН АВДАГ олонлогт байвал хос нийцтэй.
  const feVersionLine = feValidator?.match(/^\s*version:\s*([^;\n]+);/m)?.[1] ?? '';
  const tfcFrontendSet = new Set([...feVersionLine.matchAll(/'(tfc-\d+)'/g)].map((m) => m[1]!));

  return {
    // B-ийн бүрэлдэхүүн — репод «app» хувилбар БАЙХГҮЙ (frontend/package.json 0.0.0);
    // Pages deploy-ийн commit hash л таних тэмдэг.  Тиймээс null — B тодорхойлно.
    app: null,
    runtime: runtimeConfig ? constString(runtimeConfig, 'RUNTIME_VERSION') : null,
    model: null, // зөвхөн амьд runtime мэднэ (active_model.version)
    // knowledge = ажилтны SQLite-ийн ai_schema_meta.version; эх кодоос = ирээдүйн багцын схем
    knowledge: numConst(dbTs, 'SCHEMA_VERSION'),
    normRegistry: manifest?.match(/"generatorVersion":\s*"([^"]+)"\s*,\s*\n\s*"version"/)?.[1] ?? null,
    revit: null,
    runtimeApi: RUNTIME_API_CONTRACT_VERSION.split('/')[1] ?? null,
    knowledgeSchema: numConst(dbTs, 'SCHEMA_VERSION'),
    datasetIdentity: numConst(identity, 'DATASET_IDENTITY_VERSION'),
    registryManifest: manifest?.match(/"version":\s*(\d+)\s*\n\};/)?.[1] ?? null,
    trustedContract: tfcBackend !== null && tfcFrontendSet.has(tfcBackend) ? tfcBackend : null,
    promptVersion: beVersion ? constString(beVersion, 'MGL_AI_PROMPT_VERSION') : null,
    toolSchema: beVersion ? constString(beVersion, 'MGL_AI_TOOL_SCHEMA_VERSION') : null,
    retrievalVersion: beVersion ? constString(beVersion, 'MGL_AI_RETRIEVAL_VERSION') : null,
    ...(aiPkg.version ? {} : {}),
  };
}

/** A-ийн хөрвүүлсэн бүртгэлээс баримт бүрийн dataset sha (байхгүй бол []). */
export function registryIdentities(): DatasetIdentityRow[] {
  const manifest = readSource(P.beRegistryManifest);
  if (!manifest) return [];
  const out: DatasetIdentityRow[] = [];
  for (const block of manifest.split(/\n\s*\{\n/).slice(1)) {
    const id = block.match(/"documentId":\s*"([^"]+)"/)?.[1];
    const sha = block.match(/"datasetSha256":\s*"([0-9a-f]{64})"/)?.[1] ?? null;
    if (id) out.push({ documentId: id, datasetSha256: sha });
  }
  return out;
}

export interface RuntimeVersions {
  runtime: string | null;
  model: string | null;
  runtimeVariant: string | null;
  adapter: string | null;
  knowledgeInstalled: boolean | null;
  /** A гаргамагц бөглөгдөнө; өнөөдөр null. */
  knowledgeVersion: string | null;
  registryVersion: string | null;
  schemaVersion: string | null;
  documents: DatasetIdentityRow[];
}

/** Амьд runtime-аас.  Хүрэхгүй бол бүх талбар null — ХЭЗЭЭ Ч таамаглахгүй. */
export async function collectFromRuntime(base: string, headers: Record<string, string>, timeoutMs = 4000): Promise<RuntimeVersions> {
  const empty: RuntimeVersions = {
    runtime: null,
    model: null,
    runtimeVariant: null,
    adapter: null,
    knowledgeInstalled: null,
    knowledgeVersion: null,
    registryVersion: null,
    schemaVersion: null,
    documents: [],
  };
  try {
    const [info, norm] = await Promise.all([
      fetch(`${base}/info`, { headers, signal: AbortSignal.timeout(timeoutMs) }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${base}/norm/info`, { headers, signal: AbortSignal.timeout(timeoutMs) }).then((r) => (r.ok ? r.json() : null)),
    ]);
    const i = (info ?? {}) as Record<string, unknown>;
    const n = (norm ?? {}) as Record<string, unknown>;
    const engine = (i.engine ?? {}) as Record<string, unknown>;
    const active = (i.active_model ?? null) as { version?: string } | null;
    const adapter = (i.adapter ?? null) as { version?: string } | null;
    const docs = Array.isArray(n.documents) ? (n.documents as Record<string, unknown>[]) : [];
    return {
      runtime: typeof i.runtime_version === 'string' ? i.runtime_version : null,
      model: active?.version ?? (typeof engine.modelVersion === 'string' ? engine.modelVersion : null),
      runtimeVariant: typeof engine.runtimeVariant === 'string' ? engine.runtimeVariant : null,
      adapter: adapter?.version ?? null,
      knowledgeInstalled: typeof n.installed === 'boolean' ? n.installed : null,
      knowledgeVersion: typeof n.knowledge_version === 'string' ? n.knowledge_version : null,
      registryVersion: typeof n.registry_version === 'string' ? n.registry_version : null,
      schemaVersion: n.schema_version !== undefined ? String(n.schema_version) : null,
      documents: docs.map((d) => ({
        documentId: String(d.doc_id ?? ''),
        // ← A: /norm/info documents[]-д `dataset_sha256` нэмэх; хүртэл null.
        datasetSha256: typeof d.dataset_sha256 === 'string' ? d.dataset_sha256 : null,
      })),
    };
  } catch {
    return empty;
  }
}
