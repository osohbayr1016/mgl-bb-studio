/**
 * Company-wide read-only dashboard.
 *
 * One endpoint, one round trip — `/api/company/overview` returns everything
 * the frontend's `<CompanyDashboardPage />` needs to draw the portfolio
 * table, the people breakdown, the 30-day trend chart, and the alert
 * panels.  Aggregation lives in SQL so the worker never has to walk the
 * whole task tree row-by-row.
 *
 * Visibility:
 *   - Mounted under the global `/api` auth middleware, so the caller is
 *     always authenticated.
 *   - Clients (UserRole='client') are deliberately blocked: they only get
 *     to see their own project, never the company-wide picture.
 *   - All other staff (admin / engineer / architect / senior) get the
 *     same payload — this is intended as an "everyone-sees-everything"
 *     status surface, not a permission-segmented one.
 */
import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { withEdgeCache } from '../lib/edgeCache';
import { isTeamsView, primaryTeamCodeSql } from '../lib/teamsPageDisplay';
import { todayInUB } from '../lib/time';
import { buildCompanyCharts } from '../lib/companyTimeseries';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';
import { hideArchivedSql, seesArchivedProjects } from '../lib/archivedProjects';
import { attendanceRosterSql } from '../lib/attendanceRoster';
import { latestApprovedPctByCreatedAt, projectLastActivitySql } from '../lib/progressLatest';
import { projectProgressSql } from '../lib/repairProgress';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---- date-scoped panels shared by /overview and /day-snapshot ----
//
// The "Өнөөдрийн идэвхтэй төслүүд" + "Өнөөдрийн ирц" cards on the company
// dashboard can be navigated backwards in time, so the two queries that
// feed them live in helpers callable for any date.  /overview wires them
// against today; /day-snapshot lets the frontend pass an arbitrary date.

type ActiveEmployee = {
  user_id: number;
  full_name: string;
  profile_image: string | null;
  team_codes: string[];
};
type ActiveProjectRow = {
  /** `projects.id`; засварын төсөл (0324) бол СӨРӨГ `-repair_projects.id`
   *  ба `kind = 'repair'` — `/app/projects/:id` руу холбохгүй. */
  project_id: number;
  project_name: string;
  kind: 'project' | 'repair';
  employee_count: number;
  employees: ActiveEmployee[];
  teams: Array<{ code: string; count: number }>;
};

export async function queryAttendanceForDate(
  db: D1Database,
  date: string,
): Promise<{ present: number; total: number; percentage: number }> {
  // `total` is the *current* active-staff headcount, not "active on that
  // historical date" — matches the original /overview behavior, where a
  // person who joined yesterday will still appear in yesterday's
  // denominator.  Keep that intentional so the percentage stays
  // comparable across snapshots.
  const row = await db
    .prepare(
      `
    SELECT
      (SELECT COUNT(DISTINCT a.user_id)
         FROM attendance_sessions a
         JOIN users u ON u.id = a.user_id
         WHERE a.date = ? AND ${attendanceRosterSql('u')}) AS present,
      (SELECT COUNT(*)
         FROM users u
         WHERE ${attendanceRosterSql('u')}) AS total
  `,
    )
    .bind(date)
    .first<{ present: number; total: number }>();
  const present = row?.present ?? 0;
  const total = row?.total ?? 0;
  return {
    present,
    total,
    percentage: total ? Math.round((present / total) * 100) : 0,
  };
}

/**
 * @param opts.includeRepairs — ирцээр сонгосон ЗАСВАРЫН төслүүдийг (0324)
 *   `-repair_project_id` id-тай, `kind='repair'` мөрөөр хамт буцаана.  Асаадаг
 *   цорын ганц дуудагч нь Багууд хуудасны «Өнөөдөр» таб байсан
 *   (`/day-snapshot?include_repairs=1`) — тэр таб 2026-09-24-нд хасагдсан.
 *   Параметр ЗОРИУД үлдсэн: deploy-ийн үед, мөн service worker-т кэшлэгдсэн
 *   хуучин frontend bundle-ууд тэр табаараа дуудсаар байж болно.
 *   компанийн тойм / TV / MCP нь `projects`-ийн мөрийг л хардаг хэвээр.
 * @param opts.teamsView — Багууд хуудасны ХАРАГДАЦЫН багийн шилжүүлэг
 *   (`lib/teamsPageDisplay.ts`): `team_codes` нь жагсаалтад байгаа хүнд өөр
 *   баг өгнө.  `?teams_view=1` — мөн л хасагдсан «Өнөөдөр» табынх, дээрх
 *   шалтгаанаар үлдсэн.
 */
