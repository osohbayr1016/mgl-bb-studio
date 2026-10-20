import { Hono } from 'hono';
import { requireRole, requireManager } from '../middleware/auth';
import { todayInUB } from '../lib/time';
import { addDays } from '../lib/workSchedule';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';
import { hideArchivedSql } from '../lib/archivedProjects';
import { latestApprovedPctByDate } from '../lib/progressLatest';
import { withEdgeCache } from '../lib/edgeCache';
import { isTeamsView, primaryTeamSql } from '../lib/teamsPageDisplay';
import { loadDayWork } from '../lib/teamDayWorkStore';
import { listOwnTeams, requireOwnTeamOrManager } from '../lib/teamAccess';
import { isAdminRole } from '../types';
import type {
  Env,
  AppVariables,
  TeamRow,
  CreateTeamRequest,
  UpdateTeamRequest,
  AttendanceCheckpointType as AttendanceStage,
} from '../types';

const teams = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** `GET /allocation?range=` — ирцийн хэмжүүрийг нэгтгэх муж, `date`-ээр төгсөнө.
 *  «1 жил» 2026-09-18-нд эзний хүсэлтээр хасагдсан (frontend `ALLOC_RANGES` хос). */
const ALLOC_RANGE_DAYS = { day: 1, week: 7, month: 30, '3m': 90, '6m': 180 } as const;
type AllocRange = keyof typeof ALLOC_RANGE_DAYS;
const isAllocRange = (v: string): v is AllocRange => v in ALLOC_RANGE_DAYS;

// Everyone can READ the team LIST (`GET /` — used by dropdowns, filtering, etc.).
// Mutations are admin-only.
//
// 2026-09-30: ГАНЦ багийн дэлгэрэнгүй (`/:id`, `/:id/overview`,
// `/:id/member-tasks`) нь admin/senior-т бүх баг, бусдад зөвхөн өөрийн баг
// (`lib/teamAccess.ts`); бүх багийн хуваарилалтын самбар (`/allocation`) нь
// зөвхөн admin/senior.

// Shared CTE that computes each task's effective progress from the latest
// approved task-level progress entry and links it to the team via
// task_assignees → users.team_id.
//
// ⚠️ 2026-09-11: `latest_task` CTE-г таск тус бүрийн скаляр дэд асуулга болгов
//    (lib/progressLatest.ts-ийн тайлбарыг үз — /teams 203 389 → ~9 000 мөр).
//    Тиебрейк ХЭВЭЭР: date DESC, created_at DESC, id DESC.
//    ⚠️ MATERIALIZED БИШ, зориудаар: `/:id/*` handler-ууд `tt.team_id = ?`
//    шүүлтээ CTE рүү түлхдэг (pushdown); materialize хийвэл БҮХ багийн 4 345
//    таскийг тооцоод дараа нь шүүнэ (хэмжсэн: overview 113k → 546k болж
//    ДОРДСОН).  `/` handler нь ганцаараа бүх багийг хэрэглэдэг тул тэнд
//    өөрийн локал MATERIALIZED CTE-тэй.
const TEAM_TASK_CTE = `
WITH task_prog AS (
  SELECT t.id AS task_id, t.component_id, t.due_date, t.name AS task_name,
         COALESCE(${latestApprovedPctByDate('t.id')}, 0) AS progress
  FROM tasks t
),
-- "Team tasks" = every task that lives under a block whose owning team
-- matches. We use the structural block.team_id mapping (set on the
-- project setup page) instead of the older "tasks one of our members
-- has claimed" definition. This means:
--   • A project shows up on the team page as soon as it has a
--     team-tagged block, not only after a member claims a task in it.
--   • Task counts / stats include unclaimed tasks the team is supposed
--     to do, so the "Дундаж явц" and "N ажил" numbers reflect the
--     full team scope.
-- Legacy blocks where team_id IS NULL (the "Бусад" pseudo-tab) are
-- excluded — they're orphan tasks not yet assigned to a team.
--
-- ⚠️ 2026-09-11: CROSS JOIN нь SQLite-д НЭГДЭХ ДАРААЛЛЫГ хатуу заадаг (зүүнээс
--    баруун).  Өмнө нь planner tasks-ыг бүтнээр скандаж таск БҮРД эцэг 3
--    мөрийг тус тусад нь уншдаг байв (4 345 × 4); блокоос доош явбал индексээр
--    ~5 500 мөр, мөн tt.team_id = ? шүүлт b.team_id дээр шууд буудаг.
--    project_id / due_date-ыг энд авч явснаар дуудагч дахин join хийхгүй.
team_tasks AS (
  SELECT t.id AS task_id, b.team_id, b.project_id, t.due_date
  FROM blocks b
  CROSS JOIN drawings d ON d.block_id = b.id
  CROSS JOIN components c ON c.drawing_id = d.id
  CROSS JOIN tasks t ON t.component_id = c.id
  WHERE b.team_id IS NOT NULL
)
`;

/**
 * НЭГ багийн таскууд, ГАНЦ удаа тооцсон (`?1` = team id).  `/:id/overview` ба
 * `/:id/member-tasks` үүнийг `TEAM_TASK_CTE`-ийн араас залгана.
 *
 * ⚠️ MATERIALIZED нь ЗААВАЛ: workerd-ийн SQLite нь энэ CTE-г нээгээд
 *    `progress`-ыг иш татсан газар бүрд (SELECT / WHERE / ORDER BY / агрегат)
 *    сүүлийн явцын дэд асуулгыг ДАХИН гүйцэтгэж, task_assignees-аас эхэлсэн
 *    нэгдлийн дараалал сонгож байв — хэмжсэн: member-tasks 47k → 591k мөр.
 *    Материалчилсан хувилбар: ~5k.
 */
const TEAM_SCOPED_TASKS_CTE = `
team_scoped AS MATERIALIZED (
  SELECT tt.task_id, tt.project_id, tt.due_date, tp.progress, tp.component_id, tp.task_name
  FROM team_tasks tt
  INNER JOIN task_prog tp ON tp.task_id = tt.task_id
  WHERE tt.team_id = ?1
)`;

// GET /api/teams — all teams with headcount + task/project aggregates
//
// The `?date=YYYY-MM-DD` query param time-travels the *daily* snapshot
// (active_projects / active_project_count) to a past day so the command
// centre can replay "who was pointed where" on any earlier date. It only
// touches the `daily_active_projects` reads — the cumulative task stats
// (total/completed/overdue/avg_progress) are not date-scoped and stay
// current. Future dates and malformed input fall back to today.
teams.get('/', async (c) => {
  const today = todayInUB();
  const dateParam = c.req.query('date');
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam <= today ? dateParam : today;
  // 2026-09-11 (D1 rows_read аудит): энэ жагсаалтыг frontend-ийн ДОЛООН dropdown
  // татдаг атал агрегатууд нь 4 345 таскийг алхдаг (өмнө нь 203 389, одоо ~32 000
  // мөр).  Хариу хэрэглэгчээс ХАМААРДАГГҮЙ (зөвхөн `date`) тул 60 сек кэшлэнэ.
  // `?teams_view=1` — Багууд хуудасны «Өнөөдөр» таб: харагдацын багийн
  // шилжүүлэг (lib/teamsPageDisplay.ts) зөвхөн энэ хувилбарт; долоон
  // dropdown хуучин хариугаа авна.  Кэшийн түлхүүрт ЗААВАЛ орно.
  const teamsView = isTeamsView(c.req.query('teams_view'));
  return withEdgeCache(
    c,
    { key: 'teams:list', varyTags: [date, teamsView ? 'teams-view' : 'plain'], ttlSeconds: 60 },
    () => listTeams(c.env.DB, date, { teamsView }),
  );
});

