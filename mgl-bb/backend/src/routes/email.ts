/**
 * Gmail integration routes (/api/email).
 *
 * Feeds the existing per-project correspondence ledger from real mailboxes:
 *   • Admins register the 5-10 monitored mailboxes (Workspace via service
 *     account, or plain @gmail via the OAuth consent flow).
 *   • A cron (index.ts `scheduled`) + `POST /sync` pull new messages into
 *     email_messages (untriaged).
 *   • Admins triage each message — pick a project + doc_type (RFI / CR /
 *     Албан бичиг / Meeting Report) — which writes a correspondence_log row
 *     (`POST /messages/:id/classify`).
 *   • Outbound mail is sent through Gmail (`POST /send`) and, when a project
 *     + doc_type is supplied, also logged to the ledger.
 *
 * Everything is admin-tier only (ACL decision: all admins see all mailboxes)
 * EXCEPT `GET /oauth/callback`, which Google redirects the browser to — it is
 * exempted from authMiddleware and instead trusts a signed `state` token.
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import { signToken, verifyToken } from '../lib/jwt';
import {
  isAdminRole,
  isDocType,
  type Env,
  type AppVariables,
  type EmailAccountRow,
  type DocType,
} from '../types';
import {
  getAccessTokenForAccount,
  buildOAuthConsentUrl,
  exchangeOAuthCode,
} from '../lib/google/googleAuth';
import { getProfile, markRead, getRawMessage } from '../lib/google/gmailClient';
import { encryptSecret } from '../lib/crypto/secretBox';
import { syncAllMailboxes, backfillMailboxes } from '../lib/emailSync';
import { nextRefNo } from '../lib/refNo';
import { EmailSendError, sendViaGmail } from '../lib/emailSend';
import {
  getAccountTeamIds,
  setAccountTeamIds,
} from '../lib/emailAccountTeams';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const UB_TZ = 'Asia/Ulaanbaatar';

/** Stable public origin of this worker for OAuth redirect URIs. */
function apiOrigin(c: { req: { url: string }; env: Env }): string {
  if (c.env.API_PUBLIC_URL) return c.env.API_PUBLIC_URL.replace(/\/+$/, '');
  return new URL(c.req.url).origin;
}