export async function queryActiveProjectsForDate(
  db: D1Database,
  date: string,
  opts: { includeRepairs?: boolean; teamsView?: boolean } = {},
): Promise<ActiveProjectRow[]> {
  const teamCode = (fallback: string) =>
    primaryTeamCodeSql('u.id', fallback, { teamsView: opts.teamsView === true });
  const repairUnion = opts.includeRepairs
    ? `
    UNION ALL
    SELECT -dar.repair_project_id AS project_id,
           rp.name       AS project_name,
           'repair'      AS kind,
           u.id          AS user_id,
           u.full_name,
           u.profile_image,
           ${teamCode(`(SELECT tm.code
            FROM user_teams ut
            JOIN teams tm ON tm.id = ut.team_id
            WHERE ut.user_id = u.id
            ORDER BY ut.is_primary DESC, tm.sort_order, tm.id
            LIMIT 1)`)} AS team_codes
    FROM daily_active_repairs dar
    JOIN repair_projects rp ON rp.id = dar.repair_project_id
    JOIN users u ON u.id = dar.user_id
    WHERE dar.date = ?
      AND u.status = 'active'`
    : '';
  const res = await db
    .prepare(
      `
    SELECT * FROM (
    SELECT dap.project_id,
           p.name        AS project_name,
           'project'     AS kind,
           u.id          AS user_id,
           u.full_name,
           u.profile_image,
           -- The user's MAIN (primary) team code only.  An employee can be
           -- in up to 3 teams, but stats count them once under their main
           -- team so per-project team badges sum to the headcount instead of
           -- inflating it.  is_primary DESC picks the primary; the sort_order
           -- tie-break is the fallback for legacy rows with no primary set.
           ${teamCode(`(SELECT tm.code
            FROM user_teams ut
            JOIN teams tm ON tm.id = ut.team_id
            WHERE ut.user_id = u.id
            ORDER BY ut.is_primary DESC, tm.sort_order, tm.id
            LIMIT 1)`)} AS team_codes
    FROM daily_active_projects dap
    JOIN projects p ON p.id = dap.project_id
    JOIN users    u ON u.id = dap.user_id
    WHERE dap.date = ?
      AND u.status = 'active'
    ${repairUnion}
    )
    ORDER BY project_name, full_name
  `,
    )
    .bind(...(opts.includeRepairs ? [date, date] : [date]))
    .all<{
      project_id: number;
      project_name: string;
      kind: 'project' | 'repair';
      user_id: number;
      full_name: string;
      profile_image: string | null;
      team_codes: string | null;
    }>();

  const map = new Map<
    number,
    {
      project_id: number;
      project_name: string;
      kind: 'project' | 'repair';
      employees: ActiveEmployee[];
      teamCounts: Map<string, number>;
    }
  >();
  for (const r of res.results ?? []) {
    const cur = map.get(r.project_id) ?? {
      project_id: r.project_id,
      project_name: r.project_name,
      kind: r.kind,
      employees: [] as ActiveEmployee[],
      teamCounts: new Map<string, number>(),
    };
    const teamCodes = (r.team_codes ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is string => Boolean(s));
    cur.employees.push({
      user_id: r.user_id,
      full_name: r.full_name,
      profile_image: r.profile_image,
      team_codes: teamCodes,
    });
    for (const code of teamCodes) {
      cur.teamCounts.set(code, (cur.teamCounts.get(code) ?? 0) + 1);
    }
    map.set(r.project_id, cur);
  }
  return Array.from(map.values())
    .map((p) => ({
      project_id: p.project_id,
      project_name: p.project_name,
      kind: p.kind,
      employee_count: p.employees.length,
      employees: p.employees,
      teams: Array.from(p.teamCounts.entries())
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    }))
    .sort(
      (a, b) => b.employee_count - a.employee_count || a.project_name.localeCompare(b.project_name),
    );
}

