/**
 * АЛБАН ЁСНЫ ТАСКИЙН ЦАГ ХЭМЖИГЧ (OFFICIAL_TASK_TIMER) — клиентийн төрөл, цэвэр туслахууд.
 * Backend: `backend/src/routes/taskTimer.ts`, `lib/taskTimer.ts` (migration 0361).
 *
 * ⚠️ Canonical цаг нь СЕРВЕРИЙН сэшнүүд.  Энд ганц ч секунд «тоологддоггүй» —
 *    харагдах утга = серверийн дууссан нийлбэр + (серверийн одоо − эхэлсэн цаг),
 *    серверийн одоог `server_now` ба хөтчийн цагийн зөрүүгээр тооцно.
 * ⚠️ Revit-ийн автомат цаг (REVIT_ACTIVE_TIME) энд ОГТ байхгүй — нэр бүр
 *    `official_` угтвартай, хоёр систем холилдохгүй.
 *
 * 2026-10-01 (эзэн, migration 0368): таймер эхлүүлэх = таскийг «Өөртөө авах».
 * Таск дээрх НЭР = таймер нь ОДОО явж буй хүн (`GET /task-timer/working`).
 * Таскийг төслийн хуудаснаас ЭСВЭЛ «Миний ажлууд»-аас (0370: «Миний ажилд нэмэх»-ээр нэмсэн
 * таск) эхлүүлнэ — хоёулаа `useTakeTask` → `/task-timer/start`.  Товч нь ▶ / ⏸ дүрс
 * (эзэн 2026-10-01 — 09-29-ний «бичигтэй товч» шийдвэрийг сольсон; `TaskTimerControl`).
 * Цайны цонхонд (13:00–14:00) цаг тоологдохгүй — `stopwatch.ts` `countedMs`.
 */

export interface OfficialRunning {
  session_id: number;
  task_id: number;
  task_name: string | null;
  project_id: number | null;
  project_name: string | null;
  started_at: string;
}

/** Цайны цонх (эзэн 2026-10-01) — ирцийн тохиргоо; энэ хооронд албан цаг тоологдохгүй.
 *  `stopwatch.ts` `lunchRuleOf` уншина.  null = ирцэд цайг унтраасан. */
export interface LunchWire {
  start_min: number;
  end_min: number;
  from: string;
  offset_min: number;
}

export interface OfficialTimerState {
  outcome?: 'started' | 'switched' | 'already_running' | 'paused' | 'not_running';
  server_now: string;
  date: string;
  day_start: string;
  day_end: string;
  /** Хуучин worker (deploy-ийн завсар) бол байхгүй — тэр үед цай хасагдахгүй. */
  lunch?: LunchWire | null;
  running: OfficialRunning | null;
  tasks: Array<{ task_id: number; official_closed_ms: number; sessions: number }>;
  official_today_closed_ms: number;
  today_by_task: Array<{ task_id: number; official_closed_ms: number }>;
}

export interface OfficialLiveRow {
  user_id: number;
  full_name: string | null;
  username: string;
  role: string;
  profile_image: string | null;
  running: (OfficialRunning & { official_task_closed_ms: number }) | null;
  official_today_closed_ms: number;
  last_stop: {
    at: string;
    reason: string | null;
    /** 0368: clock_out | day_end | admin_stop | split | null. */
    note?: string | null;
    task_id: number;
    task_name: string | null;
  } | null;
}

/** Таск дээр ОДОО ажиллаж буй хүн (`GET /task-timer/working`) — нэр л, цаг БИШ. */
export interface TaskWorker {
  task_id: number;
  user_id: number;
  full_name: string | null;
  profile_image: string | null;
}

/** «Өөртөө авах» 409 TASK_OCCUPIED — хуваах цонхны серверийн өгөгдмөл. */
export interface TakeOccupied {
  /** `working` = өөр хүн ОДОО ажиллаж байна; `progress` = өөр хүн аль хэдийн хувь оруулсан (хуучин сервер илгээхгүй → `working`). */
  reason?: 'working' | 'progress';
  workers: Array<{ user_id: number; full_name: string | null }>;
  split: {
    weight_percent: number;
    progress: number;
    done_weight: number;
    split_total: number;
    default_weights: number[];
  };
}

