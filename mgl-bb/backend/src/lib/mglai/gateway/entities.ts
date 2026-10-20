/**
 * MGL AI · КОМПАНИЙН ӨГӨГДЛИЙН ГАРЦ — ENTITY КАТАЛОГ (§10, §11, §12).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  Хуучин загварт асуулт бүрд НЭГ
 *    хатуу хэрэгсэл (`list_projects`, `get_active_employees` …) байсан
 *    тул «манай сайтад хамгийн идэвхтэй ажилтан хэн бэ» гэх мэт
 *    төлөвлөгдөөгүй асуулт нь ХАМГИЙН ОЙРХОН хэрэгслийн (ажилтны ТОО)
 *    үр дүнг аваад загвар түүнээс хариу ЗОХИОДОГ байв (хэмжигдсэн
 *    2026-09-10: «хамгийн идэвхтэй ажилтан нь senior» — 12 гэсэн тооноос).
 *
 *    Энэ файл нь ажилтны харж болох БҮХ бизнес entity-г нэг каталогт
 *    тодорхойлно: талбар, шүүлт, эрэмбэ, нэгтгэл, ХАМРАХ ХҮРЭЭ.  Planner
 *    нь каталогийг уншиж «энэ асуулт ямар entity-ийн тухай вэ» гэж олно;
 *    `query.ts` нь түүнээс АЮУЛГҮЙ SQL угсарна.
 *
 * ⚠️ ЗАГВАР SQL БИЧИХГҮЙ ХЭВЭЭР (§12).  Энд байгаа SQL нь БИДНИЙХ;
 *    гаднаас ирдэг зүйл нь зөвхөн {entity, fields, filters, sort, limit}
 *    гэсэн бүтэц бөгөөд тэр нь `query.ts`-д талбар бүрээр шалгагдана.
 *
 * ⚠️ МӨРИЙН ТҮВШНИЙ ЭРХ НЬ ЭХ SQL-Д, ШҮҮЛТЭД БИШ.  `scope` нь entity-ийн
 *    `FROM`-д ордог тул дурын шүүлт ч түүнийг тойрч чадахгүй.  Төслийн
 *    харагдац нь `PROJECT_LIST_SQL`-ийн ЯГ ижил дүрэм (asr_only,
 *    is_pending, гишүүнчлэл) — арван хоёр дахь хуулбар БИШ, тэр
 *    template-ийг дэд асуулт болгон дуудна.
 *
 * ⚠️ НУУЦ БАГАНА ЭНД ОГТ БАЙХГҮЙ.  `users.password_hash`, `email`,
 *    `attendance_device_id`, `ip_address`, `late_minutes`-ийн торгууль
 *    зэрэг нь каталогт ОРООГҮЙ тул хүсэх ч аргагүй — «хориглосон»
 *    жагсаалт биш, «зөвшөөрсөн» жагсаалт.
 */
import { PROJECT_LIST_SQL } from '../../../routes/projects';
import { asrVisibleSql } from '../../asrVisibility';
import type { AiMode } from '../identity';

export type FieldType = 'integer' | 'number' | 'string' | 'date' | 'boolean';

export interface FieldDef {
  name: string;
  type: FieldType;
  descriptionMn: string;
  /** SQL илэрхийлэл — эх дэд асуулгын багана (`q.<col>`). */
  col: string;
  filterable?: boolean;
  sortable?: boolean;
  /** Тоон нэгтгэлд (sum/avg/min/max) орж болох эсэх. */
  numeric?: boolean;
  /** Зөвхөн энэ горимд харагдана — байхгүй бол entity-ийн горим. */
  modes?: readonly Exclude<AiMode, 'denied'>[];
}

export type EntityOperation = 'get' | 'search' | 'count' | 'filter' | 'sort' | 'aggregate' | 'group';

export interface ScopeCtx {
  mode: Exclude<AiMode, 'denied'>;
  userId: number;
  /** admin/engineer/architect/senior — бүх төслийг харна. */
  canSeeAllProjects: boolean;
  /** admin + senior — гэрээ хэлэлцээрийн шатны төслийг харна. */
  seesPending: boolean;
  /** Өнөөдрийн UB огноо — `is_overdue` зэрэг тооцоолсон талбарт. */
  today: string;
}

export interface EntityDef {
  name: string;
  descriptionMn: string;
  descriptionEn: string;
  /** Асуултаас entity-г ТАНИХ түлхүүр үгс — кирилл, латин, англи. */
  keywords: readonly string[];
  modes: readonly Exclude<AiMode, 'denied'>[];
  fields: readonly FieldDef[];
  operations: readonly EntityOperation[];
  defaultSort?: { field: string; dir: 'asc' | 'desc' };
  /**
   * `fields` өгөөгүй үед буцаах ТОВЧ талбарууд — бүх багана биш.
   * ⚠️ Хэмжигдсэн: `tasks`-ийн 20 мөр × 17 багана = 8 770 тэмдэгт; prompt-ыг
   *    дүүргэж, тайралт JSON-ыг хагасалж байв.
   */
  defaultFields?: readonly string[];
  /** Эх дэд асуулга — мөрийн түвшний хамрах хүрээ ЭНД орно. */
  source: (scope: ScopeCtx) => { sql: string; binds: unknown[] };
  /** Хүнд харуулах эх сурвалжийн нэр. */
  authority: string;
}

