import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { ADMIN_ROLES } from '../types';
import {
  computeDeadlineRisk,
  diffDays,
  isIsoDate,
  riskRank,
  type RiskState,
} from '../lib/projectRisk';
import { todayInUB } from '../lib/time';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';
import { latestApprovedPctByCreatedAt } from '../lib/progressLatest';
import { retiredHandler } from '../lib/retiredHits';

/* ============================================================
 *  «Хугацаа» — deadline харагдац
 * ============================================================
 *  Төслийн хугацааг ГАНЦ жагсаалт болгон харуулна.  ТАВАН эх сурвалжийг
 *  нэгтгэнэ:
 *
 *    project   — `project_passport.finish_date` (төслийн эцсийн хугацаа)
 *    milestone — `project_milestones` (migration 0173) нэрлэсэн хугацаа
 *                ба түүний дэд хугацаа (`parent_id`, 2 түвшин)
 *    block     — блокийн доорх таскуудаас УРГАСАН муж (min start / max due)
 *    task      — `tasks.start_date` / `tasks.due_date`
 *    sub       — `task_deadlines` (migration 0148) дэд шалгах цэгүүд
 *
 *  Эхний хоёр нь ХАДГАЛАГДДАГ мөр (гараар үүсгэнэ), сүүлийн гурав нь
 *  одоо байгаа өгөгдлөөс УРГАЖ гарна.  «Эхний дуусах хугацаа» = энэ
 *  жагсаалтын хамгийн ойрын дуусаагүй мөр.
 *
 *  ⚠️ MILESTONE НЬ АЖЛЫН НЭГЖ БИШ.  `project_milestones` нь
 *     blocks→drawings→components→tasks модонд огт байхгүй тул явцын
 *     нэгтгэл, оноо, leaderboard, батлах дараалалд БҮТЦИЙН ХУВЬД
 *     нөлөөлөх боломжгүй (migration 0173-ын толгойг үз).
 *
 *  ⚠️ ЭРСДЭЛИЙН ЛОГИК ЭНД БАЙХГҮЙ.  Мөр бүрийн төлөв нь
 *     `lib/projectRisk.ts`-ийн `computeDeadlineRisk`-ээр бодогдоно —
 *     Timeline хуудас, өдөр тутмын сануулгын cron, энэ жагсаалт гурав
 *     ижил шатлал хэрэглэнэ (overdue → due_1 → due_3 → due_7 → …).
 *
 *  Хандалт: `/api/timeline`-ийн `requireRole('admin','senior')`-ыг
 *  ЗОРИУДААР ХУУЛААГҮЙ.  Инженер, архитектор өөрийн ажлын хугацааг
 *  харах ёстой.  Уншихад module-level guard байхгүй; бичихэд:
 *    · дэд хугацаа (`sub`)  → ХАСАГДСАН (2026-10-02) — таскийн checkpoint-ыг
 *                             үүсгэх/засах/биелүүлэх/устгах зам 410 өгнө,
 *                             түүх (уншилт) хадгалагдана.
 *    · milestone            → ЗӨВХӨН admin/senior (`hasManagerRole`).
 *                             Ажилтан өөрийн таскаа задлах эрхтэй ч
 *                             төслийн түвшний хугацааг удирдлага тавина.
 *  `worker` дүр нь `lib/workerScope.ts`-ийн allowlist-д `deadlines` prefix
 *  байхгүй тул автоматаар 403 авна — энд нэмэлт шалгалт хэрэггүй.
 */
const deadlines = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------------------------------------------------ */
/*  Гаралтын хэлбэр (frontend/src/features/deadlines/types.ts-ийн ихэр) */
/* ------------------------------------------------------------------ */

export type DeadlineKind = 'project' | 'milestone' | 'block' | 'task' | 'sub';

export interface DeadlinePerson {
  id: number;
  full_name: string;
}

/** Milestone нь СОНГОЛТООР блок эсвэл таск руу холбогдоно.  Холбогдсон бол
 *  «биелсэн» эсэх нь тухайн ажлын явцаас автоматаар гарна (гараар
 *  тэмдэглэх шаардлагагүй) — UI үүнийг хэрэглэгчид хэлэх ёстой, эс бөгөөс
 *  «яагаад миний чагт ажиллахгүй байна вэ» гэсэн асуулт төрнө. */
export interface DeadlineLink {
  kind: 'block' | 'task';
  id: number;
  name: string;
}

export interface DeadlineItem {
  /** Тогтвортой react key — `kind:id` (project мөрөнд `project:<id>`). */
  key: string;
  kind: DeadlineKind;
  /** block/task/sub-ийн id; project мөрөнд төслийн id. */
  id: number;
  title: string;
  /** 'YYYY-MM-DD' эсвэл null.  ISO биш бүхэн NULL болж цэвэрлэгдсэн. */
  due_date: string | null;
  start_date: string | null;
  /** Биелсэн эсэх.  project → status, task → явц >= 100, sub → done_at. */
  done: boolean;
  /** Таскийн сүүлийн батлагдсан хувь.  block/sub/project мөрөнд null. */
  progress: number | null;
  /** Хамаарах блок (task/sub мөрөнд ч дүүрнэ) — жагсаалтыг бүлэглэхэд. */
  block_id: number | null;
  block_name: string | null;
  /** `sub` мөрийн эцэг таск.  Бусад мөрөнд null. */
  task_id: number | null;
  task_name: string | null;
  /** `sub` мөрийн тэмдэглэл. */
  note: string | null;
  /** ГАРААР тэмдэглэсэн огноо (`milestone` / `sub` мөрөнд).  `done`-оос
   *  ЯЛГААТАЙ: ажилтай холбоостой milestone нь явцаараа `done` болох ч
   *  `done_at` нь NULL хэвээр байна.  UI «хэзээ хаагдсан» гэдгийг л
   *  үүгээр хэлнэ — «хаагдсан уу» гэдгийг ХЭЗЭЭ Ч үүгээр шийдэхгүй. */
  done_at?: string | null;
  people: DeadlinePerson[];
  /** `sub` / `milestone` мөрийг энэ дуудагч засах эрхтэй эсэх — UI товч нуухад. */
  can_edit: boolean;
  /** ЗӨВХӨН `milestone` мөрөнд дүүрнэ — дэд хугацааны эцэг.  Дээд түвшний
   *  milestone дээр null, бусад төрөлд огт байхгүй (`project_id`-тай ижил
   *  «зөвхөн зарим мөрөнд» конвенц).  Frontend үүгээр 2 түвшний мод угсарна. */
  parent_id?: number | null;
  /** ЗӨВХӨН `milestone` мөрөнд — сонголтот ажлын холбоос.  Байвал `done` нь
   *  гараас биш явцаас гарсан гэсэн үг. */
  link?: DeadlineLink | null;
  /** ЗӨВХӨН `milestone` мөрөнд — энэ хугацаа хэдэн даалгаврыг хамарч
   *  байгаа (холбоосон блокийн таскийн тоо, эсвэл 1, эсвэл 0). */
  task_count?: number;
  /** ЗӨВХӨН `milestone` мөрөнд — холбоосон ажлын явц 0..100; холбоосгүй
   *  бол null.  «Хугацаа дөхөж байхад ажил хаана байна вэ» гэдгийг
   *  нэг мөрөнд хэлнэ. */
  work_progress?: number | null;
  /** ЗӨВХӨН дээд түвшний `milestone` мөрөнд — дэд хугацааны тоо. */
  sub_count?: number;
  risk_state: RiskState;
  days_left: number | null;
  days_to_start: number | null;
  /** ЗӨВХӨН `/upcoming` дээр дүүрнэ — Dashboard-ийн жагсаалт төсөл
   *  хооронд холилдсон тул мөр бүр аль төслийнх нь харагдах ёстой.
   *  `/project/:id` дээр бүх мөр нэг төслийнх тул орхигдоно. */
  project_id?: number;
  project_title?: string;
}

export interface ProjectDeadlineResponse {
  today: string;
  /** Энэ дуудагч milestone нэмэх/засах эрхтэй эсэх (admin/senior).
   *  Мөр бүрийн `can_edit`-ээс ЯЛГААТАЙ: жагсаалт ХООСОН үед ч «нэмэх»
   *  товч харуулах эсэхийг шийдэх ёстой тул түвшний туг хэрэгтэй. */
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

/* ------------------------------------------------------------------ */
/*  Туслахууд                                                          */
/* ------------------------------------------------------------------ */

/** Паспортын огооны багана, мөн `tasks.due_date` нь баталгаажаагүй чөлөөт
 *  текст — production-д '-', '', '2026-13-45' зэрэг бодитоор байдаг
 *  (`PUT /api/tasks/:id` формат шалгадаггүй).  ISO биш бүхнийг NULL
 *  болгож «Хугацаа тодорхойгүй» (`unscheduled`) руу эвтэйхэн унана. */
function isoOrNull(v: string | null | undefined): string | null {
  return isIsoDate(v) ? v : null;
}

/** SQLite талд ISO хэлбэрийн огноог шүүх GLOB — MIN()/MAX() нь хог утгыг
 *  (жишээ нь '-') жинхэнэ огноотой хольж эрэмбэлэхээс сэргийлнэ. */
const ISO_GLOB = `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

const TITLE_MAX = 300;
const NOTE_MAX = 1000;

/** Жагсаалтын эрэмбэ: эрсдэл (хамгийн яаралтай нь эхэнд) → огноо →
 *  төрөл (project → block → task → sub) → id.  Огноогүй нь эцэст. */
const KIND_RANK: Record<DeadlineKind, number> = {
  project: 0,
  milestone: 1,
  block: 2,
  task: 3,
  sub: 4,
};

function sortItems(items: DeadlineItem[]): DeadlineItem[] {
  return items.sort((a, b) => {
    const byRisk = riskRank(a.risk_state) - riskRank(b.risk_state);
    if (byRisk !== 0) return byRisk;
    if (a.due_date && b.due_date && a.due_date !== b.due_date) {
      return a.due_date < b.due_date ? -1 : 1;
    }
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (byKind !== 0) return byKind;
    return a.id - b.id;
  });
}

/** Клиент дүр нь зөвхөн өөрийн гишүүнчлэлтэй төслийг үзнэ.
 *  `routes/projects.ts:573-582`-ын шалгалтын ЯГ ижил хувилбар.
 *  (CLAUDE.md-ийн Security posture-т дурдсан гишүүнчлэлийн шалгалтгүй
 *  route-уудыг ЗОРИУДААР хуулаагүй — тэднийг загвар болгож болохгүй.) */
async function clientMayReadProject(
  db: D1Database,
  user: { sub: number; role: string },
  projectId: number,
): Promise<boolean> {
  if (user.role !== 'client') return true;
  const member = await db
    .prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
    .bind(projectId, user.sub)
    .first();
  return Boolean(member);
}

/** `requireManager()`-ийн дүрийн олонлог, гэхдээ middleware БИШ — milestone-ийн бичих эрх.
 *  Дүрийн жагсаалт нь `middleware/auth.ts`-тай нэг эх сурвалжаас (`ADMIN_ROLES`) гарна, гараар бичээгүй. */
function hasManagerRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role) || role === 'senior';
}

/* ------------------------------------------------------------------ */
/*  Milestone (migration 0173)                                         */
/* ------------------------------------------------------------------ */

/** «Сүүлийн батлагдсан явц» CTE.  Энэ файлд дөрвөн газар хэрэглэгддэг тул
 *  ГАНЦ мөрөөр тодорхойлов — хуулбарууд зөрвөл нэг хуудсан дээр нэг таск
 *  өөр өөр хувьтай харагдана.  Tiebreak нь `created_at DESC`, энэ нь
 *  `routes/projects.ts`-ийн төслийн дэлгэрэнгүй rollup-тай ЯГ ИЖИЛ
 *  (жагсаалт тэр хуудсан дээр зэрэгцэж харагддаг). */
const LATEST_TASK_CTE = `latest_task AS (
    -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
    SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
    FROM tasks t
  )`;

/** Milestone-ийн SELECT — холбоосын нэр ба явцыг хамт татна.  `latest_task`
 *  ба `block_done` CTE-үүд дуудагч талд аль хэдийн зарлагдсан байх ёстой. */
const MILESTONE_COLUMNS = `m.id, m.project_id, m.parent_id, m.title, m.due_date,
              m.note, m.done_at, m.block_id, m.task_id, m.sort_order,
              lb.name      AS link_block_name,
              lt2.name     AS link_task_name,
              ltp.percentage AS link_task_progress,
              bd.task_count  AS link_block_tasks,
              bd.done_count  AS link_block_done,
              (SELECT COUNT(*) FROM project_milestones ch
                WHERE ch.parent_id = m.id) AS child_count`;

// ⚠️ Хариуцагчид ЭНД JOIN хийгдэхгүй.  Нэг хугацаа олон хүнтэй тул JOIN нь
//    мөрийг үржүүлж `link_block_tasks` зэрэг нэгтгэсэн утгыг гуйвуулна.
//    Тэднийг `loadMilestonePeople`-ээр ТУСДАА асуулгаар авна.
const MILESTONE_JOINS = `LEFT JOIN blocks lb  ON lb.id = m.block_id
         LEFT JOIN tasks  lt2 ON lt2.id = m.task_id
         LEFT JOIN latest_task ltp ON ltp.task_id = m.task_id
         LEFT JOIN block_done  bd  ON bd.block_id = m.block_id`;

/** D1-ийн нэг мэдэгдэлд 100 bind — хариуцагчдыг багцлан уншина. */
const ID_CHUNK = 90;

/**
 * Эцсийн хугацаа бүрийн хариуцагчид (migration 0176).
 *
 * ⚠️ Тусдаа асуулга байх нь ЗАРЧМЫН: milestone-ийн үндсэн асуулга нь
 *    `block_done` зэрэг НЭГТГЭСЭН утга агуулдаг тул олон-мөрт хариуцагчийг
 *    тэнд JOIN хийвэл тоо нь хүний тоогоор үржинэ.
 */
async function loadMilestonePeople(
  db: D1Database,
  ids: number[],
): Promise<Map<number, DeadlinePerson[]>> {
  const out = new Map<number, DeadlinePerson[]>();
  if (ids.length === 0) return out;

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const ph = chunk.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT a.milestone_id, u.id AS user_id, u.full_name
           FROM project_milestone_assignees a
           JOIN users u ON u.id = a.user_id
          WHERE a.milestone_id IN (${ph})
          ORDER BY u.full_name`,
      )
      .bind(...chunk)
      .all<{ milestone_id: number; user_id: number; full_name: string }>();

    for (const row of results ?? []) {
      const list = out.get(row.milestone_id) ?? [];
      list.push({ id: row.user_id, full_name: row.full_name });
      out.set(row.milestone_id, list);
    }
  }
  return out;
}

