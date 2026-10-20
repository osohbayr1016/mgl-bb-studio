/**
 * `backend/src/routes/reports.ts`-ийн хариултын ИХЭР төрлүүд.  Талбар нэмэх
 * бол хоёр талыг хамт.
 */
import type { NonProjectEntry, NonProjectStage } from '@/features/non-project-work/types';

export type ReportWindow = 'day' | '7d' | '14d' | 'month' | 'all';
export const REPORT_WINDOWS: readonly ReportWindow[] = ['day', '7d', '14d', 'month', 'all'];

export type TrendCode = 'up' | 'down' | 'flat';

export interface TrendResult {
  code: TrendCode;
  last7: number;
  prior7: number;
  pct_change: number | null;
  slope_per_day: number;
}

export interface WindowMeta {
  window: { code: ReportWindow; from: string; to: string; days: number };
  previous: { from: string; to: string } | null;
  anchor: string;
  /**
   * Мөр бүрийн `spark` цувааны муж.  Цонхыг дагана (7d → 7, 14d → 14, сар →
   * сарын өдрүүд); `day` → сүүлийн 7, `all` → сүүлийн 30 хоног.  Баганын
   * гарчиг `days`-ээс.
   */
  sparkline: { from: string; to: string; days: number };
}

export interface EmployeeReportRow {
  user_id: number;
  full_name: string;
  username: string;
  employee_id: string | null;
  position: string | null;
  seniority: string | null;
  profile_image: string | null;
  role: string;
  status: string;
  team_id: number | null;
  team_code: string | null;
  team_name: string | null;
  is_leaderboard_member: boolean;
  points: number;
  points_prev: number | null;
  points_delta_pct: number | null;
  rank_now: number | null;
  pool_size: number | null;
  rank_7d_ago: number | null;
  rank_delta: number | null;
  rank_7d_source: 'snapshot' | 'live' | null;
  trend: TrendResult;
  /** Өдрийн оноо `sparkline` мужид — хандлага (`trend`) нь үргэлж 14 хоногоос, үүнээс биш. */
  spark: number[];
  entries_count: number;
  tasks_touched: number;
  tasks_completed: number;
  /** `points`-ийн засварын хэсэг (user_points.source = 'repair') — Засварын төсөл + бодит төслийн засвар. */
  repair_points: number;
  /** Засварын бүртгэлийн тоо (`entries_count` нь зөвхөн progress_entries). */
  repair_entries: number;
  repair_hours: number;
  /** Батлагдсан ч ОНОО АВААГҮЙ тайлан — блок/зураг/таскийн жин 0 эсвэл багийн хувь 0. */
  unweighted_entries: number;
  present_days: number;
  hours_worked: number;
  late_minutes: number;
  leave_hours: number;
  /** Цонхонд алгассан батлагдсан чөлөөт ажлын өдөр (`all` цонхонд 0) — `points`,
   *  байр, хандлага нь ажилласан өдрөөр (backend lib/leaveAvailability.ts). */
  leave_days: number;
  /** Хуанлийн цонхонд бодитоор олгогдсон оноо. */
  points_actual: number;
}

export interface OverviewResponse extends WindowMeta {
  generated_at: string;
  expected_days: number | null;
  pool_size: number;
  rows: EmployeeReportRow[];
}

export interface EmployeeMetrics {
  points: number;
  repair_points: number;
  entries_count: number;
  tasks_touched: number;
  tasks_completed: number;
  repair_entries: number;
  repair_hours: number;
  unweighted_entries: number;
  present_days: number;
  expected_days: number | null;
  hours_worked: number;
  late_minutes: number;
  leave_hours: number;
  leave_days: number;
  points_actual: number;
  /** Сүүлийн 30 өдрийн өдрийн дундаж. */
  daily_avg_30d: number;
}

export interface RankHistoryRow {
  date: string;
  rank_30d: number | null;
  rank_7d: number | null;
  pool_size: number | null;
  points_30d: number;
}

export interface EmployeeTeam {
  id: number;
  code: string;
  name_mn: string;
  is_primary: boolean;
}

export interface EmployeeProjectRow {
  project_id: number | null;
  repair_project_id: number | null;
  is_repair_project: boolean;
  /** Батлагдсан төслийн бус ажлын оноо (0343) — төсөлгүй, нэргүй бүлэг. */
  is_non_project: boolean;
  name: string | null;
  points: number;
  award_count: number;
  last_awarded_at: string | null;
}