/* ------------------------------------------------------------------ */
/*  Түгээмэл хэсгүүд                                                    */
/* ------------------------------------------------------------------ */

/** Төслийн харагдах олонлог — `PROJECT_LIST_SQL`-ийн ЯГ дүрэм. */
function visibleProjectsSql(scope: ScopeCtx): { sql: string; binds: unknown[] } {
  const sub = scope.userId;
  const forUser = !scope.canSeeAllProjects;
  const sql = `SELECT id FROM (${PROJECT_LIST_SQL(forUser, scope.seesPending)}) vp`;
  const binds = forUser ? [sub, sub, sub, sub] : [sub, sub, sub];
  return { sql, binds };
}

/** Даалгаврын хамгийн сүүлийн БАТЛАГДСАН хувь — `erp.ts`-ийн ижил дэд асуулга. */
const LATEST_PCT_SQL = `COALESCE((SELECT pe.percentage FROM progress_entries pe
   WHERE pe.task_id = t.id AND pe.status = 'approved'
   ORDER BY pe.date DESC, pe.created_at DESC, pe.id DESC LIMIT 1), 0)`;

/** Ажилтны үндсэн баг — `user_teams.is_primary`, байхгүй бол `users.team_id`. */
const PRIMARY_TEAM_SQL = `COALESCE(
  (SELECT ut.team_id FROM user_teams ut WHERE ut.user_id = u.id ORDER BY ut.is_primary DESC, ut.id ASC LIMIT 1),
  u.team_id)`;

/* ------------------------------------------------------------------ */
/*  ENTITY-үүд                                                          */
/* ------------------------------------------------------------------ */

const projects: EntityDef = {
  name: 'projects',
  descriptionMn:
    'Компанийн төслүүд — нэр, төлөв, ангилал, жигнэсэн явцын хувь, эхлэх/дуусах огноо, гишүүдийн тоо. Хэрэглэгчийн харах эрхтэй төсөл Л орно.',
  descriptionEn: 'Company projects with weighted progress, dates and member count (permission-filtered).',
  keywords: [
    'төсөл', 'төсл', 'төслүүд', 'tusul', 'tosol', 'tusluud', 'project', 'projects', 'обьект', 'объект',
    'барилга', 'зураг төсөл', 'явц', 'yavts', 'progress', 'дуусах', 'duusah', 'deadline',
    'хугацаа', 'hugatsaa', 'finish',
  ],
  modes: ['client', 'employee', 'admin'],
  operations: ['get', 'search', 'count', 'filter', 'sort', 'aggregate', 'group'],
  authority: 'ERP · projects + project_passport (амьд)',
  defaultFields: ['id', 'name', 'status', 'category', 'progress', 'finish_date', 'days_remaining'],
  defaultSort: { field: 'created_at', dir: 'desc' },
  source: (scope) => {
    const forUser = !scope.canSeeAllProjects;
    const sub = scope.userId;
    return {
      sql: `SELECT pl.id, pl.name, pl.display_title, pl.status, pl.category, pl.progress,
                   pl.start_date, pl.finish_date, pl.member_count, pl.is_asap, pl.location,
                   pl.drawing_no, pl.created_at, pl.updated_at, pl.complexity,
                   CASE WHEN pl.finish_date IS NULL THEN NULL
                        ELSE CAST(julianday(pl.finish_date) - julianday(?) AS INTEGER) END AS days_remaining
              FROM (${PROJECT_LIST_SQL(forUser, scope.seesPending)}) pl`,
      // ⚠️ BIND ДАРААЛАЛ ТЕКСТИЙН ДАРААЛАЛ: `julianday(?)` нь SELECT жагсаалтад,
      //    өөрөөр хэлбэл дэд асуулгын `?`-уудаас ӨМНӨ.  Буруу дараалалд
      //    days_remaining = 2 461 220 гарч байсан (хэмжигдсэн).
      binds: forUser ? [scope.today, sub, sub, sub, sub] : [scope.today, sub, sub, sub],
    };
  },
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Төслийн id', col: 'id', filterable: true, sortable: true },
    { name: 'name', type: 'string', descriptionMn: 'Төслийн нэр (шифртэй)', col: 'name', filterable: true, sortable: true },
    { name: 'display_title', type: 'string', descriptionMn: 'Урт гарчиг', col: 'display_title', filterable: true },
    { name: 'status', type: 'string', descriptionMn: 'Төлөв: active | completed | on_hold | cancelled', col: 'status', filterable: true, sortable: true },
    { name: 'category', type: 'string', descriptionMn: 'Ангилал: AZ ажлын зураг · ZA засвар · ET ерөнхий төлөвлөгөө · EZ эскиз · IZ интерьер', col: 'category', filterable: true, sortable: true },
    { name: 'progress', type: 'number', descriptionMn: 'Жигнэсэн явцын хувь (0–100, сервер бодсон)', col: 'progress', filterable: true, sortable: true, numeric: true },
    { name: 'start_date', type: 'date', descriptionMn: 'Эхлэх огноо (паспорт)', col: 'start_date', filterable: true, sortable: true },
    { name: 'finish_date', type: 'date', descriptionMn: 'Дуусах огноо (паспорт)', col: 'finish_date', filterable: true, sortable: true },
    { name: 'days_remaining', type: 'integer', descriptionMn: 'Дуусах хүртэл хэдэн хоног (сөрөг бол хэтэрсэн)', col: 'days_remaining', filterable: true, sortable: true, numeric: true },
    { name: 'member_count', type: 'integer', descriptionMn: 'Гишүүдийн тоо', col: 'member_count', filterable: true, sortable: true, numeric: true },
    { name: 'is_asap', type: 'boolean', descriptionMn: 'Яаралтай тэмдэгтэй эсэх', col: 'is_asap', filterable: true },
    { name: 'location', type: 'string', descriptionMn: 'Байршил', col: 'location', filterable: true, modes: ['employee', 'admin'] },
    { name: 'drawing_no', type: 'string', descriptionMn: 'Зургийн дугаар', col: 'drawing_no', filterable: true, modes: ['employee', 'admin'] },
    { name: 'complexity', type: 'string', descriptionMn: 'Төвөгшил', col: 'complexity', filterable: true, modes: ['employee', 'admin'] },
    { name: 'created_at', type: 'date', descriptionMn: 'Үүсгэсэн огноо', col: 'created_at', sortable: true, filterable: true },
  ],
};

