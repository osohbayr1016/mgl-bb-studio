// Shared interfaces for Frontend (matching backend types)
// Reconstructed from the agent transcript on 2026-04-23 after the file was
// truncated to 0 bytes. Verified against current usage across the codebase.

import type { ProjectCategory } from '@/shared/lib/project-categories';
export type { ProjectCategory } from '@/shared/lib/project-categories';

/**
 * Ажлын ээлжийн түлхүүр — backend `lib/workSchedule.ts`-ийн `ScheduleKey`-ийн
 * ТӨРӨЛ ХОСОЛ.  2026-09-01-нээс гурав: 08:00–17:00 / 08:30–17:30 / 09:00–18:00.
 * Шошго/цагийг ЭНД БҮҮ БИЧ — сервер `schedule_options`-оор өгнө
 * (`features/attendance/shifts.ts`-ийг үз).
 */
export type ScheduleKey = 'standard' | 'early' | 'mid';

export interface LoginRequest {
  username: string;
  password: string;
}

/** `worker` = цэвэрлэгч / туслах ажилтан.  Зөвхөн ирцээ (болон чөлөө/илүү
 *  цагийн хүсэлт) бүртгэдэг — төсөл, баг, бүтээмжийн самбарт хандахгүй.
 *  See `shared/lib/roles.ts` + backend `lib/workerScope.ts`. */
export type UserRole = 'admin' | 'engineer' | 'architect' | 'senior' | 'client' | 'worker';
export type UserStatus = 'active' | 'inactive';
export type ProjectStatus = 'active' | 'completed' | 'archived';
export type ProgressStatus = 'pending' | 'approved' | 'rejected';

// ─────────────────────── Seniority (зэрэг) ───────────────────────
export type Seniority = 'senior' | 'intermediate' | 'junior' | 'intern';
export type SeniorityTrack = 'architect' | 'engineer' | 'designer' | 'management' | 'other';

export const SENIORITY_OPTIONS: { value: Seniority; label_mn: string; label_en: string }[] = [
  { value: 'senior', label_mn: 'Ахлах', label_en: 'Senior' },
  { value: 'intermediate', label_mn: 'Дунд', label_en: 'Intermediate' },
  { value: 'junior', label_mn: 'Бага', label_en: 'Junior' },
  { value: 'intern', label_mn: 'Дадлагажигч', label_en: 'Intern' },
];

const TRACK_BY_TEAM: Record<string, SeniorityTrack> = {
  BA: 'architect',
  BB: 'engineer',
  HAS: 'engineer',
  TSBU: 'engineer',
  TSAH: 'engineer',
  HD: 'engineer',
  AU: 'engineer',
  IZ: 'designer',
  MGMT: 'management',
};

export function seniorityTrackOf(teamCode: string | null | undefined): SeniorityTrack {
  if (!teamCode) return 'other';
  return TRACK_BY_TEAM[teamCode] ?? 'other';
}

export function seniorityLabel(s: Seniority | null | undefined, lang: 'mn' | 'en' = 'mn'): string {
  if (!s) return '—';
  const opt = SENIORITY_OPTIONS.find((o) => o.value === s);
  if (!opt) return s;
  return lang === 'mn' ? opt.label_mn : opt.label_en;
}

/** "Senior Architect", "Junior Engineer" гэх мэт нийлсэн label.  Track байхгүй
 *  бол зөвхөн зэрэг буцаана. */
export function seniorityFullLabel(
  s: Seniority | null | undefined,
  teamCode: string | null | undefined,
  lang: 'mn' | 'en' = 'mn',
): string {
  if (!s) return '—';
  const sLabel = seniorityLabel(s, lang);
  const track = seniorityTrackOf(teamCode);
  if (track === 'other' || track === 'management') return sLabel;
  const trackLabel: Record<
    Exclude<SeniorityTrack, 'other' | 'management'>,
    { mn: string; en: string }
  > = {
    architect: { mn: 'архитектор', en: 'Architect' },
    engineer: { mn: 'инженер', en: 'Engineer' },
    designer: { mn: 'дизайнер', en: 'Designer' },
  };
  const t = trackLabel[track];
  return lang === 'mn' ? `${sLabel} ${t.mn}` : `${sLabel} ${t.en}`;
}

// ─────────────────────── User & Auth ───────────────────────
export interface UserTeam {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  is_primary: number;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  team_id: number | null;
  position: string | null;
  employee_id: string | null;
  /** Ажил мэргэшлийн зэрэг.  Track нь `team_code`-оос
   *  `seniorityTrackOf()`-ээр гарна (BA = architect, бусад тех. баг = engineer). */
  seniority?: Seniority | null;
  // Denormalized team info filled in by the list + /auth/me endpoints via JOIN.
  team_code?: string | null;
  team_name_mn?: string | null;
  team_name_en?: string | null;
  profile_image?: string | null;
  /** Ажилтны өөрөө сонгосон цагийн хуваарь.
   *  'standard' = 09:00–18:00, 'early' = 08:00–17:00.
   *  Хоцролтыг тус хуваарийн эхэн цагтай харьцуулж тооцно. */
  /** Тухайн ӨДӨР бодитоор үйлчилж буй ээлж (`/auth/me` нь зуны албадлага
   *  болон `user_work_schedules`-ийг шийдэж өгдөг — түүхий багана БИШ). */
  work_schedule?: ScheduleKey;
  /** Ажилтны СОНГОСОН ээлж (зуны албадлагаар дарагдаагүй).  `GET /api/users`
   *  буцаана — `work_schedule` нь ӨНӨӨДӨР хүчинтэй ээлж тул зуны үед хоёр
   *  нь ЗӨРНӨ.  Админ засварын форм ЭНЭ талбарыг харуулна. */
  work_schedule_selected?: ScheduleKey;
  /** Ээлж хаанаас гарсан бэ.  `GET /api/users` буцаана:
   *   · 'self'    — ажилтан ӨӨРӨӨ сонгосон (`PATCH /auth/profile`);
   *   · 'admin'   — админ хэрэглэгчийн засварын цонхноос тохируулсан
   *                 (`PUT /api/users/:id` нь ямар ч талбар засахад
   *                 `work_schedule`-ыг давхар явуулдаг тул энэ элбэг);
   *   · 'default' — хэзээ ч сонгогдоогүй, хуучин `users.work_schedule`
   *                 баганаас унасан утга.
   *  Гурвуулаа ижил ээлжийн түлхүүр өгч болох тул «хэн сонголтоо хийсэн бэ»
   *  гэдгийг ЗӨВХӨН энэ талбар хэлнэ (миграци 0199-ийн `created_by`). */
  work_schedule_source?: 'self' | 'admin' | 'default';
  /** Сонголт хэзээнээс хүчинтэй (YYYY-MM-DD).  ИРЭЭДҮЙН огноо байж болно —
   *  сонголт маргаашаас (зунаар бол 9-р сарын 1-нээс) эхэлдэг. */
  work_schedule_from?: string | null;
  /** User 69 — ажлын цаг тогтмол 09:30–17:30, picker-ээр солигдохгүй. */
  schedule_fixed?: boolean;
  /** Бодит ээлжийн эхлэх минут (`/auth/me`).  Сануулга энэ талбарыг `SHIFT_START_MINUTES` map-аас өмнө авна. */
  shift_start_minutes?: number;
  /** Тогтмол ээлжийн шошго (`GET /api/users`, зөвхөн `schedule_fixed`). */
  schedule_label?: string;
  teams?: UserTeam[];
  /** True when the user is the configured `teams.lead_user_id` of at least
   *  one team.  Drives whether the "Approvals" nav item shows up for
   *  senior-role users.  Admin-tier users see it regardless. */
  is_approval_lead?: boolean;
  /** Ирцийн төхөөрөмжийн холболт — анхны clock-in хийсэн PC-ийн id
   *  (null/undefined = холбоогүй).  Admin UsersPage-аас reset хийнэ. */
  attendance_device_id?: string | null;
  /** Холболт хэзээ үүссэн (ISO, UB). */
  attendance_device_bound_at?: string | null;
  /** Идэвхтэй холбогдсон браузер/төхөөрөмжийн тоо (`attendance_devices`,
   *  0328) — нэг компьютерийн Chrome + Edge = 2. */
  attendance_device_count?: number | null;
  /** Дэмжих ажилтан (цэвэрлэгч гэх мэт) эсэх — 1 бол бүтээмжийн
   *  (чансааны) самбарт харагдахгүй.  Ирц бүртгэлд нөлөөлөхгүй. */
  is_support?: number | null;
  /** 1 бол ирцийн бүх хязгаарлалтаас (утаснаас хориглох, нэг төхөөрөмжид
   *  холбох, төсөл сонгох) чөлөөтэй — admin-тай адил.  Admin UsersPage-аас
   *  toggle хийнэ. */
  attendance_unrestricted?: number | null;
  /** 1 бол оффисын IP-ийн гаднаас бүрэн системд хандах зөвшөөрөлтэй. */
  remote_access_allowed?: number | null;
}

export interface UserProfile extends User {
  bio: string | null;
  description: string | null;
  profile_image: string | null;
  cover_image: string | null;
  social_links: string | null;
  /** Saved signature image (/media/ key) — profile + correspondence reuse. */
  signature_url?: string | null;
}

export interface AuthResponse {
  user: UserProfile;
  token?: string;
}

export interface SocialLinks {
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  twitter?: string;
  // Legacy keys — kept optional so existing records don't break on read,
  // but they're no longer exposed in the profile editor.
  github?: string;
  website?: string;
}

// ─────────────────────── Teams ───────────────────────
export interface Team {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  member_count?: number;
  total_tasks?: number;
  completed_tasks?: number;
  in_progress_tasks?: number;
  overdue_tasks?: number;
  avg_progress?: number;
  project_count?: number;
  active_project_count?: number;
  /** Distinct primary members pointed at ANY project that day — a person on
   *  two projects counts once here but once per project in active_projects. */
  active_user_count?: number;
  active_projects?: Array<{
    project_id: number;
    project_name: string;
    user_count: number;
    percent: number;
  }>;
  /** Багийн ахлагч.  Урьд нь 100%-ийн илгээлтийг батлах хүнийг заадаг
   *  байсан; баталгаажуулалтын алхам 2026-09-17-нд хасагдсан тул одоо
   *  зөвхөн мэдэгдлийн чиглүүлэлтэд (lib/notify.ts).  Null = ахлагчгүй. */
  lead_user_id?: number | null;
}

export interface TeamProjectSummary {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  status: string;
  /** projects-page-тэй ижил карт зурахад хэрэгтэй талбарууд (overview SELECT-д
   *  p.category/complexity_pct/created_at/start_date/finish_date нэмэгдсэн). */
  category?: ProjectCategory | null;
  complexity_pct?: number | null;
  created_at?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
  task_count: number;
  completed_count: number;
  in_progress_count: number;
  overdue_count: number;
  avg_progress: number;
  next_due: string | null;
  /** Number of distinct team members who marked this project as active on
   *  today's AttendanceWidget. Reflects who is *actually* working on it now. */
  active_today_count: number;
  /** The team members behind `active_today_count` — those who linked this
   *  project in their attendance (ирц) today. */
  active_today_members: Array<{ user_id: number; full_name: string; profile_image: string | null }>;
}

