/**
 * MGL AI · ШИНЖИЛГЭЭНИЙ БА СИСТЕМИЙН ХЭРЭГСЛҮҮД (§10, §15, §17, §34).
 *
 * Дөрвөн хэрэгсэл, дөрвөн өөр цоорхойг хаана (хэмжигдсэн 2026-09-10):
 *
 *   describe_system        «манай сайт юу агуулдаг вэ» — загвар САНАХУЙГААС
 *                          зохиодог байв.  Одоо frontend-ээс үүсгэсэн
 *                          каталогийг хэрэглэгчийн РОЛИОР шүүж буцаана.
 *   get_employee_activity  «хамгийн идэвхтэй ажилтан хэн бэ» — ажилтны ТОО
 *                          л байсан тул «senior» гэж хариулдаг байв.  Одоо
 *                          ИЛ ТОД шинжилгээний хэмжүүр (§17): албан ёсны KPI
 *                          биш гэдгийг `metric_definition`-д бичиж буцаана.
 *   analyze_project        «энэ төсөл яагаад удаад байна» — зөвхөн явцын
 *                          хувь хараад шалтгаан зохиодог байв.  Одоо
 *                          БАРИМТ (хоцорсон, зогссон, эзэнгүй даалгавар,
 *                          сүүлийн хөдөлгөөн) ба ДҮГНЭЛТИЙН САНАА тусдаа.
 *   query_entities         Каталогийн дурын entity-г бүтэцтэй асуулгаар —
 *                          урьдчилан бичээгүй асуултын зам (§9, §12).
 *
 * ⚠️ АРИФМЕТИК СЕРВЕР ДЭЭР (§25).  Хоног, хувь, эрэмбэ бүгд энд бодогдоно.
 * ⚠️ ДҮГНЭЛТ ≠ БАРИМТ (§34).  `facts` нь тоо, `signals` нь «магадгүй»
 *    гэсэн санаа — загвар тэднийг тус тусад нь хэлэх ёстой.
 */
import { todayInUB } from '../../time';
import { compileQuery, runQuery } from '../gateway/query';
import type { ScopeCtx } from '../gateway/entities';
import { SYSTEM_PAGES } from '../systemCatalog.generated';
import { isAdminRole } from '../../../types';
import type { ToolContext, ToolResult } from './erp';
import { daysBetween } from './erp';

function scopeOf(ctx: ToolContext): ScopeCtx | null {
  if (ctx.identity.mode === 'denied') return null;
  const role = ctx.identity.role;
  const canAll =
    role !== null && (isAdminRole(role) || role === 'engineer' || role === 'architect' || role === 'senior');
  return {
    mode: ctx.identity.mode,
    userId: ctx.identity.userId ?? 0,
    canSeeAllProjects: canAll,
    seesPending: role !== null && (isAdminRole(role) || role === 'senior'),
    today: todayInUB(),
  };
}

/* ------------------------------------------------------------------ */
/*  describe_system                                                     */
/* ------------------------------------------------------------------ */

export async function describeSystem(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const role = ctx.identity.role ?? 'client';
  const topic = typeof args.topic === 'string' ? args.topic.toLowerCase().trim() : '';
  // ⚠️ РОЛИОР ШҮҮНЭ — захиалагч админы цэсийг мэдэх ёсгүй (§7).
  const pages = SYSTEM_PAGES.filter((p) => (p.roles as readonly string[]).includes(role)).map((p) => ({
    path: p.path,
    title_mn: p.labelMn,
    title_en: p.labelEn,
    subpages: p.children
      .filter((c) => !c.roles || (c.roles as readonly string[]).includes(role))
      .map((c) => ({ path: c.to, title_mn: c.labelMn })),
    sections: p.sections
      .filter((s) => !s.roles || (s.roles as readonly string[]).includes(role))
      .map((s) => s.labelMn),
  }));
  // Дэд хуудсыг ч тулгана: «Дотоод журам» 2026-09-23-наас «Нийтийн мэдээлэл»-ийн
  // дэд хуудас болсон тул зөвхөн эцгийн гарчгаар шүүвэл «журам» гэхэд олдохгүй.
  const filtered = topic
    ? pages.filter(
        (p) =>
          p.title_mn.toLowerCase().includes(topic) ||
          p.title_en.toLowerCase().includes(topic) ||
          p.subpages.some((s) => s.title_mn.toLowerCase().includes(topic)) ||
          p.sections.some((s) => s.toLowerCase().includes(topic)),
      )
    : pages;
  return {
    ok: true,
    data: {
      system: 'MGL ERP (вэб апп)',
      role,
      page_count: filtered.length,
      pages: filtered,
      source: 'Аппын цэс ба хуудасны бүртгэл (frontend NAV_ITEMS + APP_SECTIONS), хэрэглэгчийн ролиор шүүсэн.',
    },
    note: 'Системийн бүтэц — бүртгэлээс, загварын санахуйгаас биш.',
  };
}

