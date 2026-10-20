/**
 * Mailbox sync — pulls new Gmail messages for every active email_account
 * into D1 (+ attachments into R2).  Driven by the cron `scheduled` handler
 * in index.ts (every few minutes) and by the manual `POST /api/email/sync`.
 *
 * Sync strategy per mailbox:
 *   • Has a stored history_id  → incremental `history.list` since that
 *     cursor.  If Gmail 404s (cursor older than its ~1-week retention) we
 *     fall back to a recent full list.
 *   • No history_id (first run) → list the last 30 days, capped, then pin
 *     the cursor to the mailbox's current historyId.
 *
 * Messages are stored raw and untriaged; an admin later classifies each
 * into a project + doc_type (routes/email.ts → /classify), which is what
 * creates the correspondence_log row.  Direction ('in'/'out') is inferred
 * here by matching the mailbox address against From.
 */
import type { Env, EmailAccountRow } from '../types';
import { getAccessTokenForAccount } from './google/googleAuth';
import {
  getProfile,
  getMessage,
  listMessageIds,
  listAddedMessageIds,
  getAttachmentBytes,
  parseGmailMessage,
  type ParsedMessage,
} from './google/gmailClient';

/** Bodies/attachments above these bounds are skipped to keep D1 rows small
 *  and avoid pulling huge files on the cron path. */
const MAX_BODY_TEXT_CHARS = 50_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** First-run backfill bound so connecting a busy mailbox isn't a thundering herd. */
const INITIAL_BACKFILL_QUERY = 'newer_than:30d';
const INITIAL_BACKFILL_MAX = 50;

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 120);
}

/** 'out' when Gmail marked the message SENT, else 'in'.
 *
 *  Gmail's `SENT` label is authoritative for outgoing mail and covers send-as
 *  aliases — unlike the old `from.includes(address)` substring heuristic, which
 *  (a) missed alias-sent mail (from didn't contain the primary address → wrongly
 *  'in') and (b) false-matched incoming senders whose address merely contained
 *  the mailbox address as a substring (wrongly 'out').  Fall back to an EXACT
 *  From-address match only when the message carries no labels at all (shouldn't
 *  happen — every Gmail message has at least SENT or INBOX). */
function inferDirection(address: string, parsed: ParsedMessage): 'in' | 'out' {
  if (parsed.labelIds.includes('SENT')) return 'out';
  if (parsed.labelIds.length > 0) return 'in';
  const from = (parsed.from ?? '').toLowerCase();
  const addr = address.toLowerCase();
  return from === addr || from.includes(`<${addr}>`) ? 'out' : 'in';
}

interface SyncResult {
  account: string;
  fetched: number;
  stored: number;
  error?: string;
}

