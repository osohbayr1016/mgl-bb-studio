/**
 * Зохиогчийн хяналт — хуучин тайлан нөхөж бүртгэх (`/api/author-supervision/backfill/*`,
 * миграц 0332).  Сервер тал: `backend/src/routes/asrBackfill.ts`.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation, useApiQuery } from '@/shared/api/useApi';

const BASE = '/author-supervision/backfill';

export const backfillKeys = {
  overview: ['asr', 'backfill', 'overview'] as const,
  main: (mainId: number, projectId: number | null) => ['asr', 'backfill', 'main', mainId, projectId ?? 0] as const,
};

export interface BackfillMember {
  id: number;
  name: string;
  category: string | null;
  status: string | null;
  asr_only?: number | null;
  report_count: number;
}

export interface BackfillMainSummary {
  id: number;
  code: string | null;
  name: string;
  folder_id: string | null;
  candidate_count: number;
  unrecognized_count: number;
  imported_count: number;
  ignored_count: number;
  members: BackfillMember[];
}

export interface BackfillOverview {
  mains: BackfillMainSummary[];
  drive_configured: boolean;
}

export interface BackfillFile {
  file_id: string;
  file_name: string;
  mime_type: string | null;
  modified_at: string | null;
  view_url: string;
  is_docx: boolean;
}

export interface ExistingReportLite {
  id: number;
  doc_no: string | null;
  report_date: string;
  team_codes: string | null;
}

export interface BackfillCandidate {
  /** `date|team|seq` — мөрийн тогтвортой түлхүүр. */
  key: string;
  date: string;
  team_code: string | null;
  seq: number | null;
  legacy_doc_no: string | null;
  project_tag: string | null;
  files: BackfillFile[];
  has_docx: boolean;
  duplicate_of: ExistingReportLite | null;
}

export interface BackfillImportedFile extends BackfillFile {
  report_id: number | null;
  report: { doc_no: string | null; report_date: string; project_id: number } | null;
}

export interface BackfillTeam {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
}

export interface BackfillMainDetail {
  main: { id: number; code: string | null; name: string; folder_id: string | null };
  members: BackfillMember[];
  suggested_project_id: number | null;
  target_project_id: number | null;
  existing_reports: ExistingReportLite[];
  candidates: BackfillCandidate[];
  unrecognized: BackfillFile[];
  imported: BackfillImportedFile[];
  ignored: BackfillFile[];
  teams: BackfillTeam[];
  drive_configured: boolean;
  ledger_indexed: boolean;
}

/** `backend/src/lib/asrLegacyDocx.ts` `ParsedAsrDoc`-ийн ихэр. */
export interface ParsedAsrDoc {
  project_name: string | null;
  report_date: string | null;
  shifr: string | null;
  doc_types: string[];
  description: string | null;
  visited_teams: string[];
  work_report_teams: string[];
  work_note: string | null;
  checked_by: string | null;
  sig_arch_name: string | null;
  sig_arch_date: string | null;
  sig_site_name: string | null;
  sig_site_date: string | null;
  header_doc_no: string | null;
  header_date: string | null;
  photo_rids: string[];
}

export interface ImportItem {
  key?: string;
  file_ids?: string[];
  report_date: string;
  team_codes: string[];
  work_notes?: Record<string, string | null>;
  work_note?: string | null;
  legacy_doc_no?: string | null;
  legacy_author_name?: string | null;
  /** Тайланг бичсэн ажилтан; өгөөгүй бол сервер нэрээр нь таньж, эс бөгөөс импортлогч. */
  author_user_id?: number | null;
  description?: string | null;
  shifr?: string | null;
  doc_types?: string[];
  import_photos?: boolean;
  force_duplicate?: boolean;
}

export type ImportResult =
  | { key: string | null; ok: true; report_id: number; photos: number; author_id: number; author_matched: boolean }
  | { key: string | null; ok: false; reason: string; duplicate_of?: ExistingReportLite | null };

export function useBackfillOverview() {
  return useApiQuery<BackfillOverview>(backfillKeys.overview, `${BASE}/overview`);
}

export function useBackfillMain(mainId: number | null, projectId: number | null) {
  const q = projectId != null ? `?project_id=${projectId}` : '';
  return useApiQuery<BackfillMainDetail>(
    backfillKeys.main(mainId ?? 0, projectId),
    `${BASE}/main/${mainId}${q}`,
    { enabled: mainId != null },
  );
}

export function useBackfillInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['asr'] });
}

export function useBackfillParse(mainId: number) {
  return useApiMutation<{ parsed: ParsedAsrDoc | null; photo_count?: number; error?: string }, { file_id: string }>(
    `${BASE}/main/${mainId}/parse`,
    { method: 'POST' },
  );
}

export function useBackfillImport(mainId: number) {
  return useApiMutation<
    { results: ImportResult[]; imported: number },
    { project_id: number; items: ImportItem[] }
  >(`${BASE}/main/${mainId}/import`, { method: 'POST' });
}

export function useBackfillIgnore(mainId: number) {
  return useApiMutation<
    { ok: true; changed: number; skipped: number },
    { file_ids: string[]; ignore?: boolean; note?: string }
  >(`${BASE}/main/${mainId}/ignore`, { method: 'POST' });
}

export function useBackfillCreateTarget(mainId: number) {
  return useApiMutation<{ project_id: number; members: BackfillMember[] }, { name?: string; shifr?: string }>(
    `${BASE}/main/${mainId}/target`,
    { method: 'POST' },
  );
}

/** Импортын алгасах шалтгаан → i18n түлхүүр. */
export const IMPORT_REASON_KEY: Record<string, string> = {
  DUPLICATE: 'asrBackfill.reasonDuplicate',
  ALREADY_IMPORTED: 'asrBackfill.reasonAlreadyImported',
  IGNORED: 'asrBackfill.reasonIgnored',
  FILE_NOT_FOUND: 'asrBackfill.reasonFileNotFound',
  BAD_DATE: 'asrBackfill.reasonBadDate',
  NO_TEAM: 'asrBackfill.reasonNoTeam',
  UNKNOWN_TEAM: 'asrBackfill.reasonNoTeam',
  NOT_LINKED: 'asrBackfill.reasonNotLinked',
  INSERT_FAILED: 'asrBackfill.reasonFailed',
};
