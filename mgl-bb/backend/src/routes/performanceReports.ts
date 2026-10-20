/* =============================================================
 * Гүйцэтгэлийн тайлан — project-wide performance reports.
 * -------------------------------------------------------------
 * Many rows per project (one per issue: №01, №02, …). Each row
 * starts as a draft; issuing the report snapshots the current
 * per-team progress into `team_progress_json` and locks the row.
 *
 * URL prefix: mounted at /api/projects, so every path here is
 * relative to /api/projects/:id/performance-reports/...
 * ============================================================= */
import { Hono } from 'hono';
import { launchBrowser, type BrowserSession } from '../lib/browser';
import { requireAdmin } from '../middleware/auth';
import { signToken } from '../lib/jwt';
import {
  snapshotProgressTimeseries,
  type TimeseriesPoint,
} from '../lib/progressTimeseries';
import { weasyprintEnabled } from '../lib/weasyprint';
import { renderClientReportPdf, buildClientReportHtmlDoc } from '../lib/clientReportRender';
import type { RiskRow } from '../lib/clientReport';
import type { Env, AppVariables } from '../types';
import { latestApprovedPctByCreatedAt } from '../lib/progressLatest';

const performanceReports = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface ReportRow {
  id: number;
  project_id: number;
  report_no: number;
  period_start: string;
  period_end: string;
  status: 'draft' | 'issued';
  issued_at: string | null;
  issued_by_id: number | null;
  team_progress_json: string | null;
  progress_timeseries_json: string | null;
  status_meetings_json: string | null;
  summary_text: string | null;
  workforce_json: string | null;
  notes: string | null;
  /** Client-report authored fields (migration 0108) — consumed only by the
   *  WeasyPrint client report, not the internal perf-report blocks. */
  client_summary_md: string | null;
  risks_json: string | null;
  next_plan_json: string | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

interface TeamSnapshotItem {
  team_id: number;
  team_code: string;
  team_name_mn: string;
  share_percent: number;
  progress: number;
  task_count: number;
}

interface StatusMeeting {
  label: string;
  percent: number;
  scheduled_at: string;
  completed_at?: string | null;
}

interface WorkforceRow {
  category: string;
  count: number;
  description?: string;
}

/* Hydrate a raw DB row into the JSON shape returned to the client.
 * Parses the JSON-encoded columns into typed arrays and fills empty
 * defaults so the frontend never has to handle null. */
function hydrate(row: ReportRow): Omit<
  ReportRow,
  | 'team_progress_json'
  | 'progress_timeseries_json'
  | 'status_meetings_json'
  | 'workforce_json'
  | 'risks_json'
  | 'next_plan_json'
> & {
  team_progress: TeamSnapshotItem[];
  progress_timeseries: TimeseriesPoint[];
  status_meetings: StatusMeeting[];
  workforce: WorkforceRow[];
  risks: RiskRow[];
  next_plan: string[];
} {
  const {
    team_progress_json,
    progress_timeseries_json,
    status_meetings_json,
    workforce_json,
    risks_json,
    next_plan_json,
    ...rest
  } = row;
  let team_progress: TeamSnapshotItem[] = [];
  let progress_timeseries: TimeseriesPoint[] = [];
  let status_meetings: StatusMeeting[] = [];
  let workforce: WorkforceRow[] = [];
  let risks: RiskRow[] = [];
  let next_plan: string[] = [];
  try {
    const parsed = JSON.parse(team_progress_json ?? '[]');
    if (Array.isArray(parsed)) team_progress = parsed as TeamSnapshotItem[];
  } catch {
    /* ignore */
  }
  try {
    const parsed = JSON.parse(progress_timeseries_json ?? '[]');
    if (Array.isArray(parsed)) progress_timeseries = parsed as TimeseriesPoint[];
  } catch {
    /* ignore */
  }
  try {
    const parsed = JSON.parse(status_meetings_json ?? '[]');
    if (Array.isArray(parsed)) status_meetings = parsed as StatusMeeting[];
  } catch {
    /* ignore */
  }
  try {
    const parsed = JSON.parse(workforce_json ?? '[]');
    if (Array.isArray(parsed)) workforce = parsed as WorkforceRow[];
  } catch {
    /* ignore */
  }
  try {
    const parsed = JSON.parse(risks_json ?? '[]');
    if (Array.isArray(parsed)) risks = parsed as RiskRow[];
  } catch {
    /* ignore */
  }
  try {
    const parsed = JSON.parse(next_plan_json ?? '[]');
    if (Array.isArray(parsed)) next_plan = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    /* ignore */
  }
  return { ...rest, team_progress, progress_timeseries, status_meetings, workforce, risks, next_plan };
}

/* Membership gate identical to GET /:id — clients can only see
 * projects they're members of, staff can see anything. */
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

/* Compute the per-team progress snapshot for a project right now.
 * -------------------------------------------------------------
 * Uses the SAME formula as the in-app "Багуудын явц" panel
 * (ProjectDetailPage): a NORMALISED weighted average per team —
 *   progress = Σ(task.progress × task.weight) / Σ(task.weight)
 * grouped by drawing NAME PREFIX (e.g. "HAS - …" → HAS), with a
 * plain average fallback when the team's task weights are all 0.
 *
 * The earlier version divided by the *declared* drawing weight,
 * which collapsed a team to a tiny % whenever its task weights
 * didn't sum to 100 (e.g. HAS showing 4.7% instead of 53%). This
 * normalised form is robust to unset weights and keeps every
 * surface (dashboard, report, charts) on one calculator. */
async function snapshotTeamProgress(
  db: D1Database,
  projectId: number,
): Promise<TeamSnapshotItem[]> {
  const { results } = await db
    .prepare(
      `
    WITH
    latest_task AS (
      -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
      SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
      FROM tasks t
    ),
    -- Map each drawing to a team by its NAME PREFIX, mirroring
    -- PROJECT_LIST_SQL.drawing_team and the in-app dashboard.
    drawing_team AS (
      SELECT d.id AS drawing_id, tm.id AS team_id
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
      SELECT dt.team_id,
             t.id AS task_id,
             COALESCE(t.weight_percent, 0) AS w,
             COALESCE(lt.percentage, 0) AS pct
      FROM drawing_team dt
      INNER JOIN components c ON c.drawing_id = dt.drawing_id
      INNER JOIN tasks t      ON t.component_id = c.id
      LEFT JOIN latest_task lt ON lt.task_id = t.id
    ),
    team_prog AS (
      SELECT team_id,
             CASE WHEN SUM(w) > 0
               THEN SUM(pct * w) / SUM(w)
               ELSE AVG(pct) END AS progress,
             COUNT(DISTINCT task_id) AS task_count
      FROM team_task
      GROUP BY team_id
    )
    SELECT pts.team_id,
           t.code AS team_code,
           t.name_mn AS team_name_mn,
           pts.share_percent,
           ROUND(COALESCE(tp.progress, 0), 2) AS progress,
           COALESCE(tp.task_count, 0) AS task_count
    FROM project_team_shares pts
    INNER JOIN teams t ON t.id = pts.team_id
    LEFT JOIN team_prog tp ON tp.team_id = pts.team_id
    WHERE pts.project_id = ?
    ORDER BY pts.sort_order, t.sort_order, t.code
  `,
    )
    .bind(projectId, projectId)
    .all<TeamSnapshotItem>();
  return results ?? [];
}

/* ============================================================
 * GET /:id/performance-reports — list
 * ========================================================== */
performanceReports.get('/:id/performance-reports', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const { results } = await c.env.DB.prepare(
    `
    SELECT * FROM project_performance_reports
    WHERE project_id = ?
    ORDER BY report_no DESC
  `,
  )
    .bind(projectId)
    .all<ReportRow>();

  return c.json({ reports: (results ?? []).map(hydrate) });
});