/* ------------------------------------------------------------------ */
/*  get_employee_activity                                               */
/* ------------------------------------------------------------------ */

interface ActivityData {
  metric_definition: string;
  official_kpi: false;
  window: { from: string; to: string; days: number };
  population: number;
  with_activity: number;
  ranking: unknown[];
  ranking_reliable: boolean;
  window_widened_from_days?: number;
}

const ACTIVITY_METRIC_MN =
  'Идэвхийн оноо = сүүлийн N хоногийн: батлагдсан явцын бүртгэл (×1) + ирсэн өдөр (×1) + ' +
  'зохиогчийн хяналтын тайлан (×2) + засварын ажлын цаг (×0.25). ' +
  'Энэ бол ШИНЖИЛГЭЭНИЙ хэмжүүр — компанийн албан ёсны KPI биш.';

export async function getEmployeeActivity(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const days = typeof args.days === 'number' ? Math.max(1, Math.min(365, args.days)) : 30;
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, args.limit)) : 10;
  const teamCode = typeof args.team_code === 'string' ? args.team_code.toUpperCase() : null;
  const first = await activityWindow(ctx, days, limit, teamCode);
  // ⚠️ ЦОНХ ХООСОН БОЛ НЭГ УДАА ӨРГӨСГӨНӨ (30 → 90).  Хэмжигдсэн: локал
  //    хуулбар дээр сүүлийн 30 хоногт хэн ч бүртгэл хийгээгүй байсан тул
  //    «идэвхтэй ажилтан» гэсэн асуултад хоосон эрэмбэ буцаж байв.  Өргөсгөсөн
  //    гэдгээ ИЛ мэдээлнэ — хэрэглэгч 30 хоног асуусан бол тэр нь 0 гэдгийг
  //    мэдэх ёстой.
  if (first.data.with_activity < 3 && days < 90) {
    const wide = await activityWindow(ctx, 90, limit, teamCode);
    if (wide.data.with_activity > first.data.with_activity) {
      return {
        ...wide,
        data: { ...wide.data, window_widened_from_days: days },
        note: `Сүүлийн ${days} хоногт идэвх ${first.data.with_activity} хүнд л байсан тул цонхыг 90 хоног болгов — албан ёсны KPI биш.`,
      };
    }
  }
  return first;
}

