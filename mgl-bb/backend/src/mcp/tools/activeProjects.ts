import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { todayInUB } from '../../lib/time';
import { queryActiveProjectsForDate } from '../../routes/company';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/**
 * active_projects — which projects people clocked in to work on, for a given
 * day (today or any past date).  Sourced from clock-in project selection
 * (daily_active_projects) via queryActiveProjectsForDate.  Admin/senior only
 * (workforce data; registered in the admin-OR-senior block in MglMcpAgent.init).
 */
export function registerActiveProjectsTools(server: McpServer, env: Env, user: McpProps) {
  void user;
  server.registerTool(
    'active_projects',
    {
      title: 'Active projects by date',
      description:
        'Show which projects the team clocked in to work on for ONE day — today by ' +
        'default, or any past date via the date param. Returns one entry per project ' +
        'with the headcount, team breakdown, and the people on it (from clock-in ' +
        'project selection). Use for "what is the team working on today / on <date>", ' +
        'or pass team_code to filter to one team. Admin/senior only.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('UB date YYYY-MM-DD. Default today.'),
        team_code: z.string().trim().min(1).max(16).optional().describe('Filter to one team code, e.g. "ST".'),
        limit: z.number().int().min(1).max(100).optional().describe('Max projects to return (default 50).'),
      },
    },
    async ({ date, team_code, limit }) => {
      try {
        const day = date ?? todayInUB();
        const lim = Math.min(100, Math.max(1, limit ?? 50));
        const team = team_code?.trim().toUpperCase() || null;

        const rows = await queryActiveProjectsForDate(env.DB, day);
        const distinct = new Set<number>();

        const mapped = rows.map((p) => {
          let emps = p.employees;
          if (team) emps = emps.filter((e) => e.team_codes.some((c) => c.toUpperCase() === team));
          for (const e of emps) distinct.add(e.user_id);
          return {
            project_id: p.project_id,
            project_name: p.project_name,
            employee_count: team ? emps.length : p.employee_count,
            teams: p.teams,
            people: emps.map((e) => ({ name: e.full_name, teams: e.team_codes })),
          };
        });

        const projects = (team ? mapped.filter((p) => p.employee_count > 0) : mapped).slice(0, lim);

        return txt({
          date: day,
          team_code: team,
          project_count: projects.length,
          people_count: distinct.size,
          projects,
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
