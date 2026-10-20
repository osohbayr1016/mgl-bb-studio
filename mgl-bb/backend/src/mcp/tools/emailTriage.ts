import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { classifyEmailMessage } from '../../routes/email';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/**
 * triage_email — the FIRST write tool.  Files ONE email into a project's
 * correspondence ledger under a doc type, reusing the exact same
 * `classifyEmailMessage` the /messages/:id/classify route uses.  Confirm-gated:
 * default is a dry-run preview; `confirm:true` is required to actually write.
 * Admin-only (registered in the isAdminRole block in MglMcpAgent.init).
 */
export function registerEmailTriageTools(server: McpServer, env: Env, user: McpProps) {
  server.registerTool(
    'triage_email',
    {
      title: 'Triage / classify an email (write)',
      description:
        'Classify ONE incoming email into a project and document type, then file ' +
        'it into that project\'s correspondence ledger (marks the email triaged and ' +
        'auto-numbers a reference like RFI-202606-001). doc_type: rfi = Request for ' +
        'Information, cr = Change Request, official = Албан бичиг (official letter), ' +
        'mr = Meeting Report. THIS IS A WRITE ACTION. ALWAYS preview first by calling ' +
        'with confirm omitted/false; show the user what will be filed; only then call ' +
        'again with confirm:true to apply. Get email_id from list_emails and ' +
        'project_id from list_projects. Admin-only.',
      inputSchema: {
        email_id: z.number().int().describe('Email id (from list_emails).'),
        project_id: z.number().int().describe('Project id (from list_projects) to file the email under.'),
        doc_type: z.enum(['rfi', 'cr', 'official', 'mr']).describe('Document type: rfi | cr | official | mr.'),
        ref_no: z.string().trim().min(1).max(64).optional().describe('Override the auto-generated reference number (optional).'),
        confirm: z.boolean().optional().describe('Must be true to actually write. Default false = dry-run preview only.'),
      },
    },
    async ({ email_id, project_id, doc_type, ref_no, confirm }) => {
      try {
        const email = await env.DB.prepare(
          'SELECT id, subject, from_addr, direction, triaged, correspondence_id FROM email_messages WHERE id = ?',
        ).bind(email_id).first<{ id: number; subject: string | null; from_addr: string | null; direction: string; triaged: number; correspondence_id: number | null }>();
        if (!email) return txt({ error: `Email ${email_id} not found.` });
        const proj = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(project_id).first<{ name: string }>();
        if (!proj) return txt({ error: `Project ${project_id} not found.` });

        if (confirm !== true) {
          return txt({
            dry_run: true,
            message: 'Preview only — call again with confirm:true to file this email.',
            would_file: {
              email_id,
              subject: email.subject,
              from: email.from_addr,
              into_project: { id: project_id, name: proj.name },
              doc_type,
              ref_no: ref_no ?? '(auto-generated)',
            },
            already_triaged: email.triaged === 1,
            ...(email.triaged === 1
              ? { warning: 'This email is ALREADY triaged — filing again creates a second correspondence entry. Confirm only if intentional.' }
              : {}),
          });
        }

        const result = await classifyEmailMessage(env, {
          messageId: email_id,
          projectId: project_id,
          docType: doc_type,
          authorId: user.sub,
          refNo: ref_no,
        });
        if (!result.ok) return txt({ error: result.error });

        return txt({
          ok: true,
          message: `Filed email ${email_id} into "${result.project_name}" as ${doc_type} ${result.ref_no}.`,
          filed: {
            correspondence_id: result.correspondence_id,
            ref_no: result.ref_no,
            project: result.project_name,
            doc_type,
            direction: result.direction,
            log_date: result.log_date,
            subject: result.subject,
          },
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
