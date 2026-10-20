import { apiFetch } from '@/shared/api/client';
import type { ClientContact } from '@/shared/types';
import type { EmailAccount } from '@/features/email/types/email';
import type { CorrespondenceDocType } from '@/features/projects/components/correspondenceConstants';

export interface SendOptionsResponse {
  accounts: EmailAccount[];
  client_contacts: ClientContact[];
  can_send: boolean;
}

export interface AliasListResponse {
  aliases: string[];
}

export interface SendCorrespondencePayload {
  account_id: number;
  from?: string;
  to: string;
  cc?: string;
  subject: string;
  body_text: string;
  doc_type: CorrespondenceDocType;
  log_date: string;
  ref_no?: string | null;
  signature_url?: string | null;
  attachments?: Array<{ r2_key: string; filename: string; mime_type: string }>;
  /** RFI/CR: захиалагчид порталд гарын үсэг зуруулах хүсэлтийг илгээлттэй хамт тавина. */
  request_signature?: boolean;
}

export function getCorrespondenceSendOptions(projectId: number) {
  return apiFetch<SendOptionsResponse>(`/correspondence/projects/${projectId}/send-options`);
}

export function getCorrespondenceAliases(accountId: number) {
  return apiFetch<AliasListResponse>(`/correspondence/aliases?account_id=${accountId}`);
}

export function sendCorrespondenceEmail(projectId: number, body: SendCorrespondencePayload) {
  return apiFetch<{
    ok: true;
    correspondence_id: number | null;
    message_id: number | null;
    signature_requested?: boolean;
    signature_error?: string | null;
  }>(
    `/correspondence/projects/${projectId}/send`,
    { method: 'POST', data: body },
  );
}