/** «Өөртөө авах» 409 NOT_ALLOCATED (2026-10-02): хуваарилагдсан таск дээр миний ирээдүйн ажил алга. */
export interface NotAllocatedInfo {
  /** Хуваарилагдаагүй чөлөөт ажил (нэгжээр, 1% = 10 000). */
  available_units: number;
  /** Миний хүчинтэй хийсэн хэсэг (нэгжээр). */
  my_done_units: number;
  /** Миний буцаасан ажил (нэгжээр). */
  released_units: number;
  /** Надад энэ таск дээр хуваарилалтын мөр (түүх) байгаа эсэх. */
  has_row: boolean;
}

export type TakeResult =
  | { ok: true; outcome: OfficialTimerState['outcome']; progress: number }
  | {
      ok: false;
      code: string | undefined;
      message: string | undefined;
      occupied: TakeOccupied | null;
      allocation: NotAllocatedInfo | null;
    };

export interface OfficialLiveResponse {
  server_now: string;
  date: string;
  day_start: string;
  day_end: string;
  lunch?: LunchWire | null;
  rows: OfficialLiveRow[];
}

/** `GET /api/task-timer/report` — Тайлан хуудасны «Таскийн цаг» таб (зөвхөн admin). */
export interface OfficialReportRow {
  user_id: number;
  full_name: string | null;
  username: string;
  role: string;
  profile_image: string | null;
  running: boolean;
  official_ms: number;
  active_days: number;
  sessions: number;
  tasks: number;
}

export interface OfficialReportProject {
  project_id: number | null;
  project_name: string | null;
  official_ms: number;
  people: number;
  tasks: number;
}

export interface OfficialReportResponse {
  server_now: string;
  date: string;
  window: string;
  anchor: string;
  from: string;
  to: string;
  rows: OfficialReportRow[];
  projects: OfficialReportProject[];
  totals: { official_ms: number; sessions: number; active_people: number; people: number };
}

export const OFFICIAL_TIMER_STATE_KEY = ['/task-timer/state'] as const;
export const OFFICIAL_TIMER_LIVE_KEY = ['/task-timer/live'] as const;
/** `['/task-timer/working', projectId]` — төслийн «Одоо хийж буй». */
export const OFFICIAL_TIMER_WORKING_KEY = '/task-timer/working' as const;

/** Серверийн алдааны код → i18n түлхүүр. */
export function timerErrorKey(code: string | undefined): string {
  switch (code) {
    case 'TASK_NOT_FOUND':
      return 'taskTimer.errTaskNotFound';
    case 'NOT_ASSIGNED':
      return 'taskTimer.errNotAssigned';
    case 'TASK_COMPLETED':
      return 'taskTimer.errTaskCompleted';
    case 'PROJECT_INACTIVE':
      return 'taskTimer.errProjectInactive';
    case 'ROLE_NOT_ALLOWED':
      return 'taskTimer.errRole';
    case 'NOT_CLOCKED_IN':
      return 'taskTimer.errNotClockedIn';
    case 'TASK_OCCUPIED':
      return 'taskTimer.errOccupied';
    case 'TAKE_REQUIRED':
      return 'taskTimer.errTakeRequired';
    case 'SPLIT_DONE':
      return 'taskTimer.errSplitDone';
    case 'NOT_ALLOCATED':
      return 'taskTimer.errNotAllocated';
    case 'MANAGED_ROOT':
      return 'taskTimer.errManagedRoot';
    default:
      return 'taskTimer.errGeneric';
  }
}

/** Сэшн ЯАГААД зогссон (0368 `end_note`) → i18n.  null бол `end_reason`-ээр. */
export function endNoteKey(note: string | null | undefined): string | null {
  switch (note) {
    case 'clock_out':
      return 'taskTimer.noteClockOut';
    case 'day_end':
      return 'taskTimer.noteDayEnd';
    case 'admin_stop':
      return 'taskTimer.noteAdminStop';
    case 'split':
      return 'taskTimer.noteSplit';
    // 2026-10-02 (таскийн хуваарилалт): ирээдүйн ажлаа буцаасан/алдсан, өөрийн хэсгээ дууссан, сэшнээ хүчингүй болгосон.
    case 'alloc_release':
      return 'taskTimer.noteAllocRelease';
    case 'alloc_complete':
      return 'taskTimer.noteAllocComplete';
    case 'void':
      return 'taskTimer.noteVoid';
    default:
      return null;
  }
}