/** Блок бүрийн «нийт таск / дууссан таск» — milestone-ийн блок холбоосыг
 *  автоматаар хаахад л хэрэглэгдэнэ.  `latest_task` CTE-ээс хамаарна.
 *
 *  ⚠️ Өөрөө өөрийгөө хязгаарладаг: ЗӨВХӨН milestone-д заагдсан блокуудыг
 *     бодно.  Ингэснээр төслийн хуудас, Dashboard, хуанли гурвуулан ижил
 *     CTE хэрэглэж чадах атлаа бүх төслийн таскийн модыг бүтнээр нь
 *     гүйлгэхгүй (`block_id` бараг үргэлж хоосон байх тул ихэвчлэн 0 мөр). */
const BLOCK_DONE_CTE = `block_done AS (
         SELECT b.id AS block_id,
                COUNT(t.id) AS task_count,
                SUM(CASE WHEN COALESCE(lt.percentage, 0) >= 100 THEN 1 ELSE 0 END) AS done_count
           FROM blocks b
           JOIN drawings d   ON d.block_id = b.id
           JOIN components c ON c.drawing_id = d.id
           JOIN tasks t      ON t.component_id = c.id
           LEFT JOIN latest_task lt ON lt.task_id = t.id
          WHERE b.id IN (SELECT block_id FROM project_milestones
                          WHERE block_id IS NOT NULL)
          GROUP BY b.id)`;

interface MilestoneRow {
  id: number;
  project_id: number;
  parent_id: number | null;
  title: string;
  due_date: string;
  note: string | null;
  done_at: string | null;
  block_id: number | null;
  task_id: number | null;
  sort_order: number;
  link_block_name: string | null;
  link_task_name: string | null;
  link_task_progress: number | null;
  link_block_tasks: number | null;
  link_block_done: number | null;
  /** Дэд эцсийн хугацааны тоо. */
  child_count: number | null;
  /** ЗӨВХӨН олон төслийн асуулгад (upcoming / calendar) дүүрнэ. */
  project_title?: string | null;
}

/**
 * Энэ хугацаа ХЭДЭН ажлыг хамарч байна, тэр ажил хэдэн хувьтай вэ.
 *
 * Хэрэглэгчийн асуулт: «тухайн эцсийн хугацаа хэдэн таск-тай вэ».
 *   · блоктой холбоос → тэр блокийн бүх таск, дууссаных нь хувь
 *   · таск холбоос    → 1 таск, түүний сүүлийн батлагдсан хувь
 *   · холбоосгүй      → 0 таск, явц мэдэгдэхгүй (null)
 * Устсан ажил руу заасан өнчин холбоосыг (`link_*_name` нь NULL)
 * холбоосгүйтэй адилаар үзнэ — `milestoneDone`-тэй ижил зарчим.
 */
function milestoneWork(r: MilestoneRow): { task_count: number; work_progress: number | null } {
  if (r.task_id != null && r.link_task_name != null) {
    return { task_count: 1, work_progress: Number(r.link_task_progress) || 0 };
  }
  if (r.block_id != null && r.link_block_name != null) {
    const total = Number(r.link_block_tasks) || 0;
    const done = Number(r.link_block_done) || 0;
    return {
      task_count: total,
      work_progress: total > 0 ? Math.round((done / total) * 100) : null,
    };
  }
  return { task_count: 0, work_progress: null };
}

/**
 * Milestone «биелсэн» үү?
 *
 * Гурван эх сурвалж, ЭНЭ дарааллаар:
 *   1. таск холбоос  → тухайн таскийн сүүлийн батлагдсан явц >= 100
 *   2. блок холбоос  → блокийн БҮХ таск дууссан
 *   3. холбоосгүй    → `done_at` (гараар тэмдэглэсэн)
 *
 * Холбоосон ажил нь УСТСАН бол (`link_*_name` нь NULL) гараар тэмдэглэсэн
 * төлөв рүү эвтэйхэн унана — өнчин id нь мөрийг мөнхөд «дуусаагүй» болгож
 * гацаахгүй.  Мөн блокт таск байхгүй бол «дууссан» гэж үзэхгүй: хоосон
 * блок 0/0 гэдгээр автоматаар биелэх нь худал эерэг болно.
 */
function milestoneDone(r: MilestoneRow): boolean {
  if (r.task_id != null && r.link_task_name != null) {
    return (Number(r.link_task_progress) || 0) >= 100;
  }
  if (r.block_id != null && r.link_block_name != null) {
    const total = Number(r.link_block_tasks) || 0;
    return total > 0 && (Number(r.link_block_done) || 0) >= total;
  }
  return r.done_at != null;
}

/** Milestone мөрийг жагсаалтын нэгж болгоно.  `canEdit` нь дуудагчийн дүрээс
 *  гарна (milestone бүрд ижил) тул параметрээр авна — мөр тус бүрд SQL
 *  дахин ажиллуулах шаардлагагүй. */
function milestoneToItem(
  r: MilestoneRow,
  today: string,
  canEdit: boolean,
  people: DeadlinePerson[],
): DeadlineItem {
  const due = isoOrNull(r.due_date);
  const done = milestoneDone(r);
  const risk = computeDeadlineRisk({ due_date: due, done }, today);

  // Холбоос: таск нь блокийг дардаг (илүү нарийн).  Ажил нь устсан бол
  // холбоос харуулахгүй — байхгүй зүйл рүү заасан chip нь төөрөгдүүлнэ.
  const link: DeadlineLink | null =
    r.task_id != null && r.link_task_name != null
      ? { kind: 'task', id: r.task_id, name: r.link_task_name }
      : r.block_id != null && r.link_block_name != null
        ? { kind: 'block', id: r.block_id, name: r.link_block_name }
        : null;

  return {
    key: `milestone:${r.id}`,
    kind: 'milestone',
    id: r.id,
    title: r.title,
    due_date: due,
    start_date: null,
    done,
    progress: null,
    block_id: r.block_id,
    block_name: r.link_block_name,
    task_id: r.task_id,
    task_name: r.link_task_name,
    note: r.note,
    done_at: r.done_at,
    people,
    can_edit: canEdit,
    parent_id: r.parent_id,
    link,
    ...milestoneWork(r),
    sub_count: Number(r.child_count) || 0,
    risk_state: risk.state,
    days_left: risk.days_left,
    days_to_start: risk.days_to_start,
  };
}

/** `lib/deadlineSweep.ts`-д зориулсан гарц. */
export interface OverdueMilestone {
  id: number;
  project_id: number;
  project_title: string;
  title: string;
  due_date: string;
  /** Хариуцагчдын id.  Хоосон бол хэн ч заагдаагүй — sweep нь төслийн
   *  хариуцагчид руу шатална (migration 0176-аас өмнө ганц эзэн байсан). */
  assignee_ids: number[];
  days_overdue: number;
}

/**
 * Хугацаа хэтэрсэн, ДУУСААГҮЙ, хараахан МЭДЭГДЭЭГҮЙ milestone-ууд.
 *
 * `lib/deadlineSweep.ts` өдөрт нэг удаа дуудна.  Уг модуль дотор SQL-ээ
 * дахин бичихийн оронд ЭНД байрлуулсан шалтгаан: «дууссан» гэдгийн
 * тодорхойлолт (`milestoneDone`) ганц газар байх ёстой.  Холбоостой
 * milestone-ийн төлөв нь явцаас гардаг тул SQL-д илэрхийлэгдэхгүй —
 * хоёр газар бичвэл cron нь аль хэдийн дууссан хугацаагаар хүмүүсийг
 * цохих болно.  (`routes/timeline.ts`-ийн `loadTimelineProjects`-ыг
 * sweep дуудаж байгаатай ЯГ ижил хэв маяг.)
 */
