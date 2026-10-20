import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

type EmailListRow = {
  id: number;
  account_address: string;
  direction: 'in' | 'out';
  from_addr: string | null;
  to_addrs: string | null;
  subject: string | null;
  snippet: string | null;
  internal_date: string | null;
  is_read: 0 | 1;
  triaged: 0 | 1;
  correspondence_id: number | null;
  attachment_count: number;
};

/**
 * list_emails — list synced Gmail inbox messages (metadata only, no bodies).
 * Admin-only (mirrors the `requireAdmin()` REST gate on /api/email/messages);
 * registered inside the isAdminRole block in MglMcpAgent.init.
 */
export function registerEmailTools(server: McpServer, env: Env, user: McpProps) {
  void user;
  server.registerTool(
    'list_emails',
    {
      title: 'List synced emails',
      description:
        'List synced Gmail inbox messages (metadata only — sender, subject, ' +
        'snippet, date, direction, read/triaged flags, attachment count; NO bodies). ' +
        'Call this for "what emails came in", triage queues, or finding a thread by ' +
        'subject/sender. Filter with q (search subject/sender/snippet), account_id, ' +
        'direction (in/out), triaged, and cat (convo hides promotions/social). ' +
        'Admin-only.',
      inputSchema: {
        q: z.string().trim().min(1).max(120).optional().describe('Search subject / sender / snippet.'),
        account_id: z.number().int().positive().optional().describe('Filter to one synced mailbox account id.'),
        direction: z.enum(['in', 'out']).optional().describe('Incoming or outgoing only.'),
        triaged: z.enum(['untriaged', 'triaged', 'all']).optional().describe("Triage state. Default 'all'."),
        cat: z.enum(['all', 'convo', 'promo']).optional().describe("Category. Default 'convo' (hides Promotions/Social)."),
        limit: z.number().int().min(1).max(100).optional().describe('Max emails to return (default 25).'),
      },
    },
    async ({ q, account_id, direction, triaged, cat, limit }) => {
      try {
        const lim = Math.min(100, Math.max(1, limit ?? 25));
        const tri = triaged ?? 'all';
        const category = cat ?? 'convo';

        const where: string[] = ['m.is_deleted = 0'];
        const args: (string | number)[] = [];
        if (tri === 'untriaged') where.push('m.triaged = 0');
        else if (tri === 'triaged') where.push('m.triaged = 1');
        if (account_id != null) {
          where.push('m.account_id = ?');
          args.push(account_id);
        }
        if (direction) {
          where.push('m.direction = ?');
          args.push(direction);
        }
        if (category === 'convo') {
          where.push("(m.label_ids IS NULL OR (m.label_ids NOT LIKE '%CATEGORY_PROMOTIONS%' AND m.label_ids NOT LIKE '%CATEGORY_SOCIAL%'))");
        } else if (category === 'promo') {
          where.push("m.label_ids LIKE '%CATEGORY_PROMOTIONS%'");
        }
        if (q) {
          where.push('(m.subject LIKE ? OR m.from_addr LIKE ? OR m.snippet LIKE ?)');
          const like = `%${q}%`;
          args.push(like, like, like);
        }
        const whereSql = `WHERE ${where.join(' AND ')}`;

        const [totalRow, listRes] = await Promise.all([
          env.DB.prepare(`SELECT COUNT(*) AS n FROM email_messages m ${whereSql}`).bind(...args).first<{ n: number }>(),
          env.DB.prepare(
            `SELECT m.id, a.address AS account_address, m.direction, m.from_addr, m.to_addrs,
                    m.subject, m.snippet, m.internal_date, m.is_read, m.triaged, m.correspondence_id,
                    (SELECT COUNT(*) FROM email_attachments ea WHERE ea.message_id = m.id) AS attachment_count
               FROM email_messages m
               JOIN email_accounts a ON a.id = m.account_id
               ${whereSql}
              ORDER BY m.internal_date DESC, m.id DESC LIMIT ?`,
          ).bind(...args, lim).all<EmailListRow>(),
        ]);

        const messages = (listRes.results ?? []).map((r) => ({
          id: r.id,
          account: r.account_address,
          direction: r.direction,
          from: r.from_addr,
          to: r.to_addrs,
          subject: r.subject,
          snippet: r.snippet,
          date: r.internal_date,
          is_read: r.is_read === 1,
          triaged: r.triaged === 1,
          attachments: r.attachment_count,
          correspondence_id: r.correspondence_id,
        }));

        return txt({ count: messages.length, total: totalRow?.n ?? messages.length, messages });
      } catch (e) {
        return txt({ error: String(e) });
      }
    },
  );
}