export interface TeamMemberWorkload {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  status: string;
  position: string | null;
  employee_id: string | null;
  profile_image: string | null;
  task_count: number;
  completed_count: number;
  avg_progress: number;
  is_primary?: number;
  /** Projects the member ticked on the AttendanceWidget for today.  Empty
   *  array when they haven't clocked in yet (or skipped the picker).
   *  `kind: 'repair'` = засварын төсөл (0324), `project_id` нь тэгвэл СӨРӨГ
   *  (`-repair_projects.id`) — `/app/projects/:id` руу холбохгүй. */
  active_today: Array<{ project_id: number; project_name: string; kind?: 'project' | 'repair' }>;
}

export interface TeamRecentProgress {
  id: number;
  percentage: number;
  date: string;
  notes: string | null;
  user_id: number;
  full_name: string;
  profile_image: string | null;
  item_name: string | null;
  project_id: number | null;
  project_name: string | null;
}

export interface TeamOverview {
  team: Team;
  projects: TeamProjectSummary[];
  stats: {
    total: number;
    completed: number;
    in_progress: number;
    not_started: number;
    overdue: number;
    due_soon: number;
    avg_progress: number;
  };
  members: TeamMemberWorkload[];
  recent_progress: TeamRecentProgress[];
}

/** One assignee's view of one team task — the row shape returned by
 *  `GET /api/teams/:id/member-tasks`. Only tasks with progress (>0%) are
 *  returned; a task with several assignees appears once per assignee.
 *  The teams-list breakdown dialog groups these by `user_id`. */
export interface TeamMemberTaskRow {
  user_id: number;
  full_name: string;
  profile_image: string | null;
  role: UserRole;
  position: string | null;
  task_id: number;
  task_name: string;
  /** Latest approved task progress, 0–100. */
  progress: number;
  due_date: string | null;
  project_id: number;
  project_name: string;
  component_name: string;
  drawing_name: string;
}

export interface TeamMemberTasksResponse {
  team: { id: number; code: string; name_mn: string; name_en: string | null };
  rows: TeamMemberTaskRow[];
}

// ─────────────────────── Progress entries ───────────────────────
export interface ProgressEntry {
  id: number;
  task_id: number | null;
  user_id: number;
  percentage: number;
  date: string;
  notes: string | null;
  status: ProgressStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  image_url: string | null;
  is_rest_day: 0 | 1;
  created_at: string;
  user_name?: string;
  item_name?: string;
  task_name?: string | null;
}

export interface MyProgressEntry {
  id: number;
  task_id: number | null;
  user_id: number;
  percentage: number;
  date: string;
  notes: string | null;
  status: ProgressStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  image_url: string | null;
  is_rest_day: 0 | 1;
  created_at: string;
  task_name: string | null;
  // Profile activity-таб өргөтгөл (GET /profiles/:id/activity):
  component_id?: number | null;
  component_name?: string | null;
  block_id?: number | null;
  block_name?: string | null;
  project_id?: number | null;
  project_name?: string | null;
  /** Тухайн task-ийн өмнөх бичлэгээс хэдэн хувь нэмэгдсэн (delta). */
  delta_pct?: number | null;
  reviewer_name?: string | null;
}

export interface PendingProgressEntry extends ProgressEntry {
  user_name: string;
  user_username: string;
  user_profile_image: string | null;
  user_role?: UserRole;
  user_position?: string | null;
  user_team_code?: string | null;
  user_team_name?: string | null;
  project_name: string | null;
  project_id: number | null;
  block_name?: string | null;
  drawing_name?: string | null;
  component_name?: string | null;
}

export interface ReviewedProgressEntry extends PendingProgressEntry {
  reviewer_name: string | null;
  reviewer_username: string | null;
  reviewer_profile_image: string | null;
  reviewer_role: UserRole | null;
}

export interface MyTasksSummary {
  total: number;
  completed: number;
  in_progress: number;
  not_started: number;
}

// ─────────────────────── Notifications ───────────────────────
// ⚠️ backend/src/types.ts-ийн `NotificationType`-тай тэнцүү байх ёстой.
// Хазайлт нь compile алдаа өгдөггүй — зөвхөн bell дээр ерөнхий icon-оор
// гарах чимээгүй шинж тэмдэгтэй (`notificationIcons.tsx`-ийн `default`).
// Урьд нь suggestion_* × 3 + pgp_feedback ингэж хоцорч байсан; 2026-08-26-нд
// assessment_assigned / assessment_submitted хоёрыг мөн нөхөв.
export type NotificationType =
  | 'progress_pending'
  | 'progress_approved'
  | 'progress_rejected'
  | 'task_assigned'
  | 'leave_requested'
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_cancelled'
  | 'attendance_adjusted'
  | 'attendance_confirm_requested'
  | 'attendance_confirm_responded'
  | 'attendance_announcement'
  | 'suggestion_submitted'
  | 'suggestion_updated'
  | 'suggestion_resolved'
  | 'pgp_feedback'
  | 'asr_submitted'
  | 'asr_approved'
  | 'asr_rejected'
  // Зохиогчийн хяналтын хуваарь (0331) — «тэдэн сарын тэдэнд явна» / цуцлалт.
  | 'asr_visit_assigned'
  | 'asr_visit_cancelled'
  | 'assessment_assigned'
  | 'assessment_submitted'
  | 'project_deadline'
  | 'project_nudge'
  // Захиалагчийн портал (2026-09).  Эхний хоёр нь АЖИЛТАН руу, сүүлийн хоёр
  // нь ЗАХИАЛАГЧ руу — тэднийг нэг хүн ХЭЗЭЭ Ч хүлээж авахгүй.
  | 'client_submission_received'
  | 'client_submission_reviewed'
  | 'client_publication'
  | 'client_message'
  | 'client_signature_requested'
  | 'client_signed'
  /* Нийтийн мэдээлэл (migration 0338) — нийтлэгдэх / дахин баталгаажуулах / сануулга. */
  | 'announcement_published'
  /* Багийн профайл (migration 0346) — захирлаас багийн ахлах руу «гишүүдийн
   * бүтээмжийн зөрүү босгоос их» анхааруулга. */
  | 'team_gap_warning'
  /* «Баримт бичиг» дээрх Word баримтын гарын үсэг (migration 0371) — «батлана уу /
   * зурна уу» ба захирлын шийдвэр (батлав / буцаав). */
  | 'doc_sign_requested'
  | 'doc_sign_decided'
  /* Revit «Өөрчлөхөөс өмнө» — архитектор элемент зөөхөд мөргөлдсөн элементийн
   * зохиогчид / гараар нэмсэн хүмүүст (migration 0390, `/app/revit-changes`). */
  | 'revit_change_notice'
  /* Програмын хүсэлт (migrations 0410–0414).  `_new` / `_activity` нь ЗӨВХӨН баталгаажсан reviewer
   * (Өсөхбаяр) руу, `_update` нь илгээгч руу (нийтийн төлөв + хариу л — дотоод тэмдэглэл хэзээ ч үгүй). */
  | 'engineering_request_new'
  | 'engineering_request_activity'
  | 'engineering_request_update';

export interface AppNotification {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: 0 | 1;
  created_at: string;
}

// ─────────────────────── Project hierarchy ───────────────────────
// Workflow: Project → Block(s) → Drawing(s) → Component(s) → Task(s)
// Each level holds a `weight_percent` (sums to 100 inside its parent) and a
// rolled-up `progress` percentage computed server-side from the latest
// approved progress entry per task.

export interface AssigneeInfo {
  user_id: number;
  full_name: string;
  profile_image: string | null;
  team_id: number | null;
  team_code: string | null;
  team_name_mn: string | null;
}

export interface TaskProgress {
  id: number;
  name: string;
  weight_percent: number;
  progress: number;
  assigned_to: number | null;
  assigned_name: string | null;
  due_date: string | null;
  start_date: string | null;
  assignees?: AssigneeInfo[];
  ai_completion_summary?: string | null;
  ai_completion_summary_at?: string | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
  /**
   * Хуучин бүлгийг хуваарилалт руу хөрвүүлэхэд (migration 0385) энэ таск үндсэн ажилд НЭГТГЭГДСЭН бол root таскийн id.
   * Нэгтгэгдсэн хэсэг нь жин 0, түүх хэвээр — жагсаалтад харуулахгүй (явц, цаг, оноо root дээр).
   */
  retired_into?: number | null;
}

export interface ComponentProgress {
  id: number;
  name: string;
  weight_percent: number;
  progress: number;
  tasks: TaskProgress[];
}

export interface DrawingProgress {
  id: number;
  name: string;
  weight_percent: number;
  progress: number;
  components: ComponentProgress[];
}

export interface BlockProgress {
  id: number;
  name: string;
  weight_percent: number;
  progress: number;
  /** Owning team. Block weight is "% within this team". */
  team_id?: number | null;
  /** Хариуцагч (responsible person) — manually assigned by admin/senior
   *  (migration 0122).  NULL = unassigned; just a displayed name. */
  responsible_user_id?: number | null;
  responsible_name?: string | null;
  drawings: DrawingProgress[];
  /** Flat helper list — every task under this block, denormalized so the
   *  detail dialog can render a single sortable table without re-walking
   *  the hierarchy on every render. */
  tasks: TaskProgress[];
}

/** Төслийн идэвхийн хэмжүүр — backend `lib/projectActivity.ts`-тэй ХОС. */
export interface ProjectActivity {
  score: number;
  /** Таск дээр оноогдсон / өөрийгөө нэмсэн ялгаатай хүн (бүх хугацаанд). */
  assignee_count: number;
  /** Сүүлийн 30 хоногт ирц дээр энэ төслийг сонгосон ялгаатай хүн. */
  attendance_users_30d: number;
  attendance_user_days_30d: number;
  progress_users_30d: number;
  progress_entries_30d: number;
  last_progress_at: string | null;
  last_attendance_date: string | null;
  last_activity_at: string | null;
}

/** `projects.progress_mode` (0339) — backend `lib/repairProgress.ts`-ийн хос. */
export type ProgressMode = 'tasks' | 'hours';