/** YYYY-MM-DD in Ulaanbaatar for an absolute ISO instant. */
function ubDateFromIso(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** email direction → correspondence_log direction. */
function ledgerDirection(emailDir: string): 'sent' | 'received' {
  return emailDir === 'out' ? 'sent' : 'received';
}

/** Extract distinct in-domain email addresses from free-form From/To/Cc header
 *  strings (handles `Name <addr@x>, other@y` forms).  Lowercased + deduped +
 *  sorted.  Used to auto-derive the alias filter list with no schema change. */
function extractDomainAddrs(rawValues: (string | null)[], domain: string): string[] {
  const d = domain.toLowerCase().replace(/[.]/g, '\\.');
  const re = new RegExp(`[A-Za-z0-9._%+\\-]+@${d}`, 'gi');
  const set = new Set<string>();
  for (const v of rawValues) {
    if (!v) continue;
    const matches = v.match(re);
    if (matches) for (const m of matches) set.add(m.toLowerCase());
  }
  return [...set].sort();
}

/** Public mailbox providers — for these, "in-domain" addresses are just random
 *  external senders (gmail.com etc.), not aliases, so the alias filter is
 *  meaningless and would be polluted by everyone who emails the mailbox. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'qq.com',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ================================================================== */
/*  OAuth callback — MUST be defined first and stays un-gated.        */
/*  (authMiddleware exempts this exact path; see middleware/auth.ts.) */
/* ================================================================== */

router.get('/oauth/callback', async (c) => {
  const frontend = (c.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const fail = (reason: string) =>
    c.redirect(`${frontend}/app/admin/email?connected=0&error=${encodeURIComponent(reason)}`);

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return fail('missing_code_or_state');

  const payload = await verifyToken(state, c.env.JWT_SECRET);
  if (!payload) return fail('invalid_state');
  // The `state` must be a token minted specifically for this flow — a normal
  // session JWT (same {sub,role} shape, same secret) must NOT be replayable
  // here, and the initiator must still be admin-tier.
  if (payload.purpose !== 'email_oauth') return fail('invalid_state_purpose');
  if (!isAdminRole(payload.role)) return fail('forbidden');
  const pendingId = payload.sub;

  // Bind to the pending OAuth row only — never a workspace row or an
  // arbitrary id, so a sub-collision can't graft a token onto another mailbox.
  const pending = await c.env.DB.prepare(
    "SELECT * FROM email_accounts WHERE id = ? AND auth_type = 'oauth'",
  )
    .bind(pendingId)
    .first<EmailAccountRow>();
  if (!pending) return fail('account_not_found');

  try {
    const redirectUri = `${apiOrigin(c)}/api/email/oauth/callback`;
    const tokens = await exchangeOAuthCode(c.env, code, redirectUri);
    if (!tokens.refresh_token) return fail('no_refresh_token');
    if (!c.env.EMAIL_ENCRYPTION_KEY) return fail('encryption_key_unset');

    const enc = await encryptSecret(tokens.refresh_token, c.env.EMAIL_ENCRYPTION_KEY);
    await c.env.DB.prepare(
      `UPDATE email_accounts
         SET refresh_token_enc = ?, is_active = 1, last_sync_error = NULL,
             updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(enc, pendingId)
      .run();

    return c.redirect(`${frontend}/app/admin/email?connected=1`);
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 120) : 'exchange_failed');
  }
});

/* ================================================================== */
/*  Everything below is admin-only.                                   */
/* ================================================================== */

/* ----------------------------- Accounts --------------------------- */

/** Public shape — never leaks refresh_token_enc. */
const ACCOUNT_COLUMNS =
  'id, address, label, auth_type, history_id, last_synced_at, last_sync_error, watch_expiration, is_active, created_at, updated_at';

router.get('/accounts', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${ACCOUNT_COLUMNS} FROM email_accounts ORDER BY id`,
  ).all();
  const accounts = results ?? [];
  const withTeams = await Promise.all(
    accounts.map(async (a) => ({
      ...a,
      team_ids: await getAccountTeamIds(c.env.DB, (a as { id: number }).id),
    })),
  );
  return c.json({ accounts: withTeams });
});

router.post('/accounts', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ address?: string; label?: string }>()
    .catch(() => ({}) as { address?: string; label?: string });
  const address = (body.address ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return c.json({ error: 'Зөв и-мэйл хаяг оруулна уу' }, 400);

  try {
    const ins = await c.env.DB.prepare(
      `INSERT INTO email_accounts (address, label, auth_type, is_active, created_by_id)
       VALUES (?, ?, 'workspace', 1, ?)
       RETURNING ${ACCOUNT_COLUMNS}`,
    )
      .bind(address, body.label?.trim() || null, user.sub)
      .first();
    return c.json({ account: ins }, 201);
  } catch {
    return c.json({ error: 'Энэ хаяг аль хэдийн бүртгэгдсэн байна' }, 409);
  }
});

router.patch('/accounts/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req
    .json<{ label?: string | null; is_active?: boolean; team_ids?: number[] }>()
    .catch(() => ({}) as { label?: string | null; is_active?: boolean; team_ids?: number[] });

  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (body.label !== undefined) {
    sets.push('label = ?');
    args.push(body.label ? body.label.trim() || null : null);
  }
  if (body.is_active !== undefined) {
    sets.push('is_active = ?');
    args.push(body.is_active ? 1 : 0);
  }
  if (sets.length === 0 && body.team_ids === undefined) {
    return c.json({ error: 'No fields to update' }, 400);
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    args.push(id);
    await c.env.DB.prepare(`UPDATE email_accounts SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...args)
      .run();
  }
  if (body.team_ids !== undefined) {
    const teamIds = Array.isArray(body.team_ids)
      ? body.team_ids.filter((n) => Number.isFinite(n))
      : [];
    await setAccountTeamIds(c.env.DB, id, teamIds);
  }
  const row = await c.env.DB.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM email_accounts WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const team_ids = await getAccountTeamIds(c.env.DB, id);
  return c.json({ account: { ...row, team_ids } });
});

router.delete('/accounts/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  // D1 does not enforce foreign keys on this database, so the ON DELETE
  // CASCADE / SET NULL clauses declared in migration 0087 never fire. Clean
  // up children explicitly, leaf-first, mirroring scripts/wipe_all_projects.sql.
  // (R2 objects are removed below — CASCADE could never reach R2 anyway.)
  await c.env.DB.batch([
    // Detach any ledger rows that point back at this mailbox's messages.
    c.env.DB.prepare(
      `UPDATE correspondence_log SET email_message_id = NULL
       WHERE email_message_id IN (SELECT id FROM email_messages WHERE account_id = ?)`,
    ).bind(id),
    c.env.DB.prepare(
      `DELETE FROM email_attachments
       WHERE message_id IN (SELECT id FROM email_messages WHERE account_id = ?)`,
    ).bind(id),
    c.env.DB.prepare('DELETE FROM email_messages WHERE account_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM email_accounts WHERE id = ?').bind(id),
  ]);

  // Best-effort: drop this mailbox's R2 blobs (bodies + attachments) which all
  // live under the `email/<id>/` prefix.  Paginated; never blocks the response.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        let cursor: string | undefined;
        do {
          const listed = await c.env.MEDIA_BUCKET.list({ prefix: `email/${id}/`, cursor });
          if (listed.objects.length > 0) {
            await c.env.MEDIA_BUCKET.delete(listed.objects.map((o) => o.key));
          }
          cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
      } catch (e) {
        console.error(`[email] R2 cleanup for account ${id} failed:`, e);
      }
    })(),
  );

  return c.json({ ok: true });
});

/** Connectivity check — mint a token and read the Gmail profile. */
router.post('/accounts/:id/test', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const account = await c.env.DB.prepare('SELECT * FROM email_accounts WHERE id = ?')
    .bind(id)
    .first<EmailAccountRow>();
  if (!account) return c.json({ error: 'Not found' }, 404);
  try {
    const token = await getAccessTokenForAccount(c.env, account);
    const profile = await getProfile(token);
    return c.json({ ok: true, emailAddress: profile.emailAddress, historyId: profile.historyId });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, 200);
  }
});

/* ------------------------- OAuth connect flow --------------------- */

router.get('/oauth/start', requireAdmin(), async (c) => {
  const user = c.get('user');
  if (!c.env.GOOGLE_OAUTH_CLIENT_ID) {
    return c.json({ error: 'OAuth client тохируулаагүй байна (GOOGLE_OAUTH_CLIENT_ID)' }, 400);
  }
  const address = (c.req.query('address') ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return c.json({ error: 'Зөв и-мэйл хаяг оруулна уу' }, 400);

  // Upsert a pending oauth row (inactive until the callback stores a token).
  const row = await c.env.DB.prepare(
    `INSERT INTO email_accounts (address, auth_type, is_active, created_by_id)
       VALUES (?, 'oauth', 0, ?)
     ON CONFLICT(address) DO UPDATE SET auth_type = 'oauth', updated_at = datetime('now')
     RETURNING id`,
  )
    .bind(address, user.sub)
    .first<{ id: number }>();
  if (!row) return c.json({ error: 'Could not create pending account' }, 500);

  // state = short-lived signed token carrying the pending row id in `sub`,
  // scoped with purpose='email_oauth' so it can't be confused with a session
  // JWT in the un-gated callback.
  const state = await signToken(
    { sub: row.id, role: user.role, purpose: 'email_oauth' },
    c.env.JWT_SECRET,
    0.25,
  );
  const redirectUri = `${apiOrigin(c)}/api/email/oauth/callback`;
  const url = buildOAuthConsentUrl(c.env, redirectUri, state, address);
  return c.json({ url });
});

/* ----------------------------- Sync ------------------------------- */

router.post('/sync', requireAdmin(), async (c) => {
  const results = await syncAllMailboxes(c.env);
  return c.json({ results });
});

/** Deep one-off backfill over a chosen window (days: 30 | 90 | 180 | 365).
 *  Optional account_id limits it to one mailbox; otherwise all active ones. */
router.post('/backfill', requireAdmin(), async (c) => {
  const body = await c.req
    .json<{ account_id?: number; days?: number }>()
    .catch(() => ({}) as { account_id?: number; days?: number });
  const allowed = [30, 90, 180, 365];
  const days = allowed.includes(Number(body.days)) ? Number(body.days) : 180;
  const accountId =
    body.account_id && Number.isFinite(Number(body.account_id))
      ? Number(body.account_id)
      : undefined;
  const results = await backfillMailboxes(c.env, days, accountId);
  return c.json({ results, days });
});

/** Untriaged count — powers the sidebar badge. */
/**
 * Inbox-ийн «хувилбар» — ХЯМД polling-д (2026-09-11, D1 аудит).
 *
 * MailInboxPage нь `/threads`-ийг минут тутам дахин татдаг байсан: тэр асуулга
 * бүх 4 600 захиаг thread-ээр бүлэглэдэг тул нэг удаад 74 000 D1 мөр — inbox
 * нээлттэй цаг бүрд 4.4 сая мөр.  Одоо хөтөч ЭНЭ гарцыг л минут тутам шалгаад
 * (1 мөр: MAX(id) = сүүлд орсон захиа), хувилбар өөрчлөгдсөн үед л жагсаалтаа
 * дахин татна.  Захиа зөвхөн cron sync (2 мин) -ээр нэмэгддэг тул MAX(id)
 * нь «шинэ захиа ирсэн үү» гэдгийг бүрэн илэрхийлнэ; унших/ангилах өөрчлөлт
 * нь ижил хөтөч дээр локал invalidation-оор аль хэдийн тусдаг.
 */
router.get('/inbox-version', requireAdmin(), async (c) => {
  const row = await c.env.DB.prepare('SELECT MAX(id) AS max_id FROM email_messages').first<{
    max_id: number | null;
  }>();
  return c.json({ version: String(row?.max_id ?? 0) });
});

router.get('/triage-count', requireAdmin(), async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM email_messages WHERE triaged = 0 AND is_deleted = 0',
  ).first<{ n: number }>();
  return c.json({ count: row?.n ?? 0 });
});

/**
 * Ангилах / илгээх төслийн сонголт.  `GET /api/projects`-ыг ДУУДАХГҮЙ:
 * тэр нь progress CTE + `asr_only` хассан.  Энд id+нэр, ЗХ төсөл ОРНО.
 */
router.get('/projects', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name
       FROM projects p
      ORDER BY (p.status = 'active') DESC, p.name`,
  ).all();
  return c.json({ projects: results ?? [] });
});

/** Distinct in-domain recipient/sender aliases derived from synced mail.
 *  Powers the alias filter dropdown on the triage page — no schema change. */
router.get('/aliases', requireAdmin(), async (c) => {
  const accountId = c.req.query('account_id');
  const scoped = !!(accountId && Number.isFinite(Number(accountId)));

  // Domains to extract: the chosen account's, or the union of all accounts'.
  let domains: string[];
  if (scoped) {
    const acct = await c.env.DB.prepare('SELECT address FROM email_accounts WHERE id = ?')
      .bind(Number(accountId))
      .first<{ address: string }>();
    domains = acct?.address.includes('@') ? [acct.address.split('@')[1]!.toLowerCase()] : [];
  } else {
    const { results } = await c.env.DB.prepare('SELECT DISTINCT address FROM email_accounts').all<{
      address: string;
    }>();
    domains = [
      ...new Set(
        (results ?? [])
          .map((r) => (r.address.includes('@') ? r.address.split('@')[1]!.toLowerCase() : ''))
          .filter(Boolean),
      ),
    ];
  }
  // Drop public providers (gmail.com etc.) — their in-domain addresses are
  // external people, not aliases, so the dropdown would be noise.
  domains = domains.filter((d) => !PUBLIC_EMAIL_DOMAINS.has(d));
  if (domains.length === 0) return c.json({ aliases: [] });

  // DISTINCT collapses repeated header strings → the regex runs over a handful
  // of rows, not every message.
  const sql = scoped
    ? 'SELECT DISTINCT from_addr, to_addrs, cc_addrs FROM email_messages WHERE is_deleted = 0 AND account_id = ?'
    : 'SELECT DISTINCT from_addr, to_addrs, cc_addrs FROM email_messages WHERE is_deleted = 0';
  const stmt = c.env.DB.prepare(sql);
  const { results } = await (scoped ? stmt.bind(Number(accountId)) : stmt).all<{
    from_addr: string | null;
    to_addrs: string | null;
    cc_addrs: string | null;
  }>();

  const raw: (string | null)[] = [];
  for (const r of results ?? []) raw.push(r.from_addr, r.to_addrs, r.cc_addrs);

  const set = new Set<string>();
  for (const dom of domains) for (const a of extractDomainAddrs(raw, dom)) set.add(a);
  return c.json({ aliases: [...set].sort() });
});

/* --------------------------- Messages ----------------------------- */

/** Shared WHERE builder for the flat message list AND the thread list, so
 *  both apply identical filter semantics (triaged / account / direction /
 *  category / alias / free-text). Always seeds `m.is_deleted = 0`. */
function buildMessageFilters(c: {
  req: { query: (key: string) => string | undefined };
}): { where: string[]; args: (string | number)[] } {
  const where: string[] = ['m.is_deleted = 0'];
  const args: (string | number)[] = [];

  const triaged = c.req.query('triaged') ?? '0'; // '0' | '1' | 'all'
  if (triaged === '0') where.push('m.triaged = 0');
  else if (triaged === '1') where.push('m.triaged = 1');

  const accountId = c.req.query('account_id');
  if (accountId && Number.isFinite(Number(accountId))) {
    where.push('m.account_id = ?');
    args.push(Number(accountId));
  }

  // Direction filter — 'in' (received) | 'out' (sent). Omitted = both.
  const direction = c.req.query('direction');
  if (direction === 'in' || direction === 'out') {
    where.push('m.direction = ?');
    args.push(direction);
  }

  // Category filter using Gmail's auto-classification (stored in label_ids):
  // 'convo' = real correspondence (not Promotions/Social), 'promo' = ads.
  const cat = c.req.query('cat') ?? 'all';
  if (cat === 'convo') {
    where.push(
      "(m.label_ids IS NULL OR (m.label_ids NOT LIKE '%CATEGORY_PROMOTIONS%' AND m.label_ids NOT LIKE '%CATEGORY_SOCIAL%'))",
    );
  } else if (cat === 'promo') {
    where.push("m.label_ids LIKE '%CATEGORY_PROMOTIONS%'");
  }

  // Alias filter — matches to/cc (incoming) OR from (outgoing sent-as).
  const addr = (c.req.query('addr') ?? '').trim();
  if (addr) {
    where.push('(m.to_addrs LIKE ? OR m.cc_addrs LIKE ? OR m.from_addr LIKE ?)');
    const likeAddr = `%${addr}%`;
    args.push(likeAddr, likeAddr, likeAddr);
  }

  const q = (c.req.query('q') ?? '').trim();
  if (q) {
    where.push('(m.subject LIKE ? OR m.from_addr LIKE ? OR m.snippet LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }

  return { where, args };
}

router.get('/messages', requireAdmin(), async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size') ?? '50') || 50));
  const { where, args } = buildMessageFilters(c);
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM email_messages m ${whereSql}`)
    .bind(...args)
    .first<{ n: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.account_id, a.address AS account_address, m.direction,
            m.from_addr, m.to_addrs, m.cc_addrs, m.subject, m.snippet,
            m.internal_date, m.is_read, m.triaged, m.correspondence_id,
            (SELECT COUNT(*) FROM email_attachments ea WHERE ea.message_id = m.id) AS attachment_count
     FROM email_messages m
     JOIN email_accounts a ON a.id = m.account_id
     ${whereSql}
     ORDER BY m.internal_date DESC, m.id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...args, pageSize, (page - 1) * pageSize)
    .all();

  return c.json({
    messages: results ?? [],
    total: totalRow?.n ?? 0,
    page,
    page_size: pageSize,
  });
});

/** Thread list — one row per Gmail conversation (thread_id) for the Gmail-style
 *  inbox. Same filters/pagination as /messages, but grouped. NULL/empty
 *  thread_id → each message becomes its own singleton thread (`m:<id>`). */
router.get('/threads', requireAdmin(), async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size') ?? '50') || 50));
  const { where, args } = buildMessageFilters(c);
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT COALESCE(NULLIF(m.thread_id, ''), 'm:' || m.id) AS tkey
       FROM email_messages m
       ${whereSql}
       GROUP BY tkey
     )`,
  )
    .bind(...args)
    .first<{ n: number }>();

  const { results } = await c.env.DB.prepare(
    `WITH filtered AS (
       SELECT m.id, m.account_id, m.thread_id, m.direction, m.from_addr,
              m.subject, m.snippet, m.internal_date, m.is_read, m.triaged,
              COALESCE(NULLIF(m.thread_id, ''), 'm:' || m.id) AS tkey,
              (SELECT COUNT(*) FROM email_attachments ea WHERE ea.message_id = m.id) AS att_ct
       FROM email_messages m
       ${whereSql}
     ),
     ranked AS (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY tkey ORDER BY internal_date DESC, id DESC) AS rn
       FROM filtered
     ),
     agg AS (
       SELECT tkey,
              COUNT(*)                                     AS message_count,
              SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
              MAX(triaged)                                 AS any_triaged,
              MIN(triaged)                                 AS all_triaged,
              MAX(CASE WHEN att_ct > 0 THEN 1 ELSE 0 END)  AS has_attachments,
              COUNT(DISTINCT account_id)                   AS account_count,
              GROUP_CONCAT(DISTINCT from_addr)             AS participants_raw
       FROM filtered GROUP BY tkey
     )
     SELECT r.tkey AS thread_key, r.thread_id, r.id AS latest_message_id,
            r.account_id, a.address AS account_address, r.direction,
            r.from_addr AS latest_from, r.subject AS latest_subject,
            r.snippet AS latest_snippet, r.internal_date AS latest_date,
            ag.message_count, ag.unread_count, ag.any_triaged, ag.all_triaged,
            ag.has_attachments, ag.account_count, ag.participants_raw
     FROM ranked r
     JOIN agg ag ON ag.tkey = r.tkey
     JOIN email_accounts a ON a.id = r.account_id
     WHERE r.rn = 1
     ORDER BY r.internal_date DESC, r.id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...args, pageSize, (page - 1) * pageSize)
    .all();

  return c.json({
    threads: results ?? [],
    total: totalRow?.n ?? 0,
    page,
    page_size: pageSize,
  });
});

/** Thread detail — all non-deleted messages in a Gmail thread, oldest→newest,
 *  plus attachments keyed by message_id. Spans accounts (a thread can touch
 *  more than one monitored mailbox); the admin gate is the authorization. */
router.get('/threads/:threadId', requireAdmin(), async (c) => {
  const threadId = c.req.param('threadId');
  if (!threadId) return c.json({ error: 'Invalid thread' }, 400);

  const { results: msgs } = await c.env.DB.prepare(
    `SELECT m.id, m.account_id, a.address AS account_address, m.gmail_message_id,
            m.thread_id, m.rfc_message_id, m.direction, m.from_addr, m.to_addrs,
            m.cc_addrs, m.subject, m.snippet, m.body_text, m.body_html_r2_key,
            m.internal_date, m.label_ids, m.is_read, m.triaged, m.correspondence_id
     FROM email_messages m
     JOIN email_accounts a ON a.id = m.account_id
     WHERE m.thread_id = ? AND m.is_deleted = 0
     ORDER BY m.internal_date ASC, m.id ASC`,
  )
    .bind(threadId)
    .all<{ id: number }>();

  const messages = msgs ?? [];
  if (messages.length === 0) return c.json({ error: 'Not found' }, 404);

  const ids = messages.map((m) => m.id);
  const ph = ids.map(() => '?').join(',');
  const { results: atts } = await c.env.DB.prepare(
    `SELECT id, message_id, filename, mime_type, size_bytes, r2_key
     FROM email_attachments WHERE message_id IN (${ph}) ORDER BY message_id, id`,
  )
    .bind(...ids)
    .all<{ message_id: number }>();

  const attachments: Record<number, unknown[]> = {};
  for (const a of atts ?? []) {
    (attachments[a.message_id] ??= []).push(a);
  }

  return c.json({ thread_id: threadId, messages, attachments });
});

router.get('/messages/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const message = await c.env.DB.prepare(
    `SELECT m.*, a.address AS account_address
     FROM email_messages m JOIN email_accounts a ON a.id = m.account_id
     WHERE m.id = ?`,
  )
    .bind(id)
    .first();
  if (!message) return c.json({ error: 'Not found' }, 404);
  const { results: attachments } = await c.env.DB.prepare(
    `SELECT id, filename, mime_type, size_bytes, r2_key FROM email_attachments WHERE message_id = ? ORDER BY id`,
  )
    .bind(id)
    .all();
  return c.json({ message, attachments: attachments ?? [] });
});

/** Serve a stored HTML body (authed — email content stays behind auth). */
router.get('/messages/:id/body.html', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare('SELECT body_html_r2_key FROM email_messages WHERE id = ?')
    .bind(id)
    .first<{ body_html_r2_key: string | null }>();
  if (!row?.body_html_r2_key) return c.notFound();
  const obj = await c.env.MEDIA_BUCKET.get(row.body_html_r2_key);
  if (!obj) return c.notFound();
  return new Response(obj.body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});

/** Raw RFC822 source of a synced message — fetched live from Gmail (we don't
 *  store it).  Powers the reading pane's «Эх харах» / show-source view. */
router.get('/messages/:id/raw', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT account_id, gmail_message_id FROM email_messages WHERE id = ? AND is_deleted = 0',
  )
    .bind(id)
    .first<{ account_id: number; gmail_message_id: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const account = await c.env.DB.prepare('SELECT * FROM email_accounts WHERE id = ?')
    .bind(row.account_id)
    .first<EmailAccountRow>();
  if (!account) return c.json({ error: 'Mailbox not found' }, 404);
  try {
    const token = await getAccessTokenForAccount(c.env, account);
    const raw = await getRawMessage(token, row.gmail_message_id);
    return new Response(raw, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'failed' }, 502);
  }
});

/** Stream an attachment (authed). */
router.get('/attachments/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const att = await c.env.DB.prepare(
    'SELECT filename, mime_type, r2_key FROM email_attachments WHERE id = ?',
  )
    .bind(id)
    .first<{ filename: string | null; mime_type: string | null; r2_key: string | null }>();
  if (!att?.r2_key) return c.notFound();
  const obj = await c.env.MEDIA_BUCKET.get(att.r2_key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  headers.set('Content-Type', att.mime_type || 'application/octet-stream');
  headers.set(
    'Content-Disposition',
    `inline; filename="${(att.filename || 'attachment').replace(/"/g, '')}"`,
  );
  return new Response(obj.body, { headers });
});

