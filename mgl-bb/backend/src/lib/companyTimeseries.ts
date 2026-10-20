/* =============================================================
 * Company-wide progress time-series — the data behind the company
 * TV wallboard's TradingView-style scenes (index candle, project
 * "watchlist", discipline "sector" lines).
 *
 * Mirrors backend/src/lib/progressTimeseries.ts but aggregates
 * ACROSS every active project instead of one, so the numbers tell the
 * same story as each project's "Графикууд" tab — just rolled up.
 *
 * Company index = WORK-WEIGHTED mean of each project's overall
 * progress:
 *     index(D) = Σ_p sizeₚ · progressₚ(D) / Σ_p sizeₚ ,
 *     sizeₚ = тухайн төслийн нийт task тоо (ажлын хэмжээний proxy)
 * so a 500-task tower moves the needle more than a 20-task fit-out.
 *
 * Per-task contribution coefficient (block-weight × team-share ×
 * task-weight) is computed IDENTICALLY to progressTimeseries.ts so the
 * per-project curves here line up 1:1 with the project chart.
 * ============================================================= */

import { buildDateList, subDaysISO } from './progressTimeseries';
import { todayInUB } from './time';
import { NOT_ASR_ONLY_SQL } from './asrEligible';

export interface CompanyTimeseriesPoint {
  date: string;
  progress: number;
}

/** One row of the project "watchlist": current %, window change, a
 *  sparkline series, deadline + today's headcount. */
export interface CompanyProjectRow {
  id: number;
  name: string;
  progress: number; // latest point in the window
  change: number; // last − first across the window
  series: CompanyTimeseriesPoint[];
  finish_date: string | null;
  days_left: number | null;
  headcount_today: number;
  task_count: number;
  /** Төслийн ангилал (AZ/ZA/ET/EZ/IZ).  TV самбарын «хамгийн их ахисан
   *  төслүүд» кадар ажлын зураг ба засварын төслийг ялган харуулна. */
  category: string | null;
}

/** Per-discipline progress-over-time: one numeric column per team code,
 *  identical wide-table shape to the project per-team payload. */
export interface CompanyTeamTimeseries {
  teams: Array<{
    code: string;
    name: string;
    /** Тухайн багийн эзэмшлийн даалгаврын нийт тоо (идэвхтэй төслүүд дээр). */
    task_count: number;
    /** Түүнээс 100%-д хүрсэн нь.  «62%» гэдэг хийсвэр тоог газардуулах
     *  зорилготой — TV самбар дээр «132 / 214 даалгавар дууссан» гэж гарна. */
    done_count: number;
  }>;
  points: Array<Record<string, number | string>>;
}

export interface CompanyChartsPayload {
  from: string;
  to: string;
  days: number | null;
  /** Work-weighted company completion % per date — the index candle. */
  overall: CompanyTimeseriesPoint[];
  /** Work-weighted straight-line planned position (gold reference line).
   *  Only projects with both passport start + finish contribute. */
  planned: CompanyTimeseriesPoint[];
  teams: CompanyTeamTimeseries;
  projects: CompanyProjectRow[];
  /** Daily company headcount (distinct attendance) — the "volume" pane. */
  headcount: Array<{ date: string; count: number }>;
  /** Daily approved progress entries + distinct contributors. */
  activity: Array<{ date: string; entry_count: number; contributor_count: number }>;
}