/* ============================================================
 * POST /:id/performance-reports — create draft
 * Auto-increments report_no within the project.
 * ========================================================== */
performanceReports.post('/:id/performance-reports', requireAdmin(), async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  type CreateBody = {
    period_start?: string;
    period_end?: string;
    status_meetings?: StatusMeeting[];
    summary_text?: string | null;
    workforce?: WorkforceRow[];
    notes?: string;
    /** When provided, copy the template's blocks into the new report
     *  instead of running seedDefaultBlocks. */
    template_id?: number | null;
  };
  const body = await c.req.json<CreateBody>().catch(() => ({}) as CreateBody);

  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(report_no) AS max_no FROM project_performance_reports WHERE project_id = ?',
  )
    .bind(projectId)
    .first<{ max_no: number | null }>();
  const next_no = (maxRow?.max_no ?? 0) + 1;

  // Default period: today through today + 14 days. Admin edits these
  // in the draft editor before issuing.
  const today = new Date();
  const start = body.period_start ?? today.toISOString().slice(0, 10);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 14);
  const end = body.period_end ?? endDate.toISOString().slice(0, 10);

  const meetings = Array.isArray(body.status_meetings) ? body.status_meetings : [];
  const workforce = Array.isArray(body.workforce) ? body.workforce : [];

  const res = await c.env.DB.prepare(
    `
    INSERT INTO project_performance_reports
      (project_id, report_no, period_start, period_end, status,
       status_meetings_json, summary_text, workforce_json, notes,
       created_by_id)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
    RETURNING *
  `,
  )
    .bind(
      projectId,
      next_no,
      start,
      end,
      JSON.stringify(meetings),
      body.summary_text ?? null,
      JSON.stringify(workforce),
      body.notes ?? null,
      user.sub,
    )
    .first<ReportRow>();

  if (!res) return c.json({ error: 'Insert failed' }, 500);
  const tmplId =
    typeof body.template_id === 'number' && body.template_id > 0 ? body.template_id : null;
  if (tmplId !== null) {
    await copyTemplateBlocks(c.env.DB, tmplId, res.id);
  } else {
    await seedDefaultBlocks(c.env.DB, projectId, res.id);
  }
  return c.json({ report: hydrate(res) }, 201);
});

/* Copy every block from a saved template into the new report,
 * preserving position + content_json. Skips silently if the
 * template was deleted between picker render + create — caller
 * gets an empty-block report and can add blocks manually. */
async function copyTemplateBlocks(
  db: D1Database,
  templateId: number,
  reportId: number,
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT type, position, content_json, hidden
       FROM report_template_blocks
      WHERE template_id = ?
      ORDER BY position, id`,
    )
    .bind(templateId)
    .all<{
      type: string;
      position: number;
      content_json: string;
      hidden: number;
    }>();
  if ((results ?? []).length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO project_performance_report_blocks
       (report_id, type, position, content_json, hidden)
     VALUES (?, ?, ?, ?, ?)`,
  );
  await db.batch(
    (results ?? []).map((b) => stmt.bind(reportId, b.type, b.position, b.content_json, b.hidden)),
  );
}

/* Seed default block list for a freshly-created draft report.
 *   cover → toc → project-intro → summary-notes
 *   → for each team in team_shares: team-narrative + team-stats
 *   → all-team-stats
 * Positions are spaced by 10 so admins can insert between later. */
