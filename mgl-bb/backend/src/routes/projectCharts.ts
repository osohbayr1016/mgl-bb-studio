/* =============================================================
 * Project charts — time-series data for the project-detail
 * "Графикууд" tab.
 * -------------------------------------------------------------
 * URL prefix: mounted at /api/projects, so the path here is
 * relative to /api/projects/:id/charts/...
 *
 * One endpoint returns three series in a single round-trip:
 *   • overall  — project-wide progress %, one line (bitcoin-style area)
 *   • teams    — per-discipline normalised progress, one line per team
 *   • activity — daily entry/contributor counts + average logged %
 *
 * Everything is reconstructed live from `progress_entries` by the
 * shared builders in lib/progressTimeseries — no snapshot table/cron.
 * ============================================================= */
import { Hono } from 'hono';
import { todayInUB } from '../lib/time';
import {
  snapshotProgressTimeseriesRanged,
  snapshotTeamProgressTimeseries,
  subDaysISO,
} from '../lib/progressTimeseries';
import type { Env, AppVariables } from '../types';
import { latestApprovedPctByDate } from '../lib/progressLatest';

const projectCharts = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* Membership gate — mirrors performanceReports.assertProjectVisible:
 * clients only see projects they belong to, staff see anything. */
async function assertProjectVisible(
  db: D1Database,
  projectId: number,
  userId: number,
  role: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const project = await db
    .prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number }>();
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  if (role === 'client') {
    const member = await db
      .prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first();
    if (!member) return { ok: false, status: 403, error: 'Access denied' };
  }
  return { ok: true };
}

interface ActivityPoint {
  date: string;
  entry_count: number;
  contributor_count: number;
  avg_percentage: number;
}

interface HeadcountPoint {
  date: string;
  count: number;
}

interface MilestoneRow {
  report_no: number;
  date: string;
}

interface TeamStatsRow {
  code: string;
  task_count: number;
  done_count: number;
  member_count: number;
  members: string | null; // comma-joined assignee names (GROUP_CONCAT)
}

/** Per-team, per-day worker name — used for the period-windowed watchlist
 *  count + the hover tooltip (split into progress-loggers vs attendance). */
interface TeamWorkerRow {
  team: string;
  date: string;
  name: string;
}

/* GET /:id/charts/timeseries?days=7|30|90
 * Omit `days` (or pass anything non-numeric) for the project's full
 * history. The overall/team curves auto-start at the first approved
 * entry; `days` clamps the window for the range toggle. */
