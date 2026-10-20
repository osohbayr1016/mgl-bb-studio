/** Shared row/entry types for the ProjectDetailPage tree.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import type { AssigneeInfo, DrawingProgress, TaskProgress } from '@/shared/types';

export type FlatTask = {
  id: number;
  /** ТОГТВОРТОЙ дугаар (2026-10-02): төслийн бүтцийн дарааллаар 1, 2, … 17.  Шүүлтүүр, эрэмбэ, багийн pill-ээс ХАМААРАХГҮЙ —
   *  `allTasks`-ийн (шүүгдээгүй) байрлалаас.  Хэсэг (хуваарилалт) нь `17.1`, `17.2` … (`allocation.ts` `childLabel`). */
  number: number;
  block: string;
  drawing: string;
  component: string;
  name: string;
  assigned_name: string | null;
  /** Хуучин скаляр хариуцагч (tasks.assigned_to) — `assignees`-тэй давхар
   *  шалгана, учир нь зарим хуучин мөр зөвхөн үүнийг л тээдэг. */
  assigned_to: number | null;
  assignees: AssigneeInfo[];
  teamCode: string | null;
  /** Task weight on the team scale (sums to drawing.weight_percent inside a
   *  drawing, or to 100 across an entire block). After dropping the subtask
   *  layer this is the single per-task weight stored in the DB. */
  weight_percent: number;
  /** Same as weight_percent — kept under the old name for the legacy
   *  "Зурагт %" column header. Sums to drawing.weight_percent inside a
   *  drawing (i.e., it's "% of block"). */
  leafWeight: number;
  /** Drawing-relative share = leafWeight × 100 / drawingWeight. This is
   *  what the "Зураг %" column should display so it matches the editor on
   *  the Project Setup page (where 2.5% means "2.5 % of the BA drawing").
   *  Falls back to 0 when the parent drawing has no weight assigned. */
  drawingShare: number;
  /** Block weight as % of the project. */
  blockWeight: number;
  /** Drawing weight as % of its block (informational only — not used in the
   *  project-share calc since task weight is already team-scaled). */
  drawingWeight: number;
  /** Project-wide weight contribution = block × task / 100. */
  projectShare: number;
  progress: number;
  /** Schedule dates (ISO yyyy-mm-dd or null). Surfaced as the inline date
   *  editor under the task name in the overview tables and drive the
   *  Хуваарь (Gantt) timeline tab. */
  start_date: string | null;
  due_date: string | null;
  /** AI-generated summary cached when the task hits 100% (see
   *  backend/src/lib/taskCompletionAi.ts). Only present for done tasks. */
  ai_completion_summary: string | null;
  ai_completion_summary_at: string | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
};

/** Props threaded from `ProjectDetailPage` down through the task tables into
 *  the individual rows.  2026-10-01: хүнд оноох / буцаах / хуваалцах props
 *  ХАСАГДСАН — «Одоо хийж буй» нэр ба «Өөртөө авах» нь `TaskLiveContext`-оос
 *  (`taskLive.tsx`). */
export type TaskActionProps = {
  /** engineer / architect / senior / CEO — таск авч ажилладаг ролиуд. */
  canClaimRole: boolean;
  /** admin + senior (`canManageProjectWork`) — огноо засах, хуваах. */
  isAdmin: boolean;
  currentUserId: number | null;
  currentUserTeam: string | null;
  /** Цагаар бодогддог засварын төсөл (`progress_mode = 'hours'`, 0339).
   *  Тийм бол таскийн мөрөнд Зураг % / Төсөл % / Явц БАЙХГҮЙ — оронд нь
   *  АЖИЛЛАСАН ЦАГ (2026-09-24).  Ердийн төсөлд undefined → хуучин харагдац. */
  hoursMode?: boolean;
  /** task_id → ажилласан цаг + хүмүүс (`GET /api/repair/hours`, 0341). */
  taskHours?: ReadonlyMap<number, TaskHoursInfo>;
};

/** Нэг таскийн ажилласан цаг — «А — 3 цаг, Б — 5 цаг». */
export type TaskHoursInfo = {
  hours: number;
  people: { user_id: number; full_name: string; hours: number }[];
};

export type TaskRowProps = TaskActionProps;

export type FlatBlockTask = {
  task: TaskProgress;
  drawing: DrawingProgress;
  componentName: string;
};

export type ActivityEntry = {
  id: number;
  user_id: number;
  task_id: number | null;
  percentage: number;
  date: string;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  is_rest_day: 0 | 1;
  created_at: string;
  reviewed_at: string | null;
  user_name: string;
  user_team_code: string | null;
  task_name: string | null;
  drawing_name: string | null;
  block_name: string | null;
  block_id: number | null;
  reviewer_name?: string | null;
};
