/**
 * `/api/internal-rules` — Дотоод журам: унших, гарын үсгээр баталгаажуулах.
 *
 * Backend: `backend/src/routes/internalRules.ts` + миграц `0330_internal_rules.sql`.
 * Ажилтан ЗӨВХӨН нийтлэгдсэн ХУВИЛБАРЫГ уншина; гарын үсэг нь (version_id ×
 * user) нэг мөр — бичвэр шинээр нийтлэгдвэл дахин зурна.
 *
 * Гарын үсгийн эх нь профайлын `users.signature_url` (эзний шийдвэр 2026-09-21).
 * Гарын үсгийн зураг нь хувийн bucket-д тул `/media/` биш — `image_url` нь
 * authed API зам (`apiFetchBlob`-оор татна, `SignatureImage`).
 */
import { apiFetch, apiFetchBlob } from '@/shared/api/client';

export const BASE = '/internal-rules';

export type RuleStatus = 'draft' | 'published' | 'archived';

/**
 * Биеийн формат (миграц 0347).  `html` = «Мэдээ, зарлал»-тай ижил rich-text
 * засварлагч (сервер цэвэрлэнэ); `markdown` = 0330-ийн хуучин textarea-ийн мөр.
 * Талбарын нэр `body_md` түүхэн — html үед HTML агуулна.
 */
export type RuleBodyFormat = 'markdown' | 'html';

/** Ажилтанд харагдах хавсралт (R2 түлхүүргүй). */
export interface RuleAttachmentInfo {
  id: string;
  name: string;
  size: number;
  content_type: string;
  sha256: string;
}

/** Админы хавсралт — хадгалахдаа `key`-ээр нь буцааж илгээнэ. */
export interface AdminRuleAttachment extends RuleAttachmentInfo {
  key: string;
}

/** Ажилтны жагсаалтын мөр — одоогийн хувилбар + миний гарын үсэг. */
export interface RuleListItem {
  id: number;
  sort_order: number;
  version_id: number;
  version: number;
  title_mn: string;
  title_en: string | null;
  published_at: string;
  content_hash: string;
  body_length: number;
  body_format: RuleBodyFormat;
  attachment_count: number;
  signature_id: number | null;
  signed_at: string | null;
}

export interface RuleSignature {
  id: number;
  rule_id: number;
  version_id: number;
  user_id: number;
  content_hash: string;
  signature_sha256: string;
  signature_source: string;
  signed_at: string;
  /** API зам (`/internal-rules/signatures/:id/image`) — authed, `/media/` биш. */
  image_url: string;
}

export interface RuleDetail {
  rule: {
    id: number;
    version_id: number;
    version: number;
    title_mn: string;
    title_en: string | null;
    body_md: string;
    body_format: RuleBodyFormat;
    attachments: RuleAttachmentInfo[];
    content_hash: string;
    published_at: string;
  };
  signature: RuleSignature | null;
  /** Өмнөх хувилбарт зурсан байсан бол — «шинэ хувилбар, дахин зурна». */
  previous: { signed_at: string; version: number } | null;
  profile_signature_url: string | null;
}

/** Админы мөр — ажлын хувь + одоогийн хувилбарын мета + тоолуур. */
export interface AdminRule {
  id: number;
  title_mn: string;
  title_en: string | null;
  body_md: string;
  body_format: RuleBodyFormat;
  attachments: AdminRuleAttachment[];
  status: RuleStatus;
  current_version_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  current_version: number | null;
  current_hash: string | null;
  published_at: string | null;
  signed_count: number;
  roster_count: number;
  total_signatures: number;
  working_hash: string;
  has_unpublished_changes: boolean;
}

export interface RuleInput {
  title_mn: string;
  title_en: string | null;
  body_md: string;
  body_format: RuleBodyFormat;
  sort_order: number;
  /** Хавсралт — сервер хэмжээ/хэшийг R2-ийн метагаас дүүргэнэ. */
  attachments: Array<{ key: string; name: string }>;
}

export interface RosterRow {
  user_id: number;
  full_name: string | null;
  username: string | null;
  role: string | null;
  team_code: string | null;
  signature_id: number | null;
  signed_at: string | null;
  /** Энэ хувилбарт зураагүй ч журмын өмнөх хувилбарт зурсан бол — хамгийн сүүлийнх. */
  previous?: { version: number; signed_at: string } | null;
}

