import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { todayInUB } from '../../lib/time';
import { canSeeAllProjects, fetchVisibleProjects } from './projects';
import { assertVisible } from './report';
import { latestApprovedPctByDate } from '../../lib/progressLatest';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/* ===================== list_my_tasks ===================== */

type MyTaskRow = {
  id: number;
  name: string;
  weight_percent: number;
  due_date: string | null;
  component_id: number;
  component_name: string;
  drawing_id: number;
  drawing_name: string;
  block_id: number;
  block_name: string;
  project_id: number;
  project_name: string;
};

const MY_TASKS_SQL = `
  SELECT
    t.id, t.name, t.weight_percent, t.due_date,
    comp.id AS component_id, comp.name AS component_name,
    d.id AS drawing_id, d.name AS drawing_name,
    b.id AS block_id, b.name AS block_name,
    p.id AS project_id, p.name AS project_name
  FROM tasks t
  JOIN components comp ON comp.id = t.component_id
  JOIN drawings d ON d.id = comp.drawing_id
  JOIN blocks b ON b.id = d.block_id
  JOIN projects p ON p.id = b.project_id
  WHERE (t.assigned_to = ? OR EXISTS (
          SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))
    AND p.status = 'active'
    -- Хөрвүүлэлтээр root-д нэгтгэгдсэн хуучин хэсэг (0385) — түүх, ажил биш.
    AND NOT EXISTS (SELECT 1 FROM task_conversion_members m WHERE m.task_id = t.id AND m.role = 'retired')
  ORDER BY p.name, b.sort_order, d.sort_order, comp.sort_order, t.sort_order`;

/* ===================== list_overdue_tasks ===================== */

type OverdueRow = {
  task_id: number;
  task_name: string;
  due_date: string;
  progress: number;
  days_overdue: number;
  project_id: number;
  block_name: string;
  drawing_name: string;
  component_name: string;
  assignees_raw: string | null;
  assignee_count: number;
};

