import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import { isAdminRole } from '../../types';
import type { McpProps } from '../MglMcpAgent';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const BODY_CAP = 20_000;
const QUOTE_CAP = 1_200;

/* ===================== get_email_message + compose_email_draft (admin) ===================== */

export function registerEmailReadTools(server: McpServer, env: Env, user: McpProps) {
  void user;

  server.registerTool(
    'get_email_message',
    {
      title: 'Read a full email',
      description:
        'Read ONE synced email in full — headers, the plain-text body, and the ' +
        'attachment list. Call this after list_emails to read a specific message ' +
        '(e.g. before triaging it or drafting a reply). Body is capped at 20k chars; ' +
        'an HTML-only body is flagged (stored in R2, not inlined). Admin-only.',
      inputSchema: {
        email_id: z.number().int().describe('Email id from list_emails.'),
      },
    },
    async ({ email_id }) => {
      try {
        const m = await env.DB.prepare(
          `SELECT m.id, a.address AS account, m.direction, m.from_addr, m.to_addrs, m.cc_addrs,
                  m.subject, m.snippet, m.body_text, m.body_html_r2_key, m.internal_date,
                  m.is_read, m.triaged, m.correspondence_id
             FROM email_messages m JOIN email_accounts a ON a.id = m.account_id
            WHERE m.id = ?`,
        ).bind(email_id).first<{
          id: number; account: string; direction: string; from_addr: string | null; to_addrs: string | null;
          cc_addrs: string | null; subject: string | null; snippet: string | null; body_text: string | null;
          body_html_r2_key: string | null; internal_date: string | null; is_read: 0 | 1; triaged: 0 | 1; correspondence_id: number | null;
        }>();
        if (!m) return txt({ error: `Email ${email_id} not found.` });

        const att = await env.DB.prepare(
          'SELECT id, filename, mime_type, size_bytes FROM email_attachments WHERE message_id = ? ORDER BY id',
        ).bind(email_id).all<{ id: number; filename: string | null; mime_type: string | null; size_bytes: number | null }>();

        const body = m.body_text ?? '';
        return txt({
          id: m.id,
          account: m.account,
          direction: m.direction,
          from: m.from_addr,
          to: m.to_addrs,
          cc: m.cc_addrs,
          subject: m.subject,
          date: m.internal_date,
          is_read: m.is_read === 1,
          triaged: m.triaged === 1,
          correspondence_id: m.correspondence_id,
          body_text: body.slice(0, BODY_CAP),
          body_truncated: body.length > BODY_CAP,
          html_only: !m.body_text && !!m.body_html_r2_key,
          attachments: att.results ?? [],
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );

  server.registerTool(
    'compose_email_draft',
    {
      title: 'Compose an email reply draft (no send)',
      description:
        'Build a ready-to-send email DRAFT and return it as structured text. This ' +
        'DOES NOT SEND anything — the user reviews and sends manually. Give ' +
        'reply_to_email_id to draft a reply (to/subject/quote are derived from the ' +
        'original), or to+subject for a fresh message. You write the body. Admin-only.',
      inputSchema: {
        body: z.string().min(1).max(20_000).describe('The email body you composed.'),
        reply_to_email_id: z.number().int().optional().describe('Email id being replied to (derives to/subject/quote).'),
        to: z.string().trim().min(1).max(500).optional().describe('Recipient(s) for a fresh message (when not a reply).'),
        cc: z.string().trim().max(500).optional().describe('Optional CC recipient(s).'),
        subject: z.string().trim().max(300).optional().describe('Subject for a fresh message (when not a reply).'),
      },
    },
    async ({ body, reply_to_email_id, to, cc, subject }) => {
      try {
        let from: string | null = null;
        let toAddr = to ?? null;
        let subj = subject ?? null;
        let quoted = '';

        if (reply_to_email_id != null) {
          const orig = await env.DB.prepare(
            `SELECT a.address AS account, m.from_addr, m.subject, m.snippet, m.body_text, m.internal_date
               FROM email_messages m JOIN email_accounts a ON a.id = m.account_id WHERE m.id = ?`,
          ).bind(reply_to_email_id).first<{ account: string; from_addr: string | null; subject: string | null; snippet: string | null; body_text: string | null; internal_date: string | null }>();
          if (!orig) return txt({ error: `Email ${reply_to_email_id} not found.` });
          from = orig.account;
          toAddr = toAddr ?? orig.from_addr;
          const os = (orig.subject ?? '').trim();
          subj = subj ?? (/^re:/i.test(os) ? os : `Re: ${os}`);
          const origBody = (orig.body_text ?? orig.snippet ?? '').slice(0, QUOTE_CAP);
          quoted = `\n\n----- Original message -----\nFrom: ${orig.from_addr ?? ''}\nDate: ${orig.internal_date ?? ''}\nSubject: ${os}\n\n${origBody}`;
        }

        if (!toAddr) return txt({ error: 'Provide reply_to_email_id (for a reply) or `to` (for a fresh message).' });

        return txt({
          draft: {
            from,
            to: toAddr,
            cc: cc ?? null,
            subject: subj ?? '(no subject)',
            body: body + quoted,
          },
          sent: false,
          note: 'DRAFT ONLY — nothing was sent. Review, then send manually from your mail client / the app.',
        });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}

/* ===================== get_correspondence_log (admin + member-staff) ===================== */

async function canReadCorrespondence(env: Env, user: McpProps, projectId: number): Promise<boolean> {
  if (isAdminRole(user.role)) return true;
  if (user.role === 'client') return false;
  const m = await env.DB.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, user.sub).first();
  return !!m;
}

export function registerCorrespondenceTools(server: McpServer, env: Env, user: McpProps) {
  server.registerTool(
    'get_correspondence_log',
    {
      title: 'Get project correspondence log',
      description:
        "List a project's official correspondence ledger (RFI / CR / official / " +
        'meeting-report entries filed from emails or added manually), newest first, ' +
        'with reference numbers, direction, dates, and parties. Call this to see what ' +
        'has been logged for a project or after triaging emails. Admin sees any ' +
        'project; staff must be a project member.',
      inputSchema: {
        project_id: z.number().int().describe('Project id from list_projects.'),
        doc_type: z.enum(['rfi', 'cr', 'official', 'mr']).optional().describe('Filter by document type.'),
        limit: z.number().int().min(1).max(200).optional().describe('Max entries (default 50).'),
      },
    },
    async ({ project_id, doc_type, limit }) => {
      try {
        if (!(await canReadCorrespondence(env, user, project_id))) {
          return txt({ error: `Correspondence for project ${project_id} not visible to you.` });
        }
        const lim = Math.min(200, Math.max(1, limit ?? 50));
        const where = doc_type ? 'AND cl.doc_type = ?' : '';
        const binds: (string | number)[] = doc_type ? [project_id, doc_type, lim] : [project_id, lim];
        const res = await env.DB.prepare(
          `SELECT cl.id, cl.ref_no, cl.doc_type, cl.direction, cl.log_date, cl.subject,
                  cl.from_email, cl.to_email, cl.attachment_url, cl.email_message_id,
                  u.full_name AS author_name
             FROM correspondence_log cl
             LEFT JOIN users u ON u.id = cl.author_id
            WHERE cl.project_id = ? ${where}
            ORDER BY cl.log_date DESC, cl.id DESC LIMIT ?`,
        ).bind(...binds).all();
        const entries = res.results ?? [];
        return txt({ project_id, count: entries.length, entries });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