async function listTeams(db: D1Database, date: string, opts: { teamsView: boolean }) {
  const PRIMARY_TEAM = primaryTeamSql(opts);
  const { results } = await db.prepare(
    `
    ${TEAM_TASK_CTE},
    -- Бүх багийн таск НЭГ удаа: MATERIALIZED нь заавал — үүнгүйгээр SQLite
    -- tp.progress-ыг иш татсан агрегат бүрд (5 удаа) сүүлийн явцын дэд
    -- асуулгыг ДАХИН гүйцэтгэдэг (хэмжсэн: 78 397 → ~20 000 мөр).
    all_team_tasks AS MATERIALIZED (
      SELECT tt.team_id, tt.task_id, tt.project_id, tt.due_date, tp.progress
      FROM team_tasks tt
      INNER JOIN task_prog tp ON tp.task_id = tt.task_id
    ),
    team_task_agg AS (
      SELECT tt.team_id,
             COUNT(DISTINCT tt.task_id) AS total_tasks,
             SUM(CASE WHEN tt.progress >= 100 THEN 1 ELSE 0 END) AS completed_tasks,
             SUM(CASE WHEN tt.progress > 0 AND tt.progress < 100 THEN 1 ELSE 0 END) AS in_progress_tasks,
             SUM(CASE WHEN tt.due_date IS NOT NULL AND tt.due_date < date('now') AND tt.progress < 100 THEN 1 ELSE 0 END) AS overdue_tasks,
             AVG(tt.progress) AS avg_progress
      FROM all_team_tasks tt
      GROUP BY tt.team_id
    ),
    team_proj_agg AS (
      SELECT tt.team_id, COUNT(DISTINCT tt.project_id) AS project_count
      FROM all_team_tasks tt
      GROUP BY tt.team_id
    ),
    active_project_agg AS (
      SELECT ut.team_id,
             COUNT(DISTINCT dap.project_id) AS active_project_count,
             COUNT(DISTINCT dap.user_id) AS active_user_count
      FROM daily_active_projects dap
      INNER JOIN users u ON u.id = dap.user_id
      INNER JOIN ${PRIMARY_TEAM} ut ON ut.user_id = u.id
      WHERE dap.date = ?
        AND u.status = 'active'
      GROUP BY ut.team_id
    ),
    active_project_breakdown AS (
      SELECT team_id,
             json_group_array(
               json_object(
                 'project_id', project_id,
                 'project_name', project_name,
                 'user_count', user_count,
                 'percent', ROUND(user_count * 100.0 / NULLIF(total_count, 0), 1)
               )
             ) AS active_projects_json
      FROM (
        SELECT ap.team_id,
               ap.project_id,
               ap.project_name,
               ap.user_count,
               SUM(ap.user_count) OVER (PARTITION BY ap.team_id) AS total_count
        FROM (
          SELECT ut.team_id,
                 p.id AS project_id,
                 p.name AS project_name,
                 COUNT(DISTINCT dap.user_id) AS user_count
          FROM daily_active_projects dap
          INNER JOIN users u ON u.id = dap.user_id
          INNER JOIN ${PRIMARY_TEAM} ut ON ut.user_id = u.id
          INNER JOIN projects p ON p.id = dap.project_id
          WHERE dap.date = ?
            AND u.status = 'active'
          GROUP BY ut.team_id, p.id, p.name
        ) ap
        ORDER BY ap.team_id, ap.user_count DESC, ap.project_name
      )
      GROUP BY team_id
    )
    SELECT t.*,
           COALESCE(mc.member_count, 0) AS member_count,
           COALESCE(tta.total_tasks, 0) AS total_tasks,
           COALESCE(tta.completed_tasks, 0) AS completed_tasks,
           COALESCE(tta.in_progress_tasks, 0) AS in_progress_tasks,
           COALESCE(tta.overdue_tasks, 0) AS overdue_tasks,
           COALESCE(ROUND(tta.avg_progress, 1), 0) AS avg_progress,
           COALESCE(tpa.project_count, 0) AS project_count,
           COALESCE(apa.active_project_count, 0) AS active_project_count,
           COALESCE(apa.active_user_count, 0) AS active_user_count,
           COALESCE(apb.active_projects_json, '[]') AS active_projects_json
    FROM teams t
    LEFT JOIN (
      -- Headcount counts only members whose *primary* (main) team is this
      -- one. A user can belong to up to 3 teams; without the is_primary
      -- filter they'd inflate every secondary team's count too. Deactivated
      -- accounts keep their user_teams rows, so filter to active users like
      -- the roster queries do.
      SELECT ut.team_id, COUNT(DISTINCT ut.user_id) AS member_count
      FROM ${PRIMARY_TEAM} ut
      INNER JOIN users u ON u.id = ut.user_id
      WHERE u.status = 'active'
      GROUP BY ut.team_id
    ) mc ON mc.team_id = t.id
    LEFT JOIN team_task_agg tta ON tta.team_id = t.id
    LEFT JOIN team_proj_agg tpa ON tpa.team_id = t.id
    LEFT JOIN active_project_agg apa ON apa.team_id = t.id
    LEFT JOIN active_project_breakdown apb ON apb.team_id = t.id
    ORDER BY t.sort_order, t.name_mn
  `,
  )
    .bind(date, date)
    .all<
      TeamRow & {
        member_count: number;
        total_tasks: number;
        completed_tasks: number;
        in_progress_tasks: number;
        overdue_tasks: number;
        avg_progress: number;
        project_count: number;
        active_project_count: number;
        active_user_count: number;
        active_projects_json: string;
      }
    >();

  const teamsWithActiveProjects = (results ?? []).map((row) => {
    let active_projects: Array<{
      project_id: number;
      project_name: string;
      user_count: number;
      percent: number;
    }> = [];
    try {
      const parsed = JSON.parse(row.active_projects_json || '[]');
      if (Array.isArray(parsed)) active_projects = parsed;
    } catch {
      active_projects = [];
    }
    const { active_projects_json, ...team } = row;
    void active_projects_json;
    return { ...team, active_projects };
  });

  return { teams: teamsWithActiveProjects };
}

// GET /api/teams/mine — дуудагчийн ӨӨРИЙН багууд (үндсэн нь эхэнд).  Энгийн
// ажилтны Багууд хэсэг үүгээр өөрийн багийн хуудас руу орно.
// ⚠️ `/:id`-ЭЭС ДЭЭР байх ёстой, эс тэгвэл "mine"-ыг id гэж уншина.
teams.get('/mine', async (c) => {
  return c.json({ teams: await listOwnTeams(c.env.DB, c.get('user').sub) });
});