/** Whole days between two YYYY-MM-DD dates (b − a) on a fixed UTC axis. */
function dayDiff(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00Z`).getTime();
  const tb = new Date(`${b}T00:00:00Z`).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return NaN;
  return Math.round((tb - ta) / 86_400_000);
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** Drawing NAME-PREFIX → team-code matcher, copied verbatim from
 *  progressTimeseries.loadTaskTeams so disciplines map the same way. */
const TEAM_PREFIX_CASE = `UPPER(TRIM(
  CASE
    WHEN INSTR(d.name, ' ') > 0 AND (INSTR(d.name, '-') = 0 OR INSTR(d.name, ' ') < INSTR(d.name, '-'))
      THEN SUBSTR(d.name, 1, INSTR(d.name, ' ') - 1)
    WHEN INSTR(d.name, '-') > 0
      THEN SUBSTR(d.name, 1, INSTR(d.name, '-') - 1)
    ELSE d.name
  END))`;

export async function buildCompanyCharts(
  db: D1Database,
  days: number | null,
): Promise<CompanyChartsPayload> {
  const to = todayInUB();

  const [
    projectsRes,
    coefRes,
    teamRes,
    entriesRes,
    headcountRes,
    activityRes,
    projHeadToday,
  ] = await Promise.all([
      // ── active projects: passport dates + size (task count) ──
      db
        .prepare(
          `
        SELECT p.id, p.name, p.category,
               pp.start_date  AS start_date,
               pp.finish_date AS finish_date,
               (SELECT COUNT(*)
                  FROM tasks t
                  JOIN components c ON c.id = t.component_id
                  JOIN drawings d   ON d.id = c.drawing_id
                  JOIN blocks b     ON b.id = d.block_id
                 WHERE b.project_id = p.id) AS task_count
        FROM projects p
        LEFT JOIN project_passport pp ON pp.project_id = p.id
        WHERE p.status = 'active' AND ${NOT_ASR_ONLY_SQL}
        ORDER BY p.name
      `,
        )
        .all<{
          id: number;
          name: string;
          category: string | null;
          start_date: string | null;
          finish_date: string | null;
          task_count: number;
        }>(),

      // ── per-task overall coefficient inputs, tagged with project_id ──
      db
        .prepare(
          `
        SELECT b.project_id            AS project_id,
               t.id                    AS task_id,
               t.weight_percent        AS task_w,
               d.id                    AS drawing_id,
               d.weight_percent        AS draw_w,
               b.id                    AS block_id,
               b.weight_percent        AS block_w,
               b.team_id               AS team_id,
               COALESCE(pts.share_percent, 0) AS share
        FROM tasks t
        JOIN components c ON c.id = t.component_id
        JOIN drawings d   ON d.id = c.drawing_id
        JOIN blocks b     ON b.id = d.block_id
        JOIN projects p   ON p.id = b.project_id AND p.status = 'active'
        LEFT JOIN project_team_shares pts
          ON pts.project_id = b.project_id AND pts.team_id = b.team_id
      `,
        )
        .all<{
          project_id: number;
          task_id: number;
          task_w: number;
          drawing_id: number;
          draw_w: number;
          block_id: number;
          block_w: number;
          team_id: number | null;
          share: number;
        }>(),

      // ── per-task discipline-team mapping (drawing name prefix) ──
      db
        .prepare(
          `
        WITH drawing_team AS (
          SELECT d.id        AS drawing_id,
                 tm.code      AS team_code,
                 tm.name_mn   AS team_name,
                 tm.sort_order AS team_sort
          FROM drawings d
          JOIN blocks b   ON b.id = d.block_id
          JOIN projects p ON p.id = b.project_id AND p.status = 'active'
          JOIN teams tm   ON tm.code = ${TEAM_PREFIX_CASE}
        )
        SELECT t.id AS task_id,
               dt.team_code AS team_code,
               dt.team_name AS team_name,
               dt.team_sort AS team_sort,
               COALESCE(t.weight_percent, 0) AS w
        FROM drawing_team dt
        JOIN components c ON c.drawing_id = dt.drawing_id
        JOIN tasks t      ON t.component_id = c.id
      `,
        )
        .all<{
          task_id: number;
          team_code: string;
          team_name: string;
          team_sort: number;
          w: number;
        }>(),

      // ── every approved entry across active projects, oldest first ──
      db
        .prepare(
          `
        -- 2026-09-11: CROSS JOIN — төслөөс доош алхана (50 438 → ~14 000 мөр),
        -- үр дүн ижил (lib/progressTimeseries.ts-ийн ижил тайлбар).
        SELECT pe.task_id AS task_id, pe.date AS date, pe.percentage AS percentage
        FROM projects p
        CROSS JOIN blocks b            ON b.project_id = p.id
        CROSS JOIN drawings d          ON d.block_id = b.id
        CROSS JOIN components c        ON c.drawing_id = d.id
        CROSS JOIN tasks t             ON t.component_id = c.id
        CROSS JOIN progress_entries pe ON pe.task_id = t.id
        WHERE p.status = 'active' AND pe.status = 'approved'
        ORDER BY pe.task_id, pe.date, pe.created_at
      `,
        )
        .all<{ task_id: number; date: string; percentage: number }>(),

      // ── daily company headcount (distinct attendance) ──
      db
        .prepare(
          `
        SELECT date, COUNT(DISTINCT user_id) AS count
        FROM attendance_sessions
        WHERE date >= ? AND date <= ?
        GROUP BY date
        ORDER BY date
      `,
        )
        .bind(days ? subDaysISO(to, days) : '0000-01-01', to)
        .all<{ date: string; count: number }>(),

      // ── daily approved entries + distinct contributors ──
      db
        .prepare(
          `
        SELECT date,
               COUNT(*)               AS entry_count,
               COUNT(DISTINCT user_id) AS contributor_count
        FROM progress_entries
        WHERE status = 'approved' AND COALESCE(source, '') <> 'alloc_adj' AND date >= ? AND date <= ?
        GROUP BY date
        ORDER BY date
      `,
        )
        .bind(days ? subDaysISO(to, days) : '0000-01-01', to)
        .all<{ date: string; entry_count: number; contributor_count: number }>(),

      // ── today's per-project on-site headcount ──
      db
        .prepare(
          `
        SELECT project_id, COUNT(DISTINCT user_id) AS count
        FROM daily_active_projects
        WHERE date = ?
        GROUP BY project_id
      `,
        )
        .bind(to)
        .all<{ project_id: number; count: number }>(),
    ]);

  const projectsMeta = projectsRes.results ?? [];
  const sizeByProject = new Map<number, number>();
  for (const p of projectsMeta) sizeByProject.set(p.id, Math.max(0, p.task_count));
  const headTodayByProject = new Map<number, number>();
  for (const r of projHeadToday.results ?? []) headTodayByProject.set(r.project_id, r.count);

  // Per-task overall coefficient (identical to progressTimeseries):
  //   coef = (share/100) × (block_w/100) × (task_w/100)
  // — зарласан төсвөөр (PROJECT_LIST_SQL / calcProjectProgress-тэй ижил).
  // Зургийн жин товчлогдож хасагдана, ГЭХДЭЭ 0 төсөвтэй зураг бүхэлдээ 0
  // нэмэрлэдэг тул `draw_w <= 0` хаалт ЗААВАЛ үлдэнэ.
  const w0 = (v: number | null | undefined) => Math.max(0, v ?? 0);

  const coefByTask = new Map<number, { projectId: number; coef: number }>();
  for (const r of coefRes.results ?? []) {
    if (r.team_id === null || r.share <= 0) continue;
    if (w0(r.draw_w) <= 0 || w0(r.block_w) <= 0) continue;
    const coef = (r.share / 100) * (w0(r.block_w) / 100) * (w0(r.task_w) / 100);
    if (coef > 0) coefByTask.set(r.task_id, { projectId: r.project_id, coef });
  }

  // Per-task discipline mapping + team metadata.
  const teamByTask = new Map<number, { code: string; w: number }>();
  const teamMeta = new Map<string, { code: string; name: string; sort: number }>();
  for (const r of teamRes.results ?? []) {
    teamByTask.set(r.task_id, { code: r.team_code, w: r.w });
    if (!teamMeta.has(r.team_code)) {
      teamMeta.set(r.team_code, { code: r.team_code, name: r.team_name, sort: r.team_sort });
    }
  }
  // Багийн даалгаврын тоо — эзэмшлийн хэмжээ.  Дуусснаа доор, цуваа
  // гүйсний ДАРАА тоолно (тэр үед `curPct` нь `to` өдрийн эцсийн байдал).
  const teamTaskCount = new Map<string, number>();
  for (const tm of teamByTask.values()) {
    teamTaskCount.set(tm.code, (teamTaskCount.get(tm.code) ?? 0) + 1);
  }
  const teamOrder = [...teamMeta.values()].sort(
    (a, b) => a.sort - b.sort || a.code.localeCompare(b.code),
  );
  /** Эцсийн `curPct`-ээс 100%-д хүрсэн даалгаврыг багаар нь тоолно. */
  const buildTeams = (donePct: Map<number, number> | null) => {
    const done = new Map<string, number>();
    if (donePct) {
      for (const [taskId, tm] of teamByTask) {
        if ((donePct.get(taskId) ?? 0) >= 100) done.set(tm.code, (done.get(tm.code) ?? 0) + 1);
      }
    }
    return teamOrder.map((t) => ({
      code: t.code,
      name: t.name,
      task_count: teamTaskCount.get(t.code) ?? 0,
      done_count: done.get(t.code) ?? 0,
    }));
  };

  // Approved entries grouped by task (date-ordered) + earliest work date.
  const entriesByTask = new Map<number, Array<{ date: string; pct: number }>>();
  let earliest: string | null = null;
  for (const e of entriesRes.results ?? []) {
    let arr = entriesByTask.get(e.task_id);
    if (!arr) {
      arr = [];
      entriesByTask.set(e.task_id, arr);
    }
    arr.push({ date: e.date, pct: e.percentage });
    if (earliest === null || e.date < earliest) earliest = e.date;
  }

  // Tasks to sweep = anything that contributes to overall OR a team line.
  const taskIds = new Set<number>([...coefByTask.keys(), ...teamByTask.keys()]);

  const from = days ? subDaysISO(to, days) : (earliest ?? to);
  const dates = buildDateList(from, to);

  // Empty company → return the shells so the wallboard shows empty states.
  if (taskIds.size === 0 || dates.length === 0) {
    return {
      from,
      to,
      days,
      overall: [],
      planned: [],
      teams: { teams: buildTeams(null), points: [] },
      projects: projectsMeta.map((p) => ({
        id: p.id,
        name: p.name,
        progress: 0,
        change: 0,
        series: [],
        finish_date: p.finish_date,
        days_left:
          p.finish_date && to ? dayDiff(to, p.finish_date) : null,
        headcount_today: headTodayByProject.get(p.id) ?? 0,
        task_count: p.task_count,
        category: p.category,
      })),
      headcount: headcountRes.results ?? [],
      activity: activityRes.results ?? [],
    };
  }

  const totalSize = projectsMeta.reduce((s, p) => s + Math.max(0, p.task_count), 0);

  // Monotonic pointer per task — as D advances we only move forward.
  const ptr = new Map<number, number>();
  const curPct = new Map<number, number>();

  const overall: CompanyTimeseriesPoint[] = [];
  const planned: CompanyTimeseriesPoint[] = [];
  const teamPoints: Array<Record<string, number | string>> = [];
  const projSeries = new Map<number, CompanyTimeseriesPoint[]>();
  for (const p of projectsMeta) projSeries.set(p.id, []);

  for (const D of dates) {
    const projProgress = new Map<number, number>();
    for (const p of projectsMeta) projProgress.set(p.id, 0);
    const teamSumW = new Map<string, number>();
    const teamSumWPct = new Map<string, number>();

    for (const taskId of taskIds) {
      const arr = entriesByTask.get(taskId);
      let pct = curPct.get(taskId) ?? 0;
      if (arr) {
        let i = ptr.get(taskId) ?? 0;
        while (i < arr.length && arr[i]!.date <= D) {
          pct = arr[i]!.pct;
          i++;
        }
        ptr.set(taskId, i);
      }
      curPct.set(taskId, pct);

      const co = coefByTask.get(taskId);
      if (co) projProgress.set(co.projectId, (projProgress.get(co.projectId) ?? 0) + co.coef * pct);

      const tm = teamByTask.get(taskId);
      if (tm) {
        teamSumW.set(tm.code, (teamSumW.get(tm.code) ?? 0) + tm.w);
        teamSumWPct.set(tm.code, (teamSumWPct.get(tm.code) ?? 0) + tm.w * pct);
      }
    }

    // Company index — work-weighted across every active project.
    let weighted = 0;
    for (const p of projectsMeta) {
      const prog = projProgress.get(p.id) ?? 0;
      weighted += Math.max(0, p.task_count) * prog;
      projSeries.get(p.id)!.push({ date: D, progress: Math.round(prog * 100) / 100 });
    }
    overall.push({
      date: D,
      progress: totalSize > 0 ? Math.round((weighted / totalSize) * 100) / 100 : 0,
    });

    // Planned (straight-line) position, work-weighted over dated projects.
    let planSize = 0;
    let planWeighted = 0;
    for (const p of projectsMeta) {
      if (!p.start_date || !p.finish_date) continue;
      const total = dayDiff(p.start_date, p.finish_date);
      if (!Number.isFinite(total) || total <= 0) continue;
      const elapsed = dayDiff(p.start_date, D);
      const expected = clampPct((100 * Math.max(0, elapsed)) / total);
      planSize += Math.max(0, p.task_count);
      planWeighted += Math.max(0, p.task_count) * expected;
    }
    planned.push({
      date: D,
      progress: planSize > 0 ? Math.round((planWeighted / planSize) * 100) / 100 : 0,
    });

    // Per-team weighted average (falls back to 0 when the team has no work).
    const row: Record<string, number | string> = { date: D };
    for (const tm of teamOrder) {
      const w = teamSumW.get(tm.code) ?? 0;
      const prog = w > 0 ? teamSumWPct.get(tm.code)! / w : 0;
      row[tm.code] = Math.round(prog * 100) / 100;
    }
    teamPoints.push(row);
  }

  const projects: CompanyProjectRow[] = projectsMeta.map((p) => {
    const series = projSeries.get(p.id) ?? [];
    const latest = series.length ? series[series.length - 1]!.progress : 0;
    const first = series.length ? series[0]!.progress : 0;
    return {
      id: p.id,
      name: p.name,
      progress: latest,
      change: Math.round((latest - first) * 100) / 100,
      series,
      finish_date: p.finish_date,
      days_left: p.finish_date ? dayDiff(to, p.finish_date) : null,
      headcount_today: headTodayByProject.get(p.id) ?? 0,
      task_count: p.task_count,
      category: p.category,
    };
  });

  return {
    from,
    to,
    days,
    overall,
    planned,
    teams: { teams: buildTeams(curPct), points: teamPoints },
    projects,
    headcount: headcountRes.results ?? [],
    activity: activityRes.results ?? [],
  };
}
