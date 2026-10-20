/**
 * «Хугацаа» — frontend талын төрлүүд.
 *
 * `backend/src/routes/deadlines.ts`-ийн гарцыг ЯГ тусгана (гэрээ нь
 * тэнд бичигдсэн `DeadlineItem` / `ProjectDeadlineResponse`).  Хоёр талыг
 * хамт өөрчилнө — тестээр хамгаалагдаагүй тул зөрвөл чимээгүй эвдэрнэ.
 *
 * `RiskState`-ийг ДАХИН ЗАРЛААГҮЙ: Timeline-ийн төрлөөс импортлон,
 * өнгө/шошгыг ч мөн `features/timeline/lib/riskDisplay.ts`-ээс авна.
 * Ингэснээр хуваарийн хуудас, хугацааны жагсаалт хоёр ижил өнгөний
 * хэлээр ярина — «улаан = хэтэрсэн» гэдэг хаана ч ижил утгатай.
 */
import type { RiskState } from '@/features/timeline/types';

export type { RiskState };

/** Мөрийн эх сурвалж.
 *  `project`   — паспортын эцсийн хугацаа (нэг ширхэг)
 *  `milestone` — `project_milestones` (migration 0173), гараар үүсгэсэн
 *                нэрлэсэн хугацаа + түүний дэд хугацаа (2 түвшин)
 *  `block` / `task` / `sub` — одоо байгаа өгөгдлөөс ургасан мөрүүд. */
export type DeadlineKind = 'project' | 'milestone' | 'block' | 'task' | 'sub';

export interface DeadlinePerson {
  id: number;
  full_name: string;
}

/** Milestone-ийн сонголтот ажлын холбоос.  Байвал «биелсэн» нь гараас биш
 *  тухайн ажлын явцаас гарна — UI үүнийг хэрэглэгчид ил хэлэх ёстой. */
export interface DeadlineLink {
  kind: 'block' | 'task';
  id: number;
  name: string;
}

export interface DeadlineItem {
  /** Тогтвортой react key — `kind:id`. */
  key: string;
  kind: DeadlineKind;
  id: number;
  title: string;
  /** 'YYYY-MM-DD'.  Сервер тал ISO биш бүхнийг NULL болгож цэвэрлэсэн. */
  due_date: string | null;
  start_date: string | null;
  done: boolean;
  /** Таскийн сүүлийн батлагдсан хувь; бусад төрөлд null. */
  progress: number | null;
  block_id: number | null;
  block_name: string | null;
  /** `sub` мөрийн эцэг таск. */
  task_id: number | null;
  task_name: string | null;
  note: string | null;
  /** ГАРААР тэмдэглэсэн огноо (`milestone` / `sub`).  `done`-оос ЯЛГААТАЙ:
   *  ажилтай холбоостой milestone нь явцаараа `done` болох ч энэ нь NULL
   *  хэвээр байна — «хаагдсан уу» гэдгийг ҮРГЭЛЖ `done`-оор шийднэ. */
  done_at?: string | null;
  people: DeadlinePerson[];
  /** `sub` / `milestone` мөрийг энэ хэрэглэгч засаж чадах эсэх (сервер шийдсэн). */
  can_edit: boolean;
  /** ЗӨВХӨН `milestone` мөрөнд — дэд хугацааны эцэг (дээд түвшинд null). */
  parent_id?: number | null;
  /** ЗӨВХӨН `milestone` мөрөнд — ажлын холбоос. */
  link?: DeadlineLink | null;
  /** ЗӨВХӨН `milestone` мөрөнд — хэдэн даалгаврыг хамарч байгаа. */
  task_count?: number;
  /** ЗӨВХӨН `milestone` мөрөнд — холбоосон ажлын явц 0..100 (холбоосгүй
   *  бол null).  «Хугацаа дөхөж байхад ажил хаана байна вэ». */
  work_progress?: number | null;
  /** ЗӨВХӨН дээд түвшний `milestone` мөрөнд — дэд хугацааны тоо. */
  sub_count?: number;
  risk_state: RiskState;
  days_left: number | null;
  days_to_start: number | null;
  /** ЗӨВХӨН `/upcoming` ба `/calendar` дээр дүүрнэ — Dashboard дээр мөр бүр
   *  аль төслийнх нь харагдах ёстой. */
  project_id?: number;
  project_title?: string;
}

export interface ProjectDeadlineResponse {
  /** УБ-ийн өнөөдөр — сервер тал бодсон (хэрэглэгчийн цагийн бүс биш). */
  today: string;
  /** Milestone нэмэх/засах эрх (admin/senior).  Мөрийн `can_edit`-ээс
   *  ялгаатай нь жагсаалт хоосон үед ч мэдэгдэнэ. */
  can_manage_milestones: boolean;
  project: {
    id: number;
    name: string;
    display_title: string | null;
    status: string;
    start_date: string | null;
    finish_date: string | null;
    risk_state: RiskState;
    days_left: number | null;
    days_to_start: number | null;
  };
  items: DeadlineItem[];
}

export interface UpcomingDeadlineResponse {
  today: string;
  scope: 'mine' | 'all';
  days: number;
  items: DeadlineItem[];
}

/* ------------------------------------------------------------------ */
/*  Milestone (migration 0173)                                         */
/* ------------------------------------------------------------------ */

/** `GET /api/deadlines/calendar?from&to` — хуанлийн мужийн гарц. */
export interface CalendarDeadlineResponse {
  today: string;
  scope: 'mine' | 'all';
  from: string;
  to: string;
  items: DeadlineItem[];
}