router.get('/overview', async (c) => {
  const viewer = c.get('user');
  if (viewer.role === 'client') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // The dashboard updates as people punch in/out and as task progress
  // changes throughout the day, so a tight TTL keeps it fresh while
  // still absorbing the bursty refreshes managers do when they sit
  // staring at the page.  Variant key: админ ба бусад ажилтан хоёр ӨӨР
  // payload авна — архивласан төсөл жагсаалтад зөвхөн админд гарна
  // (2026-09-28, `lib/archivedProjects.ts`).
  const seesArchived = seesArchivedProjects(viewer.role);
  return withEdgeCache(
    c,
    {
      key: 'company:overview',
      varyTags: [seesArchived ? 'staff-archived' : 'staff'],
      ttlSeconds: 120,
    },
    async () => {
      // We deliberately keep the result lists bounded — the dashboard cards
      // never need more than the top N rows.  Going beyond just makes the
      // payload heavier without changing the visualisation.
      const PORTFOLIO_LIMIT = 50;
      const OVERDUE_LIMIT = 20;
      const STALE_CHATS_LIMIT = 15;
      // A project counts as "progress-stale" when its most recent progress
      // entry (any status) is older than this many days — the signal behind
      // the "төсөлд N хоног прогресс ороогүй" ticker reminder.
      const STALE_PROGRESS_DAYS = 3;
      const STALE_PROGRESS_LIMIT = 15;

      // ⚠ UB огноогоор — UTC-гээр БИШ.  Улаанбаатар UTC+8 тул шөнө дунджаас
      // өглөөний 08:00 хүртэл `toISOString()` нь ӨЧИГДРИЙН огноог өгдөг байсан
      // бөгөөд лоббиийн самбар өдрийн эхэнд өчигдрийн ирцийг харуулдаг байв.
      // Ирцийн бусад бүх гадаргуу `todayInUB()` ашигладаг.
      const today = todayInUB();

      // Run every aggregate in parallel.  D1 batches each prepare into its
      // own round trip but `Promise.all` makes them concurrent on the wire.
      const [
        totalsRow,
        projectsRes,
        rolesRes,
        teamsRes,
        attendanceToday,
        activeProjectsToday,
        dailyProgressRes,
        overdueRes,
        overdueProjectsRes,
        staleChatsRes,
        staleProgressRes,
      ] = await Promise.all([
        // ---- top-line counters ----
        c.env.DB.prepare(
          `
      SELECT
        (SELECT COUNT(*) FROM projects p WHERE ${NOT_ASR_ONLY_SQL})              AS projects_total,
        -- ⚠ Гэрээ хэлэлцээрийн шатанд яваа төслийг «идэвхтэй»-д ТООЛОХГҮЙ:
        -- гэрээ байгуулагдаагүй ажлыг гүйцэтгэлийн үзүүлэлтэд оруулах нь
        -- тоог гуйвуулна (migration 0143).  Нийт тоонд харин ордог —
        -- тэдгээр нь мөн л бүртгэлтэй төсөл.  ЗХ-ийн төсөл (asr_only)
        -- аль алинд нь ордоггүй.
        (SELECT COUNT(*) FROM projects p
          WHERE p.status = 'active' AND COALESCE(p.is_pending, 0) = 0
            AND ${NOT_ASR_ONLY_SQL})                                             AS projects_active,
        (SELECT COUNT(*) FROM projects p
          WHERE COALESCE(p.is_pending, 0) = 1 AND ${NOT_ASR_ONLY_SQL})           AS projects_pending,
        (SELECT COUNT(*) FROM projects p
          WHERE p.status = 'completed' AND ${NOT_ASR_ONLY_SQL})                  AS projects_completed,
        (SELECT COUNT(*) FROM users WHERE status = 'active')                     AS users_active,
        (SELECT COUNT(*) FROM users)                                             AS users_total,
        (SELECT COUNT(*) FROM blocks)                                            AS blocks_total,
        (SELECT COUNT(*) FROM drawings)                                          AS drawings_total,
        (SELECT COUNT(*) FROM components)                                        AS components_total,
        (SELECT COUNT(*) FROM tasks)                                             AS tasks_total,
        (SELECT COUNT(*) FROM tasks WHERE due_date IS NOT NULL AND due_date < ?) AS tasks_overdue_raw
    `,
        )
          .bind(today)
          .first<{
            projects_total: number;
            projects_active: number;
            projects_completed: number;
            users_active: number;
            users_total: number;
            blocks_total: number;
            drawings_total: number;
            components_total: number;
            tasks_total: number;
            tasks_overdue_raw: number;
          }>(),

        // ---- per-project portfolio with progress ----
        // Same CTE pattern used by /projects but trimmed to the columns the
        // dashboard renders.  A task is "completed" when its latest approved
        // progress entry is at 100%.
        c.env.DB.prepare(
          `
      WITH
      -- ⚠️ 2026-09-11 (D1 rows_read аудит): энэ query ТВ самбараас минут тутам
      --    татагддаг бөгөөд 285 735 мөр уншдаг байв.  Таскийн модыг ГУРВАН удаа
      --    (task_facts, draw_prog, drawing_task_progress) алхаж, мөр бүрд
      --    сүүлийн явцын дэд асуулгыг гүйцэтгэдэг байсныг НЭГ MATERIALIZED
      --    task_facts болгож, бусад нь түүнээс уншина.  Rollup-ын математик
      --    (PROJECT_LIST_SQL-тэй ижил) ХЭВЭЭР.
      task_facts AS MATERIALIZED (
        SELECT t.id AS task_id, t.due_date, t.weight_percent,
               d.id AS drawing_id, b.project_id,
               b.weight_percent AS block_weight, d.weight_percent AS d_weight,
               COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS pct
        FROM blocks b
        CROSS JOIN drawings   d ON d.block_id = b.id
        CROSS JOIN components c ON c.drawing_id = d.id
        CROSS JOIN tasks      t ON t.component_id = c.id),
      -- Hierarchical project progress — must match PROJECT_LIST_SQL in
      -- routes/projects.ts.  Түвшин бүр ЗАРЛАСАН төсвөөр хуваана: зураг нь
      -- d.weight_percent-ээр, дээших нь 100-аар.  Жингийн нийлбэр 100 болоогүй
      -- бол дутуу нь бүртгэгдээгүй буюу хийгдээгүй ажил гэж тоологдоно.
      draw_prog AS (
        SELECT d.id, d.block_id, d.weight_percent,
               COALESCE(
                 SUM(tf.weight_percent * tf.pct)
                   / NULLIF(d.weight_percent, 0),
                 0
               ) AS progress
        FROM drawings d
        LEFT JOIN task_facts tf ON tf.drawing_id = d.id
        GROUP BY d.id, d.block_id, d.weight_percent
      ),
      block_prog AS (
        SELECT b.id, b.project_id, b.team_id, b.weight_percent,
               COALESCE(SUM(dp.weight_percent * dp.progress), 0) / 100.0 AS progress
        FROM blocks b
        LEFT JOIN draw_prog dp ON dp.block_id = b.id
        GROUP BY b.id, b.project_id, b.team_id, b.weight_percent
      ),
      team_prog AS (
        SELECT project_id, team_id,
               COALESCE(SUM(weight_percent * progress), 0) / 100.0 AS progress
        FROM block_prog
        GROUP BY project_id, team_id
      ),
      proj_progress AS (
        SELECT pts.project_id,
               ROUND(COALESCE(
                 SUM(pts.share_percent * COALESCE(tmp.progress, 0)),
               0) / 100.0, 2) AS progress
        FROM project_team_shares pts
        LEFT JOIN team_prog tmp
          ON tmp.project_id = pts.project_id AND tmp.team_id = pts.team_id
        GROUP BY pts.project_id
      ),
      proj_counts AS (
        SELECT
          p.id AS project_id,
          COUNT(tf.task_id)                                                 AS task_count,
          SUM(CASE WHEN tf.pct >= 100 THEN 1 ELSE 0 END)                    AS completed_tasks,
          SUM(CASE WHEN tf.due_date IS NOT NULL AND tf.due_date < ?
                    AND tf.pct < 100 THEN 1 ELSE 0 END)                     AS overdue_tasks,
          MAX(tf.due_date)                                                  AS last_due_date
        FROM projects p
        LEFT JOIN task_facts tf ON tf.project_id = p.id
        GROUP BY p.id),
      -- Per-team progress per project — same shape as the /projects card
      -- so the dashboard row can render compact team chips. Drawings are
      -- mapped to teams by NAME prefix (e.g. "BA - Барилга архитектур" →
      -- team code BA), mirroring PROJECT_LIST_SQL.team_progress in
      -- routes/projects.ts. Unknown prefixes simply fail to join and
      -- drop out of the rollup.
      drawing_team AS (
        SELECT d.id AS drawing_id,
               b.project_id,
               b.weight_percent AS block_weight,
               tm.id AS team_id
        FROM drawings d
        INNER JOIN blocks b ON b.id = d.block_id
        INNER JOIN teams tm ON tm.code = UPPER(TRIM(
          CASE
            WHEN INSTR(d.name, ' ') > 0 AND (INSTR(d.name, '-') = 0 OR INSTR(d.name, ' ') < INSTR(d.name, '-'))
              THEN SUBSTR(d.name, 1, INSTR(d.name, ' ') - 1)
            WHEN INSTR(d.name, '-') > 0
              THEN SUBSTR(d.name, 1, INSTR(d.name, '-') - 1)
            ELSE d.name
          END
        ))
      ),
      drawing_task_progress AS (
        SELECT dt.project_id,
               dt.team_id,
               tf.task_id,
               dt.block_weight,
               tf.weight_percent,
               tf.pct AS progress
        FROM drawing_team dt
        INNER JOIN task_facts tf ON tf.drawing_id = dt.drawing_id
      ),
      team_task_progress AS (
        SELECT project_id,
               team_id,
               ROUND(AVG(progress), 2) AS progress,
               ROUND(SUM(block_weight * weight_percent / 100.0), 2) AS share_percent,
               COUNT(DISTINCT task_id) AS task_count
        FROM drawing_task_progress
        GROUP BY project_id, team_id
      ),
      team_keys AS (
        SELECT project_id, team_id FROM project_team_shares
        UNION
        SELECT project_id, team_id FROM drawing_team
      ),
      -- Гишүүдийн тоо — НЭГ удаа (өмнө нь төсөл бүрд корреляцтай дэд асуулга).
      member_count AS (
        SELECT project_id, COUNT(*) AS cnt
        FROM (
          SELECT pm.project_id, pm.user_id
          FROM project_members pm
          INNER JOIN users pu ON pu.id = pm.user_id AND pu.role <> 'client'
          UNION
          SELECT tf.project_id, ta.user_id
          FROM task_assignees ta
          INNER JOIN task_facts tf ON tf.task_id = ta.task_id
        )
        GROUP BY project_id
      ),
      team_progress AS (
        SELECT project_id,
               json_group_array(
                 json_object(
                   'team_id',      team_id,
                   'team_code',    team_code,
                   'team_name_mn', team_name_mn,
                   'progress',     progress,
                   'share_percent', share_percent,
                   'task_count',   task_count
                 )
               ) AS team_progress_json
        FROM (
          SELECT tk.project_id,
                 tm.id AS team_id,
                 tm.code AS team_code,
                 tm.name_mn AS team_name_mn,
                 COALESCE(ttp.progress, 0) AS progress,
                 COALESCE(ttp.share_percent, 0) AS share_percent,
                 COALESCE(ttp.task_count, 0) AS task_count
          FROM team_keys tk
          INNER JOIN teams tm ON tm.id = tk.team_id
          LEFT JOIN project_team_shares pts
            ON pts.project_id = tk.project_id AND pts.team_id = tk.team_id
          LEFT JOIN team_task_progress ttp
            ON ttp.project_id = tk.project_id AND ttp.team_id = tk.team_id
          ORDER BY COALESCE(pts.sort_order, 999999), tm.sort_order, tm.code
        )
        GROUP BY project_id
      )
      SELECT
        p.id, p.name, p.status, p.location, p.category, p.created_at, p.updated_at,
        pp.passport_finish AS finish_date,
        pp.passport_start  AS start_date,
        -- 'hours' горим (0339) → цагийн бүртгэлээс; PROJECT_LIST_SQL-тэй ижил дүрэм.
        ROUND(${projectProgressSql('p', 'prog.progress')}, 2) AS progress,
        cnt.task_count, cnt.completed_tasks, cnt.overdue_tasks,
        cnt.last_due_date,
        COALESCE(tp.team_progress_json, '[]') AS team_progress_json,
        -- Members = explicitly-added (project_members) OR anyone assigned to
        -- a task under the project's blocks, deduped.  Mirrors member_count in
        -- PROJECT_LIST_SQL (routes/projects.ts) so the two surfaces agree.
        COALESCE(mc.cnt, 0) AS member_count
      FROM projects p
      LEFT JOIN member_count mc ON mc.project_id = p.id
      LEFT JOIN proj_progress prog ON prog.project_id = p.id
      LEFT JOIN proj_counts   cnt  ON cnt.project_id  = p.id
      LEFT JOIN team_progress tp   ON tp.project_id   = p.id
      LEFT JOIN (
        SELECT project_id,
               finish_date AS passport_finish,
               start_date  AS passport_start
        FROM project_passport
      ) pp ON pp.project_id = p.id
      WHERE ${NOT_ASR_ONLY_SQL}${hideArchivedSql(viewer.role)}
      ORDER BY (p.status = 'active') DESC,
               COALESCE(${projectProgressSql('p', 'prog.progress')}, 0) DESC,
               p.created_at DESC
      LIMIT ?
    `,
        )
          .bind(today, PORTFOLIO_LIMIT)
          .all<{
            id: number;
            name: string;
            status: string | null;
            location: string | null;
            category: string | null;
            created_at: string;
            updated_at: string;
            finish_date: string | null;
            start_date: string | null;
            progress: number | null;
            task_count: number | null;
            completed_tasks: number | null;
            overdue_tasks: number | null;
            last_due_date: string | null;
            team_progress_json: string | null;
            member_count: number;
          }>(),

        // ---- people: by role ----
        c.env.DB.prepare(
          `
      SELECT role, COUNT(*) AS count
      FROM users WHERE status = 'active'
      GROUP BY role
      ORDER BY count DESC
    `,
        ).all<{ role: string; count: number }>(),

        // ---- people: by team (with avg per-team progress across all tasks) ----
        c.env.DB.prepare(
          `
      WITH
      -- 2026-09-11: хариуцлага бүрд сүүлийн явцыг НЭГ удаа (MATERIALIZED —
      -- user_teams-тэй нэгдэхэд дэд асуулга багийн тоогоор давтагдахгүй).
      assigned AS MATERIALIZED (
        SELECT ta.task_id, ta.user_id,
               COALESCE(${latestApprovedPctByCreatedAt('ta.task_id')}, 0) AS pct
        FROM task_assignees ta),
      assignee_progress AS (
        SELECT ut.team_id, AVG(a.pct) AS avg_progress
        FROM assigned a
        JOIN user_teams ut ON ut.user_id = a.user_id
        GROUP BY ut.team_id),
      -- Each user resolved to exactly ONE team — their main (primary) team —
      -- so member_count below counts every employee once instead of once per
      -- team they belong to.  The ORDER BY mirrors the team_codes fallback in
      -- queryActiveProjectsForDate so both stats define "main team" the same.
      primary_team AS (
        SELECT user_id, team_id FROM (
          SELECT ut.user_id, ut.team_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY ut.user_id
                   ORDER BY ut.is_primary DESC, t.sort_order, t.id
                 ) AS rn
          FROM user_teams ut
          JOIN teams t ON t.id = ut.team_id
        ) WHERE rn = 1)
      SELECT t.id AS team_id, t.code, t.name_mn,
             COUNT(DISTINCT u.id) AS member_count,
             ROUND(COALESCE(ap.avg_progress, 0), 1) AS avg_progress
      FROM teams t
      LEFT JOIN primary_team pt ON pt.team_id = t.id
      LEFT JOIN users u ON u.id = pt.user_id AND u.status = 'active'
      LEFT JOIN assignee_progress ap ON ap.team_id = t.id
      GROUP BY t.id, t.code, t.name_mn
      ORDER BY t.sort_order, t.id
    `,
        ).all<{
          team_id: number;
          code: string;
          name_mn: string;
          member_count: number;
          avg_progress: number;
        }>(),

        // ---- attendance for today (helper, shared with /day-snapshot) ----
        queryAttendanceForDate(c.env.DB, today),

        // ---- active projects today (helper, shared with /day-snapshot) ----
        queryActiveProjectsForDate(c.env.DB, today),

        // ---- 30-day trend: progress entries per day ----
        // We aggregate by `date` (the work-date the engineer logged for, NOT
        // when they submitted) so weekend backfills end up on the correct
        // bar.  Empty days will be filled in on the frontend so the chart
        // line is continuous instead of having gaps.
        c.env.DB.prepare(
          `
      SELECT date,
             COUNT(*) AS entry_count,
             COUNT(DISTINCT user_id) AS contributor_count,
             ROUND(AVG(percentage), 1) AS avg_percentage
      FROM progress_entries
      WHERE date >= date('now', '-29 days') AND COALESCE(source, '') <> 'alloc_adj'
      GROUP BY date
      ORDER BY date
    `,
        ).all<{
          date: string;
          entry_count: number;
          contributor_count: number;
          avg_percentage: number;
        }>(),

        // ---- alerts: overdue tasks (top N) ----
        c.env.DB.prepare(
          `
      WITH
      latest_task AS (
        -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
        SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
        FROM tasks t
      )
      SELECT t.id AS task_id, t.name AS task_name, t.due_date,
             COALESCE(lt.percentage, 0) AS progress,
             d.name AS drawing_name, b.name AS block_name,
             p.id AS project_id, p.name AS project_name,
             -- 2026-10-01: байнгын хариуцагч байхгүй (0369) — ОДОО ажиллаж буй хүн,
             -- үгүй бол сүүлд ажилласан хүн (task_assignees = ажилласан хүмүүсийн бүртгэл).
             COALESCE(
               (SELECT uw.full_name FROM task_timer_sessions s
                  JOIN users uw ON uw.id = s.user_id
                 WHERE s.task_id = t.id AND s.ended_at IS NULL
                 ORDER BY s.started_at LIMIT 1),
               (SELECT uc.full_name FROM task_assignees ta
                  JOIN users uc ON uc.id = ta.user_id
                 WHERE ta.task_id = t.id
                 ORDER BY ta.created_at DESC LIMIT 1)) AS assignee_name,
             CAST(julianday(?) - julianday(t.due_date) AS INTEGER) AS days_overdue
      FROM tasks t
      JOIN components c ON c.id = t.component_id
      JOIN drawings   d ON d.id = c.drawing_id
      JOIN blocks     b ON b.id = d.block_id
      JOIN projects   p ON p.id = b.project_id
      LEFT JOIN latest_task lt ON lt.task_id = t.id
      WHERE t.due_date IS NOT NULL
        AND t.due_date < ?
        AND COALESCE(lt.percentage, 0) < 100
        AND p.status = 'active'
        -- Гэрээ хэлэлцээрийн шатанд яваа төслийн хугацаа нь албан ёсны
        -- амлалт биш тул «хугацаа хэтэрсэн» жагсаалтад оруулахгүй.
        AND COALESCE(p.is_pending, 0) = 0
      ORDER BY t.due_date ASC
      LIMIT ?
    `,
        )
          .bind(today, today, OVERDUE_LIMIT)
          .all<{
            task_id: number;
            task_name: string;
            due_date: string;
            progress: number;
            drawing_name: string;
            block_name: string;
            project_id: number;
            project_name: string;
            assignee_name: string | null;
            days_overdue: number;
          }>(),

        // ---- alerts: overdue projects (passport finish date) ----
        // Portfolio rows can be overdue because the project passport's finish
        // date has passed even when no individual task due_date is overdue.
        // Surface those project-level deadlines in the same alert section as
        // overdue tasks so the dashboard does not contradict itself.
        c.env.DB.prepare(
          `
      WITH
      -- 2026-09-11: эхлээд НЭР ДЭВШИГЧ төслүүдийг (хугацаа хэтэрсэн, идэвхтэй)
      -- шүүж, ЗӨВХӨН тэдний таскийг алхана — өмнө нь 24 төслийн 4 345 таскийг
      -- бүгдийг нь тооцоод 3 мөр буцаадаг байв (33 764 мөр уншилт).
      candidates AS (
        SELECT p.id AS project_id, p.name AS project_name, pp.finish_date
        FROM projects p
        JOIN project_passport pp ON pp.project_id = p.id
        WHERE pp.finish_date IS NOT NULL
          AND pp.finish_date < ?2
          AND p.status = 'active'
          AND ${NOT_ASR_ONLY_SQL}),
      task_facts AS (
        SELECT b.project_id, t.weight_percent,
               COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS pct
        FROM candidates cp
        CROSS JOIN blocks     b ON b.project_id = cp.project_id
        CROSS JOIN drawings   d ON d.block_id = b.id
        CROSS JOIN components c ON c.drawing_id = d.id
        CROSS JOIN tasks      t ON t.component_id = c.id),
      proj_progress AS (
        SELECT
          project_id,
          ROUND(COALESCE(SUM(weight_percent * pct / 100.0)
                          / NULLIF(SUM(weight_percent), 0), 0), 2) AS progress
        FROM task_facts
        GROUP BY project_id)
      SELECT cp.project_id,
             cp.project_name,
             cp.finish_date AS due_date,
             COALESCE(prog.progress, 0) AS progress,
             CAST(julianday(?1) - julianday(cp.finish_date) AS INTEGER) AS days_overdue
      FROM candidates cp
      LEFT JOIN proj_progress prog ON prog.project_id = cp.project_id
      WHERE COALESCE(prog.progress, 0) < 100
      ORDER BY cp.finish_date ASC
      LIMIT ?3
    `,
        )
          .bind(today, today, OVERDUE_LIMIT)
          .all<{
            project_id: number;
            project_name: string;
            due_date: string;
            progress: number;
            days_overdue: number;
          }>(),

        // ---- alerts: stale chat threads ----
        // A thread is "stale" when its last message arrived more than 7 days
        // ago and the project is still active.  Threads that have never seen
        // a message are skipped — there's nothing to follow up on.
        c.env.DB.prepare(
          `
      SELECT pt.id AS thread_id, pt.team_code, pt.last_msg_at,
             p.id AS project_id, p.name AS project_name,
             CAST(julianday('now') - julianday(pt.last_msg_at) AS INTEGER) AS days_stale
      FROM project_threads pt
      JOIN projects p ON p.id = pt.project_id
      WHERE pt.last_msg_at IS NOT NULL
        AND p.status = 'active'
        AND julianday('now') - julianday(pt.last_msg_at) >= 7
      ORDER BY pt.last_msg_at ASC
      LIMIT ?
    `,
        )
          .bind(STALE_CHATS_LIMIT)
          .all<{
            thread_id: number;
            team_code: string;
            last_msg_at: string;
            project_id: number;
            project_name: string;
            days_stale: number;
          }>(),

        // ---- alerts: progress-stale projects ----
        // Active projects that HAVE tasks set up but whose most recent
        // progress entry (any status) is older than STALE_PROGRESS_DAYS — or
        // that have never had one.  This is the true "төсөлд N хоног прогресс
        // ороогүй" signal (last progress-entry time), distinct from the
        // chat-thread staleness above.  `days_stale` is NULL when the project
        // has tasks but no progress entry has ever been logged.
        c.env.DB.prepare(
          `
      WITH last_prog AS (
        -- 2026-09-11: 48 500 → ~10 000 мөр (lib/progressLatest.ts); БҮХ статус хэвээр.
        SELECT project_id, last_activity_at AS last_at FROM (${projectLastActivitySql(false)})
      )
      SELECT p.id AS project_id,
             p.name AS project_name,
             lp.last_at AS last_progress_at,
             CASE WHEN lp.last_at IS NULL THEN NULL
                  ELSE CAST(julianday('now') - julianday(lp.last_at) AS INTEGER) END AS days_stale
      FROM projects p
      LEFT JOIN last_prog lp ON lp.project_id = p.id
      WHERE p.status = 'active'
        AND ${NOT_ASR_ONLY_SQL}
        AND (lp.last_at IS NULL OR julianday('now') - julianday(lp.last_at) >= ?)
        AND EXISTS (
          SELECT 1 FROM blocks b2
          JOIN drawings d2   ON d2.block_id = b2.id
          JOIN components c2 ON c2.drawing_id = d2.id
          JOIN tasks t2      ON t2.component_id = c2.id
          WHERE b2.project_id = p.id
        )
      ORDER BY (lp.last_at IS NULL) DESC, lp.last_at ASC
      LIMIT ?
    `,
        )
          .bind(STALE_PROGRESS_DAYS, STALE_PROGRESS_LIMIT)
          .all<{
            project_id: number;
            project_name: string;
            last_progress_at: string | null;
            days_stale: number | null;
          }>(),
      ]);

      // Build a continuous 30-day series so the trend chart never has gaps.
      // We zip the SQL results onto a date axis built in JS rather than
      // generating dates in SQL (D1 doesn't have a recursive CTE primitive
      // we want to depend on for something this simple).
      const dailySeries: Array<{
        date: string;
        entry_count: number;
        contributor_count: number;
        avg_percentage: number;
      }> = [];
      const byDate = new Map((dailyProgressRes.results ?? []).map((r) => [r.date, r]));
      const cursor = new Date();
      cursor.setHours(0, 0, 0, 0);
      cursor.setDate(cursor.getDate() - 29);
      for (let i = 0; i < 30; i++) {
        const iso = cursor.toISOString().slice(0, 10);
        const row = byDate.get(iso);
        dailySeries.push({
          date: iso,
          entry_count: row?.entry_count ?? 0,
          contributor_count: row?.contributor_count ?? 0,
          avg_percentage: row?.avg_percentage ?? 0,
        });
        cursor.setDate(cursor.getDate() + 1);
      }

      // Roll up the per-day entries into ISO weeks for the secondary chart.
      const weekly = new Map<string, number>();
      for (const d of dailySeries) {
        const dt = new Date(d.date);
        // Use Monday-anchored weeks (ISO 8601).  getDay returns 0=Sun.
        const dayOfWeek = (dt.getDay() + 6) % 7;
        dt.setDate(dt.getDate() - dayOfWeek);
        const key = dt.toISOString().slice(0, 10);
        weekly.set(key, (weekly.get(key) ?? 0) + d.entry_count);
      }
      const weeklySeries = Array.from(weekly.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week_start, entries]) => ({ week_start, entries }));

      return {
        generated_at: new Date().toISOString(),
        totals: {
          projects_total: totalsRow?.projects_total ?? 0,
          projects_active: totalsRow?.projects_active ?? 0,
          projects_completed: totalsRow?.projects_completed ?? 0,
          users_active: totalsRow?.users_active ?? 0,
          users_total: totalsRow?.users_total ?? 0,
          blocks_total: totalsRow?.blocks_total ?? 0,
          drawings_total: totalsRow?.drawings_total ?? 0,
          components_total: totalsRow?.components_total ?? 0,
          tasks_total: totalsRow?.tasks_total ?? 0,
          tasks_overdue: totalsRow?.tasks_overdue_raw ?? 0,
        },
        portfolio: (projectsRes.results ?? []).map((p) => {
          const due = p.finish_date ?? p.last_due_date ?? null;
          let days_left: number | null = null;
          if (due) {
            const diff = (new Date(due).getTime() - new Date(today).getTime()) / 86400000;
            days_left = Math.round(diff);
          }
          // Decode the per-project team_progress JSON aggregate. Mirrors the
          // shape used by GET /api/projects so the dashboard row can render
          // the same compact team chips as the Projects card.
          let team_progress: Array<{
            team_id: number;
            team_code: string;
            team_name_mn: string;
            progress: number;
            task_count: number;
          }> = [];
          if (typeof p.team_progress_json === 'string') {
            try {
              const parsed = JSON.parse(p.team_progress_json);
              if (Array.isArray(parsed)) team_progress = parsed;
            } catch {
              team_progress = [];
            }
          }
          return {
            id: p.id,
            name: p.name,
            status: p.status,
            location: p.location,
            category: p.category,
            progress: p.progress ?? 0,
            member_count: p.member_count,
            task_count: p.task_count ?? 0,
            completed_tasks: p.completed_tasks ?? 0,
            overdue_tasks: p.overdue_tasks ?? 0,
            start_date: p.start_date,
            finish_date: due,
            days_left,
            created_at: p.created_at,
            updated_at: p.updated_at,
            team_progress,
          };
        }),
        people: {
          by_role: rolesRes.results ?? [],
          by_team: teamsRes.results ?? [],
          attendance_today: attendanceToday,
          active_projects_today: activeProjectsToday,
        },
        trends: {
          daily: dailySeries,
          weekly: weeklySeries,
        },
        alerts: {
          overdue_tasks: overdueRes.results ?? [],
          overdue_projects: overdueProjectsRes.results ?? [],
          stale_chats: staleChatsRes.results ?? [],
          stale_progress: staleProgressRes.results ?? [],
        },
      };
    },
  );
});

