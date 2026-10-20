import { apiFetch, apiFetchBlob, downloadPdf } from '@/shared/api/client';
import type { CorrespondenceEntry } from '@/shared/types';

/**
 * RFI/CR захиалагчийн гарын үсэг — `/api/correspondence/:id/*`
 * (backend `routes/correspondenceSignature.ts`).
 */

export interface CorrespondenceEntryDetail {
  entry: CorrespondenceEntry & { project_name: string | null };
  /** Захиалагчийн зурсан гарын үсэг — PNG data URL (signed үед л). */
  client_signature_data_url: string | null;
  can_sign: boolean;
  can_write: boolean;
}

export function getCorrespondenceEntry(id: number) {
  return apiFetch<CorrespondenceEntryDetail>(`/correspondence/${id}`);
}

/** Ажилтан: захиалагчид гарын үсэг зуруулахаар хүсэлт тавина (none → pending). */
export function requestCorrespondenceSignature(id: number) {
  return apiFetch<{ entry: CorrespondenceEntry }>(`/correspondence/${id}/signature-request`, {
    method: 'POST',
  });
}

/** Ажилтан: хүлээгдэж буй хүсэлтийг цуцална (pending → none). */
export function cancelCorrespondenceSignature(id: number) {
  return apiFetch<{ entry: CorrespondenceEntry }>(`/correspondence/${id}/signature-request`, {
    method: 'DELETE',
  });
}

/** Захиалагч: зурсан гарын үсгээ баталгаажуулна (pending → signed). */
export function signCorrespondence(id: number, signatureDataUrl: string) {
  return apiFetch<{ entry: CorrespondenceEntry }>(`/correspondence/${id}/sign`, {
    method: 'POST',
    data: { signature_data_url: signatureDataUrl },
  });
}

/** Захиалагчийн гарын үсгийн зураг (хувийн bucket — Authorization толгойтой fetch). */
export function fetchClientSignatureBlob(id: number) {
  return apiFetchBlob(`/correspondence/${id}/client-signature`);
}

export function downloadCorrespondencePdf(entry: Pick<CorrespondenceEntry, 'id' | 'ref_no' | 'doc_type'>) {
  const fallback = `${(entry.ref_no ?? `${(entry.doc_type ?? 'doc').toUpperCase()}-${entry.id}`).replace(/[\\/]/g, '-')}.pdf`;
  return downloadPdf(`/correspondence/${entry.id}/pdf`, fallback);
}