const tasks: EntityDef = {
  name: 'tasks',
  descriptionMn:
    'Төслүүдийн даалгаврууд (task) — нэр, төсөл, блок, баг, хугацаа, хариуцагчид, сүүлийн батлагдсан явц, хугацаа хэтэрсэн эсэх.',
  descriptionEn: 'Tasks under visible projects with due dates, assignees, latest approved progress and overdue flag.',
  // ⚠️ «ажил» ГАНЦААРАА БИШ (Session C, хэмжсэн): «Ажилтны тоо», «хэдэн хүн
  //    ажилладаг» дотор таарч tasks-ыг employees-ээс ДЭЭГҮҮР эрэмбэлж, «хэдэн
  //    ажилтан» асуултад ДААЛГАВРЫН тоо буцдаг байв (буруу итгэмжлэгдсэн
  //    домэйн — мандатын P0).  Даалгаврын морфологи: «даалгавр» язгуур.
  keywords: [
    'даалгавар', 'даалгавр', 'даалгаврууд', 'таск', 'task', 'tasks', 'daalgavar', 'daalgavr', 'ажил ', 'ажлууд', 'ажлын', 'ажлыг', 'ajil ', 'ajluud',
    'хоцорсон', 'хоцор', 'hotsor', 'хэтэрсэн', 'overdue', 'due', 'дуусаагүй', 'хариуцагч',
  ],
  modes: ['employee', 'admin'],
  operations: ['get', 'search', 'count', 'filter', 'sort', 'aggregate', 'group'],
  authority: 'ERP · tasks + progress_entries (амьд)',
  defaultFields: ['id', 'name', 'project_name', 'team_code', 'assignees', 'due_date', 'progress', 'is_overdue', 'last_progress_date'],
  defaultSort: { field: 'due_date', dir: 'asc' },
  source: (scope) => {
    const vp = visibleProjectsSql(scope);
    return {
      sql: `SELECT t.id, t.name, t.due_date, t.start_date, t.weight_percent, t.created_at,
                   p.id AS project_id, p.name AS project_name, b.name AS block_name,
                   tm.code AS team_code, d.name AS drawing_name,
                   ${LATEST_PCT_SQL} AS progress,
                   (SELECT group_concat(u.full_name, ', ') FROM task_assignees ta
                      JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id) AS assignees,
                   (SELECT COUNT(*) FROM task_assignees ta2 WHERE ta2.task_id = t.id) AS assignee_count,
                   (SELECT MAX(pe2.date) FROM progress_entries pe2
                     WHERE pe2.task_id = t.id AND pe2.status = 'approved') AS last_progress_date,
                   CASE WHEN t.due_date IS NOT NULL AND t.due_date < ? AND ${LATEST_PCT_SQL} < 100
                        THEN 1 ELSE 0 END AS is_overdue,
                   CASE WHEN t.due_date IS NULL THEN NULL
                        ELSE CAST(julianday(?) - julianday(t.due_date) AS INTEGER) END AS days_overdue
              FROM tasks t
              JOIN components c ON c.id = t.component_id
              JOIN drawings d ON d.id = c.drawing_id
              JOIN blocks b ON b.id = d.block_id
              JOIN projects p ON p.id = b.project_id
              LEFT JOIN teams tm ON tm.id = b.team_id
             WHERE p.id IN (${vp.sql})`,
      binds: [scope.today, scope.today, ...vp.binds],
    };
  },
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Даалгаврын id', col: 'id', filterable: true, sortable: true },
    { name: 'name', type: 'string', descriptionMn: 'Даалгаврын нэр', col: 'name', filterable: true, sortable: true },
    { name: 'project_id', type: 'integer', descriptionMn: 'Төслийн id', col: 'project_id', filterable: true, sortable: true },
    { name: 'project_name', type: 'string', descriptionMn: 'Төслийн нэр', col: 'project_name', filterable: true, sortable: true },
    { name: 'block_name', type: 'string', descriptionMn: 'Блок', col: 'block_name', filterable: true },
    { name: 'drawing_name', type: 'string', descriptionMn: 'Зураг', col: 'drawing_name', filterable: true },
    { name: 'team_code', type: 'string', descriptionMn: 'Багийн код (BA, BB, …)', col: 'team_code', filterable: true, sortable: true },
    { name: 'assignees', type: 'string', descriptionMn: 'Хариуцагчдын нэр (таслалаар)', col: 'assignees', filterable: true },
    { name: 'assignee_count', type: 'integer', descriptionMn: 'Хариуцагчийн тоо (0 = эзэнгүй)', col: 'assignee_count', filterable: true, sortable: true, numeric: true },
    { name: 'due_date', type: 'date', descriptionMn: 'Дуусах хугацаа', col: 'due_date', filterable: true, sortable: true },
    { name: 'start_date', type: 'date', descriptionMn: 'Эхлэх огноо', col: 'start_date', filterable: true, sortable: true },
    { name: 'progress', type: 'number', descriptionMn: 'Сүүлийн батлагдсан явц (0–100)', col: 'progress', filterable: true, sortable: true, numeric: true },
    { name: 'last_progress_date', type: 'date', descriptionMn: 'Хамгийн сүүлд явц бүртгэсэн огноо', col: 'last_progress_date', filterable: true, sortable: true },
    { name: 'is_overdue', type: 'boolean', descriptionMn: 'Хугацаа хэтэрсэн, дуусаагүй эсэх', col: 'is_overdue', filterable: true, sortable: true },
    { name: 'days_overdue', type: 'integer', descriptionMn: 'Хэтэрсэн хоног (сөрөг бол хугацаа хараахан болоогүй)', col: 'days_overdue', filterable: true, sortable: true, numeric: true },
    { name: 'weight_percent', type: 'number', descriptionMn: 'Жин (%)', col: 'weight_percent', filterable: true, sortable: true, numeric: true },
    { name: 'created_at', type: 'date', descriptionMn: 'Үүсгэсэн огноо', col: 'created_at', sortable: true, filterable: true },
  ],
};