// GET /api/company/charts/timeseries?days=7|30|90  (omit days = all)
//
// Company-wide TradingView-style series for the TV wallboard: the
// work-weighted company "index" candle source, a per-project watchlist,
// per-discipline "sector" lines, plus headcount/activity volume.  Heavy
// JS sweep over approved entries, so cache it like /overview.
router.get('/charts/timeseries', async (c) => {
  const viewer = c.get('user');
  if (viewer.role === 'client') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const daysRaw = c.req.query('days');
  let days: number | null = null;
  if (daysRaw !== undefined) {
    const parsed = parseInt(daysRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return c.json({ error: 'days must be a positive integer' }, 400);
    }
    days = Math.min(parsed, 3650);
  }

  return withEdgeCache(
    c,
    { key: 'company:charts', varyTags: ['staff', String(days ?? 'all')], ttlSeconds: 300 },
    async () => buildCompanyCharts(c.env.DB, days),
  );
});

// GET /api/company/day-snapshot?date=YYYY-MM-DD
//
// Date-scoped slice of /overview for the two "today" cards (attendance +
// active projects).  The rest of the dashboard (portfolio, trends, alerts)
// stays pinned to today via /overview — only this pair is navigable.
router.get('/day-snapshot', async (c) => {
  const viewer = c.get('user');
  if (viewer.role === 'client') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const date = c.req.query('date') ?? todayInUB();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date — expected YYYY-MM-DD' }, 400);
  }

  // Багууд → «Өнөөдөр» таб засварын төслийг (0324) хамт асуудаг; кэшийн
  // түлхүүрт ЗААВАЛ орно — эс тэгвэл нэг хариу нөгөө хуудсанд гарна.
  const includeRepairs = c.req.query('include_repairs') === '1';
  // `teams_view=1` — мөн Багууд хуудас л: харагдацын багийн шилжүүлэг
  // (lib/teamsPageDisplay.ts).  Самбар/TV хуучин хариугаа авна.
  const teamsView = isTeamsView(c.req.query('teams_view'));

  return withEdgeCache(
    c,
    {
      key: 'company:day-snapshot',
      varyTags: [
        'staff',
        date,
        includeRepairs ? 'repairs' : 'projects',
        teamsView ? 'teams-view' : 'plain',
      ],
      ttlSeconds: 30,
    },
    async () => {
      const [attendance, activeProjects] = await Promise.all([
        queryAttendanceForDate(c.env.DB, date),
        queryActiveProjectsForDate(c.env.DB, date, { includeRepairs, teamsView }),
      ]);
      return {
        date,
        attendance,
        active_projects: activeProjects,
      };
    },
  );
});

