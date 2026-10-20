/**
 * ХУВИЛБАРЫН ЗӨРҮҮ (Amendment A) — локал /norm-ийн эшлэл ба Worker-ийн бүртгэл
 * НЭГ баримтыг төлөөлж байвал багцын SHA-256-г тулгана.
 *
 *   ижил      → локал нотолгоог ТЭР баримтад хязгаарлан хэрэглэж болно
 *   зөрсөн    → NORM_DATA_VERSION_MISMATCH: эрх бүхий үр дүнг БУУРУУЛНА,
 *               локал нотолгоог хэрэглэхгүй (A хувилбарын тооцоо + B хувилбарын
 *               эшлэл ХЭЗЭЭ Ч хамт явахгүй)
 *   тулгах боломжгүй (хуучин шингээлт, SHA алга) → анхааруулга, бууруулахгүй
 */
import type { TrustedNormResult } from './types';
import { fold } from './text';
import { canon } from './state';

export type DriftStatus = 'match' | 'mismatch' | 'unknown' | 'different_document' | 'not_applicable';

export interface DriftCheck {
  status: DriftStatus;
  registrySha: string | null;
  localSha: string | null;
  localVersion: string | null;
  documentCode: string | null;
}

export function checkDrift(
  result: TrustedNormResult | null,
  local: { documentCode: string | null; datasetSha256: string | null; datasetVersion: string | null } | null,
): DriftCheck {
  if (result === null || result.documentCode === null || local === null || local.documentCode === null) {
    return { status: 'not_applicable', registrySha: result?.datasetSha256 ?? null, localSha: local?.datasetSha256 ?? null, localVersion: local?.datasetVersion ?? null, documentCode: result?.documentCode ?? null };
  }
  if (fold(result.documentCode) !== fold(local.documentCode)) {
    return { status: 'different_document', registrySha: result.datasetSha256, localSha: local.datasetSha256, localVersion: local.datasetVersion, documentCode: result.documentCode };
  }
  if (result.datasetSha256 === null || local.datasetSha256 === null) {
    return { status: 'unknown', registrySha: result.datasetSha256, localSha: local.datasetSha256, localVersion: local.datasetVersion, documentCode: result.documentCode };
  }
  return {
    status: result.datasetSha256 === local.datasetSha256 ? 'match' : 'mismatch',
    registrySha: result.datasetSha256,
    localSha: local.datasetSha256,
    localVersion: local.datasetVersion,
    documentCode: result.documentCode,
  };
}

/** Зөрүү илэрвэл үр дүнг БУУРУУЛСАН хуулбар (эх объектыг хөндөхгүй). */
export function applyDrift(result: TrustedNormResult, drift: DriftCheck): TrustedNormResult {
  if (drift.status !== 'mismatch') return result;
  const warn = `NORM_DATA_VERSION_MISMATCH: registry ${drift.registrySha?.slice(0, 12)}… ≠ local ${drift.localSha?.slice(0, 12)}…`;
  return {
    ...result,
    verification: 'data_version_mismatch',
    authoritative: false,
    warnings: [...result.warnings, warn],
    textMn: `${canon('data_version_mismatch', 'mn-Cyrl')} Урьдчилсан үр дүн: ${result.textMn}`,
    textEn: `${canon('data_version_mismatch', 'en')} Preliminary result: ${result.textEn || result.textMn}`,
    allowedCategories: [],
  };
}
