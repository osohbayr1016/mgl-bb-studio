import { Hono } from 'hono';
import type { Env, AppVariables, UserRow, ProjectRow } from '../types';
import { todayInUB } from '../lib/time';
import { latestApprovedPctByDate } from '../lib/progressLatest';
import { categoryLabelOf, entryStage, type NonProjectStatus } from '../lib/nonProjectWork';

/** Row shape of the assigned-tasks SELECT in GET /:id/tasks below. */
interface AssignedTaskRow {
  id: number;
  name: string;
  weight_percent: number;
  due_date: string | null;
  start_date: string | null;
  item_type: 'task';
  component_id: number;
  component_name: string;
  drawing_id: number;
  drawing_name: string;
  block_id: number;
  block_name: string;
  project_id: number;
  project_name: string;
  project_status: ProjectRow['status'];
}

/* =============================================================
 * Public profile viewing endpoints.
 *
 * Unlike /api/users (admin-only CRUD), these endpoints let ANY
 * authenticated user look up a coworker's basic profile + their
 * current assignments. Activity (daily reports) is guarded:
 *   - Admin / senior can view anyone's activity
 *   - Anyone else can only view their own
 * ============================================================= */

const profiles = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* Бөөрөнхийлөх туслахууд — `routes/leaderboard.ts`-ийн `round1`/`round2`-ын
 * яг хуулбар (тэнд export хийгдээгүй бөгөөд leaderboard.ts → progress.ts
 * гинжийг энд татахаас зайлсхийв).  Хоёр газар ижил дүрмээр бөөрөнхийлж
 * байж «Тэргүүлэгчид» ба «Профайл»-ын тоо зөрөхгүй. */

/** Оноон дүнд нэг орон хангалттай. */
function round1(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 10) / 10;
}

/** Хувь нэмрийн хувь (`delta_pct`) нь 0.03% гэх мэт жижиг утгатай байдаг тул
 *  хоёр орон — нэг орноор бөөрөнхийлбөл олон хүн «0» болж алга болно. */
function round2(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 100) / 100;
}

// ---- GET /api/profiles/:id — coworker profile card ----
profiles.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  // `u.social_links` энд ЗОРИУДААР байхгүй — сошиал холбоос бүтээгдэхүүнээс
  // хасагдсан.  Багана нь DB-д үлдсэн (users-ийг rebuild хийхгүйн тулд), гэхдээ
  // уншихаа больсон.  Бичих зам нь мөн хаагдсан (auth.ts PATCH /profile).
  const row = await c.env.DB.prepare(
    `
    SELECT u.id, u.username, u.full_name, u.role, u.status,
           u.profile_image, u.cover_image, u.signature_url, u.bio, u.description,
           u.team_id, u.position, u.employee_id, u.created_at,
           pt.code AS team_code, pt.name_mn AS team_name_mn, pt.name_en AS team_name_en
    FROM users u
    LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
    LEFT JOIN teams pt ON pt.id = ut_p.team_id
    WHERE u.id = ?
  `,
  )
    .bind(id)
    .first<Omit<UserRow, 'password_hash' | 'social_links'>>();

  if (!row) return c.json({ error: 'User not found' }, 404);

  const { results: teamRows } = await c.env.DB.prepare(
    `SELECT t.id, t.code, t.name_mn, t.name_en, ut.is_primary
     FROM user_teams ut
     JOIN teams t ON t.id = ut.team_id
     WHERE ut.user_id = ?
     ORDER BY ut.is_primary DESC, t.sort_order`,
  )
    .bind(id)
    .all<{
      id: number;
      code: string;
      name_mn: string;
      name_en: string | null;
      is_primary: number;
    }>();

  return c.json({ user: { ...row, teams: teamRows ?? [] } });
});