// GET /api/company/lifetime
//
// «Компанийн эрин» — TV самбарын нээлтийн scene-д зориулсан НАСАН ТУРШИЙН
// хуримтлагдсан тоонууд.  Эдгээр нь өдөр бүр бараг өөрчлөгддөггүй тул
// /overview-оос (30сек TTL) тусад нь, урт кэштэй байрлана.
//
// ⚠ «Хийсэн төсөл» гэдгийг `projects.status='completed'`-оор ТООЛОХГҮЙ:
// production-д тэр статусыг хэн ч тавьдаггүй тул үргэлж 0 гардаг (2026-08-19-нд
// баталгаажсан).  Оронд нь ЖИНЛЭСЭН явц 100% хүрсэн эсвэл статус нь completed
// төслийг «хүлээлгэн өгсөн» гэж үзнэ.  Жинлэлт нь PROJECT_LIST_SQL-тэй ижил
// (routes/projects.ts-ийн толгойн тайлбарыг үз) — түвшин бүр ЗАРЛАСАН төсвөөр
// хуваагдана.
router.get('/lifetime', async (c) => {
  const viewer = c.get('user');
  if (viewer.role === 'client') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return withEdgeCache(
    c,
    { key: 'company:lifetime', varyTags: ['staff'], ttlSeconds: 3600 },
    async () => {
      const [countsRow, hoursRow, deliveredRow] = await Promise.all([
        c.env.DB.prepare(
          `
      SELECT
        (SELECT COUNT(*) FROM projects p WHERE ${NOT_ASR_ONLY_SQL})            AS projects_total,
        (SELECT COUNT(*) FROM projects p
          WHERE p.status = 'active' AND COALESCE(p.is_pending, 0) = 0
            AND ${NOT_ASR_ONLY_SQL})                                           AS projects_active,
        (SELECT COUNT(*) FROM drawings)                                    AS drawings_total,
        (SELECT COUNT(*) FROM blocks)                                      AS blocks_total,
        (SELECT COUNT(*) FROM tasks)                                       AS tasks_total,
        (SELECT COUNT(*) FROM progress_entries WHERE COALESCE(source, '') <> 'alloc_adj') AS entries_total,
        (SELECT COUNT(*) FROM users
          WHERE status = 'active' AND role != 'client')                    AS people_active,
        (SELECT COUNT(*) FROM teams)                                       AS teams_total
    `,
        ).first<{
          projects_total: number;
          projects_active: number;
          drawings_total: number;
          blocks_total: number;
          tasks_total: number;
          entries_total: number;
          people_active: number;
          teams_total: number;
        }>(),

        // Нийт ажилласан цаг — CEO-гийн гол хүсэлт.  `hours_worked` нь зөвхөн
        // clock_out хийсэн session-д бөглөгддөг тул нээлттэй ээлж тоологдохгүй:
        // энэ нь зөв (дуусаагүй цагийг «ажилласан» гэж бичих ёсгүй).
        c.env.DB.prepare(
          `
      SELECT COALESCE(SUM(hours_worked), 0) AS hours_worked,
             COUNT(*)                       AS sessions,
             MIN(date)                      AS first_date,
             COUNT(DISTINCT user_id)        AS people_ever
        FROM attendance_sessions
       WHERE hours_worked IS NOT NULL
    `,
        ).first<{
          hours_worked: number;
          sessions: number;
          first_date: string | null;
          people_ever: number;
        }>(),

        // Хүлээлгэн өгсөн төсөл — жинлэсэн явц 100% (эсвэл статус completed).
        c.env.DB.prepare(
          `
      WITH
      latest_task AS (
        -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
        SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
        FROM tasks t
      ),
      draw_prog AS (
        SELECT d.id, d.block_id, d.weight_percent,
               COALESCE(
                 SUM(t.weight_percent * COALESCE(lt.percentage, 0))
                   / NULLIF(d.weight_percent, 0),
                 0
               ) AS progress
        FROM drawings d
        LEFT JOIN components c ON c.drawing_id = d.id
        LEFT JOIN tasks t ON t.component_id = c.id
        LEFT JOIN latest_task lt ON lt.task_id = t.id
        GROUP BY d.id, d.block_id, d.weight_percent),
      block_prog AS (
        SELECT b.id, b.project_id, b.team_id, b.weight_percent,
               COALESCE(SUM(dp.weight_percent * dp.progress), 0) / 100.0 AS progress
        FROM blocks b
        LEFT JOIN draw_prog dp ON dp.block_id = b.id
        GROUP BY b.id, b.project_id, b.team_id, b.weight_percent),
      team_prog AS (
        SELECT project_id, team_id,
               COALESCE(SUM(weight_percent * progress), 0) / 100.0 AS progress
        FROM block_prog
        GROUP BY project_id, team_id),
      proj_progress AS (
        SELECT pts.project_id,
               ROUND(COALESCE(
                 SUM(pts.share_percent * COALESCE(tmp.progress, 0)),
               0) / 100.0, 2) AS progress
        FROM project_team_shares pts
        LEFT JOIN team_prog tmp
          ON tmp.project_id = pts.project_id AND tmp.team_id = pts.team_id
        GROUP BY pts.project_id)
      SELECT COUNT(*) AS delivered
        FROM projects p
        LEFT JOIN proj_progress pp ON pp.project_id = p.id
       WHERE ${NOT_ASR_ONLY_SQL}
         AND (p.status = 'completed' OR COALESCE(${projectProgressSql('p', 'pp.progress')}, 0) >= 100)
    `,
        ).first<{ delivered: number }>(),
      ]);

      return {
        generated_at: new Date().toISOString(),
        /** Хамгийн эртний ирцийн бүртгэл — «... оноос хойш» гэсэн бичээсийн эх. */
        since: hoursRow?.first_date ?? null,
        hours_worked: Math.round(hoursRow?.hours_worked ?? 0),
        attendance_sessions: hoursRow?.sessions ?? 0,
        people_ever: hoursRow?.people_ever ?? 0,
        projects_total: countsRow?.projects_total ?? 0,
        projects_active: countsRow?.projects_active ?? 0,
        projects_delivered: deliveredRow?.delivered ?? 0,
        drawings_total: countsRow?.drawings_total ?? 0,
        blocks_total: countsRow?.blocks_total ?? 0,
        tasks_total: countsRow?.tasks_total ?? 0,
        entries_total: countsRow?.entries_total ?? 0,
        people_active: countsRow?.people_active ?? 0,
        teams_total: countsRow?.teams_total ?? 0,
      };
    },
  );
});

export default router;
