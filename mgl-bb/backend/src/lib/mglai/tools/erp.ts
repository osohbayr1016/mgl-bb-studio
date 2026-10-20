/**
 * MGL AI · ERP ХЭРЭГСЛИЙН ГҮЙЦЭТГЭГЧ (§26).
 *
 * ⚠️ ЭНЭ ФАЙЛ БОЛ §35-ИЙН ХЭРЭГЖҮҮЛЭЛТ.  «Компанид хэдэн ажилтан байна»
 *    гэсэн асуултын хариу нь ЖИНД БАЙХГҮЙ — маргааш 43 болвол загварыг
 *    дахин сургахгүйгээр 43 гэж хариулна, учир нь тоо нь ЭНДЭЭС ирдэг.
 *
 * ⚠️ ОДООГИЙН ERP-ИЙН ЭРХЭЭС ХЭТРЭХГҮЙ.  Хэрэгсэл бүр route-ийн ижил
 *    дүрмийг дагана.  Ялангуяа `PROJECT_LIST_SQL`-ийг `seesPending`-тэй
 *    ЗӨВ дуудна: MCP-ийн `fetchVisibleProjects` нь тэр аргументыг
 *    ОРХИГДУУЛСАН тул гэрээ хэлэлцээрийн шатны төслүүд инженерт задардаг
 *    (CLAUDE.md-ийн мэдэгдэж буй цоорхой).  MGL AI ТЭР АЛДААГ ДАВТАХГҮЙ.
 *
 * ⚠️ АРИФМЕТИК СЕРВЕР ДЭЭР.  Өдрийн зөрүү, хувь, тоолол бүгд SQL/TS-д
 *    бодогдож ГОТОВ тоогоор загварт очно (§14: «Do NOT ask the LLM to
 *    guess arithmetic»).
 *
 * ⚠️ ХАРИУ НЬ ЖИЖИГ БАЙНА.  Загварын контекст 4K — 200 төслийн бүрэн мөр
 *    нь түүнийг дүүргэнэ.  Хэрэгсэл бүр `limit` барьж, зөвхөн шаардлагатай
 *    багана буцаана.
 */
import type { Env, UserRole } from '../../../types';
import { isAdminRole } from '../../../types';
import { PROJECT_LIST_SQL } from '../../../routes/projects';
import { hideArchivedRows } from '../../archivedProjects';
import { todayInUB } from '../../time';
import type { AiIdentity } from '../identity';
import { lexicalSearch } from '../retrieval';
import { filterEvidence, type Viewer } from '../visibility';
import { analyzeProject, describeSystem, getEmployeeActivity, queryEntities } from './analytics';

export interface ToolContext {
  env: Env;
  identity: AiIdentity;
  /** Хэрэглэгчийн харах эрхтэй төслүүд — захиалагчийн шүүлтэд. */
  projectIds: readonly number[];
  /** Захиалагчийн байгууллага — нотолгооны шүүлтэд. */
  orgId?: number | null;
}

export interface ToolResult {
  ok: boolean;
  /** Загварт очих БҮТЭЦТЭЙ өгөгдөл. */
  data: unknown;
  /** Хүнд харуулах товч тэмдэглэл (оношилгоо, эх сурвалж). */
  note?: string;
  error?: string;
}

/* ------------------------------------------------------------------ */

function canSeeAllProjects(role: UserRole | null): boolean {
  return (
    role !== null &&
    (isAdminRole(role) || role === 'engineer' || role === 'architect' || role === 'senior')
  );
}

/** ⚠️ `projects.ts:414`-ийн дүрмийн ЯГ хуулбар — admin + senior Л хардаг. */
function seesPending(role: UserRole | null): boolean {
  return role !== null && (isAdminRole(role) || role === 'senior');
}