async function seedDefaultBlocks(
  db: D1Database,
  projectId: number,
  reportId: number,
): Promise<void> {
  const teamRes = await db
    .prepare(
      `SELECT t.code AS team_code
       FROM project_team_shares pts
       INNER JOIN teams t ON t.id = pts.team_id
       WHERE pts.project_id = ?
       ORDER BY pts.sort_order, t.sort_order, t.code`,
    )
    .bind(projectId)
    .all<{ team_code: string }>();
  const teamCodes = (teamRes.results ?? []).map((r) => r.team_code);

  const blocks: Array<{ type: string; content: object }> = [
    { type: 'cover', content: {} },
    { type: 'toc', content: {} },
    { type: 'project-intro', content: {} },
    // Төслийн үндэслэл/ангилал, норм дүрэм, техникийн өрөө, гал — эхний
    // хуудсанд (танилцуулгын дараа, багуудын өмнө). Бөглөсөн хэсэг л харагдана.
    { type: 'project-sections', content: {} },
  ];
  for (const code of teamCodes) {
    blocks.push({ type: 'team-narrative', content: { team_code: code } });
    blocks.push({ type: 'team-stats', content: { team_code: code } });
  }
  blocks.push({ type: 'all-team-stats', content: {} });

  const stmt = db.prepare(
    `INSERT INTO project_performance_report_blocks
       (report_id, type, position, content_json)
     VALUES (?, ?, ?, ?)`,
  );
  await db.batch(
    blocks.map((b, i) => stmt.bind(reportId, b.type, (i + 1) * 10, JSON.stringify(b.content))),
  );
}

/* Membership-aware fetch of a report's blocks ordered by position. */
interface BlockRow {
  id: number;
  report_id: number;
  type: string;
  position: number;
  content_json: string;
  hidden: number;
  created_at: string;
  updated_at: string;
}
function hydrateBlock(row: BlockRow): Omit<BlockRow, 'content_json' | 'hidden'> & {
  content: unknown;
  hidden: boolean;
} {
  const { content_json, hidden, ...rest } = row;
  let content: unknown = {};
  try {
    content = JSON.parse(content_json ?? '{}');
  } catch {
    content = {};
  }
  return { ...rest, content, hidden: hidden === 1 };
}

async function fetchBlocks(db: D1Database, reportId: number) {
  const { results } = await db
    .prepare(
      `SELECT * FROM project_performance_report_blocks
        WHERE report_id = ? ORDER BY position, id`,
    )
    .bind(reportId)
    .all<BlockRow>();
  return (results ?? []).map(hydrateBlock);
}

/* ============================================================
 *  «Боловсруулсан ажилтан» — гарын үсгийн СЕРВЕР ТАЛЫН тодруулга
 * ============================================================
 *  ⚠️ Яагаад сервер дээр вэ (2026-09-02):
 *  Хэвлэлийн хуудас гарын үсэг зурсан хүний НЭР болон ЗУРГИЙГ олохын
 *  тулд `GET /api/users`-ыг дууддаг байсан бөгөөд тэр маршрут нь
 *  `requireManager()`.  Тиймээс ЗАХИАЛАГЧ өөрөө (мөн инженер/архитектор)
 *  PDF татахад 403 буцаж `users: []` болно — тамга нь гарсаар атал
 *  ГАРЫН ҮСГИЙН ЗУРАГ БА НЭР ХООСОН баримт client тал руу явдаг байв.
 *  Зөвхөн admin/senior өөрөө татахад л зөв гардаг байсан.
 *
 *  ⚠️ ИХЭР ФАЙЛ: `frontend/src/features/performance-reports/lib/
 *  signoffSigner.ts` (`resolveSignerName` + `findSigner`).  Нэр таарах
 *  дүрмийг нэг талд нь өөрчилвөл нөгөөд нь ЗААВАЛ өөрчил — эс бөгөөс
 *  хэвлэл дэлгэцээс зөрнө.
 *
 *  Нөхөлт (fallback) ЗОРИУДААР БАЙХГҮЙ — өөр хүний гарын үсгийг хэзээ ч
 *  орлуулж болохгүй.  `signature_url` нь ТҮҮХИЙ түлхүүр; `mediaUrl()`-ыг
 *  frontend хэрэглэнэ (meetings.ts-ийн оролцогчидтой ижил хэв маяг). */
const SIGNOFF_EXEC_REP_KEY = 'signoff.exec.val.rep';

async function resolveSignoff(
  db: D1Database,
  blocks: ReturnType<typeof hydrateBlock>[],
  createdById: number | null,
): Promise<{ name: string; signature_url: string | null }> {
  // Блокт харьяалагдахгүй хуудсуудын (гарын үсэг, нэгтгэсэн график) текст
  // танилцуулгын блокийн нэрийн зайд хадгалагддаг — хэвлэл/preview-ийн
  // `docTextBlockId`-тай ЯГ ижил дүрэм.
  const docBlock = blocks.find((b) => b.type === 'project-intro') ?? blocks[0];
  const overrides = (docBlock?.content as { textOverrides?: Record<string, unknown> } | undefined)
    ?.textOverrides;
  const rawOverride = overrides?.[SIGNOFF_EXEC_REP_KEY];
  const override = typeof rawOverride === 'string' ? rawOverride : undefined;

  // ХООСОН МӨР ('') = «хэрэглэгч зориуд арилгасан» тул авто-нэр рүү БУЦАХГҮЙ.
  if (override === '') return { name: '', signature_url: null };
  if (override === undefined && createdById == null) return { name: '', signature_url: null };

  const { results } = await db
    .prepare('SELECT id, full_name, signature_url FROM users')
    .all<{ id: number; full_name: string | null; signature_url: string | null }>();
  const users = results ?? [];

  const self = users.find((u) => u.id === createdById) ?? null;
  const name = override ?? self?.full_name ?? '';
  if (!name.trim()) return { name: '', signature_url: null };
  /* Хэрэглэгч нэрийг гараар БИЧЭЭГҮЙ бол тайланг үүсгэсэн хүн нь id-гаар
   * аль хэдийн олдсон — угтварын скан хийх ЯМАР Ч шалтгаангүй.  Скан нь
   * эрэмбэгүй жагсаалт дээр ажилладаг тул «Б.Бат» / «Б.Батбаяр» мэт
   * угтвар давхцахад ӨӨР хүний гарын үсэг сонгогдож, preview (эрэмбэтэй
   * жагсаалт) хэвлэлээс зөрөх эрсдэлтэй. */
  if (override === undefined) return { name, signature_url: self?.signature_url ?? null };

  // Бүтэн таарах · бичиж дуусаагүй байхад угтвараар · товчилсон нэрийн
  // үед эсрэгээр нь (findSigner-ийн ихэр).
  const q = name.trim().toLowerCase();
  const signer =
    users.find((u) => {
      const n = (u.full_name || '').trim().toLowerCase();
      if (!n) return false;
      return n === q || n.startsWith(q) || q.startsWith(n);
    }) ?? null;
  return { name, signature_url: signer?.signature_url ?? null };
}

