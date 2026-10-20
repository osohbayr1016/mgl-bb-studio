/**
 * ЗХ-ийн НЭГТГЭЛ ТАЙЛАН — `GET /author-supervision/summary`-ийн хариу.
 *
 * ⚠️ ИХЭР: `backend/src/lib/asrSummary.ts` (`AsrSummary`) + `routes/asrSummary.ts`.
 *    Тоо бүгд серверт бодогдоно — хэвлэх хуудас, Excel, Word гурвуулаа ЭНЭ
 *    объектоос уншина, дахин бодохгүй (гурван файл хоорондоо зөрөхгүй).
 */
import { ASR_REPORT_TYPES, type AsrRedBookStatus, type AsrReportType } from '@/features/projects/asr/types';
import { normalizeRange, presetRange, type AsrRange } from '../lib/asrRange';

export type AsrSummaryStatusFilter = 'counted' | 'approved';

/** Нэгтгэлийн шүүлт — URL / API-ийн параметр. */
export interface AsrSummaryParams {
  from: string | null;
  to: string | null;
  projectId: number | null;
  reportType: AsrReportType | null;
  status: AsrSummaryStatusFilter;
}

export type TypeCounts = Record<AsrReportType, number>;

export interface AsrSummaryEntry {
  id: number;
  project_id: number;
  project_name: string;
  shifr: string | null;
  contract_no: string | null;
  doc_no: string | null;
  report_date: string;
  report_type: AsrReportType;
  meeting_platform: string | null;
  meeting_place: string | null;
  meeting_start: string | null;
  meeting_end: string | null;
  meeting_parties: string | null;
  meeting_purpose: string | null;
  status: 'submitted' | 'approved';
  description: string | null;
  work_report: string | null;
  site_tasks: string | null;
  defects: string | null;
  red_book_status: AsrRedBookStatus;
  author_id: number | null;
  author_name: string | null;
  companions: string[];
  teams: { code: string; name: string | null; work_note: string | null }[];
  resolutions: {
    prev_doc_no: string | null;
    prev_report_date: string | null;
    issue_text: string | null;
    resolution_text: string | null;
  }[];
  reviewer_name: string | null;
  reviewed_at: string | null;
  photo_count: number;
}

export interface AsrSummaryProjectRow {
  project_id: number;
  name: string;
  shifr: string | null;
  contract_no: string | null;
  reports: number;
  site_visits: number;
  by_type: TypeCounts;
  approved: number;
  with_defects: number;
  people: number;
  first_date: string;
  last_date: string;
}

export interface AsrSummaryResponse {
  filters: {
    from: string | null;
    to: string | null;
    projectId: number | null;
    reportType: AsrReportType | null;
    status: AsrSummaryStatusFilter;
  };
  period: { from: string | null; to: string | null };
  totals: {
    reports: number;
    site_visits: number;
    projects: number;
    people: number;
    by_type: TypeCounts;
    by_status: { submitted: number; approved: number };
    red_book: Record<AsrRedBookStatus, number>;
    with_defects: number;
    with_tasks: number;
    photos: number;
  };
  by_project: AsrSummaryProjectRow[];
  by_team: { code: string; name: string | null; reports: number; site_visits: number }[];
  by_person: { user_id: number; name: string; reports: number; site_visits: number; authored: number }[];
  entries: AsrSummaryEntry[];
  truncated: boolean;
  project: { id: number; name: string } | null;
  /** Татах файлын нэр (өргөтгөлгүй) — сервер нэг газар угсарна. */
  file_stem: string;
  generated_at: string;
  generated_by: number;
}

/** API / хэвлэх хуудасны query string (`t` токенгүй). */
export function summaryQueryString(p: AsrSummaryParams): string {
  const qs = new URLSearchParams();
  if (p.from) qs.set('from', p.from);
  if (p.to) qs.set('to', p.to);
  if (p.projectId != null) qs.set('project_id', String(p.projectId));
  if (p.reportType) qs.set('report_type', p.reportType);
  if (p.status !== 'counted') qs.set('status', p.status);
  return qs.toString();
}

/** URL → шүүлт (буруу утга чимээгүй үл тоогдоно — сервер ч мөн шалгана). */
export function summaryParamsFromSearch(sp: URLSearchParams): AsrSummaryParams {
  const range = normalizeRange(sp.get('from'), sp.get('to'));
  const pid = Number(sp.get('project_id'));
  const type = sp.get('report_type');
  return {
    ...range,
    projectId: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
    reportType: (ASR_REPORT_TYPES as readonly string[]).includes(type ?? '') ? (type as AsrReportType) : null,
    status: sp.get('status') === 'approved' ? 'approved' : 'counted',
  };
}

/**
 * Самбараас нээхэд өгөгдмөл хугацаа: сарын эхний 10 хоногт ӨМНӨХ сар
 * (сарын нэгтгэлийг ихэвчлэн сар дууссаны дараа гаргадаг — 10-р сарын 1-нд
 * «Энэ сар» хоосон байна), түүнээс хойш ЭНЭ сар.
 */
export function defaultSummaryRange(today: string): AsrRange {
  return presetRange(Number(today.slice(8, 10)) <= 10 ? 'lastMonth' : 'thisMonth', today);
}
