import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env, ProjectRow, ProjectClientRow } from '../../types';
import { isAdminRole } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { canSeeAllProjects, fetchVisibleProjects } from './projects';
import {
  getProjectHierarchyFast,
  rowToPassport,
  type PassportRow,
} from '../../routes/projects';

/** MCP tool-ийн стандарт текст хариу. */
const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/** getProjectHierarchyFast-ийн буцаах нэг блокийн төрөл (гараар бичихгүй —
 *  helper-ийн хэлбэрийг автоматаар дагана). */
type HierBlock = Awaited<ReturnType<typeof getProjectHierarchyFast>>[number];

const round2 = (v: number | null | undefined) => Math.round((v ?? 0) * 100) / 100;

/** projects.ts:476-485-тэй ижил харагдах дүрэм: staff бүх төслийг хардаг;
 *  client зөвхөн өөрийн гишүүн (`project_members`) төслийг.  Exported тул
 *  бусад tool (tasks.ts) дахин ашигладаг. */
export async function assertVisible(env: Env, user: McpProps, projectId: number): Promise<boolean> {
  if (canSeeAllProjects(user.role)) return true;
  const m = await env.DB.prepare(
    'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?',
  )
    .bind(projectId, user.sub)
    .first();
  return !!m;
}

function countTasks(blocks: HierBlock[]): number {
  let n = 0;
  for (const b of blocks)
    for (const d of b.drawings) for (const c of d.components) n += c.tasks.length;
  return n;
}

/** Бүтэн модыг блок→зураг түвшинд хураангуйлна (эд анги/таскгүй) — хариуны
 *  хэмжээг хязгаарлахын тулд. */
function summarizeTree(blocks: HierBlock[]) {
  return blocks.map((b) => ({
    id: b.id,
    name: b.name,
    weight_percent: b.weight_percent,
    team_id: b.team_id,
    progress: round2(b.progress),
    drawing_count: b.drawings.length,
    drawings: b.drawings.map((d) => ({
      id: d.id,
      name: d.name,
      weight_percent: d.weight_percent,
      progress: round2(d.progress),
      component_count: d.components.length,
      task_count: d.components.reduce((n, c) => n + c.tasks.length, 0),
    })),
  }));
}