/* Asserts report exists + visible + (if mutating) not locked.
 * Returns the row OR an error pair. */
async function assertReportMutable(
  db: D1Database,
  projectId: number,
  reportId: number,
): Promise<{ ok: true; report: ReportRow } | { ok: false; status: 404 | 409; error: string }> {
  const report = await db
    .prepare(
      `SELECT * FROM project_performance_reports
      WHERE id = ? AND project_id = ?`,
    )
    .bind(reportId, projectId)
    .first<ReportRow>();
  if (!report) return { ok: false, status: 404, error: 'Report not found' };
  if (report.status === 'issued') {
    return { ok: false, status: 409, error: 'Report is issued and locked' };
  }
  return { ok: true, report };
}

/* ============================================================
 * GET /:id/performance-reports/:reportId
 * ========================================================== */
performanceReports.get('/:id/performance-reports/:reportId', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const user = c.get('user');
  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const row = await c.env.DB.prepare(
    `
    SELECT * FROM project_performance_reports
    WHERE id = ? AND project_id = ?
  `,
  )
    .bind(reportId, projectId)
    .first<ReportRow>();
  if (!row) return c.json({ error: 'Report not found' }, 404);

  const blocks = await fetchBlocks(c.env.DB, reportId);
  const signoff = await resolveSignoff(c.env.DB, blocks, row.created_by_id ?? null);
  return c.json({ report: { ...hydrate(row), signoff }, blocks });
});

/* ============================================================
 * GET /:id/performance-reports/:reportId/progress-timeseries
 * Line-chart data for the "Нэгтгэсэн график" block. Issued reports
 * return the frozen snapshot; drafts compute it live over
 * [period_start, min(period_end, today)].
 * ========================================================== */
performanceReports.get('/:id/performance-reports/:reportId/progress-timeseries', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const user = c.get('user');
  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const row = await c.env.DB.prepare(
    `
    SELECT period_start, period_end, status, progress_timeseries_json
    FROM project_performance_reports
    WHERE id = ? AND project_id = ?
  `,
  )
    .bind(reportId, projectId)
    .first<
      Pick<ReportRow, 'period_start' | 'period_end' | 'status' | 'progress_timeseries_json'>
    >();
  if (!row) return c.json({ error: 'Report not found' }, 404);

  // Issued reports: serve the frozen curve if present.
  if (row.status === 'issued' && row.progress_timeseries_json) {
    try {
      const parsed = JSON.parse(row.progress_timeseries_json);
      if (Array.isArray(parsed)) return c.json({ series: parsed as TimeseriesPoint[] });
    } catch {
      /* fall through to live recompute */
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const to = row.period_end < today ? row.period_end : today;
  const series = await snapshotProgressTimeseries(c.env.DB, projectId, row.period_start, to);
  return c.json({ series });
});

/* ============================================================
 * Block CRUD — only writable while the report is in `draft`.
 * ========================================================== */

/* GET /:id/performance-reports/:reportId/blocks */
performanceReports.get('/:id/performance-reports/:reportId/blocks', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const user = c.get('user');
  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const exists = await c.env.DB.prepare(
    'SELECT 1 AS x FROM project_performance_reports WHERE id = ? AND project_id = ?',
  )
    .bind(reportId, projectId)
    .first();
  if (!exists) return c.json({ error: 'Report not found' }, 404);

  const blocks = await fetchBlocks(c.env.DB, reportId);
  return c.json({ blocks });
});

/* POST /:id/performance-reports/:reportId/blocks — add a block */
performanceReports.post('/:id/performance-reports/:reportId/blocks', requireAdmin(), async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const gate = await assertReportMutable(c.env.DB, projectId, reportId);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  type Body = { type?: string; content?: unknown; position?: number };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const type = (body.type ?? '').trim();
  if (!type) return c.json({ error: 'type required' }, 400);

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(position) AS max_pos FROM project_performance_report_blocks WHERE report_id = ?',
  )
    .bind(reportId)
    .first<{ max_pos: number | null }>();
  const position = body.position ?? (maxRow?.max_pos ?? 0) + 10;
  const content = body.content !== undefined ? body.content : {};

  const row = await c.env.DB.prepare(
    `INSERT INTO project_performance_report_blocks
           (report_id, type, position, content_json)
         VALUES (?, ?, ?, ?)
         RETURNING *`,
  )
    .bind(reportId, type, position, JSON.stringify(content))
    .first<BlockRow>();
  if (!row) return c.json({ error: 'Insert failed' }, 500);
  return c.json({ block: hydrateBlock(row) }, 201);
});

/* PATCH /:id/performance-reports/:reportId/blocks/:blockId */
performanceReports.patch(
  '/:id/performance-reports/:reportId/blocks/:blockId',
  requireAdmin(),
  async (c) => {
    const projectId = parseInt(c.req.param('id'), 10);
    const reportId = parseInt(c.req.param('reportId'), 10);
    const blockId = parseInt(c.req.param('blockId'), 10);

    const gate = await assertReportMutable(c.env.DB, projectId, reportId);
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);

    const existing = await c.env.DB.prepare(
      'SELECT * FROM project_performance_report_blocks WHERE id = ? AND report_id = ?',
    )
      .bind(blockId, reportId)
      .first<BlockRow>();
    if (!existing) return c.json({ error: 'Block not found' }, 404);

    type Body = { type?: string; content?: unknown; hidden?: boolean };
    const body = await c.req.json<Body>().catch(() => ({}) as Body);

    const newType = body.type !== undefined ? body.type : existing.type;
    const newContent =
      body.content !== undefined ? JSON.stringify(body.content) : existing.content_json;
    const newHidden = body.hidden !== undefined ? (body.hidden ? 1 : 0) : existing.hidden;

    const updated = await c.env.DB.prepare(
      `UPDATE project_performance_report_blocks
            SET type = ?, content_json = ?, hidden = ?, updated_at = datetime('now')
          WHERE id = ? AND report_id = ?
          RETURNING *`,
    )
      .bind(newType, newContent, newHidden, blockId, reportId)
      .first<BlockRow>();
    if (!updated) return c.json({ error: 'Update failed' }, 500);
    return c.json({ block: hydrateBlock(updated) });
  },
);