/**
 * The one capability this module needs from the request's execution context.
 *
 * ⚠️ Deliberately NOT the global `ExecutionContext`. Two incompatible
 * declarations of that name are in scope: Hono's own (what `c.executionCtx`
 * actually is) and `@cloudflare/workers-types`' `ExecutionContext<Props>`,
 * which gained a required `tracing` member in a recent workers-types bump.
 * Annotating with the global one made `softDeleteMessageIds(c.env, c.executionCtx, …)`
 * fail to typecheck at both call sites — the repo's only place that passes the
 * context to a helper instead of calling `c.executionCtx.waitUntil(...)` inline.
 * Structural typing on just `waitUntil` satisfies both and cannot drift again.
 */
type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

/** Soft-delete a set of message ids (app-only — never touches Gmail). A
 *  tombstone (is_deleted=1) keeps the next sync from re-importing them; we
 *  still detach the ledger, drop attachment rows, and free R2 blobs. Shared
 *  by DELETE /messages/:id and POST /messages/delete. Returns rows affected. */
async function softDeleteMessageIds(
  env: Env,
  executionCtx: WaitUntilCtx,
  ids: number[],
): Promise<number> {
  if (ids.length === 0) return 0;
  // Chunk to stay under D1's bound-parameter ceiling; a selected thread can
  // expand to many message ids.
  const CHUNK = 90;
  const allRows: { id: number; account_id: number; gmail_message_id: string }[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const inPh = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, account_id, gmail_message_id FROM email_messages
       WHERE is_deleted = 0 AND id IN (${inPh})`,
    )
      .bind(...chunk)
      .all<{ id: number; account_id: number; gmail_message_id: string }>();
    const rows = results ?? [];
    if (rows.length === 0) continue;
    allRows.push(...rows);
    const liveIds = rows.map((r) => r.id);
    const ph = liveIds.map(() => '?').join(',');
    stmts.push(
      env.DB.prepare(
        `UPDATE correspondence_log SET email_message_id = NULL WHERE email_message_id IN (${ph})`,
      ).bind(...liveIds),
      env.DB.prepare(`DELETE FROM email_attachments WHERE message_id IN (${ph})`).bind(...liveIds),
      env.DB.prepare(
        `UPDATE email_messages SET is_deleted = 1, body_text = NULL, body_html_r2_key = NULL WHERE id IN (${ph})`,
      ).bind(...liveIds),
    );
  }
  if (allRows.length === 0) return 0;
  await env.DB.batch(stmts);

  // Free each message's R2 blobs (body + attachments) — best-effort.
  executionCtx.waitUntil(
    (async () => {
      for (const r of allRows) {
        try {
          const prefix = `email/${r.account_id}/${r.gmail_message_id}/`;
          let cursor: string | undefined;
          do {
            const listed = await env.MEDIA_BUCKET.list({ prefix, cursor });
            if (listed.objects.length > 0) {
              await env.MEDIA_BUCKET.delete(listed.objects.map((o) => o.key));
            }
            cursor = listed.truncated ? listed.cursor : undefined;
          } while (cursor);
        } catch (e) {
          console.error(`[email] R2 cleanup for message ${r.id} failed:`, e);
        }
      }
    })(),
  );
  return allRows.length;
}

/** Resolve a set of message ids from explicit ids + whole thread_ids (each
 *  thread expands to all its non-deleted message ids). Deduped. */
async function resolveMessageIds(
  env: Env,
  ids: number[],
  threadIds: string[],
): Promise<number[]> {
  const out = new Set<number>(ids);
  if (threadIds.length > 0) {
    const ph = threadIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id FROM email_messages WHERE is_deleted = 0 AND thread_id IN (${ph})`,
    )
      .bind(...threadIds)
      .all<{ id: number }>();
    for (const r of results ?? []) out.add(r.id);
  }
  return [...out];
}