export async function loadOverdueMilestones(
  db: D1Database,
  today: string,
): Promise<OverdueMilestone[]> {
  const { results } = await db
    .prepare(
      `WITH ${LATEST_TASK_CTE},
            ${BLOCK_DONE_CTE}
       SELECT ${MILESTONE_COLUMNS},
              COALESCE(NULLIF(TRIM(p.display_title), ''), p.name) AS project_title
         FROM project_milestones m
         JOIN projects p ON p.id = m.project_id
         ${MILESTONE_JOINS}
        WHERE p.status = 'active'
          AND m.overdue_notified_at IS NULL
          AND m.due_date ${ISO_GLOB}
          AND m.due_date < ?
        ORDER BY m.due_date`,
    )
    .bind(today)
    .all<MilestoneRow>();

  const open = (results ?? []).filter((m) => !milestoneDone(m));
  const people = await loadMilestonePeople(db, open.map((m) => m.id));

  const out: OverdueMilestone[] = [];
  for (const m of open) {
    const days = diffDays(m.due_date, today);
    out.push({
      id: m.id,
      project_id: m.project_id,
      project_title: m.project_title ?? '',
      title: m.title,
      due_date: m.due_date,
      assignee_ids: (people.get(m.id) ?? []).map((p) => p.id),
      days_overdue: Number.isFinite(days) ? days : 0,
    });
  }
  return out;
}

/* ================================================================== */
/*  GET /api/deadlines/project/:id                                     */
/* ================================================================== */
/*
 *  Нэг төслийн БҮХ хугацааг нэг жагсаалтаар.  «Хугацаа» таб болон hero
 *  дээрх chip хоёул үүнийг уншина — нэг эх сурвалж.
 *
 *  ⚠️ ТӨСЛИЙН ЯВЦЫГ ЭНД БОДОХГҮЙ.  Төслийн мөрийн `done` нь ЗӨВХӨН
 *     `projects.status`-аас гарна (completed/archived).  Шалтгаан:
 *     жинлэсэн rollup нь репод АЛЬ ХЭДИЙН 11 газар хуулагдсан бөгөөд
 *     тэдгээрийг ижил байлгах ямар ч автомат баталгаа байхгүй
 *     (CLAUDE.md-ийн «ONE rollup» хэсэг ба `PROJECT_LIST_SQL`-ийн толгойн
 *     жагсаалтыг үз).  12 дахийг нь энд үүсгэх нь дараагийн зөрүүг
 *     төрүүлнэ.  Явцад тулгуурласан төслийн эрсдэл хэрэгтэй бол Timeline
 *     хуудас (`/api/timeline`) хэвээрээ эрх мэдэлтэй эх сурвалж.
 *     Практик зөрүү нарийн: 99.999%-д хүрсэн төсөл автоматаар архивлагддаг
 *     тул «100% ч гэсэн active» цонх бараг үүсдэггүй.
 */