async function activityWindow(
  ctx: ToolContext,
  days: number,
  limit: number,
  teamCode: string | null,
): Promise<ToolResult & { data: ActivityData }> {
  const today = todayInUB();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

  // ⚠️ Нэг асуулга — ажилтан бүрд дөрвөн тоолуур.  `is_support = 0`:
  //    TV бүртгэл гэх мэт туслах хэрэглэгч эрэмбэд орохгүй.
  const sql = `
    SELECT u.id, u.full_name, u.role, u.position, tm.code AS team_code,
           (SELECT COUNT(*) FROM progress_entries pe
             WHERE pe.user_id = u.id AND pe.status = 'approved' AND COALESCE(pe.source, '') <> 'alloc_adj' AND pe.date >= ?) AS progress_entries,
           (SELECT COUNT(DISTINCT pe2.task_id) FROM progress_entries pe2
             WHERE pe2.user_id = u.id AND pe2.status = 'approved' AND COALESCE(pe2.source, '') <> 'alloc_adj' AND pe2.date >= ?) AS tasks_touched,
           (SELECT COUNT(DISTINCT a.date) FROM attendance_sessions a
             WHERE a.user_id = u.id AND a.date >= ?) AS days_present,
           (SELECT COUNT(DISTINCT r.id) FROM author_supervision_reports r
             LEFT JOIN asr_report_companions c ON c.report_id = r.id AND c.user_id = u.id
             WHERE r.status IN ('submitted','approved')
               AND COALESCE(r.submitted_at, r.report_date) >= ?
               AND (r.author_id = u.id OR c.user_id IS NOT NULL)) AS asr_reports,
           (SELECT COALESCE(SUM(re.hours), 0) FROM repair_entries re
             WHERE re.user_id = u.id AND re.date >= ?) AS repair_hours,
           (SELECT MAX(pe3.date) FROM progress_entries pe3
             WHERE pe3.user_id = u.id AND pe3.status = 'approved' AND COALESCE(pe3.source, '') <> 'alloc_adj') AS last_progress_date
      FROM users u
      LEFT JOIN teams tm ON tm.id = COALESCE(
        (SELECT ut.team_id FROM user_teams ut WHERE ut.user_id = u.id ORDER BY ut.is_primary DESC, ut.id ASC LIMIT 1),
        u.team_id)
     WHERE u.status = 'active' AND u.role <> 'client' AND COALESCE(u.is_support, 0) = 0
       ${teamCode ? 'AND tm.code = ?' : ''}`;
  const binds: unknown[] = [from, from, from, from, from];
  if (teamCode) binds.push(teamCode);

  const { results } = await ctx.env.DB.prepare(sql)
    .bind(...binds)
    .all<{
      id: number;
      full_name: string;
      role: string;
      position: string | null;
      team_code: string | null;
      progress_entries: number;
      tasks_touched: number;
      days_present: number;
      asr_reports: number;
      repair_hours: number;
      last_progress_date: string | null;
    }>();

  const scored = (results ?? []).map((r) => {
    const score =
      Number(r.progress_entries ?? 0) +
      Number(r.days_present ?? 0) +
      Number(r.asr_reports ?? 0) * 2 +
      Number(r.repair_hours ?? 0) * 0.25;
    return {
      user_id: r.id,
      name: r.full_name,
      role: r.role,
      position: r.position,
      team_code: r.team_code,
      progress_entries: Number(r.progress_entries ?? 0),
      tasks_touched: Number(r.tasks_touched ?? 0),
      days_present: Number(r.days_present ?? 0),
      asr_reports: Number(r.asr_reports ?? 0),
      repair_hours: Math.round(Number(r.repair_hours ?? 0) * 10) / 10,
      last_progress_date: r.last_progress_date,
      activity_score: Math.round(score * 10) / 10,
    };
  });
  scored.sort((a, b) => b.activity_score - a.activity_score || a.name.localeCompare(b.name));
  const active = scored.filter((s) => s.activity_score > 0);

  return {
    ok: true,
    data: {
      metric_definition: ACTIVITY_METRIC_MN,
      official_kpi: false,
      window: { from, to: today, days },
      population: scored.length,
      with_activity: active.length,
      // ⚠️ Оноо 0 хүн эрэмбэд ОРОХГҮЙ — тэднийг цагаан толгойгоор эрэмбэлэх нь
      //    «test» гэсэн хэрэглэгчийг «хамгийн идэвхтэй» болгож байсан.
      ranking: active.slice(0, limit),
      // ⚠️ Өгөгдөл сийрэг бол эрэмбэ хийхгүй байх нь зөв (§17).
      ranking_reliable: active.length >= 3,
    },
    note:
      active.length === 0
        ? `Сүүлийн ${days} хоногт нэг ч ажилтанд бүртгэгдсэн идэвх алга — эрэмбэ хийх боломжгүй.`
        : `Сүүлийн ${days} хоногийн явц, ирц, тайлан, засварын бүртгэлээс тооцов — албан ёсны KPI биш.`,
  };
}

/* ------------------------------------------------------------------ */
/*  analyze_project                                                     */
/* ------------------------------------------------------------------ */