export interface EmployeeDetailResponse extends WindowMeta {
  user: {
    id: number;
    full_name: string;
    username: string;
    employee_id: string | null;
    position: string | null;
    seniority: string | null;
    role: string;
    status: string;
    profile_image: string | null;
    team_id: number | null;
    team_code: string | null;
    team_name: string | null;
    teams: EmployeeTeam[];
    is_leaderboard_member: boolean;
  };
  metrics: EmployeeMetrics;
  prev_metrics: EmployeeMetrics | null;
  deltas: {
    points_pct: number | null;
    hours_pct: number | null;
    late_minutes: number | null;
    present_days: number | null;
    entries: number | null;
  };
  rank: {
    now: number | null;
    pool_size: number | null;
    at_7d_ago: number | null;
    delta: number | null;
    source: 'snapshot' | 'live' | null;
    history: RankHistoryRow[];
  };
  trend: TrendResult;
  spark: number[];
  /** Цонхны цуваа.  ≤ 90 өдөр → өдрөөр, ≤ 400 → 7 хоногоор (Даваа), цаашид сараар;
   *  `dates` нь нэгжийн эхний өдөр, `expected` = нэгж дэх ажлын өдөр. */
  series: {
    granularity: SeriesGranularity;
    dates: string[];
    points: number[];
    hours: number[];
    late_minutes: number[];
    present: number[];
    expected: number[];
  };
  projects: EmployeeProjectRow[];
  /** Цонхтой давхцсан чөлөөний хүсэлтүүд — бүх төлөв (цуцалсан ч). */
  leaves: { by_status: Record<string, { days: number; count: number }>; rows: EmployeeLeaveRow[] };
  /** Цонхонд илгээсэн санал хүсэлт — зөвхөн нэрээ нууцлаагүй. */
  suggestions: EmployeeSuggestionRow[];
  /** Цонхны төслийн бус ажил (татгалзсанаас бусад) — зарцуулсан минут. */
  non_project_work: EmployeeNonProjectWork;
}

export interface EmployeeNonProjectRow {
  date: string;
  category: string;
  note: string | null;
  minutes: number;
  status: string;
}

export interface EmployeeNonProjectWork {
  minutes: number;
  rows: EmployeeNonProjectRow[];
}

export type SeriesGranularity = 'day' | 'week' | 'month';

export interface EmployeeLeaveRow {
  id: number;
  leave_type: string;
  reason_code: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  days: number;
  hours: number | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | string;
  is_paid: number | null;
  reviewer_note: string | null;
  decided_at: string | null;
  created_at: string;
  reviewer_name: string | null;
}

export interface EmployeeSuggestionRow {
  id: number;
  title: string;
  description: string;
  status: 'received' | 'discussing' | 'resolved' | string;
  resolution: 'approved' | 'rejected' | null;
  reviewer_note: string | null;
  decided_at: string | null;
  created_at: string;
  reviewer_name: string | null;
}

export interface TeamReportRow {
  team_id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  members: number;
  leaderboard_members: number;
  points: number;
  points_prev: number | null;
  points_delta_pct: number | null;
  avg_points_per_member: number;
  repair_points: number;
  rank: number | null;
  present_rate: number | null;
  present_days: number;
  hours_worked: number;
  late_minutes: number;
  entries_count: number;
  tasks_completed: number;
  repair_entries: number;
  unweighted_entries: number;
  trend: TrendResult;
  spark: number[];
}

export interface TeamsResponse extends WindowMeta {
  expected_days: number | null;
  rows: TeamReportRow[];
}

export interface TeamDetailResponse extends WindowMeta {
  team: TeamReportRow | null;
  rows: EmployeeReportRow[];
  series: { dates: string[]; points: number[] };
}

export interface SnapshotRow {
  user_id: number;
  date: string;
  points_day: number;
  points_7d: number;
  points_30d: number;
  rank_7d: number | null;
  rank_30d: number | null;
  pool_size: number | null;
  entries_count: number;
  tasks_touched: number;
  tasks_completed: number;
  repair_hours: number;
  present: number;
  hours_worked: number;
  late_minutes: number;
  on_leave: number;
  is_free_day: number;
  team_id: number | null;
  team_code: string | null;
  source: string;
  computed_at: string;
}

export interface SnapshotsResponse {
  user_id: number;
  from: string;
  to: string;
  rows: SnapshotRow[];
}

export interface SnapshotStatus {
  last_date: string | null;
  total_rows: number;
  first_date: string | null;
  missing_days_30: string[];
}