deadlines.get('/project/:id', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return c.json({ error: 'Төслийн дугаар буруу' }, 400);
  }
  const user = c.get('user');
  const today = todayInUB();

  if (!(await clientMayReadProject(c.env.DB, user, projectId))) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const project = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.display_title, p.status,
            pp.start_date  AS start_date,
            pp.finish_date AS finish_date
       FROM projects p
       LEFT JOIN project_passport pp ON pp.project_id = p.id
      WHERE p.id = ?`,
  )
    .bind(projectId)
    .first<{
      id: number;
      name: string;
      display_title: string | null;
      status: string;
      start_date: string | null;
      finish_date: string | null;
    }>();
  if (!project) return c.json({ error: 'Төсөл олдсонгүй' }, 404);

  // ---- Milestone + блокийн муж + таскийн мөрүүд + дэд хугацаанууд ----
  const [blockRes, taskRes, assigneeRes, subRes, milestoneRes] = await Promise.all([
    // (a) Блок бүрийн муж нь доорх таскуудаас УРГАНА (blocks-д огнооны
    //     багана байхгүй — `computeBlockTiming`-ийн frontend логиктой ижил).
    c.env.DB.prepare(
      `WITH ${LATEST_TASK_CTE}
       SELECT b.id                                      AS id,
              b.name                                    AS name,
              MIN(CASE WHEN t.start_date ${ISO_GLOB} THEN t.start_date END) AS start_date,
              MAX(CASE WHEN t.due_date   ${ISO_GLOB} THEN t.due_date   END) AS due_date,
              COUNT(t.id)                               AS task_count,
              SUM(CASE WHEN COALESCE(lt.percentage, 0) >= 100 THEN 1 ELSE 0 END) AS done_count
         FROM blocks b
         JOIN drawings d       ON d.block_id = b.id
         JOIN components c     ON c.drawing_id = d.id
         JOIN tasks t          ON t.component_id = c.id
         LEFT JOIN latest_task lt ON lt.task_id = t.id
        WHERE b.project_id = ?
        GROUP BY b.id, b.name
       HAVING due_date IS NOT NULL OR start_date IS NOT NULL`,
    )
      .bind(projectId)
      .all<{
        id: number;
        name: string;
        start_date: string | null;
        due_date: string | null;
        task_count: number;
        done_count: number;
      }>(),

    // (b) Огноотой таскууд.  «Сүүлийн батлагдсан бичилт»-ийн tiebreak нь
    //     `created_at DESC` — `routes/projects.ts`-ийн төслийн дэлгэрэнгүй
    //     rollup-тай ЯГ ИЖИЛ (энэ жагсаалт тэр хуудсан дээр зэрэгцэж
    //     харагддаг тул хоёр газарт өөр хувь гарах нь болохгүй).
    c.env.DB.prepare(
      `WITH ${LATEST_TASK_CTE}
       SELECT t.id, t.name, t.start_date, t.due_date,
              b.id AS block_id, b.name AS block_name,
              COALESCE(lt.percentage, 0) AS progress
         FROM tasks t
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
         LEFT JOIN latest_task lt ON lt.task_id = t.id
        WHERE b.project_id = ?
          AND (t.due_date IS NOT NULL OR t.start_date IS NOT NULL)`,
    )
      .bind(projectId)
      .all<{
        id: number;
        name: string;
        start_date: string | null;
        due_date: string | null;
        block_id: number;
        block_name: string;
        progress: number;
      }>(),

    // (c) Таскийн эзэд — `task_assignees` (олон эзэн) нь эх сурвалж.
    c.env.DB.prepare(
      `SELECT ta.task_id, u.id AS user_id, u.full_name
         FROM task_assignees ta
         JOIN users u      ON u.id = ta.user_id
         JOIN tasks t      ON t.id = ta.task_id
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
        WHERE b.project_id = ?`,
    )
      .bind(projectId)
      .all<{ task_id: number; user_id: number; full_name: string }>(),

    // (d) Дэд хугацаанууд (migration 0148) — ЗӨВХӨН БИЕЛСЭН нь (түүх).  Биелүүлэх/засах замууд 2026-10-02-нд хасагдсан
    //     тул нээлттэй хуучин шалгах цэг хэзээ ч хаагдахгүй — тэдгээрийг «хоцорсон» гэж харуулбал үүрд улаан дохио болно.
    c.env.DB.prepare(
      `SELECT td.id, td.task_id, td.title, td.due_date, td.note,
              td.done_at, td.sort_order,
              t.name  AS task_name,
              b.id    AS block_id,
              b.name  AS block_name,
              u.id    AS assignee_id,
              u.full_name AS assignee_name
         FROM task_deadlines td
         JOIN tasks t      ON t.id = td.task_id
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
         LEFT JOIN users u ON u.id = td.assignee_id
        WHERE b.project_id = ? AND td.done_at IS NOT NULL`,
    )
      .bind(projectId)
      .all<{
        id: number;
        task_id: number;
        title: string;
        due_date: string;
        note: string | null;
        done_at: string | null;
        sort_order: number;
        task_name: string;
        block_id: number;
        block_name: string;
        assignee_id: number | null;
        assignee_name: string | null;
      }>(),

    // (e) Milestone-ууд (migration 0173) — дээд түвшин ба дэд хугацаа хамт.
    //     Мод угсрахыг frontend `parent_id`-аар хийнэ; энд хавтгайгаар
    //     буцаана (жагсаалт нь эрсдэлээр эрэмбэлэгддэг тул мод нь зөвхөн
    //     харагдацын асуудал).
    c.env.DB.prepare(
      `WITH ${LATEST_TASK_CTE},
            ${BLOCK_DONE_CTE}
       SELECT ${MILESTONE_COLUMNS}
         FROM project_milestones m
         ${MILESTONE_JOINS}
        WHERE m.project_id = ?
        ORDER BY m.due_date, m.sort_order, m.id`,
    )
      .bind(projectId)
      .all<MilestoneRow>(),
  ]);

  const peopleByTask = new Map<number, DeadlinePerson[]>();
  for (const row of assigneeRes.results ?? []) {
    const list = peopleByTask.get(row.task_id) ?? [];
    if (!list.some((p) => p.id === row.user_id)) {
      list.push({ id: row.user_id, full_name: row.full_name });
    }
    peopleByTask.set(row.task_id, list);
  }

  const isManager = hasManagerRole(user.role);

  const items: DeadlineItem[] = [];

  // ---- Төслийн мөр ----
  const projStart = isoOrNull(project.start_date);
  const projFinish = isoOrNull(project.finish_date);
  const projDone = project.status === 'completed' || project.status === 'archived';
  const projRisk = computeDeadlineRisk(
    { due_date: projFinish, start_date: projStart, done: projDone },
    today,
  );
  items.push({
    key: `project:${project.id}`,
    kind: 'project',
    id: project.id,
    title: project.display_title?.trim() || project.name,
    due_date: projFinish,
    start_date: projStart,
    done: projDone,
    progress: null,
    block_id: null,
    block_name: null,
    task_id: null,
    task_name: null,
    note: null,
    people: [],
    can_edit: false, // Төслийн огноог `/api/timeline/.../schedule` засна.
    risk_state: projRisk.state,
    days_left: projRisk.days_left,
    days_to_start: projRisk.days_to_start,
  });

  // ---- Milestone-ийн мөрүүд ----
  // Бичих эрх нь мөр бүрд ижил (дүрээс л шалтгаална) тул нэг л удаа бодно.
  const milestoneRows = milestoneRes.results ?? [];
  const milestonePeople = await loadMilestonePeople(
    c.env.DB,
    milestoneRows.map((m) => m.id),
  );
  for (const m of milestoneRows) {
    items.push(milestoneToItem(m, today, isManager, milestonePeople.get(m.id) ?? []));
  }

  // ---- Блокийн мөрүүд ----
  for (const b of blockRes.results ?? []) {
    const due = isoOrNull(b.due_date);
    const start = isoOrNull(b.start_date);
    const done = b.task_count > 0 && b.done_count >= b.task_count;
    const risk = computeDeadlineRisk({ due_date: due, start_date: start, done }, today);
    items.push({
      key: `block:${b.id}`,
      kind: 'block',
      id: b.id,
      title: b.name,
      due_date: due,
      start_date: start,
      done,
      progress: null,
      block_id: b.id,
      block_name: b.name,
      task_id: null,
      task_name: null,
      note: null,
      people: [],
      can_edit: false,
      risk_state: risk.state,
      days_left: risk.days_left,
      days_to_start: risk.days_to_start,
    });
  }

  // ---- Таскийн мөрүүд ----
  for (const t of taskRes.results ?? []) {
    const due = isoOrNull(t.due_date);
    const start = isoOrNull(t.start_date);
    // ISO биш огноотой таск нь хоёр талдаа NULL болвол жагсаалтад
    // утгагүй — алгасна (SQL-ийн шүүлт зөвхөн "NULL биш"-ийг шалгасан).
    if (!due && !start) continue;
    const progress = Number(t.progress) || 0;
    const done = progress >= 100;
    const risk = computeDeadlineRisk({ due_date: due, start_date: start, done }, today);
    items.push({
      key: `task:${t.id}`,
      kind: 'task',
      id: t.id,
      title: t.name,
      due_date: due,
      start_date: start,
      done,
      progress,
      block_id: t.block_id,
      block_name: t.block_name,
      task_id: t.id,
      task_name: t.name,
      note: null,
      people: peopleByTask.get(t.id) ?? [],
      can_edit: false, // Таскийн огноог `PUT /api/tasks/:id` засна.
      risk_state: risk.state,
      days_left: risk.days_left,
      days_to_start: risk.days_to_start,
    });
  }

  // ---- Дэд хугацааны мөрүүд ----
  for (const s of subRes.results ?? []) {
    const due = isoOrNull(s.due_date);
    const done = s.done_at != null;
    const risk = computeDeadlineRisk({ due_date: due, done }, today);
    // Тодорхой эзэн заагаагүй бол эцэг таскийн эздийг өвлөнө.
    const people: DeadlinePerson[] =
      s.assignee_id != null
        ? [{ id: s.assignee_id, full_name: s.assignee_name ?? '' }]
        : (peopleByTask.get(s.task_id) ?? []);
    items.push({
      key: `sub:${s.id}`,
      kind: 'sub',
      id: s.id,
      title: s.title,
      due_date: due,
      start_date: null,
      done,
      progress: null,
      block_id: s.block_id,
      block_name: s.block_name,
      task_id: s.task_id,
      task_name: s.task_name,
      note: s.note,
      people,
      can_edit: false, // Таскийн дэд хугацааг үүсгэх/засах боломж 2026-10-02-нд хасагдсан (түүх л харагдана).
      risk_state: risk.state,
      days_left: risk.days_left,
      days_to_start: risk.days_to_start,
    });
  }

  const body: ProjectDeadlineResponse = {
    today,
    can_manage_milestones: isManager,
    project: {
      id: project.id,
      name: project.name,
      display_title: project.display_title,
      status: project.status,
      start_date: projStart,
      finish_date: projFinish,
      risk_state: projRisk.state,
      days_left: projRisk.days_left,
      days_to_start: projRisk.days_to_start,
    },
    items: sortItems(items),
  };
  return c.json(body);
});

/* ================================================================== */
/*  Огнооны мужаар цуглуулах — `/upcoming` ба `/calendar`-ийн НИЙТЛЭГ ЦӨМ */
/* ================================================================== */
/*
 *  Хоёр хэрэглэгч, НЭГ эх сурвалж:
 *    · `/upcoming` — доод хязгааргүй (хугацаа хэтэрсэн бүхэн орно),
 *                    эрсдэлээр эрэмбэлж таслана.  Dashboard-ийн карт.
 *    · `/calendar` — хатуу [from, to] муж.  Хуанлийн сүлжээ.
 *  Хоёр газарт ижил SQL хуулбарлавал нэг өдөр нэг нь milestone-ыг мартаж,
 *  хуудас бүр өөр тоо харуулна — тиймээс ганц функц.
 *
 *  ЗӨВХӨН ДУУСААГҮЙ мөр буцаана: хуанли ч, карт ч «хийх ёстой зүйл»
 *  харуулдаг.  Milestone-ийн «дууссан» нь SQL-д бодогдохгүй (холбоосон
 *  ажлын явцаас гарч болзошгүй) тул JS талд `milestoneDone`-оор шүүнэ.
 *
 *  scope='mine' — надад оноогдсон таск, миний дэд хугацаа, миний хариуцсан
 *                 milestone, миний гишүүн болсон төслийн хугацаанууд.
 *  scope='all'  — бүх идэвхтэй төслийн бүх мөр.  ЗӨВХӨН admin + senior —
 *                 дүрийн шалгалтыг ДУУДАГЧ тал хийнэ, энэ функц хийхгүй.
 */
const UPCOMING_LIMIT = 100;
const DEFAULT_WINDOW_DAYS = 30;

/** `include_done=1` үед нэмж буцаах БИЕЛСЭН мөрийн дээд тоо.  Нээлттэй
 *  мөрийн квотоос ТУСДАА — «саяхан хаасан ажлаа харах» нь эргэн харах
 *  зорилготой болохоос архив биш, тиймээс бага байхад зүгээр. */
const DONE_LIMIT = 50;

/** Query-ийн boolean туг.  `?include_done=1` / `=true` хоёуланг хүлээж
 *  авна — дуудагч тал хэлбэрээ санах шаардлагагүй. */
function isTruthyFlag(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Хуанлийн нэг хүсэлтээр татах хамгийн урт муж (улирал).  Хязгааргүй
 *  мужийг зөвшөөрвөл нэг хүсэлт бүх түүхийг татах болно. */
const MAX_CALENDAR_DAYS = 92;

/** «Доод хязгааргүй» гэдгийг илэрхийлэх хамгийн эрт ISO огноо.  SQL-ийг
 *  НЭГ хэлбэртэй байлгана — нөхцөлт WHERE угсрахын оронд үргэлж
 *  `BETWEEN ? AND ?` хэрэглэх тул bind-ийн тоо тогтмол хэвээр үлдэнэ. */
const NO_LOWER_BOUND = '0000-01-01';

interface RangeArgs {
  /** ISO огноо (оруулаад).  Доод хязгааргүй бол `NO_LOWER_BOUND`. */
  from: string;
  /** ISO огноо (оруулаад). */
  to: string;
  scope: 'mine' | 'all';
  today: string;
  /** Эх сурвалж БҮРТ тавигдах дээд хязгаар (нийт биш). */
  limit: number;
  /**
   * Биелсэн мөрүүдийг ч буцаах уу.
   *
   * ⚠️ ЯАГААД ЭНЭ ТУГ БАЙХ ЁСТОЙ ВЭ: 2026-08 хүртэл энэ цуглуулагч
   *    биелсэн мөрийг ҮРГЭЛЖ хаядаг байсан.  Улмаас `/app/deadlines` дээр
   *    хугацааг чагтлах нь түүнийг БҮРМӨСӨН АЛГА БОЛГОДОГ байв — эзэн
   *    «тэмдэглэсэн хугацаагаа хаанаас ч олохгүй байна» гэж мэдээлсэн.
   *    Одоо хуудас нь `include_done=1`-ээр дуудаж, биелсэн мөрийг
   *    жагсаалтын ЁРООЛД тэмдэглэгээтэй нь үлдээнэ.
   *
   * ⚠️ ЗӨВХӨН `milestone` ба `sub` мөрөнд хамаарна — тэд л гараар
   *    чагтлагддаг.  Дууссан ТАСК-уудыг оруулбал (төсөл бүрт 50-200 таск)
   *    жагсаалт живэх бөгөөд хэрэглэгч тэднийг энэ хуудсанд хааж ч
   *    чадахгүй тул утгагүй.  Dashboard-ийн карт нь тугийг өгөхгүй тул
   *    хуучин зан үйлээрээ (зөвхөн нээлттэй) хэвээр үлдэнэ.
   */
  includeDone: boolean;
}

async function collectRangeItems(
  db: D1Database,
  user: { sub: number; role: string },
  { from, to, scope, today, limit, includeDone }: RangeArgs,
): Promise<DeadlineItem[]> {
  // SQL-д `? = 1` хэлбэрээр шалгана (D1 нь boolean bind дэмждэггүй).
  const incDone = includeDone ? 1 : 0;
  // SQL дотор `? = 0` гэсэн шүүлтийг унтраахад ашиглана — scope='all' үед
  // «минийх» нөхцлүүд бүхэлдээ үнэн болно.
  const mine = scope === 'mine' ? 1 : 0;
  const isManager = hasManagerRole(user.role);

  const [taskRes, subRes, projRes, milestoneRes] = await Promise.all([
    // (a) Дуусаагүй, огноотой таскууд.
    db.prepare(
      `WITH ${LATEST_TASK_CTE}
       SELECT t.id, t.name, t.start_date, t.due_date,
              b.id AS block_id, b.name AS block_name,
              p.id AS project_id,
              COALESCE(NULLIF(TRIM(p.display_title), ''), p.name) AS project_title,
              COALESCE(lt.percentage, 0) AS progress
         FROM tasks t
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
         JOIN projects p   ON p.id = b.project_id
         LEFT JOIN latest_task lt ON lt.task_id = t.id
        WHERE p.status = 'active'
          AND t.due_date ${ISO_GLOB}
          AND t.due_date BETWEEN ? AND ?
          AND COALESCE(lt.percentage, 0) < 100
          AND (? = 0 OR t.assigned_to = ?
               OR EXISTS (SELECT 1 FROM task_assignees ta
                           WHERE ta.task_id = t.id AND ta.user_id = ?))
          -- «Би өөрийн хэсгээ дуусгасан» (0253) — ЗӨВХӨН scope='mine' дээр.
          -- Ажилтны хувийн тэмдэглэгээ тул scope='all'-ын ахлагч/админд
          -- мөр хэвээрээ харагдана.
          AND (? = 0 OR NOT EXISTS (SELECT 1 FROM task_self_done sd
                                     WHERE sd.task_id = t.id AND sd.user_id = ?))
        ORDER BY t.due_date
        LIMIT ?`,
    )
      .bind(from, to, mine, user.sub, user.sub, mine, user.sub, limit)
      .all<{
        id: number;
        name: string;
        start_date: string | null;
        due_date: string;
        block_id: number;
        block_name: string;
        project_id: number;
        project_title: string;
        progress: number;
      }>(),

    // (b) Дэд хугацаанууд.  «Минийх» гэдэг нь: шууд оноогдсон, ЭСВЭЛ эзэн
    //     заагаагүй атал эцэг таск нь надад оноогдсон.
    //
    //     ⚠️ 2026-10-02: дэд хугацааг биелүүлэх/засах боломж хасагдсан тул НЭЭЛТТЭЙ (done_at IS NULL) мөр энд ХЭЗЭЭ Ч
    //     орохгүй (хэзээ ч хаагдахгүй «хоцорсон» дохио болно); биелсэн нь зөвхөн `include_done`-д (түүх).
    //
    //     ЭРЭМБЭ нь `done_at IS NOT NULL`-ээр эхэлнэ (түүхийн хэвээр).
    db.prepare(
      `SELECT td.id, td.task_id, td.title, td.due_date, td.note, td.done_at,
              t.name AS task_name,
              b.id   AS block_id, b.name AS block_name,
              p.id   AS project_id,
              COALESCE(NULLIF(TRIM(p.display_title), ''), p.name) AS project_title,
              u.id   AS assignee_id, u.full_name AS assignee_name
         FROM task_deadlines td
         JOIN tasks t      ON t.id = td.task_id
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
         JOIN projects p   ON p.id = b.project_id
         LEFT JOIN users u ON u.id = td.assignee_id
        WHERE p.status = 'active'
          AND (? = 1 AND td.done_at IS NOT NULL)
          AND td.due_date ${ISO_GLOB}
          AND td.due_date BETWEEN ? AND ?
          AND (? = 0
               OR td.assignee_id = ?
               OR (td.assignee_id IS NULL
                   AND (t.assigned_to = ?
                        OR EXISTS (SELECT 1 FROM task_assignees ta
                                    WHERE ta.task_id = t.id AND ta.user_id = ?))))
          -- Эцэг таскаа «дуусгасан» гэж хаасан бол түүний дэд хугацаанууд ч
          -- миний жагсаалтад гарах ёсгүй — эс тэгвэл нэг таск нэг самбараас
          -- алга болоод нөгөөд нь үлдэж, зөрүүтэй харагдана.
          AND (? = 0 OR NOT EXISTS (SELECT 1 FROM task_self_done sd
                                     WHERE sd.task_id = td.task_id AND sd.user_id = ?))
        ORDER BY (td.done_at IS NOT NULL), td.due_date
        LIMIT ?`,
    )
      .bind(incDone, from, to, mine, user.sub, user.sub, user.sub, mine, user.sub, limit)
      .all<{
        id: number;
        task_id: number;
        title: string;
        due_date: string;
        note: string | null;
        done_at: string | null;
        task_name: string;
        block_id: number;
        block_name: string;
        project_id: number;
        project_title: string;
        assignee_id: number | null;
        assignee_name: string | null;
      }>(),

    // (c) Төслийн эцсийн хугацаа.  `mine` үед зөвхөн гишүүн болсон төсөл.
    //     Клиент дүр нь `mine`-аар л ирнэ (дээр `all`-ыг 403-оор хаасан)
    //     тул гишүүнчлэлийн шүүлт нь түүний хамгаалалт мөн болно.
    db.prepare(
      `SELECT p.id,
              COALESCE(NULLIF(TRIM(p.display_title), ''), p.name) AS title,
              pp.start_date, pp.finish_date
         FROM projects p
         JOIN project_passport pp ON pp.project_id = p.id
        WHERE p.status = 'active'
          AND ${NOT_ASR_ONLY_SQL}
          AND pp.finish_date ${ISO_GLOB}
          AND pp.finish_date BETWEEN ? AND ?
          AND (? = 0 OR EXISTS (SELECT 1 FROM project_members pm
                                 WHERE pm.project_id = p.id AND pm.user_id = ?))
        ORDER BY pp.finish_date
        LIMIT ?`,
    )
      .bind(from, to, mine, user.sub, limit)
      .all<{
        id: number;
        title: string;
        start_date: string | null;
        finish_date: string;
      }>(),

    // (d) Milestone-ууд (migration 0173 + 0176).  «Минийх» гэдэг нь: би
    //     хариуцагчдын НЭГ нь, ЭСВЭЛ хариуцагч ОГТ заагаагүй атал би тухайн
    //     төслийн гишүүн (төслийн түвшний хугацаа нь багийн бүх гишүүнд
    //     хамаатай — дээрх (c) төслийн мөртэй ижил зарчим).
    //     `done_at IS NULL` гэж ЭНД шүүхгүй: холбоостой milestone нь
    //     `done_at`-гүй атлаа явцаараа дууссан байж болно.  Шүүлтийг
    //     `milestoneDone`-оор JS талд хийнэ.
    db.prepare(
      `WITH ${LATEST_TASK_CTE},
            ${BLOCK_DONE_CTE}
       SELECT ${MILESTONE_COLUMNS},
              COALESCE(NULLIF(TRIM(p.display_title), ''), p.name) AS project_title
         FROM project_milestones m
         JOIN projects p ON p.id = m.project_id
         ${MILESTONE_JOINS}
        WHERE p.status = 'active'
          AND m.due_date ${ISO_GLOB}
          AND m.due_date BETWEEN ? AND ?
          AND (? = 0
               OR EXISTS (SELECT 1 FROM project_milestone_assignees a
                           WHERE a.milestone_id = m.id AND a.user_id = ?)
               OR (NOT EXISTS (SELECT 1 FROM project_milestone_assignees a2
                                WHERE a2.milestone_id = m.id)
                   AND EXISTS (SELECT 1 FROM project_members pm
                                WHERE pm.project_id = m.project_id
                                  AND pm.user_id = ?)))
        ORDER BY m.due_date
        LIMIT ?`,
    )
      .bind(from, to, mine, user.sub, user.sub, limit)
      .all<MilestoneRow>(),
  ]);

  const items: DeadlineItem[] = [];

  for (const p of projRes.results ?? []) {
    const due = isoOrNull(p.finish_date);
    const start = isoOrNull(p.start_date);
    const risk = computeDeadlineRisk({ due_date: due, start_date: start, done: false }, today);
    items.push({
      key: `project:${p.id}`,
      kind: 'project',
      id: p.id,
      title: p.title,
      due_date: due,
      start_date: start,
      done: false,
      progress: null,
      block_id: null,
      block_name: null,
      task_id: null,
      task_name: null,
      note: null,
      people: [],
      can_edit: false,
      risk_state: risk.state,
      days_left: risk.days_left,
      days_to_start: risk.days_to_start,
    });
  }

  for (const t of taskRes.results ?? []) {
    const due = isoOrNull(t.due_date);
    const start = isoOrNull(t.start_date);
    const risk = computeDeadlineRisk({ due_date: due, start_date: start, done: false }, today);
    items.push({
      key: `task:${t.id}`,
      kind: 'task',
      id: t.id,
      title: t.name,
      due_date: due,
      start_date: start,
      done: false,
      progress: Number(t.progress) || 0,
      block_id: t.block_id,
      block_name: t.block_name,
      task_id: t.id,
      task_name: t.name,
      note: null,
      people: [],
      can_edit: false,
      risk_state: risk.state,
      days_left: risk.days_left,
      days_to_start: risk.days_to_start,
      project_id: t.project_id,
      project_title: t.project_title,
    });
  }

  for (const s of subRes.results ?? []) {
    const due = isoOrNull(s.due_date);
    // `done` нь `done_at`-аас гарна — `includeDone=false` үед SQL аль хэдийн
    // шүүсэн тул үргэлж false, харин `true` үед жинхэнэ төлөв ирнэ.
    const done = s.done_at != null;
    const risk = computeDeadlineRisk({ due_date: due, done }, today);
    items.push({
      key: `sub:${s.id}`,
      kind: 'sub',
      id: s.id,
      title: s.title,
      due_date: due,
      start_date: null,
      done,
      progress: null,
      block_id: s.block_id,
      block_name: s.block_name,
      task_id: s.task_id,
      task_name: s.task_name,
      note: s.note,
      done_at: s.done_at,
      people:
        s.assignee_id != null
          ? [{ id: s.assignee_id, full_name: s.assignee_name ?? '' }]
          : [],
      can_edit: false,
      risk_state: risk.state,
      days_left: risk.days_left,
      days_to_start: risk.days_to_start,
      project_id: s.project_id,
      project_title: s.project_title,
    });
  }

  // Milestone.  `milestoneDone` нь холбоостой мөрийн хувьд явцаас,
  // холбоосгүйд `done_at`-аас шийднэ (SQL-д илэрхийлэх боломжгүй тул энд
  // шүүв).  `includeDone` үед бүгдийг үлдээнэ — эрэмбэ нь `sortItems`-д
  // `risk_state='done'` болж хамгийн ард очно.
  const milestoneRows = includeDone
    ? (milestoneRes.results ?? [])
    : (milestoneRes.results ?? []).filter((m) => !milestoneDone(m));
  const milestonePeople = await loadMilestonePeople(
    db,
    milestoneRows.map((m) => m.id),
  );
  for (const m of milestoneRows) {
    items.push({
      ...milestoneToItem(m, today, isManager, milestonePeople.get(m.id) ?? []),
      project_id: m.project_id,
      project_title: m.project_title ?? '',
    });
  }

  return items;
}

/* ================================================================== */
/*  GET /api/deadlines/upcoming?scope=mine|all&days=30                 */
/* ================================================================== */
/*
 *  Dashboard-ийн «Ойрын хугацаанууд» карт ба хуанлийн дээрх зурвас.
 *
 *  ХУГАЦАА ХЭТЭРСЭН мөрүүд `days` цонхноос ҮЛ ХАМААРЧ үргэлж орно —
 *  цонхны гадна үлдээвэл хамгийн чухал мөр нь алга болно.  Үүнийг
 *  `from = NO_LOWER_BOUND` гэдгээр илэрхийлнэ.
 *
 *  `include_done=1` нь БИЕЛСЭН milestone/дэд хугацааг ч буцаана
 *  (`/app/deadlines` хуудас).  Тэдгээр нь `sortItems`-ээр ард орно, мөн
 *  доорх тайралт нь НЭЭЛТТЭЙ мөрийг эхэлж багтаана — биелсэн мөр нээлттэйг
 *  нь хэзээ ч шахаж гаргахгүй.  Тугийг өгөөгүй дуудагч (Dashboard-ийн
 *  карт, DeadlineStrip) хуучин зан үйлээрээ үлдэнэ.
 */
deadlines.get('/upcoming', async (c) => {
  const user = c.get('user');
  const today = todayInUB();

  const scopeRaw = (c.req.query('scope') ?? 'mine').toLowerCase();
  const scope = scopeRaw === 'all' ? 'all' : 'mine';
  if (scope === 'all' && !hasManagerRole(user.role)) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const daysRaw = parseInt(c.req.query('days') ?? '', 10);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : DEFAULT_WINDOW_DAYS;
  // Цонхны дээд хязгаар — `addDaysIso`-г ашиглалгүй энгийн UTC арифметик
  // (`today` нь аль хэдийн УБ-ийн өдөр, эндээс зөвхөн мөр шүүнэ).
  const until = new Date(new Date(`${today}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const includeDone = isTruthyFlag(c.req.query('include_done'));

  const items = await collectRangeItems(c.env.DB, user, {
    from: NO_LOWER_BOUND,
    to: until,
    scope,
    today,
    limit: UPCOMING_LIMIT,
    includeDone,
  });

  // Тайралтыг ХОЁР ХУВААНА: нээлттэй мөр бүрэн квоттой, биелсэн нь тусдаа
  // жижиг квоттой.  Ганц `slice(0, 100)` бол 100 нээлттэй мөртэй хэрэглэгч
  // өөрийн саяхан чагтласан хугацааг ХАРАХГҮЙ болно — яг тэр гомдлыг энэ
  // өөрчлөлт засаж байгаа тул давтахгүй.  (`sortItems` биелсэнийг аль хэдийн
  // ард тавьсан тул залгах нь эрэмбийг хадгална.)
  const sorted = sortItems(items);
  const open = sorted.filter((i) => !i.done).slice(0, UPCOMING_LIMIT);
  const done = sorted.filter((i) => i.done).slice(0, DONE_LIMIT);

  return c.json({
    today,
    scope,
    days,
    items: [...open, ...done],
  });
});

