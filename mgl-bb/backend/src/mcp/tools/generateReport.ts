import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { assertVisible } from './report';
import { weasyprintEnabled } from '../../lib/weasyprint';
import { buildClientReportData, type Rag } from '../../lib/clientReport';
import {
  loadPerfReportInput,
  latestReportId,
  renderClientReportPdf,
} from '../../lib/clientReportRender';

const txt = (data: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
  ],
});

const ragLabel: Record<Rag, string> = {
  green: 'On track',
  amber: 'At risk',
  red: 'Behind',
  unknown: 'N/A',
};

/** generate_report — produce the client-facing design-progress report PDF and
 *  return a download link + a text summary. Registered for ALL authenticated
 *  users (clients are member-gated by assertVisible; the compute layer suppresses
 *  internal data for the 'client' audience). */
export function registerGenerateReportTool(server: McpServer, env: Env, user: McpProps) {
  server.registerTool(
    'generate_report',
    {
      title: 'Generate client design-progress report (PDF)',
      description:
        'Generate the client-facing AEC design-progress report for ONE project as ' +
        'a PDF (cover, executive summary with RAG status, schedule variance vs the ' +
        '50/70 S-curve, discipline-by-discipline progress, drawing register, ' +
        'milestones, recent activity, risks, next-period plan). Stores the PDF and ' +
        'returns a download URL plus a text summary. Builds on the latest issued ' +
        'performance report by default; pass report_id to pick a specific one. ' +
        'Internal data (contributor points, individual names, approval queue) is ' +
        'omitted — this is the client variant. Get project_id from list_projects.',
      inputSchema: {
        project_id: z.number().int().describe('Project id from list_projects.'),
        report_id: z
          .number()
          .int()
          .optional()
          .describe('Performance-report id to build on. Default: latest issued (else latest draft).'),
        lang: z
          .enum(['mn', 'en'])
          .optional()
          .describe("Report language: 'mn' (default) or 'en'."),
      },
    },
    async ({ project_id, report_id, lang }) => {
      if (!(await assertVisible(env, user, project_id)))
        return txt({ error: `Project ${project_id} not visible to you.` });

      const language: 'mn' | 'en' = lang === 'en' ? 'en' : 'mn';
      const reportId = report_id ?? (await latestReportId(env, project_id));
      const report = reportId != null ? await loadPerfReportInput(env, project_id, reportId) : null;

      // Compute the data once for the text summary.
      const data = await buildClientReportData({
        env,
        user,
        projectId: project_id,
        report,
        audience: 'client',
        lang: language,
      });

      const lines: string[] = [];
      lines.push(`# ${data.passport?.full_title || data.project.name}`);
      if (data.report) lines.push(`Report №${String(data.report.report_no).padStart(2, '0')} · ${data.report.status}`);
      lines.push(`Overall progress: ${Math.round(data.overall_progress)}%`);
      lines.push(
        `Schedule: ${ragLabel[data.schedule.rag]}` +
          (data.schedule.variance !== null
            ? ` (variance ${data.schedule.variance >= 0 ? '+' : ''}${data.schedule.variance.toFixed(1)} pts; ` +
              `${Math.round(data.schedule.elapsed_pct ?? 0)}% time elapsed vs ${Math.round(
                data.schedule.expected_pct ?? 0,
              )}% expected)`
            : ' (contract dates missing)'),
      );
      if (data.schedule.finish_passed && data.overall_progress < 100)
        lines.push('⚠ Contract finish date has passed but work is incomplete.');
      lines.push('');
      lines.push('Disciplines:');
      for (const d of data.disciplines)
        lines.push(`  - ${d.team_code} ${d.team_name_mn}: ${Math.round(d.progress)}% (${ragLabel[d.rag]}, ${d.task_count} tasks)`);
      if (data.authored.risks.length) lines.push(`Risks recorded: ${data.authored.risks.length}`);
      if (data.authored.next_plan.length) lines.push(`Next-period plan items: ${data.authored.next_plan.length}`);

      // Render + store the PDF (best-effort — the summary is useful on its own).
      let pdf_url: string | null = null;
      let pdf_error: string | null = null;
      if (!weasyprintEnabled(env)) {
        pdf_error = 'WeasyPrint container is not configured (WEASYPRINT_SVC).';
      } else {
        try {
          const pdf = await renderClientReportPdf(env, user, {
            projectId: project_id,
            reportId,
            audience: 'client',
            lang: language,
          });
          const key = `client-reports/${project_id}-${reportId ?? 'live'}-${crypto.randomUUID()}.pdf`;
          await env.MEDIA_BUCKET.put(key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
          const base = env.API_PUBLIC_URL?.replace(/\/+$/, '');
          pdf_url = base ? `${base}/media/${key}` : `/media/${key}`;
        } catch (err) {
          pdf_error = err instanceof Error ? err.message : String(err);
        }
      }

      return txt({
        project_id,
        report_id: reportId,
        lang: language,
        summary: lines.join('\n'),
        pdf_url,
        pdf_note: pdf_url
          ? 'Unguessable key acts as the access token; the link is world-readable by key.'
          : undefined,
        pdf_error: pdf_error ?? undefined,
      });
    },
  );
}

/**
 * get_report_content — буцаана: тухайн ГАНЦ төслийн тайлангийн бүтэн ДАТА-г
 * (buildClientReportData) бүтэцлэгдсэн JSON хэлбэрээр, ямар ч файл (PDF/docx)
 * рендэрлэхгүйгээр.  Claude үүнийг get_report_template-тай хослуулж Microsoft
 * Word (.docx) тайланг ӨӨРӨӨ зохиоход зориулав.
 *
 * Анхдагчаар амьд өгөгдөл (report=null); report_id заавал performance-report дээр
 * тулгуурлана.  audience анхдагч 'internal' (staff-д баялаг); client role бол
 * аюулгүйн үүднээс 'client'-руу дарамтална (нэр, pending дотоод мэдээллийг нуух).
 * assertVisible-аар member-gated — generate_report-тай ижил.  Бүх нэвтэрсэн
 * хэрэглэгчид бүртгэнэ.
 */
export function registerReportContentTool(server: McpServer, env: Env, user: McpProps) {
  server.registerTool(
    'get_report_content',
    {
      title: 'Get report content data (to author a Word report)',
      description:
        'Return the full AEC design-progress report DATA for ONE project as ' +
        'structured JSON — overall progress, schedule variance vs the 50/70 S-curve ' +
        'with RAG status, per-discipline progress (each with RAG), the block→drawing ' +
        'register with statuses, recent approved activity, and any authored summary/ ' +
        'risks/next-plan. Live current data by default; pass report_id to build on a ' +
        'specific performance report. Renders NO file — use this (with ' +
        'get_report_template) to compose the Word (.docx) report yourself. Internal ' +
        'fields follow your own visibility (clients get the client-safe view). Get ' +
        'project_id from list_projects.',
      inputSchema: {
        project_id: z.number().int().describe('Project id from list_projects.'),
        report_id: z
          .number()
          .int()
          .optional()
          .describe('Performance-report id to build on. Default: live current data.'),
        lang: z
          .enum(['mn', 'en'])
          .optional()
          .describe("Report language: 'mn' (default) or 'en'."),
        audience: z
          .enum(['internal', 'client'])
          .optional()
          .describe(
            "Data variant: 'internal' (default; includes names/pending for staff) or " +
              "'client' (client-safe: no individual names, no approval queue). Clients " +
              "always get the client-safe view regardless.",
          ),
      },
    },
    async ({ project_id, report_id, lang, audience }) => {
      if (!(await assertVisible(env, user, project_id)))
        return txt({ error: `Project ${project_id} not visible to you.` });

      const language: 'mn' | 'en' = lang === 'en' ? 'en' : 'mn';
      // Client role-д дотоод мэдээлэл алдагдахаас сэргийлж 'client'-руу дарамтална.
      const effectiveAudience: 'internal' | 'client' =
        user.role === 'client' ? 'client' : audience === 'client' ? 'client' : 'internal';

      const report =
        report_id != null ? await loadPerfReportInput(env, project_id, report_id) : null;

      const data = await buildClientReportData({
        env,
        user,
        projectId: project_id,
        report,
        audience: effectiveAudience,
        lang: language,
      });

      return txt(data);
    },
  );
}