const employees: EntityDef = {
  name: 'employees',
  descriptionMn:
    'Компанийн ажилтнууд — нэр, албан тушаал, роль, баг, ажилд орсон огноо, төлөв. Захиалагч ЭНД ОРОХГҮЙ. Нууц үг, имэйл, төхөөрөмж, цалин зэрэг мэдээлэл ЭНД БАЙХГҮЙ.',
  descriptionEn: 'Staff roster (no clients): name, position, role, team, hire date, status.',
  keywords: [
    'ажилтан', 'ажилтн', 'ажилтнууд', 'ажилчид', 'ажилладаг', 'ажиллаж', 'ajiltan', 'ajiltn', 'employee', 'employees', 'staff', 'хүн хүч',
    'хүн', 'хүнтэй', 'хэдэн хүн', 'инженер', 'архитектор', 'engineer', 'architect', 'senior', 'ахлах', 'албан тушаал',
    'хэн', 'hen', 'who',
  ],
  modes: ['employee', 'admin'],
  operations: ['get', 'search', 'count', 'filter', 'sort', 'aggregate', 'group'],
  authority: 'ERP · users (амьд)',
  defaultFields: ['id', 'full_name', 'role', 'position', 'team_code', 'status'],
  defaultSort: { field: 'full_name', dir: 'asc' },
  source: () => ({
    sql: `SELECT u.id, u.full_name, u.username, u.role, u.position, u.seniority, u.status,
                 u.created_at AS hired_at, u.is_support,
                 tm.code AS team_code, tm.name_mn AS team_name
            FROM users u
            LEFT JOIN teams tm ON tm.id = ${PRIMARY_TEAM_SQL}
           WHERE u.role <> 'client'`,
    binds: [],
  }),
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Ажилтны id', col: 'id', filterable: true, sortable: true },
    { name: 'full_name', type: 'string', descriptionMn: 'Бүтэн нэр', col: 'full_name', filterable: true, sortable: true },
    { name: 'username', type: 'string', descriptionMn: 'Нэвтрэх нэр', col: 'username', filterable: true },
    { name: 'role', type: 'string', descriptionMn: 'Роль: admin | engineer | architect | senior | worker', col: 'role', filterable: true, sortable: true },
    { name: 'position', type: 'string', descriptionMn: 'Албан тушаал', col: 'position', filterable: true, sortable: true },
    { name: 'seniority', type: 'string', descriptionMn: 'Зэрэг дэв', col: 'seniority', filterable: true, sortable: true },
    { name: 'team_code', type: 'string', descriptionMn: 'Үндсэн багийн код', col: 'team_code', filterable: true, sortable: true },
    { name: 'team_name', type: 'string', descriptionMn: 'Үндсэн багийн нэр', col: 'team_name', filterable: true },
    { name: 'status', type: 'string', descriptionMn: 'Төлөв: active | inactive', col: 'status', filterable: true, sortable: true },
    { name: 'hired_at', type: 'date', descriptionMn: 'Системд бүртгэгдсэн (ажилд орсон) огноо', col: 'hired_at', filterable: true, sortable: true },
    { name: 'is_support', type: 'boolean', descriptionMn: 'Туслах бүртгэл (жишээ нь TV) эсэх', col: 'is_support', filterable: true, modes: ['admin'] },
  ],
};