/* ================================================================== */
/*  GET /api/deadlines/calendar?from=&to=&scope=mine|all               */
/* ================================================================== */
/*
 *  Хуанлийн сүлжээнд зориулсан ХАТУУ огнооны муж.  `/upcoming`-аас ялгаатай
 *  нь доод хязгаартай: өнгөрсөн сар руу гүйлгэхэд тэр сарын мөрүүд гарах
 *  ёстой, харин «хэтэрсэн бүхнийг үргэлж оруулах» дүрэм энд утгагүй
 *  (хуанли дээр мөр нь өөрийн нүдэндээ л суух ёстой).
 *
 *  Эрэмбэ нь `/upcoming`-тайгаа ижил (эрсдэл → огноо) — нэг өдрийн доторх
 *  мөрүүд хуанлийн нүдэнд яаралтайгаараа эрэмбэлэгдэнэ.
 */
deadlines.get('/calendar', async (c) => {
  const user = c.get('user');
  const today = todayInUB();

  const scopeRaw = (c.req.query('scope') ?? 'mine').toLowerCase();
  const scope = scopeRaw === 'all' ? 'all' : 'mine';
  if (scope === 'all' && !hasManagerRole(user.role)) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const from = (c.req.query('from') ?? '').trim();
  const to = (c.req.query('to') ?? '').trim();
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return c.json({ error: 'Огноо буруу форматтай (YYYY-MM-DD)' }, 400);
  }
  const span = diffDays(from, to);
  if (span < 0) return c.json({ error: 'Эхлэх огноо дуусах огнооноос хойно байна' }, 400);
  if (span > MAX_CALENDAR_DAYS) {
    return c.json({ error: `Хугацааны муж хэт урт (дээд тал нь ${MAX_CALENDAR_DAYS} хоног)` }, 400);
  }

  const items = await collectRangeItems(c.env.DB, user, {
    from,
    to,
    scope,
    today,
    limit: UPCOMING_LIMIT,
    includeDone: isTruthyFlag(c.req.query('include_done')),
  });

  return c.json({ today, scope, from, to, items: sortItems(items) });
});

