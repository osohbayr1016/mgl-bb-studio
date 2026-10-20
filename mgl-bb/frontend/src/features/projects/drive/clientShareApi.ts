/**
 * Захиалагчид төслийн Drive баримт нээх — АЖИЛТНЫ талын API (миграц 0327,
 * `backend/src/routes/clientDriveAdmin.ts`).  Захиалагчийн өөрийн уншилт нь
 * `api.ts`-ийн ижил функцууд `scope = 'client'`-ээр (`driveBase`).
 */
import { apiFetch } from '@/shared/api/client';

export interface ClientDriveShare {
  id: number;
  project_id: number;
  org_id: number;
  org_name: string;
  drive_item_id: string;
  item_kind: 'folder' | 'file';
  item_name: string;
  item_mime: string | null;
  note: string | null;
  shared_by: number | null;
  shared_by_name: string | null;
  shared_at: string;
  revoked_by: number | null;
  revoked_by_name: string | null;
  revoked_at: string | null;
  last_access_at: string | null;
  access_count: number;
}

export interface ClientDriveOrg {
  org_id: number;
  org_name: string;
  access_level: 'viewer' | 'contributor' | 'approver';
  contact_count: number;
}

export interface ClientDriveSharesResponse {
  linked: boolean;
  folder_name: string | null;
  /** Энэ төсөлд ИДЭВХТЭЙ эрхтэй байгууллагууд — зөвхөн тэдэнд нээж болно. */
  orgs: ClientDriveOrg[];
  shares: ClientDriveShare[];
}

export interface ClientDriveAccessLogRow {
  id: number;
  org_id: number | null;
  org_name: string | null;
  user_id: number;
  user_name: string | null;
  drive_item_id: string;
  item_name: string;
  action: 'view' | 'download';
  created_at: string;
}

export const clientSharesKey = (projectId: number) => ['client-drive-shares', projectId] as const;
export const clientShareLogKey = (projectId: number) => ['client-drive-shares', projectId, 'log'] as const;

export function fetchClientShares(projectId: number, includeRevoked = false): Promise<ClientDriveSharesResponse> {
  return apiFetch(`/client-admin/projects/${projectId}/drive-shares${includeRevoked ? '?include_revoked=1' : ''}`);
}

export function createClientShare(
  projectId: number,
  data: { org_ids: number[]; item_id: string; note?: string | null },
): Promise<{ ok: true; item: { id: string; name: string; kind: 'folder' | 'file' }; org_ids: number[] }> {
  return apiFetch(`/client-admin/projects/${projectId}/drive-shares`, { method: 'POST', data });
}

export function revokeClientShare(projectId: number, shareId: number): Promise<{ ok: true }> {
  return apiFetch(`/client-admin/projects/${projectId}/drive-shares/${shareId}`, { method: 'DELETE' });
}

export function fetchClientShareLog(projectId: number, limit = 50): Promise<{ log: ClientDriveAccessLogRow[] }> {
  return apiFetch(`/client-admin/projects/${projectId}/drive-shares/log?limit=${limit}`);
}

/* ---- Байгууллага / хүн үүсгэх (routes/clientAdmin.ts-ийн одоо байгаа замууд) ---- */

export interface ClientOrgRow {
  id: number;
  name: string;
  status: string;
  contact_count: number;
  project_count: number;
}

export function fetchClientOrgs(): Promise<{ orgs: ClientOrgRow[] }> {
  return apiFetch('/client-admin/orgs');
}

export function createClientOrg(name: string): Promise<{ id: number }> {
  return apiFetch('/client-admin/orgs', { method: 'POST', data: { name } });
}

export function grantProjectAccess(
  projectId: number,
  orgId: number,
  level: 'viewer' | 'contributor' | 'approver' = 'viewer',
): Promise<{ ok: true }> {
  return apiFetch(`/client-admin/projects/${projectId}/access`, {
    method: 'POST',
    data: { org_id: orgId, access_level: level },
  });
}

export interface ContactInviteResult {
  user_id: number;
  invite_url: string | null;
  email_sent: boolean;
  email_error: string | null;
}

export function inviteContact(
  orgId: number,
  data: { full_name: string; email: string; send_email: boolean; project_id?: number },
): Promise<ContactInviteResult> {
  return apiFetch(`/client-admin/orgs/${orgId}/contacts`, { method: 'POST', data });
}