/** `GET /api/profiles/:id/tasks` — ажилтны одоогийн даалгаврууд (идэвхтэй төслүүд). */
export interface ProfileTaskItem {
  id: number;
  name: string;
  weight_percent: number;
  due_date: string | null;
  start_date: string | null;
  component_id: number;
  component_name: string;
  drawing_id: number;
  drawing_name: string;
  block_id: number;
  block_name: string;
  project_id: number;
  project_name: string;
  project_status: string;
  current_progress: number;
  reported_today: boolean;
  reported_today_rest: boolean;
  reported_today_status: 'pending' | 'approved' | 'rejected' | null;
}

export interface ProfileTasksResponse {
  items: ProfileTaskItem[];
  projects: Array<{ project_id: number; project_name: string; items: ProfileTaskItem[]; avg_progress: number }>;
  summary: {
    total: number;
    completed: number;
    in_progress: number;
    not_started: number;
    today: string;
    reported_today: number;
    pending_today: number;
  };
}

export type ContractType = 'permanent' | 'fixed_term' | 'probation' | 'contractor' | 'other';
export const CONTRACT_TYPES: readonly ContractType[] = ['permanent', 'fixed_term', 'probation', 'contractor', 'other'];

export interface EmployeeHr {
  user_id: number;
  hired_at: string | null;
  probation_end: string | null;
  contract_no: string | null;
  contract_type: ContractType | string | null;
  contract_start: string | null;
  contract_end: string | null;
  contract_file_name: string | null;
  contract_file_size: number | null;
  contract_uploaded_at: string | null;
  nda_file_name: string | null;
  nda_file_size: number | null;
  nda_uploaded_at: string | null;
  pc_username: string | null;
  pc_password: string | null;
  phone: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: number | null;
  has_contract_file: boolean;
  has_nda_file: boolean;
}

/** Гэрээний файлын төрөл — employment = Хөдөлмөрийн гэрээ, nda = Нууцлалын гэрээ. */
export type ContractKind = 'employment' | 'nda';

