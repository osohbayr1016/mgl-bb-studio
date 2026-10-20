/* =============================================================
 * Progress time-series builders — shared by the performance-report
 * "Нэгтгэсэн график" block and the project-detail "Графикууд" tab.
 * -------------------------------------------------------------
 * Everything here reconstructs a project's progress *as of each
 * date* from the approved `progress_entries` log (each row stores an
 * ABSOLUTE per-task percentage stamped with a work `date`). No
 * snapshot table or cron is involved — the curve is computed live.
 *
 * Two rollups live here and they intentionally mirror the two the
 * rest of the app already uses:
 *
 *   • OVERALL  — Σ_task (block_w/100 × share/100 × task_w/100) × pct(D),
 *     the same block-weight × team-share rollup as PROJECT_LIST_SQL's
 *     `project_prog`. The last point equals the project's headline %.
 *     An hours-mode project (`progress_mode = 'hours'`) reads the % its
 *     staff were credited (`user_points`) instead (`buildHoursOverall`),
 *     for the same reason.
 *
 *   • PER-TEAM — a NORMALISED weighted average per discipline,
 *     Σ(task_w × pct) / Σ(task_w), grouped by drawing NAME PREFIX
 *     (e.g. "HAS - …" → HAS). Identical to `snapshotTeamProgress`
 *     and the in-app "Багуудын явц" panel, just evaluated per date.
 * ============================================================= */

import { orgUtcOffsetMinutes, sqliteOffsetModifier } from './reportWindows';

/** One point on the project-wide progress-over-time line chart.
 *  `progress` = overall weighted project progress (0–100) as of `date`. */
export interface TimeseriesPoint {
  date: string;
  progress: number;
}

/** Per-team progress-over-time payload. `points` is a recharts-friendly
 *  wide table: one row per date, one numeric column per team code. */
export interface TeamTimeseries {
  teams: Array<{ code: string; name: string }>;
  points: Array<Record<string, number | string>>;
}

/* Daily dates from `from` to `to` inclusive (YYYY-MM-DD). Steps weekly
 * when the span exceeds 90 days so a long project stays a readable line;
 * always ends exactly on `to`. Returns [] for unparseable / inverted
 * ranges (caller renders the chart's empty state). */
export function buildDateList(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(end)) return [];
  if (Number.isNaN(start) || start > end) return [to];
  const dayMs = 86_400_000;
  const span = Math.round((end - start) / dayMs);
  const step = span > 90 ? 7 : 1;
  const out: string[] = [];
  for (let t = start; t <= end; t += step * dayMs) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  if (out[out.length - 1] !== to) out.push(to);
  return out;
}

/** Subtract `n` whole days from a YYYY-MM-DD string, returning YYYY-MM-DD.
 *  Pure UTC offset math on a fixed date (same approach as buildDateList) —
 *  never touches the local clock/timezone. */
