/**
 * ТАСКИЙН ХУВААРИЛАЛТ — API-ийн төрлүүд (backend: `routes/taskAllocations.ts`, `lib/taskRootOps.ts`,
 * `lib/taskRootStore.ts`, `lib/taskContributors.ts`).  2026-10-02.
 *
 * Бүх хэмжээ БҮТЭН НЭГЖ (1 пункт = 10 000 нэгж, `units.ts`) — JSON-д аравтын бутархай ирэхгүй, явуулахгүй.
 */

export type ParticipantStatus = 'active' | 'history' | 'cancelled';

export interface ParticipantView {
  allocation_id: number;
  user_id: number;
  /** Хэсгийн дугаар (17.k) — НЭГ удаа олгогдож хэзээ ч дахин ашиглагдахгүй. */
  ordinal: number;
  /** T — нийт зорилт. */
  target_units: number;
  /** D — одоо хүчинтэй хийсэн. */
  done_units: number;
  /** L — түгжигдсэн доод хязгаар (энгийн «−» эндээс доош орохгүй). */
  floor_units: number;
  /** T − D — ирээдүйд хийх. */
  future_units: number;
  released_units: number;
  status: ParticipantStatus;
}

/** Хүнгүй хэсэг (0394) — нэр + хувь, хүн оноогоогүй; ▶ дарсан ажилтан авна. */
export interface PartView {
  part_id: number;
  /** Дугаар (17.k) — хуваарилалттай НЭГ тоолуур, авахад хадгалагдана. */
  ordinal: number;
  label: string;
  /** Үндсэн ажлын нэгжээр (1% = 10 000). */
  units: number;
}

export interface RootView {
  task_id: number;
  revision: number;
  managed: true;
  root_done_units: number;
  remaining_units: number;
  unattributed_units: number;
  /** U — хуваарилагдаагүй ирээдүйн ажил (хүнгүй хэсгүүдийг ОРУУЛСАН). */
  unallocated_units: number;
  /** U − Σ хэсэг — нэргүй чөлөөт ажил.  Хуучин backend-д байхгүй. */
  free_units?: number;
  complete: boolean;
  participants: ParticipantView[];
  /** Хүнгүй хэсгүүд (0394).  Хуучин backend-д байхгүй. */
  parts?: PartView[];
}

/** `GET /api/tasks/:id/allocation` */
export interface AllocationOverview {
  server_now: string;
  task: {
    id: number;
    name: string;
    project_id: number;
    project_status: string | null;
    splittable: boolean;
    latest_pct: number;
  };
  managed: boolean;
  root: RootView | null;
  /** Managed болоогүй таскийн seed-ийн ТӨЛӨВЛӨГӨӨ (юу ч бичигдээгүй). */
  preview: {
    attribution: string;
    root_done_units: number;
    unattributed_units: number;
    slack_units: number;
    participants: Array<{ user_id: number; done_units: number }>;
    reasons: string[];
  } | null;
  me: ParticipantView | null;
  allowed: {
    edit: boolean;
    progress: boolean;
    release: boolean;
    retake: boolean;
    /** Хүнгүй хэсэг болгон хуваах / засах (0394). */
    parts?: boolean;
  };
}

/** `GET /api/progress/my-tasks` дахь мөр бүрийн `allocation` (managed биш таскт null). */
export interface MyTaskAllocation {
  revision: number;
  root_done_units: number;
  unallocated_units: number;
  unattributed_units: number;
  participants: number;
  my: ParticipantView | null;
}

export interface CandidateUser {
  id: number;
  full_name: string | null;
  username: string;
  role: string;
  profile_image: string | null;
}