export interface EmployeeHrPatch {
  hired_at?: string | null;
  probation_end?: string | null;
  contract_no?: string | null;
  contract_type?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  pc_username?: string | null;
  pc_password?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface EmployeeAssessment {
  round_id: number;
  round_name: string;
  period: string;
  round_status: string;
  overall_pct: number | null;
  level: { code: string; label: string; color: string } | null;
  self_pct: number | null;
  senior_pct: number | null;
  senior_count: number;
}

export interface EmployeeHrResponse {
  user: {
    id: number;
    username: string;
    full_name: string;
    email: string | null;
    role: string;
    status: string;
    position: string | null;
    employee_id: string | null;
    seniority: string | null;
    created_at: string;
    profile_image: string | null;
    work_schedule: string;
    teams: EmployeeTeam[];
  };
  hr: EmployeeHr | null;
  assessments: EmployeeAssessment[];
  pgp: Array<{ id: number; period: string; updated_at: string }>;
  contract_types: readonly string[];
}

/* ---- Засварын төслийн тайлан (`GET /api/reports/repair-projects*`) ---- */

export type RepairTargetKind = 'repair' | 'project';

/** Засварын зорилт — дотоод ажил (`r:<repair_projects.id>`) ЭСВЭЛ жинхэнэ төсөл (`p:<projects.id>`).
 *  Хоёр id-ийн орон зай давхцдаг тул `key` л таних тэмдэг. */
export interface RepairProjectReportRow {
  key: string;
  kind: RepairTargetKind;
  id: number;
  name: string;
  description: string | null;
  /** repair: active|archived · project: active|completed|archived */
  status: string;
  category: string | null;
  /** Зөвхөн жинхэнэ төсөлд (`projects.progress_mode`, 0339). */
  progress_mode: string | null;
  /** Цагийн бүртгэлээс бодсон явц 0–100 (0339): дотоод ажилд үргэлж, жинхэнэ
   *  төсөлд зөвхөн 'hours' горимд; бусдад null (жинлэсэн явц энд харуулахгүй). */
  progress: number | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  entry_count: number;
  people_count: number;
  total_hours: number;
  total_pct: number;
  last_entry_at: string | null;
  last_entry_date: string | null;
  last_entry_user_id: number | null;
  last_entry_user_name: string | null;
}

export interface RepairProjectsResponse {
  generated_at: string;
  /** Ядаж нэг бүртгэлтэй (дотоод ажил + жинхэнэ төсөл) — сүүлийн бүртгэлээр буурах. */
  rows: RepairProjectReportRow[];
  /** Бүртгэлгүй дотоод ажил (сая нэмсэн) — устгаж болно. */
  idle: RepairProjectReportRow[];
}

export interface RepairProjectPersonRow {
  user_id: number;
  full_name: string;
  username: string;
  profile_image: string | null;
  position: string | null;
  user_status: string;
  team_code: string | null;
  entries: number;
  hours: number;
  pct: number;
  /** Энэ хүний ЯВЦЫН хувь — Σ progress_pct (0339). */
  progress_pct: number;
  /** Төслийн нийт хувьд эзлэх хэсэг (0–100). */
  share_pct: number;
  first_date: string;
  last_date: string;
  last_at: string | null;
}

export interface RepairProjectDetailResponse {
  project: RepairProjectReportRow;
  people: RepairProjectPersonRow[];
}

export interface RepairProjectEntryRow {
  id: number;
  user_id: number;
  full_name: string;
  profile_image: string | null;
  date: string;
  hours: number;
  computed_pct: number;
  /** Төслийн явцад нэмсэн хувь (0339). */
  progress_pct: number;
  weekly_avg_pct: number;
  rate_source: string | null;
  description: string;
  created_at: string | null;
}

export interface RepairProjectEntriesPage {
  rows: RepairProjectEntryRow[];
  next_before: number | null;
}

/* ---- Төслийн бус ажлын тайлан (0343/0344, routes/nonProjectWorkReview.ts) ---- */

/** Табын шүүлт — `lib/nonProjectReview.ts` `REVIEW_FILTERS`-ийн ихэр. */
export const NON_PROJECT_REVIEW_FILTERS = ['awaiting_review', 'needs_report', 'approved', 'rejected', 'all'] as const;
export type NonProjectReviewFilter = (typeof NON_PROJECT_REVIEW_FILTERS)[number];

export interface NonProjectReviewItem extends NonProjectEntry {
  user: {
    id: number;
    full_name: string | null;
    username: string;
    profile_image: string | null;
    team_code: string | null;
    team_name: string | null;
    active: boolean;
  };
  /** Шийдвэр гаргасан админ; хүлээгдэж буй мөрөнд null. */
  reviewer: { id: number; full_name: string | null } | null;
  /** Батлах үеийн snapshot (0344): өдрийн дундаж ханш ба түүний шат (олгосон хувь нь `computed_pct`). */
  daily_rate: number | null;
  rate_source: string | null;
}

export interface NonProjectReviewResponse {
  stage: NonProjectReviewFilter;
  items: NonProjectReviewItem[];
  truncated: boolean;
  counts: Record<NonProjectStage, number>;
}

/* ---- Менежментийн багийн тайлан (өдрийн ажлын тайлан 0345, routes/managementLogs.ts) ---- */

export interface MgmtMemberSummary {
  user_id: number;
  name: string;
  username: string;
  position: string | null;
  active: boolean;
  is_admin: boolean;
  is_ceo: boolean;
  days_logged: number;
  items: number;
  logged_workdays: number;
  expected_workdays: number;
  /** 0..1; хүлээгдэх ажлын өдөргүй бол null. */
  coverage: number | null;
  late_days: number;
  first_date: string | null;
  last_date: string | null;
}

export interface MgmtTeamMember extends MgmtMemberSummary {
  lifetime_days: number;
  lifetime_last_date: string | null;
}

export interface MgmtDayCell {
  user_id: number;
  date: string;
  count: number;
  late: boolean;
  /** Муж ≤ 62 өдөр үед л. */
  items?: string[];
  /** UTC ISO — хамгийн сүүлд хадгалсан агшин (2026-10-07-ноос; хуучин worker буцаадаггүй). */
  updated_at?: string;
}

export interface MgmtTeamResponse {
  window: ReportWindow;
  anchor: string;
  today: string;
  range: { from: string; to: string };
  since: string;
  with_items: boolean;
  workdays: number;
  totals: {
    members: number;
    writers: number;
    items: number;
    person_days: number;
    logged_workdays: number;
    expected_workdays: number;
    coverage: number | null;
  };
  members: MgmtTeamMember[];
  days: MgmtDayCell[];
}

export interface MgmtMemberLog {
  log_date: string;
  items: string[];
  first_written_on: string;
  late: boolean;
  edit_count: number;
  updated_at: string;
}

export interface MgmtMemberResponse {
  window: ReportWindow;
  anchor: string;
  today: string;
  range: { from: string; to: string };
  heat: { from: string; to: string };
  member: {
    user_id: number;
    name: string;
    username: string;
    position: string | null;
    active: boolean;
    is_admin: boolean;
    is_ceo: boolean;
    first_log_date: string | null;
  };
  summary: Omit<MgmtMemberSummary, 'user_id' | 'name' | 'username' | 'position' | 'active' | 'is_admin' | 'is_ceo'>;
  logs: MgmtMemberLog[];
}