/** ISO огнооны хоорондох ХОНОГИЙН зөрүү — загвар БИШ, сервер бодно. */
export function daysBetween(fromIsoDate: string, toIsoDate: string): number | null {
  const a = Date.parse(`${fromIsoDate}T00:00:00Z`);
  const b = Date.parse(`${toIsoDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/*  Хэрэгслүүд                                                          */
/* ------------------------------------------------------------------ */

async function getActiveEmployees(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const role = typeof args.role === 'string' ? args.role : null;

  // ⚠️ `role <> 'client'` нь ростерийн репо даяарх заншил.  `worker`
  //    (цэвэрлэгч) нь ажилтан тул ОРНО — `is_support` нь зөвхөн
  //    бүтээмжийн самбараас хасдаг, ростероос биш.
  const sql = role
    ? `SELECT role, COUNT(*) AS n FROM users
        WHERE status = 'active' AND role = ? AND role <> 'client'
        GROUP BY role`
    : `SELECT role, COUNT(*) AS n FROM users
        WHERE status = 'active' AND role <> 'client'
        GROUP BY role ORDER BY n DESC`;

  const stmt = role ? ctx.env.DB.prepare(sql).bind(role) : ctx.env.DB.prepare(sql);
  const { results } = await stmt.all<{ role: string; n: number }>();
  const rows = results ?? [];
  const total = rows.reduce((s, r) => s + Number(r.n ?? 0), 0);

  return {
    ok: true,
    data: {
      total_active: total,
      by_role: rows.map((r) => ({ role: r.role, count: Number(r.n ?? 0) })),
      as_of: todayInUB(),
    },
    note: 'Амьд ERP өгөгдөл.',
  };
}

async function listProjects(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const role = ctx.identity.role;
  const canAll = canSeeAllProjects(role);
  const limit = typeof args.limit === 'number' ? args.limit : 50;
  const statusFilter = typeof args.status === 'string' ? args.status : null;

  const sub = ctx.identity.userId ?? 0;
  const stmt = ctx.env.DB.prepare(PROJECT_LIST_SQL(!canAll, seesPending(role)));
  // ⚠️ Bind тоо нь `projects.ts`-ийн route-тай ЯГ ИЖИЛ: 3× EXISTS, мөн
  //    non-admin үед INNER JOIN-д 4 дэх удаа.
  const bound = canAll ? stmt.bind(sub, sub, sub) : stmt.bind(sub, sub, sub, sub);
  const { results } = await bound.all<{
    id: number;
    name: string;
    status: string | null;
    progress: number | null;
    finish_date: string | null;
  }>();

  // REST `GET /api/projects`-тэй ижил: архивласан төсөл зөвхөн админд.
  const all = hideArchivedRows(role ?? '', results ?? []);
  // ⚠️ ТӨЛВИЙН ТООГ СЕРВЕР ТООЛНО.  Хэмжигдсэн (2026-09-10, Qwen3-8B): 24
  //    мөртэй жагсаалтаас загвар «идэвхтэй» төслийг гурван удаа гурван
  //    өөрөөр (14, 16, 18) тоолсон.  Тоо нь ЭНДЭЭС л гарна — загвар
  //    `counts_by_status`-ыг уншина, мөр тоолохгүй (§28, §29).
  const countsByStatus: Record<string, number> = {};
  for (const r of all) {
    const s = r.status ?? 'unknown';
    countsByStatus[s] = (countsByStatus[s] ?? 0) + 1;
  }
  const today = todayInUB();
  let rows = statusFilter ? all.filter((r) => r.status === statusFilter) : all;
  const total = rows.length;
  rows = rows.slice(0, limit);

  const projects = rows.map((r) => {
    const daysRemaining =
      r.status === 'active' && typeof r.finish_date === 'string' ? daysBetween(today, r.finish_date) : null;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      progress_percent: Math.round(Number(r.progress ?? 0) * 10) / 10,
      finish_date: r.finish_date,
      // ⚠️ Сөрөг = ХОЦОРСОН.  «Аль төсөл хоцорч байна» гэсэн асуултад загвар
      //    огноо хасахгүй — сервер бодсон тоог л уншина.
      days_remaining: daysRemaining,
      overdue: daysRemaining !== null && daysRemaining < 0,
    };
  });

  return {
    ok: true,
    data: {
      total_visible: total,
      returned: rows.length,
      active_count: countsByStatus.active ?? 0,
      counts_by_status: countsByStatus,
      overdue_count: projects.filter((p) => p.overdue).length,
      projects,
      as_of: today,
    },
    note: `Идэвхтэй төсөл: ${countsByStatus.active ?? 0}. Тоог өөрөө тоолохгүй — counts_by_status-ыг ашигла.`,
  };
}

async function getUpcomingDeadlines(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const days = typeof args.days === 'number' ? args.days : 30;
  const limit = typeof args.limit === 'number' ? args.limit : 10;
  const today = todayInUB();
  const role = ctx.identity.role;

  // ⚠️ `projects`-Д ОГНООНЫ БАГАНА БАЙХГҮЙ.  `finish_date` нь
  //    `project_passport`-д амьдардаг ба `PROJECT_LIST_SQL` түүнийг
  //    `LEFT JOIN project_passport`-оор нэмдэг.  Өмнө нь энэ функц
  //    `SELECT p.finish_date FROM projects p` гэж бичсэн байсан бөгөөд
  //    продакшнд «no such column: p.finish_date» гэж 500 өгдөг байв
  //    (2026-09-08-нд илэрсэн).
  //
  //    ⚠️ ЭНД ШИНЭ SQL БИЧИХГҮЙ.  CLAUDE.md: төслийн SQL нь аль хэдийн
  //    арван нэгэн хуулбартай — арван хоёр дахийг нэмэх нь алдаа.
  //    `PROJECT_LIST_SQL` нь мөн `asr_only` / `is_pending` шүүлтийг
  //    ЗӨВӨӨР хийдэг тул эрхийн давхардсан логик ч хэрэггүй.
  const canAll = canSeeAllProjects(role);
  const sub = ctx.identity.userId ?? 0;
  const stmt = ctx.env.DB.prepare(PROJECT_LIST_SQL(!canAll, seesPending(role)));
  const bound = canAll ? stmt.bind(sub, sub, sub) : stmt.bind(sub, sub, sub, sub);
  const { results } = await bound.all<{
    id: number;
    name: string;
    status: string | null;
    progress: number | null;
    finish_date: string | null;
  }>();

  const rows = (results ?? [])
    .filter((r) => r.status === 'active' && typeof r.finish_date === 'string' && r.finish_date >= today)
    .map((r) => ({
      id: r.id,
      name: r.name,
      finish_date: r.finish_date,
      progress_percent: Math.round(Number(r.progress ?? 0) * 10) / 10,
      // ⚠️ Өдрийн зөрүүг СЕРВЕР бодно — загвар огноо хасаж болохгүй.
      days_remaining: daysBetween(today, r.finish_date as string),
    }))
    .filter((r) => r.days_remaining !== null && r.days_remaining <= days)
    .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))
    .slice(0, Math.max(1, Math.min(50, limit)));

  return {
    ok: true,
    data: { today, window_days: days, count: rows.length, projects: rows },
    note:
      rows.length === 0
        ? 'Энэ хугацаанд дуусах төсөл алга (эсвэл паспортад дуусах огноо бөглөөгүй).'
        : 'Өдрийн зөрүүг сервер бодов.',
  };
}

async function getOverdueTasks(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const wantAll = args.scope === 'all';
  const isAdmin = ctx.identity.mode === 'admin';
  // ⚠️ `all` нь ЗӨВХӨН админд.  Ажилтан хүсвэл чимээгүй `mine` рүү унана —
  //    403 биш, учир нь энэ бол загварын сонголт, хэрэглэгчийн хүсэлт биш.
  const scopeAll = wantAll && isAdmin;
  const limit = typeof args.limit === 'number' ? args.limit : 20;
  const today = todayInUB();
  const sub = ctx.identity.userId ?? 0;

  const mineClause = scopeAll
    ? ''
    : `AND (t.assigned_to = ? OR EXISTS (
           SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))`;

  const sql = `
    SELECT t.id, t.name, t.due_date, p.id AS project_id, p.name AS project_name,
           COALESCE((SELECT pe.percentage FROM progress_entries pe
                      WHERE pe.task_id = t.id AND pe.status = 'approved'
                      ORDER BY pe.date DESC, pe.created_at DESC, pe.id DESC
                      LIMIT 1), 0) AS pct
      FROM tasks t
      JOIN components comp ON comp.id = t.component_id
      JOIN drawings d ON d.id = comp.drawing_id
      JOIN blocks b ON b.id = d.block_id
      JOIN projects p ON p.id = b.project_id
     WHERE p.status = 'active'
       AND t.due_date IS NOT NULL
       AND t.due_date < ?
       ${mineClause}
     ORDER BY t.due_date ASC
     LIMIT ?`;

  const cap = Math.max(1, Math.min(100, limit));
  const stmt = ctx.env.DB.prepare(sql);
  const bound = scopeAll ? stmt.bind(today, cap) : stmt.bind(today, sub, sub, cap);
  const { results } = await bound.all<{
    id: number;
    name: string;
    due_date: string;
    project_id: number;
    project_name: string;
    pct: number;
  }>();

  const rows = (results ?? [])
    .filter((r) => Number(r.pct ?? 0) < 100)
    .map((r) => ({
      task_id: r.id,
      task: r.name,
      project_id: r.project_id,
      project: r.project_name,
      due_date: r.due_date,
      days_overdue: (() => {
        const d = daysBetween(r.due_date, today);
        return d === null ? null : Math.max(0, d);
      })(),
      progress_percent: Math.round(Number(r.pct ?? 0)),
    }));

  return {
    ok: true,
    data: { today, scope: scopeAll ? 'all' : 'mine', count: rows.length, tasks: rows },
  };
}

async function getMyAssignments(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const sub = ctx.identity.userId;
  if (sub === null) return { ok: false, data: null, error: 'Нэвтрээгүй хэрэглэгч.' };
  const limit = Math.max(1, Math.min(100, typeof args.limit === 'number' ? args.limit : 25));

  const { results } = await ctx.env.DB.prepare(
    `SELECT t.id, t.name, t.due_date, p.id AS project_id, p.name AS project_name,
            COALESCE((SELECT pe.percentage FROM progress_entries pe
                       WHERE pe.task_id = t.id AND pe.status = 'approved'
                       ORDER BY pe.date DESC, pe.created_at DESC, pe.id DESC
                       LIMIT 1), 0) AS pct
       FROM tasks t
       JOIN components comp ON comp.id = t.component_id
       JOIN drawings d ON d.id = comp.drawing_id
       JOIN blocks b ON b.id = d.block_id
       JOIN projects p ON p.id = b.project_id
      WHERE p.status = 'active'
        AND (t.assigned_to = ? OR EXISTS (
             SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))
      ORDER BY (t.due_date IS NULL), t.due_date ASC
      LIMIT ?`,
  )
    .bind(sub, sub, limit)
    .all<{
      id: number;
      name: string;
      due_date: string | null;
      project_id: number;
      project_name: string;
      pct: number;
    }>();

  const rows = (results ?? []).map((r) => ({
    task_id: r.id,
    task: r.name,
    project_id: r.project_id,
    project: r.project_name,
    due_date: r.due_date,
    progress_percent: Math.round(Number(r.pct ?? 0)),
  }));

  return { ok: true, data: { count: rows.length, tasks: rows, as_of: todayInUB() } };
}

async function getProjectProgress(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const id = typeof args.project_id === 'number' ? args.project_id : 0;
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, data: null, error: 'project_id буруу.' };
  }

  // ⚠️ ЭРХИЙН ХААЛТ: захиалагч ба гишүүнчлэлээр хязгаарлагдсан хэрэглэгч
  //    зөвхөн өөрийн төслийг харна.  `projectIds` нь дуудагчийн бэлдсэн
  //    ERP-ийн үнэн — энэ функц түүнийг ЭРГЭЛЗЭЛГҮЙ дагана.
  const canAll = canSeeAllProjects(ctx.identity.role);
  if (!canAll && !ctx.projectIds.includes(id)) {
    return { ok: false, data: null, error: 'Энэ төсөлд хандах эрхгүй.' };
  }

  const stmt = ctx.env.DB.prepare(PROJECT_LIST_SQL(false, seesPending(ctx.identity.role)));
  const sub = ctx.identity.userId ?? 0;
  const { results } = await stmt.bind(sub, sub, sub).all<{
    id: number;
    name: string;
    status: string | null;
    progress: number | null;
    team_progress_json: string | null;
    finish_date: string | null;
  }>();

  const row = (results ?? []).find((r) => r.id === id);
  if (!row) return { ok: false, data: null, error: 'Төсөл олдсонгүй.' };

  let teams: unknown = [];
  if (typeof row.team_progress_json === 'string') {
    try {
      teams = JSON.parse(row.team_progress_json);
    } catch {
      teams = [];
    }
  }

  return {
    ok: true,
    data: {
      id: row.id,
      name: row.name,
      status: row.status,
      progress_percent: Math.round(Number(row.progress ?? 0) * 10) / 10,
      finish_date: row.finish_date,
      teams,
      as_of: todayInUB(),
    },
    note: 'Жигнэсэн явц — PROJECT_LIST_SQL-ийн ижил тооцоо.',
  };
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Хайлтын хэрэгслүүд                                                  */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭДГЭЭР НЬ `/context`-ИЙН АВТОМАТ ХАЙЛТЫГ СОЛИХГҮЙ.  `/context` нь
 *    асуулт бүрд хайлт хийж prompt-д нотолгоо тавьдаг.  Эдгээр нь загвар
 *    өөрөө «дахин, өөр үгээр хай» гэж шийдэх ҮЕД зориулагдсан —
 *    tool-calling сургалт хийгдмэгц (1.1) бүрэн идэвхжинэ.
 *
 * ⚠️ ГЭХДЭЭ ОДООНООС АЖИЛЛАНА.  Бүртгэлд байгаа мөртлөө гүйцэтгэгчгүй
 *    хэрэгсэл нь «энэ хэрэгслийг дуудна» гэсэн ХУДАЛ тайлбартай болно
 *    (`registry.test.ts` тэрийг барина).
 *
 * ⚠️ ШҮҮЛТ ЗААВАЛ.  `lexicalSearch` нь ШҮҮЛТГҮЙ буцаадаг тул энд
 *    `filterEvidence`-ийг дуудна — эс тэгвэл захиалагч нууц баримт харна.
 */
async function runSearch(
  ctx: ToolContext,
  args: Record<string, unknown>,
  sourceKinds: readonly string[] | undefined,
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query : '';
  if (query.trim().length === 0) return { ok: false, data: null, error: 'query хоосон.' };
  const topK = typeof args.top_k === 'number' ? args.top_k : 6;

  const raw = await lexicalSearch(ctx.env, query, {
    limit: Math.max(12, topK * 3),
    sourceKinds,
  });

  const viewer: Viewer = {
    mode: ctx.identity.mode,
    role: ctx.identity.role,
    userId: ctx.identity.userId,
    projectIds: ctx.projectIds,
    orgId: ctx.orgId ?? null,
  };
  const { kept, dropped } = filterEvidence(raw, viewer);

  return {
    ok: true,
    data: {
      count: kept.length,
      results: kept.slice(0, topK).map((e) => ({
        id: e.id,
        title: e.title,
        document_uid: e.documentUid,
        clause_uid: e.clauseUid,
        page: e.page,
        section: e.section,
        text: e.text,
      })),
    },
    note:
      kept.length === 0
        ? 'Баталгаажсан эх сурвалж олдсонгүй — дүрэм ЗОХИОХГҮЙ.'
        : `${kept.length} эх сурвалж (${dropped.length} эрхээр хасагдсан).`,
  };
}

/** Норм, стандарт (БНбД, БД, MNS) -аас хайх. */
async function searchRegulations(ctx: ToolContext, args: Record<string, unknown>) {
  return runSearch(ctx, args, ['regulation']);
}

/** Компанийн архиваас хайх — захиалагчид бүртгэлээр ХААЛТТАЙ. */
async function searchCompanyDocuments(ctx: ToolContext, args: Record<string, unknown>) {
  return runSearch(ctx, args, ['company_doc', 'project_doc', 'handbook', 'upload']);
}

export type ToolExecutor = (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * ⚠️ НЭР → ФУНКЦ.  Бүртгэлд (`registry.ts`) байгаа ч энд байхгүй нэр нь
 *    ажиллах үед `not_implemented` өгнө — тестээр хаагдсан, тул хэрэгсэл
 *    зарлаад хэрэгжүүлэхээ мартах нь ЧИМЭЭГҮЙ өнгөрөхгүй.
 */
export const ERP_EXECUTORS: Record<string, ToolExecutor> = {
  get_active_employees: getActiveEmployees,
  list_projects: listProjects,
  get_upcoming_deadlines: getUpcomingDeadlines,
  get_overdue_tasks: getOverdueTasks,
  get_my_assignments: getMyAssignments,
  get_project_progress: getProjectProgress,
  search_regulations: searchRegulations,
  search_company_documents: searchCompanyDocuments,
  describe_system: describeSystem,
  get_employee_activity: getEmployeeActivity,
  analyze_project: analyzeProject,
  query_entities: queryEntities,
};