export function registerTaskTools(server: McpServer, env: Env, user: McpProps) {
  server.registerTool(
    'list_my_tasks',
    {
      title: 'List my assigned tasks',
      description:
        'List every task assigned to the CURRENT user across active projects, ' +
        'with its latest approved progress %, due date, WBS path, and whether it ' +
        'was already reported today. Call this when the user asks what is on their ' +
        'plate, what they need to report, or to draft their standup. Purely ' +
        'self-scoped — no project_id needed.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Max tasks to return (default 50).'),
        include_reported_today: z.boolean().optional().describe('Include today report flags (default true).'),
        only_open: z.boolean().optional().describe('Only tasks under 100% (default false).'),
      },
    },
    async ({ limit, include_reported_today, only_open }) => {
      const lim = Math.min(100, Math.max(1, limit ?? 50));
      const inclToday = include_reported_today ?? true;
      const today = todayInUB();

      const res = await env.DB.prepare(MY_TASKS_SQL).bind(user.sub, user.sub).all<MyTaskRow>();
      const raw = (res.results ?? []).slice(0, 200); // bound the N+1 enrichment

      const enriched = await Promise.all(
        raw.map(async (t) => {
          const approved = await env.DB.prepare(
            `SELECT percentage FROM progress_entries WHERE task_id = ? AND status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 1`,
          ).bind(t.id).first<{ percentage: number }>();
          const todayRow = inclToday
            ? await env.DB.prepare(
                `SELECT id, is_rest_day, defer_next_day FROM progress_entries WHERE task_id = ? AND user_id = ? AND date = ? ORDER BY created_at DESC LIMIT 1`,
              ).bind(t.id, user.sub, today).first<{ id: number; is_rest_day: 0 | 1; defer_next_day: 0 | 1 }>()
            : null;
          return {
            id: t.id,
            name: t.name,
            weight_percent: t.weight_percent,
            due_date: t.due_date,
            wbs_path: `${t.project_name} / ${t.block_name} / ${t.drawing_name} / ${t.component_name}`,
            project_id: t.project_id,
            project_name: t.project_name,
            block_name: t.block_name,
            drawing_name: t.drawing_name,
            component_name: t.component_name,
            current_progress: approved?.percentage ?? 0,
            reported_today: !!todayRow,
            reported_today_rest: todayRow?.is_rest_day === 1,
            reported_today_deferred: todayRow?.defer_next_day === 1,
          };
        }),
      );

      const summary = {
        total: enriched.length,
        completed: enriched.filter((i) => i.current_progress >= 100).length,
        in_progress: enriched.filter((i) => i.current_progress > 0 && i.current_progress < 100).length,
        not_started: enriched.filter((i) => i.current_progress === 0).length,
        today,
        reported_today: enriched.filter((i) => i.reported_today).length,
        pending_today: enriched.filter((i) => !i.reported_today && i.current_progress < 100).length,
      };

      let items = enriched;
      if (only_open) items = items.filter((i) => i.current_progress < 100);
      items = items.slice(0, lim);

      return txt({ items, summary });
    },
  );

  server.registerTool(
    'list_overdue_tasks',
    {
      title: 'List overdue tasks',
      description:
        'List tasks past their due date that are not yet 100% complete (latest ' +
        'approved %), for one project or across all projects visible to the user, ' +
        'with days-overdue and assignees. Call this when the user asks what is ' +
        'late, behind, or at-risk. Get project ids from list_projects.',
      inputSchema: {
        project_id: z.number().int().optional().describe('Limit to one project. Omit for all visible projects.'),
        limit: z.number().int().min(1).max(200).optional().describe('Max overdue tasks (default 50).'),
        include_unassigned: z.boolean().optional().describe('Include overdue tasks with no assignees (default true).'),
      },
    },
    async ({ project_id, limit, include_unassigned }) => {
      const lim = Math.min(200, Math.max(1, limit ?? 50));
      const inclUnassigned = include_unassigned ?? true;
      const today = todayInUB();

      let ids: number[];
      if (project_id != null) {
        if (!(await assertVisible(env, user, project_id))) {
          return txt({ error: `Project ${project_id} not visible to you.` });
        }
        ids = [project_id];
      } else {
        ids = (await fetchVisibleProjects(env, user, canSeeAllProjects(user.role))).map((r) => r.id);
      }
      if (ids.length === 0) return txt({ today, count: 0, tasks: [] });

      const ph = ids.map(() => '?').join(',');
      const having = inclUnassigned ? '' : 'HAVING COUNT(DISTINCT ta.user_id) > 0';
      const SQL = `
        WITH latest_task AS (
    -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
    SELECT t.id AS task_id, ${latestApprovedPctByDate('t.id')} AS percentage
    FROM tasks t
  )
        SELECT
          t.id AS task_id, t.name AS task_name, t.due_date,
          COALESCE(lt.percentage, 0) AS progress,
          CAST(julianday(?) - julianday(t.due_date) AS INTEGER) AS days_overdue,
          b.project_id AS project_id, b.name AS block_name,
          d.name AS drawing_name, c.name AS component_name,
          GROUP_CONCAT(DISTINCT u.id || '|' || u.full_name) AS assignees_raw,
          COUNT(DISTINCT ta.user_id) AS assignee_count
        FROM tasks t
        INNER JOIN components c ON c.id = t.component_id
        INNER JOIN drawings d ON d.id = c.drawing_id
        INNER JOIN blocks b ON b.id = d.block_id
        LEFT JOIN latest_task lt ON lt.task_id = t.id
        LEFT JOIN task_assignees ta ON ta.task_id = t.id
        LEFT JOIN users u ON u.id = ta.user_id
        WHERE b.project_id IN (${ph})
          AND t.due_date IS NOT NULL AND t.due_date < ?
          AND COALESCE(lt.percentage, 0) < 100
        GROUP BY t.id ${having}
        ORDER BY t.due_date ASC, t.id ASC
        LIMIT ?`;

      const rows = (await env.DB.prepare(SQL).bind(today, ...ids, today, lim).all<OverdueRow>()).results ?? [];

      const shape = (r: OverdueRow) => ({
        task_id: r.task_id,
        task_name: r.task_name,
        project_id: r.project_id,
        block_name: r.block_name,
        drawing_name: r.drawing_name,
        component_name: r.component_name,
        due_date: r.due_date,
        days_overdue: r.days_overdue,
        progress_percent: Math.round(r.progress),
        assignees: (r.assignees_raw ?? '')
          .split(',')
          .filter(Boolean)
          .slice(0, 10)
          .map((s) => {
            const idx = s.indexOf('|');
            return {
              user_id: Number(idx >= 0 ? s.slice(0, idx) : s),
              full_name: idx >= 0 ? s.slice(idx + 1) : '',
            };
          }),
      });

      return txt({ today, count: rows.length, truncated: rows.length === lim, tasks: rows.map(shape) });
    },
  );
}