const teams: EntityDef = {
  name: 'teams',
  descriptionMn: 'Багууд (мэргэжлийн чиглэл) — код, нэр, ахлагч, гишүүдийн тоо.',
  descriptionEn: 'Discipline teams with lead and member count.',
  keywords: ['баг', 'багууд', 'bag', 'team', 'teams', 'хэлтэс', 'heltes', 'department', 'чиглэл', 'ахлагч', 'lead'],
  modes: ['employee', 'admin'],
  operations: ['get', 'search', 'count', 'filter', 'sort'],
  authority: 'ERP · teams + user_teams (амьд)',
  defaultSort: { field: 'code', dir: 'asc' },
  source: () => ({
    sql: `SELECT tm.id, tm.code, tm.name_mn, tm.name_en, tm.description,
                 lu.full_name AS lead_name,
                 (SELECT COUNT(DISTINCT ut.user_id) FROM user_teams ut
                    JOIN users u ON u.id = ut.user_id
                   WHERE ut.team_id = tm.id AND u.status = 'active' AND u.role <> 'client') AS member_count
            FROM teams tm
            LEFT JOIN users lu ON lu.id = tm.lead_user_id`,
    binds: [],
  }),
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Багийн id', col: 'id', filterable: true, sortable: true },
    { name: 'code', type: 'string', descriptionMn: 'Код (BA, BB, TSAH …)', col: 'code', filterable: true, sortable: true },
    { name: 'name_mn', type: 'string', descriptionMn: 'Монгол нэр', col: 'name_mn', filterable: true, sortable: true },
    { name: 'name_en', type: 'string', descriptionMn: 'Англи нэр', col: 'name_en', filterable: true },
    { name: 'description', type: 'string', descriptionMn: 'Тайлбар', col: 'description' },
    { name: 'lead_name', type: 'string', descriptionMn: 'Ахлагчийн нэр', col: 'lead_name', filterable: true },
    { name: 'member_count', type: 'integer', descriptionMn: 'Идэвхтэй гишүүдийн тоо', col: 'member_count', filterable: true, sortable: true, numeric: true },
  ],
};