// ---- GET /api/profiles/:id/tasks — active assignments + progress ----
// Returns the projects and tasks this user is currently assigned to,
// grouped by project. Useful on a coworker's profile to see "what are
// they working on right now?".
profiles.get('/:id/tasks', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const { results: tasks } = await c.env.DB.prepare(
    `
    SELECT
      t.id, t.name, t.weight_percent, t.due_date, t.start_date,
      'task' AS item_type,
      comp.id AS component_id, comp.name AS component_name,
      d.id AS drawing_id, d.name AS drawing_name,
      b.id AS block_id, b.name AS block_name,
      p.id AS project_id, p.name AS project_name, p.status AS project_status
    FROM tasks t
    JOIN components comp ON comp.id = t.component_id
    JOIN drawings d ON d.id = comp.drawing_id
    JOIN blocks b ON b.id = d.block_id
    JOIN projects p ON p.id = b.project_id
    WHERE (t.assigned_to = ? OR EXISTS (
            SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))
      AND p.status = 'active'
    ORDER BY p.name, b.sort_order, d.sort_order, comp.sort_order, t.sort_order
  `,
  )
    .bind(id, id)
    .all<AssignedTaskRow>();

  // Enrich each task with its latest approved %; cheap N+1 because the
  // assigned list is small (a handful of tasks per employee in practice).
  const today = todayInUB();
  const enrich = async (row: AssignedTaskRow) => {
    const approved = await c.env.DB.prepare(
      `SELECT percentage FROM progress_entries
       WHERE task_id = ? AND status = 'approved'
       ORDER BY date DESC, created_at DESC, id DESC LIMIT 1`,
    )
      .bind(row.id)
      .first<{ percentage: number }>();
    const todayRow = await c.env.DB.prepare(
      `SELECT id, is_rest_day, status, percentage FROM progress_entries
       WHERE task_id = ? AND user_id = ? AND date = ? AND COALESCE(source, '') <> 'alloc_adj'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
      .bind(row.id, id, today)
      .first<{ id: number; is_rest_day: 0 | 1; status: string; percentage: number }>();
    return {
      ...row,
      current_progress: approved?.percentage ?? 0,
      reported_today: !!todayRow,
      reported_today_rest: todayRow?.is_rest_day === 1,
      reported_today_status: todayRow?.status ?? null,
    };
  };

  const items = await Promise.all(tasks.map(enrich));

  // Group by project for display purposes.
  const byProject = new Map<
    number,
    {
      project_id: number;
      project_name: string;
      items: typeof items;
      avg_progress: number;
    }
  >();
  for (const it of items) {
    if (!byProject.has(it.project_id)) {
      byProject.set(it.project_id, {
        project_id: it.project_id,
        project_name: it.project_name,
        items: [],
        avg_progress: 0,
      });
    }
    byProject.get(it.project_id)!.items.push(it);
  }
  for (const p of byProject.values()) {
    const avg =
      p.items.reduce((s, it) => s + it.current_progress, 0) / (p.items.length || 1);
    p.avg_progress = Math.round(avg * 10) / 10;
  }

  const totalItems = items.length;
  const completed = items.filter((i) => i.current_progress >= 100).length;
  const inProgress = items.filter(
    (i) => i.current_progress > 0 && i.current_progress < 100,
  ).length;
  const notStarted = items.filter((i) => i.current_progress === 0).length;
  const reportedToday = items.filter((i) => i.reported_today).length;

  return c.json({
    items,
    projects: Array.from(byProject.values()),
    summary: {
      total: totalItems,
      completed,
      in_progress: inProgress,
      not_started: notStarted,
      today,
      reported_today: reportedToday,
      pending_today: Math.max(0, totalItems - completed - reportedToday),
    },
  });
});

// ---- GET /api/profiles/:id/activity — recent daily reports ----
// Admin / senior / self only. Returns the same shape as /progress/my.
profiles.get('/:id/activity', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const viewer = c.get('user');
  const isPrivileged = viewer.role === 'admin' || viewer.role === 'senior';
  const isSelf = viewer.sub === id;
  if (!isPrivileged && !isSelf) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Тааз 1000 — «Тайлан → Ажилтан»-ы «Бүх цаг» экспорт бүх бичлэгээ авдаг байх ёстой (өмнө нь 200).
  const limit = Math.min(parseInt(c.req.query('limit') ?? '60', 10) || 60, 1000);
  const from = c.req.query('from');
  const to = c.req.query('to');

  const conds = ['pe.user_id = ?'];
  const binds: (string | number)[] = [id];
  if (from) {
    conds.push('pe.date >= ?');
    binds.push(from);
  }
  if (to) {
    conds.push('pe.date <= ?');
    binds.push(to);
  }
  binds.push(limit);

  // project/block/component нэр + тухайн task-ийн ӨМНӨХ бичлэгтэй харьцуулсан
  // delta_pct (хэдэн хувь нэмэгдсэн).  delta нь limit цонхноос үл хамаарч зөв
  // байхын тулд бүх түүхээс шууд хамгийн ойрын өмнөх бичлэгийг хардаг.
  const { results } = await c.env.DB.prepare(
    `
    SELECT pe.*,
      t.name AS task_name,
      comp.id AS component_id, comp.name AS component_name,
      b.id AS block_id, b.name AS block_name,
      p.id AS project_id, p.name AS project_name,
      reviewer.full_name AS reviewer_name,
      pe.percentage - COALESCE((
        SELECT prev.percentage FROM progress_entries prev
        WHERE prev.task_id = pe.task_id
          AND (prev.date < pe.date OR (prev.date = pe.date AND prev.created_at < pe.created_at))
        ORDER BY prev.date DESC, prev.created_at DESC LIMIT 1
      ), 0) AS delta_pct
    FROM progress_entries pe
    LEFT JOIN tasks t ON t.id = pe.task_id
    LEFT JOIN components comp ON comp.id = t.component_id
    LEFT JOIN drawings d ON d.id = comp.drawing_id
    LEFT JOIN blocks b ON b.id = d.block_id
    LEFT JOIN projects p ON p.id = b.project_id
    LEFT JOIN users reviewer ON reviewer.id = pe.reviewed_by
    WHERE ${conds.join(' AND ')}
    ORDER BY pe.date DESC, pe.created_at DESC
    LIMIT ?
  `,
  )
    .bind(...binds)
    .all();

  return c.json({ entries: results });
});

// ---- GET /api/profiles/:id/hours-log — засвар + төслийн бус ажлын цаг ----
//
// Профайлын «Өдрийн тайлан» таб явцын бичлэгийн (`/:id/activity`) хажууд
// ЦАГААР бүртгэгддэг хоёр ажлыг өдрөөр нь харуулна (эзний хүсэлт 2026-09-28):
//   • `repairs`     — засварын бүртгэл (0114/0194/0348): цаг + тэр мөчийн
//                     өдрийн дундаж ханш (`weekly_avg_pct` — нэр нь түүхэн, 0196-аас
//                     хойш ӨДРИЙН ханш) + олгосон хувь (`computed_pct` = ханш × цаг / 8).
//                     0 цаг ногдсон «Ажилласан» тэмдэглэгээ ч (`kind = 'mark'`) —
//                     `GET /repair/my`-ийн ижил UNION, эс бөгөөс «тэмдэглэсэн ч
//                     цаггүй» өдөр алга болно.
//   • `non_project` — төслийн бус ажил (0342–0344/0356): минут + батлах үеийн
//                     ханш/олгосон хувь (хүлээгдэж буй мөрөнд NULL — зохиохгүй).
// Эрх нь `/:id/activity`-тэй ЯГ ижил.  Шинэ тооцоо ХИЙХГҮЙ — хадгалсан
// snapshot-уудыг л уншина (оноо нь дэвтэр, дахин бодвол түүх хөдөлнө).
// `?from=&to=` (сонголттой) — «Тайлан → Ажилтан»-ы «Явцын бичлэгүүд» картад
// засварын мөрүүдийг толгойн цонхоор авна (2026-09-28).
profiles.get('/:id/hours-log', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const viewer = c.get('user');
  const isPrivileged = viewer.role === 'admin' || viewer.role === 'senior';
  const isSelf = viewer.sub === id;
  if (!isPrivileged && !isSelf) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Тааз 1000 — «Тайлан → Ажилтан»-ы «Явцын бичлэгүүд» цонхоор (`from`/`to`) бүгдийг авна.
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '150', 10) || 150, 1), 1000);
  // Сонголттой огнооны муж (YYYY-MM-DD, хоёр тал нь орно) — гурван эх сурвалжид ижил.
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const from = c.req.query('from');
  const to = c.req.query('to');
  const range = (col: string) => {
    const conds: string[] = [];
    const binds: string[] = [];
    if (from && dateRe.test(from)) {
      conds.push(`${col} >= ?`);
      binds.push(from);
    }
    if (to && dateRe.test(to)) {
      conds.push(`${col} <= ?`);
      binds.push(to);
    }
    return { sql: conds.map((s) => ` AND ${s}`).join(''), binds };
  };
  const rRange = range('r.date');
  const mRange = range('m.date');
  const nRange = range('date');

  const [repairRes, npwRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT 'entry' AS kind, r.id, r.date, r.created_at, r.hours, r.hours_source,
              r.weekly_avg_pct AS daily_rate, r.rate_source, r.computed_pct, r.description,
              r.project_id, r.repair_project_id,
              COALESCE(p.name, rp.name) AS project_name,
              CASE WHEN r.repair_project_id IS NOT NULL THEN 1 ELSE 0 END AS is_repair_project,
              tk.id AS task_id, tk.name AS task_name
         FROM repair_entries r
         LEFT JOIN projects        p  ON p.id  = r.project_id
         LEFT JOIN repair_projects rp ON rp.id = r.repair_project_id
         LEFT JOIN tasks           tk ON tk.id = r.task_id
        WHERE r.user_id = ?${rRange.sql}
       UNION ALL
       SELECT 'mark' AS kind, m.id, m.date, m.marked_at AS created_at, 0 AS hours, 'auto' AS hours_source,
              m.daily_rate, m.rate_source, 0 AS computed_pct, '' AS description,
              m.project_id, m.repair_project_id,
              COALESCE(mp.name, mrp.name) AS project_name,
              CASE WHEN m.repair_project_id IS NOT NULL THEN 1 ELSE 0 END AS is_repair_project,
              mt.id AS task_id, mt.name AS task_name
         FROM repair_marks m
         LEFT JOIN projects        mp  ON mp.id  = m.project_id
         LEFT JOIN repair_projects mrp ON mrp.id = m.repair_project_id
         LEFT JOIN tasks           mt  ON mt.id  = m.task_id
        WHERE m.user_id = ? AND m.award_points = 1${mRange.sql}
          AND NOT EXISTS (SELECT 1 FROM repair_entries r2 WHERE r2.mark_id = m.id)
        ORDER BY date DESC, created_at DESC
        LIMIT ?`,
    )
      .bind(id, ...rRange.binds, id, ...mRange.binds, limit)
      .all<{
        kind: 'entry' | 'mark';
        id: number;
        date: string;
        created_at: string;
        hours: number;
        hours_source: 'manual' | 'auto' | 'backfill';
        daily_rate: number | null;
        rate_source: string | null;
        computed_pct: number | null;
        description: string | null;
        project_id: number | null;
        repair_project_id: number | null;
        project_name: string | null;
        is_repair_project: number;
        task_id: number | null;
        task_name: string | null;
      }>(),
    c.env.DB.prepare(
      `SELECT id, date, category, note, start_time, end_time, minutes, report, status,
              review_note, daily_rate, rate_source, computed_pct, created_at
         FROM non_project_work_entries
        WHERE user_id = ?${nRange.sql}
        ORDER BY date DESC, start_time DESC, id DESC
        LIMIT ?`,
    )
      .bind(id, ...nRange.binds, limit)
      .all<{
        id: number;
        date: string;
        category: string;
        note: string | null;
        start_time: string | null;
        end_time: string | null;
        minutes: number;
        report: string | null;
        status: NonProjectStatus;
        review_note: string | null;
        daily_rate: number | null;
        rate_source: string | null;
        computed_pct: number | null;
        created_at: string;
      }>(),
  ]);

  return c.json({
    repairs: (repairRes.results ?? []).map((r) => ({
      ...r,
      is_repair_project: r.is_repair_project === 1,
      // Хувиар бөглөснөөс нөхсөн мөр (0348 backfill) оноо авдаггүй — оноо нь тэр
      // бөглөлтөөр аль хэдийн орсон.  Ханш 0 гэж харуулбал «0% авсан» гэж
      // ойлгогдоно, тиймээс NULL.
      daily_rate: r.hours_source === 'backfill' ? null : r.daily_rate,
    })),
    non_project: (npwRes.results ?? []).map((r) => ({
      ...r,
      category_label: categoryLabelOf(r.category),
      stage: entryStage(r),
    })),
  });
});