async function storeMessage(
  env: Env,
  account: EmailAccountRow,
  token: string,
  gmailId: string,
): Promise<boolean> {
  // Skip if we already have it (the unique index also protects us, but this
  // avoids re-downloading attachments for messages seen on a prior run).
  const existing = await env.DB.prepare(
    'SELECT 1 AS x FROM email_messages WHERE account_id = ? AND gmail_message_id = ? LIMIT 1',
  )
    .bind(account.id, gmailId)
    .first<{ x: number }>();
  if (existing) return false;

  const raw = await getMessage(token, gmailId);
  const parsed = parseGmailMessage(raw);
  const direction = inferDirection(account.address, parsed);

  // Large HTML bodies go to R2; D1 keeps a capped plain-text copy + snippet.
  let bodyHtmlKey: string | null = null;
  if (parsed.bodyHtml) {
    bodyHtmlKey = `email/${account.id}/${gmailId}/body.html`;
    await env.MEDIA_BUCKET.put(bodyHtmlKey, new TextEncoder().encode(parsed.bodyHtml), {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
  }
  const bodyText = parsed.bodyText ? parsed.bodyText.slice(0, MAX_BODY_TEXT_CHARS) : null;

  const ins = await env.DB.prepare(
    `INSERT INTO email_messages
       (account_id, gmail_message_id, thread_id, rfc_message_id, direction,
        from_addr, to_addrs, cc_addrs, subject, snippet, body_text,
        body_html_r2_key, internal_date, label_ids, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, gmail_message_id) DO NOTHING
     RETURNING id`,
  )
    .bind(
      account.id,
      gmailId,
      parsed.threadId,
      parsed.rfcMessageId,
      direction,
      parsed.from,
      parsed.to,
      parsed.cc,
      parsed.subject,
      parsed.snippet,
      bodyText,
      bodyHtmlKey,
      parsed.internalDateIso,
      parsed.labelIds.join(','),
      parsed.labelIds.includes('UNREAD') ? 0 : 1,
    )
    .first<{ id: number }>();

  // No id means a concurrent sync (manual + cron, or two cron ticks) already
  // inserted this message between our existence check and this INSERT.  The
  // ON CONFLICT DO NOTHING keeps that race from throwing a UNIQUE error — we
  // simply treat it as "not stored by us" and move on.
  const messageId = ins?.id;
  if (!messageId) return false;

  // Download attachment bytes to R2, then write all attachment rows in ONE
  // batch so the message + its attachment metadata commit atomically.  If the
  // batch fails we roll back the message row, so the next sync re-processes it
  // cleanly — otherwise the early-exit guard above would leave the message
  // permanently stored with missing attachment rows that can never backfill.
  const attStatements: D1PreparedStatement[] = [];
  for (let i = 0; i < parsed.attachments.length; i++) {
    const att = parsed.attachments[i]!;
    let r2Key: string | null = null;
    if (att.size > 0 && att.size <= MAX_ATTACHMENT_BYTES) {
      try {
        const bytes = await getAttachmentBytes(token, gmailId, att.attachmentId);
        r2Key = `email/${account.id}/${gmailId}/att-${i}-${safeName(att.filename)}`;
        await env.MEDIA_BUCKET.put(r2Key, bytes, {
          httpMetadata: { contentType: att.mimeType },
        });
      } catch (e) {
        // A single failed attachment download shouldn't drop the message — we
        // still record the metadata row with a null r2_key.
        console.error(`[emailSync] attachment ${att.filename} failed:`, e);
        r2Key = null;
      }
    }
    attStatements.push(
      env.DB.prepare(
        `INSERT INTO email_attachments
           (message_id, gmail_attachment_id, filename, mime_type, size_bytes, r2_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(messageId, att.attachmentId, att.filename, att.mimeType, att.size, r2Key),
    );
  }

  if (attStatements.length > 0) {
    try {
      await env.DB.batch(attStatements);
    } catch (e) {
      await env.DB.prepare('DELETE FROM email_messages WHERE id = ?').bind(messageId).run();
      throw e;
    }
  }
  return true;
}

/** `last_synced_at` (SQLite `datetime('now')` = 'YYYY-MM-DD HH:MM:SS' UTC) энэ
 *  хугацаанаас хуучин уу.  Задлагдахгүй/хоосон бол хуучирсанд тооцно. */
function isStale(stamp: string | null | undefined, maxAgeMs: number): boolean {
  if (!stamp) return true;
  const ms = Date.parse(stamp.includes('T') ? stamp : stamp.replace(' ', 'T') + 'Z');
  return !Number.isFinite(ms) || Date.now() - ms > maxAgeMs;
}
const SYNC_STAMP_MAX_AGE_MS = 10 * 60_000;

/** D1-ийн bind хязгаар 100 — 90-өөр хуваана. */
const ID_CHUNK = 90;

/** Аль хэдийн хадгалагдсан gmail id-уудыг хасна (нэг хайрцагт, IN-асуулгаар). */
async function filterUnknownIds(env: Env, accountId: number, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return ids;
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { results } = await env.DB.prepare(
      `SELECT gmail_message_id FROM email_messages
        WHERE account_id = ? AND gmail_message_id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(accountId, ...chunk)
      .all<{ gmail_message_id: string }>();
    for (const r of results ?? []) known.add(r.gmail_message_id);
  }
  return ids.filter((id) => !known.has(id));
}

/** Sync a single mailbox.  Never throws — records the error on the row. */
export async function syncMailbox(env: Env, account: EmailAccountRow): Promise<SyncResult> {
  const result: SyncResult = { account: account.address, fetched: 0, stored: 0 };
  try {
    const token = await getAccessTokenForAccount(env, account);

    // Current mailbox historyId — also the cursor we pin after this run.
    const profile = await getProfile(token);
    let newIds: string[] = [];

    if (account.history_id) {
      try {
        const hist = await listAddedMessageIds(token, account.history_id);
        newIds = hist.ids;
      } catch (e) {
        // Expired cursor (404) → recent full list fallback.
        console.warn(`[emailSync] history fallback for ${account.address}:`, e);
        const listed = await listMessageIds(token, {
          q: INITIAL_BACKFILL_QUERY,
          maxResults: INITIAL_BACKFILL_MAX,
        });
        newIds = listed.ids.map((m) => m.id);
      }
    } else {
      const listed = await listMessageIds(token, {
        q: INITIAL_BACKFILL_QUERY,
        maxResults: INITIAL_BACKFILL_MAX,
      });
      newIds = listed.ids.map((m) => m.id);
    }

    // Always top up recent SENT mail.  history.list/messageAdded can lag (or
    // miss) sent items, and the initial backfill cap is dominated by inbound
    // mail — so without this our "Явсан" view stays empty.  Sent volume is
    // low; dedupe + the existence check keep this cheap.
    try {
      const sent = await listMessageIds(token, { q: 'in:sent newer_than:30d', maxResults: 50 });
      newIds = [...new Set([...newIds, ...sent.ids.map((m) => m.id)])];
    } catch (e) {
      console.warn(`[emailSync] sent top-up failed for ${account.address}:`, e);
    }

    result.fetched = newIds.length;
    // 2026-09-11 (D1 аудит): «аль хэдийн байгаа» шалгалтыг НЭГ IN-асуулгаар.
    // Өмнө нь `storeMessage` id бүрд тусдаа SELECT хийдэг тул 2 хайрцаг × 50
    // sent-id × 720 cron = өдөрт 72 000 D1 асуулга (бүгд аль хэдийн байгаа мөр).
    // Одоо cron бүрт хайрцаг тутам нэг асуулга; `storeMessage`-ийн өөрийн
    // шалгалт ХЭВЭЭР (зэрэгцээ гар sync-тэй уралдахад хамгаалалт).
    newIds = await filterUnknownIds(env, account.id, newIds);
    for (const id of newIds) {
      // Isolate per-message failures: a single message that 404s on
      // messages.get (Gmail occasionally lists ids it can't return) must not
      // abort the whole mailbox — otherwise history_id never advances and the
      // sync gets stuck re-trying the same bad id forever, never storing the
      // good ones (incl. sent mail).
      try {
        const stored = await storeMessage(env, account, token, id);
        if (stored) result.stored++;
      } catch (e) {
        console.error(`[emailSync] skip message ${id} for ${account.address}:`, e);
      }
    }

    // 2026-09-11 (D1 аудит): бичлэгийг ХЯЗГААРЛАНА.  Өмнө нь cron бүрт хайрцаг
    // тутам UPDATE (өдөрт 1 440 мөр бичилт — юу ч өөрчлөгдөөгүй байсан ч).
    // history_id өөрчлөгдсөн / шинэ захиа орсон / өмнөх алдаатай байсан /
    // `last_synced_at` 10 минутаас хуучирсан үед л бичнэ; UI-ийн «сүүлд
    // sync» цаг хамгийн ихдээ 10 минут хоцорно.
    const shouldWrite =
      profile.historyId !== account.history_id ||
      result.stored > 0 ||
      !!account.last_sync_error ||
      isStale(account.last_synced_at, SYNC_STAMP_MAX_AGE_MS);
    if (shouldWrite) {
      await env.DB.prepare(
        `UPDATE email_accounts
           SET history_id = ?, last_synced_at = datetime('now'),
               last_sync_error = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(profile.historyId, account.id)
        .run();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.error = msg;
    await env.DB.prepare(
      `UPDATE email_accounts
         SET last_sync_error = ?, last_synced_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(msg.slice(0, 500), account.id)
      .run();
  }
  return result;
}

/** Sync every active mailbox.  Called from cron and the manual endpoint. */
export async function syncAllMailboxes(env: Env): Promise<SyncResult[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM email_accounts WHERE is_active = 1 ORDER BY id',
  ).all<EmailAccountRow>();
  const accounts = results ?? [];
  const out: SyncResult[] = [];
  // Sequential: 5-10 mailboxes is small, and serial keeps us well under
  // Gmail per-user rate limits without bespoke throttling.
  for (const account of accounts) {
    out.push(await syncMailbox(env, account));
  }
  return out;
}

/** One run fetches at most this many messages — bounds Worker subrequests
 *  (each message ≈ 1 get + its attachments) and CPU/wall time. */
const BACKFILL_MAX_MESSAGES = 300;

/** Deep one-off backfill over a chosen window (e.g. last 180 days).  Pages
 *  newest-first up to the cap; the regular cron keeps owning history_id, so
 *  this never moves the incremental cursor.  Already-stored / tombstoned
 *  messages are skipped by storeMessage's existence check. */
export async function backfillMailbox(
  env: Env,
  account: EmailAccountRow,
  days: number,
): Promise<SyncResult & { truncated?: boolean }> {
  const result: SyncResult & { truncated?: boolean } = {
    account: account.address,
    fetched: 0,
    stored: 0,
  };
  try {
    const token = await getAccessTokenForAccount(env, account);
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 12 && ids.length < BACKFILL_MAX_MESSAGES; page++) {
      const listed = await listMessageIds(token, {
        q: `newer_than:${days}d`,
        maxResults: 100,
        pageToken,
      });
      for (const m of listed.ids) ids.push(m.id);
      if (!listed.nextPageToken) break;
      pageToken = listed.nextPageToken;
    }
    if (ids.length >= BACKFILL_MAX_MESSAGES) result.truncated = true;
    const bounded = ids.slice(0, BACKFILL_MAX_MESSAGES);
    result.fetched = bounded.length;
    for (const id of bounded) {
      try {
        if (await storeMessage(env, account, token, id)) result.stored++;
      } catch (e) {
        console.error(`[backfill] skip message ${id} for ${account.address}:`, e);
      }
    }
    await env.DB.prepare(
      "UPDATE email_accounts SET last_synced_at = datetime('now'), last_sync_error = NULL, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(account.id)
      .run();
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

/** Backfill one mailbox (by id) or every active mailbox. */
export async function backfillMailboxes(
  env: Env,
  days: number,
  accountId?: number,
): Promise<Array<SyncResult & { truncated?: boolean }>> {
  const sql = accountId
    ? 'SELECT * FROM email_accounts WHERE id = ?'
    : 'SELECT * FROM email_accounts WHERE is_active = 1 ORDER BY id';
  const stmt = env.DB.prepare(sql);
  const { results } = await (accountId ? stmt.bind(accountId) : stmt).all<EmailAccountRow>();
  const out: Array<SyncResult & { truncated?: boolean }> = [];
  for (const account of results ?? []) {
    out.push(await backfillMailbox(env, account, days));
  }
  return out;
}
