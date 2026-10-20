/**
 * Баримтын гарын үсгийн API — `backend/src/routes/driveSigning.ts`.
 * Замууд нь «Баримт бичиг»-ийнхтэй ижил угтвартай (`driveBase`).
 */
import { apiFetch, apiFetchBlob } from '@/shared/api/client';
import { driveBase } from '../api';
import type { DriveScope } from '../types';
import type { CreatedSignLink, FileSignStatus, PendingSignatures, SignLinksState, SigningState } from './types';

export const signingKey = (scope: DriveScope, id: number, fileId: string) =>
  ['project-drive', scope, id, 'signing', fileId] as const;
export const signingStatusesKey = (scope: DriveScope, id: number, ids: readonly string[]) =>
  ['project-drive', scope, id, 'signing-statuses', ids.join(',')] as const;
export const pendingSignaturesKey = ['drive-signing', 'pending'] as const;
export const signLinksKey = (scope: DriveScope, id: number, fileId: string) =>
  ['project-drive', scope, id, 'signing-links', fileId] as const;

const filePath = (scope: DriveScope, id: number, fileId: string) =>
  `${driveBase(scope, id)}/drive/files/${encodeURIComponent(fileId)}/signing`;

export function fetchSigning(scope: DriveScope, id: number, fileId: string): Promise<SigningState> {
  return apiFetch<SigningState>(filePath(scope, id, fileId), { timeoutMs: 45_000 });
}

export function signSlot(
  scope: DriveScope,
  id: number,
  fileId: string,
  body: { slot_key: string; base_modified_time: string; request_approval: boolean; confirm_name_mismatch?: boolean },
): Promise<SigningState> {
  return apiFetch<SigningState>(`${filePath(scope, id, fileId)}/sign`, { method: 'POST', data: body, timeoutMs: 60_000 });
}

export function approveDocument(
  scope: DriveScope,
  id: number,
  fileId: string,
  body: { base_modified_time: string; slot_key?: string },
): Promise<SigningState> {
  return apiFetch<SigningState>(`${filePath(scope, id, fileId)}/approve`, { method: 'POST', data: body, timeoutMs: 60_000 });
}

export function requestApproval(scope: DriveScope, id: number, fileId: string, note?: string): Promise<SigningState> {
  return apiFetch<SigningState>(`${filePath(scope, id, fileId)}/request`, { method: 'POST', data: { note }, timeoutMs: 45_000 });
}

export function returnDocument(scope: DriveScope, id: number, fileId: string, note: string): Promise<SigningState> {
  return apiFetch<SigningState>(`${filePath(scope, id, fileId)}/return`, { method: 'POST', data: { note }, timeoutMs: 45_000 });
}

export function cancelRequest(scope: DriveScope, id: number, fileId: string): Promise<SigningState> {
  return apiFetch<SigningState>(`${filePath(scope, id, fileId)}/cancel`, { method: 'POST', data: {}, timeoutMs: 45_000 });
}

export function askSignature(scope: DriveScope, id: number, fileId: string, slotKey: string): Promise<SigningState> {
  return apiFetch<SigningState>(`${filePath(scope, id, fileId)}/ask`, { method: 'POST', data: { slot_key: slotKey }, timeoutMs: 45_000 });
}

export function fetchSigningStatuses(
  scope: DriveScope,
  id: number,
  fileIds: readonly string[],
): Promise<{ statuses: Record<string, FileSignStatus> }> {
  return apiFetch(`${driveBase(scope, id)}/drive/signing/statuses`, { method: 'POST', data: { file_ids: fileIds } });
}

/** Гаднын гарын үсгийн link-үүд + бодит цагийн «хувилбар» (зөвхөн D1 — 3 сек тутам асуухад хямд). */
export function fetchSignLinks(scope: DriveScope, id: number, fileId: string): Promise<SignLinksState> {
  return apiFetch<SignLinksState>(`${filePath(scope, id, fileId)}/links`, { timeoutMs: 20_000 });
}

export function createSignLink(
  scope: DriveScope,
  id: number,
  fileId: string,
  body: {
    /** Мөрийн түлхүүр — эсвэл `add_client_row` («Захиалагч хүлээн авсан» мөр нэмээд тэр мөрөнд). */
    slot_key?: string;
    add_client_row?: boolean;
    base_modified_time?: string | null;
    role_label?: string;
    signer_name_hint?: string | null;
    expires_in_days?: number;
  },
): Promise<CreatedSignLink> {
  return apiFetch<CreatedSignLink>(`${filePath(scope, id, fileId)}/links`, { method: 'POST', data: body, timeoutMs: 45_000 });
}

export function revokeSignLink(scope: DriveScope, id: number, linkId: number): Promise<{ ok: true }> {
  return apiFetch(`${driveBase(scope, id)}/drive/signing/links/${linkId}`, { method: 'DELETE', timeoutMs: 20_000 });
}

/** Гарын үсэг зурагдсан агшны яг .docx (нотолгоо) — татах. */
export async function downloadSignedFile(scope: DriveScope, id: number, linkId: number, fileName: string): Promise<void> {
  const blob = await apiFetchBlob(`${driveBase(scope, id)}/drive/signing/links/${linkId}/signed-file`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Хэвлэх хуудас (`DrivePrintPage`) — шинэ табанд, хөтчийн хэвлэх цонх → принтер эсвэл «PDF болгох». */
export function drivePrintUrl(scope: DriveScope, id: number, fileId: string): string {
  return `/app/drive-print/${scope}/${id}/${encodeURIComponent(fileId)}`;
}

export function fetchPendingSignatures(): Promise<PendingSignatures> {
  return apiFetch<PendingSignatures>('/drive-signing/pending');
}
