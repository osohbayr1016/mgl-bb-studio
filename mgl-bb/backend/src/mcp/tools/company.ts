import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { todayInUB, nowInUBIso } from '../../lib/time';
import { queryAttendanceForDate } from '../../routes/company';
import { fetchVisibleProjects } from './projects';
import { NOT_ASR_ONLY_SQL } from '../../lib/asrEligible';
import { latestApprovedPctByDate } from '../../lib/progressLatest';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const SECTIONS = ['totals', 'portfolio', 'people', 'trends', 'alerts'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * get_company_overview — firm-wide portfolio rollup, bounded by a `sections`
 * param.  Register-gated to non-client in MglMcpAgent.init (mirrors the REST
 * /api/company/overview client block).  Reuses fetchVisibleProjects for the
 * portfolio (staff see all) and queryAttendanceForDate for the headcount,
 * rather than duplicating the route's giant CTE.
 */
export function registerCompanyTools(server: McpServer, env: Env, user: McpProps) {
  void user;
  server.registerTool(
    'get_company_overview',
    {
      title: 'Company-wide overview',
      description:
        'Firm-wide portfolio rollup for company-level reporting: totals, a ' +
        'project portfolio with progress, people/headcount, a daily activity ' +
        'trend, and alerts (overdue tasks & projects). Call this for "how is the ' +
        'company doing" / portfolio-status / leadership-report questions. Use the ' +
        'sections param to fetch only what you need — "people" and "trends" are heavier.',
      inputSchema: {
        sections: z.array(z.enum(SECTIONS)).optional().describe('Which sections to compute. Default ["totals","portfolio","alerts"].'),
        portfolio_limit: z.number().int().min(1).max(50).optional().describe('Max portfolio rows (default 15, active-first then progress desc).'),
        trend_days: z.number().int().min(7).max(90).optional().describe('Trend window in days (default 30).'),
      },
    },
    async ({ sections, portfolio_limit, trend_days }) => {
      const wanted: Section[] = sections?.length ? sections : ['totals', 'portfolio', 'alerts'];
      const want = (s: Section) => wanted.includes(s);
      const limit = Math.min(50, Math.max(1, portfolio_limit ?? 15));
      const days = Math.min(90, Math.max(7, trend_days ?? 30));
      const today = todayInUB();

      const out: Record<string, unknown> = { generated_at: nowInUBIso(), sections: wanted };

      if (want('totals')) {
        const t = await env.DB.prepare(
          `SELECT
             (SELECT COUNT(*) FROM projects p WHERE ${NOT_ASR_ONLY_SQL}) AS projects_total,
             (SELECT COUNT(*) FROM projects p WHERE p.status='active' AND ${NOT_ASR_ONLY_SQL}) AS projects_active,
             (SELECT COUNT(*) FROM projects p WHERE p.status='completed' AND ${NOT_ASR_ONLY_SQL}) AS projects_completed,
             (SELECT COUNT(*) FROM users WHERE status='active') AS users_active,
             (SELECT COUNT(*) FROM users) AS users_total,
             (SELECT COUNT(*) FROM tasks) AS tasks_total,
             (SELECT COUNT(*) FROM tasks WHERE due_date IS NOT NULL AND due_date < ?) AS tasks_overdue`,
        ).bind(today).first();
        out.totals = t ?? {};
      }

      if (want('portfolio')) {
        // Staff see all projects; sort active-first then progress desc.
        const all = await fetchVisibleProjects(env, user, true);
        const sorted = all.slice().sort((a, b) => {
          const aw = a.status === 'active' ? 0 : 1;
          const bw = b.status === 'active' ? 0 : 1;
          if (aw !== bw) return aw - bw;
          return (b.progress ?? 0) - (a.progress ?? 0);
        });
        out.portfolio = sorted.slice(0, limit).map((r) => {
          let teamCount = 0;
          try {
            const parsed = JSON.parse(r.team_progress_json ?? '[]');
            if (Array.isArray(parsed)) teamCount = parsed.length;
          } catch {
            teamCount = 0;
          }
          return {
            id: r.id,
            name: r.name,
            status: r.status,
            progress: Math.round((r.progress ?? 0) * 100) / 100,
            member_count: r.member_count ?? 0,
            team_count: teamCount,
          };
        });
        out.portfolio_total = all.length;
      }

      if (want('people')) {
        const [byRole, byTeam, attendance] = await Promise.all([
          env.DB.prepare(
            `SELECT role, COUNT(*) AS count FROM users WHERE status='active' GROUP BY role ORDER BY count DESC`,
          ).all(),
          env.DB.prepare(
            `SELECT tm.code, tm.name_mn, COUNT(DISTINCT u.id) AS member_count
               FROM teams tm
               LEFT JOIN user_teams ut ON ut.team_id = tm.id
               LEFT JOIN users u ON u.id = ut.user_id AND u.status = 'active'
              GROUP BY tm.id ORDER BY tm.sort_order, tm.code`,
          ).all(),
          queryAttendanceForDate(env.DB, today),
        ]);
        out.people = {
          by_role: byRole.results ?? [],
          by_team: byTeam.results ?? [],
          attendance_today: attendance,
        };
      }

      if (want('trends')) {
        const daily = await env.DB.prepare(
          `SELECT date, COUNT(*) AS entry_count, COUNT(DISTINCT user_id) AS contributor_count,
                  ROUND(AVG(percentage), 1) AS avg_percentage
             FROM progress_entries
            WHERE date >= date(?, ?) AND COALESCE(source, '') <> 'alloc_adj'
            GROUP BY date ORDER BY date`,
        ).bind(today, `-${days - 1} days`).all();
        out.trends = { window_days: days, daily: daily.results ?? [] };
      }

      if (want('alerts')) {
        const [overdueTasks, overdueProjects] = await Promise.all([
          env.DB.prepare(
            `WITH latest_task AS (
    -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
    SELECT t.id AS task_id, ${latestApprovedPctByDate('t.id')} AS percentage
    FROM tasks t
  )
             SELECT t.id AS task_id, t.name AS task_name, t.due_date, p.name AS project_name,
                    CAST(julianday(?) - julianday(t.due_date) AS INTEGER) AS days_overdue
               FROM tasks t
               JOIN components c ON c.id = t.component_id
               JOIN drawings d ON d.id = c.drawing_id
               JOIN blocks b ON b.id = d.block_id
               JOIN projects p ON p.id = b.project_id
               LEFT JOIN latest_task lt ON lt.task_id = t.id
              WHERE t.due_date IS NOT NULL AND t.due_date < ? AND COALESCE(lt.percentage,0) < 100
              ORDER BY t.due_date ASC LIMIT 20`,
          ).bind(today, today).all(),
          env.DB.prepare(
            `SELECT p.id AS project_id, p.name AS project_name, pp.finish_date AS due_date,
                    CAST(julianday(?) - julianday(pp.finish_date) AS INTEGER) AS days_overdue
               FROM projects p
               JOIN project_passport pp ON pp.project_id = p.id
              WHERE p.status='active' AND ${NOT_ASR_ONLY_SQL}
                AND pp.finish_date IS NOT NULL AND pp.finish_date < ?
              ORDER BY pp.finish_date ASC LIMIT 20`,
          ).bind(today, today).all(),
        ]);
        out.alerts = {
          overdue_tasks: overdueTasks.results ?? [],
          overdue_projects: overdueProjects.results ?? [],
        };
      }

      return txt(out);
    },
  );
}
