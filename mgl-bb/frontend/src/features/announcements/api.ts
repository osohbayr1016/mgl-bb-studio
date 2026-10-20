/**
 * `/api/announcements` — Нийтийн мэдээлэл: системийн шинэчлэлт, компанийн
 * мэдээлэл, чухал дотоод зарлал.
 *
 * Backend: `backend/src/routes/announcements.ts` + миграц `0338_announcements.sql`.
 * Ажилтан нийтлэгдсэн, өөрт хамаарах (role × баг) мэдээллийг л харна;
 * баталгаа нь (announcement × ack_version × user) нэг мөр — админ «дахин
 * баталгаажуул» гэж шинэчилбэл ack_version +1, бүгд дахин.
 *
 * Гарын үсгийн эх нь профайлын `users.signature_url` (Дотоод журамтай ижил
 * зарчим).  Зурсан хуулбар хувийн bucket-д тул `/media/` биш — `image_url` нь
 * authed API зам (`apiFetchBlob`).
 */
import { apiFetch, apiFetchBlob } from '@/shared/api/client';
import type { UserRole } from '@/shared/types';

export const BASE = '/announcements';

export type AnnouncementKind = 'system_update' | 'company_info' | 'announcement';
export type AckMode = 'none' | 'confirm' | 'signature';
export type AnnouncementStatus = 'draft' | 'published' | 'archived';

export const ANNOUNCEMENT_KINDS: AnnouncementKind[] = ['system_update', 'company_info', 'announcement'];
export const ACK_MODES: AckMode[] = ['none', 'confirm', 'signature'];

export interface Audience {
  roles: UserRole[];
  team_ids: number[];
}

export const EVERYONE: Audience = { roles: [], team_ids: [] };

/** Ажилтны жагсаалтын мөр — толгой + миний баталгаа. */
export interface AnnouncementHead {
  id: number;
  title: string;
  kind: AnnouncementKind;
  ack_mode: AckMode;
  pinned: boolean;
  ack_version: number;
  content_hash: string | null;
  published_at: string | null;
  published_by_name: string | null;
  excerpt: string;
}

export interface AnnouncementListItem extends AnnouncementHead {
  my_ack: { id: number; acked_at: string; ack_kind: 'confirm' | 'signature' } | null;
  /** Admin хүрээнээс гадуур мэдээллийг ч харна — тэр үед `false`, баталгаа шаардахгүй. */
  in_audience: boolean;
}

export interface AnnouncementAck {
  id: number;
  announcement_id: number;
  ack_version: number;
  user_id: number;
  content_hash: string;
  ack_kind: 'confirm' | 'signature';
  acked_at: string;
  /** API зам (`/announcements/acks/:id/image`) — authed, `/media/` биш; чагтад null. */
  image_url: string | null;
}

export interface AnnouncementDetail {
  announcement: AnnouncementHead & { body_html: string; audience: Audience };
  my_ack: AnnouncementAck | null;
  /** Өмнөх хувилбарт баталгаажуулсан байсан бол — «шинэчлэгдсэн, дахин». */
  previous: { ack_version: number; acked_at: string } | null;
  in_audience: boolean;
  profile_signature_url: string | null;
}

/** Админы мөр — бүх төлөв + тоолуур. */
export interface AdminAnnouncement extends AnnouncementHead {
  body_html: string;
  status: AnnouncementStatus;
  audience: Audience;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  /** Одоогийн хувилбарыг баталгаажуулсан тоо. */
  acked_count: number;
  /** Бүх хувилбарын нийт баталгаа (устгах цонхны анхааруулга). */
  total_acks: number;
  /** Хүрээний идэвхтэй ажилтны тоо (ack_mode none бол 0). */
  roster_count: number;
}

export interface AnnouncementInput {
  title: string;
  body_html: string;
  kind: AnnouncementKind;
  ack_mode: AckMode;
  audience: Audience;
  pinned: boolean;
}

