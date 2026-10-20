/**
 * MGL AI · НОРМЫН МЭДЛЭГ ↔ БҮРТГЭЛИЙН ТАНИХ ТЭМДЭГ — ХУВААЛЦСАН ЦЭВЭР ФУНКЦ (Session D §8/§14).
 *
 * ⚠️ ШИНЭ ҮНЭН БИШ.  Хоёр эх сурвалж хоёулаа Session A-ийнх:
 *      • ажилтны PC — `knowledge.sqlite` `ai_documents.metadata_json.dataset_identity.sha256`
 *        (`ai/retrieval/src/datasetIdentity.ts`, ingest бүрд бичигдэнэ; runtime `/norm/info` гаргана)
 *      • Worker — `backend/src/lib/mglai/norm/generated/manifest.generated.ts` `documents[].datasetSha256`
 *        (`ai:norm:generate`, ИЖИЛ `datasetIdentity()` функц, ижил файлын жагсаалт)
 *    Энэ модуль зөвхөн ХАРЬЦУУЛНА ба хоёр талын жагсаалтаас ДЕТЕРМИНИСТ хурууны хээ гаргана —
 *    B-ийн `NormSubsystemVersionProvider` (`knowledgeVersion`/`registryVersion`) ба health
 *    (`NORM_DATA_VERSION_MISMATCH`) хоёулаа ЭНЭ функцээр л шийднэ; backend `norm/drift.ts` нь
 *    ээлж бүрийн (баримт тус бүрийн) тулгалт — семантик ижил, хамрах хүрээ өөр.
 *
 * ⚠️ Хамааралгүй, `lib: ES2023` — Worker · Node · хөтөч.
 */

export const NORM_IDENTITY_SCHEMA = 'mgl-ai-norm-identity/1' as const;

/** Баримт бүрийн таних тэмдэг — хоёр талд ИЖИЛ хэлбэр. */
export interface NormDocumentIdentity {
  documentId: string;
  documentCode: string | null;
  datasetId: string | null;
  datasetVersion: string | null;
  /** 64 hex эсвэл null (хуучин шингээлт — таних тэмдэггүй). */
  datasetSha256: string | null;
}

export type DatasetCompareStatus =
  /** Хоёр талд байгаа баримт бүрийн sha таарна. */
  | 'match'
  /** Ядаж нэг баримтын sha зөрнө → ЭРХ БҮХИЙ хариулт ӨГЧ БОЛОХГҮЙ. */
  | 'mismatch'
  /** Тулгах баримт байхгүй (бүртгэл хоосон, эсвэл сан хоосон) — зөрчил БИШ, мэдэхгүй. */
  | 'not_comparable'
  /** Нэг тал sha мэдээлээгүй (хуучин шингээлт) — мэдэхгүй, «таарна» гэж ХУДЛАА хэлэхгүй. */
  | 'unknown';

export interface DatasetComparison {
  status: DatasetCompareStatus;
  /** Хоёр талд байгаа, sha ЗӨРСӨН баримтууд. */
  mismatched: { documentId: string; registrySha256: string; knowledgeSha256: string }[];
  /** Бүртгэлд байгаа ч ажилтны санд БАЙХГҮЙ (Worker тооцоолж чадах ч PC эшлэл өгөхгүй). */
  registryOnly: string[];
  /** Хоёр талд байгаа ч нэг нь sha-гүй. */
  shaMissing: string[];
  /** Хоёр талд байгаа, тулгасан баримтын тоо. */
  compared: number;
}

const SHA_RE = /^[0-9a-f]{64}$/;

function normSha(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return SHA_RE.test(s) ? s : null;
}

/**
 * Бүртгэл (Worker) ↔ мэдлэг (PC).  Санд байгаа ч бүртгэлд байхгүй баримт нь ЗӨРЧИЛ БИШ —
 * бүртгэл зөвхөн тооцоолуурын дүрэмтэй баримтуудыг агуулна.
 */
export function compareDatasetIdentity(
  registry: readonly NormDocumentIdentity[],
  knowledge: readonly NormDocumentIdentity[],
): DatasetComparison {
  const local = new Map(knowledge.map((d) => [d.documentId, normSha(d.datasetSha256)]));
  const out: DatasetComparison = { status: 'not_comparable', mismatched: [], registryOnly: [], shaMissing: [], compared: 0 };
  for (const r of registry) {
    if (!local.has(r.documentId)) {
      out.registryOnly.push(r.documentId);
      continue;
    }
    const rs = normSha(r.datasetSha256);
    const ks = local.get(r.documentId) ?? null;
    if (rs === null || ks === null) {
      out.shaMissing.push(r.documentId);
      continue;
    }
    out.compared += 1;
    if (rs !== ks) out.mismatched.push({ documentId: r.documentId, registrySha256: rs, knowledgeSha256: ks });
  }
  if (out.mismatched.length > 0) out.status = 'mismatch';
  else if (out.shaMissing.length > 0) out.status = 'unknown';
  else if (out.compared > 0) out.status = 'match';
  else out.status = 'not_comparable';
  return out;
}

/**
 * Жагсаалтаас ДЕТЕРМИНИСТ хурууны хээ — `kf1:<16 hex>` (мэдлэг), `rf1:<16 hex>` (бүртгэл).
 * SHA-256 хэшлэгч нь орчноос ирнэ (Node `crypto`, Worker `SubtleCrypto`, хөтөч) — энд ХАМААРАЛГҮЙ.
 *
 * ⚠️ Хэш нь `documentId=sha256` мөрүүдийг ЭРЭМБЭЛЖ залгасан текст дээр — тал бүр ИЖИЛ баримт, ИЖИЛ sha
 *    өгвөл хурууны хээ ИЖИЛ; sha-гүй баримт `documentId=-` гэж орно (хуучин шингээлт ялгарна).
 */
export function identityLines(docs: readonly NormDocumentIdentity[]): string {
  return [...docs]
    .map((d) => `${d.documentId}=${normSha(d.datasetSha256) ?? '-'}`)
    .sort()
    .join('\n');
}

export function fingerprintFromHex(prefix: 'kf1' | 'rf1', sha256Hex: string): string {
  return `${prefix}:${sha256Hex.toLowerCase().slice(0, 16)}`;
}

/** Wire хэлбэр — backend `GET /api/mgl-ai/norm-registry` ба runtime `/norm/info` хоёулаа энэ хэлбэрээр баримт өгнө. */
export interface NormIdentityWire {
  document_id: string;
  document_code: string | null;
  dataset_id: string | null;
  dataset_version: string | null;
  dataset_sha256: string | null;
}

export function fromWire(rows: readonly NormIdentityWire[]): NormDocumentIdentity[] {
  return rows.map((r) => ({
    documentId: String(r.document_id),
    documentCode: r.document_code ?? null,
    datasetId: r.dataset_id ?? null,
    datasetVersion: r.dataset_version ?? null,
    datasetSha256: r.dataset_sha256 ?? null,
  }));
}

export function toWire(docs: readonly NormDocumentIdentity[]): NormIdentityWire[] {
  return docs.map((d) => ({
    document_id: d.documentId,
    document_code: d.documentCode,
    dataset_id: d.datasetId,
    dataset_version: d.datasetVersion,
    dataset_sha256: d.datasetSha256,
  }));
}
