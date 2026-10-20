import { apiFetch } from '@/shared/api/client';

/**
 * Захиалагчийн порталын API давхарга (`/api/client/*`).
 *
 * ⚠️ Материалын файлыг ХЭЗЭЭ Ч `/media/...`-аар авахгүй — тэр нь нэвтрэлтгүй
 *    нийтийн зам.  Бүх татах холбоос `/api/client-files/*` руу заана, тэр нь
 *    эрх шалгаад хувийн R2-оос дамжуулдаг.
 */

export interface ClientPortalProject {
  id: number;
  name: string;
  display_title: string | null;
  location: string | null;
  status: string | null;
  key_image_url: string | null;
  material_count: number;
  last_event_at: string | null;
  access_level: 'viewer' | 'contributor' | 'approver';
}

export interface ClientMaterialFile {
  id: number;
  name: string;
  size: number | null;
  url: string;
}

export interface ClientMaterial {
  id: number;
  kind: string;
  ref_id: number;
  title_mn: string;
  note: string | null;
  published_at: string;
  files: ClientMaterialFile[];
  download_url: string | null;
}

export interface ClientEvent {
  id: number;
  project_id: number;
  kind: string;
  ref_id: number | null;
  title_mn: string;
  created_at: string;
}

export interface SubmissionTemplateField {
  key: string;
  label_mn: string;
  type: 'text' | 'textarea' | 'select' | 'date';
  required?: boolean;
  choices?: string[];
}

export interface SubmissionTemplate {
  id: number;
  code: string;
  name_mn: string;
  description_mn: string | null;
  filename_pattern: string;
  allowed_ext: string | null;
  fields: SubmissionTemplateField[];
}

export interface ClientSubmission {
  id: number;
  ref_no: string;
  title: string;
  status: 'submitted' | 'accepted' | 'rejected';
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  template_name: string;
  file_count: number;
}

export interface SubmissionFileInput {
  key: string;
  name: string;
  size: number | null;
  type: string | null;
}

export function previewNames(input: {
  project_id: number;
  template_id: number;
  discipline?: string | null;
  rev?: string | null;
  file_names: string[];
}): Promise<{ names: string[] }> {
  return apiFetch('/client/preview-name', { method: 'POST', data: input });
}

export function submitMaterial(input: {
  project_id: number;
  template_id: number;
  title?: string;
  discipline?: string | null;
  rev?: string | null;
  fields: Record<string, unknown>;
  files: SubmissionFileInput[];
}): Promise<{ submission: { id: number; ref_no: string }; files: string[] }> {
  return apiFetch('/client/submissions', { method: 'POST', data: input });
}

export function fetchEventsSince(
  projectId: number,
  sinceId: number,
): Promise<{ events: ClientEvent[]; last_id: number }> {
  return apiFetch(`/client/projects/${projectId}/events?since_id=${sinceId}`);
}
