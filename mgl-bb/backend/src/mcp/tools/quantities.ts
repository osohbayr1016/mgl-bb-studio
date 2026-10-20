import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

type RunRow = {
  id: number;
  project_id: number;
  created_by_name: string | null;
  model_url: string;
  file_name: string | null;
  schema_version: string | null;
  element_count: number;
  flag_count: number;
  total_volume_m3: number | null;
  total_area_m2: number | null;
  summary_json: string | null;
  created_at: string;
};

/**
 * get_project_quantities — Тоо хэмжээ (QTO): material quantity take-off for a
 * project's IFC model. Reads the persisted qto_runs summaries the in-browser
 * takeoff writes (routes/qto.ts) — the same data the QTO page shows, so answers
 * always match the UI. admin + senior only (registered in the admin/senior
 * block, the MCP mirror of the route's requireRole('admin','senior') gate).
 */
export function registerQuantityTools(server: McpServer, env: Env, user: McpProps) {
  void user;
  server.registerTool(
    'get_project_quantities',
    {
      title: 'Project quantity take-off (Тоо хэмжээ)',
      description:
        'Material quantity take-off (QTO / Тоо хэмжээ) for a project. Revit projects ' +
        'push one run PER FILE (host + linked discipline models) — the response ' +
        'includes a `files` array (latest run per file with count/volume/mass totals ' +
        'and unmapped-fact counts) so multi-file totals are a sum over it. Also ' +
        'returns the latest (or run_id-specified) run\'s summary and a run history — ' +
        'comparing runs shows what changed between model revisions. Use for "how much ' +
        'concrete does project X need", "which files were quantified", "what changed ' +
        'since the last push".',
      inputSchema: {
        project_id: z.number().int().positive().describe('Project id (see list_projects).'),
        run_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('A specific run from the history list; omit for the latest.'),
      },
    },
    async ({ project_id, run_id }) => {
      try {
        const project = await env.DB.prepare('SELECT id, name FROM projects WHERE id = ?')
          .bind(project_id)
          .first<{ id: number; name: string }>();
        if (!project) return txt({ error: `Project ${project_id} not found.` });

        const history =
          (
            await env.DB.prepare(
              `SELECT r.id, r.file_name, r.element_count, r.flag_count,
                      r.total_volume_m3, r.created_at, u.full_name AS created_by_name
                 FROM qto_runs r LEFT JOIN users u ON u.id = r.created_by
                WHERE r.project_id = ?
                ORDER BY r.created_at DESC, r.id DESC LIMIT 10`,
            )
              .bind(project_id)
              .all<Omit<RunRow, 'project_id' | 'model_url' | 'schema_version' | 'total_area_m2' | 'summary_json'>>()
          ).results ?? [];

        if (history.length === 0) {
          return txt({
            project: { id: project.id, name: project.name },
            message:
              'No QTO runs yet. Someone needs to open the project\'s "Тоо хэмжээ" tab ' +
              'and compute the take-off from the uploaded .ifc first.',
          });
        }

        const run = await env.DB.prepare(
          run_id != null
            ? `SELECT r.*, u.full_name AS created_by_name FROM qto_runs r
                 LEFT JOIN users u ON u.id = r.created_by
                WHERE r.id = ? AND r.project_id = ?`
            : `SELECT r.*, u.full_name AS created_by_name FROM qto_runs r
                 LEFT JOIN users u ON u.id = r.created_by
                WHERE r.project_id = ?
                ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
        )
          .bind(...(run_id != null ? [run_id, project_id] : [project_id]))
          .first<RunRow>();
        if (!run) return txt({ error: `Run ${run_id} not found on project ${project_id}.` });

        let summary: unknown = null;
        try {
          summary = run.summary_json ? JSON.parse(run.summary_json) : null;
        } catch {
          summary = { error: 'summary_json unreadable' };
        }

        // Файл бүрийн сүүлийн run (Самбарын endpoint-той ижил latest-per-file
        // subquery) + qto_facts-аас aggregate — summary_json-д НАЙДАХГҮЙ.
        type FileRow = {
          run_id: number;
          file_name: string | null;
          created_at: string;
          element_count: number;
          unmapped_facts: number;
          volume_m3: number | null;
          mass_kg: number | null;
        };
        const files =
          (
            await env.DB.prepare(
              `SELECT r.id AS run_id, r.file_name, r.created_at, r.element_count,
                      (SELECT COUNT(*) FROM qto_facts f
                        WHERE f.qto_run_id = r.id AND f.resource_code IS NULL) AS unmapped_facts,
                      (SELECT SUM(COALESCE(f.volume_m3, 0)) FROM qto_facts f
                        WHERE f.qto_run_id = r.id) AS volume_m3,
                      (SELECT SUM(COALESCE(f.mass_kg, 0)) FROM qto_facts f
                        WHERE f.qto_run_id = r.id) AS mass_kg
                 FROM qto_runs r
                WHERE r.project_id = ?1 AND r.source = 'revit'
                  AND r.id = (
                    SELECT r2.id FROM qto_runs r2
                     WHERE r2.project_id = ?1 AND r2.source = 'revit'
                       AND r2.file_name = r.file_name
                     ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1)
                ORDER BY r.element_count DESC
                LIMIT 40`,
            )
              .bind(project_id)
              .all<FileRow>()
          ).results ?? [];

        return txt({
          project: { id: project.id, name: project.name },
          run: {
            id: run.id,
            created_at: run.created_at,
            created_by: run.created_by_name,
            file_name: run.file_name,
            schema_version: run.schema_version,
            element_count: run.element_count,
            flag_count: run.flag_count,
            total_volume_m3: run.total_volume_m3,
            total_area_m2: run.total_area_m2,
          },
          summary,
          files,
          history: history.map((h) => ({
            run_id: h.id,
            created_at: h.created_at,
            created_by: h.created_by_name,
            file_name: h.file_name,
            element_count: h.element_count,
            flag_count: h.flag_count,
            total_volume_m3: h.total_volume_m3,
          })),
        });
      } catch (err) {
        return txt({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