projectCharts.get('/:id/charts/timeseries', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const user = c.get('user');
  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const daysParam = c.req.query('days');
  const days = daysParam && /^\d+$/.test(daysParam) ? parseInt(daysParam, 10) : null;

  const to = todayInUB();
  // Empty `from` lets the builders fall back to the earliest approved
  // entry (full history). A bounded range clamps to today-(days-1).
  const from = days ? subDaysISO(to, days - 1) : '';
  // Activity is a plain GROUP BY over `date`; '0001-01-01' = no lower bound.
  const activityFrom = days ? from : '0001-01-01';

  // Per-entry project-contribution weight = block-weight × team-share ×
  // task-weight (0 under a zero-weight drawing). Used to weight the daily
  // activity average so it reads "by the project's share" instead of a flat
  // per-task mean — a big task counts more than a tiny one.
  const projW =
    '(CASE WHEN d.weight_percent > 0 THEN b.weight_percent * COALESCE(pts.share_percent, 0) * t.weight_percent ELSE 0 END)';

  const [
    overall,
    teams,
    activityRes,
    headcountRes,
    milestoneRes,
    teamStatsRes,
    passportRow,
    overdueRow,
    backlogRow,
    progressPeopleRes,
    attendancePeopleRes,
    holidayRes,
  ] = await Promise.all([
    snapshotProgressTimeseriesRanged(c.env.DB, projectId, from, to),
    snapshotTeamProgressTimeseries(c.env.DB, projectId, from, to),
    c.env.DB.prepare(
      `
      SELECT pe.date AS date,
             COUNT(*) AS entry_count,
             COUNT(DISTINCT pe.user_id) AS contributor_count,
             ROUND(
               CASE WHEN SUM(${projW}) > 0
                 THEN SUM(${projW} * pe.percentage) / SUM(${projW})
                 ELSE AVG(pe.percentage)
               END, 1) AS avg_percentage
      FROM progress_entries pe
      INNER JOIN tasks t      ON t.id = pe.task_id
      INNER JOIN components c ON c.id = t.component_id
      INNER JOIN drawings d   ON d.id = c.drawing_id
      INNER JOIN blocks b     ON b.id = d.block_id
      LEFT JOIN project_team_shares pts
        ON pts.project_id = b.project_id AND pts.team_id = b.team_id
      WHERE b.project_id = ? AND pe.task_id IS NOT NULL AND pe.date >= ?
        AND COALESCE(pe.source, '') <> 'alloc_adj'
      GROUP BY pe.date
      ORDER BY pe.date
    `,
    )
      .bind(projectId, activityFrom)
      .all<ActivityPoint>(),
    // Daily headcount = people who declared this project on their attendance
    // checkpoint that day (daily_active_projects, migration 0044). This is
    // the "тухайн өдөр энэ төсөл дээр ажилласан хүн" volume-style series.
    c.env.DB.prepare(
      `
      SELECT date, COUNT(DISTINCT user_id) AS count
      FROM daily_active_projects
      WHERE project_id = ? AND date >= ?
      GROUP BY date
      ORDER BY date
    `,
    )
      .bind(projectId, activityFrom)
      .all<HeadcountPoint>(),
    // Issued performance reports → milestone markers on the progress line.
    c.env.DB.prepare(
      `
      SELECT report_no, date(issued_at) AS date
      FROM project_performance_reports
      WHERE project_id = ? AND status = 'issued' AND issued_at IS NOT NULL
      ORDER BY issued_at
    `,
    )
      .bind(projectId)
      .all<MilestoneRow>(),
    // Per-team stats for the fullscreen "watchlist": task count, done count
    // (latest approved % = 100) and assigned-member count. Teams are mapped by
    // drawing NAME PREFIX, mirroring snapshotTeamProgress / the team curves.
    c.env.DB.prepare(
      `
      WITH
      latest_task AS (
        -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
        SELECT t.id AS task_id, ${latestApprovedPctByDate('t.id')} AS percentage
        FROM tasks t
      ),
      drawing_team AS (
        SELECT d.id AS drawing_id, tm.code AS team_code
        FROM drawings d
        INNER JOIN blocks b ON b.id = d.block_id
        INNER JOIN teams tm ON tm.code = UPPER(TRIM(
          CASE
            WHEN INSTR(d.name, ' ') > 0 AND (INSTR(d.name, '-') = 0 OR INSTR(d.name, ' ') < INSTR(d.name, '-'))
              THEN SUBSTR(d.name, 1, INSTR(d.name, ' ') - 1)
            WHEN INSTR(d.name, '-') > 0
              THEN SUBSTR(d.name, 1, INSTR(d.name, '-') - 1)
            ELSE d.name
          END))
        WHERE b.project_id = ?
      ),
      team_task AS (
        SELECT dt.team_code, t.id AS task_id, COALESCE(lt.percentage, 0) AS pct
        FROM drawing_team dt
        INNER JOIN components c ON c.drawing_id = dt.drawing_id
        INNER JOIN tasks t      ON t.component_id = c.id
        LEFT JOIN latest_task lt ON lt.task_id = t.id
      )
      SELECT tt.team_code AS code,
             COUNT(DISTINCT tt.task_id) AS task_count,
             COUNT(DISTINCT CASE WHEN tt.pct >= 100 THEN tt.task_id END) AS done_count,
             COUNT(DISTINCT ta.user_id) AS member_count,
             GROUP_CONCAT(DISTINCT u.full_name) AS members
      FROM team_task tt
      LEFT JOIN task_assignees ta ON ta.task_id = tt.task_id
      LEFT JOIN users u ON u.id = ta.user_id
      GROUP BY tt.team_code
    `,
    )
      .bind(projectId)
      .all<TeamStatsRow>(),
    // Project schedule (passport) for the fullscreen "required daily pace"
    // panel: start_date → finish_date define the planned span.
    c.env.DB.prepare(
      `SELECT start_date, finish_date FROM project_passport WHERE project_id = ?`,
    )
      .bind(projectId)
      .first<{ start_date: string | null; finish_date: string | null }>(),
    // Overdue tasks: past due_date and latest approved % < 100 (partial work
    // still counts as not-done).
    c.env.DB.prepare(
      `
      WITH latest_task AS (
    -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
    SELECT t.id AS task_id, ${latestApprovedPctByDate('t.id')} AS percentage
    FROM tasks t
  )
      SELECT COUNT(*) AS overdue
      FROM tasks t
      INNER JOIN components c ON c.id = t.component_id
      INNER JOIN drawings d   ON d.id = c.drawing_id
      INNER JOIN blocks b     ON b.id = d.block_id
      LEFT JOIN latest_task lt ON lt.task_id = t.id
      WHERE b.project_id = ? AND t.due_date IS NOT NULL AND t.due_date < ?
        AND COALESCE(lt.percentage, 0) < 100
    `,
    )
      .bind(projectId, to)
      .first<{ overdue: number }>(),
    // Approval backlog (pending entries) + the most recent logged entry date.
    c.env.DB.prepare(
      `
      SELECT COUNT(CASE WHEN pe.status = 'pending' THEN 1 END) AS pending,
             MAX(pe.date) AS last_date
      FROM progress_entries pe
      INNER JOIN tasks t      ON t.id = pe.task_id
      INNER JOIN components c ON c.id = t.component_id
      INNER JOIN drawings d   ON d.id = c.drawing_id
      INNER JOIN blocks b     ON b.id = d.block_id
      WHERE b.project_id = ? AND pe.task_id IS NOT NULL AND COALESCE(pe.source, '') <> 'alloc_adj'
    `,
    )
      .bind(projectId)
      .first<{ pending: number; last_date: string | null }>(),
    // Per-team, per-day progress loggers (who filled task progress on this
    // team's tasks that day) — for the period-windowed watchlist tooltip.
    c.env.DB.prepare(
      `
      WITH drawing_team AS (
        SELECT d.id AS drawing_id, tm.code AS team_code
        FROM drawings d
        INNER JOIN blocks b ON b.id = d.block_id
        INNER JOIN teams tm ON tm.code = UPPER(TRIM(
          CASE
            WHEN INSTR(d.name, ' ') > 0 AND (INSTR(d.name, '-') = 0 OR INSTR(d.name, ' ') < INSTR(d.name, '-'))
              THEN SUBSTR(d.name, 1, INSTR(d.name, ' ') - 1)
            WHEN INSTR(d.name, '-') > 0
              THEN SUBSTR(d.name, 1, INSTR(d.name, '-') - 1)
            ELSE d.name
          END))
        WHERE b.project_id = ?
      )
      SELECT dt.team_code AS team, pe.date AS date, u.full_name AS name
      FROM drawing_team dt
      INNER JOIN components c ON c.drawing_id = dt.drawing_id
      INNER JOIN tasks t      ON t.component_id = c.id
      INNER JOIN progress_entries pe ON pe.task_id = t.id
      INNER JOIN users u      ON u.id = pe.user_id
      WHERE pe.date >= ? AND COALESCE(pe.source, '') <> 'alloc_adj'
      GROUP BY dt.team_code, pe.date, u.full_name
    `,
    )
      .bind(projectId, activityFrom)
      .all<TeamWorkerRow>(),
    // Per-team, per-day attendance: who declared this project that day, bucketed
    // by their own (primary) team.
    c.env.DB.prepare(
      `
      SELECT tm.code AS team, dap.date AS date, u.full_name AS name
      FROM daily_active_projects dap
      INNER JOIN users u  ON u.id = dap.user_id
      INNER JOIN teams tm ON tm.id = u.team_id
      WHERE dap.project_id = ? AND dap.date >= ?
      GROUP BY tm.code, dap.date, u.full_name
    `,
    )
      .bind(projectId, activityFrom)
      .all<TeamWorkerRow>(),
    // Баярын / ажлын бус өдрүүд (компанийн нэгдсэн календарь, migration
    // 0103) — графикийн өдрийн лаа өнгийг тооцоход (амралтын өдөр + баяр
    // дээр явц гараагүй бол улбар шар).  Зөвхөн харагдах цонхон доторхыг
    // авна.
    c.env.DB.prepare(
      `SELECT date FROM holidays WHERE date >= ? AND date <= ? ORDER BY date`,
    )
      .bind(activityFrom, to)
      .all<{ date: string }>(),
  ]);

  const milestones = (milestoneRes.results ?? []).map((m) => ({
    date: m.date,
    label: `№${m.report_no}`,
  }));

  // Merge per-team stats into the team list (matched by discipline code).
  const statsByCode = new Map<string, TeamStatsRow>();
  for (const r of teamStatsRes.results ?? []) statsByCode.set(r.code, r);
  const teamsEnriched = {
    teams: teams.teams.map((t) => {
      const s = statsByCode.get(t.code);
      return {
        code: t.code,
        name: t.name,
        taskCount: s?.task_count ?? 0,
        doneCount: s?.done_count ?? 0,
        memberCount: s?.member_count ?? 0,
        members: (s?.members ?? '')
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
      };
    }),
    points: teams.points,
  };

  return c.json({
    from: from || (overall[0]?.date ?? to),
    to,
    days,
    overall,
    teams: teamsEnriched,
    activity: activityRes.results ?? [],
    headcount: headcountRes.results ?? [],
    milestones,
    schedule: {
      start_date: passportRow?.start_date ?? null,
      finish_date: passportRow?.finish_date ?? null,
    },
    health: {
      overdue: overdueRow?.overdue ?? 0,
      pending: backlogRow?.pending ?? 0,
      last_activity_date: backlogRow?.last_date ?? null,
    },
    teamWorkers: {
      progress: progressPeopleRes.results ?? [],
      attendance: attendancePeopleRes.results ?? [],
    },
    // Ажлын бус өдрүүд (огнооны жагсаалт) — клиент талд candle өнгөнд.
    holidays: (holidayRes.results ?? []).map((h) => h.date),
  });
});

