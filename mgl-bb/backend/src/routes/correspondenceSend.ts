/**
 * Correspondence Gmail send — scoped endpoints for project staff.
 * Mounted under /api/correspondence by correspondence.ts.
 */
import type { Hono } from 'hono';
import { canUseAccount, listSendableAccounts } from '../lib/emailAccountTeams';
import { handleCorrespondenceSend } from './correspondenceSendPost';
import {
  type CanWriteFn,
  type CorrespondenceCtx,
  extractDomainAddrs,
  parseClientContacts,
  PUBLIC_EMAIL_DOMAINS,
} from './correspondenceSendLib';

export function registerCorrespondenceSendRoutes(
  router: Hono<CorrespondenceCtx>,
  canWrite: CanWriteFn,
): void {
  router.get('/projects/:projectId/send-options', async (c) => {
    const viewer = c.get('user');
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);
    if (!(await canWrite(c.env.DB, projectId, viewer))) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const passport = await c.env.DB.prepare(
      'SELECT client_contacts_json FROM project_passport WHERE project_id = ?',
    )
      .bind(projectId)
      .first<{ client_contacts_json: string | null }>();

    const accounts = await listSendableAccounts(c.env.DB, viewer);
    const client_contacts = parseClientContacts(passport?.client_contacts_json ?? null).filter(
      (ct) => ct.email.trim(),
    );

    return c.json({
      accounts,
      client_contacts,
      can_send: accounts.length > 0,
    });
  });

  router.get('/aliases', async (c) => {
    const viewer = c.get('user');
    const accountId = Number(c.req.query('account_id'));
    if (!Number.isFinite(accountId)) return c.json({ error: 'account_id шаардлагатай' }, 400);
    if (!(await canUseAccount(c.env.DB, viewer, accountId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const account = await c.env.DB.prepare('SELECT address FROM email_accounts WHERE id = ?')
      .bind(accountId)
      .first<{ address: string }>();
    if (!account) return c.json({ error: 'Mailbox not found' }, 404);

    const domain = account.address.includes('@')
      ? account.address.split('@')[1]!.toLowerCase()
      : '';
    if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) return c.json({ aliases: [] });

    const { results } = await c.env.DB.prepare(
      'SELECT DISTINCT from_addr, to_addrs, cc_addrs FROM email_messages WHERE is_deleted = 0 AND account_id = ?',
    )
      .bind(accountId)
      .all<{ from_addr: string | null; to_addrs: string | null; cc_addrs: string | null }>();

    const raw: (string | null)[] = [];
    for (const r of results ?? []) raw.push(r.from_addr, r.to_addrs, r.cc_addrs);
    const aliases = extractDomainAddrs(raw, domain).filter(
      (a) => a !== account.address.toLowerCase(),
    );
    return c.json({ aliases });
  });

  router.post('/projects/:projectId/send', (c) => handleCorrespondenceSend(c, canWrite));
}
