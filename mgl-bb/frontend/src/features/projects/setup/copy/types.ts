/* ==========================================================================
   «Бүтэц татах» — фронтендийн төрлүүд
   ==========================================================================

   ⚠️ ЭНЭ ФАЙЛ БОЛ `backend/src/lib/structureCopyPlan.ts`-ИЙН ХОСЛОЛ (twin).
   Фронтенд нь backend-ээс шууд импорт хийж чадахгүй тул төлөвлөгөөний
   гэрээг ЭНД ҮГЧЛЭН давтав.  Сервер талын интерфейс өөрчлөгдвөл ЭНЭ ФАЙЛЫГ
   МӨН адил өөрчил — эс тэгвээс `preview.ceiling_pct` / `counts` чимээгүйгээр
   `undefined` болж, tsc нь ногоон хэвээр үлдэнэ.

   Жинг ХЭЗЭЭ Ч фронтенд дээр дахин тооцохгүй: доорх бүх тоо (тоо ширхэг,
   дээд хязгаар, хасагдсан мөрүүд) нь `dry_run: true` хүсэлтийн хариунаас
   ШУУД ирнэ.  Нэг л хэрэгжүүлэлт байх ёстой (эх томьёо нь CLAUDE.md-д).
   ========================================================================== */
import type { BlockProgress, ProjectTeamShare } from '@/shared/types';
import type { ProjectCategory } from '@/shared/lib/project-categories';

/* ============================================================
 *  Төлөвлөгөө (сервер → фронтенд)
 * ============================================================ */

export interface CopyPlanTeamShare {
  team_id: number;
  team_code: string;
  team_name: string;
  share_percent: number;
  sort_order: number;
}

export type PruneReason =
  | 'NOT_SELECTED'
  | 'NO_TASKS'
  | 'NO_DRAWINGS'
  | 'NO_COMPONENTS'
  | 'NO_BLOCKS';

export interface PlannedTask {
  src_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
}
export interface PlannedComponent {
  src_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  tasks: PlannedTask[];
}
export interface PlannedDrawing {
  src_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  components: PlannedComponent[];
}
export interface PlannedBlock {
  src_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  team_id: number | null;
  team_code: string | null;
  responsible_name: string | null;
  drawings: PlannedDrawing[];
}

export type CopyWarningCode =
  | 'CEILING_BELOW_100'
  | 'ZERO_WEIGHT_DRAWING'
  | 'ZERO_WEIGHT_BLOCK'
  | 'TEAM_WITHOUT_BLOCKS'
  | 'BLOCK_WITHOUT_TEAM'
  | 'TASK_WEIGHTS_UNDER_BUDGET'
  | 'TASK_WEIGHTS_OVER_BUDGET';

export interface CopyWarning {
  code: CopyWarningCode;
  count?: number;
  detail?: string;
}

export interface CopyPlanCounts {
  teams: number;
  blocks: number;
  drawings: number;
  components: number;
  tasks: number;
}

export interface CopyPlan {
  team_shares: CopyPlanTeamShare[];
  blocks: PlannedBlock[];
  counts: CopyPlanCounts;
  pruned: {
    teams: { team_id: number; team_code: string; reason: PruneReason }[];
    blocks: { src_id: number; name: string; reason: PruneReason }[];
    drawings: { src_id: number; name: string; reason: PruneReason }[];
    components: { src_id: number; name: string; reason: PruneReason }[];
  };
  /** Хуулагдсан БҮХ ажил 100% болбол төсөл хамгийн ихдээ хэдэн хувь болох.
   *  Хэсэгчилсэн хуулбар үүнийг 100-аас доош БУУЛГАНА — энэ нь эзний
   *  зориудын шийдвэр («жинг үгчлэн хуул»), тиймээс нуухыг ХОРИГЛОНО. */
  ceiling_pct: number;
  warnings: CopyWarning[];
}

/* ============================================================
 *  Сонголт (фронтенд → сервер)
 * ============================================================
 *  `null` = «энэ түвшний БҮХ мөр».  Бүх талбар нь `null` бол «бүхэлд нь
 *  хуул» гэсэн үг бөгөөд хамгийн жижиг ачаалалтай хувилбар. */
export interface CopySelectionInput {
  team_ids: number[] | null;
  block_ids: number[] | null;
  drawing_ids: number[] | null;
  component_ids: number[] | null;
  task_ids: number[] | null;
}

/** Хүсэлтийн биед орох хэлбэр — `null` талбаруудыг ОГТ явуулахгүй. */
export interface CopySelectionWire {
  team_ids?: number[];
  block_ids?: number[];
  drawing_ids?: number[];
  component_ids?: number[];
  task_ids?: number[];
}

export interface CopyPreviewResponse {
  plan?: CopyPlan;
}

export interface CopyCommitResult {
  plan: CopyPlan;
  created?: { block_ids: number[] };
  linked?: boolean;
}

/* ============================================================
 *  Эх төслийн мод — `GET /api/projects/:id` НЭГ дуудлагаар
 * ============================================================
 *  ⚠️ Шинэ маршрут БҮҮ нэм: энэ эцсийн цэг нь блок → зураг → эд анги →
 *  ажлын бүтэн модыг аль хэдийн нэг хүсэлтээр буцаадаг. */
export interface CopySourceProject {
  id: number;
  name: string;
  display_title?: string | null;
  drawing_no?: string | null;
  category?: ProjectCategory | null;
  complexity_pct?: number | null;
}

export interface CopySourceTreeResponse {
  project: CopySourceProject;
  blocks?: BlockProgress[];
  team_shares?: ProjectTeamShare[];
}

/* ============================================================
 *  Сонголтын дотоод төлөв
 * ============================================================
 *  «Идэвхгүй болгосон» (deselected) id-ууд.  ЭЕРЭГ биш СӨРӨГ жагсаалт
 *  байгаа нь санаатай: өгөгдмөл нь «бүгдийг хуул» бөгөөд 1051 ажилтай
 *  төсөл дээр 1051 id-г төлөвт хадгалахаас зайлсхийнэ.
 *
 *  ХАДГАЛАГДАХ ТОГТМОЛ (invariant): мөч ямар нэг олонлогт байвал
 *  түүний БҮХ удам мөн өөрсдийн олонлогт байна («урьдчилсан унжилт»).
 *  Тиймээс «сонгогдсон эсэх» шалгахад өвөг дээдсийг гүйлгэх шаардлагагүй. */
export interface DeselectedIds {
  teams: Set<number>;
  blocks: Set<number>;
  drawings: Set<number>;
  components: Set<number>;
  tasks: Set<number>;
}

export function emptyDeselection(): DeselectedIds {
  return {
    teams: new Set<number>(),
    blocks: new Set<number>(),
    drawings: new Set<number>(),
    components: new Set<number>(),
    tasks: new Set<number>(),
  };
}

/** Гурван төлөвт checkbox-ын утга (Radix `checked` prop-той нийцнэ). */
export type TriState = boolean | 'indeterminate';