interface TeamTaskRow {
  user_id: number;
  full_name: string;
  profile_image: string | null;
  role: string;
  position: string | null;
  task_id: number;
  task_name: string;
  component_name: string;
  drawing_name: string;
  /** The day this approved progress entry was logged (YYYY-MM-DD). */
  date: string;
  /** Task percent immediately BEFORE this entry (0 if it was the first). */
  from_pct: number;
  /** Task percent this entry SET it to. */
  to_pct: number;
}

/* GET /:id/charts/team-tasks?team=BB
 * Per-member progress-ENTRY log for ONE discipline team on THIS project —
 * backs the "хэн аль ажилд хэдэн хувиас хэдэн хувь оруулсан" dialog opened by
 * clicking a team row in the fullscreen watchlist. Teams are mapped by drawing
 * NAME PREFIX (same convention as the team curves / watchlist stats), NOT
 * block.team_id, so the task set matches the watchlist row.
 *
 * Each row = ONE approved progress entry: who submitted it, on which task,
 * which day, and from what % to what % (the per-day delta). `from_pct` is the
 * task's previous approved percentage (via LAG over that task's approved
 * entries, ordered date/created_at/id), `to_pct` is this entry's percentage.
 * The client groups rows by user_id (the submitter). */
projectCharts.get('/:id/charts/team-tasks', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(projectId)) return c.json({ error: 'Invalid project id' }, 400);
  const teamCode = (c.req.query('team') ?? '').trim().toUpperCase();
  if (!teamCode) return c.json({ error: 'team query param required' }, 400);
  // Optional period window (exclusive from, inclusive to) — matches the
  // watchlist's (winStart, winEnd] convention so the dialog shows only the
  // entries logged in the currently-selected day/week/month. Empty = no bound.
  const fromParam = (c.req.query('from') ?? '').trim();
  const toParam = (c.req.query('to') ?? '').trim();

  const user = c.get('user');
  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const { results } = await c.env.DB.prepare(
    `
    WITH
    drawing_team AS (
      SELECT d.id AS drawing_id, d.name AS drawing_name
      FROM drawings d
      INNER JOIN blocks b ON b.id = d.block_id
      WHERE b.project_id = ?1
        AND UPPER(TRIM(
          CASE
            WHEN INSTR(d.name, ' ') > 0 AND (INSTR(d.name, '-') = 0 OR INSTR(d.name, ' ') < INSTR(d.name, '-'))
              THEN SUBSTR(d.name, 1, INSTR(d.name, ' ') - 1)
            WHEN INSTR(d.name, '-') > 0
              THEN SUBSTR(d.name, 1, INSTR(d.name, '-') - 1)
            ELSE d.name
          END)) = ?2
    ),
    team_task AS (
      SELECT t.id AS task_id, t.name AS task_name, comp.name AS component_name,
             dt.drawing_name AS drawing_name
      FROM drawing_team dt
      INNER JOIN components comp ON comp.drawing_id = dt.drawing_id
      INNER JOIN tasks t         ON t.component_id = comp.id
    ),
    -- All approved entries on this team's tasks, with the task's previous
    -- approved percentage (LAG) so we can show "from% -> to%" per day.
    entries AS (
      SELECT pe.id, pe.task_id, pe.user_id, pe.date, pe.created_at, pe.percentage AS to_pct,
             COALESCE(
               LAG(pe.percentage) OVER (
                 PARTITION BY pe.task_id ORDER BY pe.date, pe.created_at, pe.id
               ), 0) AS from_pct
      FROM progress_entries pe
      INNER JOIN team_task tt ON tt.task_id = pe.task_id
      WHERE pe.status = 'approved' AND pe.task_id IS NOT NULL
    )
    SELECT
      u.id            AS user_id,
      u.full_name     AS full_name,
      u.profile_image AS profile_image,
      u.role          AS role,
      u.position      AS position,
      e.task_id       AS task_id,
      tt.task_name    AS task_name,
      tt.component_name AS component_name,
      tt.drawing_name AS drawing_name,
      e.date          AS date,
      ROUND(e.from_pct, 1) AS from_pct,
      ROUND(e.to_pct, 1)   AS to_pct
    FROM entries e
    INNER JOIN team_task tt ON tt.task_id = e.task_id
    INNER JOIN users u      ON u.id = e.user_id
    WHERE u.status = 'active'
      AND (?3 = '' OR e.date > ?3)
      AND (?4 = '' OR e.date <= ?4)
    ORDER BY u.full_name, e.date DESC, e.created_at DESC, e.id DESC
  `,
  )
    .bind(projectId, teamCode, fromParam, toParam)
    .all<TeamTaskRow>();

  return c.json({ team_code: teamCode, rows: results ?? [] });
});

export default projectCharts;
