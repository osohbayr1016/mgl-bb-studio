/* =============================================================
 * Client-facing AEC design-progress report — data assembly + computed fields.
 * -------------------------------------------------------------
 * Reuses the existing project builders (PROJECT_LIST_SQL,
 * getProjectHierarchyFast, rowToPassport) and a hydrated performance-report
 * record, then adds the only genuinely new logic this feature needs:
 * elapsed %, expected % (50/70 S-curve), schedule variance, and RAG status.
 *
 * The shape returned here is consumed by lib/clientReportHtml.tsx (the
 * WeasyPrint HTML) and the `generate_report` MCP tool. NO rendering here.
 * ============================================================= */
import type { Env, JWTPayload, ProjectRow } from '../types';
import { isAdminRole } from '../types';
import { todayInUB } from './time';
import {
  PROJECT_LIST_SQL,
  getProjectHierarchyFast,
  rowToPassport,
  type PassportRow,
} from '../routes/projects';

export type ReportAudience = 'client' | 'internal';
export type Rag = 'green' | 'amber' | 'red' | 'unknown';
export type ReportLang = 'mn' | 'en';

/** A single authored risk row (admin-written; never auto-derived). */
export interface RiskRow {
  risk: string;
  impact: Rag;
  owner: string;
  mitigation: string;
}

/** The performance-report context the client report is built on. A subset of
 *  the hydrated perf-report row — passed in by the caller so this lib stays
 *  decoupled from routes/performanceReports.ts (no circular import). */
export interface PerfReportInput {
  report_no: number;
  period_start: string;
  period_end: string;
  status: 'draft' | 'issued';
  issued_at: string | null;
  team_progress: Array<{
    team_id: number;
    team_code: string;
    team_name_mn: string;
    share_percent: number;
    progress: number;
    task_count: number;
  }>;
  progress_timeseries: Array<{ date: string; progress: number }>;
  status_meetings: Array<{
    label: string;
    percent: number;
    scheduled_at: string;
    completed_at?: string | null;
  }>;
  client_summary_md: string | null;
  risks: RiskRow[];
  next_plan: string[];
}

export interface DisciplineRow {
  team_id: number;
  team_code: string;
  team_name_mn: string;
  team_name_en: string | null;
  share_percent: number;
  progress: number;
  task_count: number;
  rag: Rag;
}

export interface RegisterDrawing {
  name: string;
  weight_percent: number;
  progress: number;
  status: 'not_started' | 'in_progress' | 'complete';
}
export interface RegisterBlock {
  block_name: string;
  team_code: string | null;
  progress: number;
  drawings: RegisterDrawing[];
}

export interface HeatmapData {
  zones: string[];
  disciplines: string[];
  /** cells[disciplineIndex][zoneIndex] = progress % or null. */
  cells: Array<Array<number | null>>;
}

export interface RecentEntry {
  date: string;
  block: string | null;
  task: string | null;
  percentage: number;
  /** Only present for the internal audience. */
  user?: string | null;
}

export interface ClientReportData {
  audience: ReportAudience;
  lang: ReportLang;
  generated_at: string;
  rag_thresholds: { green: number; amber: number };
  project: {
    id: number;
    name: string;
    display_title: string | null;
    key_image_url: string | null;
    status: string;
    complexity_pct?: number;
  };
  passport: ReturnType<typeof rowToPassport>;
  report: {
    report_no: number;
    period_start: string;
    period_end: string;
    status: 'draft' | 'issued';
    issued_at: string | null;
  } | null;
  overall_progress: number;
  schedule: {
    start_date: string | null;
    finish_date: string | null;
    extension_date: string | null;
    elapsed_pct: number | null;
    expected_pct: number | null;
    variance: number | null;
    rag: Rag;
    finish_passed: boolean;
  };
  status_meetings: PerfReportInput['status_meetings'];
  /** Planned-vs-actual S-curve points (x = % time elapsed, y = % progress). */
  chart: {
    expected: Array<{ x: number; y: number }>;
    actual: Array<{ x: number; y: number }>;
    today_x: number | null;
  };
  disciplines: DisciplineRow[];
  register: RegisterBlock[];
  heatmap: HeatmapData | null;
  recent: RecentEntry[];
  authored: {
    summary_md: string | null;
    risks: RiskRow[];
    next_plan: string[];
  };
  /** Internal audience only. */
  pending_approvals?: number;
}

type HierBlock = Awaited<ReturnType<typeof getProjectHierarchyFast>>[number];
type ListRow = { id: number; progress: number | null; team_progress_json?: string | null };

/* RAG thresholds (variance = actual − expected, in points). Stated on the
 * report so the client can see how status is derived. */