// ---- GET /api/profiles/:id/stats — нэг хүний НАСАН ТУРШИЙН хувь нэмэр ----
//
// Admin / senior / self л харна (`/:id/activity`-тэй ижил хамгаалалт).
//
// ⚠️ Энэ endpoint нь `/:id/tasks`-аас ЯЛГААТАЙ: төслийн статусаар огт
//    шүүхгүй.  Төсөл 100%-д хүрмэгц автоматаар архивлагддаг
//    (`archiveProjectIfComplete`, routes/progress.ts) тул `p.status='active'`
//    шүүлт нь яг ДУУССАН ажлыг нь нуучихна.  Энд бүх түүхийг тоолно.
profiles.get('/:id/stats', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const viewer = c.get('user');
  const isPrivileged = viewer.role === 'admin' || viewer.role === 'senior';
  const isSelf = viewer.sub === id;
  if (!isPrivileged && !isSelf) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [taskRow, pointRow, projectRes, repairRow] = await Promise.all([
    // 1) Даалгавар.  «Дууссан» = тухайн task-ийн ХАМГИЙН СҮҮЛИЙН батлагдсан
    //    progress_entries мөрийн percentage >= 100 (teams.ts-ийн
    //    latest_task/task_prog CTE-ийн загвар).  Хуваарилалт нь хоёр
    //    замтай — хуучин `tasks.assigned_to` ба шинэ `task_assignees` —
    //    зөвхөн нэгийг нь уншвал legacy мөрүүд чимээгүйхэн алга болно.
    c.env.DB.prepare(
      `
      WITH latest_task AS (
    -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
    SELECT t.id AS task_id, ${latestApprovedPctByDate('t.id')} AS percentage
    FROM tasks t
  ),
      my_tasks AS (
        SELECT t.id AS task_id, COALESCE(lt.percentage, 0) AS progress
        FROM tasks t
        LEFT JOIN latest_task lt ON lt.task_id = t.id
        WHERE (t.assigned_to = ? OR EXISTS (
                SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))
      )
      SELECT
        COUNT(*)                                                        AS total,
        COALESCE(SUM(CASE WHEN progress >= 100 THEN 1 ELSE 0 END), 0)   AS completed,
        COALESCE(SUM(CASE WHEN progress > 0 AND progress < 100
                          THEN 1 ELSE 0 END), 0)                        AS in_progress
      FROM my_tasks
    `,
    )
      .bind(id, id)
      .first<{ total: number; completed: number; in_progress: number }>(),

    // 2) Оноо гарал үүслээр (`user_points.source`, миграци 0114).
    //    `repair / total` = «засварын ажлын хувь» — тухайн хүний нийт
    //    гаралтын хэдэн хувь нь засвар/нэмэлт ажлаас ирсэн бэ.
    c.env.DB.prepare(
      `
      SELECT
        COALESCE(SUM(amount), 0)                                          AS total,
        COALESCE(SUM(CASE WHEN source = 'progress' THEN amount ELSE 0 END), 0) AS progress,
        COALESCE(SUM(CASE WHEN source = 'repair'   THEN amount ELSE 0 END), 0) AS repair
      FROM user_points
      WHERE user_id = ?
    `,
    )
      .bind(id)
      .first<{ total: number; progress: number; repair: number }>(),

    // 3) Төсөл тус бүрийн хувь нэмэр.  `project_total_pct` нь тухайн төслийн
    //    БҮХ хувь нэмэрлэгчийн нийлбэр (UI «эзлэх хувь»-ийн туузыг зурна) —
    //    correlated subquery-гээр нэг л удаа авна, N+1 хийхгүй.
    //    ⚠️ GROUP BY нь ХОЁР баганаар (0194): `project_id` NULL байж болох
    //    болсон тул зөвхөн түүгээр бүлэглэвэл SQLite бүх NULL-ыг НЭГ бүлэг
    //    гэж үзэж, БҮХ засварын төслийн оноог нэг нэргүй мөр болгон нийлүүлнэ.
    //    Мөрийн ЯГ НЭГ нь дүүрэн (DB-ийн CHECK) тул хосоор бүлэглэхэд бүлэг
    //    бүр цор ганц эзэнтэй болно.
    //    ⚠️ source='progress' шүүлт ЗААВАЛ: засварын мөр мөн delta_pct
    //    бичдэг ч төслийн явцтай хамааралгүй (leaderboard.ts-ийн тайлбар).
    c.env.DB.prepare(
      `
      SELECT
        p.project_id,
        p.repair_project_id,
        COALESCE(pr.name, rp.name) AS project_name,
        CASE WHEN p.repair_project_id IS NOT NULL THEN 1 ELSE 0 END AS is_repair_project,
        SUM(CASE WHEN p.source = 'progress' THEN p.delta_pct ELSE 0 END) AS project_pct,
        COALESCE((
          SELECT SUM(CASE WHEN ap.source = 'progress' THEN ap.delta_pct ELSE 0 END)
          FROM user_points ap
          WHERE ap.project_id = p.project_id
        ), 0) AS project_total_pct,
        SUM(p.amount) AS total_points,
        COUNT(*)      AS award_count
      FROM user_points p
      LEFT JOIN projects        pr ON pr.id = p.project_id
      LEFT JOIN repair_projects rp ON rp.id = p.repair_project_id
      -- Төслийн бус ажлын оноо (0343) төсөлгүй тул «төслийн нөлөөлөл»-д
      -- хамаарахгүй — эс бөгөөс нэргүй «0%» мөр гарна.  Нийт оноонд (дээрх 2)
      -- хэвээр орно.
      WHERE p.user_id = ? AND p.source <> 'non_project'
      GROUP BY p.project_id, p.repair_project_id
      ORDER BY project_pct DESC, total_points DESC
    `,
    )
      .bind(id)
      .all<{
        project_id: number | null;
        repair_project_id: number | null;
        project_name: string | null;
        is_repair_project: number;
        project_pct: number | null;
        project_total_pct: number | null;
        total_points: number | null;
        award_count: number;
      }>(),

    // 4) Засварын бүртгэл (миграци 0114).
    c.env.DB.prepare(
      `
      SELECT
        COUNT(*)                        AS entry_count,
        COALESCE(SUM(hours), 0)         AS hours,
        COALESCE(SUM(computed_pct), 0)  AS computed_pct
      FROM repair_entries
      WHERE user_id = ?
    `,
    )
      .bind(id)
      .first<{ entry_count: number; hours: number; computed_pct: number }>(),
  ]);

  const pointsTotal = pointRow?.total ?? 0;
  const pointsRepair = pointRow?.repair ?? 0;

  return c.json({
    user_id: id,
    tasks: {
      total: taskRow?.total ?? 0,
      completed: taskRow?.completed ?? 0,
      in_progress: taskRow?.in_progress ?? 0,
    },
    points: {
      total: round1(pointsTotal),
      progress: round1(pointRow?.progress ?? 0),
      repair: round1(pointsRepair),
      // 0-д хуваахаас хамгаална — оноогүй хүн 0 харна (NaN биш).
      // Харьцаа тул гурван орноор (1% доош хувь ч мэдэгдэхүйц байх).
      repair_ratio:
        pointsTotal > 0 ? Math.round((pointsRepair / pointsTotal) * 1000) / 1000 : 0,
    },
    projects: (projectRes.results ?? []).map((r) => ({
      project_id: r.project_id,
      // Засварын төсөл нь ЖИНХЭНЭ төсөл биш тул тусад нь ялгаж өгнө — UI нь
      // үүнийг «Дотоод ажил» гэж тэмдэглэж, төслийн жагсаалттай хольж
      // ойлгуулахгүй (0194).
      repair_project_id: r.repair_project_id,
      is_repair_project: r.is_repair_project === 1,
      project_name: r.project_name,
      project_pct: round2(r.project_pct ?? 0),
      project_total_pct: round2(r.project_total_pct ?? 0),
      total_points: round1(r.total_points ?? 0),
      award_count: r.award_count ?? 0,
    })),
    repair: {
      entry_count: repairRow?.entry_count ?? 0,
      hours: round1(repairRow?.hours ?? 0),
      computed_pct: round2(repairRow?.computed_pct ?? 0),
    },
  });
});

export default profiles;