/* ================================================================== */
/*  GET /api/deadlines/summary?project_ids=1,2,3                       */
/* ================================================================== */
/*
 *  Төслийн ЖАГСААЛТ хуудасны карт бүрийн хугацааны chip.  N+1 хүсэлтээс
 *  сэргийлж бүх төслийг НЭГ дуудлагаар авна.
 *
 *  ⚠️ ЗӨВХӨН төслийн эцсийн хугацаа + milestone.  Таск/дэд хугацааг
 *     ЗОРИУДААР ОРУУЛААГҮЙ: тэдгээр нь хүн тус бүрийн ажлын нарийн
 *     задаргаа бөгөөд төслийн картад ямар ч утга нэмэхгүй (мөн олон зуун
 *     мөрийг дүгнэх нь картын хүсэлтийг хүндрүүлнэ).  Төслийн бүх түвшний
 *     хугацааг «Хугацаа» таб (`/project/:id`) харуулна.
 *
 *  Хамрах хүрээ нь ХҮНЭЭС ХАМААРАХГҮЙ — карт нь «энэ ТӨСӨЛ хэр байна»
 *  гэдгийг хэлэх ёстой, «надад юу оногдсон» гэдгийг биш.  Клиент дүрийн
 *  хувьд л гишүүнчлэлээр шүүнэ.
 */
/** ⚠️ D1-ийн нэг мэдэгдэлд 100 bind-ийн хязгаар бий.  Доорх хоёр асуулга
 *  тус бүр `IN (?,?,…)`-д энэ тооны bind хэрэглэдэг тул 100-аас ДООГУУР
 *  байх ёстой.  (Одоогийн репод нийт 24 төсөл байгаа тул тасрал бодитоор
 *  тохиолдохгүй; хэрэв төсөл 60-аас олон болвол энэ утгыг өсгөхийн оронд
 *  дуудагч талыг багцлах хэрэгтэй.) */
const SUMMARY_MAX_PROJECTS = 60;

/** Timeline-ийн баар дээрх НЭГ цэг.  Зөвхөн milestone (дээд болон дэд) —
 *  таскийн огноог ЗОРИУДААР оруулаагүй: төсөлд 50-200 таск байдаг тул
 *  цэгүүд бага томруулалт дээр нэг дээрээ нэгдэж тасархай шугам болно. */
export interface DeadlinePoint {
  id: number;
  title: string;
  due_date: string;
  risk_state: RiskState;
  days_left: number | null;
  done: boolean;
  /** Дэд хугацаа эсэх (`parent_id != null`) — UI жижиг цэгээр зурна. */
  is_sub: boolean;
  /** Холбогдсон блок/таскийн нэр, эсвэл null. */
  link_name: string | null;
  /** Хариуцагчид (migration 0176 — олон хүн байж болно). */
  people: DeadlinePerson[];
  /** Хамрах даалгаврын тоо. */
  task_count: number;
  /** Холбоосон ажлын явц 0..100; холбоосгүй бол null.  `milestoneWork`
   *  үүнийг `task_count`-ийн хамт аль хэдийн бодож байсныг УРЬД НЬ
   *  хаядаг байв — төслийн жагсаалтын hover «хугацаа дөхөж байхад ажил
   *  хаана байна» гэдгийг үзүүлэхэд хэрэгтэй. */
  work_progress: number | null;
  /** `project_milestones.note` — hover дээр мөрийн доор жижгээр гарна. */
  note: string | null;
}

export interface DeadlineSummary {
  project_id: number;
  /** Хамгийн ойрын ДУУСААГҮЙ хугацаа.  Байхгүй бол null. */
  next: {
    kind: 'project' | 'milestone';
    title: string;
    due_date: string;
    risk_state: RiskState;
    days_left: number | null;
  } | null;
  /** Хугацаа хэтэрсэн, дуусаагүй мөрийн тоо. */
  overdue_count: number;
  /** Дуусаагүй, огноотой нийт мөр. */
  open_count: number;
  /** Төслийн ӨӨРИЙН эцсийн хугацаа (`project_passport.finish_date`).
   *
   *  `next`-ээс ЯЛГААТАЙ: тэр нь «хамгийн ойрын нь юу ч бай» гэсэн мөр
   *  бол энэ нь ҮРГЭЛЖ төслийн мөр.  Жагсаалтын hover нь түүнийг
   *  milestone-уудын ДЭЭР тусад нь суулгадаг тул «хамгийн ойрных нь
   *  milestone байвал төслийн огноо алга болох» асуудлаас сэргийлнэ.
   *
   *  Дууссан/архивласан төсөлд null — тэнд эцсийн хугацаа «хийх ажил»
   *  биш (доорх `offer` дуудлагатай ЯГ ижил нөхцөл). */
  project_due: {
    due_date: string;
    risk_state: RiskState;
    days_left: number | null;
  } | null;
  /** Timeline-ийн тэмдэглэгээ.  ДУУССАН мөрүүд ч ОРНО (`done` тугтай) —
   *  «энэ хугацааг барьсан» гэдгийг хуваарь дээр харах нь мэдээлэлтэй.
   *  Харин дээрх тоолуурууд нь дуусаагүйг л тоолно (хоёр өөр асуулт). */
  points: DeadlinePoint[];
}

deadlines.get('/summary', async (c) => {
  const user = c.get('user');
  const today = todayInUB();

  const raw = (c.req.query('project_ids') ?? '').trim();
  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].slice(0, SUMMARY_MAX_PROJECTS);

  if (ids.length === 0) return c.json({ today, items: [] as DeadlineSummary[] });

  // Клиент дүр: зөвхөн гишүүн болсон төслүүд.  Бусад дүрд шүүлт байхгүй —
  // энэ эндпойнт нь тэдний аль хэдийн харж чадах жагсаалтын хажуугийн
  // тоо тул шинэ мэдээлэл нээхгүй.
  let allowed = ids;
  if (user.role === 'client') {
    const ph = ids.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT project_id FROM project_members
        WHERE user_id = ? AND project_id IN (${ph})`,
    )
      .bind(user.sub, ...ids)
      .all<{ project_id: number }>();
    const member = new Set((results ?? []).map((r) => r.project_id));
    allowed = ids.filter((id) => member.has(id));
    if (allowed.length === 0) return c.json({ today, items: [] as DeadlineSummary[] });
  }

  const ph = allowed.map(() => '?').join(',');

  const [projRes, milestoneRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.id,
              COALESCE(NULLIF(TRIM(p.display_title), ''), p.name) AS title,
              p.status,
              pp.finish_date
         FROM projects p
         LEFT JOIN project_passport pp ON pp.project_id = p.id
        WHERE p.id IN (${ph})`,
    )
      .bind(...allowed)
      .all<{ id: number; title: string; status: string; finish_date: string | null }>(),

    c.env.DB.prepare(
      `WITH ${LATEST_TASK_CTE},
            ${BLOCK_DONE_CTE}
       SELECT ${MILESTONE_COLUMNS}
         FROM project_milestones m
         ${MILESTONE_JOINS}
        WHERE m.project_id IN (${ph})
        ORDER BY m.due_date`,
    )
      .bind(...allowed)
      .all<MilestoneRow>(),
  ]);

  // Төсөл бүрийн хуримтлуулагч.  Бүх хүссэн id-д мөр буцаана (хоосон ч
  // гэсэн) — frontend талд «байхгүй» гэдгийг тусад нь шалгах хэрэггүй.
  const acc = new Map<number, DeadlineSummary>();
  for (const id of allowed) {
    acc.set(id, {
      project_id: id,
      next: null,
      overdue_count: 0,
      open_count: 0,
      project_due: null,
      points: [],
    });
  }

  /** Нэг нэр дэвшигчийг хуримтлуулагчид нэмнэ.  «Дараагийнх» нь хамгийн
   *  ЭРТ огноотой нь (эрсдэлээр биш) — карт дээр «дараа юу болох вэ»
   *  гэдэг нь цаг хугацааны асуулт. */
  const offer = (
    projectId: number,
    kind: 'project' | 'milestone',
    title: string,
    due: string,
  ): void => {
    const slot = acc.get(projectId);
    if (!slot) return;
    const risk = computeDeadlineRisk({ due_date: due, done: false }, today);
    slot.open_count += 1;
    if (risk.state === 'overdue') slot.overdue_count += 1;
    if (slot.next === null || due < slot.next.due_date) {
      slot.next = {
        kind,
        title,
        due_date: due,
        risk_state: risk.state,
        days_left: risk.days_left,
      };
    }
  };

  for (const p of projRes.results ?? []) {
    const due = isoOrNull(p.finish_date);
    // Дууссан/архивлагдсан төслийн эцсийн хугацаа нь «хийх ажил» биш.
    if (!due || p.status === 'completed' || p.status === 'archived') continue;
    offer(p.id, 'project', p.title, due);

    // …мөн тусад нь хадгална.  `offer` нь зөвхөн ХАМГИЙН ОЙРЫН мөрийг
    // үлдээдэг тул milestone нь төслийн огнооноос эрт байвал төслийн
    // огноо `next`-ээс шахагдан гарна — hover түүнийг ҮРГЭЛЖ харуулна.
    const slot = acc.get(p.id);
    if (slot) {
      const risk = computeDeadlineRisk({ due_date: due, done: false }, today);
      slot.project_due = { due_date: due, risk_state: risk.state, days_left: risk.days_left };
    }
  }

  const summaryPeople = await loadMilestonePeople(
    c.env.DB,
    (milestoneRes.results ?? []).map((m) => m.id),
  );

  for (const m of milestoneRes.results ?? []) {
    const due = isoOrNull(m.due_date);
    if (!due) continue;
    const done = milestoneDone(m);

    // Тоолуур/«дараагийнх» нь ЗӨВХӨН дуусаагүйг харна…
    if (!done) offer(m.project_id, 'milestone', m.title, due);

    // …харин Timeline-ийн цэгүүдэд дууссан нь ч орно (доорх `done` тугаар
    // ялгагдана).  Барьсан хугацааг хуваарь дээр харах нь мэдээлэлтэй.
    const slot = acc.get(m.project_id);
    if (!slot) continue;
    const risk = computeDeadlineRisk({ due_date: due, done }, today);
    const work = milestoneWork(m);
    slot.points.push({
      id: m.id,
      title: m.title,
      due_date: due,
      risk_state: risk.state,
      days_left: risk.days_left,
      done,
      is_sub: m.parent_id != null,
      link_name: m.link_task_name ?? m.link_block_name ?? null,
      people: summaryPeople.get(m.id) ?? [],
      task_count: work.task_count,
      work_progress: work.work_progress,
      note: readNote(m.note),
    });
  }

  // Цэгүүдийг огноогоор эрэмбэлнэ — Timeline нь тэднийг тэнхлэг дээр
  // байрлуулахдаа дарааллаас хамаардаггүй ч tooltip-ийн жагсаалт нь
  // цаг хугацааны дарааллаар уншигдах ёстой.
  for (const s of acc.values()) {
    s.points.sort((a, b) => a.due_date.localeCompare(b.due_date));
  }

  return c.json({ today, items: [...acc.values()] });
});