// ---------------------------------------------------------------------------
// GET /api/teams/allocation?date=YYYY-MM-DD
//
// «Хүн хүчний хуваарилалт» — Багууд хуудасны матрицын ГАНЦ эх сурвалж.
//
// Хариулах ёстой хоёр асуулт нь нэг л өгөгдлийн хоёр тал:
//   1. Аль багийн хэдэн гишүүн АЛЬ ТӨСӨЛ дээр ажиллаж байна вэ?   (мөр)
//   2. Аль төсөл дээр АЛЬ БАГААС хэдэн хүн ажиллаж байна вэ?      (багана)
// Тиймээс сервер нэг л (team × project) нүдний жагсаалт буцаана; хоёр
// харагдац хоёулаа түүнээс гарна.  Хоёр өөр endpoint хийвэл нийлбэр нь
// зөрөх нь гарцаагүй.
//
// ⚠️ Замын дараалал: энэ нь `/:id`-ЭЭС ДЭЭР байх ёстой, эс тэгвэл
// `/:id` нь "allocation"-ыг id гэж уншина (`parseInt` → NaN → 404).
//
// «Ажиллаж байна» гэдгийн тодорхойлолт — ХОЁР өөр хэмжүүр, хоёулаа
// нэг нүдэнд:
//   • `people`  — ХУВААРИЛАЛТ: тухайн багийн (үндсэн) гишүүн энэ төслийн
//     ямар нэг ажлын ХАРИУЦАГЧ (`task_assignees`) байна.  Тогтвортой тоо —
//     амралтын өдөр ч, чөлөө авсан ч алга болохгүй.
//   • `active`  — ТУХАЙН ӨДӨР: ирцийн аль нэг шатанд (өглөө / үдээс хойш /
//     гарахдаа — `attendance_project_checkpoints`) энэ төслийг сонгосон
//     хүн.  Өдөр бүр хэлбэлзэнэ; нүдний `active_members` нь хэн аль шатанд
//     сонгосныг, хэн ОДОО тэнд сууж байгааг (`now`) хэлнэ.
// Хоёулаа хэрэгтэй: эхнийх нь «хэн хариуцдаг», хоёр дахь нь «өнөөдөр
// хэн үнэхээр суусан».  Аль нэгийг сонгох биш, хоёуланг нь харуулна.
//
// `?range=day|week|month|3m|6m` (2026-09-17, эзний хүсэлт): ирцийн
// хэмжүүрийг ГАНЦ өдөр биш, `date`-ээр ТӨГСӨХ мужаар нэгтгэнэ — «сүүлийн
// сард энэ баг аль төслүүд дээр хэдэн өдөр суусан бэ».  `active_members[].days`
// = тухайн хүн тэр төслийг сонгосон ӨДРИЙН тоо.  Хуваарилалтын хэмжүүр
// (`people`) мужаас хамаардаггүй — ажлын хариуцагч өдрөөр өөрчлөгдөхгүй.
//
// 2026-09-18 (эзний хүсэлт): мужаар харахад тоо нь «мужид ядаж нэг удаа
// сонгосон хүний тоо» БИШ, «өдрийн ДУНДАЖ хүн» байх ёстой — «сүүлийн 7
// хоногт энэ төсөл дээр дунджаар хэдэн хүн ажилласан бэ».  Тиймээс нүд,
// баг, төсөл, нийт дөрвөн түвшинд `active_person_days` (хүн-өдөр) буцаана;
// frontend нь `active_days`-т (мужид ирцийн бүртгэлтэй өдрийн тоо —
// амралт, баяр тоологдохгүй) хувааж дунджийг гаргана.  Баг/нийт түвшинд
// хүн-өдөр нь ӨДӨР БҮРТ давхардаагүй (нэг өдөр 2 төсөл сонгосон хүн 1
// хүн-өдөр), нүд/төсөл түвшинд төсөл бүрт тусдаа.
//
// 2026-09-30: ЗӨВХӨН admin/senior.  Энгийн ажилтан Багууд хэсгээс зөвхөн өөрийн
// багийн дэлгэрэнгүйг (`/:id/overview`) авна — энэ самбар нь бүх багийн «хэн аль
// төсөл дээр» гэсэн байгууллагын зураг.
//
// Багийн харьяалал ХАМАА ГАЗАР `user_teams.is_primary = 1` — `/teams`,
// `/company/day-snapshot`-той ижил.  Нэг хүн 3 хүртэл багт байж болох ч
// зөвхөн үндсэн багтаа тоологдоно, эс тэгвэл нүднүүдийн нийлбэр толгойн
// тооноос давна.  Дээр нь Багууд хуудасны ХАРАГДАЦЫН шилжүүлэг
// (`lib/teamsPageDisplay.ts`, 2026-09-18): жагсаалтад байгаа хүн энд өөр
// багийн мөрөнд тоологдоно, `user_teams` хэвээр.
teams.get('/allocation', requireManager(), async (c) => {
  const user = c.get('user');
  const today = todayInUB();
  const dateParam = c.req.query('date');
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam <= today ? dateParam : today;
  const rangeParam = c.req.query('range') ?? 'day';
  const range: AllocRange = isAllocRange(rangeParam) ? rangeParam : 'day';
  const from = addDays(date, -(ALLOC_RANGE_DAYS[range] - 1));
  const to = date;

  // Гэрээ хэлэлцээрийн шатны төсөл зөвхөн admin/senior-т харагдана —
  // `routes/projects.ts`-ийн `seesPending`-тэй ижил дүрэм.  Энэ мөргүйгээр
  // инженер матрицаас нууц төслийн нэрийг уншина.
  const seesPending = isAdminRole(user.role) || user.role === 'senior';
  const pendingFilter = seesPending ? '' : ' AND COALESCE(p.is_pending, 0) = 0';

  // Матрицын хамрах хүрээ: архивлагдаагүй, ЗХ-ийн бус төслүүд.
  const PROJECT_SCOPE_SQL = `p.status <> 'archived' AND ${NOT_ASR_ONLY_SQL}${pendingFilter}`;

  // ⚠️ 2026-09-11: `latest_task` CTE + `LEFT JOIN` нь энд `SCAN lt` болж
  //    НЭГ хүсэлтэд 2 974 739 мөр уншдаг байв (өдрийн үнэгүй D1 лимитийн 60%).
  //    Скаляр дэд асуулга + бүрхэх индекс (0290) → ~12 000.  lib/progressLatest.ts.
  // Багууд хуудас Л уншдаг endpoint тул харагдацын шилжүүлэг ҮРГЭЛЖ асаалттай
  // (lib/teamsPageDisplay.ts) — доорх 7 join бүгд энэ харьцаагаар.
  const PRIMARY_TEAM = primaryTeamSql({ teamsView: true });

  const ALLOC_CTE = `
    WITH
    -- Нэг мөр = (хариуцагч × ажил).  Багийн харьяалал нь ХҮНийх
    -- (user_teams), блокийнх (blocks.team_id) БИШ: асуулт нь «энэ
    -- багийн хэдэн ХҮН тэнд ажиллаж байна» тул хүнээр тоолно.
    scope AS (
      SELECT ta.user_id,
             ut.team_id,
             b.project_id,
             ta.task_id,
             COALESCE(${latestApprovedPctByDate('ta.task_id')}, 0) AS progress,
             t.due_date
      FROM task_assignees ta
      INNER JOIN tasks t       ON t.id = ta.task_id
      INNER JOIN components co ON co.id = t.component_id
      INNER JOIN drawings d    ON d.id = co.drawing_id
      INNER JOIN blocks b      ON b.id = d.block_id
      INNER JOIN projects p    ON p.id = b.project_id
      INNER JOIN users u       ON u.id = ta.user_id AND u.status = 'active'
      INNER JOIN ${PRIMARY_TEAM} ut ON ut.user_id = u.id
      WHERE ${PROJECT_SCOPE_SQL}
    ),
    -- Ажлын тоо/явцыг ХАРИУЦАГЧААР давхардуулж болохгүй: 2 хариуцагчтай
    -- ажил нүдэнд 2 удаа тоологдвол «ажлын тоо» хоёр дахин гарна.
    cell_tasks AS (
      SELECT DISTINCT team_id, project_id, task_id, progress, due_date FROM scope
    )
  `;

  const [teamsRes, projectsRes, cellsRes, membersRes, activeRes, openRes, dayWork] = await Promise.all([
    // 1) Багийн мета + толгойн тоо
    c.env.DB.prepare(
      `
      SELECT t.id, t.code, t.name_mn, t.name_en, t.sort_order,
             COALESCE(mc.member_count, 0) AS member_count
      FROM teams t
      LEFT JOIN (
        SELECT ut.team_id, COUNT(DISTINCT ut.user_id) AS member_count
        FROM ${PRIMARY_TEAM} ut
        INNER JOIN users u ON u.id = ut.user_id
        WHERE u.status = 'active'
        GROUP BY ut.team_id
      ) mc ON mc.team_id = t.id
      ORDER BY t.sort_order, t.name_mn
    `,
    ).all<{
      id: number;
      code: string;
      name_mn: string;
      name_en: string | null;
      sort_order: number;
      member_count: number;
    }>(),

    // 2) Матрицын багананд орох төслүүд
    c.env.DB.prepare(
      `
      SELECT p.id, p.name, p.display_title, p.status, p.category,
             COALESCE(p.is_pending, 0) AS is_pending,
             COALESCE(p.is_asap, 0) AS is_asap
      FROM projects p
      WHERE ${PROJECT_SCOPE_SQL}
      ORDER BY p.sort_order, p.name
    `,
    ).all<{
      id: number;
      name: string;
      display_title: string | null;
      status: string;
      category: string | null;
      is_pending: number;
      is_asap: number;
    }>(),

    // 3) Матрицын нүд: (баг × төсөл)
    c.env.DB.prepare(
      `
      ${ALLOC_CTE},
      -- Хоёр агрегатыг ТУСДАА бүлэглээд холбоно.  Нэг SELECT дотор
      -- корреляцтай дэд query-гээр тоолвол нүд бүрт cell_tasks-ыг
      -- дахин уншина (локал дээр 118ms → нэгдсэн хувилбар 8ms).
      task_agg AS (
        SELECT team_id, project_id,
               COUNT(*) AS tasks,
               SUM(CASE WHEN progress >= 100 THEN 1 ELSE 0 END) AS done_tasks,
               SUM(CASE WHEN due_date IS NOT NULL AND due_date < date('now')
                             AND progress < 100 THEN 1 ELSE 0 END) AS overdue_tasks,
               ROUND(AVG(progress), 1) AS avg_progress
        FROM cell_tasks
        GROUP BY team_id, project_id
      ),
      -- «Ажиллаж байна» = ДУУСААГҮЙ ажил хариуцсан.
      --
      -- ⚠️ 2026-09-03-нд зассан.  Өмнө нь энэ нь ЗҮГЭЭР Л хариуцагч байсан
      -- бөгөөд дууссан ажил ч тоологддог тул аль хэдийн ХААГДСАН төсөл
      -- бүтэн багаараа «ажиллаж байгаа» мэт харагддаг байв.  Хэмжсэн жишээ:
      -- ХӨШИГТИЙН ХӨНДИЙ — 233 ажил, дундаж явц 99.6%, ДУУСААГҮЙ нь ердөө 1,
      -- гэтэл 13 хүн ажиллаж байгаа гэж гарч байлаа.  Улмаар 18 хүнтэй BA
      -- багийн нүднүүдийн нийлбэр 52 болж, эзэнд «тоо буруу» харагдсан.
      -- Одоо тэр нүд 1 болно.
      --
      -- ever_people нь түүхэн тоо (хэзээ нэгэн цагт энэ төсөлд ажилласан) —
      -- нүдэнд гарахгүй, зөвхөн хажуугийн самбарын «дууссан» бүлэгт.
      people_agg AS (
        SELECT team_id,
               project_id,
               COUNT(DISTINCT CASE WHEN progress < 100 THEN user_id END) AS people,
               COUNT(DISTINCT user_id) AS ever_people
        FROM scope
        GROUP BY team_id, project_id
      )
      SELECT pa.team_id,
             pa.project_id,
             pa.people,
             pa.ever_people,
             COALESCE(ta.tasks, 0) AS tasks,
             COALESCE(ta.done_tasks, 0) AS done_tasks,
             COALESCE(ta.overdue_tasks, 0) AS overdue_tasks,
             COALESCE(ta.avg_progress, 0) AS avg_progress
      FROM people_agg pa
      LEFT JOIN task_agg ta ON ta.team_id = pa.team_id AND ta.project_id = pa.project_id
    `,
    ).all<{
      team_id: number;
      project_id: number;
      people: number;
      ever_people: number;
      tasks: number;
      done_tasks: number;
      overdue_tasks: number;
      avg_progress: number | null;
    }>(),

    // 4) Нүд бүрийн ХҮМҮҮС + багийн бүх идэвхтэй гишүүд.
    //    Хоёуланг нэг query-гээр: `LEFT JOIN scope` тул ямар ч төсөлгүй
    //    («чөлөөтэй») гишүүн `project_id = NULL` мөртэйгээр буцна.  Ингэснээр
    //    frontend «хуваарилагдаагүй хэн бэ?»-г НЭРЭЭР нь харуулж чадна —
    //    менежерийн хамгийн эхний асуулт яг энэ.
    c.env.DB.prepare(
      `
      ${ALLOC_CTE}
      SELECT u.id AS user_id, u.full_name, u.profile_image, u.position,
             ut.team_id,
             sc.project_id,
             COUNT(DISTINCT sc.task_id) AS tasks,
             COUNT(DISTINCT CASE WHEN sc.progress < 100 THEN sc.task_id END) AS open_tasks,
             ROUND(AVG(sc.progress), 1) AS avg_progress
      FROM users u
      INNER JOIN ${PRIMARY_TEAM} ut ON ut.user_id = u.id
      -- team_id-г ч тулгана.  user_teams дээр «нэг хүнд НЭГ л үндсэн
      -- баг» гэсэн индекс БАЙХГҮЙ (UNIQUE нь (user_id, team_id) дээр л),
      -- тиймээс хэн нэгэнд хоёр үндсэн мөр үүсвэл зөвхөн user_id-гаар
      -- холбосон join нь түүний ажлыг ХОЁР багт хуулах байлаа.
      LEFT JOIN scope sc ON sc.user_id = u.id AND sc.team_id = ut.team_id
      WHERE u.status = 'active'
      GROUP BY u.id, ut.team_id, sc.project_id
      ORDER BY u.full_name
    `,
    ).all<{
      user_id: number;
      full_name: string;
      profile_image: string | null;
      position: string | null;
      team_id: number;
      project_id: number | null;
      tasks: number;
      open_tasks: number;
      avg_progress: number | null;
    }>(),

    // 5) Тухайн ӨДРИЙН бодит зураг — ирцээр сонгосон төсөл, ШАТ БҮРЭЭР.
    //    `daily_active_projects` нь зөвхөн СҮҮЛИЙН сонголтыг хадгалдаг
    //    (үдээс хойших checkpoint өглөөнийхийг ДАРЖ бичдэг), тиймээс түүгээр
    //    л тоолбол өглөө А, үдээс хойш Б төсөл дээр суусан хүн зөвхөн Б дээр
    //    харагдана.  Өдрийн бүх сонголт `attendance_project_checkpoints`-д
    //    (morning / afternoon / clock_out — гурав хүртэл) тул ТЭНДЭЭС уншина:
    //    нэг хүн өдөрт 2-3 төсөл дээр байж болно, тэр бүгд нүдэнд орно.
    //    Тоолсон дүн БИШ, ТҮҮХИЙ мөрүүд буцаана: frontend мөр/баганын
    //    «давхардаагүй хүн»-ийг өөрөө нэгтгэх ёстой.
    //    Checkpoint-гүй (ирцийн өмнө `PUT /active-projects`-оор л сонгосон)
    //    мөрийг ХАЯХГҮЙ — `checkpoint_type = NULL` («төлөвлөсөн») гэж орно.
    //    Мужаар (`range`) бол `[from, to]` бүх өдрийн мөр — өдөр бүр тусдаа.
    c.env.DB.prepare(
      `
      SELECT ut.team_id, cp.project_id, c.user_id, c.date, c.checkpoint_type, c.recorded_at
      FROM attendance_project_checkpoints c
      INNER JOIN attendance_checkpoint_projects cp ON cp.checkpoint_id = c.id
      INNER JOIN users u       ON u.id = c.user_id AND u.status = 'active'
      INNER JOIN ${PRIMARY_TEAM} ut ON ut.user_id = u.id
      INNER JOIN projects p    ON p.id = cp.project_id
      WHERE c.date BETWEEN ? AND ? AND ${PROJECT_SCOPE_SQL}
      UNION ALL
      SELECT ut.team_id, dap.project_id, dap.user_id, dap.date,
             NULL AS checkpoint_type, NULL AS recorded_at
      FROM daily_active_projects dap
      INNER JOIN users u       ON u.id = dap.user_id AND u.status = 'active'
      INNER JOIN ${PRIMARY_TEAM} ut ON ut.user_id = u.id
      INNER JOIN projects p    ON p.id = dap.project_id
      WHERE dap.date BETWEEN ? AND ? AND ${PROJECT_SCOPE_SQL}
      -- 7) ЗАСВАРЫН ТӨСӨЛ (repair_projects, миграц 0324) — ирцээр сонгосон
      --    дотоод/жижиг засварын ажил.  projects.id-тэй ДАВХЦДАГ тул
      --    project_id = -repair_project_id (сөрөг) гэж ялгана; frontend
      --    kind = 'repair'-аар танина (lib/allocation.ts).  Төлөвийн шүүлт
      --    ЗОРИУД байхгүй — архивласан засварын төсөл ч түүхэн мужид харагдана.
      UNION ALL
      SELECT ut.team_id, -cr.repair_project_id AS project_id, c.user_id, c.date,
             c.checkpoint_type, c.recorded_at
      FROM attendance_project_checkpoints c
      INNER JOIN attendance_checkpoint_repairs cr ON cr.checkpoint_id = c.id
      INNER JOIN users u       ON u.id = c.user_id AND u.status = 'active'
      INNER JOIN ${PRIMARY_TEAM} ut ON ut.user_id = u.id
      WHERE c.date BETWEEN ? AND ?
      UNION ALL
      SELECT ut.team_id, -dar.repair_project_id AS project_id, dar.user_id, dar.date,
             NULL AS checkpoint_type, NULL AS recorded_at
      FROM daily_active_repairs dar
      INNER JOIN users u       ON u.id = dar.user_id AND u.status = 'active'
      INNER JOIN ${PRIMARY_TEAM} ut ON ut.user_id = u.id
      WHERE dar.date BETWEEN ? AND ?
    `,
    )
      .bind(from, to, from, to, from, to, from, to)
      .all<{
        team_id: number;
        project_id: number;
        user_id: number;
        date: string;
        checkpoint_type: AttendanceStage | null;
        recorded_at: string | null;
      }>(),

    // 6) Хэн ОДОО ажлын байрандаа байна — нээлттэй session.  «Одоо энэ
    //    төсөл дээр» гэдэг нь сүүлийн checkpoint + нээлттэй session хоёрын
    //    огтлолцол; гарсан хүний сүүлийн сонголт «сүүлд ажилласан» болно.
    c.env.DB.prepare(
      `
      SELECT DISTINCT user_id
      FROM attendance_sessions
      WHERE date = ? AND clock_out IS NULL
    `,
    )
      .bind(date)
      .all<{ user_id: number }>(),

    // 7) ЗАНГУУ өдрийн (`to`) төслийн бус ажил + засварын цаг — ажилтны
    //    «одоогийн ажил» (2026-09-24, lib/teamDayWorkStore.ts).  Нүд, донат,
    //    тоолуурт ОРОХГҮЙ — зөвхөн нэрсийн мөрөнд харагдана.
    loadDayWork(c.env.DB, to, { seesPending }),
  ]);

  // Хүн бүрийн өдрийн сонголтуудыг шатаар нь угсарна.  Сүүлийн шат =
  // хамгийн хожуу `recorded_at`; checkpoint-гүй «төлөвлөсөн» мөр зөвхөн
  // ямар ч checkpoint байхгүй үед л сүүлийнх болно.
  const STAGE_RANK: Record<AttendanceStage, number> = { morning: 1, afternoon: 2, clock_out: 3 };
  type UserSpan = {
    /** project_id → ЗАНГУУ өдөр (`to`) дээр сонгосон шатууд (давхардаагүй). */
    stages: Map<number, Set<AttendanceStage>>;
    /** project_id → сонгосон өдрүүд (checkpoint эсвэл төлөвлөсөн). */
    dates: Map<number, Set<string>>;
    /** Checkpoint-гүй, зөвхөн `daily_active_projects`-д байгаа (өдөр, төсөл). */
    planned: Map<string, Set<number>>;
    /** Мужийн хамгийн СҮҮЛИЙН checkpoint — өдөр, цаг, шат, төслүүд. */
    latestDate: string | null;
    latestStage: AttendanceStage | null;
    latestAt: string | null;
    latestProjects: Set<number>;
  };
  const userSpans = new Map<number, UserSpan>();
  const teamOfActive = new Map<number, number>();
  const datesSeen = new Set<string>();
  for (const r of activeRes.results ?? []) {
    teamOfActive.set(r.user_id, r.team_id);
    let span = userSpans.get(r.user_id);
    if (!span) {
      span = {
        stages: new Map(),
        dates: new Map(),
        planned: new Map(),
        latestDate: null,
        latestStage: null,
        latestAt: null,
        latestProjects: new Set(),
      };
      userSpans.set(r.user_id, span);
    }
    let dates = span.dates.get(r.project_id);
    if (!dates) span.dates.set(r.project_id, (dates = new Set()));
    dates.add(r.date);
    // Дунджийн хуваарь (`active_days`) нь checkpoint-той ч, зөвхөн
    // төлөвлөсөн ч өдрийг тоолно — аль аль нь «тэр өдөр ажилласан».
    datesSeen.add(r.date);
    if (!r.checkpoint_type) {
      let planned = span.planned.get(r.date);
      if (!planned) span.planned.set(r.date, (planned = new Set()));
      planned.add(r.project_id);
      continue;
    }
    if (r.date === to) {
      let stages = span.stages.get(r.project_id);
      if (!stages) span.stages.set(r.project_id, (stages = new Set()));
      stages.add(r.checkpoint_type);
    }
    // Сүүлийн шат: өдөр → цаг → шатны эрэмбэ.  `recorded_at` бүх мөрөнд
    // ижил (+08:00) хэлбэртэй тул мөрөөр харьцуулж болно, гэхдээ өдрийг
    // түрүүлж тулгана — өдрөө хатуу баримталж, цагийн хэлбэрт найдахгүй.
    const at = r.recorded_at ?? '';
    const prevDate = span.latestDate ?? '';
    const prevAt = span.latestAt ?? '';
    const newer =
      span.latestStage == null ||
      r.date > prevDate ||
      (r.date === prevDate &&
        (at > prevAt ||
          (at === prevAt && STAGE_RANK[r.checkpoint_type] > STAGE_RANK[span.latestStage])));
    if (newer) {
      span.latestDate = r.date;
      span.latestStage = r.checkpoint_type;
      span.latestAt = at;
      span.latestProjects = new Set([r.project_id]);
    } else if (r.date === prevDate && r.checkpoint_type === span.latestStage && at === prevAt) {
      span.latestProjects.add(r.project_id);
    }
  }
  const openNow = new Set((openRes.results ?? []).map((r) => r.user_id));
  const isToday = to === today;

  // Мужид ирцээр сонгогдсон засварын төслүүдийн нэр — матрицын МӨР болно.
  // Зөвхөн сонгогдсон нь (бүх идэвхтэй засварын төсөл биш): хэн ч сонгоогүй
  // засварын төсөл хоосон мөр болж хүснэгтийг дүүргэх ёсгүй.
  const repairIds = [
    ...new Set(
      (activeRes.results ?? []).filter((r) => r.project_id < 0).map((r) => -r.project_id),
    ),
  ];
  const repairRows =
    repairIds.length === 0
      ? []
      : ((
          await c.env.DB.prepare(
            `SELECT id, name, status FROM repair_projects
              WHERE id IN (${repairIds.map(() => '?').join(',')})
              ORDER BY sort_order, name`,
          )
            .bind(...repairIds)
            .all<{ id: number; name: string; status: string }>()
        ).results ?? []);

  type ActiveMember = {
    user_id: number;
    /** Зангуу өдөр энэ төслийг сонгосон шатууд; хоосон = зөвхөн төлөвлөсөн / өөр өдөр. */
    stages: AttendanceStage[];
    /** Мужид энэ төслийг сонгосон ӨДРИЙН тоо (нэг өдөрт хэдэн шатанд ч сонгосон — 1). */
    days: number;
    /** Хамгийн сүүлд сонгосон өдөр. */
    last_date: string;
    /** Хүний мужийн СҮҮЛИЙН сонголтод энэ төсөл байна. */
    latest: boolean;
    /** Одоо (нээлттэй session, гараагүй) энэ төсөл дээр сууж байна — зөвхөн `to` = өнөөдөр. */
    now: boolean;
  };
  const activeByCell = new Map<string, ActiveMember[]>();
  const activePeople = new Set<number>();
  /** Хүн-өдөр: баг бүрт (өдөрт давхардаагүй), төсөл бүрт, нийт (давхардаагүй). */
  const teamPersonDays = new Map<number, number>();
  const projectPersonDays = new Map<number, number>();
  let totalPersonDays = 0;
  for (const [userId, span] of userSpans) {
    const teamId = teamOfActive.get(userId);
    if (teamId == null) continue;
    activePeople.add(userId);
    const userDates = new Set<string>();
    for (const [projectId, dates] of span.dates) {
      for (const d of dates) userDates.add(d);
      projectPersonDays.set(projectId, (projectPersonDays.get(projectId) ?? 0) + dates.size);
    }
    teamPersonDays.set(teamId, (teamPersonDays.get(teamId) ?? 0) + userDates.size);
    totalPersonDays += userDates.size;
    // Checkpoint огт байхгүй хүний «сүүлийн сонголт» = хамгийн сүүлийн
    // өдрийн төлөвлөсөн төслүүд.
    const plannedLatestDate = [...span.planned.keys()].sort().pop() ?? null;
    const latestSet =
      span.latestStage != null
        ? span.latestProjects
        : (plannedLatestDate && span.planned.get(plannedLatestDate)) || new Set<number>();
    for (const [projectId, dates] of span.dates) {
      const stages = [...(span.stages.get(projectId) ?? [])].sort(
        (x, y) => STAGE_RANK[x] - STAGE_RANK[y],
      );
      const latest = latestSet.has(projectId);
      const now =
        isToday &&
        latest &&
        (span.latestDate ?? plannedLatestDate) === today &&
        span.latestStage !== 'clock_out' &&
        openNow.has(userId);
      const key = `${teamId}:${projectId}`;
      const list = activeByCell.get(key) ?? [];
      list.push({
        user_id: userId,
        stages,
        days: dates.size,
        last_date: [...dates].sort().pop() ?? to,
        latest,
        now,
      });
      activeByCell.set(key, list);
    }
  }

  type CellMember = {
    user_id: number;
    full_name: string;
    profile_image: string | null;
    tasks: number;
    /** Дуусаагүй нь.  0 бол энэ хүн энэ төсөл дээр ажиллаж ДУУССАН. */
    open_tasks: number;
    avg_progress: number;
  };
  type IdleMember = {
    user_id: number;
    full_name: string;
    profile_image: string | null;
    position: string | null;
  };

  // Нүд бүрийн гишүүдийг угсарна; `project_id = NULL` мөр нь «чөлөөтэй».
  const cellMembers = new Map<string, CellMember[]>();
  const idleByTeam = new Map<number, IdleMember[]>();
  const assignedUsers = new Set<number>();
  const seenUser = new Set<number>();

  for (const r of membersRes.results ?? []) {
    seenUser.add(r.user_id);
    if (r.project_id == null) continue;
    // «Хуваарилагдсан» = ДУУСААГҮЙ ажилтай.  Бүх ажлаа дуусгасан хүн
    // системийн хувьд шинэ ажил хүлээж байгаа тул «чөлөөтэй» тал руу
    // орох ёстой — эс тэгвэл «Төсөлгүй» тоолуур мөнхөд 0 болно.
    if (r.open_tasks > 0) assignedUsers.add(r.user_id);
    const key = `${r.team_id}:${r.project_id}`;
    const list = cellMembers.get(key) ?? [];
    if (!list.some((m) => m.user_id === r.user_id)) {
      list.push({
        user_id: r.user_id,
        full_name: r.full_name,
        profile_image: r.profile_image,
        tasks: r.tasks,
        open_tasks: r.open_tasks,
        avg_progress: r.avg_progress ?? 0,
      });
    }
    cellMembers.set(key, list);
  }
  // Хоёр дахь дамжуулалт: хүн ЯМАР Ч төсөлд ДУУСААГҮЙ ажилгүй бол
  // «чөлөөтэй».  Нэг дамжуулалтаар шийдэж болохгүй — эхний мөр нь NULL
  // эсвэл дууссан төсөл байж болох ч хожим нээлттэй ажилтай мөр гарч
  // ирж болно.
  for (const r of membersRes.results ?? []) {
    if (assignedUsers.has(r.user_id)) continue;
    const list = idleByTeam.get(r.team_id) ?? [];
    if (!list.some((m) => m.user_id === r.user_id)) {
      list.push({
        user_id: r.user_id,
        full_name: r.full_name,
        profile_image: r.profile_image,
        position: r.position,
      });
    }
    idleByTeam.set(r.team_id, list);
  }

  const cells = (cellsRes.results ?? []).map((r) => {
    const activeMembers = activeByCell.get(`${r.team_id}:${r.project_id}`) ?? [];
    return {
      team_id: r.team_id,
      project_id: r.project_id,
      people: r.people,
      ever_people: r.ever_people,
      active: activeMembers.length,
      active_person_days: activeMembers.reduce((s, m) => s + m.days, 0),
      active_user_ids: activeMembers.map((m) => m.user_id),
      active_members: activeMembers,
      tasks: r.tasks,
      done_tasks: r.done_tasks,
      overdue_tasks: r.overdue_tasks,
      avg_progress: r.avg_progress ?? 0,
      members: cellMembers.get(`${r.team_id}:${r.project_id}`) ?? [],
    };
  });

  // Ирцээр идэвхтэй ч ХАРИУЦАГЧААР бүртгэлгүй хослол бас байж болно
  // (шинэ төсөл, ажил хараахан үүсээгүй).  Түүнийг ХАЯХГҮЙ — эс тэгвэл
  // «өнөөдөр» хэмжүүрийн нийлбэр ирцийн самбартай зөрнө.
  const cellKeys = new Set(cells.map((x) => `${x.team_id}:${x.project_id}`));
  for (const [key, activeMembers] of activeByCell) {
    if (cellKeys.has(key)) continue;
    const [teamId, projectId] = key.split(':').map(Number);
    cells.push({
      team_id: teamId ?? 0,
      project_id: projectId ?? 0,
      people: 0,
      ever_people: 0,
      active: activeMembers.length,
      active_person_days: activeMembers.reduce((s, m) => s + m.days, 0),
      active_user_ids: activeMembers.map((m) => m.user_id),
      active_members: activeMembers,
      tasks: 0,
      done_tasks: 0,
      overdue_tasks: 0,
      avg_progress: 0,
      members: [],
    });
  }

  return c.json({
    date,
    range,
    from,
    to,
    /** Мужид ядаж нэг ирцийн төслийн бүртгэлтэй өдрийн тоо — дунджийн хуваарь. */
    active_days: datesSeen.size,
    headcount: seenUser.size,
    assigned_people: assignedUsers.size,
    active_people: activePeople.size,
    /** Нийт хүн-өдөр (өдөрт давхардаагүй) — `/ active_days` = өдрийн дундаж хүн. */
    active_person_days: totalPersonDays,
    teams: (teamsRes.results ?? []).map((t) => ({
      ...t,
      active_person_days: teamPersonDays.get(t.id) ?? 0,
      idle_members: idleByTeam.get(t.id) ?? [],
    })),
    projects: [
      ...(projectsRes.results ?? []).map((p) => ({
        ...p,
        active_person_days: projectPersonDays.get(p.id) ?? 0,
        kind: 'project' as const,
      })),
      // ⚠️ `id` нь СӨРӨГ (= -repair_projects.id) — `/app/projects/:id` руу
      //    ХЭЗЭЭ Ч холбохгүй; `kind` нь frontend-ийн ганц ялгуур.
      ...repairRows.map((rp) => ({
        id: -rp.id,
        name: rp.name,
        display_title: null,
        status: rp.status,
        category: null,
        is_pending: 0,
        is_asap: 0,
        active_person_days: projectPersonDays.get(-rp.id) ?? 0,
        kind: 'repair' as const,
      })),
    ],
    cells,
    day_work: dayWork,
  });
});