const progressEntries: EntityDef = {
  name: 'progress_entries',
  descriptionMn:
    'Явцын бүртгэл — хэн, хэзээ, аль даалгаварт хэдэн хувь бүртгэсэн, батлагдсан эсэх. Ажилтны идэвх, төслийн сүүлийн хөдөлгөөнийг ЭНДЭЭС хэмжинэ.',
  descriptionEn: 'Progress log entries: who reported what percent on which task, when, and approval status.',
  keywords: [
    'явц', 'явцын бүртгэл', 'yavts', 'progress', 'бүртгэсэн', 'мэдээлсэн', 'батлагдсан', 'approved',
    'сүүлийн', 'suuliin', 'recent', 'activity', 'идэвх', 'idevh', 'хөдөлгөөн',
  ],
  modes: ['employee', 'admin'],
  operations: ['get', 'search', 'count', 'filter', 'sort', 'aggregate', 'group'],
  authority: 'ERP · progress_entries (амьд)',
  defaultFields: ['date', 'user_name', 'task_name', 'project_name', 'percentage', 'status'],
  defaultSort: { field: 'date', dir: 'desc' },
  source: (scope) => {
    const vp = visibleProjectsSql(scope);
    return {
      sql: `SELECT pe.id, pe.date, pe.percentage, pe.status, pe.created_at,
                   u.id AS user_id, u.full_name AS user_name,
                   t.id AS task_id, t.name AS task_name,
                   p.id AS project_id, p.name AS project_name
              FROM progress_entries pe
              JOIN tasks t ON t.id = pe.task_id
              JOIN components c ON c.id = t.component_id
              JOIN drawings d ON d.id = c.drawing_id
              JOIN blocks b ON b.id = d.block_id
              JOIN projects p ON p.id = b.project_id
              LEFT JOIN users u ON u.id = pe.user_id
             WHERE p.id IN (${vp.sql})`,
      binds: vp.binds,
    };
  },
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Бүртгэлийн id', col: 'id', sortable: true },
    { name: 'date', type: 'date', descriptionMn: 'Явцын огноо', col: 'date', filterable: true, sortable: true },
    { name: 'percentage', type: 'number', descriptionMn: 'Бүртгэсэн хувь', col: 'percentage', filterable: true, sortable: true, numeric: true },
    { name: 'status', type: 'string', descriptionMn: 'approved | pending | rejected', col: 'status', filterable: true },
    { name: 'user_id', type: 'integer', descriptionMn: 'Бүртгэсэн ажилтны id', col: 'user_id', filterable: true },
    { name: 'user_name', type: 'string', descriptionMn: 'Бүртгэсэн ажилтан', col: 'user_name', filterable: true, sortable: true },
    { name: 'task_id', type: 'integer', descriptionMn: 'Даалгаврын id', col: 'task_id', filterable: true },
    { name: 'task_name', type: 'string', descriptionMn: 'Даалгавар', col: 'task_name', filterable: true },
    { name: 'project_id', type: 'integer', descriptionMn: 'Төслийн id', col: 'project_id', filterable: true },
    { name: 'project_name', type: 'string', descriptionMn: 'Төсөл', col: 'project_name', filterable: true, sortable: true },
    { name: 'created_at', type: 'date', descriptionMn: 'Илгээсэн огноо', col: 'created_at', sortable: true, filterable: true },
  ],
};

const attendance: EntityDef = {
  name: 'attendance',
  descriptionMn:
    'Ирцийн бүртгэл — ажилтан бүрийн өдөр тутмын ирсэн/гарсан цаг, ажилласан цаг, хоцорсон минут. IP, төхөөрөмж ЭНД БАЙХГҮЙ.',
  descriptionEn: 'Attendance sessions per employee per day: hours worked and late minutes.',
  keywords: [
    'ирц', 'irts', 'attendance', 'ирсэн', 'хоцорсон', 'hotsorson', 'late', 'цаг бүртгэл',
    'ажилласан цаг', 'clock', 'ирээгүй',
  ],
  modes: ['employee', 'admin'],
  operations: ['get', 'count', 'filter', 'sort', 'aggregate', 'group'],
  authority: 'ERP · attendance_sessions (амьд)',
  defaultFields: ['date', 'user_name', 'hours_worked', 'late_minutes'],
  defaultSort: { field: 'date', dir: 'desc' },
  source: () => ({
    sql: `SELECT a.id, a.date, a.user_id, u.full_name AS user_name,
                 a.hours_worked, a.late_minutes,
                 substr(a.clock_in, 12, 5) AS clock_in_time,
                 substr(a.clock_out, 12, 5) AS clock_out_time
            FROM attendance_sessions a
            JOIN users u ON u.id = a.user_id AND u.role <> 'client'`,
    binds: [],
  }),
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Бүртгэлийн id', col: 'id', sortable: true },
    { name: 'date', type: 'date', descriptionMn: 'Огноо', col: 'date', filterable: true, sortable: true },
    { name: 'user_id', type: 'integer', descriptionMn: 'Ажилтны id', col: 'user_id', filterable: true },
    { name: 'user_name', type: 'string', descriptionMn: 'Ажилтан', col: 'user_name', filterable: true, sortable: true },
    { name: 'hours_worked', type: 'number', descriptionMn: 'Ажилласан цаг', col: 'hours_worked', filterable: true, sortable: true, numeric: true },
    { name: 'late_minutes', type: 'integer', descriptionMn: 'Хоцорсон минут', col: 'late_minutes', filterable: true, sortable: true, numeric: true },
    { name: 'clock_in_time', type: 'string', descriptionMn: 'Ирсэн цаг (HH:MM)', col: 'clock_in_time' },
    { name: 'clock_out_time', type: 'string', descriptionMn: 'Гарсан цаг (HH:MM)', col: 'clock_out_time' },
  ],
};