export interface ProjectWithProgress {
  id: number;
  name: string;
  /** Optional header display title (migration 0089); falls back to `name`. */
  display_title?: string | null;
  description: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  key_image_url?: string | null;
  /** Uploaded .ifc model — parsed in-browser by the QTO (Тоо хэмжээ) tab. The
   *  3D viewer is separate now (APS / .rvt, see ApsViewer.tsx + project_models). */
  model_url?: string | null;
  /** Converted .xkt media url for the 3D viewer (null until conversion done). */
  model_xkt_url?: string | null;
  /** IFC->.xkt conversion state: 'converting' | 'done' | 'failed' (null = none). */
  model_conversion_status?: 'converting' | 'done' | 'failed' | null;
  /** Short reason when model_conversion_status === 'failed'. */
  model_conversion_error?: string | null;
  status: ProjectStatus;
  /** Legacy per-project complexity tier (low/mid/high/special). Retained
   *  for backward compatibility; scoring now uses `complexity_pct`. */
  complexity?: ProjectComplexity;
  /** Per-project performance weight (0-100) an admin types in directly.
   *  Drives scoring as `complexity_pct × Δpct / 100`. Replaces the fixed
   *  tier→percent scale from migration 0093 onward. */
  complexity_pct?: number;
  /** High-level project type — picked at create time. Nullable for rows
   *  that pre-date migration 0079. See lib/project-categories.ts. */
  category?: ProjectCategory | null;
  /** Явцын горим (миграц 0339): 'tasks' = жинлэсэн блок→зураг→таскийн мод;
   *  'hours' = засварын цагийн бүртгэлээс (шинэ ZA төсөл) — таск дээр гараар
   *  % бичих боломжгүй, «Засвар бүртгэх» цонхоор цаг л бүртгэнэ. */
  progress_mode?: ProgressMode;
  /** 1 = Зохиогчийн хяналтын төсөл — Төслүүд хуудсанд гарахгүй. */
  asr_only?: number;
  created_by: number;
  created_at: string;
  updated_at: string;
  /** Гар эрэмбэ (admin drag-reorder, migration 0104). Бага = дээр. */
  sort_order?: number;
  /** Яаралтай/ASAP тэмдэг (migration 0105). 1 бол улаанаар тодорч дээр гарна. */
  is_asap?: number;
  progress: number;
  member_count: number;
  /** Идэвх (`GET /api/projects`, 2026-09-18) — Төслүүд хуудасны өгөгдмөл
   *  эрэмбэ.  `score` = backend `lib/projectActivity.ts`-ийн жинлэсэн
   *  нийлбэр; бусад нь «яагаад» гэдгийг chip дээр харуулах бүрэлдэхүүн.
   *  Optional: `GET /api/projects/:id` буцаадаггүй. */
  activity?: ProjectActivity;
  /** 1 when the current logged-in user is in `project_members` for this
   *  project, else 0. Returned by `GET /api/projects` (list endpoint).
   *  Optional for back-compat with older clients/responses. */
  is_member?: 0 | 1;
  /** 1 when *any* member of one of the caller's teams is assigned to a task
   *  in this project. Looser than `is_member` — used by the attendance
   *  picker so workers can clock in on team-owned projects without first
   *  having claimed individual tasks. */
  is_team_assigned?: 0 | 1;
  start_date?: string | null;
  finish_date?: string | null;
  /* ---- Паспортын танигчид (`GET /api/projects` жагсаалтаас, 0246/0247) ----
   * ⚠️ БҮГД optional: `project_passport` нь LEFT JOIN (24 төслийн 15-д л
   * мөр байдаг), мөн `GET /api/projects/:id` нь `SELECT *`-аар буцаадаг
   * тул тэнд БАЙХГҮЙ.  `shared/lib/projectIdentity.ts` эдгээрийг эвдрэлгүй
   * буулгаж уншина. */
  /** Зургийн шифр — ХЭД ХЭДЭН төсөл дээр ДАВХАРДАЖ БОЛНО (эзний шийдвэр
   *  2026-09-03), тиймээс танигч БИШ, зөвхөн харагдац/хайлтын талбар. */
  drawing_no?: string | null;
  /** «Doc. No.» — бүхэлдээ гараар бичигдэх чөлөөт текст. */
  doc_no?: string | null;
  /** Паспортын албан ёсны УРТ гарчиг. */
  full_title?: string | null;
  /* ---- «Эх төсөл» (migration 0254 · `projects.source_project_id`) ----
   * Засварын (ЗА) төсөл нь ихэвчлэн ӨМНӨ нь зурсан барилгын дахин ажил
   * бөгөөд бүтцээ («Бүтэц татах») тэр төслөөс хуулж авдаг.  Энэ багана
   * тэр холбоог БАЙНГА хадгална.
   *
   * ⚠️ ХОЁУЛАА optional: `GET /api/projects/:id` нь `SELECT *`-оор
   * буцаадаг тул `source_project_id` тэнд БАЙНА, харин НЭР нь JOIN
   * шаарддаг учир зөвхөн түүнийг СОНГОДОГ хариунд ирнэ.  Нэр байхгүй үед
   * дуудагч талууд `/projects` жагсаалтаас нөхөж уншина. */
  source_project_id?: number | null;
  source_project_name?: string | null;
  /* ---- Google Drive хавтас (migration 0278 · `projects.google_drive_folder_id`) ----
   * Төслийн баримт бичгийн ЭХ СУРВАЛЖ нь Drive; ERP нь зөвхөн хавтасны id
   * (URL биш) + холбох мөчийн нэрийг хадгална.  `GET /api/projects/:id` нь
   * `SELECT *` тул тэнд ирнэ; жагсаалтын хариунд БАЙХГҮЙ.  Хуудсан дээрх
   * «Баримт бичиг» таб нь `features/projects/drive/`. */
  google_drive_folder_id?: string | null;
  google_drive_folder_name?: string | null;
  team_progress?: ProjectTeamProgress[];
}

/** One uploaded model version (project_models row) for the 3D viewer history.
 *  Returned newest-first by `GET /api/projects/:id/models`. New `.rvt` uploads
 *  are translated by APS (carry `aps_urn`, `model_format:'rvt'`); legacy
 *  `.ifc`/`.xkt` rows have no `aps_urn` and are no longer rendered. */