const RAG_GREEN = -5;
const RAG_AMBER = -15;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number | null | undefined) => Math.round((v ?? 0) * 100) / 100;

/** Days since the Unix epoch for a YYYY-MM-DD date (date-only, TZ-free). */
function ymdToDays(s: string | null | undefined): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return Math.floor(Date.UTC(y, mo - 1, d) / 86_400_000);
}

/**
 * 50/70 S-curve expectation: design work is slow-fast-slow, so a straight line
 * over-penalises early/late stages. PMI heuristic: at 50% of time elapsed, 70%
 * of work should be done. Piecewise-linear through (0,0)→(0.5,0.7)→(1,1).
 * Input/return are fractions in [0,1].
 */
export function sCurve5070(elapsedFraction: number): number {
  const x = clamp(elapsedFraction, 0, 1);
  return x <= 0.5 ? 1.4 * x : 0.7 + 0.6 * (x - 0.5) / 0.5;
}

function ragFromVariance(variance: number | null, finishPassed: boolean, overall: number): Rag {
  if (finishPassed && overall < 100) return 'red';
  if (variance === null) return 'unknown';
  if (variance >= RAG_GREEN) return 'green';
  if (variance >= RAG_AMBER) return 'amber';
  return 'red';
}

/** Staff (admin/engineer/architect/senior) see all projects; clients only their
 *  own. Mirrors PROJECT_LIST_SQL bind logic in mcp/tools/projects.ts. */
function canSeeAll(role: JWTPayload['role']): boolean {
  return isAdminRole(role) || role === 'engineer' || role === 'architect' || role === 'senior';
}

async function fetchListRow(
  env: Env,
  user: { sub: number; role: JWTPayload['role'] },
  projectId: number,
): Promise<ListRow | null> {
  const all = canSeeAll(user.role);
  const stmt = env.DB.prepare(PROJECT_LIST_SQL(!all));
  const bound = all
    ? stmt.bind(user.sub, user.sub, user.sub)
    : stmt.bind(user.sub, user.sub, user.sub, user.sub);
  const res = await bound.all<ListRow>();
  return (res.results ?? []).find((r) => r.id === projectId) ?? null;
}

function drawingStatus(progress: number): RegisterDrawing['status'] {
  const p = Math.round(progress);
  if (p <= 0) return 'not_started';
  if (p >= 100) return 'complete';
  return 'in_progress';
}

/** Strip a leading discipline-code token from a block name to derive a "zone"
 *  label for the heat map (best-effort; gated by the renderer on matrix size). */
function zoneFromBlockName(name: string, teamCodes: Set<string>): string {
  const s = name.trim();
  const m = s.match(/^([A-Za-z]{1,5})\s*[-:.]?\s+(.+)$/);
  if (m && m[1] && m[2] && teamCodes.has(m[1].toUpperCase())) return m[2].trim();
  return s || name.trim();
}

function buildHeatmap(
  blocks: HierBlock[],
  teamCodeById: Map<number, string>,
  disciplineOrder: string[],
): HeatmapData | null {
  const codes = new Set(teamCodeById.values());
  // Accumulate progress sums per (discipline, zone).
  const acc = new Map<string, Map<string, { sum: number; n: number }>>();
  const zoneSet = new Set<string>();
  for (const b of blocks) {
    const code = b.team_id != null ? (teamCodeById.get(b.team_id) ?? null) : null;
    if (!code) continue;
    const zone = zoneFromBlockName(b.name, codes);
    zoneSet.add(zone);
    if (!acc.has(code)) acc.set(code, new Map());
    const row = acc.get(code)!;
    const cell = row.get(zone) ?? { sum: 0, n: 0 };
    cell.sum += b.progress ?? 0;
    cell.n += 1;
    row.set(zone, cell);
  }

  const disciplines = disciplineOrder.filter((c) => acc.has(c));
  const zones = [...zoneSet].sort((a, z) => a.localeCompare(z));
  // Only worth showing as a 2-D heat map when there's real structure.
  if (disciplines.length < 2 || zones.length < 2) return null;

  const cells = disciplines.map((code) => {
    const row = acc.get(code)!;
    return zones.map((z) => {
      const cell = row.get(z);
      return cell && cell.n > 0 ? round2(cell.sum / cell.n) : null;
    });
  });
  return { zones, disciplines, cells };
}

/**
 * Assemble the full client-report data bundle. Pure data — no HTML/PDF.
 * `report` is the hydrated perf-report the client report is built on (null for
 * an ad-hoc, report-less generation).
 */