const asrReports: EntityDef = {
  name: 'asr_reports',
  descriptionMn: 'Зохиогчийн хяналтын тайлан (ASR) — дугаар, төсөл, огноо, төлөв, зохиогч.',
  descriptionEn: 'Author supervision reports: number, project, date, status, author.',
  keywords: [
    'зохиогчийн хяналт', 'asr', 'тайлан', 'tailan', 'report', 'reports', 'хяналтын тайлан', 'газар дээрх',
  ],
  modes: ['employee', 'admin'],
  operations: ['get', 'search', 'count', 'filter', 'sort', 'group'],
  authority: 'ERP · author_supervision_reports (амьд)',
  defaultFields: ['doc_no', 'project_name', 'report_date', 'status', 'author_name'],
  defaultSort: { field: 'report_date', dir: 'desc' },
  source: (scope) => {
    const vp = visibleProjectsSql(scope);
    return {
      sql: `SELECT r.id, r.doc_no, r.report_date, r.status, r.submitted_at, r.description,
                   r.report_type, r.meeting_platform,
                   p.id AS project_id, p.name AS project_name,
                   au.full_name AS author_name
              FROM author_supervision_reports r
              JOIN projects p ON p.id = r.project_id
              LEFT JOIN users au ON au.id = r.author_id
             WHERE (p.id IN (${vp.sql}) OR COALESCE(p.asr_only, 0) = 1)
               AND ${asrVisibleSql({ sub: scope.userId, isAdmin: scope.mode === 'admin' })}
               ${scope.mode === 'admin' ? '' : `AND (r.status <> 'draft' OR r.author_id = ${Math.trunc(Number(scope.userId))})`}`,
      binds: vp.binds,
    };
  },
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Тайлангийн id', col: 'id', sortable: true },
    { name: 'doc_no', type: 'string', descriptionMn: 'Дугаар (DASR-NNN)', col: 'doc_no', filterable: true, sortable: true },
    { name: 'project_id', type: 'integer', descriptionMn: 'Төслийн id', col: 'project_id', filterable: true },
    { name: 'project_name', type: 'string', descriptionMn: 'Төсөл', col: 'project_name', filterable: true, sortable: true },
    { name: 'report_date', type: 'date', descriptionMn: 'Тайлангийн огноо', col: 'report_date', filterable: true, sortable: true },
    { name: 'status', type: 'string', descriptionMn: 'draft | submitted | approved | rejected', col: 'status', filterable: true, sortable: true },
    { name: 'report_type', type: 'string', descriptionMn: 'Төрөл: site (Талбайн хяналт) | online (Цахим уулзалт) | drawing_change (Зургийн өөрчлөлт) | office (Оффис уулзалт)', col: 'report_type', filterable: true, sortable: true },
    { name: 'meeting_platform', type: 'string', descriptionMn: 'Цахим уулзалтын платформ (Zoom, Google Meet …)', col: 'meeting_platform', filterable: true },
    { name: 'author_name', type: 'string', descriptionMn: 'Зохиогч', col: 'author_name', filterable: true, sortable: true },
    { name: 'submitted_at', type: 'date', descriptionMn: 'Илгээсэн огноо', col: 'submitted_at', filterable: true, sortable: true },
    { name: 'description', type: 'string', descriptionMn: 'Товч тайлбар', col: 'description' },
  ],
};

const meetings: EntityDef = {
  name: 'meetings',
  descriptionMn: 'Хурлын тэмдэглэл — гарчиг, огноо, төсөл, төлөв, байршил.',
  descriptionEn: 'Meeting notes: title, date, project, status.',
  keywords: ['хурал', 'hural', 'meeting', 'meetings', 'уулзалт', 'тэмдэглэл', 'хурлын'],
  modes: ['admin'],
  operations: ['get', 'search', 'count', 'filter', 'sort'],
  authority: 'ERP · meetings (амьд)',
  defaultFields: ['title', 'meeting_date', 'project_name', 'status', 'location'],
  defaultSort: { field: 'meeting_date', dir: 'desc' },
  source: () => ({
    sql: `SELECT m.id, m.title, m.meeting_date, m.meeting_time, m.status, m.location, m.purpose,
                 p.id AS project_id, p.name AS project_name
            FROM meetings m
            LEFT JOIN projects p ON p.id = m.project_id`,
    binds: [],
  }),
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Хурлын id', col: 'id', sortable: true },
    { name: 'title', type: 'string', descriptionMn: 'Гарчиг', col: 'title', filterable: true, sortable: true },
    { name: 'meeting_date', type: 'date', descriptionMn: 'Огноо', col: 'meeting_date', filterable: true, sortable: true },
    { name: 'meeting_time', type: 'string', descriptionMn: 'Цаг', col: 'meeting_time' },
    { name: 'status', type: 'string', descriptionMn: 'Төлөв', col: 'status', filterable: true },
    { name: 'location', type: 'string', descriptionMn: 'Байршил', col: 'location', filterable: true },
    { name: 'purpose', type: 'string', descriptionMn: 'Зорилго', col: 'purpose' },
    { name: 'project_id', type: 'integer', descriptionMn: 'Төслийн id', col: 'project_id', filterable: true },
    { name: 'project_name', type: 'string', descriptionMn: 'Төсөл', col: 'project_name', filterable: true },
  ],
};