// GET /api/teams/:id — single team plus its active members
teams.get('/:id', requireOwnTeamOrManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  const team = await c.env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first<TeamRow>();
  if (!team) return c.json({ error: 'Team not found' }, 404);

  const { results: members } = await c.env.DB.prepare(
    `
    SELECT u.id, u.username, u.full_name, u.role, u.status, u.position, u.employee_id, u.profile_image, ut.is_primary
    FROM user_teams ut
    JOIN users u ON u.id = ut.user_id
    WHERE ut.team_id = ? AND ut.is_primary = 1 AND u.status = 'active'
    ORDER BY
      CASE u.role WHEN 'admin' THEN 0 WHEN 'senior' THEN 1 ELSE 2 END,
      u.full_name
  `,
  )
    .bind(id)
    .all();

  return c.json({ team, members });
});

// GET /api/teams/:id/overview — team details with projects, stats, members workload
teams.get('/:id/overview', requireOwnTeamOrManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  const team = await c.env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first<TeamRow>();
  if (!team) return c.json({ error: 'Team not found' }, 404);
  const user = c.get('user');
  const seesPending = isAdminRole(user.role) || user.role === 'senior';

  const [projectsRes, statsRes, membersRes, recentRes, dayWork] = await Promise.all([
    // Active projects this team contributes to. Aggregates (avg_progress,
    // task_count, completed/in-progress/overdue counts) cover the
    // *team's slice* of each project — every task under a block tagged
    // with this team_id, claimed or not. The slice definition lives in
    // the `team_tasks` CTE above. A project appears iff this team has
    // at least one structurally tagged task in it.
    // active_today_count is the number of distinct team members who
    // marked the project as active on today's AttendanceWidget pick.
    c.env.DB.prepare(
      `
      ${TEAM_TASK_CTE},
      ${TEAM_SCOPED_TASKS_CTE},
      proj_team_tasks AS (
        SELECT tp.project_id,
               COUNT(DISTINCT tp.task_id) AS task_count,
               SUM(CASE WHEN tp.progress >= 100 THEN 1 ELSE 0 END) AS completed_count,
               SUM(CASE WHEN tp.progress > 0 AND tp.progress < 100 THEN 1 ELSE 0 END) AS in_progress_count,
               SUM(CASE WHEN tp.due_date IS NOT NULL AND tp.due_date < date('now') AND tp.progress < 100 THEN 1 ELSE 0 END) AS overdue_count,
               ROUND(AVG(tp.progress), 1) AS avg_progress,
               MIN(CASE WHEN tp.progress < 100 THEN tp.due_date ELSE NULL END) AS next_due
        FROM team_scoped tp
        GROUP BY tp.project_id
      ),
      proj_active_today AS (
        SELECT dap.project_id,
               COUNT(DISTINCT dap.user_id) AS active_count,
               json_group_array(DISTINCT json_object(
                 'user_id', u.id,
                 'full_name', u.full_name,
                 'profile_image', u.profile_image
               )) AS active_members_json
        FROM daily_active_projects dap
        INNER JOIN user_teams ut ON ut.user_id = dap.user_id
        INNER JOIN users u ON u.id = dap.user_id
        WHERE dap.date = ?2 AND ut.team_id = ?1 AND ut.is_primary = 1
        GROUP BY dap.project_id
      )
      SELECT p.id, p.name, p.description, p.location, p.status,
             p.category, p.complexity_pct, p.created_at,
             passport.start_date, passport.finish_date,
             COALESCE(pat.task_count, 0) AS task_count,
             COALESCE(pat.completed_count, 0) AS completed_count,
             COALESCE(pat.in_progress_count, 0) AS in_progress_count,
             COALESCE(pat.overdue_count, 0) AS overdue_count,
             COALESCE(pat.avg_progress, 0) AS avg_progress,
             pat.next_due AS next_due,
             COALESCE(pact.active_count, 0) AS active_today_count,
             COALESCE(pact.active_members_json, '[]') AS active_members_json
      FROM projects p
      INNER JOIN proj_team_tasks pat ON pat.project_id = p.id
      LEFT JOIN proj_active_today pact ON pact.project_id = p.id
      LEFT JOIN project_passport passport ON passport.project_id = p.id
      -- Архивласан төсөл зөвхөн админд (2026-09-28, lib/archivedProjects.ts).
      WHERE ${NOT_ASR_ONLY_SQL}${hideArchivedSql(user.role)}
      ORDER BY
        CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END,
        pat.task_count DESC, p.name
    `,
    )
      .bind(id, todayInUB())
      .all(),

    // Team-wide task stats — scoped to the team's slice (every task
    // under a block tagged with this team_id). Matches the per-project
    // counts above so the hero numbers (Дундаж явц / N ажил / Хоцорсон
    // / Ойрхон дуусах) sum across the same task set the project cards
    // show.
    c.env.DB.prepare(
      `
      ${TEAM_TASK_CTE},
      ${TEAM_SCOPED_TASKS_CTE}
      SELECT
        COUNT(DISTINCT tp.task_id) AS total,
        SUM(CASE WHEN tp.progress >= 100 THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN tp.progress > 0 AND tp.progress < 100 THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN tp.progress = 0 THEN 1 ELSE 0 END) AS not_started,
        SUM(CASE WHEN tp.due_date IS NOT NULL AND tp.due_date < date('now') AND tp.progress < 100 THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN tp.due_date IS NOT NULL AND tp.due_date >= date('now') AND tp.due_date <= date('now', '+7 days') AND tp.progress < 100 THEN 1 ELSE 0 END) AS due_soon,
        ROUND(AVG(tp.progress), 1) AS avg_progress
      FROM team_scoped tp
    `,
    )
      .bind(id)
      .first<{
        total: number;
        completed: number;
        in_progress: number;
        not_started: number;
        overdue: number;
        due_soon: number;
        avg_progress: number;
      }>(),

    // Members with task counts + avg progress + today's active projects
    // (the projects each member ticked in the AttendanceWidget when clocking
    // in — joined as a JSON array per user so the team page can render
    // "юу хийж байна вэ?" without a second round-trip).
    c.env.DB.prepare(
      `
      ${TEAM_TASK_CTE},
      -- Зөвхөн энэ багийн гишүүдийн таскууд: доорх SELECT тэднээс өөр хүнийг
      -- авахгүй тул бүх 3 300 хариуцлагыг тооцох нь дэмий байв.  MATERIALIZED —
      -- progress-ын дэд асуулга мөр бүрд ганц удаа.
      member_tasks AS MATERIALIZED (
        SELECT ta.user_id, ta.task_id, tp.progress
        FROM task_assignees ta
        INNER JOIN task_prog tp ON tp.task_id = ta.task_id
        WHERE ta.user_id IN (SELECT user_id FROM user_teams WHERE team_id = ?1 AND is_primary = 1)
      ),
      user_task_agg AS (
        SELECT mt.user_id,
               COUNT(DISTINCT mt.task_id) AS task_count,
               SUM(CASE WHEN mt.progress >= 100 THEN 1 ELSE 0 END) AS completed_count,
               ROUND(AVG(mt.progress), 1) AS avg_progress
        FROM member_tasks mt
        GROUP BY mt.user_id
      ),
      -- Засварын төсөл (0324) ч «өнөөдөр юу хийж байна»-д орно — эс тэгвэл
      -- зөвхөн засварын төсөл сонгосон хүн «төсөл сонгоогүй» гэж харагдана
      -- (2026-09-24).  id нь /allocation-тэй ижил: -repair_projects.id,
      -- kind = 'repair' — frontend түүгээр л /app/projects/:id холбоосыг хаана.
      user_active_today AS (
        SELECT pick.user_id,
               json_group_array(
                 json_object('project_id', pick.project_id, 'project_name', pick.project_name,
                             'kind', pick.kind)
               ) AS active_today_json
        FROM (
          SELECT dap.user_id, p.id AS project_id, p.name AS project_name, 'project' AS kind
          FROM daily_active_projects dap
          INNER JOIN projects p ON p.id = dap.project_id
          WHERE dap.date = ?2
          UNION ALL
          SELECT dar.user_id, -rp.id AS project_id, rp.name AS project_name, 'repair' AS kind
          FROM daily_active_repairs dar
          INNER JOIN repair_projects rp ON rp.id = dar.repair_project_id
          WHERE dar.date = ?2
        ) pick
        GROUP BY pick.user_id
      )
      SELECT u.id, u.username, u.full_name, u.role, u.status, u.position,
             u.employee_id, u.profile_image,
             COALESCE(uta.task_count, 0) AS task_count,
             COALESCE(uta.completed_count, 0) AS completed_count,
             COALESCE(uta.avg_progress, 0) AS avg_progress,
             COALESCE(uat.active_today_json, '[]') AS active_today_json
      FROM users u
      LEFT JOIN user_task_agg uta ON uta.user_id = u.id
      LEFT JOIN user_active_today uat ON uat.user_id = u.id
      WHERE u.id IN (SELECT user_id FROM user_teams WHERE team_id = ?1 AND is_primary = 1) AND u.status = 'active'
      ORDER BY
        CASE u.role WHEN 'admin' THEN 0 WHEN 'senior' THEN 1 ELSE 2 END,
        u.full_name
    `,
    )
      .bind(id, todayInUB())
      .all(),

    // Recent approved progress entries by team members (last 10)
    c.env.DB.prepare(
      `
      SELECT pe.id, pe.percentage, pe.date, pe.notes,
             u.id AS user_id, u.full_name, u.profile_image,
             t.name AS item_name,
             p.id AS project_id, p.name AS project_name
      FROM progress_entries pe
      INNER JOIN users u ON u.id = pe.user_id
      LEFT JOIN tasks t ON t.id = pe.task_id
      LEFT JOIN components c ON c.id = t.component_id
      LEFT JOIN drawings d ON d.id = c.drawing_id
      LEFT JOIN blocks b ON b.id = d.block_id
      LEFT JOIN projects p ON p.id = b.project_id
      WHERE u.id IN (SELECT user_id FROM user_teams WHERE team_id = ?1 AND is_primary = 1) AND pe.status = 'approved' AND COALESCE(pe.source, '') <> 'alloc_adj'
      ORDER BY pe.date DESC, pe.created_at DESC
      LIMIT 12
    `,
    )
      .bind(id)
      .all(),

    // Өнөөдрийн төслийн бус ажил + засварын цаг — `/allocation`-тэй ИЖИЛ
    // уншилт (lib/teamDayWorkStore.ts), гишүүний картын «одоогийн ажил».
    loadDayWork(c.env.DB, todayInUB(), { seesPending, teamId: id }),
  ]);

  type ProjRow = { active_members_json?: string; [k: string]: unknown };
  const projects = (projectsRes.results ?? []).map((p) => {
    const row = p as ProjRow;
    let active_today_members: Array<{
      user_id: number;
      full_name: string;
      profile_image: string | null;
    }> = [];
    try {
      const parsed = JSON.parse(row.active_members_json || '[]');
      if (Array.isArray(parsed)) active_today_members = parsed;
    } catch {
      /* ignore */
    }
    const { active_members_json, ...rest } = row;
    void active_members_json;
    return { ...rest, active_today_members };
  });

  type MemberRow = {
    active_today_json: string;
    [key: string]: unknown;
  };
  const members = (membersRes.results ?? []).map((m) => {
    const row = m as MemberRow;
    let active_today: Array<{ project_id: number; project_name: string }> = [];
    try {
      const parsed = JSON.parse(row.active_today_json || '[]');
      if (Array.isArray(parsed)) active_today = parsed;
    } catch {
      /* ignore */
    }
    const { active_today_json, ...rest } = row;
    void active_today_json;
    return { ...rest, active_today };
  });

  return c.json({
    team,
    projects,
    stats: statsRes ?? {
      total: 0,
      completed: 0,
      in_progress: 0,
      not_started: 0,
      overdue: 0,
      due_soon: 0,
      avg_progress: 0,
    },
    members,
    recent_progress: recentRes.results ?? [],
    day_work: dayWork,
  });
});