export async function buildClientReportData(opts: {
  env: Env;
  user: { sub: number; role: JWTPayload['role'] };
  projectId: number;
  report: PerfReportInput | null;
  audience: ReportAudience;
  lang: ReportLang;
}): Promise<ClientReportData> {
  const { env, user, projectId, report, audience, lang } = opts;
  const isAdmin = isAdminRole(user.role);
  const isClient = audience === 'client';

  const [project, passportRow, hierarchy, teamsRes, sharesRes, listRow] = await Promise.all([
    env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<ProjectRow>(),
    env.DB.prepare('SELECT * FROM project_passport WHERE project_id = ?')
      .bind(projectId)
      .first<PassportRow>(),
    getProjectHierarchyFast(env.DB, projectId),
    env.DB.prepare(
      'SELECT id, code, name_mn, name_en, sort_order FROM teams ORDER BY sort_order, code',
    ).all<{ id: number; code: string; name_mn: string; name_en: string | null; sort_order: number }>(),
    env.DB.prepare(
      `SELECT pts.team_id, pts.share_percent, pts.sort_order,
              t.code AS team_code, t.name_mn AS team_name_mn, t.name_en AS team_name_en
         FROM project_team_shares pts
         INNER JOIN teams t ON t.id = pts.team_id
        WHERE pts.project_id = ?
        ORDER BY pts.sort_order, t.sort_order, t.code`,
    )
      .bind(projectId)
      .all<{
        team_id: number;
        share_percent: number;
        sort_order: number;
        team_code: string;
        team_name_mn: string;
        team_name_en: string | null;
      }>(),
    fetchListRow(env, user, projectId),
  ]);

  if (!project) throw new Error(`Project ${projectId} not found`);

  const teams = teamsRes.results ?? [];
  const teamCodeById = new Map<number, string>(teams.map((t) => [t.id, t.code]));
  const teamMetaByCode = new Map(teams.map((t) => [t.code, t]));
  const disciplineOrder = teams.map((t) => t.code);

  const passport = rowToPassport(passportRow);
  const startDate = passport?.start_date ?? null;
  const finishDate = passport?.finish_date ?? null;

  // ---- Overall progress: frozen (issued) timeseries last point, else live ----
  let overall = round2(listRow?.progress);
  if (report && report.status === 'issued' && report.progress_timeseries.length > 0) {
    const last = report.progress_timeseries[report.progress_timeseries.length - 1];
    if (last && typeof last.progress === 'number') overall = round2(last.progress);
  }

  // ---- Schedule maths ----
  const today = ymdToDays(todayInUB());
  const start = ymdToDays(startDate);
  const finish = ymdToDays(finishDate);
  let elapsedPct: number | null = null;
  let expectedPct: number | null = null;
  let variance: number | null = null;
  let finishPassed = false;
  if (start !== null && finish !== null && finish > start && today !== null) {
    const frac = clamp((today - start) / (finish - start), 0, 1);
    elapsedPct = round2(frac * 100);
    expectedPct = round2(sCurve5070(frac) * 100);
    variance = round2(overall - expectedPct);
    finishPassed = today > finish;
  } else if (finish !== null && today !== null) {
    finishPassed = today > finish;
  }
  const scheduleRag = ragFromVariance(variance, finishPassed, overall);

  // ---- Planned-vs-actual S-curve points ----
  const expected: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 20; i++) {
    const f = i / 20;
    expected.push({ x: round2(f * 100), y: round2(sCurve5070(f) * 100) });
  }
  const actual: Array<{ x: number; y: number }> = [];
  if (start !== null && finish !== null && finish > start && report?.progress_timeseries?.length) {
    for (const pt of report.progress_timeseries) {
      const dd = ymdToDays(pt.date);
      if (dd === null || typeof pt.progress !== 'number') continue;
      const f = clamp((dd - start) / (finish - start), 0, 1);
      actual.push({ x: round2(f * 100), y: round2(pt.progress) });
    }
  }
  if (actual.length === 0 && elapsedPct !== null) actual.push({ x: elapsedPct, y: overall });
  const chart = { expected, actual, today_x: elapsedPct };

  // ---- Disciplines: frozen snapshot (issued) else share + live per-team ----
  let disciplines: DisciplineRow[];
  if (report && report.status === 'issued' && report.team_progress.length > 0) {
    disciplines = report.team_progress.map((t) => ({
      team_id: t.team_id,
      team_code: t.team_code,
      team_name_mn: t.team_name_mn,
      team_name_en: teamMetaByCode.get(t.team_code)?.name_en ?? null,
      share_percent: t.share_percent,
      progress: round2(t.progress),
      task_count: t.task_count,
      rag: disciplineRag(t.progress, expectedPct, finishPassed),
    }));
  } else {
    // Live: merge declared shares with PROJECT_LIST_SQL per-team progress.
    let perTeam: Array<{ team_id: number; progress: number; task_count: number }> = [];
    try {
      if (listRow?.team_progress_json) {
        const parsed = JSON.parse(listRow.team_progress_json);
        if (Array.isArray(parsed)) perTeam = parsed;
      }
    } catch {
      perTeam = [];
    }
    const progByTeam = new Map(perTeam.map((p) => [p.team_id, p]));
    disciplines = (sharesRes.results ?? []).map((s) => {
      const p = progByTeam.get(s.team_id);
      const progress = round2(p?.progress ?? 0);
      return {
        team_id: s.team_id,
        team_code: s.team_code,
        team_name_mn: s.team_name_mn,
        team_name_en: s.team_name_en,
        share_percent: s.share_percent,
        progress,
        task_count: p?.task_count ?? 0,
        rag: disciplineRag(progress, expectedPct, finishPassed),
      };
    });
  }

  // ---- Drawing register (block → drawing → weight/progress/status) ----
  const register: RegisterBlock[] = hierarchy.map((b) => ({
    block_name: b.name,
    team_code: b.team_id != null ? (teamCodeById.get(b.team_id) ?? null) : null,
    progress: round2(b.progress),
    drawings: b.drawings.map((d) => ({
      name: d.name,
      weight_percent: d.weight_percent,
      progress: round2(d.progress),
      status: drawingStatus(d.progress),
    })),
  }));

  // ---- Block × discipline heat map (best-effort; null when not meaningful) ----
  const heatmap = buildHeatmap(hierarchy, teamCodeById, disciplineOrder);

  // ---- Recent approved activity (client-safe: drop user names) ----
  const recentRes = await env.DB.prepare(
    `SELECT pe.percentage, pe.date,
            t.name AS task_name, b.name AS block_name, u.full_name AS user_name
       FROM progress_entries pe
       INNER JOIN users u      ON u.id = pe.user_id
       LEFT  JOIN tasks t      ON t.id = pe.task_id
       LEFT  JOIN components c ON c.id = t.component_id
       LEFT  JOIN drawings d   ON d.id = c.drawing_id
       LEFT  JOIN blocks b     ON b.id = d.block_id
      WHERE b.project_id = ? AND pe.status = 'approved'
      ORDER BY pe.created_at DESC LIMIT 10`,
  )
    .bind(projectId)
    .all<{
      percentage: number;
      date: string;
      task_name: string | null;
      block_name: string | null;
      user_name: string | null;
    }>();
  const recent: RecentEntry[] = (recentRes.results ?? []).map((r) => ({
    date: r.date,
    block: r.block_name,
    task: r.task_name,
    percentage: round2(r.percentage),
    ...(isClient ? {} : { user: r.user_name }),
  }));

  // ---- Pending approvals (internal audience only) ----
  let pendingApprovals: number | undefined;
  if (!isClient) {
    const pendingRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM progress_entries pe
         JOIN tasks t      ON t.id = pe.task_id
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
        WHERE b.project_id = ? AND pe.status = 'pending'`,
    )
      .bind(projectId)
      .first<{ n: number }>();
    pendingApprovals = pendingRow?.n ?? 0;
  }

  return {
    audience,
    lang,
    generated_at: todayInUB(),
    rag_thresholds: { green: RAG_GREEN, amber: RAG_AMBER },
    project: {
      id: project.id,
      name: project.name,
      display_title: project.display_title,
      key_image_url: project.key_image_url,
      status: project.status,
      ...(isAdmin && !isClient ? { complexity_pct: project.complexity_pct } : {}),
    },
    passport,
    report: report
      ? {
          report_no: report.report_no,
          period_start: report.period_start,
          period_end: report.period_end,
          status: report.status,
          issued_at: report.issued_at,
        }
      : null,
    overall_progress: overall,
    schedule: {
      start_date: startDate,
      finish_date: finishDate,
      extension_date: passport?.extension_date ?? null,
      elapsed_pct: elapsedPct,
      expected_pct: expectedPct,
      variance,
      rag: scheduleRag,
      finish_passed: finishPassed,
    },
    status_meetings: report?.status_meetings ?? [],
    chart,
    disciplines,
    register,
    heatmap,
    recent,
    authored: {
      summary_md: report?.client_summary_md ?? null,
      risks: report?.risks ?? [],
      next_plan: report?.next_plan ?? [],
    },
    ...(pendingApprovals !== undefined ? { pending_approvals: pendingApprovals } : {}),
  };
}

/** Per-discipline RAG vs the project-wide expected % (no per-team schedule). */
function disciplineRag(progress: number, expectedPct: number | null, finishPassed: boolean): Rag {
  if (finishPassed && progress < 100) return 'red';
  if (expectedPct === null) return 'unknown';
  const v = progress - expectedPct;
  if (v >= RAG_GREEN) return 'green';
  if (v >= RAG_AMBER) return 'amber';
  return 'red';
}