export interface ProjectModelRow {
  id: number;
  model_url: string;
  model_xkt_url: string | null;
  /** APS Model Derivative URN (base64 of the OSS object id). Null for legacy rows. */
  aps_urn?: string | null;
  /** 'rvt' = APS-rendered; 'ifc' = legacy xkt (hidden in the new viewer). */
  model_format?: 'rvt' | 'ifc' | null;
  conversion_status: 'converting' | 'done' | 'failed';
  conversion_error: string | null;
  /** Optional APS manifest progress string (e.g. "75% complete"). */
  aps_progress?: string | null;
  file_name: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface ProjectOption {
  id: number;
  name: string;
  status?: 'active' | 'completed' | 'archived';
  is_member?: 0 | 1;
  is_team_assigned?: 0 | 1;
  /** Толгойн урт гарчиг (0089) — жагсаалтын SQL одоо үүнийг СОНГОДОГ. */
  display_title?: string | null;
  /** Паспортын танигчид — сонголтын мөрийг ялгахад (шифр давхардаж болно). */
  drawing_no?: string | null;
  doc_no?: string | null;
  full_title?: string | null;
}

/** Self-logged засвар (repair / extra work) entry — migration 0114. Оноо
 *  (computed_pct) = 7 хоногийн нийт progress-оноо × (hours / day_hours), энд
 *  day_hours нь ажлын долоо хоногийн цаг (40). Ажлын долоо хоногийн хувь =
 *  hours / day_hours × 100. */
export interface RepairEntry {
  id: number;
  /** Жинхэнэ төсөл дээрх дахин ажил.  `repair_project_id`-тэй ЯГ НЭГ нь
   *  дүүрэн (backend-ийн 0194 CHECK). */
  project_id: number | null;
  /** Админы үүсгэсэн засварын төсөл дээрх компанийн дотоод ажил (0194). */
  repair_project_id: number | null;
  /** Аль эх сурвалжаас ирснээс үл хамааран нэр — сервер тал
   *  `COALESCE(projects.name, repair_projects.name)` хийж өгнө. */
  project_name: string;
  is_repair_project: 0 | 1;
  /** Хуучин бүртгэлийн «хийсэн засвар» тайлбар.  2026-09-24-өөс бүртгэх
   *  цонхонд тайлбар БАЙХГҮЙ — шинэ мөрөнд '' ирнэ. */
  description: string;
  /** Цагаар бодогддог төслийн таскийн мөрөөс бүртгэсэн бол таск (0341). */
  task_id?: number | null;
  task_name?: string | null;
  hours: number;
  day_hours: number;
  /** Үүсгэх үеийн СУУРЬ ханшийн snapshot — «нэг АЖЛЫН ӨДӨР хэдэн хувь».
   *  ⚠️ Баганын нэр түүхэн: 0196 хүртэл долоо хоногийн ханш байсан. */
  weekly_avg_pct: number;
  /** Суурь ханш аль шатнаас гарсан — «яагаад ийм оноо гарав?»-ын ул мөр.
   *  0348-аас хойш `self30`; хуучин мөрөнд `self7`. */
  rate_source: RepairRateSource | null;
  computed_pct: number;
  /** Төслийн ЯВЦАД нэмсэн хувь (0339): өдрийн дундаж төслийн-% × цаг/8.
   *  Оноо (`computed_pct`) биш — засварын төслийн явцын нийлбэрийн нэг хэсэг. */
  progress_pct?: number;
  /** 0348: 'manual' = гараар бичсэн хуучин мөр; 'auto' = «ажилласан»
   *  тэмдэглэгээнээс систем бодсон; 'backfill' = хуучин ZA хувийн бөглөлтөөс
   *  нөхсөн (ажилтан устгахгүй). */
  hours_source?: 'manual' | 'auto' | 'backfill';
  /** Цагийг гаргасан тэмдэглэгээ — устгахдаа `DELETE /repair/marks/:mark_id`. */
  mark_id?: number | null;
  /** `GET /repair/my`: 'mark' = 0 цаг ногдсон тэмдэглэгээ (мөр нь байхгүй,
   *  `id` нь тэмдэглэгээний дугаар). */
  kind?: 'entry' | 'mark';
  date: string;
  created_at: string;
}

/** Засварын суурь ханшийн шат (backend lib/repairProgress.ts `RateSource`).
 *  `self7` нь 0348-аас өмнөх мөрийн түүхэн утга. */
export type RepairRateSource = 'self30' | 'self7' | 'self90' | 'team30' | 'company30' | 'none';

/** GET /api/repair/all мөр — admin түүхэнд submitter нэртэй (`RepairEntry` +
 *  user info). */
export interface RepairAdminEntry extends RepairEntry {
  user_id: number;
  user_full_name: string;
}

/**
 * Засварын төсөл (`repair_projects`, миграци 0194) — ЖИНХЭНЭ төсөл БИШ.
 *
 * Бүх төсөл эзэнтэй болчихсон үед ажилтан компанийн дотоод ажил хийж цаг +
 * тайлбараа бүртгэдэг «сав».  `projects`-той ямар ч холбоогүй тул Төслүүд
 * хуудас, хянах самбар, Timeline, глобал хайлт зэрэгт ХЭЗЭЭ Ч гарахгүй —
 * зөвхөн `/api/repair/projects` буцаана.  Зөвхөн админ үүсгэнэ.
 *
 * ⚠️ `id` нь `projects.id`-тай ӨӨР орон зайд байна: хоёулаа бие даасан
 * AUTOINCREMENT тул 7 дугаар ХОЁУЛАНД нь байж болно.  Тиймээс UI-д хоёуланг
 * нь хольж жагсаахдаа заавал `kind:id` хэлбэрийн ХОСОЛСОН түлхүүр хэрэглэнэ.
 */
export interface RepairProject {
  id: number;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  sort_order: number;
  created_by: number | null;
  created_at: string;
  entry_count?: number;
  /** Ажилласан нийт цаг ба хүний тоо (2026-09-24). */
  total_hours?: number;
  people_count?: number;
  /** Цагийн бүртгэлээс бодсон явц 0–100 (0339). Шинэ төсөл 0. */
  progress?: number;
}

/** Нэг хүний ажилласан цаг — `GET /api/repair/hours` (backend lib/repairHours.ts). */
export interface RepairPersonHours {
  user_id: number;
  full_name: string;
  hours: number;
  entries: number;
  last_date: string | null;
}

/** `GET /api/repair/hours?project_id=|repair_project_id=` — засварын ажлын
 *  «хэн хэдэн цаг» хураангуй.  ХУВЬ агуулахгүй (2026-09-24). */
export interface RepairHoursSummary {
  total_hours: number;
  entry_count: number;
  people: RepairPersonHours[];
  /** Таск бүрийн цаг (0341); таскгүй бүртгэл энд ОРОХГҮЙ — `unlinked_hours`. */
  tasks: { task_id: number; hours: number; people: RepairPersonHours[] }[];
  unlinked_hours: number;
}

/** GET /api/repair/rate — цонхны live preview-ийн суурь тоонууд. */
export interface RepairRateInfo {
  /** Ажилтны ӨДРИЙН дундаж хувь — шаталсан байдлаар олдсон суурь ханш. */
  daily_rate: number;
  rate_source: RepairRateSource;
  /** Ажилтны өдрийн дундаж ТӨСЛИЙН-% (0339) — засварын төслийн явцад нэмэгдэх
   *  хувийн ханш; `daily_rate` (оноо)-оос тусдаа. */
  progress_rate?: number;
  progress_rate_source?: RepairRateSource;
  /** Нэг ажлын өдрийн цаг (8) — цагийг хувь болгох хуваагч. */
  work_day_hours: number;
  /** Нэг өдөрт бүртгэж болох засварын цагийн нийлбэрийн дээд хязгаар.
   *  2026-09-23-аас ИРЦЭЭС ХАМААРАХГҮЙ тогтмол (сервер тал 12 ц) — ажилтан
   *  цагаа өөрөө оруулдаг тул «ирц алга ⇒ 0» гэсэн төлөв БАЙХГҮЙ. */
  daily_cap: number;
  /** Тухайн өдөр аль хэдийн бүртгэсэн засварын цаг. */
  daily_logged: number;
}

/** Хувь хүний хөгжлийн төлөвлөгөө (PGP) — /api/pgp. Маягтын бүх талбар
 *  `answers` object-д (frontend schema, PGP_FIELDS-ээр удирдагдана) байна;
 *  admin/senior-ийн санал `comments`-д. */
export interface PgpComment {
  id: number;
  author_id: number;
  author_name: string | null;
  note: string;
  created_at: string;
}

export interface PgpPlan {
  id: number;
  user_id: number;
  period: string;
  answers: Record<string, string>;
  created_at: string;
  updated_at: string;
  comments: PgpComment[];
}

/** GET /api/pgp/authors мөр — PGP бөглөсөн нэг ажилтны нэгтгэл (UsersPage таб). */
export interface PgpAuthor {
  user_id: number;
  full_name: string;
  profile_image: string | null;
  employee_id: string | null;
  role: string;
  team_code: string | null;
  team_name_mn: string | null;
  plan_count: number;
  latest_period: string | null;
  latest_updated_at: string | null;
  /** Comma-separated period list (GROUP_CONCAT). */
  periods: string | null;
}

/** GET /api/pgp/export мөр — нэг ажилтны нэг period-ийн PGP + хэрэглэгчийн мэдээлэл. */
export interface PgpExportRow extends PgpPlan {
  full_name: string;
  employee_id: string | null;
  team_code: string | null;
  team_name_mn: string | null;
}

export interface ProjectTeamProgress {
  team_id: number;
  team_code: string | null;
  team_name_mn: string | null;
  progress: number;
  task_count: number;
}

export type ClientType = 'company' | 'individual';

export interface ProjectClient {
  id: number;
  project_id: number;
  type: ClientType;
  name: string;
  share_percent: number;
  sort_order: number;
  created_at: string;
}

export interface ClientInput {
  type: ClientType;
  name: string;
  share_percent?: number;
}

/** One row in `project_team_shares`, joined to `teams` server-side so the
 *  UI can show the team name + code badge without a second round trip.
 *  Returned by `GET /api/projects/:id` and the `PUT .../team-shares` ack. */
export interface ProjectTeamShare {
  id: number;
  project_id: number;
  team_id: number;
  share_percent: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  team_code: string;
  team_name_mn: string;
  team_name_en: string | null;
}

/** Payload row for the `team_shares` field of POST `/api/projects` and
 *  `PUT /api/projects/:id/team-shares` — server clamps share_percent to
 *  [0, 100] and de-duplicates by `team_id` (last entry wins). */
export interface TeamShareInput {
  team_id: number;
  share_percent: number;
  sort_order?: number;
}

export interface ProjectDetailResponse {
  project: ProjectWithProgress;
  blocks: BlockProgress[];
  members: User[];
  clients?: ProjectClient[];
  team_shares?: ProjectTeamShare[];
  /** Төслийн паспорт — `GET /api/projects/:id` НЭГ дуудлагаар буцаана.
   *  ⚠️ optional бөгөөд `null` байж БОЛНО: паспортын мөргүй төсөл олон, мөн
   *  хуучин серверийн хариунд энэ түлхүүр огт байхгүй.  `GET /:id/passport`
   *  тусдаа маршрут ХЭВЭЭР ажиллана (ижил `rowToPassport` mapper). */
  passport?: ProjectPassport | null;
}

// ─────────────────────── Dashboard ───────────────────────
export interface DashboardStats {
  total_projects: number;
  active_projects: number;
  completed_projects: number;
  total_users: number;
}

export interface DashboardOverview {
  stats: DashboardStats;
  recent_entries: ProgressEntry[];
  active_projects: ProjectWithProgress[];
}

// ─────────────────────── Documents ───────────────────────
export interface DocumentComment {
  id: number;
  revision_id: number;
  user_id: number;
  content: string;
  created_at: string;
  user_name: string;
  profile_image: string | null;
}

export interface DocumentRevision {
  id: number;
  document_id: number;
  revision_number: number;
  file_url: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  status: 'pending' | 'approved' | 'rejected';
  uploaded_by: number;
  uploaded_at: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_notes: string | null;
  uploaded_by_name: string;
  reviewed_by_name: string | null;
  comments?: DocumentComment[];
}

export interface DocumentItem {
  id: number;
  project_id: number;
  block_id: number | null;
  drawing_id: number | null;
  component_id: number | null;
  task_id: number | null;
  folder_id?: number | null;
  title: string;
  description: string | null;
  created_by: number;
  created_at: string;
  created_by_name: string;
  latest_revision_id?: number;
  revision_number?: number;
  file_url?: string;
  file_name?: string;
  file_type?: string | null;
  file_size?: number | null;
  status?: 'pending' | 'approved' | 'rejected';
  uploaded_at?: string;
  uploaded_by_name?: string;
}

export interface DocumentDetailResponse {
  document: DocumentItem;
  revisions: DocumentRevision[];
}

// ─────────────────────── Office IPs (attendance whitelist) ───────────────────────
export interface OfficeIp {
  id: number;
  label: string;
  ip_address: string;
  is_active: 0 | 1;
  created_by: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────── Attendance ───────────────────────
export interface AttendanceSession {
  id: number;
  user_id: number;
  clock_in: string;
  clock_out: string | null;
  hours_worked: number | null;
  device_id: string | null;
  ip_address: string | null;
  date: string;
  notes: string | null;
  /** Хоцорсон минут (0 = цагтаа). Тус ажилтны цагийн хуваарийн
   *  эхэн цагтай харьцуулсан. */
  late_minutes?: number;
  created_at: string;
  /** Админ гарах цагийг гараар нөхсөн бол хэн/хэзээ/тайлбар. */
  edited_by?: number | null;
  edited_at?: string | null;
  edit_note?: string | null;
  /** Админ ирцийг бүхэлд нь гараар нөхөж үүсгэсэн бол үүсгэгч (0102).
   *  Зөвхөн ийм бичлэгийг админ устгаж болно. */
  created_by?: number | null;
  // Joined fields (admin queries)
  full_name?: string;
  employee_id?: string | null;
  profile_image?: string | null;
  /** Ажилтны ҮНДСЭН (`user_teams.is_primary`) багийн код/нэр.
   *  Зөвхөн `GET /attendance/open-sessions` буцаана. */
  team_code?: string | null;
  team_name?: string | null;
  /** `teams.sort_order` — багийн шүүлтийг компанийн ӨӨРИЙН дараалалд
   *  барихад (цагаан толгойн эрэмбэ нь БА/БҮ-г санамсаргүй холино). */
  team_sort?: number | null;
}

/** Ирц/чөлөөн дээрх админ үйлдлийн audit лог (0102) — append-only.
 *  Backend `GET /attendance/admin-logs`. */
export type AttendanceAdminLogAction =
  | 'session_create'
  | 'session_clock_out'
  | 'session_delete'
  | 'leave_create'
  | 'leave_approve'
  | 'leave_reject'
  | 'leave_cancel'
  | 'leave_delete';

export interface AttendanceAdminLog {
  id: number;
  actor_id: number;
  target_user_id: number | null;
  action: AttendanceAdminLogAction;
  /** Хамаарах огноо — ирцийн өдөр / чөлөөний эхлэх огноо. */
  date: string | null;
  details: string | null;
  created_at: string;
  // Joined:
  actor_name?: string;
  actor_image?: string | null;
  target_name?: string | null;
  target_image?: string | null;
}

/** Нэг өдрийн нэг чөлөө — `DailyAttendanceRow.leave_parts`. */
export interface DailyLeavePart {
  leave_id: number;
  leave_type: 'annual' | 'sick' | 'unpaid' | 'remote' | 'other';
  /** 1 цалинтай, 0 цалингүй, null хуучин бичлэг.  Хуучин API-д талбар байхгүй (undefined). */
  is_paid?: number | null;
  reason: string | null;
  /** Тухайн өдрийн цонх 'HH:MM'. */
  start_time: string;
  end_time: string;
  /** Энэ чөлөөний өөрийн минут. */
  minutes: number;
  /** Давхцал, 8 цагийн тааз хассаны дараа нийлбэрт орсон минут. */
  counted_minutes: number;
}

/** One row of the XLSX-style daily attendance grid (admin Тайлан tab).
 *  See backend `GET /attendance/daily-grid` for derivation rules. */
export interface DailyAttendanceRow {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  position: string | null;
  team_code: string | null;
  team_name: string | null;
  /** `teams.sort_order` — «Тайлан» табын багийн шүүлтийн chip-үүдийг компанийн
   *  дараалалд (БА, БҮ, ХАС…) эрэмбэлэхэд.  Сервер хуучин хувилбар байхад
   *  ирэхгүй байж болох тул СОНГОЛТТОЙ — байхгүй үед код руугаа буцаж эрэмбэлнэ. */
  team_sort?: number | null;
  date: string;
  schedule_key: ScheduleKey;
  /** «08-17» / «09-18» / «08:30-17:30» — ээлж тохируулагдах тул хаалттай
   *  union БИШ (серверийн `shortShiftLabel`-ээс гарна). */
  schedule_label: string;
  planned_in: string;
  planned_out: string;
  actual_in: string | null;
  actual_out: string | null;
  /** Тухайн өдрийн ирцийн бичлэгийн тоо (0 = бүртгэлгүй).  Inline засварт
   *  олон бичлэгтэй өдрийг (≥2) аюулгүйн үүднээс хориглоход ашиглана. */
  session_count: number;
  late_minutes: number;
  late_penalty: number;
  work_minutes: number | null;
  /** `work_minutes`-ийн дотор, гарах бүртгэлийн дараа (эсвэл ирэхээс өмнө)
   *  оффисоос гадуур хийсэн төслийн бус ажлын минут (0352).  Хуучин API-д байхгүй. */
  non_project_credit_minutes?: number;
  /** Хүлээгдсэн ажлын минут (8h × 60 = 480), чөлөөтэй өдөрт 0. */
  expected_minutes: number;
  /** `min(work_minutes, expected − late)`.  Илүү цагийг оруулаагүй. */
  credited_minutes: number | null;
  /** "Ажилласан цаг" = бодит ажилласан + цалинтай чөлөө (unpaid-аас бусад) + гадуур ажил. */
  worked_effective_minutes: number;
  /** = `credited_minutes` (илүү цагийн нэмэгдэл 0171-д хасагдсан). */
  total_minutes: number | null;
  is_on_leave: boolean;
  leave_type: 'annual' | 'sick' | 'unpaid' | 'remote' | 'other' | null;
  leave_reason: string | null;
  /** Тухайн өдөрт ногдох чөлөөний цаг (минутаар).  Олон өдрийн чөлөөг
   *  календарь өдрөөр хувааж нэг өдөрт ногдох хэсгийг авна.  Нэг өдөр хэд
   *  хэдэн чөлөөтэй бол цонхнуудын нэгдэл, 8 цагаас хэтрэхгүй. */
  leave_minutes: number;
  /** Өдрийн чөлөө бүр (backend `lib/dayLeaves.ts`).  `leave_type`/`leave_reason`
   *  нь хамгийн их минуттай хэсгийнх.  Хуучин API-д байхгүй. */
  leave_parts?: DailyLeavePart[];
  is_absent: boolean;
  /** Тухайн өдөр нийтийн амралт эсэх (амарсанаар тооцно). */
  is_holiday?: boolean;
  /** Бямба/Ням эсэх.  Эдгээр өдрийн мөр зөвхөн ажилтан бодитоор ажилласан үед
   *  л үүснэ — ажиллах ёстой өдрийн тоонд ОРОХГҮЙ (`isExpectedWorkDay`). */
  is_rest_day?: boolean;
  /** Тухайн өдрийн батлагдсан гадуур ажлын цаг (минутаар). */
  out_of_office_minutes: number;
}

export interface DailyAttendanceGridResponse {
  period: { from: string; to: string; working_days: number };
  rows: DailyAttendanceRow[];
  settings: {
    late_grace_minutes: number;
    late_penalty_per_minute: number;
    expected_day_minutes: number;
  };
}

/** Ирцийн өдрийн баталгаажуулалт (migration 0115).  Админ хүсэлт явуулна →
 *  ажилтан 'confirmed' (Зөв) эсвэл 'disputed' (Буруу, тэмдэглэлтэй) гэж хариулна. */
export interface AttendanceConfirmation {
  id: number;
  user_id: number;
  date: string;
  status: 'requested' | 'confirmed' | 'disputed';
  requested_by: number;
  requested_at: string;
  responded_at: string | null;
  request_note: string | null;
  response_note: string | null;
  created_at: string;
  updated_at: string;
  /** 0403 — хариулсны ДАРАА тэр сарын ирцийн өгөгдөл өөрчлөгдсөн (дахин шалгаж батлах). Хуучин worker-т байхгүй. */
  changed_since_answer?: boolean;
  // Joined (list endpoints)
  full_name?: string;
  employee_id?: string | null;
  profile_image?: string | null;
  requester_name?: string | null;
}

export interface AttendanceSettings {
  late_grace_minutes: number;
  late_penalty_per_minute: number;
  /** true бол ирц бүртгэхэд оффисын IP шалгана; false бол хаанаас ч зөвшөөрнө. */
  require_office_ip: boolean;
  /** true бол ажилласан цаг тооцохдоо доорх цайны цонхтой давхцсан хэсгийг хасна. */
  lunch_enabled?: boolean;
  /** Цайны эхлэх/дуусах цаг 'HH:MM' (UB). */
  lunch_start?: string;
  lunch_end?: string;
  /** true бол ижил компьютерийн шинэ браузерыг (техник хангамжийн профайл
   *  таарвал) ирцийн төхөөрөмжид автоматаар нэмнэ; false бол зөвхөн яг
   *  таарсан браузер. */
  device_hw_match?: boolean;
  note?: string;
}

/** One row of the period-summary report (one per employee). */
export interface AttendanceSummaryRow {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  position: string | null;
  team_code: string | null;
  team_name: string | null;
  /** Ажиллах өдөр — period-ийн Дав–Баа ажлын өдрийн тоо (бүгдэд ижил). */
  expected_days: number;
  /** Ажиллах цаг — expected_days × 8ц, минутаар. */
  expected_minutes: number;
  /** Ажиллах ёстой өдөр дээр ирсэн өдөр (≤ `expected_days`).  Амралт/баярын
   *  өдөр ажилласныг `extra_days`-д тусад нь тоолно. */
  present_days: number;
  /** Бямба/Ням эсвэл баярын өдөр бодитоор ажилласан өдөр — `expected_days`-д
   *  ордоггүй, цаг нь `worked_effective_minutes`-д тоологдоно.  Хуучин API-д байхгүй. */
  extra_days?: number;
  late_minutes: number;
  late_penalty: number;
  credited_minutes: number;
  /** "Ажилласан цаг" = бодит ажилласан + цалинтай чөлөө (unpaid-аас бусад) + гадуур ажил. */
  worked_effective_minutes: number;
  /** Чөлөө (ээлжийн амралтаас бусад) — period-т ногдох цаг, минутаар. */
  leave_minutes: number;
  /** Ээлжийн амралт авсан ажлын өдрийн тоо. */
  annual_leave_days: number;
  /** Ээлжийн амралт авсан тодорхой огноонууд (yyyy-mm-dd, өсөхөөр). */
  annual_leave_dates: string[];
  /** Гадуур ажлын цаг — period доторх батлагдсан нийт цаг, минутаар. */
  out_of_office_minutes: number;
  total_minutes: number;
}

export interface AttendanceSummaryTotals {
  expected_days: number;
  expected_minutes: number;
  present_days: number;
  late_minutes: number;
  late_penalty: number;
  credited_minutes: number;
  worked_effective_minutes: number;
  leave_minutes: number;
  annual_leave_days: number;
  out_of_office_minutes: number;
  total_minutes: number;
}

export interface AttendanceSummaryResponse {
  period: { from: string; to: string; working_days: number };
  rows: AttendanceSummaryRow[];
  totals: AttendanceSummaryTotals;
  settings: { late_grace_minutes: number; late_penalty_per_minute: number };
}

export type AttendanceCheckpointType = 'morning' | 'afternoon' | 'clock_out';

export interface AttendanceProjectCheckpoint {
  id: number;
  checkpoint_type: AttendanceCheckpointType;
  recorded_at: string;
  notes: string | null;
  projects: Array<{
    project_id: number;
    name: string;
  }>;
  /** Ирцээр сонгосон ЗАСВАРЫН төслүүд (миграц 0324) — `projects`-тэй id
   *  давхцдаг тул тусдаа жагсаалт. */
  repairs?: Array<{
    repair_project_id: number;
    name: string;
  }>;
}

/** Ирцийн popup-ийн «Засварын төсөл» хуудасны сонголт — `GET /attendance/my-status`
 *  `repair_projects`-оос (зөвхөн `status='active'`). */
export interface RepairProjectOption {
  id: number;
  name: string;
  description?: string | null;
}

/** Live attendance state for /attendance/status — used by the employee clock-in
 *  card to decide whether the "ирц бүртгэх" button is enabled and what the
 *  today/late banners look like. */
export interface AttendanceStatus {
  clocked_in: boolean;
  on_office_ip: boolean;
  /** Админ оффисын IP шалгалтыг асаасан эсэх.  false бол хаанаас ч бүртгэнэ. */
  require_office_ip?: boolean;
  client_ip: string | null;
  /** ӨНӨӨДӨР бодитоор үйлчилж буй ээлж (зуны албадлага тооцогдсон). */
  work_schedule: ScheduleKey;
  session: AttendanceSession | null;
  today?: string;
  schedule_label?: string;
  /** Тогтмол ээлж (user 69) — picker хаалттай. */
  schedule_locked?: boolean;
  /** Зуны албадлага (6–8 сар) идэвхтэй эсэх. */
  summer_forced?: boolean;
  /** Ажилтны СОНГОСОН ээлж — picker-ийн идэвхтэй товч.  `work_schedule`-аас
   *  зуны үед ЗӨРНӨ (сонголт нь 9-р сарын 1-нээс хүчинтэй). */
  schedule_selected?: ScheduleKey;
  /** Одоо сонголт хийвэл хэзээнээс хүчинтэй болох вэ (YYYY-MM-DD). */
  schedule_effective_from?: string;
  /** Ажлын цаг дараагийн удаа өөрчлөгдөх өдөр — «маргааш ч 08:00-д эхэлнэ»
   *  сануулгын эх сурвалж.  Өөрчлөлт хүлээгдэхгүй бол `null`. */
  schedule_change?: { schedule: ScheduleKey; date: string; label: string } | null;
  /** Сонгож болох ээлжүүд — шошго нь СЕРВЕРЭЭС (`ORG_SHIFT_*` тохиргоог
   *  дагана).  Хоосон/байхгүй бол UI өөрийн нөөц шошгыг ашиглана. */
  schedule_options?: Array<{ key: ScheduleKey; label: string; start: string; end: string }>;
  late_penalty_per_minute?: number;
  active_project_ids?: number[];
  /** Өнөөдөр ирцээр сонгосон засварын төслүүд (`repair_projects.id`). */
  active_repair_project_ids?: number[];
  /** Popup-д сонгож болох идэвхтэй засварын төслүүд. */
  repair_projects?: RepairProjectOption[];
  checkpoints?: AttendanceProjectCheckpoint[];
  next_checkpoint_prompt?: AttendanceCheckpointType | null;
}

/** Rolling 7-day summary returned alongside /attendance/my-sessions. */
export interface AttendanceWeekSummary {
  /** ISO yyyy-mm-dd of the week's first day (Mongolian/локал week start). */
  week_start: string;
  week_end: string;
  days_present: number;
  total_hours: number;
  late_minutes: number;
  late_penalty: number;
}

export interface AttendanceStats {
  period: { from: string; to: string };
  today: string;
  absent_today: {
    id: number;
    full_name: string;
    employee_id: string | null;
    profile_image: string | null;
  }[];
  on_leave_today?: {
    id: number;
    /** Чөлөөний хүсэлтийн id — Today tab-аас шууд цуцлахад хэрэглэнэ. */
    leave_id: number;
    full_name: string;
    employee_id: string | null;
    profile_image: string | null;
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
  }[];
  late_today: {
    user_id: number;
    full_name: string;
    profile_image?: string | null;
    clock_in: string;
    late_minutes: number;
    late_penalty: number;
  }[];
  late_totals_today?: { minutes: number; penalty: number };
  late_penalty_per_minute?: number;
  user_stats: {
    user_id: number;
    full_name: string;
    employee_id: string | null;
    profile_image: string | null;
    days_present: number;
    total_hours: number;
    avg_hours: number;
    earliest_clock_in: string;
    latest_clock_out: string | null;
    late_minutes?: number;
    late_penalty?: number;
  }[];
}

// ─────────────────────── Чөлөө ───────────────────────
export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'remote' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: number;
  user_id: number;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  /** Цагаар нарийвчилсан хүсэлт.  Хагас өдөр / 4 цаг / 2 цаг гэх мэт.
   *  null бол хуучин (өдөр-онд тулгуурласан) бичлэг. */
  hours: number | null;
  /** Optional time-of-day window for sub-day leaves (HH:MM). */
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  /** Дотоод журам MGL-HR/0124-ийн нарийвчилсан шалтгааны код
   *  (`wedding`, `bereavement_ub`, `unpaid` гэх мэт).  Хуучин бичлэг null. */
  reason_code: string | null;
  /** 1 = цалинтай, 0 = цалингүй, null = тодорхойгүй (хуучин бичлэг). */
  is_paid: number | null;
  attachment_url: string | null;
  status: LeaveStatus;
  reviewer_id: number | null;
  reviewer_note: string | null;
  decided_at: string | null;
  /** Цуцлалтын audit — анхны зөвшөөрлийн reviewer_* талбаруудаас тусдаа. */
  cancelled_by?: number | null;
  cancelled_at?: string | null;
  cancel_note?: string | null;
  /** Админ ажилтны өмнөөс шууд бүртгэсэн бол үүсгэгч (0102). */
  created_by?: number | null;
  /** Ирсэн цагаар богиносохоос ӨМНӨХ анхны утга (0364).  `arrival_orig_days`
   *  null = богиносоогүй; бусад талбар (start/end/hours/days) нь ҮР ДҮН. */
  arrival_orig_start_time?: string | null;
  arrival_orig_end_time?: string | null;
  arrival_orig_hours?: number | null;
  arrival_orig_days?: number | null;
  /** Ирсэн цагаар богиносгосон өдрүүд — backend `lib/leaveArrivalCut.ts`. */
  arrival_cuts?: LeaveArrivalCut[];
  created_at: string;
  updated_at: string;
  // joined
  full_name?: string;
  employee_id?: string | null;
  profile_image?: string | null;
  team_code?: string | null;
  reviewer_name?: string | null;
  canceller_name?: string | null;
  creator_name?: string | null;
  // enrich-аас орох талбарууд
  policy_warnings?: string[];
  requires_ceo_approval?: boolean;
}

/** Нэг өдрийн ирсэн цагаар богиносголт (`leave_arrival_cuts`, 0364). */
export interface LeaveArrivalCut {
  date: string;
  /** Ирсэн цаг 'HH:MM'. */
  arrival: string;
  /** Тэр өдрийн үлдсэн чөлөөний цонх. */
  start_time: string;
  end_time: string;
  full_minutes: number;
  used_minutes: number;
}

/** Яагаад чөлөөний хүсэлт илгээх боломжгүй байгаа шалтгаан. */
export type LeaveWindowReason = 'open' | 'weekend' | 'holiday' | 'before_shift' | 'after_shift';

/**
 * `GET /api/leaves/window` — чөлөөний хүсэлт илгээх ажлын цагийн цонх.
 * Backend `lib/leaveWindow.ts`-ийн `LeaveWindow`-тэй 1:1.  Амралтын өдөр
 * `holidays` хүснэгтэд байдаг тул клиент дангаараа тооцох боломжгүй.
 */
export interface LeaveWindow {
  open: boolean;
  reason: LeaveWindowReason;
  /** UB-ийн өнөөдөр (YYYY-MM-DD). */
  today: string;
  schedule: ScheduleKey;
  /** '09:00–18:00' гэх мэт. */
  shift_label: string;
  shift_start: string;
  shift_end: string;
  /** UB-ийн одоогийн цаг 'HH:MM'. */
  now: string;
  /** Бүтэн өдрийн чөлөөний хамгийн эрт эхлэх огноо — маргааш. */
  min_full_day_date: string;
  /** Цагаар авах чөлөөний хамгийн эрт эхлэх огноо — өнөөдөр. */
  min_timed_date: string;
  /** Өнөөдөр цагаар чөлөө авах бол хамгийн эрт эхлэх цаг 'HH:MM'. */
  min_time_today: string;
}

/** `GET /api/leaves/window?date=` — ТУХАЙН ӨДРИЙН ээлж.  `LeaveWindow`-ийн
 *  schedule/shift_* нь ӨНӨӨДРИЙНХ (зун бүгдийг 08:00 болгодог) тул
 *  ирээдүйн чөлөөнд ХЭРЭГЛЭЖ БОЛОХГҮЙ. */
export interface LeaveWindowForDate {
  date: string;
  schedule: ScheduleKey;
  shift_label: string;
  shift_start: string;
  shift_end: string;
  am: { start_time: string; end_time: string; hours: number };
}

// ─────────────────────── Санал хүсэлт ───────────────────────
/** Ажилтны санал хүсэлтийн явц (timeline-ийн 3 зангилаа):
 *  received = Хүлээж авсан, discussing = Хэлэлцэж байна,
 *  resolved = Шийдвэрлэгдсэн (resolution-оор тийм/үгүй). */
export type SuggestionStatus = 'received' | 'discussing' | 'resolved';
/** resolved үеийн шийдвэр: approved = тийм, rejected = үгүй. */
export type SuggestionResolution = 'approved' | 'rejected';

/** Санал хүсэлтэд хавсаргасан зураг (migration 0179).  `url` нь ҮРГЭЛЖ
 *  `/media/<key>` — сервер талд шалгагддаг.  Нэрээ нууцалсан саналын
 *  түлхүүрийг сервер `anon-<uuid>` болгож сольдог тул URL-аас илгээгчийг
 *  таних боломжгүй. */
export interface SuggestionImage {
  url: string;
  name: string;
}

/** Нэг саналд хавсаргах зургийн дээд тоо (backend-ийн MAX_IMAGES-тэй ижил). */
export const SUGGESTION_MAX_IMAGES = 10;

export interface Suggestion {
  id: number;
  /** Нэрээ нууцалсан бичлэгт admin тал руу NULL ирнэ. */
  user_id: number | null;
  /** 1 = ажилтан нэрээ нууцлан илгээсэн. */
  is_anonymous: number;
  title: string;
  description: string;
  status: SuggestionStatus;
  resolution: SuggestionResolution | null;
  reviewer_id: number | null;
  reviewer_note: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  /** Хавсаргасан зураг — хуучин бичлэгт `[]`. */
  images: SuggestionImage[];
  // joined (нууц бичлэгт admin талд NULL)
  full_name?: string | null;
  profile_image?: string | null;
  team_code?: string | null;
  reviewer_name?: string | null;
}

// ─────────────────────── Ажлаас гадуурх цаг ───────────────────────
/** Албан ажлаар оффисоос гадуур зарцуулсан цагийн шалтгааны ангилал.
 *  'other' үед `reason`-д гараар бичнэ. */
export type OutOfOfficeCategory =
  | 'author_supervision'
  | 'meeting'
  | 'documents'
  | 'drawings'
  | 'class'
  | 'other';
export type OutOfOfficeStatus = LeaveStatus;

export interface OutOfOfficeRequest {
  id: number;
  user_id: number;
  work_date: string;
  category: OutOfOfficeCategory;
  hours: number;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  attachment_url: string | null;
  status: OutOfOfficeStatus;
  reviewer_id: number | null;
  reviewer_note: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  full_name?: string;
  employee_id?: string | null;
  profile_image?: string | null;
  team_code?: string | null;
  reviewer_name?: string | null;
}

export interface TimesheetRow {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  team_code: string | null;
  team_name: string | null;
  position: string | null;
  days_present: number;
  total_hours: number;
  avg_hours: number;
  late_count: number;
  late_minutes: number;
  late_penalty: number;
  leave_total: number;
  leave_total_hours: number;
  leave_breakdown: Record<LeaveType, number>;
  leave_breakdown_hours: Record<LeaveType, number>;
  absent_days: number;
}

export interface TimesheetResponse {
  period: { from: string; to: string; working_days: number };
  rows: TimesheetRow[];
  late_penalty_per_minute?: number;
}

// ─────────────────────── Project passport / cover sheet ───────────────────────
/** One contact at the client (захиалагч) for project management. */
export interface ClientContact {
  full_name: string;
  position: string;
  phone: string;
  email: string;
}

/* ---------------------------------------------------------------
 * «PROJECT DESCRIPTION» Word загварын хүснэгтэн хэсгүүд (миграц 0247)
 * ---------------------------------------------------------------
 * ⚠️ backend `routes/projects.ts`-ийн `PassportScopeRow` /
 * `PassportTimelineRow` / `PassportMeetingRow`-той ИЖРҮҮД.  Талбарын нэр
 * зөрвөл JSON дээр тип шалгалт байхгүй тул чимээгүй хоосорно.
 *
 * ⚠️ `features/performance-reports/types/introOverride.ts`-ийн
 * `IntroScopeRow` / `IntroTimelineRow` / `IntroMeetingRow`-той БҮТЦЭЭР
 * ижил байх ёстой — тайлан эдгээрийг шууд авч ашиглана. */

/** «1.2 Scope of work / Хамрах хүрээ» хүснэгтийн мөр. */
export interface ProjectScopeRow {
  id: string;
  /** Дисциплины машины код (BA, BB…). Гараар бичсэн мөр дээр хоосон байж болно. */
  code: string;
  /** Харагдах шошго («БА»). Хоосон бол `code`-оос гарна. */
  codeLabel: string;
  identification: string;
  /** «Team leader» — багийн ахлах. */
  leader: string;
  /** «Хариуцсан мэргэжилтэн» — жишиг баримтын 2 дахь нэрийн багана. */
  specialist: string;
  fileName: string;
}

/** «1.3 Project Timeline» зүүн хүснэгтийн мөр.
 *  `id` нь ачаалал үүрсэн: `tl-start` / `tl-finish` / `tl-ext*` мөрүүд
 *  серверт `start_date` / `finish_date` / `extension_date` БАГАНА руу
 *  буудаг (тэдгээрийг deadlines.ts, company.ts SQL-ээр уншдаг). */
export interface ProjectTimelineRow {
  id: string;
  labelEn: string;
  labelMn: string;
  date: string;
}

/** «1.3 Meeting schedule / Уулзалтын хуваарь» баруун хүснэгтийн мөр. */
export interface ProjectMeetingRow {
  id: string;
  label: string;
  date: string;
}

export interface ProjectPassport {
  project_id: number;
  full_title: string | null;
  drawing_no: string | null;
  /** «Doc. No.» — БҮХЭЛД НЬ гараар бичигдэх чөлөөт текст (миграц 0246).
   *  `drawing_no` (Зургийн шифр) нь ӨӨР талбар; тайлангийн хуудасны
   *  толгойд хоёулаа хэвлэгдэнэ. */
  doc_no: string | null;
  scope: string | null;
  director: string | null;
  /** @deprecated single-line legacy field — replaced by `client_contacts`. */
  client_pm: string | null;
  start_date: string | null;
  finish_date: string | null;
  extension_date: string | null;
  /** @deprecated meeting schedule has been removed from the UI. */
  meeting_30: string | null;
  /** @deprecated meeting schedule has been removed from the UI. */
  meeting_50: string | null;
  /** @deprecated meeting schedule has been removed from the UI. */
  meeting_100: string | null;
  /** List of discipline codes (e.g. ['BA','BB','HAS']). */
  disciplines: string[];
  /** Multi-row replacement for `client_pm`. */
  client_contacts: ClientContact[];
  /** Word загварын «1.2 Хамрах хүрээ» (миграц 0247). */
  scope_rows: ProjectScopeRow[];
  /** «1.3 Төслийн хугацаа» — зүүн хүснэгт (0247).  `start_date` /
   *  `finish_date` / `extension_date` баганууд ҮҮНЭЭС гардаг. */
  timeline: ProjectTimelineRow[];
  /** «1.3 Уулзалтын хуваарь» — баруун хүснэгт (0247). */
  meetings: ProjectMeetingRow[];
  notes: string | null;
  updated_at: string;
  updated_by_id: number | null;
}

export type ClientDocStatus = 'pending' | 'provided' | 'not_required';

export interface ProjectClientDocument {
  id: number;
  project_id: number;
  sort_order: number;
  doc_name: string;
  doc_no: string | null;
  doc_date: string | null;
  source: string | null;
  description: string | null;
  status: ClientDocStatus;
  provided_at: string | null;
  provided_by_id: number | null;
  provided_by_name?: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Технийн нөхцөл — engineering parameters for a project (water
 *  pressure, soil class, max power, etc.).  Same UX as the client
 *  documents list above but stripped of status/provided fields since
 *  these rows are spec values rather than deliverables. */
export interface ProjectTechCondition {
  id: number;
  project_id: number;
  sort_order: number;
  title: string;
  value: string | null;
  description: string | null;
  condition_date: string | null;
  created_at: string;
  updated_at: string;
}

/* =============================================================
 * Project status report (явцын тайлан)
 * -------------------------------------------------------------
 * Захиалагч / гэрээ / явц / санхүүжилтийн нэгдсэн нэг хуудаст
 * тайлан + олон "Явцын мэдээ" (timestamped notes with attachments).
 * Зөвхөн дотоодын баг л үздэг (захиалагчид зориулагдаагүй).
 * ============================================================= */
export interface FundingMilestone {
  /** Тулбөрийн нөхцөл, ж: "Гэрээ байгуулсны дараа" */
  label: string;
  /** 0–100 хувь */
  percent: number | null;
  /** Авсан / гүйцэтгэгдсэн эсэх */
  done: boolean;
  /** Хэрэв тэмдэглэх бол авсан огноо (ISO yyyy-mm-dd) */
  received_at?: string | null;
}

export interface ProjectStatusReport {
  project_id: number;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contract_start: string | null;
  contract_end: string | null;
  /** Хуучин текст талбарууд — UI ашиглахаа больсон, зөвхөн нийцлийн төлөө. */
  work_progress?: string | null;
  funding_terms?: string | null;
  funding_percent?: number | null;
  /** Шинэ хувилбар — олон мөртэй санхүүжилтийн жагсаалт. */
  funding_milestones: FundingMilestone[];
  nema_note: string | null;
  health_note: string | null;
  bdc_experts_note: string | null;
  bdc_review_note: string | null;
  /** Гадны байгууллага бүрийн "хийгдсэн" төлвийн checkbox-ууд. */
  nema_done: boolean;
  health_done: boolean;
  bdc_experts_done: boolean;
  bdc_review_done: boolean;
  notes: string | null;
  updated_at: string;
  updated_by_id: number | null;
}

export interface ProgressNoteAttachment {
  url: string;
  name: string;
}

export interface ProjectProgressNote {
  id: number;
  project_id: number;
  title: string;
  body: string | null;
  attachments: ProgressNoteAttachment[];
  created_by_id: number | null;
  author_name?: string | null;
  author_image?: string | null;
  created_at: string;
  updated_at: string;
  category?: 'mgl' | 'client';
}

/* ----- Dashboard calendar / announcements --------------------------------- */

export type CalendarPriority = 'normal' | 'high' | 'urgent';

export interface CalendarEvent {
  id: number;
  event_date: string;
  title: string;
  /** Optional short one-liner shown above the longer message body. */
  summary: string | null;
  message: string | null;
  task_id: number | null;
  task_name: string | null;
  /** Legacy single-team column — no longer populated (migration 0100). */
  team_id: number | null;
  /** Comma-separated team codes / ids / names this event targets, from
   *  the calendar_event_teams junction.  null = company-wide (no teams).
   *  Use `.split(',')` to render chips / load the editor. */
  team_codes: string | null;
  team_ids_csv: string | null;
  team_names: string | null;
  priority: CalendarPriority;
  /** Optional time-of-day window (HH:MM, 24h).  Both null = whole-day. */
  start_time: string | null;
  end_time: string | null;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  acknowledged: 0 | 1;
}

export interface CalendarAck {
  user_id: number;
  full_name: string;
  username: string;
  team_code: string | null;
  acknowledged_at: string;
}

/* ----- Leaderboard / performance scoring --------------------------------- */

/**
 * Linked pricing quote summary returned alongside `GET /api/projects/:id`.
 * Drives the leaderboard's project-value calculation; null when the
 * project has no quote attached (in which case approval is blocked — Q4).
 */
/**
 * Per-project complexity tier.  Drives employee performance scoring:
 * each tier maps to a percent weight (low=25, mid=50, high=75, special=100).
 * A progress submission awards `complexity_pct × Δpct / 100` percent
 * points, split evenly across the task's eligible assignees.
 */
export type ProjectComplexity = 'low' | 'mid' | 'high' | 'special';

/**
 * One award row.  `amount` is now percentage points (no money) and is
 * always visible to the row's owner.
 */
export interface UserPoint {
  id: number;
  user_id: number;
  project_id: number;
  project_name?: string | null;
  project_complexity_pct?: number | null;
  task_id: number | null;
  task_name?: string | null;
  points: number;
  delta_pct: number;
  assignee_count?: number;
  awarded_at: string;
  awarded_by?: number | null;
}

/** One row in the per-project correspondence log
 *  (`GET /api/correspondence/projects/:id`).  Staff log emails exchanged
 *  with the client; clients on the project see the same list read-only. */
export interface CorrespondenceEntry {
  id: number;
  project_id: number;
  author_id: number;
  author_name?: string | null;
  /** YYYY-MM-DD — date the email was actually sent / received. */
  log_date: string;
  /** 'sent' = бид → үйлчлүүлэгч, 'received' = үйлчлүүлэгч → бид. */
  direction: 'sent' | 'received';
  subject: string;
  body: string | null;
  attachment_url: string | null;
  /** Email(s) the message was sent FROM. Free-form — may contain
   *  `Name <addr>` syntax or a comma/newline separated list, pasted
   *  verbatim from the user's email client. */
  from_email: string | null;
  /** Email(s) the message was sent TO. Same free-form rules as
   *  `from_email`. */
  to_email: string | null;
  /** Хуулбарласан хүлээн авагчид (CC / BCC). Free-form list. */
  cc_emails: string | null;
  /** Construction document classification (migration 0087). Null on legacy
   *  rows and on entries logged before the Gmail integration. */
  doc_type: 'rfi' | 'cr' | 'official' | 'mr' | null;
  /** Optional human reference like RFI-001. */
  ref_no: string | null;
  /** Source Gmail message this was triaged from, if any. */
  email_message_id: number | null;
  /** Author signature image (/media/ key), optional. */
  signature_url?: string | null;
  /** Захиалагчийн гарын үсэг (migration 0335).  `none` → `pending` (ажилтан
   *  хүсэлт тавьсан) → `signed` (захиалагч порталд зурсан, ЭЦСИЙН — агуулга
   *  түгжигдэнэ).  Зөвхөн `doc_type = rfi | cr`. */
  sign_status?: 'none' | 'pending' | 'signed';
  sign_requested_at?: string | null;
  sign_requested_by?: number | null;
  client_signed_at?: string | null;
  client_signed_by?: number | null;
  /** Зурсан мөчийн нэрийн хуулбар. */
  client_signer_name?: string | null;
  pdf_generated_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Admin-tier full leaderboard row (workers receive 403 on the endpoint). */
export interface LeaderboardEntry {
  user_id: number;
  full_name: string;
  username: string;
  role: UserRole;
  profile_image: string | null;
  total_points: number;
  projects: number;
  award_count: number;
  last_awarded_at: string | null;
}

/** Admin-tier averaged leaderboard row.  Returned by
 *  `GET /api/leaderboard/averages?days=N` and used by the dedicated
 *  Leaderboard page.  All `*_points` / `avg_*` fields are бүтээмж % (percentage points). */
export interface LeaderboardAveragesEntry {
  user_id: number;
  full_name: string;
  username: string;
  role: UserRole;
  profile_image: string | null;
  position: string | null;
  employee_id: string | null;
  team_code: string | null;
  team_name: string | null;
  /** Бүтээмж — хүний АЖИЛЛАСАН өдрөөр: батлагдсан чөлөөт ажлын өдрийг алгасаж
   *  өмнөх ажлын өдрүүдээр нөхсөн (backend lib/leaveAvailability.ts). */
  total_points: number;
  /** Хуанлийн цонхонд бодитоор олгогдсон (чөлөөгүй бол `total_points`-тэй ижил). */
  total_points_actual: number;
  /** Өдрийн дундаж — АЖИЛЛАСАН өдрийн (backend lib/dailyAverage.ts): сүүлийн
   *  `avg_target` (30 хоног = 21) ажлын өдөр; шинэ ажилтан ажилд орсноос хойшхи
   *  `avg_days` өдрөөрөө, батлагдсан чөлөө алгасагдана. */
  avg_daily: number;
  /** Хуваарь — тоологдсон ажлын өдөр (`< avg_target` = шинэ ажилтан). */
  avg_days: number;
  avg_target: number;
  avg_weekly: number;
  avg_monthly: number;
  /** Алгассан батлагдсан чөлөөт ажлын өдөр. */
  leave_days: number;
  projects: number;
  award_count: number;
  last_awarded_at: string | null;
}

export interface LeaderboardAveragesResponse {
  entries: LeaderboardAveragesEntry[];
  window_days: number;
}

/** «Сарын тайлан» табын нэг мөр — нэг хүний нэг хуанлийн сарын ажил.
 *
 *  `pct_added` = тухайн сард таскийн явцыг ахиулсан нийт хувь (өмнөх
 *  бүртгэлээс хойшхи зөрүүний нийлбэр), `points` = бүтээмж (user_points).
 *  Эхнийх нь АЖИЛЛАСАН огноогоор, сүүлийнх нь ОЛГОГДСОН огноогоор
 *  тооцогддог тул сарын зааг дээр өдрийн зөрүү гарч болно. */
export interface LeaderboardMonthlyEntry {
  user_id: number;
  full_name: string;
  username: string;
  role: UserRole;
  profile_image: string | null;
  position: string | null;
  team_code: string | null;
  team_name: string | null;
  reports: number; // ахиц бүртгэсэн тоо
  tasks: number; // хөндсөн таскийн тоо
  completed: number; // 100% болгож дуусгасан таск (батлагдсан)
  pct_added: number; // бөглөсөн хувийн нийлбэр
  projects: number; // хөндсөн төслийн тоо
  active_days: number; // ажлаа бүртгэсэн өдрийн тоо
  points: number; // бүтээмж (%)
  award_count: number;
}

export interface LeaderboardMonthlyResponse {
  month: string; // YYYY-MM
  entries: LeaderboardMonthlyEntry[];
}

/** Нэг хүний сарын задаргаа — цуваа + сонгосон сарын таскийн жагсаалт. */
export interface LeaderboardMonthlyUserResponse {
  user_id: number;
  full_name: string;
  username: string;
  role: UserRole;
  profile_image: string | null;
  position: string | null;
  team_code: string | null;
  team_name: string | null;
  month: string;
  months: number;
  series: Array<{
    month: string;
    reports: number;
    tasks: number;
    completed: number;
    pct_added: number;
    points: number;
  }>;
  tasks: Array<{
    task_id: number;
    task_name: string;
    drawing_name: string | null;
    block_name: string | null;
    project_id: number;
    project_name: string;
    reports: number;
    pct_added: number;
    end_pct: number; // сард хүрсэн хамгийн өндөр хувь
    last_date: string;
  }>;
  month_points: number;
  month_award_count: number;
}

/** Нэг хүний өдрийн цуваа — «Хандлага» табын графикуудад.  Бүх массив
 *  `dates`-тэй ижил урттай (өсөхөөр, сүүлийнх = UB-ийн өнөөдөр). */
export interface LeaderboardUserSeriesResponse {
  user_id: number;
  full_name: string;
  role: UserRole;
  profile_image: string | null;
  team_code: string | null;
  team_name: string | null;
  days: number;
  dates: string[];
  points: number[]; // өдрийн бүтээмж (%)
  late_minutes: number[]; // өдрийн хоцролт (мин)
  hours: number[]; // өдрийн ажилласан цаг
  present_days: number; // хугацаанд ирсэн өдрийн тоо
}

/** "My stats" — what every authenticated user can fetch about themselves. */
export interface MyLeaderboardStats {
  rank: number | null;
  total_workers: number;
  /** Сүүлийн 30 хоног — батлагдсан чөлөөт ажлын өдрийг алгасаж өмнөх ажлын
   *  өдрүүдээр нөхсөн. */
  total_points: number;
  /** 30 хуанлийн хоногт бодитоор олгогдсон. */
  total_points_actual: number;
  /** Алгассан батлагдсан чөлөөт ажлын өдөр. */
  leave_days: number;
  award_count: number;
  recent: Array<{
    id: number;
    project_id: number;
    project_name: string | null;
    project_complexity_pct: number | null;
    task_id: number | null;
    task_name: string | null;
    points: number;
    delta_pct: number;
    awarded_at: string;
  }>;
}

/** Daily series for the caller — used by the dashboard sparkline.
 *  One row per day in the window even if zero, so chart never has gaps. */
export interface MyDailySeries {
  days: number;
  series: Array<{
    date: string; // YYYY-MM-DD (UTC)
    points: number; // per-day delta in percent points
    cum_points: number; // running cumulative
    n: number; // award count that day
  }>;
  total_points: number;
}

/** One point on the project-wide progress-over-time line. */
export interface ProgressTimeseriesPoint {
  date: string; // YYYY-MM-DD
  progress: number; // overall weighted project progress (0–100) as of `date`
}

/** Daily activity row for the project "Графикууд" tab. */
export interface ProjectActivityPoint {
  date: string;
  entry_count: number;
  contributor_count: number;
  avg_percentage: number; // average logged % that day (drives the red/amber/green bar)
}

/** Daily headcount: distinct people who declared this project on their
 *  attendance checkpoint that day (volume-style pane under the main chart). */
export interface ProjectHeadcountPoint {
  date: string;
  count: number;
}

/** A milestone marker on the progress line (e.g. an issued performance report). */
export interface ProjectMilestone {
  date: string;
  label: string;
}

/** Payload for GET /api/projects/:id/charts/timeseries — three series
 *  in one round-trip (overall curve, per-team curves, daily activity). */
export interface ProjectChartsTimeseries {
  from: string;
  to: string;
  days: number | null; // null = full history (range toggle "Бүгд")
  overall: ProgressTimeseriesPoint[];
  teams: {
    /** Discipline teams present on the project, in display order, with
     *  per-team stats for the fullscreen watchlist. */
    teams: Array<{
      code: string;
      name: string;
      taskCount: number;
      doneCount: number;
      memberCount: number;
      /** Assignee names on this team's tasks (for the hover tooltip). */
      members: string[];
    }>;
    /** Wide table: one row per date, one numeric column per team code. */
    points: Array<Record<string, number | string>>;
  };
  activity: ProjectActivityPoint[];
  /** Daily on-site headcount (volume-style pane under the progress chart). */
  headcount: ProjectHeadcountPoint[];
  /** Milestone markers (issued performance reports) on the progress line. */
  milestones: ProjectMilestone[];
  /** Planned schedule (project passport) for the required-daily-pace panel. */
  schedule: { start_date: string | null; finish_date: string | null };
  /** Management cockpit signals: overdue tasks, approval backlog, last activity. */
  health: { overdue: number; pending: number; last_activity_date: string | null };
  /** Per-team, per-day worker names for the period-windowed watchlist:
   *  `progress` = who logged task progress; `attendance` = who declared the
   *  project (bucketed by their own team). */
  teamWorkers: {
    progress: Array<{ team: string; date: string; name: string }>;
    attendance: Array<{ team: string; date: string; name: string }>;
  };
  /** Ажлын бус өдрүүд (баяр) — компанийн календарь (`holidays` хүснэгт).
   *  Амралтын өдөртэй хамт candle-ийн "улбар шар" логикийг тодорхойлно. */
  holidays: string[];
}

/** Компанийн нэгдсэн баярын / ажлын бус өдрийн календарийн нэг бичлэг. */
export interface Holiday {
  id: number;
  date: string; // yyyy-mm-dd
  name: string;
  created_by: number | null;
  created_at: string;
}

/** One approved progress ENTRY on a project + discipline team — row shape from
 *  `GET /api/projects/:id/charts/team-tasks?team=CODE[&from=&to=]`. Each row is
 *  one submission: who logged it, on which task, which day, and from what % to
 *  what % (the per-day delta). The charts-tab dialog groups these by `user_id`
 *  (the submitter). Teams are mapped by drawing-name prefix (same as the team
 *  curves) so the set matches the watchlist row. `from`/`to` scope it to the
 *  watchlist's selected period (exclusive from, inclusive to). */
export interface ProjectTeamTaskRow {
  user_id: number;
  full_name: string;
  profile_image: string | null;
  role: UserRole;
  position: string | null;
  task_id: number;
  task_name: string;
  component_name: string;
  drawing_name: string;
  /** Day this entry was logged (YYYY-MM-DD). */
  date: string;
  /** Task percent immediately before this entry (0 if first). */
  from_pct: number;
  /** Task percent this entry set it to. */
  to_pct: number;
}

export interface ProjectTeamTasksResponse {
  team_code: string;
  rows: ProjectTeamTaskRow[];
}

/* ── Company-wide charts (TV wallboard) — GET /api/company/charts/timeseries ──
 * The company-level analogue of ProjectChartsTimeseries: a work-weighted
 * "index" candle, a per-project watchlist, per-discipline "sector" lines,
 * plus headcount/activity volume. */

/** One row of the company project "watchlist". */
export interface CompanyProjectRow {
  id: number;
  name: string;
  progress: number; // latest % in the window
  change: number; // last − first across the window (▲/▼)
  series: ProgressTimeseriesPoint[]; // sparkline
  finish_date: string | null;
  days_left: number | null;
  headcount_today: number;
  task_count: number;
  /** Төслийн ангилал (AZ/ZA/ET/EZ/IZ).  2026-08-25-нд нэмэгдсэн тул НЭМЭЛТ:
   *  worker-ийн шинэ хувилбар тарихаас өмнө Pages гарвал талбар ирэхгүй. */
  category?: string | null;
}

export interface CompanyChartsTimeseries {
  from: string;
  to: string;
  days: number | null; // null = full history
  /** Work-weighted company completion % per date — the index candle source. */
  overall: ProgressTimeseriesPoint[];
  /** Work-weighted straight-line planned position (gold reference line). */
  planned: ProgressTimeseriesPoint[];
  teams: {
    teams: Array<{
      code: string;
      name: string;
      /** ⚠ 2026-08-25-ны нэмэлт — worker тарихаас өмнө Pages гарвал ирэхгүй.
       *  «Багуудын явц» кадар эдгээрийг «132 / 214 даалгавар дууссан» болгож
       *  гаргадаг: хувь ганцаараа юуны хувь болох нь ойлгогддоггүй. */
      task_count?: number;
      done_count?: number;
    }>;
    points: Array<Record<string, number | string>>;
  };
  projects: CompanyProjectRow[];
  /** Daily company headcount (distinct attendance) — the "volume" pane. */
  headcount: ProjectHeadcountPoint[];
  /** ⚠ `ProjectActivityPoint` БИШ: компанийн хувилбар нь `avg_percentage`-ыг
   *  буцаадаггүй (`lib/companyTimeseries.ts`-ийн activity SQL-ийг үз).  Тэр
   *  төрлийг зээлбэл байхгүй талбар байгаа мэт харагдаж, `.toFixed()` дуудвал
   *  ажиллах үедээ л унана. */
  activity: Array<{ date: string; entry_count: number; contributor_count: number }>;
}

/** Per-project contributor row (admin tier sees all, worker sees own). */
export interface ProjectContributor {
  user_id: number;
  full_name: string;
  username: string;
  role: string;
  profile_image: string | null;
  total_points: number;
  /** Энэ хүний биечлэн гүйцэтгэсэн ТӨСЛИЙН ХУВЬ (user_points.delta_pct-ийн
   *  нийлбэр).  Бүх хувь нэмрийнх нь нийлбэр төслийн нийт явцтай тэнцэнэ. */
  project_pct: number;
  award_count: number;
  last_awarded_at: string | null;
}

export interface ProjectLeaderboardAdmin {
  contributors: ProjectContributor[];
  project_complexity_pct: number | null;
  /** Бүх хувь нэмрийн нийлбэр — «эзлэх хувь»-ийн туузны хуваарь. */
  project_total_pct: number;
}

export interface ProjectLeaderboardWorker {
  me: {
    user_id: number;
    total_points: number;
    project_pct: number;
    award_count: number;
    rank: number | null;
    total_contributors: number;
  };
  project_total_pct: number;
}

/** Server response shape for the toast on a successful submit. */
export interface PointsAwarded {
  delta_pct: number;
  complexity: ProjectComplexity;
  complexity_pct: number;
  total_points: number;
  per_user: number;
  recipients: Array<{
    user_id: number;
    full_name: string;
    points: number;
  }>;
}