// GET /api/teams/:id/member-tasks — per-member task breakdown for the
// "who filled which task and how many %" dialog on the teams list.
// Each row = one assignee's view of one *team task* that has progress
// (>0%). The client groups rows by user_id. "Team tasks" use the same
// structural block.team_id mapping as the rest of this file
// (TEAM_TASK_CTE); the percentage is the task's latest *approved*
// progress entry. A task with multiple assignees appears once per
// assignee (each at the shared task %), matching how points are split
// across assignees on approval.
teams.get('/:id/member-tasks', requireOwnTeamOrManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid team id' }, 400);

  const team = await c.env.DB.prepare(
    'SELECT id, code, name_mn, name_en FROM teams WHERE id = ?',
  )
    .bind(id)
    .first<{ id: number; code: string; name_mn: string; name_en: string | null }>();
  if (!team) return c.json({ error: 'Team not found' }, 404);

  const { results } = await c.env.DB.prepare(
    `
    ${TEAM_TASK_CTE},
    ${TEAM_SCOPED_TASKS_CTE}
    SELECT
      u.id            AS user_id,
      u.full_name     AS full_name,
      u.profile_image AS profile_image,
      u.role          AS role,
      u.position      AS position,
      tp.task_id      AS task_id,
      tp.task_name    AS task_name,
      ROUND(tp.progress, 1) AS progress,
      tp.due_date     AS due_date,
      tp.project_id   AS project_id,
      proj.name       AS project_name,
      comp.name       AS component_name,
      dr.name         AS drawing_name
    FROM team_scoped tp
    INNER JOIN task_assignees ta  ON ta.task_id = tp.task_id
    INNER JOIN users u            ON u.id = ta.user_id
    INNER JOIN components comp    ON comp.id = tp.component_id
    INNER JOIN drawings dr        ON dr.id = comp.drawing_id
    INNER JOIN projects proj      ON proj.id = tp.project_id
    WHERE tp.progress > 0
      AND u.status = 'active'
      -- Зөвхөн энэ багийн (үндсэн) гишүүдийг харуулна — толгойн тоо
      -- (member_count) болон /overview-ийн гишүүдийн жагсаалттай ижил
      -- is_primary шүүлт. Өөр багийн хүн энэ багийн task-д хариуцагчаар
      -- орсон байж болох тул (task_assignees нь блокийн team_id-аас
      -- хамааралгүй) энэ шүүлтгүйгээр баг бус хүн жагсаалтад орох эрсдэлтэй.
      AND u.id IN (SELECT user_id FROM user_teams WHERE team_id = ?1 AND is_primary = 1)
    ORDER BY u.full_name, tp.progress DESC, proj.name, tp.task_name
  `,
  )
    .bind(id)
    .all<{
      user_id: number;
      full_name: string;
      profile_image: string | null;
      role: string;
      position: string | null;
      task_id: number;
      task_name: string;
      progress: number;
      due_date: string | null;
      project_id: number;
      project_name: string;
      component_name: string;
      drawing_name: string;
    }>();

  return c.json({ team, rows: results ?? [] });
});