export interface OwnRecords {
  slices: Array<{
    id: number;
    kind: 'work' | 'seed';
    units_open: number;
    work_date: string;
    awarded_at: string;
    credit_open_amount: number;
    legacy: boolean;
  }>;
  corrections: Array<{
    request_id: string;
    recorded_at: string;
    units: number;
    credit_amount: number;
    note: string | null;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Бичих үйлдлийн хариу                                                */
/* ------------------------------------------------------------------ */

interface WriteBase {
  /** Ижил `request_id` дахин ирсэн — анхны үр дүнг буцаав. */
  replayed?: boolean;
}

export interface SplitResult extends WriteBase {
  root: RootView;
  converted: boolean;
  created: number[];
  released: number[];
  dropped: number[];
}

export interface ProgressResult extends WriteBase {
  root: RootView;
  noop: boolean;
  kind: 'increase' | 'decrease' | 'none';
  delta_units: number;
  reached_own_cap: boolean;
  completed_root: boolean;
  reopened_root: boolean;
  points: { amount: number; delta_pct: number; free_units: number; paid_units: number } | null;
  reversed: { amount: number; delta_pct: number } | null;
  entry_id: number | null;
}

export interface ReleaseResult extends WriteBase {
  root: RootView;
  released_units: number;
  to_user_id: number | null;
}

export interface PartsResult extends WriteBase {
  root: RootView;
  converted: boolean;
  created: number;
  removed: number;
}

export interface ClaimPartResult extends WriteBase {
  root: RootView;
  claimed_units: number;
  ordinal: number;
  merged: boolean;
}

export interface RetakeResult extends WriteBase {
  root: RootView;
  taken_units: number;
  reactivated: boolean;
}

export interface CorrectResult extends WriteBase {
  root: RootView;
  reversed_units: number;
  reversed: { amount: number; delta_pct: number };
  reopened_root: boolean;
}

export interface RestoreResult extends WriteBase {
  root: RootView;
  restored_units: number;
  reached_own_cap: boolean;
  completed_root: boolean;
}

/** Дуусгах асуулт (`completion_qa required`-ийн нэмэлт өгөгдөл). */
export interface QaQuestion {
  id: string;
  text: string;
}

/** Серверийн алдааны биеийн нэмэлт талбарууд (`failBody`). */
export interface AllocationErrorExtra {
  current?: RootView | null;
  questions?: QaQuestion[];
  missing?: string[];
  scopes?: { own: boolean; root: boolean };
  available_units?: number;
}

/* ------------------------------------------------------------------ */
/*  Хувь нэмэрч                                                          */
/* ------------------------------------------------------------------ */

export type Evidence = 'progress' | 'credit' | 'time' | 'repair' | 'running';

export interface ContributorRow {
  user_id: number;
  full_name: string | null;
  profile_image: string | null;
  /** Тоологдсон (void-гүй, цайны цаг хассан) ДУУССАН албан цаг, мс. */
  official_closed_ms: number;
  /** Одоо явж буй сэшний эхлэл (ISO). */
  running_since: string | null;
  /** Засварын цаг — албан цагтай ХЭЗЭЭ Ч нэгтгэхгүй. */
  repair_hours: number;
  done_units: number | null;
  target_units: number | null;
  /** L — түгжигдсэн доод хязгаар; managed биш таскт null. */
  floor_units: number | null;
  ordinal: number | null;
  /** Хуваарилалтын мөрийн өөрийн нэр (0393); null бол үндсэн ажлын нэр. */
  label: string | null;
  allocation_status: ParticipantStatus | null;
  /** Нотолгоотой хувь нэмэрч мөн үү (хуваарилагдсан хэрнээ нотолгоогүй хүн false). */
  contributor: boolean;
  evidence: Evidence[];
}

export interface ManagedSummary {
  revision: number;
  root_done_units: number;
  unattributed_units: number;
  unallocated_units: number;
  /** Хүнгүй хэсгүүд (0394) — дугаарын дарааллаар.  Хуучин backend-д байхгүй. */
  parts?: PartView[];
}

export interface ProjectPerson {
  user_id: number;
  full_name: string | null;
  profile_image: string | null;
  official_closed_ms: number;
  running_since: string | null;
  tasks: number;
}

/** `GET /api/tasks/contributors?project_id=` */
export interface ProjectContributors {
  server_now: string;
  lunch: { start_min: number; end_min: number; from: string; offset_min: number } | null;
  tasks: Record<number, ContributorRow[]>;
  managed: Record<number, ManagedSummary>;
  people: ProjectPerson[];
  /** Төслийн «дуусгах асуултууд» — өөрийн хэсгээ дуусгахад асууна. */
  completion_questions: QaQuestion[];
}

/* ------------------------------------------------------------------ */
/*  Үндсэн таскууд болгон хуваах (✂, 0395) — backend `lib/taskRootSplitStore.ts`   */
/* ------------------------------------------------------------------ */

export interface RootSplitMember {
  task_id: number;
  name: string;
  weight: number;
  role: 'part' | 'done';
}

/** `GET /api/tasks/:id/root-split` */
export interface RootSplitInfo {
  task: { id: number; name: string; project_id: number; weight_percent: number; progress: number };
  can_split: boolean;
  block: { error: string; message: string } | null;
  occupied_by: Array<{ user_id: number; full_name: string | null }>;
  /** Хүнгүй хэсгүүд (0394) — урьдчилан бөглөх мөрүүд. */
  prefill: Array<{ name: string; share_units: number }>;
  last_split: null | {
    id: number;
    created_at: string;
    actor_name: string | null;
    mode: 'whole' | 'remainder';
    orig_name: string;
    members: RootSplitMember[];
    undoable: boolean;
    blocked_message: string | null;
  };
}

export interface RootSplitResult {
  ok: true;
  replayed: boolean;
  split_id: number;
  task_id: number;
  mode: 'whole' | 'remainder';
  parts: Array<{ task_id: number; name: string; weight_percent: number }>;
  done: { task_id: number; name: string; weight_percent: number } | null;
}

export interface RootSplitUndoResult {
  ok: true;
  replayed: boolean;
  split_id: number;
  task_id: number;
  removed_tasks: number;
}
