import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import { withEdgeCache } from '../lib/edgeCache';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';
import type { Env, AppVariables, ProjectRow, UserRow } from '../types';
import { latestApprovedPctByDate } from '../lib/progressLatest';
import { projectProgressSql } from '../lib/repairProgress';

const dashboard = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// GET /api/dashboard/overview
dashboard.get('/overview', async (c) => {
  const user = c.get('user');
  // The overview is per-viewer (their project list is filtered by
  // membership), so the cache key varies on user id + role.  Short TTL
  // because the panel feels live — managers expect newly-created
  // projects to appear within ~30s.
  return withEdgeCache(
    c,
    { key: 'dashboard:overview', varyTags: [user.sub, user.role], ttlSeconds: 60 },
    async () => {
      // 2026-09-11: дөрвөн дараалсан COUNT → нэг асуулга (D1 руу 4 биш 1 аялал).
      const counts = await c.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM projects p WHERE ${NOT_ASR_ONLY_SQL}) AS total_projects,
           (SELECT COUNT(*) FROM projects p WHERE p.status = 'active' AND ${NOT_ASR_ONLY_SQL}) AS active_projects,
           (SELECT COUNT(*) FROM projects p WHERE p.status = 'completed' AND ${NOT_ASR_ONLY_SQL}) AS completed_projects,
           (SELECT COUNT(*) FROM users WHERE status = 'active') AS total_users`,
      ).first<{
        total_projects: number;
        active_projects: number;
        completed_projects: number;
        total_users: number;
      }>();
      const totalProjects = { count: counts?.total_projects ?? 0 };
      const activeProjects = { count: counts?.active_projects ?? 0 };
      const completedProjects = { count: counts?.completed_projects ?? 0 };
      const totalUsers = { count: counts?.total_users ?? 0 };

      // Recent progress entries.  ⚠️ Frontend энэ талбарыг УНШДАГГҮЙ (2026-09-11
      // шалгасан — DashboardPage зөвхөн stats.active_projects + active_projects);
      // API хэлбэрийг хадгалахын тулд үлдээв, миграц 0290-ийн created_at индекс
      // үүнийг 32 000 → ~30 мөр болгоно.
      const { results: recentEntries } = await c.env.DB.prepare(
        `
    SELECT pe.*, u.full_name as user_name,
      t.name as item_name
    FROM progress_entries pe
    INNER JOIN users u ON u.id = pe.user_id
    LEFT JOIN tasks t ON t.id = pe.task_id
    WHERE COALESCE(pe.source, '') <> 'alloc_adj'
    ORDER BY pe.created_at DESC, pe.id DESC
    LIMIT 10
  `,
      ).all<{
        id: number;
        user_id: number;
        percentage: number;
        date: string;
        created_at: string;
        user_name: string;
        item_name: string;
      }>();

      // Active projects with progress for the dashboard "Идэвхтэй төслүүд"
      // card.  Visibility rules:
      //   • admin / engineer / architect / senior — see every active project
      //     (mirrors the GET /projects rule so internal staff can pick up
      //     unclaimed work).
      //   • client                                — only projects they are
      //     explicitly a member of.
      //   • everyone else (rare custom roles)     — projects where they are
      //     either a member OR have at least one task assigned via the
      //     task_assignees junction.  This was the previous bug: assigning a
      //     task did not auto-add the user to project_members, so their
      //     dashboard reported "Идэвхтэй төсөл алга." even when they had work.
      // We compute the same `progress` value the /projects endpoint uses so
      // the progress bars in the card render properly instead of always 0%.
      // Түвшин бүр бодит жингийн нийлбэрээр normalize хийнэ (PROJECT_LIST_SQL-тэй
      // яг ижил) — жингийн нийлбэр 100 болоогүй setup-ын дутуу жин прогрессыг
      // 0 руу чирэхгүй; жин гүйцсэн төслүүдэд хуучин ÷100 томьёотой тэнцүү.
      const isStaff = ['admin', 'engineer', 'architect', 'senior'].includes(user.role);
      const baseSql = `
    WITH latest_task AS (
      -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts).
      -- ⚠️ Өмнөх хувилбар MAX(date)-тай БҮХ мөрийг join хийдэг тул нэг өдөр
      --    хоёр батлагдсан мөртэй таскийн жинг ДАВХАР тоолдог байв (CLAUDE.md
      --    «three different tiebreaks … can double-count»).  Одоо тэр өдрийн
      --    сүүлийн мөр (date, created_at, id) — давхардал арилсан, бусад
      --    тохиолдолд утга ижил.
      SELECT t.id AS task_id, ${latestApprovedPctByDate('t.id')} AS percentage
      FROM tasks t
    ),
    -- Зарласан төсвөөр хуваасан rollup — PROJECT_LIST_SQL-ийн хуулбар
    -- (routes/projects.ts дахь толгойн жагсаалтыг үзнэ үү).
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
    project_prog AS (
      SELECT pts.project_id AS id,
             COALESCE(
               SUM(pts.share_percent * COALESCE(tmp.progress, 0)),
               0
             ) / 100.0 AS progress
      FROM project_team_shares pts
      LEFT JOIN team_prog tmp
        ON tmp.project_id = pts.project_id AND tmp.team_id = pts.team_id
      GROUP BY pts.project_id
    ),
    member_count AS (
      -- Захиалагчийн холбоо барих хүн «гишүүн» биш (projects.ts-тэй ижил дүрэм).
      SELECT pm.project_id AS project_id, COUNT(*) AS cnt
      FROM project_members pm
      INNER JOIN users u ON u.id = pm.user_id AND u.role <> 'client'
      GROUP BY pm.project_id
    )
    SELECT
      p.id, p.name, p.description, p.location, p.latitude, p.longitude,
      p.status, p.created_by, p.created_at, p.updated_at,
      COALESCE(mc.cnt, 0)                AS member_count,
      -- 'hours' горим (0339) → цагийн бүртгэлээс; PROJECT_LIST_SQL-тэй ижил дүрэм.
      ROUND(COALESCE(${projectProgressSql('p', 'pp.progress')}, 0), 2) AS progress
    FROM projects p
    LEFT JOIN member_count mc ON mc.project_id = p.id
    LEFT JOIN project_prog pp ON pp.id = p.id
    WHERE p.status = 'active' AND ${NOT_ASR_ONLY_SQL}`;

      let projectsList: ProjectRow[];
      if (isStaff) {
        const res = await c.env.DB.prepare(
          `${baseSql} ORDER BY p.created_at DESC LIMIT 10`,
        ).all<ProjectRow>();
        projectsList = res.results;
      } else if (user.role === 'client') {
        const res = await c.env.DB.prepare(
          `${baseSql}
        AND EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = ?
        )
        ORDER BY p.created_at DESC LIMIT 10`,
        )
          .bind(user.sub)
          .all<ProjectRow>();
        projectsList = res.results;
      } else {
        const res = await c.env.DB.prepare(
          `${baseSql}
        AND (
          EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM tasks t
            INNER JOIN components c ON c.id = t.component_id
            INNER JOIN drawings  d ON d.id = c.drawing_id
            INNER JOIN blocks    b ON b.id = d.block_id
            INNER JOIN task_assignees ta ON ta.task_id = t.id
            WHERE b.project_id = p.id AND ta.user_id = ?
          )
        )
        ORDER BY p.created_at DESC LIMIT 10`,
        )
          .bind(user.sub, user.sub)
          .all<ProjectRow>();
        projectsList = res.results;
      }

      return {
        stats: {
          total_projects: totalProjects?.count ?? 0,
          active_projects: activeProjects?.count ?? 0,
          completed_projects: completedProjects?.count ?? 0,
          total_users: totalUsers?.count ?? 0,
        },
        recent_entries: recentEntries,
        active_projects: projectsList,
      };
    },
  );
});

// GET /api/dashboard/team/:userId — senior views team member progress
dashboard.get('/team', requireRole('admin', 'senior'), async (c) => {
  const user = c.get('user');

  // Get all users that share projects with the current senior
  let teamMembers: UserRow[];

  if (user.role === 'admin') {
    const res = await c.env.DB.prepare(
      "SELECT id, username, full_name, role, status, created_at, updated_at FROM users WHERE status = 'active' ORDER BY full_name",
    ).all<UserRow>();
    teamMembers = res.results;
  } else {
    // Senior sees people in the same projects
    const res = await c.env.DB.prepare(
      `
      SELECT DISTINCT u.id, u.username, u.full_name, u.role, u.status, u.created_at, u.updated_at
      FROM users u
      INNER JOIN project_members pm1 ON pm1.user_id = u.id
      INNER JOIN project_members pm2 ON pm2.project_id = pm1.project_id
      WHERE pm2.user_id = ? AND u.id != ? AND u.status = 'active'
      ORDER BY u.full_name
    `,
    )
      .bind(user.sub, user.sub)
      .all<UserRow>();
    teamMembers = res.results;
  }

  // Get recent progress for each team member
  const membersWithProgress = await Promise.all(
    teamMembers.map(async (member) => {
      const recentProgress = await c.env.DB.prepare(
        `
        SELECT pe.percentage, pe.date, t.name as item_name
        FROM progress_entries pe
        LEFT JOIN tasks t ON t.id = pe.task_id
        WHERE pe.user_id = ? AND COALESCE(pe.source, '') <> 'alloc_adj'
        ORDER BY pe.date DESC, pe.created_at DESC, pe.id DESC
        LIMIT 5
      `,
      )
        .bind(member.id)
        .all<{ percentage: number; date: string; item_name: string }>();

      const totalEntries = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM progress_entries WHERE user_id = ? AND COALESCE(source, '') <> 'alloc_adj'`,
      )
        .bind(member.id)
        .first<{ count: number }>();

      return {
        ...member,
        recent_progress: recentProgress.results,
        total_entries: totalEntries?.count ?? 0,
      };
    }),
  );

  return c.json({ team: membersWithProgress });
});

export default dashboard;