// POST /api/teams — create
teams.post('/', requireManager(), async (c) => {
  const body = await c.req.json<CreateTeamRequest>();

  if (!body.code || !body.name_mn) {
    return c.json({ error: 'code and name_mn are required' }, 400);
  }

  try {
    const result = await c.env.DB.prepare(
      `
      INSERT INTO teams (code, name_mn, name_en, description, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `,
    )
      .bind(
        body.code.trim(),
        body.name_mn.trim(),
        body.name_en?.trim() ?? null,
        body.description?.trim() ?? null,
        body.sort_order ?? 100,
      )
      .run();

    return c.json({ message: 'Team created', id: result.meta.last_row_id }, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return c.json({ error: 'A team with that code already exists' }, 409);
    }
    return c.json({ error: 'Failed to create team' }, 500);
  }
});

// PUT /api/teams/:id — update
teams.put('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<UpdateTeamRequest>();

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.code !== undefined) {
    updates.push('code = ?');
    values.push(body.code.trim());
  }
  if (body.name_mn !== undefined) {
    updates.push('name_mn = ?');
    values.push(body.name_mn.trim());
  }
  if (body.name_en !== undefined) {
    updates.push('name_en = ?');
    values.push(body.name_en?.trim() ?? null);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description?.trim() ?? null);
  }
  if (body.sort_order !== undefined) {
    updates.push('sort_order = ?');
    values.push(body.sort_order);
  }

  // Team approval lead: must be a `senior` who's already a member of
  // this team.  We validate before queuing the SET so a bad payload
  // can't silently null the lead.
  if (body.lead_user_id !== undefined) {
    if (body.lead_user_id === null) {
      updates.push('lead_user_id = NULL');
    } else {
      const candidate = await c.env.DB.prepare(
        `
        SELECT u.id, u.role,
               EXISTS (SELECT 1 FROM user_teams ut WHERE ut.user_id = u.id AND ut.team_id = ?) AS is_member
        FROM users u WHERE u.id = ?
      `,
      )
        .bind(id, body.lead_user_id)
        .first<{ id: number; role: string; is_member: 0 | 1 }>();
      if (!candidate) return c.json({ error: 'Lead user not found' }, 404);
      if (candidate.role !== 'senior') {
        return c.json({ error: 'Lead must have the senior role' }, 400);
      }
      if (!candidate.is_member) {
        return c.json({ error: 'Lead must be a member of this team' }, 400);
      }
      updates.push('lead_user_id = ?');
      values.push(body.lead_user_id);
    }
  }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  updates.push("updated_at = datetime('now')");
  values.push(id);

  try {
    await c.env.DB.prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    return c.json({ message: 'Team updated' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return c.json({ error: 'A team with that code already exists' }, 409);
    }
    return c.json({ error: 'Failed to update team' }, 500);
  }
});