/* DELETE /:id/performance-reports/:reportId/blocks/:blockId */
performanceReports.delete(
  '/:id/performance-reports/:reportId/blocks/:blockId',
  requireAdmin(),
  async (c) => {
    const projectId = parseInt(c.req.param('id'), 10);
    const reportId = parseInt(c.req.param('reportId'), 10);
    const blockId = parseInt(c.req.param('blockId'), 10);

    const gate = await assertReportMutable(c.env.DB, projectId, reportId);
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);

    await c.env.DB.prepare(
      'DELETE FROM project_performance_report_blocks WHERE id = ? AND report_id = ?',
    )
      .bind(blockId, reportId)
      .run();
    return c.json({ ok: true });
  },
);

/* PUT /:id/performance-reports/:reportId/blocks/reorder — body { block_ids } */
performanceReports.put(
  '/:id/performance-reports/:reportId/blocks/reorder',
  requireAdmin(),
  async (c) => {
    const projectId = parseInt(c.req.param('id'), 10);
    const reportId = parseInt(c.req.param('reportId'), 10);

    const gate = await assertReportMutable(c.env.DB, projectId, reportId);
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);

    type Body = { block_ids?: number[] };
    const body = await c.req.json<Body>().catch(() => ({}) as Body);
    const ids = Array.isArray(body.block_ids) ? body.block_ids : [];
    if (ids.length === 0) return c.json({ error: 'block_ids required' }, 400);

    // Rewrite positions to (i+1)*10. Use a batch of prepared statements
    // so we don't issue 50 round-trips on a heavy reorder.
    const stmt = c.env.DB.prepare(
      `UPDATE project_performance_report_blocks
          SET position = ?, updated_at = datetime('now')
        WHERE id = ? AND report_id = ?`,
    );
    await c.env.DB.batch(ids.map((id, i) => stmt.bind((i + 1) * 10, id, reportId)));

    const blocks = await fetchBlocks(c.env.DB, reportId);
    return c.json({ blocks });
  },
);

/* ============================================================
 * PUT /:id/performance-reports/:reportId — edit draft only
 * Returns 409 if the report is already issued.
 * ========================================================== */
performanceReports.put('/:id/performance-reports/:reportId', requireAdmin(), async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);

  const existing = await c.env.DB.prepare(
    `
    SELECT * FROM project_performance_reports
    WHERE id = ? AND project_id = ?
  `,
  )
    .bind(reportId, projectId)
    .first<ReportRow>();
  if (!existing) return c.json({ error: 'Report not found' }, 404);
  if (existing.status === 'issued') {
    return c.json({ error: 'Report is issued and locked' }, 409);
  }

  type UpdateBody = {
    period_start?: string;
    period_end?: string;
    status_meetings?: StatusMeeting[];
    summary_text?: string | null;
    workforce?: WorkforceRow[];
    notes?: string | null;
    /** Client-report authored fields (migration 0108). */
    client_summary_md?: string | null;
    risks?: RiskRow[];
    next_plan?: string[];
  };
  const body = await c.req.json<UpdateBody>().catch(() => ({}) as UpdateBody);

  const period_start = body.period_start ?? existing.period_start;
  const period_end = body.period_end ?? existing.period_end;
  const meetingsJson =
    body.status_meetings !== undefined
      ? JSON.stringify(body.status_meetings)
      : existing.status_meetings_json;
  const workforceJson =
    body.workforce !== undefined ? JSON.stringify(body.workforce) : existing.workforce_json;
  const summary = body.summary_text !== undefined ? body.summary_text : existing.summary_text;
  const notes = body.notes !== undefined ? body.notes : existing.notes;
  const clientSummary =
    body.client_summary_md !== undefined ? body.client_summary_md : existing.client_summary_md;
  const risksJson =
    body.risks !== undefined ? JSON.stringify(body.risks) : existing.risks_json;
  const nextPlanJson =
    body.next_plan !== undefined ? JSON.stringify(body.next_plan) : existing.next_plan_json;

  const updated = await c.env.DB.prepare(
    `
    UPDATE project_performance_reports
       SET period_start = ?, period_end = ?,
           status_meetings_json = ?,
           summary_text = ?,
           workforce_json = ?,
           notes = ?,
           client_summary_md = ?,
           risks_json = ?,
           next_plan_json = ?,
           updated_at = datetime('now')
     WHERE id = ? AND project_id = ?
    RETURNING *
  `,
  )
    .bind(
      period_start,
      period_end,
      meetingsJson,
      summary,
      workforceJson,
      notes,
      clientSummary,
      risksJson,
      nextPlanJson,
      reportId,
      projectId,
    )
    .first<ReportRow>();

  if (!updated) return c.json({ error: 'Update failed' }, 500);
  return c.json({ report: hydrate(updated) });
});

/* ============================================================
 * POST /:id/performance-reports/:reportId/issue — snapshot + lock
 * ========================================================== */