export function registerReportTools(server: McpServer, env: Env, user: McpProps) {
  const canSeeAll = canSeeAllProjects(user.role);
  const isAdmin = isAdminRole(user.role);

  /* ---------------- get_project_report ---------------- */
  server.registerTool(
    'get_project_report',
    {
      title: 'Get full project report bundle',
      description:
        'Return a comprehensive, structured snapshot of ONE project for writing a ' +
        'report: metadata, passport (full title / drawing no / scope / director / ' +
        'client PM / dates / disciplines / contacts), clients, team ownership ' +
        'shares, overall weighted progress, per-team progress, contributors with ' +
        'points (admin-only), a block→drawing progress tree, recent progress ' +
        'entries, and the pending-approval count. Call this whenever the user asks ' +
        'you to summarise, report on, or describe the state of a specific project. ' +
        'Get the project_id from list_projects first. Task-level detail is ' +
        'summarised to drawing level by default — call get_project_breakdown for ' +
        'individual tasks, assignees and due dates.',
      inputSchema: {
        project_id: z.number().int().describe('Project id from list_projects.'),
        recent_limit: z
          .number().int().min(1).max(50).optional()
          .describe('How many recent progress entries to include (default 20).'),
        include_tasks: z
          .boolean().optional()
          .describe(
            'Inline the full task tree (capped at 400 tasks). Default false — ' +
            'prefer get_project_breakdown for large projects.',
          ),
      },
    },
    async ({ project_id, recent_limit, include_tasks }) => {
      if (!(await assertVisible(env, user, project_id)))
        return txt({ error: `Project ${project_id} not visible to you.` });

      const recent = Math.min(50, Math.max(1, recent_limit ?? 20));

      // PROJECT_LIST_SQL мөр = overall %, per-team %, огноо, member_count, status.
      const listRows = await fetchVisibleProjects(env, user, canSeeAll);
      const listRow = listRows.find((r) => r.id === project_id);

      const [project, clientsRes, sharesRes, passportRow, hierarchy, activityRes, pendingRow] =
        await Promise.all([
          env.DB.prepare('SELECT * FROM projects WHERE id = ?')
            .bind(project_id).first<ProjectRow>(),
          env.DB.prepare(
            `SELECT id, project_id, type, name, share_percent, sort_order, created_at
               FROM project_clients WHERE project_id = ? ORDER BY sort_order, id`,
          ).bind(project_id).all<ProjectClientRow>(),
          env.DB.prepare(
            `SELECT pts.team_id, pts.share_percent, pts.sort_order,
                    t.code AS team_code, t.name_mn AS team_name_mn, t.name_en AS team_name_en
               FROM project_team_shares pts
               INNER JOIN teams t ON t.id = pts.team_id
              WHERE pts.project_id = ?
              ORDER BY pts.sort_order, t.sort_order, t.name_mn`,
          ).bind(project_id).all(),
          env.DB.prepare('SELECT * FROM project_passport WHERE project_id = ?')
            .bind(project_id).first<PassportRow>(),
          getProjectHierarchyFast(env.DB, project_id),
          env.DB.prepare(
            `SELECT pe.id, pe.user_id, pe.task_id, pe.percentage, pe.date, pe.notes,
                    pe.status, pe.created_at, u.full_name AS user_name,
                    t.name AS task_name, d.name AS drawing_name, b.name AS block_name
               FROM progress_entries pe
               INNER JOIN users u      ON u.id = pe.user_id
               LEFT  JOIN tasks t      ON t.id = pe.task_id
               LEFT  JOIN components c ON c.id = t.component_id
               LEFT  JOIN drawings d   ON d.id = c.drawing_id
               LEFT  JOIN blocks b     ON b.id = d.block_id
              WHERE b.project_id = ?
              ORDER BY pe.created_at DESC LIMIT ?`,
          ).bind(project_id, recent).all(),
          env.DB.prepare(
            `SELECT COUNT(*) AS n FROM progress_entries pe
               JOIN tasks t      ON t.id = pe.task_id
               JOIN components c ON c.id = t.component_id
               JOIN drawings d   ON d.id = c.drawing_id
               JOIN blocks b     ON b.id = d.block_id
              WHERE b.project_id = ? AND pe.status = 'pending'`,
          ).bind(project_id).first<{ n: number }>(),
        ]);

      if (!project) return txt({ error: `Project ${project_id} not found.` });

      // complexity_pct redaction (projects.ts:327-339 — зөвхөн admin).
      const meta: Record<string, unknown> = { ...project };
      if (!isAdmin) delete meta.complexity_pct;

      // per-team progress: list мөрийн team_progress_json-г задлана.
      let perTeam: unknown[] = [];
      try {
        if (listRow?.team_progress_json) {
          const parsed = JSON.parse(listRow.team_progress_json);
          if (Array.isArray(parsed)) perTeam = parsed;
        }
      } catch {
        perTeam = [];
      }

      // contributors + points — зөвхөн admin (leaderboard project query).
      let contributors: unknown = null;
      if (isAdmin) {
        const res = await env.DB.prepare(
          `SELECT u.id AS user_id, u.full_name, u.username, u.role, u.profile_image,
                  SUM(p.amount) AS total_points, COUNT(*) AS award_count,
                  MAX(p.awarded_at) AS last_awarded_at
             FROM user_points p INNER JOIN users u ON u.id = p.user_id
            WHERE p.project_id = ? GROUP BY u.id
            ORDER BY total_points DESC LIMIT 50`,
        ).bind(project_id).all();
        contributors = res.results ?? [];
      }

      const totalTasks = countTasks(hierarchy);
      let tree: unknown = summarizeTree(hierarchy);
      let treeLevel = 'block_drawing';
      let treeTruncated = false;
      if (include_tasks) {
        if (totalTasks <= 400) {
          tree = hierarchy;
          treeLevel = 'full';
        } else {
          treeTruncated = true; // хураангуй модыг үлдээж, тугийг өргөнө.
        }
      }

      return txt({
        project: { ...meta, overall_progress: round2(listRow?.progress) },
        passport: rowToPassport(passportRow),
        clients: clientsRes.results ?? [],
        team_shares: sharesRes.results ?? [],
        per_team_progress: perTeam,
        member_count: listRow?.member_count ?? null,
        contributors,
        contributors_note: isAdmin ? undefined : 'admin-only',
        tree_level: treeLevel,
        tree_truncated: treeTruncated || undefined,
        tree_note: treeTruncated
          ? `Project has ${totalTasks} tasks (>400). Call get_project_breakdown ` +
            `(optionally with block_id) for full task detail.`
          : undefined,
        total_task_count: totalTasks,
        tree,
        recent_progress_entries: activityRes.results ?? [],
        pending_approvals_count: pendingRow?.n ?? 0,
      });
    },
  );

  /* ---------------- get_project_breakdown ---------------- */
  server.registerTool(
    'get_project_breakdown',
    {
      title: 'Get full project task breakdown',
      description:
        'Return the full block→drawing→component→task hierarchy for ONE project, ' +
        "with each task's weight, latest approved progress percent, due date and " +
        'assignees. Call this when the user needs task-level detail that ' +
        'get_project_report omits — e.g. which tasks are overdue, who is assigned, ' +
        'or per-task completion. For large projects pass block_id to page by block, ' +
        'or tasks_only:true for a flat task list.',
      inputSchema: {
        project_id: z.number().int().describe('Project id from list_projects.'),
        block_id: z
          .number().int().optional()
          .describe('Limit to one block (recommended for large projects).'),
        tasks_only: z
          .boolean().optional()
          .describe('Return a flat task list instead of the nested tree.'),
      },
    },
    async ({ project_id, block_id, tasks_only }) => {
      if (!(await assertVisible(env, user, project_id)))
        return txt({ error: `Project ${project_id} not visible to you.` });

      let blocks = await getProjectHierarchyFast(env.DB, project_id);
      if (block_id != null) blocks = blocks.filter((b) => b.id === block_id);

      const total = countTasks(blocks);
      const CAP = 500;
      if (total > CAP) {
        return txt({
          error: 'tree too large',
          total_task_count: total,
          hint: 'pass block_id to page by block',
          blocks: blocks.map((b) => ({
            id: b.id,
            name: b.name,
            task_count: b.drawings.reduce(
              (n, d) => n + d.components.reduce((m, c) => m + c.tasks.length, 0),
              0,
            ),
          })),
        });
      }

      if (tasks_only) {
        const flat: unknown[] = [];
        for (const b of blocks)
          for (const d of b.drawings)
            for (const c of d.components)
              for (const t of c.tasks)
                flat.push({
                  task_id: t.id,
                  task_name: t.name,
                  block_name: b.name,
                  drawing_name: d.name,
                  component_name: c.name,
                  weight_percent: t.weight_percent,
                  progress: t.progress,
                  due_date: t.due_date,
                  assignees: t.assignees.map((a) => ({
                    user_id: a.user_id,
                    full_name: a.full_name,
                  })),
                });
        return txt({ project_id, task_count: flat.length, tasks: flat });
      }

      return txt({ project_id, block_id: block_id ?? null, total_task_count: total, blocks });
    },
  );
}
