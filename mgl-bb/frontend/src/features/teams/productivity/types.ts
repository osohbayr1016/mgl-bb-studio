/**
 * `GET /api/teams/:id/productivity` — backend `lib/teamProductivityStore.ts`
 * `TeamProductivityPayload`-ийн толь.  Тоо бүрийг СЕРВЕР бодно; энд зөвхөн
 * харуулна (өдрийн дундаж = бүтээмж ÷ ажиллах ёстой өдөр, чөлөөг хасна).
 */
export type PeriodKind = 'day' | 'week' | 'month';
export const PERIOD_KINDS: readonly PeriodKind[] = ['day', 'week', 'month'];

export interface ProductivityTeam {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  lead_user_id: number | null;
  lead_active: boolean;
  lead_name: string | null;
}

export interface ProductivityPeriod {
  kind: PeriodKind;
  from: string;
  to: string;
  until: string;
  current: boolean;
  prev_date: string;
  next_date: string | null;
}

export interface ProductivitySummary {
  members: number;
  other_members: number;
  expected_person_days: number;
  leave_person_days: number;
  present_person_days: number;
  logged_person_days: number;
  earned_person_days: number;
  present_rate: number | null;
  logged_rate: number | null;
  earned_rate: number | null;
  people_expected: number;
  people_present: number;
  people_logged: number;
  people_earned: number;
  people_on_projects: number;
  project_count: number;
  people_on_repair: number;
  repair_project_count: number;
  people_asr: number;
  asr_team_visits: number;
  team_points: number;
  team_avg: number | null;
  prev_team_avg: number | null;
}

export interface ProductivityGap {
  compared: number;
  top_user_id: number | null;
  top_avg: number | null;
  bottom_user_id: number | null;
  bottom_avg: number | null;
  gap_pct: number | null;
  line: number | null;
  threshold_pct: number;
  exceeded: boolean;
}

export interface ProductivityMember {
  user_id: number;
  full_name: string;
  username: string;
  role: string;
  position: string | null;
  employee_id: string | null;
  profile_image: string | null;
  is_lead: boolean;
  points: number;
  repair_points: number;
  non_project_points: number;
  work_days: number;
  leave_days: number;
  present_days: number;
  logged_days: number;
  earned_days: number;
  avg: number | null;
  prev_avg: number | null;
  rank: number | null;
  pct_of_top: number | null;
  below_line: boolean;
  need_per_day: number | null;
  project_count: number;
  repair_count: number;
  asr_count: number;
  series: (number | null)[];
}

export interface ProductivityProject {
  project_id: number;
  kind: 'project' | 'repair';
  name: string;
  status: string | null;
  category: string | null;
  people: number;
  person_days: number;
  member_ids: number[];
}

export interface ProductivityAsr {
  id: number;
  doc_no: string | null;
  report_date: string;
  project_id: number;
  project_name: string;
  author_id: number;
  author_name: string;
  status: string;
  team_included: boolean;
  by_member: boolean;
}

export interface ProductivityHistoryPoint {
  from: string;
  to: string;
  working: boolean;
  team_avg: number | null;
  top_avg: number | null;
  bottom_avg: number | null;
  gap_pct: number | null;
  exceeded: boolean;
  compared: number;
}

export interface ProductivityWarning {
  id: number;
  created_at: string;
  period_kind: PeriodKind;
  period_from: string;
  period_to: string;
  gap_pct: number | null;
  threshold_pct: number;
  note: string | null;
  sent_by: number;
  sent_by_name: string | null;
  recipients: Array<{ id: number; full_name: string }>;
  below: Array<{ user_id: number; full_name: string; avg: number | null }>;
}

export interface WarningCandidate {
  id: number;
  full_name: string;
  profile_image: string | null;
  is_lead: boolean;
  default_selected: boolean;
}

export interface TeamProductivityResponse {
  team: ProductivityTeam;
  viewer: { can_warn: boolean; is_lead: boolean };
  period: ProductivityPeriod;
  threshold_pct: number;
  summary: ProductivitySummary;
  gap: ProductivityGap;
  members: ProductivityMember[];
  projects: ProductivityProject[];
  asr: ProductivityAsr[];
  history: ProductivityHistoryPoint[];
  warnings: ProductivityWarning[];
  warning_candidates: WarningCandidate[];
}

export interface SendWarningResponse {
  warning: { id: number | null; gap_pct: number | null; threshold_pct: number };
  notified: Array<{ id: number; full_name: string }>;
  title: string;
  body: string;
}