performanceReports.post('/:id/performance-reports/:reportId/issue', requireAdmin(), async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const user = c.get('user');

  const existing = await c.env.DB.prepare(
    `
    SELECT * FROM project_performance_reports
    WHERE id = ? AND project_id = ?
  `,
  )
    .bind(reportId, projectId)
    .first<ReportRow>();
  if (!existing) return c.json({ error: 'Report not found' }, 404);
  if (existing.status === 'issued') {
    return c.json({ error: 'Report is already issued' }, 409);
  }

  const snapshot = await snapshotTeamProgress(c.env.DB, projectId);
  // Freeze the progress curve from the report's period start through today
  // (the issue date) so the line chart never drifts after issue.
  const issuedDate = new Date().toISOString().slice(0, 10);
  const timeseries = await snapshotProgressTimeseries(
    c.env.DB,
    projectId,
    existing.period_start,
    issuedDate,
  );

  const updated = await c.env.DB.prepare(
    `
    UPDATE project_performance_reports
       SET status = 'issued',
           issued_at = datetime('now'),
           issued_by_id = ?,
           team_progress_json = ?,
           progress_timeseries_json = ?,
           updated_at = datetime('now')
     WHERE id = ? AND project_id = ?
    RETURNING *
  `,
  )
    .bind(user.sub, JSON.stringify(snapshot), JSON.stringify(timeseries), reportId, projectId)
    .first<ReportRow>();

  if (!updated) return c.json({ error: 'Issue failed' }, 500);
  return c.json({ report: hydrate(updated) });
});

/* ============================================================
 * DELETE /:id/performance-reports/:reportId — drafts only
 * ========================================================== */
performanceReports.delete('/:id/performance-reports/:reportId', requireAdmin(), async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);

  const existing = await c.env.DB.prepare(
    `
    SELECT status FROM project_performance_reports
    WHERE id = ? AND project_id = ?
  `,
  )
    .bind(reportId, projectId)
    .first<{ status: string }>();
  if (!existing) return c.json({ error: 'Report not found' }, 404);
  // Admins may delete any report — drafts AND issued ones. Blocks cascade
  // via the report_id FK (migration 0078).

  await c.env.DB.prepare('DELETE FROM project_performance_reports WHERE id = ? AND project_id = ?')
    .bind(reportId, projectId)
    .run();

  return c.json({ ok: true });
});

/* Minimal HTML escaper for values interpolated into the puppeteer
 * header/footer templates (drawing_no can contain &, <, >). */
/* =============================================================
 * ТАЙЛАНГИЙН ХАРАГДАХ ДУГААР — нүүр хуудасны override нь ялна.
 * -------------------------------------------------------------
 * Хэрэглэгч нүүр хуудасны том дугаарыг гараар өөрчилж болдог
 * (`cover` блокийн `content_json.override.reportNo`).  Гэтэл PDF-ийн
 * давтагдах header нь `report_no` буюу ӨГӨГДЛИЙН САНГИЙН утгыг уншдаг
 * байсан тул нүүрэн дээр №02 гэж бичсэн атал хуудас бүрийн толгойд №04
 * гарч байв (2026-08-25-нд хэрэглэгч илрүүлсэн).
 *
 * `report_no` нь DB-д хэвээр үлдэнэ — тэр нь `UNIQUE(project_id,
 * report_no)` түлхүүр, автомат дугаарлалтын суурь тул хөндөхгүй.
 * Зөвхөн ХАРАГДАХ дугаарыг override-оос авна.  Frontend-ийн ижил логик:
 * `frontend/src/features/performance-reports/lib/blockContentResolve.ts`
 * → `effectiveReportNo`. */