/** `GET /api/deadlines/summary?project_ids=` — төслийн картын chip.
 *  ЗӨВХӨН төслийн эцсийн хугацаа + milestone-ыг дүгнэнэ (таск/дэд хугацаа
 *  ОРООГҮЙ — backend-ийн тайлбарыг үз). */
/** Timeline-ийн баар дээрх нэг цэг.  ЗӨВХӨН milestone (дээд + дэд) —
 *  таскийн огноог оруулаагүй (backend-ийн тайлбарыг үз). */
export interface DeadlinePoint {
  id: number;
  title: string;
  due_date: string;
  risk_state: RiskState;
  days_left: number | null;
  done: boolean;
  /** Дэд хугацаа эсэх — UI жижиг цэгээр зурна. */
  is_sub: boolean;
  link_name: string | null;
  /** Хариуцагчид (олон хүн байж болно — migration 0176). */
  people: DeadlinePerson[];
  /** Хамрах даалгаврын тоо. */
  task_count: number;
  /** Холбоосон ажлын явц 0..100; холбоосгүй бол null. */
  work_progress: number | null;
  /** Тэмдэглэл (`project_milestones.note`). */
  note: string | null;
}

export interface DeadlineSummary {
  project_id: number;
  next: {
    kind: 'project' | 'milestone';
    title: string;
    due_date: string;
    risk_state: RiskState;
    days_left: number | null;
  } | null;
  overdue_count: number;
  open_count: number;
  /** Төслийн ӨӨРИЙН эцсийн хугацаа.  `next`-ээс ялгаатай нь энэ нь ҮРГЭЛЖ
   *  төслийн мөр — milestone нь түүнээс эрт байхад ч алга болохгүй.
   *  Дууссан/архивласан төсөлд null. */
  project_due: {
    due_date: string;
    risk_state: RiskState;
    days_left: number | null;
  } | null;
  /** Timeline-ийн тэмдэглэгээ — ДУУССАН мөрүүд ч орно (`done` тугтай),
   *  харин дээрх тоолуурууд зөвхөн дуусаагүйг тоолно. */
  points: DeadlinePoint[];
}

export interface DeadlineSummaryResponse {
  today: string;
  items: DeadlineSummary[];
}

/** Milestone үүсгэх / засах биет.  Бүх талбар сонголттой (засварт хэсэгчлэн
 *  илгээнэ); үүсгэхэд `project_id`, `title`, `due_date` заавал. */
export interface MilestoneInput {
  project_id?: number;
  parent_id?: number | null;
  title?: string;
  due_date?: string;
  note?: string | null;
  /** Хариуцагчид (migration 0176).  `[]` = хэн ч заагаагүй; заагаагүй
   *  (`undefined`) бол засварт хөндөгдөхгүй. */
  assignee_ids?: number[];
  block_id?: number | null;
  task_id?: number | null;
}

/* ------------------------------------------------------------------ */
/*  Төслийн дуусах хугацааны СУНГАЛТ + түүх (migration 0337)            */
/*  `backend/src/lib/deadlineExtensions.ts` + `routes/projectDeadline.ts` */
/* ------------------------------------------------------------------ */

/** Хэн зөвшөөрсөн: захиалагч / захирал / бусад (нэр заавал). */
export type ApprovedByKind = 'client' | 'director' | 'other';
export const APPROVED_BY_KINDS: readonly ApprovedByKind[] = ['client', 'director', 'other'];

/** `project_deadline_changes`-ийн нэг мөр.
 *  `extension`  — «Хугацаа сунгах» (батлагч, шалтгаан; `seq` = хэд дэх).
 *  `correction` — «Хуваарь» цонх / паспортын 1.3-аар зассан (батлагчгүй,
 *                 сунгалтын тоонд орохгүй).  `from_date` null = анх тогтоосон. */
export interface DeadlineChange {
  id: number;
  project_id: number;
  kind: 'extension' | 'correction';
  seq: number | null;
  from_date: string | null;
  to_date: string | null;
  /** to − from хуанлийн хоногоор; аль нэг нь уншигдахгүй бол null. */
  days: number | null;
  reason: string | null;
  approved_by_kind: ApprovedByKind | null;
  approved_by_name: string | null;
  approved_on: string | null;
  reference_no: string | null;
  note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  /** 'YYYY-MM-DD HH:MM:SS' (UTC). */
  created_at: string;
}

export interface DeadlineHistoryResponse {
  today: string;
  /** Сунгалт бүртгэх эрх (admin + senior). */
  can_manage: boolean;
  /** Сүүлийн сунгалтыг буцаах эрх (admin). */
  can_revert: boolean;
  /** Одоо хүчинтэй дуусах хугацаа (ISO) — `finish_date` багана. */
  current_finish_date: string | null;
  /** Баганын түүхий утга — ISO биш ч байж болно. */
  raw_finish_date: string | null;
  /** Анхны хугацаа: эхний сунгалтын `from_date`; сунгалтгүй бол одоогийнх. */
  original_finish_date: string | null;
  extension_count: number;
  total_extended_days: number;
  last_extension: DeadlineChange | null;
  /** Цаг хугацааны дарааллаар (хамгийн хуучин нь эхэнд). */
  items: DeadlineChange[];
}

export interface ExtensionInput {
  new_finish_date: string;
  reason: string;
  approved_by_kind: ApprovedByKind;
  approved_by_name?: string;
  approved_on?: string;
  reference_no?: string;
  note?: string;
}