export async function analyzeProject(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const id = typeof args.project_id === 'number' ? args.project_id : 0;
  if (!Number.isInteger(id) || id <= 0) return { ok: false, data: null, error: 'project_id буруу.' };
  const scope = scopeOf(ctx);
  if (!scope) return { ok: false, data: null, error: 'Хандах эрхгүй.' };
  const today = scope.today;
  const staleBefore = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);

  // 1. Төсөл өөрөө — харагдацын ЯГ дүрмээр (эрхгүй бол 0 мөр).
  const pq = compileQuery(
    { entity: 'projects', filters: [{ field: 'id', op: 'eq', value: id }], limit: 1 },
    scope,
  );
  if (!pq.ok) return { ok: false, data: null, error: pq.error };
  const pr = await runQuery(ctx.env, pq.query);
  const project = pr.rows[0];
  if (!project) return { ok: false, data: null, error: 'Төсөл олдсонгүй эсвэл хандах эрхгүй.' };

  // 2. Даалгаврын тоолуурууд — нэг entity, дөрвөн асуулга.
  const q = (extra: object) =>
    compileQuery({ entity: 'tasks', filters: [{ field: 'project_id', op: 'eq', value: id }], ...extra }, scope);
  const run = async (c: ReturnType<typeof compileQuery>) => {
    if (!c.ok) throw new Error(c.error);
    return runQuery(ctx.env, c.query);
  };
  const [total, done, overdue, stale, unassigned, recent, pending] = await Promise.all([
    run(q({ aggregate: [{ fn: 'count' }] })),
    run(q({ filters: [{ field: 'project_id', op: 'eq', value: id }, { field: 'progress', op: 'gte', value: 100 }], aggregate: [{ fn: 'count' }] })),
    run(
      q({
        filters: [{ field: 'project_id', op: 'eq', value: id }, { field: 'is_overdue', op: 'eq', value: true }],
        fields: ['id', 'name', 'block_name', 'team_code', 'assignees', 'due_date', 'days_overdue', 'progress'],
        sort: { field: 'days_overdue', dir: 'desc' },
        limit: 10,
      }),
    ),
    run(
      q({
        filters: [
          { field: 'project_id', op: 'eq', value: id },
          { field: 'progress', op: 'lt', value: 100 },
          { field: 'progress', op: 'gt', value: 0 },
          { field: 'last_progress_date', op: 'lt', value: staleBefore },
        ],
        aggregate: [{ fn: 'count' }],
      }),
    ),
    run(
      q({
        filters: [
          { field: 'project_id', op: 'eq', value: id },
          { field: 'progress', op: 'lt', value: 100 },
          { field: 'assignee_count', op: 'eq', value: 0 },
        ],
        aggregate: [{ fn: 'count' }],
      }),
    ),
    run(
      compileQuery(
        {
          entity: 'progress_entries',
          filters: [{ field: 'project_id', op: 'eq', value: id }, { field: 'status', op: 'eq', value: 'approved' }],
          sort: { field: 'date', dir: 'desc' },
          fields: ['date', 'user_name', 'task_name', 'percentage'],
          limit: 5,
        },
        scope,
      ),
    ),
    run(
      compileQuery(
        {
          entity: 'progress_entries',
          filters: [{ field: 'project_id', op: 'eq', value: id }, { field: 'status', op: 'eq', value: 'pending' }],
          aggregate: [{ fn: 'count' }],
        },
        scope,
      ),
    ),
  ]);

  const n = (r: { rows: Record<string, unknown>[] }) => Number(r.rows[0]?.count ?? 0);
  const totalTasks = n(total);
  const doneTasks = n(done);
  const overdueTotal = overdue.total_matching ?? overdue.returned;
  const staleTasks = n(stale);
  const unassignedTasks = n(unassigned);
  const pendingApprovals = n(pending);
  const lastActivity = (recent.rows[0]?.date as string | undefined) ?? null;
  const daysSinceActivity = lastActivity ? daysBetween(lastActivity, today) : null;

  // Багийн задаргаа — хоцролт багаар.
  const byTeam = await run(
    q({
      filters: [{ field: 'project_id', op: 'eq', value: id }, { field: 'is_overdue', op: 'eq', value: true }],
      group_by: 'team_code',
      aggregate: [{ fn: 'count' }],
    }),
  );

  const progress = Number(project.progress ?? 0);
  const finish = typeof project.finish_date === 'string' ? project.finish_date : null;
  const daysRemaining = finish ? daysBetween(today, finish) : null;

  // ⚠️ ДҮГНЭЛТИЙН САНАА — «магадгүй» гэсэн шинж тэмдэг, баримт биш (§34).
  const signals: string[] = [];
  if (overdueTotal > 0) signals.push(`${overdueTotal} даалгаврын хугацаа хэтэрсэн`);
  if (staleTasks > 0) signals.push(`${staleTasks} даалгавар 14+ хоног явцгүй зогссон`);
  if (unassignedTasks > 0) signals.push(`${unassignedTasks} дуусаагүй даалгавар хариуцагчгүй`);
  if (pendingApprovals > 0) signals.push(`${pendingApprovals} явцын бүртгэл батлагдахаа хүлээж байна`);
  if (daysSinceActivity !== null && daysSinceActivity > 7) signals.push(`сүүлийн батлагдсан явц ${daysSinceActivity} хоногийн өмнө`);
  if (daysRemaining !== null && daysRemaining >= 0 && progress < 50 && daysRemaining < 30)
    signals.push(`дуусахад ${daysRemaining} хоног үлдсэн атлаа явц ${progress}%`);
  const topTeam = byTeam.rows[0];
  if (topTeam && Number(topTeam.count) > 0) signals.push(`хоцролт хамгийн их баг: ${String(topTeam.team_code ?? '?')} (${Number(topTeam.count)})`);

  return {
    ok: true,
    data: {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        category: project.category,
        progress_percent: progress,
        finish_date: finish,
        days_remaining: daysRemaining,
      },
      facts: {
        tasks_total: totalTasks,
        tasks_done: doneTasks,
        tasks_overdue: overdueTotal,
        tasks_stale_14d: staleTasks,
        tasks_unassigned_open: unassignedTasks,
        pending_approvals: pendingApprovals,
        last_approved_progress_date: lastActivity,
        days_since_last_progress: daysSinceActivity,
        overdue_by_team: byTeam.rows.map((r) => ({ team_code: r.team_code ?? null, overdue: Number(r.count) })),
        overdue_examples: overdue.rows,
        recent_progress: recent.rows,
      },
      signals,
      signals_are_inference: true,
      as_of: today,
    },
    note:
      signals.length === 0
        ? 'Хоцролтын тодорхой шинж тэмдэг олдсонгүй.'
        : `${signals.length} шинж тэмдэг — баримт ба дүгнэлтийг ялгаж хэл.`,
  };
}

