import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import { isAdminRole } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { assertVisible } from './report';

/* =============================================================
 * get_project_info — төслийн «Мэдээлэл» табын өгөгдөл.
 * -------------------------------------------------------------
 * passport / clients / team_shares нь аль хэдийн get_project_report-д байгаа.
 * Энэ tool нь тэдгээрт БАЙХГҮЙ хэсгүүдийг нэмж өгнө:
 *   - Захиалагчийн баримтын бүртгэл (project_client_documents)
 *   - Техникийн нөхцөл (project_tech_conditions)
 *   - Захиалагчийн лого (app_settings key client_logo_url:<id>)
 *   - Гэрээ + санхүүжилтийн үе шат + агентлагийн тэмдэглэл (project_status_reports)
 *     — зөвхөн ADMIN (UI-ийн ProjectStatusReportSection admin gate-тэй нийцүүлэв).
 * Route-уудын inline SQL-ийг л тусгана, шинэ логик үгүй.  assertVisible member-gated.
 * ============================================================= */

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

interface ClientDocView {
  sort_order: number;
  doc_name: string;
  doc_no: string | null;
  doc_date: string | null;
  source: string | null;
  description: string | null;
  status: string;
  provided_at: string | null;
  provided_by_name: string | null;
  file_url: string | null;
  file_name: string | null;
}

interface TechConditionView {
  sort_order: number;
  title: string;
  value: string | null;
  description: string | null;
  condition_date: string | null;
}

interface StatusReportView {
  contract_start: string | null;
  contract_end: string | null;
  funding_milestones_json: string | null;
  nema_note: string | null;
  health_note: string | null;
  bdc_experts_note: string | null;
  bdc_review_note: string | null;
  nema_done: number;
  health_done: number;
  bdc_experts_done: number;
  bdc_review_done: number;
}

/** parseMilestones (routes/projects.ts:1906)-ийн дүйцэл. */
function parseMilestones(
  json: string | null,
): Array<{ label: string; percent: number | null; done: boolean; received_at: string | null }> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m) => m && typeof m === 'object')
      .map((m) => ({
        label: typeof m.label === 'string' ? m.label : '',
        percent:
          typeof m.percent === 'number' && Number.isFinite(m.percent)
            ? Math.max(0, Math.min(100, m.percent))
            : null,
        done: !!m.done,
        received_at: typeof m.received_at === 'string' ? m.received_at : null,
      }));
  } catch {
    return [];
  }
}

export function registerProjectInfoTool(server: McpServer, env: Env, user: McpProps) {
  server.registerTool(
    'get_project_info',
    {
      title: 'Get project "Мэдээлэл" (Info) tab data',
      description:
        'Return the project INFO ("Мэдээлэл") tab data that is NOT already in ' +
        'get_project_report/get_report_content: the client-supplied document register ' +
        '(what the client owes/has delivered, with status), the technical conditions ' +
        'list, the client logo URL, and (ADMIN ONLY) the contract dates, funding ' +
        'milestones and agency-review notes (НОБГ/ЭМ/БДС). Use this for the ' +
        'project-intro / scope / documents parts of a Word report. Passport, clients ' +
        'and team shares come from get_project_report. Contract/funding is omitted for ' +
        'non-admins and clients. Get project_id from list_projects.',
      inputSchema: {
        project_id: z.number().int().describe('Project id from list_projects.'),
      },
    },
    async ({ project_id }) => {
      if (!(await assertVisible(env, user, project_id)))
        return txt({ error: `Project ${project_id} not visible to you.` });

      const isAdmin = isAdminRole(user.role);

      const [docsRes, condRes, logoRow, statusRow] = await Promise.all([
        env.DB.prepare(
          `SELECT cd.sort_order, cd.doc_name, cd.doc_no, cd.doc_date, cd.source, cd.description,
                  cd.status, cd.provided_at, cd.file_url, cd.file_name,
                  u.full_name AS provided_by_name
             FROM project_client_documents cd
             LEFT JOIN users u ON u.id = cd.provided_by_id
            WHERE cd.project_id = ?
            ORDER BY cd.sort_order, cd.id`,
        )
          .bind(project_id)
          .all<ClientDocView>(),
        env.DB.prepare(
          `SELECT sort_order, title, value, description, condition_date
             FROM project_tech_conditions
            WHERE project_id = ?
            ORDER BY sort_order, id`,
        )
          .bind(project_id)
          .all<TechConditionView>(),
        env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
          .bind(`client_logo_url:${project_id}`)
          .first<{ value: string | null }>(),
        isAdmin
          ? env.DB.prepare(
              `SELECT contract_start, contract_end, funding_milestones_json,
                      nema_note, health_note, bdc_experts_note, bdc_review_note,
                      nema_done, health_done, bdc_experts_done, bdc_review_done
                 FROM project_status_reports WHERE project_id = ?`,
            )
              .bind(project_id)
              .first<StatusReportView>()
          : Promise.resolve(null),
      ]);

      const client_documents = docsRes.results ?? [];
      const provided = client_documents.filter((d) => d.status === 'provided').length;

      const logo = logoRow?.value?.trim();

      // Гэрээ / санхүүжилт / агентлагийн тэмдэглэл — зөвхөн admin.
      let contract: unknown = undefined;
      if (isAdmin) {
        if (statusRow) {
          contract = {
            contract_start: statusRow.contract_start,
            contract_end: statusRow.contract_end,
            funding_milestones: parseMilestones(statusRow.funding_milestones_json),
            agency_notes: {
              nema: { note: statusRow.nema_note, done: !!statusRow.nema_done },
              health: { note: statusRow.health_note, done: !!statusRow.health_done },
              bdc_experts: { note: statusRow.bdc_experts_note, done: !!statusRow.bdc_experts_done },
              bdc_review: { note: statusRow.bdc_review_note, done: !!statusRow.bdc_review_done },
            },
          };
        } else {
          contract = null;
        }
      }

      return txt({
        project_id,
        client_documents,
        client_documents_summary: { provided, total: client_documents.length },
        tech_conditions: condRes.results ?? [],
        client_logo_url: logo && logo.length > 0 ? logo : null,
        ...(isAdmin ? { contract } : { contract_note: 'admin-only' }),
        note:
          'client_documents = захиалагчаас ирэх/ирсэн бичиг баримтын бүртгэл (status: pending/provided/not_required). ' +
          'tech_conditions = техникийн нөхцөл. ' +
          'contract = гэрээний хугацаа + funding_milestones (санхүүжилтийн үе шат) + agency_notes (НОБГ/ЭМ/БДС) — ЗӨВХӨН admin. ' +
          'passport/clients/team_shares-ийг get_project_report-оос ав.',
      });
    },
  );
}