const repairEntries: EntityDef = {
  name: 'repair_entries',
  descriptionMn:
    'Засварын (дотоод/нэмэлт) ажлын цагийн бүртгэл — хэн, хэзээ, хэдэн цаг, аль төсөл/засварын төсөлд. Ажилтан ЗӨВХӨН өөрийнхөө бүртгэлийг харна.',
  descriptionEn: 'Self-logged repair/extra-work hours (employees see only their own).',
  keywords: ['засвар', 'zasvar', 'repair', 'нэмэлт ажил', 'цагийн бүртгэл', 'дотоод ажил'],
  modes: ['employee', 'admin'],
  operations: ['get', 'count', 'filter', 'sort', 'aggregate', 'group'],
  authority: 'ERP · repair_entries (амьд)',
  defaultFields: ['date', 'user_name', 'hours', 'project_name', 'description'],
  defaultSort: { field: 'date', dir: 'desc' },
  source: (scope) => ({
    sql: `SELECT re.id, re.date, re.hours, re.description, re.computed_pct,
                 u.id AS user_id, u.full_name AS user_name,
                 COALESCE(p.name, rp.name) AS project_name
            FROM repair_entries re
            JOIN users u ON u.id = re.user_id
            LEFT JOIN projects p ON p.id = re.project_id
            LEFT JOIN repair_projects rp ON rp.id = re.repair_project_id
           WHERE ${scope.mode === 'admin' ? '1 = 1' : 're.user_id = ?'}`,
    binds: scope.mode === 'admin' ? [] : [scope.userId],
  }),
  fields: [
    { name: 'id', type: 'integer', descriptionMn: 'Бүртгэлийн id', col: 'id', sortable: true },
    { name: 'date', type: 'date', descriptionMn: 'Огноо', col: 'date', filterable: true, sortable: true },
    { name: 'hours', type: 'number', descriptionMn: 'Цаг', col: 'hours', filterable: true, sortable: true, numeric: true },
    { name: 'computed_pct', type: 'number', descriptionMn: 'Тооцсон хувь', col: 'computed_pct', sortable: true, numeric: true },
    { name: 'description', type: 'string', descriptionMn: 'Тайлбар', col: 'description', filterable: true },
    { name: 'user_id', type: 'integer', descriptionMn: 'Ажилтны id', col: 'user_id', filterable: true },
    { name: 'user_name', type: 'string', descriptionMn: 'Ажилтан', col: 'user_name', filterable: true, sortable: true },
    { name: 'project_name', type: 'string', descriptionMn: 'Төсөл / засварын төсөл', col: 'project_name', filterable: true },
  ],
};

/* ------------------------------------------------------------------ */

export const ENTITIES: Record<string, EntityDef> = Object.freeze({
  projects,
  tasks,
  employees,
  teams,
  progress_entries: progressEntries,
  attendance,
  asr_reports: asrReports,
  meetings,
  repair_entries: repairEntries,
});

export function isKnownEntity(name: unknown): name is string {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ENTITIES, name);
}

/** Тухайн горимд харагдах entity-үүд.  `denied` ХООСОН авна. */
export function entitiesForMode(mode: AiMode): EntityDef[] {
  if (mode === 'denied') return [];
  return Object.values(ENTITIES).filter((e) => (e.modes as readonly string[]).includes(mode));
}

/** Тухайн горимд харагдах талбарууд — `modes`-той талбар нь өөрийн дүрмээр. */
export function fieldsForMode(entity: EntityDef, mode: Exclude<AiMode, 'denied'>): FieldDef[] {
  return entity.fields.filter((f) => !f.modes || (f.modes as readonly string[]).includes(mode));
}

/**
 * ⚠️ КАТАЛОГИЙН МАШИН УНШИХ ХЭЛБЭР (§11) — planner-т ба `/capabilities`-д.
 *    SQL ЭНД ОРОХГҮЙ: гадагш зөвхөн семантик тодорхойлолт гарна.
 */
export function describeEntities(mode: AiMode) {
  if (mode === 'denied') return [];
  return entitiesForMode(mode).map((e) => ({
    entity: e.name,
    description_mn: e.descriptionMn,
    description_en: e.descriptionEn,
    authority: e.authority,
    operations: e.operations,
    fields: fieldsForMode(e, mode).map((f) => ({
      name: f.name,
      type: f.type,
      description_mn: f.descriptionMn,
      filterable: f.filterable === true,
      sortable: f.sortable === true,
      numeric: f.numeric === true,
    })),
  }));
}