/* ------------------------------------------------------------------ */
/*  query_entities                                                      */
/* ------------------------------------------------------------------ */

export async function queryEntities(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const scope = scopeOf(ctx);
  if (!scope) return { ok: false, data: null, error: 'Хандах эрхгүй.' };
  const raw = args.query ?? args;
  const compiled = compileQuery(raw, scope);
  if (!compiled.ok) return { ok: false, data: null, error: compiled.error };
  const result = await runQuery(ctx.env, compiled.query);
  const unfiltered = !!(raw && typeof raw === 'object' && (raw as { unfiltered_retry?: unknown }).unfiltered_retry === true);
  return {
    ok: true,
    data: unfiltered
      ? {
          ...result,
          // ⚠️ Загварт ИЛ: асуусан хугацаанд өгөгдөл байгаагүй тул энэ нь БҮХ хугацааны дүн.
          scope_note: 'Асуусан хугацаа/шүүлтэд өгөгдөл олдоогүй тул энэ нь ШҮҮЛТГҮЙ, бүх хугацааны дүн — хариултад үүнийг заавал хэл.',
        }
      : result,
    note:
      result.total_matching !== null && result.truncated
        ? `${result.total_matching} мөрөөс эхний ${result.returned}-ийг харуулав.`
        : `${result.returned} мөр (${result.authority}).`,
  };
}