/** Remove a message from our app (NOT from Gmail) — soft-delete tombstone. */
router.delete('/messages/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const deleted = await softDeleteMessageIds(c.env, c.executionCtx, [id]);
  if (deleted === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

/** Bulk soft-delete (app-only) for the inbox multi-select. Accepts explicit
 *  message `ids` and/or whole `thread_ids` (each expands to all its messages).
 *  thread_ids capped at 100. */
router.post('/messages/delete', requireAdmin(), async (c) => {
  const body = await c.req
    .json<{ ids?: number[]; thread_ids?: string[] }>()
    .catch(() => ({}) as { ids?: number[]; thread_ids?: string[] });
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((n) => Number.isFinite(Number(n))).map(Number)
    : [];
  const threadIds = Array.isArray(body.thread_ids)
    ? body.thread_ids.filter((s) => typeof s === 'string' && s).slice(0, 100)
    : [];
  if (ids.length === 0 && threadIds.length === 0) {
    return c.json({ error: 'ids эсвэл thread_ids шаардлагатай' }, 400);
  }
  const finalIds = await resolveMessageIds(c.env, ids, threadIds);
  if (finalIds.length === 0) return c.json({ ok: true, deleted: 0 });
  const deleted = await softDeleteMessageIds(c.env, c.executionCtx, finalIds);
  return c.json({ ok: true, deleted });
});

/** Mark one message read/unread in D1. read=true best-effort mirrors to Gmail
 *  (removes UNREAD); read=false is D1-only — Gmail's markRead has no inverse,
 *  so app unread state can intentionally diverge from Gmail. */
router.post('/messages/:id/read', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ read?: boolean }>().catch(() => ({}) as { read?: boolean });
  const read = body.read !== false; // default → mark read
  const res = await c.env.DB.prepare(
    'UPDATE email_messages SET is_read = ? WHERE id = ? AND is_deleted = 0',
  )
    .bind(read ? 1 : 0, id)
    .run();

  if (read) {
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const row = await c.env.DB.prepare(
            'SELECT account_id, gmail_message_id FROM email_messages WHERE id = ?',
          )
            .bind(id)
            .first<{ account_id: number; gmail_message_id: string }>();
          if (!row) return;
          const account = await c.env.DB.prepare('SELECT * FROM email_accounts WHERE id = ?')
            .bind(row.account_id)
            .first<EmailAccountRow>();
          if (!account) return;
          const token = await getAccessTokenForAccount(c.env, account);
          await markRead(token, row.gmail_message_id);
        } catch (e) {
          console.error('[email] markRead mirror failed:', e);
        }
      })(),
    );
  }
  return c.json({ ok: true, updated: res.meta.changes ?? 0 });
});