// DELETE /api/teams/:id — delete (users are automatically unassigned by ON DELETE SET NULL)
teams.delete('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
  return c.json({ message: 'Team deleted' });
});

/* POST /api/teams/:id/members — bulk-assign users to a team. Body
 * shape: { user_ids: number[] }. Each listed user gets `team_id` set
 * to this team (re-assigning them away from any previous team). We
 * use a single UPDATE … WHERE id IN (?) with dynamic placeholders so
 * the whole batch is one D1 round-trip. Empty / invalid lists are
 * rejected loudly so the UI surfaces a helpful error rather than a
 * silent no-op. Admin-only. */
teams.post('/:id/members', requireManager(), async (c) => {
  const teamId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(teamId)) return c.json({ error: 'Invalid team id' }, 400);

  const body = await c.req.json<{ user_ids: number[] }>().catch(() => null);
  const ids = Array.isArray(body?.user_ids)
    ? Array.from(
        new Set(body!.user_ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)),
      )
    : [];
  if (ids.length === 0)
    return c.json({ error: 'user_ids must be a non-empty array of integers' }, 400);

  // Make sure the team actually exists so we don't dangle users on a stale id.
  const team = await c.env.DB.prepare('SELECT id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return c.json({ error: 'Team not found' }, 404);

  // For each user, insert into user_teams. Default is_primary = 0 unless they have no other teams.
  let added = 0;
  for (const uid of ids) {
    // Check max 3 teams constraint
    const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM user_teams WHERE user_id = ?`)
      .bind(uid)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= 3) continue;

    // If user has no teams yet, make this their primary and also update users.team_id
    const hasPrimary = await c.env.DB.prepare(
      `SELECT 1 FROM user_teams WHERE user_id = ? AND is_primary = 1`,
    )
      .bind(uid)
      .first();
    const isPrimary = hasPrimary ? 0 : 1;

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO user_teams (user_id, team_id, is_primary) VALUES (?, ?, ?)`,
    )
      .bind(uid, teamId, isPrimary)
      .run();

    if (isPrimary) {
      await c.env.DB.prepare(
        `UPDATE users SET team_id = ?, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(teamId, uid)
        .run();
    }
    added++;
  }

  return c.json({
    message: 'Members added',
    added,
    user_ids: ids,
  });
});

/* DELETE /api/teams/:id/members/:userId — remove a single user from
 * the team by setting their team_id back to NULL. We scope the UPDATE
 * to `team_id = ?` so a stale request can't accidentally unassign a
 * user who has since moved to a different team. Admin-only. */
teams.delete('/:id/members/:userId', requireManager(), async (c) => {
  const teamId = parseInt(c.req.param('id'), 10);
  const userId = parseInt(c.req.param('userId'), 10);
  if (!Number.isFinite(teamId) || !Number.isFinite(userId)) {
    return c.json({ error: 'Invalid id' }, 400);
  }

  // Check membership in user_teams
  const membership = await c.env.DB.prepare(
    `SELECT is_primary FROM user_teams WHERE user_id = ? AND team_id = ?`,
  )
    .bind(userId, teamId)
    .first<{ is_primary: number }>();
  if (!membership) {
    return c.json({ error: 'User is not a member of this team' }, 404);
  }

  await c.env.DB.prepare(`DELETE FROM user_teams WHERE user_id = ? AND team_id = ?`)
    .bind(userId, teamId)
    .run();

  // If the removed user was the team's approval lead, clear it so the
  // pending-approvals queue doesn't dangle on a non-member.
  await c.env.DB.prepare(
    `UPDATE teams SET lead_user_id = NULL, updated_at = datetime('now')
     WHERE id = ? AND lead_user_id = ?`,
  )
    .bind(teamId, userId)
    .run();

  // If deleted row was primary and user has other teams, promote one
  if (membership.is_primary) {
    const next = await c.env.DB.prepare(
      `SELECT team_id FROM user_teams WHERE user_id = ? ORDER BY team_id LIMIT 1`,
    )
      .bind(userId)
      .first<{ team_id: number }>();
    if (next) {
      await c.env.DB.prepare(
        `UPDATE user_teams SET is_primary = 1 WHERE user_id = ? AND team_id = ?`,
      )
        .bind(userId, next.team_id)
        .run();
      await c.env.DB.prepare(
        `UPDATE users SET team_id = ?, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(next.team_id, userId)
        .run();
    } else {
      await c.env.DB.prepare(
        `UPDATE users SET team_id = NULL, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(userId)
        .run();
    }
  }

  return c.json({ message: 'Member removed' });
});

export default teams;
