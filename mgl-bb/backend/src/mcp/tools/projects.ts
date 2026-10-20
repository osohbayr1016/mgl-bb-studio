import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import { isAdminRole } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { PROJECT_LIST_SQL } from '../../routes/projects';
import { hideArchivedRows } from '../../lib/archivedProjects';

/** Бидний унших баганууд (PROJECT_LIST_SQL-ийн SELECT-ээс дэд олонлог).
 *  report.ts энэ helper-уудыг дахин ашигладаг тул export хийв. */
export type ProjectListRow = {
  id: number;
  name: string;
  status: string | null;
  complexity: string | null;
  complexity_pct: number | null;
  progress: number | null;
  member_count?: number | null;
  start_date?: string | null;
  finish_date?: string | null;
  team_progress_json?: string | null;
};

/**
 * REST route-той (projects.ts:297-322) ИЖИЛ харагдах дүрэм: staff
 * (admin/engineer/architect/senior) бүх төслийг хардаг; client зөвхөн
 * өөрийн гишүүн төслийг.  MCP токен нь staff role агуулдаг тул энд role-оор
 * шийднэ.
 */
export function canSeeAllProjects(role: McpProps['role']): boolean {
  return (
    isAdminRole(role) ||
    role === 'engineer' ||
    role === 'architect' ||
    role === 'senior'
  );
}

/**
 * PROJECT_LIST_SQL-ийг route-той ИЖИЛ байдлаар bind хийнэ.  `is_member` (2×
 * EXISTS) ба `is_team_assigned` (1× EXISTS)-д нийт 3 удаа `user.sub`; non-admin
 * (forUser=true) үед харагдацыг хязгаарлах INNER JOIN-д нэмж 4 дэх удаагаа.
 * projects.ts:314-322-г үз.
 */
export async function fetchVisibleProjects(
  env: Env,
  user: McpProps,
  canSeeAll: boolean,
): Promise<ProjectListRow[]> {
  const stmt = env.DB.prepare(PROJECT_LIST_SQL(!canSeeAll));
  const bound = canSeeAll
    ? stmt.bind(user.sub, user.sub, user.sub)
    : stmt.bind(user.sub, user.sub, user.sub, user.sub);
  const res = await bound.all<ProjectListRow>();
  // REST `GET /api/projects`-тэй ижил: архивласан төсөл зөвхөн админд.
  return hideArchivedRows(user.role, res.results ?? []);
}

export function registerProjectTools(server: McpServer, env: Env, user: McpProps) {
  const canSeeAll = canSeeAllProjects(user.role);
  // complexity_pct нь дотоод гүйцэтгэлийн жин — зөвхөн admin-tier рүү буцаана
  // (route нь non-admin-аас үүнийг устгадаг, projects.ts:327-339).
  const showComplexityPct = isAdminRole(user.role);

  const shape = (row: ProjectListRow) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    progress_percent: Number(row.progress ?? 0),
    complexity: row.complexity,
    ...(showComplexityPct ? { complexity_pct: row.complexity_pct } : {}),
  });

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'List construction projects visible to the current user, each with its ' +
        'overall weighted progress percent. Call this when the user asks which ' +
        'projects exist, their status, or how complete they are. Visibility is ' +
        'enforced server-side by the caller identity — clients only see projects ' +
        'they are a member of.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Maximum number of projects to return (default 50).'),
      },
    },
    async ({ limit }) => {
      const rows = await fetchVisibleProjects(env, user, canSeeAll);
      const out = rows.slice(0, limit ?? 50).map(shape);
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    },
  );

  server.registerTool(
    'get_project_progress',
    {
      title: 'Get project progress',
      description:
        'Get the overall weighted progress percent (and status) for a single ' +
        'project by its id. Call this when the user asks how far along a specific ' +
        'project is. Returns an empty result if the project is not visible to the ' +
        'current user. Get project ids from list_projects first.',
      inputSchema: {
        project_id: z
          .number()
          .int()
          .describe('The project id, as returned by list_projects.'),
      },
    },
    async ({ project_id }) => {
      const rows = await fetchVisibleProjects(env, user, canSeeAll);
      const row = rows.find((r) => r.id === project_id);
      if (!row) {
        return {
          content: [
            { type: 'text', text: `No visible project with id ${project_id}.` },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(shape(row), null, 2) }],
      };
    },
  );
}