export interface RosterRow {
  user_id: number;
  full_name: string | null;
  username: string | null;
  role: string | null;
  team_code: string | null;
  ack_id: number | null;
  acked_at: string | null;
  ack_kind: 'confirm' | 'signature' | null;
  image_url: string | null;
  /** Энэ хувилбарт биш ч өмнөх хувилбарт баталгаажуулсан бол — хамгийн сүүлийнх. */
  previous: { ack_version: number; acked_at: string } | null;
}

export interface AcksReport {
  ack_mode: AckMode;
  ack_version: number;
  viewing_version: number;
  versions: Array<{ ack_version: number; acked_count: number; first_at: string; last_at: string }>;
  /** Хүрээний идэвхтэй ажилтан дээрх тоолуур (`rows`-той ижил популяци; `extra` орохгүй). */
  summary: { acked: number; pending: number; total: number };
  rows: RosterRow[];
  /** Идэвхгүй болсон / хүрээнээс гарсан ч баталгаажуулсан хүмүүс. */
  extra: RosterRow[];
}

export const announcementKeys = {
  list: ['/announcements'] as const,
  detail: (id: number) => ['/announcements', id] as const,
  admin: ['/announcements/admin'] as const,
  acks: (id: number, version: number | null) => ['/announcements', id, 'acks', version] as const,
  image: (ackId: number) => ['/announcements/acks', ackId] as const,
};

export const fetchAnnouncements = () =>
  apiFetch<{ announcements: AnnouncementListItem[]; pending_count: number }>(BASE);
export const fetchAnnouncement = (id: number) => apiFetch<AnnouncementDetail>(`${BASE}/${id}`);

export const ackAnnouncement = (id: number, ackVersion: number, contentHash: string) =>
  apiFetch<{ ack: AnnouncementAck }>(`${BASE}/${id}/ack`, {
    method: 'POST',
    data: { confirmed: true, ack_version: ackVersion, content_hash: contentHash },
  });

export const fetchAckImage = (ackId: number) => apiFetchBlob(`${BASE}/acks/${ackId}/image`);

/* ---- admin ---- */
export const fetchAnnouncementsAdmin = () => apiFetch<{ announcements: AdminAnnouncement[] }>(`${BASE}/admin`);
export const createAnnouncement = (input: AnnouncementInput) =>
  apiFetch<{ announcement: AdminAnnouncement }>(BASE, { method: 'POST', data: input });
export const updateAnnouncement = (id: number, input: Partial<AnnouncementInput> & { reack?: boolean }) =>
  apiFetch<{ announcement: AdminAnnouncement; reacked: boolean }>(`${BASE}/${id}`, { method: 'PUT', data: input });
export const publishAnnouncement = (id: number, notify = true) =>
  apiFetch<{ announcement: AdminAnnouncement; notified: number }>(`${BASE}/${id}/publish`, {
    method: 'POST',
    data: { notify },
  });
export const unpublishAnnouncement = (id: number) =>
  apiFetch<{ announcement: AdminAnnouncement }>(`${BASE}/${id}/unpublish`, { method: 'POST', data: {} });
export const archiveAnnouncement = (id: number) =>
  apiFetch<{ announcement: AdminAnnouncement }>(`${BASE}/${id}/archive`, { method: 'POST', data: {} });
export const unarchiveAnnouncement = (id: number) =>
  apiFetch<{ announcement: AdminAnnouncement }>(`${BASE}/${id}/unarchive`, { method: 'POST', data: {} });
export const remindAnnouncement = (id: number) =>
  apiFetch<{ reminded: number }>(`${BASE}/${id}/remind`, { method: 'POST', data: {} });
export const deleteAnnouncement = (id: number) => apiFetch<{ ok: true }>(`${BASE}/${id}`, { method: 'DELETE' });
export const fetchAnnouncementAcks = (id: number, version: number | null) =>
  apiFetch<AcksReport>(`${BASE}/${id}/acks${version ? `?ack_version=${version}` : ''}`);