async function displayReportNo(
  db: D1Database,
  reportId: number,
  fallback: number,
): Promise<number> {
  try {
    const row = await db
      .prepare(
        `SELECT content_json FROM project_performance_report_blocks
          WHERE report_id = ? AND type = 'cover'
          ORDER BY position LIMIT 1`,
      )
      .bind(reportId)
      .first<{ content_json: string | null }>();
    if (!row?.content_json) return fallback;
    const parsed = JSON.parse(row.content_json) as { override?: { reportNo?: unknown } } | null;
    const n = parsed?.override?.reportNo;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  } catch {
    /* эвдэрсэн JSON — DB-ийн дугаар руу уначина */
  }
  return fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
 * GET /:id/performance-reports/:reportId/pdf — server-side PDF
 * ========================================================== */
performanceReports.get('/:id/performance-reports/:reportId/pdf', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const user = c.get('user');

  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const report = await c.env.DB.prepare(
    `
    SELECT * FROM project_performance_reports
    WHERE id = ? AND project_id = ?
  `,
  )
    .bind(reportId, projectId)
    .first<ReportRow>();
  if (!report) return c.json({ error: 'Report not found' }, 404);

  const project = await c.env.DB.prepare('SELECT id, name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number; name: string }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const passportRow = await c.env.DB.prepare(
    'SELECT doc_no, drawing_no FROM project_passport WHERE project_id = ?',
  )
    .bind(projectId)
    .first<{ doc_no: string | null; drawing_no: string | null }>();

  const printToken = await signToken(
    { sub: user.sub, role: user.role, purpose: 'print' },
    c.env.JWT_SECRET,
    1 / 60, // 1 minute
  );
  const printUrl =
    `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/reports/project/${projectId}/performance-report/${reportId}/print` +
    `?t=${encodeURIComponent(printToken)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(c.env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* render whatever we have */
    }

    // Repeating header/footer drawn by Chromium in the @page margins on
    // every A4 — accurate page numbers (pageNumber/totalPages) and a footer
    // pinned to the bottom of each sheet (not flowing after the content).
    // The navy cover stays full-bleed via `@page :first { margin: 0 }`.
    const shownNo = await displayReportNo(c.env.DB, reportId, report.report_no);
    const reportNoStr = String(shownNo).padStart(2, '0');
    const reportDateStr = report.issued_at?.slice(0, 10) ?? report.period_end;
    /* Эзний шийдвэр 2026-09-02: хуудасны толгойд ХОЁУЛАНГ нь хэвлэнэ.
     * `doc_no` (гараар бичдэг баримтын дугаар, миграц 0246) ба
     * `drawing_no` (Зургийн шифр) нь ӨӨР зүйл — урьд нь шифрийг
     * «Doc. No.» гэсэн ХУДАЛ шошготой хэвлэдэг байв. */
    const docNoParts = [
      passportRow?.doc_no ? `Doc. No.: ${escapeHtml(passportRow.doc_no)}` : '',
      passportRow?.drawing_no ? `Шифр: ${escapeHtml(passportRow.drawing_no)}` : '',
    ].filter(Boolean);
    const docNoHtml = docNoParts.length ? `${docNoParts.join(' &nbsp;|&nbsp; ')}<br/>` : '';

    // Footer logo (bottom-left). Fetch the frontend's logo.svg and inline it
    // as a URL-encoded data URI — puppeteer header/footer templates render in
    // an isolated context that doesn't reliably load external <img> URLs.
    // Falls back to the "MGL E&C" wordmark if the fetch fails.
    let footerLogoHtml =
      '<span style="font-weight:700; color:#0F243E; letter-spacing:1px;">MGL E&amp;C</span>';
    try {
      const logoRes = await fetch(`${c.env.FRONTEND_URL.replace(/\/+$/, '')}/logo.svg`);
      if (logoRes.ok) {
        const svg = await logoRes.text();
        // logo.svg's artwork sits in a small region of its big 1920×1080
        // canvas (true bbox ≈ x891–1188, y365–715), so at a fixed height the
        // full mark looks tiny / gets clipped. Crop the viewBox tightly to
        // the artwork (+~20px margin) so the whole logo fills the footer.
        const cropped = svg.replace(
          /viewBox="0 0 1920 1080"/,
          'viewBox="735 345 470 390"',
        );
        const dataUri = `data:image/svg+xml,${encodeURIComponent(cropped)}`;
        footerLogoHtml = `<img src="${dataUri}" style="height:34px; width:auto;" alt="MGL E&amp;C" />`;
      }
    } catch {
      /* keep wordmark fallback */
    }

    /* ⚠️ ХУУДАСНЫ ЗАХЫН ЗАЙ — `frontend/.../components/styles.ts`-ийн
     * `@page { margin: 16.7mm 0 23.88mm 0 }`-ТАЙ ЗААВАЛ ТЭНЦҮҮ БАЙХ ЁСТОЙ.
     * -----------------------------------------------------------------
     * Урьд нь энд 22mm/15mm байсан бол CSS-д 16.7/23.88 байв.  `@page`
     * зарлагдсан үед Chromium агуулгыг CSS-ийн зайгаар (16.7mm) инсет
     * хийдэг ч header/footer-ийн зурвасыг puppeteer-ийн зайгаар (22mm)
     * байрлуулдаг тул header-ийн доод зураас агуулгын ЭХНИЙ мөрийн дээр
     * буудаг байв (PDF-ийн 2-р хуудсан дээр хэмжиж баталсан).
     * Хоёуланг нь жишиг .docx-ийн геометрт (дээд 16.7 / доод 23.88mm)
     * нийцүүлснээр дэлгэц ↔ PDF ↔ жишиг баримт гурвуулаа таарна.
     *
     * Загварын дотоод padding нь шинэ зурвасын өндөрт тохируулагдсан:
     *   header зурвас 16.7mm, бэх ≈ 5mm + 1 мөр ≈ 9mm  → багтана
     *   footer зурвас 23.88mm; `padding-top:14mm` нь бэхийг зурвасын
     *   ЁРООЛ руу түлхэнэ (эс бөгөөс Chromium түүнийг зурвасын дээд
     *   талд наагаад агуулгын доор шууд наалдсан мэт харагдана). */
    const PDF_MARGIN_TOP_MM = 16.7;
    const PDF_MARGIN_BOTTOM_MM = 23.88;

    const headerTemplate = `
      <div style="width:100%; font-family:Arial,Helvetica,sans-serif; font-size:9px; color:#111; padding:5mm 19.05mm 0 19.05mm; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid #999; padding-bottom:3px;">
          <span style="font-weight:700;">Гүйцэтгэлийн тайлан №${reportNoStr}</span>
          <span style="text-align:right; color:#555; font-size:8px; line-height:1.4;">${docNoHtml}${escapeHtml(reportDateStr)}</span>
        </div>
      </div>`;
    const footerTemplate = `
      <div style="width:100%; font-family:Arial,Helvetica,sans-serif; font-size:8px; color:#777; padding:14mm 19.05mm 0 19.05mm; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #ddd; padding-top:4px;">
          ${footerLogoHtml}
          <span>Хуудас <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      </div>`;

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: {
        top: `${PDF_MARGIN_TOP_MM}mm`,
        right: '0mm',
        bottom: `${PDF_MARGIN_BOTTOM_MM}mm`,
        left: '0mm',
      },
    });

    const safeName =
      (project.name || 'project')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'project';

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}_GT_${reportNoStr}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[perf-report-pdf] render failed', err);
    return c.json(
      {
        error: 'PDF үүсгэхэд алдаа гарлаа',
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
});

/* ============================================================
 * GET /:id/performance-reports/:reportId/docx — server-side Word
 * ------------------------------------------------------------
 * Renders the same print page Browser Rendering uses for the PDF,
 * rasterises the recharts SVGs to PNG (Word can't draw inline SVG),
 * then converts the rendered HTML to a native OOXML .docx via
 * html-to-docx. The library has no bundled types and is a UMD build,
 * so it's imported lazily inside the handler — a module-eval failure
 * is isolated to this route rather than taking down the whole worker.
 * ========================================================== */
performanceReports.get('/:id/performance-reports/:reportId/docx', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const user = c.get('user');

  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const report = await c.env.DB.prepare(
    `SELECT * FROM project_performance_reports WHERE id = ? AND project_id = ?`,
  )
    .bind(reportId, projectId)
    .first<ReportRow>();
  if (!report) return c.json({ error: 'Report not found' }, 404);

  const project = await c.env.DB.prepare('SELECT id, name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number; name: string }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const printToken = await signToken(
    { sub: user.sub, role: user.role, purpose: 'print' },
    c.env.JWT_SECRET,
    1 / 60,
  );
  const printUrl =
    `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/reports/project/${projectId}/performance-report/${reportId}/print` +
    `?t=${encodeURIComponent(printToken)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(c.env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* render whatever we have */
    }

    // Word drops inline <svg>; rasterise each recharts surface to a PNG <img>
    // so the charts survive the HTML→docx conversion, then return the cleaned
    // body markup. Passed as a string so the DOM-only globals (document,
    // Image, canvas) don't trip the worker tsconfig (no DOM lib). Best-effort.
    let bodyHtml: unknown = '';
    try {
      bodyHtml = await page.evaluate(`(async () => {
        const svgs = Array.from(document.querySelectorAll('svg.recharts-surface'));
        for (const svg of svgs) {
          try {
            const rect = svg.getBoundingClientRect();
            const w = Math.ceil(rect.width) || 320;
            const h = Math.ceil(rect.height) || 240;
            const clone = svg.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('width', String(w));
            clone.setAttribute('height', String(h));
            const xml = new XMLSerializer().serializeToString(clone);
            const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
            const png = await new Promise((resolve) => {
              const img = new Image();
              img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = w * 2; canvas.height = h * 2;
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(null); return; }
                ctx.scale(2, 2);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/png'));
              };
              img.onerror = () => resolve(null);
              img.src = svg64;
            });
            if (png && svg.parentNode) {
              const out = document.createElement('img');
              out.src = png;
              out.setAttribute('width', String(w));
              svg.parentNode.replaceChild(out, svg);
            }
          } catch (e) { /* leave this svg */ }
        }
        // Strip nodes html-to-docx's OOXML serialiser chokes on: any svg that
        // failed to rasterise (namespaced attrs → "Invalid XML name"), plus
        // <style>/<script>/<head> metadata (class CSS isn't applied to docx
        // anyway — only inline styles are). Return just the body markup.
        document.querySelectorAll('svg, style, script, link, noscript, template').forEach((n) => n.remove());
        return document.body ? document.body.innerHTML : document.documentElement.outerHTML;
      })()`);
    } catch {
      bodyHtml = '';
    }

    const html = (typeof bodyHtml === 'string' && bodyHtml) ? bodyHtml : await page.content();

    // @ts-expect-error - html-to-docx ships no type declarations
    const htmlToDocxMod = await import('html-to-docx');
    const htmlToDocx = (htmlToDocxMod.default ?? htmlToDocxMod) as (
      html: string,
      header?: string | null,
      opts?: Record<string, unknown>,
      footer?: string | null,
    ) => Promise<ArrayBuffer | Uint8Array>;

    const docx = await htmlToDocx(html, null, {
      orientation: 'portrait',
      margins: { top: 720, right: 720, bottom: 720, left: 720 },
      table: { row: { cantSplit: true } },
    });

    const safeName =
      (project.name || 'project')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'project';

    return new Response(docx as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeName}_GT_${String(report.report_no).padStart(2, '0')}.docx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[perf-report-docx] render failed', err);
    return c.json(
      {
        error: 'Word үүсгэхэд алдаа гарлаа',
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
});

/* ============================================================
 * Client-facing AEC design-progress report (WeasyPrint).
 * ------------------------------------------------------------
 * Built on this performance report's data + the authored client fields, but
 * rendered through the WeasyPrint container (server HTML → PDF), NOT the
 * puppeteer print page. Audience = 'client' (contributor points / individual
 * names / pending-approval queue are suppressed in the compute layer).
 * ========================================================== */

/* GET /:id/performance-reports/:reportId/client-pdf — downloadable PDF */
performanceReports.get('/:id/performance-reports/:reportId/client-pdf', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const user = c.get('user');

  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  if (!weasyprintEnabled(c.env)) {
    return c.json({ error: 'PDF үйлчилгээ тохируулагдаагүй (WEASYPRINT_SVC).' }, 503);
  }

  const report = await c.env.DB.prepare(
    'SELECT report_no FROM project_performance_reports WHERE id = ? AND project_id = ?',
  )
    .bind(reportId, projectId)
    .first<{ report_no: number }>();
  if (!report) return c.json({ error: 'Report not found' }, 404);

  const project = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ name: string }>();

  const lang = c.req.query('lang') === 'en' ? 'en' : 'mn';
  try {
    const pdf = await renderClientReportPdf(c.env, user, {
      projectId,
      reportId,
      audience: 'client',
      lang,
    });
    const safeName =
      (project?.name || 'project')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'project';
    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}_client_${String(report.report_no).padStart(2, '0')}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[client-report-pdf] render failed', err);
    return c.json(
      { error: 'PDF үүсгэхэд алдаа гарлаа', detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

/* GET /:id/performance-reports/:reportId/client-html — on-site web view
 * (full HTML doc + Paged.js). Fetched authed by the frontend, which opens it
 * via a blob URL in a new tab. */
performanceReports.get('/:id/performance-reports/:reportId/client-html', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const reportId = parseInt(c.req.param('reportId'), 10);
  const user = c.get('user');

  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const exists = await c.env.DB.prepare(
    'SELECT 1 AS x FROM project_performance_reports WHERE id = ? AND project_id = ?',
  )
    .bind(reportId, projectId)
    .first();
  if (!exists) return c.json({ error: 'Report not found' }, 404);

  const lang = c.req.query('lang') === 'en' ? 'en' : 'mn';
  try {
    const html = await buildClientReportHtmlDoc(c.env, user, {
      projectId,
      reportId,
      audience: 'client',
      lang,
      mode: 'web',
    });
    return c.html(html);
  } catch (err) {
    console.error('[client-report-html] render failed', err);
    return c.json(
      { error: 'Веб харагдац үүсгэхэд алдаа гарлаа', detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

export default performanceReports;