export function subDaysISO(dateStr: string, n: number): string {
  const ms = new Date(`${dateStr}T00:00:00Z`).getTime() - n * 86_400_000;
  if (Number.isNaN(ms)) return dateStr;
  return new Date(ms).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------
 * Shared loaders. Both rollups need (a) a per-task descriptor and
 * (b) the approved entries grouped by task, oldest-first. Loading
 * them once keeps the date-sweep a tight in-memory pass.
 * ----------------------------------------------------------- */

/** Approved entries for every task in the project, oldest first.
 *  Lexicographic YYYY-MM-DD compares chronologically; created_at breaks
 *  same-day ties so the latest submission wins (mirrors latest_task). */
async function loadApprovedEntries(
  db: D1Database,
  projectId: number,
): Promise<Array<{ task_id: number; date: string; percentage: number }>> {
  const res = await db
    .prepare(
      `
    -- 2026-09-11: CROSS JOIN нь нэгдэх дарааллыг ТӨСЛӨӨС доош хатуу заана —
    -- өмнө нь SQLite 8 000 явцын мөр бүрээс эцэг 4 мөрийг дагаж уншдаг байв
    -- (хэмжсэн 43 062 → ~9 000).  Үр дүн, эрэмбэ ижил.
    SELECT pe.task_id AS task_id, pe.date AS date, pe.percentage AS percentage
    FROM blocks b
    CROSS JOIN drawings d         ON d.block_id = b.id
    CROSS JOIN components c       ON c.drawing_id = d.id
    CROSS JOIN tasks t            ON t.component_id = c.id
    CROSS JOIN progress_entries pe ON pe.task_id = t.id
    WHERE b.project_id = ? AND pe.status = 'approved'
    ORDER BY pe.task_id, pe.date, pe.created_at
  `,
    )
    .bind(projectId)
    .all<{ task_id: number; date: string; percentage: number }>();
  return res.results ?? [];
}

/** Group entries by task into a date-sorted list, tracking the earliest
 *  work date seen. Only tasks present in `keep` are retained. */
function groupEntriesByTask(
  entries: Array<{ task_id: number; date: string; percentage: number }>,
  keep: (taskId: number) => boolean,
): { byTask: Map<number, Array<{ date: string; pct: number }>>; earliest: string | null } {
  const byTask = new Map<number, Array<{ date: string; pct: number }>>();
  let earliest: string | null = null;
  for (const e of entries) {
    if (!keep(e.task_id)) continue;
    let arr = byTask.get(e.task_id);
    if (!arr) {
      arr = [];
      byTask.set(e.task_id, arr);
    }
    arr.push({ date: e.date, pct: e.percentage });
    if (earliest === null || e.date < earliest) earliest = e.date;
  }
  return { byTask, earliest };
}

/** Resolve the curve's start date. The OVERALL report curve always
 *  starts at the first approved entry (`respectFrom=false`) — otherwise a
 *  report whose period starts today collapses to one invisible point. The
 *  ranged charts tab passes `respectFrom=true` so the 7/30/90-day toggle
 *  can clamp the start (progress accumulated before `from` is still folded
 *  in by the pointer sweep, so the line opens at the right height). */
function resolveStart(earliest: string | null, from: string, respectFrom: boolean): string {
  if (respectFrom && from && earliest && from > earliest) return from;
  return earliest ?? from;
}

/* -------------------------------------------------------------
 * OVERALL project progress curve.
 * ----------------------------------------------------------- */

async function loadOverallCoef(db: D1Database, projectId: number): Promise<Map<number, number>> {
  // Per-task contribution coefficient — зарласан төсвөөр бодсон rollup-ын
  // задаргаа (PROJECT_LIST_SQL / calcProjectProgress-тэй ижил):
  //   coef = (share/100) × (block_w/100) × (task_w/100)
  //
  // Зургийн жин ХАСАГДАНА: p_drawing = Σ(t.w × pct) / d.w бөгөөд блокийн
  // түвшинд d.w-ээр буцаж үржигддэг тул товчлогдоно.  ГЭХДЭЭ энэ тэнцэл
  // зөвхөн d.w ≠ 0 үед хүчинтэй — `calcProjectProgress` (routes/progress.ts)
  // нь `CASE WHEN d.weight_percent > 0 … ELSE 0` салаатай тул 0 төсөвтэй
  // зургийн бүх даалгавар 0 нэмэрлэдэг.  Тиймээс `dm.w <= 0` хаалт ЗААВАЛ
  // байх ёстой — үүнийг хасвал график SQL-ээс салж зөрнө.
  const [blocksRes, drawingsRes, tasksRes, sharesRes] = await Promise.all([
    db
      .prepare(`SELECT id, team_id, weight_percent FROM blocks WHERE project_id = ?`)
      .bind(projectId)
      .all<{ id: number; team_id: number | null; weight_percent: number }>(),
    db
      .prepare(
        `SELECT id, block_id, weight_percent FROM drawings
         WHERE block_id IN (SELECT id FROM blocks WHERE project_id = ?)`,
      )
      .bind(projectId)
      .all<{ id: number; block_id: number; weight_percent: number }>(),
    db
      .prepare(
        `SELECT t.id, c.drawing_id, t.weight_percent
         FROM tasks t
         INNER JOIN components c ON c.id = t.component_id
         WHERE c.drawing_id IN (
           SELECT d.id FROM drawings d
           INNER JOIN blocks b ON b.id = d.block_id
           WHERE b.project_id = ?
         )`,
      )
      .bind(projectId)
      .all<{ id: number; drawing_id: number; weight_percent: number }>(),
    db
      .prepare(`SELECT team_id, share_percent FROM project_team_shares WHERE project_id = ?`)
      .bind(projectId)
      .all<{ team_id: number; share_percent: number }>(),
  ]);

  const w0 = (v: number | null | undefined) => Math.max(0, v ?? 0);

  const shareByTeam = new Map<number, number>();
  for (const s of sharesRes.results ?? []) {
    shareByTeam.set(s.team_id, w0(s.share_percent));
  }

  const blockMeta = new Map<number, { team_id: number | null; w: number }>();
  for (const b of blocksRes.results ?? []) {
    blockMeta.set(b.id, { team_id: b.team_id, w: w0(b.weight_percent) });
  }

  // `drawMeta` нь блокийн холбоос болон 0-төсвийн хаалтад хэрэгтэй — зургийн
  // жин коэффициентэд шууд ордоггүй ч төсөв нь 0 эсэхийг шалгана.
  const drawMeta = new Map<number, { block_id: number; w: number }>();
  for (const d of drawingsRes.results ?? []) {
    drawMeta.set(d.id, { block_id: d.block_id, w: w0(d.weight_percent) });
  }

  const coef = new Map<number, number>();
  for (const t of tasksRes.results ?? []) {
    const dm = drawMeta.get(t.drawing_id);
    if (!dm || dm.w <= 0) continue;
    const bm = blockMeta.get(dm.block_id);
    if (!bm || bm.team_id === null || bm.w <= 0) continue;
    const share = shareByTeam.get(bm.team_id) ?? 0;
    if (share <= 0) continue;
    const c = (share / 100) * (bm.w / 100) * (w0(t.weight_percent) / 100);
    if (c > 0) coef.set(t.id, c);
  }
  return coef;
}

/* Цагаар бодогддог төсөл (`progress_mode = 'hours'`, 0339/0348 — FURNITURE
 * LAND-аас бусад бүх ZA) — явц нь жинлэсэн модноос БИШ, ажилчдад олгосон
 * хувиас (2026-09-29): D өдрийн цэг = суурь + Σ user_points.amount (олгосон
 * УБ огноо ≤ D), 100-д ТАСЛАХГҮЙ.  `lib/repairProgress.ts` `hoursProgressSql`-
 * ийн өдрөөр задалсан хувилбар — эс бөгөөс толгойн «Бодит явц» ба хажуугийн
 * график зөрнө (эзэн 2026-09-28: засварын төсөлд ЗӨВХӨН бодит явц). */
async function buildHoursOverall(
  db: D1Database,
  projectId: number,
  base: number,
  from: string,
  to: string,
  respectFrom: boolean,
): Promise<TimeseriesPoint[]> {
  const rows =
    (
      await db
        .prepare(
          `SELECT date(awarded_at, ?) AS date, SUM(amount) AS pct
           FROM user_points
           WHERE project_id = ?
           GROUP BY 1
           ORDER BY 1`,
        )
        .bind(sqliteOffsetModifier(orgUtcOffsetMinutes()), projectId)
        .all<{ date: string; pct: number | null }>()
    ).results ?? [];
  if (rows.length === 0 && base <= 0) return [];

  const dates = buildDateList(resolveStart(rows[0]?.date ?? null, from, respectFrom), to);
  const points: TimeseriesPoint[] = [];
  let i = 0;
  let cum = 0;
  for (const D of dates) {
    while (i < rows.length && rows[i]!.date <= D) {
      cum += Number(rows[i]!.pct ?? 0);
      i++;
    }
    points.push({ date: D, progress: Math.round((base + cum) * 100) / 100 });
  }
  return points;
}

async function buildOverall(
  db: D1Database,
  projectId: number,
  from: string,
  to: string,
  respectFrom: boolean,
): Promise<TimeseriesPoint[]> {
  const mode = await db
    .prepare(`SELECT progress_mode, hours_progress_base FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<{ progress_mode: string | null; hours_progress_base: number | null }>();
  if (mode?.progress_mode === 'hours') {
    return buildHoursOverall(
      db,
      projectId,
      Number(mode.hours_progress_base ?? 0),
      from,
      to,
      respectFrom,
    );
  }

  const coef = await loadOverallCoef(db, projectId);
  if (coef.size === 0) return [];

  const { byTask, earliest } = groupEntriesByTask(await loadApprovedEntries(db, projectId), (id) =>
    coef.has(id),
  );
  // No approved work yet → no meaningful curve (chart shows empty state).
  if (byTask.size === 0) return [];

  const dates = buildDateList(resolveStart(earliest, from, respectFrom), to);
  if (dates.length === 0) return [];

  // Monotonic pointer per task: as D advances we only move forward.
  const ptr = new Map<number, number>();
  const curPct = new Map<number, number>();
  const points: TimeseriesPoint[] = [];

  for (const D of dates) {
    let progress = 0;
    for (const [taskId, arr] of byTask) {
      let i = ptr.get(taskId) ?? 0;
      let pct = curPct.get(taskId) ?? 0;
      while (i < arr.length && arr[i]!.date <= D) {
        pct = arr[i]!.pct;
        i++;
      }
      ptr.set(taskId, i);
      curPct.set(taskId, pct);
      progress += coef.get(taskId)! * pct;
    }
    points.push({ date: D, progress: Math.round(progress * 100) / 100 });
  }
  return points;
}

/** Report curve: always spans first-approved-entry → `to` (ignores `from`
 *  as a lower bound). Public API preserved for performanceReports.ts. */
export function snapshotProgressTimeseries(
  db: D1Database,
  projectId: number,
  from: string,
  to: string,
): Promise<TimeseriesPoint[]> {
  return buildOverall(db, projectId, from, to, /* respectFrom */ false);
}

/** Charts-tab curve: honours `from` as a lower bound so the 7/30/90-day
 *  range toggle works, while still folding in progress earned before
 *  `from` so the line opens at the correct height. */
export function snapshotProgressTimeseriesRanged(
  db: D1Database,
  projectId: number,
  from: string,
  to: string,
): Promise<TimeseriesPoint[]> {
  return buildOverall(db, projectId, from, to, /* respectFrom */ true);
}

/* -------------------------------------------------------------
 * PER-TEAM progress curves (one line per discipline).
 * ----------------------------------------------------------- */

/** Map every task to its discipline team via the drawing NAME PREFIX,
 *  exactly like `snapshotTeamProgress` / PROJECT_LIST_SQL.drawing_team. */
async function loadTaskTeams(
  db: D1Database,
  projectId: number,
): Promise<{
  taskTeam: Map<number, { code: string; w: number }>;
  teamMeta: Map<string, { code: string; name: string; sort: number }>;
}> {
  const res = await db
    .prepare(
      `
    WITH drawing_team AS (
      SELECT d.id AS drawing_id,
             tm.code AS team_code,
             tm.name_mn AS team_name,
             tm.sort_order AS team_sort
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
    SELECT t.id AS task_id,
           dt.team_code AS team_code,
           dt.team_name AS team_name,
           dt.team_sort AS team_sort,
           COALESCE(t.weight_percent, 0) AS w
    FROM drawing_team dt
    INNER JOIN components c ON c.drawing_id = dt.drawing_id
    INNER JOIN tasks t      ON t.component_id = c.id
  `,
    )
    .bind(projectId)
    .all<{ task_id: number; team_code: string; team_name: string; team_sort: number; w: number }>();

  const taskTeam = new Map<number, { code: string; w: number }>();
  const teamMeta = new Map<string, { code: string; name: string; sort: number }>();
  for (const r of res.results ?? []) {
    taskTeam.set(r.task_id, { code: r.team_code, w: r.w });
    if (!teamMeta.has(r.team_code)) {
      teamMeta.set(r.team_code, { code: r.team_code, name: r.team_name, sort: r.team_sort });
    }
  }
  return { taskTeam, teamMeta };
}

export async function snapshotTeamProgressTimeseries(
  db: D1Database,
  projectId: number,
  from: string,
  to: string,
): Promise<TeamTimeseries> {
  const { taskTeam, teamMeta } = await loadTaskTeams(db, projectId);
  const teams = [...teamMeta.values()]
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))
    .map((t) => ({ code: t.code, name: t.name }));
  if (taskTeam.size === 0) return { teams, points: [] };

  // Seed the sweep with EVERY team task (pct defaults to 0) so the
  // normalised denominator counts not-yet-started tasks — otherwise a
  // team with 2/10 tasks done would read 100% instead of 20%.
  const { byTask, earliest } = groupEntriesByTask(await loadApprovedEntries(db, projectId), (id) =>
    taskTeam.has(id),
  );
  for (const taskId of taskTeam.keys()) {
    if (!byTask.has(taskId)) byTask.set(taskId, []);
  }
  if (earliest === null) return { teams, points: [] };

  const dates = buildDateList(resolveStart(earliest, from, true), to);
  if (dates.length === 0) return { teams, points: [] };

  const ptr = new Map<number, number>();
  const curPct = new Map<number, number>();
  const points: Array<Record<string, number | string>> = [];

  for (const D of dates) {
    const sumW = new Map<string, number>();
    const sumWPct = new Map<string, number>();
    const count = new Map<string, number>();
    const sumPct = new Map<string, number>();

    for (const [taskId, arr] of byTask) {
      let i = ptr.get(taskId) ?? 0;
      let pct = curPct.get(taskId) ?? 0;
      while (i < arr.length && arr[i]!.date <= D) {
        pct = arr[i]!.pct;
        i++;
      }
      ptr.set(taskId, i);
      curPct.set(taskId, pct);

      const { code, w } = taskTeam.get(taskId)!;
      sumW.set(code, (sumW.get(code) ?? 0) + w);
      sumWPct.set(code, (sumWPct.get(code) ?? 0) + w * pct);
      count.set(code, (count.get(code) ?? 0) + 1);
      sumPct.set(code, (sumPct.get(code) ?? 0) + pct);
    }

    const row: Record<string, number | string> = { date: D };
    for (const tm of teams) {
      const w = sumW.get(tm.code) ?? 0;
      const n = count.get(tm.code) ?? 0;
      // Weighted average; fall back to a plain average when every task
      // weight is 0 (mirrors snapshotTeamProgress's CASE … ELSE AVG).
      const prog = w > 0 ? sumWPct.get(tm.code)! / w : n > 0 ? sumPct.get(tm.code)! / n : 0;
      row[tm.code] = Math.round(prog * 100) / 100;
    }
    points.push(row);
  }
  return { teams, points };
}
