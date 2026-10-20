/**
 * Захиалагчийн порталын хэсгүүд (URL-ын `?tab=`).
 *
 * Дараалал нь навигацын дугаарлалт (01…08) — энд л солино.  `report` гэсэн
 * хуучин утга `materials`-руу буудаг (тайлан одоо «Материал» хэсгийн нэг блок).
 */
export const CLIENT_TABS = [
  'overview',
  'progress',
  'materials',
  'documents',
  'submit',
  'mail',
  'info',
  'model',
] as const;

export type ClientDashboardTab = (typeof CLIENT_TABS)[number];

/* ------------------------------------------------------------------ */
/*  `/api/project-chat/projects/:id/overview` — захиалагчид аюулгүй     */
/*  (нэр, зураг, хариуцагчгүй) төслийн тойм.  Backend: projectChat.ts  */
/* ------------------------------------------------------------------ */

export interface DisciplineRow {
  code: string;
  label_mn: string;
  drawing_count: number;
  task_count: number;
  progress: number;
  message_count: number;
  active: boolean;
}

export interface BlockDiscipline {
  code: string;
  drawing_count: number;
  task_count: number;
  progress: number;
}

export interface BlockTask {
  id: number;
  name: string;
  weight_percent: number;
  progress: number;
}

export interface BlockComponent {
  id: number;
  name: string;
  weight_percent: number;
  progress: number;
  task_count: number;
  tasks: BlockTask[];
}

export interface BlockDrawing {
  id: number;
  name: string;
  team_code: string | null;
  weight_percent: number;
  progress: number;
  task_count: number;
  components: BlockComponent[];
}

export interface BlockRow {
  id: number;
  name: string;
  weight_percent: number;
  progress: number;
  drawing_count: number;
  task_count: number;
  /** Блокыг эзэмшдэг баг (тохиргооны хуудсанд админ тэмдэглэнэ). */
  team_id?: number | null;
  team_code?: string | null;
  team_name_mn?: string | null;
  block_disciplines?: BlockDiscipline[];
  drawings?: BlockDrawing[];
}

export interface BlockTeamSummary {
  team_id: number;
  code: string;
  name_mn: string;
  block_count: number;
}

export interface OverviewResponse {
  project: {
    id: number;
    name: string;
    location: string | null;
    latitude?: number | null;
    longitude?: number | null;
    status: string | null;
    description: string | null;
    created_at: string;
    updated_at: string;
    start_date?: string | null;
    finish_date?: string | null;
  };
  overall_progress: number;
  /** Паспортын эхлэх/дуусах огнооны хоорондох хуанлийн хоног. */
  duration_days?: number | null;
  counts: {
    blocks: number;
    drawings: number;
    components: number;
    tasks: number;
    team_members: number;
    active_disciplines: number;
  };
  blocks: BlockRow[];
  disciplines: DisciplineRow[];
  /** Ядаж нэг блок эзэмшдэг багууд — «Явц» хэсгийн баг сонголт. */
  block_teams?: BlockTeamSummary[];
}