/** Bulk mark read/unread by message `ids` and/or whole `thread_id`(s) (D1 only
 *  — no Gmail mirror on bulk, to stay within Worker subrequest limits).
 *  Resolves everything to a single id set (thread_ids capped at 100). */
router.post('/messages/read', requireAdmin(), async (c) => {
  const body = await c.req
    .json<{ ids?: number[]; thread_id?: string; thread_ids?: string[]; read?: boolean }>()
    .catch(
      () =>
        ({}) as { ids?: number[]; thread_id?: string; thread_ids?: string[]; read?: boolean },
    );
  if (typeof body.read !== 'boolean') {
    return c.json({ error: 'read (boolean) шаардлагатай' }, 400);
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((n) => Number.isFinite(Number(n))).map(Number)
    : [];
  const threadIds = Array.isArray(body.thread_ids)
    ? body.thread_ids.filter((s) => typeof s === 'string' && s).slice(0, 100)
    : [];
  if (body.thread_id) threadIds.push(body.thread_id);
  if (ids.length === 0 && threadIds.length === 0) {
    return c.json({ error: 'ids эсвэл thread_id шаардлагатай' }, 400);
  }

  const finalIds = await resolveMessageIds(c.env, ids, threadIds);
  if (finalIds.length === 0) return c.json({ ok: true, updated: 0 });

  const read = body.read ? 1 : 0;
  let updated = 0;
  const CHUNK = 90;
  for (let i = 0; i < finalIds.length; i += CHUNK) {
    const chunk = finalIds.slice(i, i + CHUNK);
    const ph = chunk.map(() => '?').join(',');
    const res = await c.env.DB.prepare(
      `UPDATE email_messages SET is_read = ? WHERE is_deleted = 0 AND id IN (${ph})`,
    )
      .bind(read, ...chunk)
      .run();
    updated += res.meta.changes ?? 0;
  }
  return c.json({ ok: true, updated });
});

/* --------------------------- Classify ----------------------------- */

/** Copy the message's first stored attachment into the public media bucket
 *  so the ledger's single `attachment_url` can link to it (matching the
 *  existing screenshot behaviour, which serves from /media/*). */
async function copyFirstAttachmentToMedia(env: Env, messageId: number): Promise<string | null> {
  const att = await env.DB.prepare(
    'SELECT id, filename, mime_type, r2_key FROM email_attachments WHERE message_id = ? AND r2_key IS NOT NULL ORDER BY id LIMIT 1',
  )
    .bind(messageId)
    .first<{ id: number; filename: string | null; mime_type: string | null; r2_key: string }>();
  if (!att) return null;
  const obj = await env.MEDIA_BUCKET.get(att.r2_key);
  if (!obj) return null;
  const flatName = `corr-att-${messageId}-${att.id}-${(att.filename || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 100)}`;
  await env.MEDIA_BUCKET.put(flatName, obj.body, {
    httpMetadata: { contentType: att.mime_type || 'application/octet-stream' },
  });
  return `/media/${flatName}`;
}

/**
 * Core "file this email into the correspondence ledger" action — shared by the
 * `/messages/:id/classify` route and the MCP `triage_email` tool
 * (src/mcp/tools/emailTriage.ts).  Inserts a `correspondence_log` row
 * (auto-numbering `ref_no` per project+type+month when not given) and flags the
 * email `triaged`.  Does NOT touch Gmail — mark-read stays the route's concern.
 * Returns the created correspondence id + resolved fields, or an error string.
 */
export async function classifyEmailMessage(
  env: Env,
  opts: {
    messageId: number;
    projectId: number;
    docType: DocType;
    authorId: number;
    direction?: 'sent' | 'received';
    logDate?: string;
    refNo?: string;
  },
): Promise<
  | { ok: true; correspondence_id: number; ref_no: string; direction: 'sent' | 'received'; log_date: string; subject: string; project_name: string; already_triaged: boolean }
  | { ok: false; error: string }
> {
  const msg = await env.DB.prepare('SELECT * FROM email_messages WHERE id = ?').bind(opts.messageId).first<{
    id: number; account_id: number; direction: string; from_addr: string | null;
    to_addrs: string | null; cc_addrs: string | null; subject: string | null;
    body_text: string | null; snippet: string | null; internal_date: string | null; triaged: number;
  }>();
  if (!msg) return { ok: false, error: 'Email message not found' };

  const proj = await env.DB.prepare('SELECT name FROM projects WHERE id = ? LIMIT 1').bind(opts.projectId).first<{ name: string }>();
  if (!proj) return { ok: false, error: 'Project not found' };

  const direction = opts.direction === 'sent' || opts.direction === 'received' ? opts.direction : ledgerDirection(msg.direction);
  const logDate = typeof opts.logDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.logDate) ? opts.logDate : ubDateFromIso(msg.internal_date);
  const subject = (msg.subject ?? '(гарчиггүй)').trim() || '(гарчиггүй)';
  const ledgerBody = msg.body_text ?? msg.snippet ?? null;
  const refNo = opts.refNo?.trim() || (await nextRefNo(env.DB, opts.projectId, opts.docType, logDate));
  const attachmentUrl = await copyFirstAttachmentToMedia(env, opts.messageId);

  const ins = await env.DB.prepare(
    `INSERT INTO correspondence_log
       (project_id, author_id, log_date, direction, subject, body, attachment_url,
        from_email, to_email, cc_emails, doc_type, ref_no, email_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).bind(opts.projectId, opts.authorId, logDate, direction, subject, ledgerBody, attachmentUrl, msg.from_addr, msg.to_addrs, msg.cc_addrs, opts.docType, refNo, opts.messageId).first<{ id: number }>();

  await env.DB.prepare('UPDATE email_messages SET triaged = 1, correspondence_id = ? WHERE id = ?').bind(ins?.id ?? null, opts.messageId).run();

  return { ok: true, correspondence_id: ins?.id ?? 0, ref_no: refNo, direction, log_date: logDate, subject, project_name: proj.name, already_triaged: msg.triaged === 1 };
}

router.post('/messages/:id/classify', requireAdmin(), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req
    .json<{
      project_id?: number;
      doc_type?: string;
      direction?: string;
      log_date?: string;
      ref_no?: string;
      mark_read?: boolean;
    }>()
    .catch(() => ({}) as Record<string, never>);

  const projectId = Number(body.project_id);
  if (!Number.isFinite(projectId)) return c.json({ error: 'project_id шаардлагатай' }, 400);
  if (!isDocType(body.doc_type)) {
    return c.json({ error: "doc_type нь 'rfi'|'cr'|'official'|'mr' байх ёстой" }, 400);
  }

  const msg = await c.env.DB.prepare('SELECT * FROM email_messages WHERE id = ?').bind(id).first<{
    id: number;
    account_id: number;
    direction: string;
    from_addr: string | null;
    to_addrs: string | null;
    cc_addrs: string | null;
    subject: string | null;
    body_text: string | null;
    snippet: string | null;
    internal_date: string | null;
    triaged: number;
  }>();
  if (!msg) return c.json({ error: 'Message not found' }, 404);

  const proj = await c.env.DB.prepare('SELECT 1 AS x FROM projects WHERE id = ? LIMIT 1')
    .bind(projectId)
    .first<{ x: number }>();
  if (!proj) return c.json({ error: 'Project not found' }, 404);

  const direction =
    body.direction === 'sent' || body.direction === 'received'
      ? body.direction
      : ledgerDirection(msg.direction);
  const logDate =
    typeof body.log_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.log_date)
      ? body.log_date
      : ubDateFromIso(msg.internal_date);
  const subject = (msg.subject ?? '(гарчиггүй)').trim() || '(гарчиггүй)';
  const ledgerBody = msg.body_text ?? msg.snippet ?? null;
  // Auto-number the document (RFI-202606-001 …) per project + type + month
  // when the admin didn't type an explicit ref_no.
  const refNo =
    body.ref_no?.trim() || (await nextRefNo(c.env.DB, projectId, body.doc_type, logDate));

  const attachmentUrl = await copyFirstAttachmentToMedia(c.env, id);

  const ins = await c.env.DB.prepare(
    `INSERT INTO correspondence_log
       (project_id, author_id, log_date, direction, subject, body, attachment_url,
        from_email, to_email, cc_emails, doc_type, ref_no, email_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(
      projectId,
      user.sub,
      logDate,
      direction,
      subject,
      ledgerBody,
      attachmentUrl,
      msg.from_addr,
      msg.to_addrs,
      msg.cc_addrs,
      body.doc_type,
      refNo,
      id,
    )
    .first<{ id: number }>();

  await c.env.DB.prepare(
    'UPDATE email_messages SET triaged = 1, correspondence_id = ? WHERE id = ?',
  )
    .bind(ins?.id ?? null, id)
    .run();

  // Best-effort: mark the Gmail message read so the mailbox owner sees it
  // was processed.  Never block classification on this.
  if (body.mark_read) {
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const account = await c.env.DB.prepare('SELECT * FROM email_accounts WHERE id = ?')
            .bind(msg.account_id)
            .first<EmailAccountRow>();
          if (account) {
            const token = await getAccessTokenForAccount(c.env, account);
            const gmailId = await c.env.DB.prepare(
              'SELECT gmail_message_id FROM email_messages WHERE id = ?',
            )
              .bind(id)
              .first<{ gmail_message_id: string }>();
            if (gmailId) await markRead(token, gmailId.gmail_message_id);
          }
        } catch (e) {
          console.error('[email] markRead failed:', e);
        }
      })(),
    );
  }

  return c.json({ ok: true, correspondence_id: ins?.id }, 201);
});