export interface RuleSignaturesReport {
  version: { id: number; version: number; published_at: string; content_hash: string } | null;
  versions: Array<{ id: number; version: number; published_at: string; signed_count: number }>;
  /** Идэвхтэй roster дээрх тоолуур (`rows`-той ижил популяци; `extra` орохгүй). */
  summary: { signed: number; pending: number; total: number };
  rows: RosterRow[];
  /** Идэвхгүй болсон / roster-оос гарсан ч зурсан хүмүүс. */
  extra: RosterRow[];
}

export const ruleKeys = {
  list: ['/internal-rules'] as const,
  detail: (id: number) => ['/internal-rules', id] as const,
  admin: ['/internal-rules/admin'] as const,
  signatures: (id: number, versionId: number | null) =>
    ['/internal-rules', id, 'signatures', versionId] as const,
  image: (sigId: number) => ['/internal-rules/signatures', sigId] as const,
};

export const fetchRules = () => apiFetch<{ rules: RuleListItem[]; pending_count: number }>(BASE);
export const fetchRule = (id: number) => apiFetch<RuleDetail>(`${BASE}/${id}`);

export const signRule = (id: number, versionId: number, contentHash: string) =>
  apiFetch<{ signature: RuleSignature }>(`${BASE}/${id}/sign`, {
    method: 'POST',
    data: { confirmed: true, version_id: versionId, content_hash: contentHash },
  });

export const fetchSignatureImage = (sigId: number) =>
  apiFetchBlob(`${BASE}/signatures/${sigId}/image`);

/**
 * Хавсралт татах — ажилтан одоогийн хувилбарынхыг, admin ажлын хувь + бүх
 * хувилбарынхыг.  Хувийн bucket тул `/media/` биш; blob-оор авч хөтөч дээр
 * харуулна (PDF-ийг заавал `blob:` iframe — COEP, `AttachmentPreviews.tsx`).
 */
export const fetchRuleFile = (ruleId: number, fileId: string) =>
  apiFetchBlob(`${BASE}/${ruleId}/files/${fileId}`);

/** Хавсралт байршуулах (admin) — хувийн bucket; хадгалах хүртэл журамд холбогдохгүй. */
export async function uploadRuleFile(file: File): Promise<AdminRuleAttachment> {
  const fd = new FormData();
  fd.append('file', file);
  // `apiFetch` зөвхөн JSON илгээдэг; `apiFetchBlob` FormData дэмжиж, алдааг
  // `ApiError` болгодог — хариуны JSON-ийг өөрсдөө задална.
  const blob = await apiFetchBlob(`${BASE}/files`, { method: 'POST', data: fd });
  return (JSON.parse(await blob.text()) as { attachment: AdminRuleAttachment }).attachment;
}

/* ---- admin ---- */
export const fetchRulesAdmin = () => apiFetch<{ rules: AdminRule[] }>(`${BASE}/admin`);
export const createRule = (input: RuleInput) =>
  apiFetch<{ rule: AdminRule }>(BASE, { method: 'POST', data: input });
export const updateRule = (id: number, input: Partial<RuleInput>) =>
  apiFetch<{ rule: AdminRule }>(`${BASE}/${id}`, { method: 'PUT', data: input });
export const publishRule = (id: number) =>
  apiFetch<{ rule: AdminRule; version: { version: number } | null; reused?: boolean }>(
    `${BASE}/${id}/publish`,
    { method: 'POST' },
  );
export const archiveRule = (id: number) =>
  apiFetch<{ rule: AdminRule }>(`${BASE}/${id}/archive`, { method: 'POST' });
export const unarchiveRule = (id: number) =>
  apiFetch<{ rule: AdminRule }>(`${BASE}/${id}/unarchive`, { method: 'POST' });
export const deleteRule = (id: number) => apiFetch<{ ok: true }>(`${BASE}/${id}`, { method: 'DELETE' });
export const fetchRuleSignatures = (id: number, versionId: number | null) =>
  apiFetch<RuleSignaturesReport>(
    `${BASE}/${id}/signatures${versionId ? `?version_id=${versionId}` : ''}`,
  );