/* ================================================================== */
/*  Milestone-ийн CRUD — ЗӨВХӨН admin + senior                         */
/* ================================================================== */
/*
 *  Замууд `/milestones/...` угтвартай тул доорх дэд хугацааны `/:id`
 *  замуудтай мөргөлдөхгүй (сегментийн тоо өөр).  Гэсэн ч репогийн
 *  конвенцоор (CLAUDE.md «Route-order landmines») тодорхой зам нь `/:id`-ээс
 *  ДЭЭР бичигдэнэ.
 */

interface MilestoneBody {
  project_id?: number;
  parent_id?: number | null;
  title?: string;
  due_date?: string;
  note?: string | null;
  /** Хариуцагчид (migration 0176).  `[]` = хэн ч заагаагүй.  Заагаагүй
   *  (`undefined`) бол засварт хөндөгдөхгүй. */
  assignee_ids?: number[];
  block_id?: number | null;
  task_id?: number | null;
}

/** Хүсэлтээс ирсэн id-уудаас ИДЭВХТЭЙ хэрэглэгчдийг шүүнэ.  Идэвхгүй эсвэл
 *  байхгүй хүнийг чимээгүйхэн хаяна (`lib/meetingTasks.ts`-ийн зантай
 *  ижил) — бүтэн хүсэлтийг унагаах нь хэрэглэгчид тус болохгүй. */
async function readActiveUserIds(db: D1Database, raw: unknown): Promise<number[]> {
  if (!Array.isArray(raw)) return [];
  const ids = [
    ...new Set(raw.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)),
  ].slice(0, ID_CHUNK);
  if (ids.length === 0) return [];
  const ph = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT id FROM users WHERE status = 'active' AND id IN (${ph})`)
    .bind(...ids)
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

/** Хариуцагчдын жагсаалтыг БҮТНЭЭР солино (устгаад дахин бичнэ).
 *  Дифф бодохгүй: жагсаалт хэдхэн мөртэй тул энгийн байх нь илүү үнэтэй. */
async function syncMilestoneAssignees(
  db: D1Database,
  milestoneId: number,
  userIds: number[],
): Promise<void> {
  await db
    .prepare('DELETE FROM project_milestone_assignees WHERE milestone_id = ?')
    .bind(milestoneId)
    .run();
  if (userIds.length === 0) return;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO project_milestone_assignees (milestone_id, user_id) VALUES (?, ?)',
  );
  await db.batch(userIds.map((uid) => insert.bind(milestoneId, uid)));
}

/**
 * Эцгийн шалгалт — ГҮНИЙГ 2 ТҮВШИНД БАРИНА.
 *
 * Гурван зүйлийг хориглоно:
 *   1. өөр төслийн milestone-ыг эцэг болгох,
 *   2. дэд хугацааг дахин эцэг болгох (3 дахь түвшин),
 *   3. өөрийгөө өөрийнхөө эцэг болгох (хамгийн энгийн мөчлөг).
 * Мөчлөгийн бусад хэлбэр (A→B→A) нь (2)-оор аль хэдийн боломжгүй:
 *   эцэг нь ҮРГЭЛЖ дээд түвшний мөр байх ёстой.
 */
async function validateParent(
  db: D1Database,
  projectId: number,
  parentId: number,
  selfId: number | null,
): Promise<string | null> {
  if (selfId != null && parentId === selfId) {
    return 'Хугацааг өөрийнх нь дэд хугацаа болгох боломжгүй';
  }
  const parent = await db
    .prepare('SELECT id, project_id, parent_id FROM project_milestones WHERE id = ?')
    .bind(parentId)
    .first<{ id: number; project_id: number; parent_id: number | null }>();
  if (!parent) return 'Эцэг хугацаа олдсонгүй';
  if (parent.project_id !== projectId) return 'Эцэг хугацаа өөр төслийнх байна';
  if (parent.parent_id != null) {
    return 'Дэд хугацааны доор дахин дэд хугацаа үүсгэх боломжгүй (2 түвшин)';
  }
  return null;
}

/** Энэ milestone дэд хугацаатай юу?  Дэд хугацаатай мөрийг өөрийг нь дэд
 *  болгох нь 3 дахь түвшин үүсгэх тул хориотой. */
async function hasChildren(db: D1Database, id: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM project_milestones WHERE parent_id = ? LIMIT 1')
    .bind(id)
    .first<{ ok: number }>();
  return Boolean(row);
}

/** `block_id` / `task_id` нь ТУХАЙН ТӨСЛИЙНХ мөн эсэх.  Өөр төслийн ажилд
 *  холбовол «биелсэн» нь огт хамааралгүй явцаас гарах тул хатуу шалгана.
 *  Буцаах: [blockId, taskId] эсвэл алдааны мессеж. */
async function resolveLink(
  db: D1Database,
  projectId: number,
  blockId: number | null,
  taskId: number | null,
): Promise<{ error: string } | { block_id: number | null; task_id: number | null }> {
  let okBlock: number | null = null;
  let okTask: number | null = null;

  if (taskId != null) {
    const row = await db
      .prepare(
        `SELECT t.id FROM tasks t
           JOIN components c ON c.id = t.component_id
           JOIN drawings d   ON d.id = c.drawing_id
           JOIN blocks b     ON b.id = d.block_id
          WHERE t.id = ? AND b.project_id = ?`,
      )
      .bind(taskId, projectId)
      .first<{ id: number }>();
    if (!row) return { error: 'Холбох даалгавар энэ төсөлд олдсонгүй' };
    okTask = row.id;
  }

  if (blockId != null) {
    const row = await db
      .prepare('SELECT id FROM blocks WHERE id = ? AND project_id = ?')
      .bind(blockId, projectId)
      .first<{ id: number }>();
    if (!row) return { error: 'Холбох блок энэ төсөлд олдсонгүй' };
    okBlock = row.id;
  }

  return { block_id: okBlock, task_id: okTask };
}

/* ---------------- POST /api/deadlines/milestones ------------------- */

deadlines.post('/milestones', async (c) => {
  const user = c.get('user');
  if (!hasManagerRole(user.role)) return c.json({ error: 'Access denied' }, 403);

  const body = await c.req.json<MilestoneBody>().catch(() => ({}) as MilestoneBody);

  const projectId = typeof body.project_id === 'number' ? body.project_id : NaN;
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return c.json({ error: 'Төслийн дугаар буруу' }, 400);
  }
  const title = readTitle(body.title);
  if (!title) return c.json({ error: 'Гарчиг оруулна уу' }, 400);
  const due = typeof body.due_date === 'string' ? body.due_date.trim() : '';
  if (!isIsoDate(due)) return c.json({ error: 'Огноо буруу форматтай (YYYY-MM-DD)' }, 400);

  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number }>();
  if (!project) return c.json({ error: 'Төсөл олдсонгүй' }, 404);

  const parentId =
    typeof body.parent_id === 'number' && Number.isFinite(body.parent_id)
      ? body.parent_id
      : null;
  if (parentId != null) {
    const err = await validateParent(c.env.DB, projectId, parentId, null);
    if (err) return c.json({ error: err }, 400);
  }

  const link = await resolveLink(
    c.env.DB,
    projectId,
    typeof body.block_id === 'number' ? body.block_id : null,
    typeof body.task_id === 'number' ? body.task_id : null,
  );
  if ('error' in link) return c.json({ error: link.error }, 400);

  const assigneeIds = await readActiveUserIds(c.env.DB, body.assignee_ids);

  // Эрэмбэ нь ТҮВШИН тус бүрд тусдаа тоологдоно (дээд түвшний мөрүүд
  // хоорондоо, нэг эцгийн дэд мөрүүд хоорондоо).
  const maxOrder = await c.env.DB.prepare(
    `SELECT MAX(sort_order) AS max_order FROM project_milestones
      WHERE project_id = ? AND parent_id IS ?`,
  )
    .bind(projectId, parentId)
    .first<{ max_order: number | null }>();

  const row = await c.env.DB.prepare(
    `INSERT INTO project_milestones
       (project_id, parent_id, title, due_date, note,
        block_id, task_id, sort_order, created_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      projectId,
      parentId,
      title,
      due,
      readNote(body.note),
      link.block_id,
      link.task_id,
      (maxOrder?.max_order ?? -1) + 1,
      user.sub,
    )
    .first<{ id: number }>();

  if (row?.id != null && assigneeIds.length > 0) {
    await syncMilestoneAssignees(c.env.DB, row.id, assigneeIds);
  }

  return c.json({ success: true, id: row?.id ?? null }, 201);
});

/* ---------------- PUT /api/deadlines/milestones/:id ---------------- */