/* ----------------------------- Send ------------------------------- */

router.post('/send', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{
      account_id?: number;
      from?: string;
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body_html?: string;
      body_text?: string;
      thread_id?: string;
      in_reply_to?: string;
      references?: string;
      project_id?: number;
      doc_type?: string;
      log_date?: string;
      attachments?: Array<{ r2_key: string; filename?: string; mime_type?: string }>;
    }>()
    .catch(() => ({}) as Record<string, never>);

  const accountId = Number(body.account_id);
  if (!Number.isFinite(accountId)) return c.json({ error: 'account_id шаардлагатай' }, 400);

  const account = await c.env.DB.prepare('SELECT * FROM email_accounts WHERE id = ?')
    .bind(accountId)
    .first<EmailAccountRow>();
  if (!account) return c.json({ error: 'Mailbox not found' }, 404);

  let sentResult;
  try {
    sentResult = await sendViaGmail(c.env, {
      account,
      from: body.from,
      to: body.to ?? '',
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject ?? '',
      body_html: body.body_html,
      body_text: body.body_text,
      thread_id: body.thread_id,
      in_reply_to: body.in_reply_to,
      references: body.references,
      attachments: body.attachments,
    });
  } catch (e) {
    const err = e instanceof EmailSendError ? e : new EmailSendError('Илгээж чадсангүй', 502);
    return c.json({ error: err.message }, err.status as 400 | 404 | 409 | 502);
  }

  const nowIso = new Date().toISOString();
  const to = (body.to ?? '').trim();
  const subject = (body.subject ?? '').trim();
  const wantsLedger = Number.isFinite(Number(body.project_id)) && isDocType(body.doc_type);

  const ins = await c.env.DB.prepare(
    `INSERT INTO email_messages
       (account_id, gmail_message_id, thread_id, direction, from_addr, to_addrs,
        cc_addrs, subject, snippet, body_text, internal_date, is_read, triaged)
     VALUES (?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(account_id, gmail_message_id) DO NOTHING
     RETURNING id`,
  )
    .bind(
      accountId,
      sentResult.gmailMessageId,
      sentResult.threadId,
      sentResult.fromAddr,
      to,
      body.cc?.trim() || null,
      subject,
      sentResult.snippet,
      body.body_text?.trim() || null,
      nowIso,
      wantsLedger ? 1 : 0,
    )
    .first<{ id: number }>();

  let correspondenceId: number | null = null;
  if (wantsLedger) {
    const logDate =
      typeof body.log_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.log_date)
        ? body.log_date
        : ubDateFromIso(nowIso);
    const corr = await c.env.DB.prepare(
      `INSERT INTO correspondence_log
         (project_id, author_id, log_date, direction, subject, body,
          from_email, to_email, cc_emails, doc_type, email_message_id)
       VALUES (?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
      .bind(
        Number(body.project_id),
        user.sub,
        logDate,
        subject,
        body.body_text?.trim() || null,
        sentResult.fromAddr,
        to,
        body.cc?.trim() || null,
        body.doc_type as string,
        ins?.id ?? null,
      )
      .first<{ id: number }>();
    correspondenceId = corr?.id ?? null;
    if (ins?.id && correspondenceId) {
      await c.env.DB.prepare('UPDATE email_messages SET correspondence_id = ? WHERE id = ?')
        .bind(correspondenceId, ins.id)
        .run();
    }
  }

  return c.json({ ok: true, message_id: ins?.id, correspondence_id: correspondenceId }, 201);
});

export default router;
