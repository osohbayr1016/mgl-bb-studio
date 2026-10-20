/* =============================================================
 * Гүйцэтгэлийн тайлан — TypeScript shapes shared between the list
 * page, draft editor, and PDF print page.  Mirrors the JSON the
 * backend `routes/performanceReports.ts` returns after hydrate().
 * ============================================================= */

export type PerformanceReportStatus = 'draft' | 'issued';

export interface TeamSnapshotItem {
  team_id: number;
  team_code: string;
  team_name_mn: string;
  share_percent: number;
  /** Team's internal completion % at issue time. */
  progress: number;
  task_count: number;
}

export interface StatusMeeting {
  label: string;
  /** Project completion % at which this meeting is scheduled (e.g. 30, 50, 100). */
  percent: number;
  scheduled_at: string; // ISO date 'YYYY-MM-DD'
  completed_at?: string | null;
}

/** One row in the Section 2.2 "Ажиллах хүч" workforce table. */
export interface WorkforceRow {
  category: string;
  count: number;
  description?: string;
}

/** One point on the project-wide progress-over-time line chart
 *  (the "Нэгтгэсэн график" block). `progress` is overall weighted
 *  project completion (0–100) as of `date`. */
export interface ProgressTimeseriesPoint {
  date: string; // 'YYYY-MM-DD'
  progress: number;
}

/** RAG severity used by the client report (schedule chips + risk impact). */
export type ReportRag = 'green' | 'amber' | 'red' | 'unknown';

/** One authored risk row in the client-facing design-progress report. */
export interface ReportRisk {
  risk: string;
  impact: ReportRag;
  owner: string;
  mitigation: string;
}

export interface PerformanceReport {
  id: number;
  project_id: number;
  report_no: number;
  period_start: string;
  period_end: string;
  status: PerformanceReportStatus;
  issued_at: string | null;
  issued_by_id: number | null;
  team_progress: TeamSnapshotItem[];
  /** Frozen daily progress curve (set at issue; empty on drafts —
   *  the print/preview pages then fetch it live). */
  progress_timeseries: ProgressTimeseriesPoint[];
  status_meetings: StatusMeeting[];
  /** Section 2 intro paragraph. */
  summary_text: string | null;
  /** Section 2.2 staff table. */
  workforce: WorkforceRow[];
  notes: string | null;
  /** Client-report authored fields (migration 0108) — consumed only by the
   *  WeasyPrint client report, not the internal perf-report blocks. */
  client_summary_md: string | null;
  risks: ReportRisk[];
  next_plan: string[];
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
  /** Гарын үсэг зурсан «Боловсруулсан ажилтан» — СЕРВЕР тодруулна
   *  (`GET /:id/performance-reports/:reportId`).  Жагсаалтын хариунд
   *  БАЙХГҮЙ тул сонголттой.
   *
   *  ⚠️ Яагаад сервер вэ: нэр/зургийг олох `GET /api/users` нь
   *  `requireManager()` тул захиалагч PDF татахад 403 болж, гарын үсэг ба
   *  нэр ХООСОН баримт очдог байв.  `signature_url` нь ТҮҮХИЙ түлхүүр —
   *  хэрэглэхийн өмнө `mediaUrl()` дамжуулна. */
  signoff?: { name: string; signature_url: string | null };
}

export interface PerformanceReportListResponse {
  reports: PerformanceReport[];
}

export interface PerformanceReportResponse {
  report: PerformanceReport;
}

export interface PerformanceReportDraftInput {
  period_start?: string;
  period_end?: string;
  status_meetings?: StatusMeeting[];
  summary_text?: string | null;
  workforce?: WorkforceRow[];
  notes?: string | null;
  client_summary_md?: string | null;
  risks?: ReportRisk[];
  next_plan?: string[];
}