deadlines.put('/milestones/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Дугаар буруу' }, 400);
  const user = c.get('user');
  if (!hasManagerRole(user.role)) return c.json({ error: 'Access denied' }, 403);

  const body = await c.req.json<MilestoneBody>().catch(() => ({}) as MilestoneBody);

  const existing = await c.env.DB.prepare(
    'SELECT id, project_id, parent_id, due_date, block_id, task_id FROM project_milestones WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: number;
      project_id: number;
      parent_id: number | null;
      due_date: string;
      block_id: number | null;
      task_id: number | null;
    }>();
  if (!existing) return c.json({ error: 'Хугацаа олдсонгүй' }, 404);

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.title !== undefined) {
    const title = readTitle(body.title);
    if (!title) return c.json({ error: 'Гарчиг оруулна уу' }, 400);
    updates.push('title = ?');
    values.push(title);
  }

  if (body.due_date !== undefined) {
    const due = typeof body.due_date === 'string' ? body.due_date.trim() : '';
    if (!isIsoDate(due)) return c.json({ error: 'Огноо буруу форматтай (YYYY-MM-DD)' }, 400);
    updates.push('due_date = ?');
    values.push(due);
    // Огноо ШИЛЖВЭЛ хэтэрсэн сануулгыг дахин нээнэ — шинэ огноо дээр
    // дахин хэтэрвэл дахин мэдэгдэх ёстой (timeline.ts-ийн PUT .../schedule
    // нь `project_reminders`-ийг устгадагтай ижил зарчим).
    if (due !== existing.due_date) {
      updates.push('overdue_notified_at = NULL');
    }
  }

  if (body.note !== undefined) {
    updates.push('note = ?');
    values.push(readNote(body.note));
  }

  // Хариуцагчид нь ТУСДАА хүснэгтэд тул `updates`-д ордоггүй — доор
  // мөрийг шинэчилсний ДАРАА синк хийнэ.
  const nextAssignees =
    body.assignee_ids !== undefined
      ? await readActiveUserIds(c.env.DB, body.assignee_ids)
      : null;

  if (body.parent_id !== undefined) {
    const parentId =
      typeof body.parent_id === 'number' && Number.isFinite(body.parent_id)
        ? body.parent_id
        : null;
    if (parentId != null) {
      if (await hasChildren(c.env.DB, id)) {
        return c.json(
          { error: 'Дэд хугацаатай мөрийг өөрийг нь дэд хугацаа болгох боломжгүй' },
          400,
        );
      }
      const err = await validateParent(c.env.DB, existing.project_id, parentId, id);
      if (err) return c.json({ error: err }, 400);
    }
    updates.push('parent_id = ?');
    values.push(parentId);
  }

  // Холбоосыг ЗӨВХӨН хоёулаа дурдагдсан үед л шинэчилнэ — нэгийг нь
  // дангаар нь солих нь «аль нь давамгайлах вэ» гэсэн эргэлзээ төрүүлнэ.
  if (body.block_id !== undefined || body.task_id !== undefined) {
    const link = await resolveLink(
      c.env.DB,
      existing.project_id,
      body.block_id !== undefined
        ? typeof body.block_id === 'number'
          ? body.block_id
          : null
        : existing.block_id,
      body.task_id !== undefined
        ? typeof body.task_id === 'number'
          ? body.task_id
          : null
        : existing.task_id,
    );
    if ('error' in link) return c.json({ error: link.error }, 400);
    updates.push('block_id = ?', 'task_id = ?');
    values.push(link.block_id, link.task_id);
  }

  // Хариуцагчид ГАНЦААРАА өөрчлөгдөж болно (баганын өөрчлөлтгүй) — тиймээс
  // «өөрчлөх утга алга» шалгалт нь тэднийг ч тооцно.
  if (updates.length === 0 && nextAssignees === null) {
    return c.json({ error: 'Өөрчлөх утга алга' }, 400);
  }

  if (updates.length > 0) {
    updates.push(`updated_at = datetime('now')`);
    values.push(id);
    await c.env.DB.prepare(`UPDATE project_milestones SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  if (nextAssignees !== null) {
    await syncMilestoneAssignees(c.env.DB, id, nextAssignees);
    await c.env.DB.prepare(`UPDATE project_milestones SET updated_at = datetime('now') WHERE id = ?`)
      .bind(id)
      .run();
  }

  return c.json({ success: true });
});

/* ------------- PATCH /api/deadlines/milestones/:id/done ------------ */

deadlines.patch('/milestones/:id/done', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Дугаар буруу' }, 400);
  const user = c.get('user');
  if (!hasManagerRole(user.role)) return c.json({ error: 'Access denied' }, 403);

  const body = await c.req.json<{ done?: boolean }>().catch(() => ({}) as { done?: boolean });
  const done = body.done !== false;

  const existing = await c.env.DB.prepare(
    'SELECT id, block_id, task_id FROM project_milestones WHERE id = ?',
  )
    .bind(id)
    .first<{ id: number; block_id: number | null; task_id: number | null }>();
  if (!existing) return c.json({ error: 'Хугацаа олдсонгүй' }, 404);

  // Ажилтай холбогдсон мөрийн төлөв нь явцаас гардаг тул гараар
  // тэмдэглэсэн ч `milestoneDone` түүнийг үл тоомсорлоно.  Чимээгүй
  // үл тоомсорлохын оронд ил хэлнэ — эс бөгөөс «чагт минь ажиллахгүй
  // байна» гэсэн ойлгомжгүй байдал үүснэ.
  if (existing.task_id != null || existing.block_id != null) {
    return c.json(
      {
        error:
          'Ажилтай холбогдсон хугацааг гараар тэмдэглэх боломжгүй — холбоосон ажил дуусахад автоматаар хаагдана.',
      },
      400,
    );
  }

  await c.env.DB.prepare(
    done
      ? `UPDATE project_milestones
            SET done_at = datetime('now'), done_by_id = ?, updated_at = datetime('now')
          WHERE id = ?`
      : `UPDATE project_milestones
            SET done_at = NULL, done_by_id = NULL, updated_at = datetime('now')
          WHERE id = ?`,
  )
    .bind(...(done ? [user.sub, id] : [id]))
    .run();

  /* ---------------- Дэд хугацаа руу тархах ------------------------- *
   *
   * ДООШОО тархана, ДЭЭШЭЭ ТАРХАХГҮЙ:
   *   · эцгийг «биелсэн» болгох = «үүний доорх бүхэн дууссан» гэсэн үг,
   *     тиймээс дэд хугацаанууд нь дагаж хаагдана;
   *   · дэд хугацааг тэмдэглэх нь эцгийг ХӨНДӨХГҮЙ — нэг шалгах цэг
   *     дуусахад бүтэн хугацаа биеллээ гэсэн үг биш.
   *
   * ⚠️ ЗӨВХӨН `done = true` үед.  Тэмдэглэгээг АВАХ нь ихэвчлэн эцгийн
   *    дээрх алдааг засах үйлдэл; доошоо тарааж дэд хугацаануудын
   *    `done_at`/`done_by_id`-г устгавал бодитоор дууссан ажлын түүх
   *    санамсаргүй устана.  Тиймээс тэмдэглэгээ авах нь эцэгт л үйлчилнэ.
   *
   * ⚠️ Аль хэдийн дууссан дэд хугацааг ДАХИН бичихгүй (`done_at IS NULL`):
   *    анхны дуусгасан хүн, огноо нь хадгалагдана.
   *
   * ⚠️ Ажилтай холбоостой дэд хугацааг алгасна — тэдний төлөв явцаас
   *    гардаг тул `done_at` бичих нь `milestoneDone`-д үл тоомсорлогдож,
   *    өгөгдөл нь хуурамч болно.
   */
  let childrenMarked = 0;
  if (done) {
    const res = await c.env.DB.prepare(
      `UPDATE project_milestones
          SET done_at = datetime('now'), done_by_id = ?, updated_at = datetime('now')
        WHERE parent_id = ?
          AND done_at IS NULL
          AND block_id IS NULL
          AND task_id IS NULL`,
    )
      .bind(user.sub, id)
      .run();
    childrenMarked = res.meta?.changes ?? 0;
  }

  return c.json({ success: true, done, children_marked: childrenMarked });
});

/* -------------- DELETE /api/deadlines/milestones/:id --------------- */

deadlines.delete('/milestones/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Дугаар буруу' }, 400);
  const user = c.get('user');
  if (!hasManagerRole(user.role)) return c.json({ error: 'Access denied' }, 403);

  const existing = await c.env.DB.prepare('SELECT id FROM project_milestones WHERE id = ?')
    .bind(id)
    .first<{ id: number }>();
  if (!existing) return c.json({ error: 'Хугацаа олдсонгүй' }, 404);

  // ⚠️ D1 нь runtime дээр FK-г хэрэгжүүлдэггүй тул `parent_id` ба
  // `milestone_id`-ийн `ON DELETE CASCADE` нь зөвхөн зарлал — хүүхэд
  // мөрүүдийг ГАРААР устгана (migration 0173/0176-ийн толгойг үз).
  // Дараалал чухал: эхлээд дэд хугацааны хариуцагчид, дараа нь дэд
  // хугацаанууд, эцэст нь өөрийнх нь хариуцагчид ба мөр өөрөө.
  await c.env.DB.prepare(
    `DELETE FROM project_milestone_assignees
      WHERE milestone_id IN (SELECT id FROM project_milestones WHERE parent_id = ?)`,
  )
    .bind(id)
    .run();
  await c.env.DB.prepare('DELETE FROM project_milestones WHERE parent_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM project_milestone_assignees WHERE milestone_id = ?')
    .bind(id)
    .run();
  await c.env.DB.prepare('DELETE FROM project_milestones WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});

/* ================================================================== */
/*  Дэд хугацааны CRUD                                                 */
/* ================================================================== */

interface SubDeadlineBody {
  title?: string;
  due_date?: string;
  note?: string | null;
  assignee_id?: number | null;
}

/** `title` цэвэрлэх — хоосон бол алдаа. */
function readTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, TITLE_MAX);
  return s.length > 0 ? s : null;
}

function readNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, NOTE_MAX);
  return s.length > 0 ? s : null;
}

/* ---------------- ТАСКИЙН ДЭД ХУГАЦАА — БИЧИХ ЗАМУУД ХАСАГДСАН (2026-10-02) ----------------
 *
 * Эзний шийдвэр: таскийн дэд хугацаа (`task_deadlines`, 0148) үүсгэх / засах / биелүүлэх / устгах / сануулах
 * хэрэглэгчийн боломжийг БҮРЭН хасна.  Түүх (хүснэгт, GET замууд, төслийн «Хугацаа» таб) ХАДГАЛАГДАНА.
 * Үндсэн хугацаа, milestone (`project_milestones`, түүний дэд хугацаа) ХЭВЭЭР.  Хуучин клиентэд ойлгомжтой 410.
 */
const SUB_DEADLINE_RETIRED = {
  error: 'SUB_DEADLINE_RETIRED',
  message: 'Таскийн дэд хугацааг үүсгэх, засах боломж хасагдсан — үндсэн хугацаа, milestone ашиглана уу.',
};

deadlines.post('/tasks/:taskId', retiredHandler('deadlines.task_create', SUB_DEADLINE_RETIRED));
deadlines.put('/:id', retiredHandler('deadlines.update', SUB_DEADLINE_RETIRED));
deadlines.patch('/:id/done', retiredHandler('deadlines.done', SUB_DEADLINE_RETIRED));
deadlines.delete('/:id', retiredHandler('deadlines.delete', SUB_DEADLINE_RETIRED));

/* ---------------- GET /api/deadlines/tasks/:taskId ----------------- */
/*  Нэг таскийн дэд хугацаанууд — таскийн мөрөн доторх popover уншина. */

deadlines.get('/tasks/:taskId', async (c) => {
  const taskId = parseInt(c.req.param('taskId'), 10);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return c.json({ error: 'Даалгаврын дугаар буруу' }, 400);
  }
  const user = c.get('user');
  const today = todayInUB();

  // Клиент дүрийн хувьд эцэг таскийн төслийн гишүүнчлэлийг шалгана.
  if (user.role === 'client') {
    const owner = await c.env.DB.prepare(
      `SELECT b.project_id AS project_id
         FROM tasks t
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
        WHERE t.id = ?`,
    )
      .bind(taskId)
      .first<{ project_id: number }>();
    if (!owner || !(await clientMayReadProject(c.env.DB, user, owner.project_id))) {
      return c.json({ error: 'Access denied' }, 403);
    }
  }

  const { results } = await c.env.DB.prepare(
    `SELECT td.id, td.title, td.due_date, td.note, td.done_at,
            td.assignee_id, u.full_name AS assignee_name
       FROM task_deadlines td
       LEFT JOIN users u ON u.id = td.assignee_id
      WHERE td.task_id = ?
      ORDER BY td.due_date, td.sort_order, td.id`,
  )
    .bind(taskId)
    .all<{
      id: number;
      title: string;
      due_date: string;
      note: string | null;
      done_at: string | null;
      assignee_id: number | null;
      assignee_name: string | null;
    }>();

  return c.json({
    today,
    can_edit: false, // бичих замууд хасагдсан (2026-10-02) — зөвхөн түүх
    items: (results ?? []).map((s) => {
      const due = isoOrNull(s.due_date);
      const done = s.done_at != null;
      const risk = computeDeadlineRisk({ due_date: due, done }, today);
      return {
        id: s.id,
        title: s.title,
        due_date: due,
        note: s.note,
        done,
        done_at: s.done_at,
        assignee_id: s.assignee_id,
        assignee_name: s.assignee_name,
        risk_state: risk.state,
        days_left: risk.days_left,
      };
    }),
  });
});

export default deadlines;
